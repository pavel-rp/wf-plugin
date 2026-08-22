// wf resolver — the pure whole-plan removal / bootstrap gate (WF-458).
//
// The DECISION half of the destructive slice of the sole public mutator. Held to
// exactly the discipline `apply-install.ts` and `apply-targets.ts` hold:
// deterministic, body-free, and side-effect-free. Nothing here opens a file,
// canonicalizes a path, reads a ledger, takes a lock, or writes a byte. The
// caller answers every filesystem question under the lock and hands the ANSWERS
// in, which is what keeps "every refusal happens before a journal, a backup, or a
// byte" provable with no filesystem at all.
//
// THIS IS THE FIRST GATE IN THE RUNTIME WHOSE `ok` OUTCOME AUTHORIZES DELETING A
// USER'S FILE. Every rule below is therefore written as a PRESERVATION rule that
// happens to permit one narrow deletion — never as a deletion feature with
// exceptions.
//
// SIX RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. IT IS A WHOLE-PLAN GATE, NOT A PER-ACTION LOOP. Every check below runs
//      over the COMPLETE approved action set before a single target is composed,
//      and any failure rejects the WHOLE plan. A per-action loop with early
//      returns would already have deleted the files it walked past, and "a single
//      stale precondition invalidates everything" would degrade into "a stale
//      precondition invalidates its own action". The mutator is reachable only
//      through an `ok` outcome here — the WF-454 structure, inherited verbatim.
//
//   2. DELETION REQUIRES POSITIVE PROOF; THE ABSENCE OF PROOF PRESERVES. The one
//      deletion class is `listed, hash-proven, exclusively owned`. The six
//      preservation classes — retained, unlisted, shared, edited, ambiguous,
//      unverifiable — are each NAMED and partitioned explicitly below rather than
//      left to fall through a default arm. A file we cannot reason about
//      confidently is a file we do not touch, and an unnamed class is a class
//      nobody tested.
//
//   3. THE DESTRUCTIVE PATH IS NEVER LESS STRICT THAN THE PRESERVING OR
//      BOOTSTRAPPING PATH. WF-449 shipped a HIGH defect of exactly this shape:
//      bootstrap gated reproduced bytes on SHA-256 well-formedness while the
//      deletion path compared digests as bare strings, so two matching MALFORMED
//      values granted authority over a file whose identity had never been
//      established. Every proof this gate requires of a deletion is therefore at
//      least what `planArtifacts` requires of the corresponding retention or
//      bootstrap — and the gate re-derives the classification from current facts
//      rather than trusting the approved preview's booleans.
//
//   4. BOOTSTRAP AND DELETION MAY NEVER TOUCH THE SAME ARTIFACT IN ONE PLAN.
//      Reconstructing ownership evidence never doubles as authority to act on it.
//      Enforced as an EXPLICIT whole-plan check with its own closed reason token,
//      checked FIRST, rather than as an emergent property of `planArtifacts`
//      returning `bootstrap` before `deletable` — an emergent guarantee is one
//      refactor away from being no guarantee.
//
//   5. ONE CONFIRMATION AUTHORIZES ONLY THE EXACT LISTED ACTIONS. The approved
//      plan is an exact manifest, not a category of permission. A destination
//      that has BECOME deletable since the plan was approved but which the plan
//      does not list is simply not authorized — it is the `unlisted` preservation
//      class, and it is preserved however obviously the deselection implies it.
//
//   6. A LEGACY BOOTSTRAP SEEDS ONLY FROM COMPLETE, FRESH PROOF, AND A REJECTION
//      LEAVES THE REGISTRATION EXACTLY AS IT WAS. A partially-seeded portable
//      tuple is strictly worse than none, because it LOOKS authoritative. So the
//      tuple is admitted whole or not at all, and a rejection composes no target
//      for the pack at all rather than a smaller one.

import { planArtifacts, type PlanArtifactFact } from "./artifact-plan.js";
import type {
  ApplyReason,
  ArtifactOwner,
  PayloadSemantics,
  PlanAction,
  PlanArtifactDecision,
  PlanArtifactPreview,
  PlanEvidenceSeed,
  PortablePackEvidence,
} from "./types.js";

const SHA256_RE = /^[a-f0-9]{64}$/;

/** The six preservation classes, named. A reader may switch on this
 *  exhaustively, and every managed artifact this plan does NOT delete carries
 *  exactly one — so a preservation always states which rule preserved it. */
