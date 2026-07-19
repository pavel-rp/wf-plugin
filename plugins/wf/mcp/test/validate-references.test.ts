// WF-354 — the reference-existence check.
//
// There is deliberately NO agreement suite here. `validate_references` has no
// shell-guard counterpart — no CI guard owns the reference-existence question —
// so constructing a suite that spawns a guard would assert agreement with a
// surface that does not exist. It is verified against fixtures and against the
// live tree alone.
//
// Fixture layout note: the committed fixtures live under
// `test/fixtures/references/plugins/wf-fixture/`, shaped like a real plugin so
// the plugin-root derivation under test is exercised for real rather than
// stubbed. The ONE case that cannot ship as a committed file is the dead
// `${CLAUDE_PLUGIN_ROOT}` path (SC-3): `out4-skill-read-guard.sh` scans every
// `*.md` under `plugins/` (excluding only `_contracts/`), so a committed file
// carrying that literal token would turn the guard red. That fixture is
// therefore written into a temp dir at test time — the same mkdtemp pattern
// `validate-live-tree.test.ts` already uses for its broken-manifest input.

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
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ValidatorFs } from "../src/resolver/validate-capability.js";
import {
  deriveReferenceRules,
  validateReferences,
  INVOCATION_AXIS,
} from "../src/resolver/validate-references.js";
import { RuleSourceError } from "../src/resolver/validate-rules.js";
import { ResolverService } from "../src/service.js";
import { createDefaultPorts } from "../src/ports.js";
import { normalizeSlashes } from "../src/resolver/paths.js";

const MCP_DIR = process.env.WF_MCP_DIR ?? process.cwd();
const REPO_ROOT = join(MCP_DIR, "..", "..", "..");
const CONTRACTS = join(REPO_ROOT, "plugins", "wf", "skills", "_contracts");
const GUARD = join(CONTRACTS, "out4-skill-read-guard.sh");
const FIXTURE_ROOT = join(MCP_DIR, "test", "fixtures", "references");
const FIXTURE_PLUGIN = join(FIXTURE_ROOT, "plugins", "wf-fixture");

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

const skill = (name: string): string => join(FIXTURE_PLUGIN, "skills", name, "SKILL.md");

function check(files: string[], repoRoot = FIXTURE_ROOT) {
  return validateReferences(realFs, {
    repoRoot,
    files,
    target: repoRoot,
    guardPath: GUARD,
  });
}

// ---------------------------------------------------------------------------
// SC-6 — the classifier is DERIVED from the guard, never transcribed
// ---------------------------------------------------------------------------

test("SC-6: the derived plugin-root pattern equals the guard's own p2 assignment", () => {
  const guardSource = readFileSync(GUARD, "utf8");
  const rules = deriveReferenceRules(guardSource, GUARD);

  // Lift p2 independently, here in the test, and demand byte equality. An edit
  // to the guard that this tool does not follow fails the build rather than
  // forking silently — which is the entire point of deriving instead of copying.
  const p2 = /^p2='([^']*)'/m.exec(guardSource);
  assert.ok(p2, "the guard must still carry a single-quoted p2 assignment");
  assert.equal(rules.pluginRootPattern, p2![1]);

  // And it is used verbatim because it is already valid JS regex source.
  assert.doesNotThrow(() => new RegExp(rules.pluginRootPattern));
});

test("SC-6: the reused axis is the guard's p1, with PCRE's inline (?i) translated", () => {
  const guardSource = readFileSync(GUARD, "utf8");
  const rules = deriveReferenceRules(guardSource, GUARD);
  const p1 = /^p1='([^']*)'/m.exec(guardSource)!;

  assert.ok(p1[1].startsWith("(?i)"), "precondition: the guard's p1 carries a PCRE inline flag");
  assert.equal(rules.axisFlags, "i", "the inline flag moves onto the RegExp");
  assert.equal(rules.directiveAxisPattern, p1[1].slice("(?i)".length));
  // JS RegExp rejects an inline flag group; the translation is what makes it usable.
  assert.throws(() => new RegExp(p1[1]));
  assert.doesNotThrow(() => new RegExp(rules.directiveAxisPattern, rules.axisFlags));
});

test("the guard is recorded as the rule source on every call", () => {
  const v = check([skill("resolvable")]);
  assert.ok(
    v.ruleSources.some((s) => s.endsWith("out4-skill-read-guard.sh")),
    `ruleSources: ${v.ruleSources.join(", ")}`,
  );
});

