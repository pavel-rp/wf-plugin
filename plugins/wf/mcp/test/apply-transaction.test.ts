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
  type ApplyTarget,
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

/** The target WF-456 adds — a pack payload installed into the workspace. Like
 *  the override it is ABSENT beforehand, but it differs in the way that matters
 *  for the five-surface rollback: it is the only target whose PROOF lives in a
 *  different file (the ledger's `artifacts` section), so a rollback that undid
 *  the payload while leaving its ownership record behind would leave the
 *  workspace claiming to own a file that is not there. */
const PAYLOAD = "_local/tooling/helper.mjs";
const PAYLOAD_NEW = "export const answer = 42;\n";

/** The target WF-458 adds — a managed artifact this transaction REMOVES. It is
 *  PRESENT beforehand and its correct restoration after any interrupted removal
 *  is its exact prior bytes, which is the hardest case in the whole matrix: the
 *  destination's post-crash state is ABSENCE, so nothing on disk can be compared
 *  against, and the verified backup is the only thing standing between an
 *  interrupted delete and permanent data loss.
 *
 *  Its bytes are deliberately unlike every other fixture's, so a restore that
 *  brought back the wrong file's contents would fail loudly rather than compare
 *  equal by coincidence. */
const MANAGED = "_local/tooling/managed.md";
const MANAGED_PRIOR = "# managed\n\nInstalled by a pack that is now deregistered.\n";

/** The two targets WF-459 adds.
 *
 *  `UPGRADED` is a managed artifact this transaction ADVANCES: present beforehand,
 *  replaced with the bytes its owners declare now. Unlike a payload (absent, so
 *  its correct restoration is removal) an interrupted advance must restore
 *  CONTENT — and unlike a removal it must never leave the destination absent at
 *  any resolved point, which is the property the deletion-free assertions below
 *  exist for.
 *
 *  `EDITED` is the artifact this transaction deliberately does NOT name: a file
 *  the user changed by hand, retained rather than upgraded. It is in the workspace
 *  precisely so every run in this matrix can prove it came through byte-identical
 *  AND inode-identical — the WF-454 technique, because inode equality is what
 *  catches an atomic-replace that happened to produce identical bytes. */
