// wf resolver — the pure evidence-safe removal/upgrade join (WF-449).
//
// Deterministic, body-free, and side-effect-free. Nothing here opens a file,
// canonicalizes a path, reads a ledger, or writes a byte: the caller answers
// every filesystem question and hands the ANSWERS in. That is what keeps the
// release's BYTE-INERT guarantee assertable across the destructive slice too — a
// planner that cannot touch the filesystem cannot delete the artifact it is
// classifying, and every decision it returns says `persisted: false` in the type
// system rather than by convention.
//
// THIS IS THE DESTRUCTIVE-AUTHORITY SLICE. It decides what may be DELETED, so
// FAIL-SAFE is the governing principle: the default answer to every incomplete
// question is RETAIN.
//
// FOUR RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. DELETION ELIGIBILITY IS CONJUNCTIVE. `deletable` requires explicit
//      deselection AND a current-byte match against the PRIOR LEDGER HASH AND
//      exclusive recorded ownership, with declared removal semantics that permit
//      it. Every missing, conflicting, ambiguous, shared-incomplete, mismatching,
//      or non-reproducible proof class retains the artifact and grants no
//      deletion authority. Missing evidence never infers permission.
//
//   2. BOOTSTRAP NEVER DELETES IN THE SAME PLAN. Complete proof for a
//      missing-ledger artifact makes a bootstrap reviewable — it persists FUTURE
//      authority — but an artifact that is simultaneously bootstrappable and
//      deselected yields `bootstrap`, never `deletable`. Proving ownership now
//      does not license removing in the same breath.
//
//   3. UPGRADE IS HASH-GATED. A source-changed artifact advances only when the
//      current bytes still match the prior ledger hash. A locally edited file is
//      `divergent` and NOT fully upgraded — it is never silently overwritten.
//
//   4. OWNERLESS PAYLOADS FOLLOW THE SAME RULES. An empty recorded owner set is
//      incomplete ownership, not exclusive ownership, and grants nothing. There
//      is deliberately no special case that quietly confers authority on an
//      artifact nobody claims.
//
// There is no declaration order, registry order, first-writer preference, or
// model judgment anywhere in this module: the outcome is a function of the
// inputs alone, so permuting the facts cannot change it.

import type { PayloadSourceIdentity, PayloadTargetResolution } from "./payload-plan.js";
import type {
  ArtifactEvidence,
  ArtifactOwner,
  PayloadSemantics,
  PlanArtifactDecision,
  PlanArtifactPreview,
  PlanArtifactRetentionReason,
  PlanFinding,
} from "./types.js";

const SHA256_RE = /^[a-f0-9]{64}$/;

/** What one capability declaration would produce for a destination RIGHT NOW.
 *  Supplied only when the caller could reproduce it; `null` otherwise, which is
 *  itself a proof class (`not-reproducible` / `no-recorded-proof`). */
export interface PlanArtifactDeclaration extends PayloadSemantics {
  declaredSourceFingerprint: string;
  producedContentHash: string;
  owners: readonly ArtifactOwner[];
}

/** One managed artifact, with every filesystem question already answered. */
export interface PlanArtifactFact {
  /** The declared workspace-relative destination, verbatim. */
  destination: string;
  /** The no-create containment verdict, reused verbatim from WF-448. */
  target: PayloadTargetResolution;
  /** The ledger's recorded proof, or `null` when the ledger has no entry. */
  recorded: ArtifactEvidence | null;
  /** The bytes observed at the canonical target right now. */
  current: PayloadSourceIdentity;
  /** What the current declaration would produce, or `null` when unreproducible. */
  declared: PlanArtifactDeclaration | null;
  /** WHO declares this destination right now — every current declarer, verbatim
   *  and unfiltered. Deliberately SEPARATE from `declared`, which is a
   *  REPRODUCIBILITY channel and collapses to `null` on three distinct
   *  conditions (a source whose bytes could not be read, co-owners that disagree
   *  on bytes, co-owners that disagree on semantics). Reading ownership off that
   *  collapse would erase exactly the co-declarers most likely to be real, so
   *  the removal slice keys exclusivity on this channel instead. Empty means
   *  genuinely nothing declares it. */
  declaringOwners: readonly ArtifactOwner[];
  /** The owners this plan explicitly deregisters AND which do not survive it.
   *  Computed by the caller from the plan's own delta — never inferred here. */
  deselectedOwners: readonly ArtifactOwner[];
}

export interface PlanArtifactOptions {
  /** WF-446's `mayEstablishAbsence`. A bootstrap requires a trustworthy complete
   *  inventory: an unavailable, malformed, partial, or invalid one may not
   *  establish the absence a missing-ledger bootstrap reasons from. */
  inventoryTrustworthy: boolean;
}

