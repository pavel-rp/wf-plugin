// src/refresh.ts
import { dirname as dirname2, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// src/resolver/types.ts
var SNAPSHOT_SCHEMA_VERSION = 1;
var RESOLVER_GENERATOR = { name: "wf-resolver", version: "0.2.0" };
var SNAPSHOT_CACHE_RELPATH = "_local/resolver/snapshot.json";

// src/resolver/registry.ts
function splitRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  return cells;
}
function isSeparatorRow(cells) {
  return cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "");
}
function tableRowsUnderHeading(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const rows = [];
  let inSection = false;
  let sawHeader = false;
  const headingRe = new RegExp(`^#{1,6}\\s+${escapeRegex(heading)}\\s*$`, "i");
  for (const line of lines) {
    if (/^#{1,6}\s+/.test(line)) {
      if (headingRe.test(line)) {
        inSection = true;
        sawHeader = false;
        continue;
      }
      if (inSection) break;
      continue;
    }
    if (!inSection) continue;
    const cells = splitRow(line);
    if (!cells) {
      if (sawHeader && rows.length > 0 && line.trim() === "") break;
      continue;
    }
    if (!sawHeader) {
      sawHeader = true;
      continue;
    }
    if (isSeparatorRow(cells)) continue;
    rows.push(cells);
  }
  return rows;
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseRegistry(markdown) {
  const capabilities = [];
  for (const cells of tableRowsUnderHeading(markdown, "Capabilities")) {
    const [name, path] = cells;
    if (name && path) capabilities.push({ name, path });
  }
  const pluginRoots = [];
  for (const cells of tableRowsUnderHeading(markdown, "Plugin Roots")) {
    const [plugin, root] = cells;
    if (plugin && root) pluginRoots.push({ plugin, root });
  }
  return { capabilities, pluginRoots };
}

// src/resolver/manifest.ts
function stripCr(line) {
  return line.replace(/\r$/, "");
}
function trimCell(cell) {
  return cell.trim().replace(/^`/, "").replace(/`$/, "").trim();
}
function splitCommaList(rest) {
  return rest.split(",").map((v) => v.trim()).filter((v) => v.length > 0);
}
function parseManifest(markdown) {
  const lines = markdown.split(/\r?\n/).map(stripCr);
  let kind = null;
  const fragments = [];
  const articles = [];
  const requires = [];
  const conflicts = [];
  let profileTemplate = null;
  let inFragments = false;
  let sawFragHeader = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (kind === null) {
      const km = /^\*\*Kind:\*\*\s*([A-Za-z-]+)/.exec(trimmed);
      if (km) kind = km[1];
    }
    if (/^requires:/i.test(trimmed)) {
      requires.push(...splitCommaList(trimmed.replace(/^requires:/i, "")));
    } else if (/^conflicts:/i.test(trimmed)) {
      conflicts.push(...splitCommaList(trimmed.replace(/^conflicts:/i, "")));
    } else if (/^article:/i.test(trimmed)) {
      const decl = trimmed.replace(/^article:/i, "").trim();
      const eq = decl.indexOf("=");
      if (eq > 0) {
        const key = decl.slice(0, eq).trim();
        const value = decl.slice(eq + 1).trim();
        if (key) articles.push({ key, value });
      }
    } else if (/^profile-template:/i.test(trimmed)) {
      const v = trimmed.replace(/^profile-template:/i, "").trim();
      if (v) profileTemplate = v;
    }
    if (/^#{1,6}\s+/.test(line)) {
      if (/^#{1,6}\s+Fragments\s*$/i.test(trimmed)) {
        inFragments = true;
        sawFragHeader = false;
        continue;
      }
      if (inFragments) inFragments = false;
    }
    if (!inFragments) continue;
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-{1,}:?$/.test(c) || c === "")) continue;
    if (!sawFragHeader) {
      sawFragHeader = true;
      continue;
    }
    const [phaseRaw, kindRaw, dispatchRaw, scopeRaw] = cells;
    const phase = trimCell(phaseRaw ?? "");
    const contributionKind = trimCell(kindRaw ?? "");
    if (!phase || phase === "phase") continue;
    let scope = trimCell(scopeRaw ?? "");
    if (scope === "" || scope === "\u2014" || scope === "-") scope = null;
    fragments.push({
      phase,
      contributionKind,
      dispatch: (dispatchRaw ?? "").trim().replace(/^`/, "").replace(/`$/, "").trim(),
      scope
    });
  }
  return { kind, fragments, articles, requires, conflicts, profileTemplate };
}

