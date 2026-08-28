// wf resolver — the machine-emitted run-evidence artifact class (WF-490).
//
// THE PROBLEM THIS EXISTS FOR. A fleet run reported 100% ceremony compliance
// while the ceremony completed zero times, because the only evidence was a block
// of text the dispatched agent typed. Verifying the phase artifacts instead is no
// better: the same run hand-authored a full audit report. The only proof outside
// the dispatched agent's control is one the RESOLVER issues, so this module
// defines that record — its shape, its version, its seal, and the reader that
// matches it.
//
// THE SHAPE IS BORROWED, NOT INVENTED. Two shipped modules already answer the two
// hard questions, and this one follows both rather than growing a parallel form:
//
//   * `lifecycle-journal.ts` — A VERSION THIS RELEASE DOES NOT UNDERSTAND IS A
//     STOP. `parseRunEvidenceLedger` checks the declared version BEFORE shape and
//     never assumes a ledger that omits one is the current version.
//   * `lifecycle-evidence.ts` — THE PORTABLE/BINDING SPLIT, and AMBIGUITY RETAINS,
//     NEVER GRANTS AUTHORITY. The portable, matchable records live in the declared
//     committed class; the machine-local issuer binding lives under `_local/` and
//     is never served through any tool. Every branch that cannot PROVE a seal
//     returns `matched: false` with a stated reason — never partial credit.
//
// Deterministic and side-effect-free. Nothing here opens a file, canonicalizes a
// path, or writes a byte: the caller answers every filesystem question and hands
// the answers in, the same discipline `lifecycle-journal.ts` holds. That is what
// lets the forgery, version-refusal and non-completion properties be asserted
// exhaustively without a filesystem.
//
// THREE RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. THE CALLER ASSERTS NOTHING THE RESOLVER CAN DERIVE. A skill supplies only
//      what it alone knows — which phase it is, which task, and which artifact it
//      wrote. The run identity, the workspace, the clock, the sequence and the
//      artifact digest are all derived by the resolver. A caller that could assert
//      them could assert a receipt, which is the original defect one level down.
//
//   2. A MALFORMED RECORD IS REPORTED, NOT DISCARDED — and this is the DELIBERATE
//      INVERSE of `parseTransactionJournal`'s whole-file strictness. There, a bad
//      entry means possible corruption and dropping it would silently abandon a
//      half-written file. Here, a bad record is the FORGERY SIGNAL itself: failing
//      the whole ledger would let one hand-written line erase the genuine receipts
//      beside it, which is precisely the outcome an attacker would want. So shape
//      is tolerated per record and reported as `unmatched`; only the VERSION is
//      whole-ledger strict.
//
//   3. NO ISSUER, NO MATCH. When the machine-local binding is unavailable, every
//      record is `unmatched` with a stated reason. The fail-safe direction for a
//      proof mechanism is to prove nothing, never to assume everything.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Frozen version, destinations and vocabulary
// ---------------------------------------------------------------------------
//
// The split is the `lifecycle-evidence.ts` split, for the same reason: the
// RECORDS are portable evidence a later reader matches, and the ISSUER BINDING is
// a fact about one machine. Only the first is a committed lifecycle artifact.

/** The only run-evidence ledger version this release understands. */
export const RUN_EVIDENCE_FORMAT_VERSION = 1 as const;

/** The declared committed artifact class. `.wf/` is not a general writable home —
 *  authority comes from the resolver's lifecycle ownership PLUS this declared
 *  class, never from the path prefix. */
export const RUN_EVIDENCE_DIR = ".wf/run-evidence" as const;

/** The machine-local issuer binding. Machine-local for the same reason
 *  `lifecycle-journal.ts`'s paths are: it is a fact about one machine, not
 *  portable project state. It is never served through any resolver tool and is
 *  never named in a skill body. */
export const RUN_EVIDENCE_ISSUER_PATH = "_local/run-evidence-issuer.json" as const;

/**
 * The CLOSED set of receipt-bearing phases.
 *
 * Closed on purpose, and closed HERE rather than in prose: the charter fixes the
 * instrumentation set at exactly these seven, and widening it is a scope
 * escalation to be raised rather than absorbed. Enforcing it at the issuing
 * boundary makes "no eighth skill is instrumented" a property of the mechanism
 * instead of a convention a later editor can quietly break.
 *
 * This is deliberately NOT the pipeline driver's differently-defined "gated
 * phase" list, which names a different set for a different purpose (where an
 * unattended walk halts). Conditional remediation phases are excluded because
 * requiring a receipt from a phase that only fires on failure would record a
 * CLEAN run as unproven — inverting the very signal this mechanism exists to
 * produce.
 */
