// wf resolver — the derived repair plan (WF-460).
//
// `repair_packs` PRODUCES; IT NEVER EXECUTES. This module is the pure derivation
// behind that tool: it turns the facts `discover_packs` already observed into the
// SAME frozen `plan_install` envelope — `planVersion: 1`, the thirteen-kind
// ordered action list, the SHA-256 `planId` over the sixteen frozen fact classes
// — with the selection DERIVED from observed drift instead of supplied by a
// caller. A confirmed repair identity is executed by handing its `planId` to
// `apply_install`, which re-derives every decision under the exclusive lock.
// There is deliberately no second envelope, no second identity, and no repair
// mutator.
//
// FIVE RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. REPAIR NEVER DESELECTS. `deriveRepairSelection` returns the literal empty
//      deregistration set, and that is a STRUCTURAL guarantee rather than a
//      policy: `planArtifacts` reaches its `deletable` form only when every
//      recorded owner of a destination is deselected AND the recorded owner set
//      is non-empty, so an empty deselection set makes `deletable` UNREACHABLE.
//      A repair plan therefore cannot contain a destructive claim — not "does
//      not", cannot. "We could not establish ownership" and "we established that
//      nobody owns it" are different shapes, and only the first is constructible
//      here.
//
//   2. AN UNTRUSTWORTHY INVENTORY IS NOT MERELY FLAGGED. Under WF-446's trust
//      asymmetry only a `trustworthy` inventory may turn silence into absence, so
//      a `duplicate` (which lands as `invalid`), `unavailable`, `malformed`,
//      `invalid`, or `partial` inventory makes the whole repair plan
//      NOT-APPLICABLE through an explicit blocking finding — on top of rule 1,
//      which already removed every destructive claim from its content.
//
//   3. THE DRIFT STATES DO NOT COLLAPSE. Source drift, a moved root map, local
//      fingerprint drift, a missing machine binding, and missing portable legacy
//      evidence are five distinct observations with five distinct remedies. The
//      classifier is an exhaustive switch whose `default` arm returns the most
//      conservative outcome — `indeterminate`, which authorizes nothing — so an
//      unrecognised future comparison degrades safely instead of acting.
//
//   4. THE DIAGNOSIS AGREES WITH THE MUTATOR IT FEEDS. WF-459's upgrade gate
//      asserts two conjuncts `planArtifacts` does not: the recorded owner set must
//      not have moved relative to the currently-DECLARED one, and the declared
//      `{production, refresh, removal}` tuple must still equal the recorded one.
//      A plan that proposed an advance failing either would be a plan the mutator
//      is OBLIGED to refuse, so this module withholds the advance at diagnosis
//      time and reports the retention instead.
//
//   5. NOTHING HERE OBSERVES, AND NOTHING HERE WRITES. Every input is a fact a
//      prior slice computed. This module opens no file, canonicalizes no path,
//      reads no ledger, and has no write capability at all — which is what keeps
//      repair byte-inert from the recovered baseline onward. Crash recovery is
//      carried in the response's own separate `recovery` key, exactly as
//      `discover_packs` and `plan_install` carry it, and is never folded into the
//      plan or into `planId`.

import { hasPreviewedArtifactEffect } from "./artifact-plan.js";
import {
  planInstall as planInstallJoin,
  type PlanInstallInput,
  type PlanSelectionInput,
} from "./plan-install.js";
import { completePlan, type PlanCompletionInput } from "./plan-complete.js";
import type {
  ArtifactEvidence,
  ArtifactOwner,
  DiscoveredPack,
  LifecycleEvidenceComparison,
  PayloadSemantics,
  PlanApplicability,
  PlanArtifactPreview,
  PlanFinding,
  PlanInstallResponse,
} from "./types.js";
import { PLAN_ENVELOPE_VERSION } from "./types.js";

/** What one pack's lifecycle evidence says, in repair's own vocabulary.
 *
 *  FIVE DRIFT STATES, NOT ONE. Each names a different observation and each maps
 *  to a different remedy; collapsing any two is the failure this vocabulary
 *  exists to prevent. `settled` and `indeterminate` are the two non-drift
 *  outcomes, and `indeterminate` is the conservative default arm. */
