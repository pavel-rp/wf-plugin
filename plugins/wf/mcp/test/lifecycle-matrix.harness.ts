// WF-466 — the shared harness both halves of the lifecycle matrix run on.
//
// Deliberately NOT named `*.test.ts`: the runner globs that pattern, and a test
// file importing another test file would run the imported suite twice and
// double-count the matrix. Guards and fixtures live in
// `lifecycle-matrix.fixtures.ts`; the scenarios live in
// `lifecycle-matrix.test.ts` (block classes + controls) and
// `lifecycle-matrix.journeys.test.ts` (the six criteria's journeys).

import assert from "node:assert/strict";
import { lstatSync, rmSync } from "node:fs";
import { join } from "node:path";
import { normalizeSlashes } from "../src/resolver/paths.js";
import type { PlanInstallResponse } from "../src/resolver/types.js";
import {
  diffTrees,
  digestTree,
  guardActionablePlan,
  guardAppliedForReal,
  guardQualifiedSelection,
  makeMatrixWorkspace,
  qualifiedId,
  type FixtureName,
  type MatrixOptions,
  type MatrixWorkspace,
} from "./lifecycle-matrix.fixtures.js";

/** Every scenario runs against a workspace root that is NOT `process.cwd()`.
 *  That is the non-cwd root journey: WF-445's family guard binds the admissible
 *  root to the PROCESS LAUNCH DIRECTORY before service construction, so non-cwd
 *  admission is not provable over the wire — it is provable here, at the service
 *  layer, and every scenario below exercises it. */
export function withMatrix(options: MatrixOptions, body: (ws: MatrixWorkspace) => void): void {
  const ws = makeMatrixWorkspace(options);
  assert.notEqual(ws.workspace, normalizeSlashes(process.cwd()), "the root must not be the cwd");
  try {
    body(ws);
  } finally {
    rmSync(ws.root, { recursive: true, force: true });
  }
}

export const select = (...names: FixtureName[]): string[] => names.map(qualifiedId);
export const answer = (value: unknown) => [
  { pluginId: qualifiedId("beta"), questionId: "beta-mode", value },
];
export const codes = (plan: PlanInstallResponse): string[] => plan.findings.map((f) => f.code);
export const expectGuard = (outcome: { ok: boolean; reason: string }): void => {
  assert.ok(outcome.ok, outcome.reason);
};
export const expectGuardRejects = (outcome: { ok: boolean; reason: string }, why: string): void => {
  assert.equal(outcome.ok, false, `${why} — the guard PASSED, so it is not a guard.`);
};

/**
 * The POST-RECOVERY baseline.
 *
 * Byte-inertness is a claim about everything AFTER recovery, not about the whole
 * run: recovery is entitled to act, and `ensure()` may (re)build the resolver's
 * own gitignored snapshot cache — the shared read-query machinery every typed
 * resolver query already runs, not a lifecycle write. Taking the digest cold
 * therefore produces a FALSE red on `_local/resolver/snapshot.json`, which is
 * how a real observation gets mistaken for a defect.
 *
 * So every inertness scenario drives one recovery-first call, and only then
 * takes the full recursive tree digest it will hold the rest of the run to.
 */
export function postRecoveryBaseline(ws: MatrixWorkspace) {
  ws.service.discoverPacks();
  return digestTree(ws.workspace);
}

export function existsRel(root: string, rel: string): boolean {
  try {
    lstatSync(join(root, rel));
    return true;
  } catch {
    return false;
  }
}

/** Install a selection and return the applied envelope plus the digests around
 *  it. Every install in the matrix goes through here, so G1/G2/G3 are never
 *  accidentally skipped. */
export function install(
  ws: MatrixWorkspace,
  names: FixtureName[],
  opts: { answers?: ReturnType<typeof answer>; expectDestinations?: string[] } = {},
) {
  const discovery = ws.service.discoverPacks();
  const desired = select(...names);
  expectGuard(guardQualifiedSelection(discovery, desired));

  const selection = { desired, deregister: [], answers: opts.answers ?? answer("safe") };
  const plan = ws.service.planInstall(ws.admission, selection);
  expectGuard(guardActionablePlan(plan));

  const before = postRecoveryBaseline(ws);
  const applied = ws.service.applyInstall(ws.admission, selection, plan.identity.planId);
  const after = digestTree(ws.workspace);
  const diff = diffTrees(before, after);
  expectGuard(guardAppliedForReal(applied, diff, opts.expectDestinations ?? []));
  return { discovery, plan, applied, before, after, diff, selection };
}
