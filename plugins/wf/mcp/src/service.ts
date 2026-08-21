// wf resolver — the plugin-local typed service adapter (WF-270).
//
// This is the single service every typed MCP query tool and the /wf:resolve
// skill route through. Normal skills and isolated subagents obtain resolved
// facts ONLY by calling the typed queries here — there is no shell/CLI/plugin-
// root probe or installed-folder walk on the consumer side; all discovery
// happens once, inside this service, over the deterministic resolver engine
// (WF-269). Every metadata query response is bounded normalized metadata / paths /
// enums / small maps — NEVER a capability fragment body, skill body, manifest
// body, or raw profile-template body. A validated interview `prompt` is an
// intentional declaration field, not an executable prompt/template body.
//
// The service owns the snapshot lifecycle for a server session: a lazily built,
// in-memory-cached resolved view, an `invalidate` flag that forces the next
// query (or an explicit `refresh`) to rebuild, and the pack register write-path
// that is the sole mutation of the discovery substrate.

import { resolveRouting } from "./resolver/routing.js";
import type { RoutingDecision, RoutingInputs } from "./resolver/types.js";
import { sha256Hex } from "./resolver/fingerprint.js";
import {
  annotate,
  classifyThrow,
  isFailureSignal,
  reactionFor,
  recoveryFor,
  type FailureReaction,
  type ResolverFailure,
  type SurfaceClass,
} from "./resolver/failure.js";
import { evaluateFreshness, type StaleReason } from "./resolver/freshness.js";
import {
  resolveContentRef,
  type ContentRef,
  type ContentRefClass,
} from "./resolver/content.js";
import {
  composeSlotBody,
  planSlot,
  OVERRIDE_DIR,
  PROJECT_OVERRIDE_DIR,
  slotPointFromOverrideFilename,
  type MergePolicy,
  type PresentPart,
} from "./resolver/slot.js";
import { CONSTITUTION_RELPATH } from "./resolver/constitution.js";
import {
  PROJECT_CLAUSES_HEADING,
  articlesByCapability,
  composeConstitutionRecord,
} from "./resolver/constitution-compose.js";
import {
  SETTINGS_STORAGE_DIR,
  capabilityProfileRelPath,
  isSkillSlug,
  locateInterface,
  mergeSettings,
  parseSettingsOverride,
  settingsOverrideRelPath,
} from "./resolver/settings.js";
import {
  dirnameSlash,
  isAbsoluteRoot,
  joinSlash,
  normalizeSlashes,
  registryPathShapeError,
  resolveContainedCapabilityPath,
  type ContainedFileReadResult,
} from "./resolver/paths.js";
import {
  validateManifest,
  validateRegistry,
  type ValidatorFs,
} from "./resolver/validate-capability.js";
import { validateSkillInterface } from "./resolver/validate-skill-interface.js";
import { validateReferences } from "./resolver/validate-references.js";
import {
  previewComposition,
  type CompositionPreview,
} from "./resolver/preview-composition.js";
import type { ValidationVerdict } from "./resolver/validate-rules.js";
import { parseManifest } from "./resolver/manifest.js";
import {
  MAX_NORMALIZED_QUESTION_BYTES,
  MAX_PROFILE_TEMPLATE_BYTES,
  MAX_QUESTION_DIAGNOSTICS,
  makeQuestionDiagnostic,
  parseQuestionDeclarations,
  validateQuestionValue,
} from "./resolver/questions.js";
import {
  MAX_NORMALIZED_PAYLOAD_BYTES,
  MAX_PAYLOAD_DIAGNOSTICS,
  makePayloadDiagnostic,
  validatePayloadDeclarations,
} from "./resolver/payloads.js";
import {
  createMachineBindingEvidence,
  createPortablePackEvidence,
  resolveLedgerHome,
} from "./resolver/lifecycle-evidence.js";
import {
  discoverPacks as joinDiscoveredPacks,
  parseEvidenceLedger,
  type EvidenceLedger,
} from "./resolver/discover-packs.js";
import {
  invalidRootRecoveryReport,
  noRecoveryReport,
  recoverInterruptedTransaction,
  type RecoveryPorts,
} from "./resolver/lifecycle-recovery.js";
import {
  planInstall as planInstallJoin,
  type PlanArtifactFactInput,
  type PlanCapabilityInput,
  type PlanSelectionInput,
} from "./resolver/plan-install.js";
import { isDeclaredProjectOverrideArtifact } from "./resolver/plan-complete.js";
import {
  decideApplyGate,
  renderRegistryMutation,
  type ApplyRegistryFact,
} from "./resolver/apply-install.js";
import {
  applyTransaction,
  type ApplyPorts,
  type ApplyTargetWrite,
  type SelfCheckExpectation,
  type SelfCheckOutcome,
} from "./resolver/apply-transaction.js";
import {
  renderLedgerMutation,
  renderProfileMutation,
  type LedgerEvidenceUpdate,
  type ProfileAnswerUpdate,
  type TargetRender,
} from "./resolver/apply-targets.js";
import type {
  PayloadTargetResolution,
  PlanPayloadFact,
} from "./resolver/payload-plan.js";
import { upsertSectionRow } from "./resolver/registry-edit.js";
import type {
  InstalledPlugin,
  PluginListContractIssue,
} from "./resolver/plugin-list.js";
import {
  RESOLVER_GENERATOR,
  type ArtifactEvidence,
  type CapabilityRecord,
  type ConstitutionInput,
  type ContainedFileFingerprintResult,
  type Diagnostic,
  type DiscoverPacksResponse,
  type MachineBindingEvidence,
  type PathHashRecord,
  type PayloadDeclaration,
  type PayloadDiagnostic,
  type PlanAction,
  type PlanAdmissionState,
  type PlanInstallResponse,
  APPLY_ENVELOPE_VERSION,
  type ApplyAppliedAction,
  type ApplyInstallResponse,
  type ApplyReason,
  type ApplyResidueReport,
  type ApplyStatus,
  type DiscoveryIssue,
  type PortablePackEvidence,
  type QuestionDiagnostic,
  type RecoveryReport,
  type ResolverErrorCategory,
  type ResolverSnapshot,
} from "./resolver/types.js";

/** Result of a plugin-list resolution.
 *
 *  The three verdict fields are INDEPENDENT and answer different questions:
 *  - `ok: false`      — the `claude` CLI was unavailable or errored, so nothing
 *                       was observed at all. Distinct from a genuine empty
 *                       install set, which is `ok: true` with `plugins: []`.
 *  - `contractOk`     — whether every record the CLI returned matched the
 *                       CLI-output contract.
 *  - `issues`         — the contract findings behind `contractOk`, which
 *                       distinguish a whole-output failure (zero records) from
 *                       per-record rejection (some records survived).
 *
 *  `contractOk`/`issues` were previously discarded here; pack discovery (WF-446)
 *  derives its inventory-confidence token from exactly that distinction, so they
 *  are carried through. The widening is additive — `plugins`/`ok` are unchanged,
 *  and a caller that reads only those two is unaffected. When `ok` is `false`
 *  nothing was parsed, so `contractOk` is `true` and `issues` is empty: absence
 *  of output is not a contract violation. */
export interface PluginListResult {
  plugins: InstalledPlugin[];
  ok: boolean;
  contractOk: boolean;
  issues: PluginListContractIssue[];
}

/**
 * The injectable side-effect surface the service depends on. The production
 * factory wires these to the resolver engine + filesystem + `claude plugin
 * list --json`; tests drive them with in-memory doubles so every operation is
 * asserted without a real filesystem or CLI.
 */
export interface ResolverServicePorts {
  /** Normalized absolute workspace root the snapshot is resolved against. */
  workspaceRoot: string;
  /** Normalized absolute root of the core `wf` plugin (where the server runs
   *  from) — the anchor the content surface uses for `contract` / `shared` /
   *  core `references-template` refs. */
  corePluginRoot: string;
  /** Build a fresh resolved snapshot (full discovery). */
  resolveFresh(): ResolverSnapshot;
  /** Persist a snapshot to the project-local cache. */
  persist(snapshot: ResolverSnapshot): void;
  /** Read the persisted snapshot, or `null` when none is cached. */
  readCache(): ResolverSnapshot | null;
  /** Read a UTF-8 file (pack manifest reads for inspect/register), or `null`. */
  readFile(absPath: string): string | null;
  /** Security boundary for a manifest-selected profile template. Omission fails
   * closed; inspection never falls back to `readFile` for this input. */
  readContainedFile?(
    capabilityRoot: string,
    selectedPath: string,
    maxBytes: number,
  ): ContainedFileReadResult;
  /** Raw-byte fingerprint boundary for declared payload sources. Omission fails
   * closed; inspection never reads a declared source through `readFile`. */
  fingerprintContainedFile?(
    capabilityRoot: string,
    selectedPath: string,
    maxBytes: number,
  ): ContainedFileFingerprintResult;
  /** Canonicalize the installed root for machine-local binding evidence. */
  canonicalizeRoot?(root: string): string | null;
  /** No-create containment boundary for a declared payload destination (WF-448),
   *  measured against the ADMITTED workspace root the caller passes in — never a
   *  root this port re-derives, and never plugin-root validation. Omission fails
   *  closed: payload preview yields no actions rather than a guessed target. */
  resolvePayloadTarget?(
    admittedRoot: string,
    destination: string,
  ): PayloadTargetResolution;
  /** Write a UTF-8 file (registry edits), creating parent dirs. */
  writeFile(absPath: string, content: string): void;
  /** List immediate subdirectory names of `absDir` (used ONLY on the pack
   *  register write-path to discover `capabilities/*` folders — never on a
   *  read-query path). Returns `[]` when the directory is absent. */
  listDirs(absDir: string): string[];
  /** List immediate file names of `absDir` (used ONLY by `validate_references`'
   *  default tree walk — never on a resolution path). OPTIONAL so every existing
   *  in-memory port double stays valid; when absent the walk degrades to the
   *  conventional `SKILL.md` paths `listDirs` already yields. Returns `[]` when
   *  the directory is absent. */
  listFiles?(absDir: string): string[];
  /** Installed plugin metadata, exclusively from `claude plugin list --json`. */
  listPlugins(): PluginListResult;
  /** Resolved registry-file location, workspace-relative (default
   *  `_local/config.md`). */
  registryRelPath(): string;
  /** Crash-recovery effects for the guarded lifecycle entries — discovery
   *  (WF-451) and planning (WF-452), which share this ONE port set rather than
   *  each binding its own. OPTIONAL so every existing in-memory port double stays
   *  valid; when absent, the guarded entry performs no recovery and reports
   *  `no-journal` — which is byte-inert and non-blocking, exactly the pre-WF-451
   *  behaviour. */
  recovery?: RecoveryPorts;
  /** The journaled-transaction effects for the FIRST PUBLIC MUTATOR (WF-453).
   *
   *  A FACTORY rather than a ready-made port set, because two of the transaction's
   *  inputs are service-level facts: the resolved registry destination, and the
   *  refresh + self-check that only the service can perform. OPTIONAL so every
   *  existing in-memory port double stays valid; when absent, `apply_install`
   *  refuses with `apply/registry-unresolvable` rather than mutating through a
   *  guessed path — the fail-safe direction for a mutator. */
  createApply?(
    registryRelPath: string,
    refreshAndSelfCheck: (expectation: SelfCheckExpectation) => SelfCheckOutcome,
  ): ApplyPorts;
  /** Production-only containment boundary for the registry write. Test doubles
   *  may omit it and use the shape-validated workspace-relative join. */
  resolveRegistryWritePath?(registryRelPath: string): string;
}

// --- bounded response shapes (metadata only; no bodies) --------------------

export interface ConfigResponse {
  workspaceRoot: string;
  registryPath: string;
  coreConfig: ResolverSnapshot["coreConfig"];
  idShape: ResolverSnapshot["idShape"];
}

export interface RegistryResponse {
  capabilities: Array<{
    name: string;
    kind: string | null;
    resolvedPath: string | null;
    manifestPath: string | null;
    provenance: CapabilityRecord["provenance"];
    validity: CapabilityRecord["validity"];
    fragments: CapabilityRecord["fragments"];
    articles: CapabilityRecord["articles"];
    requires: string[];
    conflicts: string[];
    profileTemplatePath: string | null;
    questions: CapabilityRecord["questions"];
  }>;
}

export interface ProviderResponse {
  surface: string;
  owner: string | null;
  fragmentPath: string | null;
  state: "ok" | "unconfigured" | "unrecoverable";
  degradation: string;
  diagnostics: string | null;
}

export interface ProfileResponse {
  capability: string;
  present: boolean;
  values: unknown;
}

/** Per-skill settings resolution (WF-328): the override-merged VALUES for a
 *  slotted skill's declared settings keys, under the same hybrid precedence
 *  (override > declared default) as capability profiles, re-keyed per skill.
 *  Values only — never a skill body or interface prose. */
export interface SettingsResponse {
  skill: string;
  /** True when a settings-declaring `interface.md` was located for the skill. */
  declared: boolean;
  /** True when a `_local/profiles/<skill>.settings.json` override is present. */
  overridePresent: boolean;
  /** The resolved per-key values (override value where present, else the declared
   *  default). `null` when the skill declares no settings, or when resolution
   *  failed (undeclared key / unparseable override / bad skill slug). */
  values: Record<string, unknown> | null;
  /** Override keys the interface does not declare — non-empty ⇒ a loud rejection.
   *  Empty on a clean resolution. */
  undeclaredKeys: string[];
  /** The typed failure category when resolution failed, else `null`. */
  category: ResolverErrorCategory | null;
  /** A human-facing message on failure / no-declaration; `null` on clean success. */
  message: string | null;
}

export interface PluginRootResponse {
  plugin: string;
  root: string | null;
  provenance: "recorded" | "self-healed" | "unrecoverable";
}

/** Content surface (WF-302): the served body of a bundled-doc ref, or a typed
 *  failure. Distinct from the body-free metadata queries above — this is the one
 *  path that returns a document body, for exactly the five served ref classes.
 *  `served` carries the resolved `path` + `content`; a failure NEVER carries a
 *  body and NEVER falls through to a raw read. */
export type ContentResponse =
  | {
      status: "served";
      refClass: ContentRefClass;
      path: string;
      content: string;
      bytes: number;
    }
  | {
      /** A composed `slot` body (WF-327): exactly ONE fragment linearized from
       *  the ordered tier chain (personal `_local/` override > pack contribution),
       *  under the slot's declared merge policy. `content` is the single served
       *  body; `parts` records the contributing tiers/sources (attribution only).
       *  The model never sees competing fragments — composition happened here. */
      status: "composed";
      refClass: "slot";
      skillPoint: string;
      policy: MergePolicy;
      content: string;
      bytes: number;
      parts: Array<{ tier: string; source: string; path: string }>;
    }
  | {
      /** A `slot` with zero contributions and no personal override — a typed
       *  "unfilled" outcome (NOT a body, NOT a wrong-path fall-through). Directs
       *  the caller to execute the skill's inline-default region unchanged (the
       *  WF-326 no-improvisation rule). A `local-read` surface → `continue`. */
      status: "unfilled";
      refClass: "slot";
      skillPoint: string;
      reaction: "continue";
      recovery: string;
      message: string;
    }
  | {
      /** Resolution failed — the ref points at nothing readable (unregistered /
       *  dangling-and-unrecoverable capability or plugin root, no declared
       *  template, resolver-build failure). Reports the matching `resolve_gate`
       *  degradation class (content read is a `local-read` surface → `continue`)
       *  with a `/wf:resolve` recovery path. */
      status: "unresolved";
      refClass: ContentRefClass | "slot" | null;
      category: ResolverErrorCategory;
      reaction: "continue";
      recovery: string;
      message: string;
    }
  | {
      /** The ref is outside the served classes — a skill body, a CI-only
       *  fixture/validator input, a path traversal, or a malformed ref. */
      status: "refused";
      refClass: string;
      reason: string;
    };

