// WF-352 — verdict agreement between the typed MCP validators and the CI shell
// guards, over the SHARED fixture sets.
//
// This is the contract between the two surfaces: the shell guards stay
// authoritative in CI, and the tools do not replace them — they agree with
// them. So the suite does not compare against a hand-copied expectation table;
// it EXECUTES the real guard on each fixture and compares its exit status to
// the tool's verdict on the same input. A disagreement on any fixture fails.
//
//   registry-fixtures/*.md   -> validate-registry.sh   vs validate_registry
//   slot-marker-fixtures/*/  -> skill-slot-marker-lint.sh (its own lint logic,
//                               driven per fixture dir) vs validate_skill_interface

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { validateRegistry, validateManifest, type ValidatorFs } from "../src/resolver/validate-capability.js";
import { validateSkillInterface } from "../src/resolver/validate-skill-interface.js";

const MCP_DIR = process.env.WF_MCP_DIR ?? process.cwd();
const REPO_ROOT = join(MCP_DIR, "..", "..", "..");
const CONTRACTS = join(REPO_ROOT, "plugins", "wf", "skills", "_contracts");
const OPS_DOC = join(CONTRACTS, "capability-registry.ops.md");
const REGISTRY_GUARD = join(CONTRACTS, "validate-registry.sh");
const REGISTRY_FIXTURES = join(CONTRACTS, "registry-fixtures");
const SLOT_FIXTURES = join(CONTRACTS, "slot-marker-fixtures");
const INSTALL_MANIFEST = join(REGISTRY_FIXTURES, "installed_plugins.fixture.json");

/** A real-filesystem ValidatorFs — the same surface the service injects. */
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

/** Run the shell guard exactly as run.sh does; return its exit code. */
function guardExit(fixture: string, registryPathOverride = ""): number {
  const res = spawnSync(
    "bash",
    [REGISTRY_GUARD, join(REGISTRY_FIXTURES, fixture), registryPathOverride, INSTALL_MANIFEST],
    { encoding: "utf8" },
  );
  return res.status ?? 2;
}

function toolVerdict(fixture: string, registryPathOverride?: string) {
  return validateRegistry(realFs, {
    registryFile: join(REGISTRY_FIXTURES, fixture),
    repoRoot: REPO_ROOT,
    opsDocPath: OPS_DOC,
    registryPathValue: registryPathOverride ?? null,
    installManifest: INSTALL_MANIFEST,
  });
}

const fixtureFiles = readdirSync(REGISTRY_FIXTURES)
  .filter((f) => f.endsWith(".md"))
  .sort();

test("the registry fixture set is present and non-trivial", () => {
  assert.ok(fixtureFiles.length > 20, `expected the shared fixture set, found ${fixtureFiles.length}`);
  assert.ok(fixtureFiles.some((f) => f.startsWith("pass-")));
  assert.ok(fixtureFiles.some((f) => f.startsWith("fail-")));
  assert.ok(existsSync(REGISTRY_GUARD), "the shell guard must be present to compare against");
});

test("validate_registry agrees with validate-registry.sh on every shared fixture", () => {
  const disagreements: string[] = [];
  for (const fixture of fixtureFiles) {
    const exit = guardExit(fixture);
    const v = toolVerdict(fixture);
    const guardPassed = exit === 0;
    const toolPassed = v.status === "pass";
    if (guardPassed !== toolPassed) {
      disagreements.push(
        `${fixture}: guard exit ${exit} (${guardPassed ? "pass" : "fail"}) vs tool ${v.status}` +
          (v.findings.length > 0
            ? ` — findings: ${v.findings.map((f) => `${f.rule}@${f.line ?? "-"}`).join(", ")}`
            : ""),
      );
    }
  }
  assert.deepEqual(disagreements, [], `verdict disagreements:\n${disagreements.join("\n")}`);
});

test("the fixture-name convention itself holds (pass-* pass, fail-* fail)", () => {
  const wrong: string[] = [];
  for (const fixture of fixtureFiles) {
    const v = toolVerdict(fixture);
    if (fixture.startsWith("pass-") && v.status !== "pass") {
      wrong.push(`${fixture} -> ${v.status}: ${v.findings.map((f) => f.message).join(" | ")}`);
    }
    if (fixture.startsWith("fail-") && v.status === "pass") wrong.push(`${fixture} -> unexpectedly passed`);
  }
  assert.deepEqual(wrong, []);
});

