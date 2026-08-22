// The pure whole-plan upgrade / repair gate — contract tests (WF-459).
//
// Everything here runs with NO filesystem, NO lock, and NO ports, for the reason
// `apply-removal.test.ts` states: the module under test is structurally incapable
// of creating a journal, a backup, or of replacing a byte, so "every refusal
// happens before any mutation" is proved by construction rather than asserted.
//
// THE REPORTING HALF IS TESTED AS HARD AS THE WRITING HALF, AND SEPARATELY. The
// hard part of this slice is not mutating correctly — it is refusing to report
// success. A single "the edited file survived" assertion would pass just as
// happily on an implementation that silently absorbed that file into a clean
// verdict, so every honesty rule gets its own test with its own assertion about
// what was SAID, not only about what was written.
//
// The write half is exercised in `apply-transaction.test.ts` (the crash matrix,
// now including the advance and repair stages).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildUpgradeReport,
  collectRemainingDivergence,
  decideUpgradeGate,
  divergenceClassFor,
  notAssessedUpgradeReport,
  resolveUpgradeOutcome,
  type RepairFact,
  type UpgradeGateInput,
} from "../src/resolver/apply-upgrade.js";
import { planArtifacts, type PlanArtifactFact } from "../src/resolver/artifact-plan.js";
import type {
  ArtifactEvidence,
  ArtifactOwner,
  MachineBindingEvidence,
  PlanAction,
  PlanActionKind,
  PlanArtifactPreview,
  PlanArtifactRetentionReason,
  PlanRepairAction,
  PortablePackEvidence,
} from "../src/resolver/types.js";

const OLD_SOURCE = "a".repeat(64);
const NEW_SOURCE = "b".repeat(64);
const OLD_BYTES = "c".repeat(64);
const NEW_BYTES = "d".repeat(64);

const ALPHA: ArtifactOwner = { pluginId: "alpha@1", capability: "one", source: "one.md" };
const BETA: ArtifactOwner = { pluginId: "beta@1", capability: "two", source: "two.md" };

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function evidence(overrides: Partial<ArtifactEvidence> = {}): ArtifactEvidence {
  return {
    destination: "docs/one.md",
    owners: [ALPHA],
    declaredSourceFingerprint: OLD_SOURCE,
    producedContentHash: OLD_BYTES,
    production: "copy",
    refresh: "replace-if-unmodified",
    removal: "delete-if-unmodified",
    ...overrides,
  };
}

/** A fact that classifies as `advance`: nothing deselected, the source moved, and
 *  the bytes on disk still hash to the recorded digest. */
function advanceFact(overrides: Partial<PlanArtifactFact> = {}): PlanArtifactFact {
  const destination = overrides.destination ?? "docs/one.md";
  return {
    destination,
    target: { ok: true, canonicalTarget: `/ws/${destination}`, exists: true },
    recorded: evidence({ destination }),
    current: { ok: true, sha256: OLD_BYTES, bytes: 12 },
    declared: {
      declaredSourceFingerprint: NEW_SOURCE,
      producedContentHash: NEW_BYTES,
      owners: [ALPHA],
      production: "copy",
      refresh: "replace-if-unmodified",
      removal: "delete-if-unmodified",
    },
    declaringOwners: [ALPHA],
    deselectedOwners: [],
    ...overrides,
  };
}

/** The same destination, but EDITED: the bytes on disk no longer hash to the
 *  recorded digest, so the newer source may not replace them. */
function editedFact(destination = "docs/edited.md"): PlanArtifactFact {
  return advanceFact({
    destination,
    recorded: evidence({ destination }),
    current: { ok: true, sha256: "e".repeat(64), bytes: 20 },
  });
}

function action(kind: PlanActionKind, destination: string | null, pluginId: string | null = null): PlanAction {
  return {
    kind,
    order: 1,
    pluginId,
    destination,
    summary: `${kind} ${destination ?? pluginId ?? ""}`,
    mutating: true,
    persisted: false,
  };
}

function preview(facts: readonly PlanArtifactFact[], trustworthy = true): PlanArtifactPreview {
  return planArtifacts(facts, { inventoryTrustworthy: trustworthy }).preview;
}