export type PreservationClass =
  /** The plan itself classified the artifact as retained. */
  | "retained"
  /** The approved plan names no action for this destination at all (rule 5). */
  | "unlisted"
  /** A recorded owner survives the plan — ownership is not exclusive. */
  | "shared"
  /** Current bytes differ from the prior ledger hash — the file was edited. */
  | "edited"
  /** Ownership or a digest is present but not trustworthy enough to reason from. */
  | "ambiguous"
  /** The bytes or the destination could not be established at all. */
  | "unverifiable";

/** Map one retention reason to its named preservation class.
 *
 *  An EXHAUSTIVE switch with no default arm that guesses: a retention reason this
 *  release does not know must be a compile-visible edit here, not a silent
 *  inheritance of whichever class happened to be last. The `default` returns
 *  `unverifiable` — the most conservative class — so even an unreachable future
 *  token preserves rather than deletes. */
export function preservationClassFor(
  reason: PlanArtifactDecision["reason"],
): PreservationClass {
  switch (reason) {
    case "not-deselected":
      return "retained";
    case "shared-ownership":
      return "shared";
    case "current-bytes-mismatch":
    case "divergent":
      return "edited";
    case "ownership-incomplete":
    case "digest-malformed":
    case "bootstrap-defers-deletion":
    case "removal-semantics-retain":
    case "refresh-semantics-retain":
    case "semantics-incomplete":
    case "source-fingerprint-missing":
      return "ambiguous";
    case "current-bytes-unreadable":
    case "destination-unsafe":
    case "no-recorded-proof":
    case "inventory-untrustworthy":
    case "not-reproducible":
      return "unverifiable";
    default:
      return "unverifiable";
  }
}

/** One preserved artifact, with the class that preserved it. */
export interface PreservedArtifact {
  destination: string;
  class: PreservationClass;
  /** The retention reason, or `null` for the `unlisted` class (which has no
   *  retention reason — the plan simply says nothing about the destination). */
  reason: PlanArtifactDecision["reason"];
}

/** One legacy-bootstrap seed the caller re-observed under the lock. */
export interface LegacySeedFact {
  pluginId: string;
  /** The portable evidence observable RIGHT NOW, or `null` when the caller could
   *  not reproduce complete proof — itself a rejection class. */
  observed: PortablePackEvidence | null;
  /** `true` when the pack still has NO recorded portable evidence. A pack that
   *  acquired one since the plan was approved is stale, and seeding over it would
   *  broaden authority the confirmation never granted. */
  portableAbsent: boolean;
}

export interface RemovalGateInput {
  /** The approved plan's artifact preview, as the confirmation captured it. */
  approved: PlanArtifactPreview;
  /** The mutating actions the action screen admitted, in the plan's own order. */
  supported: readonly PlanAction[];
  /** Every managed artifact's facts, re-observed by the caller UNDER THE LOCK. */
  currentFacts: readonly PlanArtifactFact[];
  /** WF-446's `mayEstablishAbsence`, re-derived under the lock. */
  inventoryTrustworthy: boolean;
  /** The plan's own evidence seeds, filtered to the legacy-bootstrap kind. */
  legacySeeds: readonly PlanEvidenceSeed[];
  /** The caller's re-observation of each legacy seed, keyed by pack. */
  legacyFacts: readonly LegacySeedFact[];
}

/** One authorized removal. Reached only through the `ok` outcome. */
export interface AuthorizedRemoval {
  destination: string;
  canonicalTarget: string;
  /** The recorded owner set the deletion was proven exclusive over. */
  owners: ArtifactOwner[];
  /** The digest both the ledger and the current bytes agree on. */
  contentHash: string;
}

/** One authorized ownership bootstrap. Records future authority and nothing else. */
export interface AuthorizedBootstrap {
  destination: string;
  canonicalTarget: string;
  owners: ArtifactOwner[];
  semantics: PayloadSemantics;
  declaredSourceFingerprint: string;
  producedContentHash: string;
}

/** One authorized legacy portable seed. */
export interface AuthorizedLegacySeed {
  pluginId: string;
  portable: PortablePackEvidence;
}

export type RemovalGateDecision =
  | {
      ok: true;
      removals: AuthorizedRemoval[];
      bootstraps: AuthorizedBootstrap[];
      legacy: AuthorizedLegacySeed[];
      preserved: PreservedArtifact[];
    }
  | { ok: false; reason: ApplyReason; detail: string };

