// wf resolver — the pure selected-set planning join (WF-447).
//
// Deterministic, body-free, and side-effect-free. Nothing here reads
// configuration, opens a file, canonicalizes a root, shells out, or writes a
// byte: every input is collected by the caller and every output is bounded
// metadata. That is what makes the release's BYTE-INERT guarantee assertable —
// planning cannot touch a ledger, a seed, a project answer, or an enablement
// flag because it has no write capability at all. The response says so in the
// type system: `byteInert` is the literal `true` and every seed's `persisted` is
// the literal `false`.
//
// Pack facts reach this module EXCLUSIVELY through the caller's `discover_packs`
// join (WF-446) — never a re-derived inventory. Discovery's orderings are
// inherited, never re-checked: a duplicate stable id or name has already
// invalidated the inventory before anything reaches here, and portable
// comparison has already preceded every local root fact.
//
// THREE RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. OMISSION NEVER REMOVES. A registered pack absent from the desired set is
//      a RETENTION, never a deregistration. Removal has its own explicit input.
//      This is what makes "an orphaned registration stays visible and retained"
//      and "a disabled registration can never become an implicit removal"
//      mechanically true instead of a convention someone must remember.
//
//   2. LEGACY BOOTSTRAP IS PREVIEWED ONLY FROM COMPLETE PROOF, and only for a
//      pack the plan actually ACTS ON. Incomplete proof forces the pack back
//      into retentions — preserving its registration even when it was explicitly
//      deregistered — and makes the whole plan non-applicable. Scoping the rule
//      to acted-on packs is required by rule 1: applying it to every registered
//      pack would let one orphaned registration, which must stay retained and
//      visible, make every plan non-applicable.
//
//   3. A PROPOSED ANSWER IS NOT PERSISTED EVIDENCE. It is validated through the
//      SAME declared-schema path a persisted value takes, and a valid one
//      satisfies planning — but it stays `pending` until an apply that does not
//      exist yet. A missing or invalid answer blocks.
//
//   4. NO UNRESOLVED RECOVERY FLOWS INTO PLAN GENERATION (WF-452). The guarded
//      pre-entry gate below runs BEFORE any of the five planner paths —
//      registration, answers, payload safety, artifact evidence, and the
//      complete repair-capable completion — so an interrupted transaction that
//      could not be fully recovered yields NO plan and NO applicability claim
//      about the selection, rather than a degraded plan or a plan with a
//      warning. The gate lives HERE, in the pure join, rather than only in the
//      service: every one of the five paths runs through this function, so a
//      future caller cannot route around it, and the property is testable with
//      no filesystem at all.
//
// This module still writes nothing. Recovery — the one part of a planning run
// that can write — happens in the caller, BEFORE any state is read, and arrives
// here as a finished fact that is gated on and then echoed verbatim. Planning
// NEVER creates a journal, a backup, or a transaction: like discovery it is
// lock-acquiring but journal-free.

import {
  emptyArtifactPreview,
  hasPreviewedArtifactEffect,
  planArtifacts,
  type PlanArtifactFact,
} from "./artifact-plan.js";
import {
  emptyPayloadPreview,
  planPayloads,
  type PlanPayloadFact,
} from "./payload-plan.js";
import { completePlan, type PlanCompletionInput } from "./plan-complete.js";
import { validateQuestionValue } from "./questions.js";
import type {
  ArtifactOwner,
  DiscoveredPack,
  DiscoveryInventory,
  PlanAdmissionState,
  PlanAnswerWrite,
  PlanApplicability,
  PlanEvidenceSeed,
  PlanFinding,
  PlanInstallResponse,
  PlanRegistryDelta,
  PlanRegistryEntry,
  PlanRegistryReason,
  PlanRepairAction,
  PlanUnresolvedQuestion,
  QuestionRecord,
  RecoveryReport,
} from "./types.js";
import { PLAN_ENVELOPE_VERSION } from "./types.js";

