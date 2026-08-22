// WF-466 — the bounded fake-pack matrix: fixtures, tree digests, and the
// anti-vacuity guards.
//
// This module is deliberately NOT named `*.test.ts`. `scripts/test.mjs` globs
// `test/*.test.ts`, so a helper carrying that suffix would be bundled and run as
// a suite of its own. `lifecycle-matrix.test.ts` asserts that fact rather than
// assuming it.
//
// WHY FIXTURE PACKS LIVE HERE AND NOT IN A PACK FOLDER
// ----------------------------------------------------
// `ResolverService.discoverPacksWithInspection()` sources its inventory from
// `ports.listPlugins()` (`src/service.ts`), whose production implementation
// shells out to the Claude CLI (`src/ports.ts`). A pack is discoverable ONLY if
// the host CLI lists it — never because it exists somewhere in this repository.
// So a *fake-pack* matrix cannot be driven over the wire, where `listPlugins` is
// production; the one boundary that must be substituted is `listPlugins`, and
// that substitution is only possible in-process.
//
// Everything else is production: `createDefaultPorts` supplies the real
// filesystem, the real containment resolver, the real recovery ports, and the
// real apply ports. No lifecycle decision is re-implemented here.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultPorts } from "../src/ports.js";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import type {
  ApplyInstallResponse,
  DiscoverPacksResponse,
  PlanAdmissionState,
  PlanInstallResponse,
} from "../src/resolver/types.js";

// ---------------------------------------------------------------------------
// The five fixture packs — one equivalence class each
// ---------------------------------------------------------------------------
//
// Bounded to representative classes on purpose: "exhaustive pack combinations"
// is out of scope for WF-466. Each pack below is the SMALLEST tree that puts its
// class on the wire, and no pack carries a second class as a side effect.

/** The shared payload destination `beta` and `gamma` both declare. Two packs
 *  declaring ONE destination is the only way to reach the `shared` preservation
 *  class and the unequal-shared-target refusal. */
export const SHARED_DESTINATION = ".wf/shared.bin";

/** The bytes `beta` and `gamma` agree on. Equal sources are a LEGAL shared
 *  target; the unequal case is produced by rewriting `gamma`'s source, not by a
 *  sixth fixture. */
export const SHARED_SOURCE_BYTES = "matrix-shared-payload-v1\n";

/** `beta`'s sole owned destination — the artifact whose upgrade, edit, and
 *  deletion the matrix exercises without disturbing the shared one. */
export const BETA_DESTINATION = ".wf/beta.bin";
export const BETA_SOURCE_BYTES = "matrix-beta-payload-v1\n";

/** A destination that escapes the workspace. Refused by the containment
 *  boundary before any target is composed. */
export const ESCAPING_DESTINATION = "../escape.bin";

export type FixtureName = "alpha" | "beta" | "gamma" | "delta" | "epsilon";

interface FixtureSpec {
  /** The capability the pack declares. */
  readonly capability: string;
  /** The manifest body, minus the payload section. */
  readonly manifest: string;
  /** `source relative path -> bytes`, written under the pack root. */
  readonly sources: Readonly<Record<string, string>>;
  /** A profile template, when the class needs a declared question. */
  readonly profileTemplate: string | null;
}

function manifestHead(capability: string, kind: string, extra = ""): string {
  return `# ${capability} capability

**Kind:** ${kind}

article: ${capability}-rule = required
${extra}
## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | guidance | \`inline: fragments/${capability}.ops.md\` | |
`;
}

function payloadSection(rows: ReadonlyArray<readonly [string, string]>): string {
  const body = rows
    .map(
      ([source, destination]) =>
        `| ${source} | ${destination} | copy | replace-if-unmodified | delete-if-unmodified |`,
    )
    .join("\n");
  return `
## Payloads

| Source | Destination | Production | Refresh | Removal |
|--------|-------------|------------|---------|---------|
${body}
`;
}

