// Black-box contract tests for the built `refresh-if-stale` SessionStart hook
// (WF-576) — the process-level behaviour the pure `constitution.ts` tests
// cannot reach.
//
// The hook fans out into one process per part (`--part 0` … `--part N-1`) and
// only part 0 runs the freshness pass. That makes one regression worth pinning
// at the process boundary: if the freshness pass THROWS, part 0 must still emit
// its part. The other parts are independent processes that never run the pass,
// so a part 0 that swallowed the throw and skipped its emit would inject a
// constitution missing part 1 of n — exactly the partial-injection defect the
// per-part split exists to prevent. `npm test` would keep passing if someone
// folded the two nested `try` blocks in `refresh.ts` back into one; this test
// would not.
//
// Runs the COMMITTED bundle (`dist/refresh-if-stale.mjs`), which `verify-bundle`
// keeps identical to a rebuild of `src/`, against a throwaway workspace root
// outside any repository (the same shape the workspace-admission tests use).

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONSTITUTION_PART_BUDGET, SESSION_START_EVENT } from "../src/resolver/constitution.js";

// scripts/test.mjs sets WF_MCP_DIR to the package dir.
const bundle = join(process.env.WF_MCP_DIR ?? process.cwd(), "dist", "refresh-if-stale.mjs");

const RECORD = "# Project Constitution\n\n1. The spec is the single source of truth.\n";

/** A workspace root whose snapshot destination cannot be created: the
 *  snapshot lives at `_local/resolver/snapshot.json`, so a regular FILE at
 *  `_local/resolver` makes the freshness pass's persist step throw, which is
 *  the failure the part-0 guard exists for. */
function throwingFixture(record: string): string {
  const root = mkdtempSync(join(tmpdir(), "wf-refresh-hook-"));
  mkdirSync(join(root, "_local"));
  writeFileSync(join(root, "_local", "constitution.md"), record, "utf8");
  writeFileSync(join(root, "_local", "resolver"), "not a directory\n", "utf8");
  return root;
}

function runHook(root: string, part: number, source = "startup") {
  const result = spawnSync(process.execPath, [bundle, "--part", String(part)], {
    input: JSON.stringify({ source }),
    encoding: "utf8",
    env: { ...process.env, WF_WORKSPACE_ROOT: root },
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function parsePayload(stdout: string): { hookEventName: string; additionalContext: string } {
  const lines = stdout.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1, `stdout carries exactly one line: ${JSON.stringify(stdout)}`);
  const parsed = JSON.parse(lines[0]) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  return parsed.hookSpecificOutput;
}

test("a throwing freshness pass is reported on stderr and part 0 STILL emits its part", (t) => {
  if (!existsSync(bundle)) t.skip("dist/refresh-if-stale.mjs is not built");
  const root = throwingFixture(RECORD);
  try {
    const run = runHook(root, 0);
    assert.equal(run.status, 0, "always exits 0");
    // The pass failed — and said so — instead of silently doing nothing…
    assert.match(run.stderr, /freshness pass skipped/);
    // …and the part was emitted regardless: the guard the split introduced.
    const payload = parsePayload(run.stdout);
    assert.equal(payload.hookEventName, SESSION_START_EVENT);
    assert.equal(payload.additionalContext, RECORD.trim());
    assert.ok(payload.additionalContext.length <= CONSTITUTION_PART_BUDGET);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a part past the record's last part emits nothing and exits 0, even on the same broken root", (t) => {
  if (!existsSync(bundle)) t.skip("dist/refresh-if-stale.mjs is not built");
  const root = throwingFixture(RECORD);
  try {
    const run = runHook(root, 1);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "", "nothing on stdout");
    // Parts ≥ 1 never run the freshness pass, so nothing failed to report.
    assert.doesNotMatch(run.stderr, /freshness pass skipped/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a resume re-fire emits nothing for part 0 on the same broken root (dedupe survives the guard)", (t) => {
  if (!existsSync(bundle)) t.skip("dist/refresh-if-stale.mjs is not built");
  const root = throwingFixture(RECORD);
  try {
    const run = runHook(root, 0, "resume");
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "", "nothing on stdout");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
