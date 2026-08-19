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
export const RESOLVER_GENERATOR = { name: "wf-resolver", version: "0.4.0" } as const;

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

/** One validated declaration from a profile template's ordered top-level `ask`
 * array. `pack` is the capability identity that owns the template. */
export interface QuestionDeclaration {
  pack: string;
  id: string;
  destination: string;
  prompt: string;
  schema: QuestionSchema;
  suggestedDefault?: unknown;
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
  | { valid: true; source: QuestionValueSource; value: unknown; diagnostics: [] }
  | {
      valid: false;
      source: QuestionValueSource;
      value: unknown;
      diagnostics: QuestionDiagnostic[];
    };

export interface QuestionSuggestion {
  source: "suggested-default" | "pack-default" | "personal";
  value: unknown;
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
      value: unknown;
      suggestions: QuestionSuggestion[];
    };

/** Body-free resolver metadata for one validated declaration and its value state. */
export interface QuestionRecord extends QuestionDeclaration {
  state: QuestionResolutionState;
}

export type QuestionDeclarationResult =
  | { ok: true; questions: QuestionRecord[]; diagnostics: [] }
  | { ok: false; questions: []; diagnostics: QuestionDiagnostic[] };

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
  /** The capabilities contributing a pack slot fragment, in registry order. */
  contributors: string[];
  /** The tier the winning body comes from. */
  tier: "local-override" | "pack-contribution" | "unfilled";
  /** The winning source: `local-override`, the winning capability name, or
   *  `null` when unfilled. For `append`, the highest-precedence pack contributor
   *  (last in registry order) when no override is present. */
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
