// wf resolver — the journaled apply transaction driver (WF-453, widened WF-454).
//
// The WRITE half of the sole public mutator. Every filesystem effect it needs
// is declared on `ApplyPorts` and injected, so the whole driver — journal
// lifetime, backup proof, the TOCTOU re-observation, the atomic replacement, the
// self-check, the guarded rollback, and durable completion — is exercised in
// tests against in-memory doubles, with a separate real-filesystem suite proving
// the production ports honour the same contract. That is the discipline
// `lifecycle-recovery.ts` (WF-451) holds, and it is inherited here deliberately.
//
// WF-454 WIDENS THE DRIVER FROM ONE DESTINATION TO AN ORDERED SET, and changes
// nothing else. One registration's registry rows, its lifecycle evidence, and its
// approved project answers are a SINGLE fact that must become durable together;
// applying them as three transactions would mean three windows in which a kill
// leaves the workspace internally inconsistent. So the stage list below is
// unchanged and every per-destination stage simply became a loop over the target
// set, under ONE journal carrying N entries. WF-451's recovery driver already
// restores an N-entry journal, so the guarded rollback composes untouched.
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
//   S2  observe EVERY destination, no-follow (type, inode, size, content hash)
//   S3  compute the new bytes and their identity UP FRONT, for every target
//   S4  write the ONE journal, with every `lastWritten` ALREADY recorded
//   S5  back EVERY target up, then prove each backup reproduces its prior hash
//   S6  re-observe EVERY destination and compare against S2 (the TOCTOU guard)
//   S7  atomic replacement of every target, in the caller's canonical order
//   S8  refresh, persist the snapshot, self-check
//   S9  durable completion — discard the JOURNAL FIRST, then the backups
//
// WHY EVERY TARGET IS OBSERVED, JOURNALLED, AND BACKED UP BEFORE ANY IS WRITTEN
// (S2–S5 complete before S7 begins). This is the multi-target restatement of the
// item's sharpest rule: a plan is never partially interpreted. If target 2 turned
// out to be a symlink only after target 1 had been replaced, the run would have
// mutated part of the workspace and then failed — recoverable, but only because
// the journal happens to exist. Refusing before ANY write is strictly stronger,
// and it is free: every precondition is knowable up front.
//
// WHY THE JOURNAL PRECEDES THE BACKUPS (S4 before S5). The inverse order has a
// window in which a backup exists with no journal naming it: orphan bytes nothing
// will ever reclaim. With journal-first, a kill before any destination is touched
// leaves every destination at its prior state, which `decideEntryRecovery`
// resolves at step 4 — the idempotence guard, checked BEFORE the ownership test —
// as `already-prior-content`. The journal is then discarded and the named backups
// removed even if they were never created; `discardJournal` tolerates absence.
//
// WHY `lastWritten` IS PRE-RECORDED (S3 into S4). Recording it only after the
// write leaves a window in which a destination holds the new bytes while the
// journal still says `lastWritten: null`. Recovery's step 5 would then classify
// this transaction's OWN write as an `external-edit` and PRESERVE it — leaving
// the workspace mutated, the journal retained, and no path back. Pre-recording is
// sound because the new bytes are computed deterministically before any write,
// and it is safe because the atomic replacement guarantees no destination is ever
// in a third state.
//
// WHY COMPLETION DISCARDS THE JOURNAL FIRST (S9). Recovery's own `discardJournal`
// removes backups first, which is safe at ITS call site because every destination
// is already back at its prior state, so a re-entry re-resolves through step 4.
// At THIS call site the destinations are at their NEW state, so a kill between
// "backups removed" and "journal removed" would leave a journal demanding a
// restore from backups that no longer exist — permanently unresolved. Apply
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

/** One destination this transaction replaces, and the exact bytes it will hold.
 *
 *  The caller computes the bytes; the driver never renders content. That split is
 *  what lets the whole multi-target transaction be tested with no filesystem and
 *  no knowledge of what a registry row or a ledger entry looks like. */
export interface ApplyTargetWrite {
  /** The workspace-relative destination. */
  destination: string;
  /** The exact bytes it will hold. Computed before entry. */
  newContent: string;
}

/** What the self-check must observe once the snapshot has been rebuilt. Stated
 *  as the intended END STATE rather than as "the actions succeeded", so a write
 *  that landed but did not take effect is still a failure. */
