// wf resolver — the journaled apply transaction driver (WF-453).
//
// The WRITE half of the first public mutator. Every filesystem effect it needs
// is declared on `ApplyPorts` and injected, so the whole driver — journal
// lifetime, backup proof, the TOCTOU re-observation, the atomic replacement, the
// self-check, the guarded rollback, and durable completion — is exercised in
// tests against in-memory doubles, with a separate real-filesystem suite proving
// the production ports honour the same contract. That is the discipline
// `lifecycle-recovery.ts` (WF-451) holds, and it is inherited here deliberately.
//
// THE LOCK IS NOT THIS MODULE'S. The caller acquires the exclusive lifecycle lock
// before entering and releases it on every exit path, because the lock must also
// cover the plan recomputation that decides whether to enter at all. A driver
// that took its own lock would either deadlock against the caller's or leave a
// window between revalidation and mutation — the exact window rule 2 of
// `apply-install.ts` exists to close.
//
// THE STAGE ORDER IS THE CONTRACT. Each stage is chosen so that a process killed
// at ANY point leaves a state the frozen recovery protocol restores exactly, and
// restores idempotently on re-entry:
//
//   S1  caller holds the lock
//   S2  observe the destination, no-follow (type, inode, size, content hash)
//   S3  compute the new bytes and their identity UP FRONT
//   S4  write the journal, with `lastWritten` ALREADY recorded
//   S5  write the backup, then prove its bytes reproduce the recorded prior hash
//   S6  re-observe the destination and compare against S2 (the TOCTOU guard)
//   S7  atomic replacement — sibling temp file, then rename over the destination
//   S8  refresh, persist the snapshot, self-check
//   S9  durable completion — discard the JOURNAL FIRST, then the backups
//
// WHY THE JOURNAL PRECEDES THE BACKUP (S4 before S5). The inverse order has a
// window in which a backup exists with no journal naming it: orphan bytes nothing
// will ever reclaim. With journal-first, a kill before the destination is touched
// leaves the destination at its prior state, which `decideEntryRecovery` resolves
// at step 4 — the idempotence guard, checked BEFORE the ownership test — as
// `already-prior-content`. The journal is then discarded and the named backup
// removed even if it was never created; `discardJournal` tolerates absence.
//
// WHY `lastWritten` IS PRE-RECORDED (S3 into S4). Recording it only after the
// write leaves a window in which the destination holds the new bytes while the
// journal still says `lastWritten: null`. Recovery's step 5 would then classify
// this transaction's OWN write as an `external-edit` and PRESERVE it — leaving
// the workspace mutated, the journal retained, and no path back. Pre-recording is
// sound because the new bytes are computed deterministically before any write,
// and it is safe because the atomic replacement guarantees the destination is
// never in a third state.
//
// WHY COMPLETION DISCARDS THE JOURNAL FIRST (S9). Recovery's own `discardJournal`
// removes backups first, which is safe at ITS call site because every destination
// is already back at its prior state, so a re-entry re-resolves through step 4.
// At THIS call site the destination is at its NEW state, so a kill between
// "backups removed" and "journal removed" would leave a journal demanding a
// restore from a backup that no longer exists — permanently unresolved. Apply
// therefore owns its own journal-first completion and does not change WF-451's.

import {
  createJournalEntry,
  createLastWrittenIdentity,
  createTransactionJournal,
  type DestinationObservation,
} from "./lifecycle-journal.js";
import {
  recoverInterruptedTransaction,
  type BackupIdentity,
  type RecoveryPorts,
  type WriteOutcome,
} from "./lifecycle-recovery.js";
import type {
  ApplyReason,
  ApplyResidueReport,
  ApplyRollbackReport,
  DiscoveryIssue,
  JournalEntry,
  TransactionJournal,
} from "./types.js";

/** What the self-check must observe once the snapshot has been rebuilt. Stated
 *  as the intended END STATE rather than as "the actions succeeded", so a write
 *  that landed but did not take effect is still a failure. */
export interface SelfCheckExpectation {
  /** Capability names that must now resolve with `ok` validity. */
  present: readonly string[];
  /** Capability names that must now be absent from the resolved registry. */
  absent: readonly string[];
}

export type SelfCheckOutcome = { ok: true } | { ok: false; diagnostic: string };

/**
 * Every filesystem effect the transaction needs, and nothing else.
 *
 * Deliberately WITHOUT `acquireLock` / `releaseLock`: the lock belongs to the
 * caller (see the module header). `rollbackPorts` supplies the frozen WF-451
 * `RecoveryPorts` so the guarded rollback runs that driver VERBATIM rather than
 * re-implementing its six guards.
 */
