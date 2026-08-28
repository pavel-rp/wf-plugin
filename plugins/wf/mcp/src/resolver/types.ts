// wf resolver — versioned snapshot schema (WF-269).
//
// The project-local resolution snapshot records ONLY paths, normalized
// metadata, source fingerprints, resolution diagnostics, and provenance — the
// facts a normal caller needs to resolve configuration and capabilities without
// re-reading files each boot. It NEVER stores a capability fragment body, a
// skill body, a prompt template, or any copied prompt text (charter invariant;
// consumer inventory §7). Consumers still follow a fragment's `dispatch` in
// their own isolated context.
//
// Field set derived from docs/resolver-consumer-inventory.md §7 "Minimum
// snapshot fields". Bump SNAPSHOT_SCHEMA_VERSION on any incompatible change to
// the shapes below.

/** Incompatible-change gate for a persisted snapshot. A reader rejects a
 *  snapshot whose `schemaVersion` differs from this value. Bumped to 2 in WF-329
 *  when the snapshot gained the per-slot provenance + settings-override index and
 *  the slot-contribution / slot-override / settings-override source fingerprints.
 *  Bumped to 3 in WF-334 when `_local/constitution.md` became a fingerprinted
 *  `constitution` source (so a project-clause edit invalidates the snapshot and
 *  the SessionStart hook serves the composed constitution under fingerprint
 *  discipline) — old snapshots lack that source and must rebuild to gain it.
 *  Bumped to 4 in WF-440 when capability records gained validated interview
 *  question metadata and profile-template source fingerprints. */
export const SNAPSHOT_SCHEMA_VERSION = 4;

/** Identity of the resolver runtime that stamps a snapshot. `version` is part of
 *  the freshness contract (WF-271): a snapshot built by a different resolver
 *  version is refreshed, so a runtime upgrade never serves a snapshot shaped by
 *  older resolution logic. Bump on any resolution-logic change that should
 *  invalidate previously persisted snapshots. */
export const RESOLVER_GENERATOR = { name: "wf-resolver", version: "0.4.1" } as const;

/** Project-local, gitignored cache location for the persisted snapshot,
 *  relative to the workspace root. `_local/` is already gitignored. */
export const SNAPSHOT_CACHE_RELPATH = "_local/resolver/snapshot.json";

/** A single deterministic source input that fed a snapshot, with its content
 *  fingerprint — the basis for freshness/recovery (WF-271 owns the refresh
 *  policy; WF-269 only records the fingerprints). */
export interface SourceFingerprint {
  /** What kind of input this is. */
  kind:
    | "wf-config"
    | "registry"
    | "core-config"
    | "manifest"
    /** A declared capability `profile.template.json` — hashed but never stored raw;
     * its validated `ask` metadata is normalized into `questions`. */
    | "profile-template"
    | "profile"
    | "plugin-list"
    /** A pack slot-contribution body (`<cap>/<inline-dispatch>`) — hashed, never
     *  stored, so editing a contribution invalidates the snapshot (WF-329). */
    | "slot-contribution"
    /** A personal `_local/slots/<skill>.<point>.md` slot override (WF-329). */
    | "slot-override"
    /** A committed `.wf/slots/<skill>.<point>.md` project slot override (WF-443)
     *  — hashed, never stored, so a committed project customization invalidates
     *  the snapshot exactly as a personal override does. */
    | "slot-project-override"
    /** A per-skill `_local/profiles/<skill>.settings.json` override (WF-329). */
    | "settings-override"
    /** The composed constitution record `_local/constitution.md` (WF-334) —
     *  hashed, never stored, so a project-clause edit (or a re-composed capability
     *  article set) invalidates the snapshot and the SessionStart hook serves the
     *  constitution under fingerprint discipline, never an un-fingerprinted read. */
    | "constitution";
  /** Normalized (forward-slash) path, workspace-relative where applicable, or a
   *  synthetic id (e.g. "claude plugin list --json") for non-file inputs. */
  path: string;
  /** sha256 hex of the raw bytes, or `null` when the input was absent. */
  sha256: string | null;
  /** Byte length of the raw content, or `null` when absent. */
  bytes: number | null;
  /** True when the input was present and read; false when absent (a recorded
   *  absence is itself a source fact). */
  present: boolean;
}

/** How a plugin-anchored path was resolved. */
export type Provenance = "recorded" | "self-healed" | "unrecoverable";

/** One fragment row of a capability manifest — metadata only, never the body. */
export interface FragmentRecord {
  phase: string;
  contributionKind: string;
  /** The raw `dispatch` token: `inline: <rel-path>` or `subagent: <agent>`. The
   *  body it points at is NOT read or stored here. */
  dispatch: string;
  /** Partition scope for `provider` (a surface token) / `artifact` (a
   *  source->target pair); `null` for unpartitioned kinds. */
  scope: string | null;
}

/** A constitution clause declared by a capability's `article:` manifest key —
 *  the clause identity and stance, not prose from any phase fragment. */
export interface ArticleRecord {
  key: string;
  value: string;
}

/** Deterministic declarative schema for one pack-owned project question. */
export type QuestionSchema =
  | {
      type: "string";
      minLength?: never;
      maxLength?: never;
      pattern?: never;
    }
  | {
      type: "string";
      minLength: number;
      maxLength: number;
      pattern?: string;
    }
  | { type: "boolean" }
  | { type: "integer"; minimum: number; maximum: number }
  | { type: "enum"; values: string[] };

/** Closed value set produced by successful question validation. */
export type QuestionValue = string | boolean | number;

/** One validated declaration from a profile template's ordered top-level `ask`
 * array. `pack` is the capability identity that owns the template. */
export interface QuestionDeclaration {
  pack: string;
  id: string;
  destination: string;
  prompt: string;
  schema: QuestionSchema;
  suggestedDefault?: QuestionValue;
}

/** Every value candidate passes through the same schema validator regardless of
 * provenance. Only `persisted` can make a question resolved. */
export type QuestionValueSource =
  | "suggested-default"
  | "pack-default"
  | "personal"
  | "persisted"
  | "proposed";

export interface QuestionDiagnostic {
  code: string;
  pack: string;
  question: string | null;
  field: string;
  message: string;
}

export type QuestionValueValidation =
  | { valid: true; source: QuestionValueSource; value: QuestionValue; diagnostics: [] }
  | {
      valid: false;
      source: QuestionValueSource;
      value: unknown;
      diagnostics: QuestionDiagnostic[];
    };

export interface QuestionSuggestion {
  source: "suggested-default" | "pack-default" | "personal";
  value: QuestionValue;
}

export type QuestionResolutionState =
  | {
      status: "unresolved";
      source: null;
      value: null;
      suggestions: QuestionSuggestion[];
    }
  | {
      status: "resolved";
      source: "persisted";
      value: QuestionValue;
      suggestions: QuestionSuggestion[];
    };

/** Body-free resolver metadata for one validated declaration and its value state. */
export interface QuestionRecord extends QuestionDeclaration {
  state: QuestionResolutionState;
}

export type QuestionDeclarationResult =
  | { ok: true; questions: QuestionRecord[]; diagnostics: [] }
  | { ok: false; questions: []; diagnostics: QuestionDiagnostic[] };

/** Closed semantic tuple for one pack-managed payload declaration. */
export type PayloadProduction = "copy";
export type PayloadRefresh = "replace-if-unmodified" | "retain";
export type PayloadRemoval = "delete-if-unmodified" | "retain";
export interface PayloadSemantics {
  production: PayloadProduction;
  refresh: PayloadRefresh;
  removal: PayloadRemoval;
}

/** One normalized, ordered payload row. Provenance is explicit and body-free. */
export interface PayloadDeclaration extends PayloadSemantics {
  pluginId: string;
  capability: string;
  source: string;
  destination: string;
}

export interface PayloadDiagnostic {
  code: string;
  pluginId: string;
  capability: string;
  row: number | null;
  field: "table" | "source" | "destination" | "production" | "refresh" | "removal";
  message: string;
}

export type PayloadDeclarationResult =
  | { ok: true; payloads: PayloadDeclaration[]; diagnostics: [] }
  | { ok: false; payloads: []; diagnostics: PayloadDiagnostic[] };

/** Result of descriptor-backed raw-byte fingerprinting beneath a capability root. */
export type ContainedFileFingerprintResult =
  | { status: "ok"; path: string; sha256: string; bytes: number }
  | {
      status: "missing" | "unsafe" | "too-large" | "unsupported" | "unreadable";
      path: string | null;
      sha256: null;
      bytes: null;
    };

/** Deterministically ordered path/hash evidence. Paths are pack-relative and hashes
 * are lowercase SHA-256 hex; neither field contains a source body. */
export interface PathHashRecord {
  path: string;
  sha256: string;
}

/** Portable identity committed with project lifecycle state. It deliberately has
 * no machine root, CLI path, timestamp, scope, or enablement field. */
export interface PortablePackEvidence {
  pluginId: string;
  version: string;
  capabilities: string[];
  manifestHashes: PathHashRecord[];
  declaredSourceHashes: PathHashRecord[];
}

/** Host-local facts. This record is stored only in `_local/install-state.json`. */
export interface MachineBindingEvidence {
  pluginId: string;
  canonicalRoot: string;
  cliScope: string | null;
  enablement: "enabled" | "disabled" | "unknown";
  observedVersion: string | null;
  localFingerprints: PathHashRecord[];
}

export interface ArtifactOwner {
  pluginId: string;
  capability: string;
  source: string;
}

/** Complete proof for one produced workspace artifact. */
export interface ArtifactEvidence extends PayloadSemantics {
  destination: string;
  owners: ArtifactOwner[];
  declaredSourceFingerprint: string;
  producedContentHash: string;
}

export type LedgerHome = "committed" | "local";
export type LedgerHomeResolution =
  | {
      ok: true;
      home: LedgerHome;
      portablePath: ".wf/install-state.json" | "_local/install-state.json";
      bindingPath: "_local/install-state.json";
    }
  | {
      ok: false;
      home: null;
      portablePath: null;
      bindingPath: "_local/install-state.json";
      diagnostic: string;
    };

export type LifecycleEvidenceComparison =
  | { state: "evidence-missing"; seedProposal: null; persisted: false }
  | { state: "portable-mismatch"; seedProposal: null; persisted: false }
  | { state: "binding-seed"; seedProposal: MachineBindingEvidence; persisted: false }
  | { state: "root-moved"; seedProposal: null; persisted: false }
  | { state: "local-mismatch"; seedProposal: null; persisted: false }
  | { state: "equal"; seedProposal: null; persisted: true };

export interface ArtifactAuthority {
  persist: boolean;
  replace: boolean;
  remove: boolean;
}

/** An active registry capability, resolved to metadata. */
export interface CapabilityRecord {
  /** Registry `Capability` column — identity only. */
  name: string;
  /** Raw registry `Path` value (repo-relative folder or `plugin:<p>/<rel>`). */
  registryPath: string;
  /** Normalized, resolved path to the capability folder (post-self-heal), or
   *  `null` when unrecoverable. */
  resolvedPath: string | null;
  /** Normalized path to the resolved `manifest.md`, or `null` when the manifest
   *  could not be read. */
  manifestPath: string | null;
  /** How the (plugin-anchored) path resolved; `recorded` for repo-relative. */
  provenance: Provenance;
  kind: string | null;
  fragments: FragmentRecord[];
  articles: ArticleRecord[];
  requires: string[];
  conflicts: string[];
  /** Normalized path declared by `profile-template:`, or `null`. */
  profileTemplatePath: string | null;
  /** Ordered, validated declarations plus effective persisted/suggestion state.
   * Empty when no questions are declared or the complete set failed validation. */
  questions: QuestionRecord[];
  /** `ok` when the manifest resolved and parsed; `unrecoverable` when the
   *  registered path yields no readable manifest. */
  validity: "ok" | "unrecoverable";
}