test("CHECK-1 registryPath shape cases agree with the guard", () => {
  const cases = ["/etc/registry.md", "C:/x/registry.md", "../escape.md", "a\\b/registry.md"];
  for (const bad of cases) {
    const exit = guardExit("pass-single.md", bad);
    const v = toolVerdict("pass-single.md", bad);
    assert.equal(exit, 1, `guard should reject registryPath ${bad}`);
    assert.equal(v.status, "fail", `tool should reject registryPath ${bad}`);
    assert.ok(
      v.findings.some((f) => f.rule === "CHECK-1"),
      `expected a CHECK-1 finding for ${bad}, got ${v.findings.map((f) => f.rule).join(", ")}`,
    );
  }
  // The same registry with a well-formed registryPath passes both.
  assert.equal(guardExit("pass-single.md", "_local/config.md"), 0);
  assert.equal(toolVerdict("pass-single.md", "_local/config.md").status, "pass");
});

test("a bad phase yields a CHECK-6 finding naming the manifest file (the spec's spot-check)", () => {
  const v = toolVerdict("fail-bad-phase.md");
  assert.equal(v.status, "fail");
  const f = v.findings.find((x) => x.rule === "CHECK-6");
  assert.ok(f, `expected a CHECK-6 finding, got ${v.findings.map((x) => x.rule).join(", ")}`);
  assert.match(f!.file, /manifest\.md$/);
  assert.match(f!.message, /unknown phase/);
  assert.match(f!.message, /deploy/);
  assert.ok(typeof f!.line === "number" && f!.line > 0, "the finding is anchored at the offending row");
});

test("every verdict records the rule sources it parsed", () => {
  const v = toolVerdict("pass-multi.md");
  assert.ok(v.ruleSources.length > 0);
  assert.ok(v.ruleSources.some((s) => s.endsWith("capability-registry.ops.md")));
});

// ---------------------------------------------------------------------------
// Slot-marker fixtures
// ---------------------------------------------------------------------------

/**
 * Execute the REAL slot-marker guard against a single fixture directory and
 * return its exit status.
 *
 * The guard exposes no per-directory CLI mode: it either runs `--selftest` over
 * all fixtures at once, or scans the real tree at `<root>/plugins/*​/skills/*​/`,
 * where `<root>` is resolved by walking up from the script's OWN location. So
 * staging one fixture as the only skill in a throwaway tree — with the guard
 * copied to the path its root-walk expects — makes the guard scan exactly that
 * one fixture, unmodified. That turns the slot half of the agreement suite into
 * genuine execution rather than a transcribed expectation table.
 */
function slotGuardExit(fixtureDir: string): number {
  const tmp = mkdtempSync(join(tmpdir(), "wf-352-slot-"));
  const contractsDir = join(tmp, "plugins", "wf", "skills", "_contracts");
  mkdirSync(contractsDir, { recursive: true });
  // The root-walk stops at the marketplace marker; provide it so the guard
  // resolves <tmp> as the repo root exactly as it does in the real tree.
  mkdirSync(join(tmp, ".claude-plugin"), { recursive: true });
  writeFileSync(join(tmp, ".claude-plugin", "marketplace.json"), "{}", "utf8");
  copyFileSync(join(CONTRACTS, "skill-slot-marker-lint.sh"), join(contractsDir, "skill-slot-marker-lint.sh"));
  cpSync(join(SLOT_FIXTURES, fixtureDir), join(tmp, "plugins", "wf", "skills", fixtureDir), {
    recursive: true,
  });
  const res = spawnSync("bash", [join(contractsDir, "skill-slot-marker-lint.sh")], { encoding: "utf8" });
  rmSync(tmp, { recursive: true, force: true });
  return res.status ?? 2;
}

/** The fixture cases and the defect class each plants. */
const SLOT_CASES: Array<{ dir: string; expect: "pass" | "fail"; rule?: string }> = [
  { dir: "slotfree", expect: "pass" },
  { dir: "wellformed-replace", expect: "pass" },
  { dir: "wellformed-append", expect: "pass" },
  { dir: "malformed-marker", expect: "fail", rule: "D2" },
  { dir: "undeclared-marker", expect: "fail", rule: "D3" },
  { dir: "missing-marker", expect: "fail", rule: "D5" },
  { dir: "unbalanced", expect: "fail", rule: "D4" },
  { dir: "bad-declaration", expect: "fail", rule: "D1" },
];

