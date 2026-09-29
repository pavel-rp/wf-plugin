// Parser + path-resolution contract tests: registry, manifest, config, and
// plugin-anchored resolution (recorded-root-first with plugin-list self-heal).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRegistry } from "../src/resolver/registry.js";
import { parseManifest } from "../src/resolver/manifest.js";
import { parseCoreConfig } from "../src/resolver/config.js";
import { resolveCapabilityPath, parsePluginAnchor } from "../src/resolver/paths.js";

const REGISTRY = `# Skills Configuration

## Capabilities

| Capability | Path |
|------------|------|
| audit | plugins/wf-audit/capabilities/audit |
| git   | plugin:wf-git/capabilities/git |

## Plugin Roots

| Plugin | Root |
|--------|------|
| wf-git | /opt/plugins/wf-git |
`;

test("parseRegistry reads both tables, in order", () => {
  const r = parseRegistry(REGISTRY);
  assert.deepEqual(
    r.capabilities.map((c) => c.name),
    ["audit", "git"],
  );
  assert.equal(r.capabilities[1].path, "plugin:wf-git/capabilities/git");
  assert.equal(r.pluginRoots.length, 1);
  assert.deepEqual(r.pluginRoots[0], { plugin: "wf-git", root: "/opt/plugins/wf-git" });
});

test("parseRegistry on an empty/absent registry yields empty tables", () => {
  assert.deepEqual(parseRegistry(""), { capabilities: [], pluginRoots: [] });
  assert.deepEqual(parseRegistry("# nothing here\n\nsome prose"), {
    capabilities: [],
    pluginRoots: [],
  });
});

const MANIFEST = `# git capability manifest

**Kind:** both (ships its own init; also attaches one phase fragment)

SECRET_MANIFEST_PROSE marker that must never reach the snapshot.

requires: git
conflicts: solo
article: commit-signing = required

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/delivery.ops.md\` | delivery |

## Payloads

| Source | Destination | Production | Refresh | Removal |
|--------|-------------|------------|---------|---------|
| assets/default.json | .wf/default.json | copy | replace-if-unmodified | delete-if-unmodified |
| assets/keep.txt | docs/keep.txt | copy | retain | retain |

profile-template: profile.template.json
`;

test("parseManifest extracts metadata but no fragment body", () => {
  const m = parseManifest(MANIFEST);
  assert.equal(m.kind, "both");
  assert.deepEqual(m.requires, ["git"]);
  assert.deepEqual(m.conflicts, ["solo"]);
  assert.deepEqual(m.articles, [{ key: "commit-signing", value: "required" }]);
  assert.equal(m.profileTemplate, "profile.template.json");
  assert.equal(m.fragments.length, 1);
  assert.deepEqual(m.fragments[0], {
    phase: "implement",
    contributionKind: "provider",
    dispatch: "inline: fragments/delivery.ops.md",
    scope: "delivery",
  });
  assert.deepEqual(m.payloads, {
    headers: ["Source", "Destination", "Production", "Refresh", "Removal"],
    rows: [
      ["assets/default.json", ".wf/default.json", "copy", "replace-if-unmodified", "delete-if-unmodified"],
      ["assets/keep.txt", "docs/keep.txt", "copy", "retain", "retain"],
    ],
    sectionCount: 1,
  });
});

test("parseCoreConfig reads values and treats placeholders as unset", () => {
  const cfg = parseCoreConfig(`
| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
| **Verify Command** | \`npm run typecheck\` |
| **QA Rules** | \`<none>\` |
| **Architecture Doc** | \`<ARCHITECTURE_DOC: path>\` |
| **Context Ceiling** | \`150000\` |
| **Version Declaration** | \`plugins/unit/manifest.json\` |
| **Review Wait Minutes** | \`45\` |
`);
  assert.equal(cfg.taskRoot, "_local");
  assert.equal(cfg.verifyCommand, "npm run typecheck");
  assert.equal(cfg.qaRules, null);
  assert.equal(cfg.seedArchitectureDoc, null);
  assert.equal(cfg.contextCeiling, "150000");
  assert.equal(cfg.versionDeclaration, "plugins/unit/manifest.json");
  assert.equal(cfg.reviewWaitMinutes, "45");
});

