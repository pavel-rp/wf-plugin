// hooks.json ↔ part-count lock-step test (WF-576).
//
// The SessionStart hook list is static, so the number of `--part <i>` entries it
// declares must equal the build-time `CONSTITUTION_PART_COUNT` the splitter is
// sized for: one entry short and the last part of a maximum-size record is
// never injected; one entry over and a hook runs for nothing every session.
// This test reads the shipped `hooks.json` and pins the two together.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONSTITUTION_MAX_CHARS,
  CONSTITUTION_PART_COUNT,
  CONSTITUTION_PART_USABLE,
} from "../src/resolver/constitution.js";

// scripts/test.mjs sets WF_MCP_DIR to the package dir; hooks.json is the
// plugin's, one level up.
const hooksPath = join(process.env.WF_MCP_DIR ?? join(process.cwd()), "..", "hooks", "hooks.json");

type CommandHook = { type: string; command: string; timeout?: number };
type HooksFile = { hooks: { SessionStart?: Array<{ hooks: CommandHook[] }> } };

function sessionStartCommands(): CommandHook[] {
  const parsed = JSON.parse(readFileSync(hooksPath, "utf8")) as HooksFile;
  return (parsed.hooks.SessionStart ?? []).flatMap((group) =>
    group.hooks.filter((h) => h.type === "command"),
  );
}

test("hooks.json declares exactly one SessionStart entry per part index, 0 … PART_COUNT − 1", () => {
  const commands = sessionStartCommands();
  assert.equal(commands.length, CONSTITUTION_PART_COUNT);
  const indices = commands.map((h) => {
    const m = /--part\s+(\d+)\b/.exec(h.command);
    assert.ok(m, `every SessionStart command carries --part <n>: ${h.command}`);
    return Number(m![1]);
  });
  const expected = Array.from({ length: CONSTITUTION_PART_COUNT }, (_, i) => i);
  assert.deepEqual([...indices].sort((a, b) => a - b), expected);
  assert.equal(new Set(indices).size, indices.length, "no duplicate part index");
});

test("every SessionStart entry runs the refresh-if-stale bundle with the same timeout", () => {
  const commands = sessionStartCommands();
  for (const h of commands) {
    assert.ok(
      h.command.includes("mcp/dist/refresh-if-stale.mjs"),
      `targets the bundle: ${h.command}`,
    );
    assert.ok(h.command.includes("${CLAUDE_PLUGIN_ROOT}"), `anchored on the plugin root: ${h.command}`);
  }
  assert.equal(new Set(commands.map((h) => h.timeout)).size, 1, "one shared timeout");
});

test("a maximum-size record always fits the declared hook count", () => {
  // If a header change ever shrinks the usable budget enough to need a sixth
  // part, this is the assertion that catches it before the last part goes dark.
  assert.ok(Math.ceil(CONSTITUTION_MAX_CHARS / CONSTITUTION_PART_USABLE) <= CONSTITUTION_PART_COUNT);
});
