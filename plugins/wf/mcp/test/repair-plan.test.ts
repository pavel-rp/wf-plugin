// Derived repair-plan contract tests (WF-460).
//
// Three layers, mirroring the planner suite:
//   - the CLASSIFIER and the derived SELECTION are driven directly, because the
//     five drift states and the always-empty deregistration set are properties
//     of pure functions;
//   - the PURE PRODUCER (`planRepair`) is driven over synthetic facts, because
//     every applicability, action, identity, and destructive-claim rule is a
//     property of that function;
//   - the SERVICE surface is driven over the in-memory ports double AND over a
//     REAL temp workspace, because byte-inertness from the recovered baseline is
//     a property of the WIRING and is only worth asserting against real bytes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  agreesWithAdvanceConjuncts,
  classifyRepairDrift,
  deriveRepairSelection,
  diagnoseRepairDrift,
  planRepair,
  repairDriftIsActionable,
  repairPlanDestructiveClaims,
  REPAIR_DRIFT_REMEDY,
  type RepairDriftState,
  type RepairPlanInput,
} from "../src/resolver/repair-plan.js";
import { planInstall, type PlanCapabilityInput } from "../src/resolver/plan-install.js";
import type { PlanArtifactFactInput } from "../src/resolver/plan-install.js";
import { createDefaultPorts } from "../src/ports.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";
import { normalizeSlashes, resolveContainedCapabilityPath } from "../src/resolver/paths.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { sha256Hex } from "../src/resolver/fingerprint.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import {
  PLAN_ENVELOPE_VERSION,
  RESOLVER_GENERATOR,
  type ArtifactEvidence,
  type ArtifactOwner,
  type DiscoveredPack,
  type DiscoveryConfidence,
  type DiscoveryInventory,
  type MachineBindingEvidence,
  type PlanAdmissionState,
  type PortablePackEvidence,
  type ResolverSnapshot,
} from "../src/resolver/types.js";

// --- fixtures ---------------------------------------------------------------

const ADMITTED: PlanAdmissionState = {
  admitted: true,
  root: "/ws",
  source: "explicit",
  reason: null,
  diagnostic: null,
};

const TRUSTWORTHY: DiscoveryInventory = {
  confidence: "trustworthy",
  mayEstablishAbsence: true,
  observedCount: 1,
  issues: [],
};

function untrustworthy(confidence: DiscoveryConfidence): DiscoveryInventory {
  return { confidence, mayEstablishAbsence: false, observedCount: 0, issues: [] };
}

function portable(over: Partial<PortablePackEvidence> = {}): PortablePackEvidence {
  return {
    pluginId: "wf-demo@local",
    version: "1.0.0",
    capabilities: ["demo"],
    manifestHashes: [{ path: "capabilities/demo/manifest.md", sha256: "a".repeat(64) }],
    declaredSourceHashes: [],
    ...over,
  };
}

function binding(over: Partial<MachineBindingEvidence> = {}): MachineBindingEvidence {
  return {
    pluginId: "wf-demo@local",
    canonicalRoot: "/ws/packs/wf-demo",
    cliScope: "user",
    enablement: "enabled",
    observedVersion: "1.0.0",
    localFingerprints: [],
    ...over,
  };
}

function pack(over: Partial<DiscoveredPack> = {}): DiscoveredPack {
  return {
    pluginId: "wf-demo@local",
    pluginName: "wf-demo",
    version: "1.0.0",
    scope: "user",
    enablement: "enabled",
    installPath: "/ws/packs/wf-demo",
    state: "active",
    registeredCapabilities: ["demo"],
    diagnostics: null,
    overlay: null,
    presence: "installed",
    evidence: { comparison: "equal", portable: portable(), binding: binding() },
    seedProposal: null,
    questions: [],
    selectable: true,
    ...over,
  };
}

function capability(over: Partial<PlanCapabilityInput> = {}): PlanCapabilityInput {
  return {
    pluginId: "wf-demo@local",
    name: "demo",
    requires: [],
    conflicts: [],
    providerScopes: [],
    ...over,
  };
}

function input(over: Partial<RepairPlanInput> = {}): RepairPlanInput {
  return {
    admission: ADMITTED,
    inventory: TRUSTWORTHY,
    packs: [pack()],
    capabilities: [capability()],
    recovery: noRecoveryReport(),
    ...over,
  };
}

