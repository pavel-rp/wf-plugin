// The guarded recovery driver — contract tests (WF-451).
//
// Driven over in-memory ports, because every invariant under test is a property
// of the DRIVER — lock lifetime, journal lifetime, the two-halves proof, and
// which states let a caller proceed — not of any particular filesystem. The
// production ports are exercised separately, against a real filesystem, in
// `discovery-recovery.test.ts`.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createJournalEntry,
  createTransactionJournal,
  type DestinationObservation,
} from "../src/resolver/lifecycle-journal.js";
import {
  invalidRootRecoveryReport,
  noRecoveryReport,
  recoverInterruptedTransaction,
  type BackupIdentity,
  type LockAcquisition,
  type RecoveryPorts,
  type WriteOutcome,
} from "../src/resolver/lifecycle-recovery.js";
import type { JournalEntry } from "../src/resolver/types.js";

const PRIOR = "a".repeat(64);
const OURS = "b".repeat(64);
const THEIRS = "c".repeat(64);

function entry(over: Record<string, unknown> = {}): JournalEntry {
  const built = createJournalEntry({
    destination: "artifact.md",
    priorExistence: "present",
    priorContentHash: PRIOR,
    priorIsSymlink: false,
    backupPath: "_local/lifecycle-backups/t1/0",
    lastWritten: { contentHash: OURS, bytes: 4 },
    ...over,
  } as Parameters<typeof createJournalEntry>[0]);
  assert.ok(built !== null);
  return built;
}

function journalText(entries: JournalEntry[]): string {
  const journal = createTransactionJournal({
    transactionId: "t1",
    startedAt: "2026-08-21T00:00:00.000Z",
    entries,
  });
  assert.ok(journal !== null);
  return JSON.stringify(journal);
}

interface Harness {
  ports: RecoveryPorts;
  log: string[];
  journal: { text: string | null };
}

interface HarnessOptions {
  journal?: string | null;
  lock?: LockAcquisition;
  observe?: (destination: string) => DestinationObservation;
  backup?: (backupPath: string) => BackupIdentity;
  restore?: (destination: string) => WriteOutcome;
  remove?: (destination: string) => WriteOutcome;
}

function harness(options: HarnessOptions = {}): Harness {
  const log: string[] = [];
  const journal = { text: options.journal ?? null };
  const ports: RecoveryPorts = {
    acquireLock: () => {
      log.push("acquire");
      return options.lock ?? { ok: true };
    },
    releaseLock: () => {
      log.push("release");
    },
    readJournal: () => journal.text,
    observeDestination: (destination) => {
      log.push(`observe:${destination}`);
      return options.observe?.(destination) ?? { kind: "file", contentHash: OURS, bytes: 4 };
    },
    hashBackup: (backupPath) => {
      log.push(`hash:${backupPath}`);
      return options.backup?.(backupPath) ?? { ok: true, contentHash: PRIOR };
    },
    restoreBytes: (destination) => {
      log.push(`restore:${destination}`);
      return options.restore?.(destination) ?? { ok: true };
    },
    removeDestination: (destination) => {
      log.push(`remove:${destination}`);
      return options.remove?.(destination) ?? { ok: true };
    },
    discardJournal: () => {
      log.push("discard");
      journal.text = null;
    },
  };
  return { ports, log, journal };
}

// --- INVARIANT 1: the lock is released on every exit path --------------------

test("the lock is released on the no-journal path", () => {
  const h = harness();
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "no-journal");
  assert.equal(report.proceeded, true);
  assert.equal(report.wroteBytes, false);
  assert.deepEqual(h.log, ["acquire", "release"]);
});

test("the lock is released after a successful recovery, a stop, AND a port throw", () => {
  const recovered = harness({ journal: journalText([entry()]) });
  recoverInterruptedTransaction(recovered.ports);
  assert.ok(recovered.log.includes("release"));

  const stopped = harness({ journal: "{not json" });
  recoverInterruptedTransaction(stopped.ports);
  assert.ok(stopped.log.includes("release"));

  const thrown = harness({
    journal: journalText([entry()]),
    observe: () => {
      throw new Error("port exploded");
    },
  });
  const report = recoverInterruptedTransaction(thrown.ports);
  assert.equal(report.state, "incomplete");
  assert.equal(report.proceeded, false);
  assert.ok(thrown.log.includes("release"), "a leaked lock would block the workspace forever");
  assert.equal(report.diagnostics[0]?.code, "recovery/failed");
});

test("a lock held by another run is a fail-safe stop that reads and writes nothing", () => {
  const h = harness({
    journal: journalText([entry()]),
    lock: { ok: false, reason: "held-by-other", diagnostic: "held" },
  });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "lock-unavailable");
  assert.equal(report.proceeded, false);
  assert.equal(report.wroteBytes, false);
  assert.deepEqual(h.log, ["acquire"], "no journal read, no observation, no release of a lock never taken");
  assert.equal(report.diagnostics[0]?.code, "recovery/lock-held");
});