/** A `## Plugin Roots` mapping row, resolved. */
export interface PluginRootRecord {
  plugin: string;
  /** Normalized recorded root, or `null` when only recovered. */
  recordedRoot: string | null;
  /** Normalized effective root after self-heal, or `null` when unrecoverable. */
  resolvedRoot: string | null;
  provenance: Provenance;
}

/** The four explicit snapshot states an installed/registered pack can carry. */
export type PackState =
  | "active"
  | "installed/inactive"
  | "installed/disabled"
  | "registered/unrecoverable";

/** A pack record. `active`/`installed-*` records carry native plugin metadata
 *  from `claude plugin list --json`; a `registered/unrecoverable` record is
 *  synthesized for a registered capability whose plugin is not installed. */
export interface PackRecord {
  /** The plugin id (`<name>@<marketplace>`) from the CLI, or the bare plugin
   *  token for a synthesized `registered/unrecoverable` record. */
  pluginId: string;
  /** Left-of-`@` plugin name. */
  pluginName: string;
  version: string | null;
  scope: string | null;
  enablement: "enabled" | "disabled" | "unknown";
  /** Normalized installPath, or `null` for a not-installed registered pack. */
  installPath: string | null;
  state: PackState;
  /** Registry capability name(s) this pack provides, when registered. Empty for
   *  an installed/inactive pack (installed but not in the registry). */
  registeredCapabilities: string[];
  /** Diagnosis text for `registered/unrecoverable` records. */
  diagnostics: string | null;
}

/** The closed set of evidence-gated staleness overlays pack discovery may layer
 *  on top of an existing `PackState` (WF-446).
 *
 *  THIS IS NOT A FIFTH `PackState`. `PackState` keeps exactly its four members;
 *  the overlay is a SEPARATE nullable field, so a stale pack still reports the
 *  state it already had (`active`, `installed/disabled`, …) and staleness is
 *  additional information rather than a replacement classification. Collapsing
 *  the two would make "stale" mutually exclusive with "disabled", which it is
 *  not. */
export type PackStaleOverlay =
  | "pack/stale(source-changed)"
  | "pack/stale(root-moved)"
  | "pack/stale(evidence-missing)"
  | "pack/stale(binding-changed)";

/** How far the authoritative CLI inventory may be trusted for one discovery run.
 *  Derived FIRST-MATCH-WINS in this documented precedence:
 *
 *    `unavailable` → `malformed` → `invalid` → `partial` → `trustworthy`
 *
 *  - `unavailable`  — the CLI could not be run or errored; nothing was observed.
 *  - `malformed`    — whole-output contract failure (unparseable / not an array);
 *                     zero records, so the inventory says nothing at all.
 *  - `invalid`      — the output was readable but self-inconsistent: a duplicate
 *                     stable id or name, or a non-empty array in which every
 *                     record was rejected.
 *  - `partial`      — some records were rejected but at least one was accepted.
 *  - `trustworthy`  — read cleanly with no duplicates. A VALID EMPTY ARRAY is
 *                     trustworthy: "nothing is installed" is a real observation. */
export type DiscoveryConfidence =
  | "trustworthy"
  | "unavailable"
  | "malformed"
  | "partial"
  | "invalid";

/** One coded discovery finding. Structurally identical to (and assignable from)
 *  `PluginListContractIssue`, restated rather than imported so this module stays
 *  the dependency-free schema surface it has always been. */
export interface DiscoveryIssue {
  code: string;
  message: string;
}

/** One inventory-level or pack-level discovery finding. `pluginId` is `null` for
 *  a finding about the inventory as a whole rather than about one pack. */
export interface DiscoveryDiagnostic extends DiscoveryIssue {
  pluginId: string | null;
}

/** What the run observed about the authoritative inventory itself. */
export interface DiscoveryInventory {
  confidence: DiscoveryConfidence;
  /** True IF AND ONLY IF `confidence === "trustworthy"`. Only a trustworthy
   *  inventory may turn "this pack is not listed" into "this pack is orphaned";
   *  every other confidence means absence is unknown, not established. */
  mayEstablishAbsence: boolean;
  /** How many inventory records passed the CLI-output contract. */
  observedCount: number;
  /** The contract issues the inventory parse reported, in reported order. */
  issues: DiscoveryIssue[];
}

/** Whether a registered pack was seen in the inventory. `absence-indeterminate`
 *  is the explicit third state: the pack was not listed, but the inventory was
 *  not trustworthy enough for that silence to mean anything. */
export type PackPresence = "installed" | "orphaned" | "absence-indeterminate";

/** The lifecycle evidence discovery observed for one pack, alongside the
 *  comparison state it produced. Both fields are the OBSERVED values; the
 *  recorded values they were compared against live in the ledger. */
export interface DiscoveredPackEvidence {
  comparison: LifecycleEvidenceComparison["state"];
  portable: PortablePackEvidence | null;
  binding: MachineBindingEvidence | null;
}

/** One pack as discovery reports it: the existing `PackRecord` verbatim (its
 *  `state`, `enablement`, `registeredCapabilities`, and `diagnostics` are
 *  consumed, never re-derived) plus the discovery-only fields below.
 *
 *  Note `diagnostics` is INHERITED from `PackRecord` and keeps its existing
 *  meaning (diagnosis text for a `registered/unrecoverable` record). Discovery's
 *  own per-pack findings are not squeezed in here — they appear in the
 *  response-level `diagnostics` array, attributed by `pluginId`, so every
 *  finding sorts under one deterministic order. */
export interface DiscoveredPack extends PackRecord {
  /** The staleness overlay, or `null` when evidence is `equal` or a fresh
   *  binding seed. A total function of `evidence.comparison`. */
  overlay: PackStaleOverlay | null;
  presence: PackPresence;
  evidence: DiscoveredPackEvidence;
  /** A binding this run WOULD record, offered for a later mutator to persist.
   *  Discovery returns it and never writes it. */
  seedProposal: MachineBindingEvidence | null;
  /** The pack's declared questions across its capabilities, in declared order. */
  questions: QuestionRecord[];
  /** Whether the pack is available to act on. A staleness overlay does NOT
   *  clear this: a legacy registration stays selected and operational. */
  selectable: boolean;
}

/** The `discover_packs` response. Deterministic: `packs` is ordered by ascending
 *  `pluginId` and `diagnostics` by `(pluginId, code, message)`, both under
 *  `localeCompare`, so two runs over identical inputs are deep-equal. */
export interface DiscoverPacksResponse {
  /** The admitted workspace root, consumed as given — never re-derived. */
  workspaceRoot: string;
  inventory: DiscoveryInventory;
  packs: DiscoveredPack[];
  diagnostics: DiscoveryDiagnostic[];
  /** Crash recovery, reported SEPARATELY from everything above (WF-451).
   *
   *  This is the one field in the response that can describe a WRITE. Discovery
   *  itself remains byte-inert; when `recovery.wroteBytes` is `true` it was
   *  RECOVERY that wrote, and discovery's byte-inertness is asserted from the
   *  recovered baseline onward — never from process start. Keeping it a distinct
   *  block rather than folding it into `diagnostics` is what stops a later reader
   *  mistaking a recovery write for a discovery write. */
  recovery: RecoveryReport;
}

// ---------------------------------------------------------------------------
// The shared lifecycle transaction protocol (WF-451)
// ---------------------------------------------------------------------------
//
// WF-451 SOLELY OWNS these shapes: the lock, the versioned machine-local
// journal, its backups, the last-written identity, and the recovery report.
// Later lifecycle items (planning recovery, the first journaled transaction,
// apply, repair) CONSUME them and must not fill a gap by inventing a parallel
// shape. The journal is versioned from day one precisely so a later release can
// widen it without a reader ever best-effort-parsing a version it predates.

/** Whether a destination existed before the interrupted transaction touched it. */
export type PriorExistence = "present" | "absent";

/** The identity of the bytes an interrupted transaction LAST WROTE to one
 *  destination. It is what separates "these are our bytes, still untouched" from
 *  "someone edited this after us" — the single fact that makes a fail-safe
 *  restore decidable without ever comparing against a guess. */
export interface LastWrittenIdentity {
  /** SHA-256, lowercase hex, of the bytes the transaction wrote. */
  contentHash: string;
  /** Byte length of those bytes. Compared alongside the digest so a length
   *  mismatch is caught even in the impossible-collision case. */
  bytes: number;
}

/** One destination inside one interrupted transaction. */
export interface JournalEntry {
  /** The declared workspace-relative destination, verbatim. */
  destination: string;
  priorExistence: PriorExistence;
  /** SHA-256 of the prior bytes. `null` IF AND ONLY IF `priorExistence` is
   *  `absent` — there are no prior bytes to hash. */
  priorContentHash: string | null;
  /** Whether the prior path was a symbolic link. A link's identity is not its
   *  content, so recovery never restores one; it preserves it. */
  priorIsSymlink: boolean;
  /** Workspace-relative path of the machine-local backup holding the prior
   *  bytes, or `null` when there were none to back up. */
  backupPath: string | null;
  /** What the transaction last wrote here, or `null` when it never got that far. */
  lastWritten: LastWrittenIdentity | null;
  /** `true` when this transaction's intended END STATE for the destination is
   *  ABSENCE — a journaled removal (WF-458).
   *
   *  ADDITIVE AND DEFAULT-`false`, deliberately. `LastWrittenIdentity` requires a
   *  well-formed SHA-256 and a byte count, so absence is not expressible through
   *  it: without this flag a removal leaves a `present` prior facing an `absent`
   *  observation, which `decideEntryRecovery` resolves as `external-edit` and
   *  PRESERVES — meaning a deleted file would never be restored on any crash path.
   *  Because the default is `false`, every journal written before this field
   *  existed decides byte-identically, so `LIFECYCLE_JOURNAL_VERSION` is NOT
   *  bumped and an in-flight v1 journal keeps recovering exactly as before. */
  removesDestination: boolean;
}

/** One interrupted transaction, as the machine-local journal records it. */
export interface TransactionJournal {
  /** The only value this release understands is `1`. Any other value is
   *  `unsupported` — a STOP, never a best-effort parse. */
  journalVersion: number;
  transactionId: string;
  startedAt: string;
  entries: JournalEntry[];
}

/** The four journal-parse outcomes. `unsupported` and `malformed` are BOTH
 *  fail-safe stops that write nothing; they are separate tokens because they
 *  point a maintainer at different remedies. */
export type JournalParseResult =
  | { status: "absent" }
  | { status: "ok"; journal: TransactionJournal }
  | { status: "malformed"; diagnostic: string }
  | { status: "unsupported"; observedVersion: number | null; diagnostic: string };

/** What recovery decided for one destination. `restored` and `alreadyRestored`
 *  are the only two dispositions that resolve an entry; `preserved` and
 *  `unresolved` both leave work outstanding, which retains the journal and stops
 *  discovery. */
export type RecoveryDisposition =
  | "restored"
  | "already-restored"
  | "preserved"
  | "unresolved";

/** The CLOSED reason vocabulary. Every entry carries exactly one token, so a
 *  report is machine-readable and no outcome is explained only in prose. */
export type RecoveryReason =
  // restored
  | "restored-content"
  | "restored-absence"
  // already-restored (the idempotence guard observed prior state in place)
  | "already-prior-content"
  | "already-prior-absence"
  // preserved — ambiguity RETAINS; it never grants authority to write
  | "external-edit"
  | "symlink-conflict"
  // unresolved — recovery could not prove what to write, so it wrote nothing
  | "target-not-contained"
  | "backup-missing"
  | "backup-mismatch"
  | "observation-failed"
  | "restore-failed";

