// WF-466 — the bounded fake-pack lifecycle matrix, part two: the journeys.
//
// The block classes and the anti-vacuity controls live in
// `lifecycle-matrix.test.ts`; the shared harness in `lifecycle-matrix.harness.ts`.
// This file carries SC-1, SC-2, SC-3, SC-5 and SC-6.
//
// Every scenario runs against a workspace root that is not `process.cwd()` — the
// non-cwd root journey, proved at the service layer because WF-445's family
// guard binds the admissible root to the process launch directory BEFORE service
// construction and so makes non-cwd admission unprovable over the wire.
//
// WF-466 pinned four defects here rather than fixing them; WF-476 fixed all
// four and retired the pins. The scenarios below now assert the INTENDED
// property in each case, so they read as ordinary matrix coverage — nothing in
// this file is pinned to observed-wrong behaviour any more:
//
//   S-01   a persisted project answer resolves the question, which is asked once
//          and never re-asked (`applyQuestionValues`, on the lifecycle path too)
//   S-10b  a payload-bearing settled workspace satisfies the settled predicate,
//          because the planner decides payload eligibility from the bytes
//   S-13b  an installed-but-unselected co-declarer does not refuse an ordinary
//          install; S-13c holds the other direction — a selected pack that moves
//          between plan and apply is still refused, fail-closed
//   S-24   a hand-edited artifact is preserved AND reported as preserved, both
//          from one comparison, so the two can no longer contradict each other

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { createApplyPorts } from "../src/ports.js";
import {
  LIFECYCLE_BACKUP_DIR,
  LIFECYCLE_JOURNAL_PATH,
  LIFECYCLE_LOCK_PATH,
  createJournalEntry,
  createLastWrittenIdentity,
  createTransactionJournal,
} from "../src/resolver/lifecycle-journal.js";
import { ResolverService } from "../src/service.js";
import {
  BETA_DESTINATION,
  SHARED_DESTINATION,
  diffTrees,
  digestTree,
  guardActionablePlan,
  guardDigestWitness,
  isSettled,
  makeMatrixWorkspace,
  providerManifest,
  qualifiedId,
} from "./lifecycle-matrix.fixtures.js";
import {
  answer,
  codes,
  existsRel,
  expectGuard,
  expectGuardRejects,
  install,
  postRecoveryBaseline,
  select,
  withMatrix,
} from "./lifecycle-matrix.harness.js";

const sha256 = (bytes: Buffer | string): string =>
  createHash("sha256").update(bytes).digest("hex");

/** The lifecycle residue that must never survive a settled run. */
const RESIDUE = [LIFECYCLE_JOURNAL_PATH, LIFECYCLE_BACKUP_DIR, LIFECYCLE_LOCK_PATH];

function assertNoResidue(root: string, when: string): void {
  for (const rel of RESIDUE) {
    assert.equal(existsRel(root, rel), false, `${rel} survives ${when}`);
  }
}

/** A payload-free, question-free selection. `alpha` is the minimal registrable
 *  unit; the settled predicate is reachable on it (S-10a) and, since WF-476, on
 *  the payload-bearing class too (S-10b). */
const bare = { desired: select("alpha"), deregister: [], answers: [] };

// ===========================================================================
// SC-1 — the fresh multi-pack journey
// ===========================================================================

test("S-01 (SC-1): the journey presents ONE question round, and never re-asks it", () => {
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const discovery = ws.service.discoverPacks();

    // ONE question round: exactly one question exists across all three packs, and
    // it is unresolved before any confirmation.
    const questions = discovery.packs.flatMap((pack) => pack.questions);
    assert.equal(questions.length, 1, "the journey must present exactly one question round");
    assert.equal(questions[0].id, "beta-mode");
    assert.equal(questions[0].state.status, "unresolved");

    // ONE confirmation: a single plan carries every action, nothing is left open.
    const { plan, applied } = install(ws, ["alpha", "beta", "gamma"], {
      expectDestinations: [BETA_DESTINATION, SHARED_DESTINATION],
    });
    assert.deepEqual(plan.applicabilityBasis.blockingQuestions, []);
    assert.equal(applied.status, "applied");

    // The answer really is persisted, through the real answer-write action.
    assert.ok(
      applied.applied.some((entry) => entry.kind === "answer-write"),
      "the confirmed answer must be written",
    );
    assert.equal(
      readFileSync(join(ws.workspace, "_local/profiles/beta.profile.json"), "utf8"),
      '{\n  "beta-mode": "safe"\n}\n',
      "the persisted profile must hold the confirmed answer",
    );

    // ASKED ONCE, AND ONCE ONLY. The persisted answer is now visible to the
    // lifecycle path — the same `applyQuestionValues` overlay the
    // registry-composition read path applies — so the question reaches
    // `resolved` and is never presented a second time.
    const after = ws.service.discoverPacks();
    const stillUnresolved = after.packs
      .flatMap((pack) => pack.questions)
      .filter((question) => question.state.status === "unresolved");
    assert.deepEqual(
      stillUnresolved.map((q) => q.id),
      [],
      "an already-answered question was presented again",
    );

    // And the consequence that used to bite: a re-plan supplying NO answer is no
    // longer blocked on a question the project already answered — it emits no
    // `plan/answer-missing` and opens no unresolved question for it.
    const replan = ws.service.planInstall(ws.admission, {
      desired: select("alpha", "beta", "gamma"),
      deregister: [],
      answers: [],
    });
    assert.equal(
      codes(replan).includes("plan/answer-missing"),
      false,
      `a re-plan over an answered project re-asked: [${codes(replan)}]`,
    );
    assert.deepEqual(
      replan.answers.unresolved.map((q) => q.questionId),
      [],
      "a re-plan over an answered project opened an unresolved question",
    );
  });
});

