// Complete-plan integration and approved-plan identity contract tests (WF-450).
//
// Two layers, each chosen because the property under test lives there:
//   - the PURE COMPLETION (`completePlan`) is driven directly, because mode
//     derivation, action integration and ordering, the applicability basis, and
//     the identity's per-fact-class sensitivity are all properties of that one
//     function and need no filesystem, registry, or pack at all. Driving it
//     directly is also the only way to vary ONE fact class at a time, which is
//     exactly what the identity claim has to be tested against;
//   - the ENVELOPE (`planInstall`) is driven to prove the completion folds into
//     the ONE `planVersion: 1` lineage on BOTH response paths — the ordinary one
//     and the `invalid-root` early return — and that the newly predicate-gated
//     missing-binding action is an explicit non-applicable result rather than a
//     silent omission.
//
// The suite's spine is the identity walk: a table that mutates exactly one
// mutation-relevant fact class per row and asserts the `planId` moves, paired
// with the negative case that rewording a finding does NOT move it. That pair is
// the whole point of the slice, so it is tested exhaustively rather than sampled.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PLAN_ACTION_ORDER,
  PLAN_IDENTITY_FACT_CLASSES,
  completePlan,
  hasMutatingAction,
  isDeclaredProjectOverrideArtifact,
  isProjectOverrideDestination,
  planMode,
  type PlanCompletionInput,
} from "../src/resolver/plan-complete.js";
import {
  emptyArtifactPreview,
  planArtifacts,
  type PlanArtifactDeclaration,
  type PlanArtifactFact,
} from "../src/resolver/artifact-plan.js";
import {
  emptyPayloadPreview,
  planPayloads,
  type PlanPayloadFact,
} from "../src/resolver/payload-plan.js";
import {
  planInstall,
  type PlanCapabilityInput,
  type PlanInstallInput,
} from "../src/resolver/plan-install.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";
import { PROJECT_OVERRIDE_DIR } from "../src/resolver/slot.js";
import { CONSTITUTION_RELPATH } from "../src/resolver/constitution.js";
import {
  PLAN_ENVELOPE_VERSION,
  type ArtifactEvidence,
  type ArtifactOwner,
  type DiscoveredPack,
  type DiscoveryInventory,
  type MachineBindingEvidence,
  type PayloadSemantics,
  type PlanAdmissionState,
  type PlanIdentityFactClass,
  type PlanMode,
  type PortablePackEvidence,
  type QuestionRecord,
} from "../src/resolver/types.js";

// --- fixtures ----------------------------------------------------------------

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

const COPY: PayloadSemantics = {
  production: "copy",
  refresh: "replace-if-unmodified",
  removal: "delete-if-unmodified",
};

const LEDGER_HASH = "1".repeat(64);
const EDITED_HASH = "2".repeat(64);
const SRC_OLD = "3".repeat(64);
const SRC_NEW = "4".repeat(64);
const DIGEST_A = "a".repeat(64);

const OWNER_A: ArtifactOwner = { pluginId: "a@local", capability: "alpha", source: "p/a.md" };
const TRUST = { inventoryTrustworthy: true };

