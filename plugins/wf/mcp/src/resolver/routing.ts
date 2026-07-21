import type {
  NormalizedRoutingShapeEvidence,
  RoutingChoice,
  RoutingDecision,
  RoutingInputs,
  RoutingInsufficiencySignal,
  RoutingPostAttemptEvaluation,
  RoutingProjectConfig,
  RoutingShapeReason,
  RoutingSource,
} from "./types.js";

const DEFAULTS: RoutingProjectConfig = {
  classify: { model: "haiku", effort: null },
  branch: { model: "haiku", effort: null },
};

const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EFFORTS = new Set(["low", "medium", "high", "max"]);
const MAX_PARALLELISM = 4;
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
        : !Number.isInteger(evidence.unitCount) || (evidence.unitCount ?? 0) < 1
          ? "shape evidence unitCount must be a positive integer"
          : !Number.isInteger(evidence.requestedParallelism) || (evidence.requestedParallelism ?? 0) < 1
            ? "shape evidence requestedParallelism must be a positive integer"
            : evidence.atomicity === "atomic" && evidence.unitCount !== 1
              ? "shape evidence is contradictory: atomic work must contain exactly one unit"
              : evidence.atomicity === "composite" && (evidence.unitCount ?? 0) < 2
                ? "shape evidence is contradictory: composite work must contain at least two units"
                : evidence.unitsIndependent && (evidence.unitCount ?? 0) < 2
                  ? "shape evidence is contradictory: independence requires at least two units"
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

  if (host) {
    return {
      choice: { value: host, source: "host", requested, requestedSource, masked: requested !== null && requested !== host, fallback: null },
      stop: null,
    };
  }
  if (!requested) {
    return { choice: { value: null, source: "inheritance", requested: null, requestedSource: "inheritance", masked: false, fallback: null }, stop: required ? `${kind} override is required but none was supplied` : null };
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

function evaluationProblem(evaluation: RoutingPostAttemptEvaluation, inputs: RoutingInputs): string | null {
  const { prior } = evaluation;
  if (!prior || !Number.isInteger(prior.attempt) || prior.attempt < 1 || prior.attempt > 3) {
    return "post-attempt prior attempt must be an integer from 1 to 3";
  }
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
  if (prior.basis === undefined || prior.basis !== null && typeof prior.basis !== "string") {
    return "post-attempt prior basis must be a string or null";
  }
  const priorShape = selectShape({ ...inputs, shapeEvidence: prior.shapeEvidence, postAttempt: undefined });
  if (priorShape.stop || priorShape.executionShape !== prior.executionShape) {
    return priorShape.stop
      ? `post-attempt prior shape evidence is invalid: ${priorShape.stop}`
      : "post-attempt prior execution shape contradicts its shape evidence";
  }
  if (prior.attempt === 1 && prior.escalationOrigin) {
    return "post-attempt initial attempt must not carry escalationOrigin";
  }
  if (prior.attempt > 1 && !prior.escalationOrigin) {
    return "post-attempt retry provenance requires a non-null escalationOrigin";
  }
  if (!validSignals(evaluation.signals)) return "post-attempt signals contain an unsupported insufficiency signal";
  const units = evaluation.units;
  if (units !== undefined) {
    if (!Array.isArray(units) || units.length === 0) return "post-attempt units must be a non-empty array when supplied";
    const ids = new Set<string>();
    for (const unit of units) {
      if (!unit || typeof unit.unitId !== "string" || !unit.unitId.trim()) return "post-attempt unitId must be non-empty";
      if (ids.has(unit.unitId)) return `post-attempt unitId \`${unit.unitId}\` is duplicated`;
      ids.add(unit.unitId);
      if (typeof unit.sufficient !== "boolean" || !validSignals(unit.signals)) return `post-attempt unit \`${unit.unitId}\` is incomplete`;
      if (unit.sufficient && unit.signals.length) return `post-attempt unit \`${unit.unitId}\` is sufficient but carries insufficiency signals`;
      if (!unit.sufficient && unit.signals.length === 0) return `post-attempt unit \`${unit.unitId}\` is insufficient but carries no signal`;
    }
    if (prior.executionShape !== "bounded-parallel") return "post-attempt unit evaluations require a bounded-parallel prior attempt";
    if (units.length !== prior.shapeEvidence.unitCount) return "post-attempt unit evaluations must cover every prior bounded-parallel unit";
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
  const model = choose("model", inputs, project);
  const effort = choose("effort", inputs, project);
  const stops = [shape.stop, model.stop, effort.stop].filter((v): v is string => v !== null);
  return {
    role: inputs.role,
    executionShape: shape.executionShape,
    normalizedEvidence: shape.normalizedEvidence,
    shapeReason: shape.shapeReason,
    effectiveParallelism: shape.effectiveParallelism,
    model: model.choice,
    effort: effort.choice,
    source: model.choice.source,
    basis: inputs.basis ?? null,
    attempt: Number.isInteger(inputs.attempt) && (inputs.attempt ?? 0) >= 1 && (inputs.attempt ?? 0) <= 3 ? inputs.attempt! : 1,
    escalationOrigin: inputs.escalationOrigin ?? null,
    fallback: model.choice.fallback ?? effort.choice.fallback,
    masked: model.choice.masked || effort.choice.masked,
    ...(inputs.actualModel ? { actualModel: inputs.actualModel } : {}),
    status: stops.length ? "stop" : "dispatch",
    disposition: stops.length ? "invalid-stop" : "dispatch",
    retry: null,
    retainedUnitIds: [],
    diagnostic: stops.length ? stops.join("; ") : null,
  };
}

export function resolveRouting(project: RoutingProjectConfig, inputs: RoutingInputs): RoutingDecision {
  if (!/^[a-z][a-z0-9-]*$/.test(inputs.role)) throw new Error(`invalid routing role \`${inputs.role}\``);
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
  if (problem) return stopDecision(current, "invalid-stop", problem);
  const retainedUnitIds = evaluation.units?.filter((unit) => unit.sufficient).map((unit) => unit.unitId) ?? [];
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
  const retryUnitIds = evaluation.units?.filter((unit) => !unit.sufficient).map((unit) => unit.unitId) ?? [];
  const retryUnitCount = retryUnitIds.length;
  const retryShapeEvidence = evaluation.units
    ? {
        ...inputs.shapeEvidence,
        atomicity: retryUnitCount === 1 ? "atomic" as const : "composite" as const,
        unitCount: retryUnitCount,
        unitsIndependent: retryUnitCount > 1 && inputs.shapeEvidence.unitsIndependent,
        requestedParallelism: Math.min(inputs.shapeEvidence.requestedParallelism, retryUnitCount),
      }
    : inputs.shapeEvidence;
  const retryInputs: RoutingInputs = {
    ...inputs,
    shapeEvidence: retryShapeEvidence,
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
    !sameShapeEvidence(evaluation.prior.shapeEvidence, retryDecision.normalizedEvidence);
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
