import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { projectRoutingMeasurement, resolveRouting } from "../src/resolver/routing.js";

const pkgDir = process.env.WF_MCP_DIR;
if (!pkgDir) throw new Error("WF_MCP_DIR is required");
const repoRoot = resolve(pkgDir, "../../..");
const matrixPath = join(repoRoot, "docs/agent-routing-dispositions.md");
const calibrationPath = join(repoRoot, "docs/agent-routing-calibration.md");
const agentRoots = [
  "plugins/wf/agents",
  "plugins/wf-audit/agents",
  "plugins/wf-browser-qa/agents",
  "plugins/wf-angular/agents",
];
const dispositions = new Set(["shipped-static", "adaptive", "evidence-gated", "deferred"]);

type MatrixRow = {
  role: string;
  path: string;
  disposition: string;
  model: string;
  effort: string;
  attemptLimit: number;
  evidence: string;
};

type AdoptionRow = {
  record: string;
  role: string;
  evaluated: string;
  current: string;
  candidates: string[];
  correctness: string;
  latencyContext: string;
  cost: string;
  ownership: string;
  evidenceRefs: string;
  decision: string;
};

type InventoryRow = { role: string; path: string; frontmatter: string };

function unquote(value: string): string {
  return value.trim().replace(/^`|`$/g, "");
}

function parseMatrix(): MatrixRow[] {
  const source = readFileSync(matrixPath, "utf8");
  const heading = "## Complete production matrix";
  const section = source.slice(source.indexOf(heading) + heading.length);
  const lines = section.split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith("| Role | Agent path |"));
  assert.notEqual(header, -1, "routing matrix header is missing");
  const rows: MatrixRow[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.slice(1, -1).split("|").map(unquote);
    assert.equal(cells.length, 8, `matrix row must have eight cells: ${line}`);
    rows.push({
      role: cells[0], path: cells[1], disposition: cells[3], model: cells[4], effort: cells[5],
      attemptLimit: Number(cells[6]), evidence: cells[7],
    });
  }
  return rows;
}

function parseAdoptionRecords(): AdoptionRow[] {
  const lines = readFileSync(calibrationPath, "utf8").split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith("| Record | Role | Owner |"));
  assert.notEqual(header, -1, "calibration record table is missing");
  const rows: AdoptionRow[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.slice(1, -1).split("|").map((cell) => cell.trim());
    assert.equal(cells.length, 13, `calibration row must have thirteen cells: ${line}`);
    const record = cells[0].match(/`(CAL-[a-z0-9-]+)`/)?.[1];
    assert.ok(record, `calibration record id is missing: ${line}`);
    rows.push({
      record,
      role: unquote(cells[1]),
      evaluated: cells[3],
      current: unquote(cells[4]),
      candidates: unquote(cells[5]).split(",").map((value) => value.trim()),
      correctness: unquote(cells[6]),
      latencyContext: unquote(cells[7]),
      cost: unquote(cells[8]),
      ownership: unquote(cells[9]),
      evidenceRefs: unquote(cells[10]),
      decision: unquote(cells[11]),
    });
  }
  return rows;
}

function parseInventory(): InventoryRow[] {
  return agentRoots.flatMap((root) => readdirSync(join(repoRoot, root), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => {
      const absolute = join(repoRoot, root, entry.name);
      const source = readFileSync(absolute, "utf8");
      const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      assert.ok(match, `agent frontmatter is missing: ${relative(repoRoot, absolute)}`);
      const role = match[1].match(/^name:\s*([^\s]+)\s*$/m)?.[1];
      assert.ok(role, `agent name is missing: ${relative(repoRoot, absolute)}`);
      return { role, path: relative(repoRoot, absolute).split(sep).join("/"), frontmatter: match[1] };
    }));
}

function key(row: { role: string; path: string }): string {
  return `${row.role}|${row.path}`;
}