export interface SelfCheckExpectation {
  /** Capability names that must now resolve with `ok` validity. */
  present: readonly string[];
  /** Capability names that must now be absent from the resolved registry. */
  absent: readonly string[];
  /** Packs whose PORTABLE evidence must now read back from the ledger (WF-454). */
  portableRecorded: readonly string[];
  /** Packs whose MACHINE BINDING must now read back from the ledger (WF-454). */
  bindingRecorded: readonly string[];
  /** Project answers that must now resolve from the capability profile (WF-454).
   *  Checked as capability + declared destination, never as a value, so the
   *  check cannot pass by asserting a value it just wrote from memory. */
  answersRecorded: readonly { capability: string; destination: string }[];
  /** Committed project overrides that must now hold the APPROVED source bytes
   *  (WF-455). Carries the digest the plan approved rather than the content this
   *  run happened to compute, so the check is against an independently-derived
   *  fact and cannot pass by comparing memory with itself. */
  overridesRecorded: readonly { destination: string; sha256: string }[];
  /** Pack payloads that must now hold the APPROVED source bytes AND read back
   *  from the ledger's `artifacts` section with their COMPLETE owner set
   *  (WF-456).
   *
   *  The owner set is carried here rather than re-derived at check time for the
   *  same reason the override digest is: it is an independently-derived fact
   *  bound by the approved plan, so the check compares disk against the approval
   *  rather than memory against itself. Recording a partial owner set is a
   *  defect and not merely untidy — a later removal decision reads this set to
   *  decide exclusivity, so an omitted owner would license a deletion the
   *  remaining owner never agreed to. */
  payloadsRecorded: readonly {
    destination: string;
    sha256: string;
    owners: readonly { pluginId: string; capability: string; source: string }[];
  }[];
  /** `true` when the composed constitution was recomposed by this transaction
   *  (WF-455). The check asserts the record reads back AND that the project's own
   *  clause section survived — the one property whose loss is unrecoverable. */
  constitutionRecomposed: boolean;
}

/** The empty expectation. Exported so a caller widening only one axis does not
 *  have to spell out the others, and so adding an axis later cannot silently
 *  weaken an existing caller's check. */
export function emptySelfCheckExpectation(): SelfCheckExpectation {
  return {
    present: [],
    absent: [],
    portableRecorded: [],
    bindingRecorded: [],
    answersRecorded: [],
    overridesRecorded: [],
    payloadsRecorded: [],
    constitutionRecomposed: false,
  };
}

export type SelfCheckOutcome = { ok: true } | { ok: false; diagnostic: string };

/**
 * Every filesystem effect the transaction needs, and nothing else.
 *
 * Deliberately WITHOUT `acquireLock` / `releaseLock`: the lock belongs to the
 * caller (see the module header). `rollbackPorts` supplies the frozen WF-451
 * `RecoveryPorts` so the guarded rollback runs that driver VERBATIM rather than
 * re-implementing its six guards.
 *
 * Every per-destination port takes the destination explicitly (WF-454). Before
 * the widening they were implicitly bound to the one registry path; parameterizing
 * them is what lets one port implementation serve every target without the driver
 * knowing which file is which.
 */
export interface ApplyPorts {
  /** The workspace-relative backup path for one target in one transaction.
   *  Nested per transaction AND per destination so neither two transactions nor
   *  two targets of the same transaction can collide on one backup file. */
  backupPathFor(transactionId: string, destination: string): string;
  /** A fresh transaction id, and the moment it started. */
  newTransactionId(): string;
  now(): string;
  /** `true` when a transaction journal exists on disk. */
  journalPresent(): boolean;
  /** `true` when any backup bytes remain on disk. */
  backupsPresent(): boolean;
  /** Observe one destination now: containment, existence, link-ness, and bytes.
   *  Must test containment WITHOUT creating the path, and must NOT follow a
   *  terminal symlink (WF-448 / WF-451). */
  observeDestination(destination: string): DestinationObservation;
  /** One destination's inode now, or `null` when it does not exist or cannot be
   *  stat'd. Read with `lstat` — NEVER followed.
   *
   *  Kept a SEPARATE port rather than widened into `DestinationObservation`,
   *  because that observation is WF-451's frozen shape and this item consumes the
   *  recovery protocol unchanged. The inode completes the no-follow triple
   *  (inode / type / hash): type and hash catch a swap that changes what the path
   *  holds, and the inode catches a swap that preserves the bytes while changing
   *  WHICH file the directory entry names. */
  destinationInode(destination: string): number | null;
  /** The identity a destination would have after being written with `content`.
   *  Pure — no IO. */
  identify(content: string): { contentHash: string; bytes: number };
  /** Persist the journal. */
  writeJournal(journal: TransactionJournal): WriteOutcome;
  /** Copy one destination's CURRENT bytes to its backup path. */
  writeBackup(destination: string, backupPath: string): WriteOutcome;
  /** Hash one backup's current bytes. */
  hashBackup(backupPath: string): BackupIdentity;
  /** Replace one destination ATOMICALLY: a create-exclusive sibling temp file,
   *  durably flushed, then renamed over the destination. Never a partial write.
   *  Creates any missing parent directory, since a first-run ledger or profile
   *  seed lands in a directory that may not exist yet. */
  atomicReplace(destination: string, content: string): WriteOutcome;
  /** Rebuild + persist the snapshot, then check the intended end state. */
  refreshAndSelfCheck(expectation: SelfCheckExpectation): SelfCheckOutcome;
  /** Durable completion: remove the JOURNAL FIRST, then the named backups, then
   *  prune the emptied backup directories. Called only on a complete success. */
  discardTransaction(entries: readonly JournalEntry[]): void;
  /** The frozen recovery ports, for the guarded rollback façade. */
  rollbackPorts(): RecoveryPorts;
}

