// wf resolver — the shared lifecycle transaction protocol (WF-451).
//
// This module FREEZES the protocol every later lifecycle mutator builds on: the
// exclusive lock's path, the versioned machine-local journal and its backups,
// the last-written identity, and the pure per-entry recovery decision. WF-451
// SOLELY OWNS these; a downstream item consumes them and may not invent a
// parallel shape to fill a gap.
//
// Deterministic, body-free, and side-effect-free. Nothing here opens a file,
// canonicalizes a path, acquires a lock, or writes a byte: the caller answers
// every filesystem question and hands the ANSWERS in — the same discipline
// `payload-plan.ts` (WF-448) and `discover-packs.ts` (WF-446) hold. The write
// half lives in `lifecycle-recovery.ts`, behind an injected port surface, so the
// DECISION can be exhaustively tested without a filesystem at all.
//
// THREE RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. A VERSION THIS RELEASE DOES NOT UNDERSTAND IS A STOP. `parseTransactionJournal`
//      never best-effort-parses an unknown `journalVersion`, and never guesses a
//      version for a journal that omits one. A later release widens the schema by
//      bumping the version; a reader that predates it must refuse, not improvise.
//
//   2. AMBIGUITY RETAINS — it never grants authority to write. Inherited verbatim
//      from WF-449. An external edit, a symlink, an uncontained destination, an
//      absent backup, or a backup whose bytes do not reproduce the recorded prior
//      hash all yield a NON-writing disposition. Recovery writes only when it can
//      prove both halves: that the bytes on disk are the ones the interrupted
//      transaction wrote, and that the bytes it is about to restore are the ones
//      that were there before.
//
//   3. THE DECISION IS A TOTAL FUNCTION OF OBSERVED-VS-RECORDED STATE, WITH NO
//      MEMORY OF A PREVIOUS ATTEMPT. That is precisely what makes recovery
//      idempotent under interruption: re-entry re-observes, and a destination
//      already back at its prior state falls out as `already-restored` rather
//      than being restored twice.

import type {
  JournalEntry,
  JournalParseResult,
  LastWrittenIdentity,
  PriorExistence,
  RecoveryDisposition,
  RecoveryReason,
  TransactionJournal,
} from "./types.js";

// ---------------------------------------------------------------------------
// Frozen paths and version
// ---------------------------------------------------------------------------
//
// All MACHINE-LOCAL, under `_local/`. That placement is deliberate and is the
// reason this item does not touch the WF-444 committed-lifecycle boundary: an
// interrupted transaction is a local fact about one machine's half-finished
// work, not portable project state. None of these is `.wf/install-state.json`,
// `.wf/slots/<skill>.<point>.md`, or a declared `## Payloads` destination, so
// the committed-artifact vocabulary is neither used nor widened here.

/** The exclusive lock guarding lifecycle entry. TRANSIENT AND SELF-CLEANING:
 *  it is not transaction state, it is removed on every exit path, and a run that
 *  acquires and releases it leaves the workspace tree byte-identical at exit —
 *  which is what keeps a no-journal discovery run assertably byte-inert. */
export const LIFECYCLE_LOCK_PATH = "_local/lifecycle.lock" as const;

/** The machine-local transaction journal. Discovery may RECOVER one; it never
 *  creates one. */
export const LIFECYCLE_JOURNAL_PATH = "_local/lifecycle-journal.json" as const;

/** The machine-local backup root holding prior bytes for a journalled
 *  transaction. */
export const LIFECYCLE_BACKUP_DIR = "_local/lifecycle-backups" as const;

/** The only journal version this release understands. */
export const LIFECYCLE_JOURNAL_VERSION = 1 as const;

const SHA256_RE = /^[a-f0-9]{64}$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Fail-closed constructors
// ---------------------------------------------------------------------------
//
// Same posture as WF-442's evidence constructors: a malformed input yields
// `null` rather than a half-trusted record. A half-trusted journal entry is
// strictly worse than none, because it would be authority to overwrite a file.

export interface LastWrittenIdentityInputs {
  contentHash: string;
  bytes: number;
}

/** Construct an exact last-written identity, or fail closed. A digest that is
 *  not well-formed SHA-256 is rejected BEFORE it can ever be compared — WF-449's
 *  well-formedness-precedes-authority rule. */
export function createLastWrittenIdentity(
  inputs: LastWrittenIdentityInputs,
): LastWrittenIdentity | null {
  if (!SHA256_RE.test(inputs.contentHash)) return null;
  if (!Number.isInteger(inputs.bytes) || inputs.bytes < 0) return null;
  return { contentHash: inputs.contentHash, bytes: inputs.bytes };
}

