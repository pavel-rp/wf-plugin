// Surface-specific resolver-failure semantics tests (WF-272).
//
// Drives ResolverService over an in-memory ports double to prove the acceptance
// criteria of WF-272:
//   - a broken/unavailable resolution makes a LOCAL-ONLY READ continue
//     best-effort, with diagnostics + a `/wf:resolve` recovery path;
//   - a TRACKER WRITE warns and continues (diagnostics + recovery);
//   - a DELIVERY WRITE blocks BEFORE any mutation (diagnostics + recovery);
//   - the failure path NEVER falls back to folder-walking or environment
//     probing (C008) — no listDirs / listPlugins call, no snapshot mutation;
//   - every failure category (snapshot-missing/malformed, schema-incompatible,
//     fingerprint-unresolvable, cli-unavailable, registry-invalid) is a typed,
//     diagnosable state carrying a recovery hint.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import { categorizeCode, classifyThrow, reactionFor } from "../src/resolver/failure.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import type { ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";

const BASE_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
`;

/** A registry that registers a repo-relative capability whose manifest is
 *  absent from disk — the resolver records it as \`capability/unrecoverable\`
 *  (a registry-invalid failure signal) while still producing a usable snapshot. */
const UNRECOVERABLE_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path               |
|------------|--------------------|
| ghost      | capabilities/ghost |
`;

const PLUGIN_LIST = JSON.stringify([]);

interface Counts {
  resolveFresh: number;
  persist: number;
  writeFile: number;
  listDirs: number;
  listPlugins: number;
}

type PortsDouble = ResolverServicePorts & { counts: Counts; files: Map<string, string> };

/** Ports double whose snapshot build is a supplied function — a test can make it
 *  throw (a hard failure) or return a real snapshot with diagnostics. Every
 *  side-effecting port increments a counter so a fallback probe is observable. */