test("a guard missing either assignment is rule-source-unresolvable, never a copied fallback", () => {
  assert.throws(() => deriveReferenceRules("# no assignments here\n", GUARD), RuleSourceError);
  assert.throws(
    () => deriveReferenceRules("p1='(?i)\\bread\\b.*\\S/SKILL\\.md'\n", GUARD),
    RuleSourceError,
  );

  const v = validateReferences(realFs, {
    repoRoot: FIXTURE_ROOT,
    files: [skill("resolvable")],
    target: FIXTURE_ROOT,
    guardPath: join(tmpdir(), "wf-354-no-such-guard.sh"),
  });
  assert.equal(v.status, "error");
  assert.equal(v.findings.length, 1);
  assert.equal(v.findings[0].rule, "rule-source-unresolvable");
  assert.deepEqual(v.ruleSources, [], "no rule source was successfully parsed");
});

// ---------------------------------------------------------------------------
// SC-1 / SC-2 / SC-3 — the three classified cases
// ---------------------------------------------------------------------------

test("SC-1: a dead skill invocation reference fails, naming file, 1-based line, and token", () => {
  const file = skill("dead-ref");
  const v = check([file]);
  assert.equal(v.status, "fail");

  const dead = v.findings.find((f) => f.message.includes("wf-fixture:tc"));
  assert.ok(dead, `expected a finding for /wf-fixture:tc, got: ${v.findings.map((f) => f.message).join(" | ")}`);
  assert.equal(dead!.rule, "REF-1");
  assert.equal(dead!.severity, "error");
  assert.equal(dead!.file, file.replace(/\\/g, "/"));

  // The line is 1-based and really is the line carrying the instruction.
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  assert.equal(typeof dead!.line, "number");
  assert.match(lines[dead!.line! - 1], /\/wf-fixture:tc/);
});

test("SC-1: a dead agent dispatch reference fails too", () => {
  const v = check([skill("dead-ref")]);
  const dead = v.findings.find((f) => f.message.includes("ghost-runner"));
  assert.ok(dead, "subagent_type dispatch to a nonexistent agent must be flagged");
  assert.equal(dead!.rule, "REF-1");
});

