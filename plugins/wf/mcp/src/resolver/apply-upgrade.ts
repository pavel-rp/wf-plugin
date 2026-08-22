// wf resolver — the pure whole-plan upgrade / repair gate (WF-459).
//
// The DECISION half of the constructive slice of the sole public mutator, held to
// exactly the discipline `apply-install.ts`, `apply-targets.ts` and
// `apply-removal.ts` hold: deterministic, body-free, and side-effect-free.
// Nothing here opens a file, canonicalizes a path, reads a ledger, takes a lock,
// or writes a byte. The caller answers every filesystem question UNDER THE LOCK
// and hands the ANSWERS in, which is what keeps "every refusal happens before a
// journal, a backup, or a byte" provable with no filesystem at all.
//
// WF-458 INVERTED THIS FAMILY'S POSTURE TOWARD PRESERVATION. THIS ONE INVERTS IT
// TOWARD HONEST REPORTING. Not overwriting an edited file is the easy half of
// this item; the hard half is that the RESULT must not quietly count that file as
// done, absorbed, resolved, or skipped-because-fine. Every rule below is
// therefore written twice: once as a rule about what may be WRITTEN, and once as
// a rule about what must be SAID.
//
// SEVEN RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. IT IS A WHOLE-PLAN GATE, NOT A PER-ACTION LOOP. Every check below runs
//      over the COMPLETE approved action set before a single target is composed,
//      and any failure rejects the WHOLE plan. The WF-454 structure, inherited
//      through WF-458 verbatim: a per-action loop with early returns would
//      already have advanced the artifacts it walked past.
//
//   2. THE UPGRADE ARM IS NEVER LESS STRICT THAN THE PRESERVATION ARM. WF-449
//      shipped a HIGH defect of exactly this shape on the removal side, and
//      WF-458 closed it by RE-ASSERTING every conjunct at the authorization point
//      rather than trusting the planner's verdict. The same audit is applied here:
//      an advance re-proves well-formed, EQUAL digests, a non-empty recorded owner
//      set, a complete semantic tuple whose `refresh` is `replace-if-unmodified`,
//      a reproducible declaration, and a declared source fingerprint that is
//      well-formed AND actually different from the recorded one. `planArtifacts`
//      asserts all of it too; duplicating the test is deliberate, because this is
//      the last line before a user's file is replaced.
//
//   3. AN EDITED ARTIFACT IS NEVER OVERWRITTEN AND NEVER CONVERTED INTO SUCCESS.
//      The second clause is the one this module exists for. An edited artifact
//      that survives is a REMAINING DIVERGENCE, it is named in the report, and its
//      presence makes `fully-upgraded` unreachable by construction — not by a flag
//      somebody remembered to clear.
//
//   4. "NO DRIFT" IS A POSITIVE DEFINITION, DERIVED ONCE. `noDrift` is
//      `remaining.length === 0` and nothing else. There is deliberately no site
//      that sets a boolean because it thinks it is finished, so a new code path
//      cannot claim cleanliness it did not establish.
//
//   5. DOING NOTHING IS NOT THE SAME AS THERE BEING NOTHING TO DO. A run whose
//      every divergence is RETAINED performs zero writes, and the naive
//      implementation reports exactly what it would report for a pristine
//      workspace. The two states are distinguished here by CONSTRUCTION: a
//      pristine workspace yields `outcome: "no-drift"` with an empty `remaining`,
//      and a fully-retained run yields `outcome: "retained-divergence"` with a
//      non-empty one. The four outcomes are derived from the same two observable
//      quantities in ONE expression, so no third state can be spelled.
//
//   6. ONE CONFIRMATION AUTHORIZES ONLY THE EXACT LISTED ACTIONS. A destination
//      that has BECOME advanceable since the plan was approved but which the plan
//      does not list is not authorized — it is preserved, and it is REPORTED as a
//      remaining divergence rather than silently ignored.
//
//   7. PORTABLE AND MACHINE-LOCAL ARE DIFFERENT SCOPES, NOT A NAMING CONVENTION.
//      A `portable` repair re-establishes the portable evidence AND the applicable
//      local binding; a `binding` repair (a moved root, drifted local
//      fingerprints) re-establishes ONLY machine-local facts and may not touch the
//      portable half. Getting this backwards writes machine-specific state into
//      something meant to be shared, so the scope is re-derived here from the
//      re-observed comparison rather than trusted from the approved action.

