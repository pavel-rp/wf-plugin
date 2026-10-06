// CLI-output contract tests for `claude plugin list --json`.
//
// These pin the shape the resolver depends on. A drift in the CLI's output
// schema (renamed/removed/retyped required field, or a top-level shape change)
// must be DETECTED — surfaced as a contract issue, never silently swallowed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parsePluginList,
  scopePluginsToWorkspace,
  type InstalledPlugin,
} from "../src/resolver/plugin-list.js";

const FIX = join(process.env.WF_MCP_DIR ?? process.cwd(), "test/fixtures/plugin-list");
const read = (name: string) => readFileSync(join(FIX, name), "utf8");

test("valid CLI output parses all records with normalized paths", () => {
  const { plugins, contractOk, issues } = parsePluginList(read("valid.json"));
  assert.equal(contractOk, true);
  assert.deepEqual(issues, []);
  assert.equal(plugins.length, 3);

  const git = plugins.find((p) => p.name === "wf-git");
  assert.ok(git);
  assert.equal(git.id, "wf-git@wf-marketplace");
  assert.equal(git.enabled, true);
  // Backslashes normalized to forward slashes.
  assert.ok(!git.installPath.includes("\\"));
  assert.ok(git.installPath.includes("/wf-git/1.4.1"));

  const linear = plugins.find((p) => p.name === "wf-linear");
  assert.ok(linear);
  assert.equal(linear.enabled, false);
});

test("a top-level shape change (object, not array) is a contract failure", () => {
  const { plugins, contractOk, issues } = parsePluginList(read("incompatible-top-level.json"));
  assert.equal(contractOk, false);
  assert.equal(plugins.length, 0);
  assert.ok(issues.some((i) => i.code === "plugin-list/not-an-array"));
});

test("a renamed required field is detected as missing", () => {
  const { contractOk, issues } = parsePluginList(read("renamed-field.json"));
  assert.equal(contractOk, false);
  assert.ok(
    issues.some((i) => i.code === "plugin-list/missing-field" && i.message.includes("enabled")),
  );
});

test("a wrong-typed required field is detected", () => {
  const { contractOk, issues } = parsePluginList(read("wrong-type.json"));
  assert.equal(contractOk, false);
  assert.ok(
    issues.some((i) => i.code === "plugin-list/wrong-type" && i.message.includes("enabled")),
  );
});

test("non-JSON CLI output is a contract failure, never a throw", () => {
  const { contractOk, plugins, issues } = parsePluginList(read("unparseable.txt"));
  assert.equal(contractOk, false);
  assert.equal(plugins.length, 0);
  assert.ok(issues.some((i) => i.code === "plugin-list/unparseable"));
});

test("empty array is a valid, contract-clean, zero-pack result", () => {
  const { plugins, contractOk, issues } = parsePluginList("[]");
  assert.equal(contractOk, true);
  assert.equal(plugins.length, 0);
  assert.deepEqual(issues, []);
});

// --- WF-1072: project-bound installs and workspace scoping ------------------

test("projectPath is parsed and slash-normalized when present, absent otherwise", () => {
  const { plugins, contractOk } = parsePluginList(read("local-scope-multi-project.json"));
  assert.equal(contractOk, true);
  const local = plugins.filter((p) => p.scope === "local");
  assert.equal(local.length, 5);
  assert.ok(local.every((p) => typeof p.projectPath === "string"));
  for (const p of plugins.filter((p) => p.scope !== "local")) {
    assert.equal("projectPath" in p, false);
  }

  const [win] = parsePluginList(
    JSON.stringify([
      {
        id: "wf-demo@m",
        version: "1.0.0",
        scope: "local",
        enabled: true,
        installPath: "C:\\cache\\wf-demo",
        projectPath: "C:\\work\\proj",
      },
    ]),
  ).plugins;
  assert.equal(win.projectPath, "C:/work/proj");
});

test("a non-string projectPath is a wrong-type drift and the record is rejected", () => {
  const { plugins, contractOk, issues } = parsePluginList(
    JSON.stringify([
      { id: "wf-a@m", version: "1.0.0", scope: "user", enabled: true, installPath: "/c/a" },
      {
        id: "wf-b@m",
        version: "1.0.0",
        scope: "local",
        enabled: true,
        installPath: "/c/b",
        projectPath: 42,
      },
    ]),
  );
  assert.equal(contractOk, false);
  assert.deepEqual(
    plugins.map((p) => p.id),
    ["wf-a@m"],
  );
  assert.ok(
    issues.some((i) => i.code === "plugin-list/wrong-type" && i.message.includes("projectPath")),
  );
});

test("the pinned fixtures parse unchanged — projectPath adds no field to them", () => {
  const { plugins, contractOk } = parsePluginList(read("valid.json"));
  assert.equal(contractOk, true);
  assert.ok(plugins.every((p) => !("projectPath" in p)));
});

function plugin(over: Partial<InstalledPlugin>): InstalledPlugin {
  return {
    id: "wf-demo@m",
    name: "wf-demo",
    version: "1.0.0",
    scope: "local",
    enabled: true,
    installPath: "/c/wf-demo",
    ...over,
  };
}

test("scoping keeps unbound installs and only the project-bound ones for this workspace", () => {
  const user = plugin({ scope: "user" });
  const here = plugin({ projectPath: "/ws/project" });
  const worktree = plugin({ projectPath: "/ws/project/.claude/worktrees/agent-a1" });
  const other = plugin({ projectPath: "/ws/other" });
  const kept = scopePluginsToWorkspace([user, here, worktree, other], "/ws/project");
  assert.deepEqual(kept, [user, here]);
  // Exact equality: neither an ancestor nor a descendant of the root matches.
  assert.deepEqual(scopePluginsToWorkspace([here], "/ws"), []);
  assert.deepEqual(scopePluginsToWorkspace([user, worktree], "/ws/project"), [user]);
});

test("scoping trims trailing slashes and compares canonical forms", () => {
  const here = plugin({ projectPath: "/ws/project/" });
  assert.deepEqual(scopePluginsToWorkspace([here], "/ws/project"), [here]);

  // A symlinked root resolves to the same canonical path as the recorded one.
  const canonicalize = (p: string) => (p === "/link/project" ? "/ws/project" : p);
  const viaLink = plugin({ projectPath: "/ws/project" });
  assert.deepEqual(scopePluginsToWorkspace([viaLink], "/link/project", canonicalize), [viaLink]);
});

test("a stale projectPath the canonicalizer cannot resolve is compared literally and dropped", () => {
  const stale = plugin({ projectPath: "/ws/project/.claude/worktrees/gone" });
  const canonicalize = (p: string) => (p === "/ws/project" ? "/real/project" : null);
  assert.deepEqual(scopePluginsToWorkspace([stale], "/ws/project", canonicalize), []);
  // ...while one that literally names the workspace still matches the root's
  // literal form when neither side canonicalizes.
  const literal = plugin({ projectPath: "/ws/project" });
  assert.deepEqual(scopePluginsToWorkspace([literal], "/ws/project", () => null), [literal]);
});