const UPGRADED = "_local/tooling/upgraded.md";
const UPGRADED_PRIOR = "# upgraded\n\nThe bytes this installer last produced.\n";
const UPGRADED_NEW = "# upgraded\n\nThe bytes its owners declare now.\n";
const EDITED = "_local/tooling/edited.md";
const EDITED_PRIOR = "# edited\n\nChanged by hand. Never overwritten, always reported.\n";

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
  | "removeDestination"
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
    [MANAGED, MANAGED_PRIOR],
    [UPGRADED, UPGRADED_PRIOR],
    [EDITED, EDITED_PRIOR],
  ]);
  return {
    files,
    links: new Set(),
    inodes: new Map([
      [DESTINATION, 1],
      [LEDGER, 2],
      [CONSTITUTION, 3],
      [MANAGED, 4],
      [UPGRADED, 5],
      [EDITED, 6],
    ]),
    nextInode: 7,
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

    removeDestination: (destination): WriteOutcome => {
      const verdict = stage(ws, "removeDestination", destination);
      // A kill here happens BEFORE the unlink, exactly as the atomic-replace
      // double models a kill before the rename: the destination is untouched, and
      // the interesting crash — killed AFTER the unlink — is modelled by killing
      // at a LATER stage, where the file is genuinely gone and only the verified
      // backup can bring it back.
      if (verdict === "kill") throw new Error("killed at removeDestination");
      if (verdict === "fail") return { ok: false, diagnostic: "removal refused" };
      ws.files.delete(destination);
      ws.inodes.delete(destination);
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
  { operation: "write", destination: DESTINATION, newContent: NEW_BYTES },
];
const TWO_TARGETS: readonly ApplyTargetWrite[] = [
  { operation: "write", destination: DESTINATION, newContent: NEW_BYTES },
  { operation: "write", destination: LEDGER, newContent: LEDGER_NEW },
];
/** The WF-455 width: a configuration-only plan's full target set, registry and
 *  ledger alongside the committed project override and the composed
 *  constitution. Run through the same matrix so the widening is proved not to
 *  open a window where a kill leaves the override written and the constitution
 *  not — or, worse, the constitution half-written. */
const FOUR_TARGETS: readonly ApplyTargetWrite[] = [
  { operation: "write", destination: DESTINATION, newContent: NEW_BYTES },
  { operation: "write", destination: LEDGER, newContent: LEDGER_NEW },
  { operation: "write", destination: OVERRIDE, newContent: OVERRIDE_NEW },
  { operation: "write", destination: CONSTITUTION, newContent: CONSTITUTION_NEW },
];
/** The WF-456 width: the same four surfaces plus the pack payload. Run through
 *  the SAME matrix — extended, never rebuilt — so the five surfaces a rollback
 *  must restore (payload, ledger, registry, configuration and the composed
 *  constitution) are each proved at every kill stage rather than argued for. */
const FIVE_TARGETS: readonly ApplyTargetWrite[] = [
  ...FOUR_TARGETS,
  { operation: "write", destination: PAYLOAD, newContent: PAYLOAD_NEW },
];
/** The WF-459 width: the same five surfaces plus an artifact UPGRADE. Run through
 *  the SAME matrix — extended, never rebuilt — so the advance is proved at every
 *  kill stage rather than argued for, and so the retained `EDITED` artifact's
 *  byte-and-inode identity is asserted under the widest target set this runtime
 *  composes. */
const SIX_TARGETS: readonly ApplyTargetWrite[] = [
  ...FIVE_TARGETS,
  { operation: "write", destination: UPGRADED, newContent: UPGRADED_NEW },
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
    { operation: "write", destination: DESTINATION, newContent: NEW_BYTES },
    { operation: "write", destination: DESTINATION, newContent: PRIOR_BYTES },
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
    [UPGRADED, UPGRADED_PRIOR],
  ]);

  for (const killAt of CRASH_STAGES) {
    test(`${label}: a process killed at \`${killAt}\` restores the exact prior state, idempotently, on restart`, () => {
      const ws = newWorkspace({ killAt });
      const editedInode = ws.inodes.get(EDITED);

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

      // BYTE-IDENTITY OF THE RETAINED ARTIFACT, PROVED THE WF-454 WAY. Equal bytes
      // alone would be satisfied by an atomic replace that happened to write the
      // same content; equal INODE is what proves the file was never replaced at
      // all. Asserted at every kill stage, because a recovery that "restored" an
      // untouched file is doing something it was never asked to do.
      assert.equal(ws.files.get(EDITED), EDITED_PRIOR, `\`${EDITED}\` must be byte-identical`);
      assert.equal(
        ws.inodes.get(EDITED),
        editedInode,
        `\`${EDITED}\` must be the SAME file — a replace that reproduced its bytes is still a write`,
      );

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
crashMatrix("five targets, with the pack payload", FIVE_TARGETS);
crashMatrix("six targets, with the artifact upgrade", SIX_TARGETS);

// ---------------------------------------------------------------------------
// THE DELETION CRASH MATRIX (WF-458) — the same axis, over a target set that
// REMOVES a file
// ---------------------------------------------------------------------------
//
// EXTENDED, NEVER REBUILT. The nine-stage axis above is reused verbatim and one
// stage is added (`removeDestination`), because this is the case to test hardest:
// on every other target a crash leaves SOMETHING at the destination to compare
// against, while an interrupted removal leaves absence — and absence is
// indistinguishable from "the user deleted it themselves" unless the journal says
// otherwise. The whole `removesDestination` branch of the recovery decision exists
// for exactly this window, and these tests are what hold it honest.

const DELETION_STAGES: Stage[] = [...CRASH_STAGES, "removeDestination"];

/** A write and a removal in ONE transaction — the real shape of a deregistration
 *  that both rewrites the registry and removes the artifact it owned. The two
 *  must be all-or-nothing: a crash may never leave the registry rewritten and the
 *  file still present, nor the file removed and the registry unchanged. */
const MIXED_TARGETS: readonly ApplyTarget[] = [
  { operation: "write", destination: DESTINATION, newContent: NEW_BYTES },
  { operation: "delete", destination: MANAGED, expectedContentHash: sha256(MANAGED_PRIOR) },
];

function runMixed(ws: Workspace) {
  return applyTransaction(applyPortsFor(ws), {
    targets: MIXED_TARGETS,
    expectation: EXPECTATION,
  });
}

test("a mixed write+delete transaction applies BOTH, and reports them on separate axes", () => {
  const ws = newWorkspace();
  const result = runMixed(ws);

  assert.equal(result.status, "applied");
  assert.equal(ws.files.get(DESTINATION), NEW_BYTES);
  assert.equal(ws.files.has(MANAGED), false, "the removal actually removed the file");
  assert.deepEqual(result.written, [DESTINATION], "a removal is never reported as a write");
  assert.deepEqual(result.removed, [MANAGED]);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), [], "the verified backup is discarded on success");
  assert.equal(result.residue.clean, true);
});

for (const killAt of DELETION_STAGES) {
  test(`deletion: a process killed at \`${killAt}\` restores the removed file's EXACT prior content`, () => {
    const ws = newWorkspace({ killAt });
    assert.throws(() => runMixed(ws), /killed at/);

    const first = recoverInterruptedTransaction(recoveryPortsFor(ws));
    assert.ok(
      first.state === "recovered" || first.state === "no-journal",
      `recovery after a kill at ${killAt} must resolve, got \`${first.state}\``,
    );
    assert.equal(first.proceeded, true);

    // THE ASSERTION THIS WHOLE MATRIX EXISTS FOR: byte-exact content, not merely
    // "the path exists again". A restore that recreated an empty file, or brought
    // back another target's bytes, would satisfy a presence check and would still
    // have destroyed the user's data.
    assert.equal(
      ws.files.get(MANAGED),
      MANAGED_PRIOR,
      `a kill at ${killAt} must restore \`${MANAGED}\` byte-for-byte`,
    );
    assert.equal(
      ws.files.get(DESTINATION),
      PRIOR_BYTES,
      `a kill at ${killAt} must also restore the co-target — the transaction is all-or-nothing`,
    );
    assert.equal(ws.journal, null, "no journal survives a resolved recovery");
    assert.deepEqual(backupsIn(ws), [], "no backup survives a resolved recovery");

    // IDEMPOTENT: a second restart converges rather than re-restoring or refusing.
    const second = recoverInterruptedTransaction(recoveryPortsFor(ws));
    assert.equal(second.state, "no-journal");
    assert.equal(second.proceeded, true);
    assert.equal(ws.files.get(MANAGED), MANAGED_PRIOR);
    assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  });
}

test("deletion: a kill at `discardTransaction` leaves the removal DURABLY COMPLETE", () => {
  // The one stage whose correct outcome is the NEW state. The journal goes first,
  // so the instant it is gone the removal is complete — and a restart must not
  // resurrect the file it deliberately removed.
  const ws = newWorkspace({ killAt: "discardTransaction" });
  assert.throws(() => runMixed(ws), /killed at/);

  assert.equal(ws.files.has(MANAGED), false, "the removal survives the kill");
  assert.equal(ws.files.get(DESTINATION), NEW_BYTES);
  assert.equal(ws.journal, null, "the journal was discarded FIRST");

  const recovery = recoverInterruptedTransaction(recoveryPortsFor(ws));
  assert.equal(recovery.state, "no-journal");
  assert.equal(
    ws.files.has(MANAGED),
    false,
    "a restart must never undo a durably-completed removal",
  );
});

test("deletion: a kill mid-transaction followed by recovery lets a RE-RUN remove cleanly", () => {
  const ws = newWorkspace({ killAt: "removeDestination" });
  assert.throws(() => runMixed(ws), /killed at/);
  recoverInterruptedTransaction(recoveryPortsFor(ws));
  assert.equal(ws.files.get(MANAGED), MANAGED_PRIOR, "recovered before the re-run");

  ws.killAt = null;
  ws.log = [];
  ws.observed = new Set();
  const result = runMixed(ws);
  assert.equal(result.status, "applied");
  assert.deepEqual(result.removed, [MANAGED]);
  assert.equal(ws.files.has(MANAGED), false);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
});

test("deletion: an ordinary removal FAILURE rolls the whole transaction back", () => {
  // Not a kill — a port that returns `{ ok: false }`. The write half has already
  // landed by then, so this is the case where rollback must undo a SUCCEEDED
  // sibling target rather than merely abandon an unstarted one.
  const ws = newWorkspace({ failAt: "removeDestination" });
  const result = runMixed(ws);

  assert.notEqual(result.status, "applied");
  assert.equal(ws.files.get(MANAGED), MANAGED_PRIOR, "the file was never removed");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES, "the sibling write was rolled back");
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
});

