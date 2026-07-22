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
  assert.match(fleet, /candidate launch wave[\s\S]{0,500}effectiveParallelism[\s\S]{0,500}exact launch wave/);
  assert.match(fleet, /excess ready items outside the decision[^\n]*`queued`[^\n]*fresh initial routing/);
  assert.match(fleet, /model-homogeneous groups/);
  assert.match(fleet, /initial[\s\S]{0,300}shared per-item choice as `invocationModel`/);
  assert.match(fleet, /same agent id once under the retained routing decision/);
  assert.match(fleet, /`isolated` singleton:[\s\S]{0,300}signals: \["repeated-failure"\][\s\S]{0,200}omit `postAttempt\.units`/);
  assert.match(fleet, /`bounded-parallel` wave:[\s\S]{0,300}complete retained launch wave[\s\S]{0,500}`postAttempt\.units`/);
  assert.match(fleet, /queued outside that decision are not included/);
  assert.match(fleet, /successful launched siblings[\s\S]{0,300}`sufficient`/);
  assert.match(fleet, /failed launched items carry `repeated-failure`/);
  assert.match(fleet, /resolver-authorized retry shape[\s\S]{0,200}composite-to-atomic/);
  assert.match(fleet, /ordered item ids as `unitIds`/);
  assert.match(fleet, /dispatch replacements solely for the resolver-returned `retry\.unitIds`, in retained decision order/);
  assert.match(fleet, /exact resolver-returned next-tier model\/effort/);
  assert.doesNotMatch(fleet, /same `invocationModel` selected for that item/);
  assert.match(fleet, /fleet parent[^\n]*postAttempt|parent-owned `postAttempt`/);
  assert.match(fleet, /Never omit successes from evaluation or reassurance-rerun them/);
  assert.match(fleet, /dependency\/input order/);
  assert.match(fleet, /Do not raw-query or infer a child's dirty state from silence/);
  assert.match(fleet, /absence of an explicit dirty working-state checkpoint/);
  assert.match(fleet, /Do not `TaskStop` on elapsed silence/);
  assert.match(fleet, /explicit terminal\/idle child response or a conclusive documented runtime terminal state/);
  assert.match(fleet, /Reconcile each persisted `dispatched` row deterministically/);
  assert.match(fleet, /no recorded `agentId`.*returns it to `queued`/);
  assert.match(fleet, /runtime confirms active becomes `in-flight`/);
  assert.match(fleet, /without conclusive live-or-terminal state becomes `awaiting-confirmation`/);
  assert.match(fleet, /Never leave a resumed row stranded in `dispatched`/);
  assert.match(fleet, /status \(queued\|dispatched\|in-flight\|awaiting-confirmation\|merged\|blocked\)/);
  assert.match(fleet, /awaiting-confirmation.*occupies an in-flight pool slot/);
  assert.match(fleet, /never satisfies a dependency blocker or closeout/);
  assert.match(fleet, /counting every `in-flight` and `awaiting-confirmation` activation/);
  assert.match(fleet, /after a successful spawn, immediately mark it `in-flight`/);
  assert.match(fleet, /nonterminal scoreboard state to `awaiting-confirmation`/);
  assert.match(fleet, /re-arm supervision/);
  assert.match(fleet, /never mark it `blocked` or enter closeout while the child may still run/);
  assert.match(fleet, /do not submit `postAttempt` until \*\*every launched sibling\*\*/);
  assert.match(fleet, /still-running siblings remain `in-flight`, unknown siblings remain `awaiting-confirmation`/);
  assert.match(fleet, /Only terminal\/idle failed activations may be `TaskStop`ped/);
  assert.match(fleet, /complete retained launch-wave evaluation/);
  assert.match(fleet, /including successful siblings as `sufficient`/);
  assert.match(fleet, /limit only the fresh replacement Agent dispatch to the resolver-returned `retry\.unitIds`/);
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

test("isolated singleton recovery omits units and authorizes one exact-tier retry", () => {
  const first = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: {
      ...atomicEvidence, ambiguity: "material", toolWork: "material", contextIsolation: "required",
    },
    unitIds: ["singleton"],
    invocationModel: "haiku", supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(first.executionShape, "isolated");
  const retry = resolveRouting({}, {
    role: "shipper", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false,
      signals: ["repeated-failure"],
      prior: {
        role: first.role, attempt: first.attempt, executionShape: first.executionShape,
        shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds, model: first.model, effort: first.effort,
        basis: first.basis, escalationOrigin: first.escalationOrigin, actualModel: first.actualModel,
      },
    },
  });
  assert.equal(retry.status, "dispatch");
  assert.equal(retry.disposition, "retry");
  assert.equal(retry.executionShape, "isolated");
  assert.deepEqual(retry.retry?.unitIds, ["singleton"]);
  assert.equal(retry.model.value, "sonnet");
  assert.equal(retry.retry?.priorTier, "haiku");
  assert.equal(retry.retry?.nextTier, "sonnet");
});

