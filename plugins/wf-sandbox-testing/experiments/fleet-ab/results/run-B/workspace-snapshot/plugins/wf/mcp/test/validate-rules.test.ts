// WF-352 — the live rule-derivation layer and the anti-fork seam.
//
// The point of these tests: the validator tools derive their vocabularies from
// `capability-registry.ops.md` at call time, while `validate-registry.sh` PINS
// the same vocabularies as literal shell arrays. The equality assertion below
// is the seam that keeps the two from drifting — an ops-doc edit the shell
// guard did not follow fails the build here, instead of forking silently.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveRules, sectionBody, RuleSourceError } from "../src/resolver/validate-rules.js";

const MCP_DIR = process.env.WF_MCP_DIR ?? process.cwd();
const CONTRACTS = join(MCP_DIR, "..", "skills", "_contracts");
const OPS_DOC = join(CONTRACTS, "capability-registry.ops.md");
const GUARD = join(CONTRACTS, "validate-registry.sh");

function rules() {
  return deriveRules(readFileSync(OPS_DOC, "utf8"), OPS_DOC);
}

/** Pull a pinned ` name=" a b c "`-style shell array out of the guard source. */
function pinnedVocab(name: string): string[] {
  const src = readFileSync(GUARD, "utf8");
  const m = new RegExp(`^${name}="([^"]*)"`, "m").exec(src);
  assert.ok(m, `expected ${name} to be pinned in validate-registry.sh`);
  return m![1].split(/\s+/).filter((t) => t.length > 0);
}

test("the phase spine is derived from the ops doc, not transcribed", () => {
  const r = rules();
  // Sanity: the derivation actually found the spine and nothing bogus.
  assert.ok(r.phases.length >= 5, `derived too few phases: ${r.phases.join(", ")}`);
  for (const p of r.phases) assert.match(p, /^[a-z][a-z0-9-]*$/);
  assert.equal(new Set(r.phases).size, r.phases.length, "phases must be unique");
});

test("derived phases equal the vocabulary pinned in validate-registry.sh", () => {
  assert.deepEqual(
    [...rules().phases].sort(),
    [...pinnedVocab("VALID_PHASES")].sort(),
    "the ops doc and validate-registry.sh disagree about the SDD phase spine — one of them moved without the other.",
  );
});

test("derived contribution kinds equal the vocabulary pinned in validate-registry.sh", () => {
  assert.deepEqual(
    [...rules().kinds].sort(),
    [...pinnedVocab("VALID_KINDS")].sort(),
    "the ops doc and validate-registry.sh disagree about the contribution taxonomy.",
  );
});

test("derived slot merge policies equal the vocabulary pinned in validate-registry.sh", () => {
  assert.deepEqual(
    [...rules().slotPolicies].sort(),
    [...pinnedVocab("VALID_SLOT_POLICIES")].sort(),
    "the ops doc and validate-registry.sh disagree about the slot merge policies.",
  );
});

test("partitioned kinds and point-targeted kinds are derived from the taxonomy table", () => {
  const r = rules();
  // A partitioned kind is one whose aggregation policy partitions; a
  // point-targeted kind is one whose phase cell disclaims an SDD phase.
  assert.ok(r.partitionedKinds.length > 0, "expected at least one partitioned kind");
  for (const k of r.partitionedKinds) assert.ok(r.kinds.includes(k));
  for (const k of r.pointTargetedKinds) assert.ok(r.kinds.includes(k));
  // Every point-targeted kind must carry merge policies (its scope declares one).
  if (r.pointTargetedKinds.length > 0) assert.ok(r.slotPolicies.length >= 2);
});

test("dispatch prefixes are derived from schema v2", () => {
  const r = rules();
  assert.ok(r.dispatchPrefixes.length >= 2, `derived dispatch prefixes: ${r.dispatchPrefixes.join(", ")}`);
  for (const d of r.dispatchPrefixes) assert.match(d, /^[a-z][a-z-]*$/);
  // No manifest `kind:` vocabulary is derived (WF-354 D-2): the shell guard
  // carries no manifest-`kind:` check, so deriving one here would mint an
  // MCP-only rule and break verdict agreement between the two surfaces.
  assert.ok(!("manifestKinds" in r), "manifestKinds was removed, not left derived-but-unenforced");
});

test("every derivation records the rule source it read", () => {
  const r = rules();
  assert.equal(r.sources.length, 1);
  assert.match(r.sources[0], /capability-registry\.ops\.md$/);
  assert.ok(!r.sources[0].includes("\\"), "rule source paths are forward-slash normalized");
});

test("a rule source missing a required section raises RuleSourceError, never a bad vocabulary", () => {
  assert.throws(
    () => deriveRules("# Nothing here\n\nno sections at all\n", "/tmp/fake-ops.md"),
    (err: unknown) => err instanceof RuleSourceError,
    "an ops doc without the vocabulary sections must refuse to yield rules",
  );
});

test("sectionBody matches a heading by prefix and stops at the next heading", () => {
  const md = ["## Alpha (gloss)", "a1", "a2", "## Beta", "b1"].join("\n");
    const alpha = sectionBody(md, "Alpha");
  assert.deepEqual(alpha, ["a1", "a2"]);
  assert.equal(sectionBody(md, "Gamma"), null);
});
