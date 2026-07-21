import type {
  NormalizedRoutingShapeEvidence,
  RoutingChoice,
  RoutingDecision,
  RoutingInputs,
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

export function resolveRouting(project: RoutingProjectConfig, inputs: RoutingInputs): RoutingDecision {
  if (!/^[a-z][a-z0-9-]*$/.test(inputs.role)) throw new Error(`invalid routing role \`${inputs.role}\``);
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
    attempt: inputs.attempt ?? 1,
    escalationOrigin: inputs.escalationOrigin ?? null,
    fallback: model.choice.fallback ?? effort.choice.fallback,
    masked: model.choice.masked || effort.choice.masked,
    ...(inputs.actualModel ? { actualModel: inputs.actualModel } : {}),
    status: stops.length ? "stop" : "dispatch",
    diagnostic: stops.length ? stops.join("; ") : null,
  };
}
