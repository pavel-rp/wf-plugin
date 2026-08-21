// Slot/settings fingerprint + orphan-validation + provenance tests (WF-329).
//
// Drives the deterministic builder + freshness evaluation over a synthetic
// in-memory workspace (no real filesystem, no `claude` CLI) to assert the five
// success criteria:
//   1. editing a registered slot-contribution / slot-override / settings-override
//      file invalidates the snapshot (the next freshness check sees it stale);
//   2. an override targeting a `skill.point` no active interface declares fails
//      the refresh LOUDLY, naming the override file + the missing slot id;
//   3. a pack `slot` contribution targeting an undeclared `skill.point` fails the
//      refresh LOUDLY, naming the capability + the missing slot id;
//   4. per-slot provenance (slot id → winning source → tier + override presence)
//      is recorded and surfaced by resolve_inspect, with settings-override presence;
//   5. a project with zero slot contributions and zero overrides keeps a
//      byte-stable snapshot (no thrash) and adds none of the new source kinds.

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { evaluateFreshness } from "../src/resolver/freshness.js";
import {
  parseSlotDeclaration,
  slotPointFromOverrideFilename,
} from "../src/resolver/slot.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import type { ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";
const CORE = "/core/plugins/wf";
const NOW = () => new Date("2026-07-17T00:00:00.000Z");
const GEN = { name: "wf-resolver", version: "0.3.0" };

// A `demo` skill interface declaring two slots — `demo.review` (replace, which
// `capx` contributes to) and `demo.solo` (append, declared but uncontributed, so a
// committed project override can fill it alone) — plus one settings key. This is
// what the active declaration orphan validation checks against.
const DEMO_INTERFACE = `# /wf:demo — interface declaration (fixture)

## Slots

| slot (skill.point) | merge policy | purpose             |
|--------------------|--------------|---------------------|
| demo.review        | replace      | the review step     |
| demo.solo          | append       | an uncontributed point |

## Settings

| key          | default | purpose            |
|--------------|---------|--------------------|
| review.depth | 2       | number of passes   |
`;

// A vendored capability `capx` contributing a `slot` body to `demo.review`.
const CAPX_MANIFEST = `# capx capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| —     | slot | \`inline: hooks/review.md\` | demo.review replace |
`;

const CAPX_BODY = "CAPX_REVIEW_BODY_v1";
const OVERRIDE_BODY = "PERSONAL_REVIEW_OVERRIDE_v1";
const PROJECT_BODY = "COMMITTED_PROJECT_OVERRIDE_v1";

const REGISTRY = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path       |
|------------|------------|
| capx       | caps/capx  |
`;

const EMPTY_REGISTRY = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path |
|------------|------|
`;

interface FileMap {
  [absPath: string]: string;
}

