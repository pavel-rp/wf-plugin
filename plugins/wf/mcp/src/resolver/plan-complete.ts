// wf resolver — the complete-plan integration and approved-plan identity (WF-450).
//
// THE CAPSTONE OF THE PLANNER CHAIN. Deterministic, body-free, and
// side-effect-free: nothing here opens a file, canonicalizes a path, reads a
// ledger, or writes a byte. Every input is a fact the join already computed, so
// this module cannot widen what planning observes and cannot break the release's
// BYTE-INERT guarantee. It INTEGRATES the prior slices; it never re-derives one.
//
// FOUR RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. ONE SCHEMA, ONE IDENTITY. Install, reconcile, bootstrap, deregistration,
//      deletion, upgrade, retained-divergence, and repair are MODES of the one
//      frozen `planVersion: 1` envelope. There is deliberately no second schema,
//      no `planVersion: 2`, and no per-mode response family.
//
//   2. THE MODE IS DERIVED FROM THE PLAN'S OWN CONTENT, NEVER FROM A CALLER.
//      A caller cannot assert a mode the facts do not support, and the
//      precedence is destructive-effect-first so the most review-worthy effect
//      is the one that names the plan.
//
//   3. NO BLOCKING CONDITION IS EVER A SILENT OMISSION. The applicability basis
//      is built from the SAME findings and questions the applicability decision
//      consumed, so the two can never disagree, and a reader never re-derives
//      which input did the blocking.
//
//   4. IDENTITY IS A FUNCTION OF THE ENUMERATED MUTATION-RELEVANT FACTS AND
//      NOTHING ELSE. Every fact class is listed in `PLAN_IDENTITY_FACT_CLASSES`
//      and folded in through a key-sorted canonical serialization, so object key
//      order, collection order, and input order cannot move the hash. Finding
//      MESSAGES are deliberately excluded: rewording a diagnostic must never
//      invalidate an already-approved plan, while a finding's code, severity,
//      and attribution — which do decide applicability — are all included.
//
// A no-change plan therefore has a stable identity and zero mutating actions,
// and any mutation-relevant change produces a different `planId`.

import { sha256Hex } from "./fingerprint.js";
import { PROJECT_OVERRIDE_DIR } from "./slot.js";
import { CONSTITUTION_RELPATH } from "./constitution.js";
import type {
  DiscoveryInventory,
  PlanAction,
  PlanActionKind,
  PlanAdmissionState,
  PlanAnswerWrite,
  PlanApplicability,
  PlanApplicabilityBasis,
  PlanArtifactDecision,
  PlanArtifactPreview,
  PlanEvidenceSeed,
  PlanFinding,
  PlanIdentity,
  PlanIdentityFactClass,
  PlanMode,
  PlanPayloadPreview,
  PlanRegistryDelta,
  PlanRegistryEntry,
  PlanRepairAction,
  PlanUnresolvedQuestion,
} from "./types.js";

/** The canonical execution order of the integrated action list.
 *
 *  Mutating actions come first, in DEPENDENCY order — evidence is made truthful
 *  before anything reasons from it, the registry settles before payloads that
 *  may depend on newly registered capabilities, upgrades and bootstraps precede
 *  the single destructive kind, and the constitution recomposes last because it
 *  is a function of the FINAL capability set. Non-mutating retentions are
 *  reported after every action, because they are review material rather than
 *  work. */
export const PLAN_ACTION_ORDER: readonly PlanActionKind[] = [
  "evidence-repair",
  "evidence-seed",
  "registry-add",
  "registry-deregister",
  "payload-write",
  "override-write",
  "artifact-advance",
  "artifact-bootstrap",
  "artifact-delete",
  "answer-write",
  "constitution-recompose",
  "registry-retain",
  "artifact-retain",
];

/** The complete closed set of fact classes the approved-plan identity covers.
 *  Exported so a consumer — and the contract tests — can assert the coverage
 *  claim mechanically rather than trusting a comment. */
export const PLAN_IDENTITY_FACT_CLASSES: readonly PlanIdentityFactClass[] = [
  "envelope-version",
  "workspace-root",
  "mode",
  "applicability",
  "inventory-trust",
  "registry-delta",
  "answer-write",
  "answer-unresolved",
  "evidence-seed",
  "evidence-repair",
  "payload-action",
  "payload-rejection",
  "payload-conflict",
  "artifact-decision",
  "action",
  "finding",
];

/** Everything the completion pass needs. Every member is a fact the join has
 *  already computed and sorted — this module adds no observation of its own. */