export interface JournalEntryInputs {
  destination: string;
  priorExistence: PriorExistence;
  priorContentHash: string | null;
  priorIsSymlink: boolean;
  backupPath: string | null;
  lastWritten: LastWrittenIdentity | null;
}

/**
 * Construct one exact journal entry, or fail closed.
 *
 * The prior-state invariant is enforced here rather than trusted: a `present`
 * prior MUST carry a well-formed prior digest, and an `absent` prior MUST NOT
 * carry one. Without that, an entry could claim "there was nothing here before"
 * while also naming bytes to restore — an ambiguity that has no safe resolution
 * at recovery time.
 */
export function createJournalEntry(inputs: JournalEntryInputs): JournalEntry | null {
  if (!nonEmpty(inputs.destination)) return null;
  if (inputs.priorExistence !== "present" && inputs.priorExistence !== "absent") return null;
  if (typeof inputs.priorIsSymlink !== "boolean") return null;

  if (inputs.priorExistence === "present") {
    if (inputs.priorContentHash === null) {
      // The one admitted exception: a prior SYMLINK has no content digest,
      // because a link's identity is its target, not its bytes. Recovery never
      // restores such an entry — it preserves it — so the missing digest can
      // never become authority to write.
      if (!inputs.priorIsSymlink) return null;
    } else if (!SHA256_RE.test(inputs.priorContentHash)) {
      return null;
    }
  } else if (inputs.priorContentHash !== null) {
    return null;
  }

  if (inputs.backupPath !== null && !nonEmpty(inputs.backupPath)) return null;

  const lastWritten =
    inputs.lastWritten === null
      ? null
      : createLastWrittenIdentity(inputs.lastWritten);
  if (inputs.lastWritten !== null && lastWritten === null) return null;

  return {
    destination: inputs.destination,
    priorExistence: inputs.priorExistence,
    priorContentHash: inputs.priorContentHash,
    priorIsSymlink: inputs.priorIsSymlink,
    backupPath: inputs.backupPath,
    lastWritten,
  };
}

export interface TransactionJournalInputs {
  transactionId: string;
  startedAt: string;
  entries: readonly JournalEntry[];
}

/**
 * Construct one exact journal at the CURRENT version, or fail closed.
 *
 * Entries are ordered by destination so two journals over the same set serialize
 * identically, and a duplicate destination is rejected outright: two entries for
 * one path would let recovery apply contradictory decisions to the same file
 * depending on iteration order.
 *
 * NOTE FOR DOWNSTREAM ITEMS: this is the WRITE-SIDE shape, provided so the first
 * journalled transaction (WF-453) has one canonical constructor to build. This
 * release never calls it on the discovery path — discovery never creates a
 * journal.
 */
export function createTransactionJournal(
  inputs: TransactionJournalInputs,
): TransactionJournal | null {
  if (!nonEmpty(inputs.transactionId) || !nonEmpty(inputs.startedAt)) return null;
  const entries = [...inputs.entries].sort((left, right) =>
    left.destination.localeCompare(right.destination),
  );
  const destinations = new Set(entries.map((entry) => entry.destination));
  if (destinations.size !== entries.length) return null;
  for (const entry of entries) {
    if (createJournalEntry(entry) === null) return null;
  }
  return {
    journalVersion: LIFECYCLE_JOURNAL_VERSION,
    transactionId: inputs.transactionId,
    startedAt: inputs.startedAt,
    entries,
  };
}

// ---------------------------------------------------------------------------
// Parsing — four outcomes, two of which are stops
// ---------------------------------------------------------------------------

function readLastWritten(value: unknown): LastWrittenIdentity | null | "invalid" {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  if (row === null) return "invalid";
  const identity = createLastWrittenIdentity({
    contentHash: typeof row.contentHash === "string" ? row.contentHash : "",
    bytes: typeof row.bytes === "number" ? row.bytes : -1,
  });
  return identity === null ? "invalid" : identity;
}

/**
 * Parse the journal from ALREADY-READ text. `null` means the file is absent —
 * the ordinary case, and the only one that is not a decision at all.
 *
 * VERSION IS CHECKED BEFORE SHAPE. A journal written by a later release will
 * legitimately carry fields this reader does not know; reporting that as
 * `malformed` would send a maintainer looking for corruption that is not there.
 * Equally, a journal with NO version is `unsupported` rather than assumed to be
 * version 1 — assuming a version is exactly the best-effort parse the contract
 * forbids.
 *
 * A structurally invalid entry fails the WHOLE journal rather than being dropped.
 * This is the deliberate inverse of `parseEvidenceLedger`'s tolerance (WF-446):
 * dropping a bad ledger entry costs a stale-evidence report, whereas dropping a
 * bad journal entry would silently abandon a half-written file — recovery would
 * report success while leaving the workspace inconsistent.
 */
