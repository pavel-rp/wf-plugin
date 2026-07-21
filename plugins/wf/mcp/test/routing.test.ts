import assert from "node:assert/strict";
import test from "node:test";
import { parseRoutingConfig } from "../src/resolver/config.js";
import { resolveRouting } from "../src/resolver/routing.js";

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
      shape: "inline", reason: "atomic-caller-context", bound: 1,
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

test("malformed choices inherit unless required", () => {
  const fallback = resolveRouting({ classify: { model: "bad model", effort: null } }, base);
  assert.equal(fallback.status, "dispatch");
  assert.equal(fallback.model.value, null);
  assert.equal(fallback.model.fallback, "malformed");
  const stop = resolveRouting({ classify: { model: "bad model", effort: null } }, { ...base, requireModel: true });
  assert.equal(stop.status, "stop");
  assert.equal(stop.model.fallback, "malformed");
});