export const RECEIPT_BEARING_PHASES = [
  "spec",
  "plan",
  "implement",
  "verify-spec",
  "qa-gen",
  "ship",
  "tf",
] as const;

export type ReceiptBearingPhase = (typeof RECEIPT_BEARING_PHASES)[number];

/** The record kinds that travel this one emission path. `phase-receipt` is this
 *  release's own; `gate-approval` is reserved for the per-gate self-approval
 *  records, which write into this same class rather than inventing a second
 *  route. A gate approval is a claim about a GATE, not a phase, so its subject is
 *  not constrained to the receipt-bearing set. */
export const RUN_EVIDENCE_KINDS = ["phase-receipt", "gate-approval"] as const;
export type RunEvidenceKind = (typeof RUN_EVIDENCE_KINDS)[number];

const HEX64_RE = /^[a-f0-9]{64}$/;
const RUN_ID_RE = /^[a-f0-9]{32}$/;
const SUBJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const TASK_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The declared-class destination test
// ---------------------------------------------------------------------------

const RUN_EVIDENCE_PREFIX = `${RUN_EVIDENCE_DIR}/` as const;

/** The workspace-relative destination holding one run's evidence. Derived from
 *  the class constant, never a literal spelled out at a call site, so the two can
 *  never drift apart. */
export function runEvidenceDestination(runId: string): string {
  return `${RUN_EVIDENCE_PREFIX}${runId}.json`;
}

/**
 * The TWO-PART committed-lifecycle authority test for this class, mirroring
 * `isDeclaredProjectOverrideArtifact` exactly.
 *
 * The prefix alone is NOT enough: the remainder must be a well-formed run id
 * directly inside the class directory, with no nested path. `.wf/run-evidence`,
 * `.wf/run-evidence/nested/x.json`, `.wf/run-evidence/notarunid.json` and
 * `.wf/run-evidence/<id>.txt` are all outside the declared class and all refused.
 *
 * Exported as its own function so the authority boundary is asserted directly
 * rather than only through the surfaces that consume it — a widening here would
 * widen the admitted artifact set at once, which is exactly the kind of change
 * that must be impossible to make silently.
 */
