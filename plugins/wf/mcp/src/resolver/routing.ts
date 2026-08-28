import type {
  NormalizedRoutingShapeEvidence,
  RoutingChoice,
  RoutingDecision,
  RoutingInputs,
  RoutingInsufficiencySignal,
  RoutingMeasurement,
  RoutingPostAttemptEvaluation,
  RoutingProjectConfig,
  RoutingShapeEvidence,
  RoutingShapeReason,
  RoutingSource,
} from "./types.js";

const DEFAULTS: RoutingProjectConfig = {
  classify: { model: "haiku", effort: null },
  branch: { model: "haiku", effort: null },
};

const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UNIT_ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const UNSAFE_ROUTING_CHARACTER = /\p{C}/u;
const EFFORTS = new Set(["low", "medium", "high", "max"]);
const MAX_PARALLELISM = 4;
const MAX_UNIT_ID_LENGTH = 128;
const MAX_AVAILABLE_MODELS = 64;
const MAX_MODEL_ID_LENGTH = 128;
const MAX_EFFORT_LENGTH = 16;
const MAX_ROUTING_METADATA_LENGTH = 256;
const MAX_ROLE_LENGTH = 64;
const MODEL_TIERS = ["haiku", "sonnet", "opus"] as const;
const INSUFFICIENCY_SIGNALS = new Set<RoutingInsufficiencySignal>([
  "low-confidence",
  "failed-validation",
  "conflicting-or-incomplete-evidence",
  "repeated-failure",
  "increased-risk-or-scope",
  "high-severity-review-uncertainty",
]);

type ModelTier = (typeof MODEL_TIERS)[number];
type ShapeDecision = Pick<RoutingDecision, "executionShape" | "normalizedEvidence" | "shapeReason" | "effectiveParallelism"> & {
  stop: string | null;
};

// THE ONE COUNT-DERIVED SHAPE RULE. `unitCount` is authoritative: `atomicity` is
// DERIVED from it (1 -> "atomic", >= 2 -> "composite") and `unitsIndependent` is
// CLAMPED to false at one unit, because independence is undefined for a single
// unit. This is the single rule BOTH caller-facing paths obey — the input path
// (`selectShape`, which normalizes rather than rejecting a contradictory pair and
// reports the result on `normalizedEvidence`) and the retry path (which narrows a
// composite set to its insufficient units and re-derives the same two fields).
// One function, two call sites, so the two can never drift apart again.
function derivedCountEvidence(
  unitCount: number,
  unitsIndependent: boolean,
): Pick<RoutingShapeEvidence, "atomicity" | "unitsIndependent"> {
  return {
    atomicity: unitCount === 1 ? "atomic" : "composite",
    unitsIndependent: unitCount > 1 && unitsIndependent,
  };
}

// Apply the rule to a whole evidence object. A `unitCount` that is not a positive
// integer is left alone: that input is rejected by its own range check, and
// deriving from a nonsense count would only swap one diagnostic for another.
function withDerivedCountEvidence<T extends RoutingShapeEvidence>(evidence: T): T {
  return evidence && Number.isInteger(evidence.unitCount) && evidence.unitCount >= 1
    ? { ...evidence, ...derivedCountEvidence(evidence.unitCount, evidence.unitsIndependent) }
    : evidence;
}

