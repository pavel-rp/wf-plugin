// The pure whole-plan removal / bootstrap gate — contract tests (WF-458).
//
// Everything here runs with NO filesystem, NO lock, and NO ports. That is the
// point twice over: the module under test is structurally incapable of creating a
// journal, a backup, or of unlinking a byte, so "every refusal happens before any
// mutation" is proved by construction — and the one function in this runtime whose
// `ok` outcome authorizes DELETING A USER'S FILE is testable exhaustively, without
// ever putting a real file at risk.
//
// THE SIX PRESERVATION CLASSES ARE TESTED SEPARATELY, ONE TEST EACH. A single
// "nothing was deleted" assertion over a mixed fixture would pass just as happily
// if five of the six rules had been deleted, because one surviving rule would
// preserve everything. Each class therefore gets its own fact set, its own
// destination, and its own assertion that THAT class is the one that saved it.
//
// The write half is exercised in `apply-transaction.test.ts` (the crash matrix,
// including the deletion stages) and `apply-ports.test.ts` (real filesystem).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideRemovalGate,
  preservationClassFor,
  type LegacySeedFact,
  type PreservationClass,
  type RemovalGateInput,
} from "../src/resolver/apply-removal.js";
import { planArtifacts, type PlanArtifactFact } from "../src/resolver/artifact-plan.js";
import type {
  ArtifactEvidence,
  ArtifactOwner,
  PlanAction,
  PlanActionKind,
  PlanArtifactPreview,
  PlanEvidenceSeed,
  PortablePackEvidence,
} from "../src/resolver/types.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const SOURCE = "c".repeat(64);

const ALPHA: ArtifactOwner = { pluginId: "alpha@1", capability: "one", source: "one.md" };
const BETA: ArtifactOwner = { pluginId: "beta@1", capability: "two", source: "two.md" };

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function evidence(overrides: Partial<ArtifactEvidence> = {}): ArtifactEvidence {
  return {
    destination: "docs/one.md",
    owners: [ALPHA],
    declaredSourceFingerprint: SOURCE,
    producedContentHash: HASH_A,
    production: "copy",
    refresh: "replace-if-unmodified",
    removal: "delete-if-unmodified",
    ...overrides,
  };
}

function fact(overrides: Partial<PlanArtifactFact> = {}): PlanArtifactFact {
  const destination = overrides.destination ?? "docs/one.md";
  return {
    destination,
    target: { ok: true, canonicalTarget: `/ws/${destination}`, exists: true },
    recorded: evidence({ destination }),
    current: { ok: true, sha256: HASH_A, bytes: 12 },
    declared: null,
    declaringOwners: [],
    deselectedOwners: [ALPHA],
    ...overrides,
  };
}

function action(kind: PlanActionKind, destination: string | null, order = 1): PlanAction {
  return {
    kind,
    order,
    pluginId: destination === null ? "alpha@1" : null,
    destination,
    summary: `${kind} ${destination ?? ""}`,
    mutating: true,
    persisted: false,
  };
}

function preview(facts: readonly PlanArtifactFact[], trustworthy = true): PlanArtifactPreview {
  return planArtifacts(facts, { inventoryTrustworthy: trustworthy }).preview;
}

/** The gate input for one fact set, with the approved preview derived from the
 *  SAME facts unless a test deliberately hands in a stale one. */
function gateInput(
  facts: readonly PlanArtifactFact[],
  supported: readonly PlanAction[],
  overrides: Partial<RemovalGateInput> = {},
): RemovalGateInput {
  return {
    approved: preview(facts),
    supported,
    currentFacts: facts,
    inventoryTrustworthy: true,
    legacySeeds: [],
    legacyFacts: [],
    ...overrides,
  };
}

/** Run the gate over one fact set and return the class that preserved one
 *  destination, failing loudly if the gate refused or the destination is
 *  missing — so a test can never "pass" by asserting over an absent entry. */
