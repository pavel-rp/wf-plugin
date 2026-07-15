// End-to-end resolver-engine + snapshot-persistence contract tests.
//
// Drives the engine over a synthetic in-memory workspace (no real filesystem,
// no `claude` CLI) so the four pack states, the body-exclusion invariant, the
// source fingerprints, and the atomic write/read round-trip are all asserted
// deterministically. Uses the `valid.json` plugin-list fixture as the installed
// set: wf-git (enabled+registered → active), wf-audit (enabled+unregistered →
// installed/inactive), wf-linear (disabled → installed/disabled); the registry
// adds `ghost` (registered, not installed → registered/unrecoverable).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { resolveSnapshot } from "../src/resolver/engine.js";
import {
  writeSnapshot,
  readSnapshot,
  snapshotPath,
  SnapshotSchemaError,
} from "../src/resolver/snapshot-store.js";
import { SNAPSHOT_SCHEMA_VERSION, type ResolverSnapshot } from "../src/resolver/types.js";

const FIX = join(process.env.WF_MCP_DIR ?? process.cwd(), "test/fixtures/plugin-list");
const pluginListRaw = readFileSync(join(FIX, "valid.json"), "utf8");

const REGISTRY = `# Skills Configuration

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Build / Verify

| Key | Value |
|-----|-------|
| **Verify Command** | \`npm run typecheck\` |

## Capabilities

| Capability | Path |
|------------|------|
| git   | plugin:wf-git/capabilities/git |
| ghost | plugin:wf-ghost/capabilities/ghost |

## Plugin Roots

| Plugin | Root |
|--------|------|
| wf-git | /ws/vendor/wf-git |
`;

const GIT_MANIFEST = `# git capability manifest

**Kind:** both (ships its own init; also attaches one phase fragment)

SECRET_MANIFEST_PROSE — a whole paragraph of manifest body that is metadata's
neighbour but must never be copied into the snapshot.

article: commit-signing = required

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/delivery.ops.md\` | delivery |
`;

const DELIVERY_FRAGMENT = `# delivery provider fragment

SECRET_FRAGMENT_BODY — this file is READABLE via the IO port, yet the resolver
must never read it into the snapshot (it only records the dispatch path).
`;

function makeIO() {
  const files = new Map<string, string>([
    [normalizeSlashes("/ws/_local/config.md"), REGISTRY],
    [normalizeSlashes("/ws/vendor/wf-git/capabilities/git/manifest.md"), GIT_MANIFEST],
    [
      normalizeSlashes("/ws/vendor/wf-git/capabilities/git/fragments/delivery.ops.md"),
      DELIVERY_FRAGMENT,
    ],
  ]);
  return { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };
}

function buildForTest(): ResolverSnapshot {
  return resolveSnapshot({
    workspaceRoot: "/ws",
    io: makeIO(),
    pluginListRaw,
    now: () => new Date("2026-07-15T00:00:00.000Z"),
    generator: { name: "wf-resolver", version: "0.1.0" },
  });
}

test("a clean project produces a valid snapshot with active + installed/inactive records", () => {
  const snap = buildForTest();
  assert.equal(snap.schemaVersion, SNAPSHOT_SCHEMA_VERSION);

  const byState = (s: string) => snap.packs.filter((p) => p.state === s).map((p) => p.pluginName);
  assert.deepEqual(byState("active"), ["wf-git"]);
  assert.deepEqual(byState("installed/inactive"), ["wf-audit"]);
});

test("all four explicit states are represented distinctly", () => {
  const snap = buildForTest();
  const state = (name: string) => snap.packs.find((p) => p.pluginName === name)?.state;
  assert.equal(state("wf-git"), "active");
  assert.equal(state("wf-audit"), "installed/inactive");
  assert.equal(state("wf-linear"), "installed/disabled");
  assert.equal(state("wf-ghost"), "registered/unrecoverable");
});

test("an installed pack absent from the registry cannot affect composition", () => {
  const snap = buildForTest();
  // wf-audit is installed but not a registry row → not in capabilities[].
  assert.ok(!snap.capabilities.some((c) => c.name === "audit"));
  const audit = snap.packs.find((p) => p.pluginName === "wf-audit");
  assert.equal(audit?.state, "installed/inactive");
  assert.deepEqual(audit?.registeredCapabilities, []);
});

