// SessionStart constitution-injection contract tests (WF-334, WF-576).
//
// Three concerns:
//   1. The pure payload logic the `refresh-if-stale` hook emits — the hook-JSON
//      shape, the no-op cases (no record / suppressed re-fire), and the
//      dedupe-across-re-fire-sources rule (startup/clear/compact emit, resume
//      suppresses) so a startup→resume→compact sequence yields exactly one copy.
//   2. `_local/constitution.md` is a fingerprinted `constitution` source, so a
//      project-clause edit invalidates the snapshot (freshness), never bypassing
//      fingerprint discipline with an un-fingerprinted raw read.
//   3. The part contract (WF-576): a record past the per-part budget splits into
//      labelled parts under the host's per-value output cap, a small record is
//      byte-identical to the pre-split payload, and an over-ceiling record is
//      cut with a diagnostic — section 6 below.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONSTITUTION_DIAGNOSTIC_RESERVE,
  CONSTITUTION_HEADER_RESERVE,
  CONSTITUTION_MAX_CHARS,
  CONSTITUTION_PART_BUDGET,
  CONSTITUTION_PART_COUNT,
  CONSTITUTION_PART_ORDER_NOTE,
  CONSTITUTION_PART_USABLE,
  SESSION_START_EVENT,
  composeConstitutionContext,
  composeSessionStartStdout,
  constitutionOverage,
  constitutionOverageNote,
  constitutionPartHeader,
  parseSessionSource,
  sessionStartPayload,
  shouldEmitForSource,
  splitConstitution,
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

// --- 6. the part contract (WF-576) -----------------------------------------
//
// The host caps each hook-output value at 10,000 characters, so a record past
// the per-part budget travels as labelled parts, one per static hook entry.
// This repo's own record is ~4k, so every case below synthesizes a larger one
// from repeated lines.

const LINE = "- Article: the workflow holds itself to this rule at every phase gate.\n"; // 71 chars

/** A record of exactly `n` characters (before trim) made of repeated lines. */
function recordOf(n: number): string {
  let s = "";
  while (s.length < n) s += LINE;
  return s.slice(0, n);
}

/** The number of parts the contract promises for a below-ceiling record. */
function expectedParts(record: string): number {
  return Math.ceil(record.trim().length / CONSTITUTION_PART_USABLE);
}

function contexts(record: string, source = "startup"): string[] {
  const out: string[] = [];
  for (let i = 0; i < CONSTITUTION_PART_COUNT + 1; i++) {
    const stdout = composeSessionStartStdout(source, record, i);
    if (stdout === null) break;
    out.push(
      (JSON.parse(stdout) as { hookSpecificOutput: { additionalContext: string } })
        .hookSpecificOutput.additionalContext,
    );
  }
  return out;
}

test("the part constants: budget under the host cap, count derived, usable leaves 5 entries enough", () => {
  assert.equal(CONSTITUTION_MAX_CHARS, 40000);
  assert.ok(CONSTITUTION_PART_BUDGET <= 9000);
  assert.equal(
    CONSTITUTION_PART_COUNT,
    Math.ceil(CONSTITUTION_MAX_CHARS / CONSTITUTION_PART_BUDGET),
  );
  assert.equal(CONSTITUTION_PART_COUNT, 5);
  // The reserves are what make header + body + diagnostic fit the budget, and
  // the usable body budget must still pack a maximum-size record into the
  // declared hook count.
  assert.equal(
    CONSTITUTION_PART_USABLE,
    CONSTITUTION_PART_BUDGET - CONSTITUTION_HEADER_RESERVE - CONSTITUTION_DIAGNOSTIC_RESERVE,
  );
  assert.ok(constitutionPartHeader(0, CONSTITUTION_PART_COUNT).length <= CONSTITUTION_HEADER_RESERVE);
  assert.ok(
    `\n\n${constitutionOverageNote(9_999_999, CONSTITUTION_MAX_CHARS)}`.length <=
      CONSTITUTION_DIAGNOSTIC_RESERVE,
  );
  assert.ok(Math.ceil(CONSTITUTION_MAX_CHARS / CONSTITUTION_PART_USABLE) <= CONSTITUTION_PART_COUNT);
});