/** One destination's recovery outcome. */
export interface RecoveryEntryOutcome {
  destination: string;
  disposition: RecoveryDisposition;
  reason: RecoveryReason;
  /** Human-readable detail. Never load-bearing: every decision is carried by
   *  `disposition` + `reason`. */
  detail: string;
}

/** The overall state of one recovery attempt.
 *
 *  - `no-journal`       — nothing to recover; the run is byte-inert.
 *  - `recovered`        — every entry resolved; the journal was discarded.
 *  - `incomplete`       — something was preserved or unresolved; the journal is
 *                         RETAINED and discovery does not proceed.
 *  - `unsupported`      — a journal version this release does not understand.
 *  - `malformed`        — a journal that could not be read as this schema.
 *  - `lock-unavailable` — another holder has the exclusive lock.
 *  - `invalid-root`     — the workspace root was not admitted (WF-445). */
export type RecoveryState =
  | "no-journal"
  | "recovered"
  | "incomplete"
  | "unsupported"
  | "malformed"
  | "lock-unavailable"
  | "invalid-root";

/** The recovery report — the separate channel every recovery write is reported
 *  through. */
export interface RecoveryReport {
  state: RecoveryState;
  /** Whether the caller may go on to READ lifecycle state. `true` only for
   *  `no-journal` and `recovered`; every other state stops the caller before it
   *  reads anything inconsistent. */
  proceeded: boolean;
  /** The explicit statement that RECOVERY wrote. Byte-inertness is asserted from
   *  the recovered baseline, so this flag is how a reader knows the baseline
   *  moved. `false` on every fail-safe stop. */
  wroteBytes: boolean;
  journalVersion: number | null;
  transactionId: string | null;
  restored: RecoveryEntryOutcome[];
  alreadyRestored: RecoveryEntryOutcome[];
  preserved: RecoveryEntryOutcome[];
  unresolved: RecoveryEntryOutcome[];
  diagnostics: DiscoveryIssue[];
}

// ---------------------------------------------------------------------------
// The public planner envelope (WF-447)
// ---------------------------------------------------------------------------
//
// THIS IS THE SOLE PUBLIC PLAN-RESPONSE LINEAGE. Every later planning slice —
// payload safety, evidence-safe removal/upgrade, complete-plan review, and the
// apply path that consumes a plan — extends the shapes below rather than
// introducing a second response family. Adding a field is additive and does NOT
// re-version; `PLAN_ENVELOPE_VERSION` bumps only when an existing field's shape
// or meaning breaks.
//
// Only the slots this slice needs are pinned. Deliberately absent (and owned by
// later items): payload safety, artifact eligibility, repair identity, apply
// results, lock/transaction state.

/** Frozen version of the public planner envelope. */
export const PLAN_ENVELOPE_VERSION = 1;

/** Why a plan is or is not executable. FIRST MATCH WINS in this precedence:
 *
 *    `invalid-root` → `unrecovered` → `not-applicable` → `blocked` → `no-change`
 *    → `applicable`
 *
 *  - `invalid-root`   — the declared workspace root was not admitted; nothing
 *                       was read and nothing was classified.
 *  - `unrecovered`    — an interrupted transaction could not be fully recovered
 *                       before entry (WF-452), so NO lifecycle state was read and
 *                       no plan was generated. Deliberately its OWN token rather
 *                       than `not-applicable`: that token asserts something about
 *                       the SELECTION, which was never classified here, and
 *                       `invalid-root` would assert something false about
 *                       admission. Reporting a plausible neighbouring class
 *                       instead of the precise one is exactly the failure the
 *                       recovery report's closed reason vocabulary exists to
 *                       prevent.
 *  - `not-applicable` — a structural error finding (unsatisfied dependency,
 *                       capability conflict, provider overlap, contradictory or
 *                       unknown selection, or incomplete legacy proof). The plan
 *                       cannot be made executable by supplying an answer.
 *  - `blocked`        — every structural condition holds but at least one
 *                       required project answer is missing or invalid.
 *  - `no-change`      — the selection is already satisfied: nothing would be
 *                       added, deregistered, answered, or seeded.
 *  - `applicable`     — the delta is executable once a mutator exists.
 *
 *  `invalid-root` outranks `unrecovered` because admission fails BEFORE any
 *  root-bound port — and therefore before any recovery port — exists. */
export type PlanApplicability =
  | "applicable"
  | "no-change"
  | "blocked"
  | "not-applicable"
  | "unrecovered"
  | "invalid-root";

/** The admitted-root state, carrying WF-445's closed reason token verbatim on
 *  failure. Planning binds to that one canonical value and never re-derives a
 *  root of its own. `source` and `reason` are typed as plain strings here to keep
 *  this module the dependency-free schema surface it has always been; the values
 *  are exactly `WorkspaceRootSource` / `WorkspaceAdmissionReason`. */
export type PlanAdmissionState =
  | { admitted: true; root: string; source: string; reason: null; diagnostic: null }
  | { admitted: false; root: null; source: string; reason: string; diagnostic: string };

/** Why one pack lands in the delta bucket it does.
 *
 *  Note there is NO implicit-removal reason. Omission from the desired set is a
 *  retention (`retained-by-omission`), which is what makes "an orphaned or
 *  disabled registration can never become an implicit removal" mechanically true
 *  rather than a convention: removal has its own explicit input. */
export type PlanRegistryReason =
  /** Selected and not yet registered — the plan would register it. */
  | "selected-addition"
  /** Selected and already registered — no registry change. */
  | "selected-retention"
  /** Registered, not selected, and not explicitly deregistered. */
  | "retained-by-omission"
  /** Registered but absent from a trustworthy inventory. Stays visible. */
  | "retained-orphaned"
  /** Registered and not listed, but the inventory could not establish absence. */
  | "retained-absence-indeterminate"
  /** Acted on with incomplete legacy proof — registration is PRESERVED, even
   *  when the pack was explicitly deregistered. */
  | "retained-legacy-proof-incomplete"
  /** Acted on with a fresh-machine-binding comparison but NO binding proposal,
   *  so the missing-binding action's proof predicate is not satisfied.
   *  Registration is PRESERVED, exactly as for incomplete legacy proof — the
   *  same fail-safe direction, stated explicitly instead of degrading into a
   *  staleness warning that produced no action at all. */
  | "retained-binding-proof-incomplete"
  /** Named in the explicit deregistration set. The only removal path. */
  | "explicit-deregistration";

/** One pack's position in the previewed registry delta. The pack's own snapshot
 *  facts (`state`, `enablement`, `presence`, `overlay`) are carried verbatim from
 *  the discovery join and never re-derived. */
export interface PlanRegistryEntry {
  pluginId: string;
  pluginName: string;
  /** Registered capability names for a retention/deregistration; the pack's
   *  declared capability names for an addition. Sorted. */
  capabilities: string[];
  reason: PlanRegistryReason;
  presence: PackPresence;
  state: PackState;
  enablement: PackRecord["enablement"];
  overlay: PackStaleOverlay | null;
}

/** The previewed registry delta. Each array is sorted by ascending `pluginId`. */
export interface PlanRegistryDelta {
  additions: PlanRegistryEntry[];
  retentions: PlanRegistryEntry[];
  deregistrations: PlanRegistryEntry[];
}

/** One project answer the plan WOULD write. `status` is always `pending`: a
 *  proposed answer is not persisted evidence, and planning never writes it. */
export interface PlanAnswerWrite {
  pluginId: string;
  /** The capability that declared the question. */
  pack: string;
  questionId: string;
  destination: string;
  value: QuestionValue;
  source: "proposed";
  status: "pending";
}

/** Why a declared question is still open. Both reasons block the plan. */
export type PlanUnresolvedReason = "missing-answer" | "invalid-proposed-answer";

/** One declared question the plan cannot satisfy, with the suggestions the
 *  resolver already computed. A suggestion is NOT a resolution — only a persisted
 *  value resolves a question — so a suggested default still leaves it open. */
export interface PlanUnresolvedQuestion {
  pluginId: string;
  pack: string;
  questionId: string;
  destination: string;
  prompt: string;
  reason: PlanUnresolvedReason;
  suggestions: QuestionSuggestion[];
}

/** The closed finding vocabulary for this slice. */
export type PlanFindingCode =
  /** A post-plan capability `requires` a capability the post-plan set lacks. */
  | "plan/dependency-unsatisfied"
  /** Two post-plan capabilities declare a conflict with each other. */
  | "plan/capability-conflict"
  /** Two post-plan capabilities claim the same partitioned provider surface. */
  | "plan/provider-overlap"
  /** A plugin id appears in both the desired and the deregistration set. */
  | "plan/contradictory-selection"
  /** A selected plugin id matches no pack the resolver knows about. */
  | "plan/unknown-selection"
  /** A selected pack is disabled, so it cannot be registered. */
  | "plan/not-selectable"
  /** A registered pack is absent from a trustworthy inventory. */
  | "plan/orphaned-registration"
  /** A registered pack is not listed, but absence could not be established. */
  | "plan/absence-indeterminate"
  /** An acted-on pack's lifecycle evidence compares as drifted. */
  | "plan/stale-evidence"
  /** An acted-on pack has no recorded evidence AND incomplete observed proof. */
  | "plan/legacy-proof-incomplete"
  /** A legacy bootstrap seed is previewable from complete proof. */
  | "plan/legacy-bootstrap-previewed"
  /** An acted-on pack compares as a fresh machine binding but carries no binding
   *  proposal, so the missing-binding action's exact proof predicate fails. */
  | "plan/binding-proof-incomplete"
  /** A proposed answer failed its declared schema. */
  | "plan/answer-invalid"
  /** A declared question has no persisted and no proposed answer. */
  | "plan/answer-missing"
  /** A declared payload destination is not a safe workspace-contained target. */
  | "plan/payload-unsafe-target"
  /** A declared payload source could not be fingerprinted, so no bytes exist. */
  | "plan/payload-source-unreadable"
  /** Co-owners of one target would produce different bytes. */
  | "plan/payload-conflict-bytes"
  /** Co-owners of one target declare different lifecycle semantics. */
  | "plan/payload-conflict-semantics"
  /** A managed artifact met every conjunctive condition for removal (WF-449). */
  | "plan/artifact-deletable"
  /** A managed artifact is retained; the message names the closed reason token. */
  | "plan/artifact-retained"
  /** A missing-ledger artifact's bootstrap is previewable from complete proof. */
  | "plan/artifact-bootstrap-previewed"
  /** A source-changed artifact advances — current bytes match the prior hash. */
  | "plan/artifact-advance"
  /** A source-changed artifact was locally edited, so it stays divergent. */
  | "plan/artifact-divergent"
  /** An interrupted transaction could not be fully recovered before entry, so no
   *  lifecycle state was read and no plan was generated (WF-452). Plan-level:
   *  `pluginId` is `null`, because the halt precedes any per-pack classification. */
  | "plan/halted-unrecovered"
  /** The pack inventory is not trustworthy enough to establish that anything is
   *  unowned, so a plan derived from it is NOT APPLICABLE (WF-460). Plan-level:
   *  `pluginId` is `null`, because the inventory is a whole-run fact.
   *
   *  ADDITIVE WITHIN THE ALREADY-FROZEN `finding` FACT CLASS, and deliberately
   *  not an envelope extension: `PLAN_ENVELOPE_VERSION`, `PLAN_ACTION_ORDER`, and
   *  `PLAN_IDENTITY_FACT_CLASSES` are all unchanged, and `plan_install` never
   *  emits this code — so every plan that could be produced before is produced
   *  byte-identically, down to its `planId`. Only the derived repair plan of
   *  WF-460 raises it. */
  | "plan/inventory-untrustworthy";