test("registered-but-missing pack is registered/unrecoverable with a diagnosis", () => {
  const snap = buildForTest();
  const ghostCap = snap.capabilities.find((c) => c.name === "ghost");
  assert.equal(ghostCap?.validity, "unrecoverable");
  assert.equal(ghostCap?.manifestPath, null);
  const ghostPack = snap.packs.find((p) => p.pluginName === "wf-ghost");
  assert.equal(ghostPack?.state, "registered/unrecoverable");
  assert.ok(ghostPack?.diagnostics);
  assert.ok(snap.diagnostics.some((d) => d.code === "capability/unrecoverable"));
});

test("the snapshot contains no fragment/skill/prompt/manifest body text", () => {
  const snap = buildForTest();
  const serialized = JSON.stringify(snap);
  assert.ok(!serialized.includes("SECRET_MANIFEST_PROSE"));
  assert.ok(!serialized.includes("SECRET_FRAGMENT_BODY"));
});

test("the active capability resolves to metadata + stable normalized paths", () => {
  const snap = buildForTest();
  const git = snap.capabilities.find((c) => c.name === "git");
  assert.ok(git);
  assert.equal(git.validity, "ok");
  assert.equal(git.provenance, "recorded");
  assert.equal(git.kind, "both");
  // Path is workspace-relative + forward-slash (stable across machines).
  assert.equal(git.manifestPath, "vendor/wf-git/capabilities/git/manifest.md");
  assert.ok(!git.manifestPath.includes("\\"));
  assert.equal(git.fragments.length, 1);
  assert.equal(git.fragments[0].scope, "delivery");
});

test("provider ownership is derived (metadata only, dispatch path recorded)", () => {
  const snap = buildForTest();
  const delivery = snap.providerOwnership.find((o) => o.surface === "delivery");
  assert.ok(delivery);
  assert.equal(delivery.owner, "git");
  assert.equal(delivery.state, "ok");
  assert.equal(delivery.fragmentPath, "vendor/wf-git/capabilities/git/fragments/delivery.ops.md");
});

test("id shape is bare-core with no tracker present (no tracker product named)", () => {
  const snap = buildForTest();
  assert.equal(snap.idShape.source, "bare-core");
  assert.equal(snap.idShape.scheme, "T<NNN>");
});

test("constitution inputs are composed from capability article declarations", () => {
  const snap = buildForTest();
  assert.deepEqual(snap.constitutionInputs, [
    { capability: "git", key: "commit-signing", value: "required" },
  ]);
});

test("the engine reports the precise source inputs (fingerprints) that produced it", () => {
  const snap = buildForTest();
  const kinds = snap.sources.map((s) => s.kind);
  assert.ok(kinds.includes("registry"));
  assert.ok(kinds.includes("plugin-list"));
  assert.ok(kinds.includes("manifest"));

  const registrySrc = snap.sources.find((s) => s.kind === "registry");
  assert.equal(registrySrc?.present, true);
  assert.match(registrySrc?.sha256 ?? "", /^[0-9a-f]{64}$/);

  // wf.config.js is absent (default registry path) — recorded as a present:false fact.
  const wfConfig = snap.sources.find((s) => s.kind === "wf-config");
  assert.equal(wfConfig?.present, false);
  assert.equal(wfConfig?.sha256, null);
});

test("the build is deterministic for identical inputs", () => {
  const a = buildForTest();
  const b = buildForTest();
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("core config values are recorded", () => {
  const snap = buildForTest();
  assert.equal(snap.coreConfig.taskRoot, "_local");
  assert.equal(snap.coreConfig.verifyCommand, "npm run typecheck");
});

// --- persistence ----------------------------------------------------------

test("snapshot persists atomically under _local/ and round-trips", () => {
  const ws = mkdtempSync(join(tmpdir(), "wf-resolver-persist-"));
  try {
    const snap = buildForTest();
    const path = writeSnapshot(ws, snap);
    assert.ok(normalizeSlashes(path).endsWith("_local/resolver/snapshot.json"));
    const readBack = readSnapshot(ws);
    assert.deepEqual(readBack, snap);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("readSnapshot returns null when no cache exists", () => {
  const ws = mkdtempSync(join(tmpdir(), "wf-resolver-empty-"));
  try {
    assert.equal(readSnapshot(ws), null);
    assert.ok(normalizeSlashes(snapshotPath(ws)).endsWith("_local/resolver/snapshot.json"));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("readSnapshot rejects an incompatible schema version", () => {
  const ws = mkdtempSync(join(tmpdir(), "wf-resolver-schema-"));
  try {
    const snap = buildForTest();
    writeSnapshot(ws, { ...snap, schemaVersion: SNAPSHOT_SCHEMA_VERSION + 999 });
    assert.throws(() => readSnapshot(ws), SnapshotSchemaError);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