test("deletion: a removal over an ABSENT destination is refused BEFORE any journal", () => {
  // A target that changes nothing is not a target (WF-454 defect class B), and
  // "already gone" is not the same fact as "removed by this transaction".
  const ws = newWorkspace();
  ws.files.delete(MANAGED);
  const result = runMixed(ws);

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/precondition-moved");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES, "nothing was written either");
  assert.equal(ws.journal, null, "no journal was created");
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
});

test("deletion: a removal over a SYMLINK is refused before any journal", () => {
  const ws = newWorkspace();
  ws.links.add(MANAGED);
  const result = runMixed(ws);

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/destination-symlink");
  assert.equal(ws.journal, null);
});

test("deletion: bytes that MOVED since the gate proved them refuse before any journal", () => {
  // The identity re-proof. The path is the same, the file is still a regular
  // file, and its content is not what the removal was authorized over — so it is
  // not the file that was authorized, and the transaction never opens.
  const ws = newWorkspace();
  ws.files.set(MANAGED, "someone edited this between the decision and the entry\n");
  const result = runMixed(ws);

  assert.equal(result.status, "rejected");
  assert.equal(result.reason, "apply/precondition-moved");
  assert.match(result.diagnostics[0]?.message ?? "", /no longer holds the bytes/);
  assert.equal(ws.files.has(MANAGED), true, "the edited file is untouched");
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
});