test("an unacquirable lock is reported distinctly from a held one", () => {
  const h = harness({ lock: { ok: false, reason: "unavailable", diagnostic: "EACCES" } });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "lock-unavailable");
  assert.equal(report.diagnostics[0]?.code, "recovery/lock-unavailable");
});

// --- version and shape stops -------------------------------------------------

test("an unsupported journal version stops without reading or writing anything", () => {
  const h = harness({
    journal: JSON.stringify({ journalVersion: 7, transactionId: "t", startedAt: "n", entries: [] }),
  });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "unsupported");
  assert.equal(report.proceeded, false);
  assert.equal(report.wroteBytes, false);
  assert.equal(report.journalVersion, 7);
  assert.deepEqual(h.log, ["acquire", "release"]);
  assert.equal(h.journal.text !== null, true, "an unreadable journal is RETAINED");
});

test("a malformed journal stops and is retained", () => {
  const h = harness({ journal: "{" });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "malformed");
  assert.equal(report.proceeded, false);
  assert.notEqual(h.journal.text, null);
});

// --- restoration -------------------------------------------------------------

test("ours-and-untouched is restored from a VERIFIED backup and the journal is discarded", () => {
  const h = harness({ journal: journalText([entry()]) });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "recovered");
  assert.equal(report.proceeded, true);
  assert.equal(report.wroteBytes, true, "recovery writes are reported SEPARATELY and explicitly");
  assert.equal(report.restored.length, 1);
  assert.equal(report.restored[0]?.reason, "restored-content");
  assert.equal(report.transactionId, "t1");
  assert.equal(report.journalVersion, 1);
  assert.equal(h.journal.text, null, "a complete recovery discards the journal");
  // The backup is hashed BEFORE the write — the second half of the proof.
  assert.ok(h.log.indexOf("hash:_local/lifecycle-backups/t1/0") < h.log.indexOf("restore:artifact.md"));
});

test("a created file is removed to restore its prior absence", () => {
  const h = harness({
    journal: journalText([
      entry({ priorExistence: "absent", priorContentHash: null, backupPath: null }),
    ]),
  });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "recovered");
  assert.equal(report.wroteBytes, true);
  assert.equal(report.restored[0]?.reason, "restored-absence");
  assert.ok(h.log.includes("remove:artifact.md"));
});

test("A MISSING OR ALTERED BACKUP NEVER BECOMES AUTHORITY TO OVERWRITE", () => {
  const missing = harness({
    journal: journalText([entry()]),
    backup: () => ({ ok: false, reason: "missing", diagnostic: "gone" }),
  });
  const missingReport = recoverInterruptedTransaction(missing.ports);
  assert.equal(missingReport.unresolved[0]?.reason, "backup-missing");
  assert.equal(missingReport.wroteBytes, false);
  assert.ok(!missing.log.includes("restore:artifact.md"));

  const altered = harness({
    journal: journalText([entry()]),
    backup: () => ({ ok: true, contentHash: THEIRS }),
  });
  const alteredReport = recoverInterruptedTransaction(altered.ports);
  assert.equal(alteredReport.unresolved[0]?.reason, "backup-mismatch");
  assert.ok(!altered.log.includes("restore:artifact.md"));
});

test("a failed write is unresolved, and does not claim the baseline moved", () => {
  const h = harness({
    journal: journalText([entry()]),
    restore: () => ({ ok: false, diagnostic: "EROFS" }),
  });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "incomplete");
  assert.equal(report.unresolved[0]?.reason, "restore-failed");
  assert.equal(report.wroteBytes, false);
});

// --- INVARIANT 2: the journal is discarded only on a COMPLETE recovery -------

test("preserved or unresolved work RETAINS the journal and stops the caller", () => {
  for (const observe of [
    (): DestinationObservation => ({ kind: "file", contentHash: THEIRS, bytes: 4 }),
    (): DestinationObservation => ({ kind: "symlink" }),
    (): DestinationObservation => ({ kind: "not-contained", rejection: "traversal" }),
  ]) {
    const h = harness({ journal: journalText([entry()]), observe });
    const report = recoverInterruptedTransaction(h.ports);
    assert.equal(report.state, "incomplete");
    assert.equal(report.proceeded, false);
    assert.notEqual(h.journal.text, null, "the journal must survive so re-entry can converge");
    assert.ok(!h.log.includes("discard"));
    assert.equal(report.diagnostics[0]?.code, "recovery/incomplete");
  }
});