const OWNER: ArtifactOwner = {
  pluginId: "wf-demo@local",
  capability: "demo",
  source: "payloads/thing.md",
};

const HASH_A = "1".repeat(64);
const HASH_B = "2".repeat(64);
const SRC_OLD = "3".repeat(64);
const SRC_NEW = "4".repeat(64);

function evidence(over: Partial<ArtifactEvidence> = {}): ArtifactEvidence {
  return {
    destination: ".wf/payloads/thing.md",
    owners: [OWNER],
    declaredSourceFingerprint: SRC_OLD,
    producedContentHash: HASH_A,
    production: "copy",
    refresh: "replace-if-unmodified",
    removal: "delete-if-unmodified",
    ...over,
  };
}

function artifactFact(over: Partial<PlanArtifactFactInput> = {}): PlanArtifactFactInput {
  return {
    destination: ".wf/payloads/thing.md",
    target: { ok: true, canonicalTarget: "/ws/.wf/payloads/thing.md", exists: true },
    recorded: evidence(),
    current: { ok: true, sha256: HASH_A, bytes: 10 },
    declared: {
      declaredSourceFingerprint: SRC_OLD,
      producedContentHash: HASH_A,
      owners: [OWNER],
      production: "copy",
      refresh: "replace-if-unmodified",
      removal: "delete-if-unmodified",
    },
    ...over,
  };
}

const codes = (out: { findings: Array<{ code: string }> }): string[] =>
  out.findings.map((f) => f.code);

const kinds = (out: { actions: Array<{ kind: string }> }): string[] =>
  out.actions.map((a) => a.kind);

// --- the classifier: five states that do not collapse ------------------------

test("every lifecycle comparison maps to its own drift state and its own remedy", () => {
  assert.equal(classifyRepairDrift("portable-mismatch"), "source-drift");
  assert.equal(classifyRepairDrift("root-moved"), "root-map");
  assert.equal(classifyRepairDrift("local-mismatch"), "local-drift");
  assert.equal(classifyRepairDrift("binding-seed"), "missing-binding");
  assert.equal(classifyRepairDrift("evidence-missing"), "missing-legacy-evidence");
  assert.equal(classifyRepairDrift("equal"), "settled");

  // The four states the criterion names must be pairwise distinct, and each must
  // carry its own remedy — collapsing any two is the failure mode.
  const named: RepairDriftState[] = [
    "source-drift",
    "root-map",
    "missing-binding",
    "missing-legacy-evidence",
  ];
  assert.equal(new Set(named).size, 4);
  assert.equal(new Set(named.map((state) => REPAIR_DRIFT_REMEDY[state])).size, 4);

  // `local-drift` shares a repair SCOPE with `root-map` but is a distinct
  // observation, so it is still its own state.
  assert.notEqual(classifyRepairDrift("local-mismatch"), classifyRepairDrift("root-moved"));
});

test("an unrecognised comparison degrades to the most conservative outcome", () => {
  // The default arm, exercised through the only channel a future build could
  // reach it by: a token this build does not enumerate.
  const future = "some-future-comparison" as Parameters<typeof classifyRepairDrift>[0];
  assert.equal(classifyRepairDrift(future), "indeterminate");
  assert.equal(REPAIR_DRIFT_REMEDY.indeterminate, "none");
  assert.equal(repairDriftIsActionable("indeterminate"), false);
  assert.equal(repairDriftIsActionable("settled"), false);
  assert.equal(repairDriftIsActionable("source-drift"), true);
});

// --- the derived selection: repair never deselects ---------------------------

test("the derived selection is every registered pack and an EMPTY deregistration set", () => {
  const selection = deriveRepairSelection([
    pack({ pluginId: "z@local", pluginName: "z" }),
    pack({ pluginId: "a@local", pluginName: "a" }),
    pack({ pluginId: "unregistered@local", pluginName: "u", registeredCapabilities: [] }),
  ]);
  assert.deepEqual(selection.desired, ["a@local", "z@local"]);
  assert.deepEqual(selection.deregister, []);
  assert.deepEqual(selection.answers, []);
});

// --- SC-1: source drift regardless of root; a moved known root is root-map ----