// src/resolver/paths.ts
function normalizeSlashes(p) {
  return p.replace(/\\/g, "/");
}
function joinSlash(...segments) {
  return segments.map((s, i) => {
    let seg = normalizeSlashes(s);
    if (i > 0) seg = seg.replace(/^\/+/, "");
    if (i < segments.length - 1) seg = seg.replace(/\/+$/, "");
    return seg;
  }).filter((s) => s.length > 0).join("/");
}
var PLUGIN_ANCHOR = /^plugin:([^/]+)\/(.+)$/;
function parsePluginAnchor(registryPath) {
  const m = PLUGIN_ANCHOR.exec(registryPath.trim());
  if (!m) return null;
  return { pluginName: m[1], relPath: m[2] };
}
function resolveCapabilityPath(registryPath, opts) {
  const anchor = parsePluginAnchor(registryPath);
  if (!anchor) {
    const folder = joinSlash(opts.workspaceRoot, registryPath);
    const manifest = joinSlash(folder, "manifest.md");
    if (opts.manifestExists(manifest)) {
      return { resolvedPath: folder, manifestPath: manifest, provenance: "recorded" };
    }
    return { resolvedPath: folder, manifestPath: null, provenance: "unrecoverable" };
  }
  const recorded = opts.recordedRoots.find((r) => r.plugin === anchor.pluginName);
  if (recorded) {
    const root = isAbsoluteRoot(recorded.root) ? normalizeSlashes(recorded.root) : joinSlash(opts.workspaceRoot, recorded.root);
    const folder = joinSlash(root, anchor.relPath);
    const manifest = joinSlash(folder, "manifest.md");
    if (opts.manifestExists(manifest)) {
      return { resolvedPath: folder, manifestPath: manifest, provenance: "recorded" };
    }
  }
  const installed = opts.installedRoots.find((r) => r.pluginName === anchor.pluginName);
  if (installed) {
    const root = normalizeSlashes(installed.installPath);
    const folder = joinSlash(root, anchor.relPath);
    const manifest = joinSlash(folder, "manifest.md");
    if (opts.manifestExists(manifest)) {
      return { resolvedPath: folder, manifestPath: manifest, provenance: "self-healed" };
    }
  }
  return { resolvedPath: null, manifestPath: null, provenance: "unrecoverable" };
}
function isAbsoluteRoot(root) {
  const n = normalizeSlashes(root);
  return n.startsWith("/") || /^[A-Za-z]:/.test(n);
}

// src/resolver/plugin-list.ts
var REQUIRED_FIELDS = [
  { field: "id", type: "string" },
  { field: "version", type: "string" },
  { field: "scope", type: "string" },
  { field: "enabled", type: "boolean" },
  { field: "installPath", type: "string" }
];
function parsePluginList(raw) {
  const issues = [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    return {
      plugins: [],
      contractOk: false,
      issues: [
        {
          code: "plugin-list/unparseable",
          message: `\`claude plugin list --json\` output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
        }
      ]
    };
  }
  if (!Array.isArray(data)) {
    return {
      plugins: [],
      contractOk: false,
      issues: [
        {
          code: "plugin-list/not-an-array",
          message: `\`claude plugin list --json\` must return a JSON array of plugin records; got ${data === null ? "null" : typeof data} \u2014 incompatible CLI output schema.`
        }
      ]
    };
  }
  const plugins = [];
  data.forEach((entry, i) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      issues.push({
        code: "plugin-list/record-not-an-object",
        message: `plugin record ${i} is not an object \u2014 incompatible CLI output schema.`
      });
      return;
    }
    const rec = entry;
    let recOk = true;
    for (const { field, type } of REQUIRED_FIELDS) {
      if (!(field in rec)) {
        issues.push({
          code: "plugin-list/missing-field",
          message: `plugin record ${i} is missing required field \`${field}\` \u2014 incompatible CLI output schema.`
        });
        recOk = false;
      } else if (typeof rec[field] !== type) {
        issues.push({
          code: "plugin-list/wrong-type",
          message: `plugin record ${i} field \`${field}\` should be a ${type}, got ${typeof rec[field]} \u2014 incompatible CLI output schema.`
        });
        recOk = false;
      }
    }
    if (!recOk) return;
    const id = rec.id;
    const atIndex = id.indexOf("@");
    const name = atIndex > 0 ? id.slice(0, atIndex) : id;
    plugins.push({
      id,
      name,
      version: rec.version,
      scope: rec.scope,
      enabled: rec.enabled,
      installPath: normalizeSlashes(rec.installPath)
    });
  });
  return { plugins, contractOk: issues.length === 0, issues };
}

