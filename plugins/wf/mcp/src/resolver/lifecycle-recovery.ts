// wf resolver — the guarded, idempotent recovery driver (WF-451).
//
// The WRITE half of the shared lifecycle protocol. Every filesystem effect it
// needs is declared on `RecoveryPorts` and injected, so the whole driver — lock
// acquisition, journal lifetime, restore, retention, and every fail-safe stop —
// is exercised in tests against in-memory doubles, with a separate real-
// filesystem suite proving the production ports honour the same contract.
//
// THE INVARIANTS THIS MODULE EXISTS TO HOLD:
//
//   1. THE LOCK IS RELEASED ON EVERY EXIT PATH. A lock leaked by a fail-safe stop
//      would convert one bad run into a permanently blocked workspace — strictly
//      worse than the interruption it was guarding against.
//
//   2. THE JOURNAL IS DISCARDED ONLY WHEN EVERY ENTRY RESOLVED. That single rule
//      is what makes recovery idempotent under interruption: an interruption
//      mid-recovery leaves the journal, re-entry re-observes every destination,
//      the entries already restored fall out as `already-restored`, and the run
//      converges to the same result.
//
//   3. RECOVERY WRITES ARE REPORTED SEPARATELY, AND NEVER FOLDED INTO THE
//      CALLER'S OUTPUT. `wroteBytes` is the explicit statement that the baseline
//      moved. A caller's own byte-inertness is asserted FROM THE RECOVERED
//      BASELINE — never from process start.
//
//   4. UNRESOLVED WORK STOPS THE CALLER. `proceeded` is `true` only for
//      `no-journal` and `recovered`. Anything preserved or unresolved means the
//      caller must not go on to read lifecycle state, because that state may be
//      inconsistent.
//
// This module NEVER creates a journal, a backup, or a transaction. It only
// recovers one that already exists.

import {
  decideEntryRecovery,
  parseTransactionJournal,
  type DestinationObservation,
} from "./lifecycle-journal.js";
import type {
  DiscoveryIssue,
  JournalEntry,
  RecoveryEntryOutcome,
  RecoveryReport,
} from "./types.js";

/** The outcome of trying to take the exclusive lock. `held-by-other` is the
 *  concurrent-entry case and is a fail-safe stop, not an error. */
export type LockAcquisition =
  | { ok: true }
  | { ok: false; reason: "held-by-other" | "unavailable"; diagnostic: string };

/** The observed identity of one backup. A backup that cannot be hashed is never
 *  restored — recovery does not write bytes it cannot prove.
 *
 *  The three refusal reasons stay DISTINCT rather than collapsing into one:
 *  a backup that is absent, one whose bytes cannot be read, and one whose path
 *  does not resolve inside the workspace are three different maintainer stories,
 *  and reporting an uncontained path as a byte mismatch would send a reader
 *  looking for corruption that is not there. */
export type BackupIdentity =
  | { ok: true; contentHash: string }
  | { ok: false; reason: "missing" | "unreadable" | "not-contained"; diagnostic: string };

/** The outcome of one write. */
export type WriteOutcome = { ok: true } | { ok: false; diagnostic: string };

/**
 * Every filesystem effect recovery needs, and nothing else. A port implementation
 * owns canonicalization and containment; the driver consumes its verdicts.
 */
export interface RecoveryPorts {
  /** Take the exclusive lock. Must be create-exclusive so the filesystem, not a
   *  read-then-write sequence, decides the single holder. */
  acquireLock(): LockAcquisition;
  /** Release the lock. Called on EVERY exit path after a successful acquire, and
   *  must tolerate being called when the lock file is already gone. */
  releaseLock(): void;
  /** The raw journal text, or `null` when no journal exists. */
  readJournal(): string | null;
  /** Observe one destination now: containment, existence, link-ness, and bytes.
   *  Must test containment WITHOUT creating the path (WF-448). */
  observeDestination(destination: string): DestinationObservation;
  /** Hash one backup's current bytes. */
  hashBackup(backupPath: string): BackupIdentity;
  /** Copy the backup's bytes over the destination. */
  restoreBytes(destination: string, backupPath: string): WriteOutcome;
  /** Remove the destination, restoring its prior absence. */
  removeDestination(destination: string): WriteOutcome;
  /** Discard the journal and the backups it names. Called ONLY on a complete
   *  recovery. */
  discardJournal(entries: readonly JournalEntry[]): void;
}

interface Buckets {
  restored: RecoveryEntryOutcome[];
  alreadyRestored: RecoveryEntryOutcome[];
  preserved: RecoveryEntryOutcome[];
  unresolved: RecoveryEntryOutcome[];
}

function emptyBuckets(): Buckets {
  return { restored: [], alreadyRestored: [], preserved: [], unresolved: [] };
}

function bucketFor(buckets: Buckets, outcome: RecoveryEntryOutcome): RecoveryEntryOutcome[] {
  if (outcome.disposition === "restored") return buckets.restored;
  if (outcome.disposition === "already-restored") return buckets.alreadyRestored;
  if (outcome.disposition === "preserved") return buckets.preserved;
  return buckets.unresolved;
}

/** A report for a state that resolved before any entry was considered. */
function terminalReport(
  state: RecoveryReport["state"],
  proceeded: boolean,
  diagnostics: DiscoveryIssue[],
  journalVersion: number | null = null,
): RecoveryReport {
  return {
    state,
    proceeded,
    wroteBytes: false,
    journalVersion,
    transactionId: null,
    ...emptyBuckets(),
    diagnostics,
  };
}

