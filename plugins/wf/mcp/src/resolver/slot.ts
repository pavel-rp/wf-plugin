// wf resolver — per-skill slot composition (WF-327, C014 SUB-4).
//
// A `slot` contribution (WF-323) targets a per-skill composition POINT
// (`<skill>.<point>`, e.g. `ship.review`) rather than an SDD phase, with a
// declared merge policy — `replace` (single owner) or `append` (list-like). A
// skill body places the point with a `<!-- wf:slot … -->` marker pair (WF-326)
// carrying the inline-default region. This module linearizes every contribution
// to a point under a fixed precedence and yields exactly ONE composed body, so
// execution reaching a slot marker obtains the winning fragment with no model
// arbitration between competing fragments.
//
// Precedence is an ORDERED TIER CHAIN, not a set of hardcoded pairwise rules:
//   personal `_local/` override  (rank 30, highest)
//   > pack contribution          (rank 10)
//   > inline default             (in the SKILL.md body; NOT served here)
// A future tier (C020's committed tier) inserts between local override and pack
// contribution at a rank strictly between 10 and 30 with NO contract change and
// NO change to existing contributions/overrides or their files (proven by the
// tier-insertion test). The inline default is never read by the resolver
// (`resolve_content` refuses skill-body reads): the resolver serves only the
// pack/override contributions, and the body's inline-default region is what runs
// when the slot is UNFILLED (a typed "unfilled" outcome directs the caller there)
// or, for `append`, first — before the served composition — per the WF-326 marker
// rule ("an append fill runs after the default").
//
// Merge semantics (recorded in capability-registry.contract.md so the marker and
// the resolver agree):
//   - `replace` : the single highest-precedence present contribution is served;
//                 the inline default is SUPERSEDED wholesale.
//   - `append`  : all present contributions are concatenated in ascending tier
//                 rank (pack contributions in registry order first, the local
//                 override LAST), joined by one blank line; the body's inline
//                 default remains the FIRST part and runs before this served body.
//
// This module is pure: `planSlot` reads only the body-free snapshot + the ref and
// yields a resolution PLAN (candidate paths per tier). The service reads those
// paths via its own `fs` port and composes with `composeSlotBody`; the snapshot
// stays body-free (C008 invariant intact).

import { isAbsoluteRoot, joinSlash, normalizeSlashes } from "./paths.js";
import type { ResolverErrorCategory, ResolverSnapshot } from "./types.js";

/** The per-slot merge policy declared in a `slot` fragment's scope. */
export type MergePolicy = "replace" | "append";

/** The gitignored, per-machine location of a personal slot override, relative to
 *  the workspace root. `_local/` is gitignored wholesale (charter Assumption #1),
 *  so nothing override-related is ever committed downstream. One file per point:
 *  `_local/slots/<skill>.<point>.md`. */
export const OVERRIDE_DIR = "_local/slots";

/** The rank of the personal-override tier — the highest precedence tier. */
export const OVERRIDE_TIER_RANK = 30;
/** The rank of the pack-contribution tier — the lowest served tier. */
export const PACK_TIER_RANK = 10;

/** The separator joining the parts of an `append` composition — exactly one
 *  blank line between adjacent contribution bodies. Deterministic and fixed by
 *  contract so the composed body is a pure function of its parts. */
export const APPEND_SEPARATOR = "\n\n";

/** One candidate contribution to a slot, from a single tier. The service reads
 *  `path`; an `optional` candidate that is absent is simply skipped (the personal
 *  override), a required one that is absent is a `ref-not-found` (a declared pack
 *  fragment body missing on disk). */
export interface SlotContribution {
  /** The tier that produced this candidate (e.g. `pack-contribution`). */
  tier: string;
  /** The tier's precedence rank (higher wins for `replace`; last for `append`). */
  rank: number;
  /** Attribution: the contributing capability name, or `local-override`. */
  source: string;
  /** Absolute forward-slash path to the contribution body. */
  path: string;
  /** True when absence is legal (the personal override); false for a declared
   *  pack fragment whose body MUST exist. */
  optional: boolean;
}

/** The context a tier gathers its contributions from — the resolved slot id plus
 *  the body-free snapshot. Pure input; a tier reads no filesystem. */
export interface SlotTierContext {
  skill: string;
  point: string;
  skillPoint: string;
  snapshot: ResolverSnapshot;
  workspaceRoot: string;
}

/** One precedence tier in the ordered chain. A tier is self-contained: it gathers
 *  its own candidates from the snapshot, so a new tier is added by appending one
 *  `Tier` at a new rank — no existing tier, contribution, or override changes. */
export interface Tier {
  name: string;
  rank: number;
  gather(ctx: SlotTierContext): SlotContribution[];
}

/** A resolved slot plan. `compose` carries the ordered candidate list (ascending
 *  rank) + the merge policy; the service reads and composes it. `unresolved` /
 *  `refused` mirror the content surface's degradation discipline. */
