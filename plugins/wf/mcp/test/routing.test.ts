import assert from "node:assert/strict";
import test from "node:test";
import { parseRoutingConfig } from "../src/resolver/config.js";
import { derivedCountEvidence, resolveRouting } from "../src/resolver/routing.js";
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

const base = { role: "classify", shapeEvidence: inlineEvidence, unitIds: ["classify:single"], supportsModelSelector: true, supportsEffortSelector: false } as const;

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

test("available model inventory is bounded before selector scanning", () => {
  const tooMany = resolveRouting({}, { ...base, availableModels: Array.from({ length: 65 }, (_, index) => `model-${index}`) });
  assert.equal(tooMany.disposition, "invalid-stop");
  assert.match(tooMany.diagnostic ?? "", /availableModels must contain at most 64 entries/);

  const tooLong = resolveRouting({}, { ...base, availableModels: ["x".repeat(129)] });
  assert.equal(tooLong.disposition, "invalid-stop");
  assert.match(tooLong.diagnostic ?? "", /availableModels entries must be at most 128 characters/);
});

test("routing scalar metadata is bounded and oversized values are never echoed", () => {
  const cases: Array<[string, Record<string, unknown>, number]> = [
    ["invocationModel", { invocationModel: "x".repeat(129) }, 128],
    ["invocationEffort", { invocationEffort: "x".repeat(17) }, 16],
    ["hostModel", { hostModel: "x".repeat(129) }, 128],
    ["hostEffort", { hostEffort: "x".repeat(17) }, 16],
    ["basis", { basis: "x".repeat(257) }, 256],
    ["escalationOrigin", { escalationOrigin: "x".repeat(257) }, 256],
    ["actualModel", { actualModel: "x".repeat(129) }, 128],
  ];
  for (const [field, overrides, maximum] of cases) {
    const oversized = Object.values(overrides)[0] as string;
    const decision = resolveRouting({}, { ...base, ...overrides } as Parameters<typeof resolveRouting>[1]);
    assert.equal(decision.disposition, "invalid-stop", field);
    assert.doesNotMatch(JSON.stringify(decision), new RegExp(oversized), field);
    assert.match(decision.diagnostic ?? "", new RegExp(`${field}.*${maximum}|initial routing dispatch`), field);
  }
  for (const field of ["invocationModel", "invocationEffort", "hostModel", "hostEffort", "basis", "escalationOrigin", "actualModel"] as const) {
    const controlled = `safe${String.fromCharCode(27)}unsafe`;
    const decision = resolveRouting({}, { ...base, [field]: controlled } as Parameters<typeof resolveRouting>[1]);
    assert.equal(decision.disposition, "invalid-stop", field);
    assert.doesNotMatch(JSON.stringify(decision), new RegExp(controlled), field);
  }
});

test("oversized retained prior metadata is rejected before terminal output", () => {
  const first = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5" });
  const scalarCases: Array<[string, (candidate: RoutingPostAttemptEvaluation["prior"]) => void]> = [
    ["model.value", (candidate) => { candidate.model = { ...candidate.model, value: "x".repeat(129) }; }],
    ["model.requested", (candidate) => { candidate.model = { ...candidate.model, requested: "x".repeat(129) }; }],
    ["effort.value", (candidate) => { candidate.effort = { ...candidate.effort, value: "x".repeat(17) }; }],
    ["basis", (candidate) => { candidate.basis = "x".repeat(257); }],
    ["escalationOrigin", (candidate) => { candidate.escalationOrigin = "x".repeat(257); }],
    ["actualModel", (candidate) => { candidate.actualModel = "x".repeat(129); }],
  ];
  for (const [field, mutate] of scalarCases) {
    const candidate = prior(first);
    mutate(candidate);
    const decision = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5", postAttempt: { sufficient: false, signals: ["failed-validation"], prior: candidate } });
    assert.equal(decision.disposition, "invalid-stop", field);
    assert.match(decision.diagnostic ?? "", /at most/, field);
  }
  const controlled = `safe${String.fromCharCode(27)}unsafe`;
  const controlCases: Array<[string, (candidate: RoutingPostAttemptEvaluation["prior"]) => void]> = [
    ["model.value", (candidate) => { candidate.model = { ...candidate.model, value: controlled }; }],
    ["model.requested", (candidate) => { candidate.model = { ...candidate.model, requested: controlled }; }],
    ["effort.value", (candidate) => { candidate.effort = { ...candidate.effort, value: controlled }; }],
    ["basis", (candidate) => { candidate.basis = controlled; }],
    ["escalationOrigin", (candidate) => { candidate.escalationOrigin = controlled; }],
    ["actualModel", (candidate) => { candidate.actualModel = controlled; }],
  ];
  for (const [field, mutate] of controlCases) {
    const candidate = prior(first);
    mutate(candidate);
    const decision = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5", postAttempt: { sufficient: false, signals: ["failed-validation"], prior: candidate } });
    assert.equal(decision.disposition, "invalid-stop", field);
    assert.doesNotMatch(JSON.stringify(decision), new RegExp(controlled), field);
  }
});