// src/resolver/config.ts
function extractKeyValues(markdown) {
  const map = /* @__PURE__ */ new Map();
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "").trim();
    if (!line.startsWith("|")) continue;
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.length < 2) continue;
    const keyMatch = /^\*\*(.+?)\*\*$/.exec(cells[0]);
    if (!keyMatch) continue;
    const key = keyMatch[1].trim().toLowerCase();
    map.set(key, cells[1]);
  }
  return map;
}
function normalizeValue(raw) {
  if (raw === void 0) return null;
  let v = raw.trim();
  const bt = /^`(.*)`$/.exec(v);
  if (bt) v = bt[1].trim();
  if (v === "" || v === "\u2014") return null;
  if (/^<.*>$/.test(v)) return null;
  return v;
}
function parseCoreConfig(markdown) {
  const kv = extractKeyValues(markdown);
  return {
    taskRoot: normalizeValue(kv.get("task root")),
    verifyCommand: normalizeValue(kv.get("verify command")),
    qaRules: normalizeValue(kv.get("qa rules")),
    qaBaselineIgnore: normalizeValue(kv.get("qa baseline ignore")),
    seedArchitectureDoc: normalizeValue(kv.get("architecture doc")),
    seedBacklogPath: normalizeValue(kv.get("backlog path")),
    standupStatuses: normalizeValue(kv.get("standup statuses"))
  };
}

// src/resolver/fingerprint.ts
import { createHash } from "node:crypto";
function sha256Hex(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}
function fingerprint(kind, path, content) {
  if (content === null) {
    return { kind, path, sha256: null, bytes: null, present: false };
  }
  return {
    kind,
    path,
    sha256: sha256Hex(content),
    bytes: Buffer.byteLength(content, "utf8"),
    present: true
  };
}

// src/resolver/freshness.ts
var FILE_SOURCE_KINDS = /* @__PURE__ */ new Set([
  "wf-config",
  "registry",
  "core-config",
  "manifest",
  "profile"
]);
function isAbsolute(p) {
  return p.startsWith("/") || /^[A-Za-z]:\//.test(p);
}
function absOf(workspaceRoot2, recordedPath) {
  const p = normalizeSlashes(recordedPath);
  return isAbsolute(p) ? p : joinSlash(workspaceRoot2, p);
}
function normalizePluginList(raw) {
  if (raw === null) return null;
  const parsed = parsePluginList(raw);
  if (!parsed.contractOk) {
    return raw;
  }
  const projected = parsed.plugins.map((p) => ({
    id: p.id,
    name: p.name,
    version: p.version,
    scope: p.scope,
    enabled: p.enabled,
    installPath: p.installPath
  })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return JSON.stringify(projected);
}
function evaluateFreshness(snapshot, workspaceRoot2, probe) {
  const reasons = [];
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    reasons.push({
      code: "schema/incompatible",
      message: `snapshot schemaVersion ${String(
        snapshot.schemaVersion
      )} is incompatible with this runtime (expects ${SNAPSHOT_SCHEMA_VERSION}).`
    });
  }
  const currentGenVersion = probe.generatorVersion ?? RESOLVER_GENERATOR.version;
  if (snapshot.generator?.version && snapshot.generator.version !== currentGenVersion) {
    reasons.push({
      code: "resolver/version-changed",
      message: `snapshot built by resolver ${snapshot.generator.version}; runtime is ${currentGenVersion}.`
    });
  }
  for (const src of snapshot.sources) {
    if (!FILE_SOURCE_KINDS.has(src.kind)) continue;
    const content = probe.readFile(absOf(workspaceRoot2, src.path));
    const now = fingerprint(src.kind, src.path, content);
    if (now.present !== src.present || now.sha256 !== src.sha256) {
      const change = !now.present ? "was removed" : !src.present ? "appeared" : "changed";
      reasons.push({
        code: `${src.kind}/changed`,
        message: `${src.kind} source \`${src.path}\` ${change}.`,
        source: src.path
      });
    }
  }
  if (probe.pluginListRaw !== void 0) {
    const recorded = snapshot.sources.find((s) => s.kind === "plugin-list");
    const now = fingerprint(
      "plugin-list",
      "claude plugin list --json",
      normalizePluginList(probe.pluginListRaw)
    );
    if (!recorded || now.present !== recorded.present || now.sha256 !== recorded.sha256) {
      reasons.push({
        code: "plugin-list/changed",
        message: "installed plugin inventory changed (add / remove / enable / disable) since the snapshot.",
        source: "claude plugin list --json"
      });
    }
  }
  return { fresh: reasons.length === 0, reasons };
}

