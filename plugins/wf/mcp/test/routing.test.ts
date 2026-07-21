import assert from "node:assert/strict";
import test from "node:test";
import { parseRoutingConfig } from "../src/resolver/config.js";
import { resolveRouting } from "../src/resolver/routing.js";

const base = { role: "classify", executionShape: "task", supportsModelSelector: true, supportsEffortSelector: false } as const;

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

test("malformed choices stop rather than silently substituting", () => {
  const decision = resolveRouting({ classify: { model: "bad model", effort: null } }, base);
  assert.equal(decision.status, "stop");
  assert.equal(decision.model.fallback, "malformed");
});