export interface PlanCompletionInput {
  planVersion: number;
  admission: PlanAdmissionState;
  workspaceRoot: string | null;
  applicability: PlanApplicability;
  registryDelta: PlanRegistryDelta;
  answers: { writes: readonly PlanAnswerWrite[]; unresolved: readonly PlanUnresolvedQuestion[] };
  evidenceSeeds: readonly PlanEvidenceSeed[];
  repairs: readonly PlanRepairAction[];
  payloads: PlanPayloadPreview;
  artifacts: PlanArtifactPreview;
  findings: readonly PlanFinding[];
  inventory: DiscoveryInventory;
}

export interface PlanCompletion {
  mode: PlanMode | null;
  actions: PlanAction[];
  applicabilityBasis: PlanApplicabilityBasis;
  identity: PlanIdentity;
}

const OVERRIDE_PREFIX = `${PROJECT_OVERRIDE_DIR}/`;

/** True when a declared destination lands in the committed project-override
 *  tier. Derived from the tier's own exported constant, never a literal spelled
 *  out here, so the two can never drift apart. */
export function isProjectOverrideDestination(destination: string): boolean {
  return destination.startsWith(OVERRIDE_PREFIX) && destination.length > OVERRIDE_PREFIX.length;
}

/** True when the previewed effect leaves a mutator something to do. Retentions
 *  are excluded by construction: retaining changes nothing, which is exactly why
 *  retention is the fail-safe default of every slice above. */
export function hasMutatingAction(actions: readonly PlanAction[]): boolean {
  return actions.some((action) => action.mutating);
}

function action(
  kind: PlanActionKind,
  pluginId: string | null,
  destination: string | null,
  mutating: boolean,
  summary: string,
): Omit<PlanAction, "order"> {
  return { kind, pluginId, destination, mutating, summary, persisted: false };
}

function registryActionFor(
  entry: PlanRegistryEntry,
  kind: "registry-add" | "registry-deregister" | "registry-retain",
): Omit<PlanAction, "order"> {
  const names = entry.capabilities.length === 0 ? "no capabilities" : entry.capabilities.join(", ");
  const verb =
    kind === "registry-add" ? "register" : kind === "registry-deregister" ? "deregister" : "retain";
  return action(
    kind,
    entry.pluginId,
    null,
    kind !== "registry-retain",
    `${verb} ${names} for pack \`${entry.pluginId}\` (${entry.reason})`,
  );
}

function artifactActionFor(
  decision: PlanArtifactDecision,
  kind: "artifact-delete" | "artifact-bootstrap" | "artifact-advance" | "artifact-retain",
): Omit<PlanAction, "order"> {
  const pluginId = decision.owners.length > 0 ? decision.owners[0].pluginId : null;
  const verb =
    kind === "artifact-delete"
      ? "delete"
      : kind === "artifact-bootstrap"
        ? "record bootstrap authority over"
        : kind === "artifact-advance"
          ? "advance"
          : "retain";
  const because = decision.reason === null ? "" : ` (${decision.reason})`;
  return action(
    kind,
    pluginId,
    decision.destination,
    kind !== "artifact-retain",
    `${verb} managed artifact \`${decision.destination}\`${because}`,
  );
}

/** Integrate every action class into ONE list, then order it deterministically.
 *
 *  The `override-write` kind is DERIVED, not declared: a payload landing in the
 *  committed project-override tier is the same previewed write with a different
 *  review weight, so it is classified here from a fact the payload slice already
 *  produced rather than re-observed. `constitution-recompose` is derived the same
 *  way — the composed constitution is a function of the registered capability
 *  set, so it recomposes exactly when that set changes. */