const FIXTURES: Readonly<Record<FixtureName, FixtureSpec>> = {
  // CLASS: minimal registrable unit. Fragments only, no question, no payload.
  // Every other fixture is this plus exactly one axis.
  alpha: {
    capability: "alpha",
    manifest: manifestHead("alpha", "adapter"),
    sources: { "fragments/alpha.ops.md": "# alpha ops\n\nInert guidance.\n" },
    profileTemplate: null,
  },

  // CLASS: answer-and-artifact pack. The ONLY fixture that exercises answers,
  // payload installation, upgrade, and deletion authority.
  beta: {
    capability: "beta",
    manifest:
      manifestHead("beta", "both") +
      "\nprofile-template: profile.template.json\n" +
      payloadSection([
        ["assets/beta.bin", BETA_DESTINATION],
        ["assets/shared.bin", SHARED_DESTINATION],
      ]),
    sources: {
      "fragments/beta.ops.md": "# beta ops\n\nInert guidance.\n",
      "assets/beta.bin": BETA_SOURCE_BYTES,
      "assets/shared.bin": SHARED_SOURCE_BYTES,
    },
    profileTemplate: JSON.stringify({
      ask: [
        {
          id: "beta-mode",
          destination: "beta-mode",
          prompt: "Operating mode?",
          schema: { type: "enum", values: ["safe", "fast"] },
        },
      ],
    }),
  },

  // CLASS: co-declarer. Declares `beta`'s shared destination as well — the
  // `shared` preservation class, the unequal-shared-target refusal, and the
  // known `service.ts` co-declarer precondition defect.
  gamma: {
    capability: "gamma",
    manifest:
      manifestHead("gamma", "adapter") + payloadSection([["assets/shared.bin", SHARED_DESTINATION]]),
    sources: {
      "fragments/gamma.ops.md": "# gamma ops\n\nInert guidance.\n",
      "assets/shared.bin": SHARED_SOURCE_BYTES,
    },
    profileTemplate: null,
  },

  // CLASS: incompatible pack. The conflict is a REGISTRY-VALIDATION refusal, not
  // a filesystem one — which is exactly why it must be distinguished from the
  // other five block classes rather than merely observed to block.
  delta: {
    capability: "delta",
    manifest: manifestHead("delta", "adapter", "\nconflicts: beta\n"),
    sources: { "fragments/delta.ops.md": "# delta ops\n\nInert guidance.\n" },
    profileTemplate: null,
  },

  // CLASS: unsafe destination. Refused by the containment boundary, which
  // canonicalizes before deciding and never creates the path it tests.
  epsilon: {
    capability: "epsilon",
    manifest:
      manifestHead("epsilon", "adapter") +
      payloadSection([["assets/escape.bin", ESCAPING_DESTINATION]]),
    sources: {
      "fragments/epsilon.ops.md": "# epsilon ops\n\nInert guidance.\n",
      "assets/escape.bin": "matrix-escaping-payload\n",
    },
    profileTemplate: null,
  },
};

export const FIXTURE_NAMES: readonly FixtureName[] = ["alpha", "beta", "gamma", "delta", "epsilon"];

/** The QUALIFIED id every selection must use. WF-464's whole 5/5 green measured
 *  nothing because its harness passed bare pack names while the resolver keys on
 *  qualified ids; `guardQualifiedSelection` (G1) exists to make that failure
 *  impossible to repeat silently, and NC-1 proves it fires on this host. */
export const qualifiedId = (name: FixtureName): string => `wf-${name}@matrix`;