test("parseCoreConfig leaves an absent or <none> review wait null for fleet's own fallback", () => {
  // A repo initialized before the key existed, and an explicit `<none>`, both reach
  // `/wf:fleet` as `null`, which it reads as its shipped default — never as `0`,
  // which would mean "no wait is possible".
  assert.equal(parseCoreConfig("| **Task Root** | `_local` |\n").reviewWaitMinutes, null);
  assert.equal(parseCoreConfig("| **Review Wait Minutes** | `<none>` |\n").reviewWaitMinutes, null);
  assert.equal(parseCoreConfig("| **Review Wait Minutes** | `0` |\n").reviewWaitMinutes, "0");
});

test("parseCoreConfig leaves an unset version declaration null rather than guessing", () => {
  // The currency check must be able to say "not configured" — an absent key and
  // an explicit `<none>` both have to reach the caller as `null`, never as an
  // empty string a comparison could mistake for a real declaration.
  const absent = parseCoreConfig(`
| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
`);
  assert.equal(absent.versionDeclaration, null);

  const none = parseCoreConfig(`
| Key | Value |
|-----|-------|
| **Version Declaration** | \`<none>\` |
`);
  assert.equal(none.versionDeclaration, null);
});

test("parsePluginAnchor recognizes plugin-anchored tokens", () => {
  assert.deepEqual(parsePluginAnchor("plugin:wf-git/capabilities/git"), {
    pluginName: "wf-git",
    relPath: "capabilities/git",
  });
  assert.equal(parsePluginAnchor("plugins/wf-audit/capabilities/audit"), null);
});

test("resolveCapabilityPath: repo-relative resolves against workspace root", () => {
  const r = resolveCapabilityPath("plugins/wf-audit/capabilities/audit", {
    workspaceRoot: "/ws",
    recordedRoots: [],
    installedRoots: [],
    manifestExists: (p) => p === "/ws/plugins/wf-audit/capabilities/audit/manifest.md",
  });
  assert.equal(r.provenance, "recorded");
  assert.equal(r.manifestPath, "/ws/plugins/wf-audit/capabilities/audit/manifest.md");
});

test("resolveCapabilityPath: recorded plugin root wins when its manifest exists", () => {
  const r = resolveCapabilityPath("plugin:wf-git/capabilities/git", {
    workspaceRoot: "/ws",
    recordedRoots: [{ plugin: "wf-git", root: "/opt/wf-git" }],
    installedRoots: [{ pluginName: "wf-git", installPath: "/cache/wf-git" }],
    manifestExists: (p) => p === "/opt/wf-git/capabilities/git/manifest.md",
  });
  assert.equal(r.provenance, "recorded");
  assert.equal(r.manifestPath, "/opt/wf-git/capabilities/git/manifest.md");
});

test("resolveCapabilityPath: self-heals from installPath when recorded root dangles", () => {
  const r = resolveCapabilityPath("plugin:wf-git/capabilities/git", {
    workspaceRoot: "/ws",
    recordedRoots: [{ plugin: "wf-git", root: "/opt/STALE" }],
    installedRoots: [{ pluginName: "wf-git", installPath: "/cache/wf-git" }],
    manifestExists: (p) => p === "/cache/wf-git/capabilities/git/manifest.md",
  });
  assert.equal(r.provenance, "self-healed");
  assert.equal(r.manifestPath, "/cache/wf-git/capabilities/git/manifest.md");
});