test("a portable tuple mismatch is source drift regardless of the machine root", () => {
  for (const root of ["/ws/packs/wf-demo", "/elsewhere/wf-demo"]) {
    const { plan, diagnosis } = planRepair(
      input({
        packs: [
          pack({
            evidence: {
              comparison: "portable-mismatch",
              portable: portable({ version: "9.9.9" }),
              binding: binding({ canonicalRoot: root }),
            },
            overlay: "stale-portable",
          }),
        ],
      }),
    );
    assert.equal(diagnosis[0].drift, "source-drift");
    assert.deepEqual(
      plan.repairs.map((repair) => repair.scope),
      ["portable"],
      `root \`${root}\` must not change the scope`,
    );
    assert.equal(plan.mode, "repair");
    assert.ok(kinds(plan).includes("evidence-repair"));
  }
});

test("equal portable tuples plus a moved known root produce a root-map repair", () => {
  const { plan, diagnosis } = planRepair(
    input({
      packs: [
        pack({
          evidence: {
            comparison: "root-moved",
            portable: portable(),
            binding: binding({ canonicalRoot: "/moved/wf-demo" }),
          },
          overlay: "stale-binding",
        }),
      ],
    }),
  );
  assert.equal(diagnosis[0].drift, "root-map");
  assert.deepEqual(plan.repairs.map((repair) => repair.scope), ["binding"]);
  assert.deepEqual(plan.repairs.map((repair) => repair.comparison), ["root-moved"]);
  assert.equal(plan.mode, "repair");
});

test("local fingerprint drift is its own state and never reads as a moved root", () => {
  const { plan, diagnosis } = planRepair(
    input({
      packs: [
        pack({
          evidence: {
            comparison: "local-mismatch",
            portable: portable(),
            binding: binding({ localFingerprints: [{ path: "x", sha256: HASH_B }] }),
          },
        }),
      ],
    }),
  );
  assert.equal(diagnosis[0].drift, "local-drift");
  assert.deepEqual(plan.repairs.map((repair) => repair.comparison), ["local-mismatch"]);
  assert.deepEqual(plan.repairs.map((repair) => repair.scope), ["binding"]);
});

// --- SC-2: the two missing-evidence states -----------------------------------

test("a missing local binding stays REGISTERED and carries a plan seed", () => {
  const { plan, diagnosis } = planRepair(
    input({
      packs: [
        pack({
          evidence: { comparison: "binding-seed", portable: portable(), binding: binding() },
          seedProposal: binding(),
        }),
      ],
    }),
  );
  assert.equal(diagnosis[0].drift, "missing-binding");
  assert.deepEqual(plan.evidenceSeeds.map((seed) => seed.kind), ["binding-seed"]);
  assert.deepEqual(
    plan.registryDelta.retentions.map((entry) => entry.pluginId),
    ["wf-demo@local"],
    "the registration is retained, never removed",
  );
  assert.deepEqual(plan.registryDelta.deregistrations, []);
  assert.equal(plan.applicability, "applicable");
});

test("missing portable legacy evidence stays selected and operational pending bootstrap", () => {
  const { plan, diagnosis } = planRepair(
    input({
      packs: [
        pack({
          evidence: { comparison: "evidence-missing", portable: portable(), binding: binding() },
          overlay: "legacy-unrecorded",
        }),
      ],
    }),
  );
  assert.equal(diagnosis[0].drift, "missing-legacy-evidence");
  assert.equal(diagnosis[0].selected, true, "the pack stays selected");
  assert.deepEqual(plan.evidenceSeeds.map((seed) => seed.kind), ["legacy-bootstrap"]);
  assert.ok(codes(plan).includes("plan/legacy-bootstrap-previewed"));
  assert.deepEqual(plan.registryDelta.deregistrations, []);
});

test("incomplete legacy proof preserves the registration and blocks the plan", () => {
  const { plan } = planRepair(
    input({
      packs: [
        pack({
          evidence: { comparison: "evidence-missing", portable: null, binding: null },
        }),
      ],
    }),
  );
  assert.ok(codes(plan).includes("plan/legacy-proof-incomplete"));
  assert.equal(plan.applicability, "not-applicable");
  assert.deepEqual(
    plan.registryDelta.retentions.map((entry) => entry.reason),
    ["retained-legacy-proof-incomplete"],
  );
  assert.deepEqual(repairPlanDestructiveClaims(plan), []);
});