export interface LifecycleResponse {
  valid: boolean;
  cached: boolean;
  generatedAt: string | null;
  schemaVersion: number | null;
  counts: { capabilities: number; packs: number; providers: number };
  /** Per-slot composition provenance (WF-329): for each composed `skill.point`,
   *  the winning source and the tier it won from, plus whether a personal
   *  override is present. Empty when the project has no slot contributions or
   *  overrides. Body-free — attribution only, never a composed body. */
  slots: Array<{
    skillPoint: string;
    winningSource: string | null;
    tier: string;
    overridePresent: boolean;
    policy: string | null;
  }>;
  /** Skill slugs with a present `_local/profiles/<skill>.settings.json` override
   *  (WF-329) — the settings-override presence index. */
  settingsOverrides: string[];
  diagnostics: Diagnostic[];
}

/** The surface-gate decision (WF-272): given the current resolver health, how a
 *  local-only read / tracker write / delivery write must react to a failure. */
export interface SurfaceGateResponse {
  surface: SurfaceClass;
  /** True when the resolver produced a usable snapshot with no failure signals. */
  healthy: boolean;
  /** The reaction this surface takes: continue | warn | block. */
  reaction: FailureReaction;
  /** Distinct failure categories detected (empty when healthy). */
  categories: ResolverErrorCategory[];
  /** The failure-signal diagnostics, each carrying its category + recovery.
   *  Empty when healthy. Never a fragment / manifest / prompt body. */
  diagnostics: Diagnostic[];
  /** Deduplicated recovery paths (each names a `/wf:resolve` action). Empty when healthy. */
  recovery: string[];
  /** Invariant marker (C008): while assessing a failure, the surface gate NEVER
   *  falls back to a fallback folder-walk (`listDirs`) or environment probe
   *  (`listPlugins`) — it serves the last-known snapshot + classified failure.
   *  Always false. (This is the no-FALLBACK-probe guarantee proven by
   *  `failure-semantics.test.ts` via `listDirs === 0` / `listPlugins === 0`; a
   *  normal freshness `ensure()`/rebuild is a legitimate rebuild, not a probe.) */
  probed: false;
}

export interface PackCapabilitySummary {
  name: string;
  /** plugin-anchored registry path token, e.g. `plugin:wf-git/capabilities/git`. */
  path: string;
  manifestPath: string;
  kind: string | null;
  /** Ordered validated declarations; empty when absent or when the set is invalid. */
  questions: CapabilityRecord["questions"];
  /** Ordered normalized payload declarations; empty when absent or when any
   * declaration/source in the inspected pack is invalid. */
  payloads: PayloadDeclaration[];
  payloadDiagnostics: PayloadDiagnostic[];
  /** Ordered pack/question/field-attributed declaration diagnostics, aggregate-
   *  bounded across the complete `inspect_pack` response. */
  questionDiagnostics: QuestionDiagnostic[];
}

export interface InspectPackResponse {
  pluginId: string;
  pluginName: string;
  installed: boolean;
  enabled: boolean;
  version: string | null;
  installPath: string | null;
  capabilities: PackCapabilitySummary[];
  portableEvidence: PortablePackEvidence | null;
  machineBinding: MachineBindingEvidence | null;
  /** Stable identity of the pack's registerable surface; register_pack revalidates it. */
  fingerprint: string | null;
  valid: boolean;
  /** Ordered, aggregate-bounded inspection failures. */
  issues: string[];
}

export interface RegisterPackResponse {
  status: "registered" | "rejected";
  reason: string | null;
  capabilities: string[];
  root: string | null;
  selfCheck: "ok" | "failed" | "skipped";
  /** Preview of the registry rows the write applied (or would have applied). */
  preview: Array<{ section: string; key: string; value: string }>;
}

interface PackFingerprintInput {
  path: string;
  present: boolean;
  sha256: string | null;
}

const MAX_DECLARED_SOURCE_BYTES = 16 * 1024 * 1024;

/** Single source of truth for "is this a recognized surface token" — covers
 *  both the bare scope forms the provider-ownership index is keyed on
 *  (`engine`, `host`, `delivery`, `tracker`) and the composite `<phase>:<scope>`
 *  forms the tool schema and `/wf:qa-auto` advertise (`qa-execution:engine`,
 *  `qa-execution:host`). A token outside this set is a caller error, never a
 *  genuine "no provider registered" state. */
const KNOWN_SURFACES = new Set([
  "engine",
  "host",
  "delivery",
  "tracker",
  "qa-execution:engine",
  "qa-execution:host",
]);

/** Strip a leading `qa-execution:` prefix so the documented composite surface
 *  token resolves against the same bare-scope-keyed ownership index the bare
 *  token already matches. Bare tokens pass through unchanged. Only called for
 *  a token already confirmed to be in `KNOWN_SURFACES`. */
function bareScope(surface: string): string {
  return surface.startsWith("qa-execution:") ? surface.slice("qa-execution:".length) : surface;
}

/** Degradation class a consumer reproduces when a surface is not `ok`. Keyed
 *  off the bare scope so the composite and bare forms of the same surface
 *  yield the identical degradation class (an unnormalized composite `qa-
 *  execution:engine`/`qa-execution:host` falling through to `bare-core` would
 *  violate the required `engine-block`). */
function degradationFor(surface: string, state: ProviderResponse["state"]): string {
  if (state === "ok") return "ok";
  const scope = bareScope(surface);
  if (scope === "delivery") return "delivery-block";
  if (scope === "tracker") return "tracker-warn";
  if (scope === "engine" || scope === "host") return "engine-block";
  return "bare-core";
}

function boundInspectionIssues(issues: readonly string[]): string[] {
  const retained: string[] = [];
  let truncated = false;
  for (const issue of issues) {
    if (retained.length >= MAX_QUESTION_DIAGNOSTICS) {
      truncated = true;
      break;
    }
    if (
      Buffer.byteLength(JSON.stringify([...retained, issue]), "utf8") >
      MAX_NORMALIZED_QUESTION_BYTES
    ) {
      truncated = true;
      break;
    }
    retained.push(issue);
  }
  if (!truncated) return retained;

  const sentinel = "additional question diagnostics omitted after aggregate limit.";
  while (
    retained.length >= MAX_QUESTION_DIAGNOSTICS ||
    Buffer.byteLength(JSON.stringify([...retained, sentinel]), "utf8") >
      MAX_NORMALIZED_QUESTION_BYTES
  ) {
    retained.pop();
  }
  return [...retained, sentinel];
}

function boundInspectionQuestionDiagnostics(
  capabilities: readonly PackCapabilitySummary[],
): PackCapabilitySummary[] {
  const retained: Array<{ capabilityIndex: number; diagnostic: QuestionDiagnostic }> = [];
  let truncatedAt: number | null = null;

  outer: for (let capabilityIndex = 0; capabilityIndex < capabilities.length; capabilityIndex++) {
    for (const diagnostic of capabilities[capabilityIndex].questionDiagnostics) {
      if (retained.length >= MAX_QUESTION_DIAGNOSTICS) {
        truncatedAt = capabilityIndex;
        break outer;
      }
      const candidate = [...retained.map((entry) => entry.diagnostic), diagnostic];
      if (
        Buffer.byteLength(JSON.stringify(candidate), "utf8") >
        MAX_NORMALIZED_QUESTION_BYTES
      ) {
        truncatedAt = capabilityIndex;
        break outer;
      }
      retained.push({ capabilityIndex, diagnostic });
    }
  }

  if (truncatedAt === null) return [...capabilities];

  const sentinel = makeQuestionDiagnostic(
    capabilities[truncatedAt]?.name ?? "inspection",
    null,
    "ask",
    "question/diagnostics-truncated",
    "additional diagnostics omitted after aggregate limit.",
  );
  while (
    retained.length >= MAX_QUESTION_DIAGNOSTICS ||
    Buffer.byteLength(
      JSON.stringify([...retained.map((entry) => entry.diagnostic), sentinel]),
      "utf8",
    ) > MAX_NORMALIZED_QUESTION_BYTES
  ) {
    retained.pop();
  }
  retained.push({ capabilityIndex: truncatedAt, diagnostic: sentinel });

  const bounded = capabilities.map((capability) => ({
    ...capability,
    questionDiagnostics: [] as QuestionDiagnostic[],
  }));
  for (const entry of retained) {
    bounded[entry.capabilityIndex]!.questionDiagnostics.push(entry.diagnostic);
  }
  return bounded;
}

function boundInspectionPayloadDiagnostics(
  pluginId: string,
  capabilities: readonly PackCapabilitySummary[],
): PackCapabilitySummary[] {
  const retained: Array<{ capabilityIndex: number; diagnostic: PayloadDiagnostic }> = [];
  let truncatedAt: number | null = null;

  outer: for (let capabilityIndex = 0; capabilityIndex < capabilities.length; capabilityIndex++) {
    for (const diagnostic of capabilities[capabilityIndex].payloadDiagnostics) {
      if (retained.length >= MAX_PAYLOAD_DIAGNOSTICS) {
        truncatedAt = capabilityIndex;
        break outer;
      }
      const candidate = [...retained.map((entry) => entry.diagnostic), diagnostic];
      if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_NORMALIZED_PAYLOAD_BYTES) {
        truncatedAt = capabilityIndex;
        break outer;
      }
      retained.push({ capabilityIndex, diagnostic });
    }
  }

  if (truncatedAt === null) return [...capabilities];

  const sentinel = makePayloadDiagnostic(
    pluginId,
    capabilities[truncatedAt]?.name ?? "inspection",
    null,
    "table",
    "payload/diagnostics-truncated",
    "additional diagnostics omitted after aggregate limit.",
  );
  while (
    retained.length >= MAX_PAYLOAD_DIAGNOSTICS ||
    Buffer.byteLength(
      JSON.stringify([...retained.map((entry) => entry.diagnostic), sentinel]),
      "utf8",
    ) > MAX_NORMALIZED_PAYLOAD_BYTES
  ) {
    retained.pop();
  }
  retained.push({ capabilityIndex: truncatedAt, diagnostic: sentinel });

  const bounded = capabilities.map((capability) => ({
    ...capability,
    payloadDiagnostics: [] as PayloadDiagnostic[],
  }));
  for (const entry of retained) {
    bounded[entry.capabilityIndex]!.payloadDiagnostics.push(entry.diagnostic);
  }
  return bounded;
}

export class ResolverService {
  private current: ResolverSnapshot | null = null;
  private invalidated = false;
  /** Reasons the pending/last (in)validation was triggered — surfaced as
   *  diagnostics so every refresh/invalidation is explainable, never silent. */
  private pendingReasons: StaleReason[] = [];
  private lastRefreshReasons: StaleReason[] = [];

  constructor(private readonly ports: ResolverServicePorts) {}

  /** Ensure a usable, FRESH snapshot exists — the query-time correctness
   *  backstop. Every typed query routes through here; before reusing a cached or
   *  in-memory snapshot it re-validates the recorded input fingerprints and the
   *  schema/resolver version, rebuilding on any mismatch. Validation re-reads
   *  ONLY the exact source paths the snapshot recorded; profile templates use
   *  the same bounded contained-file port as discovery, while other sources use
   *  `ports.readFile`. It never lists/walks capability folders, so unchanged inputs are a cheap
   *  hash comparison with no rediscovery. Freshness is fingerprint-driven only;
   *  there is no elapsed-time / TTL path. */
  private ensure(): ResolverSnapshot {
    if (this.invalidated) return this.rebuild();

    const candidate = this.current ?? this.ports.readCache();
    if (!candidate) {
      this.pendingReasons = [
        { code: "cache/absent", message: "no snapshot cached yet; building the first." },
      ];
      return this.rebuild();
    }

    const { fresh, reasons } = evaluateFreshness(candidate, this.ports.workspaceRoot, {
      readFile: (p) => this.ports.readFile(p),
      readContainedFile: this.ports.readContainedFile
        ? (root, selectedPath, maxBytes) =>
            this.ports.readContainedFile!(root, selectedPath, maxBytes)
        : undefined,
      generatorVersion: RESOLVER_GENERATOR.version,
    });
    if (!fresh) {
      this.pendingReasons = reasons;
      return this.rebuild();
    }

    this.current = candidate;
    return candidate;
  }

  /** Full rediscovery + atomic persist. The ONE place a snapshot is built. */
  private rebuild(): ResolverSnapshot {
    this.current = this.ports.resolveFresh();
    this.ports.persist(this.current);
    this.invalidated = false;
    this.lastRefreshReasons = this.pendingReasons;
    this.pendingReasons = [];
    return this.current;
  }

  /** Failure-aware `ensure` for the surface gate (WF-272). Attempts ONE ensure
   *  (the single legitimate discovery); on a throw it classifies the failure and
   *  serves the last-known in-memory snapshot (possibly `null`) best-effort — it
   *  NEVER retries discovery, walks folders, or probes the environment as a
   *  fallback. That structural absence of a probe fallback is the C008 invariant. */
  private safeEnsure(): { snapshot: ResolverSnapshot | null; failure: ResolverFailure | null } {
    try {
      return { snapshot: this.ensure(), failure: null };
    } catch (err) {
      return { snapshot: this.current, failure: classifyThrow(err) };
    }
  }

  // --- R1 -----------------------------------------------------------------
  resolveConfig(): ConfigResponse {
    const s = this.ensure();
    return {
      workspaceRoot: s.workspaceRoot,
      registryPath: s.registryPath,
      coreConfig: s.coreConfig,
      idShape: s.idShape,
    };
  }

  // --- R2 -----------------------------------------------------------------
  resolveRegistry(): RegistryResponse {
    const s = this.ensure();
    return {
      capabilities: s.capabilities.map((c) => ({
        name: c.name,
        kind: c.kind,
        resolvedPath: c.resolvedPath,
        manifestPath: c.manifestPath,
        provenance: c.provenance,
        validity: c.validity,
        fragments: c.fragments,
        articles: c.articles,
        requires: c.requires,
        conflicts: c.conflicts,
        profileTemplatePath: c.profileTemplatePath,
        questions: c.questions,
      })),
    };
  }

  // --- R3 -----------------------------------------------------------------
  resolveProvider(surface: string): ProviderResponse {
    // An unrecognized surface token is a caller/invalid-argument error, never
    // a genuine "no provider registered" outcome — throw so `guard()` (tools.ts)
    // maps it to the MCP `isError` channel, distinct from `state: "unconfigured"`.
    // This must run BEFORE the ownership lookup so a typo can never masquerade
    // as a registered-but-empty surface.
    if (!KNOWN_SURFACES.has(surface)) {
      throw new Error(
        `unknown surface \`${surface}\`; expected one of: ${[...KNOWN_SURFACES].join(", ")}.`,
      );
    }
    const s = this.ensure();
    const owned = s.providerOwnership.find((o) => o.surface === bareScope(surface));
    if (!owned) {
      return {
        surface,
        owner: null,
        fragmentPath: null,
        state: "unconfigured",
        degradation: degradationFor(surface, "unconfigured"),
        diagnostics: `no capability owns the \`${surface}\` surface; degrade per its class.`,
      };
    }
    const pack =
      owned.state !== "ok"
        ? s.packs.find((p) => p.registeredCapabilities.includes(owned.owner))
        : undefined;
    return {
      surface,
      owner: owned.owner,
      fragmentPath: owned.fragmentPath,
      state: owned.state,
      degradation: degradationFor(surface, owned.state),
      diagnostics: pack?.diagnostics ?? null,
    };
  }

  // --- R4 -----------------------------------------------------------------
  resolveProfile(capability: string): ProfileResponse {
    const s = this.ensure();
    const present = Object.prototype.hasOwnProperty.call(s.profiles, capability);
    return { capability, present, values: present ? s.profiles[capability] : null };
  }

