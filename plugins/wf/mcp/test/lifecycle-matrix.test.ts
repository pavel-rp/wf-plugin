// WF-466 — the bounded fake-pack lifecycle matrix.
//
// The integration proof for umbrella WF-439: twenty-three slices shipped
// independently, and this suite exercises the SEAMS between them rather than
// re-testing each in isolation.
//
// THE DOMINANT RISK HERE IS THE VACUOUS GREEN. Every other item in the umbrella
// shipped behaviour and used tests to check it; this one ships the tests. A
// matrix that cannot fail is worse than no matrix, because it manufactures
// unearned confidence across the whole lifecycle. Two concrete precedents:
//
//   * WF-464's initial 5/5 green measured nothing. Its harness passed BARE PACK
//     NAMES while the resolver keys on QUALIFIED IDS, so every plan came back
//     `plan/unknown-selection` / `blocked: true` — and a blocked plan's
//     `deregistrations: []` is empty BY CONSTRUCTION, not by the property under
//     test. The assertion could not have failed.
//   * WF-459 shipped a missing import that made every refusal path throw, so the
//     sole public mutator reported `apply/write-failed` instead of the true
//     `apply/plan-stale`. Fail-safe, but the WRONG CLASS — and a 15/15 audit
//     passed over it because every scenario only checked THAT it blocked.
//
// So: five guards (G1..G5) carry every scoring assertion, and nine negative
// controls prove each guard actually fires ON THIS HOST. NC-3 is the load-bearing
// one — it proves G2 rejects a REAL, WELL-FORMED, SUCCESSFUL `no-change` plan,
// not merely a malformed one. A guard that only rejects garbage is not a guard.

import { test } from "node:test";
import assert from "node:assert/strict";
import { lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDefaultPorts } from "../src/ports.js";
import {
  LIFECYCLE_BACKUP_DIR,
  LIFECYCLE_JOURNAL_PATH,
  LIFECYCLE_LOCK_PATH,
} from "../src/resolver/lifecycle-journal.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { ResolverService } from "../src/service.js";
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
import {
  BLOCK_CLASS_TOKENS,
  ESCAPING_DESTINATION,
  FIXTURE_NAMES,
  SHARED_DESTINATION,
  diffTrees,
  digestTree,
  guardActionablePlan,
  guardAppliedForReal,
  guardBlockClass,
  guardDigestWitness,
  guardQualifiedSelection,
  isUntouched,
  makeMatrixWorkspace,
  qualifiedId,
  type FixtureName,
  type MatrixOptions,
  type MatrixWorkspace,
} from "./lifecycle-matrix.fixtures.js";

const MCP_DIR = process.env.WF_MCP_DIR;
if (!MCP_DIR) throw new Error("WF_MCP_DIR is required");
const REPO_ROOT = normalizeSlashes(resolve(MCP_DIR, "../../.."));

// ===========================================================================
// NEGATIVE CONTROLS — proving each guard fires on THIS host
// ===========================================================================

test("NC-1: a BARE PACK NAME is rejected by G1 — WF-464's exact failure, reproduced here", () => {
  withMatrix({ packs: ["alpha", "beta"] }, (ws) => {
    const discovery = ws.service.discoverPacks();
    // The qualified form is what the resolver keys on, and it passes.
    expectGuard(guardQualifiedSelection(discovery, select("alpha")));
    // WF-464 passed this instead. Every plan came back blocked, and its
    // assertions then read the empty-by-construction fields of a blocked plan.
    expectGuardRejects(guardQualifiedSelection(discovery, ["wf-alpha"]), "NC-1: a bare pack name");
    // And the resolver really does refuse it — the guard is not guessing.
    const blocked = ws.service.planInstall(ws.admission, {
      desired: ["wf-alpha"],
      deregister: [],
      answers: [],
    });
    assert.ok(
      codes(blocked).includes("plan/unknown-selection"),
      `NC-1: expected plan/unknown-selection, got [${codes(blocked)}]`,
    );
    assert.equal(blocked.applicabilityBasis.blocked, true);
    // The trap itself: a blocked plan authorizes NO MUTATION, by construction —
    // so any field a scenario reads off it is empty for a structural reason
    // rather than because the property under test holds.
    //
    // MEASURED CORRECTION TO WF-465's BAR: `actions[]` itself is NOT necessarily
    // empty here. A blocked plan over a workspace carrying managed artifacts
    // still lists non-mutating `artifact-retain` entries, so WF-465's "non-empty
    // actions[]" conjunct would have PASSED this blocked plan. G2 therefore
    // requires a non-empty MUTATING subset instead.
    assert.equal(
      blocked.actions.filter((a) => a.mutating).length,
      0,
      "a blocked plan must authorize no mutation",
    );
    expectGuardRejects(guardActionablePlan(blocked), "NC-1: a blocked plan");
  });
});

