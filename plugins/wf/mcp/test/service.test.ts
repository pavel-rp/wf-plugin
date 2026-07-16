// Typed resolver service contract tests (WF-270).
//
// Drives ResolverService over an in-memory ports double (no real filesystem, no
// `claude` CLI) to assert the WF-270 acceptance criteria:
//   - every command action (inspect/refresh/invalidate + the read queries)
//     routes through the ONE service and does not duplicate discovery;
//   - the public query response/error contract EXCLUDES fragment bodies;
//   - register_pack rejects each invalid case WITHOUT writing, and refreshes the
//     snapshot (making the new capability resolvable) on success.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { normalizeSlashes, joinSlash } from "../src/resolver/paths.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import type { ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";
const INSTALL = "/ws/packs/wf-demo";

const SECRET_MANIFEST = "SECRET_MANIFEST_PROSE_do_not_leak";
const SECRET_FRAGMENT = "SECRET_FRAGMENT_BODY_do_not_leak";

const DEMO_MANIFEST = `# demo capability

**Kind:** both

${SECRET_MANIFEST} — a manifest body paragraph the resolver must never echo.

article: demo-rule = required

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/thing.ops.md\` | delivery |
`;

const DEMO_FRAGMENT = `# thing fragment\n\n${SECRET_FRAGMENT} — never read into any response.\n`;

