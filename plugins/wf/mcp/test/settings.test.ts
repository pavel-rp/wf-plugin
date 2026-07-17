// Per-skill settings resolution contract tests (WF-328, C014 SUB-5).
//
// Covers the three success criteria against synthetic fixtures (no real
// filesystem, no `claude` CLI):
//   1. a declared key with no override resolves to its declared default, and no
//      override file is seeded (there is none to seed);
//   2. an override with a divergent value wins per key;
//   3. an override carrying an UNDECLARED key is rejected loudly at refresh-time
//      validation, naming the key AND the skill.
// Plus the pure parse/merge helpers and the resolver service query surface.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { resolveSnapshot } from "../src/resolver/engine.js";
import {
  parseSettingsDeclaration,
  parseSettingsOverride,
  mergeSettings,
  skillFromSettingsFilename,
  settingsOverrideRelPath,
} from "../src/resolver/settings.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import type { ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";
const CORE = "/core/plugins/wf";

// A settings-declaring interface for a synthetic `demo` core skill.
const DEMO_INTERFACE = `# /wf:demo — interface declaration (fixture)

## Slots

_(none)_

## Settings

| key          | default | purpose                          |
|--------------|---------|----------------------------------|
| \`review.depth\` | \`2\`     | number of review passes          |
| review.strict | false   | fail on any warning              |

## Safety rules

Reads only.
`;

const REGISTRY = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path |
|------------|------|
`;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("parseSettingsDeclaration reads keys and defaults from the `## Settings` table", () => {
  const decl = parseSettingsDeclaration(DEMO_INTERFACE);
  assert.ok(decl);
  assert.equal(decl.get("review.depth"), "2");
  assert.equal(decl.get("review.strict"), "false");
  assert.equal(decl.size, 2);
});

test("parseSettingsDeclaration returns an empty map for a `_(none)_` section", () => {
  const decl = parseSettingsDeclaration("## Settings\n\n_(none)_\n");
  assert.ok(decl);
  assert.equal(decl.size, 0);
});

test("parseSettingsDeclaration returns null when there is no `## Settings` section", () => {
  assert.equal(parseSettingsDeclaration("# skill\n\n## Slots\n\n_(none)_\n"), null);
});

test("skillFromSettingsFilename accepts a well-formed override name and rejects others", () => {
  assert.equal(skillFromSettingsFilename("demo.settings.json"), "demo");
  assert.equal(skillFromSettingsFilename("audit.profile.json"), null); // a capability profile
  assert.equal(skillFromSettingsFilename("bad..settings.json"), null);
  assert.equal(settingsOverrideRelPath("demo"), "_local/profiles/demo.settings.json");
});

test("mergeSettings applies the default when no override, the override when divergent", () => {
  const decl = parseSettingsDeclaration(DEMO_INTERFACE)!;
  const noOverride = mergeSettings(decl, null);
  assert.equal(noOverride.values["review.depth"], "2");
  assert.deepEqual(noOverride.undeclared, []);

  const overridden = mergeSettings(decl, { "review.depth": 5 });
  assert.equal(overridden.values["review.depth"], 5); // override wins
  assert.equal(overridden.values["review.strict"], "false"); // untouched default
  assert.deepEqual(overridden.undeclared, []);
});

test("mergeSettings collects undeclared override keys instead of merging them", () => {
  const decl = parseSettingsDeclaration(DEMO_INTERFACE)!;
  const merged = mergeSettings(decl, { "review.depth": 3, "review.bogus": true, other: 1 });
  assert.deepEqual(merged.undeclared, ["other", "review.bogus"]); // sorted
  assert.ok(!("review.bogus" in merged.values));
  assert.equal(merged.values["review.depth"], 3);
});

test("parseSettingsOverride rejects non-object JSON", () => {
  assert.equal(parseSettingsOverride("[1,2]").ok, false);
  assert.equal(parseSettingsOverride("42").ok, false);
  assert.equal(parseSettingsOverride("{ not json").ok, false);
  const good = parseSettingsOverride('{"a":1}');
  assert.ok(good.ok && good.value.a === 1);
});

// ---------------------------------------------------------------------------
// Refresh-time validation (buildSnapshot)
// ---------------------------------------------------------------------------

interface FileMap {
  [absPath: string]: string;
}

function makeIO(files: FileMap) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) map.set(normalizeSlashes(k), v);
  return {
    readFile: (p: string) => map.get(normalizeSlashes(p)) ?? null,
    listFiles: (dir: string) => {
      const prefix = normalizeSlashes(dir).replace(/\/+$/, "") + "/";
      const names = new Set<string>();
      for (const key of map.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (!rest.includes("/")) names.add(rest);
      }
      return [...names];
    },
  };
}