/** One planning finding. `pluginId` is `null` for a plan-level finding. */
export interface PlanFinding {
  code: PlanFindingCode;
  severity: "error" | "warning" | "info";
  pluginId: string | null;
  message: string;
}

/** What a seed proposal would establish. `binding-seed` is the ordinary
 *  first-run case (portable evidence matches, no machine binding recorded);
 *  `legacy-bootstrap` is the pre-ledger registration, previewable ONLY from
 *  complete observed proof. */
export type PlanEvidenceSeedKind = "binding-seed" | "legacy-bootstrap";

/** A reviewable seed proposal. `persisted` is the literal `false`: this record is
 *  RETURNED for review and never written, and typing the literal means a future
 *  writer cannot satisfy the shape by flipping a boolean. */
export interface PlanEvidenceSeed {
  pluginId: string;
  kind: PlanEvidenceSeedKind;
  comparison: LifecycleEvidenceComparison["state"];
  /** Observed portable evidence a bootstrap would record; `null` for a plain
   *  binding seed, whose portable evidence is already recorded. */
  portable: PortablePackEvidence | null;
  binding: MachineBindingEvidence;
  persisted: false;
}

// ---------------------------------------------------------------------------
// The payload slice of the planner envelope (WF-448)
// ---------------------------------------------------------------------------
//
// The additive payload extension the WF-447 header anticipated. It adds fields;
// it does NOT fork the response family and it does NOT re-version the envelope.
//
// TWO RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. CANONICALIZE BEFORE DECIDING, AND CREATE NOTHING WHILE DECIDING. A
//      destination is judged on its canonical form measured against the ONE
//      admitted workspace root (WF-445). Traversal, an absolute path, an
//      escaping symlink, and an out-of-workspace canonical target are each a
//      refusal — never a followed link, never a probe that materializes the very
//      path it is testing. Workspace containment is a DIFFERENT question from
//      plugin-root validation and never stands in for it.
//
//   2. CO-OWNERSHIP IS EXACT-EQUALITY-ONLY. Two capabilities may share one
//      target if and only if their produced bytes are identical AND their
//      generation, refresh, and removal semantics are field-for-field equal.
//      Any other difference blocks. There is deliberately no first-writer rule,
//      no registry-order tiebreak, and no model judgment: the outcome is a
//      function of the inputs alone, so permuting the declarations cannot
//      change it.

/** Why a declared payload destination is not a usable workspace target. A closed
 *  vocabulary — a reader may switch on it exhaustively. */
export type PlanPayloadRejection =
  /** A `..` segment. Rejected lexically, before any filesystem access. */
  | "traversal"
  /** A leading `/` or a drive prefix. Rejected lexically. */
  | "absolute"
  /** Empty, NUL, backslash, colon, or an empty / `.` segment. Rejected lexically. */
  | "malformed"
  /** Canonicalization traversed a symlink that leaves the admitted root. */
  | "symlink-escape"
  /** The canonical target is simply not beneath the admitted root. */
  | "out-of-workspace"
  /** The canonical target already exists and is not a regular file. */
  | "target-not-a-file"
  /** The containment probe could not reach a decision. Fails closed. */
  | "unresolvable";

/** One capability's claim on a payload destination. */
export interface PlanPayloadOwner {
  pluginId: string;
  capability: string;
  /** The capability-relative source the produced bytes come from. */
  source: string;
}

/** Byte identity of the produced payload. Never a body. */
export interface PlanPayloadIdentity {
  /** Lowercase SHA-256 hex of the bytes that would be written. */
  sha256: string;
  bytes: number;
}

/** One previewed payload write. Previewed only — nothing is written. */
export interface PlanPayloadAction {
  /** The declared workspace-relative destination, verbatim. */
  destination: string;
  /** The canonical absolute target, proven contained by the admitted root. */
  canonicalTarget: string;
  identity: PlanPayloadIdentity;
  /** The complete declared tuple: generation, refresh, and removal semantics. */
  semantics: PayloadSemantics;
  /** EVERY capability declaring this target, sorted. Never a first writer. */
  owners: PlanPayloadOwner[];
  /** What the write would do to the canonical target. */
  write: "create" | "overwrite";
}

/** One destination refused before any action could be formed. */
export interface PlanPayloadRejectedTarget {
  pluginId: string;
  capability: string;
  destination: string;
  rejection: PlanPayloadRejection;
}

/** Which axis of the exact-equality test a co-ownership collision failed. Both
 *  are reported independently, so a collision differing on both says so. */
export type PlanPayloadConflictKind = "bytes" | "semantics";

/** One blocking co-ownership collision. */
export interface PlanPayloadConflict {
  canonicalTarget: string;
  destination: string;
  kind: PlanPayloadConflictKind;
  owners: PlanPayloadOwner[];
}

/** The previewed payload effect. Every collection sorts on a stable key. */
export interface PlanPayloadPreview {
  actions: PlanPayloadAction[];
  rejected: PlanPayloadRejectedTarget[];
  conflicts: PlanPayloadConflict[];
}

// ---------------------------------------------------------------------------
// The evidence-safe removal/upgrade slice of the planner envelope (WF-449)
// ---------------------------------------------------------------------------
//
// The additive artifact extension the WF-447 header anticipated ("artifact
// eligibility"). It adds fields; it does NOT fork the response family and it
// does NOT re-version the envelope.
//
// THIS IS THE DESTRUCTIVE-AUTHORITY SLICE — it decides what may be DELETED.
// FOUR RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. DELETION ELIGIBILITY IS CONJUNCTIVE AND FAIL-SAFE. An artifact is
//      `deletable` only when explicit deselection AND a current-byte match
//      against the PRIOR LEDGER HASH AND exclusive recorded ownership all hold,
//      and the declared removal semantics permit it. Every missing, conflicting,
//      ambiguous, shared-incomplete, mismatching, or non-reproducible proof class
//      RETAINS the artifact and grants no deletion authority. Missing evidence
//      never infers permission.
//
//   2. BOOTSTRAP PERSISTS FUTURE AUTHORITY BUT NEVER DELETES IN THE SAME PLAN.
//      Proving ownership now does not license removing in the same breath, so a
//      deselected-and-bootstrappable artifact yields `bootstrap`, never
//      `deletable`. The two-step is deliberate.
//
//   3. UPGRADE IS HASH-GATED. A source-changed artifact advances only when the
//      current bytes still match the prior ledger hash. A locally edited file
//      stays `divergent` and NOT fully upgraded — never silently overwritten.
//
//   4. OWNERLESS PAYLOADS FOLLOW THE SAME RULES. An empty recorded owner set is
//      not "exclusive" ownership; it is incomplete ownership, and it grants
//      nothing. There is deliberately no special case that quietly confers
//      authority on an artifact nobody claims.

/** Which of the four decision forms one managed artifact takes. */
export type PlanArtifactForm = "deletable" | "retained" | "bootstrap" | "advance";

/** Why an artifact was NOT deleted. A closed vocabulary — a reader may switch on
 *  it exhaustively, and every non-deletable decision carries one, so a retention
 *  always states its reason. `null` only on the `deletable` form. */
export type PlanArtifactRetentionReason =
  /** The artifact's owners were not explicitly deselected. Omission never removes. */
  | "not-deselected"
  /** A recorded owner survives the plan — ownership is not exclusive. */
  | "shared-ownership"
  /** A pack that declares this destination RIGHT NOW is not in the recorded
   *  owner set and is not deselected by this plan, so the recorded set is known
   *  to be incomplete and exclusivity cannot be established from it (WF-476).
   *  Distinct from `shared-ownership`, which is about a recorded owner that
   *  SURVIVES: here no recorded owner survives, and the blocking declarer is by
   *  construction absent from the decision's `owners`. */
  | "unrecorded-declarer"
  /** The recorded owner set is empty or not fully resolvable (ownerless payload). */
  | "ownership-incomplete"
  /** Current bytes differ from the prior ledger hash — the file was edited. */
  | "current-bytes-mismatch"
  /** Current bytes could not be observed at all. */
  | "current-bytes-unreadable"
  /** A recorded or observed digest is not a well-formed SHA-256. A "match"
   *  between two malformed digests is not evidence, so it never supports a
   *  removal or an upgrade — the destructive path is held to at least the
   *  strictness of the bootstrap path. */
  | "digest-malformed"
  /** The destination failed the no-create workspace-containment test (WF-448). */
  | "destination-unsafe"
  /** The ledger has no entry for this destination and bootstrap is not applicable. */
  | "no-recorded-proof"
  /** Bootstrap blocked: the inventory may not establish absence (WF-446). */
  | "inventory-untrustworthy"
  /** Bootstrap blocked: observed bytes are not reproducible from the declaration. */
  | "not-reproducible"
  /** Bootstrap blocked: no valid declared-source fingerprint. */
  | "source-fingerprint-missing"
  /** Bootstrap blocked: the `{production, refresh, removal}` tuple is incomplete. */
  | "semantics-incomplete"
  /** The declared tuple says `removal: retain` — deletion is never authorized. */
  | "removal-semantics-retain"
  /** The declared tuple says `refresh: retain` — an upgrade is never authorized. */
  | "refresh-semantics-retain"
  /** Bootstrap and deselection coincided; bootstrap never deletes in the same plan. */
  | "bootstrap-defers-deletion"
  /** Upgrade path: the source changed but the file was locally edited. */
  | "divergent";

/** One managed artifact's previewed decision. Previewed only — nothing is
 *  written, which `persisted: false` states in the type system. */
export interface PlanArtifactDecision {
  /** The declared workspace-relative destination, verbatim. */
  destination: string;
  /** The canonical absolute target, or `null` when the destination was refused. */
  canonicalTarget: string | null;
  form: PlanArtifactForm;
  /** Why this artifact was not deleted. `null` IFF `form === "deletable"`. */
  reason: PlanArtifactRetentionReason | null;
  /** The RECORDED owner set, sorted. May be empty — an ownerless payload. */
  owners: ArtifactOwner[];
  /** The complete recorded (or, on the bootstrap path, declared) semantic tuple. */
  semantics: PayloadSemantics | null;
  /** The PRIOR ledger hash — the produced-content hash the ledger recorded. */
  recordedContentHash: string | null;
  /** The bytes observed at the canonical target right now. */
  currentContentHash: string | null;
  /** Whether the current bytes equal the prior ledger hash. */
  bytesMatchLedger: boolean;
  /** Deletion authority. The literal `false` on every form but `deletable`, so a
   *  future writer cannot satisfy the shape by flipping a boolean. */
  deletionAuthority: boolean;
  /** Whether an advance fully upgrades the artifact. `false` whenever divergent. */
  fullyUpgraded: boolean;
  /** Node-runner candidacy, surfaced in the SAME public plan rather than through a
   *  separate API: `true` exactly when this decision leaves the runner something
   *  to act on later (delete, bootstrap-persist, or advance). A pure retention is
   *  never a candidate. */
  runnerCandidate: boolean;
  /** Always the literal `false`: planning is byte-inert and persists nothing. */
  persisted: false;
}

/** The previewed artifact effect, bucketed by form. Every collection sorts on a
 *  stable key, so permuting the input facts cannot change the response. */
export interface PlanArtifactPreview {
  deletable: PlanArtifactDecision[];
  retained: PlanArtifactDecision[];
  bootstrap: PlanArtifactDecision[];
  advance: PlanArtifactDecision[];
}

