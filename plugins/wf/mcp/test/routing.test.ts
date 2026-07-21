import assert from "node:assert/strict";
import test from "node:test";
import { parseRoutingConfig } from "../src/resolver/config.js";
import { resolveRouting } from "../src/resolver/routing.js";
import type { RoutingDecision, RoutingInsufficiencySignal, RoutingPostAttemptEvaluation } from "../src/resolver/types.js";

const inlineEvidence = {
  workSurface: "caller-context",
  atomicity: "atomic",
  unitCount: 1,
  unitsIndependent: false,
  ambiguity: "none",
  risk: "low",
  toolWork: "none",
  validation: "mechanical",
  contextIsolation: "none",
  independentReview: false,
  returnContract: "mechanically-judgeable",
  requestedParallelism: 1,
} as const;

const base = { role: "classify", shapeEvidence: inlineEvidence, supportsModelSelector: true, supportsEffortSelector: false } as const;

test("parses arbitrary routing roles with independent optional cells", () => {
  assert.deepEqual(parseRoutingConfig("## Routing\n\n| Role | Model | Effort |\n|---|---|---|\n| classify | sonnet | — |\n| custom-role | — | high |\n"), {
    classify: { model: "sonnet", effort: null },
    "custom-role": { model: null, effort: "high" },
  });
});

test("ships haiku defaults only for bootstrap roles", () => {
  assert.equal(resolveRouting({}, base).model.value, "haiku");
  assert.equal(resolveRouting({}, { ...base, role: "branch" }).model.value, "haiku");
  assert.equal(resolveRouting({}, { ...base, role: "other" }).model.value, null);
});

test("resolves invocation over project over default and model independently from effort", () => {
  const decision = resolveRouting({ classify: { model: "sonnet", effort: "high" } }, {
    ...base, invocationModel: "opus", supportsEffortSelector: true,
  });
  assert.deepEqual([decision.model.value, decision.model.source], ["opus", "invocation"]);
  assert.deepEqual([decision.effort.value, decision.effort.source], ["high", "project"]);
});

test("host enforcement masks lower choices", () => {
  const decision = resolveRouting({}, { ...base, invocationModel: "sonnet", hostModel: "opus" });
  assert.equal(decision.model.value, "opus");
  assert.equal(decision.model.source, "host");
  assert.equal(decision.model.masked, true);
});

test("unsupported selectors inherit unless required", () => {
  const fallback = resolveRouting({}, { ...base, supportsModelSelector: false });
  assert.equal(fallback.status, "dispatch");
  assert.equal(fallback.model.fallback, "selector-unsupported");
  assert.equal(fallback.model.value, null);
  const stop = resolveRouting({}, { ...base, supportsModelSelector: false, requireModel: true });
  assert.equal(stop.status, "stop");
});