function refreshWith(files: FileMap): ResolverSnapshot {
  return resolveSnapshot({
    workspaceRoot: WS,
    corePluginRoot: CORE,
    io: makeIO({ [`${WS}/_local/config.md`]: REGISTRY, ...files }),
    pluginListRaw: "[]",
    now: () => new Date("2026-07-17T00:00:00.000Z"),
    generator: { name: "wf-resolver", version: "0.3.0" },
  });
}

test("refresh rejects an override with an undeclared key, naming the key and the skill", () => {
  const snap = refreshWith({
    [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE,
    [`${WS}/_local/profiles/demo.settings.json`]: JSON.stringify({ "review.bogus": true }),
  });
  const d = snap.diagnostics.find((x) => x.code === "settings/undeclared-key");
  assert.ok(d, "expected a settings/undeclared-key diagnostic");
  assert.equal(d!.severity, "error");
  assert.equal(d!.category, "registry-invalid");
  assert.match(d!.message, /demo/); // names the skill
  assert.match(d!.message, /review\.bogus/); // names the key
});

test("refresh accepts a clean override with only declared keys (no error)", () => {
  const snap = refreshWith({
    [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE,
    [`${WS}/_local/profiles/demo.settings.json`]: JSON.stringify({ "review.depth": 9 }),
  });
  assert.ok(!snap.diagnostics.some((d) => d.code === "settings/undeclared-key"));
});

test("refresh warns (does not hard-fail) when an override's interface is unlocatable", () => {
  const snap = refreshWith({
    [`${WS}/_local/profiles/ghost.settings.json`]: JSON.stringify({ x: 1 }),
  });
  const d = snap.diagnostics.find((x) => x.code === "settings/interface-unresolvable");
  assert.ok(d);
  assert.equal(d!.severity, "warning");
});

test("refresh warns on an unparseable override", () => {
  const snap = refreshWith({
    [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE,
    [`${WS}/_local/profiles/demo.settings.json`]: "{ not json",
  });
  const d = snap.diagnostics.find((x) => x.code === "settings/unparseable");
  assert.ok(d);
  assert.equal(d!.severity, "warning");
});

test("a project with no settings overrides produces no settings diagnostics", () => {
  const snap = refreshWith({ [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE });
  assert.ok(!snap.diagnostics.some((d) => d.code.startsWith("settings/")));
});

// ---------------------------------------------------------------------------
// Service query (resolve_settings)
// ---------------------------------------------------------------------------

function makeService(files: FileMap): ResolverService {
  const map = new Map<string, string>();
  const seed: FileMap = { [`${WS}/_local/config.md`]: REGISTRY, ...files };
  for (const [k, v] of Object.entries(seed)) map.set(normalizeSlashes(k), v);
  const io = makeIO(seed);
  const ports: ResolverServicePorts = {
    workspaceRoot: WS,
    corePluginRoot: CORE,
    resolveFresh: () =>
      resolveSnapshot({
        workspaceRoot: WS,
        corePluginRoot: CORE,
        io,
        pluginListRaw: "[]",
        now: () => new Date("2026-07-17T00:00:00.000Z"),
        generator: { name: "wf-resolver", version: "0.3.0" },
      }),
    persist: () => {},
    readCache: () => null,
    readFile: (p) => map.get(normalizeSlashes(p)) ?? null,
    writeFile: () => {},
    listDirs: () => [],
    listPlugins: () => ({ plugins: [], ok: true }),
    registryRelPath: () => "_local/config.md",
  };
  return new ResolverService(ports);
}

test("resolveSettings returns declared defaults when no override is present", () => {
  const svc = makeService({ [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE });
  const r = svc.resolveSettings("demo");
  assert.equal(r.declared, true);
  assert.equal(r.overridePresent, false);
  assert.equal(r.category, null);
  assert.deepEqual(r.values, { "review.depth": "2", "review.strict": "false" });
});

test("resolveSettings lets a divergent override win per key", () => {
  const svc = makeService({
    [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE,
    [`${WS}/_local/profiles/demo.settings.json`]: JSON.stringify({ "review.depth": 7 }),
  });
  const r = svc.resolveSettings("demo");
  assert.equal(r.overridePresent, true);
  assert.equal(r.category, null);
  assert.equal(r.values!["review.depth"], 7);
  assert.equal(r.values!["review.strict"], "false");
});

test("resolveSettings rejects an undeclared override key loudly, naming key and skill", () => {
  const svc = makeService({
    [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE,
    [`${WS}/_local/profiles/demo.settings.json`]: JSON.stringify({ nope: 1 }),
  });
  const r = svc.resolveSettings("demo");
  assert.equal(r.category, "registry-invalid");
  assert.deepEqual(r.undeclaredKeys, ["nope"]);
  assert.equal(r.values, null);
  assert.match(r.message!, /demo/);
  assert.match(r.message!, /nope/);
});

test("resolveSettings reports a bad skill slug as registry-invalid", () => {
  const svc = makeService({});
  const r = svc.resolveSettings("Bad.Slug");
  assert.equal(r.category, "registry-invalid");
  assert.equal(r.values, null);
});