export function isDeclaredRunEvidenceArtifact(destination: string): boolean {
  if (!destination.startsWith(RUN_EVIDENCE_PREFIX)) return false;
  const filename = destination.slice(RUN_EVIDENCE_PREFIX.length);
  if (filename.length === 0 || filename.includes("/")) return false;
  if (!filename.endsWith(".json")) return false;
  return RUN_ID_RE.test(filename.slice(0, -".json".length));
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** The artifact a phase produced, as the RESOLVER observed it — never as a caller
 *  described it. A caller names a path; the resolver reads and digests it. */
export interface RunEvidenceArtifact {
  path: string;
  sha256: string;
  bytes: number;
}

export interface RunEvidenceRecord {
  kind: RunEvidenceKind;
  /** The receipt-bearing phase (for `phase-receipt`) or the gate token (for
   *  `gate-approval`). */
  subject: string;
  taskId: string;
  runId: string;
  workspaceRoot: string;
  issuedAt: string;
  sequence: number;
  artifact: RunEvidenceArtifact | null;
  /** The keyed digest over every field above. This is the whole mechanism: a
   *  record written by anything other than the issuer carries no valid seal. */
  seal: string;
}

export interface RunEvidenceLedger {
  formatVersion: number;
  runId: string;
  records: RunEvidenceRecord[];
}

/** The unsealed body a seal is computed over. */
export type RunEvidenceBody = Omit<RunEvidenceRecord, "seal">;

// ---------------------------------------------------------------------------
// Canonicalization and the seal
// ---------------------------------------------------------------------------

/**
 * One canonical, injective serialization of a record body.
 *
 * An ARRAY OF PAIRS in a fixed order rather than an object, so the serialization
 * cannot move with object key order, and `JSON.stringify`'s own quoting keeps it
 * injective — no field value can forge the delimiter of another. Same reasoning
 * as the approved-plan identity's fact tokens.
 */
export function canonicalRunEvidenceBody(body: RunEvidenceBody): string {
  return JSON.stringify([
    ["formatVersion", RUN_EVIDENCE_FORMAT_VERSION],
    ["kind", body.kind],
    ["subject", body.subject],
    ["taskId", body.taskId],
    ["runId", body.runId],
    ["workspaceRoot", body.workspaceRoot],
    ["issuedAt", body.issuedAt],
    ["sequence", body.sequence],
    [
      "artifact",
      body.artifact === null
        ? null
        : [body.artifact.path, body.artifact.sha256, body.artifact.bytes],
    ],
  ]);
}

/** Seal a record body with the machine-local issuer key. */
export function sealRunEvidenceBody(body: RunEvidenceBody, issuerKey: string): string | null {
  if (!HEX64_RE.test(issuerKey)) return null;
  return createHmac("sha256", Buffer.from(issuerKey, "hex"))
    .update(canonicalRunEvidenceBody(body), "utf8")
    .digest("hex");
}

/** Constant-time seal comparison. Length is checked first because
 *  `timingSafeEqual` throws on a length mismatch, and a thrown comparison would
 *  be a crash where the contract requires a stated `unmatched`. */
function sealEquals(left: string, right: string): boolean {
  if (!HEX64_RE.test(left) || !HEX64_RE.test(right)) return false;
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Fail-closed construction
// ---------------------------------------------------------------------------

export interface RunEvidenceRecordInputs {
  kind: RunEvidenceKind;
  subject: string;
  taskId: string;
  runId: string;
  workspaceRoot: string;
  issuedAt: string;
  sequence: number;
  artifact: RunEvidenceArtifact | null;
}

/** True when `subject` is admissible for `kind`. A `phase-receipt` is constrained
 *  to the closed receipt-bearing set; a `gate-approval` names a gate, so it takes
 *  any well-formed token. */
export function isAdmissibleSubject(kind: RunEvidenceKind, subject: string): boolean {
  if (!SUBJECT_RE.test(subject)) return false;
  if (kind === "phase-receipt") {
    return (RECEIPT_BEARING_PHASES as readonly string[]).includes(subject);
  }
  return true;
}

/**
 * Construct one sealed record, or fail closed.
 *
 * Same posture as the shipped evidence and journal constructors: a malformed
 * input yields `null` rather than a half-trusted record. A half-trusted receipt is
 * strictly worse than none, because its whole purpose is to be believed.
 */
export function createRunEvidenceRecord(
  inputs: RunEvidenceRecordInputs,
  issuerKey: string,
): RunEvidenceRecord | null {
  if (!(RUN_EVIDENCE_KINDS as readonly string[]).includes(inputs.kind)) return null;
  if (!isAdmissibleSubject(inputs.kind, inputs.subject)) return null;
  if (!TASK_ID_RE.test(inputs.taskId)) return null;
  if (!RUN_ID_RE.test(inputs.runId)) return null;
  if (!nonEmpty(inputs.workspaceRoot) || !nonEmpty(inputs.issuedAt)) return null;
  if (!Number.isInteger(inputs.sequence) || inputs.sequence < 0) return null;

  let artifact: RunEvidenceArtifact | null = null;
  if (inputs.artifact !== null) {
    const { path, sha256, bytes } = inputs.artifact;
    if (!nonEmpty(path) || !HEX64_RE.test(sha256)) return null;
    if (!Number.isInteger(bytes) || bytes < 0) return null;
    artifact = { path, sha256, bytes };
  }

  const body: RunEvidenceBody = {
    kind: inputs.kind,
    subject: inputs.subject,
    taskId: inputs.taskId,
    runId: inputs.runId,
    workspaceRoot: inputs.workspaceRoot,
    issuedAt: inputs.issuedAt,
    sequence: inputs.sequence,
    artifact,
  };
  const seal = sealRunEvidenceBody(body, issuerKey);
  if (seal === null) return null;
  return { ...body, seal };
}

/** Serialize a ledger for durable write. Stable and pretty-printed so a reviewer
 *  can read the evidence a run produced without a tool. */
export function serializeRunEvidenceLedger(ledger: RunEvidenceLedger): string {
  return `${JSON.stringify(
    {
      formatVersion: RUN_EVIDENCE_FORMAT_VERSION,
      runId: ledger.runId,
      records: ledger.records,
    },
    null,
    2,
  )}\n`;
}

// ---------------------------------------------------------------------------
// Parsing — version first, then tolerant shape
// ---------------------------------------------------------------------------

export type RunEvidenceParseResult =
  | { status: "absent" }
  | { status: "ok"; ledger: RunEvidenceLedger; unreadableRecords: number }
  | { status: "malformed"; diagnostic: string }
  | { status: "unsupported"; observedVersion: number | null; diagnostic: string };

function readArtifact(value: unknown): RunEvidenceArtifact | null | "invalid" {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  if (row === null) return "invalid";
  const path = row.path;
  const sha256 = row.sha256;
  const bytes = row.bytes;
  if (!nonEmpty(path) || typeof sha256 !== "string" || !HEX64_RE.test(sha256)) return "invalid";
  if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes < 0) return "invalid";
  return { path, sha256, bytes };
}

/**
 * Read a record as it literally appears, WITHOUT re-deriving or repairing it.
 *
 * This deliberately does not go through `createRunEvidenceRecord`: that
 * constructor seals, and re-sealing a record on read would mint a valid seal for
 * a forged body — the exact failure this whole module exists to prevent. Read
 * takes the seal as found and lets the matcher judge it.
 *
 * Returns `null` for a record too malformed to even carry a subject; the caller
 * counts those rather than failing the ledger (rule 2 in the header).
 */
function readRecord(value: unknown): RunEvidenceRecord | null {
  const row = asRecord(value);
  if (row === null) return null;
  const artifact = readArtifact(row.artifact);
  if (artifact === "invalid") return null;
  const kind = row.kind;
  const subject = row.subject;
  if (typeof kind !== "string" || typeof subject !== "string") return null;
  return {
    kind: kind as RunEvidenceKind,
    subject,
    taskId: typeof row.taskId === "string" ? row.taskId : "",
    runId: typeof row.runId === "string" ? row.runId : "",
    workspaceRoot: typeof row.workspaceRoot === "string" ? row.workspaceRoot : "",
    issuedAt: typeof row.issuedAt === "string" ? row.issuedAt : "",
    sequence:
      typeof row.sequence === "number" && Number.isInteger(row.sequence) ? row.sequence : -1,
    artifact,
    seal: typeof row.seal === "string" ? row.seal : "",
  };
}

/**
 * Parse a ledger from ALREADY-READ text. `null` means the file is absent — the
 * ordinary case, and the only outcome that is not a decision at all.
 *
 * VERSION IS CHECKED BEFORE SHAPE, and a ledger with NO version is `unsupported`
 * rather than assumed to be version 1 — assuming a version is exactly the
 * best-effort parse the contract forbids. A later release widens the schema by
 * bumping the version; a reader that predates it must refuse, not improvise.
 */
export function parseRunEvidenceLedger(raw: string | null): RunEvidenceParseResult {
  if (raw === null) return { status: "absent" };

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: "malformed", diagnostic: "the run-evidence ledger is not valid JSON." };
  }

  const root = asRecord(data);
  if (root === null) {
    return { status: "malformed", diagnostic: "the run-evidence ledger is not a JSON object." };
  }

  // --- version first ---
  const rawVersion = root.formatVersion;
  if (typeof rawVersion !== "number" || !Number.isInteger(rawVersion)) {
    return {
      status: "unsupported",
      observedVersion: null,
      diagnostic:
        "the run-evidence ledger declares no integer `formatVersion`; a ledger with no declared version is never assumed to be the current one.",
    };
  }
  if (rawVersion !== RUN_EVIDENCE_FORMAT_VERSION) {
    return {
      status: "unsupported",
      observedVersion: rawVersion,
      diagnostic: `the run-evidence ledger declares \`formatVersion\` ${rawVersion}; this release understands only ${RUN_EVIDENCE_FORMAT_VERSION}.`,
    };
  }

  // --- then shape ---
  if (!nonEmpty(root.runId)) {
    return { status: "malformed", diagnostic: "the run-evidence ledger is missing `runId`." };
  }
  if (!Array.isArray(root.records)) {
    return {
      status: "malformed",
      diagnostic: "the run-evidence ledger's `records` is not an array.",
    };
  }

  const records: RunEvidenceRecord[] = [];
  let unreadableRecords = 0;
  for (const candidate of root.records) {
    const record = readRecord(candidate);
    if (record === null) {
      // Counted, never dropped silently and never fatal — see rule 2.
      unreadableRecords += 1;
      continue;
    }
    records.push(record);
  }

  return {
    status: "ok",
    ledger: { formatVersion: RUN_EVIDENCE_FORMAT_VERSION, runId: root.runId, records },
    unreadableRecords,
  };
}