/** Capability metadata the structural findings need. Supplied by the caller for
 *  BOTH already-registered capabilities and the not-yet-registered capabilities
 *  an addition would bring, so the post-plan set is complete. */
export interface PlanCapabilityInput {
  /** The pack that owns this capability. */
  pluginId: string;
  name: string;
  requires: string[];
  conflicts: string[];
  /** Partitioned provider surfaces this capability claims (a `provider`
   *  fragment's `scope`). */
  providerScopes: string[];
}

/** One proposed project answer. Not persisted evidence. */
export interface PlanProposedAnswer {
  pluginId: string;
  questionId: string;
  value: unknown;
}

/** The explicit selection. Every field is consumed verbatim; planning infers no
 *  membership of its own. */
export interface PlanSelectionInput {
  desired: readonly string[];
  deregister: readonly string[];
  answers: readonly PlanProposedAnswer[];
}

export interface PlanInstallInput {
  admission: PlanAdmissionState;
  inventory: DiscoveryInventory;
  packs: readonly DiscoveredPack[];
  capabilities: readonly PlanCapabilityInput[];
  selection: PlanSelectionInput;
  /** Declared payload rows with every filesystem question already answered
   *  (WF-448). Supplied for every inspectable pack; the join itself narrows them
   *  to the ACTED-ON set, for the same reason rule 2 is scoped that way — an
   *  orphaned registration that must stay retained and visible cannot be allowed
   *  to make every plan non-applicable. Omitted entirely by a caller that does
   *  not preview payloads, which leaves registration-only planning unchanged. */
  payloads?: readonly PlanPayloadFact[];
  /** Managed-artifact facts with every filesystem question already answered
   *  (WF-449), MINUS the deselection half. `deselectedOwners` is deliberately not
   *  a caller input: explicit deselection is a property of THIS plan's own
   *  registry delta, so the join below derives it and a caller cannot assert
   *  deletion authority by handing one in. Omitted entirely by a caller that does
   *  not preview artifacts, which leaves registration-only planning unchanged. */
  artifacts?: readonly PlanArtifactFactInput[];
  /** The pre-entry crash-recovery report for this run (WF-452).
   *
   *  REQUIRED, not optional-with-a-default, and that is the point. An omitted
   *  report would silently read as "there was nothing to recover" — precisely the
   *  false negative this field exists to prevent — so every caller must state
   *  what recovery found. `noRecoveryReport()` is the explicit way to say "this
   *  caller performs no recovery"; it is never assumed.
   *
   *  Consumed for exactly TWO things: the `proceeded` gate below, and a verbatim
   *  echo into the response's separate `recovery` envelope. It is NOT a
   *  mutation-relevant fact and never reaches `completePlan`, which is what keeps
   *  `planId` byte-stable across differing recovery reports. */
  recovery: RecoveryReport;
}

/** A managed-artifact fact as a CALLER supplies it — the pure join's fact without
 *  the deselection half, which only the plan itself may determine. */
export type PlanArtifactFactInput = Omit<PlanArtifactFact, "deselectedOwners">;

/** The zeroed inventory the `invalid-root` path reports: admission failed before
 *  anything was read, so claiming any observation would be a lie. */
const UNOBSERVED_INVENTORY: DiscoveryInventory = {
  confidence: "unavailable",
  mayEstablishAbsence: false,
  observedCount: 0,
  issues: [],
};

function byPluginId<T extends { pluginId: string }>(rows: T[]): T[] {
  return [...rows].sort((left, right) => left.pluginId.localeCompare(right.pluginId));
}

function sortFindings(findings: PlanFinding[]): PlanFinding[] {
  return [...findings].sort(
    (left, right) =>
      (left.pluginId ?? "").localeCompare(right.pluginId ?? "") ||
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
}

function sortQuestionRows<T extends { pluginId: string; pack: string; questionId: string }>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (left, right) =>
      left.pluginId.localeCompare(right.pluginId) ||
      left.pack.localeCompare(right.pack) ||
      left.questionId.localeCompare(right.questionId),
  );
}