test("S-02 (SC-1): one confirmation authorizes EXACTLY the listed actions", () => {
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const { plan, applied } = install(ws, ["alpha", "beta", "gamma"], {
      expectDestinations: [BETA_DESTINATION, SHARED_DESTINATION],
    });

    const authorized = plan.actions.filter((action) => action.mutating);
    const performed = [...applied.applied, ...applied.deferred];
    // Nothing was performed that the confirmation did not list...
    for (const entry of performed) {
      assert.ok(
        authorized.some(
          (action) => action.kind === entry.kind && action.destination === entry.destination,
        ),
        `\`${entry.kind}\` at \`${entry.destination}\` was applied but never listed`,
      );
    }
    // ...and everything listed was accounted for, as applied or as deferred.
    assert.equal(
      performed.length,
      authorized.length,
      "the applied+deferred set must exactly account for the confirmed set",
    );
    // A deferral is reported honestly, with its follow-up, not silently dropped.
    for (const entry of applied.deferred) {
      assert.ok(entry.reason, "a deferral must state its reason");
      assert.ok(entry.followUp, "a deferral must name its follow-up");
    }
  });
});

test("S-03 (SC-1): owned artifacts carry the approved digests and the COMPLETE owner set", () => {
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const { plan } = install(ws, ["alpha", "beta", "gamma"], {
      expectDestinations: [BETA_DESTINATION, SHARED_DESTINATION],
    });

    for (const previewed of plan.payloads.actions) {
      const onDisk = readFileSync(join(ws.workspace, previewed.destination));
      assert.equal(
        sha256(onDisk),
        previewed.identity.sha256,
        `${previewed.destination} does not hold the approved bytes`,
      );
      assert.equal(onDisk.length, previewed.identity.bytes);
    }

    // The shared destination records BOTH declaring owners. Recording a narrower
    // owner set would make a later deletion look authorized when it is not.
    const shared = plan.payloads.actions.find((a) => a.destination === SHARED_DESTINATION);
    assert.ok(shared, "the shared destination must be previewed");
    assert.deepEqual(
      shared.owners.map((owner) => owner.pluginId).sort(),
      [qualifiedId("beta"), qualifiedId("gamma")].sort(),
      "the shared destination must record its complete owner set",
    );
  });
});

test("S-04 (SC-1): precedence composes in REGISTRY ORDER, and a partition admits one owner", () => {
  // Half one — AGGREGATE. Registry order is the injection order: general first,
  // most-specific last. The order the confirmation listed is the order the
  // registry ends up in.
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    install(ws, ["alpha", "beta", "gamma"], {
      expectDestinations: [BETA_DESTINATION, SHARED_DESTINATION],
    });
    const registry = ws.service.resolveRegistry();
    assert.deepEqual(
      registry.capabilities.map((capability) => capability.name),
      ["alpha", "beta", "gamma"],
      "registry order must follow the reviewed selection order",
    );
    for (const capability of registry.capabilities) {
      assert.equal(capability.validity, "ok", `${capability.name} did not resolve`);
    }
  });

  // Half two — PARTITION. A provider surface admits only the OWNING capability,
  // so two packs claiming one surface is a validation error, not an aggregation.
  // No sixth fixture: two existing packs are re-manifested onto one surface.
  withMatrix(
    {
      packs: ["alpha", "gamma"],
      manifestOverrides: {
        alpha: providerManifest("alpha", "engine"),
        gamma: providerManifest("gamma", "engine"),
      },
    },
    (ws) => {
      const before = postRecoveryBaseline(ws);
      const plan = ws.service.planInstall(ws.admission, {
        desired: select("alpha", "gamma"),
        deregister: [],
        answers: [],
      });
      assert.notEqual(
        plan.applicability,
        "applicable",
        `two owners on one surface must not compose an applicable plan, findings [${codes(plan)}]`,
      );
      expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
    },
  );
});

test("S-05 (SC-1): the run ENDS CLEAN — no journal, no backup, no lock, no residue", () => {
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const { applied } = install(ws, ["alpha", "beta", "gamma"], {
      expectDestinations: [BETA_DESTINATION, SHARED_DESTINATION],
    });
    assert.equal(applied.residue.clean, true, applied.residue.detail);
    assert.equal(applied.residue.journalRetained, false);
    assert.equal(applied.residue.backupsRetained, false);
    assertNoResidue(ws.workspace, "a successful apply");

    // "Ends clean" is a claim about a SUBSEQUENT READ, not just about the
    // response: a fresh read over the same root must find nothing to recover.
    const reread = ws.service.discoverPacks();
    assert.equal(reread.recovery.proceeded, true);
    assert.equal(reread.recovery.wroteBytes, false, "a settled workspace needed recovery");
    assertNoResidue(ws.workspace, "a re-read of a settled workspace");

    // A first apply is NOT `no-drift`: the destinations did not exist when the
    // plan was previewed, so their current bytes were unreadable and the upgrade
    // verdict conservatively reports `retained-divergence`. Ending clean and
    // being fully upgraded are different claims, and the envelope keeps them so.
    assert.equal(applied.upgrade.noDrift, false);
    assert.equal(applied.upgrade.outcome, "retained-divergence");
    for (const entry of applied.upgrade.remaining) {
      assert.equal(entry.class, "unverifiable");
      assert.equal(entry.reason, "current-bytes-unreadable");
    }
  });
});

// ===========================================================================
// SC-2 — byte-inertness until confirmed apply, and evidence preservation
// ===========================================================================

