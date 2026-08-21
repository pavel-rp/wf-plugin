// Slot composition tests (WF-327, C014 SUB-4).
//
// Drives ResolverService.resolveContent({ class: "slot", … }) over an in-memory
// ports double (no real filesystem, no `claude` CLI) to assert the full
// precedence/merge/unfilled matrix, plus a planSlot-level tier-insertion test
// proving a new intermediate tier changes no existing winner:
//   - replace slot, pack contribution only, no override → pack body served;
//   - replace slot, pack contribution + personal override → override served,
//     deterministically (every run);
//   - append slot, two pack contributions + one override → ONE composed body,
//     parts in registry order with the override LAST;
//   - append slot, pack contributions only (no override) → composed pack parts;
//   - zero contributions + no override → typed `unfilled` (no body, directs to
//     the inline default);
//   - a dangling contributing capability → `unresolved` (registry-invalid);
//   - a declared pack body missing on disk → `unresolved` (ref-not-found);
//   - tier insertion: a synthetic tier registered between local override and
//     pack contribution resolves every pre-existing slot to the SAME winner.
//
// WF-443 adds the committed `.wf/` project-override tier at rank 20 and its own
// matrix, driven through the PRODUCTION chain (`DEFAULT_TIERS`):
//   - replace: project override beats the pack contribution, with project-tier
//     provenance on the winning part;
//   - replace: the personal `_local/` override still beats the project override;
//   - append : pack parts (registry order) → project override → personal override;
//   - a project override alone fills a slot with no pack contributor;
//   - with NO project override present, every winner/part is byte-identical to
//     the pre-WF-443 two-tier chain;
//   - the rank interval invariant and the shipped chain's sorted composition.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { joinSlash, normalizeSlashes } from "../src/resolver/paths.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import {
  composeSlotBody,
  planSlot,
  type SlotContribution,
  type SlotPlan,
  type Tier,
  DEFAULT_TIERS,
  PACK_TIER_RANK,
  PROJECT_TIER_RANK,
  OVERRIDE_TIER_RANK,
} from "../src/resolver/slot.js";
import type { ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";
const CORE = "/core/plugins/wf";

// Distinctive bodies so a wrong-path / wrong-order body is caught.
const REVIEW_ALPHA = "PACK_REVIEW_ALPHA_body";
const NOTES_ALPHA = "NOTES_ALPHA_body";
const NOTES_BETA = "NOTES_BETA_body";
const OVERRIDE_REVIEW = "OVERRIDE_REVIEW_body";
const OVERRIDE_NOTES = "OVERRIDE_NOTES_body";
const PROJECT_REVIEW = "PROJECT_REVIEW_body";
const PROJECT_NOTES = "PROJECT_NOTES_body";
const SYNTH_MID = "SYNTHETIC_FUTURE_body";

// alpha: owns `ship.review` (replace) + contributes to `plan.notes` (append).
const MANIFEST_ALPHA = `# alpha capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| —     | slot | \`inline: hooks/review-alpha.md\` | ship.review replace |
| —     | slot | \`inline: hooks/notes-alpha.md\`  | plan.notes append   |
`;

// beta: second contributor to `plan.notes` (append), registered AFTER alpha.
const MANIFEST_BETA = `# beta capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| —     | slot | \`inline: hooks/notes-beta.md\` | plan.notes append |
`;

const REGISTRY = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path       |
|------------|------------|
| alpha      | caps/alpha |
| beta       | caps/beta  |
`;

/** Base seed: manifests + pack hook bodies. Overrides are added per test. */
function baseFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const seed: Record<string, string> = {
    [`${WS}/_local/config.md`]: REGISTRY,
    [`${WS}/caps/alpha/manifest.md`]: MANIFEST_ALPHA,
    [`${WS}/caps/alpha/hooks/review-alpha.md`]: REVIEW_ALPHA,
    [`${WS}/caps/alpha/hooks/notes-alpha.md`]: NOTES_ALPHA,
    [`${WS}/caps/beta/manifest.md`]: MANIFEST_BETA,
    [`${WS}/caps/beta/hooks/notes-beta.md`]: NOTES_BETA,
  };
  for (const [k, v] of Object.entries(seed)) files.set(normalizeSlashes(k), v);
  return files;
}

function makePorts(files: Map<string, string>): ResolverServicePorts {
  const io = { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };
  let cache: ResolverSnapshot | null = null;
  return {
    workspaceRoot: WS,
    corePluginRoot: CORE,
    resolveFresh: () =>
      resolveSnapshot({
        workspaceRoot: WS,
        io,
        now: () => new Date("2026-07-17T00:00:00.000Z"),
        generator: { name: "wf-resolver", version: "0.3.0" },
      }),
    persist: (snap) => {
      cache = snap;
    },
    readCache: () => cache,
    readFile: (p) => files.get(normalizeSlashes(p)) ?? null,
    writeFile: (p, content) => files.set(normalizeSlashes(p), content),
    listDirs: () => [],
    listPlugins: () => ({ plugins: [], ok: true, contractOk: true, issues: [] }),
    registryRelPath: () => "_local/config.md",
  };
}

function buildSnapshot(files: Map<string, string>): ResolverSnapshot {
  const io = { readFile: (p: string) => files.get(normalizeSlashes(p)) ?? null };
  return resolveSnapshot({
    workspaceRoot: WS,
    io,
    now: () => new Date("2026-07-17T00:00:00.000Z"),
    generator: { name: "wf-resolver", version: "0.3.0" },
  });
}

function overridePath(skillPoint: string): string {
  return normalizeSlashes(joinSlash(WS, "_local/slots", `${skillPoint}.md`));
}

// --- replace: pack only, then + override ------------------------------------

test("replace slot with one pack contribution and no override serves the pack body", () => {
  const svc = new ResolverService(makePorts(baseFiles()));
  const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.policy, "replace");
  assert.equal(r.content, REVIEW_ALPHA);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].source, "alpha");
});

test("replace slot with a pack contribution AND a personal override serves the override, every run", () => {
  const files = baseFiles();
  files.set(overridePath("ship.review"), OVERRIDE_REVIEW);
  const svc = new ResolverService(makePorts(files));
  for (let i = 0; i < 3; i++) {
    const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
    assert.equal(r.status, "composed");
    if (r.status !== "composed") return;
    assert.equal(r.content, OVERRIDE_REVIEW, "the override wins deterministically");
    assert.equal(r.parts[r.parts.length - 1].source, "local-override");
  }
});

// --- append: two pack contributions + override, override LAST ---------------

test("append slot composes pack contributions in registry order with the override LAST", () => {
  const files = baseFiles();
  files.set(overridePath("plan.notes"), OVERRIDE_NOTES);
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "plan", point: "notes" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.policy, "append");
  // Exactly one composed body; parts in registry order (alpha, beta) then override.
  assert.equal(r.content, [NOTES_ALPHA, NOTES_BETA, OVERRIDE_NOTES].join("\n\n"));
  assert.deepEqual(
    r.parts.map((p) => p.source),
    ["alpha", "beta", "local-override"],
  );
});

test("append slot with pack contributions and no override composes just the pack parts", () => {
  const svc = new ResolverService(makePorts(baseFiles()));
  const r = svc.resolveContent({ class: "slot", skill: "plan", point: "notes" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.content, [NOTES_ALPHA, NOTES_BETA].join("\n\n"));
  assert.deepEqual(
    r.parts.map((p) => p.source),
    ["alpha", "beta"],
  );
});

// --- unfilled: zero contributions, no override ------------------------------

test("a slot with zero contributions and no override is typed unfilled (no body)", () => {
  const svc = new ResolverService(makePorts(baseFiles()));
  const r = svc.resolveContent({ class: "slot", skill: "nobody", point: "here" });
  assert.equal(r.status, "unfilled");
  if (r.status !== "unfilled") return;
  assert.equal(r.reaction, "continue");
  assert.equal(r.skillPoint, "nobody.here");
  assert.match(r.recovery, /inline-default/i);
  assert.ok(!("content" in r), "unfilled never carries a body");
  assert.ok(!("path" in r), "unfilled never carries a path");
});

test("an override-only slot (no pack contribution) serves the override as the single body", () => {
  const files = baseFiles();
  files.set(overridePath("solo.point"), "SOLO_OVERRIDE_body");
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "solo", point: "point" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.content, "SOLO_OVERRIDE_body");
  assert.deepEqual(r.parts.map((p) => p.source), ["local-override"]);
});

// --- degradation discipline -------------------------------------------------

test("a slot whose only contributor's manifest is unreadable degrades to unfilled (pack flagged separately)", () => {
  // alpha's folder yields no readable manifest → its fragments are unparsed, so
  // the contribution is invisible to the slot scan: honest best-effort degradation
  // to unfilled, with the broken pack surfaced by the registry projection.
  const files = baseFiles();
  files.delete(normalizeSlashes(`${WS}/caps/alpha/manifest.md`));
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
  assert.equal(r.status, "unfilled");
  if (r.status !== "unfilled") return;
  assert.ok(!("content" in r));
  // The broken pack is not silently lost — the registry projection flags it.
  const alpha = svc.resolveRegistry().capabilities.find((c) => c.name === "alpha");
  assert.equal(alpha?.validity, "unrecoverable");
});

test("two capabilities each replace-claiming one point is unresolved (registry-invalid)", () => {
  // beta ALSO replace-claims ship.review → two owners of a single-owner point.
  const files = baseFiles();
  files.set(
    normalizeSlashes(`${WS}/caps/beta/manifest.md`),
    `# beta capability\n\n**Kind:** adapter\n\n## Fragments\n\n| phase | contribution-kind | dispatch | scope |\n|-------|-------------------|----------|-------|\n| —     | slot | \`inline: hooks/notes-beta.md\` | ship.review replace |\n`,
  );
  files.set(normalizeSlashes(`${WS}/caps/beta/hooks/notes-beta.md`), NOTES_BETA);
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
  assert.equal(r.status, "unresolved");
  if (r.status !== "unresolved") return;
  assert.equal(r.category, "registry-invalid");
  assert.match(r.message, /replace/);
  assert.match(r.message, /alpha/);
  assert.match(r.message, /beta/);
});