test("an empty or absent record splits to nothing and emits nothing for every part", () => {
  assert.deepEqual(splitConstitution(null), []);
  assert.deepEqual(splitConstitution("  \n "), []);
  for (let i = 0; i < CONSTITUTION_PART_COUNT; i++) {
    assert.equal(composeSessionStartStdout("startup", null, i), null);
    assert.equal(composeSessionStartStdout("startup", "  ", i), null);
  }
});

test("a record within the budget is one header-less part, byte-identical to the pre-split payload", () => {
  for (const n of [4000, CONSTITUTION_PART_BUDGET]) {
    const record = recordOf(n);
    const parts = splitConstitution(record);
    assert.equal(parts.length, 1);
    assert.equal(parts[0], record.trim());
    assert.ok(!parts[0].startsWith("wf constitution — part"));
    // The two-argument call is unchanged and equals the pre-split single payload.
    assert.equal(
      composeSessionStartStdout("startup", record),
      JSON.stringify(sessionStartPayload(record.trim())),
    );
    assert.equal(composeSessionStartStdout("startup", record, 1), null);
  }
});

test("budget + 1 splits into two labelled parts; part 1 alone carries the read-order note", () => {
  const record = recordOf(CONSTITUTION_PART_BUDGET + 1);
  const parts = splitConstitution(record);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].startsWith(`wf constitution — part 1 of 2\n${CONSTITUTION_PART_ORDER_NOTE}\n\n`));
  assert.ok(parts[1].startsWith("wf constitution — part 2 of 2\n\n"));
  assert.ok(!parts[1].includes(CONSTITUTION_PART_ORDER_NOTE));
});

test("below the ceiling: exactly ceil(len / usable) parts, each within budget, split on line boundaries", () => {
  const cases = [
    CONSTITUTION_PART_BUDGET + 1,
    CONSTITUTION_PART_USABLE * 2, // exact multiple of the usable budget
    CONSTITUTION_PART_USABLE * 2 + 1,
    23000,
    CONSTITUTION_MAX_CHARS - 1,
    CONSTITUTION_MAX_CHARS, // exactly the ceiling: no cut, no diagnostic
  ];
  for (const n of cases) {
    const record = recordOf(n);
    const parts = splitConstitution(record);
    assert.equal(parts.length, expectedParts(record), `part count for ${n}`);
    assert.ok(parts.length <= CONSTITUTION_PART_COUNT);
    // At an exact multiple of the usable budget every part is full, so a cut on
    // a line boundary would need one more part than the contract promises; the
    // splitter keeps the count and hard-cuts there. Everywhere else the slack
    // lets every cut land on a line boundary.
    const exactMultiple = record.trim().length % CONSTITUTION_PART_USABLE === 0;
    const bodies: string[] = [];
    parts.forEach((part, i) => {
      assert.ok(part.length <= CONSTITUTION_PART_BUDGET, `part ${i + 1} of ${n} within budget`);
      const header = constitutionPartHeader(i, parts.length);
      assert.ok(part.startsWith(header), `part ${i + 1} of ${n} header`);
      const body = part.slice(header.length);
      // Every part but the last ends on a complete line (the boundary newline
      // itself is dropped), and reassembling the bodies restores the record.
      if (i < parts.length - 1 && !exactMultiple) {
        assert.ok(body.endsWith("."), `part ${i + 1} of ${n} ends a line`);
      }
      bodies.push(body);
    });
    assert.equal(bodies.join(exactMultiple ? "" : "\n"), record.trim());
    assert.ok(!parts[parts.length - 1].includes("truncated"), `no diagnostic at ${n}`);
    assert.equal(constitutionOverage(record), null);
  }
});