test("S-06 (SC-2): a FIRST-MACHINE binding-seed proposal is byte-inert", () => {
  withMatrix({ packs: ["alpha", "beta"] }, (ws) => {
    install(ws, ["alpha", "beta"], { expectDestinations: [BETA_DESTINATION] });

    // The first-machine world: the COMMITTED portable half is present, the
    // MACHINE-LOCAL binding half is not. That is a fresh checkout on a new box.
    unlinkSync(join(ws.workspace, "_local/install-state.json"));

    const baseline = postRecoveryBaseline(ws);
    assert.ok(baseline.size > 0, "the baseline must witness real files");

    const plan = ws.service.planInstall(ws.admission, {
      desired: select("alpha", "beta"),
      deregister: [],
      answers: answer("safe"),
    });

    // A seed is PROPOSED...
    const seeds = plan.evidenceSeeds.filter((seed) => seed.kind === "binding-seed");
    assert.ok(seeds.length > 0, "a missing machine binding must propose a binding-seed");
    for (const seed of seeds) {
      assert.equal(seed.persisted, false, "a proposal must not claim to be persisted");
    }
    assert.equal(plan.byteInert, true, "planning declares itself byte-inert");

    // ...and NOT A BYTE was written to make that proposal.
    expectGuard(guardDigestWitness(baseline, diffTrees(baseline, digestTree(ws.workspace))));
    assertNoResidue(ws.workspace, "a byte-inert plan");
  });
});

test("S-07 (SC-2): a LEGACY-BOOTSTRAP proposal is byte-inert on the same baseline", () => {
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const baseline = postRecoveryBaseline(ws);
    assert.ok(baseline.size > 0, "the baseline must witness real files");

    const plan = ws.service.planInstall(ws.admission, {
      desired: select("alpha", "beta", "gamma"),
      deregister: [],
      answers: answer("safe"),
    });
    expectGuard(guardActionablePlan(plan));
    const bootstraps = plan.evidenceSeeds.filter((seed) => seed.kind === "legacy-bootstrap");
    assert.ok(bootstraps.length > 0, "an unrecorded pack must propose a legacy bootstrap");
    assert.equal(plan.byteInert, true);

    // Planning it twice is still inert, and still the same plan.
    const again = ws.service.planInstall(ws.admission, {
      desired: select("alpha", "beta", "gamma"),
      deregister: [],
      answers: answer("safe"),
    });
    assert.equal(again.identity.planId, plan.identity.planId, "plan identity must be stable");
    expectGuard(guardDigestWitness(baseline, diffTrees(baseline, digestTree(ws.workspace))));
    assertNoResidue(ws.workspace, "two byte-inert plans");
  });
});

test("S-08 (SC-2): a pack whose evidence cannot be proved KEEPS its registration", () => {
  // `epsilon` is registered but its manifest is invalid — its observed proof can
  // never be completed, and it is not in this run's selection. Omission does not
  // imply removal, and unprovable evidence does not either.
  withMatrix({ packs: ["alpha", "epsilon"], registered: ["epsilon"] }, (ws) => {
    const registryBefore = readFileSync(join(ws.workspace, "_local/config.md"), "utf8");
    const baseline = postRecoveryBaseline(ws);

    const plan = ws.service.planInstall(ws.admission, {
      desired: select("alpha"),
      deregister: [],
      answers: [],
    });

    // The unprovable pack is carried in the RETENTION channel, with its evidence
    // state named — not silently dropped, and not quietly "cleaned up".
    const retained = plan.registryDelta.retentions.find(
      (row) => row.pluginId === qualifiedId("epsilon"),
    );
    assert.ok(retained, "the unprovable registration must be reported as retained");
    assert.equal(retained.reason, "retained-by-omission");
    assert.equal(
      retained.overlay,
      "pack/stale(evidence-missing)",
      "the retention must carry the evidence state it could not prove",
    );

    // Nothing authorizes a removal, on either channel.
    assert.deepEqual(
      plan.registryDelta.deregistrations,
      [],
      "unprovable evidence must never authorize a deregistration",
    );
    assert.equal(
      plan.actions.some((a) => a.kind === "registry-deregister"),
      false,
      "no deregistration action may be composed",
    );

    // And the registry file itself is byte-identical.
    expectGuard(guardDigestWitness(baseline, diffTrees(baseline, digestTree(ws.workspace))));
    assert.equal(
      readFileSync(join(ws.workspace, "_local/config.md"), "utf8"),
      registryBefore,
      "the registry was rewritten",
    );
  });
});

test("S-09 (SC-2): `repair_packs` is byte-inert from the recovered baseline", () => {
  withMatrix({ packs: ["alpha", "beta"] }, (ws) => {
    install(ws, ["alpha", "beta"], { expectDestinations: [BETA_DESTINATION] });
    const baseline = postRecoveryBaseline(ws);

    const first = ws.service.repairPacks(ws.admission);
    assert.equal(first.plan.byteInert, true, "repair declares itself byte-inert");
    // Repair never creates a transaction of its own.
    assertNoResidue(ws.workspace, "a repair plan");

    // Two repair reports yield the SAME planId, because `plan.recovery` is
    // excluded from `identity`.
    const second = ws.service.repairPacks(ws.admission);
    assert.equal(
      second.plan.identity.planId,
      first.plan.identity.planId,
      "recovery must not leak into plan identity",
    );
    assert.deepEqual(second.plan.actions, first.plan.actions);
    // A repair plan structurally cannot carry a destructive claim.
    assert.deepEqual(first.plan.registryDelta.deregistrations, []);
    assert.deepEqual(first.plan.artifacts.deletable, []);
    assert.equal(
      first.plan.actions.some((a) => a.kind === "artifact-delete"),
      false,
      "a repair plan may never contain an artifact-delete",
    );

    expectGuard(guardDigestWitness(baseline, diffTrees(baseline, digestTree(ws.workspace))));
  });
});

// ===========================================================================
// SC-3 — settled reruns and the exact reviewed delta, once
// ===========================================================================