test("a non-inline (subagent) slot dispatch is unresolved (registry-invalid), never silently dropped", () => {
  const files = baseFiles();
  files.set(
    normalizeSlashes(`${WS}/caps/alpha/manifest.md`),
    `# alpha capability\n\n**Kind:** adapter\n\n## Fragments\n\n| phase | contribution-kind | dispatch | scope |\n|-------|-------------------|----------|-------|\n| —     | slot | \`subagent: some-agent\` | ship.review replace |\n`,
  );
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
  assert.equal(r.status, "unresolved");
  if (r.status !== "unresolved") return;
  assert.equal(r.category, "registry-invalid");
  assert.match(r.message, /inline/);
});

test("a declared pack body missing on disk is unresolved (ref-not-found), no body", () => {
  const files = baseFiles();
  files.delete(normalizeSlashes(`${WS}/caps/alpha/hooks/review-alpha.md`));
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
  assert.equal(r.status, "unresolved");
  if (r.status !== "unresolved") return;
  assert.equal(r.category, "ref-not-found");
  assert.match(r.message, /review-alpha\.md/);
  assert.ok(!("content" in r));
});

test("a malformed slot ref (bad skill/point segment) is refused", () => {
  const svc = new ResolverService(makePorts(baseFiles()));
  const r = svc.resolveContent({ class: "slot", skill: "Ship", point: "review" });
  assert.equal(r.status, "refused");
});

