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
//     committed class; the machine-local issuer binding lives outside the audited
//     workspace and is never served through any tool. Every branch that cannot
//     PROVE a seal returns `matched: false` with a stated reason — never partial
//     credit.
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
//      wrote. The run identity, the workspace binding, the clock, the sequence, the
//      artifact digest and the run mode are all derived by the resolver. A caller
//      that could assert them could assert a receipt, which is the original defect
//      one level down.
//
//   2. A MALFORMED RECORD IS REPORTED, NOT DISCARDED — and this is the DELIBERATE
//      INVERSE of `parseTransactionJournal`'s whole-file strictness. There, a bad
//      entry means possible corruption and dropping it would silently abandon a
//      half-written file. Here, a bad record is the FORGERY SIGNAL itself: failing
//      the whole ledger would let one hand-written line erase the genuine receipts
//      beside it, which is precisely the outcome an attacker would want. So shape
//      is tolerated per record — parsed into `RawRunEvidenceRecord`, which is
//      honest that its `kind` is unvalidated — and reported as `unmatched`. Only
//      the VERSION is whole-ledger strict.
//
//   3. NO ISSUER, NO MATCH. When the machine-local binding is unavailable, every
//      record is `unmatched` with a stated reason. The fail-safe direction for a
//      proof mechanism is to prove nothing, never to assume everything.
//
// --- WHAT A RECEIPT DOES AND DOES NOT CLAIM (read this before consuming one) ---
//
// These bounds are stated here because a consumer that over-reads a receipt
// rebuilds the very over-claim this module exists to prevent.
//
//   * SCOPE IS THE TASK, NOT THE RUN. The run identity is a stable function of the
//     workspace binding and the task id — it carries no per-run nonce, because
//     nothing in the resolver's observable state marks where one run of a task
//     ends and the next begins. A receipt therefore proves "this phase completed
//     for this task in this workspace, at `issuedAt`" — NOT "during the run you
//     are currently evaluating". A consumer that needs run scope must window on
//     `issuedAt`; that policy belongs to the consumer, and `issuedAt` is carried
//     on every matched record precisely so it can.
//
//   * AN ARTIFACT-LESS RECEIPT IS WEAKER, AND SAYS SO. Five of the seven
//     receipt-bearing phases write an artifact the resolver reads and digests
//     itself, so their receipts are `artifact-backed`: the resolver observed
//     something the caller did not supply. The two delivery-ceremony skills write
//     no such artifact, so their receipts are `invocation-only` — they attest that
//     the skill reached its completion point and invoked the resolver there, which
//     is strictly weaker than "the ceremony succeeded". `evidenceClass` carries
//     that distinction on every record so a consumer can weight the two
//     differently rather than being silently told they are the same.
//
//   * VERIFIABILITY IS SCOPED TO THE ISSUING WORKSPACE. Both the run identity and
//     the issuer binding are keyed on the resolved workspace root. A receipt filed
//     from an isolated worktree is therefore not matchable from a different
//     checkout of the same repository. Re-anchoring on the worktree family is a
//     resolver-boundary question owned by the worktree-isolation work, not a
//     property to change here.
//
//   * THE LEDGER IS APPEND-ONLY AND BOUNDED. A re-run appends rather than
//     replacing, so a phase run twice files two receipts; `provenPhases`
//     de-duplicates, so a verdict is unaffected. Growth is bounded by
//     `MAX_RUN_EVIDENCE_RECORDS` and a further append is refused with a stated
//     reason rather than growing without limit.
//
//   * THE RECORDING TOOL IS CALLABLE BY THE AGENT BEING ATTESTED, so a record is
//     NOT a proof that the work happened. It proves that the RESOLVER — not the
//     caller — digested the named artifact, stamped the identity, sequence and
//     clock, observed the run mode, and sealed the result. That defeats a
//     hand-written receipt-shaped file and binds the record to bytes a later
//     reader can re-check; it does not make the record unforgeable, and no prose
//     built on this module may say that it does.
//
//   * A GATE APPROVAL AND A PHASE RECEIPT ARE DIFFERENT CLAIMS (WF-493). A
//     `gate-approval` says a named artifact was approved at a GATE before the next
//     phase began; a `phase-receipt` says a PHASE completed. Neither satisfies the
//     other's requirement, which is why `provenPhases` filters on the kind rather
//     than on the subject: counting an approval as a receipt would readmit exactly
//     the agent-authored evidence this module exists to exclude.
//
//   * FRESHNESS IS A READ-TIME FACT, NOT A SEALED ONE (WF-493). The seal proves
//     what the artifact's bytes were AT ISSUE and says nothing about what they are
//     now, so "has the approved artifact since changed" can only be answered by
//     re-observing. `classifyArtifactState` does that against a freshly supplied
//     digest, and its result is deliberately OUTSIDE the seal — sealing a function
//     of mutable state would report the first legitimate edit as forgery.
//
//   * THE RUN MODE IS OBSERVED, SEALED, AND FAILS CLOSED (WF-493). It is never a
//     caller input: the service reads it from a signal the resolver process holds
//     and the requesting agent cannot reach, and an absent or unrecognized signal
//     is `unestablished` rather than a guess in either direction. Sealing it is
//     what makes "which mode was this issued under" durable rather than a
//     transient claim about the record. It is a LABEL PLACED OUT OF THE DISPATCHED
//     AGENT'S HANDS, not an authenticated assertion — an operator who declares it
//     falsely gets a falsely-labelled record.

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sha256Hex } from "./fingerprint.js";