test("S-10a (SC-3): a settled workspace satisfies the FOUR-CONJUNCT predicate", () => {
  // The simplest class on which the settled exit is reachable: a pack with no
  // payloads and no questions. S-10b covers the payload-bearing class, which
  // reaches the same exit.
  withMatrix({ packs: ["alpha"] }, (ws) => {
    const plan = ws.service.planInstall(ws.admission, bare);
    expectGuard(guardActionablePlan(plan));
    const applied = ws.service.applyInstall(ws.admission, bare, plan.identity.planId);
    assert.equal(applied.status, "applied");
    assert.equal(applied.upgrade.outcome, "no-drift");
    assert.equal(applied.residue.clean, true, applied.residue.detail);

    const baseline = postRecoveryBaseline(ws);
    const repair = ws.service.repairPacks(ws.admission);

    // The predicate is REUSED from `reconcile-mode.md:58-65` Step R2 verbatim,
    // not re-derived into something looser.
    expectGuard(isSettled(repair));

    // The stronger WF-461 form: a settled project must never ENTER the mutation
    // stage at all, not enter it and do nothing.
    assert.equal(
      repair.plan.actions.some((a) => a.mutating),
      false,
      "a settled workspace authorized a mutating action",
    );
    expectGuard(guardDigestWitness(baseline, diffTrees(baseline, digestTree(ws.workspace))));

    // Idempotence: a clean rerun writes nothing.
    const rerun = ws.service.planInstall(ws.admission, bare);
    assert.equal(rerun.applicability, "no-change");
    expectGuard(guardDigestWitness(baseline, diffTrees(baseline, digestTree(ws.workspace))));
  });
});

test("S-10b (SC-3): a PAYLOAD-BEARING settled workspace satisfies the predicate too", () => {
  withMatrix({ packs: ["alpha", "gamma"] }, (ws) => {
    const selection = { desired: select("alpha", "gamma"), deregister: [], answers: [] };
    const first = ws.service.planInstall(ws.admission, selection);
    const applied = ws.service.applyInstall(ws.admission, selection, first.identity.planId);
    assert.equal(applied.status, "applied");

    // Nothing has changed since. The artifact's bytes match the ledger exactly.
    const settledBytes = postRecoveryBaseline(ws);
    const repair = ws.service.repairPacks(ws.admission);
    const retained = repair.plan.artifacts.retained.find(
      (decision) => decision.destination === SHARED_DESTINATION,
    );
    assert.ok(retained, "the payload must be reported");
    assert.equal(retained.bytesMatchLedger, true, "the setup requires an unmodified artifact");
    assert.equal(retained.reason, "not-deselected");

    // The planner now answers the eligibility question itself: the destination
    // already holds the declared bytes, so no `payload-write` is composed at all.
    // The settled exit is reachable on a payload-bearing workspace, not only on
    // the payload-free class S-10a covers.
    assert.equal(repair.plan.applicability, "no-change");
    assert.deepEqual(repair.plan.applicabilityBasis.blockingFindings, []);
    assert.deepEqual(
      repair.plan.actions.filter((a) => a.mutating).map((a) => `${a.kind}:${a.destination}`),
      [],
      "a settled payload-bearing workspace authorized a mutating action",
    );
    // The predicate is REUSED from `reconcile-mode.md` Step R2 verbatim, exactly
    // as S-10a reuses it — not re-derived into something looser for this class.
    expectGuard(isSettled(repair));

    // Planner and mutator agree, which is the half that used to contradict: the
    // very same plan is now `no-change`, so there is nothing for apply to refuse.
    const second = ws.service.planInstall(ws.admission, selection);
    assert.equal(second.applicability, "no-change", "the planner settles");
    assert.deepEqual(
      second.actions.filter((a) => a.mutating),
      [],
      "a settled re-plan previewed a mutating action",
    );

    // And the property the whole slice exists to protect: a no-drift rerun writes
    // ZERO bytes — proved against the digest witness, not assumed.
    expectGuard(guardDigestWitness(settledBytes, diffTrees(settledBytes, digestTree(ws.workspace))));
  });
});

test("S-11 (SC-3): `remaining[]` and `withheldAdvances[]` are INDEPENDENT channels", () => {
  withMatrix({ packs: ["alpha", "gamma"] }, (ws) => {
    const selection = { desired: select("alpha", "gamma"), deregister: [], answers: [] };
    const first = ws.service.planInstall(ws.admission, selection);
    ws.service.applyInstall(ws.admission, selection, first.identity.planId);

    // Hand-edit an owned artifact. It surfaces on the RETAINED channel with its
    // own reason — conjunct 4's channel, which conjuncts 1-3 know nothing about.
    writeFileSync(join(ws.workspace, SHARED_DESTINATION), "hand-edited\n");
    const repair = ws.service.repairPacks(ws.admission);
    const divergent = repair.plan.artifacts.retained.filter(
      (decision) => decision.reason !== "not-deselected",
    );
    assert.deepEqual(
      divergent.map((decision) => `${decision.destination}:${decision.reason}`),
      [`${SHARED_DESTINATION}:current-bytes-mismatch`],
      "the edit must surface as retained divergence",
    );
    assert.deepEqual(repair.withheldAdvances, [], "the OTHER channel is empty — that is the point");
    expectGuardRejects(isSettled(repair), "S-11: a hand-edited artifact");

    // Conjunct 4's INDEPENDENCE, proved directly rather than inferred: take a
    // report that satisfies conjuncts 1, 2 and 3 outright — `no-change`, no
    // withheld advances, every drift `settled` — and change nothing but one
    // retained reason. The predicate must still reject it. A looser predicate
    // that stopped at `applicability === "no-change"` would call this settled.
    const otherwiseSettled = {
      plan: {
        applicability: "no-change",
        artifacts: { retained: [{ reason: "not-deselected" }] },
      },
      withheldAdvances: [],
      diagnosis: [{ drift: "settled" }],
    };
    expectGuard(isSettled(otherwiseSettled as never));
    for (const reason of ["current-bytes-mismatch", "shared", "ambiguous", "unverifiable"]) {
      expectGuardRejects(
        isSettled({
          ...otherwiseSettled,
          plan: { ...otherwiseSettled.plan, artifacts: { retained: [{ reason }] } },
        } as never),
        `S-11: an otherwise-settled report whose sole divergence is \`${reason}\``,
      );
    }
    // And the same for conjunct 2's channel, alone.
    expectGuardRejects(
      isSettled({
        ...otherwiseSettled,
        withheldAdvances: [{ destination: SHARED_DESTINATION, reason: "owner-set-moved" }],
      } as never),
      "S-11: an otherwise-settled report whose sole divergence is a withheld advance",
    );
  });
});