test("serving a composed slot never leaks a body into the metadata queries", () => {
  const files = baseFiles();
  files.set(overridePath("plan.notes"), OVERRIDE_NOTES);
  const svc = new ResolverService(makePorts(files));
  svc.resolveContent({ class: "slot", skill: "plan", point: "notes" });
  const metadata = JSON.stringify([svc.resolveConfig(), svc.resolveRegistry(), svc.inspect()]);
  for (const body of [NOTES_ALPHA, NOTES_BETA, OVERRIDE_NOTES, REVIEW_ALPHA]) {
    assert.ok(!metadata.includes(body), `metadata leaked a slot body: ${body}`);
  }
});

// --- tier insertion: a synthetic tier changes no existing winner ------------

/** Read + compose exactly as ResolverService.resolveSlot does, so a planSlot
 *  built with a custom tier chain composes identically to the production path. */
function readAndCompose(
  plan: SlotPlan,
  files: Map<string, string>,
): { status: string; policy?: string; content?: string; sources?: string[] } {
  if (plan.kind !== "compose") return { status: plan.kind };
  const present: Array<{ rank: number; source: string; content: string }> = [];
  for (const c of plan.contributions) {
    const content = files.get(normalizeSlashes(c.path)) ?? null;
    if (content === null) {
      if (c.optional) continue;
      return { status: "ref-not-found" };
    }
    present.push({ rank: c.rank, source: c.source, content });
  }
  if (present.length === 0) return { status: "unfilled" };
  return {
    status: "composed",
    policy: plan.policy,
    content: composeSlotBody(plan.policy, present),
    sources: present.map((p) => p.source),
  };
}

