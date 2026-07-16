// wf resolver — the deterministic snapshot builder.
//
// `buildSnapshot` is a PURE function of its declared inputs plus an injected
// read-only IO port (a single `readFile` probe). Given identical inputs it
// produces an identical snapshot (the persist-time `generatedAt` stamp is the
// only non-deterministic field, and it is supplied by the caller). This is what
// makes the engine testable without a real filesystem or the `claude` CLI: a
// test drives it with synthetic file contents and a fixture plugin-list.
//
// It records ONLY paths, normalized metadata, source fingerprints, resolution
// diagnostics, and provenance. It never reads or stores a fragment/skill/prompt
// body — it resolves a fragment's DISPATCH path and stops there.

import {
  joinSlash,
  normalizeSlashes,
  resolveCapabilityPath,
  type InstalledRoot,
  type RecordedRoot,
} from "./paths.js";
import { parseRegistry } from "./registry.js";
import { parseManifest } from "./manifest.js";
import { parsePluginList, type ParsedPluginList } from "./plugin-list.js";
import { parseCoreConfig } from "./config.js";
import { fingerprint } from "./fingerprint.js";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type CapabilityRecord,
  type ConstitutionInput,
  type Diagnostic,
  type PackRecord,
  type PluginRootRecord,
  type ProviderOwnershipRecord,
  type ResolverSnapshot,
  type SourceFingerprint,
} from "./types.js";

/** Read-only IO port: returns UTF-8 content, or `null` when the path is absent. */
export interface ResolverIO {
  readFile(absPath: string): string | null;
}

export interface BuildSnapshotInputs {
  /** Normalized absolute workspace root. */
  workspaceRoot: string;
  /** Resolved registry location, workspace-relative (default `_local/config.md`). */
  registryPathValue: string;
  /** Registry markdown (holds `## Capabilities` + `## Plugin Roots`). */
  registryContent: string | null;
  /** `wf.config.js` content (fingerprint only), or null when absent (default). */
  wfConfigContent: string | null;
  /** `_local/config.md` content for core config VALUES. In the default setup
   *  this is the same file as the registry. */
  coreConfigContent: string | null;
  /** Raw stdout of `claude plugin list --json`, or `null` when the CLI was
   *  unavailable/errored. A real success (including an empty `"[]"`) is a string;
   *  `null` is a genuine failure recorded as an ABSENT plugin-list source. */
  pluginListRaw: string | null;
  /** ISO-8601 stamp applied at persist time. */
  generatedAt: string;
  generator: { name: string; version: string };
}

/** Make a path stable + normalized: workspace-relative when under the workspace
 *  root, else normalized absolute (a plugin-cache path is inherently absolute). */
function relativize(workspaceRoot: string, absPath: string): string {
  const abs = normalizeSlashes(absPath);
  const root = normalizeSlashes(workspaceRoot).replace(/\/+$/, "");
  if (abs === root) return ".";
  if (abs.startsWith(root + "/")) return abs.slice(root.length + 1);
  return abs;
}

/** Parse an `inline: <rel>` dispatch to its rel path; `null` for subagent/other. */
function inlineDispatchRel(dispatch: string): string | null {
  const m = /^inline:\s*(.+)$/.exec(dispatch.trim());
  return m ? m[1].trim() : null;
}