/** The report a caller uses when the workspace root was never admitted (WF-445).
 *  Exported because the admission decision is made at the tool boundary, before
 *  any service — and therefore before any port — exists. */
export function invalidRootRecoveryReport(diagnostic: string): RecoveryReport {
  return terminalReport("invalid-root", false, [
    { code: "recovery/invalid-root", message: diagnostic },
  ]);
}

/** The report for a caller that has no recovery surface wired at all. Used by
 *  the in-memory service doubles, and by any path that legitimately performs no
 *  recovery. Byte-inert and non-blocking by construction. */
export function noRecoveryReport(): RecoveryReport {
  return terminalReport("no-journal", true, []);
}

/**
 * Recover an interrupted transaction, or establish that there is nothing to
 * recover. Returns the report the caller reports SEPARATELY from its own output.
 *
 * The lock is held for the whole run and released before returning on every
 * path, including a throw from a port (which is classified rather than
 * propagated — a throw escaping here would leave the lock held).
 */
export function recoverInterruptedTransaction(ports: RecoveryPorts): RecoveryReport {
  const lock = ports.acquireLock();
  if (!lock.ok) {
    const code =
      lock.reason === "held-by-other"
        ? "recovery/lock-held"
        : "recovery/lock-unavailable";
    return terminalReport("lock-unavailable", false, [
      { code, message: lock.diagnostic },
    ]);
  }

  try {
    return runUnderLock(ports);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return terminalReport("incomplete", false, [
      {
        code: "recovery/failed",
        message: `recovery could not complete: ${message}`,
      },
    ]);
  } finally {
    // INVARIANT 1. `finally` covers the success path, every fail-safe stop, and
    // a throw from any port.
    ports.releaseLock();
  }
}

function runUnderLock(ports: RecoveryPorts): RecoveryReport {
  const parsed = parseTransactionJournal(ports.readJournal());

  if (parsed.status === "absent") {
    // Nothing to recover. No transaction state is created, no byte is written,
    // and the caller proceeds from a workspace identical to the one it entered.
    return terminalReport("no-journal", true, []);
  }

  if (parsed.status === "unsupported") {
    return terminalReport(
      "unsupported",
      false,
      [{ code: "recovery/journal-unsupported", message: parsed.diagnostic }],
      parsed.observedVersion,
    );
  }

  if (parsed.status === "malformed") {
    return terminalReport("malformed", false, [
      { code: "recovery/journal-malformed", message: parsed.diagnostic },
    ]);
  }

  const journal = parsed.journal;
  const buckets = emptyBuckets();
  const diagnostics: DiscoveryIssue[] = [];
  let wroteBytes = false;

  for (const entry of journal.entries) {
    const decided = decideEntryRecovery(entry, ports.observeDestination(entry.destination));

    let outcome: RecoveryEntryOutcome = {
      destination: entry.destination,
      disposition: decided.disposition,
      reason: decided.reason,
      detail: decided.detail,
    };

    if (decided.action === "restore-content" && entry.backupPath !== null) {
      // THE SECOND HALF OF THE PROOF. The decision established that the bytes on
      // disk are the ones the interrupted transaction wrote; this establishes
      // that the bytes about to be written are the ones that were there before.
      // Both halves are required, so a backup that has itself been lost or
      // altered can never become authority to overwrite the destination.
      const backup = ports.hashBackup(entry.backupPath);
      if (!backup.ok) {
        outcome = {
          destination: entry.destination,
          disposition: "unresolved",
          reason:
            backup.reason === "missing"
              ? "backup-missing"
              : backup.reason === "not-contained"
                ? "target-not-contained"
                : "backup-mismatch",
          detail: backup.diagnostic,
        };
      } else if (backup.contentHash !== entry.priorContentHash) {
        outcome = {
          destination: entry.destination,
          disposition: "unresolved",
          reason: "backup-mismatch",
          detail: `the backup for \`${entry.destination}\` no longer reproduces the recorded prior bytes; recovery writes nothing it cannot prove.`,
        };
      } else {
        const written = ports.restoreBytes(entry.destination, entry.backupPath);
        if (written.ok) {
          wroteBytes = true;
        } else {
          outcome = {
            destination: entry.destination,
            disposition: "unresolved",
            reason: "restore-failed",
            detail: written.diagnostic,
          };
        }
      }
    } else if (decided.action === "restore-absence") {
      const removed = ports.removeDestination(entry.destination);
      if (removed.ok) {
        wroteBytes = true;
      } else {
        outcome = {
          destination: entry.destination,
          disposition: "unresolved",
          reason: "restore-failed",
          detail: removed.diagnostic,
        };
      }
    }

    bucketFor(buckets, outcome).push(outcome);
  }

  const complete = buckets.preserved.length === 0 && buckets.unresolved.length === 0;

  if (complete) {
    // INVARIANT 2. The journal (and the backups it names) is discarded ONLY
    // here. Until this line runs, a re-entry sees the same journal and converges.
    ports.discardJournal(journal.entries);
  } else {
    diagnostics.push({
      code: "recovery/incomplete",
      message: `recovery left ${buckets.preserved.length} destination(s) preserved and ${buckets.unresolved.length} unresolved; the journal is retained and lifecycle state is not read.`,
    });
  }

  return {
    state: complete ? "recovered" : "incomplete",
    proceeded: complete,
    wroteBytes,
    journalVersion: journal.journalVersion,
    transactionId: journal.transactionId,
    restored: buckets.restored,
    alreadyRestored: buckets.alreadyRestored,
    preserved: buckets.preserved,
    unresolved: buckets.unresolved,
    diagnostics,
  };
}
