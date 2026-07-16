// wf resolver — the plugin-local typed service adapter (WF-270).
//
// This is the single service every typed MCP query tool and the /wf:resolve
// skill route through. Normal skills and isolated subagents obtain resolved
// facts ONLY by calling the typed queries here — there is no shell/CLI/plugin-
// root probe or installed-folder walk on the consumer side; all discovery
// happens once, inside this service, over the deterministic resolver engine
// (WF-269). Every response is bounded metadata / normalized paths / enums /
// small maps — NEVER a capability fragment body, a skill body, or prompt text
// (the snapshot itself already excludes bodies; these projections only narrow).
//
// The service owns the snapshot lifecycle for a server session: a lazily built,
// in-memory-cached resolved view, an `invalidate` flag that forces the next
// query (or an explicit `refresh`) to rebuild, and the pack register write-path
// that is the sole mutation of the discovery substrate.

import { sha256Hex } from "./resolver/fingerprint.js";
import { evaluateFreshness, type StaleReason } from "./resolver/freshness.js";
import { joinSlash, normalizeSlashes } from "./resolver/paths.js";
import { upsertSectionRow } from "./resolver/registry-edit.js";
import type { InstalledPlugin } from "./resolver/plugin-list.js";
import {
  RESOLVER_GENERATOR,
  type CapabilityRecord,
  type Diagnostic,
  type ResolverSnapshot,
} from "./resolver/types.js";

/** Result of a plugin-list resolution: `ok:false` = the `claude` CLI was
 *  unavailable/errored (distinct from a genuine empty install set). */