test("published dispositions exactly cover the production agent inventory", () => {
  const matrix = parseMatrix();
  const inventory = parseInventory();
  assert.equal(inventory.length, 17, "bounded production inventory changed; disposition review is required");
  assert.equal(matrix.length, 17, "matrix must contain exactly 17 role/path rows");

  const invalid = matrix.filter((row) => !dispositions.has(row.disposition));
  const duplicateKeys = [...new Set(matrix.map(key).filter((value, index, all) => all.indexOf(value) !== index))];
  const multiplyDisposed = [...new Set(matrix
    .filter((row) => matrix.some((other) => other.role === row.role && other.path === row.path && other.disposition !== row.disposition))
    .map(key))];
  const matrixKeys = new Set(matrix.map(key));
  const inventoryKeys = new Set(inventory.map(key));
  const missing = [...inventoryKeys].filter((value) => !matrixKeys.has(value));
  const stale = [...matrixKeys].filter((value) => !inventoryKeys.has(value));
  assert.deepEqual({ invalid, duplicateKeys, multiplyDisposed, missing, stale }, {
    invalid: [], duplicateKeys: [], multiplyDisposed: [], missing: [], stale: [],
  }, "matrix has invalid, duplicate, multiply-disposed, missing, or stale entries");

  for (const agent of inventory) {
    assert.doesNotMatch(agent.frontmatter, /^(?:model|effort)\s*:/m, `${agent.path} must inherit routing rather than declare agent frontmatter`);
  }
});

test("gated and deferred roles have durable ineligible adoption records", () => {
  const gated = parseMatrix().filter((row) => row.disposition === "evidence-gated" || row.disposition === "deferred");
  const records = parseAdoptionRecords();
  assert.deepEqual(
    records.map((row) => row.role).sort(),
    gated.map((row) => row.role).sort(),
    "every gated or deferred role must have exactly one durable calibration record",
  );
  assert.equal(new Set(records.map((row) => row.role)).size, records.length, "calibration roles must be unique");
  assert.equal(new Set(records.map((row) => row.record)).size, records.length, "calibration record ids must be unique");

  for (const matrixRow of gated) {
    const record = records.find((candidate) => candidate.role === matrixRow.role)!;
    assert.ok(matrixRow.evidence.includes(`#cal-${matrixRow.role})`), `${matrixRow.role} must link its record`);
    assert.match(record.evaluated, /^\d{4}-\d{2}-\d{2}$/, `${matrixRow.role} must date its durable decision`);
    assert.equal(record.current, "inherit", `${matrixRow.role} must retain inheritance until adoption is eligible`);
    assert.ok(record.candidates.includes("inherit"), `${matrixRow.role} candidates must include its current selection`);
    assert.ok(record.evidenceRefs.length > 0, `${matrixRow.role} must explicitly record its evidence references or their absence`);
    assert.equal(record.correctness, "missing", `${matrixRow.role} has no qualifying correctness comparison yet`);
    assert.equal(record.latencyContext, "missing", `${matrixRow.role} has no qualifying latency/context comparison yet`);
    assert.equal(record.cost, "missing", `${matrixRow.role} has no qualifying cost comparison yet`);
    assert.notEqual(record.decision, "adopt", `${matrixRow.role} cannot adopt with missing evidence`);
    if (matrixRow.disposition === "deferred") {
      assert.equal(record.ownership, "unresolved", `${matrixRow.role} must preserve its owner gate`);
      assert.equal(record.decision, "defer", `${matrixRow.role} must defer while ownership is unresolved`);
    } else {
      assert.equal(record.ownership, "resolved", `${matrixRow.role} evidence gate should name resolved ownership`);
      assert.equal(record.decision, "retain", `${matrixRow.role} must retain pending evidence`);
    }
  }
});

test("compact measurement projection preserves routing evidence without artifact attribution", () => {
  const decision = resolveRouting({}, {
    role: "charter-reviewer",
    shapeEvidence: {
      workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
      ambiguity: "material", risk: "elevated", toolWork: "bounded", validation: "judgment",
      contextIsolation: "required", independentReview: true,
      returnContract: "judgment", requestedParallelism: 1,
    },
    invocationModel: "sonnet",
    invocationEffort: "high",
    supportsModelSelector: true,
    supportsEffortSelector: true,
    basis: "calibration-fixture-v1",
    actualModel: "claude-sonnet-4-6",
  });
  assert.deepEqual(projectRoutingMeasurement(decision), {
    role: "charter-reviewer",
    executionShape: "isolated",
    shapeReason: "single-isolation-worthy-unit",
    unitIds: [],
    model: "sonnet",
    effort: "high",
    source: "invocation",
    basis: "calibration-fixture-v1",
    attempt: 1,
    escalationOrigin: null,
    modelFallback: null,
    effortFallback: null,
    masked: false,
    actualModel: "claude-sonnet-4-6",
  });
  assert.ok(!Object.hasOwn(projectRoutingMeasurement({ ...decision, actualModel: undefined }), "actualModel"));
  assert.ok(!Object.hasOwn(projectRoutingMeasurement(decision), "Model"), "artifact Model attribution is not routing metadata");
});