function selectShape(inputs: RoutingInputs): ShapeDecision {
  const evidence = inputs.shapeEvidence as Partial<RoutingInputs["shapeEvidence"]> | undefined;
  const normalizedEvidence: NormalizedRoutingShapeEvidence = {
    workSurface: evidence?.workSurface ?? "caller-context",
    atomicity: evidence?.atomicity ?? "atomic",
    unitCount: evidence?.unitCount ?? 0,
    unitsIndependent: evidence?.unitsIndependent ?? false,
    ambiguity: evidence?.ambiguity ?? "none",
    risk: evidence?.risk ?? "low",
    toolWork: evidence?.toolWork ?? "none",
    validation: evidence?.validation ?? "mechanical",
    contextIsolation: evidence?.contextIsolation ?? "none",
    independentReview: evidence?.independentReview ?? false,
    returnContract: evidence?.returnContract ?? "mechanically-judgeable",
    requestedParallelism: evidence?.requestedParallelism ?? 0,
  };
  const enumFields = [
    ["workSurface", evidence?.workSurface, ["caller-context", "external-context"]],
    ["atomicity", evidence?.atomicity, ["atomic", "composite"]],
    ["ambiguity", evidence?.ambiguity, ["none", "bounded", "material"]],
    ["risk", evidence?.risk, ["low", "elevated"]],
    ["toolWork", evidence?.toolWork, ["none", "bounded", "material"]],
    ["validation", evidence?.validation, ["mechanical", "judgment"]],
    ["contextIsolation", evidence?.contextIsolation, ["none", "useful", "required"]],
    ["returnContract", evidence?.returnContract, ["mechanically-judgeable", "judgment"]],
  ] as const;
  const invalidEnum = enumFields.find(([, value, allowed]) => typeof value !== "string" || !allowed.includes(value as never));
  const invalidBoolean = ["unitsIndependent", "independentReview"].find(
    (field) => typeof evidence?.[field as "unitsIndependent" | "independentReview"] !== "boolean",
  );
  const stop = !evidence
    ? "shape evidence is required"
    : invalidEnum
      ? `shape evidence ${invalidEnum[0]} must be one of: ${invalidEnum[2].join(", ")}`
      : invalidBoolean
        ? `shape evidence ${invalidBoolean} must be boolean`
        : !Number.isInteger(evidence.unitCount) || (evidence.unitCount ?? 0) < 1 || (evidence.unitCount ?? 0) > MAX_PARALLELISM
          ? `shape evidence unitCount must be an integer from 1 to ${MAX_PARALLELISM}`
          : !Number.isInteger(evidence.requestedParallelism) || (evidence.requestedParallelism ?? 0) < 1
            ? "shape evidence requestedParallelism must be a positive integer"
            : null;

  if (stop) {
    return {
      executionShape: "inline",
      normalizedEvidence,
      shapeReason: "dependent-or-nonmaterial-units",
      effectiveParallelism: 1,
      stop,
    };
  }

  // `atomicity` and `unitsIndependent` are DERIVED from the authoritative
  // `unitCount`, never a second source of truth a caller can contradict. A pair
  // the caller states inconsistently is normalized here — not rejected — and the
  // derived values are what `normalizedEvidence` reports back, so the caller can
  // read exactly what the resolver made of its evidence. `atomicity` feeds no
  // shape predicate below and `parallelWorthy` already requires two or more
  // units, so this derivation cannot change a selected shape.
  const derived = derivedCountEvidence(normalizedEvidence.unitCount, normalizedEvidence.unitsIndependent);
  normalizedEvidence.atomicity = derived.atomicity;
  normalizedEvidence.unitsIndependent = derived.unitsIndependent;

  const isolationWorthy =
    normalizedEvidence.workSurface === "external-context" ||
    normalizedEvidence.ambiguity !== "none" ||
    normalizedEvidence.risk === "elevated" ||
    normalizedEvidence.toolWork !== "none" ||
    normalizedEvidence.validation === "judgment" ||
    normalizedEvidence.contextIsolation !== "none" ||
    normalizedEvidence.independentReview;
  const parallelWorthy =
    normalizedEvidence.unitsIndependent &&
    normalizedEvidence.unitCount >= 2 &&
    normalizedEvidence.requestedParallelism >= 2 &&
    normalizedEvidence.returnContract === "mechanically-judgeable" &&
    (normalizedEvidence.ambiguity !== "none" ||
      normalizedEvidence.risk === "elevated" ||
      normalizedEvidence.toolWork !== "none" ||
      normalizedEvidence.contextIsolation !== "none" ||
      normalizedEvidence.independentReview);

  if (parallelWorthy) {
    return {
      executionShape: "bounded-parallel",
      normalizedEvidence,
      shapeReason: "independent-material-units",
      effectiveParallelism: Math.min(
        normalizedEvidence.unitCount,
        normalizedEvidence.requestedParallelism,
        MAX_PARALLELISM,
      ),
      stop: null,
    };
  }
  if (isolationWorthy) {
    return {
      executionShape: "isolated",
      normalizedEvidence,
      shapeReason: normalizedEvidence.unitCount === 1
        ? "single-isolation-worthy-unit"
        : "dependent-or-nonmaterial-units",
      effectiveParallelism: 1,
      stop: null,
    };
  }
  return {
    executionShape: "inline",
    normalizedEvidence,
    shapeReason: normalizedEvidence.unitCount === 1
      ? "atomic-caller-context"
      : "nonmaterial-units-inline",
    effectiveParallelism: 1,
    stop: null,
  };
}

