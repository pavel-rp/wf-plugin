import type {
  RoutingChoice,
  RoutingDecision,
  RoutingInputs,
  RoutingProjectConfig,
  RoutingSource,
} from "./types.js";

const DEFAULTS: RoutingProjectConfig = {
  classify: { model: "haiku", effort: null },
  branch: { model: "haiku", effort: null },
};

const MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EFFORTS = new Set(["low", "medium", "high", "max"]);

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
    return { choice: { value: null, source: "inheritance", requested, requestedSource, masked: false, fallback: "malformed" }, stop: `${kind} choice \`${requested}\` is malformed` };
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
  const model = choose("model", inputs, project);
  const effort = choose("effort", inputs, project);
  const stops = [model.stop, effort.stop].filter((v): v is string => v !== null);
  return {
    role: inputs.role,
    executionShape: inputs.executionShape,
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