// src/resolver/content.ts
var CONTENT_REF_CLASSES = [
  "fragment",
  "contract",
  "shared",
  "references-template",
  "profile-template"
];
var ALL_CONTENT_CLASSES = [...CONTENT_REF_CLASSES, "slot"];

// src/resolver/settings.ts
var SETTINGS_STORAGE_DIR = "_local/profiles";
var SETTINGS_OVERRIDE_SUFFIX = ".settings.json";
var SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
var SETTINGS_KEY = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
function isSkillSlug(s) {
  return typeof s === "string" && SEGMENT.test(s);
}
function skillFromSettingsFilename(filename) {
  if (!filename.endsWith(SETTINGS_OVERRIDE_SUFFIX)) return null;
  const stem = filename.slice(0, -SETTINGS_OVERRIDE_SUFFIX.length);
  return isSkillSlug(stem) ? stem : null;
}
function unquote(cell) {
  return cell.trim().replace(/^`/, "").replace(/`$/, "").trim();
}
function parseSettingsDeclaration(interfaceMd) {
  const lines = interfaceMd.split(/\r?\n/);
  let inSection = false;
  let sawSection = false;
  const decl = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const heading = /^\s*##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      inSection = /^settings$/i.test(heading[1].trim());
      if (inSection) sawSection = true;
      continue;
    }
    if (!inSection) continue;
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    const cells = trimmed.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length < 2) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c) || c === "")) continue;
    const key = unquote(cells[0]);
    if (key === "key" || !SETTINGS_KEY.test(key)) continue;
    decl.set(key, unquote(cells[1]));
  }
  return sawSection ? decl : null;
}
function parseSettingsOverride(jsonText) {
  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "a settings override must be a JSON object of key \u2192 value" };
  }
  return { ok: true, value: parsed };
}
function mergeSettings(declared, override) {
  const values = {};
  for (const [key, def] of declared) {
    values[key] = override && Object.prototype.hasOwnProperty.call(override, key) ? override[key] : def;
  }
  const undeclared = [];
  if (override) {
    for (const key of Object.keys(override)) {
      if (!declared.has(key)) undeclared.push(key);
    }
  }
  undeclared.sort();
  return { values, undeclared };
}
function locateInterface(skill, roots, readFile, joinSlash2) {
  for (const root of roots) {
    const path = joinSlash2(root, "skills", skill, "interface.md");
    const content = readFile(path);
    if (content === null) continue;
    const declared = parseSettingsDeclaration(content);
    if (declared === null) continue;
    return { root, path, declared };
  }
  return null;
}

