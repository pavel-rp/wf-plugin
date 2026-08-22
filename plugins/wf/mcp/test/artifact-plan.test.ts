// Evidence-safe removal/upgrade contract tests (WF-449).
//
// Two layers, each chosen because the property under test lives there:
//   - the PURE JOIN (`planArtifacts`) is driven directly, because the entire
//     proof matrix — conjunctive deletion eligibility, bootstrap applicability,
//     hash-gated advance, divergence, and the ownerless rule — is a property of
//     that function and needs no filesystem at all;
//   - the ENVELOPE (`planInstall`) is driven to prove the preview folds into
//     WF-447's single plan lineage: one `artifacts` block, findings on the one
//     shared list, deselection derived from the plan's OWN registry delta, and
//     applicability reached through the existing precedence.
//
// The suite's spine is the table-driven walk over EVERY retention reason
// asserting `deletionAuthority === false`. That is the one property this slice
// exists to guarantee, so it is tested exhaustively rather than by sampling.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyArtifactPreview,
  hasPreviewedArtifactEffect,
  planArtifacts,
  type PlanArtifactDeclaration,
  type PlanArtifactFact,
} from "../src/resolver/artifact-plan.js";
import {
  planInstall,
  type PlanCapabilityInput,
  type PlanInstallInput,
} from "../src/resolver/plan-install.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";
import {
  PLAN_ENVELOPE_VERSION,
  type ArtifactEvidence,
  type ArtifactOwner,
  type DiscoveredPack,
  type DiscoveryInventory,
  type MachineBindingEvidence,
  type PayloadSemantics,
  type PlanAdmissionState,
  type PlanArtifactRetentionReason,
  type PortablePackEvidence,
} from "../src/resolver/types.js";

// --- fixtures ----------------------------------------------------------------

const LEDGER_HASH = "1".repeat(64); // the bytes the ledger recorded
const EDITED_HASH = "2".repeat(64); // bytes someone changed by hand
const SRC_OLD = "3".repeat(64);
const SRC_NEW = "4".repeat(64);

const OWNER_A: ArtifactOwner = { pluginId: "a@local", capability: "alpha", source: "p/a.md" };
const OWNER_B: ArtifactOwner = { pluginId: "b@local", capability: "beta", source: "p/b.md" };

const COPY: PayloadSemantics = {
  production: "copy",
  refresh: "replace-if-unmodified",
  removal: "delete-if-unmodified",
};

const TRUST = { inventoryTrustworthy: true };

function recorded(over: Partial<ArtifactEvidence> = {}): ArtifactEvidence {
  return {
    destination: ".wf/thing.md",
    owners: [OWNER_A],
    declaredSourceFingerprint: SRC_OLD,
    producedContentHash: LEDGER_HASH,
    ...COPY,
    ...over,
  };
}

function declared(over: Partial<PlanArtifactDeclaration> = {}): PlanArtifactDeclaration {
  return {
    declaredSourceFingerprint: SRC_OLD,
    producedContentHash: LEDGER_HASH,
    owners: [OWNER_A],
    ...COPY,
    ...over,
  };
}

function fact(over: Partial<PlanArtifactFact> = {}): PlanArtifactFact {
  return {
    destination: ".wf/thing.md",
    target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: true },
    recorded: recorded(),
    current: { ok: true, sha256: LEDGER_HASH, bytes: 10 },
    declared: null,
    deselectedOwners: [],
    ...over,
  };
}

const codes = (out: { findings: Array<{ code: string }> }): string[] =>
  out.findings.map((f) => f.code);

const only = (out: ReturnType<typeof planArtifacts>) => {
  const all = [
    ...out.preview.deletable,
    ...out.preview.retained,
    ...out.preview.bootstrap,
    ...out.preview.advance,
  ];
  assert.equal(all.length, 1, "fixture yields exactly one decision");
  return all[0];
};

// --- SC1: deletion eligibility is CONJUNCTIVE --------------------------------

