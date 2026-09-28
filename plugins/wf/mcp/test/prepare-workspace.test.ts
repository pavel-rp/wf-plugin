// WF-831 — fresh-worktree preparation.
//
// A real Git repository with a linked worktree (the fleet shipper layout): the
// source worktree carries initialized `_local/` setup state plus decoys that must
// never transfer; the child is fresh. Covers the original failure (an unprepared
// child resolves no task root), the prepared path (config, provider and profile
// resolve identically), idempotency, and every blocker.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { createDefaultPorts } from "../src/ports.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import { planPreparation } from "../src/resolver/prepare-workspace.js";
import { inspectContainedStatePath, writeContainedStateFile } from "../src/resolver/contained-state.js";
import { ResolverService } from "../src/service.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

const MANIFEST = `# demo capability

**Kind:** both

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/thing.ops.md\` | delivery |
`;

function config(install: string): string {
  return `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path |
|------------|------|
| demo | plugin:wf-demo/capabilities/demo |

## Plugin Roots

| Plugin | Root |
|--------|------|
| wf-demo | ${install} |
`;
}

type Family = {
  root: string;
  install: string;
  source: string;
  child: string;
  cleanup: () => void;
};

/** Source worktree (initialized) + a fresh linked worktree child. */
function makeFamily(opts: { initialize?: boolean } = {}): Family {
  const root = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-prepare-"))));
  const install = `${root}/install/wf-demo`;
  write(`${install}/capabilities/demo/manifest.md`, MANIFEST);
  write(`${install}/capabilities/demo/fragments/thing.ops.md`, "# thing\n");

  const source = `${root}/source`;
  mkdirSync(source);
  git(source, "init", "-b", "main");
  git(source, "config", "user.email", "test@example.invalid");
  git(source, "config", "user.name", "Test");
  write(`${source}/.gitignore`, "_local/\n.wf/\n");
  write(`${source}/tracked.txt`, "fixture\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "fixture");

  if (opts.initialize !== false) {
    write(`${source}/_local/config.md`, config(install));
    write(`${source}/_local/constitution.md`, "# Constitution\n\n- core.1 — spec is truth.\n");
    write(`${source}/_local/profiles/demo.profile.json`, `${JSON.stringify({ team: "alpha" })}\n`);
    write(`${source}/_local/slots/spec.questions.md`, "# override\n");
    // Decoys — none of these may ever reach the child.
    write(`${source}/_local/WF-1/01_spec.md`, "# a task folder\n");
    write(`${source}/_local/fleet/scoreboard.md`, "# scoreboard\n");
    write(`${source}/_local/scratch/note.md`, "scratch\n");
    write(`${source}/_local/resolver/snapshot.json`, "{}\n");
    write(`${source}/_local/install-state.json`, `${JSON.stringify({ binding: {} })}\n`);
    write(`${source}/_local/lifecycle-journal.json`, "{}\n");
    write(`${source}/.wf/run-evidence/r.json`, "{}\n");
  }

  const child = `${root}/child`;
  git(source, "worktree", "add", "-b", "child", child);
  return { root, install, source, child, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function service(workspaceRoot: string, install?: string): ResolverService {
  const listing = install
    ? parsePluginList(
        JSON.stringify([
          { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: true, installPath: install },
        ]),
      )
    : { plugins: [], contractOk: true, issues: [] };
  return new ResolverService({
    ...createDefaultPorts(workspaceRoot),
    listPlugins: () => ({
      plugins: listing.plugins,
      ok: true,
      contractOk: listing.contractOk,
      issues: listing.issues,
    }),
  });
}

function listTree(dir: string, prefix = ""): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listTree(join(dir, entry.name), `${prefix}${entry.name}/`)
      : [`${prefix}${entry.name}`],
  );
}

function digestTree(dir: string): string {
  const hash = createHash("sha256");
  for (const rel of listTree(dir).sort()) {
    hash.update(rel);
    hash.update(readFileSync(join(dir, rel)));
  }
  return hash.digest("hex");
}

test("the original failure: an unprepared linked worktree resolves no task root", () => {
  const family = makeFamily();
  try {
    assert.equal(service(family.child).resolveConfig().coreConfig.taskRoot, null);
    assert.equal(service(family.child).resolveProvider("delivery").state, "unconfigured");
  } finally {
    family.cleanup();
  }
});

test("prepared: config, provider and profile resolve as in the source; only allowlisted files transfer", () => {
  const family = makeFamily();
  try {
    const sourceBefore = digestTree(`${family.source}/_local`);
    const child = service(family.child, family.install);
    const result = child.prepareWorkspace(family.source);

    assert.equal(result.status, "prepared", JSON.stringify(result));
    // Measured before this test opens its own service on the source, which
    // legitimately writes that worktree's own snapshot cache.
    assert.equal(digestTree(`${family.source}/_local`), sourceBefore, "source bytes are unchanged");
    assert.deepEqual([...result.copied].sort(), [
      "_local/config.md",
      "_local/constitution.md",
      "_local/profiles/demo.profile.json",
      "_local/slots/spec.questions.md",
    ]);

    const source = service(family.source, family.install);
    assert.equal(child.resolveConfig().coreConfig.taskRoot, source.resolveConfig().coreConfig.taskRoot);
    assert.equal(child.resolveConfig().coreConfig.taskRoot, "_local");
    const childProvider = child.resolveProvider("delivery");
    const sourceProvider = source.resolveProvider("delivery");
    assert.equal(childProvider.state, "ok");
    assert.equal(childProvider.owner, sourceProvider.owner);
    assert.deepEqual(child.resolveProfile("demo"), source.resolveProfile("demo"));

    // Nothing outside the allowlist, and no task folder, receipt or run evidence.
    const childFiles = listTree(`${family.child}/_local`).sort();
    const allowed = new Set([
      "config.md",
      "constitution.md",
      "profiles/demo.profile.json",
      "slots/spec.questions.md",
      "install-state.json",
    ]);
    for (const rel of childFiles) {
      assert.ok(allowed.has(rel) || rel.startsWith("resolver/"), `unexpected child file _local/${rel}`);
    }
    for (const decoy of ["WF-1", "fleet", "scratch", "lifecycle-journal.json"]) {
      assert.equal(existsSync(`${family.child}/_local/${decoy}`), false, `${decoy} must not transfer`);
    }
    assert.equal(existsSync(`${family.child}/.wf/run-evidence`), false);
    const childSnapshot = `${family.child}/_local/resolver/snapshot.json`;
    assert.ok(
      !existsSync(childSnapshot) || readFileSync(childSnapshot, "utf8") !== "{}\n",
      "the source snapshot must never be copied",
    );

    // The machine binding is regenerated from the child's own observation, not copied.
    assert.equal(result.installState, "regenerated");
    const ledger = JSON.parse(readFileSync(`${family.child}/_local/install-state.json`, "utf8"));
    const bindings = Object.values(ledger.binding ?? {}) as { pluginId?: string; canonicalRoot?: string }[];
    assert.ok(
      bindings.some((binding) => binding.pluginId === "wf-demo@local" && binding.canonicalRoot === family.install),
      `the observed pack binding is recorded: ${JSON.stringify(ledger)}`,
    );
    assert.equal(ledger.portable, undefined, "the portable half is never written here");
    assert.equal(existsSync(`${family.child}/.wf/install-state.json`), false);
  } finally {
    family.cleanup();
  }
});

test("already-prepared: a second call writes nothing", () => {
  const family = makeFamily();
  try {
    const child = service(family.child, family.install);
    assert.equal(child.prepareWorkspace(family.source).status, "prepared");
    const watched = ["config.md", "constitution.md", "install-state.json"];
    const before = watched.map((rel) => statSync(`${family.child}/_local/${rel}`).mtimeMs);

    const again = service(family.child, family.install).prepareWorkspace(family.source);
    assert.equal(again.status, "already-prepared", JSON.stringify(again));
    assert.deepEqual(again.copied, []);
    assert.equal(again.installState, "present");
    assert.deepEqual(
      watched.map((rel) => statSync(`${family.child}/_local/${rel}`).mtimeMs),
      before,
    );
  } finally {
    family.cleanup();
  }
});

test("divergent: a differing child file blocks and is left untouched", () => {
  const family = makeFamily();
  try {
    write(`${family.child}/_local/constitution.md`, "# a local edit\n");
    const result = service(family.child).prepareWorkspace(family.source);
    assert.equal(result.status, "blocked");
    assert.equal(result.status === "blocked" && result.reason, "divergent");
    assert.equal(result.status === "blocked" && result.path, "_local/constitution.md");
    assert.equal(readFileSync(`${family.child}/_local/constitution.md`, "utf8"), "# a local edit\n");
    assert.equal(existsSync(`${family.child}/_local/config.md`), false, "nothing is written on a blocker");
  } finally {
    family.cleanup();
  }
});

test("foreign-root: an unrelated repository and the worktree itself are both refused", () => {
  const family = makeFamily();
  const other = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-prepare-other-"))));
  try {
    git(other, "init", "-b", "main");
    write(`${other}/_local/config.md`, config(family.install));
    const unrelated = service(family.child).prepareWorkspace(other);
    assert.equal(unrelated.status === "blocked" && unrelated.reason, "foreign-root");

    const self = service(family.child).prepareWorkspace(family.child);
    assert.equal(self.status === "blocked" && self.reason, "foreign-root");
    assert.equal(existsSync(`${family.child}/_local`), false, "nothing is written on a blocker");
  } finally {
    family.cleanup();
    rmSync(other, { recursive: true, force: true });
  }
});

test("source-uninitialized: a source with no registry, or no task root, is refused", () => {
  const bare = makeFamily({ initialize: false });
  try {
    const result = service(bare.child).prepareWorkspace(bare.source);
    assert.equal(result.status === "blocked" && result.reason, "source-uninitialized");

    write(`${bare.source}/_local/config.md`, "# Config\n\n| Key | Value |\n|-----|-------|\n| **Task Root** | `<none>` |\n");
    const noTaskRoot = service(bare.child).prepareWorkspace(bare.source);
    assert.equal(noTaskRoot.status === "blocked" && noTaskRoot.reason, "source-uninitialized");
    assert.equal(existsSync(`${bare.child}/_local`), false);
  } finally {
    bare.cleanup();
  }
});

test("unsafe-path: a symlinked source entry is refused and nothing is written", () => {
  const family = makeFamily();
  try {
    rmSync(`${family.source}/_local/profiles/demo.profile.json`);
    write(`${family.root}/elsewhere.json`, "{}\n");
    symlinkSync(`${family.root}/elsewhere.json`, `${family.source}/_local/profiles/demo.profile.json`);
    const result = service(family.child).prepareWorkspace(family.source);
    assert.equal(result.status === "blocked" && result.reason, "unsafe-path");
    assert.equal(result.status === "blocked" && result.path, "_local/profiles/demo.profile.json");
    assert.equal(existsSync(`${family.child}/_local`), false);
  } finally {
    family.cleanup();
  }
});

// WF-872 — the machine binding ledger is proved link-free before any copy.

test("unsafe-path: a dangling binding-ledger symlink blocks before any copy and creates nothing outside", () => {
  const family = makeFamily();
  try {
    mkdirSync(`${family.child}/_local`);
    const outside = `${family.root}/outside/ledger.json`;
    symlinkSync(outside, `${family.child}/_local/install-state.json`);
    const result = service(family.child, family.install).prepareWorkspace(family.source);
    assert.equal(result.status === "blocked" && result.reason, "unsafe-path", JSON.stringify(result));
    assert.equal(result.status === "blocked" && result.path, "_local/install-state.json");
    assert.equal(existsSync(outside), false, "the link target is never created");
    assert.equal(existsSync(`${family.root}/outside`), false);
    assert.equal(existsSync(`${family.child}/_local/config.md`), false, "no copy lands on a blocker");
  } finally {
    family.cleanup();
  }
});

test("unsafe-path: a binding-ledger symlink to an existing file is neither trusted as present nor written", () => {
  const family = makeFamily();
  try {
    mkdirSync(`${family.child}/_local`);
    const outside = `${family.root}/external-ledger.json`;
    write(outside, "external\n");
    symlinkSync(outside, `${family.child}/_local/install-state.json`);
    const result = service(family.child, family.install).prepareWorkspace(family.source);
    assert.equal(result.status === "blocked" && result.reason, "unsafe-path");
    assert.equal(result.status === "blocked" && result.path, "_local/install-state.json");
    assert.equal(readFileSync(outside, "utf8"), "external\n");
    assert.equal(existsSync(`${family.child}/_local/config.md`), false);
  } finally {
    family.cleanup();
  }
});

test("unsafe-path: a symlinked ledger ancestor blocks and writes nothing through it", () => {
  const family = makeFamily();
  try {
    const outsideDir = `${family.root}/outside-local`;
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, `${family.child}/_local`);
    const result = service(family.child, family.install).prepareWorkspace(family.source);
    assert.equal(result.status === "blocked" && result.reason, "unsafe-path");
    assert.equal(result.status === "blocked" && result.path, "_local");
    assert.deepEqual(readdirSync(outsideDir), [], "nothing lands in the link target");
  } finally {
    family.cleanup();
  }
});