test("NC-2: G2 rejects a not-applicable plan carrying blocking findings", () => {
  withMatrix({ packs: ["alpha", "beta", "delta"] }, (ws) => {
    const plan = ws.service.planInstall(ws.admission, {
      desired: select("beta", "delta"),
      deregister: [],
      answers: answer("safe"),
    });
    assert.notEqual(plan.applicability, "applicable");
    expectGuardRejects(guardActionablePlan(plan), "NC-2: a plan with blocking findings");
  });
});

test("NC-3: G2 rejects a REAL, WELL-FORMED, SUCCESSFUL no-change plan", () => {
  // The control that matters. NC-1 and NC-2 feed G2 broken plans; a guard that
  // only rejects garbage is not a guard. This feeds it a genuine success: a
  // settled workspace re-planned with the SAME selection it already applied.
  // Applicable-adjacent, zero blocking findings, zero error findings — and still
  // no mutating action, so a scenario scoring "the plan did X" over it scores
  // nothing at all.
  withMatrix({ packs: ["alpha"] }, (ws) => {
    install(ws, ["alpha"], { answers: [] });

    const settledPlan = ws.service.planInstall(ws.admission, {
      desired: select("alpha"),
      deregister: [],
      answers: [],
    });

    // It is a real success by every other measure:
    assert.equal(settledPlan.applicability, "no-change", "NC-3 needs a genuine no-change plan");
    assert.deepEqual(settledPlan.applicabilityBasis.blockingFindings, []);
    assert.equal(settledPlan.applicabilityBasis.blocked, false);
    assert.deepEqual(
      settledPlan.findings.filter((f) => f.severity === "error").map((f) => f.code),
      [],
      "NC-3 needs a plan with NO error findings",
    );
    assert.equal(
      settledPlan.actions.filter((a) => a.mutating).length,
      0,
      "NC-3 needs a plan that authorizes no mutation",
    );

    // And G2 must STILL reject it.
    expectGuardRejects(guardActionablePlan(settledPlan), "NC-3: a successful no-change plan");
  });
});

test("NC-4: G3 rejects an `applied` envelope over an unchanged tree", () => {
  const applied = {
    status: "applied",
    reason: null,
    applied: [
      {
        kind: "registry-add",
        order: 0,
        pluginId: "wf-alpha@matrix",
        destination: null,
        summary: "x",
        persisted: true,
      },
    ],
  } as never;
  const unchanged = diffTrees(new Map(), new Map());
  expectGuardRejects(
    guardAppliedForReal(applied, unchanged, []),
    "NC-4: `applied` with no bytes moved",
  );
  // And it accepts the same envelope once bytes really moved.
  const moved = diffTrees(
    new Map(),
    new Map([[".wf/x", { sha256: "a".repeat(64), ino: 1, mtimeMs: 1 }]]),
  );
  expectGuard(guardAppliedForReal(applied, moved, [".wf/x"]));
});

test("NC-5: G4 rejects the PLAUSIBLE NEIGHBOURING failure class — the WF-459 defect", () => {
  // WF-459's refusal paths reported `apply/write-failed` where the truth was
  // `apply/plan-stale`. Fail-safe, wrong class, and invisible to any check that
  // only asked whether something blocked.
  expectGuardRejects(guardBlockClass(["apply/write-failed"], "stalePlan"), "NC-5: a neighbour");
  expectGuardRejects(guardBlockClass([], "stalePlan"), "NC-5: nothing blocked at all");
  // Every one of the six classes must be distinguishable from every other.
  for (const [name, token] of Object.entries(BLOCK_CLASS_TOKENS)) {
    expectGuard(guardBlockClass([token], name as keyof typeof BLOCK_CLASS_TOKENS));
    for (const [other, otherToken] of Object.entries(BLOCK_CLASS_TOKENS)) {
      if (other === name) continue;
      expectGuardRejects(
        guardBlockClass([otherToken], name as keyof typeof BLOCK_CLASS_TOKENS),
        `NC-5: \`${otherToken}\` must not satisfy \`${name}\``,
      );
    }
  }
});