function choose(
  kind: "model" | "effort",
  inputs: RoutingInputs,
  project: RoutingProjectConfig,
): { choice: RoutingChoice; stop: string | null } {
  const selectorSupported = kind === "model" ? inputs.supportsModelSelector : inputs.supportsEffortSelector;
  const host = kind === "model" ? inputs.hostModel : inputs.hostEffort;
  const invocation = kind === "model" ? inputs.invocationModel : inputs.invocationEffort;
  const configured = project[inputs.role]?.[kind] ?? null;
  const shipped = DEFAULTS[inputs.role]?.[kind] ?? null;
  const required = kind === "model" ? inputs.requireModel : inputs.requireEffort;
  const requested = invocation ?? configured ?? shipped;
  const requestedSource: RoutingSource = invocation
    ? "invocation"
    : configured
      ? "project"
      : shipped
        ? "shipped-default"
        : "inheritance";

  const maximum = kind === "model" ? MAX_MODEL_ID_LENGTH : MAX_EFFORT_LENGTH;
  if (host && UNSAFE_ROUTING_CHARACTER.test(host)) {
    return {
      choice: { value: null, source: "inheritance", requested: null, requestedSource: "inheritance", masked: false, fallback: "malformed" },
      stop: `${kind} host choice must not contain control or format characters`,
    };
  }
  if (host && host.length > maximum) {
    return {
      choice: { value: null, source: "inheritance", requested: null, requestedSource: "inheritance", masked: false, fallback: "malformed" },
      stop: `${kind} host choice must be at most ${maximum} characters`,
    };
  }
  if (host) {
    return {
      choice: { value: host, source: "host", requested, requestedSource, masked: requested !== null && requested !== host, fallback: null },
      stop: null,
    };
  }
  if (!requested) {
    return { choice: { value: null, source: "inheritance", requested: null, requestedSource: "inheritance", masked: false, fallback: null }, stop: required ? `${kind} override is required but none was supplied` : null };
  }
  if (UNSAFE_ROUTING_CHARACTER.test(requested)) {
    return {
      choice: { value: null, source: "inheritance", requested: null, requestedSource: "inheritance", masked: false, fallback: "malformed" },
      stop: `${kind} choice must not contain control or format characters`,
    };
  }
  if (requested.length > maximum) {
    return {
      choice: { value: null, source: "inheritance", requested: null, requestedSource: "inheritance", masked: false, fallback: "malformed" },
      stop: `${kind} choice must be at most ${maximum} characters`,
    };
  }
  const valid = kind === "model" ? MODEL_TOKEN.test(requested) : EFFORTS.has(requested);
  if (!valid) {
    const stop = required ? `${kind} choice \`${requested}\` is required but malformed` : null;
    return { choice: { value: null, source: "inheritance", requested, requestedSource, masked: false, fallback: "malformed" }, stop };
  }
  if (!selectorSupported) {
    const stop = required ? `${kind} choice \`${requested}\` is required but this runtime cannot honor it` : null;
    return { choice: { value: null, source: "inheritance", requested, requestedSource, masked: false, fallback: "selector-unsupported" }, stop };
  }
  const modelAvailable = (choice: string): boolean =>
    !inputs.availableModels || inputs.availableModels.some((available) =>
      available === choice || (choice === "haiku" || choice === "sonnet" || choice === "opus") && available.includes(`-${choice}-`),
    );
  if (kind === "model" && !modelAvailable(requested)) {
    const stop = required ? `model choice \`${requested}\` is required but unavailable` : null;
    return { choice: { value: null, source: "inheritance", requested, requestedSource, masked: false, fallback: "unavailable" }, stop };
  }
  return { choice: { value: requested, source: requestedSource, requested, requestedSource, masked: false, fallback: null }, stop: null };
}

function modelTier(value: string | null | undefined): ModelTier | null {
  if (!value) return null;
  const exact = MODEL_TIERS.find((tier) => value === tier);
  if (exact) return exact;
  const matches = MODEL_TIERS.filter((tier) => new RegExp(`(^|[-_.])${tier}([-_.]|$)`).test(value));
  return matches.length === 1 ? matches[0] : null;
}

function validSignals(signals: unknown): signals is RoutingInsufficiencySignal[] {
  return Array.isArray(signals) &&
    signals.length <= INSUFFICIENCY_SIGNALS.size &&
    new Set(signals).size === signals.length &&
    signals.every((signal) => INSUFFICIENCY_SIGNALS.has(signal));
}

const SHAPE_EVIDENCE_KEYS = [
  "workSurface", "atomicity", "unitCount", "unitsIndependent", "ambiguity", "risk",
  "toolWork", "validation", "contextIsolation", "independentReview", "returnContract", "requestedParallelism",
] as const;