export interface ApplyPorts {
  /** The workspace-relative destination this transaction mutates. */
  destination: string;
  /** The workspace-relative backup path for one transaction. Nested per
   *  transaction so two transactions can never collide on one backup file. */
  backupPathFor(transactionId: string): string;
  /** A fresh transaction id, and the moment it started. */
  newTransactionId(): string;
  now(): string;
  /** `true` when a transaction journal exists on disk. */
  journalPresent(): boolean;
  /** `true` when any backup bytes remain on disk. */
  backupsPresent(): boolean;
  /** Observe the destination now: containment, existence, link-ness, and bytes.
   *  Must test containment WITHOUT creating the path, and must NOT follow a
   *  terminal symlink (WF-448 / WF-451). */
  observeDestination(): DestinationObservation;
  /** The destination's inode now, or `null` when it does not exist or cannot be
   *  stat'd. Read with `lstat` — NEVER followed.
   *
   *  Kept a SEPARATE port rather than widened into `DestinationObservation`,
   *  because that observation is WF-451's frozen shape and this item consumes the
   *  recovery protocol unchanged. The inode completes the no-follow triple
   *  (inode / type / hash): type and hash catch a swap that changes what the path
   *  holds, and the inode catches a swap that preserves the bytes while changing
   *  WHICH file the directory entry names. */
  destinationInode(): number | null;
  /** The identity the destination would have after being written with `content`.
   *  Pure — no IO. */
  identify(content: string): { contentHash: string; bytes: number };
  /** Persist the journal. */
  writeJournal(journal: TransactionJournal): WriteOutcome;
  /** Copy the destination's CURRENT bytes to the backup path. */
  writeBackup(backupPath: string): WriteOutcome;
  /** Hash one backup's current bytes. */
  hashBackup(backupPath: string): BackupIdentity;
  /** Replace the destination ATOMICALLY: a create-exclusive sibling temp file,
   *  durably flushed, then renamed over the destination. Never a partial write. */
  atomicReplace(content: string): WriteOutcome;
  /** Rebuild + persist the snapshot, then check the intended end state. */
  refreshAndSelfCheck(expectation: SelfCheckExpectation): SelfCheckOutcome;
  /** Durable completion: remove the JOURNAL FIRST, then the named backups, then
   *  prune the emptied backup directories. Called only on a complete success. */
  discardTransaction(entries: readonly JournalEntry[]): void;
  /** The frozen recovery ports, for the guarded rollback façade. */
  rollbackPorts(): RecoveryPorts;
}

export interface ApplyTransactionInput {
  /** The exact bytes the registry will hold. Computed before entry. */
  newContent: string;
  expectation: SelfCheckExpectation;
}

export interface ApplyTransactionResult {
  status: "applied" | "rejected" | "rolled-back";
  reason: ApplyReason | null;
  /** `null` exactly when no journal was created — the observable boundary
   *  between "refused before a transaction" and "a transaction existed". */
  transactionId: string | null;
  rollback: ApplyRollbackReport | null;
  selfCheck: "ok" | "failed" | "skipped";
  refreshed: boolean;
  residue: ApplyResidueReport;
  diagnostics: DiscoveryIssue[];
}

function issue(code: string, message: string): DiscoveryIssue {
  return { code, message };
}

function rejected(
  reason: ApplyReason,
  message: string,
  residue: ApplyResidueReport,
): ApplyTransactionResult {
  return {
    status: "rejected",
    reason,
    transactionId: null,
    rollback: null,
    selfCheck: "skipped",
    refreshed: false,
    residue,
    diagnostics: [issue(reason, message)],
  };
}

/** The residue statement for a run that created no transaction state at all. */
function noTransactionResidue(): ApplyResidueReport {
  return {
    clean: true,
    journalRetained: false,
    backupsRetained: false,
    detail: "no journal and no backup were created; nothing was left behind.",
  };
}

function residueFrom(ports: ApplyPorts, detail: string): ApplyResidueReport {
  const journalRetained = ports.journalPresent();
  const backupsRetained = ports.backupsPresent();
  return {
    clean: !journalRetained && !backupsRetained,
    journalRetained,
    backupsRetained,
    detail,
  };
}

/**
 * Run the guarded rollback over THIS transaction's own journal.
 *
 * Reuses WF-451's `recoverInterruptedTransaction` VERBATIM through a lock-neutral
 * façade, because the caller already holds the exclusive lock and the frozen
 * driver would otherwise refuse its own re-entry as `held-by-other`. Every guard
 * therefore composes unchanged: containment → observability → symlink-preserve →
 * idempotence → ownership → verified backup. An external edit or a symlink
 * swapped in between check and write is PRESERVED, never clobbered.
 *
 * The façade is the whole adaptation. Not one guard, disposition, reason, or
 * ordering is altered, and `lifecycle-journal.ts` / `lifecycle-recovery.ts` are
 * not touched at all.
 */
