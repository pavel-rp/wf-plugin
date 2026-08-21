import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorkspaceIdentity } from "../src/git-workspace.js";
import {
  selectWorkspaceRoot,
  type WorkspaceAdmissionReason,
  type WorkspaceRootSource,
} from "../src/workspace-admission.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function canonical(path: string): string {
  return realpathSync(path).replace(/\\/g, "/");
}

/** A real repository family: a main worktree, a linked worktree, a symlink alias
 *  to the main worktree, a NESTED independent repository, and an UNRELATED
 *  independent repository. The last two are the `out-of-family` cases. */
function makeRepositoryFixture(): {
  root: string;
  main: string;
  linked: string;
  alias: string;
  nested: string;
  unrelated: string;
  file: string;
} {
  const root = mkdtempSync(join(tmpdir(), "wf-workspace-admission-"));
  const main = join(root, "main");
  const linked = join(root, "linked");
  const alias = join(root, "alias");
  const nested = join(main, "nested");
  const unrelated = join(root, "unrelated");

  mkdirSync(main);
  git(main, "init", "-b", "main");
  git(main, "config", "user.email", "test@example.invalid");
  git(main, "config", "user.name", "Test");
  writeFileSync(join(main, "tracked.txt"), "fixture\n");
  git(main, "add", "tracked.txt");
  git(main, "commit", "-m", "fixture");
  git(main, "worktree", "add", "-b", "linked", linked);
  symlinkSync(main, alias, "junction");

  mkdirSync(nested);
  git(nested, "init", "-b", "nested");
  mkdirSync(unrelated);
  git(unrelated, "init", "-b", "other");

  return { root, main, linked, alias, nested, unrelated, file: join(main, "tracked.txt") };
}

/** Recursive name+kind listing, used to prove the API writes nothing. */
function treeSnapshot(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(`d ${full}`);
      out.push(...treeSnapshot(full));
    } else {
      out.push(`f ${full}`);
    }
  }
  return out;
}

function expectFailure(
  result: ReturnType<typeof selectWorkspaceRoot>,
  source: WorkspaceRootSource,
  reason: WorkspaceAdmissionReason,
): void {
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.root, null);
  assert.equal(result.source, source);
  assert.equal(result.reason, reason);
  assert.ok(result.diagnostic.length > 0);
}

