// wf resolver — the pure apply screening, gate, and registry rendering (WF-453).
//
// The DECISION half of the first public mutator. Deterministic, body-free, and
// side-effect-free: nothing here opens a file, canonicalizes a path, acquires a
// lock, or writes a byte. Every filesystem question is answered by the caller and
// handed in, exactly the discipline `plan-install.ts` (WF-447),
// `payload-plan.ts` (WF-448) and `lifecycle-journal.ts` (WF-451) hold. The write
// half lives in `apply-transaction.ts`, behind an injected port surface.
//
// That split is what makes the item's headline guarantee testable with no
// filesystem at all: EVERY REFUSAL BELOW HAPPENS BEFORE A JOURNAL, A BACKUP, OR
// A BYTE, because nothing below is capable of producing one.
//
// FOUR RULES ARE CORRECTNESS, NOT PREFERENCE:
//
//   1. A BOUNDED SUPPORTED SET, AND EVERYTHING ELSE FAILS LOUDLY AND EARLY. The
//      frozen plan schema has thirteen action kinds. Six are applied
//      unconditionally (WF-453's registry pair, widened by WF-454, again by
//      WF-455's committed project override, and again by WF-456's pack payload);
//      one more is applied when its enabling fact holds and NAMED with a
//      follow-up when it does not; the rest are refused before entry. The screen
//      covers the WHOLE action list AND the whole seed list before the first
//      target is composed, so an unsupported kind can never follow a supported
//      subset that was already written. A silently-ignored unsupported action
//      would report success over a half-applied plan — the worst defect
//      available to this family.
//
//      A KIND THIS RELEASE DOES NOT UNDERSTAND IS REFUSED BY THIS SAME SCREEN,
//      NOT BY A SECOND ONE. Anything absent from both lists below is
//      `apply/unsupported-action` BEFORE `composeApplyTargets` runs and therefore
//      before a single target is composed. That is why the screen must stay a
//      whole-plan gate rather than a per-action early return inside the compose
//      loop: an early return would already have written the actions it walked
//      past.
//
//      WF-458 MOVES DELETION AND BOOTSTRAP FROM "REFUSED HERE" TO "ADMITTED HERE
//      AND GATED AGAIN". `artifact-delete`, `artifact-bootstrap` and the
//      `legacy-bootstrap` seed kind are now supported — but admission is only
//      permission to be CONSIDERED. They must additionally pass
//      `decideRemovalGate` (`apply-removal.ts`), a second pure whole-plan gate
//      that re-derives every artifact classification from facts re-observed under
//      the lock and rejects the WHOLE plan on any drift. The two gates compose in
//      series and both precede the first composed target, so the strictly
//      stronger property — refuse before ANY write — is unchanged.
//
//   2. THE PLAN IS REVALIDATED AGAINST CURRENT FACTS, NEVER TRUSTED. The caller
//      approves a `planId`; this module compares it to one recomputed from the
//      world as it is NOW. WF-450 froze that identity over a closed set of
//      sixteen mutation-relevant fact classes precisely so a moved world is
//      detectable, and detecting it is worth nothing unless the detection
//      precedes the transaction.
//
//   3. FIRST MATCH WINS, MOST-FUNDAMENTAL FIRST. Admission outranks recovery,
//      which outranks identity, which outranks applicability, which outranks the
//      action screen. A run that was never admitted must not report a stale plan,
//      and a run that never recovered must not report anything about the
//      selection at all.
//
//   4. THE PRECISE CLASS, NEVER A PLAUSIBLE NEIGHBOUR. Every refusal carries
//      exactly one closed `ApplyReason`. Reporting an unsupported action kind as
//      a stale plan would send a maintainer chasing a world that never moved.

import { removeSectionRow, upsertSectionRow } from "./registry-edit.js";
import type {
  ApplyDeferredAction,
  ApplyReason,
  PlanAction,
  PlanActionKind,
  PlanEvidenceSeedKind,
  PlanInstallResponse,
} from "./types.js";

