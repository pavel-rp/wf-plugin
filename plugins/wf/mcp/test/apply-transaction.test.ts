// The journaled apply transaction driver — contract tests (WF-453).
//
// Driven over an in-memory workspace, for the same reason `lifecycle-recovery`'s
// suite is: every invariant under test is a property of the DRIVER — stage order,
// journal lifetime, the backup proof, the TOCTOU guard, the self-check verdict,
// the guarded rollback, and durable completion — not of any particular
// filesystem. The production ports are exercised against a real filesystem in
// `apply-ports.test.ts`.
//
// THE CENTRE OF THIS FILE IS THE CRASH MATRIX. A `throw` from a port is the
// faithful in-memory model of a process kill: `applyTransaction` deliberately
// does not catch one, so the fake workspace is left in exactly the on-disk state
// that stage would leave. Each case then runs the REAL frozen recovery driver
// over that state and asserts (a) the destination is byte-identical to its prior
// state, (b) no journal and no backup survive, and (c) a SECOND recovery run
// converges — idempotent restart, not merely a lucky first pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyTransaction,
  type ApplyPorts,
  type SelfCheckExpectation,
  type SelfCheckOutcome,
} from "../src/resolver/apply-transaction.js";
import type { DestinationObservation } from "../src/resolver/lifecycle-journal.js";
import {
  recoverInterruptedTransaction,
  type BackupIdentity,
  type RecoveryPorts,
  type WriteOutcome,
} from "../src/resolver/lifecycle-recovery.js";
import type { JournalEntry, TransactionJournal } from "../src/resolver/types.js";

const DESTINATION = "_local/config.md";
const PRIOR_BYTES = "# config\n\n| Capability | Path |\n| ------ | ------ |\n";
const NEW_BYTES = "# config\n\n| Capability | Path |\n| ------ | ------ |\n| beta | p |\n";

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** Every stage a kill can land in, named exactly as the driver's stage comments
 *  name them. Used as the crash matrix's axis. */
type Stage =
  | "observe"
  | "identify"
  | "writeJournal"
  | "writeBackup"
  | "hashBackup"
  | "recheck"
  | "atomicReplace"
  | "refreshAndSelfCheck"
  | "discardTransaction";

interface Workspace {
  /** `null` models an absent file. Symlinks are modelled by `linkAt`. */
  files: Map<string, string>;
  links: Set<string>;
  /** A cheap stand-in for the inode: bumped on every replacement. */
  inodes: Map<string, number>;
  nextInode: number;
  journal: string | null;
  /** Ports throw when the named stage is reached — the process-kill model. */
  killAt: Stage | null;
  /** Ports return a failure (not a throw) when the named stage is reached — the
   *  ordinary-failure model, which must roll back rather than strand. */
  failAt: Stage | null;
  selfCheck: SelfCheckOutcome;
  /** Mutates the workspace immediately before the S6 re-observation, modelling a
   *  concurrent writer between check and write. */
  beforeRecheck: (() => void) | null;
  log: Stage[];
}

function newWorkspace(over: Partial<Workspace> = {}): Workspace {
  const files = new Map<string, string>([[DESTINATION, PRIOR_BYTES]]);
  return {
    files,
    links: new Set(),
    inodes: new Map([[DESTINATION, 1]]),
    nextInode: 2,
    journal: null,
    killAt: null,
    failAt: null,
    selfCheck: { ok: true },
    beforeRecheck: null,
    log: [],
    ...over,
  };
}

function observe(ws: Workspace, path: string): DestinationObservation {
  if (ws.links.has(path)) return { kind: "symlink" };
  const content = ws.files.get(path);
  if (content === undefined) return { kind: "absent" };
  const bytes = Buffer.from(content, "utf8");
  return { kind: "file", contentHash: sha256(content), bytes: bytes.byteLength };
}

function stage(ws: Workspace, name: Stage): "kill" | "fail" | "ok" {
  ws.log.push(name);
  if (ws.killAt === name) return "kill";
  if (ws.failAt === name) return "fail";
  return "ok";
}