function integrateActions(input: PlanCompletionInput): PlanAction[] {
  const pending: Array<Omit<PlanAction, "order">> = [];

  for (const repair of input.repairs) {
    pending.push(
      action(
        "evidence-repair",
        repair.pluginId,
        null,
        true,
        `re-establish drifted lifecycle evidence for pack \`${repair.pluginId}\` (${repair.comparison}, ${repair.scope} half)`,
      ),
    );
  }

  for (const seed of input.evidenceSeeds) {
    pending.push(
      action(
        "evidence-seed",
        seed.pluginId,
        null,
        true,
        `record ${seed.kind} lifecycle evidence for pack \`${seed.pluginId}\` (comparison ${seed.comparison})`,
      ),
    );
  }

  for (const entry of input.registryDelta.additions) {
    pending.push(registryActionFor(entry, "registry-add"));
  }
  for (const entry of input.registryDelta.deregistrations) {
    pending.push(registryActionFor(entry, "registry-deregister"));
  }

  for (const payload of input.payloads.actions) {
    const override = isProjectOverrideDestination(payload.destination);
    const pluginId = payload.owners.length > 0 ? payload.owners[0].pluginId : null;
    pending.push(
      action(
        override ? "override-write" : "payload-write",
        pluginId,
        payload.destination,
        true,
        `${payload.write} ${override ? "project override" : "payload"} \`${payload.destination}\` (sha256 ${payload.identity.sha256}, ${payload.identity.bytes} bytes, ${payload.owners.length} owner(s))`,
      ),
    );
  }

  for (const decision of input.artifacts.advance) {
    pending.push(artifactActionFor(decision, "artifact-advance"));
  }
  for (const decision of input.artifacts.bootstrap) {
    pending.push(artifactActionFor(decision, "artifact-bootstrap"));
  }
  for (const decision of input.artifacts.deletable) {
    pending.push(artifactActionFor(decision, "artifact-delete"));
  }

  for (const write of input.answers.writes) {
    pending.push(
      action(
        "answer-write",
        write.pluginId,
        write.destination,
        true,
        `bind proposed answer for question \`${write.questionId}\` of capability \`${write.pack}\` (${write.status})`,
      ),
    );
  }

  // The composed constitution is a function of the registered capability set, so
  // it recomposes exactly when an addition or a deregistration changes that set.
  // A retention — including a proof-incomplete retention that PRESERVED a
  // registration the caller asked to remove — changes nothing, so it does not
  // trigger a recomposition.
  if (
    input.registryDelta.additions.length > 0 ||
    input.registryDelta.deregistrations.length > 0
  ) {
    pending.push(
      action(
        "constitution-recompose",
        null,
        CONSTITUTION_RELPATH,
        true,
        `recompose the project constitution: the registered capability set changes (${input.registryDelta.additions.length} addition(s), ${input.registryDelta.deregistrations.length} deregistration(s))`,
      ),
    );
  }

  for (const entry of input.registryDelta.retentions) {
    pending.push(registryActionFor(entry, "registry-retain"));
  }
  for (const decision of input.artifacts.retained) {
    pending.push(artifactActionFor(decision, "artifact-retain"));
  }

  const rank = (kind: PlanActionKind): number => PLAN_ACTION_ORDER.indexOf(kind);
  return [...pending]
    .sort(
      (left, right) =>
        rank(left.kind) - rank(right.kind) ||
        (left.pluginId ?? "").localeCompare(right.pluginId ?? "") ||
        (left.destination ?? "").localeCompare(right.destination ?? "") ||
        left.summary.localeCompare(right.summary),
    )
    .map((entry, order) => ({ ...entry, order }));
}

/** Derive the plan's lifecycle mode from its own content. FIRST MATCH WINS in
 *  the order documented on `PlanMode`. `null` on the `invalid-root` path only:
 *  admission failed before anything was read, so no lifecycle shape was observed
 *  and claiming one would be a lie. */
export function planMode(input: PlanCompletionInput): PlanMode | null {
  if (input.applicability === "invalid-root") return null;
  if (input.artifacts.deletable.length > 0) return "deletion";
  if (input.registryDelta.deregistrations.length > 0) return "deregistration";
  if (input.repairs.length > 0) return "repair";
  if (input.evidenceSeeds.length > 0 || input.artifacts.bootstrap.length > 0) return "bootstrap";
  if (input.artifacts.advance.length > 0) return "upgrade";
  if (input.registryDelta.additions.length > 0) return "install";
  if (input.artifacts.retained.some((decision) => decision.reason === "divergent")) {
    return "retained-divergence";
  }
  return "reconcile";
}

/** State the applicability basis explicitly, from the SAME findings and
 *  questions the applicability decision consumed. */
export function applicabilityBasis(input: PlanCompletionInput): PlanApplicabilityBasis {
  const blockingFindings = input.findings.filter((finding) => finding.severity === "error");
  const blockingQuestions = [...input.answers.unresolved];
  return {
    applicability: input.applicability,
    blockingFindings,
    blockingQuestions,
    blocked: blockingFindings.length > 0 || blockingQuestions.length > 0,
  };
}

/** Key-sorted canonicalization. Object key order is normalized recursively so a
 *  record built with a different field order cannot change the hash. Array order
 *  is preserved HERE — it is normalized one level up, where the fact tokens of
 *  each class are sorted before folding — because a nested array (an owner list,
 *  a fingerprint list) is itself a fact whose order its producing slice fixed. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort((left, right) => left.localeCompare(right))) {
      out[key] = canonical(source[key]);
    }
    return out;
  }
  return value;
}

/** One canonical fact token. `JSON.stringify` over `[class, value]` is injective
 *  — its own quoting disambiguates a value that contains the delimiter — so no
 *  fact of one class can forge a token of another. Deliberately NOT a raw
 *  control-byte separator: a literal control character in a source file makes
 *  that file "binary" to diff and search tooling, which silently hides it from
 *  review. */
