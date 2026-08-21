// The shared lifecycle transaction protocol — contract tests (WF-451).
//
// This file drives the PURE half: the fail-closed constructors, the four-outcome
// journal parse, and the per-entry recovery decision. No filesystem is involved,
// because none of those behaviours is a property of the filesystem — the driver
// and the production ports are covered by their own suites.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LIFECYCLE_BACKUP_DIR,
  LIFECYCLE_JOURNAL_PATH,
  LIFECYCLE_JOURNAL_VERSION,
  LIFECYCLE_LOCK_PATH,
  createJournalEntry,
  createLastWrittenIdentity,
  createTransactionJournal,
  decideEntryRecovery,
  parseTransactionJournal,
  type DestinationObservation,
} from "../src/resolver/lifecycle-journal.js";
import type { JournalEntry } from "../src/resolver/types.js";

const PRIOR = "a".repeat(64);
const OURS = "b".repeat(64);
const THEIRS = "c".repeat(64);

function entry(over: Partial<JournalEntry> = {}): JournalEntry {
  const built = createJournalEntry({
    destination: ".wf/slots/ship.review.md",
    priorExistence: "present",
    priorContentHash: PRIOR,
    priorIsSymlink: false,
    backupPath: `${LIFECYCLE_BACKUP_DIR}/t1/0`,
    lastWritten: { contentHash: OURS, bytes: 12 },
    ...over,
  } as Parameters<typeof createJournalEntry>[0]);
  assert.ok(built !== null, "fixture entry must be constructible");
  return built;
}

// --- the frozen constants ---------------------------------------------------

test("every protocol path is machine-local under `_local/`", () => {
  // The placement decision is part of the frozen contract: an interrupted
  // transaction is a local fact, so none of these is a committed lifecycle
  // artifact and the committed-artifact vocabulary is neither used nor widened.
  for (const path of [LIFECYCLE_LOCK_PATH, LIFECYCLE_JOURNAL_PATH, LIFECYCLE_BACKUP_DIR]) {
    assert.ok(path.startsWith("_local/"), `${path} must be machine-local`);
    assert.ok(!path.includes(".wf/"), `${path} must not be a committed lifecycle artifact`);
  }
  assert.equal(LIFECYCLE_JOURNAL_VERSION, 1);
});

// --- fail-closed constructors ------------------------------------------------

test("a last-written identity requires a well-formed digest and a non-negative length", () => {
  assert.equal(createLastWrittenIdentity({ contentHash: "not-a-digest", bytes: 1 }), null);
  assert.equal(createLastWrittenIdentity({ contentHash: PRIOR.toUpperCase(), bytes: 1 }), null);
  assert.equal(createLastWrittenIdentity({ contentHash: PRIOR, bytes: -1 }), null);
  assert.equal(createLastWrittenIdentity({ contentHash: PRIOR, bytes: 1.5 }), null);
  assert.deepEqual(createLastWrittenIdentity({ contentHash: PRIOR, bytes: 0 }), {
    contentHash: PRIOR,
    bytes: 0,
  });
});

test("the prior-state invariant is enforced, not trusted", () => {
  // `present` must carry a digest…
  assert.equal(
    createJournalEntry({
      destination: "d",
      priorExistence: "present",
      priorContentHash: null,
      priorIsSymlink: false,
      backupPath: "b",
      lastWritten: null,
    }),
    null,
  );
  // …unless it was a symlink, whose identity is its target, not its bytes.
  assert.notEqual(
    createJournalEntry({
      destination: "d",
      priorExistence: "present",
      priorContentHash: null,
      priorIsSymlink: true,
      backupPath: null,
      lastWritten: null,
    }),
    null,
  );
  // `absent` must NOT carry one — "there was nothing here" plus "here are the
  // bytes to restore" has no safe resolution at recovery time.
  assert.equal(
    createJournalEntry({
      destination: "d",
      priorExistence: "absent",
      priorContentHash: PRIOR,
      priorIsSymlink: false,
      backupPath: null,
      lastWritten: null,
    }),
    null,
  );
  assert.equal(
    createJournalEntry({
      destination: "",
      priorExistence: "absent",
      priorContentHash: null,
      priorIsSymlink: false,
      backupPath: null,
      lastWritten: null,
    }),
    null,
  );
});