function sameShapeEvidence(a: RoutingInputs["shapeEvidence"], b: RoutingInputs["shapeEvidence"]): boolean {
  return SHAPE_EVIDENCE_KEYS.every((key) => a[key] === b[key]);
}

function boundedOptionalString(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return `${field} must be a string or null`;
  if (UNSAFE_ROUTING_CHARACTER.test(value)) return `${field} must not contain control or format characters`;
  // A hard rejection that names the field, the bound, AND the length received —
  // so a caller knows exactly how much to remove. Nothing is ever truncated: the
  // over-long value is dropped from the decision rather than shortened into it.
  return value.length > maximum
    ? `${field} must be at most ${maximum} characters (received ${value.length})`
    : null;
}

function routingScalarProblem(inputs: RoutingInputs): string | null {
  const checks: Array<[unknown, string, number]> = [
    [inputs.invocationModel, "invocationModel", MAX_MODEL_ID_LENGTH],
    [inputs.invocationEffort, "invocationEffort", MAX_EFFORT_LENGTH],
    [inputs.hostModel, "hostModel", MAX_MODEL_ID_LENGTH],
    [inputs.hostEffort, "hostEffort", MAX_EFFORT_LENGTH],
    [inputs.basis, "basis", MAX_ROUTING_METADATA_LENGTH],
    [inputs.escalationOrigin, "escalationOrigin", MAX_ROUTING_METADATA_LENGTH],
    [inputs.actualModel, "actualModel", MAX_MODEL_ID_LENGTH],
  ];
  for (const [value, field, maximum] of checks) {
    const problem = boundedOptionalString(value, field, maximum);
    if (problem) return problem;
  }
  return null;
}

function routingChoiceProblem(choice: RoutingChoice | undefined, field: string, maximum: number): string | null {
  if (!choice) return `post-attempt prior ${field} choice is required`;
  return boundedOptionalString(choice.value, `post-attempt prior ${field}.value`, maximum) ??
    boundedOptionalString(choice.requested, `post-attempt prior ${field}.requested`, maximum);
}

function availableModelsProblem(availableModels: unknown): string | null {
  if (availableModels === undefined || availableModels === null) return null;
  if (!Array.isArray(availableModels)) return "availableModels must be an array or null";
  if (availableModels.length > MAX_AVAILABLE_MODELS) return `availableModels must contain at most ${MAX_AVAILABLE_MODELS} entries`;
  if (availableModels.some((model) => typeof model !== "string" || !model.length)) return "availableModels entries must be non-empty strings";
  if (availableModels.some((model) => UNSAFE_ROUTING_CHARACTER.test(model))) return "availableModels entries must not contain control or format characters";
  if (availableModels.some((model) => model.length > MAX_MODEL_ID_LENGTH)) return `availableModels entries must be at most ${MAX_MODEL_ID_LENGTH} characters`;
  return null;
}

function unitIdsProblem(unitIds: unknown, unitCount: number): string | null {
  if (!Array.isArray(unitIds)) return "routing unitIds are required";
  if (unitIds.length > MAX_PARALLELISM) return `routing unitIds must contain at most ${MAX_PARALLELISM} entries`;
  if (unitIds.length !== unitCount) return "routing unitIds must match shape evidence unitCount";
  if (unitIds.some((id) => typeof id !== "string" || !id.trim())) return "routing unitIds must be non-empty strings";
  if (unitIds.some((id) => id.length > MAX_UNIT_ID_LENGTH)) return `routing unitIds must be at most ${MAX_UNIT_ID_LENGTH} characters`;
  if (unitIds.some((id) => !UNIT_ID_TOKEN.test(id))) return "routing unitIds must use canonical printable identifier characters";
  if (new Set(unitIds).size !== unitIds.length) return "routing unitIds must be unique";
  return null;
}

function sameUnitIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