test("post-attempt host selectors are validated before retry construction", () => {
  const first = resolveRouting({}, base);
  const cases = [
    { hostEffort: "x".repeat(17) },
    { hostEffort: `safe${String.fromCharCode(27)}unsafe` },
    { hostModel: "x".repeat(129) },
    { hostModel: `safe${String.fromCharCode(27)}unsafe` },
  ];
  for (const overrides of cases) {
    const raw = Object.values(overrides)[0];
    const decision = resolveRouting({}, {
      ...base,
      ...overrides,
      postAttempt: { sufficient: false, signals: ["failed-validation"], prior: prior(first) },
    });
    assert.equal(decision.disposition, "invalid-stop");
    assert.doesNotMatch(JSON.stringify(decision), new RegExp(raw));
  }
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
      evidence: { ...inlineEvidence, atomicity: "composite", unitCount: 4, unitsIndependent: true, toolWork: "material", contextIsolation: "useful", requestedParallelism: 6 },
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

test("a contradictory atomicity pair is normalized in both directions without changing selector decisions", () => {
  // `composite` stated for one unit — the exact pair the C011 subject run was
  // rejected for. It is now accepted and reported back as the derived `atomic`.
  const composite = resolveRouting({}, {
    ...base,
    shapeEvidence: { ...inlineEvidence, atomicity: "composite", unitCount: 1 },
  });
  assert.equal(composite.status, "dispatch");
  assert.equal(composite.disposition, "dispatch");
  assert.equal(composite.diagnostic, null);
  assert.equal(composite.normalizedEvidence.atomicity, "atomic");
  assert.equal(composite.normalizedEvidence.unitCount, 1);

  // The rule is symmetric: `unitCount` is authoritative in the other direction too.
  const atomic = resolveRouting({}, {
    ...base,
    unitIds: ["classify:first", "classify:second"],
    shapeEvidence: { ...inlineEvidence, atomicity: "atomic", unitCount: 2 },
  });
  assert.equal(atomic.status, "dispatch");
  assert.equal(atomic.normalizedEvidence.atomicity, "composite");
  assert.equal(atomic.normalizedEvidence.unitCount, 2);

  // Independence is clamped under the same rule rather than rejected.
  const independent = resolveRouting({}, {
    ...base,
    shapeEvidence: { ...inlineEvidence, unitsIndependent: true, unitCount: 1 },
  });
  assert.equal(independent.status, "dispatch");
  assert.equal(independent.normalizedEvidence.unitsIndependent, false);

  // The original invariant survives: normalizing evidence never disturbs selectors.
  for (const decision of [composite, atomic, independent]) {
    assert.equal(decision.model.value, "haiku");
    assert.equal(decision.model.source, "shipped-default");
  }
});

test("unitIds cardinality is still a hard rejection against the authoritative unitCount", () => {
  const decision = resolveRouting({}, {
    ...base,
    unitIds: ["classify:single"],
    shapeEvidence: { ...inlineEvidence, atomicity: "atomic", unitCount: 2 },
  });
  assert.equal(decision.status, "stop");
  assert.equal(decision.disposition, "invalid-stop");
  assert.match(decision.diagnostic ?? "", /unitIds must match shape evidence unitCount/);
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
    unitIds: decision.unitIds,
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

test("post-attempt singleton recovery requires retained identity and returns the same id", () => {
  const { unitIds: _unitIds, ...unidentifiedBase } = base;
  const unidentified = resolveRouting({}, unidentifiedBase);
  assert.equal(unidentified.status, "dispatch", "an identity-free singleton is explicitly non-retry");
  const stopped = resolveRouting({}, {
    ...unidentifiedBase,
    postAttempt: { sufficient: false, signals: ["failed-validation"], prior: prior(unidentified) },
  });
  assert.equal(stopped.disposition, "invalid-stop");
  assert.match(stopped.diagnostic ?? "", /requires one retained unitId/);
  assert.equal(stopped.retry, null);

  const first = resolveRouting({}, { ...base, actualModel: "haiku" });
  const retried = resolveRouting({}, {
    ...base,
    postAttempt: { sufficient: false, signals: ["failed-validation"], prior: prior(first) },
  });
  assert.equal(retried.disposition, "retry");
  assert.deepEqual(retried.unitIds, ["classify:single"]);
  assert.deepEqual(retried.retry?.unitIds, ["classify:single"]);
});

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

test("post-attempt signal arrays are bounded before uniqueness allocation", () => {
  const first = resolveRouting({}, base);
  const sevenSignals = [
    "low-confidence", "failed-validation", "conflicting-or-incomplete-evidence", "repeated-failure",
    "increased-risk-or-scope", "high-severity-review-uncertainty", "low-confidence",
  ] as RoutingInsufficiencySignal[];
  const decision = resolveRouting({}, {
    ...base,
    postAttempt: { sufficient: false, signals: sevenSignals, prior: prior(first) },
  });
  assert.equal(decision.disposition, "invalid-stop");
  assert.match(decision.diagnostic ?? "", /signals contain an unsupported insufficiency signal/);
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
  const unitIds = ["a", "b", "c"];
  const first = resolveRouting({}, { ...base, shapeEvidence: evidence, unitIds, actualModel: "haiku" });
  const decision = resolveRouting({}, {
    ...base,
    shapeEvidence: evidence,
    unitIds,
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

test("an exhausted budget stops terminally while an unmappable tier opens the gate", () => {
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
    unitIds: exhaustedPrior.unitIds,
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

  // WF-497: both of these are inapplicable-lever cases, not defeated ones, so the
  // gate opens and the retry carries the prior selection forward.
  const noLeverCases = [
    { model: "opus", actualModel: "claude-opus-4-8", escalation: "top-tier", priorTier: "opus" },
    { model: "custom-model", actualModel: "custom-model", escalation: "prior-tier-unknown", priorTier: null },
  ] as const;
  for (const row of noLeverCases) {
    const routed = resolveRouting({}, {
      ...base,
      invocationModel: row.model,
      basis: "terminal-basis",
      actualModel: row.actualModel,
    });
    const carriedPrior = prior(routed);
    const retried = resolveRouting({}, {
      role: "classify",
      shapeEvidence: routed.normalizedEvidence,
      unitIds: carriedPrior.unitIds,
      supportsModelSelector: true,
      supportsEffortSelector: false,
      postAttempt: { sufficient: false, signals: ["low-confidence"], prior: carriedPrior },
    });
    assert.equal(retried.disposition, "retry");
    assert.equal(retried.retry?.escalation, row.escalation);
    assert.equal(retried.retry?.nextTier, null);
    assert.equal(retried.retry?.priorTier, row.priorTier);
    assert.equal(retried.diagnostic, null);
    assert.deepEqual(
      [retried.model, retried.effort, retried.basis],
      [carriedPrior.model, carriedPrior.effort, carriedPrior.basis],
      "the prior selection and its basis survive an opened gate unchanged",
    );
    assert.equal(retried.attempt, carriedPrior.attempt + 1);
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
  assert.equal(decision.role, "security-auditor");
  assert.equal(decision.attempt, 2);
  assert.match(decision.diagnostic ?? "", /prior role must match/);
});

test("malformed prior attempts never leak into an invalid-stop decision", () => {
  const first = resolveRouting({}, { ...base, invocationModel: "haiku" });
  for (const badAttempt of [0, 4, 1.5]) {
    const decision = resolveRouting({}, {
      ...base,
      postAttempt: evaluated("failed-validation", {
        prior: { ...prior(first), attempt: badAttempt },
      }),
    });
    assert.equal(decision.status, "stop");
    assert.equal(decision.disposition, "invalid-stop");
    assert.equal(decision.role, base.role);
    assert.equal(decision.attempt, 1);
    assert.equal(decision.retry, null);
    assert.match(decision.diagnostic ?? "", /prior attempt must be an integer from 1 to 3/);
  }
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
  const unitIds = ["same", "other"];
  const first = resolveRouting({}, { ...base, shapeEvidence: evidence, unitIds, actualModel: "haiku" });
  const decision = resolveRouting({}, {
    ...base,
    shapeEvidence: evidence,
    unitIds,
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

test("post-attempt rejects reordered retained identities and unit evaluations", () => {
  const evidence = {
    ...inlineEvidence, atomicity: "composite", unitCount: 2, unitsIndependent: true,
    toolWork: "material", requestedParallelism: 2,
  } as const;
  const unitIds = ["first", "second"];
  const first = resolveRouting({}, { ...base, shapeEvidence: evidence, unitIds, actualModel: "haiku" });

  const reorderedInputs = resolveRouting({}, {
    ...base,
    shapeEvidence: evidence,
    unitIds: ["second", "first"],
    postAttempt: {
      sufficient: false,
      signals: [],
      prior: prior(first),
      units: [
        { unitId: "first", sufficient: true, signals: [] },
        { unitId: "second", sufficient: false, signals: ["failed-validation"] },
      ],
    },
  });
  assert.equal(reorderedInputs.disposition, "invalid-stop");
  assert.match(reorderedInputs.diagnostic ?? "", /unitIds must match the retained prior decision/);

  const reorderedEvaluations = resolveRouting({}, {
    ...base,
    shapeEvidence: evidence,
    unitIds,
    postAttempt: {
      sufficient: false,
      signals: [],
      prior: prior(first),
      units: [
        { unitId: "second", sufficient: false, signals: ["failed-validation"] },
        { unitId: "first", sufficient: true, signals: [] },
      ],
    },
  });
  assert.equal(reorderedEvaluations.disposition, "invalid-stop");
  assert.match(reorderedEvaluations.diagnostic ?? "", /unit evaluations must match the retained prior unitIds/);
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

test("retry stops on a DEFEATED tier advance but opens the gate when no tier lever applies", () => {
  const first = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5" });
  const postAttempt = evaluated("failed-validation", { prior: prior(first) });

  // The lever was applicable and was ATTEMPTED: the resolver asked for a specific
  // next tier and did not get it. That is an integrity failure and still stops,
  // preserving WF-394 host precedence.
  const defeated = [
    { inputs: { hostModel: "haiku" }, pattern: /masked/ },
    { inputs: { availableModels: ["haiku"] }, pattern: /unavailable/ },
  ] as const;
  for (const row of defeated) {
    const decision = resolveRouting({}, { ...base, ...row.inputs, postAttempt });
    assert.equal(decision.disposition, "invalid-stop");
    assert.match(decision.diagnostic ?? "", row.pattern);
    assert.equal(decision.retry, null);
    assert.deepEqual(
      [decision.model, decision.effort, decision.basis, decision.attempt, decision.escalationOrigin, decision.actualModel],
      [postAttempt.prior.model, postAttempt.prior.effort, postAttempt.prior.basis, postAttempt.prior.attempt, postAttempt.prior.escalationOrigin, postAttempt.prior.actualModel ?? undefined],
      "a failed retry candidate must leave the prior routing record terminal",
    );
  }

  // The lever was NOT APPLICABLE, so none was requested. WF-497: the gate opens
  // anyway — a caller that reports a real failure gets a bounded, narrowed retry
  // instead of being told its well-formed evidence was invalid.
  // `priorTier` is evidence about the attempt that already ran, so it is reported
  // whenever it resolves — including on `selector-unsupported`, where the prior
  // attempt's own model still maps even though this edge cannot honor a selector.
  const notApplicable = [
    { inputs: { supportsModelSelector: false }, escalation: "selector-unsupported", priorTier: "haiku", model: null },
    { inputs: {}, priorModel: "custom-model", escalation: "prior-tier-unknown", priorTier: null, model: "custom-model" },
    { inputs: {}, priorModel: "opus", escalation: "top-tier", priorTier: "opus", model: "opus" },
  ] as const;
  for (const row of notApplicable) {
    const evaluation = row.priorModel
      ? {
          ...postAttempt,
          prior: {
            ...postAttempt.prior,
            model: { ...postAttempt.prior.model, value: row.priorModel, requested: row.priorModel, requestedSource: "invocation" as const, source: "invocation" as const },
            actualModel: null,
          },
        }
      : postAttempt;
    const decision = resolveRouting({}, { ...base, ...row.inputs, postAttempt: evaluation });
    assert.equal(decision.status, "dispatch", row.escalation);
    assert.equal(decision.disposition, "retry", row.escalation);
    assert.equal(decision.retry?.escalation, row.escalation);
    assert.equal(decision.retry?.nextTier, null, "no tier lever means no advance was requested");
    assert.equal(decision.retry?.priorTier, row.priorTier, row.escalation);
    assert.equal(decision.retry?.attempt, 2);
    assert.ok(decision.retry?.escalationOrigin, "an opened gate records escalation provenance");
    assert.equal(
      decision.diagnostic, null,
      "a retry must never carry a diagnostic: callers hard-stop on a non-null one and would silently drop the work",
    );
    assert.equal(decision.model.value, row.model, "the retry re-resolves the prior attempt's own request");
    assert.equal(decision.effort, evaluation.prior.effort, "effort is preserved across the retry");
    assert.equal(decision.basis, evaluation.prior.basis);
  }
});

// The three not-applicable branches must not become a laundering path: they still
// resolve the model through `choose()`, so a host pin and an availability constraint
// supplied on the retry call bind exactly as they do on the advancing path.
test("an opened gate that requests no advance still honors host enforcement and availability", () => {
  const first = resolveRouting({}, { ...base, invocationModel: "opus" });
  const atTop = evaluated("failed-validation", { prior: prior(first) });

  const hostPinned = resolveRouting({}, { ...base, hostModel: "sonnet", postAttempt: atTop });
  assert.equal(hostPinned.disposition, "retry");
  assert.equal(hostPinned.retry?.escalation, "top-tier");
  assert.equal(hostPinned.model.value, "sonnet", "the host pin wins over the prior selection");
  assert.equal(hostPinned.model.source, "host");
  assert.equal(hostPinned.model.masked, true, "masking the prior choice must be recorded, not hidden");
  // The exact case the invariant does NOT cover, pinned so no surface may claim it
  // does: a null `nextTier` promises only that no ADVANCE was requested, never that
  // the model is unchanged, because re-resolution lets a host pin still bind.
  assert.equal(hostPinned.retry?.nextTier, null);
  assert.notEqual(
    hostPinned.model.value, atTop.prior.model.value,
    "a null nextTier must not be read as a promise that the model is unchanged",
  );

  const unavailable = resolveRouting({}, { ...base, availableModels: ["haiku", "sonnet"], postAttempt: atTop });
  assert.equal(unavailable.disposition, "retry");
  assert.equal(unavailable.model.value, null, "an unavailable prior model must not be re-dispatched");
  assert.equal(unavailable.model.fallback, "unavailable");

  // A caller cannot launder forged provenance through the carried selection either:
  // the claimed value is re-validated, not copied.
  const forged = resolveRouting({}, {
    ...base,
    postAttempt: {
      ...atTop,
      prior: {
        ...atTop.prior,
        model: { value: "not a model id !!$$", source: "host", requested: "not a model id !!$$", requestedSource: "invocation", masked: false, fallback: null },
        actualModel: null,
      },
    },
  });
  assert.notEqual(forged.model.value, "not a model id !!$$", "a malformed prior model must never reach a dispatch decision");
  assert.equal(forged.model.fallback, "malformed");
});

test("retry.nextTier is non-null exactly when the resolver advanced the selection a tier", () => {
  const advancing = resolveRouting({}, { ...base, actualModel: "claude-haiku-4-5" });
  const advanced = resolveRouting({}, {
    ...base, postAttempt: evaluated("failed-validation", { prior: prior(advancing) }),
  });
  assert.equal(advanced.retry?.escalation, "next-stable-tier");
  assert.equal(advanced.retry?.priorTier, "haiku");
  assert.equal(advanced.retry?.nextTier, "sonnet");
  assert.notEqual(advanced.model.value, advancing.model.value, "a non-null nextTier must move the selection");

  const carried = resolveRouting({}, {
    ...base,
    supportsModelSelector: false,
    postAttempt: evaluated("failed-validation", { prior: prior(advancing) }),
  });
  assert.equal(carried.retry?.nextTier, null);
  assert.equal(carried.retry?.escalation, "selector-unsupported");

  // The classifier and the carry-forward must read ONE prior model. Reading
  // `actualModel` ahead of the selection let them disagree, so a retry could report
  // `top-tier` from the actual model while re-dispatching BELOW the prior selection
  // and forfeiting a genuinely available advance.
  const diverged = resolveRouting({}, { ...base, invocationModel: "haiku", actualModel: "claude-opus-4-8" });
  const fromSelection = resolveRouting({}, {
    ...base, postAttempt: evaluated("failed-validation", { prior: prior(diverged) }),
  });
  assert.equal(fromSelection.retry?.priorTier, "haiku", "the tier is classified from the selection the retry controls");
  assert.equal(fromSelection.retry?.nextTier, "sonnet", "the available advance must not be forfeited");
  assert.equal(fromSelection.model.value, "sonnet", "and the retry must never route below the prior selection");
});

test("retry accepts full model identifiers but rejects caller-supplied shape changes", () => {
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
  assert.equal(changed.status, "stop");
  assert.equal(changed.disposition, "invalid-stop");
  assert.equal(changed.retry, null);
  assert.match(changed.diagnostic ?? "", /shape evidence must match the retained prior decision/);
  assert.deepEqual(changed.normalizedEvidence, inlineEvidence);
});

test("the input path and the retry path derive count evidence from one shared rule", () => {
  const parallelEvidence = {
    ...inlineEvidence,
    atomicity: "composite",
    unitCount: 4,
    unitsIndependent: true,
    toolWork: "material",
    contextIsolation: "useful",
    requestedParallelism: 4,
  } as const;
  const priorUnitIds = ["a", "b", "c", "d"];
  const first = resolveRouting({}, {
    ...base, shapeEvidence: parallelEvidence, unitIds: priorUnitIds, actualModel: "haiku",
  });
  assert.equal(first.executionShape, "bounded-parallel");

  for (const retryCount of [1, 2, 3, 4]) {
    // The RETRY path: narrow the prior set to exactly `retryCount` insufficient units.
    const retried = resolveRouting({}, {
      ...base,
      shapeEvidence: parallelEvidence,
      unitIds: priorUnitIds,
      postAttempt: {
        sufficient: false,
        signals: [],
        prior: prior(first),
        units: priorUnitIds.map((unitId, index) => index < retryCount
          ? { unitId, sufficient: false, signals: ["failed-validation"] as RoutingInsufficiencySignal[] }
          : { unitId, sufficient: true, signals: [] as RoutingInsufficiencySignal[] }),
      },
    });
    assert.equal(retried.disposition, "retry", `retryCount ${retryCount}`);
    assert.equal(retried.normalizedEvidence.unitCount, retryCount, `retryCount ${retryCount}`);

    // The INPUT path, asked the same question directly with a deliberately
    // contradictory `atomicity` so the derivation is doing the work, not the caller.
    const direct = resolveRouting({}, {
      ...base,
      unitIds: priorUnitIds.slice(0, retryCount),
      shapeEvidence: {
        ...parallelEvidence,
        atomicity: retryCount === 1 ? "composite" : "atomic",
        unitCount: retryCount,
        requestedParallelism: retryCount,
      },
    });
    assert.equal(direct.status, "dispatch", `retryCount ${retryCount}`);

    assert.deepEqual(
      [retried.normalizedEvidence.atomicity, retried.normalizedEvidence.unitsIndependent],
      [direct.normalizedEvidence.atomicity, direct.normalizedEvidence.unitsIndependent],
      `input and retry paths must agree at unitCount ${retryCount}`,
    );
    assert.equal(
      direct.normalizedEvidence.atomicity,
      retryCount === 1 ? "atomic" : "composite",
      `retryCount ${retryCount}`,
    );
  }
});

test("count-derived normalization leaves a malformed unitCount alone rather than deriving from it", () => {
  // The defensive branch of the shared rule: a `unitCount` that is not a positive
  // integer is rejected by its own range check, so normalization must not derive
  // `composite` from nonsense and swap one diagnostic for another.
  const first = resolveRouting({}, { ...base, actualModel: "haiku" });
  const decision = resolveRouting({}, {
    ...base,
    shapeEvidence: { ...inlineEvidence, unitCount: 0 },
    postAttempt: { sufficient: false, signals: ["failed-validation"], prior: prior(first) },
  } as unknown as Parameters<typeof resolveRouting>[1]);
  assert.equal(decision.status, "stop");
  assert.equal(decision.disposition, "invalid-stop");
  assert.match(decision.diagnostic ?? "", /shape evidence must match the retained prior decision/);
  assert.equal(decision.retry, null);
});

test("an over-long basis is rejected naming the field, the bound, and the length received", () => {
  const oversized = "x".repeat(257);
  const decision = resolveRouting({}, { ...base, basis: oversized });
  assert.equal(decision.status, "stop");
  assert.equal(decision.disposition, "invalid-stop");
  assert.match(decision.diagnostic ?? "", /basis must be at most 256 characters \(received 257\)/);
  // Never an unexplained schema error, and never a silently truncated basis: the
  // over-long value is dropped from the decision rather than shortened into it.
  assert.equal(decision.basis, null);
  assert.doesNotMatch(JSON.stringify(decision), /x{200}/);
});

test("a basis at the bound is accepted and returned byte-identical — no truncation exists", () => {
  const atBound = "b".repeat(256);
  const decision = resolveRouting({}, { ...base, basis: atBound });
  assert.equal(decision.status, "dispatch");
  assert.equal(decision.diagnostic, null);
  assert.equal(decision.basis, atBound);
  assert.equal(decision.basis?.length, 256);
});

test("a single-unit decision dispatches one unit, never nothing", () => {
  const inline = resolveRouting({}, base);
  assert.equal(inline.executionShape, "inline");
  assert.equal(inline.status, "dispatch");
  assert.equal(inline.disposition, "dispatch");
  assert.equal(inline.effectiveParallelism, 1);
  assert.deepEqual(inline.unitIds, ["classify:single"]);

  const isolated = resolveRouting({}, {
    ...base,
    shapeEvidence: { ...inlineEvidence, workSurface: "external-context", toolWork: "material", contextIsolation: "useful" },
  });
  assert.equal(isolated.executionShape, "isolated");
  assert.equal(isolated.status, "dispatch");
  assert.equal(isolated.disposition, "dispatch");
  assert.equal(isolated.effectiveParallelism, 1);
  assert.deepEqual(isolated.unitIds, ["classify:single"]);

  // `effectiveParallelism` is a concurrency bound, not a unit count: the one
  // decision that legitimately runs more than one at a time still names them all.
  const parallel = resolveRouting({}, {
    ...base,
    unitIds: ["p1", "p2"],
    shapeEvidence: {
      ...inlineEvidence, atomicity: "composite", unitCount: 2, unitsIndependent: true,
      toolWork: "material", requestedParallelism: 2,
    },
  });
  assert.equal(parallel.executionShape, "bounded-parallel");
  assert.equal(parallel.effectiveParallelism, 2);
});

test("effectiveParallelism is a concurrency bound — how many units to run is unitIds.length", () => {
  // A DEPENDENT multi-unit decision is legitimately `isolated` at
  // `effectiveParallelism: 1` and still carries every unit. Reading the bound as a
  // unit count here would silently drop work, so pin the distinction.
  const dependent = resolveRouting({}, {
    ...base,
    unitIds: ["dep:a", "dep:b"],
    shapeEvidence: {
      ...inlineEvidence, atomicity: "composite", unitCount: 2, unitsIndependent: false,
      toolWork: "material", requestedParallelism: 2,
    },
  });
  assert.equal(dependent.status, "dispatch");
  assert.equal(dependent.executionShape, "isolated");
  assert.equal(dependent.effectiveParallelism, 1);
  assert.deepEqual(dependent.unitIds, ["dep:a", "dep:b"]);
  assert.equal(dependent.normalizedEvidence.unitCount, 2);
});

test("the shared count-derived rule is directly assertable and total over the unit range", () => {
  for (const unitCount of [1, 2, 3, 4]) {
    for (const unitsIndependent of [true, false]) {
      assert.deepEqual(
        derivedCountEvidence(unitCount, unitsIndependent),
        {
          atomicity: unitCount === 1 ? "atomic" : "composite",
          unitsIndependent: unitCount > 1 && unitsIndependent,
        },
        `unitCount ${unitCount} / unitsIndependent ${unitsIndependent}`,
      );
    }
  }
});