test("resolveCapabilityPath: an installed sibling version supersedes a readable older recorded root", () => {
  const r = resolveCapabilityPath("plugin:wf-pm/capabilities/pm", {
    workspaceRoot: "/ws",
    recordedRoots: [{ plugin: "wf-pm", root: "/cache/mk/wf-pm/0.8.1" }],
    installedRoots: [{ pluginName: "wf-pm", installPath: "/cache/mk/wf-pm/0.9.9" }],
    manifestExists: (p) =>
      p === "/cache/mk/wf-pm/0.8.1/capabilities/pm/manifest.md" ||
      p === "/cache/mk/wf-pm/0.9.9/capabilities/pm/manifest.md",
  });
  assert.equal(r.provenance, "self-healed");
  assert.equal(r.resolvedPath, "/cache/mk/wf-pm/0.9.9/capabilities/pm");
  assert.equal(r.manifestPath, "/cache/mk/wf-pm/0.9.9/capabilities/pm/manifest.md");
  assert.equal(r.supersededRoot, "/cache/mk/wf-pm/0.8.1");
});

test("resolveCapabilityPath: a non-sibling recorded root still wins over a readable installed copy", () => {
  const r = resolveCapabilityPath("plugin:wf-pm/capabilities/pm", {
    workspaceRoot: "/ws",
    recordedRoots: [{ plugin: "wf-pm", root: "/src/checkout/plugins/wf-pm" }],
    installedRoots: [{ pluginName: "wf-pm", installPath: "/cache/mk/wf-pm/0.9.9" }],
    manifestExists: (p) =>
      p === "/src/checkout/plugins/wf-pm/capabilities/pm/manifest.md" ||
      p === "/cache/mk/wf-pm/0.9.9/capabilities/pm/manifest.md",
  });
  assert.equal(r.provenance, "recorded");
  assert.equal(r.manifestPath, "/src/checkout/plugins/wf-pm/capabilities/pm/manifest.md");
  assert.equal(r.supersededRoot, null);
});

test("resolveCapabilityPath: a readable sibling recorded root is kept when the installed manifest is unreadable", () => {
  const r = resolveCapabilityPath("plugin:wf-pm/capabilities/pm", {
    workspaceRoot: "/ws",
    recordedRoots: [{ plugin: "wf-pm", root: "/cache/mk/wf-pm/0.8.1" }],
    installedRoots: [{ pluginName: "wf-pm", installPath: "/cache/mk/wf-pm/0.9.9" }],
    manifestExists: (p) => p === "/cache/mk/wf-pm/0.8.1/capabilities/pm/manifest.md",
  });
  assert.equal(r.provenance, "recorded");
  assert.equal(r.manifestPath, "/cache/mk/wf-pm/0.8.1/capabilities/pm/manifest.md");
  assert.equal(r.supersededRoot, null);
});

test("resolveCapabilityPath: a recorded root equal to the installed root resolves as recorded", () => {
  const r = resolveCapabilityPath("plugin:wf-pm/capabilities/pm", {
    workspaceRoot: "/ws",
    recordedRoots: [{ plugin: "wf-pm", root: "/cache/mk/wf-pm/0.9.9/" }],
    installedRoots: [{ pluginName: "wf-pm", installPath: "/cache/mk/wf-pm/0.9.9" }],
    manifestExists: (p) => p === "/cache/mk/wf-pm/0.9.9/capabilities/pm/manifest.md",
  });
  assert.equal(r.provenance, "recorded");
  assert.equal(r.supersededRoot, null);
});

test("resolveCapabilityPath: the dangling-root self-heal reports no superseded root", () => {
  const r = resolveCapabilityPath("plugin:wf-git/capabilities/git", {
    workspaceRoot: "/ws",
    recordedRoots: [{ plugin: "wf-git", root: "/cache/mk/wf-git/0.7.0" }],
    installedRoots: [{ pluginName: "wf-git", installPath: "/cache/mk/wf-git/0.12.0" }],
    manifestExists: (p) => p === "/cache/mk/wf-git/0.12.0/capabilities/git/manifest.md",
  });
  assert.equal(r.provenance, "self-healed");
  assert.equal(r.supersededRoot, null);
});

test("resolveCapabilityPath: unrecoverable when neither route has a manifest", () => {
  const r = resolveCapabilityPath("plugin:wf-ghost/capabilities/ghost", {
    workspaceRoot: "/ws",
    recordedRoots: [],
    installedRoots: [],
    manifestExists: () => false,
  });
  assert.equal(r.provenance, "unrecoverable");
  assert.equal(r.manifestPath, null);
});
