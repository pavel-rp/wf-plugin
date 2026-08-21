// wf resolver — the deterministic snapshot builder.
//
// `buildSnapshot` is a PURE function of its declared inputs plus an injected
// read-only IO port. Given identical inputs it produces an identical snapshot
// (the persist-time `generatedAt` stamp is the only non-deterministic field, and
// it is supplied by the caller). This makes the engine testable without a real
// filesystem or the `claude` CLI: a test drives it with synthetic file contents
// and a fixture plugin-list.
//
// It records ONLY paths, normalized metadata, source fingerprints, resolution
// diagnostics, and provenance. It never reads or stores a fragment/skill body;
// a declared profile template is read through a bounded containment-aware port
// only to normalize its reserved question metadata, and its raw body is discarded.

import {
  isAbsoluteRoot,
  joinSlash,
  normalizeSlashes,
  resolveCapabilityPath,
  resolveContainedCapabilityPath,
  type ContainedFileReadResult,
  type InstalledRoot,
  type RecordedRoot,
} from "./paths.js";
import {
  capabilityProfileRelPath,
  SETTINGS_STORAGE_DIR,
  locateInterface,
  mergeSettings,
  parseSettingsOverride,
  skillFromSettingsFilename,
} from "./settings.js";
import {
  OVERRIDE_DIR,
  PROJECT_OVERRIDE_DIR,
  locateSlotInterface,
  parseSlotScope,
  slotPointFromOverrideFilename,
  type MergePolicy,
} from "./slot.js";
import { parseRegistry } from "./registry.js";
import { parseManifest } from "./manifest.js";
import {
  MAX_PROFILE_TEMPLATE_BYTES,
  applyQuestionValues,
  parseQuestionDeclarations,
} from "./questions.js";
import { parsePluginList, type ParsedPluginList } from "./plugin-list.js";
import { parseCoreConfig, parseRoutingConfig } from "./config.js";
import { fingerprint } from "./fingerprint.js";
import { normalizePluginList } from "./freshness.js";
import {
  SNAPSHOT_SCHEMA_VERSION,
  type CapabilityRecord,
  type ConstitutionInput,
  type Diagnostic,
  type PackRecord,
  type PluginRootRecord,
  type ProviderOwnershipRecord,
  type QuestionDiagnostic,
  type ResolverSnapshot,
  type SlotProvenanceRecord,
  type SourceFingerprint,
} from "./types.js";

/** Read-only IO port: returns UTF-8 content, or `null` when the path is absent.
 *  `listFiles` is OPTIONAL — only the settings-validation pass uses it (to
 *  enumerate `_local/profiles/*.settings.json` overrides); a port that omits it
 *  simply resolves zero settings overrides, so every existing caller is
 *  unaffected. It returns immediate file (non-directory) names, or `[]` when the
 *  directory is absent. */