test("fleet replacement retries only failed bounded units at the exact next tier", () => {
  const first = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: { ...atomicEvidence, atomicity: "composite", unitCount: 2, unitsIndependent: true, toolWork: "material", contextIsolation: "required", requestedParallelism: 2 },
    unitIds: ["a", "b"],
    invocationModel: "haiku", supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(first.status, "dispatch");
  assert.equal(first.executionShape, "bounded-parallel");

  const prior = {
    role: first.role, attempt: first.attempt, executionShape: first.executionShape,
    shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds, model: first.model, effort: first.effort,
    basis: first.basis, escalationOrigin: first.escalationOrigin, actualModel: first.actualModel,
  };
  const missingUnits = resolveRouting({}, {
    role: "shipper", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: ["repeated-failure"], prior,
    },
  });
  assert.equal(missingUnits.status, "stop");
  assert.equal(missingUnits.disposition, "invalid-stop");
  assert.equal(missingUnits.retry, null);
  assert.match(missingUnits.diagnostic ?? "", /bounded-parallel evaluation requires complete unit results/);

  const retry = resolveRouting({}, {
    role: "shipper", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    invocationModel: "haiku", supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: [], prior,
      units: [
        { unitId: "a", sufficient: true, signals: [] },
        { unitId: "b", sufficient: false, signals: ["repeated-failure"] },
      ],
    },
  });
  assert.equal(retry.status, "dispatch");
  assert.equal(retry.disposition, "retry");
  assert.deepEqual(retry.retainedUnitIds, ["a"]);
  assert.deepEqual(retry.retry?.unitIds, ["b"]);
  assert.equal(retry.executionShape, "isolated");
  assert.equal(retry.model.value, "sonnet");
  assert.equal(retry.retry?.priorTier, "haiku");
  assert.equal(retry.retry?.nextTier, "sonnet");

  const highest = resolveRouting({}, {
    role: "shipper", shapeEvidence: atomicEvidence, unitIds: ["highest"],
    invocationModel: "opus", supportsModelSelector: true, supportsEffortSelector: false,
  });
  const exhausted = resolveRouting({}, {
    role: "shipper", shapeEvidence: highest.normalizedEvidence, unitIds: highest.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: ["repeated-failure"],
      prior: {
        role: highest.role, attempt: highest.attempt, executionShape: highest.executionShape,
        shapeEvidence: highest.normalizedEvidence, unitIds: highest.unitIds, model: highest.model, effort: highest.effort,
        basis: highest.basis, escalationOrigin: highest.escalationOrigin, actualModel: highest.actualModel,
      },
    },
  });
  assert.equal(exhausted.status, "stop");
  assert.equal(exhausted.disposition, "invalid-stop");
  assert.match(exhausted.diagnostic ?? "", /highest stable tier/);
  assert.equal(exhausted.retry, null);
});