test("deletion: a failing self-check rolls the removal back too", () => {
  // The removal has already happened when the self-check runs, so this proves the
  // rollback restores an ABSENT destination from its backup — the path a
  // write-only rollback never exercises.
  const ws = newWorkspace({ selfCheck: { ok: false, diagnostic: "capability did not resolve" } });
  const result = runMixed(ws);

  assert.notEqual(result.status, "applied");
  assert.equal(result.selfCheck, "failed");
  assert.equal(ws.files.get(MANAGED), MANAGED_PRIOR, "the removed file came back, byte-exact");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
});

test("SC-5: a rolled-back payload transaction restores ALL FIVE surfaces, leaving no residue", () => {
  // The five surfaces named as five, at the point of failure rather than in the
  // happy path: payload, ledger, registry, configuration and snapshot. The
  // registry IS the configuration file here (`_local/config.md`), and the
  // "snapshot" surface is the composed constitution the resolver derives from
  // the final capability set — the one whose loss no backup elsewhere covers.
  const ws = newWorkspace({ selfCheck: { ok: false, diagnostic: "beta did not resolve" } });
  const result = applyTransaction(applyPortsFor(ws), {
    targets: FIVE_TARGETS,
    expectation: EXPECTATION,
  });

  assert.equal(result.status, "rolled-back");
  assert.equal(result.selfCheck, "failed");

  // Created targets are REMOVED, not left holding their new bytes.
  assert.equal(ws.files.get(PAYLOAD), undefined, "the payload is removed, not left behind");
  assert.equal(ws.files.get(OVERRIDE), undefined, "the override is removed, not left behind");
  // Replaced targets are restored byte-for-byte.
  assert.equal(ws.files.get(LEDGER), LEDGER_PRIOR, "the ledger is restored exactly");
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES, "the registry/config is restored exactly");
  assert.equal(ws.files.get(CONSTITUTION), CONSTITUTION_PRIOR, "the constitution is restored exactly");

  assert.equal(ws.journal, null, "no journal survives the rollback");
  assert.deepEqual(backupsIn(ws), [], "no backup survives the rollback");
  assert.equal(result.residue.clean, true);
});

