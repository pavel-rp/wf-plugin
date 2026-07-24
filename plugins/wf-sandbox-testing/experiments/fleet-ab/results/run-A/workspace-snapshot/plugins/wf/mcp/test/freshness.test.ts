// Freshness + resolver-owned invalidation contract tests (WF-271).
//
// Asserts the WF-271 acceptance criteria over the pure freshness evaluator and
// the service's query-time backstop:
//   - a registered capability/manifest change, a registry edit, a plugin
//     add/remove/enable/disable, and an explicit invalidate each cause a
//     deterministic next-request refresh;
//   - unchanged inputs reuse the snapshot WITHOUT walking capability folders
//     (the hot path never lists a directory and never rebuilds);
//   - freshness is fingerprint-driven only — there is NO elapsed-time / TTL path
//     (a differing generatedAt with identical inputs stays fresh);
//   - typed consumers can record suspected-stale reasons, surfaced as diagnostics.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { evaluateFreshness, normalizePluginList } from "../src/resolver/freshness.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import { RESOLVER_GENERATOR, SNAPSHOT_SCHEMA_VERSION } from "../src/resolver/types.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import type { ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";
const INSTALL = "/ws/packs/wf-demo";

const DEMO_MANIFEST = `# demo capability

**Kind:** both

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/thing.ops.md\` | delivery |
`;

const DEMO_FRAGMENT = `# thing fragment\n\nbody, never read into a response.\n`;

const BASE_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
`;

const REGISTERED_CONFIG = `${BASE_CONFIG}
## Capabilities

| Capability | Path |
|------------|------|
| demo | plugin:wf-demo/capabilities/demo |

## Plugin Roots

