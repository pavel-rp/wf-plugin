import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { projectRoutingMeasurement, resolveRouting } from "../src/resolver/routing.js";

const pkgDir = process.env.WF_MCP_DIR;
if (!pkgDir) throw new Error("WF_MCP_DIR is required");
const repoRoot = resolve(pkgDir, "../../..");
const inventoryPath = join(repoRoot, "plugins/wf/skills/_contracts/core-dispatch-inventory.tsv");

type Row = { id: string; classification: string; file: string; target: string; role: string; selectors: string; evidence: string; retryOwner: string };
function rows(): Row[] {
  return readFileSync(inventoryPath, "utf8").split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [id, classification, file, target, role, selectors, evidence, retryOwner] = line.split("\t");
      return { id, classification, file, target, role, selectors, evidence, retryOwner };
    });
}

function dispatchTokens(text: string): string[] {
  return text.match(/\/(?:wf:[a-z0-9-]+|<skill>|wf:<phase>)|(?<![a-z0-9\/-])(?:wf:[a-z0-9-]+|general-purpose)(?![a-z0-9-])/g) ?? [];
}

function exactInventoryTargetIsPresent(source: string, rawTarget: string): boolean {
  const expected = dispatchTokens(rawTarget);
  return expected.length > 0
    ? expected.every((token) => dispatchTokens(source).includes(token))
    : source.includes(rawTarget);
}

const atomicEvidence = {
  workSurface: "external-context" as const, atomicity: "atomic" as const, unitCount: 1,
  unitsIndependent: false, ambiguity: "bounded" as const, risk: "elevated" as const,
  toolWork: "bounded" as const, validation: "judgment" as const, contextIsolation: "useful" as const,
  independentReview: false, returnContract: "mechanically-judgeable" as const, requestedParallelism: 1,
};

test("inventory target matching rejects token-prefix and prose collisions", () => {
  assert.equal(exactInventoryTargetIsPresent("invoke `/wf:child`", "/wf:child"), true);
  assert.equal(exactInventoryTargetIsPresent("invoke `/wf:child2`", "/wf:child"), false);
  assert.equal(exactInventoryTargetIsPresent("subagent_type: wf:childish", "wf:child"), false);
});

test("authoritative dispatch inventory is normalized and bidirectional", () => {
  const inventory = rows();
  assert.equal(new Set(inventory.map((row) => row.id)).size, inventory.length, "inventory ids must be unique");
  assert.equal(inventory.filter((row) => row.classification === "excluded").length, 5, "only the revised-spec structural exclusions are allowed");
  const included = inventory.filter((row) => row.classification === "included");
  assert.equal(included.length, 63, "fixed core dispatch inventory changed; review and guard update required");
  for (const row of included) {
    const source = readFileSync(join(repoRoot, row.file), "utf8");
    assert.ok(exactInventoryTargetIsPresent(source, row.target), `${row.id} exact target is stale`);
    assert.ok(["shared-branch-gate", "index-wrapper-mediated", "fixed-skill-route", "fleet-cardinality-route", "fleet-recovery-route"].includes(row.evidence) || row.evidence.split(",").length === 12, `${row.id} requires complete shape evidence`);
    assert.match(row.selectors, /^(?:model=(?:true|false);effort=(?:true|false)|mixed)$/);
    assert.ok(row.retryOwner, `${row.id} requires explicit retry ownership`);
  }
  assert.ok(included.some((row) => row.id === "init-constitution"));
  assert.ok(included.some((row) => row.id === "qa-followup-rerun"));
  assert.ok(included.some((row) => row.id === "ship-gated-phase"));
  assert.ok(included.some((row) => row.id === "fleet-run-resume"));
  assert.ok(included.some((row) => row.id === "phase-runner-skill"));
});