// ---------------------------------------------------------------------------
// The closed action screen
// ---------------------------------------------------------------------------

/** The mutating action kinds this mutator APPLIES UNCONDITIONALLY.
 *
 *  WF-453 shipped exactly the registry pair. WF-454 widened it to the four kinds
 *  that make up ONE lifecycle registration — the registry rows, the evidence that
 *  records who owns them, and the approved project answers that seed the
 *  capability profile. WF-455 adds `override-write`, the committed
 *  project-override tier, because a pack that contributes shared slot content
 *  activates through the SAME confirmed transaction as its registration: applying
 *  the rows without the override would leave the project registered against
 *  content it has not received.
 *
 *  WF-456 adds `payload-write`, the general pack payload. The planner still
 *  separates the two (`isProjectOverrideDestination`) because they carry different
 *  review weight, but both are now applied by the same transaction: a pack whose
 *  runtime support files are part of its activation must receive them through the
 *  SAME confirmed transaction as its registration, or the project ends up
 *  registered against a capability whose payload never arrived.
 *
 *  WF-458 added deletion and bootstrap; WF-459 adds upgrade and repair. Every
 *  mutating kind the frozen plan schema defines is now either here or in the
 *  conditional list below — which makes the fail-closed default the only thing
 *  standing between a FUTURE kind and a silently half-applied plan.
 *
 *  Stated as data rather than as a comment so the contract tests can assert the
 *  boundary mechanically. EVERY kind absent from this list and from the
 *  conditional list below is refused, and refused over the WHOLE plan before any
 *  of these writes a byte. */
export const APPLY_SUPPORTED_ACTION_KINDS: readonly PlanActionKind[] = [
  "evidence-seed",
  "registry-add",
  "registry-deregister",
  "payload-write",
  "answer-write",
  "override-write",
  // WF-458. The destructive slice, admitted to the SAME whole-plan screen as
  // everything else — and then held to a SECOND whole-plan gate
  // (`decideRemovalGate`) that re-derives every artifact classification from
  // current facts before a single target is composed. Admission here is
  // permission to be considered, never permission to delete.
  //
  "artifact-bootstrap",
  "artifact-delete",
  // WF-459. The constructive slice, admitted to the SAME whole-plan screen — and
  // then held to a THIRD whole-plan gate (`decideUpgradeGate`, `apply-upgrade.ts`)
  // that re-derives every artifact classification from facts re-observed under the
  // lock and rejects the WHOLE plan on any drift. Admission here is permission to
  // be considered, never permission to replace a user's file.
  //
  // The gate's second job has no analogue on the removal side: it also decides
  // what this run will NOT resolve, so an edited artifact that survives is
  // REPORTED as a remaining divergence rather than silently absorbed. Every
  // mutating action kind is now supported, so `unsupported` is reachable only for
  // a kind a FUTURE release adds — which is exactly the fail-closed posture the
  // exhaustive partition below was built for.
  "artifact-advance",
  "evidence-repair",
];

/** The mutating action kinds this mutator applies ONLY when an enabling fact
 *  holds, and NAMES with a follow-up when it does not.
 *
 *  `constitution-recompose` is derived by the planner whenever the registered
 *  capability set changes, so EVERY registry plan carries one. WF-455 composes it
 *  — but composition REPLACES a derived section of an existing record and
 *  preserves the rest, so it is only possible where a record already exists. A
 *  project that has never run `/wf:constitution` has no record to compose from,
 *  and inventing one would mean the resolver authoring the core articles and the
 *  project's own clauses, which it did not write and must not fabricate.
 *
 *  On that path the action is DEFERRED exactly as it was before this item —
 *  neither applied nor refused — so a project with no composed constitution keeps
 *  precisely its prior appliability. */