test("explicit deselection + matching current bytes + exclusive ownership yields deletable", () => {
  const out = planArtifacts([fact({ deselectedOwners: [OWNER_A] })], TRUST);

  assert.equal(out.preview.deletable.length, 1);
  assert.deepEqual(out.preview.retained, []);
  const decision = out.preview.deletable[0];
  assert.equal(decision.form, "deletable");
  assert.equal(decision.reason, null, "the deletable form is the ONLY one with a null reason");
  assert.equal(decision.deletionAuthority, true);
  assert.equal(decision.bytesMatchLedger, true);
  assert.equal(decision.runnerCandidate, true);
  assert.equal(decision.persisted, false, "planning persists nothing");
  assert.equal(decision.recordedContentHash, LEDGER_HASH);
  assert.equal(decision.currentContentHash, LEDGER_HASH);
  assert.deepEqual(decision.owners, [OWNER_A]);
  assert.deepEqual(codes(out), ["plan/artifact-deletable"]);
  assert.equal(out.findings[0].severity, "warning", "a destructive preview is flagged");
});

test("dropping ANY ONE of the three conjuncts retains instead of deleting", () => {
  // conjunct 1: no explicit deselection
  assert.equal(only(planArtifacts([fact()], TRUST)).reason, "not-deselected");
  // conjunct 2: current bytes do not match the prior ledger hash
  assert.equal(
    only(
      planArtifacts(
        [fact({ deselectedOwners: [OWNER_A], current: { ok: true, sha256: EDITED_HASH, bytes: 9 } })],
        TRUST,
      ),
    ).reason,
    "current-bytes-mismatch",
  );
  // conjunct 3: ownership is not exclusive — B survives the plan
  assert.equal(
    only(
      planArtifacts(
        [fact({ recorded: recorded({ owners: [OWNER_A, OWNER_B] }), deselectedOwners: [OWNER_A] })],
        TRUST,
      ),
    ).reason,
    "shared-ownership",
  );
});

test("a CURRENT declarer the ledger never recorded blocks deletion (WF-476)", () => {
  // Exclusivity is proven against the LEDGER's owner set, and apply records that
  // set from the acted-on packs only — so a still-registered pack that was never
  // selected can declare this destination without ever being recorded against
  // it. Read naively, its absence from `recordedOwners` says "not an owner"
  // rather than "owner we failed to record", and deselecting the one recorded
  // owner would delete a file the surviving co-declarer never agreed to remove.
  // Exclusivity is therefore re-derived against the CURRENT declaration too.
  const decision = only(
    planArtifacts(
      [
        fact({
          recorded: recorded({ owners: [OWNER_A] }),
          declared: declared({ owners: [OWNER_A, OWNER_B] }),
          deselectedOwners: [OWNER_A],
        }),
      ],
      TRUST,
    ),
  );

  assert.equal(decision.form, "retained");
  assert.equal(decision.reason, "shared-ownership");
  assert.equal(decision.deletionAuthority, false);
});

test("deletion still proceeds when every current declarer IS a recorded owner", () => {
  // The control for the guard above: re-deriving exclusivity must not make the
  // ordinary removal unreachable. Same shape, minus the unrecorded declarer.
  const decision = only(
    planArtifacts(
      [
        fact({
          recorded: recorded({ owners: [OWNER_A] }),
          declared: declared({ owners: [OWNER_A] }),
          deselectedOwners: [OWNER_A],
        }),
      ],
      TRUST,
    ),
  );

  assert.equal(decision.form, "deletable");
  assert.equal(decision.deletionAuthority, true);
});

// --- SC2 / SC3: edited and shared files are retained WITH REASONS ------------

test("an edited file is retained with a reason and never deletable", () => {
  const out = planArtifacts(
    [fact({ deselectedOwners: [OWNER_A], current: { ok: true, sha256: EDITED_HASH, bytes: 9 } })],
    TRUST,
  );
  const decision = only(out);
  assert.equal(decision.form, "retained");
  assert.equal(decision.reason, "current-bytes-mismatch");
  assert.equal(decision.deletionAuthority, false);
  assert.equal(decision.bytesMatchLedger, false);
  assert.equal(decision.runnerCandidate, false);
  assert.deepEqual(codes(out), ["plan/artifact-retained"]);
  assert.match(out.findings[0].message, /grants no deletion authority/);
});