const BASE_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
`;

const PLUGIN_LIST = JSON.stringify([
  {
    id: "wf-demo@local",
    version: "1.2.3",
    scope: "user",
    enabled: true,
    installPath: INSTALL,
  },
]);

const DISABLED_LIST = JSON.stringify([
  { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: false, installPath: INSTALL },
]);

/** An in-memory ports double whose file map is mutated by writeFile, so a
 *  register write is visible to the next resolveFresh (real refresh behaviour). */
function makePorts(opts?: {
  pluginList?: string | null;
  files?: Record<string, string>;
}): ResolverServicePorts & {
  counts: { resolveFresh: number; persist: number; writeFile: number };
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const seed: Record<string, string> = {
    [`${WS}/_local/config.md`]: BASE_CONFIG,
    [`${INSTALL}/capabilities/demo/manifest.md`]: DEMO_MANIFEST,
    [`${INSTALL}/capabilities/demo/fragments/thing.ops.md`]: DEMO_FRAGMENT,
    ...(opts?.files ?? {}),
  };
  for (const [k, v] of Object.entries(seed)) files.set(normalizeSlashes(k), v);

  const counts = { resolveFresh: 0, persist: 0, writeFile: 0 };
  let cache: ResolverSnapshot | null = null;
  const pluginListRaw = opts?.pluginList === undefined ? PLUGIN_LIST : opts.pluginList;

  const io = { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };

  return {
    counts,
    files,
    workspaceRoot: WS,
    corePluginRoot: "/core/plugins/wf",
    resolveFresh() {
      counts.resolveFresh++;
      return resolveSnapshot({
        workspaceRoot: WS,
        io,
        pluginListRaw: pluginListRaw ?? undefined,
        now: () => new Date("2026-07-16T00:00:00.000Z"),
        generator: { name: "wf-resolver", version: "0.2.0" },
      });
    },
    persist(snap) {
      counts.persist++;
      cache = snap;
    },
    readCache: () => cache,
    readFile: (p) => files.get(normalizeSlashes(p)) ?? null,
    writeFile(p, content) {
      counts.writeFile++;
      files.set(normalizeSlashes(p), content);
    },
    listDirs(dir) {
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
}

// --- discovery routing / no duplication -----------------------------------

test("read queries share ONE discovery — no per-call rediscovery", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveConfig();
  svc.resolveRegistry();
  svc.resolveProvider("delivery");
  svc.resolvePluginRoot("wf-demo");
  assert.equal(ports.counts.resolveFresh, 1, "all read queries resolved from one snapshot");
});

test("inspect reports state without rebuilding; refresh rebuilds; invalidate forces the next query to rebuild", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);

  // Cold inspect: no cache, no build.
  const cold = svc.inspect();
  assert.equal(cold.valid, false);
  assert.equal(cold.cached, false);
  assert.equal(ports.counts.resolveFresh, 0);

  // refresh builds once and marks valid.
  const refreshed = svc.refresh();
  assert.equal(refreshed.valid, true);
  assert.equal(ports.counts.resolveFresh, 1);

  // A read query now reuses the refreshed snapshot (still 1 build).
  svc.resolveConfig();
  assert.equal(ports.counts.resolveFresh, 1);

  // invalidate marks it invalid without rebuilding...
  const invalid = svc.invalidate();
  assert.equal(invalid.valid, false);
  assert.equal(ports.counts.resolveFresh, 1);

  // ...and the next query rebuilds (fresh resolved view).
  svc.resolveRegistry();
  assert.equal(ports.counts.resolveFresh, 2);
  assert.equal(svc.inspect().valid, true);
});

// --- fragment-body exclusion ----------------------------------------------

test("no query/inspect response carries a manifest or fragment body", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  // Register so the capability is active and provider ownership is derived.
  const insp = svc.inspectPack("wf-demo@local");
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint!);
  assert.equal(reg.status, "registered");

  const blob = JSON.stringify([
    svc.resolveConfig(),
    svc.resolveRegistry(),
    svc.resolveProvider("delivery"),
    svc.resolveProfile("demo"),
    svc.resolvePluginRoot("wf-demo"),
    svc.inspect(),
    svc.inspectPack("wf-demo@local"),
    reg,
  ]);
  assert.ok(!blob.includes(SECRET_MANIFEST), "manifest body must not leak");
  assert.ok(!blob.includes(SECRET_FRAGMENT), "fragment body must not leak");
  // The dispatch PATH (metadata) is allowed and expected.
  assert.ok(blob.includes("fragments/thing.ops.md"));
});

// --- register_pack: success path ------------------------------------------

test("register_pack writes the registry, refreshes, and self-checks ok", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);

  // Before: the capability is not registered.
  assert.equal(svc.resolveRegistry().capabilities.length, 0);

  const insp = svc.inspectPack("wf-demo@local");
  assert.equal(insp.valid, true);
  assert.equal(insp.capabilities.length, 1);
  assert.equal(insp.capabilities[0].path, "plugin:wf-demo/capabilities/demo");

  const before = ports.counts.resolveFresh;
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint!);
  assert.equal(reg.status, "registered");
  assert.equal(reg.selfCheck, "ok");
  assert.deepEqual(reg.capabilities, ["demo"]);

  // The registry file gained both rows.
  const written = ports.files.get(normalizeSlashes(`${WS}/_local/config.md`))!;
  assert.match(written, /## Plugin Roots/);
  assert.match(written, /wf-demo\s*\|\s*\/ws\/packs\/wf-demo/);
  assert.match(written, /## Capabilities/);
  assert.match(written, /demo\s*\|\s*plugin:wf-demo\/capabilities\/demo/);

  // The snapshot was refreshed (rebuilt) so the capability is now resolvable.
  assert.ok(ports.counts.resolveFresh > before, "register triggered a refresh");
  const view = svc.resolveRegistry();
  assert.ok(view.capabilities.some((c) => c.name === "demo" && c.validity === "ok"));
  const provider = svc.resolveProvider("delivery");
  assert.equal(provider.owner, "demo");
  assert.equal(provider.state, "ok");
});

// --- register_pack: every rejection writes nothing ------------------------

test("register_pack rejects a not-installed pack without writing", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const reg = svc.registerPack("wf-absent@local", "anything");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /not installed/);
  assert.equal(ports.counts.writeFile, 0);
});

test("register_pack rejects a disabled pack without writing", () => {
  const ports = makePorts({ pluginList: DISABLED_LIST });
  const svc = new ResolverService(ports);
  const insp = svc.inspectPack("wf-demo@local");
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint ?? "x");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /disabled/);
  assert.equal(ports.counts.writeFile, 0);
});

test("register_pack rejects a stale fingerprint without writing", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const reg = svc.registerPack("wf-demo@local", "stale-fingerprint-value");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /stale fingerprint/);
  assert.equal(ports.counts.writeFile, 0);
});

test("register_pack rejects a pack with no readable manifest without writing", () => {
  // Pack installed + enabled, but no capabilities/*/manifest.md present.
  const ports = makePorts({
    files: {},
  });
  // Remove the demo manifest so the pack has no valid capability.
  ports.files.delete(normalizeSlashes(`${INSTALL}/capabilities/demo/manifest.md`));
  const svc = new ResolverService(ports);
  const insp = svc.inspectPack("wf-demo@local");
  assert.equal(insp.valid, false);
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint ?? "x");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /path-invalid or manifest-invalid/);
  assert.equal(ports.counts.writeFile, 0);
});

// --- inspect_pack graceful CLI-unavailable --------------------------------

test("inspect_pack reports a CLI-unavailable failure without throwing", () => {
  const ports = makePorts({ pluginList: null });
  const svc = new ResolverService(ports);
  const insp = svc.inspectPack("wf-demo@local");
  assert.equal(insp.installed, false);
  assert.equal(insp.valid, false);
  assert.ok(insp.issues.some((i) => /unavailable/.test(i)));
});

// --- provider degradation for an unowned surface --------------------------

test("resolve_provider on an unowned surface degrades per class (no throw)", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  const delivery = svc.resolveProvider("delivery");
  assert.equal(delivery.state, "unconfigured");
  assert.equal(delivery.degradation, "delivery-block");
  const tracker = svc.resolveProvider("tracker");
  assert.equal(tracker.degradation, "tracker-warn");
});