const BASE_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
`;

// ---------------------------------------------------------------------------
// Workspace construction
// ---------------------------------------------------------------------------

export interface MatrixWorkspace {
  /** The throwaway parent. Remove this to clean up everything. */
  readonly root: string;
  /** The admitted workspace root — deliberately NOT `process.cwd()`. */
  readonly workspace: string;
  readonly admission: PlanAdmissionState;
  readonly service: ResolverService;
  readonly ports: ResolverServicePorts;
  readonly packRoots: Readonly<Record<string, string>>;
  /** Rewrite a fixture pack's source bytes, e.g. to make a shared target
   *  unequal or to move a declared source so an advance becomes available. */
  writePackSource(name: FixtureName, relPath: string, bytes: string): void;
}

export interface MatrixOptions {
  /** Which fixture packs the substituted CLI inventory lists. */
  readonly packs: readonly FixtureName[];
  /** Capability rows pre-seeded into the registry (an already-installed world). */
  readonly registered?: readonly FixtureName[];
  /** List one pack twice — the duplicate-inventory equivalence class. */
  readonly duplicate?: FixtureName | null;
  /** Extra files seeded into the workspace, `relPath -> bytes`. Used for the
   *  external-bytes scenario, whose file the lifecycle must never own. */
  readonly seedFiles?: Readonly<Record<string, string>>;
  /** Replace a fixture's manifest body wholesale. Used to reach the partition
   *  half of precedence (two packs claiming ONE provider surface) without adding
   *  a sixth fixture pack, which the bounded-classes constraint forbids. */
  readonly manifestOverrides?: Partial<Record<FixtureName, string>>;
}

/** A manifest whose single fragment claims a PROVIDER surface. Partition kinds
 *  admit only the owning capability, so two packs carrying this are a
 *  registry-validation error rather than an aggregation. */
export function providerManifest(capability: string, surface: string): string {
  return `# ${capability} capability

**Kind:** adapter

article: ${capability}-rule = required

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| qa-execution | provider | \`inline: fragments/${capability}.ops.md\` | ${surface} |
`;
}