import { planArtifacts, type PlanArtifactFact } from "./artifact-plan.js";
import type {
  ApplyReason,
  ArtifactOwner,
  LifecycleEvidenceComparison,
  MachineBindingEvidence,
  PayloadSemantics,
  PlanAction,
  PlanArtifactDecision,
  PlanArtifactPreview,
  PlanRepairAction,
  PlanRepairScope,
  PortablePackEvidence,
  RemainingDivergence,
  RemainingDivergenceClass,
  UpgradeOutcome,
  UpgradeReport,
} from "./types.js";

const SHA256_RE = /^[a-f0-9]{64}$/;

// ---------------------------------------------------------------------------
// Remaining divergence — the reporting half
// ---------------------------------------------------------------------------

/** Map one retention reason to the divergence class that would remain, or `null`
 *  when the reason does not describe a divergence at all.
 *
 *  AN EXHAUSTIVE SWITCH WHOSE `default` ARM IS THE CONSERVATIVE ONE — WF-458's
 *  `preservationClassFor` discipline, mirrored. "Conservative" here means the
 *  opposite direction to the removal side and for the same reason: over there the
 *  safe answer was "do not delete", here the safe answer is "this is still
 *  divergent". An unrecognised future retention reason must therefore be REPORTED
 *  as a remaining divergence rather than absorbed into a comfortable "no drift".
 *
 *  The four reasons that are deliberately NOT divergences are the ones that
 *  belong to a different arm's vocabulary — a settled artifact, and the three
 *  deselection/removal/bootstrap tokens WF-458 owns. Naming them explicitly is
 *  what stops an ordinary deregistration run from reporting phantom drift. */
export function divergenceClassFor(
  reason: PlanArtifactDecision["reason"],
): RemainingDivergenceClass | null {
  switch (reason) {
    // --- not a divergence: another arm's vocabulary ---
    case "not-deselected":
      return null;
    case "shared-ownership":
    case "unrecorded-declarer":
      return null;
    case "removal-semantics-retain":
      return null;
    case "bootstrap-defers-deletion":
      return null;

    // --- the file was edited ---
    case "divergent":
    case "current-bytes-mismatch":
      return "edited";

    // --- the declaration forbids replacing it ---
    case "refresh-semantics-retain":
      return "refresh-retained";

    // --- present but not trustworthy ---
    case "ownership-incomplete":
    case "digest-malformed":
    case "semantics-incomplete":
    case "source-fingerprint-missing":
      return "ambiguous";

    // --- could not be established at all ---
    case "current-bytes-unreadable":
    case "destination-unsafe":
    case "no-recorded-proof":
    case "inventory-untrustworthy":
    case "not-reproducible":
      return "unverifiable";

    default:
      // Rule 4 and rule 3, in one arm. A reason this release does not understand
      // is a reason nobody tested, and the honest thing to say about an untested
      // state is that it is unresolved.
      return "unverifiable";
  }
}

/** The report for a run that never assessed the artifact arm. `noDrift` is
 *  `false` because nothing established it, not because drift was observed. */
export function notAssessedUpgradeReport(): UpgradeReport {
  return {
    noDrift: false,
    outcome: "not-assessed",
    remaining: [],
    advanced: [],
    repaired: [],
  };
}

/**
 * Rules 4 and 5, as ONE total expression over two observable quantities.
 *
 * The single producer of every non-`not-assessed` outcome. Two runs with the same
 * `(acted, remaining)` pair therefore always agree, and no site anywhere else can
 * spell a fifth state or promote a partial run to a full one.
 */
export function resolveUpgradeOutcome(acted: number, remaining: number): UpgradeOutcome {
  if (remaining > 0) return acted > 0 ? "partial" : "retained-divergence";
  return acted > 0 ? "fully-upgraded" : "no-drift";
}

// ---------------------------------------------------------------------------
// The gate's inputs and authorizations
// ---------------------------------------------------------------------------