// src/resolver/resolve.ts
function relativize(workspaceRoot2, absPath) {
  const abs = normalizeSlashes(absPath);
  const root = normalizeSlashes(workspaceRoot2).replace(/\/+$/, "");
  if (abs === root) return ".";
  if (abs.startsWith(root + "/")) return abs.slice(root.length + 1);
  return abs;
}
function toAbsolute(workspaceRoot2, snapshotPath2) {
  return isAbsoluteRoot(snapshotPath2) ? normalizeSlashes(snapshotPath2) : joinSlash(workspaceRoot2, snapshotPath2);
}
function inlineDispatchRel(dispatch) {
  const m = /^inline:\s*(.+)$/.exec(dispatch.trim());
  return m ? m[1].trim() : null;
}
function buildSnapshot(inputs, io) {
  const { workspaceRoot: workspaceRoot2 } = inputs;
  const diagnostics = [];
  const sources = [];
  const registryPath = normalizeSlashes(inputs.registryPathValue);
  sources.push(fingerprint("wf-config", "wf.config.js", inputs.wfConfigContent));
  sources.push(fingerprint("registry", registryPath, inputs.registryContent));
  if (registryPath !== "_local/config.md") {
    sources.push(fingerprint("core-config", "_local/config.md", inputs.coreConfigContent));
  }
  sources.push(
    fingerprint(
      "plugin-list",
      "claude plugin list --json",
      normalizePluginList(inputs.pluginListRaw)
    )
  );
  const registry = parseRegistry(inputs.registryContent ?? "");
  const coreConfig = parseCoreConfig(inputs.coreConfigContent ?? inputs.registryContent ?? "");
  let pluginList;
  if (inputs.pluginListRaw === null) {
    pluginList = { plugins: [], contractOk: true, issues: [] };
    diagnostics.push({
      severity: "warning",
      code: "plugin-list/cli-unavailable",
      message: "`claude plugin list --json` could not be run (CLI unavailable or errored); installed-pack facts are unknown for this snapshot. The plugin-list source is recorded as absent rather than an empty result \u2014 re-run once the `claude` CLI is available on PATH."
    });
  } else {
    pluginList = parsePluginList(inputs.pluginListRaw);
    for (const issue of pluginList.issues) {
      diagnostics.push({ severity: "error", code: issue.code, message: issue.message });
    }
  }
  const recordedRoots = registry.pluginRoots.map((r) => ({
    plugin: r.plugin,
    root: r.root
  }));
  const installedRoots = pluginList.plugins.map((p) => ({
    pluginName: p.name,
    installPath: p.installPath
  }));
  const manifestExists = (p) => io.readFile(p) !== null;
  const registeredByPlugin = /* @__PURE__ */ new Map();
  const pluginRootProvenance = /* @__PURE__ */ new Map();
  const capabilities = registry.capabilities.map((row) => {
    const anchor = /^plugin:([^/]+)\//.exec(row.path);
    const pluginName = anchor ? anchor[1] : null;
    const resolved = resolveCapabilityPath(row.path, {
      workspaceRoot: workspaceRoot2,
      recordedRoots,
      installedRoots,
      manifestExists
    });
    let kind = null;
    let fragments = [];
    let articles = [];
    let requires = [];
    let conflicts = [];
    let profileTemplatePath = null;
    if (resolved.manifestPath) {
      const content = io.readFile(resolved.manifestPath);
      if (content !== null) {
        sources.push(
          fingerprint("manifest", relativize(workspaceRoot2, resolved.manifestPath), content)
        );
        const m = parseManifest(content);
        kind = m.kind;
        fragments = m.fragments;
        articles = m.articles;
        requires = m.requires;
        conflicts = m.conflicts;
        if (m.profileTemplate && resolved.resolvedPath) {
          profileTemplatePath = relativize(
            workspaceRoot2,
            joinSlash(resolved.resolvedPath, m.profileTemplate)
          );
        }
      }
    }
    const validity = resolved.manifestPath !== null ? "ok" : "unrecoverable";
    if (validity === "unrecoverable") {
      diagnostics.push({
        severity: "error",
        code: "capability/unrecoverable",
        message: `capability \`${row.name}\` (path \`${row.path}\`) has no readable manifest \u2014 unrecoverable; re-run the owning pack's init to refresh its plugin root.`
      });
    }
    if (pluginName) {
      const entry = registeredByPlugin.get(pluginName) ?? {
        capabilities: [],
        anyUnrecoverable: false
      };
      entry.capabilities.push(row.name);
      if (validity === "unrecoverable") entry.anyUnrecoverable = true;
      registeredByPlugin.set(pluginName, entry);
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
      resolvedPath: resolved.resolvedPath ? relativize(workspaceRoot2, resolved.resolvedPath) : null,
      manifestPath: resolved.manifestPath ? relativize(workspaceRoot2, resolved.manifestPath) : null,
      provenance: resolved.provenance,
      kind,
      fragments,
      articles,
      requires,
      conflicts,
      profileTemplatePath,
      validity
    };
  });
  const pluginRoots = registry.pluginRoots.map((r) => {
    const provenance = pluginRootProvenance.get(r.plugin) ?? "recorded";
    const recordedRoot = normalizeSlashes(r.root);
    let resolvedRoot = recordedRoot;
    if (provenance === "self-healed") {
      const installed = installedRoots.find((ir) => ir.pluginName === r.plugin);
      resolvedRoot = installed ? relativize(workspaceRoot2, installed.installPath) : null;
    } else if (provenance === "unrecoverable") {
      resolvedRoot = null;
    } else {
      resolvedRoot = relativize(workspaceRoot2, recordedRoot);
    }
    return {
      plugin: r.plugin,
      recordedRoot: relativize(workspaceRoot2, recordedRoot),
      resolvedRoot,
      provenance
    };
  });
  const packs = [];
  const seenPlugins = /* @__PURE__ */ new Set();
  for (const p of pluginList.plugins) {
    seenPlugins.add(p.name);
    const reg = registeredByPlugin.get(p.name);
    let state;
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
      installPath: relativize(workspaceRoot2, p.installPath),
      state,
      registeredCapabilities: reg?.capabilities ?? [],
      diagnostics: state === "registered/unrecoverable" ? "registered capability manifest is unreadable under this installed pack \u2014 refresh its plugin root (re-run the pack init)." : null
    });
  }
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
      diagnostics: `registered pack \`${pluginName}\` is not installed (absent from \`claude plugin list --json\`) \u2014 install it or remove its registry rows.`
    });
  }
  const providerOwnership = [];
  for (const cap of capabilities) {
    for (const frag of cap.fragments) {
      if (frag.contributionKind !== "provider" || !frag.scope) continue;
      let fragmentPath = null;
      const rel = inlineDispatchRel(frag.dispatch);
      if (rel && cap.resolvedPath) {
        fragmentPath = joinSlash(cap.resolvedPath, rel);
      }
      providerOwnership.push({
        surface: frag.scope,
        owner: cap.name,
        fragmentPath,
        state: cap.validity === "ok" ? "ok" : "unrecoverable"
      });
    }
  }
  const trackerOwner = providerOwnership.find(
    (o) => o.surface === "tracker" && o.state === "ok"
  );
  const idShape = trackerOwner ? { source: `tracker:${trackerOwner.owner}`, scheme: null } : { source: "bare-core", scheme: "T<NNN>" };
  const profiles = {};
  for (const cap of capabilities) {
    const profilePath = joinSlash(
      workspaceRoot2,
      "_local/profiles",
      `${cap.name}.profile.json`
    );
    const content = io.readFile(profilePath);
    if (content === null) continue;
    sources.push(fingerprint("profile", relativize(workspaceRoot2, profilePath), content));
    try {
      profiles[cap.name] = JSON.parse(content);
    } catch (err) {
      diagnostics.push({
        severity: "warning",
        code: "profile/unparseable",
        message: `profile for \`${cap.name}\` is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  }
  const interfaceRoots = [];
  if (inputs.corePluginRoot) interfaceRoots.push(normalizeSlashes(inputs.corePluginRoot));
  for (const r of pluginRoots) {
    if (r.resolvedRoot) interfaceRoots.push(toAbsolute(workspaceRoot2, r.resolvedRoot));
  }
  const settingsDir = joinSlash(workspaceRoot2, SETTINGS_STORAGE_DIR);
  const settingsFiles = io.listFiles ? io.listFiles(settingsDir) : [];
  for (const filename of settingsFiles) {
    const skill = skillFromSettingsFilename(filename);
    if (!skill) continue;
    const overridePath = joinSlash(settingsDir, filename);
    const overrideRaw = io.readFile(overridePath);
    if (overrideRaw === null) continue;
    const parsed = parseSettingsOverride(overrideRaw);
    if (!parsed.ok) {
      diagnostics.push({
        severity: "warning",
        code: "settings/unparseable",
        message: `settings override for skill \`${skill}\` (\`${SETTINGS_STORAGE_DIR}/${filename}\`) is not a valid JSON object: ${parsed.error}`
      });
      continue;
    }
    const located = locateInterface(skill, interfaceRoots, io.readFile, joinSlash);
    if (!located) {
      diagnostics.push({
        severity: "warning",
        code: "settings/interface-unresolvable",
        message: `settings override for skill \`${skill}\` (\`${SETTINGS_STORAGE_DIR}/${filename}\`) has no locatable declaring \`interface.md\` \u2014 its keys cannot be validated. Install the owning pack or remove the override.`
      });
      continue;
    }
    const { undeclared } = mergeSettings(located.declared, parsed.value);
    if (undeclared.length > 0) {
      diagnostics.push({
        severity: "error",
        code: "settings/undeclared-key",
        message: `settings override for skill \`${skill}\` (\`${SETTINGS_STORAGE_DIR}/${filename}\`) carries ${undeclared.length === 1 ? "a key" : "keys"} its \`interface.md\` does not declare: ${undeclared.map((k) => `\`${k}\``).join(", ")}. Remove the undeclared ${undeclared.length === 1 ? "key" : "keys"} or declare ${undeclared.length === 1 ? "it" : "them"} in the skill's \`## Settings\` table.`,
        category: "registry-invalid",
        recovery: "The capability registry or a manifest/profile is invalid. Fix the registry or re-run the owning pack's init, then run `/wf:resolve refresh`."
      });
    }
  }
  const providerConfig = {};
  if (providerOwnership.some((o) => o.surface === "tracker")) {
    diagnostics.push({
      severity: "info",
      code: "provider-config/deferred",
      message: "tracker provider config values are resolved by the provider surface at query time (WF-270); the snapshot records ownership only, never a tracker product's config section."
    });
  }
  const constitutionInputs = [];
  for (const cap of capabilities) {
    for (const a of cap.articles) {
      constitutionInputs.push({ capability: cap.name, key: a.key, value: a.value });
    }
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    generatedAt: inputs.generatedAt,
    generator: inputs.generator,
    workspaceRoot: normalizeSlashes(workspaceRoot2),
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
    diagnostics
  };
}

