// WF-831 — the project-declared dependency-setup step, and the fleet template
// that runs preparation then setup before the ceremony.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createDefaultPorts } from "../src/ports.js";
import { parseCoreConfig, splitTableRow } from "../src/resolver/config.js";
import {
  acquireSetupLock,
  DEFAULT_SETUP_TIMEOUT_SECONDS,
  MAX_SETUP_TIMEOUT_SECONDS,
  parseSetupTimeout,
  renderSetupLock,
  renderSetupState,
  SETUP_LOCK_RELPATH,
  setupCommandDigest,
  type SetupLockDeps,
  type WorkspaceSetupResponse,
} from "../src/resolver/workspace-setup.js";
import { ResolverService } from "../src/service.js";

// WF-871 — child mode: this same bundled file, re-run as a separate process,
// performs ONE setup call for the root it is handed and prints the response.
// That is what makes the concurrency test a real cross-process race.
const CHILD_ROOT = process.env.WF_SETUP_CHILD_ROOT;
if (CHILD_ROOT) {
  const response = new ResolverService({
    ...createDefaultPorts(CHILD_ROOT),
    listPlugins: () => ({ plugins: [], ok: true, contractOk: true, issues: [] }),
  }).runWorkspaceSetup();
  // Synchronous write then exit, before any `test(...)` below is registered.
  writeSync(1, JSON.stringify(response));
  process.exit(0);
}

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

// WF-872 — the success marker is never trusted or written through a link.

const MARKED = "echo ran > setup-marker.txt";

function validMarker(): string {
  return renderSetupState(setupCommandDigest(MARKED), "2026-01-01T00:00:00.000Z");
}

test("unsafe-path: an external marker carrying the current digest never yields already-done", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    write(`${outside}/marker.json`, validMarker());
    mkdirSync(`${ws.root}/_local/resolver`, { recursive: true });
    symlinkSync(`${outside}/marker.json`, `${ws.root}/_local/resolver/setup-state.json`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(result.reason, "unsafe-path");
    assert.equal(result.command, MARKED, "the declared command is still echoed");
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false, "the command is not run");
    assert.equal(readFileSync(`${outside}/marker.json`, "utf8"), validMarker(), "the external file is untouched");
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("unsafe-path: a dangling marker symlink blocks and creates nothing outside", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    mkdirSync(`${ws.root}/_local/resolver`, { recursive: true });
    symlinkSync(`${outside}/never.json`, `${ws.root}/_local/resolver/setup-state.json`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unsafe-path");
    assert.equal(existsSync(`${outside}/never.json`), false);
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false);
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("unsafe-path: a symlinked `_local/resolver` ancestor is neither read nor written through", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    write(`${outside}/setup-state.json`, validMarker());
    symlinkSync(outside, `${ws.root}/_local/resolver`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unsafe-path");
    assert.match(result.detail, /_local\/resolver/);
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false);
    assert.equal(readFileSync(`${outside}/setup-state.json`, "utf8"), validMarker());
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("contained marker: the ordinary path records success as a regular file inside the workspace", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  try {
    assert.equal(ws.service().runWorkspaceSetup().status, "succeeded");
    const marker = `${ws.root}/_local/resolver/setup-state.json`;
    assert.ok(lstatSync(marker).isFile() && !lstatSync(marker).isSymbolicLink());
    assert.equal(JSON.parse(readFileSync(marker, "utf8")).commandDigest, setupCommandDigest(MARKED));
    assert.equal(ws.service().runWorkspaceSetup().status, "already-done");
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

// ---------------------------------------------------------------------------
// WF-871 — exact values, serialized runs, and a fully stopped process tree.
// ---------------------------------------------------------------------------

function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function lockPath(root: string): string {
  return `${root}/${SETUP_LOCK_RELPATH}`;
}

function markerPath(root: string): string {
  return `${root}/_local/resolver/setup-state.json`;
}

/** Run one setup call in a separate resolver process for `root`. */
function runInChild(root: string): Promise<WorkspaceSetupResponse> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url)], {
      env: { ...process.env, WF_SETUP_CHILD_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString("utf8")));
    child.stderr.on("data", (chunk) => (err += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", () => {
      try {
        resolvePromise(JSON.parse(out) as WorkspaceSetupResponse);
      } catch {
        reject(new Error(`child produced no response: ${out}${err}`));
      }
    });
  });
}