function evaluationProblem(evaluation: RoutingPostAttemptEvaluation, inputs: RoutingInputs): string | null {
  const inputScalarProblem = routingScalarProblem(inputs) ?? availableModelsProblem(inputs.availableModels);
  if (inputScalarProblem) return `post-attempt ${inputScalarProblem}`;
  const { prior } = evaluation;
  if (!prior || !Number.isInteger(prior.attempt) || prior.attempt < 1 || prior.attempt > 3) {
    return "post-attempt prior attempt must be an integer from 1 to 3";
  }
  if (prior.role.length > MAX_ROLE_LENGTH) return `post-attempt prior role must be at most ${MAX_ROLE_LENGTH} characters`;
  if (prior.role !== inputs.role) {
    return "post-attempt prior role must match the routed role";
  }
  if (inputs.attempt !== undefined && inputs.attempt !== prior.attempt) {
    return "post-attempt attempt contradicts the prior routing attempt";
  }
  if (inputs.escalationOrigin !== undefined && inputs.escalationOrigin !== prior.escalationOrigin) {
    return "post-attempt escalationOrigin contradicts the prior routing attempt";
  }
  if (inputs.basis !== undefined && (inputs.basis ?? null) !== prior.basis) {
    return "post-attempt basis contradicts the prior routing attempt";
  }
  if (!prior.model || !prior.effort || !prior.shapeEvidence || !prior.executionShape) {
    return "post-attempt prior routing context is incomplete";
  }
  const priorStringProblem = routingChoiceProblem(prior.model, "model", MAX_MODEL_ID_LENGTH) ??
    routingChoiceProblem(prior.effort, "effort", MAX_EFFORT_LENGTH) ??
    boundedOptionalString(prior.basis, "post-attempt prior basis", MAX_ROUTING_METADATA_LENGTH) ??
    boundedOptionalString(prior.escalationOrigin, "post-attempt prior escalationOrigin", MAX_ROUTING_METADATA_LENGTH) ??
    boundedOptionalString(prior.actualModel, "post-attempt prior actualModel", MAX_MODEL_ID_LENGTH);
  if (priorStringProblem) return priorStringProblem;
  if (prior.basis === undefined || prior.basis !== null && typeof prior.basis !== "string") {
    return "post-attempt prior basis must be a string or null";
  }
  const priorShape = selectShape({ ...inputs, shapeEvidence: prior.shapeEvidence, postAttempt: undefined });
  if (priorShape.stop || priorShape.executionShape !== prior.executionShape) {
    return priorShape.stop
      ? `post-attempt prior shape evidence is invalid: ${priorShape.stop}`
      : "post-attempt prior execution shape contradicts its shape evidence";
  }
  if (!Array.isArray(prior.unitIds)) return "post-attempt prior unitIds are required";
  if (prior.unitIds.length === 0) return "post-attempt retry requires one retained unitId for atomic or isolated work";
  const priorUnitProblem = prior.executionShape === "bounded-parallel" || prior.unitIds.length
    ? unitIdsProblem(prior.unitIds, prior.shapeEvidence.unitCount)
    : null;
  if (priorUnitProblem) return `post-attempt prior ${priorUnitProblem}`;
  const inputUnitProblem = prior.unitIds.length || inputs.unitIds !== undefined
    ? unitIdsProblem(inputs.unitIds, prior.shapeEvidence.unitCount)
    : null;
  if (inputUnitProblem) return `post-attempt ${inputUnitProblem}`;
  if (!sameUnitIds(inputs.unitIds ?? [], prior.unitIds)) {
    return "post-attempt unitIds must match the retained prior decision";
  }
  // Compare under the one count-derived rule, so a caller that restates a
  // contradictory atomicity pair is not told its evidence "changed" when the
  // resolver already normalized both sides to the same thing. Every other field
  // still has to match exactly — retry narrowing stays resolver-derived.
  if (!sameShapeEvidence(withDerivedCountEvidence(inputs.shapeEvidence), withDerivedCountEvidence(prior.shapeEvidence))) {
    return "post-attempt shape evidence must match the retained prior decision; retry narrowing is resolver-derived";
  }
  if (prior.attempt === 1 && prior.escalationOrigin) {
    return "post-attempt initial attempt must not carry escalationOrigin";
  }
  if (prior.attempt > 1 && !prior.escalationOrigin) {
    return "post-attempt retry provenance requires a non-null escalationOrigin";
  }
  if (!validSignals(evaluation.signals)) return "post-attempt signals contain an unsupported insufficiency signal";
  const units = evaluation.units;
  if (prior.executionShape === "bounded-parallel" && units === undefined) {
    return "post-attempt bounded-parallel evaluation requires complete unit results";
  }
  if (units !== undefined) {
    if (!Array.isArray(units) || units.length === 0) return "post-attempt units must be a non-empty array when supplied";
    if (units.length > MAX_PARALLELISM) return `post-attempt units must contain at most ${MAX_PARALLELISM} entries`;
    const ids = new Set<string>();
    for (const unit of units) {
      if (!unit || typeof unit.unitId !== "string" || !unit.unitId.trim()) return "post-attempt unitId must be non-empty";
      if (unit.unitId.length > MAX_UNIT_ID_LENGTH) return `post-attempt unitId must be at most ${MAX_UNIT_ID_LENGTH} characters`;
      if (!UNIT_ID_TOKEN.test(unit.unitId)) return "post-attempt unitId must use canonical printable identifier characters";
      if (ids.has(unit.unitId)) return `post-attempt unitId \`${unit.unitId}\` is duplicated`;
      ids.add(unit.unitId);
      if (typeof unit.sufficient !== "boolean" || !validSignals(unit.signals)) return `post-attempt unit \`${unit.unitId}\` is incomplete`;
      if (unit.sufficient && unit.signals.length) return `post-attempt unit \`${unit.unitId}\` is sufficient but carries insufficiency signals`;
      if (!unit.sufficient && unit.signals.length === 0) return `post-attempt unit \`${unit.unitId}\` is insufficient but carries no signal`;
    }
    if (prior.executionShape !== "bounded-parallel") return "post-attempt unit evaluations require a bounded-parallel prior attempt";
    if (units.length !== prior.shapeEvidence.unitCount) return "post-attempt unit evaluations must cover every prior bounded-parallel unit";
    if (!sameUnitIds(units.map((unit) => unit.unitId), prior.unitIds)) {
      return "post-attempt unit evaluations must match the retained prior unitIds";
    }
  }
  const insufficientUnits = units?.filter((unit) => !unit.sufficient) ?? [];
  if (evaluation.sufficient && (evaluation.signals.length || insufficientUnits.length)) {
    return "post-attempt evaluation is sufficient but carries insufficiency evidence";
  }
  if (!evaluation.sufficient && evaluation.signals.length === 0 && insufficientUnits.length === 0) {
    return "post-attempt evaluation is insufficient but carries no insufficiency signal";
  }
  if (evaluation.sufficient && units?.some((unit) => !unit.sufficient)) {
    return "post-attempt evaluation contradicts an insufficient unit result";
  }
  if (!evaluation.sufficient && units && insufficientUnits.length === 0) {
    return "post-attempt evaluation is insufficient but every unit is sufficient";
  }
  return null;
}