export function parseTransactionJournal(raw: string | null): JournalParseResult {
  if (raw === null) return { status: "absent" };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      status: "malformed",
      diagnostic: "the transaction journal is not valid JSON.",
    };
  }

  const root = asRecord(data);
  if (root === null) {
    return {
      status: "malformed",
      diagnostic: "the transaction journal is not a JSON object.",
    };
  }

  // --- version first ---
  const rawVersion = root.journalVersion;
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion)) {
    return {
      status: "unsupported",
      observedVersion: null,
      diagnostic:
        "the transaction journal declares no integer `journalVersion`; a journal with no declared version is never assumed to be the current one.",
    };
  }
  if (rawVersion !== LIFECYCLE_JOURNAL_VERSION) {
    return {
      status: "unsupported",
      observedVersion: rawVersion,
      diagnostic: `the transaction journal declares \`journalVersion\` ${rawVersion}; this release understands only ${LIFECYCLE_JOURNAL_VERSION}.`,
    };
  }

  // --- then shape ---
  if (!nonEmpty(root.transactionId) || !nonEmpty(root.startedAt)) {
    return {
      status: "malformed",
      diagnostic: "the transaction journal is missing `transactionId` or `startedAt`.",
    };
  }
  if (!Array.isArray(root.entries)) {
    return {
      status: "malformed",
      diagnostic: "the transaction journal's `entries` is not an array.",
    };
  }

  const entries: JournalEntry[] = [];
  for (const candidate of root.entries) {
    const row = asRecord(candidate);
    if (row === null) {
      return {
        status: "malformed",
        diagnostic: "a transaction-journal entry is not a JSON object.",
      };
    }
    const lastWritten = readLastWritten(row.lastWritten);
    if (lastWritten === "invalid") {
      return {
        status: "malformed",
        diagnostic: `the last-written identity for \`${String(row.destination)}\` is incomplete or non-deterministic.`,
      };
    }
    const entry = createJournalEntry({
      destination: typeof row.destination === "string" ? row.destination : "",
      priorExistence: row.priorExistence as PriorExistence,
      priorContentHash: typeof row.priorContentHash === "string" ? row.priorContentHash : null,
      priorIsSymlink: row.priorIsSymlink === true,
      backupPath: typeof row.backupPath === "string" ? row.backupPath : null,
      lastWritten,
    });
    if (entry === null) {
      return {
        status: "malformed",
        diagnostic: `the transaction-journal entry for \`${String(row.destination)}\` is incomplete or self-contradictory.`,
      };
    }
    entries.push(entry);
  }

  const destinations = new Set(entries.map((entry) => entry.destination));
  if (destinations.size !== entries.length) {
    return {
      status: "malformed",
      diagnostic:
        "the transaction journal names a destination more than once; the recovery decision would depend on iteration order.",
    };
  }

  return {
    status: "ok",
    journal: {
      journalVersion: LIFECYCLE_JOURNAL_VERSION,
      transactionId: root.transactionId,
      startedAt: root.startedAt,
      entries: entries.sort((left, right) =>
        left.destination.localeCompare(right.destination),
      ),
    },
  };
}

// ---------------------------------------------------------------------------
// The pure per-entry decision
// ---------------------------------------------------------------------------

/** Everything the CALLER observed about one destination right now. The decision
 *  function derives none of it. */
export type DestinationObservation =
  /** The destination did not canonicalize to a workspace-contained target, tested
   *  WITHOUT creating the path (WF-448's containment property). */
  | { kind: "not-contained"; rejection: string }
  /** The destination could not be observed at all (an I/O error). */
  | { kind: "observation-failed"; diagnostic: string }
  /** Nothing is at the destination. */
  | { kind: "absent" }
  /** A symbolic link is at the destination. Never followed. */
  | { kind: "symlink" }
  /** A regular file is at the destination, with these observed bytes. */
  | { kind: "file"; contentHash: string; bytes: number };

/** What recovery should DO about one entry, plus how to report it. `action` is
 *  the only field the driver acts on; a `none` action is a write-free outcome. */
export interface EntryDecision {
  action: "none" | "restore-content" | "restore-absence";
  disposition: RecoveryDisposition;
  reason: RecoveryReason;
  detail: string;
}

function decision(
  action: EntryDecision["action"],
  disposition: RecoveryDisposition,
  reason: RecoveryReason,
  detail: string,
): EntryDecision {
  return { action, disposition, reason, detail };
}