export interface ArtifactPlanResult {
  preview: PlanArtifactPreview;
  /** Artifact findings, unsorted — the planner folds them into its own list and
   *  applies the one shared ordering. */
  findings: PlanFinding[];
}

/** A fresh empty preview. A factory rather than a shared constant so no two
 *  responses can ever alias the same collections. */
export function emptyArtifactPreview(): PlanArtifactPreview {
  return { deletable: [], retained: [], bootstrap: [], advance: [] };
}

/** True when the preview leaves the Node runner something to act on. A plan whose
 *  only artifact entries are retentions changes nothing. */
export function hasPreviewedArtifactEffect(preview: PlanArtifactPreview): boolean {
  return (
    preview.deletable.length > 0 || preview.bootstrap.length > 0 || preview.advance.length > 0
  );
}

/** A collision-free identity for one owner triple. `JSON.stringify` over the
 *  three fields is injective — its own quoting disambiguates a value that
 *  contains the delimiter — so no combination of plugin id, capability, and
 *  source can forge another triple's key. Deliberately NOT a raw control-byte
 *  separator: a literal control character in a source file makes that file
 *  "binary" to diff and search tooling, which silently hides it from review. */
function ownerKey(owner: ArtifactOwner): string {
  return JSON.stringify([owner.pluginId, owner.capability, owner.source]);
}

function sortOwners(owners: readonly ArtifactOwner[]): ArtifactOwner[] {
  return owners
    .map((owner) => ({
      pluginId: owner.pluginId,
      capability: owner.capability,
      source: owner.source,
    }))
    .sort(
      (left, right) =>
        left.pluginId.localeCompare(right.pluginId) ||
        left.capability.localeCompare(right.capability) ||
        left.source.localeCompare(right.source),
    );
}

function includesOwner(set: readonly ArtifactOwner[], owner: ArtifactOwner): boolean {
  const key = ownerKey(owner);
  return set.some((candidate) => ownerKey(candidate) === key);
}

/** The full semantic tuple, checked field by field against WF-444's closed
 *  vocabulary. A partial tuple proves nothing. */
function semanticsComplete(semantics: PayloadSemantics): boolean {
  return (
    semantics.production === "copy" &&
    (semantics.refresh === "replace-if-unmodified" || semantics.refresh === "retain") &&
    (semantics.removal === "delete-if-unmodified" || semantics.removal === "retain")
  );
}

function tupleOf(semantics: PayloadSemantics): PayloadSemantics {
  return {
    production: semantics.production,
    refresh: semantics.refresh,
    removal: semantics.removal,
  };
}

/** Classify exactly one managed artifact. Total: every path returns a decision,
 *  and every path but the single `deletable` one returns `deletionAuthority:
 *  false`. */