/** The frozen WF-451 recovery ports over the same in-memory workspace. Used both
 *  as the driver's `rollbackPorts()` and, in the crash matrix, as the RESTART
 *  path — the same driver a fresh process would run. */
function recoveryPortsFor(ws: Workspace): RecoveryPorts {
  return {
    acquireLock: () => ({ ok: true }),
    releaseLock: () => {},
    readJournal: () => ws.journal,
    observeDestination: (destination) => observe(ws, destination),
    hashBackup: (backupPath): BackupIdentity => {
      const content = ws.files.get(backupPath);
      if (content === undefined) {
        return { ok: false, reason: "missing", diagnostic: `\`${backupPath}\` is absent.` };
      }
      return { ok: true, contentHash: sha256(content) };
    },
    restoreBytes: (destination, backupPath): WriteOutcome => {
      const content = ws.files.get(backupPath);
      if (content === undefined) {
        return { ok: false, diagnostic: `\`${backupPath}\` is absent.` };
      }
      ws.files.set(destination, content);
      ws.inodes.set(destination, ws.nextInode++);
      return { ok: true };
    },
    removeDestination: (destination): WriteOutcome => {
      ws.files.delete(destination);
      ws.inodes.delete(destination);
      return { ok: true };
    },
    discardJournal: (entries) => {
      for (const entry of entries) {
        if (entry.backupPath !== null) ws.files.delete(entry.backupPath);
      }
      ws.journal = null;
    },
  };
}

function applyPortsFor(ws: Workspace): ApplyPorts {
  let counter = 0;
  return {
    destination: DESTINATION,
    backupPathFor: (transactionId) => `_local/lifecycle-backups/${transactionId}/registry`,
    newTransactionId: () => `tx${++counter}`,
    now: () => "2026-08-21T00:00:00.000Z",
    journalPresent: () => ws.journal !== null,
    backupsPresent: () =>
      [...ws.files.keys()].some((path) => path.startsWith("_local/lifecycle-backups/")),

    observeDestination: () => {
      // S2 and S6 share this port. `beforeRecheck` fires once, on the SECOND call,
      // which is exactly the check-to-write window the TOCTOU guard closes.
      const first = !ws.log.includes("observe");
      const verdict = stage(ws, first ? "observe" : "recheck");
      if (verdict === "kill") throw new Error(`killed at ${first ? "observe" : "recheck"}`);
      if (!first && ws.beforeRecheck !== null) {
        const mutate = ws.beforeRecheck;
        ws.beforeRecheck = null;
        mutate();
      }
      return observe(ws, DESTINATION);
    },

    destinationInode: () => ws.inodes.get(DESTINATION) ?? null,

    identify: (content) => {
      if (stage(ws, "identify") === "kill") throw new Error("killed at identify");
      return { contentHash: sha256(content), bytes: Buffer.from(content, "utf8").byteLength };
    },

    writeJournal: (journal: TransactionJournal): WriteOutcome => {
      const verdict = stage(ws, "writeJournal");
      if (verdict === "kill") throw new Error("killed at writeJournal");
      if (verdict === "fail") return { ok: false, diagnostic: "journal write refused" };
      ws.journal = JSON.stringify(journal);
      return { ok: true };
    },

    writeBackup: (backupPath): WriteOutcome => {
      const verdict = stage(ws, "writeBackup");
      if (verdict === "kill") throw new Error("killed at writeBackup");
      if (verdict === "fail") return { ok: false, diagnostic: "backup write refused" };
      const source = ws.files.get(DESTINATION);
      if (source === undefined) return { ok: false, diagnostic: "nothing to back up" };
      ws.files.set(backupPath, source);
      return { ok: true };
    },

    hashBackup: (backupPath): BackupIdentity => {
      const verdict = stage(ws, "hashBackup");
      if (verdict === "kill") throw new Error("killed at hashBackup");
      if (verdict === "fail") {
        return { ok: false, reason: "unreadable", diagnostic: "backup unreadable" };
      }
      return recoveryPortsFor(ws).hashBackup(backupPath);
    },

    atomicReplace: (content): WriteOutcome => {
      const verdict = stage(ws, "atomicReplace");
      // A kill here happens BEFORE the rename, so the destination is untouched —
      // that is exactly what "atomic" buys, and modelling it any other way would
      // be testing a filesystem this code does not target.
      if (verdict === "kill") throw new Error("killed at atomicReplace");
      if (verdict === "fail") return { ok: false, diagnostic: "replacement refused" };
      ws.files.set(DESTINATION, content);
      ws.inodes.set(DESTINATION, ws.nextInode++);
      return { ok: true };
    },

    refreshAndSelfCheck: (_expectation: SelfCheckExpectation): SelfCheckOutcome => {
      const verdict = stage(ws, "refreshAndSelfCheck");
      if (verdict === "kill") throw new Error("killed at refreshAndSelfCheck");
      return ws.selfCheck;
    },

    discardTransaction: (entries: readonly JournalEntry[]) => {
      const verdict = stage(ws, "discardTransaction");
      // JOURNAL FIRST — modelled faithfully, so a kill after this line leaves a
      // durably-complete transaction with at most an orphan backup.
      ws.journal = null;
      if (verdict === "kill") throw new Error("killed at discardTransaction");
      for (const entry of entries) {
        if (entry.backupPath !== null) ws.files.delete(entry.backupPath);
      }
    },

    rollbackPorts: () => recoveryPortsFor(ws),
  };
}