test("a shared file is retained even when one owner is fully deselected", () => {
  const decision = only(
    planArtifacts(
      [fact({ recorded: recorded({ owners: [OWNER_B, OWNER_A] }), deselectedOwners: [OWNER_B] })],
      TRUST,
    ),
  );
  assert.equal(decision.reason, "shared-ownership");
  assert.equal(decision.deletionAuthority, false);
  assert.deepEqual(decision.owners, [OWNER_A, OWNER_B], "owners are reported sorted, in full");
});

test("`removal: retain` refuses deletion even when every other conjunct holds", () => {
  const decision = only(
    planArtifacts(
      [fact({ recorded: recorded({ removal: "retain" }), deselectedOwners: [OWNER_A] })],
      TRUST,
    ),
  );
  assert.equal(decision.reason, "removal-semantics-retain");
  assert.equal(decision.deletionAuthority, false);
});

// --- SC4: bootstrap applicability requires EVERY precondition ----------------

test("a missing-ledger artifact with complete proof and a trustworthy inventory bootstraps", () => {
  const out = planArtifacts([fact({ recorded: null, declared: declared() })], TRUST);

  assert.equal(out.preview.bootstrap.length, 1);
  const decision = out.preview.bootstrap[0];
  assert.equal(decision.form, "bootstrap");
  assert.equal(decision.deletionAuthority, false, "bootstrap NEVER grants deletion");
  assert.equal(decision.runnerCandidate, true, "it does leave the runner future authority to record");
  assert.equal(decision.persisted, false);
  assert.equal(decision.recordedContentHash, null);
  assert.deepEqual(decision.semantics, COPY, "the FULL semantic tuple is carried");
  assert.deepEqual(codes(out), ["plan/artifact-bootstrap-previewed"]);
});

const BOOTSTRAP_BLOCKERS: Array<[PlanArtifactRetentionReason, Partial<PlanArtifactFact>, boolean]> = [
  // [expected reason, fact override, inventory trustworthy]
  ["inventory-untrustworthy", { recorded: null, declared: declared() }, false],
  ["no-recorded-proof", { recorded: null, declared: null }, true],
  ["ownership-incomplete", { recorded: null, declared: declared({ owners: [] }) }, true],
  [
    "source-fingerprint-missing",
    { recorded: null, declared: declared({ declaredSourceFingerprint: "not-a-digest" }) },
    true,
  ],
  [
    "semantics-incomplete",
    {
      recorded: null,
      declared: declared({ refresh: "sometimes" as PayloadSemantics["refresh"] }),
    },
    true,
  ],
  [
    "not-reproducible",
    { recorded: null, declared: declared({ producedContentHash: SRC_NEW }) },
    true,
  ],
  [
    "destination-unsafe",
    { recorded: null, declared: declared(), target: { ok: false, rejection: "traversal" } },
    true,
  ],
  [
    "current-bytes-unreadable",
    { recorded: null, declared: declared(), current: { ok: false, status: "missing" } },
    true,
  ],
];

for (const [reason, over, trustworthy] of BOOTSTRAP_BLOCKERS) {
  test(`bootstrap is NOT applicable when proof fails as \`${reason}\``, () => {
    const out = planArtifacts([fact(over)], { inventoryTrustworthy: trustworthy });
    assert.deepEqual(out.preview.bootstrap, [], "no bootstrap is previewed from partial proof");
    const decision = only(out);
    assert.equal(decision.form, "retained");
    assert.equal(decision.reason, reason);
    assert.equal(decision.deletionAuthority, false);
  });
}

// --- SC6: bootstrap persists future authority but never deletes NOW ----------

test("a bootstrappable artifact whose every owner is deselected still bootstraps, never deletes", () => {
  const out = planArtifacts(
    [fact({ recorded: null, declared: declared(), deselectedOwners: [OWNER_A] })],
    TRUST,
  );

  assert.deepEqual(out.preview.deletable, [], "proving ownership now does not license removing now");
  assert.equal(out.preview.bootstrap.length, 1);
  const decision = out.preview.bootstrap[0];
  assert.equal(decision.form, "bootstrap");
  assert.equal(decision.reason, "bootstrap-defers-deletion", "the two-step is stated, not implied");
  assert.equal(decision.deletionAuthority, false);
});