function stopDecision(
  decision: RoutingDecision,
  disposition: "exhausted" | "invalid-stop",
  diagnostic: string,
  retainedUnitIds: string[] = [],
): RoutingDecision {
  return { ...decision, status: "stop", disposition, retry: null, retainedUnitIds, diagnostic };
}

function priorTerminalDecision(
  current: RoutingDecision,
  prior: RoutingPostAttemptEvaluation["prior"],
  shape: ShapeDecision,
  status: "retain" | "stop",
  disposition: "retain" | "exhausted" | "invalid-stop",
  diagnostic: string | null,
  retainedUnitIds: string[],
): RoutingDecision {
  const { actualModel: _currentActualModel, ...withoutCurrentActualModel } = current;
  return {
    ...withoutCurrentActualModel,
    role: prior.role,
    executionShape: prior.executionShape,
    normalizedEvidence: shape.normalizedEvidence,
    unitIds: prior.unitIds,
    shapeReason: shape.shapeReason,
    effectiveParallelism: shape.effectiveParallelism,
    model: prior.model,
    effort: prior.effort,
    source: prior.model.source,
    basis: prior.basis,
    attempt: prior.attempt,
    escalationOrigin: prior.escalationOrigin,
    fallback: prior.model.fallback ?? prior.effort.fallback,
    masked: prior.model.masked || prior.effort.masked,
    ...(prior.actualModel ? { actualModel: prior.actualModel } : {}),
    status,
    disposition,
    retry: null,
    retainedUnitIds,
    diagnostic,
  };
}