export const APPLY_CONDITIONAL_ACTION_KINDS: readonly PlanActionKind[] = [
  "constitution-recompose",
];

/** The named follow-up for each conditional kind when its enabling fact does not
 *  hold. A command a maintainer runs — never a command this mutator runs. */
const DEFERRED_FOLLOW_UP: Record<string, string> = {
  "constitution-recompose": "/wf:constitution",
};

/** Every caller-computed fact the SCREEN depends on.
 *
 *  Handed in rather than observed, exactly as `ApplyGateInput` hands in the
 *  recomputed plan and the journal's presence: the screen stays pure, so "every
 *  refusal happens before a journal, a backup, or a byte" remains provable with no
 *  filesystem at all. */
export interface ApplyScreeningFacts {
  /** `true` when the composed constitution record exists NOW. Decides whether a
   *  `constitution-recompose` action is applied or named. */
  constitutionRecordPresent: boolean;
}

export interface ScreenedActions {
  /** Mutating registry actions, in the plan's own canonical order. */
  supported: PlanAction[];
  /** Mutating actions carried but deliberately not performed here. */
  deferred: ApplyDeferredAction[];
  /** Mutating actions outside this mutator's scope. A non-empty list is a
   *  refusal BEFORE journal creation. */
  unsupported: PlanAction[];
  /** Non-mutating actions. Review material; ignored by construction. */
  retained: PlanAction[];
}

/**
 * Partition a complete plan's action list into the four screening buckets.
 *
 * EXHAUSTIVE BY CONSTRUCTION: a non-mutating action is retained, a supported kind
 * is applied, a deferred kind is named, and EVERYTHING ELSE is unsupported. There
 * is no fall-through, so a future `PlanActionKind` added upstream lands in
 * `unsupported` — refusing a kind this release does not understand, which is the
 * same fail-closed posture `parseTransactionJournal` takes toward a journal
 * version it does not understand.
 */
export function screenPlanActions(
  actions: readonly PlanAction[],
  facts: ApplyScreeningFacts,
): ScreenedActions {
  const screened: ScreenedActions = {
    supported: [],
    deferred: [],
    unsupported: [],
    retained: [],
  };

  /** Whether one conditional kind's enabling fact holds RIGHT NOW.
   *
   *  Written as an exhaustive switch on the kind rather than as a boolean flag,
   *  so adding a second conditional kind is a compile-visible edit here rather
   *  than a silent inheritance of the constitution's condition — the WF-454
   *  defect-(A) class, where an unguarded branch quietly answered for a kind it
   *  was never asked about. */
  const conditionMet = (kind: PlanActionKind): boolean => {
    switch (kind) {
      case "constitution-recompose":
        return facts.constitutionRecordPresent;
      default:
        return false;
    }
  };

  for (const action of actions) {
    if (!action.mutating) {
      screened.retained.push(action);
      continue;
    }
    if (APPLY_SUPPORTED_ACTION_KINDS.includes(action.kind)) {
      screened.supported.push(action);
      continue;
    }
    if (APPLY_CONDITIONAL_ACTION_KINDS.includes(action.kind)) {
      if (conditionMet(action.kind)) {
        screened.supported.push(action);
        continue;
      }
      screened.deferred.push({
        kind: action.kind,
        order: action.order,
        destination: action.destination,
        reason: "no-constitution-record",
        followUp: DEFERRED_FOLLOW_UP[action.kind] ?? "",
        detail: `\`${action.kind}\` replaces a derived section of the composed constitution record and preserves the rest, but this workspace has no record to compose from; the transaction below does not create one.`,
      });
      continue;
    }
    screened.unsupported.push(action);
  }

  return screened;
}

// ---------------------------------------------------------------------------
// The pre-journal gate
// ---------------------------------------------------------------------------