test("a journal is version-stamped, destination-ordered, and duplicate-free", () => {
  const journal = createTransactionJournal({
    transactionId: "t1",
    startedAt: "2026-08-21T00:00:00.000Z",
    entries: [entry({ destination: "z" }), entry({ destination: "a" })],
  });
  assert.ok(journal !== null);
  assert.equal(journal.journalVersion, LIFECYCLE_JOURNAL_VERSION);
  assert.deepEqual(
    journal.entries.map((e) => e.destination),
    ["a", "z"],
  );
  assert.equal(
    createTransactionJournal({
      transactionId: "t1",
      startedAt: "now",
      entries: [entry({ destination: "a" }), entry({ destination: "a" })],
    }),
    null,
    "two entries for one destination would make the decision order-dependent",
  );
});

// --- the four parse outcomes -------------------------------------------------

test("an absent journal is `absent`, which is not a decision at all", () => {
  assert.deepEqual(parseTransactionJournal(null), { status: "absent" });
});

test("a version this release does not understand is a STOP, never a best-effort parse", () => {
  const future = parseTransactionJournal(
    JSON.stringify({ journalVersion: 2, transactionId: "t", startedAt: "n", entries: [] }),
  );
  assert.equal(future.status, "unsupported");
  assert.equal(future.status === "unsupported" ? future.observedVersion : null, 2);

  // A journal with NO version is also unsupported — assuming version 1 IS the
  // best-effort parse the contract forbids.
  const versionless = parseTransactionJournal(
    JSON.stringify({ transactionId: "t", startedAt: "n", entries: [] }),
  );
  assert.equal(versionless.status, "unsupported");
  assert.equal(versionless.status === "unsupported" ? versionless.observedVersion : 0, null);
});

test("version is checked BEFORE shape, so a future journal is never reported as corrupt", () => {
  const parsed = parseTransactionJournal(
    JSON.stringify({ journalVersion: 99, somethingEntirelyNew: true }),
  );
  assert.equal(parsed.status, "unsupported");
});

test("unparseable, non-object, and shape-drifted journals are malformed", () => {
  assert.equal(parseTransactionJournal("{not json").status, "malformed");
  assert.equal(parseTransactionJournal("[]").status, "malformed");
  assert.equal(parseTransactionJournal("").status, "malformed");
  assert.equal(
    parseTransactionJournal(JSON.stringify({ journalVersion: 1, entries: [] })).status,
    "malformed",
  );
  assert.equal(
    parseTransactionJournal(
      JSON.stringify({ journalVersion: 1, transactionId: "t", startedAt: "n", entries: {} }),
    ).status,
    "malformed",
  );
});

test("ONE bad entry fails the WHOLE journal — a dropped entry would abandon a half-written file", () => {
  const parsed = parseTransactionJournal(
    JSON.stringify({
      journalVersion: 1,
      transactionId: "t",
      startedAt: "n",
      entries: [
        { destination: "good", priorExistence: "absent", priorContentHash: null, priorIsSymlink: false, backupPath: null, lastWritten: null },
        { destination: "bad", priorExistence: "present", priorContentHash: null, priorIsSymlink: false, backupPath: null, lastWritten: null },
      ],
    }),
  );
  assert.equal(parsed.status, "malformed");
});

test("a duplicate destination in a parsed journal is malformed", () => {
  const row = {
    destination: "d",
    priorExistence: "absent",
    priorContentHash: null,
    priorIsSymlink: false,
    backupPath: null,
    lastWritten: null,
  };
  assert.equal(
    parseTransactionJournal(
      JSON.stringify({ journalVersion: 1, transactionId: "t", startedAt: "n", entries: [row, row] }),
    ).status,
    "malformed",
  );
});

test("a well-formed journal round-trips through the constructor and the parser", () => {
  const built = createTransactionJournal({
    transactionId: "t1",
    startedAt: "2026-08-21T00:00:00.000Z",
    entries: [entry()],
  });
  assert.ok(built !== null);
  const parsed = parseTransactionJournal(JSON.stringify(built));
  assert.equal(parsed.status, "ok");
  assert.deepEqual(parsed.status === "ok" ? parsed.journal : null, built);
});

// --- the per-entry decision --------------------------------------------------

const file = (contentHash: string, bytes = 12): DestinationObservation => ({
  kind: "file",
  contentHash,
  bytes,
});

test("containment is refused FIRST, before anything else is considered", () => {
  const decided = decideEntryRecovery(entry(), {
    kind: "not-contained",
    rejection: "symlink-escape",
  });
  assert.equal(decided.action, "none");
  assert.equal(decided.disposition, "unresolved");
  assert.equal(decided.reason, "target-not-contained");
});