const EXPECTATION: SelfCheckExpectation = { present: ["beta"], absent: [] };

function run(ws: Workspace) {
  return applyTransaction(applyPortsFor(ws), {
    newContent: NEW_BYTES,
    expectation: EXPECTATION,
  });
}

function backupsIn(ws: Workspace): string[] {
  return [...ws.files.keys()].filter((path) => path.startsWith("_local/lifecycle-backups/"));
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("an exact registry-only transaction applies, self-checks, and leaves NO residue", () => {
  const ws = newWorkspace();
  const result = run(ws);

  assert.equal(result.status, "applied");
  assert.equal(result.reason, null);
  assert.equal(result.selfCheck, "ok");
  assert.equal(result.refreshed, true);
  assert.ok(result.transactionId !== null);
  assert.equal(result.rollback, null);
  assert.equal(ws.files.get(DESTINATION), NEW_BYTES);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
  assert.equal(result.residue.journalRetained, false);
  assert.equal(result.residue.backupsRetained, false);
});

test("the stage order is the contract: journal BEFORE backup, and the TOCTOU re-check before the write", () => {
  const ws = newWorkspace();
  run(ws);
  const order = ws.log;
  assert.ok(order.indexOf("writeJournal") < order.indexOf("writeBackup"), "journal precedes backup");
  assert.ok(order.indexOf("writeBackup") < order.indexOf("hashBackup"), "backup precedes its proof");
  assert.ok(order.indexOf("hashBackup") < order.indexOf("recheck"), "proof precedes the re-check");
  assert.ok(order.indexOf("recheck") < order.indexOf("atomicReplace"), "re-check precedes the write");
  assert.ok(
    order.indexOf("atomicReplace") < order.indexOf("refreshAndSelfCheck"),
    "write precedes the self-check",
  );
  assert.ok(
    order.indexOf("refreshAndSelfCheck") < order.indexOf("discardTransaction"),
    "self-check precedes completion",
  );
});

test("a transaction over an ABSENT destination journals an absent prior and creates no backup", () => {
  const ws = newWorkspace();
  ws.files.delete(DESTINATION);
  ws.inodes.delete(DESTINATION);
  const result = run(ws);
  assert.equal(result.status, "applied");
  assert.equal(ws.files.get(DESTINATION), NEW_BYTES);
  assert.deepEqual(backupsIn(ws), []);
  assert.ok(!ws.log.includes("writeBackup"), "no backup is written for an absent prior");
});

// ---------------------------------------------------------------------------
// Refusals BEFORE any journal exists
// ---------------------------------------------------------------------------

test("a symlink destination is refused before a journal, a backup, or a byte", () => {
  const ws = newWorkspace();
  ws.links.add(DESTINATION);
  const result = run(ws);
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/destination-symlink");
  assert.equal(result.transactionId, null, "no journal was created");
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
  assert.ok(!ws.log.includes("writeJournal"));
});

test("an uncontained destination is refused before a journal", () => {
  const ws = newWorkspace();
  const ports = applyPortsFor(ws);
  const result = applyTransaction(
    { ...ports, observeDestination: () => ({ kind: "not-contained", rejection: "escapes-root" }) },
    { newContent: NEW_BYTES, expectation: EXPECTATION },
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/registry-unresolvable");
  assert.equal(result.transactionId, null);
  assert.equal(ws.journal, null);
});

test("an unobservable destination is refused before a journal", () => {
  const ws = newWorkspace();
  const ports = applyPortsFor(ws);
  const result = applyTransaction(
    {
      ...ports,
      observeDestination: () => ({ kind: "observation-failed", diagnostic: "EACCES" }),
    },
    { newContent: NEW_BYTES, expectation: EXPECTATION },
  );
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/registry-unresolvable");
  assert.equal(result.transactionId, null);
});

test("a journal that cannot be written creates no transaction and needs no rollback", () => {
  const ws = newWorkspace({ failAt: "writeJournal" });
  const result = run(ws);
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/write-failed");
  assert.equal(result.transactionId, null);
  assert.equal(result.rollback, null);
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
});

// ---------------------------------------------------------------------------
// Failures AFTER the journal — every one rolls back
// ---------------------------------------------------------------------------

test("a backup that cannot be written rolls back and reports the BACKUP failure", () => {
  const ws = newWorkspace({ failAt: "writeBackup" });
  const result = run(ws);
  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/backup-failed");
  assert.ok(result.transactionId !== null, "a transaction existed");
  assert.equal(result.rollback?.complete, true);
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.equal(ws.journal, null);
  assert.equal(result.residue.clean, true);
  assert.ok(!ws.log.includes("atomicReplace"), "nothing was written");
});

test("a backup that cannot be verified rolls back — the proof precedes the write, never follows it", () => {
  const ws = newWorkspace({ failAt: "hashBackup" });
  const result = run(ws);
  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/backup-failed");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.ok(!ws.log.includes("atomicReplace"));
});

test("a backup whose bytes do not reproduce the recorded prior hash rolls back", () => {
  const ws = newWorkspace();
  const ports = applyPortsFor(ws);
  const result = applyTransaction(
    { ...ports, hashBackup: () => ({ ok: true, contentHash: "0".repeat(64) }) },
    { newContent: NEW_BYTES, expectation: EXPECTATION },
  );
  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/backup-failed");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
});

test("a destination whose BYTES change between check and write is refused, and the edit is preserved", () => {
  const external = `${PRIOR_BYTES}| gamma | p |\n`;
  const ws = newWorkspace();
  ws.beforeRecheck = () => {
    ws.files.set(DESTINATION, external);
  };
  const result = run(ws);

  assert.equal(result.status, "rolled-back");
  assert.ok(!ws.log.includes("atomicReplace"), "nothing was written over the moved file");
  // The precondition-moved CAUSE is reported; the rollback disposition then
  // overrides the headline reason, because the concurrent edit is preserved
  // rather than clobbered and preserved work means no success is claimed.
  assert.ok(result.diagnostics.some((d) => d.code === "apply/precondition-moved"));
  assert.equal(result.reason, "apply/rollback-incomplete");
  assert.equal(ws.files.get(DESTINATION), external, "the concurrent edit survives byte-for-byte");
  assert.ok((result.rollback?.preserved.length ?? 0) > 0);
});

test("a SYMLINK swapped in between check and write is refused, and the link is preserved", () => {
  const ws = newWorkspace();
  ws.beforeRecheck = () => {
    ws.files.delete(DESTINATION);
    ws.links.add(DESTINATION);
  };
  const result = run(ws);
  assert.equal(result.status, "rolled-back");
  assert.ok(result.diagnostics.some((d) => d.code === "apply/precondition-moved"));
  // The frozen recovery guard preserves a symlink rather than clobbering it, so
  // the rollback reports preserved work and claims no success.
  assert.equal(result.reason, "apply/rollback-incomplete");
  assert.ok(ws.links.has(DESTINATION), "the link that was swapped in survives");
  assert.equal(ws.files.has(DESTINATION), false);
  assert.ok((result.rollback?.preserved.length ?? 0) > 0);
});

test("a destination whose INODE changes while its bytes stay identical is still refused", () => {
  // The case type-and-hash alone cannot catch: same content, different file. This
  // is why the inode is a separate port rather than a widened frozen observation.
  const ws = newWorkspace();
  ws.beforeRecheck = () => {
    ws.inodes.set(DESTINATION, 999);
  };
  const result = run(ws);
  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/precondition-moved");
  assert.ok(result.diagnostics.some((d) => d.message.includes("999")));
  assert.ok(!ws.log.includes("atomicReplace"));
});

test("a replacement that fails rolls the destination back to its exact prior bytes", () => {
  const ws = newWorkspace({ failAt: "atomicReplace" });
  const result = run(ws);
  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/write-failed");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.equal(ws.journal, null);
  assert.equal(result.residue.clean, true);
});

test("A FAILED SELF-CHECK IS TRANSACTION FAILURE — the write is rolled back, not warned about", () => {
  const ws = newWorkspace({ selfCheck: { ok: false, diagnostic: "`beta` did not resolve" } });
  const result = run(ws);
  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/self-check-failed");
  assert.equal(result.selfCheck, "failed");
  assert.equal(result.refreshed, true, "the refresh DID happen, and is reported honestly");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES, "the write is undone");
  assert.equal(ws.journal, null);
  assert.ok(result.diagnostics.some((d) => d.message.includes("did not resolve")));
});

test("NO SUCCESS IS CLAIMED when the rollback itself cannot finish", () => {
  // The write LANDED and then the self-check refused, so the destination holds
  // this transaction's own bytes and the rollback must restore from the backup —
  // which here cannot be proved, leaving the entry explicitly unresolved.
  const ws = newWorkspace({ selfCheck: { ok: false, diagnostic: "`beta` did not resolve" } });
  const ports = applyPortsFor(ws);
  const crippled: ApplyPorts = {
    ...ports,
    rollbackPorts: () => ({
      ...recoveryPortsFor(ws),
      // The backup cannot be proved, so the frozen driver leaves the entry
      // UNRESOLVED and retains the journal.
      hashBackup: () => ({ ok: false, reason: "unreadable", diagnostic: "backup unreadable" }),
    }),
  };
  const result = applyTransaction(crippled, { newContent: NEW_BYTES, expectation: EXPECTATION });

  assert.equal(result.status, "rolled-back");
  // The outstanding work OVERRIDES the original cause: it is the more urgent story.
  assert.equal(result.reason, "apply/rollback-incomplete");
  assert.equal(result.rollback?.complete, false);
  assert.ok((result.rollback?.unresolved.length ?? 0) > 0);
  assert.equal(result.residue.clean, false);
  assert.equal(result.residue.journalRetained, true, "the journal is retained so a later run converges");
  assert.ok(result.diagnostics.some((d) => d.code === "apply/rollback-incomplete"));
});

test("an EXTERNAL EDIT landing after the write is preserved by the rollback, never clobbered", () => {
  const ws = newWorkspace({ selfCheck: { ok: false, diagnostic: "self-check refused" } });
  const ports = applyPortsFor(ws);
  const external = "# somebody else entirely\n";
  const result = applyTransaction(
    {
      ...ports,
      refreshAndSelfCheck: () => {
        // A third party writes between the replacement and the rollback.
        ws.files.set(DESTINATION, external);
        return { ok: false, diagnostic: "self-check refused" };
      },
    },
    { newContent: NEW_BYTES, expectation: EXPECTATION },
  );

  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/rollback-incomplete");
  assert.equal(ws.files.get(DESTINATION), external, "the external edit survives byte-for-byte");
  assert.ok((result.rollback?.preserved.length ?? 0) > 0);
  assert.equal(result.residue.clean, false);
});

// ---------------------------------------------------------------------------
// THE CRASH MATRIX — a kill at EVERY journal and mutation stage
// ---------------------------------------------------------------------------

const CRASH_STAGES: Stage[] = [
  "observe",
  "identify",
  "writeJournal",
  "writeBackup",
  "hashBackup",
  "recheck",
  "atomicReplace",
  "refreshAndSelfCheck",
];

for (const killAt of CRASH_STAGES) {
  test(`a process killed at \`${killAt}\` restores the exact prior state, idempotently, on restart`, () => {
    const ws = newWorkspace({ killAt });

    // The kill. `applyTransaction` does not catch a port throw, so what remains is
    // exactly the state that stage would leave on disk.
    assert.throws(() => run(ws), /killed at/);

    // The restart: the SAME frozen recovery driver a fresh process runs.
    const first = recoverInterruptedTransaction(recoveryPortsFor(ws));
    assert.ok(
      first.state === "recovered" || first.state === "no-journal",
      `recovery after a kill at ${killAt} must resolve, got \`${first.state}\``,
    );
    assert.equal(first.proceeded, true);
    assert.equal(
      ws.files.get(DESTINATION),
      PRIOR_BYTES,
      `a kill at ${killAt} must restore the exact prior bytes`,
    );
    assert.equal(ws.journal, null, `a kill at ${killAt} must leave no journal after recovery`);
    assert.deepEqual(backupsIn(ws), [], `a kill at ${killAt} must leave no backup after recovery`);

    // IDEMPOTENT: a second restart converges rather than re-restoring or refusing.
    const second = recoverInterruptedTransaction(recoveryPortsFor(ws));
    assert.equal(second.state, "no-journal");
    assert.equal(second.proceeded, true);
    assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  });
}

test("a kill at `discardTransaction` leaves the transaction DURABLY COMPLETE — the journal goes first", () => {
  // The one stage whose correct outcome is the NEW state, not the prior one: the
  // journal is removed before the backups, so the instant it is gone the
  // transaction is complete and a restart must not undo it.
  const ws = newWorkspace({ killAt: "discardTransaction" });
  assert.throws(() => run(ws), /killed at/);

  assert.equal(ws.files.get(DESTINATION), NEW_BYTES, "the applied bytes survive the kill");
  assert.equal(ws.journal, null, "the journal was discarded FIRST");

  const recovery = recoverInterruptedTransaction(recoveryPortsFor(ws));
  assert.equal(recovery.state, "no-journal");
  assert.equal(
    ws.files.get(DESTINATION),
    NEW_BYTES,
    "a restart must never undo a durably-completed transaction",
  );
  // At most an orphan backup remains — inert, and reclaimed by the ports' prune.
  assert.ok(backupsIn(ws).length <= 1);
});

test("a kill mid-transaction followed by recovery lets a RE-RUN apply cleanly", () => {
  // End-to-end convergence: kill, recover, re-enter, succeed — the property that
  // makes an interrupted install safe to simply retry.
  const ws = newWorkspace({ killAt: "atomicReplace" });
  assert.throws(() => run(ws), /killed at/);
  recoverInterruptedTransaction(recoveryPortsFor(ws));

  ws.killAt = null;
  ws.log = [];
  const result = run(ws);
  assert.equal(result.status, "applied");
  assert.equal(ws.files.get(DESTINATION), NEW_BYTES);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
});