/** One pack's lifecycle-evidence facts, RE-OBSERVED by the caller under the lock.
 *
 *  `comparison` is re-derived through `compareLifecycleEvidence` from the current
 *  world, never carried from the approved plan: a repair whose drift has since
 *  resolved itself, or changed shape, must reject rather than write. */
export interface RepairFact {
  pluginId: string;
  comparison: LifecycleEvidenceComparison["state"];
  /** The portable tuple observable RIGHT NOW, or `null` when it could not be
   *  reproduced — itself a rejection class for a `portable` repair. */
  observedPortable: PortablePackEvidence | null;
  /** The machine binding observable RIGHT NOW, or `null`. Required by BOTH
   *  scopes: rule 7's portable repair re-establishes the applicable local binding
   *  as well as the portable half. */
  observedBinding: MachineBindingEvidence | null;
}

/** One authorized artifact advance. Reached only through the `ok` outcome. */
export interface AuthorizedAdvance {
  destination: string;
  canonicalTarget: string;
  /** The recorded owner set the advance was proven over. */
  owners: ArtifactOwner[];
  semantics: PayloadSemantics;
  /** The ledger hash the current bytes were proven to still match. */
  priorContentHash: string;
  /** The fingerprint of the NEW declared source. Well-formed, and different from
   *  the recorded one — the advance's whole justification. */
  declaredSourceFingerprint: string;
  /** The digest the new bytes must hash to. */
  producedContentHash: string;
}

/** One authorized lifecycle-evidence repair.
 *
 *  RULE 7 IN THE TYPE SYSTEM. A `binding` repair carries `portable: null`, so the
 *  composer physically cannot write the portable half from it; a `portable` repair
 *  carries both, because it re-establishes the portable evidence AND the
 *  applicable local binding. */
export interface AuthorizedRepair {
  pluginId: string;
  scope: PlanRepairScope;
  comparison: LifecycleEvidenceComparison["state"];
  /** Non-null EXACTLY when `scope` is `portable`. */
  portable: PortablePackEvidence | null;
  /** Always non-null: both scopes re-establish the machine-local half. */
  binding: MachineBindingEvidence;
}

export interface UpgradeGateInput {
  /** The approved plan's artifact preview, as the confirmation captured it. */
  approved: PlanArtifactPreview;
  /** The mutating actions the action screen admitted, in the plan's own order. */
  supported: readonly PlanAction[];
  /** Every managed artifact's facts, re-observed by the caller UNDER THE LOCK. */
  currentFacts: readonly PlanArtifactFact[];
  /** WF-446's `mayEstablishAbsence`, re-derived under the lock. */
  inventoryTrustworthy: boolean;
  /** The plan's own previewed repairs. */
  repairs: readonly PlanRepairAction[];
  /** The caller's re-observation of each repair's pack, keyed by pack. */
  repairFacts: readonly RepairFact[];
  /** Destinations the WF-458 removal gate authorized for DELETION, so rule 1's
   *  cross-arm coherence check can refuse a plan that would advance and delete
   *  one path. Passed rather than re-derived: the two gates must agree, and a
   *  second independently-written derivation is how they drift apart. */
  removalDestinations: readonly string[];
}

export type UpgradeGateDecision =
  | {
      ok: true;
      advances: AuthorizedAdvance[];
      repairs: AuthorizedRepair[];
      /** Everything this plan will NOT resolve, ready for the report. */
      remaining: RemainingDivergence[];
    }
  | { ok: false; reason: ApplyReason; detail: string };

/** Whether two owner sets are the same triple-for-triple, order-independently.
 *
 *  `JSON.stringify` over the triple is injective — its own quoting disambiguates a
 *  value containing the delimiter — so no combination can forge another triple's
 *  key. Deliberately NOT a raw control-byte separator: a literal control character
 *  makes a source file "binary" to diff and search tooling and hides it from
 *  review (the WF-449 near-miss). */