function classOf(input: RemovalGateInput, destination: string): PreservationClass {
  const decision = decideRemovalGate(input);
  assert.ok(decision.ok, decision.ok ? "" : `the gate refused: ${decision.detail}`);
  const entry = decision.preserved.find((candidate) => candidate.destination === destination);
  assert.ok(entry, `\`${destination}\` must appear in the preserved set`);
  assert.equal(
    decision.removals.length,
    0,
    "a preservation fixture must authorize no removal at all",
  );
  return entry.class;
}

// ---------------------------------------------------------------------------
// the happy path — the ONE deletion class
// ---------------------------------------------------------------------------

test("the one deletion class: listed, hash-proven, exclusively owned", () => {
  const facts = [fact()];
  const decision = decideRemovalGate(
    gateInput(facts, [action("artifact-delete", "docs/one.md")]),
  );

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(
    decision.removals.map((removal) => removal.destination),
    ["docs/one.md"],
  );
  assert.equal(decision.removals[0].contentHash, HASH_A, "the proven digest travels with it");
  assert.equal(decision.removals[0].canonicalTarget, "/ws/docs/one.md");
  assert.deepEqual(decision.removals[0].owners, [ALPHA]);
  assert.deepEqual(decision.preserved, [], "nothing else was in scope to preserve");
});

// ---------------------------------------------------------------------------
// the six preservation classes — one test each, one destination each
// ---------------------------------------------------------------------------

test("preservation class 1/6 — RETAINED: the plan itself classified it as retained", () => {
  // Nothing deselected and the source unchanged: the ordinary keep.
  const facts = [fact({ deselectedOwners: [] })];
  assert.equal(classOf(gateInput(facts, []), "docs/one.md"), "retained");
});

test("preservation class 2/6 — UNLISTED: deletable NOW, but the confirmation names it not", () => {
  // The SAME fact set as the happy path, minus the action. Deletion authority is
  // fully proven and still not exercised: one confirmation authorizes only the
  // exact listed actions, however obviously the deselection implies this one.
  const facts = [fact()];
  const decision = decideRemovalGate(gateInput(facts, []));

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(decision.removals, [], "an unlisted deletable artifact is NOT deleted");
  assert.equal(classOf(gateInput(facts, []), "docs/one.md"), "unlisted");
  // And the proof that this is rule 5 and not an accident of the fixture: the
  // very same facts DO authorize a removal once the plan lists it.
  const listed = decideRemovalGate(gateInput(facts, [action("artifact-delete", "docs/one.md")]));
  assert.ok(listed.ok && listed.removals.length === 1);
});

test("preservation class 3/6 — SHARED: a recorded owner survives the plan", () => {
  const facts = [
    fact({
      recorded: evidence({ owners: [ALPHA, BETA] }),
      deselectedOwners: [ALPHA],
    }),
  ];
  assert.equal(classOf(gateInput(facts, []), "docs/one.md"), "shared");
});

test("preservation class 4/6 — EDITED: current bytes differ from the prior ledger hash", () => {
  const facts = [fact({ current: { ok: true, sha256: HASH_B, bytes: 12 } })];
  assert.equal(classOf(gateInput(facts, []), "docs/one.md"), "edited");
});

test("preservation class 5/6 — AMBIGUOUS: a digest is present but not well-formed", () => {
  // WF-449's HIGH defect, restated as a preservation. Two matching MALFORMED
  // digests must never establish identity: the file is kept, and kept under the
  // class that says we could not reason about it rather than under `retained`.
  const facts = [
    fact({
      recorded: evidence({ producedContentHash: "not-a-digest" }),
      current: { ok: true, sha256: "not-a-digest", bytes: 12 },
    }),
  ];
  assert.equal(classOf(gateInput(facts, []), "docs/one.md"), "ambiguous");
});

test("preservation class 6/6 — UNVERIFIABLE: the bytes could not be established at all", () => {
  const facts = [fact({ current: { ok: false, status: "unreadable" } })];
  assert.equal(classOf(gateInput(facts, []), "docs/one.md"), "unverifiable");
});

