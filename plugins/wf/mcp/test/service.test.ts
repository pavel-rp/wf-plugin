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
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { resolveContainedRegistryWritePath } from "../src/ports.js";
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
  registryPath?: string;
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
        generator: { name: "wf-resolver", version: "0.3.0" },
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
    registryRelPath: () => opts?.registryPath ?? "_local/config.md",
  };
}

// --- discovery routing / no duplication -----------------------------------

test("read queries share ONE discovery — no per-call rediscovery", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveConfig();
  svc.resolveRegistry();
  svc.resolveProvider("delivery");
  const routed = svc.resolveRouting({
    role: "classify",
    shapeEvidence: {
      workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
      ambiguity: "bounded", risk: "low", toolWork: "bounded", validation: "judgment",
      contextIsolation: "useful", independentReview: false,
      returnContract: "mechanically-judgeable", requestedParallelism: 1,
    },
    supportsModelSelector: true,
    supportsEffortSelector: false,
    basis: "service-cache-basis",
  });
  assert.equal(routed.executionShape, "isolated");
  assert.equal(routed.model.value, "haiku");
  const escalated = svc.resolveRouting({
    role: "classify",
    shapeEvidence: routed.normalizedEvidence,
    supportsModelSelector: true,
    supportsEffortSelector: false,
    availableModels: ["claude-haiku-4-5", "claude-sonnet-4-6"],
    basis: "service-cache-basis",
    postAttempt: {
      sufficient: false,
      signals: ["low-confidence"],
      prior: {
        role: routed.role,
        attempt: 1,
        executionShape: routed.executionShape,
        shapeEvidence: routed.normalizedEvidence,
        unitIds: routed.unitIds,
        model: routed.model,
        effort: routed.effort,
        basis: routed.basis,
        escalationOrigin: null,
        actualModel: "claude-haiku-4-5",
      },
    },
  });
  assert.equal(escalated.disposition, "retry");
  assert.equal(escalated.model.value, "sonnet");
  assert.equal(escalated.basis, "service-cache-basis");
  const incomplete = svc.resolveRouting({
    role: "classify",
    shapeEvidence: { workSurface: "caller-context" },
    supportsModelSelector: true,
    supportsEffortSelector: false,
  } as unknown as Parameters<typeof svc.resolveRouting>[0]);
  assert.equal(incomplete.status, "stop");
  assert.match(incomplete.diagnostic ?? "", /atomicity must be one of/);
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

test("register_pack rejects invalid registryPath shapes without writing", () => {
  const cases = [
    ["../outside.md", /\.\.' segment/],
    ["/outside.md", /absolute path/],
    ["C:/outside.md", /drive-prefixed path/],
    ["_local\\config.md", /backslash/],
  ] as const;

  for (const [registryPath, reason] of cases) {
    const ports = makePorts({ registryPath });
    const svc = new ResolverService(ports);
    const inspected = svc.inspectPack("wf-demo@local");
    const registered = svc.registerPack("wf-demo@local", inspected.fingerprint!);
    assert.equal(registered.status, "rejected", registryPath);
    assert.match(registered.reason ?? "", reason, registryPath);
    assert.equal(ports.counts.writeFile, 0, registryPath);
  }
});

test("register_pack rejects a symlink escape before mutation", () => {
  const fixture = mkdtempSync(join(tmpdir(), "wf-registry-containment-"));
  try {
    const workspace = join(fixture, "workspace");
    const outside = join(fixture, "outside");
    mkdirSync(workspace);
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, "linked"), "junction");

    const ports = makePorts({ registryPath: "linked/config.md" });
    ports.resolveRegistryWritePath = (registryPath) =>
      resolveContainedRegistryWritePath(workspace, registryPath);
    const svc = new ResolverService(ports);
    const inspected = svc.inspectPack("wf-demo@local");
    const registered = svc.registerPack("wf-demo@local", inspected.fingerprint!);
    assert.equal(registered.status, "rejected");
    assert.match(registered.reason ?? "", /escapes the selected workspace/);
    assert.equal(ports.counts.writeFile, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
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

// --- WF-319: composite <-> bare qa-execution surface resolution -----------

const ENGINE_MANIFEST = `# engine-cap capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| qa-execution | provider | \`subagent: wf-browser-qa:qa-engine\` | engine |
`;

const HOST_MANIFEST = `# host-cap capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| qa-execution | provider | \`subagent: wf-angular:qa-host\` | host |
`;

const ENGINE_HOST_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path |
|------------|------|
| engine-cap | capabilities/engine-cap |
| host-cap   | capabilities/host-cap |
`;

/** A ports double with `engine-cap` / `host-cap` pre-registered (repo-relative
 *  paths — no plugin/install indirection needed) so resolveProvider can be
 *  exercised against a real owner without going through register_pack. */
function makeEngineHostPorts() {
  return makePorts({
    files: {
      [`${WS}/_local/config.md`]: ENGINE_HOST_CONFIG,
      [`${WS}/capabilities/engine-cap/manifest.md`]: ENGINE_MANIFEST,
      [`${WS}/capabilities/host-cap/manifest.md`]: HOST_MANIFEST,
    },
  });
}

test("resolve_provider: composite qa-execution:engine resolves identically to bare engine", () => {
  const ports = makeEngineHostPorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  const composite = svc.resolveProvider("qa-execution:engine");
  const bare = svc.resolveProvider("engine");
  assert.equal(composite.owner, "engine-cap");
  assert.equal(composite.state, "ok");
  assert.equal(composite.degradation, "ok");
  assert.equal(bare.owner, "engine-cap");
  assert.equal(bare.state, "ok");
  assert.equal(bare.degradation, "ok");
  assert.equal(composite.owner, bare.owner);
  assert.equal(composite.state, bare.state);
  assert.equal(composite.degradation, bare.degradation);
  assert.equal(composite.fragmentPath, bare.fragmentPath);
});

test("resolve_provider: composite qa-execution:host resolves identically to bare host", () => {
  const ports = makeEngineHostPorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  const composite = svc.resolveProvider("qa-execution:host");
  const bare = svc.resolveProvider("host");
  assert.equal(composite.owner, "host-cap");
  assert.equal(composite.state, "ok");
  assert.equal(composite.degradation, "ok");
  assert.equal(bare.owner, "host-cap");
  assert.equal(bare.state, "ok");
  assert.equal(bare.degradation, "ok");
  assert.equal(composite.owner, bare.owner);
  assert.equal(composite.state, bare.state);
  assert.equal(composite.degradation, bare.degradation);
  assert.equal(composite.fragmentPath, bare.fragmentPath);
});

test("resolve_provider: bare delivery/tracker/engine/host still resolve as before (regression guard)", () => {
  // Bare delivery/tracker on an unowned registry (existing behaviour, untouched).
  const bareOnly = makePorts();
  const svcBare = new ResolverService(bareOnly);
  svcBare.refresh();
  assert.equal(svcBare.resolveProvider("delivery").state, "unconfigured");
  assert.equal(svcBare.resolveProvider("delivery").degradation, "delivery-block");
  assert.equal(svcBare.resolveProvider("tracker").state, "unconfigured");
  assert.equal(svcBare.resolveProvider("tracker").degradation, "tracker-warn");

  // Bare engine/host on a registry where they ARE owned — the documented
  // workaround this fix must not regress.
  const ports = makeEngineHostPorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  assert.equal(svc.resolveProvider("engine").owner, "engine-cap");
  assert.equal(svc.resolveProvider("engine").state, "ok");
  assert.equal(svc.resolveProvider("host").owner, "host-cap");
  assert.equal(svc.resolveProvider("host").state, "ok");
});

test("resolve_provider: genuine no-owner qa-execution:engine returns unconfigured with engine-block degradation", () => {
  const ports = makePorts(); // default fixture — no engine/host capability registered
  const svc = new ResolverService(ports);
  svc.refresh();
  const composite = svc.resolveProvider("qa-execution:engine");
  assert.equal(composite.state, "unconfigured");
  assert.equal(composite.owner, null);
  assert.equal(composite.degradation, "engine-block");
  const bare = svc.resolveProvider("engine");
  assert.equal(bare.state, "unconfigured");
  assert.equal(bare.degradation, "engine-block");
});

test("resolve_provider: unrecognized surface token throws a distinct signal, not state:unconfigured", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  assert.throws(() => svc.resolveProvider("qa-exec:engine"), /unknown surface/);
  assert.throws(() => svc.resolveProvider("bogus"), /unknown surface/);
});