function sameOwners(left: readonly ArtifactOwner[], right: readonly ArtifactOwner[]): boolean {
  if (left.length !== right.length) return false;
  const key = (owner: ArtifactOwner): string =>
    JSON.stringify([owner.pluginId, owner.capability, owner.source]);
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

function sameSemantics(left: PayloadSemantics, right: PayloadSemantics): boolean {
  return (
    left.production === right.production &&
    left.refresh === right.refresh &&
    left.removal === right.removal
  );
}

function indexCurrent(preview: PlanArtifactPreview): Map<string, PlanArtifactDecision> {
  const index = new Map<string, PlanArtifactDecision>();
  for (const decision of [
    ...preview.deletable,
    ...preview.bootstrap,
    ...preview.advance,
    ...preview.retained,
  ]) {
    index.set(decision.destination, decision);
  }
  return index;
}

/** The scope a comparison state implies. Derived from the comparison rather than
 *  read off the approved action, because the approved `scope` is an assertion the
 *  confirmation captured and rule 7 is the property that must hold NOW.
 *
 *  An exhaustive switch: `evidence-missing`, `binding-seed` and `equal` are not
 *  repairs at all and yield `null`, which rejects. */
function scopeForComparison(
  comparison: LifecycleEvidenceComparison["state"],
): PlanRepairScope | null {
  switch (comparison) {
    case "portable-mismatch":
      return "portable";
    case "root-moved":
    case "local-mismatch":
      return "binding";
    case "equal":
    case "binding-seed":
    case "evidence-missing":
      return null;
    default:
      return null;
  }
}

/**
 * Decide whether an approved plan's advance and repair actions may be executed AT
 * ALL — over the whole plan, before any target is composed.
 *
 * FIRST MATCH WINS, MOST FUNDAMENTAL FIRST, and every failure rejects the WHOLE
 * plan. The internal-coherence checks run before any world-state comparison, for
 * the reason `decideRemovalGate` states: a plan that contradicts itself says
 * nothing reliable about the world either.
 */
export function decideUpgradeGate(input: UpgradeGateInput): UpgradeGateDecision {
  const advanceActions = input.supported.filter((action) => action.kind === "artifact-advance");
  const repairActions = input.supported.filter((action) => action.kind === "evidence-repair");

  // --- rule 1: internal coherence, checked FIRST ----------------------------
  const seen = new Set<string>();
  for (const action of advanceActions) {
    if (action.destination === null) {
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail:
          "an `artifact-advance` action names no destination, so the artifact it would upgrade cannot be resolved; the whole plan is refused and nothing was written.",
      };
    }
    if (seen.has(action.destination)) {
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail: `destination \`${action.destination}\` is named by more than one advance in one plan; the whole plan is refused and nothing was written.`,
      };
    }
    seen.add(action.destination);
  }

  // Advancing and deleting one path in a single plan is incoherent in the same
  // way bootstrapping and deleting it is (WF-458 rule 4): one arm would replace
  // the bytes the other proved it was safe to destroy. Checked EXPLICITLY rather
  // than left to emerge from `classify` returning one form per destination — an
  // emergent guarantee is one refactor away from being no guarantee.
  const removalSet = new Set(input.removalDestinations);
  const advanceDeleteConflict = [...seen].filter((destination) => removalSet.has(destination)).sort();
  if (advanceDeleteConflict.length > 0) {
    return {
      ok: false,
      reason: "apply/artifact-precondition",
      detail: `destination(s) ${advanceDeleteConflict
        .map((destination) => `\`${destination}\``)
        .join(", ")} carry both an upgrade and a deletion in one plan; the whole plan is refused before any journal, backup, or mutation.`,
    };
  }

  const repairSeen = new Set<string>();
  for (const action of repairActions) {
    if (action.pluginId === null) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail:
          "an `evidence-repair` action carries no pack attribution, so the evidence it would re-establish cannot be resolved; the whole plan is refused and nothing was written.",
      };
    }
    if (repairSeen.has(action.pluginId)) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `pack \`${action.pluginId}\` is named by more than one evidence repair in one plan; the whole plan is refused and nothing was written.`,
      };
    }
    repairSeen.add(action.pluginId);
  }

  // The inverse direction, and it is the one that silently half-applies a plan. An
  // `evidence-repair` action with no matching previewed repair would be filtered
  // out below, composed as nothing, and reported in `applied[]` as though it had
  // landed — the WF-454 defect-(A) shape exactly. Refusing loudly is the only
  // honest option.
  const previewedRepairs = new Set(input.repairs.map((repair) => repair.pluginId));
  const unbacked = [...repairSeen].filter((pluginId) => !previewedRepairs.has(pluginId)).sort();
  if (unbacked.length > 0) {
    return {
      ok: false,
      reason: "apply/evidence-precondition",
      detail: `pack(s) ${unbacked
        .map((pluginId) => `\`${pluginId}\``)
        .join(", ")} carry an \`evidence-repair\` action with no previewed repair to bind it to, so applying this plan would silently omit it; the whole plan is refused and nothing was written.`,
    };
  }

  // --- rule 2: re-derive the classification from CURRENT facts --------------
  //
  // Re-derived, never trusted. The approved preview's `advance` bucket is an
  // assertion the confirmation captured; this is the same function recomputed
  // against the world as it is now. It also inherits `planArtifacts`' digest
  // well-formedness and hash-gating conjuncts wholesale, so the upgrade arm here
  // cannot be laxer than the preservation arm there.
  const recomputed = planArtifacts(input.currentFacts, {
    inventoryTrustworthy: input.inventoryTrustworthy,
  }).preview;
  const currentIndex = indexCurrent(recomputed);

  const advances: AuthorizedAdvance[] = [];
  for (const action of advanceActions) {
    const destination = action.destination as string;
    const decision = currentIndex.get(destination);
    const fact = input.currentFacts.find((candidate) => candidate.destination === destination);
    if (
      decision === undefined ||
      decision.form !== "advance" ||
      decision.canonicalTarget === null ||
      decision.recordedContentHash === null ||
      decision.currentContentHash === null ||
      !SHA256_RE.test(decision.recordedContentHash) ||
      !SHA256_RE.test(decision.currentContentHash) ||
      decision.recordedContentHash !== decision.currentContentHash ||
      decision.bytesMatchLedger !== true ||
      decision.owners.length === 0 ||
      decision.semantics === null ||
      decision.semantics.production !== "copy" ||
      decision.semantics.refresh !== "replace-if-unmodified" ||
      fact === undefined ||
      fact.declared === null ||
      !SHA256_RE.test(fact.declared.declaredSourceFingerprint) ||
      !SHA256_RE.test(fact.declared.producedContentHash) ||
      fact.recorded === null ||
      fact.declared.declaredSourceFingerprint === fact.recorded.declaredSourceFingerprint ||
      // TWO CONJUNCTS `planArtifacts` DOES NOT ASSERT, ADDED BY THE RULE-2 AUDIT.
      //
      // (a) THE OWNER SET MUST NOT HAVE MOVED. `classify`'s advance path reasons
      //     entirely from the RECORDED owners and never compares them with the
      //     currently-DECLARED ones, so a destination whose declaring-capability
      //     set changed alongside its source would advance and silently rewrite
      //     the ledger's owner set. A later deletion establishes exclusivity from
      //     exactly that set, so an owner quietly dropped here would license
      //     destroying a file a surviving owner still declares. WF-456's payload
      //     precondition refuses the same drift on the install side; the upgrade
      //     arm must not be laxer than it.
      //
      // (b) THE DECLARED TUPLE MUST STILL MATCH THE RECORDED ONE. `classify`
      //     gates the advance on `recorded.refresh === "replace-if-unmodified"`
      //     and never looks at the DECLARED refresh, so a pack that changed its
      //     row to `refresh: retain` would still have its artifact replaced on the
      //     authority of a stale recorded tuple — an upgrade performed against the
      //     current declaration's explicit instruction not to.
      //
      // Bytes and semantics are independent axes (WF-448's rule), so both are
      // checked, and either one failing rejects the whole plan.
      !sameOwners(decision.owners, fact.declared.owners) ||
      !sameSemantics(decision.semantics, {
        production: fact.declared.production,
        refresh: fact.declared.refresh,
        removal: fact.declared.removal,
      })
    ) {
      // EVERY conjunct restated at the point of authorization rather than
      // inherited from `planArtifacts`. Duplicating the test is deliberate and is
      // rule 2: this is the last line before a user's file is replaced, and a
      // proof that is only asserted somewhere else is a proof one refactor can
      // delete. The final conjunct is the advance's own justification — a
      // "changed" source that is byte-identical to the recorded one would replace
      // a file for no reason at all.
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail: `managed artifact \`${destination}\` is listed for an upgrade but does not currently satisfy every advance conjunct (listed, hash-proven with well-formed matching digests against the prior ledger hash, exclusively owned by an owner set that has not moved, declaring the same \`{production, refresh, removal}\` tuple the ledger recorded with \`refresh: replace-if-unmodified\`, and a well-formed declared source fingerprint that actually differs from the recorded one); the whole plan is refused and nothing was written.`,
      };
    }
    // Rule 3 asserted as a POST-condition of the classification: an advance may
    // never coincide with deletion authority, and `planArtifacts` never grants
    // both. Checked rather than assumed.
    if (decision.deletionAuthority !== false) {
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail: `managed artifact \`${destination}\` would be upgraded and would also carry deletion authority; an upgrade grants no deletion in the same plan, so the whole plan is refused.`,
      };
    }
    advances.push({
      destination,
      canonicalTarget: decision.canonicalTarget,
      owners: decision.owners,
      semantics: decision.semantics,
      priorContentHash: decision.currentContentHash,
      declaredSourceFingerprint: fact.declared.declaredSourceFingerprint,
      producedContentHash: fact.declared.producedContentHash,
    });
  }

  // --- rule 7: the repairs, scoped from the RE-OBSERVED comparison ----------
  //
  // RULE 6 FOR THE REPAIR ARM. Only a pack the ACTION LIST names is authorized —
  // `plan.repairs` is the previewed diagnosis, and the confirmation authorizes the
  // integrated actions, not the preview. Reading the preview directly would let a
  // repair the screen never admitted reach a ledger write.
  const repairs: AuthorizedRepair[] = [];
  for (const approved of input.repairs.filter((repair) => repairSeen.has(repair.pluginId))) {
    const fact = input.repairFacts.find((candidate) => candidate.pluginId === approved.pluginId);
    if (fact === undefined) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `pack \`${approved.pluginId}\` is listed for an evidence repair but its lifecycle evidence could not be re-observed under the lock; the whole plan is refused and the existing record is preserved exactly as it was.`,
      };
    }
    if (fact.comparison !== approved.comparison) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `pack \`${approved.pluginId}\` no longer compares as \`${approved.comparison}\` under the lock (now \`${fact.comparison}\`), so the approved repair is stale; the whole plan is refused and the existing record is preserved exactly as it was.`,
      };
    }
    const scope = scopeForComparison(fact.comparison);
    if (scope === null || scope !== approved.scope) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `the repair for pack \`${approved.pluginId}\` names scope \`${approved.scope}\`, which is not the scope comparison \`${fact.comparison}\` implies; portable and machine-local are different scopes, so the whole plan is refused and nothing was written.`,
      };
    }
    if (fact.observedBinding === null) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `pack \`${approved.pluginId}\` is listed for an evidence repair but its machine binding could not be observed under the lock; a repair records complete evidence or none, so the whole plan is refused.`,
      };
    }
    if (scope === "portable" && fact.observedPortable === null) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `pack \`${approved.pluginId}\` is listed for a portable evidence repair but its portable tuple could not be reproduced under the lock; a partial tuple is strictly worse than none, so the whole plan is refused and the existing record is preserved exactly as it was.`,
      };
    }
    repairs.push({
      pluginId: approved.pluginId,
      scope,
      comparison: fact.comparison,
      // Rule 7 in the type system: a `binding` repair carries NO portable half,
      // so the composer cannot write machine-specific state into the shared
      // record even by mistake.
      portable: scope === "portable" ? fact.observedPortable : null,
      binding: fact.observedBinding,
    });
  }

  // --- rules 3, 5 and 6: what this run will NOT resolve ---------------------
  const remaining = collectRemainingDivergence({
    currentFacts: input.currentFacts,
    inventoryTrustworthy: input.inventoryTrustworthy,
    advancing: advances.map((advance) => advance.destination),
    removing: input.removalDestinations,
    repairFacts: input.repairFacts,
    repairing: repairs.map((repair) => repair.pluginId),
  });

  return { ok: true, advances, repairs, remaining };
}