test("a single line longer than the usable budget is the one case that is hard-split", () => {
  const record = "x".repeat(CONSTITUTION_PART_USABLE + 500);
  const parts = splitConstitution(record);
  assert.equal(parts.length, 2);
  for (const part of parts) assert.ok(part.length <= CONSTITUTION_PART_BUDGET);
  const h0 = constitutionPartHeader(0, 2);
  const h1 = constitutionPartHeader(1, 2);
  assert.equal(parts[0].slice(h0.length).length, CONSTITUTION_PART_USABLE);
  assert.equal(parts[0].slice(h0.length) + parts[1].slice(h1.length), record);
});

test("over the ceiling: cut at the ceiling, count capped, last part ends with the diagnostic", () => {
  for (const n of [CONSTITUTION_MAX_CHARS + 1, 45000]) {
    const record = recordOf(n);
    const parts = splitConstitution(record);
    assert.ok(parts.length <= CONSTITUTION_PART_COUNT);
    assert.equal(parts.length, Math.ceil(CONSTITUTION_MAX_CHARS / CONSTITUTION_PART_USABLE));
    const last = parts[parts.length - 1];
    const note = constitutionOverageNote(record.trim().length, CONSTITUTION_MAX_CHARS);
    assert.ok(last.endsWith(note), `last part of ${n} ends with the diagnostic`);
    assert.ok(note.includes(String(CONSTITUTION_MAX_CHARS)) && note.includes(String(record.trim().length)));
    assert.ok(note.includes("not injected"));
    for (const part of parts) assert.ok(part.length <= CONSTITUTION_PART_BUDGET);
    // Only the first `CONSTITUTION_MAX_CHARS` characters are carried.
    const carried = parts
      .map((part, i) => part.slice(constitutionPartHeader(i, parts.length).length))
      .map((body, i) => (i === parts.length - 1 ? body.slice(0, -(`\n\n${note}`.length)) : body))
      .join("\n");
    assert.equal(carried, record.trim().slice(0, CONSTITUTION_MAX_CHARS));
    assert.deepEqual(constitutionOverage(record), {
      length: record.trim().length,
      ceiling: CONSTITUTION_MAX_CHARS,
    });
  }
});

test("composeSessionStartStdout emits exactly splitConstitution's part i, and null past the end", () => {
  const record = recordOf(23000);
  const parts = splitConstitution(record);
  assert.equal(parts.length, 3);
  assert.deepEqual(contexts(record), parts);
  assert.ok(contexts(record)[0].startsWith("wf constitution — part 1 of 3"));
  assert.equal(composeSessionStartStdout("startup", record, 3), null);
  assert.equal(composeSessionStartStdout("startup", record, CONSTITUTION_PART_COUNT), null);
  assert.equal(composeSessionStartStdout("startup", record, -1), null);
  assert.equal(composeSessionStartStdout("startup", record, 1.5), null);
  // Each emitted value is one valid hook-JSON object under the budget.
  for (let i = 0; i < parts.length; i++) {
    const parsed = JSON.parse(composeSessionStartStdout("startup", record, i)!) as {
      hookSpecificOutput: { hookEventName: string; additionalContext: string };
    };
    assert.equal(parsed.hookSpecificOutput.hookEventName, SESSION_START_EVENT);
    assert.ok(parsed.hookSpecificOutput.additionalContext.length <= CONSTITUTION_PART_BUDGET);
  }
});

test("resume suppresses every part; startup, clear, compact and an absent source emit every part", () => {
  const record = recordOf(23000);
  for (let i = 0; i < CONSTITUTION_PART_COUNT; i++) {
    assert.equal(composeSessionStartStdout("resume", record, i), null);
  }
  for (const source of ["startup", "clear", "compact", null, undefined]) {
    assert.equal(contexts(record, source as string).length, 3, `source ${String(source)}`);
  }
});