function baseDecision(project: RoutingProjectConfig, inputs: RoutingInputs): RoutingDecision {
  const shape = selectShape(inputs);
  const scalarStop = routingScalarProblem(inputs);
  const boundedInputs = scalarStop ? {
    ...inputs,
    invocationModel: null,
    invocationEffort: null,
    hostModel: null,
    hostEffort: null,
    basis: null,
    escalationOrigin: null,
    actualModel: null,
  } : inputs;
  const availableStop = availableModelsProblem(inputs.availableModels);
  const selectorInputs = availableStop ? { ...boundedInputs, availableModels: null } : boundedInputs;
  const model = choose("model", selectorInputs, project);
  const effort = choose("effort", selectorInputs, project);
  const unitStop = inputs.unitIds !== undefined || shape.normalizedEvidence.unitCount > 1
    ? unitIdsProblem(inputs.unitIds, shape.normalizedEvidence.unitCount)
    : null;
  const stops = [shape.stop, unitStop, scalarStop, availableStop, model.stop, effort.stop].filter((v): v is string => v !== null);
  return {
    role: inputs.role,
    executionShape: shape.executionShape,
    normalizedEvidence: shape.normalizedEvidence,
    unitIds: inputs.unitIds ?? [],
    shapeReason: shape.shapeReason,
    effectiveParallelism: shape.effectiveParallelism,
    model: model.choice,
    effort: effort.choice,
    source: model.choice.source,
    basis: selectorInputs.basis ?? null,
    attempt: Number.isInteger(selectorInputs.attempt) && (selectorInputs.attempt ?? 0) >= 1 && (selectorInputs.attempt ?? 0) <= 3 ? selectorInputs.attempt! : 1,
    escalationOrigin: selectorInputs.escalationOrigin ?? null,
    fallback: model.choice.fallback ?? effort.choice.fallback,
    masked: model.choice.masked || effort.choice.masked,
    ...(selectorInputs.actualModel ? { actualModel: selectorInputs.actualModel } : {}),
    status: stops.length ? "stop" : "dispatch",
    disposition: stops.length ? "invalid-stop" : "dispatch",
    retry: null,
    retainedUnitIds: [],
    diagnostic: stops.length ? stops.join("; ") : null,
  };
}

export function projectRoutingMeasurement(decision: RoutingDecision): RoutingMeasurement {
  return {
    role: decision.role,
    executionShape: decision.executionShape,
    shapeReason: decision.shapeReason,
    unitIds: decision.unitIds,
    model: decision.model.value,
    effort: decision.effort.value,
    source: decision.source,
    basis: decision.basis,
    attempt: decision.attempt,
    escalationOrigin: decision.escalationOrigin,
    modelFallback: decision.model.fallback,
    effortFallback: decision.effort.fallback,
    masked: decision.masked,
    ...(decision.actualModel ? { actualModel: decision.actualModel } : {}),
  };
}