test("an unobservable destination is unresolved, never assumed", () => {
  const decided = decideEntryRecovery(entry(), {
    kind: "observation-failed",
    diagnostic: "EACCES",
  });
  assert.equal(decided.disposition, "unresolved");
  assert.equal(decided.reason, "observation-failed");
});

test("a symlink — recorded OR observed — is preserved, never restored", () => {
  const observed = decideEntryRecovery(entry(), { kind: "symlink" });
  assert.equal(observed.action, "none");
  assert.equal(observed.disposition, "preserved");
  assert.equal(observed.reason, "symlink-conflict");

  const recorded = decideEntryRecovery(
    entry({ priorIsSymlink: true, priorContentHash: null, backupPath: null }),
    file(OURS),
  );
  assert.equal(recorded.action, "none");
  assert.equal(recorded.reason, "symlink-conflict");
});

test("THE IDEMPOTENCE GUARD — a destination already at its prior state is not rewritten", () => {
  const content = decideEntryRecovery(entry(), file(PRIOR));
  assert.equal(content.action, "none");
  assert.equal(content.disposition, "already-restored");
  assert.equal(content.reason, "already-prior-content");

  const absence = decideEntryRecovery(
    entry({ priorExistence: "absent", priorContentHash: null, backupPath: null }),
    { kind: "absent" },
  );
  assert.equal(absence.action, "none");
  assert.equal(absence.disposition, "already-restored");
  assert.equal(absence.reason, "already-prior-absence");
});

test("the guard is checked BEFORE ownership, so re-entry converges instead of re-writing", () => {
  // Prior bytes are in place AND they happen to equal nothing the transaction
  // wrote. Ownership would say "not ours"; the guard says "already done". The
  // guard must win, or a re-entered recovery would report `preserved` for work
  // it had itself completed.
  const decided = decideEntryRecovery(entry({ lastWritten: null }), file(PRIOR));
  assert.equal(decided.disposition, "already-restored");
});

test("AN UNRELATED EDIT IS PRESERVED, never overwritten", () => {
  const decided = decideEntryRecovery(entry(), file(THEIRS));
  assert.equal(decided.action, "none");
  assert.equal(decided.disposition, "preserved");
  assert.equal(decided.reason, "external-edit");
});

test("a byte-length mismatch alone defeats ownership", () => {
  const decided = decideEntryRecovery(entry(), file(OURS, 13));
  assert.equal(decided.disposition, "preserved");
  assert.equal(decided.reason, "external-edit");
});

test("a destination the transaction never wrote is preserved, not claimed", () => {
  const decided = decideEntryRecovery(entry({ lastWritten: null }), file(THEIRS));
  assert.equal(decided.action, "none");
  assert.equal(decided.disposition, "preserved");
  assert.equal(decided.reason, "external-edit");
});

test("ours and untouched restores content", () => {
  const decided = decideEntryRecovery(entry(), file(OURS));
  assert.equal(decided.action, "restore-content");
  assert.equal(decided.disposition, "restored");
  assert.equal(decided.reason, "restored-content");
});

test("ours and untouched restores ABSENCE when the transaction created the file", () => {
  const decided = decideEntryRecovery(
    entry({ priorExistence: "absent", priorContentHash: null, backupPath: null }),
    file(OURS),
  );
  assert.equal(decided.action, "restore-absence");
  assert.equal(decided.disposition, "restored");
  assert.equal(decided.reason, "restored-absence");
});

test("prior bytes with no backup to restore them from is unresolved, not a guess", () => {
  const decided = decideEntryRecovery(entry({ backupPath: null }), file(OURS));
  assert.equal(decided.action, "none");
  assert.equal(decided.disposition, "unresolved");
  assert.equal(decided.reason, "backup-missing");
});

test("a vanished destination whose prior was present is preserved, never resurrected blindly", () => {
  const decided = decideEntryRecovery(entry(), { kind: "absent" });
  assert.equal(decided.action, "none");
  assert.equal(decided.disposition, "preserved");
  assert.equal(decided.reason, "external-edit");
});

test("no observation ever yields a write without both halves of the proof", () => {
  const observations: DestinationObservation[] = [
    { kind: "not-contained", rejection: "traversal" },
    { kind: "observation-failed", diagnostic: "x" },
    { kind: "symlink" },
    { kind: "absent" },
    file(PRIOR),
    file(THEIRS),
  ];
  for (const observation of observations) {
    assert.equal(
      decideEntryRecovery(entry(), observation).action,
      "none",
      `${observation.kind} must not authorize a write`,
    );
  }
});