// src/resolver/engine.ts
import { readFileSync as readFileSync2, readdirSync } from "node:fs";
import { join as join2 } from "node:path";
import { execFileSync } from "node:child_process";

// src/resolver/snapshot-store.ts
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
function snapshotPath(workspaceRoot2) {
  return join(workspaceRoot2, SNAPSHOT_CACHE_RELPATH);
}
function writeSnapshot(workspaceRoot2, snapshot) {
  const target = snapshotPath(workspaceRoot2);
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.snapshot.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
  const json = `${JSON.stringify(snapshot, null, 2)}
`;
  try {
    writeFileSync(tmp, json, { encoding: "utf8" });
    renameSync(tmp, target);
  } catch (err) {
    try {
      rmSync(tmp, { force: true });
    } catch {
    }
    throw err;
  }
  return target;
}
var SnapshotSchemaError = class extends Error {
  constructor(found, expected) {
    super(
      `resolver snapshot schemaVersion ${String(found)} is incompatible with this runtime (expects ${expected}); rebuild the snapshot.`
    );
    this.found = found;
    this.expected = expected;
    this.name = "SnapshotSchemaError";
  }
  found;
  expected;
};
function readSnapshot(workspaceRoot2) {
  const target = snapshotPath(workspaceRoot2);
  let raw;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const parsed = JSON.parse(raw);
  if (parsed.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new SnapshotSchemaError(parsed.schemaVersion, SNAPSHOT_SCHEMA_VERSION);
  }
  return parsed;
}

