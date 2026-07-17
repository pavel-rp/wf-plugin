// SessionStart constitution-injection contract tests (WF-334).
//
// Two concerns:
//   1. The pure payload logic the `refresh-if-stale` hook emits — the hook-JSON
//      shape, the no-op cases (no record / suppressed re-fire), and the
//      dedupe-across-re-fire-sources rule (startup/clear/compact emit, resume
//      suppresses) so a startup→resume→compact sequence yields exactly one copy.
//   2. `_local/constitution.md` is a fingerprinted `constitution` source, so a
//      project-clause edit invalidates the snapshot (freshness), never bypassing
//      fingerprint discipline with an un-fingerprinted raw read.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_START_EVENT,
  composeConstitutionContext,
  composeSessionStartStdout,
  parseSessionSource,
  shouldEmitForSource,
} from "../src/resolver/constitution.js";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { evaluateFreshness } from "../src/resolver/freshness.js";
import { normalizeSlashes } from "../src/resolver/paths.js";

const RECORD = `# Project Constitution

## Core articles (provenance: core)

1. The spec is the single source of truth.
9. Temp and scratch files live under \`_local/\`.
`;

// --- 1. per-source emit/suppress -------------------------------------------

test("startup, clear, and compact re-fires emit; resume suppresses", () => {
  assert.equal(shouldEmitForSource("startup"), true);
  assert.equal(shouldEmitForSource("clear"), true);
  assert.equal(shouldEmitForSource("compact"), true); // survives compaction
  assert.equal(shouldEmitForSource("resume"), false); // no double-injection
});

test("an absent or unknown source defaults to emit (presence over duplication)", () => {
  assert.equal(shouldEmitForSource(null), true);
  assert.equal(shouldEmitForSource(undefined), true);
  assert.equal(shouldEmitForSource("something-new"), true);
});

// --- 2. stdin source parsing ------------------------------------------------

test("parseSessionSource reads `source` from the hook stdin JSON, defensively", () => {
  assert.equal(parseSessionSource('{"source":"compact","cwd":"/x"}'), "compact");
  assert.equal(parseSessionSource('{"cwd":"/x"}'), null); // missing field
  assert.equal(parseSessionSource("not json"), null); // malformed → null
  assert.equal(parseSessionSource(null), null);
  assert.equal(parseSessionSource(""), null);
});

// --- 3. context normalization ----------------------------------------------

test("composeConstitutionContext trims content and no-ops on absent/empty records", () => {
  assert.equal(composeConstitutionContext(null), null);
  assert.equal(composeConstitutionContext("   \n  "), null);
  assert.equal(composeConstitutionContext("  hello  "), "hello");
});

// --- 4. the emitted stdout --------------------------------------------------

test("an emitting re-fire produces exactly one valid SessionStart hook-JSON object", () => {
  const out = composeSessionStartStdout("startup", RECORD);
  assert.ok(out !== null);
  // Single object, no stray log lines: the whole stdout parses as one JSON value.
  const parsed = JSON.parse(out) as {
    hookSpecificOutput: { hookEventName: string; additionalContext: string };
  };
  assert.equal(parsed.hookSpecificOutput.hookEventName, SESSION_START_EVENT);
  assert.equal(parsed.hookSpecificOutput.additionalContext, RECORD.trim());
  // The scratch-discipline article rides along in the payload.
  assert.ok(parsed.hookSpecificOutput.additionalContext.includes("_local/"));
});

test("no payload when there is no constitution record (non-wf repo / no record)", () => {
  assert.equal(composeSessionStartStdout("startup", null), null);
  assert.equal(composeSessionStartStdout("startup", "   "), null);
});

test("a resume re-fire emits nothing even with a record present (dedupe)", () => {
  assert.equal(composeSessionStartStdout("resume", RECORD), null);
});

test("startup→resume→compact yields exactly one in-context copy", () => {
  // startup adds it, resume keeps it (suppress), compact restores it after
  // compaction drops it — one copy present at every point, never zero, never two.
  assert.ok(composeSessionStartStdout("startup", RECORD) !== null); // +1
  assert.equal(composeSessionStartStdout("resume", RECORD), null); // still 1
  assert.ok(composeSessionStartStdout("compact", RECORD) !== null); // dropped→+1
});

// --- 5. `_local/constitution.md` is a fingerprinted source ------------------

function ioWith(constitution: string | null) {
  const files = new Map<string, string>();
  if (constitution !== null) {
    files.set(normalizeSlashes("/ws/_local/constitution.md"), constitution);
  }
  return { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };
}

test("the snapshot records _local/constitution.md as a present constitution source", () => {
  const snap = resolveSnapshot({
    workspaceRoot: "/ws",
    io: ioWith(RECORD),
    pluginListRaw: "[]",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  const src = snap.sources.find((s) => s.kind === "constitution");
  assert.ok(src, "a constitution source is recorded");
  assert.equal(src?.path, "_local/constitution.md");
  assert.equal(src?.present, true);
  assert.ok(src?.sha256);
  // Body is HASHED, never stored.
  assert.ok(!JSON.stringify(snap).includes("single source of truth"));
});

test("an absent constitution is recorded as an absent source", () => {
  const snap = resolveSnapshot({
    workspaceRoot: "/ws",
    io: ioWith(null),
    pluginListRaw: "[]",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  const src = snap.sources.find((s) => s.kind === "constitution");
  assert.ok(src);
  assert.equal(src?.present, false);
  assert.equal(src?.sha256, null);
});

test("editing a project clause invalidates the snapshot (fingerprint discipline)", () => {
  const snap = resolveSnapshot({
    workspaceRoot: "/ws",
    io: ioWith(RECORD),
    pluginListRaw: "[]",
    now: () => new Date("2026-07-18T00:00:00.000Z"),
  });
  const edited = ioWith(`${RECORD}\n## Project clauses\n\n- Always double-check.\n`);
  const { fresh, reasons } = evaluateFreshness(snap, "/ws", {
    readFile: (p) => edited.readFile(p),
  });
  assert.equal(fresh, false);
  assert.ok(reasons.some((r) => r.code === "constitution/changed"));
});
