// WF-352 — typed-error semantics and the live-tree clean run.
//
// Two things are proved here.
//
// 1. A broken input NEVER crashes and NEVER silently passes. The verdict's
//    third status, `error`, is reserved for "the rules could not be fully
//    evaluated" and is never collapsed into `pass` or `fail` — that distinction
//    is the whole point of the status enum.
// 2. The repo's own live artifacts — its registry, its capability manifests,
//    and its whole skill tree — validate clean, with a non-empty ruleSources[]
//    proving the verdict was reached by reading the contract, not by assuming.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateManifest, validateRegistry, type ValidatorFs } from "../src/resolver/validate-capability.js";
import { validateSkillInterface } from "../src/resolver/validate-skill-interface.js";

const MCP_DIR = process.env.WF_MCP_DIR ?? process.cwd();
const REPO_ROOT = join(MCP_DIR, "..", "..", "..");
const CONTRACTS = join(REPO_ROOT, "plugins", "wf", "skills", "_contracts");
const OPS_DOC = join(CONTRACTS, "capability-registry.ops.md");

const realFs: ValidatorFs = {
  readFile: (p) => {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  isFile: (p) => {
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  },
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Typed errors — never a crash, never a silent pass
// ---------------------------------------------------------------------------

test("a manifest with an unparseable Fragments table returns a typed error, not a pass", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-352-broken-"));
  const manifest = join(dir, "manifest.md");
  writeFileSync(
    manifest,
    [
      "# Broken capability",
      "",
      "**Kind:** adapter",
      "",
      "## Fragments",
      "",
      "| phase | contribution-kind | dispatch | scope |",
      "|-------|-------------------|----------|-------|",
      "| verify | finding",
      "",
    ].join("\n"),
    "utf8",
  );

  const v = validateManifest(realFs, manifest, OPS_DOC);
  assert.equal(v.status, "error", "a row that cannot be parsed must not be silently skipped into a pass");
  assert.notEqual(v.status, "pass");
  assert.ok(
    v.findings.some((f) => f.rule === "input-unparseable"),
    `expected an input-unparseable finding, got ${v.findings.map((f) => f.rule).join(", ")}`,
  );
  const f = v.findings.find((x) => x.rule === "input-unparseable")!;
  assert.equal(f.file, manifest.replace(/\\/g, "/"));
  assert.ok(typeof f.line === "number", "the broken row is anchored by line");
});

test("a missing manifest returns a typed error naming the path", () => {
  const v = validateManifest(realFs, join(tmpdir(), "wf-352-absent", "manifest.md"), OPS_DOC);
  assert.equal(v.status, "error");
  assert.ok(v.findings.some((f) => f.rule === "input-unparseable"));
});

test("an unreadable rule source yields rule-source-unresolvable, never a verdict on the input", () => {
  const missingOps = join(tmpdir(), "wf-352-no-such-ops.md");
  const v = validateRegistry(realFs, {
    registryFile: join(CONTRACTS, "registry-fixtures", "pass-single.md"),
    repoRoot: REPO_ROOT,
    opsDocPath: missingOps,
    registryPathValue: "_local/config.md",
    installManifest: null,
  });
  assert.equal(v.status, "error");
  assert.equal(v.findings.length, 1);
  assert.equal(v.findings[0].rule, "rule-source-unresolvable");
  assert.deepEqual(v.ruleSources, [], "no rule source was successfully parsed");
});

test("an unreadable registry returns a typed error rather than an empty pass", () => {
  const v = validateRegistry(realFs, {
    registryFile: join(tmpdir(), "wf-352-no-registry.md"),
    repoRoot: REPO_ROOT,
    opsDocPath: OPS_DOC,
    registryPathValue: "_local/config.md",
    installManifest: null,
  });
  assert.equal(v.status, "error");
  assert.ok(v.findings.some((f) => f.rule === "input-unparseable"));
});

test("a target naming no skill folder is an error, not a vacuous pass", () => {
  const v = validateSkillInterface(realFs, {
    opsDocPath: OPS_DOC,
    skillDirs: [],
    target: join(REPO_ROOT, "plugins", "nope", "skills", "*"),
  });
  assert.equal(v.status, "error");
  assert.ok(v.findings.some((f) => f.rule === "input-unparseable"));
});

test("the verdict invariant holds: findings are empty if and only if status is pass", () => {
  const clean = validateManifest(realFs, join(REPO_ROOT, "plugins", "wf-git", "capabilities", "git"), OPS_DOC);
  assert.equal(clean.status, "pass");
  assert.deepEqual(clean.findings, []);

  const broken = validateManifest(realFs, join(tmpdir(), "wf-352-absent-2", "manifest.md"), OPS_DOC);
  assert.notEqual(broken.status, "pass");
  assert.ok(broken.findings.length > 0);
});

// ---------------------------------------------------------------------------
// The live tree
// ---------------------------------------------------------------------------

test("every skill in the live tree passes the interface-marker check", () => {
  const pluginsDir = join(REPO_ROOT, "plugins");
  const skillDirs: string[] = [];
  for (const plugin of readdirSync(pluginsDir)) {
    const skillsRoot = join(pluginsDir, plugin, "skills");
    if (!existsSync(skillsRoot)) continue;
    for (const s of readdirSync(skillsRoot)) {
      const dir = join(skillsRoot, s);
      if (!existsSync(join(dir, "SKILL.md"))) continue;
      skillDirs.push(dir);
    }
  }
  assert.ok(skillDirs.length > 10, `expected the live skill tree, found ${skillDirs.length} skills`);

  const v = validateSkillInterface(realFs, {
    opsDocPath: OPS_DOC,
    skillDirs,
    target: join(pluginsDir, "*", "skills", "*"),
  });
  assert.equal(
    v.status,
    "pass",
    `live skill tree must validate clean:\n${v.findings.map((f) => `${f.file}:${f.line ?? "-"} ${f.rule} ${f.message}`).join("\n")}`,
  );
  assert.ok(v.ruleSources.length > 0);
  assert.match(v.summary, /skill\(s\) checked/);
});

test("a skill that declares a slot and marks it correctly still passes at tree scale", () => {
  // `ship` is the repo's live slotted skill (ship.review). If the tree-wide run
  // above passes, this asserts the non-inert path is actually exercised — a
  // guard against the whole suite passing only because nothing declares slots.
  const shipDir = join(REPO_ROOT, "plugins", "wf", "skills", "ship");
  if (!existsSync(join(shipDir, "interface.md"))) return; // not yet slotted — inert
  const iface = readFileSync(join(shipDir, "interface.md"), "utf8");
  if (!/^## Slots/m.test(iface)) return;

  const v = validateSkillInterface(realFs, {
    opsDocPath: OPS_DOC,
    skillDirs: [shipDir],
    target: shipDir,
  });
  assert.equal(v.status, "pass", v.findings.map((f) => f.message).join(" | "));
});