export function makeMatrixWorkspace(options: MatrixOptions): MatrixWorkspace {
  const root = normalizeSlashes(mkdtempSync(join(tmpdir(), "wf466-matrix-")));
  const workspace = normalizeSlashes(join(root, "workspace"));
  mkdirSync(join(workspace, "_local"), { recursive: true });

  const packRoots: Record<string, string> = {};
  for (const name of options.packs) {
    const spec = FIXTURES[name];
    const packRoot = normalizeSlashes(join(root, `wf-${name}`));
    const capabilityRoot = join(packRoot, "capabilities", spec.capability);
    mkdirSync(capabilityRoot, { recursive: true });
    writeFileSync(
      join(capabilityRoot, "manifest.md"),
      options.manifestOverrides?.[name] ?? spec.manifest,
    );
    if (spec.profileTemplate !== null) {
      writeFileSync(join(capabilityRoot, "profile.template.json"), spec.profileTemplate);
    }
    for (const [rel, bytes] of Object.entries(spec.sources)) {
      const target = join(capabilityRoot, rel);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, bytes);
    }
    packRoots[name] = packRoot;
  }

  const rootRows = options.packs.map((name) => `| wf-${name} | ${packRoots[name]} |`).join("\n");
  const capabilityRows = (options.registered ?? [])
    .map(
      (name) =>
        `| ${FIXTURES[name].capability} | plugin:wf-${name}/capabilities/${FIXTURES[name].capability} |`,
    )
    .join("\n");
  writeFileSync(
    join(workspace, "_local", "config.md"),
    `${BASE_CONFIG}
## Plugin Roots

| Plugin | Root |
|---|---|
${rootRows}

## Capabilities

| Capability | Path |
|---|---|
${capabilityRows}
`,
  );

  for (const [rel, bytes] of Object.entries(options.seedFiles ?? {})) {
    const target = join(workspace, rel);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, bytes);
  }

  const listed = options.packs.map((name) => ({
    id: qualifiedId(name),
    version: "1.0.0",
    scope: "user",
    enabled: true,
    installPath: packRoots[name],
  }));
  if (options.duplicate) {
    const twin = listed.find((entry) => entry.id === qualifiedId(options.duplicate as FixtureName));
    if (twin) listed.push({ ...twin });
  }
  const pluginListRaw = JSON.stringify(listed);

  const production = createDefaultPorts(workspace);
  const ports: ResolverServicePorts = {
    ...production,
    listPlugins: () => ({ ...parsePluginList(pluginListRaw), ok: true }),
    resolveFresh: () =>
      resolveSnapshot({
        workspaceRoot: workspace,
        pluginListRaw,
        now: () => new Date("2026-08-22T00:00:00.000Z"),
      }),
  };

  return {
    root,
    workspace,
    admission: {
      admitted: true,
      root: workspace,
      source: "explicit",
      reason: null,
      diagnostic: null,
    },
    service: new ResolverService(ports),
    ports,
    packRoots,
    writePackSource(name, relPath, bytes) {
      const spec = FIXTURES[name];
      writeFileSync(
        join(packRoots[name], "capabilities", spec.capability, relPath),
        bytes,
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Tree digests — the witness every "no bytes written" claim rests on
// ---------------------------------------------------------------------------

export interface FileWitness {
  readonly sha256: string;
  /** Load-bearing. An atomic replace producing IDENTICAL bytes changes the
   *  inode, so a hash-only comparison would call it unchanged. NC-6 proves the
   *  comparator below actually notices. */
  readonly ino: number;
  readonly mtimeMs: number;
}

export type TreeDigest = ReadonlyMap<string, FileWitness>;

/** A FULL recursive digest of `dir`. Directories are descended; symlinks are
 *  recorded by their own stat rather than followed, so a symlink swap shows up
 *  as a change instead of silently reading through. */
export function digestTree(dir: string, prefix = ""): Map<string, FileWitness> {
  const out = new Map<string, FileWitness>();
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const [k, v] of digestTree(abs, rel)) out.set(k, v);
      continue;
    }
    try {
      const stat = statSync(abs, { bigint: false });
      const bytes = entry.isFile() ? readFileSync(abs) : Buffer.from(rel);
      out.set(rel, {
        sha256: createHash("sha256").update(bytes).digest("hex"),
        ino: Number(stat.ino),
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      out.set(rel, { sha256: "unreadable", ino: -1, mtimeMs: -1 });
    }
  }
  return out;
}

export interface DigestDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  /** Bytes differ. */
  readonly changed: readonly string[];
  /** Bytes are IDENTICAL but the inode moved — an atomic replace. Reported on
   *  its own channel precisely so it cannot be mistaken for "unchanged". */
  readonly replacedInPlace: readonly string[];
}

export function diffTrees(before: TreeDigest, after: TreeDigest): DigestDiff {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  const replacedInPlace: string[] = [];
  for (const [path, now] of after) {
    const then = before.get(path);
    if (!then) {
      added.push(path);
      continue;
    }
    if (then.sha256 !== now.sha256) changed.push(path);
    else if (then.ino !== now.ino) replacedInPlace.push(path);
  }
  for (const path of before.keys()) if (!after.has(path)) removed.push(path);
  return {
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.sort(),
    replacedInPlace: replacedInPlace.sort(),
  };
}

export const isUntouched = (diff: DigestDiff): boolean =>
  diff.added.length === 0 &&
  diff.removed.length === 0 &&
  diff.changed.length === 0 &&
  diff.replacedInPlace.length === 0;

// ---------------------------------------------------------------------------
// The guards. Every scoring assertion routes through one of these.
// ---------------------------------------------------------------------------

export interface GuardOutcome {
  readonly ok: boolean;
  readonly reason: string;
}

const pass = (reason: string): GuardOutcome => ({ ok: true, reason });
const fail = (reason: string): GuardOutcome => ({ ok: false, reason });

/**
 * G1 — the selection is expressed in QUALIFIED ids, and every one of them is
 * actually present in the inventory this run observed.
 *
 * This is WF-464's exact failure encoded as a guard: its harness passed bare
 * pack names, every plan came back `plan/unknown-selection` / `blocked: true`,
 * and a blocked plan's `deregistrations: []` is empty BY CONSTRUCTION rather
 * than by the property under test. NC-1 reproduces that call on this host and
 * asserts this guard rejects it.
 */
export function guardQualifiedSelection(
  discovery: DiscoverPacksResponse,
  selection: readonly string[],
): GuardOutcome {
  if (selection.length === 0) return fail("G1: the selection is empty — nothing was measured.");
  if (discovery.inventory.confidence !== "trustworthy") {
    return fail(`G1: inventory confidence is \`${discovery.inventory.confidence}\`, not trustworthy.`);
  }
  const present = new Map(discovery.packs.map((pack) => [pack.pluginId, pack]));
  for (const id of selection) {
    if (!id.includes("@")) {
      return fail(`G1: \`${id}\` is a bare pack name — the resolver keys on qualified ids.`);
    }
    const pack = present.get(id);
    if (!pack) return fail(`G1: \`${id}\` is absent from the observed inventory.`);
    if (pack.presence !== "installed") {
      return fail(`G1: \`${id}\` has presence \`${pack.presence}\`, not \`installed\`.`);
    }
  }
  return pass(`G1: ${selection.length} qualified id(s), all present and installed.`);
}

/**
 * G2 — a plan claimed SUCCESSFUL must really be actionable.
 *
 * The fourth conjunct is the one that matters, and it is deliberately STRONGER
 * than WF-465's bar. WF-465 required a non-empty `actions[]`; measured here, that
 * is not sufficient — a BLOCKED plan over a workspace with managed artifacts
 * still carries non-mutating `artifact-retain` entries, so `actions[]` is
 * non-empty and the weaker conjunct passes. This guard requires at least one
 * MUTATING action, which is the thing a scenario claiming "the plan did X" is
 * actually relying on.
 *
 * NC-2 feeds this a blocked plan and NC-3 feeds it a REAL, well-formed,
 * SUCCESSFUL `no-change` plan — the control that proves the guard rejects
 * success, not just garbage.
 */
export function guardActionablePlan(plan: PlanInstallResponse): GuardOutcome {
  if (plan.applicability !== "applicable") {
    return fail(`G2: applicability is \`${plan.applicability}\`, not \`applicable\`.`);
  }
  if (plan.applicabilityBasis.blockingFindings.length > 0) {
    return fail(
      `G2: ${plan.applicabilityBasis.blockingFindings.length} blocking finding(s): ${plan.applicabilityBasis.blockingFindings.join(", ")}.`,
    );
  }
  const errors = plan.findings.filter((finding) => finding.severity === "error");
  if (errors.length > 0) {
    return fail(`G2: ${errors.length} error finding(s): ${errors.map((f) => f.code).join(", ")}.`);
  }
  const mutating = plan.actions.filter((action) => action.mutating);
  if (mutating.length === 0) {
    return fail(
      `G2: the plan authorizes no MUTATING action (${plan.actions.length} non-mutating entr(ies)) — nothing to assert against.`,
    );
  }
  return pass(`G2: applicable, unblocked, ${mutating.length} mutating action(s).`);
}

/**
 * G3 — an apply that claims to have applied must have MOVED BYTES.
 *
 * `status: "applied"` is a string; the tree digest is evidence. NC-4 feeds this
 * a well-formed applied envelope over an unchanged tree and asserts refusal.
 */
export function guardAppliedForReal(
  apply: ApplyInstallResponse,
  diff: DigestDiff,
  expectedDestinations: readonly string[],
): GuardOutcome {
  if (apply.status !== "applied") {
    return fail(`G3: status is \`${apply.status}\` (reason \`${apply.reason ?? "none"}\`).`);
  }
  if (apply.applied.length === 0) return fail("G3: `applied[]` is empty.");
  const touched = new Set([...diff.added, ...diff.changed, ...diff.replacedInPlace]);
  if (touched.size === 0) {
    return fail("G3: the tree is byte-identical — nothing was actually applied.");
  }
  const missing = expectedDestinations.filter((dest) => !touched.has(dest));
  if (missing.length > 0) {
    return fail(`G3: expected destination(s) untouched: ${missing.join(", ")}.`);
  }
  return pass(`G3: applied, ${apply.applied.length} target(s), ${touched.size} path(s) moved.`);
}

/**
 * The six block classes, each with its own precise token. Held in ONE place so
 * G4 can assert both halves — that the observed token is the expected one, and
 * that it is not any of the other five.
 */
export const BLOCK_CLASS_TOKENS = {
  conflicts: "plan/capability-conflict",
  duplicateInventory: "plan/inventory-untrustworthy",
  /** The CONTAINMENT refusal, reached by a lexically-valid destination whose
   *  canonical target escapes the workspace (a symlinked parent). The other,
   *  earlier unsafe-destination sub-class — a LEXICALLY invalid destination
   *  (`..`, absolute, backslash, NUL) — never reaches this code at all: it is
   *  refused during manifest validation, which invalidates the pack. S-16 and
   *  S-16b prove the two separately rather than letting either stand in for the
   *  other. */
  unsafeDestination: "plan/payload-unsafe-target",
  unequalSharedTarget: "plan/payload-conflict-bytes",
  invalidAnswer: "plan/answer-invalid",
  stalePlan: "apply/plan-stale",
} as const;

export type BlockClass = keyof typeof BLOCK_CLASS_TOKENS;

/**
 * G4 — CLASS PRECISION.
 *
 * WF-459 shipped a missing import that made every refusal path throw, so the
 * sole public mutator reported `apply/write-failed` with an `apply-threw`
 * diagnostic instead of the true `apply/plan-stale`. Fail-safe, but the WRONG
 * CLASS — and a 15/15 audit passed straight over it, because every scenario only
 * checked THAT it blocked. This guard checks WHICH.
 *
 * NC-5 feeds it the plausible neighbour and asserts refusal.
 */
export function guardBlockClass(
  observedTokens: readonly string[],
  expected: BlockClass,
): GuardOutcome {
  if (observedTokens.length === 0) return fail(`G4: nothing blocked — expected \`${expected}\`.`);
  const want = BLOCK_CLASS_TOKENS[expected];
  const neighbours = Object.entries(BLOCK_CLASS_TOKENS)
    .filter(([name]) => name !== expected)
    .map(([, token]) => token);
  if (!observedTokens.includes(want)) {
    const strays = observedTokens.filter((token) => neighbours.includes(token));
    return fail(
      strays.length > 0
        ? `G4: reported a NEIGHBOURING class (${strays.join(", ")}) instead of \`${want}\`.`
        : `G4: \`${want}\` absent; observed [${observedTokens.join(", ")}].`,
    );
  }
  return pass(`G4: \`${want}\` reported, and no neighbouring class.`);
}

/**
 * G5 — DIGEST WITNESS.
 *
 * "Nothing was written" is vacuous over an empty tree. A scenario that protects
 * nothing must not be able to pass by protecting it successfully. NC-7 feeds
 * this an empty digest set.
 */
export function guardDigestWitness(before: TreeDigest, diff: DigestDiff): GuardOutcome {
  if (before.size === 0) {
    return fail("G5: the baseline digest is empty — there was nothing to protect.");
  }
  if (!isUntouched(diff)) {
    return fail(
      `G5: bytes moved — added [${diff.added}], removed [${diff.removed}], changed [${diff.changed}], replaced-in-place [${diff.replacedInPlace}].`,
    );
  }
  return pass(`G5: ${before.size} file(s) witnessed, none touched.`);
}

/**
 * The FOUR-CONJUNCT settled predicate, reused verbatim from
 * `plugins/wf/skills/init/references/reconcile-mode.md` Step R2 (lines 58-65).
 *
 * Reused, NOT re-derived. Conjuncts 2 and 4 are not decoration: `applicability`
 * is derived from `deletable`/`bootstrap`/`advance` only, so a workspace whose
 * sole issue is a withheld advance or a hand-edited artifact still reports
 * `no-change`. Calling that "no drift" is the exact collapse this predicate
 * refuses.
 */
export function isSettled(repair: {
  plan: PlanInstallResponse;
  diagnosis: ReadonlyArray<{ drift: string }>;
  withheldAdvances: readonly unknown[];
}): GuardOutcome {
  if (repair.plan.applicability !== "no-change") {
    return fail(`settled#1: applicability is \`${repair.plan.applicability}\`.`);
  }
  if (repair.withheldAdvances.length > 0) {
    return fail(`settled#2: ${repair.withheldAdvances.length} withheld advance(s).`);
  }
  const drifted = repair.diagnosis.filter((row) => row.drift !== "settled");
  if (drifted.length > 0) {
    return fail(`settled#3: ${drifted.length} pack(s) not settled.`);
  }
  const notRetained = repair.plan.artifacts.retained.filter(
    (decision) => decision.reason !== "not-deselected",
  );
  if (notRetained.length > 0) {
    return fail(
      `settled#4: retained divergence — ${notRetained.map((d) => d.reason).join(", ")}.`,
    );
  }
  return pass("settled: all four conjuncts hold.");
}