test("S-12 (SC-3): the exact reviewed delta applies ONCE — a replay is `apply/plan-stale`", () => {
  withMatrix({ packs: ["alpha", "beta"] }, (ws) => {
    const { plan, applied } = install(ws, ["alpha", "beta"], {
      expectDestinations: [BETA_DESTINATION],
    });
    assert.equal(applied.status, "applied");

    // Replay the SAME approved plan id. The world has moved, so the identity no
    // longer matches and the mutator refuses rather than double-applying.
    const settled = postRecoveryBaseline(ws);
    const replay = ws.service.applyInstall(
      ws.admission,
      { desired: select("alpha", "beta"), deregister: [], answers: answer("safe") },
      plan.identity.planId,
    );
    assert.equal(replay.status, "rejected");
    assert.equal(replay.reason, "apply/plan-stale");
    assert.deepEqual(replay.applied, [], "a replay must apply nothing");
    expectGuard(guardDigestWitness(settled, diffTrees(settled, digestTree(ws.workspace))));
  });
});

test("S-13a (SC-3): OMISSION IS NOT REMOVAL; only an explicit deselection removes", () => {
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    install(ws, ["alpha", "beta", "gamma"], {
      expectDestinations: [BETA_DESTINATION, SHARED_DESTINATION],
    });

    // Re-plan naming only `alpha` and `gamma`: `beta` is omitted, never
    // deselected, and must be RETAINED.
    const omitted = ws.service.planInstall(ws.admission, {
      desired: select("alpha", "gamma"),
      deregister: [],
      answers: [],
    });
    assert.deepEqual(
      omitted.registryDelta.deregistrations,
      [],
      "omission implied a removal — the reconcile rule is broken",
    );
    assert.ok(
      omitted.registryDelta.retentions.some((row) => row.pluginId === qualifiedId("beta")),
      "the omitted pack must be reported as retained",
    );

    // An EXPLICIT deselection is the only thing that removes.
    const explicit = ws.service.planInstall(ws.admission, {
      desired: select("alpha", "gamma"),
      deregister: select("beta"),
      answers: [],
    });
    assert.ok(
      explicit.registryDelta.deregistrations.some((row) => row.pluginId === qualifiedId("beta")),
      "an explicit deselection must produce a deregistration",
    );
    // SC-6's `shared` class, on the same plan: the shared destination is not
    // deletable, because a retained owner still declares it.
    assert.equal(
      explicit.artifacts.deletable.some((d) => d.destination === SHARED_DESTINATION),
      false,
      "a destination a retained owner still declares is never deletable",
    );
  });
});

test("S-13b (SC-3): an UNSELECTED CO-DECLARER does not refuse an ordinary install", () => {
  // The declaring-capability precondition compares the currently-declared owner
  // set against the approved one. The approved set is built from the SELECTED
  // packs only, so the comparison set must be scoped the same way: `gamma` is
  // installed and co-declares `beta`'s shared destination, but this plan does not
  // act on it, so it is not evidence that anything moved between plan and apply.
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const selection = {
      desired: select("alpha", "beta"),
      deregister: [],
      answers: answer("safe"),
    };
    const plan = ws.service.planInstall(ws.admission, selection);
    expectGuard(guardActionablePlan(plan));

    const applied = ws.service.applyInstall(ws.admission, selection, plan.identity.planId);
    assert.equal(
      applied.status,
      "applied",
      applied.status === "rejected" ? `${applied.reason}: ${applied.detail ?? ""}` : "",
    );
    assert.equal(applied.residue.clean, true, applied.residue.detail);
    assertNoResidue(ws.workspace, "a completed install");

    // The control that keeps this a diagnosis rather than a coincidence:
    // selecting the co-declarer too still succeeds, as it always did. It writes
    // no payload bytes this time — the destinations already hold exactly the
    // declared content, which is the settled case S-10b now covers — so no
    // destination is expected to move.
    install(ws, ["alpha", "beta", "gamma"]);
  });
});

test("S-13c (SC-3): a SELECTED pack edited between plan and apply is still refused", () => {
  // The second half of the criterion, and the reason S-13b is a narrowing of the
  // COMPARISON SET rather than a weakening of the guard: a SELECTED pack that
  // moves between plan and apply is still refused, before any write.
  //
  // WHICH TOKEN, AND WHY IT IS NOT `apply/payload-precondition` HERE. Editing a
  // pack's declared source also moves that pack's fingerprint, so the plan's own
  // staleness gate — an EARLIER and strictly broader guard — refuses first. That
  // ordering is asserted rather than worked around: it is the honest description
  // of the composed behaviour, and engineering an edit past it would only prove a
  // scenario the lifecycle cannot actually reach. The payload precondition's own
  // fail-closed behaviour on a selected owner that moved is proved directly, at
  // the unit level, by `apply-payload.test.ts` RE-BINDING 4/4.
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const selection = {
      desired: select("alpha", "beta", "gamma"),
      deregister: [],
      answers: answer("safe"),
    };
    const plan = ws.service.planInstall(ws.admission, selection);
    expectGuard(guardActionablePlan(plan));

    // A SELECTED pack's declared payload source moves after the approval.
    ws.writePackSource("gamma", "assets/shared.bin", "edited-between-plan-and-apply\n");

    const before = postRecoveryBaseline(ws);
    const applied = ws.service.applyInstall(ws.admission, selection, plan.identity.planId);

    assert.equal(applied.status, "rejected");
    assert.equal(applied.reason, "apply/plan-stale");
    // FAIL-CLOSED, BEFORE ANY WRITE — asserted, not assumed.
    assert.deepEqual(applied.applied, []);
    assert.equal(applied.residue.clean, true, applied.residue.detail);
    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
    assertNoResidue(ws.workspace, "a precondition refusal");
  });
});