function sameOwners(left: readonly ArtifactOwner[], right: readonly ArtifactOwner[]): boolean {
  if (left.length !== right.length) return false;
  const key = (owner: ArtifactOwner): string =>
    // `JSON.stringify` over the triple is injective — its own quoting
    // disambiguates a value containing the delimiter — so no combination can
    // forge another triple's key. Deliberately NOT a raw control-byte separator:
    // a literal control character makes a source file "binary" to diff and search
    // tooling and hides it from review (the WF-449 near-miss).
    JSON.stringify([owner.pluginId, owner.capability, owner.source]);
  const leftKeys = left.map(key).sort();
  const rightKeys = right.map(key).sort();
  return leftKeys.every((value, index) => value === rightKeys[index]);
}

function sameSemantics(
  left: PayloadSemantics | null,
  right: PayloadSemantics | null,
): boolean {
  if (left === null || right === null) return left === right;
  return (
    left.production === right.production &&
    left.refresh === right.refresh &&
    left.removal === right.removal
  );
}

/** Whether two decisions describe the same artifact fact-for-fact.
 *
 *  Compares the DECISION and the facts it was derived from, on independent axes,
 *  because bytes and semantics are independent questions (WF-448's rule) and an
 *  owner set that moved while the digest held is exactly the drift that would
 *  license a deletion the surviving owner never agreed to. */
function sameDecision(left: PlanArtifactDecision, right: PlanArtifactDecision): boolean {
  return (
    left.destination === right.destination &&
    left.canonicalTarget === right.canonicalTarget &&
    left.form === right.form &&
    left.reason === right.reason &&
    left.recordedContentHash === right.recordedContentHash &&
    left.currentContentHash === right.currentContentHash &&
    left.bytesMatchLedger === right.bytesMatchLedger &&
    left.deletionAuthority === right.deletionAuthority &&
    sameOwners(left.owners, right.owners) &&
    sameSemantics(left.semantics, right.semantics)
  );
}

