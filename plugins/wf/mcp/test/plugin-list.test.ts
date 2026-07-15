// CLI-output contract tests for `claude plugin list --json`.
//
// These pin the shape the resolver depends on. A drift in the CLI's output
// schema (renamed/removed/retyped required field, or a top-level shape change)
// must be DETECTED — surfaced as a contract issue, never silently swallowed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePluginList } from "../src/resolver/plugin-list.js";

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