// --- SC-3: advance vs retained divergence ------------------------------------

test("a hash-matching source-changed artifact advances", () => {
  const { plan, withheldAdvances } = planRepair(
    input({
      artifacts: [
        artifactFact({
          declared: {
            declaredSourceFingerprint: SRC_NEW,
            producedContentHash: HASH_B,
            owners: [OWNER],
            production: "copy",
            refresh: "replace-if-unmodified",
            removal: "delete-if-unmodified",
          },
        }),
      ],
    }),
  );
  assert.deepEqual(withheldAdvances, []);
  assert.deepEqual(plan.artifacts.advance.map((d) => d.destination), [".wf/payloads/thing.md"]);
  assert.ok(kinds(plan).includes("artifact-advance"));
  assert.equal(plan.mode, "upgrade");
});

test("an EDITED file stays retained divergence and denies a fully-upgraded claim", () => {
  const { plan } = planRepair(
    input({
      artifacts: [
        artifactFact({
          // The bytes on disk are not the bytes the ledger recorded: a hand edit.
          current: { ok: true, sha256: HASH_B, bytes: 11 },
          declared: {
            declaredSourceFingerprint: SRC_NEW,
            producedContentHash: "5".repeat(64),
            owners: [OWNER],
            production: "copy",
            refresh: "replace-if-unmodified",
            removal: "delete-if-unmodified",
          },
        }),
      ],
    }),
  );
  assert.deepEqual(plan.artifacts.advance, []);
  assert.deepEqual(
    plan.artifacts.retained.map((d) => d.reason),
    ["divergent"],
    "the edit is reported, never absorbed",
  );
  assert.equal(plan.artifacts.retained[0].fullyUpgraded, false);
  assert.equal(plan.mode, "retained-divergence");
  assert.ok(kinds(plan).includes("artifact-retain"));
  assert.ok(!kinds(plan).includes("artifact-advance"));
});

// --- SC-3: agreement with WF-459's advance conjuncts -------------------------

test("an advance whose OWNER SET moved is withheld, not planned", () => {
  const moved: ArtifactOwner = { ...OWNER, capability: "other" };
  const { plan, withheldAdvances } = planRepair(
    input({
      artifacts: [
        artifactFact({
          declared: {
            declaredSourceFingerprint: SRC_NEW,
            producedContentHash: HASH_B,
            owners: [moved],
            production: "copy",
            refresh: "replace-if-unmodified",
            removal: "delete-if-unmodified",
          },
        }),
      ],
    }),
  );
  assert.deepEqual(withheldAdvances, [
    { destination: ".wf/payloads/thing.md", reason: "owner-set-moved" },
  ]);
  assert.deepEqual(plan.artifacts.advance, []);
  assert.ok(!kinds(plan).includes("artifact-advance"));
  assert.ok(codes(plan).includes("plan/artifact-retained"));
});

test("an advance whose DECLARED TUPLE changed is withheld, not planned", () => {
  const { plan, withheldAdvances } = planRepair(
    input({
      artifacts: [
        artifactFact({
          declared: {
            declaredSourceFingerprint: SRC_NEW,
            producedContentHash: HASH_B,
            owners: [OWNER],
            production: "copy",
            // The pack moved its row to `retain`: an advance would replace the
            // file against the CURRENT declaration's explicit instruction.
            refresh: "retain",
            removal: "delete-if-unmodified",
          },
        }),
      ],
    }),
  );
  assert.deepEqual(withheldAdvances, [
    { destination: ".wf/payloads/thing.md", reason: "declared-tuple-changed" },
  ]);
  assert.deepEqual(plan.artifacts.advance, []);
});

