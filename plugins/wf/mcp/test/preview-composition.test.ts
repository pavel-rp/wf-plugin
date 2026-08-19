// WF-354 — the dry-run composition preview.
//
// Two things are proved here.
//
// 1. SC-4: with capabilities registered, the preview lists every fragment that
//    would fire, in REGISTRY ORDER, each carrying its provenance — and the call
//    is READ-ONLY. `service.ensure()` legitimately rebuilds and persists a cold
//    or stale snapshot; that write is resolution, not the preview. So the
//    snapshot is WARMED first, then the registry file and the persisted snapshot
//    are byte-compared across the `previewComposition` call. The assertion is
//    that the preview adds no write of its own.
// 2. SC-5: an empty `## Capabilities` table is a first-class INERT outcome —
//    zero entries, no error status. A project that registers nothing composes
//    nothing, which is the contract's designed behaviour, not a fault.
//
// There is deliberately no agreement suite: no shell guard owns the composition
// question, so there is nothing to agree with.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import { previewComposition } from "../src/resolver/preview-composition.js";
import { RESOLVER_GENERATOR, type ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";

const CONFIG_HEADER = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
`;

/** Two vendored capabilities, in a deliberate registry order: `alpha` first
 *  (general), `beta` second (specific). Registry order IS injection order. */
const CONFIG_TWO_CAPS = `${CONFIG_HEADER}
## Capabilities

| Capability | Path |
|------------|------|
| alpha | caps/alpha |
| beta  | caps/beta  |
`;

const CONFIG_EMPTY_CAPS = `${CONFIG_HEADER}
## Capabilities

| Capability | Path |
|------------|------|
`;

const ALPHA_MANIFEST = `# alpha capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| verify | finding | \`inline: fragments/alpha-verify.ops.md\` | — |
| spec | guidance | \`inline: fragments/alpha-spec.ops.md\` | — |
`;

const BETA_MANIFEST = `# beta capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| verify | finding | \`subagent: beta-auditor\` | — |
| qa-execution | provider | \`inline: fragments/beta-engine.ops.md\` | engine |
`;

function makePorts(config: string): ResolverServicePorts & {
  counts: { persist: number; writeFile: number };
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  for (const [k, v] of Object.entries({
    [`${WS}/_local/config.md`]: config,
    [`${WS}/caps/alpha/manifest.md`]: ALPHA_MANIFEST,
    [`${WS}/caps/beta/manifest.md`]: BETA_MANIFEST,
  })) {
    files.set(normalizeSlashes(k), v);
  }

  const counts = { persist: 0, writeFile: 0 };
  let cache: ResolverSnapshot | null = null;
  const io = { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };

  return {
    counts,
    files,
    workspaceRoot: WS,
    corePluginRoot: "/core/plugins/wf",
    resolveFresh: () =>
      resolveSnapshot({
        workspaceRoot: WS,
        io,
        pluginListRaw: "[]",
        now: () => new Date("2026-07-19T00:00:00.000Z"),
        generator: RESOLVER_GENERATOR,
      }),
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
    listPlugins: () => ({ plugins: [], ok: true }),
    registryRelPath: () => "_local/config.md",
  };
}

// ---------------------------------------------------------------------------
// SC-4 — registry order, provenance, and read-only
// ---------------------------------------------------------------------------

test("SC-4: every fragment that would fire is listed, in registry order, with provenance", () => {
  const svc = new ResolverService(makePorts(CONFIG_TWO_CAPS));
  const preview = svc.previewComposition();

  assert.equal(preview.tool, "preview_composition");
  assert.equal(preview.phase, null, "no filter means every phase");
  assert.equal(preview.capabilitiesConsidered, 2);
  assert.equal(preview.entries.length, 4, "two capabilities contributing two fragments each");

  // Registry order — alpha's rows before beta's, each capability's rows in
  // manifest order. This is the composed (injection) order, general → specific.
  assert.deepEqual(
    preview.entries.map((e) => `${e.capability}:${e.phase}:${e.contributionKind}`),
    ["alpha:verify:finding", "alpha:spec:guidance", "beta:verify:finding", "beta:qa-execution:provider"],
  );
  assert.deepEqual(
    preview.entries.map((e) => e.order),
    [0, 1, 2, 3],
    "order is the composed position, not a per-capability index",
  );

  // Provenance travels with every entry.
  for (const e of preview.entries) {
    assert.ok(e.dispatch.length > 0, "the resolved dispatch target is named");
    assert.equal(e.registryPath, `caps/${e.capability}`, "the raw registry Path value");
    assert.ok(e.resolvedPath?.endsWith(`caps/${e.capability}`), `resolvedPath: ${e.resolvedPath}`);
    assert.ok(
      e.manifestPath?.endsWith(`caps/${e.capability}/manifest.md`),
      `manifestPath: ${e.manifestPath}`,
    );
    assert.equal(e.provenance, "recorded");
    assert.equal(e.validity, "ok");
  }

  // Scope is carried where the kind partitions, and null where it does not.
  const engine = preview.entries.find((e) => e.contributionKind === "provider")!;
  assert.equal(engine.scope, "engine");
  assert.equal(preview.entries.find((e) => e.contributionKind === "guidance")!.scope, null);

  // It names the dispatch target but never a fragment BODY.
  assert.ok(!JSON.stringify(preview).includes("ops.md\n"), "no body content is echoed");
});

test("SC-4: an optional phase filters, and omitting it covers every phase", () => {
  const svc = new ResolverService(makePorts(CONFIG_TWO_CAPS));

  const verify = svc.previewComposition("verify");
  assert.equal(verify.phase, "verify");
  assert.deepEqual(verify.entries.map((e) => e.capability), ["alpha", "beta"]);
  assert.deepEqual(verify.phasesCovered, ["verify"]);

  const all = svc.previewComposition();
  assert.deepEqual(all.phasesCovered, ["verify", "spec", "qa-execution"]);

  // A phase nobody contributes to is inert, not an error.
  const plan = svc.previewComposition("plan");
  assert.deepEqual(plan.entries, []);
  assert.equal(plan.phase, "plan");
  assert.ok(!("status" in plan), "a preview carries no pass/fail status (D-4)");
});

test("SC-4: the preview writes nothing — registry file and persisted snapshot are byte-identical across the call", () => {
  const ports = makePorts(CONFIG_TWO_CAPS);
  const svc = new ResolverService(ports);

  // Warm the snapshot first: ensure()'s cold-cache rebuild+persist is
  // resolution, not the preview, so it must not be counted against it.
  svc.resolveConfig();
  const persistsAfterWarm = ports.counts.persist;
  const writesAfterWarm = ports.counts.writeFile;

  const registryBefore = ports.files.get(normalizeSlashes(`${WS}/_local/config.md`))!;
  const snapshotBefore = JSON.stringify(ports.readCache());

  svc.previewComposition();
  svc.previewComposition("verify");

  const registryAfter = ports.files.get(normalizeSlashes(`${WS}/_local/config.md`))!;
  const snapshotAfter = JSON.stringify(ports.readCache());

  assert.equal(registryBefore, registryAfter, "the registry file is untouched");
  assert.equal(snapshotBefore, snapshotAfter, "the persisted snapshot is untouched");
  assert.equal(ports.counts.persist, persistsAfterWarm, "the preview persisted nothing of its own");
  assert.equal(ports.counts.writeFile, writesAfterWarm, "the preview wrote no file of its own");
});

test("the renderer is pure — the same snapshot renders identically every time", () => {
  const ports = makePorts(CONFIG_TWO_CAPS);
  const snapshot = ports.resolveFresh();
  assert.deepEqual(previewComposition(snapshot), previewComposition(snapshot, null));
  assert.deepEqual(
    previewComposition(snapshot, "verify"),
    previewComposition(snapshot, "  verify  "),
    "a padded phase argument is trimmed, not treated as a different phase",
  );
});

// ---------------------------------------------------------------------------
// SC-5 — an empty registry is inert, not an error
// ---------------------------------------------------------------------------

test("SC-5: an empty ## Capabilities table yields zero entries and no error status", () => {
  const svc = new ResolverService(makePorts(CONFIG_EMPTY_CAPS));
  const preview = svc.previewComposition();

  assert.deepEqual(preview.entries, []);
  assert.equal(preview.capabilitiesConsidered, 0);
  assert.deepEqual(preview.phasesCovered, []);
  assert.ok(!("status" in preview), "there is no status field to set to an error");
  assert.ok(!("findings" in preview), "a preview is not a ValidationVerdict (D-4)");
  assert.match(preview.summary, /inert, not an error/);

  // And the record is still fully formed — the snapshot it was rendered from is
  // reported, so an empty result is distinguishable from a failed one.
  assert.equal(preview.renderedFrom.workspaceRoot, WS);
  assert.equal(preview.renderedFrom.registryPath, "_local/config.md");
  assert.ok(preview.renderedFrom.generatedAt.length > 0);
});

test("SC-5: a phase filter over an empty registry is equally inert", () => {
  const svc = new ResolverService(makePorts(CONFIG_EMPTY_CAPS));
  const preview = svc.previewComposition("verify");
  assert.deepEqual(preview.entries, []);
  assert.equal(preview.phase, "verify");
  assert.match(preview.summary, /nothing would compose at phase `verify`/);
});