test("SC-2: prose mentions with no directive verb pass with zero findings", () => {
  const v = check([skill("prose")]);
  assert.equal(
    v.status,
    "pass",
    `prose must not turn red:\n${v.findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.message}`).join("\n")}`,
  );
  assert.deepEqual(v.findings, []);
});

test("references that resolve pass — the checker is not flagging every verb-governed token", () => {
  const v = check([skill("resolvable")]);
  assert.equal(v.status, "pass", v.findings.map((f) => f.message).join(" | "));
  assert.match(v.summary, /reference\(s\) resolved against the tree/);
});

test("SC-3: an unresolvable ${CLAUDE_PLUGIN_ROOT} path fails, naming the path", () => {
  // Written at test time: a committed file carrying this literal token would be
  // seen by out4-skill-read-guard.sh's real-tree scan of plugins/**/*.md.
  const root = mkdtempSync(join(tmpdir(), "wf-354-pluginroot-"));
  const dir = join(root, "plugins", "wf-fixture", "skills", "dead-root");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(
    file,
    [
      "# /wf-fixture:dead-root",
      "",
      "Load the procedure from ${CLAUDE_PLUGIN_ROOT}/skills/nope/SKILL.md before starting.",
      "",
    ].join("\n"),
    "utf8",
  );

  const v = check([file], root);
  assert.equal(v.status, "fail");
  const f = v.findings.find((x) => x.rule === "REF-2");
  assert.ok(f, `expected a REF-2 finding, got ${v.findings.map((x) => x.rule).join(", ")}`);
  assert.match(f!.message, /skills\/nope\/SKILL\.md/);
  assert.equal(f!.line, 3, "the 1-based line carrying the token");
});

test("a ${CLAUDE_PLUGIN_ROOT} path that DOES resolve passes", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-354-pluginroot-ok-"));
  const target = join(root, "plugins", "wf-fixture", "skills", "real");
  mkdirSync(target, { recursive: true });
  writeFileSync(join(target, "SKILL.md"), "# /wf-fixture:real\n", "utf8");

  const dir = join(root, "plugins", "wf-fixture", "skills", "caller");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "SKILL.md");
  writeFileSync(file, "See ${CLAUDE_PLUGIN_ROOT}/skills/real/SKILL.md for the shape.\n", "utf8");

  const v = check([file], root);
  assert.equal(v.status, "pass", v.findings.map((x) => x.message).join(" | "));
});

// ---------------------------------------------------------------------------
// D-3 — indeterminate is excluded from findings and counted in summary
// ---------------------------------------------------------------------------

test("D-3: a reference whose owning plugin root is absent is counted, not flagged", () => {
  const v = check([skill("indeterminate")]);
  assert.equal(v.status, "pass", "indeterminate is not proven dead — it must not fail");
  assert.deepEqual(v.findings, [], "and it must not enter findings at all");
  assert.match(v.summary, /1 indeterminate \(owning plugin root not resolvable in this workspace\)/);
});

// ---------------------------------------------------------------------------
// SC-7 — the frozen verdict shape, reused unchanged
// ---------------------------------------------------------------------------

test("SC-7: the verdict shape is the frozen one and findings are empty iff status is pass", () => {
  const pass = check([skill("prose")]);
  const fail = check([skill("dead-ref")]);
  const error = validateReferences(realFs, {
    repoRoot: FIXTURE_ROOT,
    files: [],
    target: join(FIXTURE_ROOT, "plugins", "nope"),
    guardPath: GUARD,
  });

  for (const v of [pass, fail, error]) {
    assert.deepEqual(
      Object.keys(v).sort(),
      ["findings", "ruleSources", "status", "summary", "target", "tool"],
      "the ValidationVerdict shape is frozen — no key added, none removed",
    );
    assert.equal(v.tool, "validate_references");
    assert.equal(typeof v.summary, "string");
    for (const f of v.findings) {
      assert.deepEqual(Object.keys(f).sort(), ["file", "line", "message", "rule", "severity"]);
      assert.equal(f.severity, "error", "severity stays single-valued — no warning tier (D-3)");
      assert.ok(f.line === null || typeof f.line === "number");
    }
  }

  assert.equal(pass.status, "pass");
  assert.deepEqual(pass.findings, []);
  assert.equal(fail.status, "fail");
  assert.ok(fail.findings.length > 0);

  // `error` is never collapsed into pass or fail.
  assert.equal(error.status, "error");
  assert.notEqual(error.status, "pass");
  assert.notEqual(error.status, "fail");
  assert.ok(error.findings.some((f) => f.rule === "input-unparseable"));
});

test("a verb AFTER the token does not govern it — the guard's ordering is reused, not just its verb set", () => {
  // The live instance this exists for: `plugins/wf/agents/phase-runner.md`
  // says "There is no `/wf:phase-runner` slash command, and a user should never
  // invoke you directly". "invoke" governs "you", and the sentence NEGATES the
  // token's existence. The guard's own p1 is `\b(verb)\b.*<token>` — verb THEN
  // token — so reusing that ordering passes this prose.
  const root = mkdtempSync(join(tmpdir(), "wf-354-ordering-"));
  const dir = join(root, "plugins", "wf-fixture", "agents");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "ordered.md");
  writeFileSync(
    file,
    [
      "There is no `/wf-fixture:ghost` slash command, and a user should never invoke you directly.",
      "",
      "But: invoke `/wf-fixture:ghost` to start.",
      "",
    ].join("\n"),
    "utf8",
  );

  const v = check([file], root);
  assert.equal(v.status, "fail", "the verb-then-token line is still caught");
  assert.equal(v.findings.length, 1, "only the line where the verb governs the token");
  assert.equal(v.findings[0].line, 3);
});

test("the verb family and token shapes are declared in exactly one constant", () => {
  assert.deepEqual(INVOCATION_AXIS.verbs, ["invoke", "call", "run", "dispatch"]);
  assert.deepEqual(INVOCATION_AXIS.excludedVerbs, ["load", "loads", "loading"]);
  assert.ok(INVOCATION_AXIS.skillToken.includes("wf"));
  assert.ok(INVOCATION_AXIS.agentToken.includes("subagent_type"));
});

// ---------------------------------------------------------------------------
// The live tree — the false-positive control (spec Risky (b))
// ---------------------------------------------------------------------------

test("the live plugins/ tree comes back clean — no live prose is turned red", () => {
  const pluginsDir = join(REPO_ROOT, "plugins");
  const files: string[] = [];

  const mdIn = (dir: string): string[] => {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dir, e.name));
  };

  for (const plugin of readdirSync(pluginsDir)) {
    const skillsRoot = join(pluginsDir, plugin, "skills");
    if (existsSync(skillsRoot)) {
      for (const s of readdirSync(skillsRoot)) {
        if (s.startsWith("_")) continue; // the frozen contract layer, as the guard excludes it
        const dir = join(skillsRoot, s);
        if (!existsSync(join(dir, "SKILL.md"))) continue;
        files.push(join(dir, "SKILL.md"));
        files.push(...mdIn(join(dir, "references")));
      }
    }
    files.push(...mdIn(join(pluginsDir, plugin, "agents")));
  }

  assert.ok(files.length > 30, `expected the live tree, found ${files.length} files`);

  const v = validateReferences(realFs, {
    repoRoot: REPO_ROOT,
    files,
    target: join(pluginsDir, "*"),
    guardPath: GUARD,
  });

  assert.equal(
    v.status,
    "pass",
    `the live tree must validate clean — a finding here is a classifier false positive, not a real defect:\n${v.findings
      .map((f) => `${f.file}:${f.line ?? "-"} ${f.rule} ${f.message}`)
      .join("\n")}`,
  );
  // And it actually did work: real references were resolved, not zero.
  assert.match(v.summary, /[1-9]\d* reference\(s\) resolved against the tree/);
});

test("the SERVICE's zero-argument default scan is clean on the live tree too", () => {
  // The test above drives the module with a file list the test itself builds.
  // This drives the real service default — which walks the tree through the
  // ports (including the optional `listFiles`) — so the walk itself is covered,
  // not just the checker it feeds.
  process.env.WF_CORE_PLUGIN_ROOT = join(REPO_ROOT, "plugins", "wf");
  const svc = new ResolverService(createDefaultPorts(normalizeSlashes(REPO_ROOT)));

  const v = svc.validateReferences();
  assert.equal(
    v.status,
    "pass",
    `the service default scan must come back clean:\n${v.findings
      .map((f) => `${f.file}:${f.line ?? "-"} ${f.rule} ${f.message}`)
      .join("\n")}`,
  );
  assert.match(v.summary, /[1-9]\d* file\(s\) scanned/);
  assert.ok(
    v.ruleSources.some((s) => s.endsWith("out4-skill-read-guard.sh")),
    "the guard is anchored off corePluginRoot and recorded",
  );

  // Scoping to one file works and is still clean.
  const one = svc.validateReferences("plugins/wf/agents/phase-runner.md");
  assert.equal(one.status, "pass", one.findings.map((f) => f.message).join(" | "));
});

test("the `path` argument accepts a FOLDER, not just a file", () => {
  // Regression: file-ness used to be probed by reading the path, but the real
  // `readFile` swallows only ENOENT and rethrows EISDIR — so scoping to a
  // folder, which the argument explicitly accepts, crashed the tool instead of
  // returning a verdict. Directory-ness is now settled before any read.
  process.env.WF_CORE_PLUGIN_ROOT = join(REPO_ROOT, "plugins", "wf");
  const svc = new ResolverService(createDefaultPorts(normalizeSlashes(REPO_ROOT)));

  const scoped = svc.validateReferences("plugins/wf/agents");
  assert.equal(
    scoped.status,
    "pass",
    `a folder-scoped scan must return a verdict, not throw:\n${scoped.findings
      .map((f) => `${f.file}:${f.line ?? "-"} ${f.rule} ${f.message}`)
      .join("\n")}`,
  );
  assert.match(scoped.summary, /[1-9]\d* file\(s\) scanned/, "the folder's markdown must actually be walked");

  // A folder is scoped, not swallowed: it sees strictly fewer files than the
  // whole-tree default, proving the argument narrowed the scan.
  const all = svc.validateReferences();
  const count = (s: string) => Number(/^(\d+) file\(s\) scanned/.exec(s)![1]);
  assert.ok(
    count(scoped.summary) < count(all.summary),
    `folder scope (${scoped.summary}) must be narrower than the default (${all.summary})`,
  );

  // A path that is neither file nor folder stays an honest typed error rather
  // than a vacuous pass.
  const missing = svc.validateReferences("plugins/wf/agents/does-not-exist.md");
  assert.equal(missing.status, "error");
  assert.ok(missing.findings.some((f) => f.rule === "input-unparseable"));
});
