// WF-831 — the project-declared dependency-setup step, and the fleet template
// that runs preparation then setup before the ceremony.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createDefaultPorts } from "../src/ports.js";
import { parseCoreConfig } from "../src/resolver/config.js";
import {
  DEFAULT_SETUP_TIMEOUT_SECONDS,
  MAX_SETUP_TIMEOUT_SECONDS,
  parseSetupTimeout,
} from "../src/resolver/workspace-setup.js";
import { ResolverService } from "../src/service.js";

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function config(rows: Record<string, string>): string {
  const extra = Object.entries(rows)
    .map(([key, value]) => `| **${key}** | ${value} |`)
    .join("\n");
  return `# Config\n\n| Key | Value |\n|-----|-------|\n| **Task Root** | \`_local\` |\n${extra}\n`;
}

function workspace(configText: string | null): { root: string; service: () => ResolverService; cleanup: () => void } {
  const root = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-"))));
  if (configText !== null) write(`${root}/_local/config.md`, configText);
  return {
    root,
    service: () =>
      new ResolverService({
        ...createDefaultPorts(root),
        listPlugins: () => ({ plugins: [], ok: true, contractOk: true, issues: [] }),
      }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("the keys are empty by default and parse from the project config only", () => {
  const empty = parseCoreConfig(config({}));
  assert.equal(empty.dependencySetupCommand, null);
  assert.equal(empty.dependencySetupTimeout, null);
  const placeholder = parseCoreConfig(config({ "Dependency Setup Command": "`<none>`" }));
  assert.equal(placeholder.dependencySetupCommand, null);
  const declared = parseCoreConfig(config({ "Dependency Setup Command": "`exit 0`", "Dependency Setup Timeout": "`30`" }));
  assert.equal(declared.dependencySetupCommand, "exit 0");
  assert.equal(declared.dependencySetupTimeout, "30");
});

test("the timeout defaults, falls back on garbage, and is held to the ceiling", () => {
  assert.equal(parseSetupTimeout(null).seconds, DEFAULT_SETUP_TIMEOUT_SECONDS);
  assert.equal(parseSetupTimeout("abc").seconds, DEFAULT_SETUP_TIMEOUT_SECONDS);
  assert.ok(parseSetupTimeout("abc").diagnostic);
  assert.equal(parseSetupTimeout("0").seconds, DEFAULT_SETUP_TIMEOUT_SECONDS);
  assert.equal(parseSetupTimeout("45").seconds, 45);
  assert.equal(parseSetupTimeout("999999").seconds, MAX_SETUP_TIMEOUT_SECONDS);
});

test("unprepared: no resolved project config blocks with a named reason", () => {
  const ws = workspace(null);
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unprepared");
  } finally {
    ws.cleanup();
  }
});

test("not-declared: an empty key runs nothing (inert by default)", () => {
  const ws = workspace(config({}));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "not-declared");
    assert.equal(result.command, null);
    assert.equal(result.reason, null);
  } finally {
    ws.cleanup();
  }
});

test("succeeded, then already-done: the declared command runs once and is echoed", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`echo ran > setup-marker.txt`" }));
  try {
    const first = ws.service().runWorkspaceSetup();
    assert.equal(first.status, "succeeded", JSON.stringify(first));
    assert.equal(first.command, "echo ran > setup-marker.txt");
    assert.equal(first.exitCode, 0);
    assert.equal(readFileSync(`${ws.root}/setup-marker.txt`, "utf8").trim(), "ran");

    rmSync(`${ws.root}/setup-marker.txt`);
    const second = ws.service().runWorkspaceSetup();
    assert.equal(second.status, "already-done");
    assert.equal(second.command, "echo ran > setup-marker.txt");
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false, "an already-done command is not re-run");
  } finally {
    ws.cleanup();
  }
});

test("failed: a non-zero exit blocks, names the status, and records no success", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`exit 3`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "failed");
    assert.equal(result.exitCode, 3);
    assert.match(result.detail, /exited with status 3/);
    assert.equal(ws.service().runWorkspaceSetup().status, "blocked", "a failure is retried, never marked done");
  } finally {
    ws.cleanup();
  }
});

test("timed-out: a command exceeding its timeout blocks with a named reason", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`sleep 5`", "Dependency Setup Timeout": "`1`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "timed-out");
    assert.equal(result.timeoutSeconds, 1);
    assert.equal(result.command, "sleep 5");
  } finally {
    ws.cleanup();
  }
});

test("a capability-declared setup command is ignored; only the project key is honoured", () => {
  const ws = workspace(config({}));
  try {
    const evil = "echo capability > capability-ran.txt";
    write(`${ws.root}/_local/profiles/demo.profile.json`, `${JSON.stringify({ dependencySetupCommand: evil, "Dependency Setup Command": evil })}\n`);
    write(`${ws.root}/caps/demo/manifest.md`, `# demo\n\n| Key | Value |\n|-----|-------|\n| **Dependency Setup Command** | \`${evil}\` |\n`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "not-declared");
    assert.equal(existsSync(`${ws.root}/capability-ran.txt`), false);
  } finally {
    ws.cleanup();
  }
});

test("fleet template: preparation then setup run before the ceremony, and the scoreboard echoes the command", () => {
  const mcpDir = process.env.WF_MCP_DIR;
  assert.ok(mcpDir, "WF_MCP_DIR is set by the test runner");
  const skill = readFileSync(join(mcpDir, "..", "skills", "fleet", "SKILL.md"), "utf8");

  const start = skill.indexOf("## The shipper dispatch template");
  const end = skill.indexOf("\n## ", start + 1);
  assert.ok(start >= 0 && end > start, "the dispatch template section exists");
  const template = skill.slice(start, end);

  const prepare = template.indexOf("prepare_workspace");
  const setup = template.indexOf("run_workspace_setup");
  const ceremony = template.indexOf("EXECUTE — THE CEREMONY IS MANDATORY");
  assert.ok(prepare >= 0, "the template calls prepare_workspace");
  assert.ok(setup > prepare, "setup runs after preparation");
  assert.ok(ceremony > setup, "both run before the ceremony line");
  assert.match(template, /<SOURCE-ROOT>/, "the orchestrator fills the source root");
  assert.match(template, /SHIP — Blocked/, "a blocker stops the item before the ceremony");

  const step0 = skill.slice(skill.indexOf("## Step 0"), skill.indexOf("## The tick loop"));
  assert.match(step0, /\*\*Setup command:\*\*/, "the scoreboard header echoes the setup command");
});
