// wf resolver — the pure payload safety + co-ownership join (WF-448).
//
// Deterministic, body-free, and side-effect-free. Nothing here opens a file,
// canonicalizes a path, or writes a byte: the caller answers every filesystem
// question and hands the ANSWERS in. That is what keeps the release's
// BYTE-INERT guarantee assertable across the payload slice too — a preview that
// cannot touch the filesystem cannot create the target it is previewing, and in
// particular the no-create safety check is structurally incapable of
// materializing the path it tests.
//
// TWO RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. AN UNSAFE TARGET OR AN UNREADABLE SOURCE NEVER BECOMES AN ACTION. A
//      refused destination is reported as a refusal, and a source with no
//      fingerprint is reported as unreadable. Neither is ever emitted as an
//      action carrying a guessed target or a fabricated digest, because a
//      reviewer confirming a plan must never be shown a write that was invented
//      rather than observed.
//
//   2. CO-OWNERSHIP IS EXACT-EQUALITY-ONLY. Two capabilities may share one
//      canonical target if and only if their produced bytes are identical (same
//      digest AND same length) and their generation, refresh, and removal
//      semantics are field-for-field equal. Every softer arbitration is banned
//      by construction, not by convention: no declaration order, registry order,
//      first-writer preference, or model judgment reaches this function at all.
//      The two axes are tested INDEPENDENTLY so a collision that differs on both
//      reports both.

import type {
  PayloadSemantics,
  PlanFinding,
  PlanPayloadAction,
  PlanPayloadConflict,
  PlanPayloadOwner,
  PlanPayloadPreview,
  PlanPayloadRejectedTarget,
  PlanPayloadRejection,
} from "./types.js";

/** The caller's verdict on one destination. `exists` describes the canonical
 *  target itself and decides `create` vs `overwrite`; it is never a licence to
 *  write. */
export type PayloadTargetResolution =
  | { ok: true; canonicalTarget: string; exists: boolean }
  | { ok: false; rejection: PlanPayloadRejection };

/** The caller's fingerprint of one declared source. `status` carries the
 *  contained-read outcome verbatim when the bytes could not be observed. */
export type PayloadSourceIdentity =
  | { ok: true; sha256: string; bytes: number }
  | { ok: false; status: string };

/** One declared payload row, with every filesystem question already answered. */
export interface PlanPayloadFact {
  pluginId: string;
  capability: string;
  source: string;
  /** The declared workspace-relative destination, verbatim. */
  destination: string;
  semantics: PayloadSemantics;
  target: PayloadTargetResolution;
  identity: PayloadSourceIdentity;
}

export interface PayloadPlanResult {
  preview: PlanPayloadPreview;
  /** Payload findings, unsorted — the planner folds them into its own list and
   *  applies the one shared ordering. */
  findings: PlanFinding[];
}

/** A fresh empty preview. A factory rather than a shared constant so no two
 *  responses can ever alias the same collections. */
export function emptyPayloadPreview(): PlanPayloadPreview {
  return { actions: [], rejected: [], conflicts: [] };
}

/** Human-readable text for each closed rejection token. */
const REJECTION_DETAIL: Record<PlanPayloadRejection, string> = {
  traversal: "contains a `..` segment",
  absolute: "is an absolute or drive-prefixed path",
  malformed: "is not a well-formed forward-slash workspace-relative path",
  "symlink-escape": "resolves through a symlink that leaves the workspace root",
  "out-of-workspace": "canonicalizes outside the admitted workspace root",
  "target-not-a-file": "already exists and is not a regular file",
  unresolvable: "could not be canonicalized, so containment could not be established",
};

function ownerOf(fact: PlanPayloadFact): PlanPayloadOwner {
  return { pluginId: fact.pluginId, capability: fact.capability, source: fact.source };
}

function compareOwners(left: PlanPayloadOwner, right: PlanPayloadOwner): number {
  return (
    left.pluginId.localeCompare(right.pluginId) ||
    left.capability.localeCompare(right.capability) ||
    left.source.localeCompare(right.source)
  );
}

function ownerLabel(owner: PlanPayloadOwner): string {
  return `\`${owner.pluginId}\`/\`${owner.capability}\``;
}

function semanticsEqual(left: PayloadSemantics, right: PayloadSemantics): boolean {
  return (
    left.production === right.production &&
    left.refresh === right.refresh &&
    left.removal === right.removal
  );
}

/**
 * Plan the previewed payload effect of one set of declared rows.
 *
 * Pure: identical facts always produce deep-equal output, in any input order,
 * and no input object is mutated.
 */