const BINDING: MachineBindingEvidence = {
  pluginId: "alpha@1",
  canonicalRoot: "/ws/packs/alpha",
  cliScope: "user",
  enablement: "enabled",
  observedVersion: "1.0.0",
  localFingerprints: [{ path: "capabilities/one/manifest.md", sha256: OLD_SOURCE }],
};

const PORTABLE: PortablePackEvidence = {
  pluginId: "alpha@1",
  version: "1.0.0",
  capabilities: ["one"],
  manifestHashes: [{ path: "capabilities/one/manifest.md", sha256: NEW_SOURCE }],
  declaredSourceHashes: [{ path: "capabilities/one/one.md", sha256: NEW_SOURCE }],
};

function repairAction(overrides: Partial<PlanRepairAction> = {}): PlanRepairAction {
  return {
    pluginId: "alpha@1",
    comparison: "portable-mismatch",
    scope: "portable",
    overlay: null,
    persisted: false,
    ...overrides,
  };
}

function repairFact(overrides: Partial<RepairFact> = {}): RepairFact {
  return {
    pluginId: "alpha@1",
    comparison: "portable-mismatch",
    observedPortable: PORTABLE,
    observedBinding: BINDING,
    ...overrides,
  };
}

function gateInput(
  facts: readonly PlanArtifactFact[],
  supported: readonly PlanAction[],
  overrides: Partial<UpgradeGateInput> = {},
): UpgradeGateInput {
  return {
    approved: preview(facts),
    supported,
    currentFacts: facts,
    inventoryTrustworthy: true,
    repairs: [],
    repairFacts: [],
    removalDestinations: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// The happy path — the ONE advance class
// ---------------------------------------------------------------------------

test("the one upgrade class: listed, hash-proven, owner set unmoved, refresh permits it", () => {
  const facts = [advanceFact()];
  const decision = decideUpgradeGate(gateInput(facts, [action("artifact-advance", "docs/one.md")]));

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(
    decision.advances.map((a) => a.destination),
    ["docs/one.md"],
  );
  const advance = decision.advances[0];
  assert.equal(advance.priorContentHash, OLD_BYTES, "the advance is proven against the PRIOR hash");
  assert.equal(advance.declaredSourceFingerprint, NEW_SOURCE);
  assert.equal(advance.producedContentHash, NEW_BYTES);
  assert.deepEqual(advance.owners, [ALPHA]);
  assert.deepEqual(decision.remaining, [], "a clean single-advance plan leaves nothing behind");

  const report = buildUpgradeReport(decision);
  assert.equal(report.outcome, "fully-upgraded");
  assert.equal(report.noDrift, true);
});

// ---------------------------------------------------------------------------
// THE HONESTY RULES
// ---------------------------------------------------------------------------

test("SC: an edited artifact is preserved AND reported — never absorbed into success", () => {
  // Only the edited destination is in play, and the plan lists nothing. The naive
  // implementation writes nothing and says nothing; the requirement is that it
  // writes nothing and SAYS SO.
  const facts = [editedFact()];
  const decision = decideUpgradeGate(gateInput(facts, []));

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(decision.advances, [], "an edited artifact is never advanced");
  assert.deepEqual(decision.remaining, [
    { subject: "docs/edited.md", class: "edited", reason: "divergent" },
  ]);

  const report = buildUpgradeReport(decision);
  assert.equal(report.noDrift, false);
  assert.equal(report.outcome, "retained-divergence");
  assert.deepEqual(report.advanced, []);
});

test("SC: a MIXED run is partial — the absence of a fully-upgraded verdict is the assertion", () => {
  // One destination advances, one is edited. This is the run a naive
  // implementation reports as a success, because the thing it did succeeded.
  const facts = [advanceFact(), editedFact()];
  const decision = decideUpgradeGate(gateInput(facts, [action("artifact-advance", "docs/one.md")]));

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  const report = buildUpgradeReport(decision);

  assert.notEqual(report.outcome, "fully-upgraded", "a mixed run must NEVER read as fully upgraded");
  assert.notEqual(report.outcome, "no-drift");
  assert.equal(report.outcome, "partial");
  assert.equal(report.noDrift, false, "a surviving edit is a remaining divergence");
  assert.deepEqual(report.advanced, ["docs/one.md"], "the half that did land is still reported");
  assert.deepEqual(
    report.remaining.map((entry) => entry.subject),
    ["docs/edited.md"],
  );
});

test("SC: doing nothing and there being nothing to do are DIFFERENT reports", () => {
  // The single most important distinction in this slice. Both runs write zero
  // bytes; only one of them has nothing left to do.
  const settled = advanceFact({
    destination: "docs/settled.md",
    recorded: evidence({ destination: "docs/settled.md" }),
    declared: {
      declaredSourceFingerprint: OLD_SOURCE,
      producedContentHash: OLD_BYTES,
      owners: [ALPHA],
      production: "copy",
      refresh: "replace-if-unmodified",
      removal: "delete-if-unmodified",
    },
  });

  const clean = buildUpgradeReport(decideOk(gateInput([settled], [])));
  const retained = buildUpgradeReport(decideOk(gateInput([editedFact()], [])));

  // Identical on every axis a careless implementation would report on...
  assert.deepEqual(clean.advanced, retained.advanced);
  assert.deepEqual(clean.repaired, retained.repaired);
  // ...and different on the two that state the truth.
  assert.equal(clean.outcome, "no-drift");
  assert.equal(clean.noDrift, true);
  assert.deepEqual(clean.remaining, []);
  assert.equal(retained.outcome, "retained-divergence");
  assert.equal(retained.noDrift, false);
  assert.equal(retained.remaining.length, 1);
});

test("`no-drift` is a POSITIVE definition: the four outcomes are one total function", () => {
  // The single producer of every non-`not-assessed` outcome, asserted over its
  // whole domain, so no site anywhere can spell a fifth state or promote a
  // partial run to a full one.
  assert.equal(resolveUpgradeOutcome(0, 0), "no-drift");
  assert.equal(resolveUpgradeOutcome(1, 0), "fully-upgraded");
  assert.equal(resolveUpgradeOutcome(1, 1), "partial");
  assert.equal(resolveUpgradeOutcome(0, 1), "retained-divergence");

  // And `noDrift` follows `remaining` alone — never an authorization count.
  assert.equal(buildUpgradeReport({ advances: [], repairs: [], remaining: [] }).noDrift, true);
  assert.equal(
    buildUpgradeReport({
      advances: [],
      repairs: [],
      remaining: [{ subject: "x", class: "edited", reason: null }],
    }).noDrift,
    false,
  );
});

test("a never-assessed run claims nothing at all", () => {
  const report = notAssessedUpgradeReport();
  assert.equal(report.outcome, "not-assessed");
  assert.equal(report.noDrift, false, "`noDrift` is false because nothing established it");
  assert.deepEqual(report.remaining, []);
  assert.deepEqual(report.advanced, []);
  assert.deepEqual(report.repaired, []);
});

test("ONE CONFIRMATION AUTHORIZES ONLY THE LISTED ACTIONS: an unlisted advance is reported", () => {
  // Advanceable right now, but the confirmation says nothing about it. Preserving
  // it is the easy half; naming it is the requirement.
  const facts = [advanceFact({ destination: "docs/unlisted.md" })];
  const decision = decideUpgradeGate(gateInput(facts, []));

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(decision.advances, []);
  assert.deepEqual(decision.remaining, [
    { subject: "docs/unlisted.md", class: "unlisted", reason: "not-deselected" },
  ]);
});

test("every retention reason maps to a class, and an unknown one is conservatively divergent", () => {
  const known: [PlanArtifactRetentionReason, string | null][] = [
    ["not-deselected", null],
    ["shared-ownership", null],
    ["removal-semantics-retain", null],
    ["bootstrap-defers-deletion", null],
    ["divergent", "edited"],
    ["current-bytes-mismatch", "edited"],
    ["refresh-semantics-retain", "refresh-retained"],
    ["ownership-incomplete", "ambiguous"],
    ["digest-malformed", "ambiguous"],
    ["semantics-incomplete", "ambiguous"],
    ["source-fingerprint-missing", "ambiguous"],
    ["current-bytes-unreadable", "unverifiable"],
    ["destination-unsafe", "unverifiable"],
    ["no-recorded-proof", "unverifiable"],
    ["inventory-untrustworthy", "unverifiable"],
    ["not-reproducible", "unverifiable"],
  ];
  for (const [reason, expected] of known) {
    assert.equal(divergenceClassFor(reason), expected, `\`${reason}\``);
  }
  // The default arm. A reason this release does not understand is a reason nobody
  // tested, and the honest thing to say about an untested state is "unresolved".
  assert.equal(
    divergenceClassFor("a-reason-from-the-future" as PlanArtifactRetentionReason),
    "unverifiable",
  );
});

test("a deletion-only plan reports NO phantom drift", () => {
  // The inverse honesty failure: reporting divergence an ordinary removal run does
  // not have would make every deregistration look broken.
  const deletable: PlanArtifactFact = {
    destination: "docs/gone.md",
    target: { ok: true, canonicalTarget: "/ws/docs/gone.md", exists: true },
    recorded: evidence({ destination: "docs/gone.md" }),
    current: { ok: true, sha256: OLD_BYTES, bytes: 12 },
    declared: null,
    declaringOwners: [],
    deselectedOwners: [ALPHA],
  };
  const decision = decideUpgradeGate(
    gateInput([deletable], [], { removalDestinations: ["docs/gone.md"] }),
  );
  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(decision.remaining, []);
  assert.equal(buildUpgradeReport(decision).outcome, "no-drift");
});

// ---------------------------------------------------------------------------
// THE STRICTNESS AUDIT — the two conjuncts `classify()` does not assert
// ---------------------------------------------------------------------------

test("AUDIT (a): an advance whose DECLARING owner set moved is refused", () => {
  // `classify()`'s advance path reasons entirely from the RECORDED owners and
  // never compares them with the currently-declared ones, so this destination
  // still classifies as `advance`. The gate must refuse it anyway: a later
  // deletion establishes exclusivity from the recorded owner set, so quietly
  // narrowing it here would license destroying a file a surviving owner declares.
  const facts = [
    advanceFact({
      declared: {
        declaredSourceFingerprint: NEW_SOURCE,
        producedContentHash: NEW_BYTES,
        owners: [ALPHA, BETA],
        production: "copy",
        refresh: "replace-if-unmodified",
        removal: "delete-if-unmodified",
      },
    }),
  ];
  // The precondition for this test to mean anything: the classifier still says
  // `advance`, so the refusal below is the GATE's and not an inherited one.
  assert.equal(preview(facts).advance.length, 1, "the classifier must still admit it");

  const decision = decideUpgradeGate(gateInput(facts, [action("artifact-advance", "docs/one.md")]));
  assert.ok(!decision.ok);
  assert.ok(!decision.ok && decision.reason === "apply/artifact-precondition");
});

test("AUDIT (b): an advance whose DECLARED refresh says `retain` is refused", () => {
  // `classify()` gates the advance on `recorded.refresh === "replace-if-unmodified"`
  // and never looks at the DECLARED refresh, so a pack that changed its row to
  // `refresh: retain` would still have its artifact replaced on the authority of a
  // stale recorded tuple — an upgrade performed against the current declaration's
  // explicit instruction not to.
  const facts = [
    advanceFact({
      declared: {
        declaredSourceFingerprint: NEW_SOURCE,
        producedContentHash: NEW_BYTES,
        owners: [ALPHA],
        production: "copy",
        refresh: "retain",
        removal: "delete-if-unmodified",
      },
    }),
  ];
  assert.equal(preview(facts).advance.length, 1, "the classifier must still admit it");

  const decision = decideUpgradeGate(gateInput(facts, [action("artifact-advance", "docs/one.md")]));
  assert.ok(!decision.ok);
  assert.ok(!decision.ok && decision.reason === "apply/artifact-precondition");
});

test("an advance whose bytes were edited between plan and gate is refused, not applied", () => {
  // The approved preview says `advance`; the world says the file was edited. The
  // gate re-derives from CURRENT facts, so the stale approval buys nothing.
  const approved = preview([advanceFact()]);
  const edited = advanceFact({ current: { ok: true, sha256: "f".repeat(64), bytes: 30 } });
  const decision = decideUpgradeGate(
    gateInput([edited], [action("artifact-advance", "docs/one.md")], { approved }),
  );
  assert.ok(!decision.ok);
  assert.ok(!decision.ok && decision.reason === "apply/artifact-precondition");
});

test("a `changed` source that is byte-identical to the recorded one advances nothing", () => {
  const facts = [
    advanceFact({
      declared: {
        declaredSourceFingerprint: OLD_SOURCE,
        producedContentHash: OLD_BYTES,
        owners: [ALPHA],
        production: "copy",
        refresh: "replace-if-unmodified",
        removal: "delete-if-unmodified",
      },
    }),
  ];
  const decision = decideUpgradeGate(gateInput(facts, [action("artifact-advance", "docs/one.md")]));
  assert.ok(!decision.ok, "an advance with no justification must refuse");
});

// ---------------------------------------------------------------------------
// INTERNAL COHERENCE — rule 1
// ---------------------------------------------------------------------------

test("a destination named by BOTH an upgrade and a deletion refuses the whole plan", () => {
  const decision = decideUpgradeGate(
    gateInput([advanceFact()], [action("artifact-advance", "docs/one.md")], {
      removalDestinations: ["docs/one.md"],
    }),
  );
  assert.ok(!decision.ok);
  assert.ok(!decision.ok && decision.detail.includes("docs/one.md"));
});

test("a duplicate advance destination, and a null one, each refuse the whole plan", () => {
  const duplicate = decideUpgradeGate(
    gateInput([advanceFact()], [
      action("artifact-advance", "docs/one.md"),
      action("artifact-advance", "docs/one.md"),
    ]),
  );
  assert.ok(!duplicate.ok);

  const nullDestination = decideUpgradeGate(
    gateInput([advanceFact()], [action("artifact-advance", null)]),
  );
  assert.ok(!nullDestination.ok);
});

test("an `evidence-repair` action with NO previewed repair refuses loudly", () => {
  // The WF-454 defect-(A) shape: filtered out below, composed as nothing, and
  // reported in `applied[]` as though it had landed.
  const decision = decideUpgradeGate(
    gateInput([], [action("evidence-repair", null, "alpha@1")], { repairs: [] }),
  );
  assert.ok(!decision.ok);
  assert.ok(!decision.ok && decision.reason === "apply/evidence-precondition");
  assert.ok(!decision.ok && decision.detail.includes("alpha@1"));
});

test("a PREVIEWED repair the action list does not name is not authorized", () => {
  // Rule 6 for the repair arm: the confirmation authorizes the integrated
  // actions, not the diagnosis. Reading the preview directly would let a repair
  // the screen never admitted reach a ledger write.
  const decision = decideUpgradeGate(
    gateInput([], [], { repairs: [repairAction()], repairFacts: [repairFact()] }),
  );
  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(decision.repairs, [], "no action, no authorization");
  // ...and it is still REPORTED, because the drift is real and unresolved.
  assert.deepEqual(decision.remaining, [
    { subject: "alpha@1", class: "evidence-drifted", reason: null },
  ]);
});

// ---------------------------------------------------------------------------
// RULE 7 — portable and machine-local are different scopes
// ---------------------------------------------------------------------------

test("a PORTABLE repair carries the portable tuple AND the binding", () => {
  const decision = decideUpgradeGate(
    gateInput([], [action("evidence-repair", null, "alpha@1")], {
      repairs: [repairAction()],
      repairFacts: [repairFact()],
    }),
  );
  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.equal(decision.repairs.length, 1);
  assert.equal(decision.repairs[0].scope, "portable");
  assert.deepEqual(decision.repairs[0].portable, PORTABLE);
  assert.deepEqual(decision.repairs[0].binding, BINDING);
  assert.deepEqual(decision.remaining, [], "a repaired pack is not a remaining divergence");
});

test("a BINDING repair carries NO portable half — rule 7 in the type system", () => {
  for (const comparison of ["root-moved", "local-mismatch"] as const) {
    const decision = decideUpgradeGate(
      gateInput([], [action("evidence-repair", null, "alpha@1")], {
        repairs: [repairAction({ comparison, scope: "binding" })],
        repairFacts: [repairFact({ comparison })],
      }),
    );
    assert.ok(decision.ok, decision.ok ? "" : decision.detail);
    assert.equal(decision.repairs[0].scope, "binding");
    assert.equal(
      decision.repairs[0].portable,
      null,
      `\`${comparison}\` may never carry a portable tuple into the composer`,
    );
    assert.deepEqual(decision.repairs[0].binding, BINDING);
  }
});

test("the scope is DERIVED from the re-observed comparison, not read off the action", () => {
  // The approved action claims `binding` over a comparison that implies
  // `portable`. Trusting the action would write machine-local state into a shared
  // record, or leave the shared record wrong; deriving it catches the lie.
  const decision = decideUpgradeGate(
    gateInput([], [action("evidence-repair", null, "alpha@1")], {
      repairs: [repairAction({ comparison: "portable-mismatch", scope: "binding" })],
      repairFacts: [repairFact({ comparison: "portable-mismatch" })],
    }),
  );
  assert.ok(!decision.ok);
  assert.ok(!decision.ok && decision.reason === "apply/evidence-precondition");
});

test("a comparison that is not a repair at all is refused", () => {
  for (const comparison of ["equal", "binding-seed", "evidence-missing"] as const) {
    const decision = decideUpgradeGate(
      gateInput([], [action("evidence-repair", null, "alpha@1")], {
        repairs: [repairAction({ comparison })],
        repairFacts: [repairFact({ comparison })],
      }),
    );
    assert.ok(!decision.ok, `\`${comparison}\` is not a repairable state`);
  }
});

test("a repair whose drift RESOLVED ITSELF between plan and gate is refused", () => {
  const decision = decideUpgradeGate(
    gateInput([], [action("evidence-repair", null, "alpha@1")], {
      repairs: [repairAction({ comparison: "portable-mismatch" })],
      repairFacts: [repairFact({ comparison: "equal" })],
    }),
  );
  assert.ok(!decision.ok);
  assert.ok(!decision.ok && decision.detail.includes("alpha@1"));
});

test("a repair whose halves could not be observed is refused, and the record is preserved", () => {
  const noBinding = decideUpgradeGate(
    gateInput([], [action("evidence-repair", null, "alpha@1")], {
      repairs: [repairAction()],
      repairFacts: [repairFact({ observedBinding: null })],
    }),
  );
  assert.ok(!noBinding.ok);

  const noPortable = decideUpgradeGate(
    gateInput([], [action("evidence-repair", null, "alpha@1")], {
      repairs: [repairAction()],
      repairFacts: [repairFact({ observedPortable: null })],
    }),
  );
  assert.ok(!noPortable.ok);

  // A `binding` repair does NOT need the portable half, and must not be refused
  // for lacking one — that would be the scope confusion in the other direction.
  const bindingOnly = decideUpgradeGate(
    gateInput([], [action("evidence-repair", null, "alpha@1")], {
      repairs: [repairAction({ comparison: "root-moved", scope: "binding" })],
      repairFacts: [repairFact({ comparison: "root-moved", observedPortable: null })],
    }),
  );
  assert.ok(bindingOnly.ok, bindingOnly.ok ? "" : bindingOnly.detail);
  assert.equal(bindingOnly.repairs[0].portable, null);
});

// ---------------------------------------------------------------------------
// The read-only assessment — divergence is a property of the WORKSPACE
// ---------------------------------------------------------------------------

test("`collectRemainingDivergence` answers honestly with NO transaction at all", () => {
  // The refusal path: a plan rejected before any gate still has to say what the
  // workspace looks like, and this is the function that does it.
  const remaining = collectRemainingDivergence({
    currentFacts: [advanceFact(), editedFact()],
    inventoryTrustworthy: true,
    advancing: [],
    removing: [],
    repairFacts: [repairFact()],
    repairing: [],
  });
  assert.deepEqual(remaining, [
    { subject: "alpha@1", class: "evidence-drifted", reason: null },
    { subject: "docs/edited.md", class: "edited", reason: "divergent" },
    { subject: "docs/one.md", class: "unlisted", reason: "not-deselected" },
  ]);
});

test("a repaired pack and an advanced destination drop out of the remaining set", () => {
  const remaining = collectRemainingDivergence({
    currentFacts: [advanceFact()],
    inventoryTrustworthy: true,
    advancing: ["docs/one.md"],
    removing: [],
    repairFacts: [repairFact()],
    repairing: ["alpha@1"],
  });
  assert.deepEqual(remaining, []);
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Run the gate and fail loudly rather than let a test assert over a refusal. */
function decideOk(input: UpgradeGateInput) {
  const decision = decideUpgradeGate(input);
  assert.ok(decision.ok, decision.ok ? "" : `the gate refused: ${decision.detail}`);
  return decision;
}