/**
 * Enumerate everything a run leaves divergent — rules 3, 5 and 6, as ONE pure
 * function of the world plus the set of subjects this run resolves.
 *
 * SEPARATE FROM THE GATE ON PURPOSE. Divergence is a property of the WORKSPACE,
 * not of the transaction, so it must be answerable on the paths where no
 * transaction happens at all: a plan refused as `plan-not-applicable` because its
 * only artifact content is retained divergence is precisely the run whose report
 * must not read like a clean workspace's (rule 5). Calling this with empty
 * `advancing` / `removing` / `repairing` gives the honest read-only answer for
 * exactly that case.
 */
export function collectRemainingDivergence(input: {
  currentFacts: readonly PlanArtifactFact[];
  inventoryTrustworthy: boolean;
  /** Destinations this run ADVANCES — resolved, so not remaining. */
  advancing: readonly string[];
  /** Destinations this run DELETES — WF-458's arm, not a source divergence. */
  removing: readonly string[];
  /** Every pack whose evidence comparison the caller re-observed. */
  repairFacts: readonly RepairFact[];
  /** Packs this run REPAIRS — resolved, so not remaining. */
  repairing: readonly string[];
}): RemainingDivergence[] {
  const currentIndex = indexCurrent(
    planArtifacts(input.currentFacts, {
      inventoryTrustworthy: input.inventoryTrustworthy,
    }).preview,
  );
  const advancing = new Set(input.advancing);
  const removing = new Set(input.removing);
  const remaining: RemainingDivergence[] = [];

  for (const decision of currentIndex.values()) {
    if (advancing.has(decision.destination)) continue;
    if (removing.has(decision.destination)) continue;
    if (decision.form === "advance") {
      // Rule 6. Advanceable NOW, but the confirmation does not list it — so it is
      // not authorized, and saying nothing about it would be exactly the silent
      // absorption rule 3 forbids.
      remaining.push({
        subject: decision.destination,
        class: "unlisted",
        reason: decision.reason,
      });
      continue;
    }
    if (decision.form === "deletable" || decision.form === "bootstrap") {
      // WF-458's arm. Not a source divergence, and reporting it as one here would
      // make an ordinary removal plan report drift it does not have.
      continue;
    }
    const divergence = divergenceClassFor(decision.reason);
    if (divergence === null) continue;
    remaining.push({
      subject: decision.destination,
      class: divergence,
      reason: decision.reason,
    });
  }

  // A pack whose evidence is still drifted after this run is a remaining
  // divergence too — the same honesty rule applied to the repair arm.
  const repairing = new Set(input.repairing);
  for (const fact of input.repairFacts) {
    if (repairing.has(fact.pluginId)) continue;
    if (scopeForComparison(fact.comparison) === null) continue;
    remaining.push({ subject: fact.pluginId, class: "evidence-drifted", reason: null });
  }

  remaining.sort(
    (left, right) =>
      left.subject.localeCompare(right.subject) || left.class.localeCompare(right.class),
  );
  return remaining;
}

/**
 * Compose the run's honest statement from what it authorized and what it left.
 *
 * Rule 4 lives HERE and only here: `noDrift` is derived from `remaining` being
 * empty, and `outcome` from `resolveUpgradeOutcome`. No caller sets either.
 */
export function buildUpgradeReport(decision: {
  advances: readonly AuthorizedAdvance[];
  repairs: readonly AuthorizedRepair[];
  remaining: readonly RemainingDivergence[];
}): UpgradeReport {
  const advanced = decision.advances.map((advance) => advance.destination).sort();
  const repaired = decision.repairs
    .map((repair) => ({ pluginId: repair.pluginId, scope: repair.scope }))
    .sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  const remaining = [...decision.remaining];
  return {
    noDrift: remaining.length === 0,
    outcome: resolveUpgradeOutcome(advanced.length + repaired.length, remaining.length),
    remaining,
    advanced,
    repaired,
  };
}