test("config cells: a pipe inside a code span or written as \\| stays in the value", () => {
  assert.deepEqual(splitTableRow("| **K** | `a | b` | note |"), ["**K**", "`a | b`", "note"]);
  assert.deepEqual(splitTableRow("| **K** | a \\| b |"), ["**K**", "a | b"]);
  assert.deepEqual(splitTableRow("| **K** | ``x ` | y`` |"), ["**K**", "``x ` | y``"]);
  assert.deepEqual(splitTableRow("| **K** | `unclosed | rest |"), ["**K**", "`unclosed", "rest"]);

  const backticked = parseCoreConfig(config({ "Dependency Setup Command": "`npm ci | tee install.log`" }));
  assert.equal(backticked.dependencySetupCommand, "npm ci | tee install.log");
  const escaped = parseCoreConfig(config({ "Dependency Setup Command": "npm ci \\| tee install.log" }));
  assert.equal(escaped.dependencySetupCommand, "npm ci | tee install.log");
  const verbatim = parseCoreConfig(config({ "Dependency Setup Command": "`grep -E 'a\\|b' x || true`" }));
  assert.equal(verbatim.dependencySetupCommand, "grep -E 'a\\|b' x || true", "a code span is taken verbatim");
});

test("config cells: existing rows keep their meaning, a third column included", () => {
  const cfg = parseCoreConfig(
    "| Key | Value | Note |\n|---|---|---|\n| **Task Root** | `_local` | where tasks live |\n| **Verify Command** | `(cd x && npm run build)` | build |\n| **Context Ceiling** | `<none>` | |\n",
  );
  assert.equal(cfg.taskRoot, "_local");
  assert.equal(cfg.verifyCommand, "(cd x && npm run build)");
  assert.equal(cfg.contextCeiling, null);
});

test("a declared pipeline runs complete and is echoed verbatim", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`echo piped | tr a-z A-Z > piped.txt`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(result.command, "echo piped | tr a-z A-Z > piped.txt");
    assert.equal(readFileSync(`${ws.root}/piped.txt`, "utf8").trim(), "PIPED");
  } finally {
    ws.cleanup();
  }
});

test("timeout stops the whole process tree: a descendant never writes afterwards", () => {
  const ws = workspace(
    config({ "Dependency Setup Command": "`(sleep 2; echo late > late.txt) & sleep 30`", "Dependency Setup Timeout": "`1`" }),
  );
  try {
    const started = Date.now();
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(result.reason, "timed-out");
    assert.ok(Date.now() - started < 10_000, "the call returns at the timeout, not when the tree would finish");
    pause(3_000);
    assert.equal(existsSync(`${ws.root}/late.txt`), false, "the backgrounded descendant was stopped with its group");
    assert.equal(existsSync(lockPath(ws.root)), false, "the lock is released on timeout");
    assert.equal(existsSync(markerPath(ws.root)), false, "a timeout records no success");
  } finally {
    ws.cleanup();
  }
});

test("a straggler left running when the command exits is stopped before success is reported", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`(sleep 2; echo late > straggler.txt) & echo started`" }));
  try {
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.match(result.outputTail, /started/);
    pause(3_000);
    assert.equal(existsSync(`${ws.root}/straggler.txt`), false);
  } finally {
    ws.cleanup();
  }
});