function classify(fact: PlanArtifactFact, inventoryTrustworthy: boolean): PlanArtifactDecision {
  const canonicalTarget = fact.target.ok ? fact.target.canonicalTarget : null;
  const currentContentHash = fact.current.ok ? fact.current.sha256 : null;
  const recorded: ArtifactEvidence | null = fact.recorded;
  const recordedOwners = recorded === null ? [] : sortOwners(recorded.owners);
  const recordedContentHash = recorded === null ? null : recorded.producedContentHash;
  const recordedSemantics = recorded === null ? null : tupleOf(recorded);
  // A byte "match" is evidence only when BOTH digests are well-formed. Two
  // matching malformed values (an empty string, a truncated digest) establish
  // nothing, and this module re-validates rather than trusting its inputs
  // structurally: it is the join a later apply path will trust, so it must not
  // inherit an unverified digest from a caller.
  const digestsWellFormed =
    recordedContentHash !== null &&
    currentContentHash !== null &&
    SHA256_RE.test(recordedContentHash) &&
    SHA256_RE.test(currentContentHash);
  const bytesMatchLedger =
    digestsWellFormed && currentContentHash === recordedContentHash;

  const retain = (
    reason: PlanArtifactRetentionReason,
    owners: ArtifactOwner[],
    semantics: PayloadSemantics | null,
  ): PlanArtifactDecision => ({
    destination: fact.destination,
    canonicalTarget,
    form: "retained",
    reason,
    owners,
    semantics,
    recordedContentHash,
    currentContentHash,
    bytesMatchLedger,
    deletionAuthority: false,
    fullyUpgraded: false,
    runnerCandidate: false,
    persisted: false,
  });

  // Rule 1 — an unsafe destination or unobservable bytes can prove nothing at
  // all, so neither can ever reach a removal or an upgrade decision.
  if (!fact.target.ok) return retain("destination-unsafe", recordedOwners, recordedSemantics);
  if (!fact.current.ok) {
    return retain("current-bytes-unreadable", recordedOwners, recordedSemantics);
  }

  // --- the missing-ledger BOOTSTRAP path -----------------------------------
  if (recorded === null) {
    const declared = fact.declared;
    const declaredOwners = declared === null ? [] : sortOwners(declared.owners);
    const declaredSemantics = declared === null ? null : tupleOf(declared);

    if (!inventoryTrustworthy) {
      return retain("inventory-untrustworthy", declaredOwners, declaredSemantics);
    }
    if (declared === null) return retain("no-recorded-proof", [], null);
    if (declaredOwners.length === 0) {
      // Rule 4 — an ownerless declaration proves no ownership to bootstrap.
      return retain("ownership-incomplete", declaredOwners, declaredSemantics);
    }
    if (!SHA256_RE.test(declared.declaredSourceFingerprint)) {
      return retain("source-fingerprint-missing", declaredOwners, declaredSemantics);
    }
    if (!semanticsComplete(declared)) {
      return retain("semantics-incomplete", declaredOwners, null);
    }
    if (
      !SHA256_RE.test(declared.producedContentHash) ||
      currentContentHash !== declared.producedContentHash
    ) {
      // The bytes on disk are not the bytes the declaration reproduces, so the
      // canonical destination's contents are not proven to be pack-managed.
      return retain("not-reproducible", declaredOwners, declaredSemantics);
    }

    // Complete proof. Rule 2: this records FUTURE authority and deletes nothing
    // now — even when every proven owner is also explicitly deselected.
    const alsoDeselected = declaredOwners.every((owner) =>
      includesOwner(fact.deselectedOwners, owner),
    );
    return {
      destination: fact.destination,
      canonicalTarget,
      form: "bootstrap",
      reason: alsoDeselected ? "bootstrap-defers-deletion" : "not-deselected",
      owners: declaredOwners,
      semantics: declaredSemantics,
      recordedContentHash: null,
      currentContentHash,
      bytesMatchLedger: false,
      deletionAuthority: false,
      fullyUpgraded: false,
      runnerCandidate: true,
      persisted: false,
    };
  }

  // --- recorded proof exists ----------------------------------------------
  // Rule 4 — ownerless is INCOMPLETE ownership, never exclusive ownership.
  if (recordedOwners.length === 0) {
    return retain("ownership-incomplete", recordedOwners, recordedSemantics);
  }

  // The destructive path is held to AT LEAST the strictness of the bootstrap
  // path, which already gates on digest well-formedness before trusting
  // reproduced bytes. Without this, two matching malformed digests would satisfy
  // the byte-match conjunct and grant removal authority over a file whose
  // identity was never established — deriving authority from ambiguous state.
  if (!digestsWellFormed) {
    return retain("digest-malformed", recordedOwners, recordedSemantics);
  }

  const deselectedCount = recordedOwners.filter((owner) =>
    includesOwner(fact.deselectedOwners, owner),
  ).length;

  if (deselectedCount === recordedOwners.length) {
    // Rule 1 — the conjunctive removal test. Exclusive deselection is proven;
    // the remaining conjuncts each have their own retention reason.
    if (!bytesMatchLedger) {
      return retain("current-bytes-mismatch", recordedOwners, recordedSemantics);
    }
    if (recorded.removal !== "delete-if-unmodified") {
      return retain("removal-semantics-retain", recordedOwners, recordedSemantics);
    }
    // THE RECORDED SET MAY BE INCOMPLETE (WF-476). Exclusive deselection is
    // proven against the LEDGER's owner set, and apply records that set from the
    // acted-on packs only — so a still-registered pack that was never selected
    // can declare this destination without ever being recorded against it. Its
    // absence from `recordedOwners` then reads as "not an owner" rather than
    // "owner we failed to record", and deselecting the one recorded owner would
    // delete an artifact the surviving co-declarer never agreed to remove.
    // Exclusivity is therefore re-derived against WHO DECLARES IT NOW.
    //
    // KEYED ON `declaringOwners`, NEVER ON `declared`. `declared` answers "what
    // would this declaration produce", and collapses to `null` whenever the
    // answer is not reproducible — including when co-owners DISAGREE, which is
    // the case a second owner is most likely to be present in. Reading ownership
    // off that collapse would fail OPEN in exactly the configuration this guard
    // exists for, and delete the file.
    //
    // AN OWNER THIS PLAN DESELECTS IS NOT A SURVIVING CLAIM. It is on its way
    // out, so requiring it to be recorded would let a pack block its own
    // removal — the retention direction is fail-safe, but this one would make
    // ordinary deregistration unreachable rather than merely conservative.
    const survivingUnrecorded = fact.declaringOwners.filter(
      (owner) =>
        !includesOwner(recordedOwners, owner) && !includesOwner(fact.deselectedOwners, owner),
    );
    if (survivingUnrecorded.length > 0) {
      // A DISTINCT token, not `shared-ownership`. That one means "a recorded
      // owner survives"; here none does — the block comes from a declarer the
      // ledger never recorded, which the decision's `owners` (the RECORDED set)
      // cannot name. Reusing it would leave a report that states a cause its own
      // owner list contradicts.
      return retain("unrecorded-declarer", recordedOwners, recordedSemantics);
    }
    return {
      destination: fact.destination,
      canonicalTarget,
      form: "deletable",
      reason: null,
      owners: recordedOwners,
      semantics: recordedSemantics,
      recordedContentHash,
      currentContentHash,
      bytesMatchLedger,
      deletionAuthority: true,
      fullyUpgraded: false,
      runnerCandidate: true,
      persisted: false,
    };
  }

  if (deselectedCount > 0) {
    // A recorded owner survives the plan: ownership is shared, not exclusive.
    return retain("shared-ownership", recordedOwners, recordedSemantics);
  }

  // --- nothing deselected: the UPGRADE path --------------------------------
  const declared = fact.declared;
  const sourceChanged =
    declared !== null &&
    declared.declaredSourceFingerprint !== recorded.declaredSourceFingerprint;

  if (!sourceChanged) {
    return retain(
      bytesMatchLedger ? "not-deselected" : "current-bytes-mismatch",
      recordedOwners,
      recordedSemantics,
    );
  }

  // Rule 3 — hash-gated advance. An edited file stays divergent rather than
  // being overwritten by the newer source.
  if (!bytesMatchLedger) return retain("divergent", recordedOwners, recordedSemantics);
  if (recorded.refresh !== "replace-if-unmodified") {
    return retain("refresh-semantics-retain", recordedOwners, recordedSemantics);
  }

  return {
    destination: fact.destination,
    canonicalTarget,
    form: "advance",
    reason: "not-deselected",
    owners: recordedOwners,
    semantics: recordedSemantics,
    recordedContentHash,
    currentContentHash,
    bytesMatchLedger,
    deletionAuthority: false,
    fullyUpgraded: true,
    runnerCandidate: true,
    persisted: false,
  };
}