/** A synthetic further tier at rank 25 — strictly between the committed project
 *  override (20) and the personal override (30), proving the chain still admits a
 *  new tier now that WF-443 has taken rank 20. Contributes
 *  `_local/synthetic/<id>.md` when present, else nothing. */
const SYNTHETIC_TIER: Tier = {
  name: "synthetic-future",
  rank: 25,
  gather(ctx): SlotContribution[] {
    const path = normalizeSlashes(joinSlash(ctx.workspaceRoot, "_local/synthetic", `${ctx.skillPoint}.md`));
    return [{ tier: "synthetic-future", rank: 25, source: "synthetic-future", path, optional: true }];
  },
};

test("inserting a synthetic tier between override and pack changes no existing winner", () => {
  const files = baseFiles();
  files.set(overridePath("ship.review"), OVERRIDE_REVIEW); // replace + override present
  files.set(overridePath("plan.notes"), OVERRIDE_NOTES); // append + override present
  const snapshot = buildSnapshot(files);

  const withSynthetic: Tier[] = [...DEFAULT_TIERS, SYNTHETIC_TIER];

  // The synthetic tier's own file is ABSENT — it contributes nothing, so every
  // pre-existing slot must resolve to precisely the same winner as before.
  for (const ref of [
    { skill: "ship", point: "review" },
    { skill: "plan", point: "notes" },
  ]) {
    const before = readAndCompose(planSlot(ref, snapshot, WS), files);
    const after = readAndCompose(planSlot(ref, snapshot, WS, withSynthetic), files);
    assert.deepEqual(after, before, `winner changed for ${ref.skill}.${ref.point} after tier insertion`);
  }
});

test("a synthetic tier WITH content lands between the pack contributions and the override", () => {
  const files = baseFiles();
  files.set(overridePath("plan.notes"), OVERRIDE_NOTES);
  files.set(normalizeSlashes(joinSlash(WS, "_local/synthetic", "plan.notes.md")), SYNTH_MID);
  const snapshot = buildSnapshot(files);

  const withSynthetic: Tier[] = [...DEFAULT_TIERS, SYNTHETIC_TIER];
  const composed = readAndCompose(planSlot({ skill: "plan", point: "notes" }, snapshot, WS, withSynthetic), files);
  assert.equal(composed.status, "composed");
  // pack contributions (registry order) → synthetic (rank 25) → override (rank 30, last).
  assert.equal(composed.content, [NOTES_ALPHA, NOTES_BETA, SYNTH_MID, OVERRIDE_NOTES].join("\n\n"));
  assert.deepEqual(composed.sources, ["alpha", "beta", "synthetic-future", "local-override"]);
});

test("with a synthetic tier present, a replace override still outranks it", () => {
  const files = baseFiles();
  files.set(overridePath("ship.review"), OVERRIDE_REVIEW);
  files.set(normalizeSlashes(joinSlash(WS, "_local/synthetic", "ship.review.md")), SYNTH_MID);
  const snapshot = buildSnapshot(files);

  const withSynthetic: Tier[] = [...DEFAULT_TIERS, SYNTHETIC_TIER];
  const composed = readAndCompose(planSlot({ skill: "ship", point: "review" }, snapshot, WS, withSynthetic), files);
  assert.equal(composed.status, "composed");
  assert.equal(composed.content, OVERRIDE_REVIEW, "override (rank 30) beats the synthetic tier (rank 25)");
});

// --- WF-443: the committed `.wf/` project-override tier ---------------------
//
// The tier sits at rank 20, strictly between pack contribution (10) and the
// personal `_local/` override (30). These tests drive the PRODUCTION chain
// (`DEFAULT_TIERS`, via ResolverService) — not an injected synthetic one — so they
// assert the shipped precedence, not a hypothetical.

function projectOverridePath(skillPoint: string): string {
  return normalizeSlashes(joinSlash(WS, ".wf/slots", `${skillPoint}.md`));
}

test("the project tier's rank sits strictly between the pack and personal-override ranks", () => {
  assert.ok(
    PACK_TIER_RANK < PROJECT_TIER_RANK && PROJECT_TIER_RANK < OVERRIDE_TIER_RANK,
    "the committed project tier must rank above every pack contribution and below the personal override",
  );
  // The shipped chain is exactly the three served tiers, and sorting it by rank
  // is what produces the composition order — no pairwise special case anywhere.
  assert.deepEqual(
    [...DEFAULT_TIERS].sort((a, b) => a.rank - b.rank).map((t) => t.name),
    ["pack-contribution", "project-override", "local-override"],
  );
});

