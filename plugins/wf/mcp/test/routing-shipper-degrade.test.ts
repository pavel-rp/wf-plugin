import assert from "node:assert/strict";
import test from "node:test";
import { resolveRouting, projectRoutingMeasurement } from "../src/resolver/routing.js";
import type { RoutingDecision, RoutingInsufficiencySignal, RoutingShapeEvidence } from "../src/resolver/types.js";

// WF-743. An unpinned fleet shipper resolves to the top tier from a static
// default, and a host that genuinely lacks that tier degrades it exactly one tier,
// at most once, through the shipper-only `model-unavailable` postAttempt signal —
// never hard-failing the item solely for want of the tier.

/** The one-item wave evidence `fleet` states for an `isolated` singleton. */
const singletonEvidence: RoutingShapeEvidence = {
  workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
  ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment",
  contextIsolation: "required", independentReview: false,
  returnContract: "mechanically-judgeable", requestedParallelism: 1,
};

const initial = (overrides: Record<string, unknown> = {}) => resolveRouting({}, {
  role: "shipper", shapeEvidence: singletonEvidence, unitIds: ["unit-a1"],
  supportsModelSelector: true, supportsEffortSelector: false,
  ...overrides,
});

const priorOf = (decision: RoutingDecision, unitIds = decision.unitIds) => ({
  role: decision.role, attempt: decision.attempt, executionShape: decision.executionShape,
  shapeEvidence: decision.normalizedEvidence, unitIds, model: decision.model, effort: decision.effort,
  basis: decision.basis, escalationOrigin: decision.escalationOrigin,
  ...(decision.actualModel ? { actualModel: decision.actualModel } : {}),
});

const report = (
  prior: RoutingDecision,
  signals: RoutingInsufficiencySignal[],
  overrides: Record<string, unknown> = {},
) => resolveRouting({}, {
  role: prior.role, shapeEvidence: prior.normalizedEvidence, unitIds: prior.unitIds,
  supportsModelSelector: true, supportsEffortSelector: false,
  postAttempt: { sufficient: false, signals, prior: priorOf(prior) },
  ...overrides,
});

test("WF-743: an unpinned shipper resolves the static top tier", () => {
  const decision = initial();
  assert.equal(decision.status, "dispatch");
  assert.equal(decision.model.value, "opus");
  assert.equal(decision.model.source, "shipped-default");
  assert.equal(decision.model.masked, false);
  assert.equal(decision.model.fallback, null);
  assert.equal(decision.carried, false);
});

test("WF-743: `model-unavailable` steps a shipper down exactly one tier and spends the retry", () => {
  const first = initial();
  const retry = report(first, ["model-unavailable"]);
  assert.equal(retry.status, "dispatch");
  assert.equal(retry.disposition, "retry");
  assert.equal(retry.diagnostic, null, "a retry carrying a diagnostic would make callers drop the work");
  assert.equal(retry.model.value, "sonnet");
  assert.equal(retry.attempt, 2, "the step-down consumes the item's one retry");
  assert.equal(retry.retry?.escalation, "lower-stable-tier");
  assert.equal(retry.retry?.priorTier, "opus");
  assert.equal(retry.retry?.nextTier, "sonnet");
  assert.deepEqual(retry.retry?.signals, ["model-unavailable"]);
  assert.match(retry.escalationOrigin ?? "", /model-unavailable/, "the record names the step-down");
  const measurement = projectRoutingMeasurement(retry);
  assert.equal(measurement.escalation, "lower-stable-tier");
  assert.equal(measurement.model, "sonnet");
});

test("WF-743: a second `model-unavailable` for the same item stops `exhausted`, never stepping down again", () => {
  const retry = report(initial(), ["model-unavailable"]);
  const second = report(retry, ["model-unavailable"]);
  assert.equal(second.status, "stop");
  assert.equal(second.disposition, "exhausted");
  assert.equal(second.retry, null);
  assert.equal(second.model.value, "sonnet", "the stopped record restates the prior, not a lower tier");
  assert.match(second.diagnostic ?? "", /at most once per item/);
});

test("WF-743: a degraded item that later halts finds its retry budget already spent", () => {
  const retry = report(initial(), ["model-unavailable"]);
  const halted = report(retry, ["repeated-failure"]);
  assert.equal(halted.status, "stop");
  assert.equal(halted.disposition, "exhausted");
  assert.equal(halted.retry, null);
});

