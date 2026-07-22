import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { projectRoutingMeasurement, resolveRouting } from "../src/resolver/routing.js";

const pkgDir = process.env.WF_MCP_DIR;
if (!pkgDir) throw new Error("WF_MCP_DIR is required");
const repoRoot = resolve(pkgDir, "../../..");
const inventoryPath = join(repoRoot, "plugins/wf/skills/_contracts/core-dispatch-inventory.tsv");

type Row = { id: string; classification: string; file: string; target: string; role: string; selectors: string; evidence: string };
function rows(): Row[] {
  return readFileSync(inventoryPath, "utf8").split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [id, classification, file, target, role, selectors, evidence] = line.split("\t");
      return { id, classification, file, target, role, selectors, evidence };
    });
}

const atomicEvidence = {
  workSurface: "external-context" as const, atomicity: "atomic" as const, unitCount: 1,
  unitsIndependent: false, ambiguity: "bounded" as const, risk: "elevated" as const,
  toolWork: "bounded" as const, validation: "judgment" as const, contextIsolation: "useful" as const,
  independentReview: false, returnContract: "mechanically-judgeable" as const, requestedParallelism: 1,
};

test("authoritative dispatch inventory is normalized and bidirectional", () => {
  const inventory = rows();
  assert.equal(new Set(inventory.map((row) => row.id)).size, inventory.length, "inventory ids must be unique");
  assert.equal(inventory.filter((row) => row.classification === "excluded").length, 4, "only the four revised-spec exclusions are allowed");
  const included = inventory.filter((row) => row.classification === "included");
  assert.equal(included.length, 29, "fixed core dispatch inventory changed; review and guard update required");
  for (const row of included) {
    const source = readFileSync(join(repoRoot, row.file), "utf8");
    for (const target of row.target.split(",")) assert.ok(source.includes(target), `${row.id} target is stale`);
    assert.ok(["shared-gate-and-index", "index-wrapper-mediated"].includes(row.evidence) || row.evidence.split(",").length === 12, `${row.id} requires complete shape evidence`);
    assert.match(row.selectors, /^(?:model=(?:true|false);effort=(?:true|false)|mixed)$/);
  }
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
  assert.ok(!Object.hasOwn(compact, "Model"), "artifact attribution must stay outside routing metadata");
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
