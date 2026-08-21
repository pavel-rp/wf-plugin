// The journaled apply transaction driver — contract tests (WF-453, widened WF-454).
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
// over that state and asserts (a) EVERY destination is byte-identical to its
// prior state, (b) no journal and no backup survive, and (c) a SECOND recovery
// run converges — idempotent restart, not merely a lucky first pass.
//
// WF-454 RUNS THE WHOLE MATRIX TWICE: once over a single target (the WF-453
// shape, unchanged) and once over a TWO-target transaction. The second pass is
// what proves the widening did not open a window in which a kill leaves one
// destination written and another not.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  applyTransaction,
  emptySelfCheckExpectation,
  type ApplyPorts,
  type ApplyTargetWrite,
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

/** The SECOND destination of the widened transaction — a lifecycle ledger, the
 *  real co-target of a new registration. Its bytes are deliberately unrelated to
 *  the registry's, so a driver that confused the two would fail loudly. */
const LEDGER = "_local/install-state.json";
const LEDGER_PRIOR = '{\n  "portable": {}\n}\n';
const LEDGER_NEW = '{\n  "portable": {\n    "beta": 1\n  }\n}\n';

/** The two targets WF-455 adds, chosen to cover BOTH shapes a kill can find:
 *  the committed project override is ABSENT beforehand (a first write, whose
 *  correct restoration is removal), and the composed constitution is PRESENT
 *  (a replacement, whose correct restoration is the exact prior bytes —
 *  including the project's own clause section, which no backup elsewhere holds). */
const OVERRIDE = ".wf/slots/ship.review.md";
const OVERRIDE_NEW = "Drive the registered reviewer.\n";
const CONSTITUTION = "_local/constitution.md";
const CONSTITUTION_PRIOR =
  "# Project Constitution\n\n## Capability articles (provenance: each capability)\n\nNo registered capability declares a constitution article.\n\n## Project clauses (provenance: project)\n\n1. **no-vendored-forks:** upgraded, never forked.\n";
const CONSTITUTION_NEW =
  "# Project Constitution\n\n## Capability articles (provenance: each capability)\n\n### beta\n\n- **k:** v\n\n## Project clauses (provenance: project)\n\n1. **no-vendored-forks:** upgraded, never forked.\n";

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
  /** When set, `failAt` only fires for THIS destination. Lets a multi-target run
   *  fail on its second target while the first is already prepared. */
  failFor: string | null;
  selfCheck: SelfCheckOutcome;
  /** Mutates the workspace immediately before the first S6 re-observation,
   *  modelling a concurrent writer between check and write. */
  beforeRecheck: (() => void) | null;
  /** When set, `beforeRecheck` fires before THIS destination's re-observation
   *  rather than the first one reached. */
  recheckFor: string | null;
  /** Destinations already observed once — first observation is S2, any later one
   *  is the S6 re-check. */
  observed: Set<string>;
  log: Stage[];
}