export type SlotPlan =
  | { kind: "compose"; skillPoint: string; policy: MergePolicy; contributions: SlotContribution[] }
  | { kind: "unresolved"; category: ResolverErrorCategory; message: string }
  | { kind: "refused"; reason: string };

/** A single `slot` fragment matching a target point, projected from the snapshot. */
interface SlotFragmentMatch {
  capability: string;
  validity: "ok" | "unrecoverable";
  resolvedPath: string | null;
  /** The `inline:` dispatch's relative body path, or `null` for a non-inline
   *  (subagent) dispatch — which cannot be composed as a served body. */
  dispatchRel: string | null;
  policy: MergePolicy | null;
}

/** A single lowercase / digit / hyphen segment (a `skill` or `point`). */
function isSegment(s: string | undefined): s is string {
  return typeof s === "string" && /^[a-z0-9][a-z0-9-]*$/.test(s);
}

/** A ref path is safe when it holds no traversal, absolute anchor, or backslash. */
function isSafeRelPath(p: string): boolean {
  if (p.length === 0) return false;
  const n = normalizeSlashes(p);
  if (n.includes("\\")) return false;
  if (n.startsWith("/") || isAbsoluteRoot(n)) return false;
  return !n.split("/").some((seg) => seg === "." || seg === ".." || seg === "");
}

/** Resolve a relativized snapshot path (workspace-relative OR absolute) to an
 *  absolute forward-slash path. */
function toAbsolute(workspaceRoot: string, snapshotPath: string): string {
  return isAbsoluteRoot(snapshotPath)
    ? normalizeSlashes(snapshotPath)
    : joinSlash(workspaceRoot, snapshotPath);
}

/** Parse a `slot` fragment scope (`<skill>.<point> <merge-policy>`) into its id
 *  and policy. Returns `null` for a blank/malformed scope, an ill-formed
 *  `skill.point`, or an absent/unknown policy (the same shape the registry
 *  validator enforces). */
export function parseSlotScope(scope: string | null): { skillPoint: string; policy: MergePolicy } | null {
  if (!scope) return null;
  const parts = scope.trim().split(/\s+/);
  if (parts.length !== 2) return null;
  const [id, policyRaw] = parts;
  const segs = id.split(".");
  if (segs.length !== 2 || !isSegment(segs[0]) || !isSegment(segs[1])) return null;
  if (policyRaw !== "replace" && policyRaw !== "append") return null;
  return { skillPoint: id, policy: policyRaw };
}

/** Extract an `inline:` dispatch's relative path; `null` for a `subagent:`
 *  dispatch (not a servable body) or a malformed token. */
function parseInlineDispatch(dispatch: string): string | null {
  const m = /^inline:\s*(.+)$/i.exec(dispatch.trim());
  if (!m) return null;
  const rel = m[1].trim().replace(/^`/, "").replace(/`$/, "").trim();
  return rel.length > 0 ? rel : null;
}

/** Project every active `slot` fragment targeting `skillPoint`, in registry order. */
function findSlotFragments(snapshot: ResolverSnapshot, skillPoint: string): SlotFragmentMatch[] {
  const out: SlotFragmentMatch[] = [];
  for (const cap of snapshot.capabilities) {
    for (const f of cap.fragments) {
      if (f.contributionKind !== "slot") continue;
      const parsed = parseSlotScope(f.scope);
      if (!parsed || parsed.skillPoint !== skillPoint) continue;
      out.push({
        capability: cap.name,
        validity: cap.validity,
        resolvedPath: cap.resolvedPath,
        dispatchRel: parseInlineDispatch(f.dispatch),
        policy: parsed.policy,
      });
    }
  }
  return out;
}

/** The pack-contribution tier: every active capability's `slot` fragment for the
 *  point, in registry order. Lowest served precedence. */
export const PACK_CONTRIBUTION_TIER: Tier = {
  name: "pack-contribution",
  rank: PACK_TIER_RANK,
  gather(ctx) {
    return findSlotFragments(ctx.snapshot, ctx.skillPoint)
      .filter((m) => m.validity === "ok" && m.resolvedPath && m.dispatchRel)
      .map((m) => ({
        tier: "pack-contribution",
        rank: PACK_TIER_RANK,
        source: m.capability,
        path: joinSlash(toAbsolute(ctx.workspaceRoot, m.resolvedPath as string), m.dispatchRel as string),
        optional: false,
      }));
  },
};

/** The personal-override tier: the single gitignored `_local/slots/<id>.md`
 *  candidate. Highest precedence. Optional — absence means "no override". */