// src/resolver/engine.ts
var DEFAULT_REGISTRY_RELPATH = "_local/config.md";
function readOrNull(absPath) {
  try {
    return readFileSync2(absPath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
function listFilesOrEmpty(absDir) {
  try {
    return readdirSync(absDir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return [];
  }
}
var fsIO = { readFile: readOrNull, listFiles: listFilesOrEmpty };
function extractRegistryPath(wfConfig) {
  if (!wfConfig) return DEFAULT_REGISTRY_RELPATH;
  const m = /^\s*registryPath\s*:\s*["']([^"']*)["']/m.exec(wfConfig);
  const v = m?.[1]?.trim();
  return v && v.length > 0 ? normalizeSlashes(v) : DEFAULT_REGISTRY_RELPATH;
}
function runPluginList() {
  try {
    return execFileSync("claude", ["plugin", "list", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 16 * 1024 * 1024
    });
  } catch {
    return null;
  }
}
function resolveSnapshot(opts) {
  const workspaceRoot2 = normalizeSlashes(opts.workspaceRoot);
  const io = opts.io ?? fsIO;
  const wfConfigContent = io.readFile(join2(opts.workspaceRoot, "wf.config.js"));
  const registryPathValue = extractRegistryPath(wfConfigContent);
  const registryAbs = join2(opts.workspaceRoot, registryPathValue);
  const registryContent = io.readFile(registryAbs);
  const coreConfigAbs = join2(opts.workspaceRoot, DEFAULT_REGISTRY_RELPATH);
  const coreConfigContent = registryPathValue === DEFAULT_REGISTRY_RELPATH ? registryContent : io.readFile(coreConfigAbs);
  const pluginListRaw = opts.pluginListRaw !== void 0 ? opts.pluginListRaw : runPluginList();
  const now = (opts.now ?? (() => /* @__PURE__ */ new Date()))();
  const inputs = {
    workspaceRoot: workspaceRoot2,
    registryPathValue,
    registryContent,
    wfConfigContent,
    coreConfigContent,
    pluginListRaw,
    generatedAt: now.toISOString(),
    generator: opts.generator ?? { ...RESOLVER_GENERATOR },
    corePluginRoot: opts.corePluginRoot ?? null
  };
  return buildSnapshot(inputs, io);
}
function resolveAndPersist(opts) {
  const snapshot = resolveSnapshot(opts);
  const cachePath = writeSnapshot(opts.workspaceRoot, snapshot);
  return { snapshot, cachePath };
}

// src/refresh.ts
function workspaceRoot() {
  return normalizeSlashes(process.env.WF_WORKSPACE_ROOT || process.cwd());
}
function corePluginRoot() {
  if (process.env.WF_CORE_PLUGIN_ROOT) {
    return normalizeSlashes(process.env.WF_CORE_PLUGIN_ROOT);
  }
  const here = fileURLToPath(import.meta.url);
  return normalizeSlashes(resolve(dirname2(here), "..", ".."));
}
function log(line) {
  process.stdout.write(`wf-resolver refresh-if-stale: ${line}
`);
}
function main() {
  const root = workspaceRoot();
  let cached = null;
  let cacheReason = null;
  try {
    cached = readSnapshot(root);
    if (cached === null) {
      cacheReason = { code: "cache/absent", message: "no snapshot cached yet." };
    }
  } catch (err) {
    cacheReason = {
      code: "cache/unreadable",
      message: `cached snapshot is malformed or incompatible: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  if (cached === null) {
    resolveAndPersist({ workspaceRoot: root, corePluginRoot: corePluginRoot() });
    log(`built snapshot (${cacheReason?.message ?? "no cache"}).`);
    return;
  }
  const { fresh, reasons } = evaluateFreshness(cached, root, {
    readFile: (p) => fsIO.readFile(p),
    pluginListRaw: runPluginList(),
    generatorVersion: RESOLVER_GENERATOR.version
  });
  if (fresh) {
    log("snapshot is fresh; no rebuild.");
    return;
  }
  resolveAndPersist({ workspaceRoot: root, corePluginRoot: corePluginRoot() });
  log(`refreshed snapshot; reasons: ${reasons.map((r) => r.code).join(", ")}.`);
}
try {
  main();
} catch (err) {
  process.stderr.write(
    `wf-resolver refresh-if-stale: skipped (${err instanceof Error ? err.message : String(err)}).
`
  );
}
process.exit(0);
