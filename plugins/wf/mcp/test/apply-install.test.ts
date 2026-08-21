// The pure apply screening, gate, and registry rendering — contract tests (WF-453).
//
// Everything here runs with NO filesystem, NO lock, and NO ports, which is itself
// the point: the module under test is structurally incapable of creating a
// journal, a backup, or a byte, so "every refusal happens before journal creation
// or mutation" is proved by construction rather than by observing an absence.
//
// The write half is exercised in `apply-transaction.test.ts` (in-memory ports,
// the crash matrix) and `apply-ports.test.ts` (real filesystem).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  APPLY_DEFERRED_ACTION_KINDS,
  APPLY_SUPPORTED_ACTION_KINDS,
  APPLY_SUPPORTED_SEED_KINDS,
  decideApplyGate,
  renderRegistryMutation,
  screenPlanActions,
  type ApplyRegistryFact,
} from "../src/resolver/apply-install.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";
import { PLAN_ACTION_ORDER } from "../src/resolver/plan-complete.js";
import type {
  MachineBindingEvidence,
  PlanAction,
  PlanActionKind,
  PlanApplicability,
  PlanEvidenceSeed,
  PlanEvidenceSeedKind,
  PlanInstallResponse,
  PortablePackEvidence,
} from "../src/resolver/types.js";

const PLAN_ID = "f".repeat(64);

function portable(pluginId: string): PortablePackEvidence {
  return {
    pluginId,
    version: "1.0.0",
    capabilities: ["one"],
    manifestHashes: [],
    declaredSourceHashes: [],
  };
}

function binding(pluginId: string): MachineBindingEvidence {
  return {
    pluginId,
    canonicalRoot: "/packs/beta",
    cliScope: null,
    enablement: "enabled",
    observedVersion: "1.0.0",
    localFingerprints: [],
  };
}

function seed(kind: PlanEvidenceSeedKind, pluginId = "pack@1.0.0"): PlanEvidenceSeed {
  return {
    pluginId,
    kind,
    comparison: kind === "binding-seed" ? "binding-seed" : "evidence-missing",
    portable: kind === "legacy-bootstrap" ? portable(pluginId) : null,
    binding: binding(pluginId),
    persisted: false,
  };
}

function action(over: Partial<PlanAction> & { kind: PlanActionKind }): PlanAction {
  return {
    order: 0,
    pluginId: "pack@1.0.0",
    destination: null,
    mutating: true,
    summary: `${over.kind} summary`,
    persisted: false,
    ...over,
  };
}

/** A plan carrying only what the gate reads. The remaining envelope fields are
 *  filled with their empty forms so the fixture is a real `PlanInstallResponse`
 *  — the gate must never grow a dependency on a field this builder fakes. */
function plan(over: {
  actions?: PlanAction[];
  applicability?: PlanApplicability;
  planId?: string;
  admitted?: boolean;
  evidenceSeeds?: PlanEvidenceSeed[];
}): PlanInstallResponse {
  const admitted = over.admitted ?? true;
  const applicability = over.applicability ?? "applicable";
  return {
    planVersion: 1,
    workspaceRoot: admitted ? "/ws" : null,
    admission: admitted
      ? { admitted: true, root: "/ws", source: "explicit", reason: null, diagnostic: null }
      : {
          admitted: false,
          root: null,
          source: "explicit",
          reason: "not-a-directory",
          diagnostic: "the declared root is not a directory.",
        },
    applicability,
    mode: "install",
    registryDelta: { additions: [], retentions: [], deregistrations: [] },
    answers: { writes: [], unresolved: [] },
    evidenceSeeds: over.evidenceSeeds ?? [],
    repairs: [],
    payloads: { actions: [], rejected: [], conflicts: [] },
    artifacts: { deletable: [], retained: [], bootstrap: [], advance: [] },
    actions: over.actions ?? [action({ kind: "registry-add" })],
    findings: [],
    applicabilityBasis: {
      applicability,
      blockingFindings: [],
      blockingQuestions: [],
      blocked: false,
    },
    identity: {
      planId: over.planId ?? PLAN_ID,
      algorithm: "sha256",
      coveredFactClasses: [],
      factCount: 0,
    },
    inventory: { confidence: "trustworthy", mayEstablishAbsence: true, observedCount: 1, issues: [] },
    recovery: noRecoveryReport(),
    byteInert: true,
  };
}