export const LOCAL_OVERRIDE_TIER: Tier = {
  name: "local-override",
  rank: OVERRIDE_TIER_RANK,
  gather(ctx) {
    return [
      {
        tier: "local-override",
        rank: OVERRIDE_TIER_RANK,
        source: "local-override",
        path: joinSlash(ctx.workspaceRoot, OVERRIDE_DIR, `${ctx.skillPoint}.md`),
        optional: true,
      },
    ];
  },
};

/** The default ordered tier chain (WF-327's committed three-tier precedence,
 *  minus the never-served inline default). C020 inserts its tier between these
 *  two at a rank strictly between {@link PACK_TIER_RANK} and
 *  {@link OVERRIDE_TIER_RANK}. */
export const DEFAULT_TIERS: readonly Tier[] = [PACK_CONTRIBUTION_TIER, LOCAL_OVERRIDE_TIER];

/** Resolve a slot ref to a composition plan. Pure — reads only the body-free
 *  snapshot. The `tiers` chain is injectable so the tier-insertion test can prove
 *  a new intermediate tier changes no existing winner. */
export function planSlot(
  ref: { skill?: string; point?: string },
  snapshot: ResolverSnapshot,
  workspaceRoot: string,
  tiers: readonly Tier[] = DEFAULT_TIERS,
): SlotPlan {
  const skill = ref.skill?.trim();
  const point = ref.point?.trim();
  if (!isSegment(skill)) {
    return { kind: "refused", reason: "a `slot` ref requires a `skill` segment (lowercase, hyphenated)." };
  }
  if (!isSegment(point)) {
    return { kind: "refused", reason: "a `slot` ref requires a `point` segment (lowercase, hyphenated)." };
  }
  const skillPoint = `${skill}.${point}`;

  const matches = findSlotFragments(snapshot, skillPoint);

  // A contributing capability whose plugin root dangles (self-heal recovered
  // nothing) cannot be served — the integrity-class failure, not a caller error.
  for (const m of matches) {
    if (m.validity !== "ok" || !m.resolvedPath) {
      return {
        kind: "unresolved",
        category: "registry-invalid",
        message: `capability \`${m.capability}\` contributes to slot \`${skillPoint}\` but has no readable manifest (its plugin root dangles and self-heal recovered nothing) — the slot cannot be composed.`,
      };
    }
    if (!m.dispatchRel) {
      return {
        kind: "unresolved",
        category: "registry-invalid",
        message: `capability \`${m.capability}\` contributes to slot \`${skillPoint}\` with a non-inline dispatch — a slot body must use \`inline: <rel-path>\` to be composed.`,
      };
    }
    if (!isSafeRelPath(m.dispatchRel)) {
      return {
        kind: "refused",
        reason: `capability \`${m.capability}\` slot \`${skillPoint}\` dispatch is not a safe relative path.`,
      };
    }
  }

  // Merge policy: taken from the contributing fragments. With no pack
  // contribution, only the single override can be served, so the policy is
  // observationally irrelevant (one body either way) and defaults to `replace`.
  let policy: MergePolicy = "replace";
  if (matches.length > 0) {
    const policies = new Set(matches.map((m) => m.policy));
    if (policies.size > 1) {
      return {
        kind: "unresolved",
        category: "registry-invalid",
        message: `slot \`${skillPoint}\` has contributions declaring conflicting merge policies — a slot's policy must be consistent across contributors.`,
      };
    }
    policy = matches[0].policy as MergePolicy;
    if (policy === "replace" && matches.length > 1) {
      return {
        kind: "unresolved",
        category: "registry-invalid",
        message: `slot \`${skillPoint}\` is claimed \`replace\` by ${matches.length} capabilities (${matches.map((m) => m.capability).join(", ")}) — a replace slot has a single owner.`,
      };
    }
  }

  const ctx: SlotTierContext = { skill, point, skillPoint, snapshot, workspaceRoot };
  const ordered = [...tiers].sort((a, b) => a.rank - b.rank);
  const contributions = ordered.flatMap((t) => t.gather(ctx));

  return { kind: "compose", skillPoint, policy, contributions };
}

/** A contribution the service has read a body for (present on disk). */
export interface PresentPart {
  tier: string;
  rank: number;
  source: string;
  path: string;
  content: string;
}

/**
 * Compose the single served body from the present parts, under the merge policy.
 * The parts arrive in ascending tier rank (the plan's order).
 *   - `replace`: the highest-rank present part (the last in the list) — the
 *     override when present, else the single pack contribution.
 *   - `append` : every present part concatenated in order, joined by one blank
 *     line — pack contributions (registry order) first, the override last.
 * Pure and deterministic: the body is a function of the parts alone.
 */
export function composeSlotBody(policy: MergePolicy, present: PresentPart[]): string {
  if (present.length === 0) return "";
  if (policy === "replace") {
    return present.reduce((a, b) => (b.rank >= a.rank ? b : a)).content;
  }
  return present.map((p) => p.content).join(APPEND_SEPARATOR);
}