test("UNAFFECTED TARGETS STILL RESTORE while an external edit and a symlink are preserved", () => {
  const entries = [
    entry({ destination: "a-clean.md" }),
    entry({ destination: "b-edited.md" }),
    entry({ destination: "c-link.md" }),
  ];
  const h = harness({
    journal: journalText(entries),
    observe: (destination) => {
      if (destination === "b-edited.md") return { kind: "file", contentHash: THEIRS, bytes: 4 };
      if (destination === "c-link.md") return { kind: "symlink" };
      return { kind: "file", contentHash: OURS, bytes: 4 };
    },
  });
  const report = recoverInterruptedTransaction(h.ports);

  assert.deepEqual(report.restored.map((r) => r.destination), ["a-clean.md"]);
  assert.deepEqual(
    report.preserved.map((r) => `${r.destination}:${r.reason}`),
    ["b-edited.md:external-edit", "c-link.md:symlink-conflict"],
  );
  assert.equal(report.wroteBytes, true, "the clean target was still restored");
  assert.equal(report.state, "incomplete");
  assert.equal(report.proceeded, false, "unresolved work stops the caller");
  assert.notEqual(h.journal.text, null);
});

// --- IDEMPOTENCE -------------------------------------------------------------

test("recovery interrupted mid-way and re-entered CONVERGES to the same result", () => {
  const text = journalText([entry({ destination: "a.md" }), entry({ destination: "b.md" })]);

  // First pass: `a.md` is restored, then the process dies before `b.md`. The
  // journal survives because nothing discarded it.
  const disk = new Map<string, string>([
    ["a.md", OURS],
    ["b.md", OURS],
  ]);
  const first = harness({
    journal: text,
    observe: (destination) => ({
      kind: "file",
      contentHash: disk.get(destination) ?? OURS,
      bytes: 4,
    }),
    restore: (destination) => {
      if (destination !== "a.md") throw new Error("interrupted");
      disk.set(destination, PRIOR);
      return { ok: true };
    },
  });
  const firstReport = recoverInterruptedTransaction(first.ports);
  assert.equal(firstReport.state, "incomplete");
  assert.notEqual(first.journal.text, null);
  assert.equal(disk.get("a.md"), PRIOR);
  assert.equal(disk.get("b.md"), OURS);

  // Re-entry against the SAME journal. `a.md` is already at its prior state, so
  // the guard reports it rather than rewriting it; `b.md` is still ours and is
  // restored. The run converges and the journal is discarded exactly once.
  const second = harness({
    journal: text,
    observe: (destination) => ({
      kind: "file",
      contentHash: disk.get(destination) ?? OURS,
      bytes: 4,
    }),
    restore: (destination) => {
      disk.set(destination, PRIOR);
      return { ok: true };
    },
  });
  const secondReport = recoverInterruptedTransaction(second.ports);
  assert.equal(secondReport.state, "recovered");
  assert.equal(secondReport.proceeded, true);
  assert.deepEqual(secondReport.alreadyRestored.map((r) => r.destination), ["a.md"]);
  assert.deepEqual(secondReport.restored.map((r) => r.destination), ["b.md"]);
  assert.equal(second.journal.text, null);
  assert.equal(disk.get("a.md"), PRIOR);
  assert.equal(disk.get("b.md"), PRIOR);

  // A THIRD entry against a fully-recovered workspace is a clean no-op.
  const third = harness({ journal: null });
  const thirdReport = recoverInterruptedTransaction(third.ports);
  assert.equal(thirdReport.state, "no-journal");
  assert.equal(thirdReport.wroteBytes, false);
});

test("re-running a COMPLETED recovery over the same journal rewrites nothing", () => {
  const text = journalText([entry()]);
  const h = harness({
    journal: text,
    observe: () => ({ kind: "file", contentHash: PRIOR, bytes: 4 }),
  });
  const report = recoverInterruptedTransaction(h.ports);
  assert.equal(report.state, "recovered");
  assert.equal(report.wroteBytes, false, "nothing needed writing, so the baseline did not move");
  assert.deepEqual(report.alreadyRestored.map((r) => r.reason), ["already-prior-content"]);
  assert.ok(!h.log.includes("restore:artifact.md"));
  assert.equal(h.journal.text, null);
});

// --- the two exported terminal reports ---------------------------------------

test("the invalid-root report is a fail-safe stop that never wrote", () => {
  const report = invalidRootRecoveryReport("root is blank");
  assert.equal(report.state, "invalid-root");
  assert.equal(report.proceeded, false);
  assert.equal(report.wroteBytes, false);
  assert.equal(report.diagnostics[0]?.code, "recovery/invalid-root");
});

test("the no-recovery report is byte-inert and non-blocking", () => {
  const report = noRecoveryReport();
  assert.equal(report.state, "no-journal");
  assert.equal(report.proceeded, true);
  assert.equal(report.wroteBytes, false);
  assert.deepEqual(report.restored, []);
  assert.deepEqual(report.preserved, []);
  assert.deepEqual(report.unresolved, []);
});
