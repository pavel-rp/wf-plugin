// Worktree-isolation reproduction fixture for the C011 F4 claim (WF-484, C029 OUT-3).
//
// F4 claims the resolver defeats worktree isolation for a dispatched fleet shipper.
//
// The fixture rebuilds the layout the C011 run actually used: a container
// directory `<parent-checkout>/.claude/worktrees/agent-<id>` **nested inside the
// parent checkout**, and exercises it in the two states that separate the two
// competing mechanisms:
//
//   (a) pre-registration — the container is a plain directory that no
//       `git worktree add` has registered yet. This is the state C011's F5
//       records all 16 shippers ran in (`subagent_type: "claude"`, no
//       `isolation`), and it is F5's own stated rationale.
//   (b) registered — the container is a genuine linked worktree, the shape
//       `plugins/wf/skills/fleet/SKILL.md:158` mandates and which
//       `docs/c029-out8-dispatch-behaviour-retest.md` §5 records as available.
//
// Each state drives the same code path a `resolve_config({ workspaceRoot })`
// request takes to resolve a root — `resolveWorkspaceIdentity`, and
// `WorkspaceServiceRegistry.select` above it — and asserts the observed root
// against the expected root, so the verdict recorded in
// `docs/c029-out3-worktree-isolation-reproduction.md` is re-derived
// mechanically on every run rather than asserted in prose.
//
// This file adds coverage only. It changes no resolver source and no resolver
// semantics; it pins current behaviour so a later semantic change (WF-495) has
// a baseline to be judged against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveWorkspaceIdentity } from "../src/git-workspace.js";
import { WorkspaceServiceRegistry } from "../src/workspace-services.js";
import type { ResolverService } from "../src/service.js";

/** The container path the fleet dispatch shape uses, relative to the parent checkout. */
const CONTAINER_PREFIX = ".claude/worktrees";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function canonical(path: string): string {
  return realpathSync(path).replace(/\\/g, "/");
}

/**
 * Build the C011 layout: a parent checkout with a `.claude/worktrees/` container
 * directory nested inside it. Containers are returned as paths only — each test
 * decides whether to leave a container unregistered (state a) or register it as
 * a linked worktree (state b).
 */
function makeFleetLayout(): { root: string; parent: string; container: (id: string) => string } {
  const root = mkdtempSync(join(tmpdir(), "wf-worktree-isolation-repro-"));
  const parent = join(root, "parent-checkout");

  mkdirSync(parent);
  git(parent, "init", "-b", "main");
  git(parent, "config", "user.email", "test@example.invalid");
  git(parent, "config", "user.name", "Test");
  writeFileSync(join(parent, "tracked.txt"), "fixture\n");
  git(parent, "add", "tracked.txt");
  git(parent, "commit", "-m", "fixture");

  // The container root lives *inside* the parent's working tree, exactly as the
  // C011 run's `.claude/worktrees/` did.
  mkdirSync(join(parent, CONTAINER_PREFIX), { recursive: true });

  return { root, parent, container: (id) => join(parent, CONTAINER_PREFIX, `agent-${id}`) };
}