// --- SC7: upgrade is HASH-GATED, edits stay divergent ------------------------

test("a source-changed artifact advances when current bytes match the prior ledger hash", () => {
  const out = planArtifacts(
    [fact({ declared: declared({ declaredSourceFingerprint: SRC_NEW }) })],
    TRUST,
  );

  assert.equal(out.preview.advance.length, 1);
  const decision = out.preview.advance[0];
  assert.equal(decision.form, "advance");
  assert.equal(decision.fullyUpgraded, true);
  assert.equal(decision.bytesMatchLedger, true);
  assert.equal(decision.deletionAuthority, false, "an upgrade is not a removal");
  assert.equal(decision.runnerCandidate, true);
  assert.deepEqual(codes(out), ["plan/artifact-advance"]);
});

test("a source-changed artifact that was locally EDITED stays divergent and not fully upgraded", () => {
  const out = planArtifacts(
    [
      fact({
        declared: declared({ declaredSourceFingerprint: SRC_NEW }),
        current: { ok: true, sha256: EDITED_HASH, bytes: 9 },
      }),
    ],
    TRUST,
  );

  assert.deepEqual(out.preview.advance, [], "an edit is never silently overwritten");
  const decision = only(out);
  assert.equal(decision.form, "retained");
  assert.equal(decision.reason, "divergent");
  assert.equal(decision.fullyUpgraded, false);
  assert.equal(decision.deletionAuthority, false);
  assert.deepEqual(codes(out), ["plan/artifact-divergent"]);
  assert.equal(out.findings[0].severity, "warning");
});

test("`refresh: retain` refuses the advance even at a clean hash match", () => {
  const decision = only(
    planArtifacts(
      [
        fact({
          recorded: recorded({ refresh: "retain" }),
          declared: declared({ declaredSourceFingerprint: SRC_NEW }),
        }),
      ],
      TRUST,
    ),
  );
  assert.equal(decision.reason, "refresh-semantics-retain");
  assert.equal(decision.fullyUpgraded, false);
});

test("an UNCHANGED source is a plain retention, not an advance", () => {
  const decision = only(planArtifacts([fact({ declared: declared() })], TRUST));
  assert.equal(decision.form, "retained");
  assert.equal(decision.reason, "not-deselected");
  assert.equal(decision.runnerCandidate, false);
});

// --- SC8: ownerless payloads follow the SAME rules ---------------------------

test("an ownerless recorded artifact is never deletable — empty is not exclusive", () => {
  const decision = only(
    planArtifacts(
      [fact({ recorded: recorded({ owners: [] }), deselectedOwners: [OWNER_A, OWNER_B] })],
      TRUST,
    ),
  );
  assert.equal(decision.form, "retained");
  assert.equal(decision.reason, "ownership-incomplete");
  assert.equal(decision.deletionAuthority, false);
  assert.deepEqual(decision.owners, [], "the empty owner set is reported honestly");
});

// --- regression (verify run 1, Finding 1): malformed digests are not evidence -
//
// The bootstrap path already gated on digest well-formedness before trusting
// reproduced bytes; the removal path did not, so two MATCHING MALFORMED digests
// satisfied the byte-match conjunct and granted deletion authority over a file
// whose identity was never established. The destructive path must be at least as
// strict as the non-destructive one.

for (const digest of ["", "not-a-digest", "abc123", "A".repeat(64)]) {
  test(`matching but MALFORMED digests (\`${digest}\`) never grant deletion authority`, () => {
    const decision = only(
      planArtifacts(
        [
          fact({
            recorded: recorded({ producedContentHash: digest }),
            current: { ok: true, sha256: digest, bytes: 10 },
            deselectedOwners: [OWNER_A],
          }),
        ],
        TRUST,
      ),
    );
    assert.equal(decision.form, "retained", "a malformed pair is never deletable");
    assert.equal(decision.reason, "digest-malformed");
    assert.equal(decision.deletionAuthority, false);
    assert.equal(
      decision.bytesMatchLedger,
      false,
      "a match between malformed digests is not reported as a ledger match",
    );
  });
}