test("failure releases the lock and records nothing; a retry runs again, then already-done", () => {
  const ws = workspace(config({ "Dependency Setup Command": "`test -f ok.txt || { touch ok.txt; exit 3; }`" }));
  try {
    const failed = ws.service().runWorkspaceSetup();
    assert.equal(failed.status, "blocked");
    assert.equal(failed.reason, "failed");
    assert.equal(existsSync(lockPath(ws.root)), false, "failure releases the lock");
    assert.equal(existsSync(markerPath(ws.root)), false, "failure creates no success marker");

    const retried = ws.service().runWorkspaceSetup();
    assert.equal(retried.status, "succeeded", JSON.stringify(retried));
    assert.equal(existsSync(lockPath(ws.root)), false);
    assert.equal(ws.service().runWorkspaceSetup().status, "already-done");
  } finally {
    ws.cleanup();
  }
});

test("concurrent resolver processes run the command exactly once", async () => {
  const ws = workspace(config({ "Dependency Setup Command": "`echo run >> runs.txt; sleep 1`" }));
  try {
    const results = await Promise.all([runInChild(ws.root), runInChild(ws.root)]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, ["already-done", "succeeded"], JSON.stringify(results));
    const runs = readFileSync(`${ws.root}/runs.txt`, "utf8").trim().split("\n");
    assert.equal(runs.length, 1, "the command ran once");
    assert.equal(existsSync(lockPath(ws.root)), false, "the lock is released");
  } finally {
    ws.cleanup();
  }
});

test("a lock whose holder process is gone is reclaimed", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  try {
    const gone = spawnSync(process.execPath, ["-e", ""]).pid;
    assert.ok(typeof gone === "number");
    write(lockPath(ws.root), renderSetupLock({ pid: gone, host: hostname(), token: "stale", acquiredAt: "2026-01-01T00:00:00.000Z" }));
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.equal(existsSync(lockPath(ws.root)), false);
  } finally {
    ws.cleanup();
  }
});

test("a live holder past the wait bound is busy, and its lock is left alone", () => {
  const ws = workspace(config({}));
  try {
    const held = renderSetupLock({ pid: process.pid, host: hostname(), token: "live", acquiredAt: "2026-01-01T00:00:00.000Z" });
    write(lockPath(ws.root), held);
    let clock = 0;
    const deps: SetupLockDeps = {
      pid: process.pid + 1,
      host: hostname(),
      now: () => clock,
      sleepMs: (ms) => {
        clock += ms;
      },
      processAlive: () => true,
    };
    const result = acquireSetupLock(ws.root, 1_000, deps);
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.kind, "busy");
    assert.match(!result.ok ? result.detail : "", /setup\.lock/);
    assert.equal(readFileSync(lockPath(ws.root), "utf8"), held, "a live holder's lock is never taken over");
  } finally {
    ws.cleanup();
  }
});

test("unsafe-path: a symlinked setup lock blocks and the command does not run", () => {
  const ws = workspace(config({ "Dependency Setup Command": `\`${MARKED}\`` }));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    write(`${outside}/lock`, "not ours\n");
    mkdirSync(`${ws.root}/_local/resolver`, { recursive: true });
    symlinkSync(`${outside}/lock`, lockPath(ws.root));
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "blocked", JSON.stringify(result));
    assert.equal(result.reason, "unsafe-path");
    assert.equal(existsSync(`${ws.root}/setup-marker.txt`), false);
    assert.equal(readFileSync(`${outside}/lock`, "utf8"), "not ours\n");
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});

test("not-declared never touches setup state, even under a symlinked `_local/resolver`", () => {
  const ws = workspace(config({}));
  const outside = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-setup-out-"))));
  try {
    symlinkSync(outside, `${ws.root}/_local/resolver`);
    const result = ws.service().runWorkspaceSetup();
    assert.equal(result.status, "not-declared", JSON.stringify(result));
  } finally {
    ws.cleanup();
    rmSync(outside, { recursive: true, force: true });
  }
});