test("the conjunct test itself matches the mutator's two extra conditions", () => {
  const recorded = evidence();
  assert.equal(agreesWithAdvanceConjuncts(recorded, null), false);
  assert.equal(agreesWithAdvanceConjuncts(null, recorded), false);
  assert.equal(
    agreesWithAdvanceConjuncts(recorded, { ...recorded, declaredSourceFingerprint: SRC_NEW }),
    true,
  );
  assert.equal(
    agreesWithAdvanceConjuncts(recorded, { ...recorded, owners: [{ ...OWNER, source: "b.md" }] }),
    false,
    "a moved owner set fails",
  );
  assert.equal(
    agreesWithAdvanceConjuncts(recorded, { ...recorded, refresh: "retain" }),
    false,
    "a changed declared tuple fails",
  );
  assert.equal(
    agreesWithAdvanceConjuncts(recorded, { ...recorded, declaredSourceFingerprint: "not-a-hash" }),
    false,
    "a malformed declared fingerprint fails",
  );
  assert.equal(
    agreesWithAdvanceConjuncts({ ...recorded, owners: [] }, recorded),
    false,
    "an empty recorded owner set fails",
  );
});

// --- SC-4: ownerless artifacts use the established rules ---------------------

test("an ownerless recorded artifact is INCOMPLETE ownership, never exclusive", () => {
  const { plan } = planRepair(
    input({ artifacts: [artifactFact({ recorded: evidence({ owners: [] }) })] }),
  );
  assert.deepEqual(plan.artifacts.deletable, []);
  assert.deepEqual(plan.artifacts.retained.map((d) => d.reason), ["ownership-incomplete"]);
  assert.equal(plan.artifacts.retained[0].deletionAuthority, false);
  assert.deepEqual(repairPlanDestructiveClaims(plan), []);
});

test("an ownerless DECLARATION with no ledger record proves nothing to bootstrap", () => {
  const { plan } = planRepair(
    input({
      artifacts: [
        artifactFact({
          recorded: null,
          declared: {
            declaredSourceFingerprint: SRC_OLD,
            producedContentHash: HASH_A,
            owners: [],
            production: "copy",
            refresh: "replace-if-unmodified",
            removal: "delete-if-unmodified",
          },
        }),
      ],
    }),
  );
  assert.deepEqual(plan.artifacts.bootstrap, []);
  assert.deepEqual(plan.artifacts.retained.map((d) => d.reason), ["ownership-incomplete"]);
});

// --- SC-6: only a trustworthy complete inventory may prove absence -----------

test("every untrustworthy inventory shape makes the plan non-applicable", () => {
  // The five shapes the criterion names. A duplicate plugin id or name is what
  // discovery reports as `invalid`, so it is covered by that token.
  for (const confidence of ["unavailable", "malformed", "partial", "invalid"] as const) {
    const { plan } = planRepair(input({ inventory: untrustworthy(confidence) }));
    assert.equal(plan.applicability, "not-applicable", confidence);
    assert.ok(
      codes(plan).includes("plan/inventory-untrustworthy"),
      `${confidence} must raise the blocking finding`,
    );
    assert.ok(
      plan.applicabilityBasis.blockingFindings.some(
        (finding) => finding.code === "plan/inventory-untrustworthy",
      ),
      `${confidence} must be enumerated in the basis, never a silent omission`,
    );
    assert.equal(plan.applicabilityBasis.blocked, true);
  }
});

test("an untrustworthy inventory carries NO destructive claim at all, not merely a flag", () => {
  for (const confidence of ["unavailable", "malformed", "partial", "invalid"] as const) {
    const { plan } = planRepair(
      input({
        inventory: untrustworthy(confidence),
        // Facts that WOULD be the richest possible deletion candidates: complete
        // recorded ownership, matching digests, and `delete-if-unmodified`.
        artifacts: [artifactFact()],
      }),
    );
    assert.deepEqual(plan.artifacts.deletable, [], `${confidence}: no deletable decision`);
    assert.ok(!kinds(plan).includes("artifact-delete"), `${confidence}: no artifact-delete action`);
    assert.deepEqual(
      repairPlanDestructiveClaims(plan),
      [],
      `${confidence}: no destructive claim of any shape`,
    );
    assert.notEqual(plan.mode, "deletion");
  }
});

test("a repair plan can never reach a destructive claim, even on a trustworthy inventory", () => {
  // The STRUCTURAL half of the guarantee: with nothing deselected, the deletable
  // form is unreachable, so the strongest possible deletion facts still produce
  // no claim. `deregister` is not merely empty by default — repair has no input
  // that could make it non-empty.
  const { plan } = planRepair(input({ artifacts: [artifactFact()] }));
  assert.deepEqual(plan.artifacts.deletable, []);
  assert.deepEqual(repairPlanDestructiveClaims(plan), []);
  assert.ok(!kinds(plan).includes("artifact-delete"));
  assert.ok(!kinds(plan).includes("registry-deregister"));
});