test("malformed digests block the UPGRADE path too, not just removal", () => {
  const decision = only(
    planArtifacts(
      [
        fact({
          recorded: recorded({ producedContentHash: "short" }),
          current: { ok: true, sha256: "short", bytes: 10 },
          declared: declared({ declaredSourceFingerprint: SRC_NEW }),
        }),
      ],
      TRUST,
    ),
  );
  assert.equal(decision.reason, "digest-malformed");
  assert.equal(decision.fullyUpgraded, false);
  assert.equal(decision.runnerCandidate, false);
});

test("the removal path is at least as strict as the bootstrap path on digests", () => {
  // Same malformed digest, once through bootstrap and once through removal.
  const viaBootstrap = only(
    planArtifacts(
      [
        fact({
          recorded: null,
          declared: declared({ producedContentHash: "bad" }),
          current: { ok: true, sha256: "bad", bytes: 10 },
        }),
      ],
      TRUST,
    ),
  );
  const viaRemoval = only(
    planArtifacts(
      [
        fact({
          recorded: recorded({ producedContentHash: "bad" }),
          current: { ok: true, sha256: "bad", bytes: 10 },
          deselectedOwners: [OWNER_A],
        }),
      ],
      TRUST,
    ),
  );
  assert.equal(viaBootstrap.form, "retained");
  assert.equal(viaRemoval.form, "retained", "the destructive path is never the laxer one");
  assert.equal(viaBootstrap.deletionAuthority, false);
  assert.equal(viaRemoval.deletionAuthority, false);
});

// --- SC5: EVERY retention reason grants no deletion authority ----------------

const EVERY_REASON: Array<[PlanArtifactRetentionReason, Partial<PlanArtifactFact>, boolean]> = [
  ["not-deselected", {}, true],
  ["shared-ownership", { recorded: recorded({ owners: [OWNER_A, OWNER_B] }), deselectedOwners: [OWNER_A] }, true],
  ["ownership-incomplete", { recorded: recorded({ owners: [] }) }, true],
  [
    "current-bytes-mismatch",
    { deselectedOwners: [OWNER_A], current: { ok: true, sha256: EDITED_HASH, bytes: 9 } },
    true,
  ],
  ["current-bytes-unreadable", { current: { ok: false, status: "unreadable" } }, true],
  [
    "digest-malformed",
    { recorded: recorded({ producedContentHash: "bad" }), current: { ok: true, sha256: "bad", bytes: 10 } },
    true,
  ],
  ["destination-unsafe", { target: { ok: false, rejection: "symlink-escape" } }, true],
  ["no-recorded-proof", { recorded: null, declared: null }, true],
  ["inventory-untrustworthy", { recorded: null, declared: declared() }, false],
  ["not-reproducible", { recorded: null, declared: declared({ producedContentHash: SRC_NEW }) }, true],
  [
    "source-fingerprint-missing",
    { recorded: null, declared: declared({ declaredSourceFingerprint: "short" }) },
    true,
  ],
  [
    "semantics-incomplete",
    { recorded: null, declared: declared({ production: "render" as PayloadSemantics["production"] }) },
    true,
  ],
  ["removal-semantics-retain", { recorded: recorded({ removal: "retain" }), deselectedOwners: [OWNER_A] }, true],
  [
    "refresh-semantics-retain",
    { recorded: recorded({ refresh: "retain" }), declared: declared({ declaredSourceFingerprint: SRC_NEW }) },
    true,
  ],
  [
    "divergent",
    {
      declared: declared({ declaredSourceFingerprint: SRC_NEW }),
      current: { ok: true, sha256: EDITED_HASH, bytes: 9 },
    },
    true,
  ],
];