test("state (a) pre-registration: a container nested in the parent checkout resolves to the parent, not itself", () => {
  const layout = makeFleetLayout();
  try {
    const container = layout.container("aaa");
    mkdirSync(container); // a plain directory — no `git worktree add` has run

    const expectedIfIsolated = canonical(container);
    const parentRoot = canonical(layout.parent);
    const identity = resolveWorkspaceIdentity(container);

    // Recorded verbatim so a CI failure prints the observed and expected roots.
    assert.equal(
      identity.root,
      parentRoot,
      `observed root ${identity.root} — expected the parent checkout ${parentRoot} ` +
        `(isolation would have required ${expectedIfIsolated})`,
    );
    assert.notEqual(
      identity.root,
      expectedIfIsolated,
      `observed root ${identity.root} unexpectedly equals the container ${expectedIfIsolated}`,
    );

    // The mechanism: git's own discovery walks up out of an unregistered
    // directory, so `--show-toplevel` (git-workspace.ts) already reports the
    // parent. The resolver is handed the parent and never sees the container.
    assert.equal(identity.kind, "git");
    const topLevel = execFileSync("git", ["-C", container, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
    }).trim();
    assert.equal(
      canonical(topLevel),
      parentRoot,
      `git itself reports ${canonical(topLevel)} as the top-level for the unregistered container`,
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("state (a) pre-registration: two shippers' containers collapse onto the parent's single service", () => {
  const layout = makeFleetLayout();
  try {
    const first = layout.container("aaa");
    const second = layout.container("bbb");
    mkdirSync(first);
    mkdirSync(second);

    const constructed: string[] = [];
    const registry = new WorkspaceServiceRegistry(layout.parent, (root) => {
      constructed.push(root);
      return { root } as unknown as ResolverService;
    });

    const firstService = registry.select(first);
    const secondService = registry.select(second);

    // This is C011's F4 symptom, mechanically: concurrent shippers share one
    // root-bound service, and that root is the shared checkout.
    assert.strictEqual(firstService, secondService);
    assert.deepEqual(constructed, [canonical(layout.parent)]);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("state (b) registered: the same container path resolves to itself once it is a linked worktree", () => {
  const layout = makeFleetLayout();
  try {
    const container = layout.container("aaa");
    git(layout.parent, "worktree", "add", "-b", "agent-aaa", container);

    const expected = canonical(container);
    const identity = resolveWorkspaceIdentity(container);

    assert.equal(
      identity.root,
      expected,
      `observed root ${identity.root} — expected the agent's own worktree ${expected}`,
    );
    assert.notEqual(
      identity.root,
      canonical(layout.parent),
      `observed root ${identity.root} is the parent checkout — isolation did not hold`,
    );
    assert.equal(identity.kind, "git");
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("state (b) registered: concurrent sibling worktrees resolve to distinct roots and distinct services", () => {
  const layout = makeFleetLayout();
  try {
    const first = layout.container("aaa");
    const second = layout.container("bbb");
    git(layout.parent, "worktree", "add", "-b", "agent-aaa", first);
    git(layout.parent, "worktree", "add", "-b", "agent-bbb", second);

    const constructed: string[] = [];
    const registry = new WorkspaceServiceRegistry(layout.parent, (root) => {
      constructed.push(root);
      return { root, mutable: { invalidated: false } } as unknown as ResolverService;
    });

    const firstService = registry.select(first) as unknown as { mutable: { invalidated: boolean } };
    firstService.mutable.invalidated = true;
    const secondService = registry.select(second) as unknown as { mutable: { invalidated: boolean } };

    assert.notStrictEqual(firstService, secondService);
    assert.equal(secondService.mutable.invalidated, false, "sibling worktrees leaked service state");
    assert.deepEqual(constructed, [canonical(first), canonical(second)]);

    // Repeat selection is stable — a second shipper call returns its own service.
    assert.strictEqual(registry.select(first), firstService as unknown as ResolverService);
    assert.strictEqual(registry.select(second), secondService as unknown as ResolverService);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("an unregistered directory inside a registered worktree resolves to that worktree, not to the family root", () => {
  const layout = makeFleetLayout();
  try {
    const container = layout.container("aaa");
    git(layout.parent, "worktree", "add", "-b", "agent-aaa", container);

    // A plain, unregistered subdirectory *inside* the agent's own linked
    // worktree — the shape a shipper reaches when it resolves a path below its
    // own root. This is the decisive discriminator between the two candidate
    // mechanisms: the caller's common dir here IS the family's, so a
    // `--git-common-dir`-driven return would answer with the parent checkout.
    const nested = join(container, "_local", "scratch", "probe");
    mkdirSync(nested, { recursive: true });

    const identity = resolveWorkspaceIdentity(nested);
    assert.equal(identity.kind, "git");
    assert.equal(
      identity.root,
      canonical(container),
      `observed root ${identity.root} — expected the enclosing worktree ${canonical(container)}`,
    );
    assert.notEqual(
      identity.root,
      canonical(layout.parent),
      `observed root ${identity.root} is the family root — a common-dir-driven return`,
    );
    assert.equal(
      identity.kind === "git" ? identity.commonDir : "",
      canonical(join(layout.parent, ".git")),
      "the caller's common dir is the family's, yet the returned root is not the family root",
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("the service map is keyed on the resolved worktree root, not on the shared Git common directory", () => {
  const layout = makeFleetLayout();
  try {
    const first = layout.container("aaa");
    const second = layout.container("bbb");
    git(layout.parent, "worktree", "add", "-b", "agent-aaa", first);
    git(layout.parent, "worktree", "add", "-b", "agent-bbb", second);

    const firstIdentity = resolveWorkspaceIdentity(first);
    const secondIdentity = resolveWorkspaceIdentity(second);
    assert.equal(firstIdentity.kind, "git");
    assert.equal(secondIdentity.kind, "git");

    // Both worktrees share one common dir — the family-admission predicate.
    assert.equal(
      firstIdentity.kind === "git" ? firstIdentity.commonDir : "",
      secondIdentity.kind === "git" ? secondIdentity.commonDir : "",
    );

    // Yet they do not collapse: the map keys on `identity.root`. Had the common
    // dir been the key — the mechanism C011's F4 describes — one service would
    // have been constructed here instead of two.
    const constructed: string[] = [];
    const registry = new WorkspaceServiceRegistry(layout.parent, (root) => {
      constructed.push(root);
      return { root } as unknown as ResolverService;
    });
    registry.select(first);
    registry.select(second);
    assert.equal(
      constructed.length,
      2,
      `two worktrees sharing one common dir produced ${constructed.length} service(s): ${constructed.join(", ")}`,
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});
