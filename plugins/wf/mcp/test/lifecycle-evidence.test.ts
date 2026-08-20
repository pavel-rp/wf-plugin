import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COMMITTED_LEDGER_PATH,
  LOCAL_LEDGER_PATH,
  compareLifecycleEvidence,
  createArtifactEvidence,
  createMachineBindingEvidence,
  createPortablePackEvidence,
  resolveArtifactAuthority,
  resolveLedgerHome,
} from "../src/resolver/lifecycle-evidence.js";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);

function portable(version = "1.0.0") {
  const evidence = createPortablePackEvidence({
    pluginId: "wf-demo@local",
    version,
    capabilities: ["zeta", "alpha"],
    manifestHashes: [
      { path: "capabilities/zeta/manifest.md", sha256: B },
      { path: "capabilities/alpha/manifest.md", sha256: A },
    ],
    declaredSourceHashes: [
      { path: "capabilities/zeta/assets/z", sha256: C },
      { path: "capabilities/alpha/assets/a", sha256: B },
    ],
  });
  assert.ok(evidence);
  return evidence;
}

function binding(root = "/canonical/wf-demo") {
  const evidence = createMachineBindingEvidence({
    pluginId: "wf-demo@local",
    canonicalRoot: root,
    cliScope: "user",
    enablement: "enabled",
    observedVersion: "1.0.0",
    localFingerprints: [
      { path: `${root}/z`, sha256: B },
      { path: `${root}/a`, sha256: A },
    ],
  });
  assert.ok(evidence);
  return evidence;
}

test("ledger policy defaults to committed and bindings are always local", () => {
  assert.deepEqual(resolveLedgerHome(), {
    ok: true,
    home: "committed",
    portablePath: COMMITTED_LEDGER_PATH,
    bindingPath: LOCAL_LEDGER_PATH,
  });
  assert.deepEqual(resolveLedgerHome("committed"), resolveLedgerHome());
  assert.deepEqual(resolveLedgerHome("local"), {
    ok: true,
    home: "local",
    portablePath: LOCAL_LEDGER_PATH,
    bindingPath: LOCAL_LEDGER_PATH,
  });
  const invalid = resolveLedgerHome("elsewhere");
  assert.equal(invalid.ok, false);
  assert.equal(invalid.bindingPath, LOCAL_LEDGER_PATH);
});

test("portable evidence has the exact portable key set and deterministic ordering", () => {
  const evidence = portable();
  assert.deepEqual(Object.keys(evidence), [
    "pluginId",
    "version",
    "capabilities",
    "manifestHashes",
    "declaredSourceHashes",
  ]);
  assert.deepEqual(evidence.capabilities, ["alpha", "zeta"]);
  assert.deepEqual(evidence.manifestHashes.map((record) => record.path), [
    "capabilities/alpha/manifest.md",
    "capabilities/zeta/manifest.md",
  ]);
  const serialized = JSON.stringify(evidence);
  assert.ok(!serialized.includes("canonicalRoot"));
  assert.ok(!serialized.includes("timestamp"));
  assert.ok(!serialized.includes("/canonical/"));
});

test("machine binding has the exact local key set and sorted local fingerprints", () => {
  const evidence = binding();
  assert.deepEqual(Object.keys(evidence), [
    "pluginId",
    "canonicalRoot",
    "cliScope",
    "enablement",
    "observedVersion",
    "localFingerprints",
  ]);
  assert.deepEqual(evidence.localFingerprints.map((record) => record.path), [
    "/canonical/wf-demo/a",
    "/canonical/wf-demo/z",
  ]);
});

test("portable mismatch takes precedence over concurrent root movement", () => {
  const result = compareLifecycleEvidence(
    portable("1.0.0"),
    portable("2.0.0"),
    binding("/old/root"),
    binding("/new/root"),
  );
  assert.deepEqual(result, {
    state: "portable-mismatch",
    seedProposal: null,
    persisted: false,
  });
});

test("equal portable evidence compares root only after portable equality", () => {
  assert.deepEqual(
    compareLifecycleEvidence(portable(), portable(), binding("/old/root"), binding("/new/root")),
    { state: "root-moved", seedProposal: null, persisted: false },
  );
  assert.deepEqual(compareLifecycleEvidence(portable(), portable(), binding(), binding()), {
    state: "equal",
    seedProposal: null,
    persisted: true,
  });
});

test("absent binding is a non-persisted seed proposal, never stale evidence", () => {
  const observed = binding();
  const result = compareLifecycleEvidence(portable(), portable(), null, observed);
  assert.deepEqual(result, {
    state: "binding-seed",
    seedProposal: observed,
    persisted: false,
  });
});

test("missing evidence fails closed before any seed or movement result", () => {
  assert.deepEqual(compareLifecycleEvidence(null, portable(), null, binding()), {
    state: "evidence-missing",
    seedProposal: null,
    persisted: false,
  });
  assert.deepEqual(compareLifecycleEvidence(portable(), null, binding(), binding()), {
    state: "evidence-missing",
    seedProposal: null,
    persisted: false,
  });
});

test("artifact evidence has complete deterministic owners and the full semantic tuple", () => {
  const evidence = createArtifactEvidence({
    destination: ".wf/generated.json",
    owners: [
      { pluginId: "wf-z@local", capability: "zeta", source: "assets/z" },
      { pluginId: "wf-a@local", capability: "alpha", source: "assets/a" },
    ],
    declaredSourceFingerprint: A,
    producedContentHash: B,
    production: "copy",
    refresh: "replace-if-unmodified",
    removal: "delete-if-unmodified",
  });
  assert.ok(evidence);
  assert.deepEqual(Object.keys(evidence), [
    "destination",
    "owners",
    "declaredSourceFingerprint",
    "producedContentHash",
    "production",
    "refresh",
    "removal",
  ]);
  assert.deepEqual(evidence.owners.map((owner) => owner.pluginId), ["wf-a@local", "wf-z@local"]);
  assert.deepEqual(resolveArtifactAuthority(evidence, B), {
    persist: true,
    replace: true,
    remove: true,
  });
});

test("missing, incomplete, or modified artifact proof grants no authority", () => {
  assert.deepEqual(resolveArtifactAuthority(null, B), {
    persist: false,
    replace: false,
    remove: false,
  });
  const evidence = createArtifactEvidence({
    destination: "out",
    owners: [{ pluginId: "wf-a@local", capability: "a", source: "source" }],
    declaredSourceFingerprint: A,
    producedContentHash: B,
    production: "copy",
    refresh: "replace-if-unmodified",
    removal: "delete-if-unmodified",
  });
  assert.ok(evidence);
  assert.deepEqual(resolveArtifactAuthority(evidence, C), {
    persist: false,
    replace: false,
    remove: false,
  });
  assert.equal(
    createArtifactEvidence({
      destination: "out",
      owners: [],
      declaredSourceFingerprint: A,
      producedContentHash: B,
      production: "copy",
      refresh: "retain",
      removal: "retain",
    }),
    null,
  );
});

test("duplicate or malformed hash identities fail closed", () => {
  assert.equal(
    createPortablePackEvidence({
      pluginId: "wf-demo@local",
      version: "1.0.0",
      capabilities: ["demo", "demo"],
      manifestHashes: [],
      declaredSourceHashes: [],
    }),
    null,
  );
  assert.equal(
    createMachineBindingEvidence({
      pluginId: "wf-demo@local",
      canonicalRoot: "/root",
      cliScope: "user",
      enablement: "enabled",
      observedVersion: "1.0.0",
      localFingerprints: [{ path: "/root/a", sha256: "not-a-sha" }],
    }),
    null,
  );
});