export interface ResolverIO {
  readFile(absPath: string): string | null;
  /** Security boundary for manifest-selected profile templates. Omission fails
   * closed for question discovery; core never falls back to an unrestricted read. */
  readContainedFile?(
    capabilityRoot: string,
    selectedPath: string,
    maxBytes: number,
  ): ContainedFileReadResult;
  listFiles?(absDir: string): string[];
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
  /** Normalized absolute root of the core `wf` plugin — the anchor for locating a
   *  core skill's `interface.md` in the settings-validation pass. `null`/omitted
   *  when the caller cannot supply it (only pack-skill interfaces are then
   *  probed). */
  corePluginRoot?: string | null;
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

/** Resolve a relativized snapshot path (workspace-relative OR absolute) to an
 *  absolute forward-slash path — the inverse of `relativize`. */
function toAbsolute(workspaceRoot: string, snapshotPath: string): string {
  return isAbsoluteRoot(snapshotPath)
    ? normalizeSlashes(snapshotPath)
    : joinSlash(workspaceRoot, snapshotPath);
}

/** Canonical question provenance is the owning capability folder, which is the
 *  only stable identity shared by installed-pack inspection and aliased registry rows. */
function questionPackName(resolvedPath: string, fallback: string): string {
  const normalized = normalizeSlashes(resolvedPath).replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  const name = separator >= 0 ? normalized.slice(separator + 1) : normalized;
  return name || fallback;
}

/** Parse an `inline: <rel>` dispatch to its rel path; `null` for subagent/other. */
function inlineDispatchRel(dispatch: string): string | null {
  const m = /^inline:\s*(.+)$/.exec(dispatch.trim());
  return m ? m[1].trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendQuestionDiagnostics(
  target: Diagnostic[],
  questionDiagnostics: readonly QuestionDiagnostic[],
): void {
  for (const issue of questionDiagnostics) {
    target.push({
      severity: "error",
      code: issue.code,
      message: issue.message,
      category: "registry-invalid",
      recovery:
        "The capability registry or a manifest/profile is invalid. Fix the registry or re-run the owning pack's init, then run `/wf:resolve refresh`.",
    });
  }
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
  // present `"[]"`. `fingerprint` maps null content to an absent record. The raw
  // output is NORMALIZED first (order-independent projection of the fields the
  // resolver depends on) so the recorded fingerprint matches what freshness
  // recomputes at query time — a cosmetic reorder never churns the snapshot,
  // and add/remove/enable/disable always does (WF-271).
  sources.push(
    fingerprint(
      "plugin-list",
      "claude plugin list --json",
      normalizePluginList(inputs.pluginListRaw),
    ),
  );
  // WF-334: fingerprint the composed constitution record so a project-clause edit
  // (or a re-composed capability-article set) invalidates the snapshot on the next
  // query — the SessionStart hook then serves the constitution through this
  // recorded source, never an un-fingerprinted raw read. An absent record (a
  // non-wf repo, or a wf repo with no `/wf:constitution` run yet) is recorded as
  // an absent source, so it appearing later is itself detected as a change.
  sources.push(
    fingerprint(
      "constitution",
      "_local/constitution.md",
      io.readFile(joinSlash(workspaceRoot, "_local/constitution.md")),
    ),
  );

  // --- parse inputs --------------------------------------------------------
  const registry = parseRegistry(inputs.registryContent ?? "");
  const configMarkdown = inputs.coreConfigContent ?? inputs.registryContent ?? "";
  const coreConfig = parseCoreConfig(configMarkdown);
  const routing = parseRoutingConfig(configMarkdown);

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
    let questions: CapabilityRecord["questions"] = [];

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
          const packName = questionPackName(resolved.resolvedPath, row.name);
          const profileTemplateAbs = resolveContainedCapabilityPath(
            resolved.resolvedPath,
            m.profileTemplate,
          );
          if (profileTemplateAbs === null) {
            appendQuestionDiagnostics(diagnostics, [
              {
                code: "question/template-path-invalid",
                pack: packName,
                question: null,
                field: "profile-template",
                message: `pack \`${packName}\`, field \`profile-template\`: declared template path \`${m.profileTemplate}\` must be a forward-slash relative path contained beneath its capability folder.`,
              },
            ]);
          } else {
            profileTemplatePath = relativize(workspaceRoot, profileTemplateAbs);
            const templateRead = io.readContainedFile
              ? io.readContainedFile(
                  resolved.resolvedPath,
                  m.profileTemplate,
                  MAX_PROFILE_TEMPLATE_BYTES,
                )
              : ({
                  status: "unsupported",
                  path: profileTemplateAbs,
                  content: null,
                } satisfies ContainedFileReadResult);
            const profileTemplateRaw =
              templateRead.status === "ok" ? templateRead.content : null;
            sources.push(
              fingerprint("profile-template", profileTemplatePath, profileTemplateRaw),
            );
            if (templateRead.status === "missing") {
              appendQuestionDiagnostics(diagnostics, [
                {
                  code: "question/template-missing",
                  pack: packName,
                  question: null,
                  field: "profile-template",
                  message: `pack \`${packName}\`, field \`profile-template\`: declared template \`${m.profileTemplate}\` is not readable.`,
                },
              ]);
            } else if (templateRead.status === "too-large") {
              appendQuestionDiagnostics(diagnostics, [
                {
                  code: "question/template-too-large",
                  pack: packName,
                  question: null,
                  field: "profile-template",
                  message: `pack \`${packName}\`, field \`profile-template\`: declared template must be at most ${MAX_PROFILE_TEMPLATE_BYTES} UTF-8 bytes.`,
                },
              ]);
            } else if (templateRead.status !== "ok") {
              appendQuestionDiagnostics(diagnostics, [
                {
                  code: "question/template-path-invalid",
                  pack: packName,
                  question: null,
                  field: "profile-template",
                  message: `pack \`${packName}\`, field \`profile-template\`: declared template must resolve to one regular, non-symlink file contained beneath its canonical capability folder.`,
                },
              ]);
            } else {
              const parsedQuestions = parseQuestionDeclarations(packName, templateRead.content);
              if (parsedQuestions.ok) questions = parsedQuestions.questions;
              else appendQuestionDiagnostics(diagnostics, parsedQuestions.diagnostics);
            }
          }
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
      questions,
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
    const profilePath = joinSlash(workspaceRoot, capabilityProfileRelPath(cap.name));
    const content = io.readFile(profilePath);
    sources.push(fingerprint("profile", relativize(workspaceRoot, profilePath), content));
    if (content === null) continue;
    try {
      const parsedProfile: unknown = JSON.parse(content);
      profiles[cap.name] = parsedProfile;
      if (cap.questions.length > 0) {
        const packName = cap.questions[0]?.pack ?? cap.name;
        if (!isRecord(parsedProfile)) {
          cap.questions = [];
          appendQuestionDiagnostics(diagnostics, [
            {
              code: "question/persisted-container-invalid",
              pack: packName,
              question: null,
              field: "profile",
              message: `pack \`${packName}\`, field \`profile\`: persisted question answers require a JSON object keyed by declared destination.`,
            },
          ]);
        } else {
          const applied = applyQuestionValues(cap.questions, { persisted: parsedProfile });
          if (applied.ok) cap.questions = applied.questions;
          else {
            cap.questions = [];
            appendQuestionDiagnostics(diagnostics, applied.diagnostics);
          }
        }
      }
    } catch {
      if (cap.questions.length > 0) {
        const packName = cap.questions[0]?.pack ?? cap.name;
        cap.questions = [];
        appendQuestionDiagnostics(diagnostics, [
          {
            code: "question/persisted-unparseable",
            pack: packName,
            question: null,
            field: "profile",
            message: `pack \`${packName}\`, field \`profile\`: persisted question answers must be valid JSON.`,
          },
        ]);
      } else {
        diagnostics.push({
          severity: "warning",
          code: "profile/unparseable",
          message: `profile for \`${cap.name}\` is not valid JSON.`,
        });
      }
    }
  }

  // --- per-skill settings overrides (validate at refresh — WF-328) ---------
  // Enumerate every `_local/profiles/<skill>.settings.json` override and validate
  // it against its skill's declared `## Settings` interface. An override carrying
  // a key the interface does not declare is rejected LOUDLY (a `registry-invalid`
  // error diagnostic naming the key AND the skill) — never silently accepted. The
  // check homes HERE (snapshot refresh), not `validate-registry.sh`, because it
  // depends on the WF-326 interface declarations the registry validator runs
  // without. Each override is fingerprinted into `sources` (WF-329) so an edit
  // invalidates the snapshot; the presence set feeds `resolve_inspect`.
  //
  // Interface location reuses the resolved roots already computed above: the core
  // plugin root (for a core skill) first, then every resolved pack root (for a
  // pack skill). The winning interface is the first root that holds a
  // settings-declaring `skills/<skill>/interface.md`.
  const interfaceRoots: string[] = [];
  if (inputs.corePluginRoot) interfaceRoots.push(normalizeSlashes(inputs.corePluginRoot));
  for (const r of pluginRoots) {
    if (r.resolvedRoot) interfaceRoots.push(toAbsolute(workspaceRoot, r.resolvedRoot));
  }
  const settingsDir = joinSlash(workspaceRoot, SETTINGS_STORAGE_DIR);
  const settingsFiles = io.listFiles ? io.listFiles(settingsDir) : [];
  const settingsOverrides: string[] = [];
  for (const filename of [...settingsFiles].sort()) {
    const skill = skillFromSettingsFilename(filename);
    if (!skill) continue; // not a `<skill>.settings.json` (e.g. a capability profile)
    const overridePath = joinSlash(settingsDir, filename);
    const overrideRaw = io.readFile(overridePath);
    if (overrideRaw === null) continue;
    // Fingerprint the settings override into the snapshot's input set (WF-329) so
    // editing it invalidates the snapshot. The JSON is HASHED, not stored.
    sources.push(
      fingerprint("settings-override", `${SETTINGS_STORAGE_DIR}/${filename}`, overrideRaw),
    );
    settingsOverrides.push(skill);
    const parsed = parseSettingsOverride(overrideRaw);
    if (!parsed.ok) {
      diagnostics.push({
        severity: "warning",
        code: "settings/unparseable",
        message: `settings override for skill \`${skill}\` (\`${SETTINGS_STORAGE_DIR}/${filename}\`) is not a valid JSON object: ${parsed.error}`,
      });
      continue;
    }
    const located = locateInterface(skill, interfaceRoots, io.readFile, joinSlash);
    if (!located) {
      // The override targets a skill with no locatable settings-declaring
      // interface (an uninstalled pack, a renamed/removed skill). Warn — the
      // resolver cannot validate it — but do not hard-fail an unrelated override.
      diagnostics.push({
        severity: "warning",
        code: "settings/interface-unresolvable",
        message: `settings override for skill \`${skill}\` (\`${SETTINGS_STORAGE_DIR}/${filename}\`) has no locatable declaring \`interface.md\` — its keys cannot be validated. Install the owning pack or remove the override.`,
      });
      continue;
    }
    const { undeclared } = mergeSettings(located.declared, parsed.value);
    if (undeclared.length > 0) {
      diagnostics.push({
        severity: "error",
        code: "settings/undeclared-key",
        message: `settings override for skill \`${skill}\` (\`${SETTINGS_STORAGE_DIR}/${filename}\`) carries ${
          undeclared.length === 1 ? "a key" : "keys"
        } its \`interface.md\` does not declare: ${undeclared
          .map((k) => `\`${k}\``)
          .join(", ")}. Remove the undeclared ${
          undeclared.length === 1 ? "key" : "keys"
        } or declare ${undeclared.length === 1 ? "it" : "them"} in the skill's \`## Settings\` table.`,
        category: "registry-invalid",
        recovery:
          "The capability registry or a manifest/profile is invalid. Fix the registry or re-run the owning pack's init, then run `/wf:resolve refresh`.",
      });
    }
  }

  // --- per-skill slot contributions + overrides (validate at refresh — WF-329)
  // Fingerprint every pack slot-contribution body and every personal slot
  // override so editing either invalidates the snapshot; compute per-slot
  // provenance for `resolve_inspect`; and fail LOUDLY on either orphan class —
  // an override OR a pack contribution targeting a `skill.point` no active skill
  // interface declares (which would silently lose to the default / never fire).
  // Bodies are HASHED only, never stored (C008 body-free invariant intact). The
  // orphan checks home HERE (refresh), not `validate-registry.sh`, because they
  // depend on the WF-326 interface declarations the registry validator runs
  // without. Interface location reuses `interfaceRoots` computed above.
  const SLOT_RECOVERY =
    "The capability registry or a skill interface is invalid. Declare the missing slot in the skill's `## Slots` interface table, or remove the orphaned contribution/override, then run `/wf:resolve refresh`.";

  // The declared-slot set per skill, memoized (first slot-declaring interface
  // wins, core root first). `null` = no slot-declaring interface located.
  const declaredSlotsCache = new Map<string, Set<string> | null>();
  const declaredSlotsFor = (skill: string): Set<string> | null => {
    if (declaredSlotsCache.has(skill)) return declaredSlotsCache.get(skill) ?? null;
    const located = locateSlotInterface(skill, interfaceRoots, io.readFile, joinSlash);
    const set = located ? located.declared : null;
    declaredSlotsCache.set(skill, set);
    return set;
  };
  const isDeclared = (skillPoint: string, skill: string): boolean =>
    declaredSlotsFor(skill)?.has(skillPoint) ?? false;

  // 1) Active pack slot contributions: every `ok` capability's `slot` fragment
  //    with an inline dispatch, in registry order.
  interface PackSlot {
    capability: string;
    skillPoint: string;
    skill: string;
    policy: MergePolicy;
    bodyPath: string;
    bodyRel: string;
  }
  const packSlots: PackSlot[] = [];
  for (const cap of capabilities) {
    if (cap.validity !== "ok" || !cap.resolvedPath) continue;
    for (const frag of cap.fragments) {
      if (frag.contributionKind !== "slot") continue;
      const parsed = parseSlotScope(frag.scope);
      if (!parsed) continue;
      const rel = inlineDispatchRel(frag.dispatch);
      if (!rel) continue; // non-inline slot dispatch — not a composable body
      const bodyAbs = joinSlash(toAbsolute(workspaceRoot, cap.resolvedPath), rel);
      packSlots.push({
        capability: cap.name,
        skillPoint: parsed.skillPoint,
        skill: parsed.skillPoint.split(".")[0],
        policy: parsed.policy,
        bodyPath: bodyAbs,
        bodyRel: relativize(workspaceRoot, bodyAbs),
      });
    }
  }

  // 2) Fingerprint each contribution body (deduped by path); fail loudly on an
  //    orphaned contribution.
  const fingerprintedBodies = new Set<string>();
  for (const ps of packSlots) {
    if (!fingerprintedBodies.has(ps.bodyPath)) {
      fingerprintedBodies.add(ps.bodyPath);
      sources.push(fingerprint("slot-contribution", ps.bodyRel, io.readFile(ps.bodyPath)));
    }
    if (!isDeclared(ps.skillPoint, ps.skill)) {
      diagnostics.push({
        severity: "error",
        code: "slot/orphaned-contribution",
        message: `capability \`${ps.capability}\` contributes to slot \`${ps.skillPoint}\`, which no active skill interface declares — the contribution would silently never fire. Declare the slot in the skill's \`## Slots\` interface table or remove the capability's \`slot\` fragment row.`,
        category: "registry-invalid",
        recovery: SLOT_RECOVERY,
      });
    }
  }

  // 3) Personal slot overrides (`_local/slots/<skill>.<point>.md`): fingerprint
  //    each, record presence, and fail loudly on an orphaned override.
  const slotOverrideDir = joinSlash(workspaceRoot, OVERRIDE_DIR);
  const slotOverrideFiles = io.listFiles ? io.listFiles(slotOverrideDir) : [];
  const overridePresent = new Set<string>();
  for (const filename of [...slotOverrideFiles].sort()) {
    const parsedName = slotPointFromOverrideFilename(filename);
    if (!parsedName) continue; // not a well-formed `<skill>.<point>.md`
    const overridePath = joinSlash(slotOverrideDir, filename);
    const overrideRaw = io.readFile(overridePath);
    if (overrideRaw === null) continue;
    sources.push(
      fingerprint("slot-override", `${OVERRIDE_DIR}/${filename}`, overrideRaw),
    );
    overridePresent.add(parsedName.skillPoint);
    if (!isDeclared(parsedName.skillPoint, parsedName.skill)) {
      diagnostics.push({
        severity: "error",
        code: "slot/orphaned-override",
        message: `slot override \`${OVERRIDE_DIR}/${filename}\` targets slot \`${parsedName.skillPoint}\`, which no active skill interface declares — the override would silently lose to the default. Remove the override or restore the slot declaration in the skill's \`## Slots\` interface table.`,
        category: "registry-invalid",
        recovery: SLOT_RECOVERY,
      });
    }
  }

  // 3b) Committed project slot overrides (`.wf/slots/<skill>.<point>.md`, WF-443):
  //     the same treatment as the personal override, one tier down. Fingerprinted
  //     so a committed edit invalidates the snapshot, and orphan-validated
  //     symmetrically so a project override targeting an undeclared point fails
  //     loudly instead of silently losing to the inline default.
  const projectOverrideDir = joinSlash(workspaceRoot, PROJECT_OVERRIDE_DIR);
  const projectOverrideFiles = io.listFiles ? io.listFiles(projectOverrideDir) : [];
  const projectOverridePresent = new Set<string>();
  for (const filename of [...projectOverrideFiles].sort()) {
    const parsedName = slotPointFromOverrideFilename(filename);
    if (!parsedName) continue; // not a well-formed `<skill>.<point>.md`
    const overridePath = joinSlash(projectOverrideDir, filename);
    const overrideRaw = io.readFile(overridePath);
    if (overrideRaw === null) continue;
    sources.push(
      fingerprint("slot-project-override", `${PROJECT_OVERRIDE_DIR}/${filename}`, overrideRaw),
    );
    projectOverridePresent.add(parsedName.skillPoint);
    if (!isDeclared(parsedName.skillPoint, parsedName.skill)) {
      diagnostics.push({
        severity: "error",
        code: "slot/orphaned-project-override",
        message: `project slot override \`${PROJECT_OVERRIDE_DIR}/${filename}\` targets slot \`${parsedName.skillPoint}\`, which no active skill interface declares — the override would silently lose to the default. Remove the override or restore the slot declaration in the skill's \`## Slots\` interface table.`,
        category: "registry-invalid",
        recovery: SLOT_RECOVERY,
      });
    }
  }

  // 4) Per-slot provenance: one row per composed `skill.point` (a pack
  //    contribution and/or a present override at either override tier), sorted
  //    for determinism.
  const slotIds = new Set<string>([
    ...packSlots.map((p) => p.skillPoint),
    ...overridePresent,
    ...projectOverridePresent,
  ]);
  const slots: SlotProvenanceRecord[] = [...slotIds]
    .sort()
    .map((skillPoint) => {
      const contributors = packSlots
        .filter((p) => p.skillPoint === skillPoint)
        .map((p) => p.capability);
      const policyOwner = packSlots.find((p) => p.skillPoint === skillPoint);
      const hasOverride = overridePresent.has(skillPoint);
      const hasProjectOverride = projectOverridePresent.has(skillPoint);
      // Descending tier rank — the same ordered chain `planSlot` composes under,
      // read here as "which tier supplies the winning body": personal override
      // (30) > committed project override (20) > pack contribution (10).
      let tier: SlotProvenanceRecord["tier"];
      let winningSource: string | null;
      if (hasOverride) {
        tier = "local-override";
        winningSource = "local-override";
      } else if (hasProjectOverride) {
        tier = "project-override";
        winningSource = "project-override";
      } else if (contributors.length > 0) {
        tier = "pack-contribution";
        // The highest-precedence pack contributor (last in registry order — the
        // one that wins last for `append`, the single owner for `replace`).
        winningSource = contributors[contributors.length - 1];
      } else {
        tier = "unfilled";
        winningSource = null;
      }
      return {
        skillPoint,
        policy: policyOwner ? policyOwner.policy : null,
        overridePresent: hasOverride,
        projectOverridePresent: hasProjectOverride,
        contributors,
        tier,
        winningSource,
      };
    });

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
    routing,
    capabilities,
    pluginRoots,
    packs,
    providerOwnership,
    idShape,
    profiles,
    providerConfig,
    constitutionInputs,
    slots,
    settingsOverrides,
    sources,
    diagnostics,
  };
}