test("all six classes are reachable in ONE plan, and each names its own destination", () => {
  // The mixed fixture runs LAST, after each class has been proven separately, so
  // it tests the partition rather than standing in for the six rules.
  const facts = [
    fact({ destination: "a.md", deselectedOwners: [] }),
    fact({ destination: "b.md" }),
    fact({
      destination: "c.md",
      recorded: evidence({ destination: "c.md", owners: [ALPHA, BETA] }),
    }),
    fact({ destination: "d.md", current: { ok: true, sha256: HASH_B, bytes: 1 } }),
    fact({
      destination: "e.md",
      recorded: evidence({ destination: "e.md", producedContentHash: "short" }),
      current: { ok: true, sha256: "short", bytes: 1 },
    }),
    fact({ destination: "f.md", current: { ok: false, status: "unreadable" } }),
  ];
  const decision = decideRemovalGate(gateInput(facts, []));
  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(
    decision.preserved.map((entry) => [entry.destination, entry.class]),
    [
      ["a.md", "retained"],
      ["b.md", "unlisted"],
      ["c.md", "shared"],
      ["d.md", "edited"],
      ["e.md", "ambiguous"],
      ["f.md", "unverifiable"],
    ],
  );
  assert.deepEqual(decision.removals, [], "no destination was listed, so none is removed");
});

test("an unrecognised retention reason falls to the MOST CONSERVATIVE class", () => {
  // The default arm exists so a reason a future release adds preserves rather
  // than inheriting whichever class happened to be last in the switch.
  assert.equal(
    preservationClassFor("future-reason-nobody-has-written-yet" as never),
    "unverifiable",
  );
  assert.equal(preservationClassFor(null), "unverifiable");
});

// ---------------------------------------------------------------------------
// rule 4 — bootstrap and deletion never touch the same artifact
// ---------------------------------------------------------------------------

test("SC-4: one destination carrying BOTH a bootstrap and a deletion refuses the whole plan", () => {
  const facts = [fact()];
  const decision = decideRemovalGate(
    gateInput(facts, [
      action("artifact-bootstrap", "docs/one.md", 1),
      action("artifact-delete", "docs/one.md", 2),
    ]),
  );

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/bootstrap-delete-conflict");
  assert.match(decision.detail, /docs\/one\.md/);
  assert.match(decision.detail, /never doubles as authority/);
});

test("SC-4: the conflict is checked FIRST, before any world-state comparison", () => {
  // The approved preview is deliberately stale here too, which would otherwise
  // refuse with `apply/artifact-precondition`. The conflict must still win: a plan
  // that contradicts ITSELF says nothing reliable about the world either, and
  // reporting the neighbouring failure class would send a maintainer to the wrong
  // question entirely.
  const facts = [fact()];
  const decision = decideRemovalGate(
    gateInput(facts, [
      action("artifact-bootstrap", "docs/one.md", 1),
      action("artifact-delete", "docs/one.md", 2),
    ]),
    { approved: preview([fact({ destination: "vanished.md" })]) },
  );

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/bootstrap-delete-conflict");
});

test("SC-4: a bootstrap retains EVERY candidate and grants NO same-plan deletion", () => {
  // Every proven owner is ALSO deselected — the strongest possible case for
  // "surely you meant to delete it". The classification is `bootstrap` with
  // `bootstrap-defers-deletion`, the gate authorizes the bootstrap, and it
  // authorizes no removal whatsoever.
  const facts = [
    fact({
      recorded: null,
      declared: {
        declaredSourceFingerprint: SOURCE,
        producedContentHash: HASH_A,
        owners: [ALPHA],
        production: "copy",
        refresh: "replace-if-unmodified",
        removal: "delete-if-unmodified",
      },
      deselectedOwners: [ALPHA],
    }),
  ];
  const decision = decideRemovalGate(
    gateInput(facts, [action("artifact-bootstrap", "docs/one.md")]),
  );

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.equal(decision.bootstraps.length, 1);
  assert.deepEqual(decision.bootstraps[0].owners, [ALPHA]);
  assert.equal(decision.bootstraps[0].producedContentHash, HASH_A);
  assert.deepEqual(decision.removals, [], "a bootstrap grants no deletion in the same plan");
});