// ---------------------------------------------------------------------------
// The closed action screen
// ---------------------------------------------------------------------------

test("the supported set is exactly one registration's four kinds, and the deferred set exactly the constitution", () => {
  assert.deepEqual(
    [...APPLY_SUPPORTED_ACTION_KINDS],
    ["evidence-seed", "registry-add", "registry-deregister", "answer-write"],
  );
  assert.deepEqual([...APPLY_DEFERRED_ACTION_KINDS], ["constitution-recompose"]);
  // The seed screen is the SECOND half of the action screen, because both seed
  // kinds wear the same `evidence-seed` action kind.
  assert.deepEqual([...APPLY_SUPPORTED_SEED_KINDS], ["binding-seed"]);
});

test("every mutating plan action kind outside the supported and deferred sets is unsupported", () => {
  // Driven off the FROZEN action order rather than a hand-listed set, so a kind
  // added upstream is screened by this test the moment it exists.
  const others = PLAN_ACTION_ORDER.filter(
    (kind) =>
      !APPLY_SUPPORTED_ACTION_KINDS.includes(kind) && !APPLY_DEFERRED_ACTION_KINDS.includes(kind),
  );
  assert.ok(others.length > 0, "the frozen action order must carry out-of-scope kinds");

  for (const kind of others) {
    const screened = screenPlanActions([action({ kind })]);
    assert.deepEqual(
      screened.unsupported.map((a) => a.kind),
      [kind],
      `\`${kind}\` must be screened as unsupported`,
    );
    assert.equal(screened.supported.length, 0);
    assert.equal(screened.deferred.length, 0);
  }
});

test("a NON-mutating action of any kind is retained, never applied and never refused", () => {
  for (const kind of PLAN_ACTION_ORDER) {
    const screened = screenPlanActions([action({ kind, mutating: false })]);
    assert.equal(screened.retained.length, 1, `\`${kind}\` retention`);
    assert.equal(screened.supported.length, 0);
    assert.equal(screened.unsupported.length, 0);
    assert.equal(screened.deferred.length, 0);
  }
});

test("the constitution recomposition is DEFERRED with a named follow-up, neither applied nor dropped", () => {
  const screened = screenPlanActions([
    action({ kind: "registry-add", order: 0 }),
    action({ kind: "constitution-recompose", order: 1, pluginId: null }),
  ]);
  assert.deepEqual(screened.supported.map((a) => a.kind), ["registry-add"]);
  assert.equal(screened.unsupported.length, 0);
  assert.equal(screened.deferred.length, 1);
  assert.equal(screened.deferred[0].kind, "constitution-recompose");
  assert.equal(screened.deferred[0].reason, "out-of-scope-constitution");
  assert.equal(screened.deferred[0].followUp, "/wf:constitution");
  assert.ok(screened.deferred[0].detail.length > 0);
});

test("screening preserves the plan's own canonical order", () => {
  const screened = screenPlanActions([
    action({ kind: "registry-add", order: 0, pluginId: "a@1" }),
    action({ kind: "registry-add", order: 1, pluginId: "b@1" }),
    action({ kind: "registry-deregister", order: 2, pluginId: "c@1" }),
  ]);
  assert.deepEqual(screened.supported.map((a) => a.order), [0, 1, 2]);
});

// ---------------------------------------------------------------------------
// The pre-journal gate
// ---------------------------------------------------------------------------