test("`plan_install` itself is unchanged: it never raises the repair finding", () => {
  // The additive finding code must not perturb a single existing plan, or every
  // approved `planId` in the field would silently change.
  const out = planInstall({
    admission: ADMITTED,
    inventory: untrustworthy("partial"),
    packs: [pack()],
    capabilities: [capability()],
    selection: { desired: [], deregister: [], answers: [] },
    recovery: noRecoveryReport(),
  });
  assert.ok(!codes(out).includes("plan/inventory-untrustworthy"));
});

// --- SC-5: idempotence, with retained divergence still visible ---------------

test("repeated repair over unchanged facts is byte-stable in identity and actions", () => {
  const facts = input({ packs: [pack({ evidence: { comparison: "root-moved", portable: portable(), binding: binding({ canonicalRoot: "/moved" }) } })] });
  const first = planRepair(facts);
  const second = planRepair(facts);
  assert.equal(first.plan.identity.planId, second.plan.identity.planId);
  assert.deepEqual(first.plan.actions, second.plan.actions);
  assert.deepEqual(first.plan, second.plan);
  assert.deepEqual(first.diagnosis, second.diagnosis);
});

test("retained divergence STAYS VISIBLE on every repeated run — no suppression", () => {
  const facts = input({
    artifacts: [
      artifactFact({
        current: { ok: true, sha256: HASH_B, bytes: 11 },
        declared: {
          declaredSourceFingerprint: SRC_NEW,
          producedContentHash: "5".repeat(64),
          owners: [OWNER],
          production: "copy",
          refresh: "replace-if-unmodified",
          removal: "delete-if-unmodified",
        },
      }),
    ],
  });
  const first = planRepair(facts);
  const second = planRepair(facts);
  for (const [label, run] of [["first", first], ["second", second]] as const) {
    assert.deepEqual(
      run.plan.artifacts.retained.map((d) => d.reason),
      ["divergent"],
      `${label} run still reports the divergence`,
    );
    assert.equal(run.plan.mode, "retained-divergence", label);
  }
  assert.equal(first.plan.identity.planId, second.plan.identity.planId);
});

// --- the frozen envelope and the separate recovery channel -------------------

test("the repair plan rides the frozen envelope and reports recovery separately", () => {
  const { plan } = planRepair(input());
  assert.equal(plan.planVersion, PLAN_ENVELOPE_VERSION);
  assert.equal(plan.byteInert, true);
  assert.equal(plan.identity.algorithm, "sha256");
  assert.equal(plan.identity.coveredFactClasses.length, 16);
  assert.ok(!plan.identity.coveredFactClasses.includes("recovery" as never));
  assert.equal(plan.recovery.state, "no-journal");
});

test("differing recovery reports do not move the plan identity", () => {
  const clean = planRepair(input()).plan;
  const recovered = planRepair(
    input({
      recovery: {
        ...noRecoveryReport(),
        state: "recovered",
        proceeded: true,
        wroteBytes: true,
      },
    }),
  ).plan;
  assert.equal(clean.identity.planId, recovered.identity.planId);
  assert.deepEqual(clean.actions, recovered.actions);
  assert.notDeepEqual(clean.recovery, recovered.recovery);
  const { recovery: _a, ...cleanRest } = clean;
  const { recovery: _b, ...recoveredRest } = recovered;
  assert.deepEqual(cleanRest, recoveredRest, "deep-equal apart from the recovery key");
});

test("an unrecovered run reads NO lifecycle state and claims nothing", () => {
  const { plan, diagnosis } = planRepair(
    input({
      recovery: { ...noRecoveryReport(), state: "incomplete", proceeded: false, wroteBytes: false },
    }),
  );
  assert.equal(plan.applicability, "unrecovered");
  assert.equal(plan.mode, null);
  assert.deepEqual(codes(plan), ["plan/halted-unrecovered"]);
  assert.deepEqual(plan.actions, []);
  assert.equal(plan.inventory.mayEstablishAbsence, false);
  assert.deepEqual(repairPlanDestructiveClaims(plan), []);
  // A halted run asserts nothing — the derived channels are emptied to match the
  // envelope, EVEN THOUGH this caller handed in a pack it had observed.
  assert.deepEqual(diagnosis, []);
});