function portable(over: Partial<PortablePackEvidence> = {}): PortablePackEvidence {
  return {
    pluginId: "wf-demo@local",
    version: "1.0.0",
    capabilities: ["demo"],
    manifestHashes: [{ path: "capabilities/demo/manifest.md", sha256: DIGEST_A }],
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

function question(over: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    pack: "demo",
    id: "team",
    destination: "team",
    prompt: "Which team owns this project?",
    schema: { type: "string", minLength: 1, maxLength: 64 },
    state: { status: "unresolved", source: null, value: null, suggestions: [] },
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

function joinInput(over: Partial<PlanInstallInput> = {}): PlanInstallInput {
  return {
    admission: ADMITTED,
    inventory: TRUSTWORTHY,
    packs: [pack()],
    capabilities: [capability()],
    selection: { desired: [], deregister: [], answers: [] },
    // WF-452: the byte-inert, non-blocking report. Every completion, action-order,
    // and identity property in this suite is therefore asserted against exactly
    // the pre-retrofit behaviour.
    recovery: noRecoveryReport(),
    ...over,
  };
}

// --- artifact/payload preview builders (real joins, never hand-rolled) -------

function recorded(over: Partial<ArtifactEvidence> = {}): ArtifactEvidence {
  return {
    destination: ".wf/thing.md",
    owners: [OWNER_A],
    declaredSourceFingerprint: SRC_OLD,
    producedContentHash: LEDGER_HASH,
    ...COPY,
    ...over,
  };
}

function declared(over: Partial<PlanArtifactDeclaration> = {}): PlanArtifactDeclaration {
  return {
    declaredSourceFingerprint: SRC_OLD,
    producedContentHash: LEDGER_HASH,
    owners: [OWNER_A],
    ...COPY,
    ...over,
  };
}

function artifactFact(over: Partial<PlanArtifactFact> = {}): PlanArtifactFact {
  return {
    destination: ".wf/thing.md",
    target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: true },
    recorded: recorded(),
    current: { ok: true, sha256: LEDGER_HASH, bytes: 10 },
    declared: null,
    deselectedOwners: [],
    ...over,
  };
}

const artifactPreview = (facts: PlanArtifactFact[]) => planArtifacts(facts, TRUST).preview;

function payloadFact(over: Partial<PlanPayloadFact> = {}): PlanPayloadFact {
  return {
    pluginId: "wf-demo@local",
    capability: "demo",
    source: "payloads/thing.md",
    destination: ".wf/thing.md",
    semantics: { ...COPY },
    target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: false },
    identity: { ok: true, sha256: DIGEST_A, bytes: 12 },
    current: { ok: false, status: "missing" },
    recordedContentHash: null,
    ...over,
  };
}

const payloadPreview = (facts: PlanPayloadFact[]) => planPayloads(facts).preview;

// --- the completion input ----------------------------------------------------

/** A completion input with every collection empty — the `reconcile`, `no-change`
 *  baseline every test varies exactly one facet of. */
function completion(over: Partial<PlanCompletionInput> = {}): PlanCompletionInput {
  return {
    planVersion: PLAN_ENVELOPE_VERSION,
    admission: ADMITTED,
    workspaceRoot: "/ws",
    applicability: "no-change",
    registryDelta: { additions: [], retentions: [], deregistrations: [] },
    answers: { writes: [], unresolved: [] },
    evidenceSeeds: [],
    repairs: [],
    payloads: emptyPayloadPreview(),
    artifacts: emptyArtifactPreview(),
    findings: [],
    inventory: TRUSTWORTHY,
    ...over,
  };
}

const registryEntry = (pluginId: string, reason: PlanCompletionInput["registryDelta"]["additions"][number]["reason"]) => ({
  pluginId,
  pluginName: pluginId.split("@")[0],
  capabilities: ["demo"],
  reason,
  presence: "installed" as const,
  state: "active" as const,
  enablement: "enabled" as const,
  overlay: null,
});

const kinds = (out: ReturnType<typeof completePlan>): string[] =>
  out.actions.map((action) => action.kind);

// --- SC1: ONE schema — every lifecycle shape is a MODE of the one envelope ----

const MODE_CASES: Array<[PlanMode, Partial<PlanCompletionInput>]> = [
  ["deletion", { artifacts: artifactPreview([artifactFact({ deselectedOwners: [OWNER_A] })]) }],
  ["deregistration", { registryDelta: { additions: [], retentions: [], deregistrations: [registryEntry("d@local", "explicit-deregistration")] } }],
  ["repair", { repairs: [{ pluginId: "r@local", comparison: "root-moved", scope: "binding", overlay: null, persisted: false }] }],
  ["bootstrap", { artifacts: artifactPreview([artifactFact({ recorded: null, declared: declared() })]) }],
  ["upgrade", { artifacts: artifactPreview([artifactFact({ declared: declared({ declaredSourceFingerprint: SRC_NEW }) })]) }],
  ["install", { registryDelta: { additions: [registryEntry("a@local", "selected-addition")], retentions: [], deregistrations: [] } }],
  [
    "retained-divergence",
    {
      artifacts: artifactPreview([
        artifactFact({
          declared: declared({ declaredSourceFingerprint: SRC_NEW }),
          current: { ok: true, sha256: EDITED_HASH, bytes: 9 },
        }),
      ]),
    },
  ],
  ["reconcile", {}],
];

for (const [mode, over] of MODE_CASES) {
  test(`a plan whose dominant effect is ${mode} reports mode \`${mode}\``, () => {
    assert.equal(planMode(completion(over)), mode);
    assert.equal(completePlan(completion(over)).mode, mode);
  });
}

test("mode precedence is destructive-first: a deletion outranks every other effect present", () => {
  const out = completePlan(
    completion({
      registryDelta: {
        additions: [registryEntry("a@local", "selected-addition")],
        retentions: [],
        deregistrations: [registryEntry("d@local", "explicit-deregistration")],
      },
      repairs: [{ pluginId: "r@local", comparison: "local-mismatch", scope: "binding", overlay: null, persisted: false }],
      artifacts: artifactPreview([artifactFact({ deselectedOwners: [OWNER_A] })]),
    }),
  );
  assert.equal(out.mode, "deletion", "the most review-worthy effect names the plan");
});

test("an inadmissible root reports a null mode rather than claiming an unobserved shape", () => {
  const out = completePlan(
    completion({
      applicability: "invalid-root",
      workspaceRoot: null,
      admission: { admitted: false, root: null, source: "explicit", reason: "outside", diagnostic: "d" },
    }),
  );
  assert.equal(out.mode, null);
});

// --- SC2: one integrated, deterministically ordered action list --------------

test("every action class integrates into ONE list, ordered by the exported rank table", () => {
  const out = completePlan(
    completion({
      applicability: "applicable",
      registryDelta: {
        additions: [registryEntry("a@local", "selected-addition")],
        retentions: [registryEntry("k@local", "retained-by-omission")],
        deregistrations: [registryEntry("d@local", "explicit-deregistration")],
      },
      answers: {
        writes: [
          {
            pluginId: "a@local",
            pack: "demo",
            questionId: "team",
            destination: "team",
            value: "core",
            source: "proposed",
            status: "pending",
          },
        ],
        unresolved: [],
      },
      evidenceSeeds: [
        { pluginId: "s@local", kind: "binding-seed", comparison: "binding-seed", portable: null, binding: binding(), persisted: false },
      ],
      repairs: [{ pluginId: "r@local", comparison: "portable-mismatch", scope: "portable", overlay: null, persisted: false }],
      payloads: payloadPreview([
        payloadFact(),
        payloadFact({
          source: "payloads/override.md",
          destination: `${PROJECT_OVERRIDE_DIR}/ship.review.md`,
          target: { ok: true, canonicalTarget: `/ws/${PROJECT_OVERRIDE_DIR}/ship.review.md`, exists: false },
        }),
      ]),
      artifacts: artifactPreview([
        artifactFact({ deselectedOwners: [OWNER_A] }),
        artifactFact({ destination: ".wf/b.md", target: { ok: true, canonicalTarget: "/ws/.wf/b.md", exists: true }, recorded: recorded({ destination: ".wf/b.md" }), declared: declared({ declaredSourceFingerprint: SRC_NEW }) }),
        artifactFact({ destination: ".wf/c.md", target: { ok: true, canonicalTarget: "/ws/.wf/c.md", exists: true }, recorded: null, declared: declared() }),
        artifactFact({
          destination: ".wf/d.md",
          target: { ok: true, canonicalTarget: "/ws/.wf/d.md", exists: true },
          declared: declared({ declaredSourceFingerprint: SRC_NEW }),
          current: { ok: true, sha256: EDITED_HASH, bytes: 9 },
        }),
      ]),
    }),
  );

  const present = new Set(kinds(out));
  for (const kind of [
    "evidence-repair",
    "evidence-seed",
    "registry-add",
    "registry-deregister",
    "payload-write",
    "override-write",
    "artifact-advance",
    "artifact-bootstrap",
    "artifact-delete",
    "answer-write",
    "constitution-recompose",
    "registry-retain",
    "artifact-retain",
  ]) {
    assert.ok(present.has(kind), `the integrated list covers \`${kind}\``);
  }

  const ranks = out.actions.map((action) => PLAN_ACTION_ORDER.indexOf(action.kind));
  assert.ok(
    ranks.every((rank) => rank >= 0),
    "the rank table covers every emitted kind — an unranked kind would sort silently first",
  );
  assert.deepEqual([...ranks].sort((l, r) => l - r), ranks, "kinds appear in rank-table order");
  assert.deepEqual(
    out.actions.map((action) => action.order),
    out.actions.map((_, index) => index),
    "`order` is a dense 0-based ordinal",
  );
  assert.ok(
    out.actions.every((action) => action.persisted === false),
    "every previewed action is byte-inert",
  );
});

test("integration is order-insensitive: permuting the input collections is deep-equal", () => {
  const base = completion({
    applicability: "applicable",
    registryDelta: {
      additions: [registryEntry("a@local", "selected-addition"), registryEntry("b@local", "selected-addition")],
      retentions: [],
      deregistrations: [],
    },
    repairs: [
      { pluginId: "r1@local", comparison: "root-moved", scope: "binding", overlay: null, persisted: false },
      { pluginId: "r2@local", comparison: "portable-mismatch", scope: "portable", overlay: null, persisted: false },
    ],
  });
  const permuted = completion({
    ...base,
    registryDelta: { ...base.registryDelta, additions: [...base.registryDelta.additions].reverse() },
    repairs: [...base.repairs].reverse(),
  });

  assert.deepEqual(completePlan(permuted).actions, completePlan(base).actions);
  assert.equal(completePlan(permuted).identity.planId, completePlan(base).identity.planId);
});

test("THE `.wf/` AUTHORITY TEST IS TWO-PART: the tier prefix alone admits nothing", () => {
  // The narrowness of this boundary is the whole reason `.wf/` is safe to write
  // into at all (WF-444). Each rejection below is a destination that IS under the
  // committed tier and is STILL outside the declared artifact class.
  assert.equal(isDeclaredProjectOverrideArtifact(`${PROJECT_OVERRIDE_DIR}/ship.review.md`), true);

  for (const outside of [
    PROJECT_OVERRIDE_DIR, // the bare tier
    ".wf/install-state.json", // a DIFFERENT declared class, not this one
    ".wf/anything.md", // the prefix without the tier
    `${PROJECT_OVERRIDE_DIR}/deep/ship.review.md`, // nested, so not "in" the tier
    `${PROJECT_OVERRIDE_DIR}/ship.md`, // no `<point>` segment
    `${PROJECT_OVERRIDE_DIR}/ship.review.extra.md`, // three segments
    `${PROJECT_OVERRIDE_DIR}/ship.review.txt`, // not the declared extension
    `${PROJECT_OVERRIDE_DIR}/Ship.Review.md`, // not a lowercase-hyphenated segment
    `${PROJECT_OVERRIDE_DIR}/.md`, // empty segments
  ]) {
    assert.equal(
      isDeclaredProjectOverrideArtifact(outside),
      false,
      `\`${outside}\` must NOT be admitted as a declared project-override artifact`,
    );
  }
});

test("a project-override destination is classified as an override write, not a plain payload write", () => {
  assert.equal(isProjectOverrideDestination(`${PROJECT_OVERRIDE_DIR}/ship.review.md`), true);
  assert.equal(isProjectOverrideDestination(PROJECT_OVERRIDE_DIR), false, "the bare tier is not a destination");
  assert.equal(isProjectOverrideDestination(".wf/install-state.json"), false);

  const out = completePlan(
    completion({
      applicability: "applicable",
      payloads: payloadPreview([
        payloadFact({
          destination: `${PROJECT_OVERRIDE_DIR}/ship.review.md`,
          target: { ok: true, canonicalTarget: `/ws/${PROJECT_OVERRIDE_DIR}/ship.review.md`, exists: false },
        }),
      ]),
    }),
  );
  assert.deepEqual(kinds(out), ["override-write"]);
});

test("the constitution recomposes exactly when the registered capability set changes", () => {
  const changed = completePlan(
    completion({
      applicability: "applicable",
      registryDelta: { additions: [registryEntry("a@local", "selected-addition")], retentions: [], deregistrations: [] },
    }),
  );
  const recompose = changed.actions.find((action) => action.kind === "constitution-recompose");
  assert.ok(recompose, "an addition changes the set");
  assert.equal(recompose.destination, CONSTITUTION_RELPATH);
  assert.equal(recompose.mutating, true);

  const retainedOnly = completePlan(
    completion({
      registryDelta: { additions: [], retentions: [registryEntry("k@local", "retained-by-omission")], deregistrations: [] },
    }),
  );
  assert.deepEqual(kinds(retainedOnly), ["registry-retain"], "a retention changes nothing to recompose");
});

test("`no-change` carries no mutating action and `applicable` carries at least one", () => {
  const unchanged = completePlan(
    completion({
      registryDelta: { additions: [], retentions: [registryEntry("k@local", "retained-by-omission")], deregistrations: [] },
      artifacts: artifactPreview([artifactFact({ recorded: recorded({ removal: "retain" }), deselectedOwners: [OWNER_A] })]),
    }),
  );
  assert.equal(unchanged.applicabilityBasis.applicability, "no-change");
  assert.equal(hasMutatingAction(unchanged.actions), false);
  assert.ok(unchanged.actions.length > 0, "retentions are still REPORTED, just not executable");

  const applicable = completePlan(
    completion({
      applicability: "applicable",
      registryDelta: { additions: [registryEntry("a@local", "selected-addition")], retentions: [], deregistrations: [] },
    }),
  );
  assert.equal(hasMutatingAction(applicable.actions), true);
});

// --- SC3: no blocking condition is ever a silent omission --------------------

test("the basis enumerates every blocking finding and question, drawn from the same inputs", () => {
  const out = completePlan(
    completion({
      applicability: "not-applicable",
      findings: [
        { code: "plan/binding-proof-incomplete", severity: "error", pluginId: "x@local", message: "no binding proposal" },
        { code: "plan/stale-evidence", severity: "warning", pluginId: "y@local", message: "drifted" },
      ],
      answers: {
        writes: [],
        unresolved: [
          {
            pluginId: "x@local",
            pack: "demo",
            questionId: "team",
            destination: "team",
            prompt: "Which team?",
            reason: "missing-answer",
            suggestions: [],
          },
        ],
      },
    }),
  );

  assert.equal(out.applicabilityBasis.blocked, true);
  assert.deepEqual(
    out.applicabilityBasis.blockingFindings.map((f) => f.code),
    ["plan/binding-proof-incomplete"],
    "only error-severity findings block",
  );
  assert.equal(out.applicabilityBasis.blockingQuestions.length, 1);
  assert.equal(out.applicabilityBasis.applicability, "not-applicable");
});

test("a plan with nothing blocking reports an unblocked basis with both lists empty", () => {
  const out = completePlan(
    completion({
      findings: [{ code: "plan/stale-evidence", severity: "warning", pluginId: "y@local", message: "drifted" }],
    }),
  );
  assert.equal(out.applicabilityBasis.blocked, false);
  assert.deepEqual(out.applicabilityBasis.blockingFindings, []);
  assert.deepEqual(out.applicabilityBasis.blockingQuestions, []);
});

// --- SC4: identity is a function of the mutation-relevant facts, and nothing else

test("identity is a stable 64-char sha256 hex, reproduced byte-for-byte across repeats", () => {
  const out = completePlan(completion());
  assert.equal(out.identity.algorithm, "sha256");
  assert.match(out.identity.planId, /^[0-9a-f]{64}$/);
  assert.equal(completePlan(completion()).identity.planId, out.identity.planId);
  assert.ok(out.identity.factCount > 0);
});

test("a no-change plan has a stable identity and zero writes", () => {
  const first = completePlan(completion());
  const second = completePlan(completion());
  assert.equal(first.identity.planId, second.identity.planId);
  assert.equal(hasMutatingAction(first.actions), false);
});

test("the action rank table is a closed, duplicate-free vocabulary", () => {
  assert.equal(new Set(PLAN_ACTION_ORDER).size, PLAN_ACTION_ORDER.length, "no kind is ranked twice");
  assert.deepEqual([...PLAN_ACTION_ORDER], [
    "evidence-repair",
    "evidence-seed",
    "registry-add",
    "registry-deregister",
    "payload-write",
    "override-write",
    "artifact-advance",
    "artifact-bootstrap",
    "artifact-delete",
    "answer-write",
    "constitution-recompose",
    "registry-retain",
    "artifact-retain",
  ]);
});

test("coverage is a property of the derivation: every plan reports the complete closed set", () => {
  for (const over of [{}, { applicability: "invalid-root" as const }, MODE_CASES[0][1]]) {
    const identity = completePlan(completion(over)).identity;
    assert.deepEqual(identity.coveredFactClasses, [...PLAN_IDENTITY_FACT_CLASSES]);
  }
});

/** One mutation per fact class. Each row changes exactly the named class (and, by
 *  construction, the derived `action`/`mode` classes that read from it). */
const IDENTITY_CASES: Array<[PlanIdentityFactClass, Partial<PlanCompletionInput>]> = [
  ["envelope-version", { planVersion: PLAN_ENVELOPE_VERSION + 1 }],
  ["workspace-root", { workspaceRoot: "/other" }],
  ["mode", { registryDelta: { additions: [registryEntry("a@local", "selected-addition")], retentions: [], deregistrations: [] } }],
  ["applicability", { applicability: "blocked" }],
  ["inventory-trust", { inventory: { ...TRUSTWORTHY, mayEstablishAbsence: false, confidence: "partial" } }],
  ["registry-delta", { registryDelta: { additions: [], retentions: [registryEntry("k@local", "retained-by-omission")], deregistrations: [] } }],
  [
    "answer-write",
    {
      answers: {
        writes: [
          { pluginId: "a@local", pack: "demo", questionId: "team", destination: "team", value: "core", source: "proposed", status: "pending" },
        ],
        unresolved: [],
      },
    },
  ],
  [
    "answer-unresolved",
    {
      answers: {
        writes: [],
        unresolved: [
          { pluginId: "a@local", pack: "demo", questionId: "team", destination: "team", prompt: "Which team?", reason: "missing-answer", suggestions: [] },
        ],
      },
    },
  ],
  [
    "evidence-seed",
    { evidenceSeeds: [{ pluginId: "s@local", kind: "binding-seed", comparison: "binding-seed", portable: null, binding: binding(), persisted: false }] },
  ],
  ["evidence-repair", { repairs: [{ pluginId: "r@local", comparison: "root-moved", scope: "binding", overlay: null, persisted: false }] }],
  ["payload-action", { payloads: payloadPreview([payloadFact()]) }],
  ["payload-rejection", { payloads: payloadPreview([payloadFact({ destination: "../escape.md", target: { ok: false, rejection: "traversal" } })]) }],
  [
    "payload-conflict",
    {
      payloads: payloadPreview([
        payloadFact(),
        payloadFact({ pluginId: "other@local", capability: "beta", source: "payloads/other.md", identity: { ok: true, sha256: "b".repeat(64), bytes: 12 } }),
      ]),
    },
  ],
  ["artifact-decision", { artifacts: artifactPreview([artifactFact({ deselectedOwners: [OWNER_A] })]) }],
  [
    "finding",
    { findings: [{ code: "plan/stale-evidence", severity: "warning", pluginId: "y@local", message: "drifted" }] },
  ],
];

const BASELINE_ID = completePlan(completion()).identity.planId;

for (const [factClass, over] of IDENTITY_CASES) {
  test(`identity changes when a ${factClass} fact changes`, () => {
    assert.notEqual(completePlan(completion(over)).identity.planId, BASELINE_ID);
  });
}

test("identity changes when the derived action list changes", () => {
  // `action` is the one derived class: an override write and a plain payload
  // write of IDENTICAL bytes still differ, because the destination differs.
  const plain = completePlan(completion({ payloads: payloadPreview([payloadFact()]) }));
  const override = completePlan(
    completion({
      payloads: payloadPreview([
        payloadFact({
          destination: `${PROJECT_OVERRIDE_DIR}/ship.review.md`,
          target: { ok: true, canonicalTarget: `/ws/${PROJECT_OVERRIDE_DIR}/ship.review.md`, exists: false },
        }),
      ]),
    }),
  );
  assert.notEqual(override.identity.planId, plain.identity.planId);
  assert.deepEqual(kinds(plain), ["payload-write"]);
  assert.deepEqual(kinds(override), ["override-write"]);
});

test("identity is INSENSITIVE to a finding's wording but SENSITIVE to its code and severity", () => {
  const original = completion({
    findings: [{ code: "plan/stale-evidence", severity: "warning", pluginId: "y@local", message: "lifecycle evidence compares as `root-moved`." }],
  });
  const reworded = completion({
    findings: [{ code: "plan/stale-evidence", severity: "warning", pluginId: "y@local", message: "Lifecycle evidence has drifted (root moved)." }],
  });
  assert.equal(
    completePlan(reworded).identity.planId,
    completePlan(original).identity.planId,
    "rewording a diagnostic must not invalidate an approved plan",
  );

  const escalated = completion({
    findings: [{ code: "plan/stale-evidence", severity: "error", pluginId: "y@local", message: "lifecycle evidence compares as `root-moved`." }],
  });
  assert.notEqual(completePlan(escalated).identity.planId, completePlan(original).identity.planId);
});

test("identity separates two different inadmissible roots", () => {
  const inadmissible = (reason: string): PlanCompletionInput =>
    completion({
      applicability: "invalid-root",
      workspaceRoot: null,
      admission: { admitted: false, root: null, source: "explicit", reason, diagnostic: reason },
    });
  assert.notEqual(
    completePlan(inadmissible("outside")).identity.planId,
    completePlan(inadmissible("nested")).identity.planId,
  );
});

// --- SC5: the ENVELOPE — one schema on BOTH response paths -------------------

test("the ordinary response carries the complete envelope on the frozen planVersion", () => {
  const out = planInstall(joinInput());
  assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION);
  assert.equal(out.byteInert, true);
  assert.equal(out.mode, "reconcile");
  assert.deepEqual(out.repairs, []);
  assert.equal(out.applicabilityBasis.applicability, out.applicability);
  assert.match(out.identity.planId, /^[0-9a-f]{64}$/);
  assert.deepEqual(out.identity.coveredFactClasses, [...PLAN_IDENTITY_FACT_CLASSES]);
});