test("every retention reason in the closed vocabulary is reachable and grants nothing", () => {
  const seen = new Set<PlanArtifactRetentionReason>();
  for (const [reason, over, trustworthy] of EVERY_REASON) {
    const decision = only(planArtifacts([fact(over)], { inventoryTrustworthy: trustworthy }));
    assert.equal(decision.reason, reason, `expected the \`${reason}\` fixture to produce it`);
    assert.equal(decision.form, "retained");
    assert.equal(decision.deletionAuthority, false, `\`${reason}\` must grant no deletion`);
    assert.equal(decision.fullyUpgraded, false, `\`${reason}\` must not be fully upgraded`);
    assert.equal(decision.runnerCandidate, false, `\`${reason}\` leaves the runner nothing to do`);
    assert.equal(decision.persisted, false);
    seen.add(reason);
  }
  // `bootstrap-defers-deletion` is the one non-retention reason; it is covered by
  // its own SC6 test and is deliberately absent from this retention walk.
  assert.equal(seen.size, 15, "all 15 retention reasons are exercised");
});

// --- SC9 / SC11: byte-inert and order-independent ----------------------------

test("an empty preview is a fresh object each time — no shared aliasing", () => {
  const first = emptyArtifactPreview();
  first.deletable.push(planArtifacts([fact({ deselectedOwners: [OWNER_A] })], TRUST).preview.deletable[0]);
  assert.deepEqual(emptyArtifactPreview(), { deletable: [], retained: [], bootstrap: [], advance: [] });
});

test("only a removal, bootstrap, or advance is a previewed EFFECT — retention is not", () => {
  assert.equal(hasPreviewedArtifactEffect(planArtifacts([fact()], TRUST).preview), false);
  assert.equal(
    hasPreviewedArtifactEffect(planArtifacts([fact({ deselectedOwners: [OWNER_A] })], TRUST).preview),
    true,
  );
});

test("permuting the input facts produces a deep-equal response", () => {
  const facts = [
    fact({ destination: ".wf/z.md", deselectedOwners: [OWNER_A] }),
    fact({ destination: ".wf/a.md", recorded: null, declared: declared() }),
    fact({ destination: ".wf/m.md", declared: declared({ declaredSourceFingerprint: SRC_NEW }) }),
    fact({ destination: ".wf/b.md", current: { ok: false, status: "missing" } }),
  ];
  const forward = planArtifacts(facts, TRUST);
  const reversed = planArtifacts([...facts].reverse(), TRUST);
  assert.deepEqual(reversed.preview, forward.preview, "the outcome is a function of the inputs alone");
});

test("no input fact is mutated by the join", () => {
  const input = fact({ deselectedOwners: [OWNER_A] });
  const snapshot = structuredClone(input);
  planArtifacts([input], TRUST);
  assert.deepEqual(input, snapshot);
});

// --- the ENVELOPE: one plan lineage, not a second schema ---------------------

const ADMITTED: PlanAdmissionState = {
  admitted: true,
  root: "/ws",
  source: "explicit",
  reason: null,
  diagnostic: null,
};

const TRUSTWORTHY: DiscoveryInventory = {
  confidence: "trustworthy",
  mayEstablishAbsence: true,
  observedCount: 1,
  issues: [],
};

const OWNER_DEMO: ArtifactOwner = {
  pluginId: "wf-demo@local",
  capability: "demo",
  source: "p/thing.md",
};

function portable(over: Partial<PortablePackEvidence> = {}): PortablePackEvidence {
  return {
    pluginId: "wf-demo@local",
    version: "1.0.0",
    capabilities: ["demo"],
    manifestHashes: [{ path: "capabilities/demo/manifest.md", sha256: LEDGER_HASH }],
    declaredSourceHashes: [],
    ...over,
  };
}

function binding(over: Partial<MachineBindingEvidence> = {}): MachineBindingEvidence {
  return {
    pluginId: "wf-demo@local",
    canonicalRoot: "/ws/packs/wf-demo",
    cliScope: "user",
    enablement: "enabled",
    observedVersion: "1.0.0",
    localFingerprints: [],
    ...over,
  };
}

function pack(over: Partial<DiscoveredPack> = {}): DiscoveredPack {
  return {
    pluginId: "wf-demo@local",
    pluginName: "wf-demo",
    version: "1.0.0",
    scope: "user",
    enablement: "enabled",
    installPath: "/ws/packs/wf-demo",
    state: "active",
    registeredCapabilities: ["demo"],
    diagnostics: null,
    overlay: null,
    presence: "installed",
    evidence: { comparison: "equal", portable: portable(), binding: binding() },
    seedProposal: null,
    questions: [],
    selectable: true,
    ...over,
  };
}