export function resolveRouting(project: RoutingProjectConfig, inputs: RoutingInputs): RoutingDecision {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(inputs.role)) throw new Error(`invalid routing role \`${inputs.role.slice(0, MAX_ROLE_LENGTH)}\``);
  if (!inputs.postAttempt) {
    const initial = baseDecision(project, inputs);
    if (inputs.attempt !== undefined && inputs.attempt !== 1) {
      return stopDecision(initial, "invalid-stop", "initial routing dispatch must use attempt 1");
    }
    if (inputs.escalationOrigin !== undefined && inputs.escalationOrigin !== null) {
      return stopDecision(initial, "invalid-stop", "initial routing dispatch must not carry escalationOrigin");
    }
    return initial;
  }

  const evaluation = inputs.postAttempt;
  const problem = evaluationProblem(evaluation, inputs);
  const current = baseDecision(project, inputs);
  if (problem) {
    if (problem === "post-attempt shape evidence must match the retained prior decision; retry narrowing is resolver-derived") {
      const priorShape = selectShape({ ...inputs, shapeEvidence: evaluation.prior.shapeEvidence, postAttempt: undefined });
      return priorTerminalDecision(current, evaluation.prior, priorShape, "stop", "invalid-stop", problem, []);
    }
    return stopDecision(current, "invalid-stop", problem);
  }
  const sufficientUnitIds = new Set(evaluation.units
    ? evaluation.units.filter((unit) => unit.sufficient).map((unit) => unit.unitId)
    : evaluation.sufficient ? evaluation.prior.unitIds : []);
  const retainedUnitIds = evaluation.prior.unitIds.filter((id) => sufficientUnitIds.has(id));
  const priorShape = selectShape({ ...inputs, shapeEvidence: evaluation.prior.shapeEvidence, postAttempt: undefined });
  if (evaluation.sufficient) {
    return priorTerminalDecision(current, evaluation.prior, priorShape, "retain", "retain", null, retainedUnitIds);
  }

  const signals = [...new Set([
    ...evaluation.signals,
    ...(evaluation.units ?? []).flatMap((unit) => unit.sufficient ? [] : unit.signals),
  ])];
  const maxAttempts = inputs.role === "security-auditor" &&
    signals.length === 1 && signals[0] === "high-severity-review-uncertainty" ? 3 : 2;
  if (evaluation.prior.attempt >= maxAttempts) {
    return priorTerminalDecision(
      current, evaluation.prior, priorShape, "stop", "exhausted",
      `retry limit exhausted after ${evaluation.prior.attempt} attempts`, retainedUnitIds,
    );
  }

  const priorSelector = evaluation.prior.actualModel ?? evaluation.prior.model.value;
  const priorTier = modelTier(priorSelector);
  if (!priorTier) {
    return priorTerminalDecision(
      current, evaluation.prior, priorShape, "stop", "invalid-stop",
      "prior model does not map unambiguously to a stable tier", retainedUnitIds,
    );
  }
  const nextTier = MODEL_TIERS[MODEL_TIERS.indexOf(priorTier) + 1];
  if (!nextTier) {
    return priorTerminalDecision(
      current, evaluation.prior, priorShape, "stop", "invalid-stop",
      "prior model is already at the highest stable tier", retainedUnitIds,
    );
  }

  const attempt = evaluation.prior.attempt + 1;
  const escalationOrigin = evaluation.prior.escalationOrigin ?? `routing:${inputs.role}:attempt-${evaluation.prior.attempt}`;
  const insufficientUnitIds = new Set(evaluation.units
    ? evaluation.units.filter((unit) => !unit.sufficient).map((unit) => unit.unitId)
    : evaluation.prior.unitIds);
  const retryUnitIds = evaluation.prior.unitIds.filter((id) => insufficientUnitIds.has(id));
  const retryUnitCount = retryUnitIds.length;
  const retryShapeEvidence = evaluation.units
    ? {
        ...evaluation.prior.shapeEvidence,
        // The same one count-derived rule the input path applies — one function,
        // so the narrowed retry evidence and an equivalent caller-supplied shape
        // can never disagree about what a given unit count means.
        ...derivedCountEvidence(retryUnitCount, evaluation.prior.shapeEvidence.unitsIndependent),
        unitCount: retryUnitCount,
        requestedParallelism: Math.min(evaluation.prior.shapeEvidence.requestedParallelism, retryUnitCount),
      }
    : evaluation.prior.shapeEvidence;
  const retryInputs: RoutingInputs = {
    ...inputs,
    shapeEvidence: retryShapeEvidence,
    unitIds: retryUnitIds.length ? retryUnitIds : undefined,
    postAttempt: undefined,
    invocationModel: nextTier,
    invocationEffort: undefined,
    requireModel: true,
    requireEffort: false,
    supportsEffortSelector: true,
    hostEffort: undefined,
    attempt,
    escalationOrigin,
    basis: evaluation.prior.basis,
    actualModel: undefined,
  };
  let retryDecision = baseDecision(project, retryInputs);
  const priorRequestedEffort = evaluation.prior.effort.source === "host"
    ? evaluation.prior.effort.requested
    : evaluation.prior.effort.value;
  const priorRequestedEffortSource = evaluation.prior.effort.source === "host"
    ? evaluation.prior.effort.requestedSource
    : evaluation.prior.effort.source;
  const retryEffort: RoutingChoice = inputs.hostEffort
    ? {
        value: inputs.hostEffort,
        source: "host",
        requested: priorRequestedEffort,
        requestedSource: priorRequestedEffortSource,
        masked: evaluation.prior.effort.masked ||
          priorRequestedEffort !== null && priorRequestedEffort !== inputs.hostEffort,
        fallback: null,
      }
    : evaluation.prior.effort;
  retryDecision = {
    ...retryDecision,
    effort: retryEffort,
    fallback: retryDecision.model.fallback ?? retryEffort.fallback,
    masked: retryDecision.model.masked || retryEffort.masked,
  };
  if (
    retryDecision.status === "stop" ||
    retryDecision.model.masked ||
    retryDecision.model.fallback ||
    modelTier(retryDecision.model.value) !== nextTier
  ) {
    const reason = retryDecision.diagnostic ?? (retryDecision.model.masked
      ? "next model tier was masked by host enforcement"
      : retryDecision.model.fallback
        ? `next model tier fell back: ${retryDecision.model.fallback}`
        : "next model tier did not advance exactly one stable tier");
    return priorTerminalDecision(
      retryDecision, evaluation.prior, priorShape, "stop", "invalid-stop", reason, retainedUnitIds,
    );
  }

  const priorExecutionShape = evaluation.prior.executionShape;
  const shapeChanged = priorExecutionShape !== retryDecision.executionShape ||
    !sameShapeEvidence(withDerivedCountEvidence(evaluation.prior.shapeEvidence), retryDecision.normalizedEvidence);
  return {
    ...retryDecision,
    disposition: "retry",
    retry: {
      attempt,
      signals,
      unitIds: retryUnitIds,
      priorTier,
      nextTier,
      escalationOrigin,
      priorExecutionShape,
      shapeChanged,
    },
    retainedUnitIds,
  };
}