test("the invalid-root early return carries the SAME schema, byte-inert, with a null mode", () => {
  const out = planInstall(
    joinInput({ admission: { admitted: false, root: null, source: "explicit", reason: "outside", diagnostic: "d" } }),
  );
  assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION);
  assert.equal(out.byteInert, true);
  assert.equal(out.applicability, "invalid-root");
  assert.equal(out.mode, null);
  assert.deepEqual(out.actions, []);
  assert.deepEqual(out.repairs, []);
  assert.equal(out.applicabilityBasis.blocked, false);
  assert.deepEqual(out.identity.coveredFactClasses, [...PLAN_IDENTITY_FACT_CLASSES]);
});

test("re-planning identical inputs reproduces an identical planId through the whole join", () => {
  assert.equal(planInstall(joinInput()).identity.planId, planInstall(joinInput()).identity.planId);
});

// --- SC6: applicability is PREDICATE-gated, never a silent no-op --------------

test("a binding-seed comparison WITH an observed proposal seeds and stays applicable", () => {
  const out = planInstall(
    joinInput({
      packs: [
        pack({
          state: "installed/inactive",
          registeredCapabilities: [],
          evidence: { comparison: "binding-seed", portable: portable(), binding: null },
          seedProposal: binding(),
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );

  assert.equal(out.evidenceSeeds.length, 1);
  assert.equal(out.applicability, "applicable");
  assert.equal(out.mode, "bootstrap");
  assert.ok(out.actions.some((action) => action.kind === "evidence-seed"));
});

test("a binding-seed comparison WITHOUT an observed proposal is an explicit non-applicable result", () => {
  const out = planInstall(
    joinInput({
      packs: [
        pack({
          evidence: { comparison: "binding-seed", portable: portable(), binding: null },
          seedProposal: null,
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );

  assert.deepEqual(out.evidenceSeeds, [], "the seed action is not applicable under a failed predicate");
  assert.deepEqual(
    out.findings.map((f) => f.code),
    ["plan/binding-proof-incomplete"],
    "the failure is stated, never silently omitted",
  );
  assert.equal(out.applicability, "not-applicable");
  assert.deepEqual(
    out.registryDelta.retentions.map((entry) => entry.reason),
    ["retained-binding-proof-incomplete"],
    "the registration is preserved on the fail-safe path",
  );
  assert.deepEqual(out.applicabilityBasis.blockingFindings.map((f) => f.code), ["plan/binding-proof-incomplete"]);
  assert.equal(out.applicabilityBasis.blocked, true);
});

test("an incomplete binding proof preserves an EXPLICIT deregistration too", () => {
  const out = planInstall(
    joinInput({
      packs: [
        pack({
          evidence: { comparison: "binding-seed", portable: portable(), binding: null },
          seedProposal: null,
        }),
      ],
      selection: { desired: [], deregister: ["wf-demo@local"], answers: [] },
    }),
  );
  assert.deepEqual(out.registryDelta.deregistrations, [], "preservation outranks removal");
  assert.deepEqual(
    out.registryDelta.retentions.map((entry) => entry.reason),
    ["retained-binding-proof-incomplete"],
  );
});

test("the legacy-bootstrap predicate keeps its own distinct retention reason", () => {
  const out = planInstall(
    joinInput({
      packs: [
        pack({ evidence: { comparison: "evidence-missing", portable: portable(), binding: null } }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.deepEqual(out.findings.map((f) => f.code), ["plan/legacy-proof-incomplete"]);
  assert.deepEqual(
    out.registryDelta.retentions.map((entry) => entry.reason),
    ["retained-legacy-proof-incomplete"],
    "the two proof failures stay distinguishable",
  );
});

// --- SC7: a drifted comparison makes the plan REPAIR-capable -----------------

test("a drifted comparison yields a previewed repair, an applicable plan, and repair mode", () => {
  const out = planInstall(
    joinInput({
      packs: [
        pack({
          overlay: "stale-version",
          evidence: { comparison: "portable-mismatch", portable: portable(), binding: binding() },
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );

  assert.deepEqual(out.findings.map((f) => f.code), ["plan/stale-evidence"]);
  assert.equal(out.repairs.length, 1);
  assert.deepEqual(out.repairs[0], {
    pluginId: "wf-demo@local",
    comparison: "portable-mismatch",
    scope: "portable",
    overlay: "stale-version",
    persisted: false,
  });
  assert.equal(out.mode, "repair");
  assert.equal(out.applicability, "applicable", "a plan carrying a repair is never no-change");
  assert.ok(out.actions.some((action) => action.kind === "evidence-repair" && action.mutating));
});

for (const [comparison, scope] of [
  ["portable-mismatch", "portable"],
  ["root-moved", "binding"],
  ["local-mismatch", "binding"],
] as const) {
  test(`a ${comparison} repair is scoped to the ${scope} half`, () => {
    const out = planInstall(
      joinInput({
        packs: [pack({ evidence: { comparison, portable: portable(), binding: binding() } })],
        selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
      }),
    );
    assert.equal(out.repairs[0].scope, scope);
  });
}

test("an equal comparison produces no repair and leaves the plan no-change", () => {
  const out = planInstall(
    joinInput({ selection: { desired: ["wf-demo@local"], deregister: [], answers: [] } }),
  );
  assert.deepEqual(out.repairs, []);
  assert.equal(out.applicability, "no-change");
  assert.equal(hasMutatingAction(out.actions), false);
});

test("an unacted-on pack's drift is not this plan's business", () => {
  const out = planInstall(
    joinInput({
      packs: [pack({ evidence: { comparison: "root-moved", portable: portable(), binding: binding() } })],
    }),
  );
  assert.deepEqual(out.repairs, [], "rule 1's acted-on scoping is inherited, not re-litigated");
  assert.equal(out.mode, "reconcile");
});

// --- SC8: a blocked answer still yields a complete, identifiable plan --------

test("an unresolved question blocks the plan and the basis names the question", () => {
  const out = planInstall(
    joinInput({
      packs: [pack({ questions: [question()] })],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );

  assert.equal(out.applicability, "blocked");
  assert.equal(out.applicabilityBasis.blocked, true);
  assert.deepEqual(out.applicabilityBasis.blockingQuestions.map((q) => q.questionId), ["team"]);
  assert.match(out.identity.planId, /^[0-9a-f]{64}$/);
});

test("a valid proposed answer becomes a previewed, non-persisted answer write", () => {
  const out = planInstall(
    joinInput({
      packs: [pack({ questions: [question()] })],
      selection: {
        desired: ["wf-demo@local"],
        deregister: [],
        answers: [{ pluginId: "wf-demo@local", questionId: "team", value: "core" }],
      },
    }),
  );

  assert.equal(out.answers.writes.length, 1);
  assert.equal(out.answers.writes[0].status, "pending", "planning binds an intent, never persistence");
  assert.equal(out.applicability, "applicable");
  const write = out.actions.find((action) => action.kind === "answer-write");
  assert.ok(write);
  assert.equal(write.destination, "team");
  assert.equal(write.persisted, false);
});