test("an inadmissible root returns the typed invalid-root envelope, not an error", () => {
  const { plan } = planRepair(
    input({
      admission: {
        admitted: false,
        root: null,
        source: "explicit",
        reason: "not-absolute",
        diagnostic: "the declared workspace root is not absolute.",
      },
      packs: [],
      capabilities: [],
    }),
  );
  assert.equal(plan.applicability, "invalid-root");
  assert.equal(plan.mode, null);
  assert.equal(plan.workspaceRoot, null);
  assert.equal(plan.byteInert, true);
  assert.deepEqual(repairPlanDestructiveClaims(plan), []);
});

test("the diagnosis is deterministic and ordered by plugin id", () => {
  const rows = diagnoseRepairDrift([
    pack({ pluginId: "z@local", pluginName: "z" }),
    pack({ pluginId: "a@local", pluginName: "a", evidence: { comparison: "root-moved", portable: portable(), binding: binding() } }),
  ]);
  assert.deepEqual(rows.map((row) => row.pluginId), ["a@local", "z@local"]);
  assert.deepEqual(rows.map((row) => row.drift), ["root-map", "settled"]);
  assert.deepEqual(rows.map((row) => row.remedy), ["evidence-repair:binding", "none"]);
});

// --- byte-inertness over the real service wiring -----------------------------

const WS = "/ws";
const INSTALL = "/ws/packs/wf-demo";

const DEMO_MANIFEST = `# demo capability

**Kind:** both

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/thing.ops.md\` | delivery |
`;

const CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Plugin Roots

| Plugin | Root |
|---|---|
| wf-demo | ${INSTALL} |

## Capabilities

| Capability | Path |
|---|---|
| demo | plugin:wf-demo/capabilities/demo |
`;

const PLUGIN_LIST = JSON.stringify([
  { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: true, installPath: INSTALL },
]);

function makePorts(): ResolverServicePorts & {
  counts: { resolveFresh: number; persist: number; writeFile: number };
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const seed: Record<string, string> = {
    [`${WS}/_local/config.md`]: CONFIG,
    [`${INSTALL}/capabilities/demo/manifest.md`]: DEMO_MANIFEST,
    [`${INSTALL}/capabilities/demo/fragments/thing.ops.md`]: "# thing\n",
  };
  for (const [k, v] of Object.entries(seed)) files.set(normalizeSlashes(k), v);

  const counts = { resolveFresh: 0, persist: 0, writeFile: 0 };
  let cache: ResolverSnapshot | null = null;
  const readFile = (p: string): string | null => files.get(normalizeSlashes(p)) ?? null;
  const readContainedFile = (root: string, selectedPath: string, maxBytes: number) => {
    const path = resolveContainedCapabilityPath(root, selectedPath);
    if (path === null) return { status: "unsafe" as const, path: null, content: null };
    const content = readFile(path);
    if (content === null) return { status: "missing" as const, path, content: null };
    if (Buffer.byteLength(content, "utf8") > maxBytes) {
      return { status: "too-large" as const, path, content: null };
    }
    return { status: "ok" as const, path, content };
  };

  return {
    counts,
    files,
    workspaceRoot: WS,
    corePluginRoot: "/core/plugins/wf",
    resolveFresh() {
      counts.resolveFresh++;
      return resolveSnapshot({
        workspaceRoot: WS,
        io: { readFile, readContainedFile },
        pluginListRaw: PLUGIN_LIST,
        now: () => new Date("2026-08-21T00:00:00.000Z"),
        generator: RESOLVER_GENERATOR,
      });
    },
    persist(snap) {
      counts.persist++;
      cache = snap;
    },
    readCache: () => cache,
    readFile,
    readContainedFile,
    fingerprintContainedFile: (root, selectedPath, maxBytes) => {
      const path = resolveContainedCapabilityPath(root, selectedPath);
      if (path === null) return { status: "unsafe" as const, path: null, sha256: null, bytes: null };
      const content = readFile(path);
      if (content === null) return { status: "missing" as const, path, sha256: null, bytes: null };
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > maxBytes) return { status: "too-large" as const, path, sha256: null, bytes: null };
      return { status: "ok" as const, path, sha256: sha256Hex(content), bytes };
    },
    canonicalizeRoot: (root) => normalizeSlashes(root),
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
    listPlugins: () => ({ ...parsePluginList(PLUGIN_LIST), ok: true }),
    registryRelPath: () => "_local/config.md",
  };
}

test("repair writes NO byte through the service — no writeFile, no ledger, no seed", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveConfig(); // warm the snapshot so `persist` is not attributed to us
  const persistBefore = ports.counts.persist;
  const filesBefore = new Map(ports.files);

  const { plan } = svc.repairPacks(ADMITTED);

  assert.equal(plan.byteInert, true);
  assert.equal(ports.counts.writeFile, 0, "repair never calls writeFile");
  assert.equal(ports.counts.persist, persistBefore, "repair does not re-persist a warm snapshot");
  assert.equal(ports.files.size, filesBefore.size, "no file was created");
  assert.ok(!ports.files.has(`${WS}/.wf/install-state.json`), "the committed ledger is untouched");
  assert.ok(!ports.files.has(`${WS}/_local/install-state.json`), "the local ledger is untouched");
  for (const [key, value] of filesBefore) {
    assert.equal(ports.files.get(key), value, `\`${key}\` is byte-identical`);
  }
});