test("replace slot: a committed project override beats the pack contribution", () => {
  const files = baseFiles();
  files.set(projectOverridePath("ship.review"), PROJECT_REVIEW);
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.policy, "replace");
  assert.equal(r.content, PROJECT_REVIEW, "project content wins over pack content");
  // Provenance: the winning part is attributed to the project tier, not the pack.
  const winner = r.parts[r.parts.length - 1];
  assert.equal(winner.tier, "project-override");
  assert.equal(winner.source, "project-override");
  assert.equal(winner.path, projectOverridePath("ship.review"));
});

test("replace slot: a personal override still beats a committed project override", () => {
  const files = baseFiles();
  files.set(projectOverridePath("ship.review"), PROJECT_REVIEW);
  files.set(overridePath("ship.review"), OVERRIDE_REVIEW);
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "ship", point: "review" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.content, OVERRIDE_REVIEW, "personal content remains highest precedence");
  assert.deepEqual(
    r.parts.map((p) => p.tier),
    ["pack-contribution", "project-override", "local-override"],
  );
});

test("append slot: the project override composes after the pack parts and before the personal one", () => {
  const files = baseFiles();
  files.set(projectOverridePath("plan.notes"), PROJECT_NOTES);
  files.set(overridePath("plan.notes"), OVERRIDE_NOTES);
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "plan", point: "notes" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.policy, "append");
  assert.equal(
    r.content,
    [NOTES_ALPHA, NOTES_BETA, PROJECT_NOTES, OVERRIDE_NOTES].join("\n\n"),
    "registry-ordered pack parts, then the committed project part, then the personal override",
  );
  assert.deepEqual(
    r.parts.map((p) => p.source),
    ["alpha", "beta", "project-override", "local-override"],
  );
});

test("append slot: a project override with no personal override composes last", () => {
  const files = baseFiles();
  files.set(projectOverridePath("plan.notes"), PROJECT_NOTES);
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "plan", point: "notes" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.content, [NOTES_ALPHA, NOTES_BETA, PROJECT_NOTES].join("\n\n"));
  assert.deepEqual(
    r.parts.map((p) => p.source),
    ["alpha", "beta", "project-override"],
  );
});

test("a project override alone fills a slot no capability contributes to", () => {
  const files = baseFiles();
  files.set(projectOverridePath("solo.point"), PROJECT_REVIEW);
  const svc = new ResolverService(makePorts(files));
  const r = svc.resolveContent({ class: "slot", skill: "solo", point: "point" });
  assert.equal(r.status, "composed");
  if (r.status !== "composed") return;
  assert.equal(r.content, PROJECT_REVIEW);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].tier, "project-override");
});

test("with NO project override present, every winner and part is byte-identical to before the tier existed", () => {
  // The pre-WF-443 chain, reconstructed exactly.
  const legacyChain: Tier[] = [...DEFAULT_TIERS].filter((t) => t.name !== "project-override");
  assert.equal(legacyChain.length, 2, "the legacy chain is the two original tiers");

  const files = baseFiles();
  files.set(overridePath("ship.review"), OVERRIDE_REVIEW);
  files.set(overridePath("plan.notes"), OVERRIDE_NOTES);
  const snapshot = buildSnapshot(files);

  for (const ref of [
    { skill: "ship", point: "review" },
    { skill: "plan", point: "notes" },
    { skill: "nobody", point: "here" },
  ]) {
    const legacy = readAndCompose(planSlot(ref, snapshot, WS, legacyChain), files);
    const shipped = readAndCompose(planSlot(ref, snapshot, WS), files);
    assert.deepEqual(
      shipped,
      legacy,
      `adding the project tier changed ${ref.skill}.${ref.point} with no project override present`,
    );
  }
});

test("the unfilled recovery names all three fill locations", () => {
  const svc = new ResolverService(makePorts(baseFiles()));
  const r = svc.resolveContent({ class: "slot", skill: "nobody", point: "here" });
  assert.equal(r.status, "unfilled");
  if (r.status !== "unfilled") return;
  assert.match(r.recovery, /\.wf\/slots\/nobody\.here\.md/, "names the committed project override");
  assert.match(r.recovery, /_local\/slots\/nobody\.here\.md/, "names the personal override");
  assert.match(r.recovery, /contributing capability/, "names the pack contribution");
});