// ---------------------------------------------------------------------------
// The complete-plan integration slice of the planner envelope (WF-450)
// ---------------------------------------------------------------------------
//
// THE CAPSTONE. It closes the envelope the WF-447 header opened and freezes the
// approved-plan identity every later mutator will trust as its sole authority.
// It adds fields; it does NOT fork the response family, it does NOT introduce a
// second schema, and it does NOT re-version the envelope — all eight lifecycle
// modes ride the same `planVersion: 1`.
//
// FOUR RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. ONE SCHEMA, ONE IDENTITY. Install, reconcile, bootstrap, deregistration,
//      deletion, upgrade, retained-divergence, and repair are MODES of this one
//      envelope, not response families. A reader switches on `mode`; it never
//      has to ask which shape it received.
//
//   2. THIS SLICE SOLELY OWNS THE SCHEMA. Neither the resolver's service layer
//      nor a downstream host may fill a missing field or arbitrate a finding.
//      Every field that can be absent states what absent MEANS in its own type:
//      `mode` is `null` on the `invalid-root` path and nowhere else, exactly as
//      `PlanArtifactDecision.reason` is `null` on the `deletable` form and
//      nowhere else.
//
//   3. NO BLOCKING CONDITION IS EVER A SILENT OMISSION. Every finding that
//      forces a non-applicable result, and every question that blocks, is
//      enumerated in `applicabilityBasis`. A reader never re-derives which input
//      did the blocking, and a predicate that fails says so with a finding
//      rather than by quietly producing no action.
//
//   4. IDENTITY IS A FUNCTION OF THE MUTATION-RELEVANT FACTS AND NOTHING ELSE.
//      It changes when any enumerated hash, semantic tuple, machine binding,
//      owner set, answer, destination, containment verdict, symlink rejection,
//      registry fact, or evidence fact changes — and it does NOT change when a
//      finding's human-readable message is reworded, because a reworded
//      diagnostic must never invalidate an already-approved plan. A no-change
//      plan therefore has a stable identity and zero mutating actions.

/** Which lifecycle shape one plan takes. All eight ride the SAME versioned
 *  envelope — there is deliberately no second schema and no `planVersion: 2`.
 *
 *  Derived from the plan's OWN content, never from a caller input, so a caller
 *  cannot assert a mode the facts do not support. FIRST MATCH WINS in the
 *  declaration order below, which is destructive-effect-first so the most
 *  review-worthy effect is the one that names the plan:
 *
 *    `deletion` → `deregistration` → `repair` → `bootstrap` → `upgrade`
 *      → `install` → `retained-divergence` → `reconcile`
 *
 *  `retained-divergence` deliberately sits below every effect-bearing mode: it
 *  describes a plan whose notable content IS the divergent retention, so a plan
 *  that also installs something is an `install`, not a divergence report. */
export type PlanMode =
  /** At least one managed artifact is eligible for removal. */
  | "deletion"
  /** At least one pack would be deregistered. */
  | "deregistration"
  /** At least one drifted lifecycle-evidence record would be re-established. */
  | "repair"
  /** At least one evidence seed or artifact bootstrap is previewed. */
  | "bootstrap"
  /** At least one managed artifact advances to a newer declared source. */
  | "upgrade"
  /** At least one pack would be registered. */
  | "install"
  /** Nothing above applies and at least one artifact is retained as divergent. */
  | "retained-divergence"
  /** The residual: the plan reconciles the workspace and nothing above applies. */
  | "reconcile";

/** Every action class one complete plan integrates. A closed vocabulary — a
 *  reader may switch on it exhaustively.
 *
 *  RETENTIONS APPEAR HERE TOO, as non-mutating actions. Retention is the
 *  fail-safe default of both the registry slice (omission never removes) and the
 *  destructive slice (missing evidence never infers permission), so a COMPLETE
 *  plan must show it. Modelling it as an action with `mutating: false`
 *  integrates it for review without ever making it executable. */
export type PlanActionKind =
  /** Re-establish a drifted lifecycle-evidence record. */
  | "evidence-repair"
  /** Record a binding seed or a legacy bootstrap for a pack. */
  | "evidence-seed"
  /** Register a selected pack's capabilities. */
  | "registry-add"
  /** Deregister an explicitly deselected pack's capabilities. */
  | "registry-deregister"
  /** Write a declared payload to a workspace-contained destination. */
  | "payload-write"
  /** Write a payload landing in the committed project-override tier. */
  | "override-write"
  /** Advance a managed artifact to its newer declared source. */
  | "artifact-advance"
  /** Persist future authority over a missing-ledger managed artifact. */
  | "artifact-bootstrap"
  /** Delete a managed artifact that met every conjunctive removal condition. */
  | "artifact-delete"
  /** Persist a validated proposed project answer. */
  | "answer-write"
  /** Recompose the project constitution because the capability set changes. */
  | "constitution-recompose"
  /** A registry entry that is retained. Changes nothing. */
  | "registry-retain"
  /** A managed artifact that is retained. Changes nothing. */
  | "artifact-retain";

/** One integrated action in the complete plan. Previewed only — `persisted` is
 *  the literal `false`, so a future writer cannot satisfy the shape by flipping
 *  a boolean. */
export interface PlanAction {
  kind: PlanActionKind;
  /** Dense 0-based ordinal assigned AFTER the canonical sort. Two runs over
   *  identical facts assign identical ordinals, and permuting the input facts
   *  cannot change one. */
  order: number;
  /** The pack this action is attributed to, or `null` for a plan-level action
   *  (the constitution recomposition is the only such action today). */
  pluginId: string | null;
  /** The workspace-relative destination this action would touch, or `null` when
   *  the action touches no single destination (a registry or evidence action). */
  destination: string | null;
  /** `true` when a mutator would change bytes or registry state. A retention is
   *  `false`: it is integrated for review and changes nothing. */
  mutating: boolean;
  /** A deterministic one-line summary. Never a body. */
  summary: string;
  persisted: false;
}

/** Which half of the lifecycle-evidence record a repair would re-establish. */
export type PlanRepairScope =
  /** The committed portable evidence disagrees with what is installed. */
  | "portable"
  /** The machine-local binding disagrees — the root moved, or the local
   *  fingerprints drifted. The committed portable half is untouched. */
  | "binding";

/** One previewed re-establishment of a DRIFTED lifecycle-evidence record.
 *
 *  Distinct from an evidence SEED: a seed records evidence where there is none,
 *  a repair corrects evidence that exists and disagrees. Before this slice a
 *  drifted comparison produced a `plan/stale-evidence` warning and no action at
 *  all, which is precisely what made the plan not repair-capable.
 *
 *  This is the repair ACTION as it appears in a plan. It is deliberately NOT a
 *  repair diagnosis entry point, which is a separate concern owned elsewhere. */
export interface PlanRepairAction {
  pluginId: string;
  comparison: LifecycleEvidenceComparison["state"];
  scope: PlanRepairScope;
  /** The staleness overlay discovery attributed to the pack, carried verbatim. */
  overlay: PackStaleOverlay | null;
  /** Always the literal `false`: planning is byte-inert and persists nothing. */
  persisted: false;
}

/** The EXPLICIT basis for the plan's applicability. No blocking condition is
 *  ever a silent omission: every finding that forced a non-applicable result and
 *  every question that blocked is enumerated here, so a reader never re-derives
 *  which input did the blocking and a downstream host never arbitrates. */
export interface PlanApplicabilityBasis {
  /** The same token the response's `applicability` carries, repeated so the
   *  basis is self-contained for a consumer that stores it alone. */
  applicability: PlanApplicability;
  /** Every `severity: "error"` finding, in the response's own finding order.
   *  Non-empty IMPLIES `applicability === "not-applicable"`. */
  blockingFindings: PlanFinding[];
  /** Every unresolved question, in the response's own question order. Non-empty
   *  alongside an empty `blockingFindings` IMPLIES `applicability === "blocked"`. */
  blockingQuestions: PlanUnresolvedQuestion[];
  /** `true` exactly when at least one of the two collections above is non-empty,
   *  so a reader never has to infer "blocked" from an empty array. */
  blocked: boolean;
}

/** The closed enumeration of fact classes the approved-plan identity is derived
 *  from. NOTHING outside this set may influence `planId`, and every member names
 *  a mutation-relevant fact a later mutator could act on. */
export type PlanIdentityFactClass =
  /** The frozen envelope version. */
  | "envelope-version"
  /** The admitted workspace root and its admission verdict — a plan for another
   *  root, or one that was never admitted, is another plan. */
  | "workspace-root"
  /** The derived lifecycle mode. */
  | "mode"
  /** The applicability token. */
  | "applicability"
  /** Whether discovery's inventory may establish absence (WF-446). */
  | "inventory-trust"
  /** Each registry entry: pack, capability set, bucket reason, and snapshot facts. */
  | "registry-delta"
  /** Each bound answer: question, destination, and value. */
  | "answer-write"
  /** Each still-open question and why it is open. */
  | "answer-unresolved"
  /** Each evidence seed: kind, comparison, and the portable/binding identity. */
  | "evidence-seed"
  /** Each drifted-evidence repair: comparison, scope, and overlay. */
  | "evidence-repair"
  /** Each previewed payload write: destination, containment, digest, tuple, owners. */
  | "payload-action"
  /** Each refused destination and its closed rejection token — traversal,
   *  absolute, malformed, symlink-escape, out-of-workspace, and the rest. */
  | "payload-rejection"
  /** Each blocking co-ownership collision and the axis it failed on. */
  | "payload-conflict"
  /** Each artifact decision: form, reason, owners, hashes, and authority. */
  | "artifact-decision"
  /** Each integrated action's kind, target, and mutating flag. */
  | "action"
  /** Each finding's code, severity, and pack — deliberately NOT its message, so
   *  rewording a diagnostic can never invalidate an approved plan. */
  | "finding";

/** The sole approved-plan identity. A later mutator consumes THIS and nothing
 *  else as its authority: approving a plan means approving this `planId`.
 *
 *  STABLE — re-planning an unchanged workspace reproduces it byte-for-byte, and
 *  permuting the input facts cannot change it. SENSITIVE — it changes when any
 *  fact in `coveredFactClasses` changes. */
export interface PlanIdentity {
  /** Lowercase SHA-256 hex over the canonical serialization of the covered facts. */
  planId: string;
  algorithm: "sha256";
  /** The fact classes folded into `planId`. Always the complete closed set — the
   *  coverage claim is a property of the derivation, not of one plan's data — so
   *  a reviewer verifies coverage from this list rather than from a hash they
   *  cannot read. */
  coveredFactClasses: PlanIdentityFactClass[];
  /** How many canonical fact tokens were folded in. */
  factCount: number;
}

/** The `plan_install` response — the frozen public planner envelope.
 *
 *  Deterministic: identical inputs always produce a deep-equal response. Every
 *  collection sorts on a stable key under `localeCompare`.
 *
 *  BYTE-INERT: `byteInert` is the literal `true`. Nothing on the planning path
 *  writes a ledger, a seed, an answer, an enablement change, or any other byte.
 *  Since WF-452 the run is preceded by guarded recovery, which CAN write — so
 *  the guarantee is stated precisely: planning is byte-inert FROM THE RECOVERED
 *  BASELINE, and the separate `recovery` envelope is where any such write is
 *  reported. Planning still never creates a journal or a backup of its own; like
 *  discovery it is lock-acquiring but journal-free. */