test("bounded unit identities reject forged sets and normalize evaluation order", () => {
  const evidence = {
    ...atomicEvidence, atomicity: "composite" as const, unitCount: 3,
    unitsIndependent: true, toolWork: "material" as const, contextIsolation: "required" as const,
    requestedParallelism: 3,
  };
  const countMismatch = resolveRouting({}, {
    role: "shipper", shapeEvidence: evidence, unitIds: ["a"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(countMismatch.disposition, "invalid-stop");
  assert.match(countMismatch.diagnostic ?? "", /unitIds must match shape evidence unitCount/);
  const duplicateInitial = resolveRouting({}, {
    role: "shipper", shapeEvidence: evidence, unitIds: ["a", "a", "c"],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(duplicateInitial.disposition, "invalid-stop");
  assert.match(duplicateInitial.diagnostic ?? "", /unitIds must be unique/);
  const oversizedInitialId = resolveRouting({}, {
    role: "shipper", shapeEvidence: evidence, unitIds: ["a", "b", "x".repeat(129)],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(oversizedInitialId.disposition, "invalid-stop");
  assert.match(oversizedInitialId.diagnostic ?? "", /unitIds must be at most 128 characters/);
  const controlInitialId = resolveRouting({}, {
    role: "shipper", shapeEvidence: evidence, unitIds: ["a", "b", "c" + String.fromCharCode(27)],
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(controlInitialId.disposition, "invalid-stop");
  assert.match(controlInitialId.diagnostic ?? "", /canonical printable identifier characters/);

  const first = resolveRouting({}, {
    role: "shipper", shapeEvidence: evidence, unitIds: ["a", "b", "c"], invocationModel: "haiku",
    supportsModelSelector: true, supportsEffortSelector: false,
  });
  const prior = {
    role: first.role, attempt: first.attempt, executionShape: first.executionShape,
    shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    model: first.model, effort: first.effort, basis: first.basis,
    escalationOrigin: first.escalationOrigin, actualModel: first.actualModel,
  };
  const duplicatePostAttemptIds = resolveRouting({}, {
    role: "shipper", shapeEvidence: first.normalizedEvidence, unitIds: ["a", "a", "a"],
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: { sufficient: false, signals: ["failed-validation"], prior },
  });
  assert.equal(duplicatePostAttemptIds.disposition, "invalid-stop");
  assert.match(duplicatePostAttemptIds.diagnostic ?? "", /unitIds must be unique/);

  const evaluate = (units: Array<{ unitId: string; sufficient: boolean; signals: Array<"failed-validation"> }>) =>
    resolveRouting({}, {
      role: "shipper", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
      supportsModelSelector: true, supportsEffortSelector: false,
      postAttempt: { sufficient: false, signals: [], prior, units },
    });
  for (const [units, pattern] of [
    [[{ unitId: "a", sufficient: true, signals: [] }, { unitId: "b", sufficient: false, signals: ["failed-validation"] }], /cover every/],
    [[{ unitId: "a", sufficient: true, signals: [] }, { unitId: "b", sufficient: false, signals: ["failed-validation"] }, { unitId: "c", sufficient: true, signals: [] }, { unitId: "d", sufficient: true, signals: [] }], /cover every/],
    [[{ unitId: "a", sufficient: true, signals: [] }, { unitId: "b", sufficient: false, signals: ["failed-validation"] }, { unitId: "forged", sufficient: true, signals: [] }], /match the retained prior unitIds/],
    [[{ unitId: "a", sufficient: true, signals: [] }, { unitId: "b", sufficient: false, signals: ["failed-validation"] }, { unitId: "x".repeat(129), sufficient: true, signals: [] }], /unitId must be at most 128 characters/],
    [[{ unitId: "a", sufficient: true, signals: [] }, { unitId: "b", sufficient: false, signals: ["failed-validation"] }, { unitId: "c" + String.fromCharCode(27), sufficient: true, signals: [] }], /canonical printable identifier characters/],
    [[{ unitId: "a", sufficient: true, signals: [] }, { unitId: "a", sufficient: false, signals: ["failed-validation"] }, { unitId: "c", sufficient: true, signals: [] }], /duplicated/],
  ] as const) {
    const decision = evaluate(units as never);
    assert.equal(decision.disposition, "invalid-stop");
    assert.match(decision.diagnostic ?? "", pattern);
  }
  const reordered = evaluate([
    { unitId: "c", sufficient: true, signals: [] },
    { unitId: "a", sufficient: true, signals: [] },
    { unitId: "b", sufficient: false, signals: ["failed-validation"] },
  ]);
  assert.equal(reordered.disposition, "retry");
  assert.deepEqual(reordered.retainedUnitIds, ["a", "c"]);
  assert.deepEqual(reordered.retry?.unitIds, ["b"]);
});

test("bounded parallel work rejects oversized waves and keeps retained retry units", () => {
  const oversized = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: { ...atomicEvidence, atomicity: "composite", unitCount: 5, unitsIndependent: true, toolWork: "material", contextIsolation: "required", returnContract: "mechanically-judgeable", requestedParallelism: 8 },
    unitIds: ["a", "b", "c", "d", "e"],
    invocationModel: "sonnet", supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(oversized.disposition, "invalid-stop");
  assert.match(oversized.diagnostic ?? "", /unitCount must be an integer from 1 to 4/);

  const first = resolveRouting({}, {
    role: "shipper",
    shapeEvidence: { ...atomicEvidence, atomicity: "composite", unitCount: 4, unitsIndependent: true, toolWork: "material", contextIsolation: "required", returnContract: "mechanically-judgeable", requestedParallelism: 8 },
    unitIds: ["a", "b", "c", "d"],
    invocationModel: "sonnet", supportsModelSelector: true, supportsEffortSelector: false,
  });
  assert.equal(first.executionShape, "bounded-parallel");
  assert.equal(first.effectiveParallelism, 4);

  const retry = resolveRouting({}, {
    role: "shipper", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    supportsModelSelector: true, supportsEffortSelector: false,
    postAttempt: {
      sufficient: false, signals: [],
      units: [
        { unitId: "a", sufficient: true, signals: [] },
        { unitId: "b", sufficient: false, signals: ["failed-validation"] },
        { unitId: "c", sufficient: true, signals: [] },
        { unitId: "d", sufficient: true, signals: [] },
      ],
      prior: {
        role: first.role, attempt: first.attempt, executionShape: first.executionShape,
        shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds, model: first.model, effort: first.effort,
        basis: first.basis, escalationOrigin: first.escalationOrigin, actualModel: first.actualModel,
      },
    },
  });
  assert.deepEqual(retry.retainedUnitIds, ["a", "c", "d"]);
  assert.deepEqual(retry.retry?.unitIds, ["b"]);
  assert.equal(retry.disposition, "retry");
});