/** The evidence-seed kinds this mutator APPLIES.
 *
 *  `binding-seed` only. A `legacy-bootstrap` records portable evidence for a
 *  pre-ledger registration from OBSERVED proof rather than from evidence the
 *  project already committed, and that remains out of scope (WF-449 planned it;
 *  nothing applies it).
 *
 *  THIS SCREEN CANNOT BE EXPRESSED AS AN ACTION KIND. Both seed kinds integrate
 *  into the plan as the single `evidence-seed` action, so screening the action
 *  list alone would silently admit a legacy bootstrap into a supported plan —
 *  exactly the half-understood application the ordering rule exists to prevent.
 *  The gate therefore screens the plan's own `evidenceSeeds` facts as well. */
export const APPLY_SUPPORTED_SEED_KINDS: readonly PlanEvidenceSeedKind[] = [
  "binding-seed",
  // WF-458. A `legacy-bootstrap` records portable evidence for a pre-ledger
  // registration from OBSERVED proof. It is admitted here and then held to
  // `decideRemovalGate`'s rule 6, which requires the observed tuple to be
  // COMPLETE and EXACTLY equal to the approved one and the pack to still have no
  // recorded portable evidence. Incomplete or stale proof rejects the whole plan
  // with the registration preserved byte-for-byte — a partially-seeded tuple is
  // strictly worse than none, because it looks authoritative.
  "legacy-bootstrap",
];

/** Everything the gate needs. Every member is a fact the caller already
 *  computed — the recomputed plan, the approved identity, and whether a journal
 *  survived pre-entry recovery. */
export interface ApplyGateInput {
  /** The plan recomputed from CURRENT facts, not the one the caller approved. */
  plan: PlanInstallResponse;
  /** The `identity.planId` the caller approved. */
  expectedPlanId: string;
  /** `true` when a journal is still on disk after recovery reported it
   *  proceeded. Structurally impossible under the frozen protocol — recovery
   *  discards the journal exactly when every entry resolved — so observing one
   *  means something outside the protocol wrote it, and entering a second
   *  transaction over it could strand the first. */
  journalPresent: boolean;
  /** `true` when the composed constitution record exists NOW (WF-455). The one
   *  screening fact the gate forwards; see {@link ApplyScreeningFacts}. */
  constitutionRecordPresent: boolean;
}

export type ApplyGateDecision =
  | { ok: true; screened: ScreenedActions }
  | { ok: false; reason: ApplyReason; detail: string; screened: ScreenedActions };

/**
 * Decide whether a transaction may be opened at all. RULE 3 — first match wins,
 * most-fundamental first.
 *
 * Note the ordering of the identity check against the applicability check: a
 * STALE plan is reported as stale even when the recomputed plan is also
 * inapplicable. That is deliberate and is rule 4: "the plan you approved no
 * longer describes this workspace" and "the plan you approved cannot be applied"
 * are different maintainer stories, and the first one explains the second.
 */