export interface PlanInstallResponse {
  planVersion: number;
  /** The admitted root, or `null` when admission failed. */
  workspaceRoot: string | null;
  admission: PlanAdmissionState;
  applicability: PlanApplicability;
  /** The dominant lifecycle effect this plan describes (WF-450). `null` on the
   *  `invalid-root` and `unrecovered` paths and NOWHERE else — one rationale
   *  covers both: nothing was read (admission failed, or recovery did not
   *  proceed), so no lifecycle shape was observed and claiming one would be a
   *  lie. */
  mode: PlanMode | null;
  registryDelta: PlanRegistryDelta;
  answers: { writes: PlanAnswerWrite[]; unresolved: PlanUnresolvedQuestion[] };
  evidenceSeeds: PlanEvidenceSeed[];
  /** Previewed re-establishments of drifted lifecycle evidence (WF-450). Empty
   *  on the `invalid-root` path and whenever no acted-on pack's evidence has
   *  drifted — a plan over exact evidence is unchanged by this slice. */
  repairs: PlanRepairAction[];
  /** The previewed payload effect (WF-448). Empty on the `invalid-root` path and
   *  whenever no acted-on capability declares a payload — registration-only
   *  planning is unchanged by this slice. */
  payloads: PlanPayloadPreview;
  /** The previewed evidence-safe removal/upgrade effect (WF-449). Empty on the
   *  `invalid-root` path and whenever no managed artifact is in scope — planning
   *  that touches no ledger-managed destination is unchanged by this slice. */
  artifacts: PlanArtifactPreview;
  /** Every action class integrated into ONE deterministically ordered list
   *  (WF-450) — selected-set, registration, deregistration, retention, answer,
   *  evidence seed, evidence repair, payload, override, constitution, artifact
   *  removal, bootstrap, and upgrade. Empty on the `invalid-root` path.
   *
   *  INVARIANT: `applicability === "no-change"` implies no action here is
   *  `mutating`, and `applicability === "applicable"` implies at least one is. */
  actions: PlanAction[];
  findings: PlanFinding[];
  /** The explicit basis for `applicability` (WF-450), enumerating every blocking
   *  finding and every blocking question so no blocking condition is ever a
   *  silent omission. */
  applicabilityBasis: PlanApplicabilityBasis;
  /** The sole approved-plan identity (WF-450). Never absent: even the
   *  `invalid-root` path carries one, so a consumer never has to special-case a
   *  missing authority value. */
  identity: PlanIdentity;
  /** The inventory confidence this plan was computed against, carried verbatim
   *  from discovery so a reader never re-derives whether absence was
   *  establishable. Zeroed on the `invalid-root` and `unrecovered` paths (nothing
   *  was read). */
  inventory: DiscoveryInventory;
  /** Crash recovery, reported SEPARATELY from the plan above (WF-452).
   *
   *  The SAME separate channel `discover_packs` carries, for the same reason:
   *  this is the one field in the response that can describe a WRITE. Planning
   *  itself stays byte-inert — `byteInert` remains the literal `true` — and when
   *  `recovery.wroteBytes` is `true` it was RECOVERY that wrote, so planning's
   *  byte-inertness is asserted from the recovered baseline onward, never from
   *  process start.
   *
   *  DELIBERATELY NOT A PLAN-IDENTITY FACT CLASS. `PLAN_IDENTITY_FACT_CLASSES`
   *  is unchanged at the WF-450 sixteen, and this envelope never reaches
   *  `planIdentity`. That is what makes the retrofit's headline guarantee
   *  mechanical: for identical recovered facts the plan schema, actions,
   *  ordering, and `planId` are byte-for-byte what they were before recovery was
   *  integrated — two runs agree on a `planId` even when one recovered a journal
   *  and wrote bytes and the other found none to recover. */
  recovery: RecoveryReport;
  byteInert: true;
}

// ---------------------------------------------------------------------------
// The public apply envelope (WF-453)
// ---------------------------------------------------------------------------
//
// THE FIRST PUBLIC MUTATOR. `apply_install` is the SOLE public registry mutator
// and it applies EXACT plans only, over a bounded supported action set — the
// registry pair (WF-453), widened by WF-454 with `evidence-seed` (binding seeds
// only) and `answer-write`. The ENVELOPE SHAPE IS UNCHANGED by that widening:
// the added targets ride the same journal and the same `applied[]`, so no
// consumer of this family has to learn a new field. It extends the WF-447 lineage
// rather than opening a second response family: it consumes the frozen
// `PlanInstallResponse` and the frozen WF-451 recovery protocol unchanged, and
// adds only the shapes below.
//
// THREE RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. EVERY PRE-JOURNAL REFUSAL HAPPENS BEFORE A JOURNAL, A BACKUP, OR A BYTE.
//      An unsupported action kind and a stale identity-bound precondition are
//      both screened from the RECOMPUTED plan, so a plan whose world moved under
//      it is refused rather than half-applied.
//
//   2. FAILED SELF-CHECK IS TRANSACTION FAILURE. There is no "succeeded but the
//      self-check complained" status — a failed self-check rolls the transaction
//      back and reports `rolled-back`.
//
//   3. WHEN ANYTHING IS UNRESOLVED, NO SUCCESS IS CLAIMED. `status: "applied"`
//      requires every supported action applied AND a passing self-check AND a
//      durably discarded journal. Anything else is `rejected`, `rolled-back`, or
//      `halted`, each carrying exactly one closed reason token.

/** Frozen version of the public apply envelope. */
export const APPLY_ENVELOPE_VERSION = 1;

/** The outcome of one apply run. A closed set — a reader may switch on it
 *  exhaustively.
 *
 *  - `applied`      — every supported action landed, the self-check passed, and
 *                     the journal was durably discarded.
 *  - `rejected`     — refused BEFORE journal creation. Byte-inert from the
 *                     recovered baseline: no journal, no backup, no mutation.
 *  - `rolled-back`  — a journal existed and the transaction failed; the guarded
 *                     rollback ran. `rollback` reports how far it got.
 *  - `halted`       — pre-entry recovery did not proceed, so nothing was read
 *                     and nothing was attempted (the WF-452 posture).
 *  - `invalid-root` — the declared workspace root was not admitted (WF-445).
 *                     Its own token rather than `rejected`, for the same reason
 *                     `unrecovered` is its own applicability: `rejected` asserts
 *                     something about the PLAN, which was never computed here. */
export type ApplyStatus =
  | "applied"
  | "rejected"
  | "rolled-back"
  | "halted"
  | "invalid-root";

/** The CLOSED reason vocabulary. Exactly one token explains every non-`applied`
 *  outcome, and the token is the PRECISE class — never a plausible neighbouring
 *  one. */
export type ApplyReason =
  // --- refused before journal creation ---
  | "apply/invalid-root"
  | "apply/halted-unrecovered"
  | "apply/lock-held"
  | "apply/lock-unavailable"
  | "apply/plan-stale"
  | "apply/plan-not-applicable"
  | "apply/unsupported-action"
  | "apply/registry-unresolvable"
  | "apply/journal-present"
  /** A lifecycle-evidence precondition no longer holds at apply time (WF-454):
   *  the portable tuple is not an EXACT match, a machine binding the plan meant
   *  to seed already exists, or the recorded ownership evidence changed. Its own
   *  token rather than `plan-stale`: the approved plan may still be current in
   *  every other respect, and rather than `precondition-moved`, which is the
   *  post-journal TOCTOU class. Nothing is written on this path. */
  | "apply/evidence-precondition"
  /** A proposed answer failed revalidation against its declared schema at apply
   *  time (WF-454). Distinct from `evidence-precondition`: the failure is in the
   *  VALUE the plan carries, not in the workspace's evidence. */
  | "apply/answer-invalid"
  /** The declared ledger home is not a legal policy, or a ledger destination
   *  could not be resolved to a workspace-contained path (WF-454). Kept apart
   *  from `registry-unresolvable` so a maintainer is not sent to the registry
   *  file when the ledger is what could not be resolved. */
  | "apply/ledger-unresolvable"
  /** A committed project-override precondition no longer holds at apply time
   *  (WF-455): the action's destination does not re-derive as a DECLARED
   *  committed project-override artifact, the approved plan names no single
   *  payload action for it, or the declared source's bytes no longer reproduce
   *  the approved `{sha256, bytes}` identity. Its own token rather than
   *  `plan-stale`, because the approved plan may still be current in every other
   *  respect, and rather than `precondition-moved`, which is the post-journal
   *  TOCTOU class. Nothing is written on this path. */
  | "apply/override-precondition"
  /** A pack-payload precondition no longer holds at apply time (WF-456): the
   *  approved plan names no single previewed payload action for the destination,
   *  the destination no longer resolves to a workspace-contained target, an
   *  owner's declared source no longer reproduces the approved `{sha256, bytes}`
   *  identity, or the co-owners' generation/refresh/removal tuples are no longer
   *  field-for-field equal. Its own token rather than `override-precondition`
   *  (a different, narrower artifact class) and rather than `plan-stale` (the
   *  approved plan may still be current in every other respect). Reporting the
   *  precise class matters: a maintainer chasing a stale plan would never look at
   *  the pack's payload source. Nothing is written on this path. */
  | "apply/payload-precondition"
  /** A bound MANAGED-ARTIFACT precondition no longer holds at apply time
   *  (WF-458): the recorded owner set moved, a recorded or observed digest is not
   *  a well-formed SHA-256 or no longer matches, the declared
   *  `{production, refresh, removal}` tuple moved, the destination no longer
   *  resolves to a workspace-contained target, or the plan's approved decision for
   *  the destination is no longer the decision the current facts produce.
   *
   *  Its own token rather than `payload-precondition` (that is the INSTALL side's
   *  narrower class) and rather than `plan-stale` (the approved plan may still be
   *  current in every other respect). Reporting the precise class matters doubly
   *  here: the class name is what tells a maintainer whether their file was
   *  preserved or destroyed. THE WHOLE PLAN is rejected on this token and nothing
   *  is written — a single stale precondition invalidates every action, not just
   *  its own. */
  | "apply/artifact-precondition"
  /** One destination carries BOTH a bootstrap and a delete action in a single
   *  plan (WF-458). Reconstructing ownership evidence never doubles as authority
   *  to act on it, so the two may never coincide. Enforced as an explicit
   *  whole-plan check with its own diagnostic rather than as an emergent property
   *  of action ordering — an emergent guarantee is one refactor away from being no
   *  guarantee. Nothing is written on this path. */
  | "apply/bootstrap-delete-conflict"
  /** The composed constitution record cannot be recomposed without risking the
   *  project's own writing (WF-455): a section heading this composer needs is
   *  absent, duplicated, or out of order, or the record could not be read back
   *  under the lock. Its own token so a maintainer is sent to the constitution
   *  record rather than to the registry or the ledger. Nothing is written on this
   *  path — in particular the record is NOT re-emitted, so nothing that is in it
   *  now is lost. */
  | "apply/constitution-precondition"
  /** The destination IS a symbolic link. Its own token rather than
   *  `precondition-moved`: nothing moved, the destination simply is not a thing
   *  this mutator may write through. Recovery never follows, replaces, or removes
   *  a link, so a transaction over one could never be rolled back either. */
  | "apply/destination-symlink"
  // --- failed after journal creation; each rolls back ---
  /** The destination's type, inode, or content hash changed between the
   *  observation the journal recorded and the write — the TOCTOU window. */
  | "apply/precondition-moved"
  /** The prior bytes could not be backed up, or the backup did not reproduce
   *  them. Distinct from `write-failed`: nothing was written to the destination
   *  at all, and reporting it as a failed write would send a maintainer looking
   *  at a file that was never touched. */
  | "apply/backup-failed"
  | "apply/write-failed"
  | "apply/self-check-failed"
  | "apply/rollback-incomplete";

/** Why one subject is STILL divergent after an apply run (WF-459).
 *
 *  A closed set, so a reader may switch on it exhaustively, and every artifact a
 *  run leaves un-advanced carries exactly one — a divergence always states which
 *  rule left it standing. */
export type RemainingDivergenceClass =
  /** Current bytes differ from the prior ledger hash — the file was EDITED. The
   *  canonical retained divergence, and the one this slice exists to report. */
  | "edited"
  /** The declared source changed but the declared tuple says `refresh: retain`,
   *  so an upgrade is never authorized for this destination. */
  | "refresh-retained"
  /** Advanceable NOW, but the approved plan lists no advance for it. One
   *  confirmation authorizes only the exact listed actions. */
  | "unlisted"
  /** Ownership, a digest, or the semantic tuple is present but not trustworthy
   *  enough to reason from. */
  | "ambiguous"
  /** The bytes, the destination, or the declaration could not be established. */
  | "unverifiable"
  /** A pack's lifecycle evidence is still drifted after this run. */
  | "evidence-drifted";