function newWorkspace(over: Partial<Workspace> = {}): Workspace {
  const files = new Map<string, string>([
    [DESTINATION, PRIOR_BYTES],
    [LEDGER, LEDGER_PRIOR],
    [CONSTITUTION, CONSTITUTION_PRIOR],
  ]);
  return {
    files,
    links: new Set(),
    inodes: new Map([
      [DESTINATION, 1],
      [LEDGER, 2],
      [CONSTITUTION, 3],
    ]),
    nextInode: 4,
    journal: null,
    killAt: null,
    failAt: null,
    failFor: null,
    selfCheck: { ok: true },
    beforeRecheck: null,
    recheckFor: null,
    observed: new Set(),
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

function stage(ws: Workspace, name: Stage, destination?: string): "kill" | "fail" | "ok" {
  ws.log.push(name);
  if (ws.killAt === name) return "kill";
  if (ws.failAt === name) {
    if (ws.failFor === null || destination === undefined || ws.failFor === destination) {
      return "fail";
    }
  }
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

/** The per-destination backup slug the in-memory ports use. Only has to be
 *  injective over the destinations in this file; the production slug is proved
 *  in `apply-ports.test.ts`. */
function slug(destination: string): string {
  return destination.replace(/[^A-Za-z0-9._-]/g, "_");
}

function applyPortsFor(ws: Workspace): ApplyPorts {
  let counter = 0;
  return {
    backupPathFor: (transactionId, destination) =>
      `_local/lifecycle-backups/${transactionId}/${slug(destination)}`,
    newTransactionId: () => `tx${++counter}`,
    now: () => "2026-08-21T00:00:00.000Z",
    journalPresent: () => ws.journal !== null,
    backupsPresent: () =>
      [...ws.files.keys()].some((path) => path.startsWith("_local/lifecycle-backups/")),

    observeDestination: (destination) => {
      // S2 and S6 share this port. The FIRST observation of a destination is S2;
      // any later one is the re-check, which is exactly the check-to-write window
      // the TOCTOU guard closes.
      const first = !ws.observed.has(destination);
      ws.observed.add(destination);
      const verdict = stage(ws, first ? "observe" : "recheck", destination);
      if (verdict === "kill") throw new Error(`killed at ${first ? "observe" : "recheck"}`);
      if (!first && ws.beforeRecheck !== null) {
        if (ws.recheckFor === null || ws.recheckFor === destination) {
          const mutate = ws.beforeRecheck;
          ws.beforeRecheck = null;
          mutate();
        }
      }
      return observe(ws, destination);
    },

    destinationInode: (destination) => ws.inodes.get(destination) ?? null,

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

    writeBackup: (destination, backupPath): WriteOutcome => {
      const verdict = stage(ws, "writeBackup", destination);
      if (verdict === "kill") throw new Error("killed at writeBackup");
      if (verdict === "fail") return { ok: false, diagnostic: "backup write refused" };
      const source = ws.files.get(destination);
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

    atomicReplace: (destination, content): WriteOutcome => {
      const verdict = stage(ws, "atomicReplace", destination);
      // A kill here happens BEFORE the rename, so the destination is untouched —
      // that is exactly what "atomic" buys, and modelling it any other way would
      // be testing a filesystem this code does not target.
      if (verdict === "kill") throw new Error("killed at atomicReplace");
      if (verdict === "fail") return { ok: false, diagnostic: "replacement refused" };
      ws.files.set(destination, content);
      ws.inodes.set(destination, ws.nextInode++);
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

const EXPECTATION: SelfCheckExpectation = { ...emptySelfCheckExpectation(), present: ["beta"] };

const ONE_TARGET: readonly ApplyTargetWrite[] = [
  { destination: DESTINATION, newContent: NEW_BYTES },
];
const TWO_TARGETS: readonly ApplyTargetWrite[] = [
  { destination: DESTINATION, newContent: NEW_BYTES },
  { destination: LEDGER, newContent: LEDGER_NEW },
];
/** The WF-455 width: a configuration-only plan's full target set, registry and
 *  ledger alongside the committed project override and the composed
 *  constitution. Run through the same matrix so the widening is proved not to
 *  open a window where a kill leaves the override written and the constitution
 *  not — or, worse, the constitution half-written. */
const FOUR_TARGETS: readonly ApplyTargetWrite[] = [
  { destination: DESTINATION, newContent: NEW_BYTES },
  { destination: LEDGER, newContent: LEDGER_NEW },
  { destination: OVERRIDE, newContent: OVERRIDE_NEW },
  { destination: CONSTITUTION, newContent: CONSTITUTION_NEW },
];

function runTargets(ws: Workspace, targets: readonly ApplyTargetWrite[]) {
  return applyTransaction(applyPortsFor(ws), { targets, expectation: EXPECTATION });
}

function run(ws: Workspace) {
  return runTargets(ws, ONE_TARGET);
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
  assert.deepEqual(result.written, [DESTINATION]);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
  assert.equal(result.residue.journalRetained, false);
  assert.equal(result.residue.backupsRetained, false);
  assert.equal(
    ws.files.get(LEDGER),
    LEDGER_PRIOR,
    "a file this transaction did not name is byte-identical afterwards",
  );
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
// The widened, multi-target transaction (WF-454)
// ---------------------------------------------------------------------------

test("a MULTI-TARGET transaction writes every destination under ONE journal", () => {
  const ws = newWorkspace();
  const result = runTargets(ws, TWO_TARGETS);

  assert.equal(result.status, "applied");
  assert.deepEqual(result.written, [DESTINATION, LEDGER], "written in the caller's canonical order");
  assert.equal(ws.files.get(DESTINATION), NEW_BYTES);
  assert.equal(ws.files.get(LEDGER), LEDGER_NEW);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
  // ONE transaction id for the whole set: the two writes are one durable fact.
  assert.equal(ws.log.filter((s) => s === "writeJournal").length, 1);
});

test("every target is observed, journalled and backed up BEFORE any target is written", () => {
  const ws = newWorkspace();
  runTargets(ws, TWO_TARGETS);
  const order = ws.log;
  // Both backups precede the first replacement — the multi-target restatement of
  // "a plan is never partially interpreted".
  assert.equal(order.filter((s) => s === "writeBackup").length, 2);
  assert.equal(order.filter((s) => s === "atomicReplace").length, 2);
  assert.ok(
    order.lastIndexOf("writeBackup") < order.indexOf("atomicReplace"),
    "the LAST backup still precedes the FIRST write",
  );
  assert.ok(
    order.lastIndexOf("recheck") < order.indexOf("atomicReplace"),
    "the LAST re-check still precedes the FIRST write",
  );
  assert.ok(
    order.lastIndexOf("observe") < order.indexOf("writeJournal"),
    "every destination is observed before the journal is written",
  );
});

test("two targets of one transaction get DISTINCT backup paths", () => {
  const ws = newWorkspace({ failAt: "atomicReplace" });
  // Fail at the write so the backups are still on disk when we look.
  const ports = applyPortsFor(ws);
  const paths = new Set([
    ports.backupPathFor("tx1", DESTINATION),
    ports.backupPathFor("tx1", LEDGER),
  ]);
  assert.equal(paths.size, 2, "one transaction never collides two targets on one backup file");
  const result = runTargets(ws, TWO_TARGETS);
  assert.equal(result.status, "rolled-back");
  assert.deepEqual(result.written, [], "no write set is reported for a run that did not complete");
});

test("A BAD TARGET ANYWHERE REFUSES THE WHOLE TRANSACTION — no journal, no partial write", () => {
  // The second target is a symlink. The first is perfectly writable, and must
  // still be byte-identical afterwards.
  const ws = newWorkspace();
  ws.files.delete(LEDGER);
  ws.links.add(LEDGER);
  const result = runTargets(ws, TWO_TARGETS);

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/destination-symlink");
  assert.equal(result.transactionId, null, "no transaction id is even consumed");
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.deepEqual(result.written, []);
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES, "the GOOD target is untouched");
  assert.ok(!ws.log.includes("atomicReplace"));
});

test("a backup failure on the SECOND target leaves the FIRST target untouched", () => {
  const ws = newWorkspace({ failAt: "writeBackup", failFor: LEDGER });
  const result = runTargets(ws, TWO_TARGETS);

  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/backup-failed");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.equal(ws.files.get(LEDGER), LEDGER_PRIOR);
  assert.ok(!ws.log.includes("atomicReplace"), "nothing was written");
  assert.equal(ws.journal, null);
  assert.equal(result.residue.clean, true);
});

test("INTERFERENCE with the second target refuses before the FIRST is written", () => {
  const ws = newWorkspace();
  ws.recheckFor = LEDGER;
  ws.beforeRecheck = () => {
    ws.files.set(LEDGER, '{\n  "portable": {"someone-else": true}\n}\n');
  };
  const result = runTargets(ws, TWO_TARGETS);

  assert.equal(result.status, "rolled-back");
  assert.ok(!ws.log.includes("atomicReplace"), "the first target was never written");
  assert.ok(result.diagnostics.some((d) => d.code === "apply/precondition-moved"));
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES, "the untouched target is byte-identical");
  assert.ok(
    ws.files.get(LEDGER)?.includes("someone-else"),
    "the concurrent edit survives byte-for-byte",
  );
});

test("an EMPTY target set is refused before a journal", () => {
  const ws = newWorkspace();
  const result = runTargets(ws, []);
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/registry-unresolvable");
  assert.equal(result.transactionId, null);
  assert.equal(ws.journal, null);
  assert.deepEqual(result.written, []);
});

test("a DUPLICATE destination is refused before a journal", () => {
  const ws = newWorkspace();
  const result = runTargets(ws, [
    { destination: DESTINATION, newContent: NEW_BYTES },
    { destination: DESTINATION, newContent: PRIOR_BYTES },
  ]);
  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/registry-unresolvable");
  assert.equal(result.transactionId, null);
  assert.equal(ws.journal, null);
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.ok(result.diagnostics.some((d) => d.message.includes("twice")));
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
    { targets: ONE_TARGET, expectation: EXPECTATION },
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
    { targets: ONE_TARGET, expectation: EXPECTATION },
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
    { targets: ONE_TARGET, expectation: EXPECTATION },
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

test("a replacement that fails on the SECOND target rolls the FIRST one back too", () => {
  // The one case a multi-target driver could get catastrophically wrong: target 1
  // is already replaced when target 2 refuses. The journal covers BOTH, so the
  // guarded rollback restores both.
  const ws = newWorkspace({ failAt: "atomicReplace", failFor: LEDGER });
  const result = runTargets(ws, TWO_TARGETS);

  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/write-failed");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES, "the already-written target is undone");
  assert.equal(ws.files.get(LEDGER), LEDGER_PRIOR);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
  assert.deepEqual(result.written, []);
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

test("A FAILED SELF-CHECK rolls back EVERY target of a multi-target transaction", () => {
  const ws = newWorkspace({
    selfCheck: { ok: false, diagnostic: "the seeded evidence did not read back" },
  });
  const result = runTargets(ws, TWO_TARGETS);
  assert.equal(result.status, "rolled-back");
  assert.equal(result.reason, "apply/self-check-failed");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.equal(ws.files.get(LEDGER), LEDGER_PRIOR);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.deepEqual(result.written, []);
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
  const result = applyTransaction(crippled, { targets: ONE_TARGET, expectation: EXPECTATION });

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
    { targets: ONE_TARGET, expectation: EXPECTATION },
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

/** Run the matrix over a target set. `label` names the shape in the test title so
 *  a failure says WHICH width broke; `prior` is the byte-exact state every named
 *  destination must be restored to. */
function crashMatrix(label: string, targets: readonly ApplyTargetWrite[]) {
  // `OVERRIDE` is deliberately absent from this map: its correct restoration is
  // "not there", and `Map.get` yields `undefined` for both sides of that
  // comparison, so the same assertion covers a created file and a replaced one.
  const prior = new Map<string, string>([
    [DESTINATION, PRIOR_BYTES],
    [LEDGER, LEDGER_PRIOR],
    [CONSTITUTION, CONSTITUTION_PRIOR],
  ]);

  for (const killAt of CRASH_STAGES) {
    test(`${label}: a process killed at \`${killAt}\` restores the exact prior state, idempotently, on restart`, () => {
      const ws = newWorkspace({ killAt });

      // The kill. `applyTransaction` does not catch a port throw, so what remains
      // is exactly the state that stage would leave on disk.
      assert.throws(() => runTargets(ws, targets), /killed at/);

      // The restart: the SAME frozen recovery driver a fresh process runs.
      const first = recoverInterruptedTransaction(recoveryPortsFor(ws));
      assert.ok(
        first.state === "recovered" || first.state === "no-journal",
        `recovery after a kill at ${killAt} must resolve, got \`${first.state}\``,
      );
      assert.equal(first.proceeded, true);
      for (const target of targets) {
        assert.equal(
          ws.files.get(target.destination),
          prior.get(target.destination),
          `a kill at ${killAt} must restore the exact prior bytes of \`${target.destination}\``,
        );
      }
      assert.equal(ws.journal, null, `a kill at ${killAt} must leave no journal after recovery`);
      assert.deepEqual(backupsIn(ws), [], `a kill at ${killAt} must leave no backup after recovery`);

      // IDEMPOTENT: a second restart converges rather than re-restoring or refusing.
      const second = recoverInterruptedTransaction(recoveryPortsFor(ws));
      assert.equal(second.state, "no-journal");
      assert.equal(second.proceeded, true);
      for (const target of targets) {
        assert.equal(ws.files.get(target.destination), prior.get(target.destination));
      }
    });
  }

  test(`${label}: a kill at \`discardTransaction\` leaves the transaction DURABLY COMPLETE — the journal goes first`, () => {
    // The one stage whose correct outcome is the NEW state, not the prior one: the
    // journal is removed before the backups, so the instant it is gone the
    // transaction is complete and a restart must not undo it.
    const ws = newWorkspace({ killAt: "discardTransaction" });
    assert.throws(() => runTargets(ws, targets), /killed at/);

    for (const target of targets) {
      assert.equal(
        ws.files.get(target.destination),
        target.newContent,
        "the applied bytes survive the kill",
      );
    }
    assert.equal(ws.journal, null, "the journal was discarded FIRST");

    const recovery = recoverInterruptedTransaction(recoveryPortsFor(ws));
    assert.equal(recovery.state, "no-journal");
    for (const target of targets) {
      assert.equal(
        ws.files.get(target.destination),
        target.newContent,
        "a restart must never undo a durably-completed transaction",
      );
    }
    // At most one orphan backup per target remains — inert, and reclaimed by the
    // ports' prune.
    assert.ok(backupsIn(ws).length <= targets.length);
  });

  test(`${label}: a kill mid-transaction followed by recovery lets a RE-RUN apply cleanly`, () => {
    // End-to-end convergence: kill, recover, re-enter, succeed — the property that
    // makes an interrupted install safe to simply retry.
    const ws = newWorkspace({ killAt: "atomicReplace" });
    assert.throws(() => runTargets(ws, targets), /killed at/);
    recoverInterruptedTransaction(recoveryPortsFor(ws));

    ws.killAt = null;
    ws.log = [];
    ws.observed = new Set();
    const result = runTargets(ws, targets);
    assert.equal(result.status, "applied");
    for (const target of targets) {
      assert.equal(ws.files.get(target.destination), target.newContent);
    }
    assert.equal(ws.journal, null);
    assert.deepEqual(backupsIn(ws), []);
  });
}

crashMatrix("one target", ONE_TARGET);
crashMatrix("two targets", TWO_TARGETS);
crashMatrix("four targets, with the committed override and the constitution", FOUR_TARGETS);

test("a rolled-back four-target transaction leaves the project's clause section exactly as it was", () => {
  // The single most damaging loss this item could cause, asserted at the widest
  // width and on the failure path: the clause section is human-authored, no second
  // copy exists, and a rollback that restored "most of" the record would still have
  // destroyed it.
  const ws = newWorkspace({ selfCheck: { ok: false, diagnostic: "beta did not resolve" } });
  const result = applyTransaction(applyPortsFor(ws), {
    targets: FOUR_TARGETS,
    expectation: EXPECTATION,
  });

  assert.equal(result.status, "rolled-back");
  assert.equal(ws.files.get(CONSTITUTION), CONSTITUTION_PRIOR);
  assert.ok(ws.files.get(CONSTITUTION)?.includes("no-vendored-forks"));
  assert.equal(ws.files.has(OVERRIDE), false, "a created override is REMOVED, not left behind");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.equal(ws.files.get(LEDGER), LEDGER_PRIOR);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
});