function identityMatches(
  observation: Extract<DestinationObservation, { kind: "file" }>,
  identity: LastWrittenIdentity,
): boolean {
  return (
    observation.contentHash === identity.contentHash && observation.bytes === identity.bytes
  );
}

/**
 * Decide ONE entry, fail-safe, in a fixed order. Every branch is reachable and
 * every non-`none` action is guarded by a proof, so a decision can never be
 * "probably safe".
 *
 * THE ORDER IS THE CONTRACT:
 *
 *   1. containment      — an uncontained target is refused before anything else
 *                         is even considered. Consistent with WF-448, which
 *                         refuses traversal, absolute, symlink-escape and
 *                         out-of-workspace destinations without creating them.
 *   2. observability    — an unobservable destination is unresolved, not assumed.
 *   3. symlink          — recorded-as or observed-as a link means PRESERVE. A
 *                         link's identity is not its content, so no digest
 *                         comparison could establish that restoring it is safe.
 *   4. already at prior — THE IDEMPOTENCE GUARD. Checked BEFORE the ownership
 *                         test, so a re-entered recovery that already restored
 *                         this destination converges instead of re-writing.
 *   5. ours, untouched  — the only path to a write, and only when the observed
 *                         identity is exactly what the transaction last wrote.
 *   6. anything else    — an external edit. Preserved.
 */
export function decideEntryRecovery(
  entry: JournalEntry,
  observation: DestinationObservation,
): EntryDecision {
  // 1. Containment.
  if (observation.kind === "not-contained") {
    return decision(
      "none",
      "unresolved",
      "target-not-contained",
      `\`${entry.destination}\` does not resolve to a workspace-contained target (${observation.rejection}); recovery refuses it rather than writing outside the admitted root.`,
    );
  }

  // 2. Observability.
  if (observation.kind === "observation-failed") {
    return decision(
      "none",
      "unresolved",
      "observation-failed",
      `\`${entry.destination}\` could not be observed: ${observation.diagnostic}`,
    );
  }

  // 3. Symlink — either half is enough.
  if (observation.kind === "symlink" || entry.priorIsSymlink) {
    return decision(
      "none",
      "preserved",
      "symlink-conflict",
      `\`${entry.destination}\` is or was a symbolic link; recovery never follows, replaces, or removes a link, so it is preserved exactly as found.`,
    );
  }

  // 4. Already at the prior state — the idempotence guard.
  if (entry.priorExistence === "absent") {
    if (observation.kind === "absent") {
      return decision(
        "none",
        "already-restored",
        "already-prior-absence",
        `\`${entry.destination}\` is already absent, which is its prior state.`,
      );
    }
  } else if (
    observation.kind === "file" &&
    entry.priorContentHash !== null &&
    observation.contentHash === entry.priorContentHash
  ) {
    return decision(
      "none",
      "already-restored",
      "already-prior-content",
      `\`${entry.destination}\` already holds its prior bytes.`,
    );
  }

  // 5. Ours and untouched — the only route to a write.
  //
  // `lastWritten === null` means the transaction journalled this destination but
  // was interrupted before writing it. Step 4 already proved the destination is
  // NOT at its prior state, so something moved it and it was not us. There is no
  // ownership to claim, so it is preserved rather than restored.
  if (entry.lastWritten === null) {
    return decision(
      "none",
      "preserved",
      "external-edit",
      `\`${entry.destination}\` differs from its prior state, but the interrupted transaction never wrote it; the change is not ours to undo.`,
    );
  }

  const ours =
    observation.kind === "file" && identityMatches(observation, entry.lastWritten);
  if (!ours) {
    return decision(
      "none",
      "preserved",
      "external-edit",
      `\`${entry.destination}\` no longer holds the bytes the interrupted transaction wrote; an unrelated edit is preserved, never overwritten.`,
    );
  }

  if (entry.priorExistence === "absent") {
    return decision(
      "restore-absence",
      "restored",
      "restored-absence",
      `\`${entry.destination}\` was created by the interrupted transaction and is removed to restore its prior absence.`,
    );
  }

  // A `present` non-symlink prior must have both a digest and a backup to
  // restore from. `createJournalEntry` guarantees the digest; the backup path is
  // checked here, and the driver additionally verifies the backup's BYTES
  // reproduce that digest before writing anything.
  if (entry.backupPath === null || entry.priorContentHash === null) {
    return decision(
      "none",
      "unresolved",
      "backup-missing",
      `\`${entry.destination}\` records prior bytes but no backup to restore them from.`,
    );
  }

  return decision(
    "restore-content",
    "restored",
    "restored-content",
    `\`${entry.destination}\` still holds the interrupted transaction's bytes and is restored from its verified backup.`,
  );
}