test("the service-level repair plan is idempotent across repeated calls", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const first = svc.repairPacks(ADMITTED);
  const second = svc.repairPacks(ADMITTED);
  assert.equal(first.plan.identity.planId, second.plan.identity.planId);
  assert.deepEqual(first.plan.actions, second.plan.actions);
  assert.deepEqual(first.plan, second.plan);
  assert.deepEqual(repairPlanDestructiveClaims(first.plan), []);
});

/** Every file under `dir`, as `relative path -> sha256`. The baseline half of the
 *  baseline-and-compare: a byte-inertness claim is only worth what it is measured
 *  against, and an in-memory port double cannot observe a real write. */
function treeDigest(dir: string, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? item.name : `${prefix}/${item.name}`;
    if (item.isDirectory()) {
      for (const [k, v] of treeDigest(join(dir, item.name), rel)) out.set(k, v);
    } else if (item.isFile()) {
      out.set(rel, sha256Hex(readFileSync(join(dir, item.name)).toString("utf8")));
    }
  }
  return out;
}

test("repair is byte-inert over a REAL workspace, and admits a non-cwd root", () => {
  // The root is a temp directory that is NOT the process cwd, so this also
  // exercises WF-445's non-cwd admission end to end.
  const dir = mkdtempSync(join(tmpdir(), "wf-repair-"));
  try {
    mkdirSync(join(dir, "_local"), { recursive: true });
    writeFileSync(join(dir, "_local", "config.md"), CONFIG, "utf8");
    mkdirSync(join(dir, ".wf"), { recursive: true });
    writeFileSync(join(dir, ".wf", "install-state.json"), "{}\n", "utf8");

    const root = normalizeSlashes(dir);
    const svc = new ResolverService(createDefaultPorts(root, "/core/plugins/wf"));
    const admitted: PlanAdmissionState = {
      admitted: true,
      root,
      source: "explicit",
      reason: null,
      diagnostic: null,
    };

    // Baseline AFTER a first call, so the comparison is taken from the
    // post-recovery baseline the contract actually claims — never from process
    // start, which recovery is allowed to move.
    const first = svc.repairPacks(admitted);
    const baseline = treeDigest(dir);

    const second = svc.repairPacks(admitted);
    const after = treeDigest(dir);

    assert.deepEqual([...after.entries()].sort(), [...baseline.entries()].sort(), "zero bytes changed");
    assert.equal(second.plan.byteInert, true);
    assert.equal(second.plan.workspaceRoot, root, "the non-cwd root is admitted verbatim");
    assert.equal(first.plan.identity.planId, second.plan.identity.planId);
    assert.deepEqual(first.plan.actions, second.plan.actions);
    assert.deepEqual(repairPlanDestructiveClaims(second.plan), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