function rollback(ports: ApplyPorts): ApplyRollbackReport {
  const real = ports.rollbackPorts();
  const lockNeutral: RecoveryPorts = {
    ...real,
    acquireLock: () => ({ ok: true }),
    releaseLock: () => {
      /* the caller owns the lock for the whole transaction */
    },
  };
  const report = recoverInterruptedTransaction(lockNeutral);
  return {
    complete: report.state === "recovered" || report.state === "no-journal",
    restored: report.restored,
    alreadyRestored: report.alreadyRestored,
    preserved: report.preserved,
    unresolved: report.unresolved,
  };
}

/** Fail after the journal exists: roll back, then report the ORIGINAL cause —
 *  unless the rollback itself left work outstanding, in which case the
 *  outstanding work is the more urgent story and no success is claimed. */
function failAfterJournal(
  ports: ApplyPorts,
  transactionId: string,
  reason: ApplyReason,
  message: string,
  selfCheck: ApplyTransactionResult["selfCheck"],
  refreshed: boolean,
): ApplyTransactionResult {
  const report = rollback(ports);
  const diagnostics = [issue(reason, message)];
  if (!report.complete) {
    diagnostics.push(
      issue(
        "apply/rollback-incomplete",
        `rollback left ${report.preserved.length} destination(s) preserved and ${report.unresolved.length} unresolved; the journal is retained and no success is claimed.`,
      ),
    );
  }
  return {
    status: "rolled-back",
    reason: report.complete ? reason : "apply/rollback-incomplete",
    transactionId,
    rollback: report,
    selfCheck,
    refreshed,
    residue: residueFrom(
      ports,
      report.complete
        ? "the transaction was rolled back and its journal and backups were discarded."
        : "the transaction could not be fully rolled back; its journal is retained so a later run re-observes and converges.",
    ),
    diagnostics,
  };
}

/**
 * Apply one exact registry-only mutation as a journaled transaction.
 *
 * The caller MUST already hold the exclusive lifecycle lock, MUST already have
 * revalidated the plan (`decideApplyGate`), and MUST have computed `newContent`
 * from the screened actions. This driver decides nothing about the plan; it owns
 * only the transaction.
 *
 * A throw from a port is NOT caught here. That is deliberate and mirrors
 * `runUnderLock`: the caller classifies it, and a genuinely killed process leaves
 * exactly the on-disk state of the stage it died in — which the stage ordering
 * above guarantees is recoverable.
 */