test("WF-743: any non-shipper role submitting `model-unavailable` is an invalid stop", () => {
  const cases: Array<{ role: string; shapeEvidence: RoutingShapeEvidence; unitIds: string[] }> = [
    { role: "phase-runner", shapeEvidence: singletonEvidence, unitIds: ["run:phase"] },
    { role: "finalize", shapeEvidence: singletonEvidence, unitIds: ["ship:finalize"] },
    { role: "classify", shapeEvidence: singletonEvidence, unitIds: ["classify:single"] },
    { role: "security-auditor", shapeEvidence: singletonEvidence, unitIds: ["lens:security"] },
  ];
  for (const { role, shapeEvidence, unitIds } of cases) {
    const first = resolveRouting({}, {
      role, shapeEvidence, unitIds, supportsModelSelector: true, supportsEffortSelector: false,
    });
    const refused = report(first, ["model-unavailable"]);
    assert.equal(refused.status, "stop", role);
    assert.equal(refused.disposition, "invalid-stop", role);
    assert.equal(refused.retry, null, role);
    assert.match(refused.diagnostic ?? "", /valid only for role `shipper`/, role);
  }
});

test("WF-743: `model-unavailable` beside another signal still steps the whole retry down", () => {
  const retry = report(initial(), ["model-unavailable", "repeated-failure"]);
  assert.equal(retry.status, "dispatch");
  assert.equal(retry.disposition, "retry");
  assert.equal(retry.model.value, "sonnet");
  assert.equal(retry.retry?.escalation, "lower-stable-tier");
});

test("WF-743: a prior forging a lower shipped default is refused, never walked further down", () => {
  const genuine = initial();
  const forgedModel = { ...genuine.model, value: "sonnet", requested: "sonnet" };
  const refused = resolveRouting({}, {
    role: "shipper", shapeEvidence: genuine.normalizedEvidence, unitIds: genuine.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: ["model-unavailable"],
      prior: { ...priorOf(genuine), model: forgedModel },
    },
  });
  assert.equal(refused.status, "stop");
  assert.equal(refused.disposition, "invalid-stop");
  assert.equal(refused.retry, null);
  assert.match(refused.diagnostic ?? "", /claims a shipped default of `sonnet`/);
});

test("WF-743: a masked or mismatched `actualModel` alone never triggers a retry", () => {
  const masked = initial({ hostModel: "sonnet" });
  assert.equal(masked.model.value, "sonnet");
  assert.equal(masked.model.masked, true, "the mismatch is recorded, not acted on");
  assert.equal(masked.disposition, "dispatch");
  assert.equal(masked.retry, null);

  const mismatched = initial({ actualModel: "claude-sonnet-5" });
  assert.equal(mismatched.disposition, "dispatch");
  assert.equal(mismatched.retry, null);
  assert.equal(projectRoutingMeasurement(mismatched).actualModel, "claude-sonnet-5");

  // A successful attempt that reports a different model is simply retained.
  const retained = resolveRouting({}, {
    role: "shipper", shapeEvidence: mismatched.normalizedEvidence, unitIds: mismatched.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: { sufficient: true, signals: [], prior: priorOf(mismatched) },
  });
  assert.equal(retained.disposition, "retain");
  assert.equal(retained.retry, null);
});

test("WF-743: a `--model` pin outranks the static default and is never stepped down", () => {
  const pinned = initial({ invocationModel: "opus" });
  assert.equal(pinned.model.value, "opus");
  assert.equal(pinned.model.source, "invocation");
  const refused = report(pinned, ["model-unavailable"], { invocationModel: "opus" });
  assert.equal(refused.status, "stop");
  assert.equal(refused.disposition, "invalid-stop");
  assert.match(refused.diagnostic ?? "", /only a delivered shipped-default selection/);

  const cheaper = initial({ invocationModel: "sonnet" });
  assert.equal(cheaper.model.value, "sonnet");
  assert.equal(cheaper.model.source, "invocation");
});