test("unavailable required model stops and actual model is only included when supplied", () => {
  const decision = resolveRouting({}, { ...base, availableModels: ["sonnet"], requireModel: true });
  assert.equal(decision.status, "stop");
  assert.equal(decision.model.fallback, "unavailable");
  assert.equal("actualModel" in decision, false);
  assert.equal(resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5" }).actualModel, "claude-haiku-4-5");
});

test("selects execution shape deterministically from task evidence", () => {
  const cases = [
    { name: "atomic caller-context work", evidence: inlineEvidence, shape: "inline", reason: "atomic-caller-context", bound: 1 },
    { name: "one-row bookkeeping", evidence: { ...inlineEvidence }, shape: "inline", reason: "atomic-caller-context", bound: 1 },
    {
      name: "one isolation-worthy unit",
      evidence: { ...inlineEvidence, workSurface: "external-context", toolWork: "material", contextIsolation: "useful" },
      shape: "isolated", reason: "single-isolation-worthy-unit", bound: 1,
    },
    {
      name: "independent material units",
      evidence: { ...inlineEvidence, atomicity: "composite", unitCount: 7, unitsIndependent: true, toolWork: "material", contextIsolation: "useful", requestedParallelism: 6 },
      shape: "bounded-parallel", reason: "independent-material-units", bound: 4,
    },
    {
      name: "independent trivial units",
      evidence: { ...inlineEvidence, atomicity: "composite", unitCount: 3, unitsIndependent: true, requestedParallelism: 3 },
      shape: "inline", reason: "nonmaterial-units-inline", bound: 1,
    },
    {
      name: "dependent material units",
      evidence: { ...inlineEvidence, atomicity: "composite", unitCount: 3, toolWork: "material", requestedParallelism: 3 },
      shape: "isolated", reason: "dependent-or-nonmaterial-units", bound: 1,
    },
    {
      name: "non-judgeable independent units",
      evidence: { ...inlineEvidence, atomicity: "composite", unitCount: 3, unitsIndependent: true, toolWork: "material", returnContract: "judgment", requestedParallelism: 3 },
      shape: "isolated", reason: "dependent-or-nonmaterial-units", bound: 1,
    },
  ] as const;
  for (const row of cases) {
    const decision = resolveRouting({}, { ...base, shapeEvidence: row.evidence });
    assert.deepEqual(
      [decision.executionShape, decision.shapeReason, decision.effectiveParallelism],
      [row.shape, row.reason, row.bound],
      row.name,
    );
    assert.deepEqual(decision.normalizedEvidence, row.evidence, row.name);
  }
});

test("caps parallelism by units, request, and the core maximum", () => {
  const evidence = { ...inlineEvidence, atomicity: "composite", unitCount: 3, unitsIndependent: true, toolWork: "material", requestedParallelism: 2 } as const;
  assert.equal(resolveRouting({}, { ...base, shapeEvidence: evidence }).effectiveParallelism, 2);
});

test("a caller bound of one never selects parallel execution", () => {
  const evidence = {
    ...inlineEvidence,
    atomicity: "composite",
    unitCount: 3,
    unitsIndependent: true,
    toolWork: "material",
    requestedParallelism: 1,
  } as const;
  const decision = resolveRouting({}, { ...base, shapeEvidence: evidence });
  assert.equal(decision.executionShape, "isolated");
  assert.equal(decision.effectiveParallelism, 1);
});

test("contradictory shape evidence stops without changing selector decisions", () => {
  const decision = resolveRouting({}, {
    ...base,
    shapeEvidence: { ...inlineEvidence, atomicity: "atomic", unitCount: 2 },
  });
  assert.equal(decision.status, "stop");
  assert.match(decision.diagnostic ?? "", /atomic work must contain exactly one unit/);
  assert.equal(decision.model.value, "haiku");
  assert.equal(decision.model.source, "shipped-default");
});

test("incomplete or legacy shape inputs stop with specific diagnostics", () => {
  const incomplete = resolveRouting({}, {
    ...base,
    shapeEvidence: { ...inlineEvidence, contextIsolation: undefined },
  } as unknown as Parameters<typeof resolveRouting>[1]);
  assert.equal(incomplete.status, "stop");
  assert.match(incomplete.diagnostic ?? "", /contextIsolation must be one of/);

  const legacy = resolveRouting({}, {
    role: "classify",
    executionShape: "task",
    supportsModelSelector: true,
    supportsEffortSelector: false,
  } as unknown as Parameters<typeof resolveRouting>[1]);
  assert.equal(legacy.status, "stop");
  assert.match(legacy.diagnostic ?? "", /shape evidence is required/);
});

test("malformed choices inherit unless required", () => {
  const fallback = resolveRouting({ classify: { model: "bad model", effort: null } }, base);
  assert.equal(fallback.status, "dispatch");
  assert.equal(fallback.model.value, null);
  assert.equal(fallback.model.fallback, "malformed");
  const stop = resolveRouting({ classify: { model: "bad model", effort: null } }, { ...base, requireModel: true });
  assert.equal(stop.status, "stop");
  assert.equal(stop.model.fallback, "malformed");
});

function prior(decision: RoutingDecision, attempt = 1): RoutingPostAttemptEvaluation["prior"] {
  return {
    role: decision.role,
    attempt,
    executionShape: decision.executionShape,
    shapeEvidence: decision.normalizedEvidence,
    model: decision.model,
    effort: decision.effort,
    basis: decision.basis,
    escalationOrigin: attempt > 1 ? "routing:test:attempt-1" : null,
    ...(decision.actualModel ? { actualModel: decision.actualModel } : {}),
  };
}

function evaluated(signal: RoutingInsufficiencySignal, overrides: Partial<RoutingPostAttemptEvaluation> = {}): RoutingPostAttemptEvaluation {
  const first = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5" });
  return { sufficient: false, signals: [signal], prior: prior(first), ...overrides };
}

test("all six insufficiency signals independently produce one Haiku to Sonnet retry", () => {
  const signals: RoutingInsufficiencySignal[] = [
    "low-confidence",
    "failed-validation",
    "conflicting-or-incomplete-evidence",
    "repeated-failure",
    "increased-risk-or-scope",
    "high-severity-review-uncertainty",
  ];
  for (const signal of signals) {
    const decision = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5", postAttempt: evaluated(signal) });
    assert.equal(decision.status, "dispatch", signal);
    assert.equal(decision.disposition, "retry", signal);
    assert.equal(decision.attempt, 2, signal);
    assert.equal(decision.model.value, "sonnet", signal);
    assert.equal(decision.model.source, "invocation", signal);
    assert.equal(decision.retry?.priorTier, "haiku", signal);
    assert.equal(decision.retry?.nextTier, "sonnet", signal);
    assert.deepEqual(decision.retry?.signals, [signal], signal);
    assert.ok(decision.retry?.escalationOrigin, signal);
    assert.equal(decision.effort.value, null, signal);
  }
});

test("sufficient attempts are terminal retains and never emit a retry", () => {
  const first = resolveRouting({}, base);
  const decision = resolveRouting({}, {
    ...base,
    supportsModelSelector: false,
    requireModel: true,
    postAttempt: { sufficient: true, signals: [], prior: prior(first) },
  });
  assert.equal(decision.status, "retain");
  assert.equal(decision.disposition, "retain");
  assert.equal(decision.retry, null);
});

test("bounded-parallel evaluation retains successful units and retries only insufficient units", () => {
  const evidence = {
    ...inlineEvidence,
    atomicity: "composite",
    unitCount: 3,
    unitsIndependent: true,
    toolWork: "material",
    contextIsolation: "useful",
    requestedParallelism: 3,
  } as const;
  const first = resolveRouting({}, { ...base, shapeEvidence: evidence, actualModel: "haiku" });
  const decision = resolveRouting({}, {
    ...base,
    shapeEvidence: evidence,
    postAttempt: {
      sufficient: false,
      signals: [],
      prior: prior(first),
      units: [
        { unitId: "a", sufficient: true, signals: [] },
        { unitId: "b", sufficient: false, signals: ["failed-validation"] },
        { unitId: "c", sufficient: true, signals: [] },
      ],
    },
  });
  assert.equal(decision.disposition, "retry");
  assert.deepEqual(decision.retainedUnitIds, ["a", "c"]);
  assert.deepEqual(decision.retry?.unitIds, ["b"]);
  assert.equal(decision.executionShape, "isolated");
  assert.equal(decision.normalizedEvidence.unitCount, 1);
  assert.equal(decision.normalizedEvidence.atomicity, "atomic");
  assert.equal(decision.retry?.shapeChanged, true);
});

test("default and security-auditor role policies exhaust at their shipped limits", () => {
  const first = resolveRouting({}, { ...base, actualModel: "haiku" });
  const sonnet = resolveRouting({}, {
    ...base,
    postAttempt: evaluated("low-confidence", { prior: prior(first) }),
  });
  const exhausted = resolveRouting({}, {
    ...base,
    attempt: 2,
    postAttempt: {
      sufficient: false,
      signals: ["repeated-failure"],
      prior: prior(sonnet, 2),
    },
  });
  assert.equal(exhausted.disposition, "exhausted");
  assert.equal(exhausted.retry, null);

  const securityFirst = resolveRouting({}, {
    ...base,
    role: "security-auditor",
    invocationModel: "haiku",
    actualModel: "haiku",
  });
  const security = resolveRouting({}, {
    ...base,
    role: "security-auditor",
    invocationModel: "haiku",
    postAttempt: {
      sufficient: false,
      signals: ["low-confidence"],
      prior: prior(securityFirst),
    },
  });
  const retry = resolveRouting({}, {
    ...base,
    role: "security-auditor",
    attempt: 2,
    postAttempt: {
      sufficient: false,
      signals: ["high-severity-review-uncertainty"],
      prior: prior(security, 2),
    },
  });
  assert.equal(retry.disposition, "retry");
  assert.equal(retry.attempt, 3);
  assert.equal(retry.model.value, "opus");

  const mixed = resolveRouting({}, {
    ...base,
    role: "security-auditor",
    attempt: 2,
    postAttempt: {
      sufficient: false,
      signals: ["high-severity-review-uncertainty", "low-confidence"],
      prior: prior(security, 2),
    },
  });
  assert.equal(mixed.disposition, "exhausted");
  assert.equal(mixed.retry, null);

  const opusPrior = prior(retry, 3);
  const final = resolveRouting({}, {
    ...base,
    role: "security-auditor",
    attempt: 3,
    postAttempt: { sufficient: false, signals: ["high-severity-review-uncertainty"], prior: opusPrior },
  });
  assert.equal(final.disposition, "exhausted");
});

test("validated pre-retry stops preserve the exhausted or unmappable prior routing record", () => {
  const project = { classify: { model: "haiku", effort: "high" } };
  const first = resolveRouting(project, {
    ...base,
    supportsEffortSelector: true,
    basis: "stable-basis",
    actualModel: "claude-haiku-4-5",
  });
  const second = resolveRouting(project, {
    ...base,
    supportsEffortSelector: true,
    basis: "stable-basis",
    postAttempt: evaluated("low-confidence", { prior: prior(first) }),
  });
  const exhaustedPrior = { ...prior(second, 2), actualModel: "claude-sonnet-4-6" };
  const exhausted = resolveRouting({}, {
    role: "classify",
    shapeEvidence: second.normalizedEvidence,
    supportsModelSelector: true,
    supportsEffortSelector: false,
    postAttempt: { sufficient: false, signals: ["repeated-failure"], prior: exhaustedPrior },
  });
  assert.equal(exhausted.disposition, "exhausted");
  assert.deepEqual(
    {
      role: exhausted.role, shape: exhausted.executionShape, evidence: exhausted.normalizedEvidence,
      model: exhausted.model, effort: exhausted.effort, basis: exhausted.basis,
      attempt: exhausted.attempt, origin: exhausted.escalationOrigin, actualModel: exhausted.actualModel,
    },
    {
      role: exhaustedPrior.role, shape: exhaustedPrior.executionShape, evidence: exhaustedPrior.shapeEvidence,
      model: exhaustedPrior.model, effort: exhaustedPrior.effort, basis: exhaustedPrior.basis,
      attempt: exhaustedPrior.attempt, origin: exhaustedPrior.escalationOrigin, actualModel: exhaustedPrior.actualModel,
    },
  );

  const terminalCases = [
    { model: "opus", actualModel: "claude-opus-4-8", diagnostic: /highest stable tier/ },
    { model: "custom-model", actualModel: "custom-model", diagnostic: /does not map/ },
  ] as const;
  for (const row of terminalCases) {
    const routed = resolveRouting({}, {
      ...base,
      invocationModel: row.model,
      basis: "terminal-basis",
      actualModel: row.actualModel,
    });
    const terminalPrior = prior(routed);
    const stopped = resolveRouting({}, {
      role: "classify",
      shapeEvidence: routed.normalizedEvidence,
      supportsModelSelector: true,
      supportsEffortSelector: false,
      postAttempt: { sufficient: false, signals: ["low-confidence"], prior: terminalPrior },
    });
    assert.equal(stopped.disposition, "invalid-stop");
    assert.match(stopped.diagnostic ?? "", row.diagnostic);
    assert.deepEqual(
      [stopped.model, stopped.effort, stopped.basis, stopped.attempt, stopped.escalationOrigin, stopped.actualModel],
      [terminalPrior.model, terminalPrior.effort, terminalPrior.basis, terminalPrior.attempt, terminalPrior.escalationOrigin, terminalPrior.actualModel],
    );
  }
});

test("initial routing cannot bypass escalation attempts or provenance", () => {
  const cases = [
    { attempt: 2 },
    { attempt: 3 },
    { attempt: 4 },
    { attempt: 0 },
    { escalationOrigin: "caller-forged" },
    { escalationOrigin: "" },
  ];
  for (const extra of cases) {
    const decision = resolveRouting({}, { ...base, ...extra });
    assert.equal(decision.status, "stop");
    assert.equal(decision.disposition, "invalid-stop");
    assert.equal(decision.retry, null);
    assert.ok(decision.diagnostic);
    assert.ok(decision.attempt >= 1 && decision.attempt <= 3);
  }
});

test("role continuity prevents gaining the security-auditor attempt exception", () => {
  const sonnet = resolveRouting({}, { ...base, invocationModel: "sonnet" });
  const switchedPrior = { ...prior(sonnet, 2), role: "classify", escalationOrigin: "routing:classify:attempt-1" };
  const decision = resolveRouting({}, {
    ...base,
    role: "security-auditor",
    attempt: 2,
    postAttempt: {
      sufficient: false,
      signals: ["high-severity-review-uncertainty"],
      prior: switchedPrior,
    },
  });
  assert.equal(decision.status, "stop");
  assert.equal(decision.disposition, "invalid-stop");
  assert.match(decision.diagnostic ?? "", /prior role must match/);
});

test("retry preserves prior explicit effort provenance unless host effort masks it", () => {
  const project = { classify: { model: "haiku", effort: "high" } };
  const first = resolveRouting(project, { ...base, supportsEffortSelector: true, actualModel: "haiku" });
  assert.deepEqual([first.effort.value, first.effort.source], ["high", "project"]);
  const postAttempt = evaluated("failed-validation", { prior: prior(first) });

  const preserved = resolveRouting({ classify: { model: "haiku", effort: "low" } }, {
    ...base,
    supportsEffortSelector: true,
    invocationEffort: "max",
    postAttempt,
  });
  assert.equal(preserved.disposition, "retry");
  assert.deepEqual(preserved.effort, first.effort);

  const masked = resolveRouting(project, {
    ...base,
    supportsEffortSelector: true,
    hostEffort: "low",
    postAttempt,
  });
  assert.equal(masked.disposition, "retry");
  assert.deepEqual(
    [masked.effort.value, masked.effort.source, masked.effort.requested, masked.effort.requestedSource, masked.effort.masked],
    ["low", "host", "high", "project", true],
  );

  const hostFirst = resolveRouting({}, {
    ...base,
    supportsEffortSelector: true,
    invocationEffort: "low",
    hostEffort: "high",
    actualModel: "haiku",
  });
  const hostRetried = resolveRouting({}, {
    ...base,
    supportsEffortSelector: true,
    hostEffort: "high",
    postAttempt: evaluated("failed-validation", { prior: prior(hostFirst) }),
  });
  assert.equal(hostRetried.disposition, "retry");
  assert.deepEqual(hostRetried.effort, hostFirst.effort, "existing host-masked effort provenance must survive retry");
});

test("retry and retain preserve prior basis and reject replacement or malformed basis", () => {
  const first = resolveRouting({}, { ...base, basis: "original-basis", actualModel: "haiku" });
  const retry = resolveRouting({}, {
    ...base,
    postAttempt: evaluated("low-confidence", { prior: prior(first) }),
  });
  assert.equal(retry.disposition, "retry");
  assert.equal(retry.basis, "original-basis");

  const retained = resolveRouting({}, {
    ...base,
    postAttempt: { sufficient: true, signals: [], prior: prior(first) },
  });
  assert.equal(retained.disposition, "retain");
  assert.equal(retained.basis, "original-basis");

  const replacement = resolveRouting({}, {
    ...base,
    basis: "replacement-basis",
    postAttempt: evaluated("low-confidence", { prior: prior(first) }),
  });
  assert.equal(replacement.disposition, "invalid-stop");
  assert.match(replacement.diagnostic ?? "", /basis contradicts/);

  const malformedPrior = { ...prior(first), basis: undefined };
  const malformed = resolveRouting({}, {
    ...base,
    postAttempt: evaluated("low-confidence", {
      prior: malformedPrior as unknown as RoutingPostAttemptEvaluation["prior"],
    }),
  });
  assert.equal(malformed.disposition, "invalid-stop");
  assert.match(malformed.diagnostic ?? "", /basis must be a string or null/);
});

test("malformed or duplicate unit evaluations stop before retained ids are derived", () => {
  const evidence = {
    ...inlineEvidence, atomicity: "composite", unitCount: 2, unitsIndependent: true,
    toolWork: "material", requestedParallelism: 2,
  } as const;
  const first = resolveRouting({}, { ...base, shapeEvidence: evidence, actualModel: "haiku" });
  const decision = resolveRouting({}, {
    ...base,
    shapeEvidence: evidence,
    postAttempt: {
      sufficient: false,
      signals: [],
      prior: prior(first),
      units: [
        { unitId: "same", sufficient: true, signals: [] },
        { unitId: "same", sufficient: false, signals: ["failed-validation"] },
      ],
    },
  });
  assert.equal(decision.disposition, "invalid-stop");
  assert.deepEqual(decision.retainedUnitIds, []);
  assert.match(decision.diagnostic ?? "", /duplicated/);
});

test("shape-change comparison ignores object property insertion order", () => {
  const first = resolveRouting({}, { ...base, actualModel: "haiku" });
  const reordered = Object.fromEntries(Object.entries(first.normalizedEvidence).reverse()) as typeof inlineEvidence;
  const decision = resolveRouting({}, {
    ...base,
    postAttempt: evaluated("low-confidence", {
      prior: { ...prior(first), shapeEvidence: reordered },
    }),
  });
  assert.equal(decision.disposition, "retry");
  assert.equal(decision.retry?.shapeChanged, false);
});

test("contradictory and incomplete retry contexts stop with diagnostics", () => {
  const first = resolveRouting({}, base);
  const cases = [
    { sufficient: true, signals: ["low-confidence"], prior: prior(first) },
    { sufficient: false, signals: [], prior: prior(first) },
    { sufficient: false, signals: ["low-confidence"], prior: { ...prior(first), attempt: 2, escalationOrigin: null } },
  ] as RoutingPostAttemptEvaluation[];
  for (const postAttempt of cases) {
    const decision = resolveRouting({}, { ...base, postAttempt });
    assert.equal(decision.status, "stop");
    assert.equal(decision.disposition, "invalid-stop");
    assert.ok(decision.diagnostic);
    assert.equal(decision.retry, null);
  }
});

test("retry stops on masked, unavailable, unsupported, unknown, and non-advancing model tiers", () => {
  const first = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5" });
  const postAttempt = evaluated("failed-validation", { prior: prior(first) });
  const cases = [
    { inputs: { hostModel: "haiku" }, pattern: /masked/ },
    { inputs: { availableModels: ["haiku"] }, pattern: /unavailable/ },
    { inputs: { supportsModelSelector: false }, pattern: /cannot honor/ },
    { inputs: {}, priorModel: "custom-model", pattern: /does not map/ },
    { inputs: {}, priorModel: "opus", pattern: /highest stable tier/ },
  ] as const;
  for (const row of cases) {
    const evaluation = row.priorModel
      ? { ...postAttempt, prior: { ...postAttempt.prior, model: { ...postAttempt.prior.model, value: row.priorModel }, actualModel: null } }
      : postAttempt;
    const decision = resolveRouting({}, { ...base, ...row.inputs, postAttempt: evaluation });
    assert.equal(decision.disposition, "invalid-stop");
    assert.match(decision.diagnostic ?? "", row.pattern);
    assert.equal(decision.retry, null);
  }
});

test("retry accepts full model identifiers and recomputes shape only from supplied evidence", () => {
  const first = resolveRouting({}, { ...base, invocationModel: "claude-haiku-4-5", actualModel: "claude-haiku-4-5" });
  const unchanged = resolveRouting({}, {
    ...base,
    postAttempt: evaluated("low-confidence", { prior: prior(first) }),
    availableModels: ["claude-sonnet-4-6"],
  });
  assert.equal(unchanged.disposition, "retry");
  assert.equal(unchanged.executionShape, first.executionShape);
  assert.equal(unchanged.retry?.shapeChanged, false);

  const changedEvidence = { ...inlineEvidence, risk: "elevated", contextIsolation: "required" } as const;
  const changed = resolveRouting({}, {
    ...base,
    shapeEvidence: changedEvidence,
    postAttempt: evaluated("increased-risk-or-scope", { prior: prior(first) }),
  });
  assert.equal(changed.executionShape, "isolated");
  assert.equal(changed.retry?.shapeChanged, true);
  assert.deepEqual(changed.normalizedEvidence, changedEvidence);
});