// ---------------------------------------------------------------------------
// Matching — the forgery boundary
// ---------------------------------------------------------------------------

export type RunEvidenceUnmatchedReason =
  /** No issuer binding was available, so nothing can be proved either way. */
  | "issuer-unavailable"
  /** The record carries no well-formed seal at all — the hand-written shape. */
  | "seal-absent"
  /** The record's fields are not admissible, so no valid seal could exist. */
  | "record-inadmissible"
  /** A well-formed seal that is not the one this issuer would produce. */
  | "seal-mismatch"
  /** The record claims a different run than the ledger it sits in. */
  | "run-mismatch";

export interface RunEvidenceMatch {
  record: RunEvidenceRecord;
  matched: boolean;
  reason: RunEvidenceUnmatchedReason | null;
}

/**
 * Classify every record as matched or unmatched, with a stated reason.
 *
 * EVERY branch that cannot PROVE the seal returns `matched: false` — missing
 * issuer, absent seal, inadmissible fields, a mismatched digest, and a record
 * claiming a run other than its ledger's. Ambiguity retains and never grants
 * authority: there is no "probably a receipt".
 *
 * `issuerKey === null` is the whole-set case rather than a throw: a reader with no
 * binding must report that it proved nothing, not crash and not assume.
 */
export function matchRunEvidence(
  ledger: RunEvidenceLedger,
  issuerKey: string | null,
): RunEvidenceMatch[] {
  return ledger.records.map((record) => {
    if (issuerKey === null || !HEX64_RE.test(issuerKey)) {
      return { record, matched: false, reason: "issuer-unavailable" as const };
    }
    if (!HEX64_RE.test(record.seal)) {
      return { record, matched: false, reason: "seal-absent" as const };
    }
    if (record.runId !== ledger.runId) {
      return { record, matched: false, reason: "run-mismatch" as const };
    }
    const admissible =
      (RUN_EVIDENCE_KINDS as readonly string[]).includes(record.kind) &&
      isAdmissibleSubject(record.kind, record.subject) &&
      TASK_ID_RE.test(record.taskId) &&
      RUN_ID_RE.test(record.runId) &&
      nonEmpty(record.workspaceRoot) &&
      nonEmpty(record.issuedAt) &&
      Number.isInteger(record.sequence) &&
      record.sequence >= 0;
    if (!admissible) {
      return { record, matched: false, reason: "record-inadmissible" as const };
    }
    const expected = sealRunEvidenceBody(
      {
        kind: record.kind,
        subject: record.subject,
        taskId: record.taskId,
        runId: record.runId,
        workspaceRoot: record.workspaceRoot,
        issuedAt: record.issuedAt,
        sequence: record.sequence,
        artifact: record.artifact,
      },
      issuerKey,
    );
    if (expected === null || !sealEquals(expected, record.seal)) {
      return { record, matched: false, reason: "seal-mismatch" as const };
    }
    return { record, matched: true, reason: null };
  });
}