export type RepairDriftState =
  /** The committed portable tuple disagrees with the installed pack. Root-
   *  independent: this is drift in the SHARED half and is diagnosed the same way
   *  whether or not the install root also moved. */
  | "source-drift"
  /** The portable tuples are equal and a KNOWN root moved. Machine-local only. */
  | "root-map"
  /** The portable tuples are equal, the root is unchanged, and the local
   *  fingerprints drifted. Machine-local only, and NOT the same observation as a
   *  moved root. */
  | "local-drift"
  /** No machine binding is recorded. The registration is RETAINED and a binding
   *  seed is offered. */
  | "missing-binding"
  /** No portable evidence is recorded at all — a pre-ledger registration. The
   *  pack stays SELECTED AND OPERATIONAL and a strict bootstrap is offered. */
  | "missing-legacy-evidence"
  /** The recorded and observed evidence agree. Nothing to repair. */
  | "settled"
  /** The comparison is one this build does not recognise. Authorizes NOTHING. */
  | "indeterminate";

/** The remedy each drift state licenses, as a closed token. Kept as data next to
 *  the classifier so a reader can see at a glance that no two states share one
 *  remedy — the mechanical form of rule 3. */
export const REPAIR_DRIFT_REMEDY: Readonly<Record<RepairDriftState, string>> = Object.freeze({
  "source-drift": "evidence-repair:portable",
  "root-map": "evidence-repair:binding",
  "local-drift": "evidence-repair:binding",
  "missing-binding": "evidence-seed:binding-seed",
  "missing-legacy-evidence": "evidence-seed:legacy-bootstrap",
  settled: "none",
  indeterminate: "none",
});

/** Whether a drift state authorizes any previewed effect at all. `indeterminate`
 *  and `settled` authorize nothing, for opposite reasons: one because there is
 *  nothing to do, the other because what to do could not be established. */
export function repairDriftIsActionable(state: RepairDriftState): boolean {
  return REPAIR_DRIFT_REMEDY[state] !== "none";
}

/**
 * Classify one pack's comparison into repair's drift vocabulary.
 *
 * EXHAUSTIVE, WITH A CONSERVATIVE DEFAULT (WF-454 class A, WF-458's
 * `preservationClassFor` pattern). Every comparison the frozen evidence
 * primitive can produce is named; anything else returns `indeterminate`, which
 * licenses no action, so a comparison added by a future build degrades to "we
 * could not establish what to do" rather than to a remedy chosen by accident.
 */
export function classifyRepairDrift(
  comparison: LifecycleEvidenceComparison["state"],
): RepairDriftState {
  switch (comparison) {
    case "portable-mismatch":
      // Rule 3, the root-independence clause. The portable half is the SHARED
      // half; whether this machine's install root also moved is a machine-local
      // question that cannot downgrade shared-tuple drift into a root remap.
      return "source-drift";
    case "root-moved":
      return "root-map";
    case "local-mismatch":
      return "local-drift";
    case "binding-seed":
      return "missing-binding";
    case "evidence-missing":
      return "missing-legacy-evidence";
    case "equal":
      return "settled";
    default:
      return "indeterminate";
  }
}

/** One pack's repair diagnosis, for review. Carries no authority of its own —
 *  the authority is the plan's `identity.planId` and nothing else. */
export interface RepairDiagnosis {
  pluginId: string;
  comparison: LifecycleEvidenceComparison["state"];
  drift: RepairDriftState;
  remedy: string;
  /** `true` when the pack is registered, and therefore in the derived selection.
   *  A registered pack with missing legacy evidence stays selected and
   *  operational — that is what this field records. */
  selected: boolean;
}

