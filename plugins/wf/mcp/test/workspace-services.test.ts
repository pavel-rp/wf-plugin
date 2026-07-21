import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ResolverService } from "../src/service.js";
import { WorkspaceServiceRegistry } from "../src/workspace-services.js";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function makeRepositoryFixture(): {
  root: string;
  main: string;
  linked: string;
  alias: string;
  nested: string;
  unrelated: string;
} {
  const root = mkdtempSync(join(tmpdir(), "wf-workspace-services-"));
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

  return { root, main, linked, alias, nested, unrelated };
}

test("canonical aliases and subdirectories share one root-bound service while linked worktrees isolate state", () => {
  const fixture = makeRepositoryFixture();
  try {
    const constructed: string[] = [];
    const registry = new WorkspaceServiceRegistry(fixture.main, (root) => {
      constructed.push(root);
      return { root, mutable: { invalidated: false } } as unknown as ResolverService;
    });
    const subdirectory = join(fixture.main, "subdirectory");
    mkdirSync(subdirectory);

    const main = registry.select(fixture.main) as unknown as { mutable: { invalidated: boolean } };
    main.mutable.invalidated = true;
    assert.strictEqual(registry.select(fixture.alias), main);
    assert.strictEqual(registry.select(subdirectory), main);

    const linked = registry.select(fixture.linked) as unknown as { mutable: { invalidated: boolean } };
    assert.notStrictEqual(linked, main);
    assert.equal(linked.mutable.invalidated, false);
    assert.equal(constructed.length, 2);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("plain launch roots admit only their canonical alias and support status/query access", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-workspace-plain-"));
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

    const constructed: string[] = [];
    const service = {
      inspect: () => ({ valid: false }),
      resolveConfig: () => ({ workspaceRoot: realpathSync(plain) }),
    } as unknown as ResolverService;
    const registry = new WorkspaceServiceRegistry(plain, (workspaceRoot) => {
      constructed.push(workspaceRoot);
      return service;
    });

    const selected = registry.select(plain);
    assert.strictEqual(registry.select(alias), selected);
    assert.equal((selected as unknown as { inspect(): { valid: boolean } }).inspect().valid, false);
    assert.equal(
      (selected as unknown as { resolveConfig(): { workspaceRoot: string } }).resolveConfig().workspaceRoot,
      realpathSync(plain),
    );
    assert.deepEqual(constructed, [realpathSync(plain).replace(/\\/g, "/")]);

    assert.throws(() => registry.select(other), /outside the plain launch directory/);
    assert.throws(() => registry.select(repository), /outside the plain launch directory/);
    assert.equal(constructed.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a plain launch root reuses its service if it becomes a Git top-level", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-workspace-transition-"));
  try {
    const launch = join(root, "launch");
    const linked = join(root, "linked");
    const nested = join(launch, "nested");
    mkdirSync(launch);

    const constructed: string[] = [];
    const registry = new WorkspaceServiceRegistry(launch, (workspaceRoot) => {
      constructed.push(workspaceRoot);
      return { workspaceRoot } as unknown as ResolverService;
    });
    const beforeGit = registry.select(launch);

    git(launch, "init", "-b", "main");
    git(launch, "config", "user.email", "test@example.invalid");
    git(launch, "config", "user.name", "Test");
    writeFileSync(join(launch, "tracked.txt"), "fixture\n");
    git(launch, "add", "tracked.txt");
    git(launch, "commit", "-m", "fixture");
    git(launch, "worktree", "add", "-b", "linked", linked);

    assert.strictEqual(registry.select(launch), beforeGit);
    assert.deepEqual(constructed, [realpathSync(launch).replace(/\\/g, "/")]);

    mkdirSync(nested);
    git(nested, "init", "-b", "nested");
    assert.throws(() => registry.select(nested), /outside the plain launch directory/);
    assert.throws(() => registry.select(linked), /outside the plain launch directory/);
    assert.equal(constructed.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid, nested, and unrelated roots are rejected before service construction", () => {
  const fixture = makeRepositoryFixture();
  try {
    let constructions = 0;
    const registry = new WorkspaceServiceRegistry(fixture.main, () => {
      constructions += 1;
      return {} as ResolverService;
    });
    const file = join(fixture.main, "tracked.txt");

    assert.throws(() => registry.select("relative/path"), /absolute path/);
    assert.throws(() => registry.select(join(fixture.root, "missing")), /does not exist/);
    assert.throws(() => registry.select(file), /must be a directory/);
    assert.throws(() => registry.select(fixture.nested), /outside the launch repository/);
    assert.throws(() => registry.select(fixture.unrelated), /outside the launch repository/);
    assert.equal(constructions, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