function capability(over: Partial<PlanCapabilityInput> = {}): PlanCapabilityInput {
  return { pluginId: "wf-demo@local", name: "demo", requires: [], conflicts: [], providerScopes: [], ...over };
}

function input(over: Partial<PlanInstallInput> = {}): PlanInstallInput {
  return {
    admission: ADMITTED,
    inventory: TRUSTWORTHY,
    packs: [pack()],
    capabilities: [capability()],
    selection: { desired: [], deregister: [], answers: [] },
    // WF-452: the byte-inert, non-blocking report, so the artifact-evidence path
    // is asserted against exactly its pre-retrofit behaviour.
    recovery: noRecoveryReport(),
    ...over,
  };
}

/** A ledger-recorded artifact owned by the pack the envelope tests act on. */
const DEMO_ARTIFACT = {
  destination: ".wf/thing.md",
  target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: true },
  recorded: recorded({ owners: [OWNER_DEMO] }),
  current: { ok: true as const, sha256: LEDGER_HASH, bytes: 10 },
  declared: null,
};

test("a previewed artifact decision rides the SAME plan envelope — one lineage", () => {
  const out = planInstall(input({ artifacts: [DEMO_ARTIFACT] }));
  assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION, "still envelope version 1");
  assert.equal(out.byteInert, true);
  assert.equal(out.artifacts.retained.length, 1);
  assert.equal(out.artifacts.retained[0].reason, "not-deselected");
  assert.ok(
    out.findings.some((f) => f.code === "plan/artifact-retained"),
    "artifact findings join the ONE findings list",
  );
});

test("the envelope derives deselection from its OWN registry delta, previewing the removal", () => {
  const out = planInstall(
    input({
      selection: { desired: [], deregister: ["wf-demo@local"], answers: [] },
      artifacts: [DEMO_ARTIFACT],
    }),
  );

  assert.equal(out.registryDelta.deregistrations.length, 1);
  assert.equal(out.artifacts.deletable.length, 1, "deregistering the sole owner makes it deletable");
  assert.equal(out.artifacts.deletable[0].deletionAuthority, true);
  assert.equal(out.applicability, "applicable");
});

test("a retention-only artifact set leaves an otherwise-empty plan at no-change", () => {
  const out = planInstall(input({ artifacts: [DEMO_ARTIFACT] }));
  assert.equal(out.applicability, "no-change", "retaining changes nothing");
});

test("an artifact retention never downgrades applicability to not-applicable", () => {
  const out = planInstall(
    input({
      artifacts: [{ ...DEMO_ARTIFACT, target: { ok: false, rejection: "traversal" } }],
    }),
  );
  assert.equal(out.artifacts.retained[0].reason, "destination-unsafe");
  assert.notEqual(out.applicability, "not-applicable", "a fail-safe retention is not a plan error");
});

test("an inadmissible root returns the ordinary envelope with an EMPTY artifact preview", () => {
  const out = planInstall(
    input({
      admission: {
        admitted: false,
        root: null,
        source: "explicit",
        reason: "not-a-directory",
        diagnostic: "no",
      },
      artifacts: [DEMO_ARTIFACT],
    }),
  );
  assert.equal(out.applicability, "invalid-root");
  assert.deepEqual(out.artifacts, { deletable: [], retained: [], bootstrap: [], advance: [] });
});

test("a plan that supplies NO artifacts is unchanged by this slice", () => {
  const out = planInstall(input());
  assert.deepEqual(out.artifacts, { deletable: [], retained: [], bootstrap: [], advance: [] });
  assert.equal(out.applicability, "no-change");
});

test("an untrustworthy inventory blocks bootstrap through the envelope too", () => {
  const out = planInstall(
    input({
      inventory: { confidence: "partial", mayEstablishAbsence: false, observedCount: 0, issues: [] },
      artifacts: [{ ...DEMO_ARTIFACT, recorded: null, declared: declared({ owners: [OWNER_DEMO] }) }],
    }),
  );
  assert.deepEqual(out.artifacts.bootstrap, []);
  assert.equal(out.artifacts.retained[0].reason, "inventory-untrustworthy");
});