export interface PluginListResult {
  plugins: InstalledPlugin[];
  ok: boolean;
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
  /** Build a fresh resolved snapshot (full discovery). */
  resolveFresh(): ResolverSnapshot;
  /** Persist a snapshot to the project-local cache. */
  persist(snapshot: ResolverSnapshot): void;
  /** Read the persisted snapshot, or `null` when none is cached. */
  readCache(): ResolverSnapshot | null;
  /** Read a UTF-8 file (pack manifest reads for inspect/register), or `null`. */
  readFile(absPath: string): string | null;
  /** Write a UTF-8 file (registry edits), creating parent dirs. */
  writeFile(absPath: string, content: string): void;
  /** List immediate subdirectory names of `absDir` (used ONLY on the pack
   *  register write-path to discover `capabilities/*` folders — never on a
   *  read-query path). Returns `[]` when the directory is absent. */
  listDirs(absDir: string): string[];
  /** Installed plugin metadata, exclusively from `claude plugin list --json`. */
  listPlugins(): PluginListResult;
  /** Resolved registry-file location, workspace-relative (default
   *  `_local/config.md`). */
  registryRelPath(): string;
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

export interface PluginRootResponse {
  plugin: string;
  root: string | null;
  provenance: "recorded" | "self-healed" | "unrecoverable";
}

export interface LifecycleResponse {
  valid: boolean;
  cached: boolean;
  generatedAt: string | null;
  schemaVersion: number | null;
  counts: { capabilities: number; packs: number; providers: number };
  diagnostics: Diagnostic[];
}

export interface PackCapabilitySummary {
  name: string;
  /** plugin-anchored registry path token, e.g. `plugin:wf-git/capabilities/git`. */
  path: string;
  manifestPath: string;
  kind: string | null;
}

export interface InspectPackResponse {
  pluginId: string;
  pluginName: string;
  installed: boolean;
  enabled: boolean;
  version: string | null;
  installPath: string | null;
  capabilities: PackCapabilitySummary[];
  /** Stable identity of the pack's registerable surface; register_pack revalidates it. */
  fingerprint: string | null;
  valid: boolean;
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

const KNOWN_SURFACES = new Set([
  "delivery",
  "tracker",
  "qa-execution:engine",
  "qa-execution:host",
]);

/** Degradation class a consumer reproduces when a surface is not `ok`. */
function degradationFor(surface: string, state: ProviderResponse["state"]): string {
  if (state === "ok") return "ok";
  if (surface === "delivery") return "delivery-block";
  if (surface === "tracker") return "tracker-warn";
  if (surface.startsWith("qa-execution")) return "engine-block";
  return "bare-core";
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
   *  ONLY the exact source paths the snapshot recorded (via `ports.readFile`) —
   *  it never lists/walks capability folders, so unchanged inputs are a cheap
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
      })),
    };
  }

  // --- R3 -----------------------------------------------------------------
  resolveProvider(surface: string): ProviderResponse {
    const s = this.ensure();
    const owned = s.providerOwnership.find((o) => o.surface === surface);
    if (!owned) {
      return {
        surface,
        owner: null,
        fragmentPath: null,
        state: "unconfigured",
        degradation: degradationFor(surface, "unconfigured"),
        diagnostics: KNOWN_SURFACES.has(surface)
          ? `no capability owns the \`${surface}\` surface; degrade per its class.`
          : `unknown surface \`${surface}\`.`,
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

  // --- R6: inspect_pack (read-only) --------------------------------------
  inspectPack(pluginId: string): InspectPackResponse {
    const pluginName = this.bareName(pluginId);
    const listing = this.ports.listPlugins();
    const base: InspectPackResponse = {
      pluginId,
      pluginName,
      installed: false,
      enabled: false,
      version: null,
      installPath: null,
      capabilities: [],
      fingerprint: null,
      valid: false,
      issues: [],
    };

    if (!listing.ok) {
      base.issues.push(
        "`claude plugin list --json` is unavailable; pack state cannot be resolved.",
      );
      return base;
    }

    const pack = listing.plugins.find(
      (p) => p.id === pluginId || p.name === pluginName,
    );
    if (!pack) {
      base.issues.push(`plugin \`${pluginId}\` is not installed.`);
      return base;
    }

    base.installed = true;
    base.enabled = pack.enabled;
    base.version = pack.version;
    base.installPath = pack.installPath;

    if (!pack.enabled) base.issues.push(`plugin \`${pluginId}\` is disabled.`);

    const found = this.scanPackCapabilities(pack.installPath, pack.name);
    base.capabilities = found.capabilities;
    if (found.capabilities.length === 0) {
      base.issues.push(
        `no readable \`capabilities/*/manifest.md\` under \`${pack.installPath}\`.`,
      );
    }

    base.fingerprint = this.packFingerprint(pack, found.manifestContents);
    base.valid = base.enabled && base.capabilities.length > 0 && base.issues.length === 0;
    return base;
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

    // Own the registry write (the sole mutation), then refresh the snapshot.
    const registryAbs = joinSlash(this.ports.workspaceRoot, this.ports.registryRelPath());
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
  ): { capabilities: PackCapabilitySummary[]; manifestContents: string[] } {
    const capabilities: PackCapabilitySummary[] = [];
    const manifestContents: string[] = [];
    // Discover the pack's capability folders by listing `<installPath>/
    // capabilities/*` and keeping those with a readable `manifest.md`. This
    // folder listing runs ONLY on the register write-path (init), never on a
    // read-query — normal consumers read the already-resolved snapshot.
    const capsDir = joinSlash(installPath, "capabilities");
    const names = [...this.ports.listDirs(capsDir)].sort();
    for (const name of names) {
      const rel = `capabilities/${name}`;
      const manifestAbs = joinSlash(installPath, rel, "manifest.md");
      const body = this.ports.readFile(manifestAbs);
      if (body === null) continue;
      manifestContents.push(body);
      capabilities.push({
        name,
        path: `plugin:${pluginName}/${rel}`,
        manifestPath: normalizeSlashes(manifestAbs),
        kind: this.manifestKind(body),
      });
    }
    return { capabilities, manifestContents };
  }

  private manifestKind(body: string): string | null {
    const m = /^\*\*Kind:\*\*\s*([A-Za-z-]+)/m.exec(body);
    return m ? m[1] : null;
  }

  private packFingerprint(pack: InstalledPlugin, manifestContents: string[]): string {
    return sha256Hex(
      JSON.stringify({
        installPath: pack.installPath,
        version: pack.version,
        manifests: manifestContents.map((c) => sha256Hex(c)),
      }),
    );
  }
}