export function buildSnapshot(
  inputs: BuildSnapshotInputs,
  io: ResolverIO,
): ResolverSnapshot {
  const { workspaceRoot } = inputs;
  const diagnostics: Diagnostic[] = [];
  const sources: SourceFingerprint[] = [];

  const registryPath = normalizeSlashes(inputs.registryPathValue);

  // --- source fingerprints for the top-level inputs ------------------------
  sources.push(fingerprint("wf-config", "wf.config.js", inputs.wfConfigContent));
  sources.push(fingerprint("registry", registryPath, inputs.registryContent));
  // Only record a distinct core-config source when it differs from the registry
  // file (relocated registryPath); otherwise the registry fingerprint covers it.
  if (registryPath !== "_local/config.md") {
    sources.push(fingerprint("core-config", "_local/config.md", inputs.coreConfigContent));
  }
  // A `null` plugin-list is a genuine CLI failure/unavailability: record the
  // source as ABSENT (present:false, sha256:null, bytes:null) — never a fake
  // present `"[]"`. `fingerprint` maps null content to an absent record.
  sources.push(fingerprint("plugin-list", "claude plugin list --json", inputs.pluginListRaw));

  // --- parse inputs --------------------------------------------------------
  const registry = parseRegistry(inputs.registryContent ?? "");
  const coreConfig = parseCoreConfig(inputs.coreConfigContent ?? inputs.registryContent ?? "");

  // A real CLI success (including an empty `"[]"`) parses normally: zero packs,
  // contractOk, no diagnostic. A `null` (CLI unavailable/errored) is NOT parsed
  // as `"[]"` — that would be a false "no plugins installed" fact. Instead it
  // yields an empty installed set plus a warning diagnostic, so a failed CLI is
  // distinguishable from a genuinely empty one.
  let pluginList: ParsedPluginList;
  if (inputs.pluginListRaw === null) {
    pluginList = { plugins: [], contractOk: true, issues: [] };
    diagnostics.push({
      severity: "warning",
      code: "plugin-list/cli-unavailable",
      message:
        "`claude plugin list --json` could not be run (CLI unavailable or errored); installed-pack facts are unknown for this snapshot. The plugin-list source is recorded as absent rather than an empty result — re-run once the `claude` CLI is available on PATH.",
    });
  } else {
    pluginList = parsePluginList(inputs.pluginListRaw);
    for (const issue of pluginList.issues) {
      diagnostics.push({ severity: "error", code: issue.code, message: issue.message });
    }
  }

  const recordedRoots: RecordedRoot[] = registry.pluginRoots.map((r) => ({
    plugin: r.plugin,
    root: r.root,
  }));
  const installedRoots: InstalledRoot[] = pluginList.plugins.map((p) => ({
    pluginName: p.name,
    installPath: p.installPath,
  }));

  const manifestExists = (p: string): boolean => io.readFile(p) !== null;

  // --- resolve capabilities ------------------------------------------------
  // Track which plugin provides each plugin-anchored capability, and whether the
  // capability resolved — for pack-state derivation.
  interface RegEntry {
    capabilities: string[];
    anyUnrecoverable: boolean;
  }
  const registeredByPlugin = new Map<string, RegEntry>();
  const pluginRootProvenance = new Map<string, PluginRootRecord["provenance"]>();

  const capabilities: CapabilityRecord[] = registry.capabilities.map((row) => {
    const anchor = /^plugin:([^/]+)\//.exec(row.path);
    const pluginName = anchor ? anchor[1] : null;

    const resolved = resolveCapabilityPath(row.path, {
      workspaceRoot,
      recordedRoots,
      installedRoots,
      manifestExists,
    });

    let kind: string | null = null;
    let fragments: CapabilityRecord["fragments"] = [];
    let articles: CapabilityRecord["articles"] = [];
    let requires: string[] = [];
    let conflicts: string[] = [];
    let profileTemplatePath: string | null = null;

    if (resolved.manifestPath) {
      const content = io.readFile(resolved.manifestPath);
      if (content !== null) {
        sources.push(
          fingerprint("manifest", relativize(workspaceRoot, resolved.manifestPath), content),
        );
        const m = parseManifest(content);
        kind = m.kind;
        fragments = m.fragments;
        articles = m.articles;
        requires = m.requires;
        conflicts = m.conflicts;
        if (m.profileTemplate && resolved.resolvedPath) {
          profileTemplatePath = relativize(
            workspaceRoot,
            joinSlash(resolved.resolvedPath, m.profileTemplate),
          );
        }
      }
    }

    const validity: CapabilityRecord["validity"] =
      resolved.manifestPath !== null ? "ok" : "unrecoverable";

    if (validity === "unrecoverable") {
      diagnostics.push({
        severity: "error",
        code: "capability/unrecoverable",
        message: `capability \`${row.name}\` (path \`${row.path}\`) has no readable manifest — unrecoverable; re-run the owning pack's init to refresh its plugin root.`,
      });
    }

    if (pluginName) {
      const entry = registeredByPlugin.get(pluginName) ?? {
        capabilities: [],
        anyUnrecoverable: false,
      };
      entry.capabilities.push(row.name);
      if (validity === "unrecoverable") entry.anyUnrecoverable = true;
      registeredByPlugin.set(pluginName, entry);

      // Record the strongest provenance seen for this plugin's root.
      const prev = pluginRootProvenance.get(pluginName);
      if (resolved.provenance !== "unrecoverable" && prev !== "self-healed") {
        pluginRootProvenance.set(pluginName, resolved.provenance);
      } else if (!prev) {
        pluginRootProvenance.set(pluginName, resolved.provenance);
      }
    }

    return {
      name: row.name,
      registryPath: row.path,
      resolvedPath: resolved.resolvedPath
        ? relativize(workspaceRoot, resolved.resolvedPath)
        : null,
      manifestPath: resolved.manifestPath
        ? relativize(workspaceRoot, resolved.manifestPath)
        : null,
      provenance: resolved.provenance,
      kind,
      fragments,
      articles,
      requires,
      conflicts,
      profileTemplatePath,
      validity,
    };
  });

  // --- plugin roots --------------------------------------------------------
  const pluginRoots: PluginRootRecord[] = registry.pluginRoots.map((r) => {
    const provenance = pluginRootProvenance.get(r.plugin) ?? "recorded";
    const recordedRoot = normalizeSlashes(r.root);
    let resolvedRoot: string | null = recordedRoot;
    if (provenance === "self-healed") {
      const installed = installedRoots.find((ir) => ir.pluginName === r.plugin);
      resolvedRoot = installed ? relativize(workspaceRoot, installed.installPath) : null;
    } else if (provenance === "unrecoverable") {
      resolvedRoot = null;
    } else {
      resolvedRoot = relativize(workspaceRoot, recordedRoot);
    }
    return {
      plugin: r.plugin,
      recordedRoot: relativize(workspaceRoot, recordedRoot),
      resolvedRoot,
      provenance,
    };
  });

  // --- packs (the four states) --------------------------------------------
  const packs: PackRecord[] = [];
  const seenPlugins = new Set<string>();

  for (const p of pluginList.plugins) {
    seenPlugins.add(p.name);
    const reg = registeredByPlugin.get(p.name);
    let state: PackRecord["state"];
    if (!p.enabled) {
      state = "installed/disabled";
    } else if (reg && reg.capabilities.length > 0) {
      state = reg.anyUnrecoverable ? "registered/unrecoverable" : "active";
    } else {
      state = "installed/inactive";
    }
    packs.push({
      pluginId: p.id,
      pluginName: p.name,
      version: p.version,
      scope: p.scope,
      enablement: p.enabled ? "enabled" : "disabled",
      installPath: relativize(workspaceRoot, p.installPath),
      state,
      registeredCapabilities: reg?.capabilities ?? [],
      diagnostics:
        state === "registered/unrecoverable"
          ? "registered capability manifest is unreadable under this installed pack — refresh its plugin root (re-run the pack init)."
          : null,
    });
  }

  // Registered plugin-anchored packs that are NOT installed at all.
  for (const [pluginName, reg] of registeredByPlugin) {
    if (seenPlugins.has(pluginName)) continue;
    packs.push({
      pluginId: pluginName,
      pluginName,
      version: null,
      scope: null,
      enablement: "unknown",
      installPath: null,
      state: "registered/unrecoverable",
      registeredCapabilities: reg.capabilities,
      diagnostics: `registered pack \`${pluginName}\` is not installed (absent from \`claude plugin list --json\`) — install it or remove its registry rows.`,
    });
  }

  // --- provider ownership --------------------------------------------------
  const providerOwnership: ProviderOwnershipRecord[] = [];
  for (const cap of capabilities) {
    for (const frag of cap.fragments) {
      if (frag.contributionKind !== "provider" || !frag.scope) continue;
      let fragmentPath: string | null = null;
      const rel = inlineDispatchRel(frag.dispatch);
      if (rel && cap.resolvedPath) {
        fragmentPath = joinSlash(cap.resolvedPath, rel);
      }
      providerOwnership.push({
        surface: frag.scope,
        owner: cap.name,
        fragmentPath,
        state: cap.validity === "ok" ? "ok" : "unrecoverable",
      });
    }
  }

  // --- id shape (tracker presence only — never a tracker product) ----------
  const trackerOwner = providerOwnership.find(
    (o) => o.surface === "tracker" && o.state === "ok",
  );
  const idShape = trackerOwner
    ? { source: `tracker:${trackerOwner.owner}`, scheme: null }
    : { source: "bare-core", scheme: "T<NNN>" };

  // --- profiles (override-merged values; never a template) -----------------
  const profiles: Record<string, unknown> = {};
  for (const cap of capabilities) {
    const profilePath = joinSlash(
      workspaceRoot,
      "_local/profiles",
      `${cap.name}.profile.json`,
    );
    const content = io.readFile(profilePath);
    if (content === null) continue;
    sources.push(fingerprint("profile", relativize(workspaceRoot, profilePath), content));
    try {
      profiles[cap.name] = JSON.parse(content);
    } catch (err) {
      diagnostics.push({
        severity: "warning",
        code: "profile/unparseable",
        message: `profile for \`${cap.name}\` is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  // --- provider config (deferred to provider resolution — WF-270) ----------
  const providerConfig: Record<string, Record<string, string>> = {};
  if (providerOwnership.some((o) => o.surface === "tracker")) {
    diagnostics.push({
      severity: "info",
      code: "provider-config/deferred",
      message:
        "tracker provider config values are resolved by the provider surface at query time (WF-270); the snapshot records ownership only, never a tracker product's config section.",
    });
  }

  // --- constitution inputs -------------------------------------------------
  const constitutionInputs: ConstitutionInput[] = [];
  for (const cap of capabilities) {
    for (const a of cap.articles) {
      constitutionInputs.push({ capability: cap.name, key: a.key, value: a.value });
    }
  }

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: inputs.generatedAt,
    generator: inputs.generator,
    workspaceRoot: normalizeSlashes(workspaceRoot),
    registryPath,
    coreConfig,
    capabilities,
    pluginRoots,
    packs,
    providerOwnership,
    idShape,
    profiles,
    providerConfig,
    constitutionInputs,
    sources,
    diagnostics,
  };
}