test("the shell lint's own selftest passes (the guard we are agreeing with is sound)", () => {
  const res = spawnSync("bash", [join(CONTRACTS, "skill-slot-marker-lint.sh"), "--selftest"], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `slot-marker lint selftest failed:\n${res.stdout}\n${res.stderr}`);
});

test("validate_skill_interface agrees with skill-slot-marker-lint.sh on every fixture", () => {
  const disagreements: string[] = [];
  for (const c of SLOT_CASES) {
    const dir = join(SLOT_FIXTURES, c.dir);
    const exit = slotGuardExit(c.dir);
    const v = validateSkillInterface(realFs, { opsDocPath: OPS_DOC, skillDirs: [dir], target: dir });
    const guardPassed = exit === 0;
    const toolPassed = v.status === "pass";
    if (guardPassed !== toolPassed) {
      disagreements.push(
        `${c.dir}: guard exit ${exit} (${guardPassed ? "pass" : "fail"}) vs tool ${v.status}` +
          (v.findings.length > 0 ? ` — ${v.findings.map((f) => f.rule).join(", ")}` : ""),
      );
    }
  }
  assert.deepEqual(disagreements, [], `slot-marker verdict disagreements:\n${disagreements.join("\n")}`);
});

test("validate_skill_interface reproduces every planted slot-marker case", () => {
  for (const c of SLOT_CASES) {
    const dir = join(SLOT_FIXTURES, c.dir);
    const v = validateSkillInterface(realFs, {
      opsDocPath: OPS_DOC,
      skillDirs: [dir],
      target: dir,
    });
    assert.equal(v.status, c.expect, `${c.dir}: expected ${c.expect}, got ${v.status} — ${v.findings.map((f) => f.message).join(" | ")}`);
    if (c.rule) {
      assert.ok(
        v.findings.some((f) => f.rule === c.rule),
        `${c.dir}: expected a ${c.rule} finding, got ${v.findings.map((f) => f.rule).join(", ")}`,
      );
      for (const f of v.findings) {
        assert.ok(f.file.length > 0, "every finding names a file");
        assert.equal(f.severity, "error");
      }
    }
  }
});

test("slot-marker findings anchor to SKILL.md or interface.md, never leak body content", () => {
  const dir = join(SLOT_FIXTURES, "undeclared-marker");
  const v = validateSkillInterface(realFs, { opsDocPath: OPS_DOC, skillDirs: [dir], target: dir });
  assert.equal(v.status, "fail");
  for (const f of v.findings) {
    assert.match(f.file, /(SKILL|interface)\.md$/);
  }
});

// ---------------------------------------------------------------------------
// validate_manifest over the same manifests
// ---------------------------------------------------------------------------

test("validate_manifest passes each live capability manifest in the repo", () => {
  const pluginsDir = join(REPO_ROOT, "plugins");
  const failures: string[] = [];
  for (const plugin of readdirSync(pluginsDir)) {
    const capsDir = join(pluginsDir, plugin, "capabilities");
    if (!existsSync(capsDir)) continue;
    for (const cap of readdirSync(capsDir)) {
      const manifest = join(capsDir, cap, "manifest.md");
      if (!existsSync(manifest)) continue;
      const v = validateManifest(realFs, manifest, OPS_DOC);
      if (v.status !== "pass") {
        failures.push(`${plugin}/${cap}: ${v.status} — ${v.findings.map((f) => `${f.rule}: ${f.message}`).join(" | ")}`);
      }
      assert.ok(v.ruleSources.length > 0, `${plugin}/${cap} recorded no rule sources`);
    }
  }
  assert.deepEqual(failures, [], `live manifests must validate clean:\n${failures.join("\n")}`);
});

test("validate_manifest accepts a capability folder as well as a manifest path", () => {
  const folder = join(REPO_ROOT, "plugins", "wf-git", "capabilities", "git");
  const byFolder = validateManifest(realFs, folder, OPS_DOC);
  const byFile = validateManifest(realFs, join(folder, "manifest.md"), OPS_DOC);
  assert.equal(byFolder.status, "pass");
  assert.equal(byFile.status, "pass");
  assert.equal(byFolder.target, byFile.target);
});