/** One thing an apply run did not resolve (WF-459). */
export interface RemainingDivergence {
  /** The workspace-relative destination, or the pack id for `evidence-drifted`. */
  subject: string;
  class: RemainingDivergenceClass;
  /** The retention reason that produced the class, or `null` when the class was
   *  derived from something other than an artifact retention. */
  reason: PlanArtifactRetentionReason | null;
}

/** What an apply run can honestly claim about drift (WF-459).
 *
 *  DERIVED, NEVER ASSERTED. `resolveUpgradeOutcome` is the sole producer, and it
 *  is a total function of two observable quantities. `fully-upgraded` is
 *  UNREACHABLE while anything remains — which is the point: there must be no code
 *  path, no "all applicable actions succeeded" and no "0 errors", that renders a
 *  mixed run as full success.
 *
 *  `no-drift` and `retained-divergence` are the pair that must never collapse
 *  into one another. Both can describe a run that wrote ZERO bytes; the first
 *  says there was nothing to do, the second says nothing could be done. */
export type UpgradeOutcome =
  /** Nothing remained divergent and nothing needed to — a genuinely clean
   *  workspace. */
  | "no-drift"
  /** Something was advanced or repaired AND nothing remains divergent. */
  | "fully-upgraded"
  /** Something was advanced or repaired AND something still remains. */
  | "partial"
  /** NOTHING was advanced or repaired and something still remains — zero bytes
   *  written, and emphatically not the same as `no-drift`. */
  | "retained-divergence"
  /** The run never reached the gate (admission failed, recovery did not proceed,
   *  or the plan was refused before the artifact arm was assessed), so no claim
   *  about drift is made at all. Claiming `no-drift` here would be exactly the
   *  comfortable lie this slice forbids. */
  | "not-assessed";

/** An apply run's honest statement about what it advanced, what it repaired, and
 *  what it left divergent (WF-459). */
export interface UpgradeReport {
  /** `remaining.length === 0`, derived at ONE site. Never set by a code path
   *  that thinks it is finished. */
  noDrift: boolean;
  outcome: UpgradeOutcome;
  /** Every artifact and pack this run left divergent, sorted by subject. */
  remaining: RemainingDivergence[];
  /** Destinations this run ADVANCED. */
  advanced: string[];
  /** Packs whose evidence this run REPAIRED, with the half it re-established. */
  repaired: { pluginId: string; scope: PlanRepairScope }[];
}

/** One action this run actually applied. Mirrors the plan action it came from,
 *  with `persisted` flipped to the literal `true` — the inverse of the plan
 *  envelope, where it is the literal `false`. */
export interface ApplyAppliedAction {
  kind: PlanActionKind;
  order: number;
  pluginId: string | null;
  destination: string | null;
  summary: string;
  persisted: true;
}

/** Why a mutating action the plan carries was NOT applied by this mutator.
 *
 *  Today there is exactly one member, and it is deliberate rather than a gap.
 *  Since WF-455 the mutator DOES compose the constitution — but composition
 *  replaces a derived section of an existing record and preserves the rest, so it
 *  is only possible where a record exists. A workspace that has never run
 *  `/wf:constitution` has none, and the resolver will not fabricate the core
 *  articles and project clauses it did not author. Rejecting on it would make no
 *  registry plan appliable on such a workspace; silently dropping it would be the
 *  half-applied success this family exists to prevent. Naming it is the third
 *  option, and the only honest one. */
export type ApplyDeferredReason = "no-constitution-record";

/** One mutating action the plan carries that this mutator's scope does not
 *  perform, reported explicitly with the follow-up that does perform it. */
export interface ApplyDeferredAction {
  kind: PlanActionKind;
  order: number;
  destination: string | null;
  reason: ApplyDeferredReason;
  /** The named follow-up. Never a body, never a command this mutator runs. */
  followUp: string;
  detail: string;
}

/** How far the guarded rollback got. Produced by running WF-451's recovery
 *  driver over this transaction's own journal, so the dispositions are that
 *  protocol's, unchanged. */
export interface ApplyRollbackReport {
  /** `true` only when every entry resolved and the journal was discarded. */
  complete: boolean;
  restored: RecoveryEntryOutcome[];
  alreadyRestored: RecoveryEntryOutcome[];
  preserved: RecoveryEntryOutcome[];
  unresolved: RecoveryEntryOutcome[];
}

/** What this run left behind. `clean` is the explicit statement that the
 *  transaction left no journal, no backup, and no empty backup directory — the
 *  "no recovery residue" criterion stated as an observable field rather than a
 *  promise in prose. */
export interface ApplyResidueReport {
  clean: boolean;
  journalRetained: boolean;
  backupsRetained: boolean;
  detail: string;
}

/** The recomputed plan this run revalidated against, echoed so a caller can see
 *  exactly which plan was applied without re-planning. */
export interface ApplyPlanEcho {
  /** The freshly recomputed identity. */
  planId: string | null;
  /** What the caller approved. */
  expectedPlanId: string;
  /** `true` only when the two are equal. `false` is `apply/plan-stale`. */
  matched: boolean;
  applicability: PlanApplicability | null;
  mode: PlanMode | null;
}

/** The `apply_install` response.
 *
 *  NOT byte-inert — this is the first thing in the runtime whose PURPOSE is to
 *  change committed state. The envelope therefore says precisely what changed
 *  (`applied`), what it deliberately did not change (`deferred`), what it undid
 *  (`rollback`), and what it left behind (`residue`), and it reports pre-entry
 *  recovery through the same SEPARATE channel the planners use. */
export interface ApplyInstallResponse {
  applyVersion: number;
  workspaceRoot: string | null;
  admission: PlanAdmissionState;
  status: ApplyStatus;
  /** Exactly one closed token, or `null` on `applied`. */
  reason: ApplyReason | null;
  /** The transaction id, or `null` when no journal was ever created. Its
   *  presence is the observable boundary between "refused before a journal" and
   *  "a transaction existed". */
  transactionId: string | null;
  plan: ApplyPlanEcho;
  applied: ApplyAppliedAction[];
  deferred: ApplyDeferredAction[];
  /** `null` when no rollback ran (either nothing was journalled, or the run
   *  succeeded). */
  rollback: ApplyRollbackReport | null;
  /** `skipped` when the transaction never reached the self-check stage. */
  selfCheck: "ok" | "failed" | "skipped";
  /** Whether the snapshot was rebuilt and persisted this run. */
  refreshed: boolean;
  /** Pre-entry crash recovery, reported SEPARATELY from the apply above and
   *  never folded into it — the same discipline WF-452 gave the planners. */
  recovery: RecoveryReport;
  residue: ApplyResidueReport;
  /** What this run advanced, what it repaired, and what it LEFT DIVERGENT
   *  (WF-459).
   *
   *  Always present, on every path, because "we did not look" and "there was
   *  nothing to see" are different statements and only one of them is safe to
   *  make. A run that never reached the artifact gate carries
   *  `outcome: "not-assessed"` with `noDrift: false`; a run that reached it
   *  carries a `noDrift` derived from `remaining` being empty and nothing else.
   *
   *  DELIBERATELY SEPARATE FROM `status` AND FROM `applied[]`. `status: "applied"`
   *  answers "did the transaction land?"; this answers "is the workspace now what
   *  its declarations describe?". A mixed run where some actions advanced and an
   *  edited file did not is `status: "applied"` AND `outcome: "partial"`, and
   *  collapsing the two would be exactly the comfortable lie this slice forbids. */
  upgrade: UpgradeReport;
  diagnostics: DiscoveryIssue[];
}

/** The fixed taxonomy of resolver-failure categories (WF-272). A broken
 *  resolver state is one of these typed, diagnosable categories — never an
 *  opaque throw. Each maps a diagnostic/throw to a surface-specific reaction and
 *  a recovery path (see `resolver/failure.ts`). */
export type ResolverErrorCategory =
  /** No resolution snapshot could be produced (no cache and the build failed). */
  | "snapshot-missing"
  /** A persisted snapshot is present but unreadable (unparseable / structurally invalid). */
  | "snapshot-malformed"
  /** A snapshot's `schemaVersion` is incompatible with this runtime. */
  | "schema-incompatible"
  /** A recorded source input could not be re-read to validate freshness. */
  | "fingerprint-unresolvable"
  /** `claude plugin list --json` could not run; installed-pack facts are unknown. */
  | "cli-unavailable"
  /** The `## Capabilities` registry / a capability manifest / a profile is invalid,
   *  OR a `plugin-list/*` CLI-output-contract (schema-drift) error — the CLI ran
   *  but its `--json` output failed the expected schema. Distinct from
   *  `cli-unavailable`, which is the CLI-absent/failed-to-run case. */
  | "registry-invalid"
  /** A content ref resolved against a valid root but no file exists at the
   *  joined path — a caller-side ref-shape error (e.g. a fragment ref missing
   *  its `fragments/` segment), not a broken-resolver state. Emitted only by
   *  the content surface's read-miss; never carried by a snapshot diagnostic,
   *  so it can never degrade `resolve_gate` health. */
  | "ref-not-found";

/** Enumerated categories, for validation and exhaustiveness. */
export const RESOLVER_ERROR_CATEGORIES: readonly ResolverErrorCategory[] = [
  "snapshot-missing",
  "snapshot-malformed",
  "schema-incompatible",
  "fingerprint-unresolvable",
  "cli-unavailable",
  "registry-invalid",
  "ref-not-found",
] as const;

/** A resolution diagnostic (non-fatal note or a residual-diagnosis input). The
 *  optional `category` classifies a failure-signal diagnostic into the fixed
 *  resolver-failure taxonomy (WF-272); `recovery` carries the caller-facing
 *  recovery hint (including a `/wf:resolve refresh|invalidate` path). Both are
 *  optional so every existing diagnostic remains contract-compatible. */
export interface Diagnostic {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  /** Resolver-failure category when this diagnostic is a failure signal. */
  category?: ResolverErrorCategory;
  /** Caller-facing recovery path; present when `category` is set. */
  recovery?: string;
}

/** Provider-surface ownership index (derived from active capabilities'
 *  `provider` fragments). Metadata only — no fragment body. */
export interface ProviderOwnershipRecord {
  /** The bare scope token this record is keyed on: `delivery` | `tracker` |
   *  `engine` | `host` (the `provider` fragment's `scope`). The
   *  `qa-execution:`-prefixed composite form (`qa-execution:engine` /
   *  `qa-execution:host`) appears only in the caller-supplied query token and
   *  the echoed `ProviderResponse.surface` — never in this stored record, which
   *  the query side normalizes down to the bare scope before lookup. */
  surface: string;
  owner: string;
  /** Normalized dispatch target path, or `null`. */
  fragmentPath: string | null;
  state: "ok" | "unconfigured" | "unrecoverable";
}

/** Core config values map (consumer inventory §7 field #3). */
export interface CoreConfig {
  taskRoot: string | null;
  verifyCommand: string | null;
  qaRules: string | null;
  qaBaselineIgnore: string | null;
  seedArchitectureDoc: string | null;
  seedBacklogPath: string | null;
  standupStatuses: string | null;
  /** Stated per-run context bound for `/wf:ship` (approx accumulated tokens),
   *  surfaced verbatim; `ship` interprets `<none>`/absent/unparseable as its
   *  shipped default (~150K) and owns the numeric parse. Added WF-378. */
  contextCeiling: string | null;
  /** Workspace-relative path of the file that declares the version of the unit
   *  this workspace publishes, surfaced verbatim. It is the already-resolved
   *  `<version-declaration>` a caller hands the delivery surface's
   *  newest-published-version read; core never derives one and never hardcodes a
   *  path. `null` (unset, `<none>`, or a placeholder) means the currency check
   *  has nothing to ask for and states that it is not configured, never that the
   *  installation is current. Added WF-489. */
  versionDeclaration: string | null;
}