test("an exact, applicable, registry-only plan passes the gate", () => {
  const decision = decideApplyGate({
    plan: plan({}),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.equal(decision.ok, true);
  assert.ok(decision.ok && decision.screened.supported.length === 1);
});

test("an inadmissible root outranks every other refusal", () => {
  // Stale id AND not-applicable AND an unsupported action AND a journal — the
  // most fundamental refusal must still win.
  const decision = decideApplyGate({
    plan: plan({
      admitted: false,
      applicability: "invalid-root",
      planId: "0".repeat(64),
      actions: [action({ kind: "payload-write" })],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: true,
  });
  assert.equal(decision.ok, false);
  assert.ok(!decision.ok && decision.reason === "apply/invalid-root");
});

test("an unrecovered plan outranks the stale-identity and applicability refusals", () => {
  const decision = decideApplyGate({
    plan: plan({ applicability: "unrecovered", planId: "0".repeat(64) }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.reason === "apply/halted-unrecovered");
});

test("a journal surviving recovery refuses a second transaction over it", () => {
  const decision = decideApplyGate({
    plan: plan({}),
    expectedPlanId: PLAN_ID,
    journalPresent: true,
  });
  assert.ok(!decision.ok && decision.reason === "apply/journal-present");
});

test("a stale identity-bound precondition is refused as STALE, not as inapplicable", () => {
  // Both conditions hold. The stale plan is the story that explains the other, so
  // reporting the neighbour would send a maintainer chasing the wrong world.
  const decision = decideApplyGate({
    plan: plan({ applicability: "not-applicable", planId: "1".repeat(64) }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.reason === "apply/plan-stale");
  assert.ok(!decision.ok && decision.detail.includes(PLAN_ID));
  assert.ok(!decision.ok && decision.detail.includes("1".repeat(64)));
});

test("every non-applicable applicability is refused, exact identity notwithstanding", () => {
  for (const applicability of ["no-change", "blocked", "not-applicable"] as const) {
    const decision = decideApplyGate({
      plan: plan({ applicability }),
      expectedPlanId: PLAN_ID,
      journalPresent: false,
    });
    assert.ok(
      !decision.ok && decision.reason === "apply/plan-not-applicable",
      `\`${applicability}\` must be refused`,
    );
  }
});

test("an unsupported action refuses the WHOLE plan — a registry action alongside it is not applied", () => {
  const decision = decideApplyGate({
    plan: plan({
      actions: [
        action({ kind: "registry-add", order: 0 }),
        action({ kind: "artifact-delete", order: 1 }),
      ],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.reason === "apply/unsupported-action");
  assert.ok(!decision.ok && decision.detail.includes("artifact-delete"));
  // The supported action was screened but the gate refused, so nothing renders.
  assert.ok(!decision.ok && decision.screened.supported.length === 1);
});

test("THE ORDERING RULE: an unsupported kind refuses a plan carrying EVERY supported kind", () => {
  // The sharpest requirement on this item, stated at its widest: a plan carrying
  // all four supported kinds AND one unsupported one is refused as a whole. The
  // gate is pure, so "no supported subset was applied first" is proved by the
  // module being structurally incapable of applying anything at all — the refusal
  // is returned by the same call that would otherwise have authorized the write.
  const decision = decideApplyGate({
    plan: plan({
      actions: [
        action({ kind: "evidence-seed", order: 0 }),
        action({ kind: "registry-add", order: 1 }),
        action({ kind: "registry-deregister", order: 2 }),
        action({ kind: "answer-write", order: 3, destination: "beta.token" }),
        action({ kind: "payload-write", order: 4, destination: ".wf/thing.md" }),
      ],
      evidenceSeeds: [seed("binding-seed")],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });

  assert.ok(!decision.ok && decision.reason === "apply/unsupported-action");
  assert.ok(!decision.ok && decision.detail.includes("payload-write"));
  // All four supported actions WERE screened — and none of them can be applied,
  // because the gate did not return `ok`.
  assert.ok(!decision.ok && decision.screened.supported.length === 4);
});

test("EVERY out-of-scope kind refuses a plan that also carries a full supported set", () => {
  // Driven off the frozen action order so a kind added upstream is covered the
  // moment it exists — the same fail-closed posture as the screening test above,
  // but asserted at the GATE, which is the boundary the write half sits behind.
  const others = PLAN_ACTION_ORDER.filter(
    (kind) =>
      !APPLY_SUPPORTED_ACTION_KINDS.includes(kind) && !APPLY_DEFERRED_ACTION_KINDS.includes(kind),
  );
  for (const kind of others) {
    const decision = decideApplyGate({
      plan: plan({
        actions: [
          action({ kind: "registry-add", order: 0 }),
          action({ kind: "answer-write", order: 1, destination: "beta.token" }),
          action({ kind, order: 2 }),
        ],
      }),
      expectedPlanId: PLAN_ID,
      journalPresent: false,
    });
    assert.ok(
      !decision.ok && decision.reason === "apply/unsupported-action",
      `\`${kind}\` alongside a supported set must refuse the whole plan`,
    );
    assert.ok(!decision.ok && decision.detail.includes(kind));
  }
});

test("A LEGACY PORTABLE BOOTSTRAP is refused, though it wears a SUPPORTED action kind", () => {
  // The screen the action list alone cannot perform: both seed kinds are
  // integrated as `evidence-seed`, so only the seed FACTS distinguish them.
  const decision = decideApplyGate({
    plan: plan({
      actions: [
        action({ kind: "evidence-seed", order: 0 }),
        action({ kind: "registry-add", order: 1 }),
      ],
      evidenceSeeds: [seed("legacy-bootstrap")],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.reason === "apply/unsupported-action");
  assert.ok(!decision.ok && decision.detail.includes("legacy-bootstrap"));
  assert.ok(!decision.ok && decision.detail.includes("pack@1.0.0"));
  // The action screen saw nothing wrong — which is exactly why the seed screen
  // has to exist.
  assert.equal(decision.ok, false);
  assert.ok(!decision.ok && decision.screened.unsupported.length === 0);
});

test("a legacy bootstrap ANYWHERE in the seed list refuses, even beside an ordinary binding seed", () => {
  const decision = decideApplyGate({
    plan: plan({
      actions: [
        action({ kind: "evidence-seed", order: 0 }),
        action({ kind: "registry-add", order: 1 }),
      ],
      evidenceSeeds: [seed("binding-seed", "good@1"), seed("legacy-bootstrap", "legacy@1")],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.reason === "apply/unsupported-action");
  assert.ok(!decision.ok && decision.detail.includes("legacy@1"));
  assert.ok(!decision.ok && !decision.detail.includes("good@1"), "only the offender is named");
});

test("an ordinary binding seed passes the gate", () => {
  const decision = decideApplyGate({
    plan: plan({
      actions: [
        action({ kind: "evidence-seed", order: 0 }),
        action({ kind: "registry-add", order: 1 }),
      ],
      evidenceSeeds: [seed("binding-seed")],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.equal(decision.ok, true);
  assert.ok(decision.ok && decision.screened.supported.length === 2);
});

test("the ordering rule outranks nothing that is MORE fundamental", () => {
  // Rule 3 of the module header, re-asserted across the widened screen: a stale
  // plan carrying an unsupported kind reports STALE, because the moved world is
  // the story that explains everything else.
  const decision = decideApplyGate({
    plan: plan({
      planId: "1".repeat(64),
      actions: [
        action({ kind: "registry-add", order: 0 }),
        action({ kind: "payload-write", order: 1 }),
      ],
      evidenceSeeds: [seed("legacy-bootstrap")],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.reason === "apply/plan-stale");
});

test("a plan whose only mutating action is the deferred one has nothing to apply", () => {
  const decision = decideApplyGate({
    plan: plan({ actions: [action({ kind: "constitution-recompose", pluginId: null })] }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.reason === "apply/plan-not-applicable");
});

test("the gate carries the screening buckets on every path, so a refusal still names its deferrals", () => {
  const decision = decideApplyGate({
    plan: plan({
      applicability: "blocked",
      actions: [
        action({ kind: "registry-add", order: 0 }),
        action({ kind: "constitution-recompose", order: 1, pluginId: null }),
      ],
    }),
    expectedPlanId: PLAN_ID,
    journalPresent: false,
  });
  assert.ok(!decision.ok && decision.screened.deferred.length === 1);
});

// ---------------------------------------------------------------------------
// Registry rendering
// ---------------------------------------------------------------------------

const REGISTRY = [
  "# Project config",
  "",
  "Prose that must survive byte-for-byte.",
  "",
  "## Plugin Roots",
  "",
  "| Plugin | Root |",
  "| ------ | ------ |",
  "| alpha | /packs/alpha |",
  "",
  "## Capabilities",
  "",
  "| Capability | Path |",
  "| ------ | ------ |",
  "| alpha-one | plugin:alpha/capabilities/one |",
  "",
  "## Core",
  "",
  "- Task Root: `_local`",
  "",
].join("\n");

function facts(...entries: ApplyRegistryFact[]): Map<string, ApplyRegistryFact> {
  return new Map(entries.map((fact) => [fact.pluginId, fact]));
}

test("an addition writes the plugin root row and one capability row per capability", () => {
  const result = renderRegistryMutation(
    REGISTRY,
    [action({ kind: "registry-add", pluginId: "beta@2" })],
    facts({
      pluginId: "beta@2",
      pluginName: "beta",
      installPath: "/packs/beta",
      capabilities: [
        { name: "beta-one", path: "plugin:beta/capabilities/one" },
        { name: "beta-two", path: "plugin:beta/capabilities/two" },
      ],
    }),
  );
  assert.ok(result.ok);
  assert.ok(result.ok && result.changed);
  assert.ok(result.ok && result.content.includes("| beta | /packs/beta |"));
  assert.ok(result.ok && result.content.includes("| beta-one | plugin:beta/capabilities/one |"));
  assert.ok(result.ok && result.content.includes("| beta-two | plugin:beta/capabilities/two |"));
  // Narrow by construction: the untouched rows, prose, and other sections survive.
  assert.ok(result.ok && result.content.includes("Prose that must survive byte-for-byte."));
  assert.ok(result.ok && result.content.includes("| alpha | /packs/alpha |"));
  assert.ok(result.ok && result.content.includes("- Task Root: `_local`"));
});

test("a deregistration removes exactly the rows the REGISTRY attributes to the pack", () => {
  const result = renderRegistryMutation(
    REGISTRY,
    [action({ kind: "registry-deregister", pluginId: "alpha@1" })],
    facts({
      pluginId: "alpha@1",
      pluginName: "alpha",
      installPath: null,
      capabilities: [{ name: "alpha-one", path: "" }],
    }),
  );
  assert.ok(result.ok);
  assert.ok(result.ok && result.changed);
  assert.ok(result.ok && !result.content.includes("| alpha-one |"));
  assert.ok(result.ok && !result.content.includes("| alpha | /packs/alpha |"));
  // The emptied table is left in place — a header-only Capabilities table IS the
  // fully generic core state.
  assert.ok(result.ok && result.content.includes("| Capability | Path |"));
  assert.ok(result.ok && result.content.includes("## Capabilities"));
});

test("rendering is idempotent — re-rendering an already-applied plan reports no change", () => {
  const add = [action({ kind: "registry-add", pluginId: "beta@2" })];
  const fact = facts({
    pluginId: "beta@2",
    pluginName: "beta",
    installPath: "/packs/beta",
    capabilities: [{ name: "beta-one", path: "plugin:beta/capabilities/one" }],
  });
  const first = renderRegistryMutation(REGISTRY, add, fact);
  assert.ok(first.ok && first.changed);
  const second = renderRegistryMutation(first.ok ? first.content : "", add, fact);
  assert.ok(second.ok);
  assert.equal(second.ok && second.changed, false);
  assert.equal(second.ok && second.content, first.ok ? first.content : "");
});

test("rendering is deterministic — two runs over the same plan produce identical bytes", () => {
  const actions = [
    action({ kind: "registry-add", order: 0, pluginId: "beta@2" }),
    action({ kind: "registry-deregister", order: 1, pluginId: "alpha@1" }),
  ];
  const fact = facts(
    {
      pluginId: "beta@2",
      pluginName: "beta",
      installPath: "/packs/beta",
      capabilities: [{ name: "beta-one", path: "plugin:beta/capabilities/one" }],
    },
    {
      pluginId: "alpha@1",
      pluginName: "alpha",
      installPath: null,
      capabilities: [{ name: "alpha-one", path: "" }],
    },
  );
  const left = renderRegistryMutation(REGISTRY, actions, fact);
  const right = renderRegistryMutation(REGISTRY, actions, fact);
  assert.ok(left.ok && right.ok);
  assert.equal(left.ok && left.content, right.ok ? right.content : "<not-ok>");
});

test("an action with no pack attribution is unresolvable, never guessed at", () => {
  const result = renderRegistryMutation(
    REGISTRY,
    [action({ kind: "registry-add", pluginId: null })],
    facts(),
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "apply/registry-unresolvable");
});

test("an action naming a pack with no supplied fact is unresolvable", () => {
  const result = renderRegistryMutation(
    REGISTRY,
    [action({ kind: "registry-add", pluginId: "ghost@1" })],
    facts(),
  );
  assert.ok(!result.ok && result.reason === "apply/registry-unresolvable");
  assert.ok(!result.ok && result.detail.includes("ghost@1"));
});

test("an addition with no install root or no capabilities is unresolvable, not a blank row", () => {
  const noRoot = renderRegistryMutation(
    REGISTRY,
    [action({ kind: "registry-add", pluginId: "beta@2" })],
    facts({
      pluginId: "beta@2",
      pluginName: "beta",
      installPath: null,
      capabilities: [{ name: "beta-one", path: "p" }],
    }),
  );
  assert.ok(!noRoot.ok && noRoot.reason === "apply/registry-unresolvable");

  const noCaps = renderRegistryMutation(
    REGISTRY,
    [action({ kind: "registry-add", pluginId: "beta@2" })],
    facts({
      pluginId: "beta@2",
      pluginName: "beta",
      installPath: "/packs/beta",
      capabilities: [],
    }),
  );
  assert.ok(!noCaps.ok && noCaps.reason === "apply/registry-unresolvable");
});

test("a deregistration of a pack contributing no capability names removes only its root row", () => {
  // The fail-safe direction: removing a capability row the registry does not
  // attribute to this pack would deregister something the plan never named.
  const result = renderRegistryMutation(
    REGISTRY,
    [action({ kind: "registry-deregister", pluginId: "alpha@1" })],
    facts({ pluginId: "alpha@1", pluginName: "alpha", installPath: null, capabilities: [] }),
  );
  assert.ok(result.ok);
  assert.ok(result.ok && !result.content.includes("| alpha | /packs/alpha |"));
  assert.ok(result.ok && result.content.includes("| alpha-one | plugin:alpha/capabilities/one |"));
});

test("removing an absent row is a no-op, so a re-entered transaction converges", () => {
  const deregister = [action({ kind: "registry-deregister", pluginId: "alpha@1" })];
  const fact = facts({
    pluginId: "alpha@1",
    pluginName: "alpha",
    installPath: null,
    capabilities: [{ name: "alpha-one", path: "" }],
  });
  const first = renderRegistryMutation(REGISTRY, deregister, fact);
  assert.ok(first.ok && first.changed);
  const second = renderRegistryMutation(first.ok ? first.content : "", deregister, fact);
  assert.ok(second.ok);
  assert.equal(second.ok && second.changed, false);
});