// ---------------------------------------------------------------------------
// Frozen version, destinations and vocabulary
// ---------------------------------------------------------------------------

/**
 * The only run-evidence ledger version this release understands.
 *
 * BUMPED TO 2 BY WF-493, and the bump is forced rather than chosen: the observed
 * run mode joins the canonical sealed body, so every version-1 seal is computed
 * over a strictly smaller field set and can never verify here. Silently reading a
 * v1 ledger would therefore reclassify genuine records as `record-inadmissible` —
 * `matchRunEvidence`'s admissibility gate rejects an empty/absent `runMode` BEFORE
 * the seal is even recomputed, so a v1 record never reaches the seal comparison at
 * all. That is a distinct outcome from `seal-mismatch`, but the refusal argument is
 * unchanged (arguably stronger: the ledger is rejected on shape, not merely on a
 * digest that happens not to verify). The reader already refuses an unsupported
 * version with a stated reason, so the degradation is honest and no data is
 * destroyed.
 */
export const RUN_EVIDENCE_FORMAT_VERSION = 2 as const;

/** The declared committed artifact class. `.wf/` is not a general writable home —
 *  authority comes from the resolver's lifecycle ownership PLUS this declared
 *  class, never from the path prefix. */
export const RUN_EVIDENCE_DIR = ".wf/run-evidence" as const;

/**
 * The machine-local issuer binding, relative to a MACHINE-LOCAL home OUTSIDE the
 * audited workspace.
 *
 * OUTSIDE IS THE WHOLE POINT. The seal defends against a dispatched agent that can
 * read and write the workspace; a key stored inside that workspace would be one
 * file read away from a forged receipt, since the canonical body and the seal
 * algorithm are public in-repo source. Keeping the binding out of the workspace is
 * what leaves the agent no key to read. It is also never served through any
 * resolver tool, never logged, and never named in a skill body.
 */
export const RUN_EVIDENCE_ISSUER_DIR = ".wf-run-evidence" as const;

/** Bound on one ledger's records. A legitimate run files at most the seven phase
 *  receipts plus a small number of gate approvals, so this is generous by orders
 *  of magnitude while still refusing unbounded growth driven by repeated calls. */
export const MAX_RUN_EVIDENCE_RECORDS = 512;

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

/** The record kinds that travel this one emission path. `phase-receipt` is
 *  WF-490's own; `gate-approval`, added by WF-493, is now actively issued for the
 *  per-gate self-approval records — both kinds write into this same class rather
 *  than either inventing a second route. A gate approval is a claim about a GATE,
 *  not a phase, so its subject is not constrained to the receipt-bearing set. */