function token(factClass: PlanIdentityFactClass, value: unknown): string {
  return JSON.stringify([factClass, canonical(value)]);
}

/**
 * Derive the sole approved-plan identity.
 *
 * Each fact class contributes a COUNT token followed by one token per member, so
 * an empty collection is distinguishable from an absent one and a class can
 * never be silently skipped. `coveredFactClasses` is therefore the complete
 * closed set on every plan — coverage is a property of this derivation, not of
 * one plan's data.
 *
 * A class's member tokens are SORTED before folding, which makes the identity a
 * function of the fact MULTISET rather than of the order the facts happened to
 * arrive in. The count token still pins cardinality, so sorting loses nothing:
 * two plans agree on a `planId` exactly when they carry the same facts, never
 * merely when they carry them in the same sequence. Presentation order remains
 * fixed and deterministic in the response itself; it is simply not a
 * mutation-relevant fact, and an approved plan must not be invalidated by one.
 */
export function planIdentity(input: PlanCompletionInput, actions: readonly PlanAction[]): PlanIdentity {
  const tokens: string[] = [];
  const emit = (factClass: PlanIdentityFactClass, values: readonly unknown[]): void => {
    tokens.push(JSON.stringify([factClass, "count", values.length]));
    const members = values.map((value) => token(factClass, value));
    members.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    for (const member of members) tokens.push(member);
  };

  emit("envelope-version", [input.planVersion]);
  emit("workspace-root", [
    [
      input.workspaceRoot,
      input.admission.admitted,
      input.admission.source,
      input.admission.reason,
    ],
  ]);
  emit("mode", [planMode(input)]);
  emit("applicability", [input.applicability]);
  emit("inventory-trust", [[input.inventory.confidence, input.inventory.mayEstablishAbsence]]);

  emit("registry-delta", [
    ...input.registryDelta.additions.map((entry) => ["addition", entry] as const),
    ...input.registryDelta.deregistrations.map((entry) => ["deregistration", entry] as const),
    ...input.registryDelta.retentions.map((entry) => ["retention", entry] as const),
  ]);

  emit(
    "answer-write",
    input.answers.writes.map((write) => [
      write.pluginId,
      write.pack,
      write.questionId,
      write.destination,
      write.value,
      write.source,
      write.status,
    ]),
  );
  emit(
    "answer-unresolved",
    input.answers.unresolved.map((question) => [
      question.pluginId,
      question.pack,
      question.questionId,
      question.destination,
      question.reason,
    ]),
  );

  emit("evidence-seed", [...input.evidenceSeeds]);
  emit("evidence-repair", [...input.repairs]);

  emit("payload-action", [...input.payloads.actions]);
  emit("payload-rejection", [...input.payloads.rejected]);
  emit("payload-conflict", [...input.payloads.conflicts]);

  emit("artifact-decision", [
    ...input.artifacts.deletable.map((decision) => ["deletable", decision] as const),
    ...input.artifacts.bootstrap.map((decision) => ["bootstrap", decision] as const),
    ...input.artifacts.advance.map((decision) => ["advance", decision] as const),
    ...input.artifacts.retained.map((decision) => ["retained", decision] as const),
  ]);

  // An action contributes its kind, target, and mutating flag — never its
  // human-readable `summary`, for exactly the reason a finding never contributes
  // its message: rewording review prose must not invalidate an approved plan.
  // `order` is excluded too, because it is derived from the kind rank and the
  // tiebreak rather than observed, and the tokens are sorted anyway.
  emit(
    "action",
    actions.map((entry) => [entry.kind, entry.pluginId, entry.destination, entry.mutating]),
  );

  // Findings contribute their code, severity, and attribution — never their
  // message. Rewording a diagnostic must not invalidate an approved plan, while
  // the three fields that DO decide applicability are all folded in.
  emit(
    "finding",
    input.findings.map((finding) => [finding.code, finding.severity, finding.pluginId]),
  );

  return {
    planId: sha256Hex(JSON.stringify(tokens)),
    algorithm: "sha256",
    coveredFactClasses: [...PLAN_IDENTITY_FACT_CLASSES],
    factCount: tokens.length,
  };
}

/**
 * Complete one plan: derive its mode, integrate every action class into one
 * ordered list, state the applicability basis explicitly, and freeze the
 * approved-plan identity.
 *
 * Pure: identical inputs always produce deep-equal output and an identical
 * `planId`, and no input object is mutated.
 */
export function completePlan(input: PlanCompletionInput): PlanCompletion {
  const actions = integrateActions(input);
  return {
    mode: planMode(input),
    actions,
    applicabilityBasis: applicabilityBasis(input),
    identity: planIdentity(input, actions),
  };
}