test("WF-743: the step-down never lowers past the bottom tier or reaches past host enforcement", () => {
  // A project row that sets the shipper to the bottom tier is stated intent, not a
  // shipped default, so it is refused on provenance before the tier is consulted.
  const project = { shipper: { model: "haiku", effort: null } };
  const bottom = resolveRouting(project, {
    role: "shipper", shapeEvidence: singletonEvidence, unitIds: ["unit-a1"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(bottom.model.source, "project");
  const refused = resolveRouting(project, {
    role: "shipper", shapeEvidence: bottom.normalizedEvidence, unitIds: bottom.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: { sufficient: false, signals: ["model-unavailable"], prior: priorOf(bottom) },
  });
  assert.equal(refused.disposition, "invalid-stop");

  // A host pin that masks the stepped-down tier is an integrity failure, as for an
  // upward advance.
  const masked = report(initial(), ["model-unavailable"], { hostModel: "opus" });
  assert.equal(masked.status, "stop");
  assert.equal(masked.disposition, "invalid-stop");
  assert.match(masked.diagnostic ?? "", /masked by host enforcement/);
});

test("WF-743: a host-masked prior never dispatched the default tier, so it cannot step down", () => {
  // The host delivered `sonnet` although the shipped default requested `opus`; a
  // `model-unavailable` report must not walk that delivered tier further down.
  const hostMasked = initial({ hostModel: "sonnet" });
  assert.equal(hostMasked.model.source, "host");
  assert.equal(hostMasked.model.requestedSource, "shipped-default");
  const refused = report(hostMasked, ["model-unavailable"]);
  assert.equal(refused.status, "stop");
  assert.equal(refused.disposition, "invalid-stop");
  assert.match(refused.diagnostic ?? "", /the prior was `host`/);
});

test("WF-743: a forged shipped-default prior with a divergent requested source, delivered value, masking, or a fallback cannot step down", () => {
  const genuine = initial();
  const forgeries = [
    { ...genuine.model, requestedSource: "invocation" as const },
    { ...genuine.model, value: "sonnet" },
    { ...genuine.model, masked: true },
    { ...genuine.model, fallback: "unavailable" as const },
  ];
  for (const model of forgeries) {
    const refused = report({ ...genuine, model }, ["model-unavailable"]);
    assert.equal(refused.status, "stop");
    assert.equal(refused.disposition, "invalid-stop");
    assert.match(refused.diagnostic ?? "", /different requested source, a different delivered value, masking, or a fallback/);
  }
});

test("WF-743: a bounded-parallel wave steps down only the units that reported it", () => {
  const waveEvidence: RoutingShapeEvidence = {
    ...singletonEvidence, atomicity: "composite", unitCount: 2, unitsIndependent: true, requestedParallelism: 2,
  };
  const wave = resolveRouting({}, {
    role: "shipper", shapeEvidence: waveEvidence, unitIds: ["unit-a1", "unit-b2"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(wave.executionShape, "bounded-parallel");
  assert.equal(wave.model.value, "opus");
  const retry = resolveRouting({}, {
    role: "shipper", shapeEvidence: wave.normalizedEvidence, unitIds: wave.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: [], prior: priorOf(wave),
      units: [
        { unitId: "unit-a1", sufficient: true, signals: [] },
        { unitId: "unit-b2", sufficient: false, signals: ["model-unavailable"] },
      ],
    },
  });
  assert.equal(retry.disposition, "retry");
  assert.deepEqual(retry.retainedUnitIds, ["unit-a1"]);
  assert.deepEqual(retry.retry?.unitIds, ["unit-b2"]);
  assert.equal(retry.model.value, "sonnet");
  assert.equal(retry.retry?.escalation, "lower-stable-tier");
});

test("WF-743: a mixed-failure wave retries every failed unit one tier down", () => {
  const waveEvidence: RoutingShapeEvidence = {
    ...singletonEvidence, atomicity: "composite", unitCount: 3, unitsIndependent: true, requestedParallelism: 3,
  };
  const wave = resolveRouting({}, {
    role: "shipper", shapeEvidence: waveEvidence, unitIds: ["unit-a1", "unit-b2", "unit-c3"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  const retry = resolveRouting({}, {
    role: "shipper", shapeEvidence: wave.normalizedEvidence, unitIds: wave.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: [], prior: priorOf(wave),
      units: [
        { unitId: "unit-a1", sufficient: true, signals: [] },
        { unitId: "unit-b2", sufficient: false, signals: ["model-unavailable"] },
        { unitId: "unit-c3", sufficient: false, signals: ["repeated-failure"] },
      ],
    },
  });
  assert.equal(retry.status, "dispatch");
  assert.equal(retry.disposition, "retry");
  assert.deepEqual(retry.retainedUnitIds, ["unit-a1"]);
  assert.deepEqual(retry.retry?.unitIds, ["unit-b2", "unit-c3"]);
  assert.equal(retry.model.value, "sonnet");
  assert.equal(retry.retry?.escalation, "lower-stable-tier");
});

test("WF-743: every other role's ordinary retry is unchanged", () => {
  // The upward lever still advances one tier for a derivation-eligible role.
  const first = resolveRouting({}, {
    role: "phase-runner", shapeEvidence: singletonEvidence, unitIds: ["run:phase"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  const retry = report(first, ["failed-validation"]);
  assert.equal(retry.disposition, "retry");
  assert.equal(retry.retry?.escalation, "next-stable-tier");
  assert.equal(retry.retry?.nextTier, "opus");
  // And a shipper reporting an ordinary failure at the top tier re-runs there.
  const top = report(initial(), ["repeated-failure"]);
  assert.equal(top.disposition, "retry");
  assert.equal(top.retry?.escalation, "top-tier");
  assert.equal(top.retry?.nextTier, null);
  assert.equal(top.model.value, "opus");
});