function indexPreview(preview: PlanArtifactPreview): Map<string, PlanArtifactDecision> {
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

function samePortable(left: PortablePackEvidence, right: PortablePackEvidence): boolean {
  const sameHashes = (
    a: PortablePackEvidence["manifestHashes"],
    b: PortablePackEvidence["manifestHashes"],
  ): boolean => {
    if (a.length !== b.length) return false;
    const key = (row: { path: string; sha256: string }): string =>
      JSON.stringify([row.path, row.sha256]);
    const aKeys = a.map(key).sort();
    const bKeys = b.map(key).sort();
    return aKeys.every((value, index) => value === bKeys[index]);
  };
  const leftCapabilities = [...left.capabilities].sort();
  const rightCapabilities = [...right.capabilities].sort();
  return (
    left.pluginId === right.pluginId &&
    left.version === right.version &&
    leftCapabilities.length === rightCapabilities.length &&
    leftCapabilities.every((value, index) => value === rightCapabilities[index]) &&
    sameHashes(left.manifestHashes, right.manifestHashes) &&
    sameHashes(left.declaredSourceHashes, right.declaredSourceHashes)
  );
}

/** A portable tuple is COMPLETE only when every field it will be trusted for is
 *  present and well-formed. A partial tuple proves nothing and, once recorded,
 *  looks authoritative — which is why it is refused rather than trimmed. */
function portableComplete(portable: PortablePackEvidence): boolean {
  if (portable.pluginId.length === 0 || portable.version.length === 0) return false;
  if (portable.capabilities.length === 0) return false;
  if (portable.manifestHashes.length === 0) return false;
  const wellFormed = (rows: PortablePackEvidence["manifestHashes"]): boolean =>
    rows.every((row) => row.path.length > 0 && SHA256_RE.test(row.sha256));
  return wellFormed(portable.manifestHashes) && wellFormed(portable.declaredSourceHashes);
}

/**
 * Decide whether an approved plan's removal, bootstrap and legacy-seed actions
 * may be executed AT ALL — over the whole plan, before any target is composed.
 *
 * FIRST MATCH WINS, MOST FUNDAMENTAL FIRST, and every failure rejects the WHOLE
 * plan. The order is the contract: an internally incoherent plan (rule 4) is
 * refused before any world-state comparison, because a plan that contradicts
 * itself says nothing reliable about the world either.
 */
export function decideRemovalGate(input: RemovalGateInput): RemovalGateDecision {
  const deleteActions = input.supported.filter((action) => action.kind === "artifact-delete");
  const bootstrapActions = input.supported.filter(
    (action) => action.kind === "artifact-bootstrap",
  );

  // --- rule 4: internal coherence, checked FIRST ----------------------------
  const bootstrapDestinations = new Set(
    bootstrapActions.map((action) => action.destination).filter((d): d is string => d !== null),
  );
  const conflicting = deleteActions
    .map((action) => action.destination)
    .filter((d): d is string => d !== null && bootstrapDestinations.has(d))
    .sort();
  if (conflicting.length > 0) {
    return {
      ok: false,
      reason: "apply/bootstrap-delete-conflict",
      detail: `destination(s) ${conflicting
        .map((d) => `\`${d}\``)
        .join(", ")} carry both an ownership bootstrap and a deletion in one plan. Reconstructing evidence never doubles as authority to act on it, so the whole plan is refused before any journal, backup, or mutation.`,
    };
  }

  // A destination may not be named twice by the same kind either: two deletions
  // of one path would journal two prior states for one file, and two bootstraps
  // would record two owner sets whose order decided the winner.
  for (const [label, actions] of [
    ["deletion", deleteActions],
    ["ownership bootstrap", bootstrapActions],
  ] as const) {
    const seen = new Set<string>();
    for (const action of actions) {
      if (action.destination === null) {
        return {
          ok: false,
          reason: "apply/artifact-precondition",
          detail: `an \`${action.kind}\` action names no destination, so the artifact it would act on cannot be resolved; the whole plan is refused and nothing was written.`,
        };
      }
      if (seen.has(action.destination)) {
        return {
          ok: false,
          reason: "apply/artifact-precondition",
          detail: `destination \`${action.destination}\` is named by more than one ${label} in one plan; the whole plan is refused and nothing was written.`,
        };
      }
      seen.add(action.destination);
    }
  }

  // --- rules 1 + 3: re-derive the classification from CURRENT facts ---------
  //
  // Re-derived, never trusted. The approved preview's `deletionAuthority: true`
  // is an assertion the confirmation captured; this is the same function
  // recomputed against the world as it is now, which is the only thing that can
  // detect a world that moved. It also inherits `planArtifacts`' digest
  // well-formedness conjunct wholesale, so the destructive path here cannot be
  // laxer than the bootstrap path there.
  const recomputed = planArtifacts(input.currentFacts, {
    inventoryTrustworthy: input.inventoryTrustworthy,
  }).preview;
  const currentIndex = indexPreview(recomputed);
  const approvedIndex = indexPreview(input.approved);

  // Every destination the approved plan reasoned about must still exist as a
  // fact, and must still classify identically. A destination that vanished from
  // the fact set is as much a moved precondition as one that changed.
  for (const [destination, approvedDecision] of approvedIndex) {
    const currentDecision = currentIndex.get(destination);
    if (currentDecision === undefined) {
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail: `the approved plan reasoned about managed artifact \`${destination}\`, which is no longer a managed artifact of this workspace; the whole plan is refused before any journal, backup, or mutation.`,
      };
    }
    if (!sameDecision(approvedDecision, currentDecision)) {
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail: `managed artifact \`${destination}\` no longer classifies as the approved plan recorded it (approved \`${approvedDecision.form}\`/\`${String(approvedDecision.reason)}\`, now \`${currentDecision.form}\`/\`${String(currentDecision.reason)}\`); a single changed precondition rejects the WHOLE plan, so nothing was written and nothing was removed.`,
      };
    }
  }

  // --- rules 2 + 5: authorize the exact listed actions, and nothing else ----
  const removals: AuthorizedRemoval[] = [];
  for (const action of deleteActions) {
    const destination = action.destination as string;
    const decision = currentIndex.get(destination);
    if (
      decision === undefined ||
      decision.form !== "deletable" ||
      decision.deletionAuthority !== true ||
      decision.canonicalTarget === null ||
      decision.recordedContentHash === null ||
      decision.currentContentHash === null ||
      !SHA256_RE.test(decision.recordedContentHash) ||
      !SHA256_RE.test(decision.currentContentHash) ||
      decision.recordedContentHash !== decision.currentContentHash ||
      decision.owners.length === 0 ||
      decision.semantics === null ||
      decision.semantics.removal !== "delete-if-unmodified"
    ) {
      // Every conjunct restated at the point of authorization rather than
      // inherited from `planArtifacts`. Duplicating the test is deliberate: this
      // is the last line before a file is destroyed, and a proof that is only
      // asserted somewhere else is a proof one refactor can delete.
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail: `managed artifact \`${destination}\` is listed for deletion but does not currently satisfy every removal conjunct (listed, hash-proven with well-formed matching digests, exclusively owned, and \`removal: delete-if-unmodified\`); the whole plan is refused and nothing was removed.`,
      };
    }
    removals.push({
      destination,
      canonicalTarget: decision.canonicalTarget,
      owners: decision.owners,
      contentHash: decision.currentContentHash,
    });
  }

  const bootstraps: AuthorizedBootstrap[] = [];
  for (const action of bootstrapActions) {
    const destination = action.destination as string;
    const decision = currentIndex.get(destination);
    const fact = input.currentFacts.find((candidate) => candidate.destination === destination);
    if (
      decision === undefined ||
      decision.form !== "bootstrap" ||
      decision.canonicalTarget === null ||
      decision.semantics === null ||
      decision.owners.length === 0 ||
      decision.currentContentHash === null ||
      !SHA256_RE.test(decision.currentContentHash) ||
      fact === undefined ||
      fact.declared === null ||
      !SHA256_RE.test(fact.declared.declaredSourceFingerprint)
    ) {
      return {
        ok: false,
        reason: "apply/artifact-precondition",
        detail: `managed artifact \`${destination}\` is listed for an ownership bootstrap but no longer carries the complete observed proof a bootstrap requires; the whole plan is refused and nothing was written.`,
      };
    }
    // Rule 4 again, now as a POST-condition of the classification rather than of
    // the action list: `planArtifacts` yields `bootstrap` even when every proven
    // owner is also deselected, precisely so that proving ownership never
    // licenses removing in the same breath. Asserted here so the property is
    // checked rather than assumed.
    if (decision.deletionAuthority !== false) {
      return {
        ok: false,
        reason: "apply/bootstrap-delete-conflict",
        detail: `managed artifact \`${destination}\` would be bootstrapped and would also carry deletion authority; a bootstrap grants no deletion in the same plan, so the whole plan is refused.`,
      };
    }
    bootstraps.push({
      destination,
      canonicalTarget: decision.canonicalTarget,
      owners: decision.owners,
      semantics: decision.semantics,
      declaredSourceFingerprint: fact.declared.declaredSourceFingerprint,
      producedContentHash: decision.currentContentHash,
    });
  }

  // --- rule 6: the legacy portable seed ------------------------------------
  const legacy: AuthorizedLegacySeed[] = [];
  for (const seed of input.legacySeeds) {
    const fact = input.legacyFacts.find((candidate) => candidate.pluginId === seed.pluginId);
    if (fact === undefined || fact.observed === null) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `pack \`${seed.pluginId}\` is listed for a legacy portable bootstrap but complete observed proof could not be reproduced under the lock; the registration is preserved exactly as it was and no partial tuple was recorded.`,
      };
    }
    if (!fact.portableAbsent) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `pack \`${seed.pluginId}\` acquired recorded portable evidence since the plan was approved, so the approved legacy bootstrap is stale; apply never broadens stale authority, and the existing registration is preserved untouched.`,
      };
    }
    if (seed.portable === null || !portableComplete(fact.observed)) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `the observed portable tuple for pack \`${seed.pluginId}\` is incomplete, so it is recorded whole or not at all; the registration is preserved exactly as it was.`,
      };
    }
    if (!samePortable(seed.portable, fact.observed)) {
      return {
        ok: false,
        reason: "apply/evidence-precondition",
        detail: `the portable tuple observed for pack \`${seed.pluginId}\` under the lock is not EXACTLY the tuple the approved plan recorded; the registration is preserved exactly as it was and nothing was written.`,
      };
    }
    legacy.push({ pluginId: seed.pluginId, portable: fact.observed });
  }

  // --- the six preservation classes, partitioned explicitly ----------------
  const listed = new Set<string>([
    ...removals.map((removal) => removal.destination),
    ...bootstraps.map((bootstrap) => bootstrap.destination),
  ]);
  const preserved: PreservedArtifact[] = [];
  for (const decision of currentIndex.values()) {
    if (listed.has(decision.destination)) continue;
    if (decision.form === "deletable") {
      // Rule 5. Deletable NOW, but the confirmation does not list it — so it is
      // not authorized, however obviously the deselection implies it.
      preserved.push({ destination: decision.destination, class: "unlisted", reason: null });
      continue;
    }
    if (decision.form === "bootstrap" || decision.form === "advance") {
      // Not a removal candidate at all, and not listed for action here. An
      // `advance` in particular is an UPGRADE, which this mutator does not
      // perform (SC-5) — it reaches this gate only as something to preserve.
      preserved.push({
        destination: decision.destination,
        class: "unlisted",
        reason: decision.reason,
      });
      continue;
    }
    preserved.push({
      destination: decision.destination,
      class: preservationClassFor(decision.reason),
      reason: decision.reason,
    });
  }
  preserved.sort((left, right) => left.destination.localeCompare(right.destination));

  return { ok: true, removals, bootstraps, legacy, preserved };
}