test("NC-6: identical bytes at a DIFFERENT inode are reported as a change", () => {
  // An atomic replace produces byte-identical content at a new inode. A
  // hash-only comparison calls that "unchanged", which is exactly how a
  // preserved-external-bytes claim goes vacuous. Inode equality is load-bearing.
  const witness = { sha256: "b".repeat(64), ino: 41, mtimeMs: 1000 };
  const same = new Map([["kept.txt", witness]]);
  const replaced = new Map([["kept.txt", { ...witness, ino: 42 }]]);
  const diff = diffTrees(same, replaced);
  assert.deepEqual(diff.changed, [], "bytes are identical, so `changed` must be empty");
  assert.deepEqual(diff.replacedInPlace, ["kept.txt"], "the inode moved and must be reported");
  assert.equal(isUntouched(diff), false, "NC-6: an atomic replace is NOT untouched");
  expectGuardRejects(guardDigestWitness(same, diff), "NC-6: an atomic replace");
});

test("NC-7: G5 rejects an EMPTY baseline — nothing protected is not protection", () => {
  const empty = new Map();
  expectGuardRejects(guardDigestWitness(empty, diffTrees(empty, empty)), "NC-7: an empty tree");
  // A non-empty baseline with no change is the real pass.
  const real = new Map([["_local/config.md", { sha256: "c".repeat(64), ino: 7, mtimeMs: 5 }]]);
  expectGuard(guardDigestWitness(real, diffTrees(real, real)));
});

test("NC-8: the fixture packs leak into no normal run (capabilities-ship-inert)", () => {
  // The fixtures are reachable only through a SUBSTITUTED CLI inventory. Over
  // the real repository, with the production `listPlugins`, none of them exists.
  const service = new ResolverService(createDefaultPorts(REPO_ROOT));
  const discovery = service.discoverPacks();
  const observed = new Set(discovery.packs.map((pack) => pack.pluginId));
  for (const name of FIXTURE_NAMES) {
    assert.equal(
      observed.has(qualifiedId(name)),
      false,
      `fixture \`${qualifiedId(name)}\` is visible to a normal run`,
    );
  }
  // And no fixture pack ships a plugin manifest under `plugins/`.
  const packDirs = readdirSync(join(REPO_ROOT, "plugins"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const name of FIXTURE_NAMES) {
    assert.equal(packDirs.includes(`wf-${name}`), false, `wf-${name} exists under plugins/`);
  }
});

test("NC-9: the fixtures module is not a suite, and both new modules are byte-clean", () => {
  // `scripts/test.mjs` globs `test/*.test.ts`. A helper carrying that suffix
  // would be bundled and run as a suite of its own — WF-460 caught exactly this
  // class of "it recurses automatically" assumption, so it is asserted.
  const testFiles = readdirSync(join(MCP_DIR as string, "test")).filter((f) =>
    f.endsWith(".test.ts"),
  );
  assert.ok(testFiles.includes("lifecycle-matrix.test.ts"), "the matrix must be discovered");
  assert.equal(
    testFiles.includes("lifecycle-matrix.fixtures.ts"),
    false,
    "the fixtures helper must NOT match the runner's suite glob",
  );
  // Neither new module may carry a control character — WF-449 nearly shipped two
  // literal NULs in an owner key, which makes a file register as BINARY to git.
  // The pattern is built from explicit escapes so this assertion cannot itself
  // smuggle in the bytes it forbids.
  const control = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]");
  for (const file of ["lifecycle-matrix.test.ts", "lifecycle-matrix.fixtures.ts"]) {
    const body = readFileSync(join(MCP_DIR as string, "test", file), "utf8");
    assert.equal(control.test(body), false, `${file} carries a control character`);
  }
});

// ===========================================================================
// SC-4 — the six block classes, each by its PRECISE token, before any byte
// ===========================================================================
//
// "Blocks before mutation" is fail-closed with ZERO bytes written, not
// fail-partway. Every scenario here takes a full recursive tree digest either
// side of the refusal and routes it through G5, which refuses to score an empty
// baseline.

test("S-14 (SC-4): CONFLICTS block as `plan/capability-conflict`", () => {
  withMatrix({ packs: ["alpha", "beta", "delta"] }, (ws) => {
    const before = postRecoveryBaseline(ws);
    const plan = ws.service.planInstall(ws.admission, {
      desired: select("beta", "delta"),
      deregister: [],
      answers: answer("safe"),
    });
    expectGuard(guardBlockClass(codes(plan), "conflicts"));
    assert.notEqual(plan.applicability, "applicable");
    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
  });
});

