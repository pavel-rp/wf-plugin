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
 *    `invalid-root` → `not-applicable` → `blocked` → `no-change` → `applicable`
 *
 *  - `invalid-root`   — the declared workspace root was not admitted; nothing
 *                       was read and nothing was classified.
 *  - `not-applicable` — a structural error finding (unsatisfied dependency,
 *                       capability conflict, provider overlap, contradictory or
 *                       unknown selection, or incomplete legacy proof). The plan
 *                       cannot be made executable by supplying an answer.
 *  - `blocked`        — every structural condition holds but at least one
 *                       required project answer is missing or invalid.
 *  - `no-change`      — the selection is already satisfied: nothing would be
 *                       added, deregistered, answered, or seeded.
 *  - `applicable`     — the delta is executable once a mutator exists. */
export type PlanApplicability =
  | "applicable"
  | "no-change"
  | "blocked"
  | "not-applicable"
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
  /** A proposed answer failed its declared schema. */
  | "plan/answer-invalid"
  /** A declared question has no persisted and no proposed answer. */
  | "plan/answer-missing";

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

/** The `plan_install` response — the frozen public planner envelope.
 *
 *  Deterministic: identical inputs always produce a deep-equal response. Every
 *  collection sorts on a stable key under `localeCompare`.
 *
 *  BYTE-INERT: `byteInert` is the literal `true`. Nothing on the planning path
 *  writes a ledger, a seed, an answer, an enablement change, or any other byte. */
export interface PlanInstallResponse {
  planVersion: number;
  /** The admitted root, or `null` when admission failed. */
  workspaceRoot: string | null;
  admission: PlanAdmissionState;
  applicability: PlanApplicability;
  registryDelta: PlanRegistryDelta;
  answers: { writes: PlanAnswerWrite[]; unresolved: PlanUnresolvedQuestion[] };
  evidenceSeeds: PlanEvidenceSeed[];
  findings: PlanFinding[];
  /** The inventory confidence this plan was computed against, carried verbatim
   *  from discovery so a reader never re-derives whether absence was
   *  establishable. Zeroed on the `invalid-root` path (nothing was read). */
  inventory: DiscoveryInventory;
  byteInert: true;
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

export type RoutingSource = "host" | "invocation" | "project" | "shipped-default" | "inheritance";
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
  priorTier: "haiku" | "sonnet" | "opus";
  nextTier: "haiku" | "sonnet" | "opus";
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
  /** Override-merged profile VALUES per capability (consumer inventory §7 field
   *  #8) — never a template. Keyed by capability name. */
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