function findingFor(decision: PlanArtifactDecision): PlanFinding {
  const pluginId = decision.owners.length > 0 ? decision.owners[0].pluginId : null;
  if (decision.form === "deletable") {
    return {
      code: "plan/artifact-deletable",
      severity: "warning",
      pluginId,
      message: `managed artifact \`${decision.destination}\` is eligible for removal: every recorded owner is explicitly deselected, the current bytes match the recorded hash, and the declared removal semantics permit it.`,
    };
  }
  if (decision.form === "bootstrap") {
    return {
      code: "plan/artifact-bootstrap-previewed",
      severity: "info",
      pluginId,
      message: `managed artifact \`${decision.destination}\` has no recorded lifecycle evidence; complete observed proof makes a bootstrap reviewable. It records future authority and grants no deletion in this plan.`,
    };
  }
  if (decision.form === "advance") {
    return {
      code: "plan/artifact-advance",
      severity: "info",
      pluginId,
      message: `managed artifact \`${decision.destination}\` advances: its declared source changed and the current bytes still match the prior ledger hash.`,
    };
  }
  if (decision.reason === "divergent") {
    return {
      code: "plan/artifact-divergent",
      severity: "warning",
      pluginId,
      message: `managed artifact \`${decision.destination}\` is divergent: its declared source changed but the current bytes do not match the prior ledger hash, so it is retained and not fully upgraded.`,
    };
  }
  return {
    code: "plan/artifact-retained",
    severity: "info",
    pluginId,
    message: `managed artifact \`${decision.destination}\` is retained (\`${decision.reason}\`); it grants no deletion authority.`,
  };
}

/**
 * Plan the previewed removal/upgrade effect over one set of managed artifacts.
 *
 * Pure: identical facts always produce deep-equal output, in any input order,
 * and no input object is mutated.
 */
export function planArtifacts(
  facts: readonly PlanArtifactFact[],
  options: PlanArtifactOptions,
): ArtifactPlanResult {
  const preview = emptyArtifactPreview();
  const findings: PlanFinding[] = [];

  for (const fact of facts) {
    const decision = classify(fact, options.inventoryTrustworthy);
    findings.push(findingFor(decision));
    if (decision.form === "deletable") preview.deletable.push(decision);
    else if (decision.form === "bootstrap") preview.bootstrap.push(decision);
    else if (decision.form === "advance") preview.advance.push(decision);
    else preview.retained.push(decision);
  }

  const byDestination = (left: PlanArtifactDecision, right: PlanArtifactDecision): number =>
    left.destination.localeCompare(right.destination);

  preview.deletable.sort(byDestination);
  preview.bootstrap.sort(byDestination);
  preview.advance.sort(byDestination);
  preview.retained.sort(
    (left, right) =>
      byDestination(left, right) || (left.reason ?? "").localeCompare(right.reason ?? ""),
  );

  return { preview, findings };
}