test("SC-5b: the payload and its ownership record are written under ONE journal, or not at all", () => {
  // The property the five-surface rule exists to protect. The payload is the LAST
  // target written, so at the moment it fails the ledger's ownership record is
  // ALREADY on disk — and must come back off. Recording ownership of a file that
  // was never installed is the specific inconsistency a per-target write loop
  // would produce, and the reason both belong to one transaction.
  const ws = newWorkspace({ failAt: "atomicReplace", failFor: PAYLOAD });
  const result = runTargets(ws, FIVE_TARGETS);

  assert.equal(result.status, "rolled-back");
  assert.equal(ws.files.get(PAYLOAD), undefined);
  assert.equal(
    ws.files.get(LEDGER),
    LEDGER_PRIOR,
    "no ownership record survives an uninstalled payload",
  );
  assert.equal(ws.files.get(DESTINATION), PRIOR_BYTES);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
});

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

// ---------------------------------------------------------------------------
// THE UPGRADE WRITE HALF (WF-459)
// ---------------------------------------------------------------------------
//
// The advance and the evidence repair both compose ORDINARY write targets, so the
// stage machinery above already covers them — which is exactly why the matrix is
// EXTENDED rather than rebuilt. What is asserted here is the handful of properties
// that are specific to replacing a file a user can already see, and every one of
// them is about a failure mode a "did it apply?" check would miss.

test("the upgraded artifact and its ownership record land under ONE journal, or not at all", () => {
  // The property that makes an upgrade atomic. The advance is the LAST target
  // written, so at the moment it fails the ledger's NEW ownership record is
  // already on disk — and must come back off. A surviving new record over the
  // prior bytes reads as `edited` on the very next run, which is the stuck state
  // this transaction boundary exists to prevent.
  const ws = newWorkspace({ failAt: "atomicReplace", failFor: UPGRADED });
  const result = runTargets(ws, SIX_TARGETS);

  assert.equal(result.status, "rolled-back");
  assert.equal(ws.files.get(UPGRADED), UPGRADED_PRIOR, "the artifact keeps its prior bytes");
  assert.equal(
    ws.files.get(LEDGER),
    LEDGER_PRIOR,
    "no post-upgrade ownership record survives an upgrade that did not land",
  );
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
});

test("a rolled-back upgrade never DELETES the artifact — restoration is content, not absence", () => {
  // The failure mode that separates the constructive arm from the destructive one.
  // A rollback implemented as "undo the write" by removing the file would satisfy
  // every "the new bytes are gone" assertion and would have destroyed the user's
  // artifact. Presence is asserted before content, so a failure names the right
  // defect.
  const ws = newWorkspace({ selfCheck: { ok: false, diagnostic: "beta did not resolve" } });
  const result = runTargets(ws, SIX_TARGETS);

  assert.equal(result.status, "rolled-back");
  assert.equal(result.selfCheck, "failed");
  assert.equal(ws.files.has(UPGRADED), true, "the artifact is still THERE");
  assert.equal(ws.files.get(UPGRADED), UPGRADED_PRIOR, "...and holds its exact prior bytes");
  assert.equal(ws.files.has(MANAGED), true, "an unnamed managed artifact is untouched");
  assert.equal(ws.files.get(EDITED), EDITED_PRIOR);
  assert.deepEqual(result.removed, [], "an upgrade transaction removes nothing at all");
  assert.equal(result.residue.clean, true);
});