test("a bootstrapped destination is NOT reported as an unlisted preservation", () => {
  // It is acted on, so it belongs to `bootstraps` and to no preservation class —
  // otherwise a reader could not tell "kept and recorded" from "kept and ignored".
  const facts = [
    fact({
      recorded: null,
      declared: {
        declaredSourceFingerprint: SOURCE,
        producedContentHash: HASH_A,
        owners: [ALPHA],
        production: "copy",
        refresh: "replace-if-unmodified",
        removal: "delete-if-unmodified",
      },
      deselectedOwners: [],
    }),
  ];
  const decision = decideRemovalGate(
    gateInput(facts, [action("artifact-bootstrap", "docs/one.md")]),
  );
  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(decision.preserved, []);
});

// ---------------------------------------------------------------------------
// rule 1 + 5 — the whole-plan gate and the exact manifest
// ---------------------------------------------------------------------------

test("SC-1: a changed bound precondition rejects the WHOLE plan, not just its own action", () => {
  // Two independent removals. The world moved under exactly one of them — the
  // other is still perfectly provable — and BOTH are refused.
  const approvedFacts = [fact({ destination: "a.md" }), fact({ destination: "b.md" })];
  const currentFacts = [
    fact({ destination: "a.md" }),
    fact({ destination: "b.md", current: { ok: true, sha256: HASH_B, bytes: 9 } }),
  ];
  const decision = decideRemovalGate({
    approved: preview(approvedFacts),
    supported: [
      action("artifact-delete", "a.md", 1),
      action("artifact-delete", "b.md", 2),
    ],
    currentFacts,
    inventoryTrustworthy: true,
    legacySeeds: [],
    legacyFacts: [],
  });

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
  assert.match(decision.detail, /b\.md/);
  assert.match(decision.detail, /rejects the WHOLE plan/);
});

test("SC-1: a destination that VANISHED from the fact set is a moved precondition too", () => {
  const decision = decideRemovalGate({
    approved: preview([fact({ destination: "a.md" })]),
    supported: [],
    currentFacts: [],
    inventoryTrustworthy: true,
    legacySeeds: [],
    legacyFacts: [],
  });

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
  assert.match(decision.detail, /no longer a managed artifact/);
});

test("SC-1: an owner set that moved while the digest held still rejects the plan", () => {
  // The subtlest drift: bytes unchanged, path unchanged, but a co-owner appeared.
  // Comparing only the digest would license deleting a file the new owner never
  // agreed to.
  const approvedFacts = [fact()];
  const currentFacts = [
    fact({
      recorded: evidence({ owners: [ALPHA, BETA] }),
      deselectedOwners: [ALPHA],
    }),
  ];
  const decision = decideRemovalGate({
    approved: preview(approvedFacts),
    supported: [action("artifact-delete", "docs/one.md")],
    currentFacts,
    inventoryTrustworthy: true,
    legacySeeds: [],
    legacyFacts: [],
  });

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
});

test("SC-1: two deletions of one destination refuse before anything is authorized", () => {
  const facts = [fact()];
  const decision = decideRemovalGate(
    gateInput(facts, [
      action("artifact-delete", "docs/one.md", 1),
      action("artifact-delete", "docs/one.md", 2),
    ]),
  );

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
  assert.match(decision.detail, /more than one deletion/);
});

test("SC-1: a deletion action naming no destination refuses the whole plan", () => {
  const facts = [fact()];
  const decision = decideRemovalGate(gateInput(facts, [action("artifact-delete", null)]));

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
  assert.match(decision.detail, /names no destination/);
});

test("SC-1: a listed deletion whose current form is NOT deletable refuses the whole plan", () => {
  // The approved preview and the current facts agree — the plan simply lists a
  // destination the classification never made deletable. Every conjunct is
  // restated at the authorization point, so this cannot slip through on the
  // strength of the plan having named it.
  const facts = [fact({ deselectedOwners: [] })];
  const decision = decideRemovalGate(
    gateInput(facts, [action("artifact-delete", "docs/one.md")]),
  );

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
  assert.match(decision.detail, /every removal conjunct/);
});

test("SC-1: `removal: retain` is never deleted, however exclusive the ownership", () => {
  const facts = [
    fact({ recorded: evidence({ removal: "retain" }) }),
  ];
  const decision = decideRemovalGate(gateInput(facts, []));
  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(decision.removals, []);
  assert.equal(classOf(gateInput(facts, []), "docs/one.md"), "ambiguous");
});