test("precedence: explicit beats environment, environment beats cwd, cwd only when neither is declared", () => {
  const fixture = makeRepositoryFixture();
  try {
    const launch = resolveWorkspaceIdentity(fixture.main);

    // Explicit wins outright even when the environment also declares one.
    const explicit = selectWorkspaceRoot(
      { explicit: fixture.linked, environment: fixture.main, cwd: fixture.main },
      launch,
    );
    assert.equal(explicit.ok, true);
    if (explicit.ok) {
      assert.equal(explicit.source, "explicit");
      assert.equal(explicit.root, canonical(fixture.linked));
    }

    // Environment wins over cwd when no explicit root is declared.
    const environment = selectWorkspaceRoot(
      { explicit: null, environment: fixture.linked, cwd: fixture.main },
      launch,
    );
    assert.equal(environment.ok, true);
    if (environment.ok) {
      assert.equal(environment.source, "environment");
      assert.equal(environment.root, canonical(fixture.linked));
    }

    // An UNSET environment variable is ABSENT, not a failure: it falls through to cwd.
    const fellThrough = selectWorkspaceRoot(
      { explicit: null, environment: null, cwd: fixture.main },
      launch,
    );
    assert.equal(fellThrough.ok, true);
    if (fellThrough.ok) {
      assert.equal(fellThrough.source, "cwd");
      assert.equal(fellThrough.root, canonical(fixture.main));
    }

    // An OMITTED optional field is likewise absent.
    const omitted = selectWorkspaceRoot({ cwd: fixture.main }, launch);
    assert.equal(omitted.ok, true);
    if (omitted.ok) assert.equal(omitted.source, "cwd");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("declaration-empty is terminal at its declaring tier and never falls through", () => {
  const fixture = makeRepositoryFixture();
  try {
    const launch = resolveWorkspaceIdentity(fixture.main);

    for (const blank of ["", "   ", "\t\n"]) {
      // Declared blank at the ENVIRONMENT tier: cwd is valid and must NOT be used.
      expectFailure(
        selectWorkspaceRoot({ explicit: null, environment: blank, cwd: fixture.main }, launch),
        "environment",
        "declaration-empty",
      );

      // Declared blank at the EXPLICIT tier: neither the environment nor cwd is consulted.
      expectFailure(
        selectWorkspaceRoot(
          { explicit: blank, environment: fixture.main, cwd: fixture.main },
          launch,
        ),
        "explicit",
        "declaration-empty",
      );

      // The terminal tier declared blank fails too.
      expectFailure(
        selectWorkspaceRoot({ explicit: null, environment: null, cwd: blank }, launch),
        "cwd",
        "declaration-empty",
      );
    }

    // The regression this boundary closes: `||` treats "" and unset alike, `??` does not.
    const blankEnvironment = selectWorkspaceRoot(
      { explicit: null, environment: "", cwd: fixture.main },
      launch,
    );
    assert.equal(blankEnvironment.ok, false);
    const unsetEnvironment = selectWorkspaceRoot(
      { explicit: null, environment: null, cwd: fixture.main },
      launch,
    );
    assert.equal(unsetEnvironment.ok, true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("invalid declared roots map onto the closed reason set without throwing", () => {
  const fixture = makeRepositoryFixture();
  try {
    const launch = resolveWorkspaceIdentity(fixture.main);

    expectFailure(
      selectWorkspaceRoot({ explicit: "relative/path", cwd: fixture.main }, launch),
      "explicit",
      "not-absolute",
    );
    expectFailure(
      selectWorkspaceRoot({ explicit: join(fixture.root, "missing"), cwd: fixture.main }, launch),
      "explicit",
      "not-found",
    );
    expectFailure(
      selectWorkspaceRoot({ explicit: fixture.file, cwd: fixture.main }, launch),
      "explicit",
      "not-a-directory",
    );

    // The same tokens surface from the environment tier, carrying that tier's source.
    expectFailure(
      selectWorkspaceRoot({ environment: "relative/path", cwd: fixture.main }, launch),
      "environment",
      "not-absolute",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the reason token is derived from the wording, never from the rejected path's own text", () => {
  const fixture = makeRepositoryFixture();
  try {
    const launch = resolveWorkspaceIdentity(fixture.main);

    // A MISSING path whose own name reads like the non-directory failure. The
    // raised message interpolates the path, so classifying the raw message would
    // report `not-a-directory` for something that simply is not there.
    const spoofMissing = join(fixture.root, "must be a directory");
    const missing = selectWorkspaceRoot({ explicit: spoofMissing, cwd: fixture.main }, launch);
    assert.equal(missing.ok, false);
    assert.equal(missing.ok === false && missing.reason, "not-found");

    // And the mirror: a FILE whose own name reads like the missing-path failure.
    const spoofFile = join(fixture.root, "does not exist");
    writeFileSync(spoofFile, "not a directory\n");
    const notDirectory = selectWorkspaceRoot({ explicit: spoofFile, cwd: fixture.main }, launch);
    assert.equal(notDirectory.ok, false);
    assert.equal(notDirectory.ok === false && notDirectory.reason, "not-a-directory");

    // A rejected candidate is always recoverable from the diagnostic — the
    // absolute-path check names the label but not the value, so the boundary
    // echoes it rather than leaving the caller without the offending input.
    const relative = selectWorkspaceRoot({ explicit: "relative/path", cwd: fixture.main }, launch);
    assert.equal(relative.ok, false);
    assert.ok(relative.ok === false && relative.diagnostic.includes("relative/path"));
    for (const failed of [missing, notDirectory]) {
      assert.ok(failed.ok === false && failed.diagnostic.length > 0);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("out-of-family: a Git launch admits its worktree family and rejects everything else", () => {
  const fixture = makeRepositoryFixture();
  try {
    const launch = resolveWorkspaceIdentity(fixture.main);

    // The linked worktree and the symlink alias are IN the family. The alias
    // converges on the same canonical root as the main worktree.
    const linked = selectWorkspaceRoot({ explicit: fixture.linked, cwd: fixture.main }, launch);
    assert.equal(linked.ok, true);
    if (linked.ok) {
      assert.equal(linked.identity.kind, "git");
      assert.equal(linked.root, canonical(fixture.linked));
    }

    const alias = selectWorkspaceRoot({ explicit: fixture.alias, cwd: fixture.main }, launch);
    const direct = selectWorkspaceRoot({ explicit: fixture.main, cwd: fixture.main }, launch);
    assert.equal(alias.ok, true);
    assert.equal(direct.ok, true);
    if (alias.ok && direct.ok) assert.equal(alias.root, direct.root);

    // A nested independent repository and an unrelated one are both out of family.
    expectFailure(
      selectWorkspaceRoot({ explicit: fixture.nested, cwd: fixture.main }, launch),
      "explicit",
      "out-of-family",
    );
    expectFailure(
      selectWorkspaceRoot({ explicit: fixture.unrelated, cwd: fixture.main }, launch),
      "explicit",
      "out-of-family",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("out-of-family: a plain launch admits only its own canonical directory", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-workspace-admission-plain-"));
  try {
    const plain = join(root, "plain");
    const alias = join(root, "alias");
    const other = join(root, "other");
    const repository = join(root, "repository");
    mkdirSync(plain);
    mkdirSync(other);
    mkdirSync(repository);
    symlinkSync(plain, alias, "junction");
    git(repository, "init", "-b", "main");

    const launch = resolveWorkspaceIdentity(plain);
    assert.equal(launch.kind, "plain");

    const admitted = selectWorkspaceRoot({ explicit: alias, cwd: plain }, launch);
    assert.equal(admitted.ok, true);
    if (admitted.ok) {
      assert.equal(admitted.root, canonical(plain));
      assert.equal(admitted.identity.kind, "plain");
    }

    expectFailure(
      selectWorkspaceRoot({ explicit: other, cwd: plain }, launch),
      "explicit",
      "out-of-family",
    );
    expectFailure(
      selectWorkspaceRoot({ explicit: repository, cwd: plain }, launch),
      "explicit",
      "out-of-family",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("launch: null admits the candidate as its own launch, with no family constraint", () => {
  const fixture = makeRepositoryFixture();
  try {
    // Every one of these is out of family relative to `main`, yet each is
    // admissible on its own when there is no prior launch to constrain it.
    for (const candidate of [fixture.main, fixture.linked, fixture.nested, fixture.unrelated]) {
      const admitted = selectWorkspaceRoot({ explicit: candidate, cwd: fixture.main }, null);
      assert.equal(admitted.ok, true);
      if (admitted.ok) assert.equal(admitted.root, canonical(candidate));
    }

    // `launch: null` still canonicalizes and still rejects an invalid declaration.
    expectFailure(
      selectWorkspaceRoot({ explicit: fixture.file, cwd: fixture.main }, null),
      "explicit",
      "not-a-directory",
    );
    expectFailure(
      selectWorkspaceRoot({ explicit: "", cwd: fixture.main }, null),
      "explicit",
      "declaration-empty",
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("selection writes nothing on either the success or the failure path", () => {
  const fixture = makeRepositoryFixture();
  try {
    const launch = resolveWorkspaceIdentity(fixture.main);
    const beforeTree = treeSnapshot(fixture.root);
    const beforeCwd = process.cwd();
    const beforeEnv = process.env.WF_WORKSPACE_ROOT;

    const success = selectWorkspaceRoot({ explicit: fixture.linked, cwd: fixture.main }, launch);
    const emptyDeclaration = selectWorkspaceRoot({ explicit: "", cwd: fixture.main }, launch);
    const outOfFamily = selectWorkspaceRoot({ explicit: fixture.unrelated, cwd: fixture.main }, launch);
    const missing = selectWorkspaceRoot(
      { explicit: join(fixture.root, "missing"), cwd: fixture.main },
      launch,
    );

    assert.equal(success.ok, true);
    assert.equal(emptyDeclaration.ok, false);
    assert.equal(outOfFamily.ok, false);
    assert.equal(missing.ok, false);

    assert.deepEqual(treeSnapshot(fixture.root), beforeTree);
    assert.equal(process.cwd(), beforeCwd);
    assert.equal(process.env.WF_WORKSPACE_ROOT, beforeEnv);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("every source and every reason token is reachable", () => {
  const fixture = makeRepositoryFixture();
  try {
    const launch = resolveWorkspaceIdentity(fixture.main);

    const sources = new Set<WorkspaceRootSource>();
    const reasons = new Set<WorkspaceAdmissionReason>();
    const record = (result: ReturnType<typeof selectWorkspaceRoot>): void => {
      sources.add(result.source);
      if (!result.ok) reasons.add(result.reason);
    };

    record(selectWorkspaceRoot({ explicit: fixture.main, cwd: fixture.main }, launch));
    record(selectWorkspaceRoot({ environment: fixture.main, cwd: fixture.main }, launch));
    record(selectWorkspaceRoot({ cwd: fixture.main }, launch));
    record(selectWorkspaceRoot({ explicit: "", cwd: fixture.main }, launch));
    record(selectWorkspaceRoot({ explicit: "relative/path", cwd: fixture.main }, launch));
    record(
      selectWorkspaceRoot({ explicit: join(fixture.root, "missing"), cwd: fixture.main }, launch),
    );
    record(selectWorkspaceRoot({ explicit: fixture.file, cwd: fixture.main }, launch));
    record(selectWorkspaceRoot({ explicit: fixture.unrelated, cwd: fixture.main }, launch));

    assert.deepEqual([...sources].sort(), ["cwd", "environment", "explicit"]);
    assert.deepEqual(
      [...reasons].sort(),
      [
        "declaration-empty",
        "not-a-directory",
        "not-absolute",
        "not-found",
        "out-of-family",
      ].sort(),
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
