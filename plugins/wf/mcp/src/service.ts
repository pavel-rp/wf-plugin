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
  type MergePolicy,
  type PresentPart,
} from "./resolver/slot.js";
import {
  SETTINGS_STORAGE_DIR,
  isSkillSlug,
  locateInterface,
  mergeSettings,
  parseSettingsOverride,
  settingsOverrideRelPath,
} from "./resolver/settings.js";
import {
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
import { upsertSectionRow } from "./resolver/registry-edit.js";
import type {
  InstalledPlugin,
  PluginListContractIssue,
} from "./resolver/plugin-list.js";
import {
  RESOLVER_GENERATOR,
  type CapabilityRecord,
  type ContainedFileFingerprintResult,
  type Diagnostic,
  type DiscoverPacksResponse,
  type MachineBindingEvidence,
  type PathHashRecord,
  type PayloadDeclaration,
  type PayloadDiagnostic,
  type PortablePackEvidence,
  type QuestionDiagnostic,
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

    const packs = snapshot.packs.map((record) => {
      const listed = byId.get(record.pluginId) ?? byName.get(record.pluginName) ?? null;
      // A registered pack the inventory does not list cannot be inspected, so it
      // carries no observed evidence and no questions — which is precisely what
      // makes its comparison `evidence-missing` rather than a false `equal`.
      const inspected = listed === null ? null : this.inspectListedPack(listed);
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

    return joinDiscoveredPacks({
      workspaceRoot,
      inventory: {
        ok: listing.ok,
        contractOk: listing.contractOk,
        issues: listing.issues,
        plugins: listing.plugins,
      },
      packs,
    });
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