export function planPayloads(facts: readonly PlanPayloadFact[]): PayloadPlanResult {
  const findings: PlanFinding[] = [];
  const rejected: PlanPayloadRejectedTarget[] = [];
  const conflicts: PlanPayloadConflict[] = [];
  const actions: PlanPayloadAction[] = [];

  // Group by canonical target. Sorting the members inside each group is what
  // makes the outcome independent of the order the caller collected the rows in.
  const groups = new Map<string, PlanPayloadFact[]>();

  for (const fact of facts) {
    if (!fact.target.ok) {
      const rejection = fact.target.rejection;
      rejected.push({
        pluginId: fact.pluginId,
        capability: fact.capability,
        destination: fact.destination,
        rejection,
      });
      findings.push({
        code: "plan/payload-unsafe-target",
        severity: "error",
        pluginId: fact.pluginId,
        message: `capability \`${fact.capability}\` declares payload destination \`${fact.destination}\`, which ${REJECTION_DETAIL[rejection]}; the plan is not applicable and nothing was created while checking.`,
      });
      continue;
    }

    if (!fact.identity.ok) {
      findings.push({
        code: "plan/payload-source-unreadable",
        severity: "error",
        pluginId: fact.pluginId,
        message: `capability \`${fact.capability}\` declares payload source \`${fact.source}\`, whose bytes could not be observed (\`${fact.identity.status}\`); no target write can be previewed for it.`,
      });
      continue;
    }

    const existing = groups.get(fact.target.canonicalTarget);
    if (existing === undefined) groups.set(fact.target.canonicalTarget, [fact]);
    else existing.push(fact);
  }

  for (const canonicalTarget of [...groups.keys()].sort((left, right) =>
    left.localeCompare(right),
  )) {
    const members = [...(groups.get(canonicalTarget) as PlanPayloadFact[])].sort(
      (left, right) => compareOwners(ownerOf(left), ownerOf(right)),
    );
    const owners = members.map(ownerOf);
    const first = members[0];
    // Two owners may reach one canonical target through different declared
    // spellings; the smallest is reported so the record stays order-independent.
    const destination = [...members]
      .map((member) => member.destination)
      .sort((left, right) => left.localeCompare(right))[0];

    // The two axes are independent tests, deliberately not short-circuited.
    const bytesEqual = members.every(
      (member) =>
        member.identity.ok &&
        first.identity.ok &&
        member.identity.sha256 === first.identity.sha256 &&
        member.identity.bytes === first.identity.bytes,
    );
    const tupleEqual = members.every((member) => semanticsEqual(member.semantics, first.semantics));

    if (bytesEqual && tupleEqual) {
      if (!first.identity.ok || !first.target.ok) continue; // unreachable; narrows the union
      actions.push({
        destination,
        canonicalTarget,
        identity: { sha256: first.identity.sha256, bytes: first.identity.bytes },
        semantics: {
          production: first.semantics.production,
          refresh: first.semantics.refresh,
          removal: first.semantics.removal,
        },
        owners,
        write: first.target.exists ? "overwrite" : "create",
      });
      continue;
    }

    const named = owners.map(ownerLabel).join(", ");
    if (!bytesEqual) {
      conflicts.push({ canonicalTarget, destination, kind: "bytes", owners });
      findings.push({
        code: "plan/payload-conflict-bytes",
        severity: "error",
        pluginId: first.pluginId,
        message: `payload target \`${canonicalTarget}\` is claimed by ${named}, which would not produce byte-identical output; co-ownership is accepted only for identical bytes, so the plan is not applicable.`,
      });
    }
    if (!tupleEqual) {
      conflicts.push({ canonicalTarget, destination, kind: "semantics", owners });
      findings.push({
        code: "plan/payload-conflict-semantics",
        severity: "error",
        pluginId: first.pluginId,
        message: `payload target \`${canonicalTarget}\` is claimed by ${named}, whose generation, refresh, and removal semantics are not field-for-field equal; co-ownership is accepted only for identical semantics, so the plan is not applicable.`,
      });
    }
  }

  rejected.sort(
    (left, right) =>
      left.pluginId.localeCompare(right.pluginId) ||
      left.capability.localeCompare(right.capability) ||
      left.destination.localeCompare(right.destination) ||
      left.rejection.localeCompare(right.rejection),
  );
  conflicts.sort(
    (left, right) =>
      left.canonicalTarget.localeCompare(right.canonicalTarget) ||
      left.kind.localeCompare(right.kind),
  );

  return { preview: { actions, rejected, conflicts }, findings };
}