test("matrix pins only the WF-394 bootstrap Haiku defaults", () => {
  const matrix = parseMatrix();
  const staticRows = matrix.filter((row) => row.disposition === "shipped-static");
  assert.deepEqual(staticRows.map((row) => row.role).sort(), ["branch", "classify"]);
  assert.deepEqual(staticRows.map((row) => row.model), ["haiku", "haiku"], "WF-394 shipped defaults must remain Haiku");

  for (const row of matrix) {
    const decision = resolveRouting({}, {
      role: row.role,
      shapeEvidence: {
        workSurface: "external-context",
        atomicity: "atomic",
        unitCount: 1,
        unitsIndependent: false,
        ambiguity: "bounded",
        risk: "low",
        toolWork: "bounded",
        validation: "judgment",
        contextIsolation: "useful",
        independentReview: false,
        returnContract: "mechanically-judgeable",
        requestedParallelism: 1,
      },
      supportsModelSelector: true,
      supportsEffortSelector: true,
      availableModels: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"],
    });
    const expectedModel = row.disposition === "shipped-static" ? row.model : null;
    assert.equal(decision.model.value, expectedModel, `${row.role} model disagrees with its disposition`);
    assert.notEqual(decision.model.value, "opus", `${row.role} must not start on static Opus`);
    assert.equal(decision.effort.value, null, `${row.role} effort must inherit`);
    assert.equal(decision.effort.source, "inheritance", `${row.role} effort source must be inheritance`);
    assert.equal(row.effort, "inherit", `${row.role} matrix effort must inherit`);
    if (row.disposition !== "shipped-static") assert.equal(row.model, "inherit", `${row.role} must not claim a hidden static model`);
  }
});

test("matrix publishes the sole bounded three-attempt role policy", () => {
  const matrix = parseMatrix();
  const invalid = matrix.filter((row) => !Number.isInteger(row.attemptLimit) || row.attemptLimit < 2 || row.attemptLimit > 3);
  assert.deepEqual(invalid, [], "every production role must publish a two- or three-attempt limit");
  assert.deepEqual(
    matrix.filter((row) => row.attemptLimit === 3).map((row) => row.role),
    ["security-auditor"],
    "security-auditor must remain the sole three-attempt exception",
  );

  const inputs = {
    role: "security-auditor",
    shapeEvidence: {
      workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
      ambiguity: "material", risk: "elevated", toolWork: "bounded", validation: "judgment",
      contextIsolation: "required", independentReview: true,
      returnContract: "mechanically-judgeable", requestedParallelism: 1,
    },
    supportsModelSelector: true,
    supportsEffortSelector: true,
    unitIds: ["security-auditor:single"],
  } as const;
  const initial = resolveRouting({}, { ...inputs, invocationModel: "haiku", actualModel: "haiku" });
  const first = resolveRouting({}, {
    ...inputs,
    invocationModel: "haiku",
    postAttempt: {
      sufficient: false,
      signals: ["low-confidence"],
      prior: {
        role: initial.role,
        attempt: 1,
        executionShape: initial.executionShape,
        shapeEvidence: initial.normalizedEvidence,
        unitIds: initial.unitIds,
        model: initial.model,
        effort: initial.effort,
        basis: initial.basis,
        escalationOrigin: null,
        actualModel: "haiku",
      },
    },
  });
  const prior = {
    role: first.role,
    attempt: 2,
    executionShape: first.executionShape,
    shapeEvidence: first.normalizedEvidence,
    unitIds: first.unitIds,
    model: first.model,
    effort: first.effort,
    basis: first.basis,
    escalationOrigin: first.escalationOrigin,
  };
  assert.equal(resolveRouting({}, {
    role: "security-auditor", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    supportsModelSelector: true, supportsEffortSelector: true, attempt: 2,
    postAttempt: { sufficient: false, signals: ["high-severity-review-uncertainty"], prior },
  }).disposition, "retry");
  assert.equal(resolveRouting({}, {
    role: "security-auditor", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    supportsModelSelector: true, supportsEffortSelector: true, attempt: 2,
    postAttempt: { sufficient: false, signals: ["low-confidence"], prior },
  }).disposition, "exhausted");
  assert.equal(resolveRouting({}, {
    role: "security-auditor", shapeEvidence: first.normalizedEvidence, unitIds: first.unitIds,
    supportsModelSelector: true, supportsEffortSelector: true, attempt: 2,
    postAttempt: { sufficient: false, signals: ["high-severity-review-uncertainty", "failed-validation"], prior },
  }).disposition, "exhausted");
});
