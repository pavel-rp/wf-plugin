import type {
  NormalizedRoutingShapeEvidence,
  RoutingChoice,
  RoutingDecision,
  RoutingInputs,
  RoutingInsufficiencySignal,
  RoutingMeasurement,
  RoutingPostAttemptEvaluation,
  RoutingProjectConfig,
  RoutingRetryInstruction,
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
// WF-498: the roles whose model the resolver DERIVES from the call site's own
// complexity evidence when no higher-precedence choice wins. Deliberately a
// CLOSED, EXPLICIT set rather than "every role that has no static default":
// every role named here has a matching published disposition row that says so,
// and a role holding no such row must never silently start receiving a derived
// value. `branch` and `classify` are absent because their `DEFAULTS` entry
// already wins above this tier — which is precisely how this change leaves the
// two shipped-static rows byte-identical in behaviour. `pr` and `commit` are
// absent because their published matrix rows still read `inherit`; and `index` is
// absent because its published inlined-role entry claims no static default. The
// matrix and the runtime may never disagree, so a role earns a derived value only
// once something published says it does.
//
// WF-499 added `shipper` under exactly that rule: it now holds a published
// inlined-role entry recording `complexity-derived` as its mechanism, so the
// runtime and the matrix still agree. Like `finalize` it backs no agent file, so
// its entry lives in the matrix's inlined-roles section rather than the
// eighteen-row agent table. `pr` deliberately did NOT come with it: `CAL-pr`
// records `current: inherit`, and the calibration gate permits only
// `adopt`/`retain`/`defer` — so deriving there would falsify a durable record
// through an operation that gate does not allow. `shipper` hits no such wall
// because it holds no `CAL-` record at all.
const DERIVATION_ELIGIBLE_ROLES = new Set(["phase-runner", "finalize", "shipper"]);
// WF-499: the range the ladder below can actually mint. A CARRIED selection must
// fall inside it — that is what stops a caller smuggling a tier this resolver
// never derives (notably `opus`) in wearing resolver provenance, since a carried
// value is by definition one the resolver is said to have issued already. It is
// stated here rather than shared with `deriveModelFromEvidence` so that this
// change leaves the ladder byte-identical; `routing-carried-selection.test.ts`
// asserts the two agree over the ladder's whole score range, so widening the
// ceiling without widening this set fails the suite instead of silently
// admitting a tier the resolver cannot produce.
const DERIVABLE_MODELS = new Set<string>(["haiku", "sonnet"]);
// Evidence weights. ONLY the five dimensions describing how much REASONING a
// unit needs are scored: `ambiguity`, `toolWork`, `risk`, `validation`,
// `returnContract`. The other seven — `workSurface`, `contextIsolation`,
// `independentReview`, `atomicity`, `unitCount`, `unitsIndependent`,
// `requestedParallelism` — describe how to RUN the unit rather than how hard it
// is, and belong to `selectShape`.
const AMBIGUITY_WEIGHT = { none: 0, bounded: 1, material: 2 } as const;
const TOOL_WORK_WEIGHT = { none: 0, bounded: 1, material: 2 } as const;
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
export function derivedCountEvidence(
  unitCount: number,
  unitsIndependent: boolean,
): Pick<RoutingShapeEvidence, "atomicity" | "unitsIndependent"> {
  return {
    atomicity: unitCount === 1 ? "atomic" : "composite",
    unitsIndependent: unitCount > 1 && unitsIndependent,
  };
}

// Apply the rule to a whole evidence object, returning a copy rather than mutating
// the caller's. A `unitCount` that is not a positive integer is left alone: that
// input is rejected by its own range check, and deriving from a nonsense count
// would only swap one diagnostic for another.
function withDerivedCountEvidence<T extends RoutingShapeEvidence>(evidence: T): T {
  return Number.isInteger(evidence.unitCount) && evidence.unitCount >= 1
    ? { ...evidence, ...derivedCountEvidence(evidence.unitCount, evidence.unitsIndependent) }
    : evidence;
}

function selectShape(inputs: RoutingInputs): ShapeDecision {
  const evidence = inputs.shapeEvidence as Partial<RoutingInputs["shapeEvidence"]> | undefined;
  // `atomicity` and `unitsIndependent` are DERIVED from the authoritative
  // `unitCount`, never a second source of truth a caller can contradict. A pair
  // the caller states inconsistently is normalized here — not rejected — and the
  // derived values are what `normalizedEvidence` reports back, so the caller can
  // read exactly what the resolver made of its evidence.
  //
  // The derivation is applied HERE, before the stop-return below, so the reported
  // evidence obeys the published rule on EVERY path — a rejected call reports the
  // same derived shape a dispatched one does, rather than echoing raw values back
  // on some rejection paths and derived values on others. `withDerivedCountEvidence`
  // leaves a non-positive-integer `unitCount` alone, so a nonsense count is still
  // reported as the caller sent it and rejected by its own range check below.
  //
  // The rule cannot change a selected shape: `atomicity` feeds no predicate below,
  // and `parallelWorthy` already requires two or more units.
  const normalizedEvidence: NormalizedRoutingShapeEvidence = withDerivedCountEvidence({
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
  });
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

// THE COMPLEXITY LADDER. Scores the NORMALIZED evidence — never the caller's raw
// input — so a caller cannot launder a selection in through a contradictory
// field: by the time this runs `selectShape` has already derived
// `atomicity`/`unitsIndependent` from the authoritative `unitCount`.
//
// This is a MECHANISM, not a shipped constant. It introduces no per-role
// default: the same evidence yields the same tier for every eligible role, and
// a role's selection changes only when the evidence at its call site changes.
// That is what keeps it outside the calibration gate, which governs static
// per-role defaults.
function deriveModelFromEvidence(evidence: NormalizedRoutingShapeEvidence): { model: ModelTier; basis: string } {
  const score = AMBIGUITY_WEIGHT[evidence.ambiguity] +
    TOOL_WORK_WEIGHT[evidence.toolWork] +
    (evidence.risk === "elevated" ? 1 : 0) +
    (evidence.validation === "judgment" ? 1 : 0) +
    (evidence.returnContract === "judgment" ? 1 : 0);
  // THE CEILING IS DELIBERATE. The ladder tops out at `sonnet`; nothing derives
  // `opus`. The reason is blast radius, not cost squeamishness: `phase-runner`
  // is reached by `/wf:run`'s `run:phase` edge, which is the INTERACTIVE
  // single-task path as well as the unattended one, and whose evidence literal
  // lives in a file this change may not touch. No core call site anywhere
  // supplies `availableModels`, so the resolver's unavailability degradation is
  // unreachable by construction — a derived top tier on a host without it would
  // hard-fail a path that previously always worked, with no fallback and no
  // diagnostic. A mechanism that opens a new failure mode on an untouched
  // surface has not earned its ceiling yet.
  //
  // This bounds the MECHANISM's range on its first release; it is not a shipped
  // per-role static default and introduces none. Raising the ceiling is a
  // separate, evidence-backed decision.
  const model: ModelTier = score === 0 ? "haiku" : "sonnet";
  return {
    model,
    basis: `complexity-derived score ${score}: ambiguity=${evidence.ambiguity}, toolWork=${evidence.toolWork}, ` +
      `risk=${evidence.risk}, validation=${evidence.validation}, returnContract=${evidence.returnContract}`,
  };
}

function choose(
  kind: "model" | "effort",
  inputs: RoutingInputs,
  project: RoutingProjectConfig,
  normalizedEvidence: NormalizedRoutingShapeEvidence,
  evidenceValid: boolean,
): { choice: RoutingChoice; stop: string | null; derivedBasis?: string; carriedApplied?: boolean } {
  const selectorSupported = kind === "model" ? inputs.supportsModelSelector : inputs.supportsEffortSelector;
  const host = kind === "model" ? inputs.hostModel : inputs.hostEffort;
  const invocation = kind === "model" ? inputs.invocationModel : inputs.invocationEffort;
  const configured = project[inputs.role]?.[kind] ?? null;
  const shipped = DEFAULTS[inputs.role]?.[kind] ?? null;
  const required = kind === "model" ? inputs.requireModel : inputs.requireEffort;
  // WF-498: the derived tier sits BELOW every stated choice and ABOVE bare
  // inheritance. It is computed only when nothing higher-precedence was stated,
  // so `classify`/`branch` keep resolving their `DEFAULTS` entry unchanged, and
  // it is never derived for effort — every published row's effort still inherits.
  //
  // The retry path re-enters here and re-derives, exactly as it re-reads
  // `DEFAULTS` and the project table. That is deliberate and it is SAFE, not a
  // second decision: retry narrowing only ever changes `unitCount` and
  // `requestedParallelism`, and the ladder scores neither, so re-derivation over
  // retained evidence provably reproduces the prior attempt's own tier. Special-
  // casing derivation here would instead make it the ONE source that silently
  // evaporates on retry, dropping an eligible role back to bare inheritance for
  // the very attempt that matters most. When the escalation lever does apply it
  // passes `invocationModel`, which outranks this and leaves the tier advance
  // exactly as WF-497 specified.
  // `evidenceValid` is load-bearing, not defensive noise. `selectShape` fills
  // `normalizedEvidence` with `?? "none"` defaults BEFORE it validates the
  // enums, so a caller sending `ambiguity: "bogus"` reaches here with that value
  // intact; scoring it would index the weight tables to `undefined`, make the
  // whole score NaN, fail both tier comparisons, and silently land on `opus` —
  // the most expensive tier, chosen by a malformed input. A call whose evidence
  // was rejected derives nothing at all.
  // `selectorSupported` is part of the guard, not just a later rejection. An edge
  // that declares it cannot honor a selector is left EXACTLY as it was before
  // this change: deriving there would push its record from `fallback: null` to
  // `fallback: "selector-unsupported"`, which silently rewrites the compact
  // operational record of every frozen `model=false` edge — including
  // `agents/phase-runner.md`, a surface this change is not allowed to touch.
  // Derivation is strictly additive to edges that can actually use it.
  // WF-499: a selection this resolver already issued for this unit at an earlier,
  // item-level decision. There is deliberately NO effort counterpart — the
  // contract offers one carried channel and it is the model one, so "carried
  // effort" is unrepresentable rather than merely rejected.
  const carriedInput = kind === "model" ? (inputs.carriedModel || null) : null;
  // Validity is checked INDEPENDENTLY of precedence. A carry that loses to an
  // operator pin is not an error — it is simply outranked, and reports
  // `carried: false`. But a carry this resolver could never have MINTED is a
  // forged provenance claim, and it is refused whether or not it would have won:
  // letting it pass silently whenever something outranked it would make the
  // integrity of the channel depend on the caller's other arguments.
  const carriedProblem = carriedInput === null
    ? null
    : !DERIVATION_ELIGIBLE_ROLES.has(inputs.role)
      ? `carriedModel claims a resolver-derived selection for role \`${inputs.role}\`, which the resolver never derives`
      : !evidenceValid
        ? "carriedModel requires valid shape evidence; a call whose evidence was rejected carries nothing"
        : !selectorSupported
          ? "carriedModel requires a runtime that can honor a model selector"
          : !DERIVABLE_MODELS.has(carriedInput)
            ? `carriedModel \`${carriedInput}\` is outside the range this resolver derives`
            : null;
  if (carriedProblem) {
    return {
      choice: { value: null, source: "inheritance", requested: null, requestedSource: "inheritance", masked: false, fallback: "malformed" },
      stop: carriedProblem,
    };
  }
  // The carried tier sits directly ABOVE a fresh derivation and supersedes it:
  // the earlier item-level decision scored that unit's OWN difficulty evidence,
  // while this call's evidence describes topology, so re-deriving here would
  // replace a better-informed answer with a worse one — which is the whole reason
  // the consumer carried it rather than re-asking.
  const carried = carriedInput !== null && !invocation && !configured && !shipped
    ? carriedInput
    : null;
  const derived = kind === "model" && evidenceValid && selectorSupported &&
    !invocation && !configured && !shipped && !carried &&
    DERIVATION_ELIGIBLE_ROLES.has(inputs.role)
    ? deriveModelFromEvidence(normalizedEvidence)
    : null;
  // `|| null` rather than `??`: an empty-string selector is schema-valid but
  // meaningless, and mixing `??` here with the truthiness guards above would let
  // `invocationModel: ""` silently discard a derived selection with no
  // diagnostic and no fallback token.
  const requested = (invocation || null) ?? (configured || null) ?? (shipped || null) ?? carried ?? derived?.model ?? null;
  const requestedSource: RoutingSource = invocation
    ? "invocation"
    : configured
      ? "project"
      : shipped
        ? "shipped-default"
        : carried || derived
          ? "complexity-derived"
          : "inheritance";
  // Reported only when the derived value is the one that actually survives to
  // the decision; every early return below drops it, so a rejected or masked
  // call never claims a basis it did not act on. A carried selection states its
  // own basis when the caller stated none, so a ledger never shows
  // `complexity-derived` with nothing to justify it — but a caller-stated basis
  // still wins in `baseDecision`, which is what lets a consumer forward the
  // ORIGINATING item-level basis rather than this restatement of it.
  const derivedBasis = derived
    ? derived.basis
    : carried
      ? `complexity-derived selection \`${carried}\` carried from this unit's earlier item-level decision`
      : null;

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
  return {
    choice: { value: requested, source: requestedSource, requested, requestedSource, masked: false, fallback: null },
    stop: null,
    // Only this path actually delivers the derived value, so only this path
    // reports the basis it was derived from.
    ...(derivedBasis ? { derivedBasis } : {}),
    // WF-499: likewise the ONLY path on which a carried selection reaches the
    // agent. Every return above either rejects the call or hands back a
    // higher-precedence value, so none of them may claim the decision carried
    // anything — including the `host` path, where the carry was outranked and
    // survives only as `requested`.
    ...(carried && requested === carried ? { carriedApplied: true } : {}),
  };
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
    [inputs.carriedModel, "carriedModel", MAX_MODEL_ID_LENGTH],
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

function routingChoiceProblem(choice: RoutingChoice | undefined, field: string, maximum: number, role: string): string | null {
  if (!choice) return `post-attempt prior ${field} choice is required`;
  const bounded = boundedOptionalString(choice.value, `post-attempt prior ${field}.value`, maximum) ??
    boundedOptionalString(choice.requested, `post-attempt prior ${field}.requested`, maximum);
  if (bounded) return bounded;
  // WF-498: `complexity-derived` is a provenance only THIS resolver can mint. A
  // caller may faithfully restate one the resolver issued to it, but may never
  // invent one — the whole point of the source is that the value was computed
  // here from evidence rather than supplied. `priorTerminalDecision` copies
  // `prior.model.source` straight onto a returned decision and
  // `projectRoutingMeasurement` publishes it as the canonical operational
  // record, so an unchecked claim would put a provenance the resolver could not
  // have produced into a dispatched decision. That is the forged-provenance
  // class WF-497 removed on the neighbouring path; it is refused here rather
  // than reintroduced.
  const claimsDerived = choice.source === "complexity-derived" || choice.requestedSource === "complexity-derived";
  if (claimsDerived && field !== "model") {
    return `post-attempt prior ${field} cannot claim complexity-derived provenance; the resolver derives only a model`;
  }
  if (claimsDerived && !DERIVATION_ELIGIBLE_ROLES.has(role)) {
    return `post-attempt prior ${field} claims complexity-derived provenance for role \`${role}\`, which the resolver never derives`;
  }
  // A DELIVERED derived selection is only ever produced on `choose`'s success
  // path, which cannot be masked and carries no fallback. A prior asserting all
  // three at once describes a decision this resolver cannot emit.
  if (choice.source === "complexity-derived" && (choice.masked || choice.fallback)) {
    return `post-attempt prior ${field} claims a delivered complexity-derived selection but reports it masked or fallen back`;
  }
  return null;
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
  const priorStringProblem = routingChoiceProblem(prior.model, "model", MAX_MODEL_ID_LENGTH, inputs.role) ??
    routingChoiceProblem(prior.effort, "effort", MAX_EFFORT_LENGTH, inputs.role) ??
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
    carriedModel: null,
    hostModel: null,
    hostEffort: null,
    basis: null,
    escalationOrigin: null,
    actualModel: null,
  } : inputs;
  const availableStop = availableModelsProblem(inputs.availableModels);
  const selectorInputs = availableStop ? { ...boundedInputs, availableModels: null } : boundedInputs;
  const model = choose("model", selectorInputs, project, shape.normalizedEvidence, shape.stop === null);
  const effort = choose("effort", selectorInputs, project, shape.normalizedEvidence, shape.stop === null);
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
    // A caller-stated basis always wins; the derived one only fills the gap it
    // would otherwise leave, so a retry re-stating the prior's basis is stable.
    basis: selectorInputs.basis ?? model.derivedBasis ?? null,
    attempt: Number.isInteger(selectorInputs.attempt) && (selectorInputs.attempt ?? 0) >= 1 && (selectorInputs.attempt ?? 0) <= 3 ? selectorInputs.attempt! : 1,
    escalationOrigin: selectorInputs.escalationOrigin ?? null,
    fallback: model.choice.fallback ?? effort.choice.fallback,
    masked: model.choice.masked || effort.choice.masked,
    // Only `choose`'s delivering path sets this, so it states what actually
    // reached the agent rather than what the caller offered.
    carried: model.carriedApplied === true,
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
    escalation: decision.retry?.escalation ?? null,
    masked: decision.masked,
    carried: decision.carried,
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

  // THE MODEL TIER IS ONE ESCALATION LEVER, NOT THE GATE ITSELF. Whether the gate
  // opens is decided by genuine insufficiency plus an unexhausted attempt budget
  // (both settled above); what the retry CHANGES is decided here. Conflating the
  // two made the gate unreachable for every edge that passes
  // `supportsModelSelector: false` — which is every fixed sibling-Skill edge on the
  // shipper path — so reporting a real failure returned `invalid-stop` and the
  // caller learned nothing from reporting it.
  //
  // The lever applies only when this runtime can honor a model selector AND the
  // prior attempt maps to a known tier below the top. When it does not apply the
  // gate STILL OPENS: the narrowed units are re-dispatched under the prior
  // attempt's own selection, and `retry.escalation` names why no tier moved.
  //
  // NOT the same as a lever that was attempted and DEFEATED. Host masking and an
  // unavailable next tier are checked after the advance is requested (below) and
  // still stop — the resolver asked for a specific tier and did not get it, which
  // is an integrity failure, and WF-394 host precedence is deliberately preserved.
  // ONE prior model, read the same way by the classifier and by the carry-forward.
  // The SELECTION leads, because the selection is the only thing the retry can
  // actually change; `actualModel` is host evidence about what ran and is consulted
  // only when the resolver selected nothing, which is exactly the inheritance edge
  // where it is the sole tier signal. Reading `actualModel` first would let the two
  // disagree — classifying a tier from one model while re-dispatching another, so a
  // retry could claim `top-tier` while silently routing BELOW the prior selection.
  const priorSelector = evaluation.prior.model.value ?? evaluation.prior.actualModel;
  const priorTier = modelTier(priorSelector);
  const nextTier = priorTier !== null ? MODEL_TIERS[MODEL_TIERS.indexOf(priorTier) + 1] ?? null : null;
  // ONE classification, and the guard below is DERIVED from it — never a second
  // boolean holding the same rule, which is the drift shape WF-496 collapsed for
  // count-derived evidence. Most-causal first: an edge that cannot honor a selector
  // reports that, even though its prior tier is also unusable as a consequence.
  const escalation: RoutingRetryInstruction["escalation"] = !inputs.supportsModelSelector
    ? "selector-unsupported"
    : priorTier === null
      ? "prior-tier-unknown"
      : nextTier === null
        ? "top-tier"
        : "next-stable-tier";
  const tierAdvanceAvailable = escalation === "next-stable-tier";

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
    // Only an applicable lever requests a tier. When none applies the retry re-states
    // the prior attempt's own REQUEST and lets `choose()` resolve it through the very
    // same validated pipeline the initial path uses. It is deliberately NOT a verbatim
    // copy of caller-supplied `prior.model`: host enforcement still wins (WF-394) and
    // still records `masked`, a malformed or unavailable id is still rejected, and a
    // caller cannot launder forged provenance into a dispatched decision.
    ...(tierAdvanceAvailable
      ? { invocationModel: nextTier, requireModel: true }
      : {
          invocationModel: evaluation.prior.model.requestedSource === "invocation"
            ? evaluation.prior.model.requested
            : undefined,
          requireModel: false,
        }),
    invocationEffort: undefined,
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
  // The integrity guard validates an advance that was REQUESTED. On the
  // not-applicable path none was, so masking/fallback/non-advancement describe the
  // prior attempt's own honest state rather than a failed escalation, and gating on
  // them here would re-close the gate this change opens.
  if (
    retryDecision.status === "stop" ||
    (tierAdvanceAvailable && (
      retryDecision.model.masked ||
      retryDecision.model.fallback ||
      modelTier(retryDecision.model.value) !== nextTier
    ))
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
      escalation,
      // `priorTier` is a fact about the attempt that ALREADY RAN, so it is reported
      // whenever it resolves — including on `top-tier`, and on `selector-unsupported`
      // where the prior attempt's own model may still map even though this edge
      // cannot honor a selector. Only `nextTier` carries the caller invariant.
      priorTier,
      nextTier: tierAdvanceAvailable ? nextTier : null,
      escalationOrigin,
      priorExecutionShape,
      shapeChanged,
    },
    retainedUnitIds,
  };
}