function sortedNames(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

/** A pack is REGISTERED when the registry attributes at least one capability to
 *  it. Deliberately not `state === "active"`: a disabled or unrecoverable pack
 *  can still be registered, and treating it as unregistered would let omission
 *  silently drop its rows — exactly the implicit removal rule 1 forbids. */
function isRegistered(pack: DiscoveredPack): boolean {
  return pack.registeredCapabilities.length > 0;
}

function entryFor(
  pack: DiscoveredPack,
  reason: PlanRegistryReason,
  capabilities: readonly string[],
): PlanRegistryEntry {
  return {
    pluginId: pack.pluginId,
    pluginName: pack.pluginName,
    capabilities: sortedNames(capabilities),
    reason,
    presence: pack.presence,
    state: pack.state,
    enablement: pack.enablement,
    overlay: pack.overlay,
  };
}

/**
 * Plan the previewed effect of one explicit selection.
 *
 * Pure: identical inputs always produce deep-equal output, and no input object
 * is mutated.
 */
export function planInstall(input: PlanInstallInput): PlanInstallResponse {
  // --- the invalid-root path ------------------------------------------------
  // Admission failed, so nothing was read and nothing may be classified. The
  // envelope is still the ordinary envelope — an inadmissible root is an
  // explicit, typed, byte-inert outcome, not an error channel.
  if (!input.admission.admitted) {
    // The completion pass runs on THIS path too. An inadmissible root is a real
    // plan with a real identity — one that says "nothing may be done, and here is
    // why" — so a reviewer approving it approves the same schema they approve
    // everywhere else. The admission verdict is folded into the identity, so two
    // different inadmissible roots never collide on one `planId`.
    const completion = completePlan({
      planVersion: PLAN_ENVELOPE_VERSION,
      admission: input.admission,
      workspaceRoot: null,
      applicability: "invalid-root",
      registryDelta: { additions: [], retentions: [], deregistrations: [] },
      answers: { writes: [], unresolved: [] },
      evidenceSeeds: [],
      repairs: [],
      payloads: emptyPayloadPreview(),
      artifacts: emptyArtifactPreview(),
      findings: [],
      inventory: UNOBSERVED_INVENTORY,
    });
    return {
      planVersion: PLAN_ENVELOPE_VERSION,
      workspaceRoot: null,
      admission: input.admission,
      applicability: "invalid-root",
      mode: completion.mode,
      registryDelta: { additions: [], retentions: [], deregistrations: [] },
      answers: { writes: [], unresolved: [] },
      evidenceSeeds: [],
      repairs: [],
      payloads: emptyPayloadPreview(),
      artifacts: emptyArtifactPreview(),
      actions: completion.actions,
      applicabilityBasis: completion.applicabilityBasis,
      identity: completion.identity,
      findings: [],
      inventory: UNOBSERVED_INVENTORY,
      recovery: input.recovery,
      byteInert: true,
    };
  }

  // --- the unrecovered path (WF-452) ----------------------------------------
  // RULE 4. Recovery ran before entry and did not proceed, so NO lifecycle state
  // was read and none of the five planner paths below may run. The response is
  // the ordinary envelope, emptied: no delta, no answers, no seeds, no repairs,
  // no payload or artifact preview, no actions — and `applicability:
  // "unrecovered"`, which claims nothing about the selection because the
  // selection was never classified.
  //
  // `inventory` is zeroed for the same reason discovery zeroes it on its own
  // halted path: under WF-446's trust asymmetry only a `trustworthy` inventory
  // may turn "not listed" into "orphaned", so a halted run can never be
  // mistakable for an observation of absence.
  //
  // This branch is placed AFTER the admission branch on purpose: admission fails
  // before any root-bound port — and therefore before any recovery port — exists,
  // so `invalid-root` outranks `unrecovered` and the two can never both apply.
  if (!input.recovery.proceeded) {
    const halted: PlanFinding[] = [
      {
        code: "plan/halted-unrecovered",
        severity: "error",
        pluginId: null,
        message: `planning did not proceed: recovery reported \`${input.recovery.state}\`, so lifecycle state was never read and no plan was generated.`,
      },
    ];
    // The completion pass runs here too, exactly as it does on the `invalid-root`
    // path: a halted plan is a real plan with a real identity — one that says
    // "nothing may be done, and here is why" — so a reviewer approving it
    // approves the same schema they approve everywhere else. The recovery report
    // itself is NOT folded in (it is not a mutation-relevant fact), so the halt's
    // identity is a function of the root, the admission verdict, and the halt
    // finding alone.
    const completion = completePlan({
      planVersion: PLAN_ENVELOPE_VERSION,
      admission: input.admission,
      workspaceRoot: input.admission.root,
      applicability: "unrecovered",
      registryDelta: { additions: [], retentions: [], deregistrations: [] },
      answers: { writes: [], unresolved: [] },
      evidenceSeeds: [],
      repairs: [],
      payloads: emptyPayloadPreview(),
      artifacts: emptyArtifactPreview(),
      findings: halted,
      inventory: UNOBSERVED_INVENTORY,
    });
    return {
      planVersion: PLAN_ENVELOPE_VERSION,
      workspaceRoot: input.admission.root,
      admission: input.admission,
      applicability: "unrecovered",
      mode: completion.mode,
      registryDelta: { additions: [], retentions: [], deregistrations: [] },
      answers: { writes: [], unresolved: [] },
      evidenceSeeds: [],
      repairs: [],
      payloads: emptyPayloadPreview(),
      artifacts: emptyArtifactPreview(),
      actions: completion.actions,
      applicabilityBasis: completion.applicabilityBasis,
      identity: completion.identity,
      findings: halted,
      inventory: UNOBSERVED_INVENTORY,
      recovery: input.recovery,
      byteInert: true,
    };
  }

  const findings: PlanFinding[] = [];
  const finding = (
    code: PlanFinding["code"],
    severity: PlanFinding["severity"],
    pluginId: string | null,
    message: string,
  ): void => {
    findings.push({ code, severity, pluginId, message });
  };

  const byId = new Map(input.packs.map((pack) => [pack.pluginId, pack]));
  const desired = new Set(input.selection.desired);
  const deregister = new Set(input.selection.deregister);

  // A pack named in both sets is contradictory. It is neither added nor removed:
  // it falls through to the retention path below, so the safe direction wins.
  const contradictory = new Set<string>();
  for (const pluginId of desired) {
    if (deregister.has(pluginId)) {
      contradictory.add(pluginId);
      finding(
        "plan/contradictory-selection",
        "error",
        pluginId,
        "appears in both the desired and the deregistration set; the selection is ambiguous and neither registers nor removes it.",
      );
    }
  }

  for (const pluginId of [...desired, ...deregister].sort((l, r) => l.localeCompare(r))) {
    if (!byId.has(pluginId)) {
      finding(
        "plan/unknown-selection",
        "error",
        pluginId,
        "is not a pack the resolver knows about; it is neither installed nor registered.",
      );
    }
  }

  // --- classify every known pack -------------------------------------------
  const additions: PlanRegistryEntry[] = [];
  const retentions: PlanRegistryEntry[] = [];
  const deregistrations: PlanRegistryEntry[] = [];
  const evidenceSeeds: PlanEvidenceSeed[] = [];
  /** Drifted-evidence repairs (WF-450) — what makes the plan repair-CAPABLE. */
  const repairs: PlanRepairAction[] = [];
  /** Packs the plan ACTS ON — the only ones whose legacy proof must be complete. */
  const actedOn: DiscoveredPack[] = [];
  /** Packs whose capabilities are in the post-plan active set. */
  const postPlanPacks = new Set<string>();

  for (const pack of byPluginId([...input.packs])) {
    const registered = isRegistered(pack);
    const wanted = desired.has(pack.pluginId) && !contradictory.has(pack.pluginId);
    const removing = deregister.has(pack.pluginId) && !contradictory.has(pack.pluginId);

    // Presence findings are reported for every registered pack, acted on or not:
    // an orphaned registration must remain VISIBLE, which is what this says.
    if (registered && pack.presence === "orphaned") {
      finding(
        "plan/orphaned-registration",
        "warning",
        pack.pluginId,
        "is registered but absent from a trustworthy inventory; it stays visible and retained by default.",
      );
    }
    if (registered && pack.presence === "absence-indeterminate") {
      finding(
        "plan/absence-indeterminate",
        "warning",
        pack.pluginId,
        "is registered and not listed, but the inventory was not trustworthy enough to establish absence.",
      );
    }

    // A disabled pack cannot be registered — `register_pack` rejects it — so
    // selecting one is a structural error rather than an addition.
    if (wanted && !registered && pack.enablement === "disabled") {
      finding(
        "plan/not-selectable",
        "error",
        pack.pluginId,
        "is disabled, so it cannot be registered; enable it before selecting it.",
      );
    }

    const acting = (wanted || removing) && byId.has(pack.pluginId);
    if (acting) actedOn.push(pack);

    // --- lifecycle evidence for an acted-on pack ---------------------------
    // Rule 2. `proofComplete` is the whole gate: a bootstrap is previewable only
    // when BOTH observed halves exist.
    //
    // `proofIncomplete` carries the RETENTION REASON rather than a boolean,
    // because two distinct proof failures now reach this path and a reader of the
    // retained entry must be able to tell them apart (WF-450).
    let proofIncomplete: PlanRegistryReason | null = null;
    if (acting) {
      const comparison = pack.evidence.comparison;
      if (comparison === "binding-seed" && pack.seedProposal !== null) {
        evidenceSeeds.push({
          pluginId: pack.pluginId,
          kind: "binding-seed",
          comparison,
          portable: null,
          binding: pack.seedProposal,
          persisted: false,
        });
      } else if (comparison === "binding-seed") {
        // THE MISSING-BINDING PREDICATE (WF-450). `comparison` and `seedProposal`
        // are typed independently, so a `binding-seed` comparison with no proposal
        // is representable — and it used to fall through with no seed, no finding,
        // and no bucket change: a silent omission, which is exactly what the
        // schema forbids. The seed action is APPLICABLE ONLY UNDER ITS EXACT
        // PROOF PREDICATE, so a failed predicate produces an explicit
        // non-applicable result on the same fail-safe shape rule 2 uses: the
        // registration is preserved and the whole plan is not applicable.
        proofIncomplete = "retained-binding-proof-incomplete";
        finding(
          "plan/binding-proof-incomplete",
          "error",
          pack.pluginId,
          "needs a machine-binding seed but no binding proposal was observed; planning is not applicable and its registration is preserved.",
        );
      } else if (comparison === "evidence-missing") {
        const observedPortable = pack.evidence.portable;
        const observedBinding = pack.evidence.binding;
        if (observedPortable !== null && observedBinding !== null) {
          evidenceSeeds.push({
            pluginId: pack.pluginId,
            kind: "legacy-bootstrap",
            comparison,
            portable: observedPortable,
            binding: observedBinding,
            persisted: false,
          });
          finding(
            "plan/legacy-bootstrap-previewed",
            "info",
            pack.pluginId,
            "has no recorded lifecycle evidence; complete observed proof makes a bootstrap seed reviewable.",
          );
        } else {
          proofIncomplete = "retained-legacy-proof-incomplete";
          finding(
            "plan/legacy-proof-incomplete",
            "error",
            pack.pluginId,
            "has no recorded lifecycle evidence and incomplete observed proof; planning is not applicable and its registration is preserved.",
          );
        }
      } else if (comparison !== "equal") {
        // `portable-mismatch`, `root-moved`, `local-mismatch`. Staleness does NOT
        // clear selectability (inherited from discovery), so this is a warning.
        finding(
          "plan/stale-evidence",
          "warning",
          pack.pluginId,
          `lifecycle evidence compares as \`${comparison}\`${
            pack.overlay === null ? "" : `; overlay \`${pack.overlay}\``
          }.`,
        );
        // THIS IS WHAT MAKES THE PLAN REPAIR-CAPABLE (WF-450). A drifted
        // comparison previously produced a warning and NOTHING ELSE — the plan
        // reported the drift and then carried no effect that would ever resolve
        // it. The repair is a previewed action on the same byte-inert footing as
        // every other: it is emitted here from a comparison the discovery join
        // already made, never from a fresh diagnosis, which is why this stays
        // inside the slice's scope. `portable-mismatch` drifts the portable half;
        // `root-moved` and `local-mismatch` drift the machine-binding half.
        repairs.push({
          pluginId: pack.pluginId,
          comparison,
          scope: comparison === "portable-mismatch" ? "portable" : "binding",
          overlay: pack.overlay,
          persisted: false,
        });
      }
    }

    // --- bucket the pack ---------------------------------------------------
    // Incomplete proof always wins: the registration is PRESERVED, which means
    // retention, even for an explicit deregistration. The reason distinguishes
    // the legacy-bootstrap failure from the missing-binding failure.
    if (proofIncomplete !== null) {
      if (registered) {
        retentions.push(entryFor(pack, proofIncomplete, pack.registeredCapabilities));
        postPlanPacks.add(pack.pluginId);
      }
      continue;
    }

    if (wanted && !registered) {
      if (pack.enablement !== "disabled") {
        additions.push(
          entryFor(
            pack,
            "selected-addition",
            input.capabilities
              .filter((capability) => capability.pluginId === pack.pluginId)
              .map((capability) => capability.name),
          ),
        );
        postPlanPacks.add(pack.pluginId);
      }
      continue;
    }

    if (!registered) continue;

    if (removing) {
      deregistrations.push(entryFor(pack, "explicit-deregistration", pack.registeredCapabilities));
      continue;
    }

    // Rule 1 — every remaining registered pack is RETAINED, never removed.
    const reason: PlanRegistryReason = wanted
      ? "selected-retention"
      : pack.presence === "orphaned"
        ? "retained-orphaned"
        : pack.presence === "absence-indeterminate"
          ? "retained-absence-indeterminate"
          : "retained-by-omission";
    retentions.push(entryFor(pack, reason, pack.registeredCapabilities));
    postPlanPacks.add(pack.pluginId);
  }

  // --- structural findings over the POST-PLAN capability set ----------------
  const postPlan = input.capabilities.filter((capability) =>
    postPlanPacks.has(capability.pluginId),
  );
  const active = new Set(postPlan.map((capability) => capability.name));

  for (const capability of postPlan) {
    for (const needed of sortedNames(capability.requires)) {
      if (!active.has(needed)) {
        finding(
          "plan/dependency-unsatisfied",
          "error",
          capability.pluginId,
          `capability \`${capability.name}\` requires \`${needed}\`, which the post-plan capability set does not provide.`,
        );
      }
    }
    for (const foe of sortedNames(capability.conflicts)) {
      if (active.has(foe) && foe !== capability.name) {
        finding(
          "plan/capability-conflict",
          "error",
          capability.pluginId,
          `capability \`${capability.name}\` declares a conflict with \`${foe}\`, which the post-plan capability set also activates.`,
        );
      }
    }
  }

  // Provider surfaces partition by scope: two owners is a validation error, and
  // the pairwise walk names BOTH offenders so the finding is actionable.
  const claims = postPlan.flatMap((capability) =>
    sortedNames(capability.providerScopes).map((scope) => ({ capability, scope })),
  );
  for (let i = 0; i < claims.length; i++) {
    for (let j = i + 1; j < claims.length; j++) {
      const left = claims[i];
      const right = claims[j];
      if (left.scope === right.scope && left.capability.name !== right.capability.name) {
        finding(
          "plan/provider-overlap",
          "error",
          left.capability.pluginId,
          `capabilities \`${left.capability.name}\` and \`${right.capability.name}\` both claim the provider surface \`${left.scope}\` — partitioned ownership must not overlap.`,
        );
      }
    }
  }

  // --- project answers ------------------------------------------------------
  // Rule 3. Only a pack the plan acts on needs its questions satisfied: an
  // untouched registration's open question is not this plan's business.
  const proposedByKey = new Map<string, PlanProposedAnswer>();
  for (const answer of input.selection.answers) {
    proposedByKey.set(`${answer.pluginId} ${answer.questionId}`, answer);
  }

  const writes: PlanAnswerWrite[] = [];
  const unresolved: PlanUnresolvedQuestion[] = [];

  for (const pack of byPluginId(actedOn)) {
    for (const question of pack.questions as readonly QuestionRecord[]) {
      // Already persisted — nothing to write and nothing open.
      if (question.state.status === "resolved") continue;

      const proposed = proposedByKey.get(`${pack.pluginId} ${question.id}`);
      const open = (reason: PlanUnresolvedQuestion["reason"]): void => {
        unresolved.push({
          pluginId: pack.pluginId,
          pack: question.pack,
          questionId: question.id,
          destination: question.destination,
          prompt: question.prompt,
          reason,
          suggestions: question.state.suggestions,
        });
      };

      if (proposed === undefined) {
        finding(
          "plan/answer-missing",
          "warning",
          pack.pluginId,
          `question \`${question.id}\` has no persisted and no proposed answer.`,
        );
        open("missing-answer");
        continue;
      }

      // The SAME validator a persisted value passes through — provenance never
      // buys a shortcut past the declared schema.
      const validation = validateQuestionValue(question, "proposed", proposed.value);
      if (!validation.valid) {
        finding(
          "plan/answer-invalid",
          "warning",
          pack.pluginId,
          `proposed answer for question \`${question.id}\` failed its declared schema: ${validation.diagnostics
            .map((diagnostic) => diagnostic.message)
            .join(" ")}`,
        );
        open("invalid-proposed-answer");
        continue;
      }

      writes.push({
        pluginId: pack.pluginId,
        pack: question.pack,
        questionId: question.id,
        destination: question.destination,
        value: validation.value,
        source: "proposed",
        status: "pending",
      });
    }
  }

  // --- payload safety + co-ownership (WF-448) -------------------------------
  // Scoped to the packs the plan acts on AND that survive it. Acted-on alone is
  // not enough: `acting` is `wanted || removing`, so a pack named only in
  // `deregister` would otherwise contribute a previewed WRITE — a placement the
  // plan is not making, and one that could block a plan by colliding with a pack
  // that stays. Intersecting with the post-plan set matches how deregistration
  // already clears a `plan/provider-overlap`. The `actedOn` half still excludes a
  // retained orphan's declaration, which is not this plan's business either.
  // Payload findings join the ONE findings list, so an unsafe target or a
  // non-identical co-ownership collision reaches `not-applicable` through the
  // existing first-match-wins precedence rather than a second code path.
  const actedOnIds = new Set(
    actedOn.map((pack) => pack.pluginId).filter((pluginId) => postPlanPacks.has(pluginId)),
  );
  const payloadPlan = planPayloads(
    (input.payloads ?? []).filter((fact) => actedOnIds.has(fact.pluginId)),
  );
  for (const payloadFinding of payloadPlan.findings) findings.push(payloadFinding);

  // --- evidence-safe removals and upgrades (WF-449) -------------------------
  // The destructive slice. Unlike payloads, artifact facts are NOT narrowed to
  // the surviving set: deregistration is precisely what makes a removal
  // reviewable, so intersecting it away would delete the deletion case. The
  // narrowing that matters here is the DESELECTION half, derived from this
  // plan's own delta rather than accepted from the caller.
  //
  // `deregistrations` already excludes a pack whose legacy proof was incomplete
  // — rule 2 pushed that pack back into retentions — so an unprovable
  // registration can never contribute deletion authority. That composition is
  // the fail-safe direction and is deliberate.
  const deregisteredIds = new Set(deregistrations.map((entry) => entry.pluginId));
  const isDeselected = (owner: ArtifactOwner): boolean =>
    deregisteredIds.has(owner.pluginId) && !postPlanPacks.has(owner.pluginId);

  const artifactPlan = planArtifacts(
    (input.artifacts ?? []).map((fact) => ({
      ...fact,
      deselectedOwners: [
        ...(fact.recorded?.owners ?? []),
        ...(fact.declared?.owners ?? []),
      ].filter(isDeselected),
    })),
    { inventoryTrustworthy: input.inventory.mayEstablishAbsence },
  );
  for (const artifactFinding of artifactPlan.findings) findings.push(artifactFinding);

  // --- applicability, first match wins -------------------------------------
  const registryDelta: PlanRegistryDelta = {
    additions: byPluginId(additions),
    retentions: byPluginId(retentions),
    deregistrations: byPluginId(deregistrations),
  };

  const applicability: PlanApplicability = findings.some((f) => f.severity === "error")
    ? "not-applicable"
    : unresolved.length > 0
      ? "blocked"
      : registryDelta.additions.length === 0 &&
          registryDelta.deregistrations.length === 0 &&
          writes.length === 0 &&
          evidenceSeeds.length === 0 &&
          // A previewed repair is a previewed EFFECT. Without this conjunct a
          // `mode: "repair"` plan could report `no-change`, which is
          // self-contradictory — and it would break the schema's own invariant
          // that `no-change` implies no mutating action.
          repairs.length === 0 &&
          // A previewed payload write is a previewed EFFECT, so a plan carrying
          // one is never `no-change`. Whether that write would be a no-op against
          // the target's current bytes is an eligibility question this slice
          // deliberately does not answer.
          payloadPlan.preview.actions.length === 0 &&
          // A previewed removal, bootstrap, or advance is a previewed EFFECT, so
          // a plan carrying one is never `no-change`. A plan whose only artifact
          // entries are RETENTIONS still is — retaining changes nothing, which is
          // exactly why retention is the fail-safe default.
          !hasPreviewedArtifactEffect(artifactPlan.preview)
        ? "no-change"
        : "applicable";

  // --- complete the plan (WF-450) -------------------------------------------
  // Integration runs LAST, over the finished facts, and every collection it reads
  // is already in its final sorted order — which is what lets the identity be a
  // function of the facts rather than of the order they were discovered in.
  const answers = {
    writes: sortQuestionRows(writes),
    unresolved: sortQuestionRows(unresolved),
  };
  const completionInput: PlanCompletionInput = {
    planVersion: PLAN_ENVELOPE_VERSION,
    admission: input.admission,
    workspaceRoot: input.admission.root,
    applicability,
    registryDelta,
    answers,
    evidenceSeeds: byPluginId(evidenceSeeds),
    repairs: byPluginId(repairs),
    payloads: payloadPlan.preview,
    artifacts: artifactPlan.preview,
    findings: sortFindings(findings),
    inventory: input.inventory,
  };
  const completion = completePlan(completionInput);

  return {
    planVersion: PLAN_ENVELOPE_VERSION,
    workspaceRoot: input.admission.root,
    admission: input.admission,
    applicability,
    mode: completion.mode,
    registryDelta,
    answers,
    evidenceSeeds: byPluginId(evidenceSeeds),
    repairs: byPluginId(repairs),
    payloads: payloadPlan.preview,
    artifacts: artifactPlan.preview,
    actions: completion.actions,
    applicabilityBasis: completion.applicabilityBasis,
    identity: completion.identity,
    findings: sortFindings(findings),
    inventory: input.inventory,
    // Echoed verbatim, never consulted beyond the gate above and never folded
    // into the identity — the separation that lets a maintainer read the
    // restoration and the plan they asked for as two distinct things.
    recovery: input.recovery,
    byteInert: true,
  };
}