| Plugin | Root |
|--------|------|
| wf-demo | ${INSTALL} |
`;

const PLUGIN_LIST = JSON.stringify([
  { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: true, installPath: INSTALL },
]);

/** In-memory ports whose file map + plugin-list are mutable, so a change on disk
 *  is visible to the next resolveFresh — real freshness behaviour. Counts every
 *  side effect so a test can prove the hot path neither walks nor rebuilds. */
function makePorts(opts?: { pluginList?: string | null; files?: Record<string, string> }) {
  const files = new Map<string, string>();
  const seed: Record<string, string> = {
    [`${WS}/_local/config.md`]: REGISTERED_CONFIG,
    [`${INSTALL}/capabilities/demo/manifest.md`]: DEMO_MANIFEST,
    [`${INSTALL}/capabilities/demo/fragments/thing.ops.md`]: DEMO_FRAGMENT,
    ...(opts?.files ?? {}),
  };
  for (const [k, v] of Object.entries(seed)) files.set(normalizeSlashes(k), v);

  const counts = { resolveFresh: 0, persist: 0, writeFile: 0, listDirs: 0, readFile: 0 };
  let cache: ResolverSnapshot | null = null;
  let pluginListRaw = opts?.pluginList === undefined ? PLUGIN_LIST : opts.pluginList;
  const io = { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };

  const ports: ResolverServicePorts & {
    counts: typeof counts;
    files: Map<string, string>;
    setPluginList: (raw: string | null) => void;
  } = {
    counts,
    files,
    setPluginList: (raw) => {
      pluginListRaw = raw;
    },
    workspaceRoot: WS,
    resolveFresh() {
      counts.resolveFresh++;
      return resolveSnapshot({
        workspaceRoot: WS,
        io,
        // Pass the injected override through as `string | null` — a `null` here is
        // an explicit "CLI unavailable" signal honored deterministically by the
        // resolver, NOT coerced to `undefined` (which would shell out to the real
        // `claude plugin list --json`).
        pluginListRaw,
        now: () => new Date("2026-07-16T00:00:00.000Z"),
        generator: { ...RESOLVER_GENERATOR },
      });
    },
    persist(snap) {
      counts.persist++;
      cache = snap;
    },
    readCache: () => cache,
    readFile(p) {
      counts.readFile++;
      return files.get(normalizeSlashes(p)) ?? null;
    },
    writeFile(p, content) {
      counts.writeFile++;
      files.set(normalizeSlashes(p), content);
    },
    listDirs(dir) {
      counts.listDirs++;
      const prefix = normalizeSlashes(dir).replace(/\/+$/, "") + "/";
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const seg = rest.split("/")[0];
        if (seg && rest.includes("/")) names.add(seg);
      }
      return [...names];
    },
    listPlugins: () =>
      pluginListRaw === null
        ? { plugins: [], ok: false }
        : { plugins: parsePluginList(pluginListRaw).plugins, ok: true },
    registryRelPath: () => "_local/config.md",
  };
  return ports;
}

function snapshotFor(ports: ReturnType<typeof makePorts>): ResolverSnapshot {
  return ports.resolveFresh();
}

// --- pure evaluator: unchanged inputs are fresh ---------------------------

test("unchanged inputs are fresh (no reasons)", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);
  const res = evaluateFreshness(snap, WS, {
    readFile: (p) => ports.readFile(p),
    pluginListRaw: PLUGIN_LIST,
    generatorVersion: RESOLVER_GENERATOR.version,
  });
  assert.equal(res.fresh, true);
  assert.deepEqual(res.reasons, []);
});

// --- pure evaluator: each input change is detected ------------------------

test("a registry edit makes the snapshot stale", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);
  ports.files.set(normalizeSlashes(`${WS}/_local/config.md`), REGISTERED_CONFIG + "\n<!-- edit -->\n");
  const res = evaluateFreshness(snap, WS, { readFile: (p) => ports.readFile(p) });
  assert.equal(res.fresh, false);
  assert.ok(res.reasons.some((r) => r.code === "registry/changed"));
});

test("a registered capability's manifest change makes the snapshot stale", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);
  // sanity: the manifest was recorded as a source.
  assert.ok(snap.sources.some((s) => s.kind === "manifest"));
  ports.files.set(
    normalizeSlashes(`${INSTALL}/capabilities/demo/manifest.md`),
    DEMO_MANIFEST + "\narticle: new-rule = required\n",
  );
  const res = evaluateFreshness(snap, WS, { readFile: (p) => ports.readFile(p) });
  assert.equal(res.fresh, false);
  assert.ok(res.reasons.some((r) => r.code === "manifest/changed"));
});

test("a removed source (manifest deleted) makes the snapshot stale", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);
  ports.files.delete(normalizeSlashes(`${INSTALL}/capabilities/demo/manifest.md`));
  const res = evaluateFreshness(snap, WS, { readFile: (p) => ports.readFile(p) });
  assert.equal(res.fresh, false);
  assert.ok(res.reasons.some((r) => r.code === "manifest/changed" && /removed/.test(r.message)));
});

test("a profile change makes the snapshot stale", () => {
  const profilePath = `${WS}/_local/profiles/demo.profile.json`;
  const ports = makePorts({ files: { [profilePath]: '{"a":1}' } });
  const snap = snapshotFor(ports);
  assert.ok(snap.sources.some((s) => s.kind === "profile"));
  ports.files.set(normalizeSlashes(profilePath), '{"a":2}');
  const res = evaluateFreshness(snap, WS, { readFile: (p) => ports.readFile(p) });
  assert.equal(res.fresh, false);
  assert.ok(res.reasons.some((r) => r.code === "profile/changed"));
});

test("an incompatible schema version is stale", () => {
  const ports = makePorts();
  const snap = { ...snapshotFor(ports), schemaVersion: SNAPSHOT_SCHEMA_VERSION + 999 };
  const res = evaluateFreshness(snap, WS, { readFile: (p) => ports.readFile(p) });
  assert.equal(res.fresh, false);
  assert.ok(res.reasons.some((r) => r.code === "schema/incompatible"));
});

test("a resolver runtime upgrade (generator version change) is stale", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);
  const res = evaluateFreshness(snap, WS, {
    readFile: (p) => ports.readFile(p),
    generatorVersion: "999.0.0",
  });
  assert.equal(res.fresh, false);
  assert.ok(res.reasons.some((r) => r.code === "resolver/version-changed"));
});

// --- plugin inventory: add/remove/enable/disable --------------------------

test("a plugin add/remove/enable/disable is detected via the normalized plugin list", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);

  const added = JSON.stringify([
    { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: true, installPath: INSTALL },
    { id: "wf-extra@local", version: "0.1.0", scope: "user", enabled: true, installPath: "/ws/packs/wf-extra" },
  ]);
  const disabled = JSON.stringify([
    { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: false, installPath: INSTALL },
  ]);
  const removed = JSON.stringify([]);

  for (const raw of [added, disabled, removed]) {
    const res = evaluateFreshness(snap, WS, { readFile: (p) => ports.readFile(p), pluginListRaw: raw });
    assert.equal(res.fresh, false, `inventory change should be stale for ${raw}`);
    assert.ok(res.reasons.some((r) => r.code === "plugin-list/changed"));
  }
});

test("a cosmetic plugin-list reorder does NOT churn the snapshot (normalized)", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);
  const reordered = JSON.stringify([
    // same single record, but re-serialized with keys in a different order
    { installPath: INSTALL, enabled: true, scope: "user", version: "1.2.3", id: "wf-demo@local" },
  ]);
  const res = evaluateFreshness(snap, WS, {
    readFile: (p) => ports.readFile(p),
    pluginListRaw: reordered,
  });
  assert.equal(res.fresh, true);
});

test("normalizePluginList is order-independent and preserves absence", () => {
  const a = normalizePluginList(
    JSON.stringify([
      { id: "b@m", version: "1", scope: "s", enabled: true, installPath: "/b" },
      { id: "a@m", version: "1", scope: "s", enabled: true, installPath: "/a" },
    ]),
  );
  const b = normalizePluginList(
    JSON.stringify([
      { id: "a@m", version: "1", scope: "s", enabled: true, installPath: "/a" },
      { id: "b@m", version: "1", scope: "s", enabled: true, installPath: "/b" },
    ]),
  );
  assert.equal(a, b);
  assert.equal(normalizePluginList(null), null);
});

test("normalizePluginList falls back to raw on a PARTIAL contract break (drift not masked)", () => {
  // Two records, one missing the required `version` field: a partial CLI-schema
  // drift. The valid subset must NOT become the projection — that would silently
  // shrink the inventory to a smaller-but-healthy set and hide the drift.
  const partiallyBroken = JSON.stringify([
    { id: "a@m", version: "1", scope: "s", enabled: true, installPath: "/a" },
    { id: "b@m", scope: "s", enabled: true, installPath: "/b" }, // missing `version`
  ]);
  // The raw is fingerprinted verbatim, not the valid subset.
  assert.equal(normalizePluginList(partiallyBroken), partiallyBroken);
  // And it is distinct from what the (buggy) subset-projection would produce.
  const validSubsetOnly = JSON.stringify([
    { id: "a@m", version: "1", scope: "s", enabled: true, installPath: "/a" },
  ]);
  assert.notEqual(normalizePluginList(partiallyBroken), normalizePluginList(validSubsetOnly));
});

test("a partially contract-broken plugin list is treated as drift, not silently normalized", () => {
  const ports = makePorts();
  // Recorded snapshot: the healthy single-plugin PLUGIN_LIST.
  const snap = snapshotFor(ports);
  // Now the CLI returns two records, one drifted (missing `version`). The valid
  // subset is exactly the recorded single plugin — so masking the break to that
  // subset would falsely read as FRESH. Falling back to raw makes it stale.
  const partiallyBroken = JSON.stringify([
    { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: true, installPath: INSTALL },
    { id: "wf-extra@local", scope: "user", enabled: true, installPath: "/ws/packs/wf-extra" }, // missing `version`
  ]);
  const res = evaluateFreshness(snap, WS, {
    readFile: (p) => ports.readFile(p),
    pluginListRaw: partiallyBroken,
  });
  assert.equal(res.fresh, false, "a partial contract break must not be masked to the valid subset");
  assert.ok(res.reasons.some((r) => r.code === "plugin-list/changed"));
});

// --- NO TTL / elapsed-time path -------------------------------------------

test("freshness ignores generatedAt entirely — no elapsed-time validity path", () => {
  const ports = makePorts();
  const snap = snapshotFor(ports);
  // A snapshot stamped in the distant past with identical inputs is still fresh:
  // validity is fingerprint-driven only, never time-driven.
  const ancient = { ...snap, generatedAt: "1999-01-01T00:00:00.000Z" };
  const res = evaluateFreshness(ancient, WS, {
    readFile: (p) => ports.readFile(p),
    pluginListRaw: PLUGIN_LIST,
  });
  assert.equal(res.fresh, true);
});

// --- service: query-time backstop -----------------------------------------

test("service: unchanged inputs reuse the snapshot with NO folder walk and NO rebuild", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);

  // Warm the view once (cold build).
  svc.resolveConfig();
  assert.equal(ports.counts.resolveFresh, 1);

  const listBefore = ports.counts.listDirs;
  const freshBefore = ports.counts.resolveFresh;

  // Many subsequent read queries: each re-validates fingerprints (readFile) but
  // never lists a directory and never rebuilds.
  svc.resolveRegistry();
  svc.resolveProvider("delivery");
  svc.resolveProfile("demo");
  svc.resolvePluginRoot("wf-demo");
  svc.resolveConfig();

  assert.equal(ports.counts.resolveFresh, freshBefore, "hot path must not rebuild");
  assert.equal(ports.counts.listDirs, listBefore, "hot path must not walk capability folders");
  assert.ok(ports.counts.readFile > 0, "freshness re-reads recorded source files");
});

test("service: a registry change on disk triggers a deterministic next-request refresh", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveRegistry();
  assert.equal(ports.counts.resolveFresh, 1);

  // Edit the registry file (as an init/write would).
  ports.files.set(normalizeSlashes(`${WS}/_local/config.md`), REGISTERED_CONFIG + "\n<!-- edit -->\n");

  // The very next query rebuilds — no elapsed time involved.
  svc.resolveRegistry();
  assert.equal(ports.counts.resolveFresh, 2);
  // And a further unchanged query reuses again (back to steady state).
  svc.resolveConfig();
  assert.equal(ports.counts.resolveFresh, 2);
});

test("service: a manifest change on disk triggers a deterministic next-request refresh", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveRegistry();
  const before = ports.counts.resolveFresh;

  ports.files.set(
    normalizeSlashes(`${INSTALL}/capabilities/demo/manifest.md`),
    DEMO_MANIFEST + "\narticle: added = required\n",
  );
  svc.resolveRegistry();
  assert.equal(ports.counts.resolveFresh, before + 1);
});

test("service: explicit invalidate records typed reasons and forces the next query to rebuild", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveConfig();
  const before = ports.counts.resolveFresh;

  const life = svc.invalidate([{ code: "suspected-stale", message: "init just wrote config" }]);
  assert.equal(life.valid, false);
  assert.ok(
    life.diagnostics.some(
      (d) => d.code === "freshness/suspected-stale" && /init just wrote config/.test(d.message),
    ),
    "typed suspected-stale reason surfaces as a diagnostic",
  );

  // Next query rebuilds.
  svc.resolveRegistry();
  assert.equal(ports.counts.resolveFresh, before + 1);
  assert.equal(svc.inspect().valid, true);
});

test("service: refresh reason is surfaced as a diagnostic on the fresh view", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const life = svc.refresh([{ code: "explicit-request", message: "pack registered" }]);
  assert.equal(life.valid, true);
  assert.ok(life.diagnostics.some((d) => d.code === "freshness/explicit-request"));
});

test("service: a cold cache from a previous session is validated before reuse", () => {
  // Simulate a persisted cache written by a prior process, then an input change.
  const ports = makePorts();
  const prior = snapshotFor(ports); // resolveFresh #1
  ports.persist(prior); // seed the cache
  ports.counts.resolveFresh = 0; // reset to isolate the service's behaviour

  const svc = new ResolverService(ports);
  // Change an input BEFORE the first query, so the cached snapshot is stale.
  ports.files.set(normalizeSlashes(`${WS}/_local/config.md`), REGISTERED_CONFIG + "\n<!-- later -->\n");

  // The first query must NOT blindly trust the cache — it revalidates + rebuilds.
  svc.resolveConfig();
  assert.equal(ports.counts.resolveFresh, 1, "stale cold cache is rebuilt, not trusted");
});

// --- null plugin-list injection is honored deterministically ---------------

test("a null pluginListRaw injection is honored as CLI-unavailable (no real CLI shell-out)", () => {
  // A test injecting `null` models "the `claude` CLI was unavailable". The
  // resolver must record the plugin-list source as ABSENT and emit the
  // cli-unavailable diagnostic — deterministically, WITHOUT falling through to
  // the real `claude plugin list --json`. (`??` would coerce null→undefined and
  // shell out; the resolver distinguishes an omitted override from an injected
  // null.)
  const ports = makePorts({ pluginList: null });
  const snap = snapshotFor(ports);

  const pluginSource = snap.sources.find((s) => s.kind === "plugin-list");
  assert.ok(pluginSource, "the plugin-list source is always recorded");
  assert.equal(pluginSource?.present, false, "an injected null is recorded as an ABSENT source");

  assert.ok(
    snap.diagnostics.some((d) => d.code === "plugin-list/cli-unavailable"),
    "a null injection surfaces the CLI-unavailable diagnostic, not a real shell-out",
  );
});