  // --- per-skill settings (WF-328): resolve declared keys under override ---
  /** Resolve a slotted skill's declared settings keys to their effective values
   *  under the hybrid precedence override > declared default, re-keyed per skill
   *  on the same `_local/profiles/` machinery as capability profiles. Locates the
   *  skill's `interface.md` (core plugin root first, then resolved pack roots),
   *  reads the optional `_local/profiles/<skill>.settings.json` override via the
   *  server's own fs, and merges. A skill with no override resolves to its
   *  declared defaults (no override is seeded); an override with a divergent value
   *  wins per key; an override carrying a key the interface does NOT declare is
   *  rejected loudly (`registry-invalid`, naming the key and the skill) rather than
   *  silently accepted. Values only — never a skill body or interface prose. */
  resolveSettings(skill: string): SettingsResponse {
    const s = this.ensure();
    const slug = typeof skill === "string" ? skill.trim() : "";
    const base: SettingsResponse = {
      skill: slug,
      declared: false,
      overridePresent: false,
      values: null,
      undeclaredKeys: [],
      category: null,
      message: null,
    };
    if (!isSkillSlug(slug)) {
      return {
        ...base,
        category: "registry-invalid",
        message: "a settings ref requires a `skill` slug (lowercase letters, digits, hyphens).",
      };
    }

    const overridePath = joinSlash(this.ports.workspaceRoot, settingsOverrideRelPath(slug));
    const overrideRaw = this.ports.readFile(overridePath);
    const overridePresent = overrideRaw !== null;

    const roots: string[] = [normalizeSlashes(this.ports.corePluginRoot)];
    for (const r of s.pluginRoots) {
      if (r.resolvedRoot) {
        roots.push(
          isAbsoluteRoot(r.resolvedRoot)
            ? normalizeSlashes(r.resolvedRoot)
            : joinSlash(this.ports.workspaceRoot, r.resolvedRoot),
        );
      }
    }

    const located = locateInterface(slug, roots, (p) => this.ports.readFile(p), joinSlash);
    if (!located) {
      return {
        ...base,
        overridePresent,
        message: overridePresent
          ? `skill \`${slug}\` has a settings override but no locatable settings-declaring \`interface.md\` — its keys cannot be validated. Install the owning pack or remove \`${SETTINGS_STORAGE_DIR}/${slug}.settings.json\`.`
          : `skill \`${slug}\` declares no settings (no settings-declaring \`interface.md\` located).`,
        category: overridePresent ? "registry-invalid" : null,
      };
    }

    let override: Record<string, unknown> | null = null;
    if (overrideRaw !== null) {
      const parsed = parseSettingsOverride(overrideRaw);
      if (!parsed.ok) {
        return {
          ...base,
          declared: true,
          overridePresent,
          category: "registry-invalid",
          message: `settings override for skill \`${slug}\` (\`${SETTINGS_STORAGE_DIR}/${slug}.settings.json\`) is not a valid JSON object: ${parsed.error}`,
        };
      }
      override = parsed.value;
    }

    const { values, undeclared } = mergeSettings(located.declared, override);
    if (undeclared.length > 0) {
      return {
        ...base,
        declared: true,
        overridePresent,
        undeclaredKeys: undeclared,
        category: "registry-invalid",
        message: `settings override for skill \`${slug}\` carries ${
          undeclared.length === 1 ? "a key" : "keys"
        } its \`interface.md\` does not declare: ${undeclared.map((k) => `\`${k}\``).join(", ")}.`,
      };
    }

    return {
      ...base,
      declared: true,
      overridePresent,
      values,
    };
  }

  // --- content surface (WF-302): resolve + read a bundled-doc body ---------
  /** Resolve a logical content ref (one of the five served classes) and read
   *  its body via the server's OWN Node `fs` (the `ports.readFile` port) — never
   *  a caller-side raw read. Resolution reuses the C008 snapshot facts (no second
   *  resolution engine); the body is read on demand and returned in the response
   *  only, so the persisted snapshot stays body-free. An unresolvable/unrecoverable
   *  ref, or a resolver-build failure, reports the matching `resolve_gate`
   *  degradation class with a `/wf:resolve` recovery path — never a wrong-path
   *  body, never a raw-read fall-through. An out-of-class ref (skill body, CI-only
   *  fixture) is refused. */
  resolveContent(ref: ContentRef): ContentResponse {
    let snapshot: ResolverSnapshot;
    try {
      snapshot = this.ensure();
    } catch (err) {
      // A resolver-build failure is a local-read gate: continue best-effort with
      // the classified category + recovery, but serve NO body (structural: there
      // is no snapshot to resolve against).
      const failure = classifyThrow(err);
      return {
        status: "unresolved",
        refClass: null,
        category: failure.category,
        reaction: "continue",
        recovery: recoveryFor(failure.category),
        message: `${failure.message} (failed input: ${failure.failedInput})`,
      };
    }

    // The `slot` class composes MANY bodies into one under a merge policy — a
    // distinct path from the five single-path served classes below.
    if (typeof ref.class === "string" && ref.class.trim() === "slot") {
      return this.resolveSlot(ref, snapshot);
    }

    const plan = resolveContentRef(ref, {
      snapshot,
      workspaceRoot: this.ports.workspaceRoot,
      corePluginRoot: this.ports.corePluginRoot,
    });

    if (plan.kind === "refused") {
      return { status: "refused", refClass: plan.refClass, reason: plan.reason };
    }
    if (plan.kind === "unresolved") {
      return {
        status: "unresolved",
        refClass: plan.refClass,
        category: plan.category,
        reaction: "continue",
        recovery: plan.recovery,
        message: plan.message,
      };
    }

    if (plan.kind === "contained") {
      const result = this.ports.readContainedFile
        ? this.ports.readContainedFile(
            plan.capabilityRoot,
            plan.selectedPath,
            MAX_PROFILE_TEMPLATE_BYTES,
          )
        : ({
            status: "unsupported",
            path: null,
            content: null,
          } satisfies ContainedFileReadResult);
      if (result.status === "ok") {
        return {
          status: "served",
          refClass: plan.refClass,
          path: result.path,
          content: result.content,
          bytes: Buffer.byteLength(result.content, "utf8"),
        };
      }

      const messageByStatus: Record<Exclude<typeof result.status, "ok">, string> = {
        missing: "the declared profile template is missing.",
        "too-large": "the declared profile template exceeds the maximum allowed size.",
        unsafe:
          "the declared profile template is not one regular, non-symlink file contained beneath its capability root.",
        unsupported: "contained profile-template reads are unavailable.",
        unreadable: "the declared profile template could not be read safely.",
      };
      return {
        status: "unresolved",
        refClass: plan.refClass,
        category: "registry-invalid",
        reaction: "continue",
        recovery: recoveryFor("registry-invalid"),
        message: messageByStatus[result.status],
      };
    }

    // plan.kind === "path": read the resolved body via the server's own fs.
    // A miss here is a caller-input error (the root resolved; the ref's shape
    // didn't) — `ref-not-found`, never the integrity-class `registry-invalid`.
    const content = this.ports.readFile(plan.path);
    if (content === null) {
      return {
        status: "unresolved",
        refClass: plan.refClass,
        category: "ref-not-found",
        reaction: "continue",
        recovery: recoveryFor("ref-not-found"),
        message: `the ref resolved to \`${plan.path}\` but no file is present there.`,
      };
    }
    return {
      status: "served",
      refClass: plan.refClass,
      path: plan.path,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
    };
  }

  // --- slot composition (WF-327): linearize + serve ONE composed body ------
  /** Resolve a `slot` ref to its single composed body. `planSlot` (pure) reads
   *  the body-free snapshot and yields the ordered candidate list under the
   *  precedence tier chain; this method reads each candidate via the server's own
   *  `fs` port and composes per the slot's merge policy. A present personal
   *  `_local/` override always outranks a committed `.wf/` project override, which
   *  always outranks a pack contribution; a `replace` slot serves the single
   *  highest-precedence body, an `append` slot the concatenation (registry order
   *  first, then the project override, the personal override last). This method is
   *  generic over the chain — a new tier changes nothing here. Zero contributions
   *  AND no override at either override tier → a typed
   *  `unfilled` outcome directing the caller to the inline default; a contributing
   *  capability that dangles → `unresolved` (registry-invalid); a declared pack
   *  body missing on disk → `unresolved` (ref-not-found). Never a wrong-path body,
   *  never a raw-read fall-through. */
  private resolveSlot(ref: ContentRef, snapshot: ResolverSnapshot): ContentResponse {
    const plan = planSlot(ref, snapshot, this.ports.workspaceRoot);

    if (plan.kind === "refused") {
      return { status: "refused", refClass: "slot", reason: plan.reason };
    }
    if (plan.kind === "unresolved") {
      return {
        status: "unresolved",
        refClass: "slot",
        category: plan.category,
        reaction: "continue",
        recovery: recoveryFor(plan.category),
        message: plan.message,
      };
    }

    // Read each candidate body via the server's own fs. A present override is
    // included; an absent optional override is skipped; a declared pack fragment
    // body that is missing on disk is a caller/pack error (`ref-not-found`).
    const present: PresentPart[] = [];
    for (const c of plan.contributions) {
      const content = this.ports.readFile(c.path);
      if (content === null) {
        if (c.optional) continue;
        return {
          status: "unresolved",
          refClass: "slot",
          category: "ref-not-found",
          reaction: "continue",
          recovery: recoveryFor("ref-not-found"),
          message: `slot \`${plan.skillPoint}\` contribution from \`${c.source}\` resolved to \`${c.path}\` but no file is present there.`,
        };
      }
      present.push({ tier: c.tier, rank: c.rank, source: c.source, path: c.path, content });
    }

    if (present.length === 0) {
      return {
        status: "unfilled",
        refClass: "slot",
        skillPoint: plan.skillPoint,
        reaction: "continue",
        recovery: `Slot \`${plan.skillPoint}\` is unfilled — no capability contributes to it, no committed \`${PROJECT_OVERRIDE_DIR}/${plan.skillPoint}.md\` project override exists, and no personal \`${OVERRIDE_DIR}/${plan.skillPoint}.md\` override exists. Execute the skill's inline-default region exactly as written (the no-improvisation rule); to fill it, register a contributing capability, commit the project override, or add the personal override file.`,
        message: `no contribution or override for slot \`${plan.skillPoint}\`.`,
      };
    }

    const content = composeSlotBody(plan.policy, present);
    return {
      status: "composed",
      refClass: "slot",
      skillPoint: plan.skillPoint,
      policy: plan.policy,
      content,
      bytes: Buffer.byteLength(content, "utf8"),
      parts: present.map((p) => ({ tier: p.tier, source: p.source, path: p.path })),
    };
  }

  // --- typed bootstrap routing ---------------------------------------------
  resolveRouting(inputs: RoutingInputs): RoutingDecision {
    const snapshot = this.ensure();
    return resolveRouting(snapshot.routing ?? {}, inputs);
  }

  // --- R5 -----------------------------------------------------------------
  resolvePluginRoot(plugin: string): PluginRootResponse {
    const s = this.ensure();
    const row = s.pluginRoots.find((r) => r.plugin === plugin);
    if (!row) {
      return { plugin, root: null, provenance: "unrecoverable" };
    }
    return { plugin, root: row.resolvedRoot, provenance: row.provenance };
  }

  // --- lifecycle ----------------------------------------------------------
  inspect(): LifecycleResponse {
    // Report state WITHOUT forcing a rebuild: prefer the in-memory view, else
    // peek the cache. An invalidated session reports valid:false until refresh.
    const snap = this.current ?? this.ports.readCache();
    // Surface freshness reasons as diagnostics: pending reasons while
    // invalidated (why the next query rebuilds), else the reasons that drove the
    // last rebuild (why the current view was refreshed).
    const reasons = this.invalidated ? this.pendingReasons : this.lastRefreshReasons;
    const diagnostics: Diagnostic[] = [...(snap?.diagnostics ?? [])];
    for (const r of reasons) {
      diagnostics.push({
        severity: "info",
        code: `freshness/${r.code}`,
        message: r.source ? `${r.message} (${r.source})` : r.message,
      });
    }
    return {
      valid: !this.invalidated && snap !== null,
      cached: snap !== null,
      generatedAt: snap?.generatedAt ?? null,
      schemaVersion: snap?.schemaVersion ?? null,
      counts: {
        capabilities: snap?.capabilities.length ?? 0,
        packs: snap?.packs.length ?? 0,
        providers: snap?.providerOwnership.length ?? 0,
      },
      slots: (snap?.slots ?? []).map((s) => ({
        skillPoint: s.skillPoint,
        winningSource: s.winningSource,
        tier: s.tier,
        overridePresent: s.overridePresent,
        policy: s.policy,
      })),
      settingsOverrides: snap?.settingsOverrides ?? [],
      diagnostics,
    };
  }

  /** Force a full rebuild + persist now, recording an explicit request reason so
   *  the resulting view carries a diagnostic explaining why it was refreshed. */
  refresh(reasons: StaleReason[] = []): LifecycleResponse {
    this.pendingReasons = reasons.length
      ? reasons
      : [{ code: "explicit-request", message: "explicit refresh requested." }];
    this.rebuild();
    return this.inspect();
  }

  /** Mark the resolved view stale so the next query (or an explicit refresh)
   *  rebuilds it. Typed consumers may record suspected-stale reasons, which the
   *  next inspect/rebuild surfaces as diagnostics (concurrency-safe: only the
   *  in-memory flag flips; the persisted cache is untouched until the rebuild). */
  invalidate(reasons: StaleReason[] = []): LifecycleResponse {
    this.invalidated = true;
    this.pendingReasons = reasons.length
      ? reasons
      : [
          {
            code: "suspected-stale",
            message: "resolved view marked stale by an explicit invalidate request.",
          },
        ];
    return this.inspect();
  }

  // --- surface-gate: resolver-failure semantics by surface (WF-272) -------
  /** Assess the resolver's health and bind any failure to a surface's reaction.
   *  A consumer calls this immediately before a local-only read, a tracker
   *  write, or a delivery write to learn whether to continue / warn / block —
   *  reproducing the existing core degradation policy for a BROKEN resolver
   *  state. On a failure it surfaces categorized diagnostics + a `/wf:resolve`
   *  recovery path and NEVER falls back to folder-walking or environment
   *  probing (C008): every fact comes from the already-collected snapshot
   *  diagnostics / the classified build failure. */
  assessSurface(surface: SurfaceClass): SurfaceGateResponse {
    const { snapshot, failure } = this.safeEnsure();

    const diagnostics: Diagnostic[] = [];
    if (snapshot) {
      for (const d of snapshot.diagnostics) {
        if (isFailureSignal(d)) diagnostics.push(annotate(d));
      }
    }
    if (failure) {
      diagnostics.push({
        severity: "error",
        code: `resolver/${failure.category}`,
        message: `${failure.message} (failed input: ${failure.failedInput})`,
        category: failure.category,
        recovery: recoveryFor(failure.category),
      });
    }
    // A hard build failure surfaces through `failure` above: `ensure()` either
    // returns a non-null snapshot or throws (which `safeEnsure()` classifies into
    // a non-null `failure`), so `!snapshot && !failure` is unreachable — a missing
    // snapshot always arrives paired with a classified failure.
    const healthy = diagnostics.length === 0 && snapshot !== null;
    const categories = [
      ...new Set(diagnostics.map((d) => d.category).filter((c): c is ResolverErrorCategory => !!c)),
    ];
    const recovery = [...new Set(diagnostics.map((d) => d.recovery).filter((r): r is string => !!r))];

    return {
      surface,
      healthy,
      reaction: reactionFor(surface, healthy),
      categories,
      diagnostics,
      recovery,
      probed: false,
    };
  }

  // --- R6: inspect_pack (read-only) --------------------------------------
  inspectPack(pluginId: string): InspectPackResponse {
    const pluginName = this.bareName(pluginId);
    const listing = this.ports.listPlugins();

    if (!listing.ok) {
      return this.uninspectablePack(
        pluginId,
        pluginName,
        "`claude plugin list --json` is unavailable; pack state cannot be resolved.",
      );
    }

    const pack = listing.plugins.find(
      (p) => p.id === pluginId || p.name === pluginName,
    );
    if (!pack) {
      return this.uninspectablePack(
        pluginId,
        pluginName,
        `plugin \`${pluginId}\` is not installed.`,
      );
    }

    return this.inspectListedPack(pack, pluginId, pluginName);
  }

  /** The not-installed / no-inventory shape: everything false, one issue. */
  private uninspectablePack(
    pluginId: string,
    pluginName: string,
    issue: string,
  ): InspectPackResponse {
    return {
      pluginId,
      pluginName,
      installed: false,
      enabled: false,
      version: null,
      installPath: null,
      capabilities: [],
      portableEvidence: null,
      machineBinding: null,
      fingerprint: null,
      valid: false,
      issues: boundInspectionIssues([issue]),
    };
  }

  /**
   * Inspect one ALREADY-RESOLVED inventory record. Split out of `inspectPack` so
   * a caller holding a whole inventory (pack discovery) inspects every pack
   * against ONE `listPlugins()` call — that port shells out to the `claude` CLI,
   * so calling it per pack would turn a single discovery run into N process
   * spawns and let the inventory shift mid-run.
   *
   * `reportedId`/`reportedName` are echoed into the response so a lookup by bare
   * name still reports the id the caller asked about, exactly as before.
   */
  private inspectListedPack(
    pack: InstalledPlugin,
    reportedId: string = pack.id,
    reportedName: string = pack.name,
  ): InspectPackResponse {
    const pluginId = reportedId;
    const base: InspectPackResponse = {
      pluginId,
      pluginName: reportedName,
      installed: false,
      enabled: false,
      version: null,
      installPath: null,
      capabilities: [],
      portableEvidence: null,
      machineBinding: null,
      fingerprint: null,
      valid: false,
      issues: [],
    };
    const finish = (): InspectPackResponse => {
      base.capabilities = boundInspectionQuestionDiagnostics(base.capabilities);
      base.capabilities = boundInspectionPayloadDiagnostics(pluginId, base.capabilities);
      base.issues = boundInspectionIssues(base.issues);
      return base;
    };

    base.installed = true;
    base.enabled = pack.enabled;
    base.version = pack.version;
    base.installPath = pack.installPath;

    if (!pack.enabled) base.issues.push(`plugin \`${pluginId}\` is disabled.`);

    const found = this.scanPackCapabilities(pack.installPath, pack.name, pack.id);
    base.capabilities = found.capabilities;
    base.issues.push(...found.issues);
    if (found.capabilities.length === 0) {
      base.issues.push(
        `no readable \`capabilities/*/manifest.md\` under \`${pack.installPath}\`.`,
      );
    }

    if (!found.payloadInvalid) {
      base.portableEvidence = createPortablePackEvidence({
        pluginId: pack.id,
        version: pack.version,
        capabilities: found.capabilities.map((capability) => capability.name),
        manifestHashes: found.manifestHashes,
        declaredSourceHashes: found.declaredSourceHashes,
      });
      if (base.portableEvidence === null) {
        base.issues.push("portable pack evidence is incomplete or non-deterministic.");
      }
    }

    const canonicalRoot = this.ports.canonicalizeRoot?.(pack.installPath) ?? null;
    base.machineBinding =
      canonicalRoot === null
        ? null
        : createMachineBindingEvidence({
            pluginId: pack.id,
            canonicalRoot,
            cliScope: pack.scope,
            enablement: pack.enabled ? "enabled" : "disabled",
            observedVersion: pack.version,
            localFingerprints: found.localFingerprints,
          });
    if (base.machineBinding === null) {
      base.issues.push("machine-local binding evidence is incomplete or non-deterministic.");
    }

    base.fingerprint = this.packFingerprint(pack, found.fingerprintInputs);
    base.valid = base.enabled && base.capabilities.length > 0 && base.issues.length === 0;
    return finish();
  }

  // --- R6: discover_packs (read-only, byte-inert) ------------------------
  /**
   * Join the authoritative inventory, the snapshot's own pack records, recorded
   * vs. observed lifecycle evidence, and each pack's declared questions into one
   * deterministic inventory a maintainer can act on.
   *
   * BYTE-INERT. Every step here reads: `listPlugins()` runs the CLI, the ledger
   * reads are `readFile`, inspection hashes files, and the join is a pure
   * function. Nothing on this path writes a ledger, a seed proposal, or any
   * other file, and no `enablement` is changed. (`ensure()` may refresh the
   * resolver's own gitignored snapshot cache — that is the shared read-query
   * machinery every typed resolver query already runs, not a discovery write.)
   *
   * The admitted workspace root is consumed from `this.ports.workspaceRoot`.
   * `WorkspaceServiceRegistry.select()` binds one service per admitted root, so
   * that value IS the admitted root; discovery never re-derives one.
   */
  discoverPacks(): DiscoverPacksResponse {
    // WF-451 — RECOVERY RUNS FIRST, BEFORE ANY LIFECYCLE STATE IS READ.
    //
    // The ordering is the whole point. `discoverPacksWithInspection()` reads the
    // snapshot, the CLI inventory, and the evidence ledger; running it before
    // recovery would mean classifying packs from state an interrupted
    // transaction may have left half-written. So the guarded entry takes the
    // exclusive lock, recovers whatever it can prove, and only then reads.
    //
    // Discovery NEVER CREATES A JOURNAL. It ships before any mutator exists and
    // has no transaction of its own to open; it may only recover a pre-existing
    // one. With no journal present the lock is taken and released, no
    // transaction state is created, and the run is byte-inert.
    const recovery = this.ports.recovery
      ? recoverInterruptedTransaction(this.ports.recovery)
      : noRecoveryReport();

    if (!recovery.proceeded) {
      // The fail-safe stop. Nothing below this line runs, so no lifecycle state
      // is read at all. The inventory reports `unavailable`, which under WF-446's
      // trust asymmetry can never establish that a registered pack is orphaned —
      // a halted run must not be mistakable for an observation of absence.
      return {
        workspaceRoot: this.ports.workspaceRoot,
        inventory: {
          confidence: "unavailable",
          mayEstablishAbsence: false,
          observedCount: 0,
          issues: [],
        },
        packs: [],
        diagnostics: [
          {
            pluginId: null,
            code: "discovery/halted-unrecovered",
            message: `discovery did not proceed: recovery reported \`${recovery.state}\`, so lifecycle state was never read.`,
          },
        ],
        recovery,
      };
    }

    return this.discoverPacksWithInspection(recovery).response;
  }

  /**
   * The discovery join PLUS the per-pack inspection results it already computed.
   *
   * `discoverPacks()` deliberately returns only the body-free response, but the
   * planner (WF-447) needs one more fact discovery does not surface: the resolved
   * `manifestPath` of a pack that is installed but NOT yet registered, so its
   * `requires` / `conflicts` / provider scopes can join the post-plan capability
   * set. Re-inspecting through `inspectPack()` would re-run the `claude` CLI once
   * per pack and let the inventory shift mid-run — the exact cost
   * `inspectListedPack` was split out to avoid — so the inspections are handed
   * back from the single run instead.
   */
  private discoverPacksWithInspection(recovery: RecoveryReport = noRecoveryReport()): {
    response: DiscoverPacksResponse;
    inspected: Map<string, InspectPackResponse>;
    snapshot: ResolverSnapshot;
    /** Recorded artifact proof, keyed by declared destination (WF-449). */
    recordedArtifacts: Map<string, ArtifactEvidence>;
  } {
    const snapshot = this.ensure();
    const workspaceRoot = this.ports.workspaceRoot;

    // ONE inventory read for the whole run — see `inspectListedPack`.
    const listing = this.ports.listPlugins();

    // Recorded evidence. The declared home decides which file holds the portable
    // section; the binding section is always machine-local. When the home is
    // `local` both paths are the same file and each read takes its own section.
    const home = resolveLedgerHome();
    const readLedger = (relPath: string | null): EvidenceLedger =>
      relPath === null
        ? parseEvidenceLedger(null)
        : parseEvidenceLedger(this.ports.readFile(joinSlash(workspaceRoot, relPath)));
    const recordedPortable = readLedger(home.portablePath).portable;
    const recordedBinding = readLedger(home.bindingPath).binding;

    const byId = new Map(listing.plugins.map((plugin) => [plugin.id, plugin]));
    const byName = new Map(listing.plugins.map((plugin) => [plugin.name, plugin]));

    const inspectedByPluginId = new Map<string, InspectPackResponse>();
    const packs = snapshot.packs.map((record) => {
      const listed = byId.get(record.pluginId) ?? byName.get(record.pluginName) ?? null;
      // A registered pack the inventory does not list cannot be inspected, so it
      // carries no observed evidence and no questions — which is precisely what
      // makes its comparison `evidence-missing` rather than a false `equal`.
      const inspected = listed === null ? null : this.inspectListedPack(listed);
      if (inspected !== null) inspectedByPluginId.set(record.pluginId, inspected);
      return {
        record,
        expectedPortable: recordedPortable.get(record.pluginId) ?? null,
        observedPortable: inspected?.portableEvidence ?? null,
        priorBinding: recordedBinding.get(record.pluginId) ?? null,
        observedBinding: inspected?.machineBinding ?? null,
        questions: inspected
          ? inspected.capabilities.flatMap((capability) => capability.questions)
          : [],
        inspectionValid: inspected?.valid ?? false,
        inspectionIssues: inspected?.issues ?? [],
      };
    });

    return {
      response: joinDiscoveredPacks({
        workspaceRoot,
        inventory: {
          ok: listing.ok,
          contractOk: listing.contractOk,
          issues: listing.issues,
          plugins: listing.plugins,
        },
        packs,
        // Echoed, never consulted. The default is the byte-inert `no-journal`
        // report, which is what `plan_install` gets: planner integration is
        // WF-452's, so this shared path is left exactly as byte-inert as it was.
        recovery,
      }),
      inspected: inspectedByPluginId,
      snapshot,
      recordedArtifacts: readLedger(home.portablePath).artifacts,
    };
  }

  // --- WF-447: plan_install (read-only, byte-inert) -----------------------
  /**
   * Preview the effect of one explicit selected set.
   *
   * BYTE-INERT on every path. The inputs are the WF-446 discovery join (which is
   * itself byte-inert), the already-resolved snapshot, and — for a pack that is
   * installed but not yet registered — one `readFile` of its capability manifest
   * so the post-plan capability set is complete. Nothing here writes a ledger, a
   * seed, a project answer, an enablement flag, or any other byte, and the join
   * that produces the response is a pure function with no write capability at all.
   *
   * `admission` is supplied by the caller so the typed `invalid-root` envelope is
   * produced without this method ever being reached on an inadmissible root.
   *
   * WF-452 — RECOVERY RUNS FIRST, BEFORE ANY LIFECYCLE STATE IS READ, exactly as
   * it does for discovery. The ordering is the whole point: everything below
   * reads state (the snapshot, the CLI inventory, the evidence ledger, declared
   * payload sources, managed-artifact bytes), and planning from state an
   * interrupted transaction may have left half-written is the failure this
   * retrofit exists to prevent.
   *
   * PLANNING NEVER CREATES A JOURNAL, a backup, or a transaction of its own — it
   * may only recover a pre-existing one. With no journal present the lock is
   * taken and released, no transaction state is created, and the run is
   * byte-inert. Like discovery, planning is lock-acquiring but journal-free.
   *
   * Recovery runs EXACTLY ONCE per plan run: the report is threaded into
   * `discoverPacksWithInspection(recovery)`, which recovers nothing itself, so a
   * `plan_install` call takes the lock once rather than twice.
   */
  planInstall(
    admission: PlanAdmissionState,
    selection: PlanSelectionInput,
  ): PlanInstallResponse {
    if (!admission.admitted) {
      return planInstallJoin({
        admission,
        inventory: { confidence: "unavailable", mayEstablishAbsence: false, observedCount: 0, issues: [] },
        packs: [],
        capabilities: [],
        selection,
        // Admission failed before any root-bound port — and therefore before any
        // recovery port — existed, so nothing was recovered and nothing could be.
        recovery: invalidRootRecoveryReport(
          admission.diagnostic ??
            "the declared workspace root was not admitted, so no recovery was attempted.",
        ),
      });
    }

    const recovery = this.ports.recovery
      ? recoverInterruptedTransaction(this.ports.recovery)
      : noRecoveryReport();

    return this.planFrom(admission, selection, recovery).plan;
  }

  /**
   * The plan join over an ALREADY-PERFORMED recovery.
   *
   * Split out of `planInstall` for WF-453: the mutator must recover once, then
   * hold the exclusive lock across BOTH the revalidation and the transaction. If
   * it re-entered `planInstall` it would recover a second time — and, worse,
   * `recoverInterruptedTransaction` would find the lock it is itself holding and
   * refuse as `held-by-other`. Threading the finished report through is the same
   * technique `planInstall` already uses for `discoverPacksWithInspection`.
   *
   * Returns the per-pack inspections alongside the plan, because the mutator
   * needs each addition's install root and capability paths to render the
   * registry rows and re-inspecting would re-run the CLI and let the inventory
   * shift mid-transaction.
   */
  private planFrom(
    admission: Extract<PlanAdmissionState, { admitted: true }>,
    selection: PlanSelectionInput,
    recovery: RecoveryReport,
  ): { plan: PlanInstallResponse; inspected: Map<string, InspectPackResponse> } {
    if (!recovery.proceeded) {
      // The fail-safe stop. Nothing below this line runs, so no lifecycle state
      // is read at all. The pure join composes the halted envelope from the same
      // gate, so the property holds whether a caller enters through this service
      // or drives the join directly.
      return {
        plan: planInstallJoin({
          admission,
          inventory: { confidence: "unavailable", mayEstablishAbsence: false, observedCount: 0, issues: [] },
          packs: [],
          capabilities: [],
          selection,
          recovery,
        }),
        inspected: new Map(),
      };
    }

    const { response, inspected, snapshot, recordedArtifacts } =
      this.discoverPacksWithInspection(recovery);

    // Which pack owns which registered capability. Derived from the snapshot's
    // own attribution — never re-parsed from a registry row.
    const ownerOfCapability = new Map<string, string>();
    for (const pack of snapshot.packs) {
      for (const name of pack.registeredCapabilities) ownerOfCapability.set(name, pack.pluginId);
    }

    const capabilities: PlanCapabilityInput[] = [];
    const seenCapabilities = new Set<string>();

    // Registered capabilities: the snapshot already carries requires/conflicts
    // and the provider fragments' partition scopes.
    for (const capability of snapshot.capabilities) {
      const pluginId = ownerOfCapability.get(capability.name);
      if (pluginId === undefined) continue;
      seenCapabilities.add(capability.name);
      capabilities.push({
        pluginId,
        name: capability.name,
        requires: [...capability.requires],
        conflicts: [...capability.conflicts],
        providerScopes: capability.fragments
          .filter((fragment) => fragment.contributionKind === "provider" && fragment.scope !== null)
          .map((fragment) => fragment.scope as string),
      });
    }

    // Not-yet-registered capabilities an addition would bring. Their metadata is
    // not in the snapshot (the snapshot records the ACTIVE registry), so the one
    // manifest read below is what makes a dependency, conflict, or provider
    // overlap introduced BY the addition detectable at plan time rather than at
    // apply time.
    for (const pluginId of new Set(selection.desired)) {
      const pack = response.packs.find((candidate) => candidate.pluginId === pluginId);
      if (pack === undefined || pack.registeredCapabilities.length > 0) continue;
      for (const summary of inspected.get(pluginId)?.capabilities ?? []) {
        if (seenCapabilities.has(summary.name)) continue;
        seenCapabilities.add(summary.name);
        const raw = this.ports.readFile(summary.manifestPath);
        const parsed = raw === null ? null : parseManifest(raw);
        capabilities.push({
          pluginId,
          name: summary.name,
          requires: parsed?.requires ?? [],
          conflicts: parsed?.conflicts ?? [],
          providerScopes: (parsed?.fragments ?? [])
            .filter((fragment) => fragment.contributionKind === "provider" && fragment.scope !== null)
            .map((fragment) => fragment.scope as string),
        });
      }
    }

    const payloads = this.collectPayloadFacts(admission.root, inspected);
    return {
      plan: planInstallJoin({
        admission,
        inventory: response.inventory,
        packs: response.packs,
        capabilities,
        selection,
        payloads,
        artifacts: this.collectArtifactFacts(admission.root, payloads, recordedArtifacts),
        recovery,
      }),
      inspected,
    };
  }

  /**
   * The sole public mutator for an exact approved plan (WF-453, widened by
   * WF-454 from registry-only to registry + evidence + profile seeds).
   *
   * The whole method is one guarded, crash-recoverable journaled transaction. It
   * recovers BEFORE it decides anything, holds the exclusive lock across both the
   * revalidation and the mutation, refuses everything it is not the mutator for,
   * and — on any failure after the journal exists — rolls back and reports what
   * it could not resolve rather than claiming a partial success.
   *
   * Ordering is the contract, not an implementation detail:
   *
   * 1. **Recovery first, reported separately.** A pre-entry recovery is a fact
   *    about the workspace, not about this call; it is carried in its own
   *    `recovery` field and never folded into `status`. An unrecovered workspace
   *    halts here, before the lock, because the plan it would revalidate against
   *    is not trustworthy.
   * 2. **Lock, then revalidate.** The plan is recomputed UNDER the lock via
   *    `planFrom`, so the `expectedPlanId` comparison cannot race a concurrent
   *    installer. Recomputing outside the lock would compare against a plan that
   *    another process could invalidate between the check and the write.
   * 3. **Screen and gate before any journal.** Every stale-identity, unsupported-
   *    action, and applicability refusal happens while the workspace is still
   *    byte-identical to its pre-call state: nothing to roll back, so nothing can
   *    be left half-undone.
   * 4. **Transaction.** Only then does `applyTransaction` create a journal.
   *
   * The lock is owned HERE and not by the transaction driver precisely because it
   * must also cover step 2. The driver assumes it is held, and its rollback runs
   * through a lock-neutral façade so it never deadlocks against this holder.
   */
  applyInstall(
    admission: PlanAdmissionState,
    selection: PlanSelectionInput,
    expectedPlanId: string,
  ): ApplyInstallResponse {
    const halted = (
      status: ApplyStatus,
      reason: ApplyReason | null,
      recovery: RecoveryReport,
      plan: PlanInstallResponse | null,
      diagnostics: DiscoveryIssue[] = [],
    ): ApplyInstallResponse => ({
      applyVersion: APPLY_ENVELOPE_VERSION,
      workspaceRoot: admission.admitted ? admission.root : null,
      admission,
      status,
      reason,
      transactionId: null,
      plan: {
        planId: plan?.identity.planId ?? null,
        expectedPlanId,
        matched: plan !== null && plan.identity.planId === expectedPlanId,
        applicability: plan?.applicability ?? null,
        mode: plan?.mode ?? null,
      },
      applied: [],
      deferred: [],
      rollback: null,
      selfCheck: "skipped",
      refreshed: false,
      recovery,
      residue: {
        clean: true,
        journalRetained: false,
        backupsRetained: false,
        detail: "no transaction was created.",
      },
      diagnostics,
    });

    if (!admission.admitted) {
      return halted("invalid-root", "apply/invalid-root", noRecoveryReport(), null);
    }

    // Recovery ports are the lock's home. Without them there is no exclusion
    // primitive at all, and an unserialized mutator is worse than no mutator —
    // refuse rather than mutate unprotected.
    const recoveryPorts = this.ports.recovery;
    if (recoveryPorts === undefined) {
      return halted("halted", "apply/lock-unavailable", noRecoveryReport(), null, [
        {
          code: "apply-lock-unavailable",
          message: "no lifecycle recovery ports are configured, so the exclusive lock cannot be taken.",
        },
      ]);
    }

    // Step 1 — recover before deciding anything, and report it separately.
    const recovery = recoverInterruptedTransaction(recoveryPorts);
    if (!recovery.proceeded) {
      return halted("halted", "apply/halted-unrecovered", recovery, null);
    }

    // Step 2 — the exclusive lock, held across BOTH the revalidation and the
    // mutation. `held-by-other` is the concurrent-entry refusal, not an error.
    const lock = recoveryPorts.acquireLock();
    if (!lock.ok) {
      return halted(
        "rejected",
        lock.reason === "held-by-other" ? "apply/lock-held" : "apply/lock-unavailable",
        recovery,
        null,
        [{ code: `apply-lock-${lock.reason}`, message: lock.diagnostic }],
      );
    }

    try {
      const { plan, inspected } = this.planFrom(admission, selection, recovery);

      // Step 3 — screen and gate, all of it before any journal exists.
      //
      // The constitution record's presence is read HERE, under the lock, and
      // handed to the pure screen (WF-455). Reading it before the lock would let
      // it appear or vanish between the screen and the compose, and the screen
      // itself must stay filesystem-free for the pre-journal guarantee to remain
      // provable without one.
      const constitutionAbs = joinSlash(this.ports.workspaceRoot, CONSTITUTION_RELPATH);
      const gate = decideApplyGate({
        plan,
        expectedPlanId,
        journalPresent: recoveryPorts.readJournal() !== null,
        constitutionRecordPresent: this.ports.readFile(constitutionAbs) !== null,
      });
      if (!gate.ok) {
        const refused = halted("rejected", gate.reason, recovery, plan, [
          { code: gate.reason, message: gate.detail },
        ]);
        return { ...refused, deferred: gate.screened.deferred };
      }

      // The registry destination. A shape or containment failure is a refusal
      // before the transaction, for the same reason as everything else in step 3.
      const registryRel = this.ports.registryRelPath();
      const shapeError = registryPathShapeError(registryRel);
      if (shapeError) {
        return {
          ...halted("rejected", "apply/registry-unresolvable", recovery, plan, [
            {
              code: "apply/registry-unresolvable",
              message: `registryPath \`${registryRel}\` is not a forward-slash repo-relative file path: ${shapeError}.`,
            },
          ]),
          deferred: gate.screened.deferred,
        };
      }

      let registryAbs: string;
      try {
        registryAbs =
          this.ports.resolveRegistryWritePath?.(registryRel) ??
          joinSlash(this.ports.workspaceRoot, registryRel);
      } catch (err) {
        return {
          ...halted("rejected", "apply/registry-unresolvable", recovery, plan, [
            {
              code: "apply/registry-unresolvable",
              message: `registryPath \`${registryRel}\` escapes the selected workspace: ${
                err instanceof Error ? err.message : String(err)
              }`,
            },
          ]),
          deferred: gate.screened.deferred,
        };
      }

      // The registry facts each supported action needs, taken from the SAME
      // inspection the revalidated plan was built from. Re-inspecting here would
      // let the inventory shift between the plan that was approved and the rows
      // that get written.
      const facts = new Map<string, ApplyRegistryFact>();
      for (const entry of plan.registryDelta.additions) {
        const pack = inspected.get(entry.pluginId);
        if (pack === undefined) continue;
        facts.set(entry.pluginId, {
          pluginId: entry.pluginId,
          pluginName: pack.pluginName,
          installPath: pack.installPath,
          capabilities: pack.capabilities.map((c) => ({ name: c.name, path: c.path })),
        });
      }
      for (const entry of plan.registryDelta.deregistrations) {
        facts.set(entry.pluginId, {
          pluginId: entry.pluginId,
          pluginName: entry.pluginName,
          installPath: null,
          capabilities: entry.capabilities.map((name) => ({ name, path: "" })),
        });
      }

      const current = this.ports.readFile(registryAbs) ?? "";
      const mutation = renderRegistryMutation(current, gate.screened.supported, facts);
      if (!mutation.ok) {
        return {
          ...halted("rejected", mutation.reason, recovery, plan, [
            { code: mutation.reason, message: mutation.detail },
          ]),
          deferred: gate.screened.deferred,
        };
      }

      // What the post-write self-check must observe. Derived from the actions
      // that were actually rendered, so a self-check can never pass by asserting
      // nothing.
      //
      // The registry half switches on the action kind EXPLICITLY. Before WF-454
      // the supported set was exactly the registry pair, so "not an add" could
      // safely mean "a deregistration"; now that `evidence-seed` and
      // `answer-write` are also supported, that `else` would assert a pack's
      // capabilities are ABSENT because its binding was seeded — a self-check
      // that would fail the transaction for succeeding.
      const present: string[] = [];
      const absent: string[] = [];
      for (const action of gate.screened.supported) {
        if (action.kind !== "registry-add" && action.kind !== "registry-deregister") continue;
        const fact = action.pluginId === null ? undefined : facts.get(action.pluginId);
        if (fact === undefined) continue;
        const names = fact.capabilities.map((c) => c.name);
        if (action.kind === "registry-add") present.push(...names);
        else absent.push(...names);
      }

      // Step 3b — the WF-454 targets: lifecycle evidence and profile seeds.
      // Every refusal below still happens before `applyTransaction` is called, so
      // it is byte-inert from the recovered baseline exactly like step 3.
      const composed = this.composeApplyTargets({
        plan,
        inspected,
        supported: gate.screened.supported,
        registryRel,
        registryContent: mutation.content,
        registryChanged: mutation.changed,
      });
      if (!composed.ok) {
        return {
          ...halted("rejected", composed.reason, recovery, plan, [
            { code: composed.reason, message: composed.detail },
          ]),
          deferred: gate.screened.deferred,
        };
      }

      const applyPorts = this.ports.createApply?.(registryRel, (expectation) =>
        this.selfCheckRegistry(expectation),
      );
      if (applyPorts === undefined) {
        return {
          ...halted("rejected", "apply/registry-unresolvable", recovery, plan, [
            {
              code: "apply/registry-unresolvable",
              message: "no apply ports are configured, so the registry cannot be mutated.",
            },
          ]),
          deferred: gate.screened.deferred,
        };
      }

      // Step 4 — the transaction. Port throws are deliberately NOT caught inside
      // the driver (a kill has no catch block either); the outer handler below
      // turns one into an explicit halted envelope rather than a thrown MCP error.
      const result = applyTransaction(applyPorts, {
        targets: composed.targets,
        expectation: {
          present,
          absent,
          portableRecorded: composed.portableRecorded,
          bindingRecorded: composed.bindingRecorded,
          answersRecorded: composed.answersRecorded,
          overridesRecorded: composed.overridesRecorded,
          constitutionRecomposed: composed.constitutionRecomposed,
        },
      });

      const applied: ApplyAppliedAction[] =
        result.status === "applied"
          ? gate.screened.supported.map((action) => ({
              kind: action.kind,
              order: action.order,
              pluginId: action.pluginId,
              destination: action.destination,
              summary: action.summary,
              persisted: true as const,
            }))
          : [];

      return {
        applyVersion: APPLY_ENVELOPE_VERSION,
        workspaceRoot: admission.root,
        admission,
        status: result.status,
        reason: result.reason,
        transactionId: result.transactionId,
        plan: {
          planId: plan.identity.planId,
          expectedPlanId,
          matched: plan.identity.planId === expectedPlanId,
          applicability: plan.applicability,
          mode: plan.mode,
        },
        applied,
        deferred: gate.screened.deferred,
        rollback: result.rollback,
        selfCheck: result.selfCheck,
        refreshed: result.refreshed,
        recovery,
        residue: result.residue,
        diagnostics: result.diagnostics,
      };
    } catch (err) {
      // An unexpected throw is reported as a halt, never as a success. A throw can
      // land AFTER the journal exists, so the residue is OBSERVED here rather than
      // assumed clean: claiming "nothing was left behind" over a surviving journal
      // would be exactly the unearned reassurance this operation must never give.
      // The next entry's pre-entry recovery is what resolves whatever state is
      // left, and a retained journal is what makes that entry converge.
      const journalRetained = recoveryPorts.readJournal() !== null;
      return {
        ...halted("halted", "apply/write-failed", recovery, null, [
          {
            code: "apply-threw",
            message: err instanceof Error ? err.message : String(err),
          },
        ]),
        // `backupsRetained` tracks the journal because a backup is only ever
        // NAMED by one: the journal is written before any backup and discarded
        // before them, so a surviving journal is the operative fact and an orphan
        // backup without one is inert and reclaimed by the next prune.
        residue: {
          clean: !journalRetained,
          journalRetained,
          backupsRetained: journalRetained,
          detail: journalRetained
            ? "the transaction was interrupted and its journal is retained, along with the backups that journal names; the next entry's pre-entry recovery restores the prior state."
            : "no journal survives, so nothing is left that a later run must resolve.",
        },
      };
    } finally {
      recoveryPorts.releaseLock();
    }
  }

  /**
   * Compose every target this apply will write, and refuse before the
   * transaction if any precondition the plan depended on has moved (WF-454).
   *
   * ORDERING IS THE POINT. This runs after `decideApplyGate` — so the whole plan
   * has already been screened for unsupported action kinds and unsupported seed
   * kinds — and BEFORE `applyTransaction`, so every refusal below is byte-inert.
   * A precondition that fails here leaves the workspace exactly as the recovered
   * baseline left it: no journal, no backup, no partial subset of a plan applied.
   *
   * WHAT BECOMES A TARGET, AND WHAT DELIBERATELY DOES NOT:
   *
   * - `registry-add` records a NEW registration, so it contributes the pack's
   *   exact observed portable tuple (the ownership evidence) AND its initial
   *   machine binding.
   * - `evidence-seed` is the missing-binding case, so it contributes ONLY the
   *   machine binding. The committed portable half is deliberately not touched,
   *   which is how "committed evidence stays byte-identical" is guaranteed:
   *   on this path the committed ledger never becomes a target at all.
   * - `answer-write` contributes one profile seed per owning capability.
   * - `registry-deregister` contributes NOTHING to the ledger. Evidence removal
   *   is a removal, and removals are out of scope for this item; leaving the
   *   record is also the fail-safe direction, since a stale record re-proposes a
   *   seed while a wrongly-erased one loses the only proof the pack was ever
   *   installed.
   *
   * A rendered target whose bytes would not change is DROPPED, so an apply never
   * rewrites a file it has nothing to say about.
   */
  private composeApplyTargets(input: {
    plan: PlanInstallResponse;
    inspected: Map<string, InspectPackResponse>;
    supported: readonly PlanAction[];
    registryRel: string;
    registryContent: string;
    /** Whether the rendered registry bytes DIFFER from the current ones. A
     *  registry that would not change is not a target — the same rule every
     *  other renderer obeys, and the reason a missing-binding seed leaves
     *  `_local/config.md` untouched down to its inode. */
    registryChanged: boolean;
  }):
    | {
        ok: true;
        targets: ApplyTargetWrite[];
        portableRecorded: string[];
        bindingRecorded: string[];
        answersRecorded: { capability: string; destination: string }[];
        overridesRecorded: { destination: string; sha256: string }[];
        constitutionRecomposed: boolean;
      }
    | { ok: false; reason: ApplyReason; detail: string } {
    const workspaceRoot = this.ports.workspaceRoot;
    const readRel = (relPath: string): string | null =>
      this.ports.readFile(joinSlash(workspaceRoot, relPath));

    // The declared ledger policy. Re-resolved HERE rather than trusted from the
    // plan, because a changed ledger home is exactly the kind of stale
    // precondition this item must reject before mutating.
    const home = resolveLedgerHome();
    if (!home.ok || home.portablePath === null) {
      return {
        ok: false,
        reason: "apply/ledger-unresolvable",
        detail: `the declared ledger home is not a legal policy: ${
          home.diagnostic ?? "unknown"
        }. Nothing was written.`,
      };
    }

    const recordedPortable = parseEvidenceLedger(readRel(home.portablePath)).portable;
    const recordedBinding = parseEvidenceLedger(readRel(home.bindingPath)).binding;

    const portableUpdates: LedgerEvidenceUpdate[] = [];
    const bindingUpdates: LedgerEvidenceUpdate[] = [];
    const portableRecorded: string[] = [];
    const bindingRecorded: string[] = [];

    const seedByPluginId = new Map(input.plan.evidenceSeeds.map((seed) => [seed.pluginId, seed]));

    /** The committed project overrides this run will write, in the plan's own
     *  canonical action order (WF-455). Collected in the loop and rendered below
     *  alongside every other target, so one `addRendered` gate decides
     *  drop-if-unchanged and duplicate-destination for ALL of them. */
    const overrideWrites: { destination: string; content: string; sha256: string }[] = [];
    /** Whether a `constitution-recompose` action reached the compose step. The
     *  record is composed AFTER the loop, because its content is a function of the
     *  FINAL capability set — which every registry action in this same plan
     *  contributes to. */
    let recomposeConstitution = false;

    for (const action of input.supported) {
      const pluginId = action.pluginId;

      if (action.kind === "registry-add") {
        if (pluginId === null) {
          return {
            ok: false,
            reason: "apply/evidence-precondition",
            detail: "a `registry-add` action carries no pack attribution, so its lifecycle evidence cannot be recorded.",
          };
        }
        const pack = input.inspected.get(pluginId);
        const portable = pack?.portableEvidence ?? null;
        const binding = pack?.machineBinding ?? null;
        if (pack === undefined || !pack.valid || portable === null || binding === null) {
          return {
            ok: false,
            reason: "apply/evidence-precondition",
            detail: `pack \`${pluginId}\` is being registered but its exact portable evidence and initial machine binding could not both be observed at apply time; the registration is not recorded without the evidence that owns it.`,
          };
        }
        portableUpdates.push({ pluginId, portable });
        bindingUpdates.push({ pluginId, binding });
        portableRecorded.push(pluginId);
        bindingRecorded.push(pluginId);
        continue;
      }

      if (action.kind === "evidence-seed") {
        if (pluginId === null) {
          return {
            ok: false,
            reason: "apply/evidence-precondition",
            detail: "an `evidence-seed` action carries no pack attribution, so the binding it would seed cannot be resolved.",
          };
        }
        const seed = seedByPluginId.get(pluginId);
        if (seed === undefined || seed.kind !== "binding-seed") {
          return {
            ok: false,
            reason: "apply/evidence-precondition",
            detail: `pack \`${pluginId}\` carries an \`evidence-seed\` action with no matching binding-seed proposal at apply time; nothing was written.`,
          };
        }
        // THE EXACTNESS RULE, restated at apply time rather than inherited. A
        // missing-binding seed is legitimate ONLY when the committed portable
        // tuple and the observed one are exactly equal — not compatible, not a
        // superset. `compareLifecycleEvidence` already decided that when it
        // produced `binding-seed`, and re-deriving it here is what turns "the
        // plan said so" into "the workspace says so, now, under the lock".
        const observedPortable = input.inspected.get(pluginId)?.portableEvidence ?? null;
        const committedPortable = recordedPortable.get(pluginId) ?? null;
        if (
          observedPortable === null ||
          committedPortable === null ||
          JSON.stringify(committedPortable) !== JSON.stringify(observedPortable)
        ) {
          return {
            ok: false,
            reason: "apply/evidence-precondition",
            detail: `pack \`${pluginId}\` no longer presents a portable tuple exactly equal to the committed one, so only-the-missing-binding cannot be seeded; nothing was written.`,
          };
        }
        // An already-recorded binding means this is not a missing-binding case at
        // all. Refusing is what stops an apply from overwriting a binding the
        // plan never proposed to change.
        if (recordedBinding.has(pluginId)) {
          return {
            ok: false,
            reason: "apply/evidence-precondition",
            detail: `pack \`${pluginId}\` already has a recorded machine binding, so there is no missing binding to seed; nothing was written.`,
          };
        }
        bindingUpdates.push({ pluginId, binding: seed.binding });
        bindingRecorded.push(pluginId);
        continue;
      }

      if (action.kind === "override-write") {
        const rendered = this.renderOverrideWrite(input.plan, input.inspected, action);
        if (!rendered.ok) {
          return { ok: false, reason: "apply/override-precondition", detail: rendered.detail };
        }
        overrideWrites.push(rendered);
        continue;
      }

      if (action.kind === "constitution-recompose") {
        recomposeConstitution = true;
        continue;
      }
    }

    // --- project answers -> capability profile seeds --------------------------
    const answersByCapability = new Map<string, ProfileAnswerUpdate[]>();
    const answersRecorded: { capability: string; destination: string }[] = [];

    for (const write of input.plan.answers.writes) {
      // Only answers belonging to an action this run actually applies.
      if (!input.supported.some((a) => a.kind === "answer-write" && a.destination === write.destination && a.pluginId === write.pluginId)) {
        continue;
      }
      // REVALIDATED at apply time through the SAME declared-schema path a
      // persisted value takes. The plan validated it too, but a plan is an
      // approval, not evidence, and this mutator trusts current facts only.
      const question = input.inspected
        .get(write.pluginId)
        ?.capabilities.flatMap((capability) => capability.questions)
        .find((candidate) => candidate.id === write.questionId);
      if (question === undefined) {
        return {
          ok: false,
          reason: "apply/answer-invalid",
          detail: `question \`${write.questionId}\` of capability \`${write.pack}\` is no longer declared at apply time, so its approved answer is not persisted; nothing was written.`,
        };
      }
      const revalidated = validateQuestionValue(question, "proposed", write.value);
      if (!revalidated.valid) {
        return {
          ok: false,
          reason: "apply/answer-invalid",
          detail: `the approved answer for question \`${write.questionId}\` of capability \`${write.pack}\` no longer satisfies its declared schema: ${revalidated.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join(" ")}. Nothing was written.`,
        };
      }
      const bucket = answersByCapability.get(write.pack) ?? [];
      bucket.push({ destination: write.destination, value: revalidated.value });
      answersByCapability.set(write.pack, bucket);
      answersRecorded.push({ capability: write.pack, destination: write.destination });
    }

    // --- render every target --------------------------------------------------
    const targets: ApplyTargetWrite[] = input.registryChanged
      ? [{ destination: input.registryRel, newContent: input.registryContent }]
      : [];

    /** Add one rendered target, dropping it when it would change nothing.
     *
     *  The refusal reason is passed in by the CALLER rather than inferred from
     *  the destination's shape: which artifact class a path belongs to is
     *  already known at the call site, and re-deriving it from a filename suffix
     *  would be a second, silently-divergent answer to a settled question. */
    const addRendered = (
      destination: string,
      render: TargetRender,
      reason: ApplyReason,
    ): { ok: false; reason: ApplyReason; detail: string } | null => {
      if (!render.ok) return { ok: false, reason, detail: render.detail };
      if (!render.changed) return null;
      if (targets.some((target) => target.destination === destination)) {
        return {
          ok: false,
          reason: "apply/ledger-unresolvable",
          detail: `destination \`${destination}\` would be written twice in one transaction; nothing was written.`,
        };
      }
      targets.push({ destination, newContent: render.content });
      return null;
    };

    // The portable half and the binding half may land in the SAME file when the
    // declared home is `local`, so they are grouped by destination first — a
    // single document rendered once, never two writes racing over one path.
    const byDestination = new Map<string, LedgerEvidenceUpdate[]>();
    if (portableUpdates.length > 0) {
      byDestination.set(home.portablePath, [
        ...(byDestination.get(home.portablePath) ?? []),
        ...portableUpdates,
      ]);
    }
    if (bindingUpdates.length > 0) {
      byDestination.set(home.bindingPath, [
        ...(byDestination.get(home.bindingPath) ?? []),
        ...bindingUpdates,
      ]);
    }
    for (const [destination, updates] of byDestination) {
      const failure = addRendered(
        destination,
        renderLedgerMutation(readRel(destination), updates, `the evidence ledger \`${destination}\``),
        "apply/ledger-unresolvable",
      );
      if (failure !== null) return failure;
    }

    for (const [capability, updates] of answersByCapability) {
      const destination = capabilityProfileRelPath(capability);
      const failure = addRendered(
        destination,
        renderProfileMutation(readRel(destination), updates, `the capability profile \`${destination}\``),
        "apply/answer-invalid",
      );
      if (failure !== null) return failure;
    }

    // --- committed project overrides (WF-455) ---------------------------------
    // Rendered through the SAME `addRendered` gate as every other target, so an
    // override whose declared source already equals the committed bytes is
    // dropped and `.wf/slots/<skill>.<point>.md` is not rewritten at all.
    const overridesRecorded: { destination: string; sha256: string }[] = [];
    for (const override of overrideWrites) {
      const failure = addRendered(
        override.destination,
        {
          ok: true,
          content: override.content,
          changed: override.content !== (readRel(override.destination) ?? ""),
        },
        "apply/override-precondition",
      );
      if (failure !== null) return failure;
      // Recorded for the self-check whether or not the bytes changed: the intended
      // END STATE is "this destination holds the approved source", and a target
      // that was dropped because it already held them satisfies that state and
      // must still be asserted to.
      overridesRecorded.push({ destination: override.destination, sha256: override.sha256 });
    }

    // --- the composed constitution (WF-455) -----------------------------------
    let constitutionRecomposed = false;
    if (recomposeConstitution) {
      const composed = this.composeConstitutionTarget(input.plan, input.inspected);
      if (!composed.ok) {
        return { ok: false, reason: "apply/constitution-precondition", detail: composed.detail };
      }
      const failure = addRendered(
        CONSTITUTION_RELPATH,
        composed.render,
        "apply/constitution-precondition",
      );
      if (failure !== null) return failure;
      constitutionRecomposed = true;
    }

    // An `applicable` plan that would change nothing is a contradiction the
    // planner's own invariant forbids, but the mutator states it rather than
    // discovering it: opening a transaction that writes nothing would take a
    // lock, mint a journal, and claim a success over an unchanged workspace.
    if (targets.length === 0) {
      return {
        ok: false,
        reason: "apply/plan-not-applicable",
        detail:
          "every target this plan names already holds exactly the bytes it would be given, so there is nothing to write; no transaction was opened.",
      };
    }

    return {
      ok: true,
      targets,
      portableRecorded,
      bindingRecorded,
      answersRecorded,
      overridesRecorded,
      constitutionRecomposed,
    };
  }

  /**
   * Bind one `override-write` action to the exact bytes the approved plan
   * previewed, and refuse before mutation if anything it depended on has moved
   * (WF-455).
   *
   * THE `.wf/` AUTHORITY TEST IS TWO-PART AND RE-DERIVED HERE (WF-444). Authority
   * to write a committed lifecycle artifact comes from the resolver's lifecycle
   * ownership PLUS a declared artifact class — never from the `.wf/` path prefix.
   * So a destination is admitted only when it lands in the committed
   * project-override tier AND spells a well-formed `<skill>.<point>.md` inside it,
   * with no nested path. `.wf/slots/deep/ship.review.md` and `.wf/anything-else`
   * are both refused, and refused BEFORE the transaction. This widens the admitted
   * artifact set by nothing: it is exactly the class WF-443 established.
   *
   * THE SOURCE IS RE-OBSERVED, NEVER TRUSTED. The plan's payload action carries
   * the `{sha256, bytes}` identity the reviewer approved; this re-fingerprints
   * every owner's declared source through the same contained boundary the planner
   * used and requires exact equality. A source edited between plan and apply is
   * `apply/override-precondition` — the same posture the evidence exactness rule
   * takes, restated at apply time rather than inherited.
   */
  private renderOverrideWrite(
    plan: PlanInstallResponse,
    inspected: Map<string, InspectPackResponse>,
    action: PlanAction,
  ):
    | { ok: true; destination: string; content: string; sha256: string }
    | { ok: false; detail: string } {
    const destination = action.destination;
    if (destination === null) {
      return {
        ok: false,
        detail:
          "an `override-write` action carries no destination, so the committed project override it would write cannot be resolved.",
      };
    }

    // --- the two-part authority test ----------------------------------------
    if (!isDeclaredProjectOverrideArtifact(destination)) {
      return {
        ok: false,
        detail: `\`${destination}\` is not a declared committed project-override artifact (\`${PROJECT_OVERRIDE_DIR}/<skill>.<point>.md\`); the resolver's lifecycle ownership does not widen the admitted artifact set, so nothing was written.`,
      };
    }

    // --- exactly one approved payload action names it -------------------------
    const previewed = plan.payloads.actions.filter((entry) => entry.destination === destination);
    if (previewed.length !== 1) {
      return {
        ok: false,
        detail: `the approved plan carries ${previewed.length} previewed payload action(s) for \`${destination}\`; exactly one is required to bind the bytes this override would receive, so nothing was written.`,
      };
    }
    const approved = previewed[0];

    const fingerprint = this.ports.fingerprintContainedFile;
    const read = this.ports.readContainedFile;
    if (fingerprint === undefined || read === undefined) {
      return {
        ok: false,
        detail: `the contained-source boundary is not configured, so the declared source of \`${destination}\` cannot be re-observed; nothing was written.`,
      };
    }

    // --- every owner's source still reproduces the approved identity ----------
    // Co-ownership is exact-equality-only (WF-448), and that equality is a fact
    // about the world rather than about the plan, so it is re-derived here under
    // the lock instead of inherited from the approval.
    let content: string | null = null;
    for (const owner of approved.owners) {
      const capability = inspected
        .get(owner.pluginId)
        ?.capabilities.find((candidate) => candidate.name === owner.capability);
      if (capability === undefined) {
        return {
          ok: false,
          detail: `capability \`${owner.capability}\` of pack \`${owner.pluginId}\` declares the override \`${destination}\` but was not inspectable at apply time; nothing was written.`,
        };
      }
      const capabilityRoot = dirnameSlash(capability.manifestPath);
      const observed = fingerprint(capabilityRoot, owner.source, MAX_DECLARED_SOURCE_BYTES);
      if (
        observed.status !== "ok" ||
        observed.sha256 !== approved.identity.sha256 ||
        observed.bytes !== approved.identity.bytes
      ) {
        return {
          ok: false,
          detail: `the declared source \`${owner.source}\` of capability \`${owner.capability}\` no longer reproduces the approved bytes for \`${destination}\` (approved sha256 ${approved.identity.sha256}, ${approved.identity.bytes} bytes; observed ${observed.status === "ok" ? `sha256 ${observed.sha256}, ${observed.bytes} bytes` : observed.status}); nothing was written.`,
        };
      }
      if (content !== null) continue;
      const body = read(capabilityRoot, owner.source, MAX_DECLARED_SOURCE_BYTES);
      if (body.status !== "ok") {
        return {
          ok: false,
          detail: `the declared source \`${owner.source}\` of capability \`${owner.capability}\` could not be read (\`${body.status}\`), so the bytes for \`${destination}\` are not available; nothing was written.`,
        };
      }
      content = body.content;
    }

    if (content === null) {
      return {
        ok: false,
        detail: `the approved payload action for \`${destination}\` names no owner, so the bytes it would receive cannot be resolved; nothing was written.`,
      };
    }

    return { ok: true, destination, content, sha256: approved.identity.sha256 };
  }

  /**
   * Compose the constitution record this transaction will write (WF-455).
   *
   * COMPOSED FROM THE FINAL CAPABILITY SET, NOT THE CURRENT ONE. The recomposition
   * exists precisely because this same plan changes the registered set, so
   * composing from the pre-write registry would persist the set the transaction is
   * about to leave behind. The final order is derived the same way the registry
   * write produces it: existing rows keep their positions, deregistered ones are
   * removed, and additions append in the plan's own canonical action order.
   *
   * THE RESOLVER RENDERS ONLY THE DERIVED SECTION. Everything else in the record —
   * the preamble, the core articles, and above all the project's own
   * `## Project clauses (provenance: project)` section — is preserved
   * byte-for-byte by `composeConstitutionRecord`. That section is human-authored
   * content no other copy exists of; a composition that regenerated the document
   * would destroy it.
   */
  private composeConstitutionTarget(
    plan: PlanInstallResponse,
    inspected: Map<string, InspectPackResponse>,
  ): { ok: true; render: TargetRender } | { ok: false; detail: string } {
    const current = this.ports.readFile(
      joinSlash(this.ports.workspaceRoot, CONSTITUTION_RELPATH),
    );
    if (current === null) {
      // Screened out at the gate, which defers rather than applies when the record
      // is absent. Reaching here means it vanished between the screen and the
      // compose, and composing a record that is not there would mean authoring one.
      return {
        ok: false,
        detail: `the composed constitution record \`${CONSTITUTION_RELPATH}\` is no longer present; it is not created here, so nothing was written.`,
      };
    }

    const removed = new Set<string>();
    for (const entry of plan.registryDelta.deregistrations) {
      for (const name of entry.capabilities) removed.add(name);
    }

    const inputs: ConstitutionInput[] = [];
    const seen = new Set<string>();
    for (const capability of this.resolveRegistry().capabilities) {
      if (removed.has(capability.name)) continue;
      seen.add(capability.name);
      for (const article of capability.articles) {
        inputs.push({ capability: capability.name, key: article.key, value: article.value });
      }
    }
    const registryNames = [...seen];

    for (const entry of plan.registryDelta.additions) {
      for (const capability of inspected.get(entry.pluginId)?.capabilities ?? []) {
        if (seen.has(capability.name)) continue;
        seen.add(capability.name);
        registryNames.push(capability.name);
        const raw = this.ports.readFile(capability.manifestPath);
        const parsed = raw === null ? null : parseManifest(raw);
        for (const article of parsed?.articles ?? []) {
          inputs.push({ capability: capability.name, key: article.key, value: article.value });
        }
      }
    }

    const composed = composeConstitutionRecord({
      current,
      capabilities: articlesByCapability(inputs),
      registryNames,
    });
    if (!composed.ok) return { ok: false, detail: composed.detail };
    return { ok: true, render: composed };
  }

  /**
   * The post-write self-check: refresh discovery, then assert the resolved view
   * agrees with what the transaction claims it wrote.
   *
   * A *failed* self-check is a transaction FAILURE, not a warning — the caller
   * rolls back on it. So this must assert every half: every added capability
   * resolves `ok`, every deregistered one is gone, and — since WF-454 — every
   * recorded evidence entry and every seeded answer READS BACK. Asserting only
   * presence would let a deregistration that silently changed nothing report
   * success; asserting only the registry would let a ledger or profile write that
   * landed as unreadable bytes report success just as wrongly.
   */
  private selfCheckRegistry(expectation: SelfCheckExpectation): SelfCheckOutcome {
    this.refresh();
    const view = this.resolveRegistry();
    const missing = expectation.present.filter(
      (name) => !view.capabilities.some((c) => c.name === name && c.validity === "ok"),
    );
    const lingering = expectation.absent.filter((name) =>
      view.capabilities.some((c) => c.name === name),
    );

    // Read the evidence and the profiles back from disk, through the same
    // parsers the ordinary read path uses. Re-reading rather than trusting the
    // in-memory value is the whole point: it catches a write that landed as bytes
    // the resolver cannot understand.
    const workspaceRoot = this.ports.workspaceRoot;
    const readRel = (relPath: string): string | null =>
      this.ports.readFile(joinSlash(workspaceRoot, relPath));
    const home = resolveLedgerHome();
    const portableBack =
      home.portablePath === null
        ? new Map<string, unknown>()
        : parseEvidenceLedger(readRel(home.portablePath)).portable;
    const bindingBack = parseEvidenceLedger(readRel(home.bindingPath)).binding;

    const portableMissing = expectation.portableRecorded.filter((id) => !portableBack.has(id));
    const bindingMissing = expectation.bindingRecorded.filter((id) => !bindingBack.has(id));

    const answerMissing: string[] = [];
    for (const answer of expectation.answersRecorded) {
      const raw = readRel(capabilityProfileRelPath(answer.capability));
      let ok = false;
      if (raw !== null) {
        try {
          const parsed: unknown = JSON.parse(raw);
          ok =
            typeof parsed === "object" &&
            parsed !== null &&
            !Array.isArray(parsed) &&
            Object.prototype.hasOwnProperty.call(parsed, answer.destination);
        } catch {
          ok = false;
        }
      }
      if (!ok) answerMissing.push(`${answer.capability}:${answer.destination}`);
    }

    // --- committed project overrides (WF-455) --------------------------------
    // Hashed back off disk and compared to the APPROVED source digest, so the
    // check confirms the destination holds the bytes the plan bound rather than
    // the bytes this process happened to hold in memory. The two digests are
    // comparable because the declared source round-trips losslessly through the
    // contained boundary's UTF-8 decode; a source that does NOT round-trip fails
    // here and rolls the transaction back, which is the fail-closed direction.
    // The affected slot is
    // then re-resolved: a file that landed but did not become the winning project
    // tier is a write that did not take effect, which is exactly what a self-check
    // is for.
    const overrideMissing: string[] = [];
    const slotProvenance = expectation.overridesRecorded.length === 0 ? [] : this.ensure().slots;
    for (const override of expectation.overridesRecorded) {
      const back = readRel(override.destination);
      if (back === null || sha256Hex(back) !== override.sha256) {
        overrideMissing.push(`${override.destination} (bytes)`);
        continue;
      }
      const filename = override.destination.slice(PROJECT_OVERRIDE_DIR.length + 1);
      const point = slotPointFromOverrideFilename(filename);
      if (point === null) {
        overrideMissing.push(`${override.destination} (slot id)`);
        continue;
      }
      if (
        !slotProvenance.some(
          (slot) => slot.skillPoint === point.skillPoint && slot.projectOverridePresent,
        )
      ) {
        overrideMissing.push(`${override.destination} (not seen as a committed project override)`);
      }
    }

    // --- the composed constitution (WF-455) ----------------------------------
    // The project's own clause section is the one property whose loss is
    // unrecoverable, so it is asserted directly rather than inferred from the
    // record merely being readable.
    const constitutionMissing: string[] = [];
    if (expectation.constitutionRecomposed) {
      const back = readRel(CONSTITUTION_RELPATH);
      if (back === null) {
        constitutionMissing.push(`${CONSTITUTION_RELPATH} did not read back`);
      } else if (!back.split("\n").some((line) => line.trimEnd() === PROJECT_CLAUSES_HEADING)) {
        constitutionMissing.push(
          `${CONSTITUTION_RELPATH} no longer carries its \`${PROJECT_CLAUSES_HEADING}\` section`,
        );
      }
    }

    if (
      missing.length === 0 &&
      lingering.length === 0 &&
      portableMissing.length === 0 &&
      bindingMissing.length === 0 &&
      answerMissing.length === 0 &&
      overrideMissing.length === 0 &&
      constitutionMissing.length === 0
    ) {
      return { ok: true };
    }
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`not resolvable after the write: ${missing.join(", ")}`);
    if (lingering.length > 0) parts.push(`still registered after removal: ${lingering.join(", ")}`);
    if (portableMissing.length > 0) {
      parts.push(`portable evidence did not read back: ${portableMissing.join(", ")}`);
    }
    if (bindingMissing.length > 0) {
      parts.push(`machine binding did not read back: ${bindingMissing.join(", ")}`);
    }
    if (answerMissing.length > 0) {
      parts.push(`profile seed did not read back: ${answerMissing.join(", ")}`);
    }
    if (overrideMissing.length > 0) {
      parts.push(`committed project override did not read back: ${overrideMissing.join(", ")}`);
    }
    if (constitutionMissing.length > 0) {
      parts.push(`composed constitution did not read back: ${constitutionMissing.join(", ")}`);
    }
    return { ok: false, diagnostic: parts.join("; ") };
  }

  /**
   * Answer every filesystem question one managed artifact raises, so the pure
   * removal/upgrade join can decide without any IO of its own (WF-449).
   *
   * The fact set is the UNION of the destinations the ledger already records and
   * the destinations the installed packs currently declare — nothing wider.
   * Pruning unlisted files is explicitly out of scope, so a workspace file that
   * neither names is never classified and never at risk.
   *
   * Nothing here writes or creates. The declared source's bytes are reused from
   * the payload facts already collected (no second read), and the target's
   * CURRENT bytes are read through the same contained raw-byte fingerprint
   * boundary — no body crosses, and a read that fails becomes an explicit
   * `current-bytes-unreadable` retention rather than a fabricated digest.
   */
  private collectArtifactFacts(
    admittedRoot: string,
    payloads: readonly PlanPayloadFact[],
    recordedArtifacts: Map<string, ArtifactEvidence>,
  ): PlanArtifactFactInput[] {
    const fingerprint = this.ports.fingerprintContainedFile;
    const resolveTarget = this.ports.resolvePayloadTarget;
    if (fingerprint === undefined || resolveTarget === undefined) return [];

    // Group the declared payloads by destination so a co-owned target yields ONE
    // artifact fact carrying every owner. Production is `copy`, so the bytes a
    // declaration would produce ARE its source bytes — the same equality WF-448
    // already relies on when it compares co-owners.
    const declaredByDestination = new Map<string, PlanPayloadFact[]>();
    for (const payload of payloads) {
      const rows = declaredByDestination.get(payload.destination);
      if (rows === undefined) declaredByDestination.set(payload.destination, [payload]);
      else rows.push(payload);
    }

    const destinations = [
      ...new Set([...recordedArtifacts.keys(), ...declaredByDestination.keys()]),
    ].sort((left, right) => left.localeCompare(right));

    const facts: PlanArtifactFactInput[] = [];
    for (const destination of destinations) {
      const target = resolveTarget(admittedRoot, destination);
      const observed = fingerprint(admittedRoot, destination, MAX_DECLARED_SOURCE_BYTES);

      // A co-owned destination whose owners disagree on bytes or semantics is
      // NOT a usable declaration: WF-448 already reports that collision as a
      // blocking finding, and inventing one owner's digest here would be exactly
      // the arbitration both slices refuse. It becomes `declared: null`, which
      // the join reads as unreproducible — the fail-safe direction.
      const rows = declaredByDestination.get(destination) ?? [];
      const usable = rows.filter((row) => row.identity.ok);
      const first = usable[0];
      const agreed =
        first !== undefined &&
        usable.length === rows.length &&
        usable.every(
          (row) =>
            row.identity.ok &&
            first.identity.ok &&
            row.identity.sha256 === first.identity.sha256 &&
            row.semantics.production === first.semantics.production &&
            row.semantics.refresh === first.semantics.refresh &&
            row.semantics.removal === first.semantics.removal,
        );

      facts.push({
        destination,
        target,
        recorded: recordedArtifacts.get(destination) ?? null,
        current:
          observed.status === "ok"
            ? { ok: true, sha256: observed.sha256, bytes: observed.bytes }
            : { ok: false, status: observed.status },
        declared:
          agreed && first !== undefined && first.identity.ok
            ? {
                declaredSourceFingerprint: first.identity.sha256,
                producedContentHash: first.identity.sha256,
                owners: usable.map((row) => ({
                  pluginId: row.pluginId,
                  capability: row.capability,
                  source: row.source,
                })),
                production: first.semantics.production,
                refresh: first.semantics.refresh,
                removal: first.semantics.removal,
              }
            : null,
      });
    }
    return facts;
  }

  /**
   * Answer every filesystem question one declared payload row raises, so the
   * pure join can decide without any IO of its own (WF-448).
   *
   * Collected for every INSPECTABLE pack; the join narrows to the acted-on set.
   * Nothing here writes or creates: the source is read through the existing
   * contained raw-byte fingerprint boundary (no body crosses), and the
   * destination is resolved through the no-create containment port bound to the
   * ADMITTED root. When either port is absent the preview yields nothing rather
   * than a fabricated digest or a guessed target.
   */
  private collectPayloadFacts(
    admittedRoot: string,
    inspected: Map<string, InspectPackResponse>,
  ): PlanPayloadFact[] {
    const resolveTarget = this.ports.resolvePayloadTarget;
    const fingerprint = this.ports.fingerprintContainedFile;
    if (resolveTarget === undefined || fingerprint === undefined) return [];

    const facts: PlanPayloadFact[] = [];
    for (const [pluginId, record] of inspected) {
      for (const capability of record.capabilities) {
        // The capability folder is the manifest's own parent — the same anchor
        // inspection fingerprinted the declared sources against.
        const capabilityRoot = dirnameSlash(capability.manifestPath);
        for (const payload of capability.payloads) {
          const observed = fingerprint(
            capabilityRoot,
            payload.source,
            MAX_DECLARED_SOURCE_BYTES,
          );
          facts.push({
            pluginId,
            capability: capability.name,
            source: payload.source,
            destination: payload.destination,
            semantics: {
              production: payload.production,
              refresh: payload.refresh,
              removal: payload.removal,
            },
            target: resolveTarget(admittedRoot, payload.destination),
            identity:
              observed.status === "ok"
                ? { ok: true, sha256: observed.sha256, bytes: observed.bytes }
                : { ok: false, status: observed.status },
          });
        }
      }
    }
    return facts;
  }

  // --- R6: register_pack (mutating write-path) ---------------------------
  registerPack(pluginId: string, expectedFingerprint: string): RegisterPackResponse {
    const inspected = this.inspectPack(pluginId);

    const reject = (reason: string): RegisterPackResponse => ({
      status: "rejected",
      reason,
      capabilities: [],
      root: inspected.installPath,
      selfCheck: "skipped",
      preview: [],
    });

    if (!inspected.installed) return reject(`plugin \`${pluginId}\` is not installed.`);
    if (!inspected.enabled) return reject(`plugin \`${pluginId}\` is disabled.`);
    if (!inspected.installPath || inspected.capabilities.length === 0) {
      return reject(
        `plugin \`${pluginId}\` has no valid pack manifest (path-invalid or manifest-invalid).`,
      );
    }
    if (!inspected.valid) {
      return reject(
        `plugin \`${pluginId}\` has invalid pack metadata: ${inspected.issues.join(" ")}`,
      );
    }
    if (inspected.fingerprint !== expectedFingerprint) {
      return reject(
        `stale fingerprint: expected \`${expectedFingerprint}\`, current \`${inspected.fingerprint}\` — re-inspect before registering.`,
      );
    }

    // Build the preview: one Plugin Roots row + one Capabilities row per cap.
    const preview: RegisterPackResponse["preview"] = [
      { section: "Plugin Roots", key: inspected.pluginName, value: inspected.installPath },
      ...inspected.capabilities.map((c) => ({
        section: "Capabilities",
        key: c.name,
        value: c.path,
      })),
    ];

    // Validate and contain the sole mutation target before reading or writing it.
    const registryRel = this.ports.registryRelPath();
    const shapeError = registryPathShapeError(registryRel);
    if (shapeError) {
      return reject(
        `registryPath \`${registryRel}\` is not a forward-slash repo-relative file path: ${shapeError}.`,
      );
    }

    let registryAbs: string;
    try {
      registryAbs =
        this.ports.resolveRegistryWritePath?.(registryRel) ??
        joinSlash(this.ports.workspaceRoot, registryRel);
    } catch (err) {
      return reject(
        `registryPath \`${registryRel}\` escapes the selected workspace: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Own the registry write (the sole mutation), then refresh the snapshot.
    let content = this.ports.readFile(registryAbs) ?? "";
    for (const row of preview) {
      const columns: [string, string] =
        row.section === "Plugin Roots" ? ["Plugin", "Root"] : ["Capability", "Path"];
      content = upsertSectionRow(content, row.section, columns, row.key, row.value).content;
    }
    this.ports.writeFile(registryAbs, content);

    // Refresh discovery so the new rows take effect immediately.
    this.refresh();

    // Self-check: every registered capability must now resolve to `ok`.
    const view = this.resolveRegistry();
    const registered = inspected.capabilities.map((c) => c.name);
    const allOk = registered.every((name) =>
      view.capabilities.some((c) => c.name === name && c.validity === "ok"),
    );

    return {
      status: "registered",
      reason: null,
      capabilities: registered,
      root: inspected.installPath,
      selfCheck: allOk ? "ok" : "failed",
      preview,
    };
  }

  // --- helpers ------------------------------------------------------------
  private bareName(pluginId: string): string {
    const at = pluginId.indexOf("@");
    return at > 0 ? pluginId.slice(0, at) : pluginId;
  }

  private scanPackCapabilities(
    installPath: string,
    pluginName: string,
    pluginId: string,
  ): {
    capabilities: PackCapabilitySummary[];
    fingerprintInputs: PackFingerprintInput[];
    manifestHashes: PathHashRecord[];
    declaredSourceHashes: PathHashRecord[];
    localFingerprints: PathHashRecord[];
    payloadInvalid: boolean;
    issues: string[];
  } {
    const capabilities: PackCapabilitySummary[] = [];
    const fingerprintByPath = new Map<string, PackFingerprintInput>();
    const manifestHashByPath = new Map<string, PathHashRecord>();
    const declaredSourceHashByPath = new Map<string, PathHashRecord>();
    const localFingerprintByPath = new Map<string, PathHashRecord>();
    const issues: string[] = [];
    let payloadInvalid = false;
    // Discover the pack's capability folders by listing `<installPath>/
    // capabilities/*` and keeping those with a readable `manifest.md`. This
    // folder listing runs ONLY on the register write-path (init), never on a
    // normal resolution query.
    const capsDir = joinSlash(installPath, "capabilities");
    const names = [...this.ports.listDirs(capsDir)].sort();
    for (const name of names) {
      const rel = `capabilities/${name}`;
      const capabilityRoot = joinSlash(installPath, rel);
      const manifestAbs = joinSlash(capabilityRoot, "manifest.md");
      const body = this.ports.readFile(manifestAbs);
      if (body === null) continue;

      const manifestHash = sha256Hex(body);
      const normalizedManifestAbs = normalizeSlashes(manifestAbs);
      fingerprintByPath.set(normalizedManifestAbs, {
        path: normalizedManifestAbs,
        present: true,
        sha256: manifestHash,
      });
      manifestHashByPath.set(`${rel}/manifest.md`, {
        path: `${rel}/manifest.md`,
        sha256: manifestHash,
      });
      localFingerprintByPath.set(normalizedManifestAbs, {
        path: normalizedManifestAbs,
        sha256: manifestHash,
      });

      const manifest = parseManifest(body);
      const payloadResult = validatePayloadDeclarations(pluginId, name, manifest.payloads);
      let payloads: PayloadDeclaration[] = [];
      let payloadDiagnostics: PayloadDiagnostic[] = [];
      if (!payloadResult.ok) {
        payloadInvalid = true;
        payloadDiagnostics = payloadResult.diagnostics;
      } else {
        payloads = payloadResult.payloads;
        for (let rowIndex = 0; rowIndex < payloads.length; rowIndex++) {
          const payload = payloads[rowIndex];
          const sourceRel = `${rel}/${payload.source}`;
          const sourceAbs = joinSlash(capabilityRoot, payload.source);
          const fingerprint = this.ports.fingerprintContainedFile
            ? this.ports.fingerprintContainedFile(
                capabilityRoot,
                payload.source,
                MAX_DECLARED_SOURCE_BYTES,
              )
            : ({
                status: "unsupported",
                path: sourceAbs,
                sha256: null,
                bytes: null,
              } satisfies ContainedFileFingerprintResult);

          if (fingerprint.status === "ok") {
            declaredSourceHashByPath.set(sourceRel, {
              path: sourceRel,
              sha256: fingerprint.sha256,
            });
            localFingerprintByPath.set(fingerprint.path, {
              path: fingerprint.path,
              sha256: fingerprint.sha256,
            });
            fingerprintByPath.set(fingerprint.path, {
              path: fingerprint.path,
              present: true,
              sha256: fingerprint.sha256,
            });
          } else {
            payloadInvalid = true;
            fingerprintByPath.set(normalizeSlashes(sourceAbs), {
              path: normalizeSlashes(sourceAbs),
              present: false,
              sha256: null,
            });
            const details: Record<Exclude<typeof fingerprint.status, "ok">, string> = {
              missing: "declared source is missing.",
              "too-large": `declared source exceeds ${MAX_DECLARED_SOURCE_BYTES} bytes.`,
              unsafe:
                "declared source must be one regular, non-symlink file contained beneath its canonical capability root.",
              unsupported: "contained raw-byte source fingerprinting is unavailable.",
              unreadable: "declared source could not be fingerprinted safely.",
            };
            payloadDiagnostics.push(
              makePayloadDiagnostic(
                pluginId,
                name,
                rowIndex + 1,
                "source",
                `payload/source-${fingerprint.status}`,
                details[fingerprint.status],
              ),
            );
          }
        }
      }

      let questions: CapabilityRecord["questions"] = [];
      let questionDiagnostics: QuestionDiagnostic[] = [];
      if (manifest.profileTemplate) {
        const templateAbs = resolveContainedCapabilityPath(
          capabilityRoot,
          manifest.profileTemplate,
        );
        if (templateAbs === null) {
          questionDiagnostics = [
            makeQuestionDiagnostic(
              name,
              null,
              "profile-template",
              "question/template-path-invalid",
              "declared template path must be a forward-slash relative path contained beneath its capability folder.",
            ),
          ];
        } else {
          const templateRead = this.ports.readContainedFile
            ? this.ports.readContainedFile(
                capabilityRoot,
                manifest.profileTemplate,
                MAX_PROFILE_TEMPLATE_BYTES,
              )
            : ({
                status: "unsupported",
                path: templateAbs,
                content: null,
              } satisfies ContainedFileReadResult);
          const templateRaw = templateRead.status === "ok" ? templateRead.content : null;
          const normalizedTemplateAbs = normalizeSlashes(templateAbs);
          fingerprintByPath.set(normalizedTemplateAbs, {
            path: normalizedTemplateAbs,
            present: templateRaw !== null,
            sha256: templateRaw === null ? null : sha256Hex(templateRaw),
          });
          if (templateRead.status === "missing") {
            questionDiagnostics = [
              makeQuestionDiagnostic(
                name,
                null,
                "profile-template",
                "question/template-missing",
                "declared template is not readable.",
              ),
            ];
          } else if (templateRead.status === "too-large") {
            questionDiagnostics = [
              makeQuestionDiagnostic(
                name,
                null,
                "profile-template",
                "question/template-too-large",
                `declared template must be at most ${MAX_PROFILE_TEMPLATE_BYTES} UTF-8 bytes.`,
              ),
            ];
          } else if (templateRead.status !== "ok") {
            questionDiagnostics = [
              makeQuestionDiagnostic(
                name,
                null,
                "profile-template",
                "question/template-path-invalid",
                "declared template must resolve to one regular, non-symlink file contained beneath its canonical capability folder.",
              ),
            ];
          } else {
            localFingerprintByPath.set(normalizedTemplateAbs, {
              path: normalizedTemplateAbs,
              sha256: sha256Hex(templateRead.content),
            });
            const parsed = parseQuestionDeclarations(name, templateRead.content);
            if (parsed.ok) questions = parsed.questions;
            else questionDiagnostics = parsed.diagnostics;
          }
        }
      }

      if (questionDiagnostics.length > 0) {
        issues.push(...questionDiagnostics.map((issue) => issue.message));
      }
      if (payloadDiagnostics.length > 0) {
        issues.push(...payloadDiagnostics.map((issue) => issue.message));
      }
      capabilities.push({
        name,
        path: `plugin:${pluginName}/${rel}`,
        manifestPath: normalizedManifestAbs,
        kind: manifest.kind,
        questions,
        payloads,
        payloadDiagnostics,
        questionDiagnostics,
      });
    }

    if (payloadInvalid) {
      for (const capability of capabilities) capability.payloads = [];
      declaredSourceHashByPath.clear();
    }

    const ordered = <T extends { path: string }>(values: Iterable<T>): T[] =>
      [...values].sort((left, right) => left.path.localeCompare(right.path));
    return {
      capabilities,
      fingerprintInputs: ordered(fingerprintByPath.values()),
      manifestHashes: ordered(manifestHashByPath.values()),
      declaredSourceHashes: ordered(declaredSourceHashByPath.values()),
      localFingerprints: ordered(localFingerprintByPath.values()),
      payloadInvalid,
      issues,
    };
  }

  private packFingerprint(
    pack: InstalledPlugin,
    inputs: PackFingerprintInput[],
  ): string {
    return sha256Hex(
      JSON.stringify({
        installPath: pack.installPath,
        version: pack.version,
        sources: inputs.map((input) => ({
          path: input.path,
          present: input.present,
          sha256: input.sha256,
        })),
      }),
    );
  }

  // --- authoring validators (WF-352) ---------------------------------------
  //
  // Read-only rule evaluation over authored artifacts, returning the frozen
  // `ValidationVerdict`. They mutate no snapshot and never invalidate or
  // refresh. Every vocabulary is derived live from the ops doc at call time
  // (validate-rules.ts), so no rule is transcribed where it could fork from the
  // contract. The CI shell guards stay authoritative; these agree with them.

  /** A `ValidatorFs` over the injected ports — no new port members needed:
   *  file-ness is "readFile returned content", directory-ness is "the parent
   *  lists it as a subdirectory". `isFile` screens directories out first,
   *  because `readFile` swallows only ENOENT and rethrows EISDIR — probing a
   *  directory by reading it would throw instead of answering `false`. */
  private validatorFs(): ValidatorFs {
    const ports = this.ports;
    const isDir = (p: string): boolean => {
      const norm = p.replace(/\\/g, "/").replace(/\/$/, "");
      const idx = norm.lastIndexOf("/");
      if (idx <= 0) return false;
      return ports.listDirs(norm.slice(0, idx)).includes(norm.slice(idx + 1));
    };
    return {
      readFile: (p) => ports.readFile(p),
      isFile: (p) => !isDir(p) && ports.readFile(p) !== null,
      isDirectory: isDir,
    };
  }

  /** Absolute path of the live rule source, anchored at the core plugin root. */
  private opsDocPath(): string {
    return `${this.ports.corePluginRoot.replace(/\\/g, "/").replace(/\/$/, "")}/skills/_contracts/capability-registry.ops.md`;
  }

  /** Validate one capability manifest (or, with no argument, every active
   *  registry capability's manifest) against manifest schema v2. */
  validateManifest(path?: string | null): ValidationVerdict {
    const fs = this.validatorFs();
    const ops = this.opsDocPath();
    if (path && path.trim()) {
      const pluginRoots: Record<string, string> = {};
      for (const root of this.safeEnsure().snapshot?.pluginRoots ?? []) {
        if (root.resolvedRoot !== null) pluginRoots[root.plugin] = root.resolvedRoot;
      }
      return validateManifest(fs, this.absolutize(path.trim()), ops, {
        pluginRoots,
      });
    }
    // Default scope: every active capability's manifest. The registry validator
    // already visits exactly that set, so reuse its pass and re-scope the
    // verdict — keeping only the manifest-level findings, and describing the
    // target as the scope walked rather than the registry file it was read
    // from (which is `validate_registry`'s target, not this tool's).
    const full = this.validateRegistry();
    const manifestFindings = full.findings.filter((f) => /manifest\.md$/.test(f.file));
    return {
      ...full,
      tool: "validate_manifest",
      target: "every active capability manifest in the registry",
      findings: full.status === "error" ? full.findings : manifestFindings,
      status: full.status === "error" ? "error" : manifestFindings.length === 0 ? "pass" : "fail",
      summary:
        full.status === "error"
          ? full.summary
          : `${full.ruleSources.filter((s) => s.endsWith("manifest.md")).length} manifest(s) checked, ${manifestFindings.length} finding(s); pass a \`path\` to check one.`,
    };
  }

  /** Validate the resolved registry: its two tables, every declared
   *  capability's resolvability, and every resolvable manifest's own rules. */
  validateRegistry(): ValidationVerdict {
    const workspaceRoot = this.ports.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
    const registryRel = this.ports.registryRelPath();
    return validateRegistry(this.validatorFs(), {
      registryFile: `${workspaceRoot}/${registryRel}`,
      repoRoot: workspaceRoot,
      opsDocPath: this.opsDocPath(),
      registryPathValue: registryRel,
      installManifest: null,
    });
  }

  /** Validate skill slot markers against their interface declarations — one
   *  skill, one plugin's skills, or (by default) every skill in the tree. */
  validateSkillInterface(plugin?: string | null, skill?: string | null): ValidationVerdict {
    const workspaceRoot = this.ports.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
    const pluginsRoot = `${workspaceRoot}/plugins`;
    const wantPlugin = plugin?.trim() || null;
    const wantSkill = skill?.trim() || null;

    const skillDirs: string[] = [];
    const pluginNames = wantPlugin ? [wantPlugin] : this.ports.listDirs(pluginsRoot);
    for (const p of pluginNames) {
      const skillsRoot = `${pluginsRoot}/${p}/skills`;
      for (const s of this.ports.listDirs(skillsRoot)) {
        if (wantSkill && s !== wantSkill) continue;
        skillDirs.push(`${skillsRoot}/${s}`);
      }
    }

    const target = wantSkill
      ? `${pluginsRoot}/${wantPlugin ?? "*"}/skills/${wantSkill}`
      : wantPlugin
        ? `${pluginsRoot}/${wantPlugin}/skills/*`
        : `${pluginsRoot}/*/skills/*`;

    return validateSkillInterface(this.validatorFs(), {
      opsDocPath: this.opsDocPath(),
      skillDirs,
      target,
    });
  }

  // --- reference existence + composition preview (WF-354) ------------------

  /** Absolute path of the reference classifier's live rule source, anchored at
   *  the core plugin root exactly as `opsDocPath()` anchors the ops doc. */
  private guardDocPath(): string {
    return `${this.ports.corePluginRoot.replace(/\\/g, "/").replace(/\/$/, "")}/skills/_contracts/out4-skill-read-guard.sh`;
  }

  /** Every markdown file under `dir`, one level of nesting deep enough to cover
   *  a skill's `references/` folder. Degrades to `[]` when the optional
   *  `listFiles` port is absent. */
  private markdownUnder(dir: string, depth = 2): string[] {
    const listFiles = this.ports.listFiles?.bind(this.ports);
    if (!listFiles) return [];
    const out: string[] = [];
    for (const f of listFiles(dir)) if (f.endsWith(".md")) out.push(`${dir}/${f}`);
    if (depth > 1) {
      for (const sub of this.ports.listDirs(dir)) {
        out.push(...this.markdownUnder(`${dir}/${sub}`, depth - 1));
      }
    }
    return out;
  }

  /** Resolve every invocation reference in skill bodies and agent files against
   *  the real tree. With no argument the scan covers every plugin's `skills/`
   *  and `agents/`, mirroring `validateSkillInterface`'s zero-argument default. */
  validateReferences(path?: string | null): ValidationVerdict {
    const workspaceRoot = this.ports.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "");
    const pluginsRoot = `${workspaceRoot}/plugins`;
    const guardPath = this.guardDocPath();

    let files: string[];
    let target: string;

    if (path && path.trim()) {
      const abs = this.absolutize(path.trim());
      target = abs;
      // Directory-ness is settled BEFORE any read: `readFile` only swallows
      // ENOENT and rethrows EISDIR, so probing file-ness by reading would crash
      // on the folder form the argument explicitly accepts. A target that is
      // neither file nor folder yields no files, which the validator reports as
      // an `input-unparseable` verdict rather than a vacuous pass.
      const vfs = this.validatorFs();
      files = vfs.isDirectory(abs) ? this.markdownUnder(abs, 3) : vfs.isFile(abs) ? [abs] : [];
    } else {
      target = `${pluginsRoot}/*/{skills,agents}`;
      files = [];
      for (const plugin of this.ports.listDirs(pluginsRoot)) {
        const skillsRoot = `${pluginsRoot}/${plugin}/skills`;
        for (const s of this.ports.listDirs(skillsRoot)) {
          // The frozen contract layer is off the surface, exactly as the shell
          // guard excludes it: it holds the deliberate violation fixtures.
          if (s.startsWith("_")) continue;
          const body = `${skillsRoot}/${s}/SKILL.md`;
          if (this.ports.readFile(body) !== null) files.push(body);
          files.push(...this.markdownUnder(`${skillsRoot}/${s}/references`, 1));
        }
        files.push(...this.markdownUnder(`${pluginsRoot}/${plugin}/agents`, 1));
      }
    }

    return validateReferences(this.validatorFs(), {
      repoRoot: workspaceRoot,
      files,
      target,
      guardPath,
    });
  }

  /** Render which fragments would compose at a phase, in registry order, with
   *  provenance. Reads through `ensure()` only — it never refreshes and never
   *  invalidates, and the renderer itself performs no I/O at all. */
  previewComposition(phase?: string | null): CompositionPreview {
    return previewComposition(this.ensure(), phase ?? null);
  }

  /** Resolve a caller-supplied path against the workspace root when relative. */
  private absolutize(p: string): string {
    const norm = p.replace(/\\/g, "/");
    if (/^(\/|[A-Za-z]:)/.test(norm)) return norm;
    return `${this.ports.workspaceRoot.replace(/\\/g, "/").replace(/\/$/, "")}/${norm}`;
  }
}