test("S-15 (SC-4): DUPLICATE INVENTORY blocks as `plan/inventory-untrustworthy`", () => {
  withMatrix({ packs: ["alpha", "beta"], duplicate: "alpha" }, (ws) => {
    const before = postRecoveryBaseline(ws);
    const discovery = ws.service.discoverPacks();
    assert.notEqual(
      discovery.inventory.confidence,
      "trustworthy",
      "a duplicated entry must not read as trustworthy",
    );
    assert.equal(
      discovery.inventory.mayEstablishAbsence,
      false,
      "an untrustworthy inventory may never establish that nobody owns a file",
    );
    // A duplicated entry does not merely lower confidence: the pack set collapses
    // to empty, because an ambiguous inventory may not be used to identify a pack.
    assert.deepEqual(discovery.packs, [], "an invalid inventory identifies no pack");

    // THE TRUE CLASS is reported by the surface whose selection is DERIVED rather
    // than supplied. `repair_packs` derives `desired` from the registry, so it
    // reaches the inventory verdict itself.
    const repair = ws.service.repairPacks(ws.admission);
    expectGuard(
      guardBlockClass(
        repair.plan.findings.map((f) => f.code),
        "duplicateInventory",
      ),
    );
    assert.notEqual(repair.plan.applicability, "applicable");

    // OBSERVED MASKING, pinned rather than glossed: over `plan_install` the same
    // world reports the NEIGHBOURING class `plan/unknown-selection`, because the
    // supplied id can no longer be resolved against an empty pack set. Both fail
    // closed, but a caller reading only `plan_install` cannot tell a duplicated
    // inventory from a typo'd pack id. This assertion exists so that if the
    // reported class is ever tightened, this matrix notices.
    const plan = ws.service.planInstall(ws.admission, {
      desired: select("alpha"),
      deregister: [],
      answers: [],
    });
    assert.ok(
      codes(plan).includes("plan/unknown-selection"),
      `expected the masking class, got [${codes(plan)}]`,
    );
    assert.equal(
      codes(plan).includes(BLOCK_CLASS_TOKENS.duplicateInventory),
      false,
      "plan_install now reports the true inventory class — tighten this scenario",
    );

    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
  });
});