export interface ApplyTransactionInput {
  /** Every destination this transaction replaces, in the caller's canonical
   *  order. MUST be non-empty and MUST NOT repeat a destination: two entries for
   *  one path would journal two prior states for the same file and make the
   *  rollback order-dependent. Both are checked before a journal exists. */
  targets: readonly ApplyTargetWrite[];
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
  /** The destinations this transaction actually replaced, in write order. Empty
   *  on every non-`applied` outcome, so a caller can never read a write set out
   *  of a run that did not complete. */
  written: string[];
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
    written: [],
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
 * not touched at all — including by the WF-454 widening, which only hands that
 * driver the N-entry journal it already knew how to restore.
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
    written: [],
  };
}

/** One target after the S2/S3 screen: observed, and with the identity of the
 *  bytes it will receive already computed. Holds no journal entry yet, because
 *  an entry needs the transaction id and the id is not minted until the WHOLE
 *  set has passed the screen. */
interface ScreenedTarget {
  destination: string;
  newContent: string;
  observed: Extract<DestinationObservation, { kind: "file" | "absent" }>;
  inode: number | null;
  willWrite: NonNullable<ReturnType<typeof createLastWrittenIdentity>>;
}

/** A screened target once the transaction id exists: its backup path and its
 *  journal entry are resolved. */
interface PreparedTarget extends ScreenedTarget {
  backupPath: string | null;
  entry: JournalEntry;
}