/** Diagnose every known pack, ordered by `pluginId`. Pure and total. */
export function diagnoseRepairDrift(packs: readonly DiscoveredPack[]): RepairDiagnosis[] {
  return packs
    .map((pack) => {
      const drift = classifyRepairDrift(pack.evidence.comparison);
      return {
        pluginId: pack.pluginId,
        comparison: pack.evidence.comparison,
        drift,
        remedy: REPAIR_DRIFT_REMEDY[drift],
        selected: pack.registeredCapabilities.length > 0,
      };
    })
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

/**
 * Derive the repair selection from the observed inventory.
 *
 * `desired` is every REGISTERED pack, because registration is exactly what makes
 * a pack acted-on in the planner — and only an acted-on pack's drift produces a
 * repair or a seed. An installed-but-unregistered pack is deliberately NOT
 * selected: adopting one would be an install, not a repair, and repair is not an
 * install surface.
 *
 * `deregister` is the literal empty array on EVERY path. This is rule 1 and it is
 * the whole safety story: with nothing deselected, `planArtifacts` can never
 * reach its `deletable` form, so a repair plan cannot carry a destructive claim.
 *
 * `answers` is empty for the same reason: repair proposes no project answer. An
 * unanswered declared question still blocks, exactly as it does for an install.
 */
export function deriveRepairSelection(packs: readonly DiscoveredPack[]): PlanSelectionInput {
  const desired = [
    ...new Set(
      packs
        .filter((pack) => pack.registeredCapabilities.length > 0)
        .map((pack) => pack.pluginId),
    ),
  ].sort((left, right) => left.localeCompare(right));
  return { desired, deregister: [], answers: [] };
}

const SHA256_RE = /^[a-f0-9]{64}$/;

/** Owner-set equality by the composite identity, order-insensitively. Built with
 *  `JSON.stringify` rather than a separator character: a literal control byte in
 *  a source file makes git read the file as BINARY, hiding it from every reviewer
 *  (WF-449 nearly shipped exactly that). */
function ownerKey(owner: ArtifactOwner): string {
  return JSON.stringify([owner.pluginId, owner.capability, owner.source]);
}

function sameOwners(left: readonly ArtifactOwner[], right: readonly ArtifactOwner[]): boolean {
  if (left.length !== right.length) return false;
  const l = left.map(ownerKey).sort();
  const r = right.map(ownerKey).sort();
  return l.every((value, index) => value === r[index]);
}

function sameSemantics(left: PayloadSemantics, right: PayloadSemantics): boolean {
  return (
    left.production === right.production &&
    left.refresh === right.refresh &&
    left.removal === right.removal
  );
}

function tupleOf(semantics: PayloadSemantics): PayloadSemantics {
  return {
    production: semantics.production,
    refresh: semantics.refresh,
    removal: semantics.removal,
  };
}

/**
 * Rule 4 — does this destination satisfy the TWO conjuncts WF-459's upgrade gate
 * asserts and `planArtifacts` does not?
 *
 * (a) The recorded owner set must not have MOVED relative to the currently
 *     declared one. A destination whose declaring-capability set changed
 *     alongside its source would otherwise advance and silently rewrite the
 *     ledger's owner set — and a later deletion establishes exclusivity from
 *     exactly that set.
 * (b) The declared `{production, refresh, removal}` tuple must still equal the
 *     recorded one. `classify` gates on the RECORDED refresh and never looks at
 *     the declared one, so a pack that moved its row to `refresh: retain` would
 *     otherwise have its artifact replaced against its current declaration.
 *
 * `true` only when both hold over well-formed, complete facts. Anything else is
 * `false`, which is the conservative direction: the advance is withheld.
 */
export function agreesWithAdvanceConjuncts(
  recorded: ArtifactEvidence | null,
  declared: ArtifactEvidence | null,
): boolean {
  if (recorded === null || declared === null) return false;
  if (recorded.owners.length === 0 || declared.owners.length === 0) return false;
  if (!SHA256_RE.test(declared.declaredSourceFingerprint)) return false;
  if (!SHA256_RE.test(declared.producedContentHash)) return false;
  if (!sameOwners(recorded.owners, declared.owners)) return false;
  return sameSemantics(tupleOf(recorded), tupleOf(declared));
}

/** Why one destination's advance was withheld. A closed pair, so the report can
 *  never say "something was wrong" without saying which axis — bytes and
 *  semantics are independent axes (WF-448's rule) and are reported as such. */
export type WithheldAdvanceReason = "owner-set-moved" | "declared-tuple-changed";

/** One withheld advance, for review. */
export interface WithheldAdvance {
  destination: string;
  reason: WithheldAdvanceReason;
}

/** Every destructive claim a finished plan carries. A repair plan's result MUST
 *  be empty; the emptiness is asserted rather than assumed, because a claim the
 *  reader is merely asked to ignore is a claim a careless reader will act on. */
export function repairPlanDestructiveClaims(plan: PlanInstallResponse): string[] {
  const claims = new Set<string>();
  for (const decision of plan.artifacts.deletable) claims.add(decision.destination);
  for (const decision of [
    ...plan.artifacts.retained,
    ...plan.artifacts.bootstrap,
    ...plan.artifacts.advance,
  ]) {
    if (decision.deletionAuthority) claims.add(decision.destination);
  }
  for (const action of plan.actions) {
    if (action.kind === "artifact-delete") claims.add(action.destination ?? "");
  }
  return [...claims].sort((left, right) => left.localeCompare(right));
}

/** Everything `planRepair` needs — exactly `plan_install`'s input minus the
 *  selection, which repair derives from the facts rather than accepting. */
export type RepairPlanInput = Omit<PlanInstallInput, "selection">;

function sortFindings(findings: readonly PlanFinding[]): PlanFinding[] {
  return [...findings].sort(
    (left, right) =>
      (left.pluginId ?? "").localeCompare(right.pluginId ?? "") ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

/** Re-derive applicability by the SAME first-match rule the planner uses, over
 *  the possibly-amended facts. Restated here rather than imported because the
 *  planner's copy is bound to its own local variables; the two are asserted
 *  equal by the contract suite on every unamended plan. */
function repairApplicability(
  plan: PlanInstallResponse,
  findings: readonly PlanFinding[],
  artifacts: PlanArtifactPreview,
): PlanApplicability {
  if (findings.some((finding) => finding.severity === "error")) return "not-applicable";
  if (plan.answers.unresolved.length > 0) return "blocked";
  const inert =
    plan.registryDelta.additions.length === 0 &&
    plan.registryDelta.deregistrations.length === 0 &&
    plan.answers.writes.length === 0 &&
    plan.evidenceSeeds.length === 0 &&
    plan.repairs.length === 0 &&
    plan.payloads.actions.length === 0 &&
    !hasPreviewedArtifactEffect(artifacts);
  return inert ? "no-change" : "applicable";
}

/** Rebuild the frozen envelope over amended findings and artifacts, re-running
 *  the SAME completion pass so `mode`, `actions`, `applicabilityBasis`, and
 *  `identity` stay derived facts rather than carried-over ones. */
function recompleted(
  plan: PlanInstallResponse,
  findings: readonly PlanFinding[],
  artifacts: PlanArtifactPreview,
): PlanInstallResponse {
  const sorted = sortFindings(findings);
  const applicability = repairApplicability(plan, sorted, artifacts);
  const completionInput: PlanCompletionInput = {
    planVersion: PLAN_ENVELOPE_VERSION,
    admission: plan.admission,
    workspaceRoot: plan.workspaceRoot,
    applicability,
    registryDelta: plan.registryDelta,
    answers: plan.answers,
    evidenceSeeds: plan.evidenceSeeds,
    repairs: plan.repairs,
    payloads: plan.payloads,
    artifacts,
    findings: sorted,
    inventory: plan.inventory,
  };
  const completion = completePlan(completionInput);
  return {
    ...plan,
    applicability,
    mode: completion.mode,
    artifacts,
    actions: completion.actions,
    applicabilityBasis: completion.applicabilityBasis,
    identity: completion.identity,
    findings: sorted,
  };
}

/** The `repair_packs` result: the frozen plan envelope plus the body-free
 *  diagnosis rows the derivation produced. The diagnosis is REVIEW MATERIAL —
 *  the plan's `identity.planId` remains the sole authority, and nothing here
 *  reaches it. */
export interface RepairPlanResult {
  plan: PlanInstallResponse;
  diagnosis: RepairDiagnosis[];
  withheldAdvances: WithheldAdvance[];
}

/**
 * Produce the complete repair plan.
 *
 * Pure and total: identical inputs always produce a deep-equal result and an
 * identical `planId`, and no input object is mutated. Nothing here writes.
 */
export function planRepair(input: RepairPlanInput): RepairPlanResult {
  const diagnosis = diagnoseRepairDrift(input.packs);

  // Rule 4, applied to the FACTS rather than to the finished decision. An
  // artifact whose owner set moved, or whose declared tuple no longer matches the
  // recorded one, has its DECLARED half withheld, so `classify` cannot see a
  // changed source and cannot reach its `advance` form. The established artifact
  // rules are consumed exactly as they are; only the fact this module hands them
  // is narrowed, and it is narrowed in the conservative direction.
  const withheldAdvances: WithheldAdvance[] = [];
  const artifactFacts = (input.artifacts ?? []).map((fact) => {
    const recorded = fact.recorded;
    const declared = fact.declared;
    if (recorded === null || declared === null) return fact;
    if (declared.declaredSourceFingerprint === recorded.declaredSourceFingerprint) return fact;
    if (agreesWithAdvanceConjuncts(recorded, declared)) return fact;
    withheldAdvances.push({
      destination: fact.destination,
      reason: sameOwners(recorded.owners, declared.owners)
        ? "declared-tuple-changed"
        : "owner-set-moved",
    });
    return { ...fact, declared: null };
  });
  withheldAdvances.sort((left, right) => left.destination.localeCompare(right.destination));

  const base = planInstallJoin({
    ...input,
    artifacts: artifactFacts,
    selection: deriveRepairSelection(input.packs),
  });

  // The two NOTHING-WAS-READ paths carry an emptied envelope and a `null` mode by
  // construction. Amending either would be claiming an observation that was never
  // made, so both are returned exactly as the planner produced them.
  if (base.applicability === "invalid-root" || base.applicability === "unrecovered") {
    // A halted run asserts NOTHING. The envelope already carries no action and no
    // decision, so the derived channels are emptied to match: a diagnosis or a
    // withheld-advance row surviving here would be a claim about a workspace whose
    // lifecycle state was never established, which is exactly the shape of claim
    // this task exists to make unrepresentable.
    return { plan: base, diagnosis: [], withheldAdvances: [] };
  }

  const findings: PlanFinding[] = [...base.findings];

  for (const withheld of withheldAdvances) {
    findings.push({
      code: "plan/artifact-retained",
      severity: "warning",
      pluginId: null,
      message: `managed artifact \`${withheld.destination}\` has a newer declared source but is retained: \`${withheld.reason}\`, so an advance would not survive the mutator's upgrade gate.`,
    });
  }

  // Rule 2. Under WF-446's trust asymmetry only a `trustworthy` inventory may
  // turn "not listed" into "orphaned", so a plan computed against any other
  // confidence cannot prove that nobody owns anything. It is made NOT-APPLICABLE
  // — on top of rule 1, which already made a destructive claim unconstructible —
  // so a reader who ignores the flag still finds no claim to act on.
  if (!input.inventory.mayEstablishAbsence) {
    findings.push({
      code: "plan/inventory-untrustworthy",
      severity: "error",
      pluginId: null,
      message: `the pack inventory reads \`${input.inventory.confidence}\`, so absence of an owner cannot be established; the repair plan is not applicable and carries no destructive claim.`,
    });
  }

  let plan = recompleted(base, findings, base.artifacts);

  // Rule 1, ASSERTED rather than assumed. Reaching this arm means a future change
  // widened something upstream; the most conservative outcome is to drop the
  // deletable bucket entirely and re-complete, so the identity covers what the
  // plan actually says.
  if (repairPlanDestructiveClaims(plan).length > 0) {
    const stripped: PlanArtifactPreview = {
      deletable: [],
      retained: plan.artifacts.retained.map((decision) => ({
        ...decision,
        deletionAuthority: false,
      })),
      bootstrap: plan.artifacts.bootstrap.map((decision) => ({
        ...decision,
        deletionAuthority: false,
      })),
      advance: plan.artifacts.advance.map((decision) => ({
        ...decision,
        deletionAuthority: false,
      })),
    };
    plan = recompleted(base, findings, stripped);
  }

  return { plan, diagnosis, withheldAdvances };
}