/** Active tracker's id shape (consumer inventory §7 field #10). Product-noun
 *  free: core records only whether a tracker surface is owned, never the tracker
 *  product. `scheme` is the bare-core local scheme when no tracker is active. */
export interface IdShape {
  /** `bare-core`, or `tracker:<capability-name>` when a tracker surface owner is
   *  active. Names the owning capability, never a tracker product. */
  source: string;
  /** `T<NNN>` in bare-core; `null` when a tracker owns the id shape (the concrete
   *  shape is the provider's to supply at resolution time — WF-270). */
  scheme: string | null;
}

/** A composed constitution clause with its provenance (consumer inventory §7
 *  field #13). Derived from capabilities' `article:` declarations. */
export interface ConstitutionInput {
  capability: string;
  key: string;
  value: string;
}

/** Per-slot composition provenance (WF-329): for one `<skill>.<point>` slot, the
 *  tier that wins and its source, so `resolve_inspect` can show what a slot
 *  resolved to WITHOUT reading any body. Derived purely from the active pack
 *  slot fragments (registry order) plus the presence of a personal
 *  `_local/slots/<skill>.<point>.md` override. Never a fragment body. */
export interface SlotProvenanceRecord {
  /** The `<skill>.<point>` composition-point id. */
  skillPoint: string;
  /** The declared merge policy (`replace` / `append`), or `null` when only a
   *  personal override is present (policy is observationally irrelevant then). */
  policy: string | null;
  /** True when a personal `_local/slots/<skill>.<point>.md` override is present. */
  overridePresent: boolean;
  /** True when a committed `.wf/slots/<skill>.<point>.md` project override is
   *  present (WF-443). Reported separately from `overridePresent` so a reader can
   *  tell a shared, checked-in customization from a personal, machine-local one. */
  projectOverridePresent: boolean;
  /** The capabilities contributing a pack slot fragment, in registry order. */
  contributors: string[];
  /** The tier the winning body comes from. */
  tier: "local-override" | "project-override" | "pack-contribution" | "unfilled";
  /** The winning source: `local-override`, `project-override`, the winning
   *  capability name, or `null` when unfilled. For `append`, the
   *  highest-precedence present tier's source — the personal override, else the
   *  project override, else the last pack contributor in registry order. */
  winningSource: string | null;
}

/** WF-498: `complexity-derived` sits BELOW `shipped-default` and ABOVE `inheritance`.
 *  It marks a selection the resolver computed itself from the call site's normalized
 *  shape evidence — never one a caller supplied — so a consumer can carry a
 *  resolver-derived selection forward with its provenance intact and tell it apart
 *  from an ordinary caller-selected `invocation` value. */
export type RoutingSource = "host" | "invocation" | "project" | "shipped-default" | "complexity-derived" | "inheritance";
export interface RoutingRow { model: string | null; effort: string | null }
export type RoutingProjectConfig = Record<string, RoutingRow>;
export interface RoutingChoice {
  value: string | null;
  source: RoutingSource;
  requested: string | null;
  requestedSource: RoutingSource;
  masked: boolean;
  fallback: "malformed" | "unavailable" | "selector-unsupported" | null;
}
export type ExecutionShape = "inline" | "isolated" | "bounded-parallel";
export type RoutingInsufficiencySignal =
  | "low-confidence"
  | "failed-validation"
  | "conflicting-or-incomplete-evidence"
  | "repeated-failure"
  | "increased-risk-or-scope"
  | "high-severity-review-uncertainty";
export interface RoutingUnitEvaluation {
  unitId: string;
  sufficient: boolean;
  signals: RoutingInsufficiencySignal[];
}
export interface RoutingPriorAttempt {
  role: string;
  attempt: number;
  executionShape: ExecutionShape;
  shapeEvidence: RoutingShapeEvidence;
  unitIds: string[];
  model: RoutingChoice;
  effort: RoutingChoice;
  basis: string | null;
  escalationOrigin: string | null;
  actualModel?: string | null;
}
export interface RoutingPostAttemptEvaluation {
  sufficient: boolean;
  signals: RoutingInsufficiencySignal[];
  units?: RoutingUnitEvaluation[];
  prior: RoutingPriorAttempt;
}
export type RoutingDisposition = "dispatch" | "retain" | "retry" | "exhausted" | "invalid-stop";
export interface RoutingRetryInstruction {
  attempt: number;
  signals: RoutingInsufficiencySignal[];
  unitIds: string[];
  /** Which escalation lever this retry actually pulls. `next-stable-tier` advances
   *  exactly one stable tier. The other three name the reason no tier lever applied,
   *  in the precedence order the resolver classifies them: the edge declared it
   *  cannot honor a model selector, the prior attempt maps to no stable tier, or the
   *  prior attempt already sits at the highest one. The model tier is ONE lever, not
   *  the gate itself — an inapplicable lever narrows and re-dispatches the failed
   *  units rather than refusing to acknowledge the failure. */
  escalation: "next-stable-tier" | "selector-unsupported" | "prior-tier-unknown" | "top-tier";
  /** The tier the attempt that ALREADY RAN mapped to, reported whenever it resolves
   *  — including when no advance was requested. Null only when the prior model maps
   *  to no stable tier. It is evidence about the past, and carries no invariant. */
  priorTier: "haiku" | "sonnet" | "opus" | null;
  /** THE CALLER INVARIANT: `nextTier` is non-null exactly when the resolver advanced
   *  the selection one stable tier above `priorTier`; null means it requested no
   *  advance and the narrowed units re-run at the prior attempt's own selection,
   *  re-resolved through the ordinary precedence chain so host enforcement still
   *  wins. A null `nextTier` together with `shapeChanged: false` is a deliberate
   *  zero-delta repeat — bounded by the attempt budget, and worth re-dispatching only
   *  when the failure was plausibly transient rather than a property of the work. */
  nextTier: "haiku" | "sonnet" | "opus" | null;
  escalationOrigin: string;
  priorExecutionShape: ExecutionShape;
  shapeChanged: boolean;
}
export type RoutingShapeReason =
  | "atomic-caller-context"
  | "single-isolation-worthy-unit"
  | "dependent-or-nonmaterial-units"
  | "nonmaterial-units-inline"
  | "independent-material-units";
export interface RoutingShapeEvidence {
  workSurface: "caller-context" | "external-context";
  atomicity: "atomic" | "composite";
  unitCount: number;
  unitsIndependent: boolean;
  ambiguity: "none" | "bounded" | "material";
  risk: "low" | "elevated";
  toolWork: "none" | "bounded" | "material";
  validation: "mechanical" | "judgment";
  contextIsolation: "none" | "useful" | "required";
  independentReview: boolean;
  returnContract: "mechanically-judgeable" | "judgment";
  requestedParallelism: number;
}
export interface NormalizedRoutingShapeEvidence extends RoutingShapeEvidence {
  requestedParallelism: number;
}
export interface RoutingInputs {
  role: string;
  shapeEvidence: RoutingShapeEvidence;
  unitIds?: string[];
  invocationModel?: string | null;
  invocationEffort?: string | null;
  requireModel?: boolean;
  requireEffort?: boolean;
  supportsModelSelector: boolean;
  supportsEffortSelector: boolean;
  hostModel?: string | null;
  hostEffort?: string | null;
  availableModels?: string[] | null;
  basis?: string | null;
  attempt?: number;
  escalationOrigin?: string | null;
  actualModel?: string | null;
  postAttempt?: RoutingPostAttemptEvaluation;
}
export interface RoutingDecision {
  role: string;
  executionShape: ExecutionShape;
  normalizedEvidence: NormalizedRoutingShapeEvidence;
  unitIds: string[];
  shapeReason: RoutingShapeReason;
  effectiveParallelism: number;
  model: RoutingChoice;
  effort: RoutingChoice;
  source: RoutingSource;
  basis: string | null;
  attempt: number;
  escalationOrigin: string | null;
  fallback: RoutingChoice["fallback"];
  masked: boolean;
  actualModel?: string;
  status: "dispatch" | "retain" | "stop";
  disposition: RoutingDisposition;
  retry: RoutingRetryInstruction | null;
  retainedUnitIds: string[];
  diagnostic: string | null;
}

/** Compact runtime-selection metadata for reproducible routing measurements.
 * Artifact producer attribution is deliberately absent: `actualModel` is host
 * runtime evidence, while an artifact's `Model` metadata is not a selector. */
export interface RoutingMeasurement {
  role: string;
  executionShape: ExecutionShape;
  shapeReason: RoutingShapeReason;
  unitIds: string[];
  model: string | null;
  effort: string | null;
  source: RoutingSource;
  basis: string | null;
  attempt: number;
  escalationOrigin: string | null;
  modelFallback: RoutingChoice["fallback"];
  effortFallback: RoutingChoice["fallback"];
  /** Which escalation lever a retry pulled, or null when this record is not a retry.
   *  Without it a zero-delta same-model retry is indistinguishable in the log from
   *  the first attempt it repeats. */
  escalation: RoutingRetryInstruction["escalation"] | null;
  masked: boolean;
  actualModel?: string;
}

/** The full versioned resolution snapshot. */
export interface ResolverSnapshot {
  schemaVersion: number;
  /** ISO-8601 stamp applied at persist time (not part of the deterministic
   *  build; excluded from reproducibility comparisons). */
  generatedAt: string;
  /** The runtime that produced the snapshot (name + version). */
  generator: { name: string; version: string };
  /** Normalized absolute workspace root. */
  workspaceRoot: string;
  /** Resolved registry location (from wf.config.js; default _local/config.md),
   *  normalized workspace-relative. */
  registryPath: string;
  coreConfig: CoreConfig;
  /** Project routing rows keyed by arbitrary valid role slug. */
  routing?: RoutingProjectConfig;
  /** Active registry capabilities, in registry (injection) order. */
  capabilities: CapabilityRecord[];
  pluginRoots: PluginRootRecord[];
  /** Every installed pack (from the CLI) plus synthesized
   *  registered/unrecoverable records — the four states, distinctly. */
  packs: PackRecord[];
  providerOwnership: ProviderOwnershipRecord[];
  idShape: IdShape;
  /** Persisted profile VALUES per capability (consumer inventory §7 field #8) —
   *  the document as written; never a template, and no override tier merged in
   *  (that is `resolve_settings`, which is a different surface). Keyed by
   *  capability name. */
  profiles: Record<string, unknown>;
  /** Provider-scoped tracker config values (consumer inventory §7 field #9).
   *  Populated by the provider surface's own resolution (R3, WF-270) so core
   *  names no tracker product here; empty until then. */
  providerConfig: Record<string, Record<string, string>>;
  /** Composed constitution clauses (consumer inventory §7 field #13). */
  constitutionInputs: ConstitutionInput[];
  /** Per-slot composition provenance (WF-329), sorted by `skillPoint`. One row
   *  per composed `<skill>.<point>` (a pack contribution and/or a personal
   *  override). Empty when the project has no slot contributions or overrides. */
  slots: SlotProvenanceRecord[];
  /** Skill slugs with a present `_local/profiles/<skill>.settings.json` override
   *  (WF-329), sorted. Empty when the project has no per-skill settings overrides. */
  settingsOverrides: string[];
  /** The precise source inputs (with fingerprints) that produced this snapshot. */
  sources: SourceFingerprint[];
  diagnostics: Diagnostic[];
}