function makeIO(files: FileMap) {
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries(files)) map.set(normalizeSlashes(k), v);
  return {
    map,
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

function build(files: FileMap): { snap: ResolverSnapshot; io: ReturnType<typeof makeIO> } {
  const io = makeIO({ [`${WS}/_local/config.md`]: REGISTRY, ...files });
  const snap = resolveSnapshot({
    workspaceRoot: WS,
    corePluginRoot: CORE,
    io,
    pluginListRaw: "[]",
    now: NOW,
    generator: GEN,
  });
  return { snap, io };
}

// A healthy project: interface declares demo.review, capx contributes to it.
function healthyFiles(extra: FileMap = {}): FileMap {
  return {
    [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE,
    [`${WS}/caps/capx/manifest.md`]: CAPX_MANIFEST,
    [`${WS}/caps/capx/hooks/review.md`]: CAPX_BODY,
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// Pure parse helpers
// ---------------------------------------------------------------------------

test("parseSlotDeclaration reads declared slot ids from the `## Slots` table", () => {
  const decl = parseSlotDeclaration(DEMO_INTERFACE);
  assert.ok(decl);
  assert.ok(decl.has("demo.review"));
  assert.ok(decl.has("demo.solo"));
  assert.equal(decl.size, 2); // the header and separator rows are not declarations
});

test("parseSlotDeclaration returns an empty set for a `_(none)_` section, null for no section", () => {
  const none = parseSlotDeclaration("## Slots\n\n_(none)_\n");
  assert.ok(none);
  assert.equal(none.size, 0);
  assert.equal(parseSlotDeclaration("# skill\n\n## Settings\n\n_(none)_\n"), null);
});

test("slotPointFromOverrideFilename accepts a well-formed name and rejects others", () => {
  assert.deepEqual(slotPointFromOverrideFilename("ship.review.md"), {
    skillPoint: "ship.review",
    skill: "ship",
    point: "review",
  });
  assert.equal(slotPointFromOverrideFilename("ship.review.txt"), null);
  assert.equal(slotPointFromOverrideFilename("shipreview.md"), null); // no point
  assert.equal(slotPointFromOverrideFilename("a.b.c.md"), null); // too many segments
});

// ---------------------------------------------------------------------------
// 1. Invalidation — editing a fingerprinted file makes the snapshot stale
// ---------------------------------------------------------------------------

test("editing a slot-contribution body invalidates the snapshot", () => {
  const { snap, io } = build(healthyFiles());
  // The contribution body was fingerprinted as a source.
  const src = snap.sources.find((s) => s.kind === "slot-contribution");
  assert.ok(src, "expected a slot-contribution source fingerprint");
  assert.equal(src.present, true);

  // Edit the body; re-evaluate freshness against the same recorded paths.
  const edited = new Map(io.map);
  edited.set(normalizeSlashes(`${WS}/caps/capx/hooks/review.md`), CAPX_BODY + "_EDITED");
  const { fresh, reasons } = evaluateFreshness(snap, WS, {
    readFile: (p) => edited.get(normalizeSlashes(p)) ?? null,
  });
  assert.equal(fresh, false);
  assert.ok(reasons.some((r) => r.code === "slot-contribution/changed"));
});

test("editing a personal slot override invalidates the snapshot", () => {
  const { snap, io } = build(healthyFiles({ [`${WS}/_local/slots/demo.review.md`]: OVERRIDE_BODY }));
  assert.ok(snap.sources.some((s) => s.kind === "slot-override" && s.present));

  const edited = new Map(io.map);
  edited.set(normalizeSlashes(`${WS}/_local/slots/demo.review.md`), OVERRIDE_BODY + "_EDITED");
  const { fresh, reasons } = evaluateFreshness(snap, WS, {
    readFile: (p) => edited.get(normalizeSlashes(p)) ?? null,
  });
  assert.equal(fresh, false);
  assert.ok(reasons.some((r) => r.code === "slot-override/changed"));
});

test("editing a committed project slot override invalidates the snapshot", () => {
  // WF-443: the committed `.wf/` tier is fingerprinted exactly as the personal
  // `_local/` one, so a checked-in customization is never served stale.
  const { snap, io } = build(healthyFiles({ [`${WS}/.wf/slots/demo.review.md`]: PROJECT_BODY }));
  assert.ok(snap.sources.some((s) => s.kind === "slot-project-override" && s.present));

  const edited = new Map(io.map);
  edited.set(normalizeSlashes(`${WS}/.wf/slots/demo.review.md`), PROJECT_BODY + "_EDITED");
  const { fresh, reasons } = evaluateFreshness(snap, WS, {
    readFile: (p) => edited.get(normalizeSlashes(p)) ?? null,
  });
  assert.equal(fresh, false);
  assert.ok(reasons.some((r) => r.code === "slot-project-override/changed"));
});

test("editing a per-skill settings override invalidates the snapshot", () => {
  const { snap, io } = build(
    healthyFiles({ [`${WS}/_local/profiles/demo.settings.json`]: JSON.stringify({ "review.depth": 5 }) }),
  );
  assert.ok(snap.sources.some((s) => s.kind === "settings-override" && s.present));

  const edited = new Map(io.map);
  edited.set(
    normalizeSlashes(`${WS}/_local/profiles/demo.settings.json`),
    JSON.stringify({ "review.depth": 9 }),
  );
  const { fresh, reasons } = evaluateFreshness(snap, WS, {
    readFile: (p) => edited.get(normalizeSlashes(p)) ?? null,
  });
  assert.equal(fresh, false);
  assert.ok(reasons.some((r) => r.code === "settings-override/changed"));
});

// ---------------------------------------------------------------------------
// 2 + 3. Orphan validation — both directions fail loudly at refresh
// ---------------------------------------------------------------------------

test("an override targeting an undeclared slot fails loudly, naming the file and the slot id", () => {
  // The interface declares only `demo.review`; the override targets `demo.gone`.
  const { snap } = build(healthyFiles({ [`${WS}/_local/slots/demo.gone.md`]: "orphan override body" }));
  const d = snap.diagnostics.find((x) => x.code === "slot/orphaned-override");
  assert.ok(d, "expected a slot/orphaned-override diagnostic");
  assert.equal(d.severity, "error");
  assert.equal(d.category, "registry-invalid");
  assert.ok(d.message.includes("_local/slots/demo.gone.md"), "names the override file");
  assert.ok(d.message.includes("demo.gone"), "names the missing slot id");
  assert.ok(d.recovery?.includes("/wf:resolve"), "states a /wf:resolve recovery path");
});

test("a committed project override targeting an undeclared slot fails loudly, naming the file and the slot id", () => {
  // WF-443: symmetric with the personal-override orphan check — a committed
  // override that could only ever lose to the inline default is a loud error,
  // never a silent no-op.
  const { snap } = build(healthyFiles({ [`${WS}/.wf/slots/demo.gone.md`]: "orphan project override body" }));
  const d = snap.diagnostics.find((x) => x.code === "slot/orphaned-project-override");
  assert.ok(d, "expected a slot/orphaned-project-override diagnostic");
  assert.equal(d.severity, "error");
  assert.equal(d.category, "registry-invalid");
  assert.ok(d.message.includes(".wf/slots/demo.gone.md"), "names the override file");
  assert.ok(d.message.includes("demo.gone"), "names the missing slot id");
  assert.ok(d.recovery?.includes("/wf:resolve"), "states a /wf:resolve recovery path");
});

test("a pack slot contribution targeting an undeclared slot fails loudly, naming the capability and slot id", () => {
  // The interface declares only `demo.review`; capx contributes to `demo.gone`.
  const orphanManifest = CAPX_MANIFEST.replace("demo.review replace", "demo.gone replace");
  const { snap } = build({
    [`${CORE}/skills/demo/interface.md`]: DEMO_INTERFACE,
    [`${WS}/caps/capx/manifest.md`]: orphanManifest,
    [`${WS}/caps/capx/hooks/review.md`]: CAPX_BODY,
  });
  const d = snap.diagnostics.find((x) => x.code === "slot/orphaned-contribution");
  assert.ok(d, "expected a slot/orphaned-contribution diagnostic");
  assert.equal(d.severity, "error");
  assert.equal(d.category, "registry-invalid");
  assert.ok(d.message.includes("capx"), "names the contributing capability");
  assert.ok(d.message.includes("demo.gone"), "names the missing slot id");
  assert.ok(d.recovery?.includes("/wf:resolve"), "states a /wf:resolve recovery path");
});

test("a declared slot (contribution + matching interface) produces no orphan diagnostic", () => {
  const { snap } = build(healthyFiles());
  assert.ok(!snap.diagnostics.some((d) => d.code?.startsWith("slot/orphaned")));
});

// ---------------------------------------------------------------------------
// 4. Provenance — per-slot winning source + tier, plus settings presence
// ---------------------------------------------------------------------------

test("provenance records the pack contribution as the winner when no override is present", () => {
  const { snap } = build(healthyFiles());
  const row = snap.slots.find((s) => s.skillPoint === "demo.review");
  assert.ok(row);
  assert.equal(row.tier, "pack-contribution");
  assert.equal(row.winningSource, "capx");
  assert.equal(row.overridePresent, false);
  assert.equal(row.projectOverridePresent, false);
  assert.equal(row.policy, "replace");
  assert.deepEqual(row.contributors, ["capx"]);
});

test("a personal override outranks the pack contribution in provenance", () => {
  const { snap } = build(healthyFiles({ [`${WS}/_local/slots/demo.review.md`]: OVERRIDE_BODY }));
  const row = snap.slots.find((s) => s.skillPoint === "demo.review");
  assert.ok(row);
  assert.equal(row.tier, "local-override");
  assert.equal(row.winningSource, "local-override");
  assert.equal(row.overridePresent, true);
});

test("a committed project override outranks the pack contribution in provenance", () => {
  const { snap } = build(healthyFiles({ [`${WS}/.wf/slots/demo.review.md`]: PROJECT_BODY }));
  const row = snap.slots.find((s) => s.skillPoint === "demo.review");
  assert.ok(row);
  assert.equal(row.tier, "project-override");
  assert.equal(row.winningSource, "project-override");
  assert.equal(row.projectOverridePresent, true);
  assert.equal(row.overridePresent, false, "no personal override is present");
  assert.deepEqual(row.contributors, ["capx"], "the pack contributor is still recorded");
});

test("a personal override outranks a committed project override in provenance", () => {
  const { snap } = build(
    healthyFiles({
      [`${WS}/.wf/slots/demo.review.md`]: PROJECT_BODY,
      [`${WS}/_local/slots/demo.review.md`]: OVERRIDE_BODY,
    }),
  );
  const row = snap.slots.find((s) => s.skillPoint === "demo.review");
  assert.ok(row);
  assert.equal(row.tier, "local-override", "personal content remains highest precedence");
  assert.equal(row.winningSource, "local-override");
  // Both presences are reported, so a reader can see the project tier was masked.
  assert.equal(row.overridePresent, true);
  assert.equal(row.projectOverridePresent, true);
});

test("a committed project override alone produces a provenance row for an uncontributed slot", () => {
  const { snap } = build(healthyFiles({ [`${WS}/.wf/slots/demo.solo.md`]: PROJECT_BODY }));
  const row = snap.slots.find((s) => s.skillPoint === "demo.solo");
  assert.ok(row, "a project override alone mints a provenance row");
  assert.equal(row.tier, "project-override");
  assert.deepEqual(row.contributors, []);
  assert.equal(row.policy, null, "no contributor declares a policy");
});

test("resolve_inspect surfaces per-slot provenance + settings-override presence", () => {
  const files = healthyFiles({
    [`${WS}/_local/profiles/demo.settings.json`]: JSON.stringify({ "review.depth": 4 }),
  });
  const map = new Map<string, string>();
  for (const [k, v] of Object.entries({ [`${WS}/_local/config.md`]: REGISTRY, ...files })) {
    map.set(normalizeSlashes(k), v);
  }
  let cache: ResolverSnapshot | null = null;
  const ports: ResolverServicePorts = {
    workspaceRoot: WS,
    corePluginRoot: CORE,
    resolveFresh: () =>
      resolveSnapshot({ workspaceRoot: WS, corePluginRoot: CORE, io: { readFile: (p) => map.get(normalizeSlashes(p)) ?? null, listFiles: (dir) => {
        const prefix = normalizeSlashes(dir).replace(/\/+$/, "") + "/";
        const names = new Set<string>();
        for (const key of map.keys()) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (!rest.includes("/")) names.add(rest);
        }
        return [...names];
      } }, pluginListRaw: "[]", now: NOW, generator: GEN }),
    persist: (snap) => { cache = snap; },
    readCache: () => cache,
    readFile: (p) => map.get(normalizeSlashes(p)) ?? null,
    writeFile: () => {},
    listDirs: () => [],
    listPlugins: () => ({ plugins: parsePluginList("[]").plugins, ok: true }),
    registryRelPath: () => "_local/config.md",
  };
  const svc = new ResolverService(ports);
  const state = svc.refresh();
  const row = state.slots.find((s) => s.skillPoint === "demo.review");
  assert.ok(row, "resolve_inspect lists the composed slot");
  assert.equal(row.tier, "pack-contribution");
  assert.equal(row.winningSource, "capx");
  assert.deepEqual(state.settingsOverrides, ["demo"]);
});

// ---------------------------------------------------------------------------
// 5. No-thrash regression — zero slot inputs keep a byte-stable snapshot
// ---------------------------------------------------------------------------

test("a project with zero slot contributions and zero overrides keeps a byte-stable snapshot", () => {
  const emptyIO = () => {
    const map = new Map<string, string>([[normalizeSlashes(`${WS}/_local/config.md`), EMPTY_REGISTRY]]);
    return {
      readFile: (p: string) => map.get(normalizeSlashes(p)) ?? null,
      listFiles: () => [] as string[],
    };
  };
  const opts = { workspaceRoot: WS, corePluginRoot: CORE, pluginListRaw: "[]", now: NOW, generator: GEN };
  const a = resolveSnapshot({ ...opts, io: emptyIO() });
  const b = resolveSnapshot({ ...opts, io: emptyIO() });

  // Byte-stable across repeated refreshes (no thrash).
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  // None of the new source kinds appear when there are no slot/settings inputs.
  const kinds = new Set(a.sources.map((s) => s.kind));
  assert.ok(!kinds.has("slot-contribution"));
  assert.ok(!kinds.has("slot-override"));
  assert.ok(!kinds.has("settings-override"));
  // The provenance + settings-override indexes are empty (behavior unchanged).
  assert.deepEqual(a.slots, []);
  assert.deepEqual(a.settingsOverrides, []);
});