test("contained-state: the inspection refuses every link and the writer creates only real directories", () => {
  const root = normalizeSlashes(realpathSync(mkdtempSync(join(tmpdir(), "wf-contained-"))));
  try {
    assert.deepEqual(inspectContainedStatePath(root, "_local/resolver/state.json"), { ok: true, state: "absent" });
    assert.deepEqual(writeContainedStateFile(root, "_local/resolver/state.json", "one\n"), { ok: true });
    assert.equal(readFileSync(`${root}/_local/resolver/state.json`, "utf8"), "one\n");
    assert.deepEqual(inspectContainedStatePath(root, "_local/resolver/state.json"), { ok: true, state: "file" });
    assert.deepEqual(writeContainedStateFile(root, "_local/resolver/state.json", "two\n"), { ok: true });
    assert.equal(readFileSync(`${root}/_local/resolver/state.json`, "utf8"), "two\n");

    // A link that resolves INSIDE the workspace is refused too: no link is followed.
    write(`${root}/_local/real.json`, "real\n");
    symlinkSync(`${root}/_local/real.json`, `${root}/_local/linked.json`);
    const inside = inspectContainedStatePath(root, "_local/linked.json");
    assert.equal(!inside.ok && inside.path, "_local/linked.json");
    const refused = writeContainedStateFile(root, "_local/linked.json", "x\n");
    assert.equal(!refused.ok && refused.kind, "unsafe");
    assert.equal(readFileSync(`${root}/_local/real.json`, "utf8"), "real\n");

    for (const rel of ["", "/abs", "_local/../x", "_local//x", "_local\\x"]) {
      assert.equal(inspectContainedStatePath(root, rel).ok, false, `refused: ${JSON.stringify(rel)}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allowlist: settings overrides transfer; a registry outside the setup-state root is unsafe", () => {
  const family = makeFamily();
  try {
    write(`${family.source}/_local/profiles/ship.settings.json`, "{}\n");
    write(`${family.source}/_local/profiles/notes.txt`, "not a profile\n");
    const plan = planPreparation({
      childRoot: family.child,
      sourceRoot: family.source,
      registryRel: "_local/config.md",
    });
    assert.ok(plan.ok);
    const rels = plan.ok ? plan.copies.map((copy) => copy.rel).sort() : [];
    assert.ok(rels.includes("_local/profiles/ship.settings.json"));
    assert.ok(!rels.includes("_local/profiles/notes.txt"));

    const outside = planPreparation({
      childRoot: family.child,
      sourceRoot: family.source,
      registryRel: "config/registry.md",
    });
    assert.equal(!outside.ok && outside.reason, "unsafe-path");
  } finally {
    family.cleanup();
  }
});