export const RUN_EVIDENCE_KINDS = ["phase-receipt", "gate-approval"] as const;
export type RunEvidenceKind = (typeof RUN_EVIDENCE_KINDS)[number];

/** How much the resolver itself observed. See the header's "what a receipt does
 *  and does not claim". */
export type RunEvidenceClass = "artifact-backed" | "invocation-only";

/**
 * The run's attendance mode, AS THE RESOLVER OBSERVED IT (WF-493).
 *
 * The amended process article says a gate may be satisfied by a recorded
 * self-approval only in an unattended run, and that the run's unattended mode is
 * NOT THE REQUESTING AGENT'S TO ASSERT. So this is never a caller input: the
 * service derives it from a signal the resolver process holds and the requesting
 * agent cannot reach, and an absent or unrecognized signal is `unestablished`
 * rather than a guess in either direction.
 *
 * It is SEALED INTO THE BODY, not merely reported alongside it. A mode returned
 * only in a response would be gone the moment the record is read back by anyone
 * else, leaving the very clause it exists to answer uncheckable; sealing it makes
 * "which mode was this approval issued under" a durable, verifiable property of
 * the record rather than a transient claim about it.
 */
export const RUN_EVIDENCE_RUN_MODES = ["unattended", "attended", "unestablished"] as const;
export type RunEvidenceRunMode = (typeof RUN_EVIDENCE_RUN_MODES)[number];

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

/** Bind a record to its workspace WITHOUT persisting the host path.
 *
 *  The binding property only needs a value that differs per workspace; the literal
 *  absolute root would additionally write local usernames and directory layout
 *  into an artifact class a project may choose to track. A digest keeps the
 *  binding and drops the leak. */
export function workspaceFingerprint(workspaceRoot: string): string {
  return sha256Hex(JSON.stringify(["run-evidence-workspace", workspaceRoot]));
}

/** The run identity — see the header's SCOPE IS THE TASK, NOT THE RUN. */
export function runEvidenceRunId(workspaceRoot: string, taskId: string): string {
  return sha256Hex(
    JSON.stringify(["run-evidence-run", workspaceFingerprint(workspaceRoot), taskId]),
  ).slice(0, 32);
}

/** The machine-local issuer binding's path within the machine-local home. Keyed on
 *  the workspace fingerprint so two checkouts never share a key. */
export function runEvidenceIssuerRelPath(workspaceRoot: string): string {
  return `${RUN_EVIDENCE_ISSUER_DIR}/issuer-${workspaceFingerprint(workspaceRoot).slice(0, 32)}.json`;
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
  /** A digest of the issuing workspace root — the binding, without the host path. */
  workspaceFingerprint: string;
  issuedAt: string;
  sequence: number;
  artifact: RunEvidenceArtifact | null;
  /** Derived from `artifact`, sealed alongside it so it cannot be edited after the
   *  fact to make an invocation-only receipt look artifact-backed. */
  evidenceClass: RunEvidenceClass;
  /** The run mode the RESOLVER observed when it issued this record — never what
   *  the caller said it was. Sealed for the same reason `evidenceClass` is. */
  runMode: RunEvidenceRunMode;
  /** The keyed digest over every field above. This is the whole mechanism: a
   *  record written by anything other than the issuer carries no valid seal. */
  seal: string;
}

/** A record exactly as it appeared on disk. `kind` is a bare `string` because the
 *  parse path deliberately does NOT validate it (module rule 2) — keeping the
 *  union off this type is what stops `RunEvidenceRecord` from lying about a
 *  guarantee the parser never checked. */
export type RawRunEvidenceRecord = Omit<
  RunEvidenceRecord,
  "kind" | "evidenceClass" | "runMode"
> & {
  kind: string;
  evidenceClass: string;
  runMode: string;
};