export function decideApplyGate(input: ApplyGateInput): ApplyGateDecision {
  const screened = screenPlanActions(input.plan.actions, {
    constitutionRecordPresent: input.constitutionRecordPresent,
  });

  if (!input.plan.admission.admitted) {
    return {
      ok: false,
      reason: "apply/invalid-root",
      detail:
        input.plan.admission.diagnostic ??
        "the declared workspace root was not admitted, so nothing was read and nothing was applied.",
      screened,
    };
  }

  if (input.plan.applicability === "unrecovered") {
    return {
      ok: false,
      reason: "apply/halted-unrecovered",
      detail:
        "pre-entry recovery did not proceed, so lifecycle state was never read and no plan was generated; nothing was applied.",
      screened,
    };
  }

  if (input.journalPresent) {
    return {
      ok: false,
      reason: "apply/journal-present",
      detail:
        "a transaction journal is still present after recovery reported it proceeded; a second transaction is not opened over it.",
      screened,
    };
  }

  if (input.plan.identity.planId !== input.expectedPlanId) {
    return {
      ok: false,
      reason: "apply/plan-stale",
      detail: `the approved plan \`${input.expectedPlanId}\` no longer describes this workspace; re-planning now yields \`${input.plan.identity.planId}\`. Re-run \`plan_install\` and approve the current plan.`,
      screened,
    };
  }

  if (input.plan.applicability !== "applicable") {
    return {
      ok: false,
      reason: "apply/plan-not-applicable",
      detail: `the plan's applicability is \`${input.plan.applicability}\`; only an \`applicable\` plan is applied.`,
      screened,
    };
  }

  if (screened.unsupported.length > 0) {
    const kinds = [...new Set(screened.unsupported.map((action) => action.kind))].sort();
    return {
      ok: false,
      reason: "apply/unsupported-action",
      detail: `the plan carries mutating action kind(s) this mutator does not support: ${kinds
        .map((kind) => `\`${kind}\``)
        .join(", ")}. The whole plan is screened before anything is written, so an unsupported kind is refused before any journal, backup, or mutation — the supported subset is never applied on its own.`,
      screened,
    };
  }

  // The SECOND half of the unsupported screen, and it must run here — alongside
  // the action screen and still before any journal — for the reason
  // `APPLY_SUPPORTED_SEED_KINDS` states: a legacy bootstrap wears the same
  // `evidence-seed` action kind as an ordinary binding seed, so the action list
  // cannot distinguish them. Screening the seed FACTS is the only place the
  // distinction exists.
  const unsupportedSeeds = input.plan.evidenceSeeds.filter(
    (seed) => !APPLY_SUPPORTED_SEED_KINDS.includes(seed.kind),
  );
  if (unsupportedSeeds.length > 0) {
    const kinds = [...new Set(unsupportedSeeds.map((seed) => seed.kind))].sort();
    const packs = [...new Set(unsupportedSeeds.map((seed) => seed.pluginId))].sort();
    return {
      ok: false,
      reason: "apply/unsupported-action",
      detail: `the plan carries evidence seed kind(s) this mutator does not support: ${kinds
        .map((kind) => `\`${kind}\``)
        .join(", ")} (pack(s) ${packs
        .map((pack) => `\`${pack}\``)
        .join(", ")}). A legacy portable bootstrap records portable evidence from observed proof and is refused before any journal, backup, or mutation.`,
      screened,
    };
  }

  // An `applicable` plan carries at least one mutating action by the planner's
  // own invariant, and every mutating action here is either supported or
  // deferred. A plan whose ONLY mutating action is a deferred constitution
  // recomposition would leave this mutator nothing to do, which is not a
  // configuration-only plan at all — it is a plan whose registry delta is empty,
  // and the planner cannot produce one (the recomposition is derived FROM a
  // non-empty delta). Refusing it explicitly costs one branch and removes the
  // possibility of opening a transaction that writes nothing.
  if (screened.supported.length === 0) {
    return {
      ok: false,
      reason: "apply/plan-not-applicable",
      detail:
        "the plan carries no supported mutating action, so there is nothing for this mutator to apply.",
      screened,
    };
  }

  return { ok: true, screened };
}

// ---------------------------------------------------------------------------
// Registry rendering
// ---------------------------------------------------------------------------

/** One pack's registerable rows, as the caller inspected them. Supplied for
 *  every pack the plan acts on; the pure renderer performs no inspection. */
export interface ApplyRegistryFact {
  pluginId: string;
  pluginName: string;
  /** The pack's resolved install root. `null` when the pack is not inspectable —
   *  legitimate for a deregistration (an orphaned registration has no root to
   *  record), and a refusal for an addition. */
  installPath: string | null;
  capabilities: readonly { name: string; path: string }[];
}

export type RegistryMutation =
  | { ok: true; content: string; changed: boolean }
  | { ok: false; reason: ApplyReason; detail: string };

const CAPABILITIES_SECTION = "Capabilities";
const PLUGIN_ROOTS_SECTION = "Plugin Roots";

/**
 * Render the registry file's new bytes for one screened plan.
 *
 * Applies the supported actions IN THE PLAN'S OWN CANONICAL ORDER — `registry-add`
 * before `registry-deregister`, exactly as `PLAN_ACTION_ORDER` fixed it — so two
 * runs over the same plan produce byte-identical output. The edit is narrow by
 * construction: `upsertSectionRow` and `removeSectionRow` touch only the rows they
 * name, and every other section, table, and line of the registry survives
 * byte-for-byte.
 *
 * Pure: the current bytes go in, the new bytes come out, and nothing is written.
 *
 * ONLY THE TWO REGISTRY KINDS ARE ACTED ON, and that guard is load-bearing since
 * WF-454. The supported set used to BE the registry pair, so "not an add" could
 * safely mean "a deregistration"; now that `evidence-seed` and `answer-write`
 * are also supported, an unguarded fall-through would take the deregistration
 * branch for an answer write and REMOVE the rows the same plan had just added.
 * Every other supported kind is skipped here and rendered by its own renderer.
 */
export function renderRegistryMutation(
  current: string,
  supported: readonly PlanAction[],
  facts: ReadonlyMap<string, ApplyRegistryFact>,
): RegistryMutation {
  let content = current;
  let changed = false;

  for (const action of supported) {
    if (action.kind !== "registry-add" && action.kind !== "registry-deregister") continue;
    const pluginId = action.pluginId;
    if (pluginId === null) {
      return {
        ok: false,
        reason: "apply/registry-unresolvable",
        detail: `a \`${action.kind}\` action carries no pack attribution, so the registry rows it names cannot be resolved.`,
      };
    }
    const fact = facts.get(pluginId);
    if (fact === undefined) {
      return {
        ok: false,
        reason: "apply/registry-unresolvable",
        detail: `pack \`${pluginId}\` is named by a \`${action.kind}\` action but was not inspectable at apply time, so its registry rows cannot be resolved.`,
      };
    }

    if (action.kind === "registry-add") {
      if (fact.installPath === null || fact.capabilities.length === 0) {
        return {
          ok: false,
          reason: "apply/registry-unresolvable",
          detail: `pack \`${pluginId}\` has no resolvable install root or no valid capability rows at apply time, so its registration cannot be written.`,
        };
      }
      const root = upsertSectionRow(
        content,
        PLUGIN_ROOTS_SECTION,
        ["Plugin", "Root"],
        fact.pluginName,
        fact.installPath,
      );
      content = root.content;
      changed = changed || root.changed;
      for (const capability of fact.capabilities) {
        const row = upsertSectionRow(
          content,
          CAPABILITIES_SECTION,
          ["Capability", "Path"],
          capability.name,
          capability.path,
        );
        content = row.content;
        changed = changed || row.changed;
      }
      continue;
    }

    // `registry-deregister`. The capability names come from the PLAN's own
    // registry delta rather than from a fresh inspection — the caller sources
    // this fact from `registryDelta.deregistrations`, because deregistering an
    // orphaned pack must remove exactly the rows the REGISTRY attributes to it
    // and an orphaned pack may no longer be inspectable at all. The delta is a
    // `planId` fact class, so it cannot have moved without the gate above already
    // refusing. A pack contributing no names removes only its `## Plugin Roots`
    // row: the fail-safe direction, since removing a capability row the registry
    // does not attribute to this pack would deregister something the plan never
    // named.
    for (const capability of fact.capabilities) {
      const row = removeSectionRow(content, CAPABILITIES_SECTION, capability.name);
      content = row.content;
      changed = changed || row.changed;
    }
    const rootRow = removeSectionRow(content, PLUGIN_ROOTS_SECTION, fact.pluginName);
    content = rootRow.content;
    changed = changed || rootRow.changed;
  }

  return { ok: true, content, changed };
}