test("routing rejects contradictory evidence and preserves safe fallback metadata", () => {
  const contradictory = resolveRouting({}, {
    role: "phase-runner", shapeEvidence: { ...atomicEvidence, unitCount: 2, unitsIndependent: true },
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(contradictory.status, "stop");
  assert.match(contradictory.diagnostic ?? "", /contradictory|atomic/i);

  const unsupported = resolveRouting({}, {
    role: "index", shapeEvidence: atomicEvidence,
    invocationModel: "sonnet", supportsModelSelector: false, supportsEffortSelector: false,
  });
  assert.equal(unsupported.model.value, null);
  assert.equal(unsupported.model.fallback, "selector-unsupported");
  assert.equal(unsupported.executionShape, "isolated");
  const compact = projectRoutingMeasurement(unsupported);
  assert.equal(compact.modelFallback, "selector-unsupported");
  assert.ok(!Object.hasOwn(compact, "actualModel"), "actualModel is omitted when the host does not expose it");
  assert.ok(!Object.hasOwn(compact, "Model"), "artifact attribution must stay outside routing metadata");

  const observed = resolveRouting({}, {
    role: "index", shapeEvidence: atomicEvidence, actualModel: "sonnet",
    supportsModelSelector: false, supportsEffortSelector: false,
  });
  assert.equal(projectRoutingMeasurement(observed).actualModel, "sonnet");
});

test("fleet consumes effective parallelism and owns selective recovery", () => {
  const fleet = readFileSync(join(repoRoot, "plugins/wf/skills/fleet/SKILL.md"), "utf8");
  assert.match(fleet, /One-item wave:[\s\S]{0,500}atomicity: "atomic"[\s\S]{0,300}unitCount: 1[\s\S]{0,300}unitsIndependent: false/);
  assert.match(fleet, /valid singleton evidence selects one `isolated` shipper/);
  assert.match(fleet, /Multi-item wave:[\s\S]{0,500}atomicity: "composite"[\s\S]{0,300}unitsIndependent: true/);
  assert.match(fleet, /min\(available slots, effectiveParallelism\)/);
  assert.match(fleet, /excess ready item[^\n]*queued/);
  assert.match(fleet, /model-homogeneous waves/);
  assert.match(fleet, /shared model as `invocationModel`/);
  assert.match(fleet, /same `invocationModel` selected for that item/);
  assert.match(fleet, /fleet parent[^\n]*postAttempt|parent-owned `postAttempt`/);
  assert.match(fleet, /retain every successful|Retain every successful/);
  assert.match(fleet, /dependency\/input order/);
  assert.match(fleet, /do not raw-query the child's worktree/);
  assert.match(fleet, /no explicit dirty working-state checkpoint/);
});

test("singleton shipper wave uses valid atomic isolated evidence", () => {
  const singleton = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: {
      ...atomicEvidence,
      atomicity: "atomic",
      unitCount: 1,
      unitsIndependent: false,
      ambiguity: "material",
      toolWork: "material",
      contextIsolation: "required",
      requestedParallelism: 1,
    },
    invocationModel: "sonnet",
    supportsModelSelector: true,
    supportsEffortSelector: false,
  });
  assert.equal(singleton.status, "dispatch");
  assert.equal(singleton.executionShape, "isolated");
  assert.equal(singleton.effectiveParallelism, 1);
  assert.equal(singleton.normalizedEvidence.atomicity, "atomic");
  assert.equal(singleton.normalizedEvidence.unitCount, 1);
  assert.equal(singleton.normalizedEvidence.unitsIndependent, false);
});

test("bounded parallel work keeps the effective bound and retained retry units", () => {
  const first = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: { ...atomicEvidence, atomicity: "composite", unitCount: 6, unitsIndependent: true, toolWork: "material", contextIsolation: "required", returnContract: "mechanically-judgeable", requestedParallelism: 8 },
    invocationModel: "sonnet", supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(first.executionShape, "bounded-parallel");
  assert.equal(first.effectiveParallelism, 4);

  const retry = resolveRouting({}, {
    role: "shipper", shapeEvidence: first.normalizedEvidence,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: [],
      units: [
        { unitId: "a", sufficient: true, signals: [] },
        { unitId: "b", sufficient: false, signals: ["failed-validation"] },
        { unitId: "c", sufficient: true, signals: [] },
        { unitId: "d", sufficient: true, signals: [] },
        { unitId: "e", sufficient: true, signals: [] },
        { unitId: "f", sufficient: true, signals: [] },
      ],
      prior: {
        role: first.role, attempt: first.attempt, executionShape: first.executionShape,
        shapeEvidence: first.normalizedEvidence, model: first.model, effort: first.effort,
        basis: first.basis, escalationOrigin: first.escalationOrigin, actualModel: first.actualModel,
      },
    },
  });
  assert.deepEqual(retry.retainedUnitIds, ["a", "c", "d", "e", "f"]);
  assert.deepEqual(retry.retry?.unitIds, ["b"]);
  assert.equal(retry.disposition, "retry");
});