export interface RunEvidenceLedger {
  formatVersion: number;
  runId: string;
  records: RawRunEvidenceRecord[];
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
    ["workspaceFingerprint", body.workspaceFingerprint],
    ["issuedAt", body.issuedAt],
    ["sequence", body.sequence],
    ["evidenceClass", body.evidenceClass],
    ["runMode", body.runMode],
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
  workspaceFingerprint: string;
  issuedAt: string;
  sequence: number;
  artifact: RunEvidenceArtifact | null;
  /** Supplied by the SERVICE from its own observation, never forwarded from a
   *  tool caller — see `RunEvidenceRunMode`. */
  runMode: RunEvidenceRunMode;
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
  if (!(RUN_EVIDENCE_RUN_MODES as readonly string[]).includes(inputs.runMode)) return null;
  if (!isAdmissibleSubject(inputs.kind, inputs.subject)) return null;
  if (!TASK_ID_RE.test(inputs.taskId)) return null;
  if (!RUN_ID_RE.test(inputs.runId)) return null;
  if (!HEX64_RE.test(inputs.workspaceFingerprint)) return null;
  if (!nonEmpty(inputs.issuedAt)) return null;
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
    workspaceFingerprint: inputs.workspaceFingerprint,
    issuedAt: inputs.issuedAt,
    sequence: inputs.sequence,
    artifact,
    evidenceClass: artifact === null ? "invocation-only" : "artifact-backed",
    runMode: inputs.runMode,
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
 * takes the seal as found and lets the matcher judge it. The return type is
 * `RawRunEvidenceRecord` precisely because nothing here validates `kind` or
 * `evidenceClass`.
 *
 * Returns `null` for a record too malformed to even carry a subject; the caller
 * counts those rather than failing the ledger (rule 2 in the header).
 */
function readRecord(value: unknown): RawRunEvidenceRecord | null {
  const row = asRecord(value);
  if (row === null) return null;
  const artifact = readArtifact(row.artifact);
  if (artifact === "invalid") return null;
  const kind = row.kind;
  const subject = row.subject;
  if (typeof kind !== "string" || typeof subject !== "string") return null;
  return {
    kind,
    subject,
    taskId: typeof row.taskId === "string" ? row.taskId : "",
    runId: typeof row.runId === "string" ? row.runId : "",
    workspaceFingerprint:
      typeof row.workspaceFingerprint === "string" ? row.workspaceFingerprint : "",
    issuedAt: typeof row.issuedAt === "string" ? row.issuedAt : "",
    sequence:
      typeof row.sequence === "number" && Number.isInteger(row.sequence) ? row.sequence : -1,
    artifact,
    evidenceClass: typeof row.evidenceClass === "string" ? row.evidenceClass : "",
    runMode: typeof row.runMode === "string" ? row.runMode : "",
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
  // The run id is validated against its real shape, not merely for non-emptiness:
  // a ledger whose identity is unparseable can never be proved to answer any
  // reader's question, and admitting it would only defer the refusal.
  if (typeof root.runId !== "string" || !RUN_ID_RE.test(root.runId)) {
    return {
      status: "malformed",
      diagnostic: "the run-evidence ledger declares no well-formed `runId`.",
    };
  }
  if (!Array.isArray(root.records)) {
    return {
      status: "malformed",
      diagnostic: "the run-evidence ledger's `records` is not an array.",
    };
  }

  const records: RawRunEvidenceRecord[] = [];
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
  /** The record claims a different run than the ledger it sits in, or the ledger
   *  claims a different run than the reader asked about. */
  | "run-mismatch"
  /** The record attests a different task than the reader asked about. */
  | "task-mismatch";

export interface RunEvidenceMatch {
  record: RawRunEvidenceRecord;
  matched: boolean;
  reason: RunEvidenceUnmatchedReason | null;
}

/** What the reader asked about. Matching is judged against THIS, never against the
 *  ledger's own self-description alone. */
export interface RunEvidenceExpectation {
  runId: string;
  taskId: string;
}

/**
 * Classify every record as matched or unmatched, with a stated reason.
 *
 * EVERY branch that cannot PROVE the seal returns `matched: false` — missing
 * issuer, absent seal, inadmissible fields, a mismatched digest, a record claiming
 * a run other than its ledger's, and a ledger or record that does not answer the
 * question the reader actually asked. Ambiguity retains and never grants
 * authority: there is no "probably a receipt".
 *
 * THE EXPECTATION IS NOT OPTIONAL, and the reason is a real attack. The
 * destination path is derivable by anyone who can read the source, and every
 * record in a genuine ledger carries a genuine seal — so COPYING one task's
 * ledger onto another task's destination would, without this check, hand the
 * second task the first task's proven phases. A seal proves who ISSUED a record;
 * only comparing against the expectation proves it answers THIS question.
 *
 * `issuerKey === null` is the whole-set case rather than a throw: a reader with no
 * binding must report that it proved nothing, not crash and not assume.
 */
export function matchRunEvidence(
  ledger: RunEvidenceLedger,
  issuerKey: string | null,
  expected: RunEvidenceExpectation,
): RunEvidenceMatch[] {
  return ledger.records.map((record) => {
    if (issuerKey === null || !HEX64_RE.test(issuerKey)) {
      return { record, matched: false, reason: "issuer-unavailable" as const };
    }
    if (!HEX64_RE.test(record.seal)) {
      return { record, matched: false, reason: "seal-absent" as const };
    }
    if (record.runId !== ledger.runId || ledger.runId !== expected.runId) {
      return { record, matched: false, reason: "run-mismatch" as const };
    }
    if (record.taskId !== expected.taskId) {
      return { record, matched: false, reason: "task-mismatch" as const };
    }
    const admissible =
      (RUN_EVIDENCE_KINDS as readonly string[]).includes(record.kind) &&
      isAdmissibleSubject(record.kind as RunEvidenceKind, record.subject) &&
      (record.evidenceClass === "artifact-backed" ||
        record.evidenceClass === "invocation-only") &&
      (RUN_EVIDENCE_RUN_MODES as readonly string[]).includes(record.runMode) &&
      TASK_ID_RE.test(record.taskId) &&
      RUN_ID_RE.test(record.runId) &&
      HEX64_RE.test(record.workspaceFingerprint) &&
      nonEmpty(record.issuedAt) &&
      Number.isInteger(record.sequence) &&
      record.sequence >= 0;
    if (!admissible) {
      return { record, matched: false, reason: "record-inadmissible" as const };
    }
    const expectedSeal = sealRunEvidenceBody(
      {
        kind: record.kind as RunEvidenceKind,
        subject: record.subject,
        taskId: record.taskId,
        runId: record.runId,
        workspaceFingerprint: record.workspaceFingerprint,
        issuedAt: record.issuedAt,
        sequence: record.sequence,
        artifact: record.artifact,
        evidenceClass: record.evidenceClass as RunEvidenceClass,
        runMode: record.runMode as RunEvidenceRunMode,
      },
      issuerKey,
    );
    if (expectedSeal === null || !sealEquals(expectedSeal, record.seal)) {
      return { record, matched: false, reason: "seal-mismatch" as const };
    }
    return { record, matched: true, reason: null };
  });
}

/** The receipt-bearing phases a run has PROVEN, in the closed set's own order.
 *  Derived only from matched `phase-receipt` records — an unmatched record
 *  contributes nothing, which is the whole point. De-duplicating is what keeps a
 *  verdict correct when an append-only ledger carries a phase twice. */
export function provenPhases(matches: readonly RunEvidenceMatch[]): ReceiptBearingPhase[] {
  const proven = new Set(
    matches
      .filter((match) => match.matched && match.record.kind === "phase-receipt")
      .map((match) => match.record.subject),
  );
  return RECEIPT_BEARING_PHASES.filter((phase) => proven.has(phase));
}

// ---------------------------------------------------------------------------
// Artifact freshness — the "has since changed" test (WF-493)
// ---------------------------------------------------------------------------

/**
 * How the approved artifact stands NOW, relative to the digest sealed into the
 * record when it was issued.
 *
 * `n/a` is a distinct value rather than a null, because "this record never named
 * an artifact" and "this record's artifact could not be checked" are different
 * facts and collapsing them would let an invocation-only record read as an
 * unchanged artifact-backed one.
 */
export type RunEvidenceArtifactState = "fresh" | "stale" | "missing" | "n/a";

/**
 * Classify one record's artifact against a freshly observed digest.
 *
 * WHY THIS EXISTS. The amended process article invalidates an approval "whose
 * approved artifact has since changed". Nothing in the issued record can answer
 * that on its own — the seal proves what the bytes were AT ISSUE, and says
 * nothing about what they are now. So the check has to re-observe, and the
 * re-observation has to happen where the caller cannot influence it.
 *
 * DELIBERATELY NOT SEALED, and this is the one place that asymmetry matters:
 * every other field on the record is a fact frozen at issue, but freshness is a
 * function of mutable state that can differ on two reads a second apart. Sealing
 * it would assert permanence for something inherently impermanent, and the first
 * legitimate edit would present as forgery rather than as staleness.
 *
 * Pure, like everything else in this module: the caller performs the read and
 * hands in the digest (or `null` when the path no longer reads), so the whole
 * matrix is assertable without a filesystem.
 */
export function classifyArtifactState(
  artifact: RunEvidenceArtifact | null,
  observedSha256: string | null,
): RunEvidenceArtifactState {
  if (artifact === null) return "n/a";
  if (observedSha256 === null) return "missing";
  if (!HEX64_RE.test(observedSha256)) return "missing";
  return observedSha256 === artifact.sha256 ? "fresh" : "stale";
}

/**
 * Normalize the machine-supplied run-mode signal into the closed vocabulary.
 *
 * FAIL-CLOSED IN BOTH DIRECTIONS. An absent signal is `unestablished`, and so is
 * an unrecognized one — never `attended` and never `unattended`. Guessing
 * `unattended` would hand a self-approval the very authority the article withholds;
 * guessing `attended` would assert a human was present who was not. Only the exact
 * tokens are honoured, and the comparison is case-insensitive with surrounding
 * whitespace trimmed because a launcher-set environment value routinely carries both.
 *
 * `raw` is `string | null`, not `string | null | undefined`: the port contract
 * (`ResolverServicePorts.runModeSignal`) already returns `string | null`, and the
 * sole call site collapses an absent port to `null` before this runs — the same
 * two-value shape `parseRunEvidenceLedger` and `parseRunEvidenceIssuer` take.
 * Widening the parameter to accept `undefined` would admit a value no caller can
 * ever actually produce.
 */
export function normalizeRunModeSignal(raw: string | null): RunEvidenceRunMode {
  if (typeof raw !== "string") return "unestablished";
  const token = raw.trim().toLowerCase();
  if (token === "unattended") return "unattended";
  if (token === "attended") return "attended";
  return "unestablished";
}

// ---------------------------------------------------------------------------
// The issuer binding
// ---------------------------------------------------------------------------

/** The issuer binding's own version, SEPARATE from the ledger's `formatVersion`.
 *  They are two independently-evolving concepts: widening the ledger schema must
 *  not invalidate a machine's key (which would silently reclassify every receipt
 *  it ever issued as tampered), and rotating the key format must not require a
 *  ledger bump. Keying both to one constant would couple exactly that. */
export const RUN_EVIDENCE_ISSUER_VERSION = 1 as const;

export interface RunEvidenceIssuer {
  key: string;
}

/** Parse the machine-local issuer binding. Returns `null` on anything it cannot
 *  fully trust — an unparseable, wrong-version, or malformed binding proves
 *  nothing, and a reader with no key reports exactly that. The version check is a
 *  pure gate; the observed value is not echoed back, because a field that can
 *  never differ from the constant it was compared against tells a reader nothing. */
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
  if (row.issuerVersion !== RUN_EVIDENCE_ISSUER_VERSION) return null;
  if (typeof row.key !== "string" || !HEX64_RE.test(row.key)) return null;
  return { key: row.key };
}

/** Serialize a freshly minted issuer binding. */
export function serializeRunEvidenceIssuer(key: string): string {
  return `${JSON.stringify({ issuerVersion: RUN_EVIDENCE_ISSUER_VERSION, key }, null, 2)}\n`;
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