export function applyTransaction(
  ports: ApplyPorts,
  input: ApplyTransactionInput,
): ApplyTransactionResult {
  // --- S2: observe the destination, no-follow -------------------------------
  const observed = ports.observeDestination();
  const observedInode = ports.destinationInode();

  if (observed.kind === "not-contained") {
    return rejected(
      "apply/registry-unresolvable",
      `\`${ports.destination}\` does not resolve to a workspace-contained target (${observed.rejection}); nothing was journalled and nothing was written.`,
      noTransactionResidue(),
    );
  }
  if (observed.kind === "observation-failed") {
    return rejected(
      "apply/registry-unresolvable",
      `\`${ports.destination}\` could not be observed: ${observed.diagnostic}`,
      noTransactionResidue(),
    );
  }
  if (observed.kind === "symlink") {
    // Refused BEFORE a journal. A transaction over a link could never be rolled
    // back either: recovery never follows, replaces, or removes one.
    return rejected(
      "apply/destination-symlink",
      `\`${ports.destination}\` is a symbolic link; this mutator never writes through a link, so no journal was created and nothing was written.`,
      noTransactionResidue(),
    );
  }

  // --- S3: compute the identity of what will be written, UP FRONT -----------
  const willWrite = createLastWrittenIdentity(ports.identify(input.newContent));
  if (willWrite === null) {
    return rejected(
      "apply/registry-unresolvable",
      "the bytes to be written could not be identified deterministically; nothing was journalled and nothing was written.",
      noTransactionResidue(),
    );
  }

  const transactionId = ports.newTransactionId();
  const backupPath = observed.kind === "file" ? ports.backupPathFor(transactionId) : null;

  const entry = createJournalEntry({
    destination: ports.destination,
    priorExistence: observed.kind === "file" ? "present" : "absent",
    priorContentHash: observed.kind === "file" ? observed.contentHash : null,
    priorIsSymlink: false,
    backupPath,
    lastWritten: willWrite,
  });
  if (entry === null) {
    return rejected(
      "apply/registry-unresolvable",
      "the transaction journal entry for the registry destination is incomplete or self-contradictory; nothing was journalled and nothing was written.",
      noTransactionResidue(),
    );
  }

  const journal = createTransactionJournal({
    transactionId,
    startedAt: ports.now(),
    entries: [entry],
  });
  if (journal === null) {
    return rejected(
      "apply/registry-unresolvable",
      "the transaction journal could not be constructed; nothing was journalled and nothing was written.",
      noTransactionResidue(),
    );
  }

  // --- S4: write the journal ------------------------------------------------
  const journalled = ports.writeJournal(journal);
  if (!journalled.ok) {
    // The journal did not land, so no transaction exists and there is nothing to
    // roll back. A partial journal file is not possible: the port writes it
    // atomically for the same reason the destination is written atomically.
    return rejected(
      "apply/write-failed",
      `the transaction journal could not be written: ${journalled.diagnostic}`,
      residueFrom(ports, "the transaction journal could not be written."),
    );
  }

  // --- S5: back the prior bytes up, and PROVE the backup ---------------------
  if (backupPath !== null) {
    const backed = ports.writeBackup(backupPath);
    if (!backed.ok) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/backup-failed",
        `the prior bytes of \`${ports.destination}\` could not be backed up: ${backed.diagnostic}`,
        "skipped",
        false,
      );
    }
    // Proving the backup BEFORE the write, not only at restore time. A backup
    // that cannot reproduce the recorded prior hash is authority to write
    // nothing, so discovering that after the destination is already replaced
    // would be discovering it too late.
    const proof = ports.hashBackup(backupPath);
    if (!proof.ok) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/backup-failed",
        `the backup of \`${ports.destination}\` could not be verified (${proof.reason}): ${proof.diagnostic}`,
        "skipped",
        false,
      );
    }
    if (proof.contentHash !== entry.priorContentHash) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/backup-failed",
        `the backup of \`${ports.destination}\` does not reproduce its recorded prior bytes; nothing was written.`,
        "skipped",
        false,
      );
    }
  }

  // --- S6: the TOCTOU guard -------------------------------------------------
  // Re-observe and compare against S2. A symlink swapped in, a file replaced, or
  // a type change between check and write all land here, and all refuse — the
  // write must land on the thing that was validated, not on whatever now occupies
  // the path.
  const recheck = ports.observeDestination();
  const recheckInode = ports.destinationInode();
  if (!sameObservation(observed, recheck)) {
    return failAfterJournal(
      ports,
      transactionId,
      "apply/precondition-moved",
      `\`${ports.destination}\` changed between the observation this transaction recorded and the write (${describe(observed)} → ${describe(recheck)}); nothing was written.`,
      "skipped",
      false,
    );
  }
  if (observedInode !== recheckInode) {
    return failAfterJournal(
      ports,
      transactionId,
      "apply/precondition-moved",
      `\`${ports.destination}\` names a different file than the one this transaction validated (inode ${String(observedInode)} → ${String(recheckInode)}); nothing was written.`,
      "skipped",
      false,
    );
  }

  // --- S7: atomic replacement -----------------------------------------------
  const written = ports.atomicReplace(input.newContent);
  if (!written.ok) {
    return failAfterJournal(
      ports,
      transactionId,
      "apply/write-failed",
      `\`${ports.destination}\` could not be replaced: ${written.diagnostic}`,
      "skipped",
      false,
    );
  }

  // --- S8: refresh, persist the snapshot, self-check -------------------------
  // A FAILED SELF-CHECK IS TRANSACTION FAILURE. There is deliberately no
  // "succeeded but the self-check complained" result shape.
  const checked = ports.refreshAndSelfCheck(input.expectation);
  if (!checked.ok) {
    return failAfterJournal(
      ports,
      transactionId,
      "apply/self-check-failed",
      `the registry was written but the self-check did not confirm the intended state: ${checked.diagnostic}`,
      "failed",
      true,
    );
  }

  // --- S9: durable completion ----------------------------------------------
  ports.discardTransaction(journal.entries);

  return {
    status: "applied",
    reason: null,
    transactionId,
    rollback: null,
    selfCheck: "ok",
    refreshed: true,
    residue: residueFrom(
      ports,
      "the transaction completed durably: the journal was discarded first, then its backups, then the emptied backup directories were pruned.",
    ),
    diagnostics: [],
  };
}

/** Whether two observations describe the same destination state. Compares the
 *  discriminant AND the bytes — a same-size, same-type replacement with different
 *  content is exactly the swap this guard exists to catch. */
function sameObservation(
  left: DestinationObservation,
  right: DestinationObservation,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "file" && right.kind === "file") {
    return left.contentHash === right.contentHash && left.bytes === right.bytes;
  }
  return left.kind === "absent" && right.kind === "absent";
}

function describe(observation: DestinationObservation): string {
  switch (observation.kind) {
    case "file":
      return `file sha256 ${observation.contentHash}`;
    case "absent":
      return "absent";
    case "symlink":
      return "symbolic link";
    case "not-contained":
      return `not contained (${observation.rejection})`;
    default:
      return "unobservable";
  }
}