/**
 * Apply one exact multi-target mutation as a single journaled transaction.
 *
 * The caller MUST already hold the exclusive lifecycle lock, MUST already have
 * revalidated the plan (`decideApplyGate`), and MUST have computed each target's
 * `newContent` from the screened actions. This driver decides nothing about the
 * plan; it owns only the transaction.
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
  // --- S2a: the target set itself, before anything is observed ---------------
  if (input.targets.length === 0) {
    return rejected(
      "apply/registry-unresolvable",
      "the transaction was handed no destination to write; nothing was journalled and nothing was written.",
      noTransactionResidue(),
    );
  }
  const seen = new Set<string>();
  for (const target of input.targets) {
    if (seen.has(target.destination)) {
      return rejected(
        "apply/registry-unresolvable",
        `destination \`${target.destination}\` appears twice in one transaction; a single journal cannot record two prior states for one file, so nothing was journalled and nothing was written.`,
        noTransactionResidue(),
      );
    }
    seen.add(target.destination);
  }

  // --- S2b: observe EVERY destination, no-follow -----------------------------
  // The whole set is screened before a journal exists, so a bad target anywhere
  // in the list refuses the whole transaction rather than the prefix of it that
  // happened to be fine.
  const screened: ScreenedTarget[] = [];
  for (const target of input.targets) {
    const observed = ports.observeDestination(target.destination);
    const inode = ports.destinationInode(target.destination);

    if (observed.kind === "not-contained") {
      return rejected(
        "apply/registry-unresolvable",
        `\`${target.destination}\` does not resolve to a workspace-contained target (${observed.rejection}); nothing was journalled and nothing was written.`,
        noTransactionResidue(),
      );
    }
    if (observed.kind === "observation-failed") {
      return rejected(
        "apply/registry-unresolvable",
        `\`${target.destination}\` could not be observed: ${observed.diagnostic}`,
        noTransactionResidue(),
      );
    }
    if (observed.kind === "symlink") {
      // Refused BEFORE a journal. A transaction over a link could never be rolled
      // back either: recovery never follows, replaces, or removes one.
      return rejected(
        "apply/destination-symlink",
        `\`${target.destination}\` is a symbolic link; this mutator never writes through a link, so no journal was created and nothing was written.`,
        noTransactionResidue(),
      );
    }

    // --- S3: compute the identity of what will be written, UP FRONT ----------
    const willWrite = createLastWrittenIdentity(ports.identify(target.newContent));
    if (willWrite === null) {
      return rejected(
        "apply/registry-unresolvable",
        `the bytes to be written to \`${target.destination}\` could not be identified deterministically; nothing was journalled and nothing was written.`,
        noTransactionResidue(),
      );
    }

    screened.push({
      destination: target.destination,
      newContent: target.newContent,
      observed,
      inode,
      willWrite,
    });
  }

  // The transaction id is minted only after EVERY target passed the screen, so a
  // refused run never even consumes one.
  const transactionId = ports.newTransactionId();

  const prepared: PreparedTarget[] = [];
  for (const target of screened) {
    const backupPath =
      target.observed.kind === "file"
        ? ports.backupPathFor(transactionId, target.destination)
        : null;

    const entry = createJournalEntry({
      destination: target.destination,
      priorExistence: target.observed.kind === "file" ? "present" : "absent",
      priorContentHash: target.observed.kind === "file" ? target.observed.contentHash : null,
      priorIsSymlink: false,
      backupPath,
      lastWritten: target.willWrite,
    });
    if (entry === null) {
      return rejected(
        "apply/registry-unresolvable",
        `the transaction journal entry for \`${target.destination}\` is incomplete or self-contradictory; nothing was journalled and nothing was written.`,
        noTransactionResidue(),
      );
    }
    prepared.push({ ...target, backupPath, entry });
  }

  const journal = createTransactionJournal({
    transactionId,
    startedAt: ports.now(),
    entries: prepared.map((target) => target.entry),
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
    // atomically for the same reason the destinations are written atomically.
    return rejected(
      "apply/write-failed",
      `the transaction journal could not be written: ${journalled.diagnostic}`,
      residueFrom(ports, "the transaction journal could not be written."),
    );
  }

  // --- S5: back EVERY prior state up, and PROVE each backup ------------------
  // All of them before any write at S7, so a backup failure on the last target
  // still leaves every earlier target untouched.
  for (const target of prepared) {
    if (target.backupPath === null) continue;
    const backed = ports.writeBackup(target.destination, target.backupPath);
    if (!backed.ok) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/backup-failed",
        `the prior bytes of \`${target.destination}\` could not be backed up: ${backed.diagnostic}`,
        "skipped",
        false,
      );
    }
    // Proving the backup BEFORE the write, not only at restore time. A backup
    // that cannot reproduce the recorded prior hash is authority to write
    // nothing, so discovering that after a destination is already replaced would
    // be discovering it too late.
    const proof = ports.hashBackup(target.backupPath);
    if (!proof.ok) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/backup-failed",
        `the backup of \`${target.destination}\` could not be verified (${proof.reason}): ${proof.diagnostic}`,
        "skipped",
        false,
      );
    }
    if (proof.contentHash !== target.entry.priorContentHash) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/backup-failed",
        `the backup of \`${target.destination}\` does not reproduce its recorded prior bytes; nothing was written.`,
        "skipped",
        false,
      );
    }
  }

  // --- S6: the TOCTOU guard, over EVERY target ------------------------------
  // Re-observe and compare against S2. A symlink swapped in, a file replaced, or
  // a type change between check and write all land here, and all refuse — every
  // write must land on the thing that was validated, not on whatever now occupies
  // the path. Checked for the whole set before the first replacement, so an
  // interfered-with target never causes a partially-written transaction.
  for (const target of prepared) {
    const recheck = ports.observeDestination(target.destination);
    const recheckInode = ports.destinationInode(target.destination);
    if (!sameObservation(target.observed, recheck)) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/precondition-moved",
        `\`${target.destination}\` changed between the observation this transaction recorded and the write (${describe(target.observed)} → ${describe(recheck)}); nothing was written.`,
        "skipped",
        false,
      );
    }
    if (target.inode !== recheckInode) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/precondition-moved",
        `\`${target.destination}\` names a different file than the one this transaction validated (inode ${String(target.inode)} → ${String(recheckInode)}); nothing was written.`,
        "skipped",
        false,
      );
    }
  }

  // --- S7: atomic replacement, in the caller's canonical order ---------------
  const written: string[] = [];
  for (const target of prepared) {
    const result = ports.atomicReplace(target.destination, target.newContent);
    if (!result.ok) {
      return failAfterJournal(
        ports,
        transactionId,
        "apply/write-failed",
        `\`${target.destination}\` could not be replaced: ${result.diagnostic}`,
        "skipped",
        false,
      );
    }
    written.push(target.destination);
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
      `the transaction wrote ${written.length} destination(s) but the self-check did not confirm the intended state: ${checked.diagnostic}`,
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
    written,
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