test("S-16 (SC-4): an UNSAFE DESTINATION blocks as `plan/payload-unsafe-target`", () => {
  // The CONTAINMENT sub-class: a lexically-valid destination whose canonical
  // target escapes the workspace because a parent is a symlink. This is the
  // refusal `resolveContainedPayloadTarget` exists for — it canonicalizes before
  // deciding, and never creates the path it tests.
  withMatrix({ packs: ["beta"] }, (ws) => {
    const outside = join(ws.root, "outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(ws.workspace, ".wf"), "dir");

    const before = postRecoveryBaseline(ws);
    const plan = ws.service.planInstall(ws.admission, {
      desired: select("beta"),
      deregister: [],
      answers: answer("safe"),
    });
    expectGuard(guardBlockClass(codes(plan), "unsafeDestination"));
    assert.notEqual(plan.applicability, "applicable");

    // The rejection names its own closed token — not a generic failure.
    assert.deepEqual(
      [...new Set(plan.payloads.rejected.map((r) => r.rejection))],
      ["symlink-escape"],
      "the containment refusal must name its precise token",
    );
    assert.deepEqual(plan.payloads.actions, [], "no escaping target may be composed");
    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
    // And nothing was written THROUGH the symlink either.
    assert.deepEqual(readdirSync(outside), [], "bytes were written outside the workspace");
  });
});

test("S-16b (SC-4): a LEXICALLY unsafe destination is refused earlier still", () => {
  // The second unsafe-destination sub-class, and it never reaches the
  // containment check at all: a `..` segment is refused during MANIFEST
  // VALIDATION, which invalidates the pack, so planning stops on incomplete
  // proof before any payload row is evaluated. Proved separately so neither
  // sub-class can silently stand in for the other.
  withMatrix({ packs: ["alpha", "epsilon"] }, (ws) => {
    const inspected = ws.service.inspectPack(qualifiedId("epsilon"));
    assert.equal(inspected.valid, false, "a `..` destination must invalidate the pack");
    assert.ok(
      inspected.issues.some(
        (issue) => issue.includes("`destination`") && issue.includes("`..` segment"),
      ),
      `the issue must name the destination rule, got ${JSON.stringify(inspected.issues)}`,
    );

    const before = postRecoveryBaseline(ws);
    const plan = ws.service.planInstall(ws.admission, {
      desired: select("epsilon"),
      deregister: [],
      answers: [],
    });
    assert.notEqual(plan.applicability, "applicable");
    assert.ok(
      codes(plan).includes("plan/legacy-proof-incomplete"),
      `expected the earlier refusal, got [${codes(plan)}]`,
    );
    // The escaping destination never becomes an action, and no payload row is
    // even previewed — the pack was invalid before that stage.
    assert.equal(
      plan.actions.some((a) => a.destination === ESCAPING_DESTINATION),
      false,
      "an escaping destination reached the action list",
    );
    assert.deepEqual(plan.payloads.actions, []);
    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
    assert.equal(
      readdirSync(ws.root).includes("escape.bin"),
      false,
      "an escaping payload was written outside the workspace",
    );
  });
});

test("S-17 (SC-4): UNEQUAL SHARED TARGETS block as `plan/payload-conflict-bytes`", () => {
  withMatrix({ packs: ["beta", "gamma"] }, (ws) => {
    // `beta` and `gamma` legitimately co-declare one destination with EQUAL
    // sources. Making gamma's source disagree is the unequal-shared-target class.
    ws.writePackSource("gamma", "assets/shared.bin", "matrix-shared-payload-DIVERGED\n");
    const before = postRecoveryBaseline(ws);
    const plan = ws.service.planInstall(ws.admission, {
      desired: select("beta", "gamma"),
      deregister: [],
      answers: answer("safe"),
    });
    expectGuard(guardBlockClass(codes(plan), "unequalSharedTarget"));
    assert.ok(plan.payloads.conflicts.length > 0, "the conflict must be enumerated");
    assert.equal(
      plan.actions.some((a) => a.kind === "payload-write" && a.destination === SHARED_DESTINATION),
      false,
      "an unequal shared target reached the action list",
    );
    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
  });
});

test("S-18 (SC-4): an INVALID ANSWER blocks as `plan/answer-invalid`", () => {
  withMatrix({ packs: ["beta"] }, (ws) => {
    const before = postRecoveryBaseline(ws);
    // `beta-mode` is an enum over ["safe", "fast"].
    const plan = ws.service.planInstall(ws.admission, {
      desired: select("beta"),
      deregister: [],
      answers: answer("catastrophic"),
    });
    expectGuard(guardBlockClass(codes(plan), "invalidAnswer"));
    assert.equal(
      plan.actions.some((a) => a.kind === "answer-write"),
      false,
      "an out-of-schema answer reached the action list",
    );
    expectGuard(guardDigestWitness(before, diffTrees(before, digestTree(ws.workspace))));
  });
});

test("S-19 (SC-4): a STALE PLAN blocks as `apply/plan-stale`, not a neighbour", () => {
  withMatrix({ packs: ["alpha", "beta"] }, (ws) => {
    const selection = { desired: select("alpha", "beta"), deregister: [], answers: answer("safe") };
    const plan = ws.service.planInstall(ws.admission, selection);
    expectGuard(guardActionablePlan(plan));

    const before = postRecoveryBaseline(ws);
    const applied = ws.service.applyInstall(ws.admission, selection, "0".repeat(64));

    // The precise class — NOT `apply/write-failed`, which is the exact
    // wrong-class defect WF-459 shipped and QA caught.
    expectGuard(guardBlockClass([applied.reason ?? ""], "stalePlan"));
    assert.equal(applied.status, "rejected");
    assert.equal(applied.plan.matched, false);
    assert.deepEqual(applied.applied, [], "`applied[]` is non-empty only for status `applied`");
    assert.equal(applied.transactionId, null, "no transaction may exist for a refused plan");

    // Before the first byte: no journal, no backup dir, no lock residue.
    const diff = diffTrees(before, digestTree(ws.workspace));
    expectGuard(guardDigestWitness(before, diff));
    for (const residue of [LIFECYCLE_JOURNAL_PATH, LIFECYCLE_BACKUP_DIR, LIFECYCLE_LOCK_PATH]) {
      assert.equal(
        existsRel(ws.workspace, residue),
        false,
        `${residue} exists after a refusal that must precede any journal`,
      );
    }
  });
});