// ---------------------------------------------------------------------------
// rule 6 — the legacy portable seed, whole or not at all
// ---------------------------------------------------------------------------

function portableTuple(overrides: Partial<PortablePackEvidence> = {}): PortablePackEvidence {
  return {
    pluginId: "alpha@1",
    version: "1.0.0",
    capabilities: ["one"],
    manifestHashes: [{ path: "manifest.md", sha256: HASH_A }],
    declaredSourceHashes: [{ path: "one.md", sha256: HASH_B }],
    ...overrides,
  };
}

function legacySeed(portable: PortablePackEvidence | null): PlanEvidenceSeed {
  return {
    pluginId: "alpha@1",
    kind: "legacy-bootstrap",
    comparison: "evidence-missing",
    portable,
    binding: {
      pluginId: "alpha@1",
      canonicalRoot: "/packs/alpha",
      cliScope: null,
      enablement: "enabled",
      observedVersion: "1.0.0",
      localFingerprints: [],
    },
    persisted: false,
  };
}

function legacyFact(overrides: Partial<LegacySeedFact> = {}): LegacySeedFact {
  return {
    pluginId: "alpha@1",
    observed: portableTuple(),
    portableAbsent: true,
    ...overrides,
  };
}

test("SC-6: a complete, fresh, exactly-equal legacy tuple is authorized whole", () => {
  const decision = decideRemovalGate(
    gateInput([], [], {
      legacySeeds: [legacySeed(portableTuple())],
      legacyFacts: [legacyFact()],
    }),
  );

  assert.ok(decision.ok, decision.ok ? "" : decision.detail);
  assert.deepEqual(
    decision.legacy.map((entry) => entry.pluginId),
    ["alpha@1"],
  );
  // The OBSERVED tuple is what gets recorded, never the plan's copy of it.
  assert.deepEqual(decision.legacy[0].portable, portableTuple());
});

test("SC-6: proof that could not be reproduced under the lock PRESERVES the registration", () => {
  const decision = decideRemovalGate(
    gateInput([], [], {
      legacySeeds: [legacySeed(portableTuple())],
      legacyFacts: [legacyFact({ observed: null })],
    }),
  );

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/evidence-precondition");
  assert.match(decision.detail, /registration is preserved/);
  assert.match(decision.detail, /no partial tuple was recorded/);
});

test("SC-6: a pack that ACQUIRED portable evidence since approval is stale, not overwritten", () => {
  const decision = decideRemovalGate(
    gateInput([], [], {
      legacySeeds: [legacySeed(portableTuple())],
      legacyFacts: [legacyFact({ portableAbsent: false })],
    }),
  );

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/evidence-precondition");
  assert.match(decision.detail, /never broadens stale authority/);
});

test("SC-6: an INCOMPLETE observed tuple is refused rather than trimmed", () => {
  // A partial tuple is strictly worse than none, because it looks authoritative.
  for (const incomplete of [
    portableTuple({ manifestHashes: [] }),
    portableTuple({ capabilities: [] }),
    portableTuple({ version: "" }),
    portableTuple({ manifestHashes: [{ path: "manifest.md", sha256: "short" }] }),
    portableTuple({ declaredSourceHashes: [{ path: "one.md", sha256: "" }] }),
  ]) {
    const decision = decideRemovalGate(
      gateInput([], [], {
        legacySeeds: [legacySeed(incomplete)],
        legacyFacts: [legacyFact({ observed: incomplete })],
      }),
    );
    assert.ok(!decision.ok, "an incomplete tuple must never be authorized");
    assert.equal(decision.reason, "apply/evidence-precondition");
    assert.match(decision.detail, /whole or not at all/);
  }
});

test("SC-6: a tuple that is not EXACTLY the approved one is refused", () => {
  const decision = decideRemovalGate(
    gateInput([], [], {
      legacySeeds: [legacySeed(portableTuple({ version: "1.0.0" }))],
      legacyFacts: [legacyFact({ observed: portableTuple({ version: "2.0.0" }) })],
    }),
  );

  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/evidence-precondition");
  assert.match(decision.detail, /not EXACTLY the tuple/);
});