/** The receipt-bearing phases a run has PROVEN, in the closed set's own order.
 *  Derived only from matched `phase-receipt` records — an unmatched record
 *  contributes nothing, which is the whole point. */
export function provenPhases(matches: readonly RunEvidenceMatch[]): ReceiptBearingPhase[] {
  const proven = new Set(
    matches
      .filter((match) => match.matched && match.record.kind === "phase-receipt")
      .map((match) => match.record.subject),
  );
  return RECEIPT_BEARING_PHASES.filter((phase) => proven.has(phase));
}

// ---------------------------------------------------------------------------
// The issuer binding
// ---------------------------------------------------------------------------

export interface RunEvidenceIssuer {
  issuerVersion: number;
  key: string;
}

/** Parse the machine-local issuer binding. Returns `null` on anything it cannot
 *  fully trust — an unparseable, wrong-version, or malformed binding proves
 *  nothing, and a reader with no key reports exactly that. */
export function parseRunEvidenceIssuer(raw: string | null): RunEvidenceIssuer | null {
  if (raw === null) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const row = asRecord(data);
  if (row === null) return null;
  if (row.issuerVersion !== RUN_EVIDENCE_FORMAT_VERSION) return null;
  if (typeof row.key !== "string" || !HEX64_RE.test(row.key)) return null;
  return { issuerVersion: RUN_EVIDENCE_FORMAT_VERSION, key: row.key };
}

/** Serialize a freshly minted issuer binding. */
export function serializeRunEvidenceIssuer(key: string): string {
  return `${JSON.stringify({ issuerVersion: RUN_EVIDENCE_FORMAT_VERSION, key }, null, 2)}\n`;
}

/**
 * Mint a fresh issuer key.
 *
 * THE ONE NON-DETERMINISTIC FUNCTION IN THIS MODULE, and deliberately so: the
 * key's unpredictability IS the forgery resistance, so it belongs beside the seal
 * it feeds rather than in a port a test double could make predictable. Every
 * other function here is a total function of its inputs, which is what lets the
 * match, refusal and version behaviours be asserted without a filesystem.
 */
export function mintRunEvidenceIssuerKey(): string {
  return randomBytes(32).toString("hex");
}
