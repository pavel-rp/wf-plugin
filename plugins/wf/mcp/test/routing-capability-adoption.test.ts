import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { projectRoutingMeasurement, resolveRouting } from "../src/resolver/routing.js";

const pkgDir = process.env.WF_MCP_DIR;
if (!pkgDir) throw new Error("WF_MCP_DIR is required");
const repoRoot = resolve(pkgDir, "../../..");
const inventoryPath = join(repoRoot, "plugins/wf/skills/_contracts/capability-dispatch-inventory.tsv");

type Row = { id: string; classification: string; file: string; target: string; role: string; selectors: string; evidence: string; retryOwner: string };
function rows(): Row[] {
  return readFileSync(inventoryPath, "utf8").split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [id, classification, file, target, role, selectors, evidence, retryOwner] = line.split("\t");
      return { id, classification, file, target, role, selectors, evidence, retryOwner };
    });
}

const isolatedEvidence = {
  workSurface: "external-context" as const, atomicity: "atomic" as const, unitCount: 1,
  unitsIndependent: false, ambiguity: "material" as const, risk: "elevated" as const,
  toolWork: "material" as const, validation: "judgment" as const, contextIsolation: "required" as const,
  independentReview: false, returnContract: "mechanically-judgeable" as const, requestedParallelism: 1,
};

test("capability dispatch inventory is normalized and marker-bidirectional", () => {
  const inventory = rows();
  assert.equal(new Set(inventory.map((row) => row.id)).size, inventory.length);
  const included = inventory.filter((row) => row.classification === "included");
  assert.equal(included.length, 13, "capability dispatch surface changed; adjudicate inventory and guard");
  assert.equal(inventory.filter((row) => row.classification === "excluded").length, 5);
  for (const row of included) {
    const source = readFileSync(join(repoRoot, row.file), "utf8");
    assert.equal(source.match(new RegExp(`<!-- capability-route:${row.id} -->`, "g"))?.length, 1, `${row.id} marker drifted`);
    assert.match(row.selectors, /^model=(?:true|false);effort=(?:true|false)$/);
    assert.ok(row.evidence === "index-wrapper-mediated" || row.evidence.split(",").length === 12);
    assert.ok(row.retryOwner);
  }
});

test("capability routing guard catches stale or bypassed adoption", () => {
  const guard = join(repoRoot, "plugins/wf/skills/_contracts/capability-dispatch-routing-guard.sh");
  const selftest = spawnSync("bash", [guard, "--selftest"], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(selftest.status, 0, `${selftest.stdout}\n${selftest.stderr}`);
  assert.match(selftest.stdout, /self-test passed/);
  const live = spawnSync("bash", [guard], { cwd: repoRoot, encoding: "utf8" });
  assert.equal(live.status, 0, `${live.stdout}\n${live.stderr}`);
  assert.match(live.stdout, /13 included edges, 5 exclusions/);
});

test("evidence-gated and deferred capability roles retain inherited selectors", () => {
  for (const role of ["correctness-auditor", "security-auditor", "audit-retrospective", "qa-engine", "qa-host", "index"]) {
    const decision = resolveRouting({}, {
      role, shapeEvidence: isolatedEvidence, unitIds: [`capability:${role}`],
      supportsModelSelector: role !== "index", supportsEffortSelector: false,
    });
    assert.equal(decision.status, "dispatch", role);
    assert.equal(decision.executionShape, "isolated", role);
    assert.equal(decision.model.value, null, role);
    assert.equal(decision.model.source, "inheritance", role);
    assert.equal(decision.effort.value, null, role);
    assert.equal(projectRoutingMeasurement(decision).actualModel, undefined, role);
  }
});

test("thin provider agents select inline sibling Skill execution", () => {
  const evidence = {
    workSurface: "caller-context" as const, atomicity: "atomic" as const, unitCount: 1,
    unitsIndependent: false, ambiguity: "none" as const, risk: "low" as const,
    toolWork: "none" as const, validation: "mechanical" as const, contextIsolation: "none" as const,
    independentReview: false, returnContract: "mechanically-judgeable" as const, requestedParallelism: 1,
  };
  for (const role of ["qa-engine", "qa-host"]) {
    const decision = resolveRouting({}, {
      role, shapeEvidence: evidence, unitIds: [`${role}:skill`],
      supportsModelSelector: false, supportsEffortSelector: false,
    });
    assert.equal(decision.status, "dispatch", role);
    assert.equal(decision.executionShape, "inline", role);
    assert.equal(decision.model.value, null, role);
    assert.equal(decision.effort.value, null, role);
  }
});

test("engine model metadata and retrospective ids stay explicit", () => {
  const engine = readFileSync(join(repoRoot, "plugins/wf-browser-qa/skills/qa-engine/SKILL.md"), "utf8");
  const orchestrator = readFileSync(join(repoRoot, "plugins/wf/skills/qa-auto/SKILL.md"), "utf8");
  const retrospective = readFileSync(join(repoRoot, "plugins/wf-audit/capabilities/audit/fragments/retrospective.md"), "utf8");
  assert.match(engine, /return `Driver model: <current model identifier>` as compact run metadata/);
  assert.match(orchestrator, /actual current model identifier from the engine's returned `Driver model:` metadata/);
  assert.match(retrospective, /outside `\[A-Za-z0-9\._:\/-\]` with `-`/);
  assert.match(retrospective, /stable SHA-256 prefix/);
});

test("capability routing records safe fallback and bounded parent escalation", () => {
  const unavailable = resolveRouting({}, {
    role: "qa-engine", shapeEvidence: isolatedEvidence, unitIds: ["qa-auto:engine"],
    invocationModel: "sonnet", availableModels: ["haiku"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(unavailable.model.value, null);
  assert.equal(unavailable.model.fallback, "unavailable");
  assert.equal(projectRoutingMeasurement(unavailable).modelFallback, "unavailable");

  const first = resolveRouting({}, {
    role: "qa-host", shapeEvidence: isolatedEvidence, unitIds: ["qa-followup:host:augment:target"],
    invocationModel: "haiku", supportsModelSelector: true, supportsEffortSelector: false,
  });
  const retry = resolveRouting({}, {
    role: first.role, shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: ["failed-validation"],
      prior: {
        role: first.role, attempt: first.attempt, executionShape: first.executionShape,
        shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds, model: first.model,
        effort: first.effort, basis: first.basis, escalationOrigin: first.escalationOrigin,
        actualModel: first.actualModel,
      },
    },
  });
  assert.equal(retry.disposition, "retry");
  assert.deepEqual(retry.retry?.unitIds, first.unitIds);
  assert.equal(retry.model.value, "sonnet");
  assert.equal(retry.escalationOrigin, "routing:qa-host:attempt-1");
});