// ===========================================================================
// SC-5 — recovery, external bytes, and never claiming partial success
// ===========================================================================

test("S-20 (SC-5): a FAILED SELF-CHECK is transaction failure, and rolls back", () => {
  const ws = makeMatrixWorkspace({ packs: ["alpha", "beta"] });
  try {
    // Production everywhere except the self-check, which is forced to fail. A
    // failed self-check is transaction failure, not a warning.
    const service = new ResolverService({
      ...ws.ports,
      createApply: (registryRel: string) =>
        createApplyPorts(ws.workspace, registryRel, () => ({
          ok: false,
          reason: "forced",
          diagnostic: "WF-466 forced a self-check failure",
        })),
    } as never);

    const selection = { desired: select("alpha", "beta"), deregister: [], answers: answer("safe") };
    const plan = service.planInstall(ws.admission, selection);
    expectGuard(guardActionablePlan(plan));

    service.discoverPacks();
    const before = digestTree(ws.workspace);
    const applied = service.applyInstall(ws.admission, selection, plan.identity.planId);

    assert.equal(applied.status, "rolled-back", `status was ${applied.status}`);
    assert.deepEqual(applied.applied, [], "`applied[]` is non-empty ONLY for status `applied`");
    assert.equal(applied.rollback?.complete, true, "the rollback must complete");
    assert.equal(applied.residue.clean, true, applied.residue.detail);

    // The prior state is restored. A rollback RESTORES lifecycle-owned files, so
    // it may legitimately rewrite them in place — the claim is byte equality,
    // and no file appearing or disappearing. (Inode equality is the load-bearing
    // conjunct only for files the lifecycle does NOT own; that is S-22.)
    const diff = diffTrees(before, digestTree(ws.workspace));
    assert.deepEqual(diff.added, [], "a rollback left a new file behind");
    assert.deepEqual(diff.removed, [], "a rollback removed a pre-existing file");
    assert.deepEqual(diff.changed, [], "a rollback left changed bytes behind");
    assertNoResidue(ws.workspace, "a completed rollback");
    // The payloads it had begun writing are gone entirely.
    assert.equal(existsRel(ws.workspace, BETA_DESTINATION), false, "a payload survived rollback");
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
});

test("S-21 (SC-5): a PROCESS KILL recovers IDEMPOTENTLY and never claims partial success", () => {
  withMatrix({ packs: ["alpha", "gamma"] }, (ws) => {
    const selection = { desired: select("alpha", "gamma"), deregister: [], answers: [] };
    const first = ws.service.planInstall(ws.admission, selection);
    ws.service.applyInstall(ws.admission, selection, first.identity.planId);

    // Simulate the kill: a durable journal describing bytes the transaction DID
    // write, and never completed. Built through the PRODUCTION constructors, so
    // the matrix cannot invent a journal shape the runtime would not.
    const priorBytes = readFileSync(join(ws.workspace, SHARED_DESTINATION));
    const halfWritten = "half-written-by-a-killed-process\n";
    const backupRel = `${LIFECYCLE_BACKUP_DIR}/shared.bak`;
    mkdirSync(join(ws.workspace, LIFECYCLE_BACKUP_DIR), { recursive: true });
    writeFileSync(join(ws.workspace, backupRel), priorBytes);

    const lastWritten = createLastWrittenIdentity({
      contentHash: sha256(halfWritten),
      bytes: Buffer.byteLength(halfWritten),
    });
    assert.ok(lastWritten, "the production constructor must accept this identity");
    const entry = createJournalEntry({
      destination: SHARED_DESTINATION,
      priorExistence: "present",
      priorContentHash: sha256(priorBytes),
      priorIsSymlink: false,
      backupPath: backupRel,
      lastWritten,
    });
    assert.ok(entry, "the production constructor must accept this entry");
    const journal = createTransactionJournal({
      transactionId: "wf466-kill",
      startedAt: "2026-08-22T00:00:00.000Z",
      entries: [entry],
    });
    assert.ok(journal, "the production constructor must accept this journal");

    writeFileSync(join(ws.workspace, SHARED_DESTINATION), halfWritten);
    writeFileSync(join(ws.workspace, LIFECYCLE_JOURNAL_PATH), JSON.stringify(journal));

    // Re-entry recovers, and SAYS SO on its own channel.
    const recovered = ws.service.discoverPacks();
    assert.equal(recovered.recovery.state, "recovered");
    assert.equal(recovered.recovery.proceeded, true, "recovery must proceed");
    assert.equal(recovered.recovery.wroteBytes, true, "recovery must report that it acted");
    assert.deepEqual(
      recovered.recovery.restored.map((entry) => entry.destination),
      [SHARED_DESTINATION],
    );
    assert.deepEqual(
      readFileSync(join(ws.workspace, SHARED_DESTINATION)),
      priorBytes,
      "recovery must restore the exact prior bytes",
    );
    assertNoResidue(ws.workspace, "a completed recovery");

    // IDEMPOTENT: a second re-entry converges and reports that it wrote nothing,
    // rather than re-claiming the work it did not do.
    const settled = digestTree(ws.workspace);
    const again = ws.service.discoverPacks();
    assert.equal(again.recovery.state, "no-journal");
    assert.equal(again.recovery.proceeded, true);
    assert.equal(again.recovery.wroteBytes, false, "a second recovery re-wrote bytes");
    expectGuard(guardDigestWitness(settled, diffTrees(settled, digestTree(ws.workspace))));
  });
});

test("S-21b (SC-5): a kill that never reached the destination PRESERVES the external edit", () => {
  // The mirror of S-21, and the reason recovery is not simply "restore the
  // backup": an entry with no `lastWritten` describes a destination the
  // interrupted transaction never wrote. A difference there belongs to someone
  // else, and undoing it would destroy an edit the lifecycle never made.
  withMatrix({ packs: ["alpha", "gamma"] }, (ws) => {
    const selection = { desired: select("alpha", "gamma"), deregister: [], answers: [] };
    const first = ws.service.planInstall(ws.admission, selection);
    ws.service.applyInstall(ws.admission, selection, first.identity.planId);

    const priorBytes = readFileSync(join(ws.workspace, SHARED_DESTINATION));
    const backupRel = `${LIFECYCLE_BACKUP_DIR}/shared.bak`;
    mkdirSync(join(ws.workspace, LIFECYCLE_BACKUP_DIR), { recursive: true });
    writeFileSync(join(ws.workspace, backupRel), priorBytes);
    const entry = createJournalEntry({
      destination: SHARED_DESTINATION,
      priorExistence: "present",
      priorContentHash: sha256(priorBytes),
      priorIsSymlink: false,
      backupPath: backupRel,
      lastWritten: null,
    });
    assert.ok(entry);
    const journal = createTransactionJournal({
      transactionId: "wf466-kill-before-write",
      startedAt: "2026-08-22T00:00:00.000Z",
      entries: [entry],
    });
    assert.ok(journal);

    const userBytes = "an edit the lifecycle never made\n";
    writeFileSync(join(ws.workspace, SHARED_DESTINATION), userBytes);
    writeFileSync(join(ws.workspace, LIFECYCLE_JOURNAL_PATH), JSON.stringify(journal));

    const report = ws.service.discoverPacks();
    assert.equal(report.recovery.state, "incomplete");
    assert.equal(report.recovery.proceeded, false, "an unresolved recovery must not claim success");
    assert.equal(report.recovery.wroteBytes, false);
    assert.deepEqual(
      report.recovery.preserved.map((row) => `${row.destination}:${row.reason}`),
      [`${SHARED_DESTINATION}:external-edit`],
    );
    assert.equal(
      readFileSync(join(ws.workspace, SHARED_DESTINATION), "utf8"),
      userBytes,
      "recovery destroyed an edit it did not make",
    );
    // The journal is RETAINED — an unresolved recovery does not tidy away its
    // own evidence, and it does not let lifecycle state be read past it.
    assert.equal(existsRel(ws.workspace, LIFECYCLE_JOURNAL_PATH), true);
  });
});

test("S-22 (SC-5): a file the lifecycle does NOT own comes back byte-identical, same inode", () => {
  const external = "notes/keep-me.txt";
  withMatrix(
    {
      packs: ["alpha", "beta"],
      seedFiles: { [external]: "external bytes the lifecycle must not touch\n" },
    },
    (ws) => {
      const path = join(ws.workspace, external);
      const before = statSync(path);
      const beforeBytes = readFileSync(path);

      install(ws, ["alpha", "beta"], { expectDestinations: [BETA_DESTINATION] });

      const after = statSync(path);
      // Bytes alone are not enough. An atomic replace produces IDENTICAL bytes at
      // a NEW inode, so a hash-only check would pass over a file that was in fact
      // opened for writing. Inode equality is the load-bearing conjunct.
      assert.equal(sha256(readFileSync(path)), sha256(beforeBytes), "external bytes changed");
      assert.equal(after.ino, before.ino, "the external file was REPLACED, not left alone");
      assert.equal(after.mtimeMs, before.mtimeMs, "the external file was rewritten");
    },
  );
});

test("S-23 (SC-5): a SYMLINK SWAP between plan and apply is refused, window closed", () => {
  withMatrix({ packs: ["alpha", "beta"] }, (ws) => {
    install(ws, ["alpha", "beta"], { expectDestinations: [BETA_DESTINATION] });

    // A settled world, then a source drift the plan will be built over.
    ws.writePackSource("beta", "assets/beta.bin", "matrix-beta-payload-v2\n");
    const selection = { desired: select("alpha", "beta"), deregister: [], answers: answer("safe") };
    const plan = ws.service.planInstall(ws.admission, selection);

    // THE WINDOW: between the decision and the write, the destination is swapped
    // for a symlink pointing at a file the lifecycle does not own. The digest is
    // re-proved one stage BEFORE the backup precisely so this cannot be followed.
    const decoy = join(ws.root, "decoy.txt");
    const decoyBytes = "decoy bytes that must survive\n";
    writeFileSync(decoy, decoyBytes);
    const decoyBefore = statSync(decoy);
    const destination = join(ws.workspace, BETA_DESTINATION);
    unlinkSync(destination);
    symlinkSync(decoy, destination);

    const before = digestTree(ws.workspace);
    const applied = ws.service.applyInstall(ws.admission, selection, plan.identity.planId);

    assert.notEqual(applied.status, "applied", "a swapped destination must never be written");
    assert.deepEqual(applied.applied, []);
    // The link was never followed: the decoy is untouched, same inode.
    assert.equal(
      readFileSync(decoy, "utf8"),
      decoyBytes,
      "the swap was FOLLOWED and the unowned target was overwritten",
    );
    assert.equal(statSync(decoy).ino, decoyBefore.ino, "the decoy was replaced");
    // The destination is still the link — it was not silently repaired either.
    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
    assertNoResidue(ws.workspace, "a refused swap");
  });
});

// ===========================================================================
// SC-6 — preservation classes, and the double-jeopardy case
// ===========================================================================

test("S-24 (SC-6): an EDITED artifact is PRESERVED, and reported as preserved", () => {
  withMatrix({ packs: ["alpha", "gamma"] }, (ws) => {
    const selection = { desired: select("alpha", "gamma"), deregister: [], answers: [] };
    const first = ws.service.planInstall(ws.admission, selection);
    ws.service.applyInstall(ws.admission, selection, first.identity.planId);

    // Double jeopardy: the file is changed by hand AND its declared source moves.
    const userBytes = "hand-edited-by-the-user\n";
    writeFileSync(join(ws.workspace, SHARED_DESTINATION), userBytes);
    ws.writePackSource("gamma", "assets/shared.bin", "matrix-shared-payload-v2\n");

    const plan = ws.service.planInstall(ws.admission, selection);

    // The PREVIEW is correct on every channel it owns. No advance is authorized…
    assert.equal(
      plan.artifacts.advance.some((a) => a.destination === SHARED_DESTINATION),
      false,
      "an edited artifact was queued for an advance",
    );
    // …and the artifact is classified as divergent, not as retained-clean.
    const retained = plan.artifacts.retained.find((r) => r.destination === SHARED_DESTINATION);
    assert.ok(retained);
    assert.equal(retained.bytesMatchLedger, false);
    assert.notEqual(retained.reason, "not-deselected");

    // …and the action list AGREES with it. The preservation decision and the
    // emitted action now fall out of ONE comparison, so the plan cannot withhold
    // the refresh on one channel and authorize the write on another.
    assert.equal(
      plan.actions.some((a) => a.mutating && a.destination === SHARED_DESTINATION),
      false,
      "a mutating write was composed for an edited artifact",
    );

    const applied = ws.service.applyInstall(ws.admission, selection, plan.identity.planId);
    assert.equal(applied.status, "applied");

    // SC-6's actual ask: the edited-and-source-changed case stays DIVERGENT. The
    // declared `refresh: replace-if-unmodified` semantics promise the refresh is
    // withheld when the destination was modified — so the user's edit survives,
    // byte for byte, and the newer source bytes do NOT land.
    assert.equal(
      readFileSync(join(ws.workspace, SHARED_DESTINATION), "utf8"),
      userBytes,
      "the hand-edited artifact was overwritten",
    );
    assert.notEqual(
      readFileSync(join(ws.workspace, SHARED_DESTINATION), "utf8"),
      "matrix-shared-payload-v2\n",
      "the newer source bytes landed over a hand-edit",
    );

    // And the report matches what happened, in the same envelope: the artifact is
    // reported preserved-and-divergent BECAUSE it was withheld — no longer a
    // claim contradicted by a write in the same response.
    assert.equal(applied.upgrade.noDrift, false);
    assert.notEqual(applied.upgrade.outcome, "fully-upgraded");
    assert.deepEqual(
      applied.upgrade.advanced,
      [],
      "the write is not reported as an advance either",
    );
    assert.deepEqual(
      applied.upgrade.remaining.map((entry) => `${entry.subject}:${entry.class}:${entry.reason}`),
      // `divergent`, not `current-bytes-mismatch`: the double-jeopardy reason,
      // distinct from S-11's edited-only reason. The two cases do not collapse.
      [`${SHARED_DESTINATION}:edited:divergent`],
      "the upgrade verdict must report the withheld artifact as edited/divergent",
    );
  });
});

test("S-25 (SC-6): `fully-upgraded` is reachable ONLY with an empty `remaining[]`", () => {
  // WF-459's rule, checked against every outcome this matrix can produce, so no
  // scenario above can quietly report success over an unresolved divergence.
  const seen = new Set<string>();
  const record = (outcome: string, remaining: readonly unknown[]): void => {
    seen.add(outcome);
    if (outcome === "fully-upgraded" || outcome === "no-drift") {
      assert.deepEqual(remaining, [], `\`${outcome}\` was claimed with a non-empty remaining[]`);
    }
    if (remaining.length > 0) {
      assert.notEqual(outcome, "fully-upgraded");
      assert.notEqual(outcome, "no-drift");
    }
  };

  withMatrix({ packs: ["alpha"] }, (ws) => {
    const plan = ws.service.planInstall(ws.admission, bare);
    const applied = ws.service.applyInstall(ws.admission, bare, plan.identity.planId);
    record(applied.upgrade.outcome, applied.upgrade.remaining);
  });
  withMatrix({ packs: ["alpha", "beta", "gamma"] }, (ws) => {
    const { applied } = install(ws, ["alpha", "beta", "gamma"], {
      expectDestinations: [BETA_DESTINATION, SHARED_DESTINATION],
    });
    record(applied.upgrade.outcome, applied.upgrade.remaining);
    writeFileSync(join(ws.workspace, BETA_DESTINATION), "edited\n");
    const selection = { desired: select("alpha", "beta", "gamma"), deregister: [], answers: answer("safe") };
    const plan = ws.service.planInstall(ws.admission, selection);
    const again = ws.service.applyInstall(ws.admission, selection, plan.identity.planId);
    record(again.upgrade.outcome, again.upgrade.remaining);
  });

  // The rule is only worth checking if more than one outcome was actually
  // reached — otherwise it is a tautology over a single sample.
  assert.ok(seen.size >= 2, `only one upgrade outcome was exercised: [${[...seen]}]`);
  assert.ok(seen.has("no-drift"), `the clean outcome was never reached: [${[...seen]}]`);
});