test("SC-6: tuple equality ignores ORDER but not CONTENT", () => {
  const left = portableTuple({
    capabilities: ["one", "two"],
    manifestHashes: [
      { path: "a.md", sha256: HASH_A },
      { path: "b.md", sha256: HASH_B },
    ],
  });
  const right = portableTuple({
    capabilities: ["two", "one"],
    manifestHashes: [
      { path: "b.md", sha256: HASH_B },
      { path: "a.md", sha256: HASH_A },
    ],
  });
  const same = decideRemovalGate(
    gateInput([], [], { legacySeeds: [legacySeed(left)], legacyFacts: [legacyFact({ observed: right })] }),
  );
  assert.ok(same.ok, same.ok ? "" : same.detail);

  const different = decideRemovalGate(
    gateInput([], [], {
      legacySeeds: [legacySeed(left)],
      legacyFacts: [
        legacyFact({
          observed: portableTuple({
            capabilities: ["one", "two"],
            manifestHashes: [
              { path: "a.md", sha256: HASH_A },
              { path: "b.md", sha256: HASH_A },
            ],
          }),
        }),
      ],
    }),
  );
  assert.ok(!different.ok, "a changed digest is a changed tuple");
});

// ---------------------------------------------------------------------------
// rule 3 — the destructive path is never laxer than the preserving one
// ---------------------------------------------------------------------------

test("SC-3: no input shape reaches an authorized removal without a well-formed digest PAIR", () => {
  // The WF-449 asymmetry, swept as a property rather than as one example. Every
  // digest shape that is not a well-formed SHA-256 must preserve, on either side
  // of the comparison — including the case where both sides MATCH.
  const malformed = ["", "short", "  ", "A".repeat(64), "z".repeat(64), `${HASH_A} `];
  for (const value of malformed) {
    for (const facts of [
      [fact({ recorded: evidence({ producedContentHash: value }) })],
      [fact({ current: { ok: true, sha256: value, bytes: 1 } })],
      [
        fact({
          recorded: evidence({ producedContentHash: value }),
          current: { ok: true, sha256: value, bytes: 1 },
        }),
      ],
    ]) {
      const decision = decideRemovalGate(
        gateInput(facts, [action("artifact-delete", "docs/one.md")]),
      );
      assert.ok(
        !decision.ok,
        `digest \`${value}\` must never authorize a deletion (matching or not)`,
      );
    }
  }
});

test("SC-3: an ownerless recorded proof never authorizes a deletion", () => {
  const facts = [fact({ recorded: evidence({ owners: [] }), deselectedOwners: [] })];
  const decision = decideRemovalGate(
    gateInput(facts, [action("artifact-delete", "docs/one.md")]),
  );
  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
});

test("SC-3: an unsafe destination never authorizes a deletion", () => {
  const facts = [fact({ target: { ok: false, rejection: "traversal" } })];
  const decision = decideRemovalGate(
    gateInput(facts, [action("artifact-delete", "docs/one.md")]),
  );
  assert.ok(!decision.ok);
  assert.equal(decision.reason, "apply/artifact-precondition");
});

// ---------------------------------------------------------------------------
// purity
// ---------------------------------------------------------------------------

test("the gate is pure: identical facts decide identically, in any order, mutating nothing", () => {
  const facts = [
    fact({ destination: "b.md" }),
    fact({ destination: "a.md", deselectedOwners: [] }),
    fact({ destination: "c.md", current: { ok: true, sha256: HASH_B, bytes: 1 } }),
  ];
  const frozen = JSON.stringify(facts);

  const forward = decideRemovalGate(gateInput(facts, [action("artifact-delete", "b.md")]));
  const reversed = decideRemovalGate(
    gateInput([...facts].reverse(), [action("artifact-delete", "b.md")]),
  );

  assert.deepEqual(forward, reversed, "input order must not change the decision");
  assert.equal(JSON.stringify(facts), frozen, "no input object may be mutated");
});