test("EVERY stage of an upgrade rolls back without deleting, at every failure point", () => {
  // The deletion-free property proved across the whole axis rather than at one
  // convenient stage — the same "one test per rule" discipline the preservation
  // classes get, applied to the stages a new write path introduces.
  // `recheck` is deliberately absent: a re-observation cannot "fail", it can only
  // find the world moved — which is its own test below, because its correct
  // outcome is a PRESERVED edit and a retained journal rather than a clean
  // rollback.
  for (const failAt of ["writeBackup", "hashBackup", "atomicReplace"] as const) {
    const ws = newWorkspace({ failAt, failFor: UPGRADED });
    const result = runTargets(ws, SIX_TARGETS);

    assert.notEqual(result.status, "applied", `\`${failAt}\` must not report success`);
    assert.equal(ws.files.has(UPGRADED), true, `\`${failAt}\` must not delete the artifact`);
    assert.equal(
      ws.files.get(UPGRADED),
      UPGRADED_PRIOR,
      `\`${failAt}\` must restore the exact prior bytes`,
    );
    assert.equal(ws.files.get(LEDGER), LEDGER_PRIOR, `\`${failAt}\` must restore the ledger`);
    assert.deepEqual(result.removed, [], `\`${failAt}\` must remove nothing`);
    assert.equal(ws.journal, null);
    assert.deepEqual(backupsIn(ws), []);
  }
});

test("an artifact EDITED between the check and the write is preserved, and the upgrade refuses", () => {
  // The narrowest window in the whole item: the gate proved the bytes matched the
  // ledger, and the user saved the file a moment later. S6 re-observes without
  // following links and refuses, so the edit survives and no journal is created.
  const ws = newWorkspace({
    recheckFor: UPGRADED,
    beforeRecheck: () => {
      ws.files.set(UPGRADED, "# upgraded\n\nSaved by hand a moment ago.\n");
      ws.inodes.set(UPGRADED, ws.nextInode++);
    },
  });
  const result = runTargets(ws, SIX_TARGETS);

  assert.notEqual(result.status, "applied");
  assert.equal(
    ws.files.get(UPGRADED),
    "# upgraded\n\nSaved by hand a moment ago.\n",
    "the hand edit survives untouched — an upgrade never wins a race against the user",
  );
  assert.ok(result.diagnostics.some((d) => d.code === "apply/precondition-moved"));
  // NO SUCCESS IS CLAIMED OVER PRESERVED WORK. The frozen recovery decision
  // preserves the concurrent edit rather than clobbering it, so the rollback is
  // deliberately INCOMPLETE and says so — journal and backups retained, residue
  // not clean. An upgrade that reported a tidy rollback here would be claiming it
  // had put the world back, over a file it correctly refused to touch.
  assert.equal(result.reason, "apply/rollback-incomplete");
  assert.ok((result.rollback?.preserved.length ?? 0) > 0);
  assert.equal(result.residue.clean, false);
  assert.equal(ws.files.has(UPGRADED), true, "and the artifact is still there");
});

test("a six-target upgrade applies, and the RETAINED artifact is the same file down to its inode", () => {
  const ws = newWorkspace();
  const editedInode = ws.inodes.get(EDITED);
  const result = runTargets(ws, SIX_TARGETS);

  assert.equal(result.status, "applied");
  assert.equal(ws.files.get(UPGRADED), UPGRADED_NEW);
  assert.ok(result.written.includes(UPGRADED));
  assert.deepEqual(result.removed, []);
  // The point of the whole slice, on the SUCCESS path: a run that upgraded one
  // artifact left the edited one entirely alone. Bytes AND inode, because an
  // atomic replace that reproduced the same content would pass a bytes-only check
  // while having rewritten a file nobody authorized it to touch.
  assert.equal(ws.files.get(EDITED), EDITED_PRIOR);
  assert.equal(ws.inodes.get(EDITED), editedInode);
  assert.equal(ws.journal, null);
  assert.deepEqual(backupsIn(ws), []);
  assert.equal(result.residue.clean, true);
});