function makePorts(opts: {
  resolveFresh: (io: { readFile(p: string): string | null }) => ResolverSnapshot;
  config?: string;
  pluginList?: string | null;
  cache?: ResolverSnapshot | null;
}): PortsDouble {
  const files = new Map<string, string>();
  files.set(normalizeSlashes(`${WS}/_local/config.md`), opts.config ?? BASE_CONFIG);
  const counts: Counts = { resolveFresh: 0, persist: 0, writeFile: 0, listDirs: 0, listPlugins: 0 };
  let cache: ResolverSnapshot | null = opts.cache ?? null;
  const io = { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };
  const pluginListRaw = opts.pluginList === undefined ? PLUGIN_LIST : opts.pluginList;

  return {
    counts,
    files,
    workspaceRoot: WS,
    resolveFresh() {
      counts.resolveFresh++;
      return opts.resolveFresh(io);
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
    listDirs() {
      counts.listDirs++;
      return [];
    },
    listPlugins() {
      counts.listPlugins++;
      if (pluginListRaw === null) return { plugins: [], ok: false, contractOk: true, issues: [] };
      const parsed = parsePluginList(pluginListRaw);
      return { plugins: parsed.plugins, ok: true, contractOk: parsed.contractOk, issues: parsed.issues };
    },
    registryRelPath: () => "_local/config.md",
  };
}

/** A real snapshot builder. `pluginList` is passed THROUGH verbatim: a `string`
 *  is real CLI output (incl. `"[]"`), a `null` is an injected CLI-unavailable
 *  signal the engine records as absent — never coalesced to `undefined` (which
 *  would shell out to the real `claude` CLI). */
function healthyBuilder(config = BASE_CONFIG, pluginList: string | null = PLUGIN_LIST) {
  return (io: { readFile(p: string): string | null }) =>
    resolveSnapshot({
      workspaceRoot: WS,
      io,
      pluginListRaw: pluginList,
      now: () => new Date("2026-07-16T00:00:00.000Z"),
      generator: { name: "wf-resolver", version: "0.3.0" },
    });
}

/** A builder that throws with a chosen message (a hard resolution failure). */
function throwingBuilder(message: string) {
  return () => {
    throw new Error(message);
  };
}

const SURFACES = ["local-read", "tracker-write", "delivery-write"] as const;

// --- healthy resolver: every surface continues, nothing degrades -----------

test("a healthy resolver leaves every surface healthy and continuing", () => {
  const ports = makePorts({ resolveFresh: healthyBuilder() });
  const svc = new ResolverService(ports);
  for (const surface of SURFACES) {
    const gate = svc.assessSurface(surface);
    assert.equal(gate.healthy, true, `${surface} healthy`);
    assert.equal(gate.reaction, "continue", `${surface} continues`);
    assert.deepEqual(gate.categories, []);
    assert.deepEqual(gate.diagnostics, []);
    assert.deepEqual(gate.recovery, []);
    assert.equal(gate.probed, false);
  }
});

// --- ACCEPTANCE: the three surface reactions on a broken resolution --------

test("malformed resolution: a LOCAL-ONLY READ continues with diagnostics + recovery", () => {
  const ports = makePorts({ resolveFresh: throwingBuilder("malformed snapshot: unexpected end of JSON input") });
  const svc = new ResolverService(ports);
  const gate = svc.assessSurface("local-read");
  assert.equal(gate.reaction, "continue");
  assert.equal(gate.healthy, false);
  assert.ok(gate.categories.includes("snapshot-malformed"), "categorized as snapshot-malformed");
  assert.ok(gate.diagnostics.length > 0, "surfaces diagnostics");
  assert.ok(gate.recovery.length > 0, "surfaces recovery");
  assert.ok(gate.recovery.some((r) => r.includes("/wf:resolve")), "recovery names a /wf:resolve action");
});

test("malformed resolution: a TRACKER WRITE warns and continues with diagnostics + recovery", () => {
  const ports = makePorts({ resolveFresh: throwingBuilder("malformed snapshot: parse error") });
  const svc = new ResolverService(ports);
  const gate = svc.assessSurface("tracker-write");
  assert.equal(gate.reaction, "warn");
  assert.equal(gate.healthy, false);
  assert.ok(gate.diagnostics.length > 0);
  assert.ok(gate.recovery.some((r) => r.includes("/wf:resolve")));
  // A warn never mutates anything.
  assert.equal(ports.counts.persist, 0);
  assert.equal(ports.counts.writeFile, 0);
});

test("malformed resolution: a DELIVERY WRITE blocks BEFORE any mutation, with diagnostics + recovery", () => {
  const ports = makePorts({ resolveFresh: throwingBuilder("malformed snapshot: corrupt cache") });
  const svc = new ResolverService(ports);
  const gate = svc.assessSurface("delivery-write");
  assert.equal(gate.reaction, "block");
  assert.equal(gate.healthy, false);
  assert.ok(gate.diagnostics.length > 0);
  assert.ok(gate.recovery.some((r) => r.includes("/wf:resolve")));
  // BLOCK means no mutation happened while assessing.
  assert.equal(ports.counts.persist, 0, "no snapshot persisted");
  assert.equal(ports.counts.writeFile, 0, "no file written");
});

// --- ACCEPTANCE (C008): NO fallback to folder / environment probing --------

test("the failure path never re-walks folders or probes the environment (C008)", () => {
  const ports = makePorts({ resolveFresh: throwingBuilder("resolution failed hard") });
  const svc = new ResolverService(ports);

  for (const surface of SURFACES) {
    const gate = svc.assessSurface(surface);
    assert.equal(gate.probed, false, `${surface}: probed marker is false`);
  }

  // The whole point of C008: a known-broken path surfaces diagnostics + recovery
  // instead of silently re-walking folders (listDirs) or probing the CLI/env
  // (listPlugins). Neither is EVER called on the failure path.
  assert.equal(ports.counts.listDirs, 0, "no folder walk as a fallback");
  assert.equal(ports.counts.listPlugins, 0, "no CLI/environment probe as a fallback");
  // A single build attempt per assess (the one legitimate discovery) — no retry
  // loop. Three assessSurface calls → at most three build attempts.
  assert.ok(ports.counts.resolveFresh <= SURFACES.length, "no discovery retry loop");
});

// --- category coverage: every taxonomy member is diagnosable ---------------

test("cli-unavailable is a diagnosable category from a real snapshot; delivery blocks, read continues", () => {
  // A buildable snapshot, but `claude plugin list --json` was unavailable — the
  // snapshot carries the plugin-list/cli-unavailable diagnostic.
  const ports = makePorts({ resolveFresh: healthyBuilder(BASE_CONFIG, null), pluginList: null });
  const svc = new ResolverService(ports);

  const delivery = svc.assessSurface("delivery-write");
  assert.ok(delivery.categories.includes("cli-unavailable"), "cli-unavailable categorized");
  assert.equal(delivery.reaction, "block");
  assert.ok(delivery.recovery.some((r) => r.includes("/wf:resolve")));

  const read = svc.assessSurface("local-read");
  assert.equal(read.reaction, "continue", "a read still continues under cli-unavailable");
  assert.ok(read.categories.includes("cli-unavailable"));
});

test("registry-invalid is a diagnosable category from an unrecoverable capability", () => {
  const ports = makePorts({
    resolveFresh: healthyBuilder(UNRECOVERABLE_CONFIG),
    config: UNRECOVERABLE_CONFIG,
  });
  const svc = new ResolverService(ports);
  const gate = svc.assessSurface("delivery-write");
  assert.ok(gate.categories.includes("registry-invalid"), "capability/unrecoverable → registry-invalid");
  assert.equal(gate.reaction, "block");
  assert.ok(gate.diagnostics.some((d) => d.code === "capability/unrecoverable" && !!d.recovery));
});

test("schema-incompatible and fingerprint-unresolvable are classified from a hard failure", () => {
  const schema = new ResolverService(
    makePorts({ resolveFresh: throwingBuilder("snapshot schemaVersion 99 is incompatible with this runtime") }),
  ).assessSurface("delivery-write");
  assert.ok(schema.categories.includes("schema-incompatible"));

  const fp = new ResolverService(
    makePorts({ resolveFresh: throwingBuilder("recorded source could not be re-read: fingerprint unresolvable") }),
  ).assessSurface("delivery-write");
  assert.ok(fp.categories.includes("fingerprint-unresolvable"));
});

test("snapshot-missing is the classification when no snapshot can be produced", () => {
  const ports = makePorts({ resolveFresh: throwingBuilder("resolution unavailable") });
  const gate = new ResolverService(ports).assessSurface("local-read");
  assert.ok(gate.categories.includes("snapshot-missing"));
  assert.ok(gate.recovery.some((r) => r.includes("/wf:resolve refresh")));
});

// --- unit-level guards on the pure classification helpers ------------------

test("categorizeCode maps known codes and returns null for non-failure notes", () => {
  assert.equal(categorizeCode("plugin-list/cli-unavailable"), "cli-unavailable");
  assert.equal(categorizeCode("capability/unrecoverable"), "registry-invalid");
  assert.equal(categorizeCode("schema/incompatible"), "schema-incompatible");
  assert.equal(categorizeCode("profile/unparseable"), "registry-invalid");
  assert.equal(categorizeCode("fingerprint/unreadable"), "fingerprint-unresolvable");
  assert.equal(categorizeCode("provider-config/deferred"), null);
});

test("reactionFor reproduces the surface policy; classifyThrow always yields a category", () => {
  assert.equal(reactionFor("local-read", false), "continue");
  assert.equal(reactionFor("tracker-write", false), "warn");
  assert.equal(reactionFor("delivery-write", false), "block");
  assert.equal(reactionFor("delivery-write", true), "continue");
  assert.equal(classifyThrow(new Error("anything")).category, "snapshot-missing");
});
