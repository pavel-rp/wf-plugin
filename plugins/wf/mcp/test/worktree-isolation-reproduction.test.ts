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
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { describeCallerRoot, resolveWorkspaceIdentity } from "../src/git-workspace.js";
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

// --- WF-495: the additive caller-root signal --------------------------------
//
// The six cases above pin the RESOLUTION, which WF-484 found correct and left
// unchanged. What they also establish is that the resolution is SILENT: in
// state (a) the caller receives a plausible absolute path with no way to learn
// it is the parent's. WF-495 adds two strictly additive `resolve_config`
// response fields — `callerRoot` and the designated predicate `rootRedirected`
// — so that condition is detectable from the response alone.
//
// These cases drive the REAL registered `resolve_config` handler through the
// stub-server harness (the shape `test/plan-install.test.ts` uses), with a
// selector that performs the real `resolveWorkspaceIdentity` against the real
// git layouts built above. They therefore exercise the shipped handler
// composition rather than a re-implementation of it. Nothing above this comment
// is modified — this block is appended coverage only.

type ConfigToolResult = {
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type CallerRootResponse = {
  workspaceRoot: string;
  callerRoot: string;
  rootRedirected: boolean;
};

/** Register the real tools against a stub server and return `resolve_config`'s handler. */
async function resolveConfigHandler(): Promise<(args: { workspaceRoot: string }) => Promise<ConfigToolResult>> {
  const { registerResolverTools } = await import("../src/tools.js");
  const registered = new Map<string, { handler: (args: never) => Promise<ConfigToolResult> }>();
  const server = {
    registerTool(
      name: string,
      _config: unknown,
      handler: (args: never) => Promise<ConfigToolResult>,
    ) {
      registered.set(name, { handler });
    },
  } as unknown as Parameters<typeof registerResolverTools>[0];

  // The selector does the REAL root resolution; the service it returns is a
  // minimal root-bound stub, because the only thing under test here is how the
  // handler relates the caller's request to that resolved root.
  registerResolverTools(server, (workspaceRoot: string) => {
    const identity = resolveWorkspaceIdentity(workspaceRoot);
    return {
      resolveConfig: () => ({
        workspaceRoot: identity.root,
        registryPath: "_local/config.md",
        coreConfig: {},
        idShape: null,
        coreVersion: null,
      }),
    } as unknown as ResolverService;
  });

  const tool = registered.get("resolve_config");
  assert.ok(tool, "resolve_config is registered");
  return tool.handler as unknown as (args: { workspaceRoot: string }) => Promise<ConfigToolResult>;
}

// Registered once for the whole file, not per call: the tool surface is
// stateless here (the selector resolves each request's root afresh), so
// re-registering it per assertion would only repeat work.
let sharedHandler: Promise<(args: { workspaceRoot: string }) => Promise<ConfigToolResult>> | undefined;

/** Call the real `resolve_config` handler and return its structured payload. */
async function resolveConfigFrom(workspaceRoot: string): Promise<CallerRootResponse> {
  sharedHandler ??= resolveConfigHandler();
  const handler = await sharedHandler;
  const result = await handler({ workspaceRoot });
  assert.notEqual(result.isError, true, `resolve_config errored for ${workspaceRoot}`);
  assert.ok(result.structuredContent, "resolve_config returned no structured payload");
  return result.structuredContent as unknown as CallerRootResponse;
}

test("WF-495 state (a): an unregistered container reports the redirection it previously suffered silently", async () => {
  const layout = makeFleetLayout();
  try {
    const container = layout.container("aaa");
    mkdirSync(container); // a plain directory — no `git worktree add` has run

    const response = await resolveConfigFrom(container);

    // The resolved root is unchanged from case 1 — this signal alters nothing.
    assert.equal(response.workspaceRoot, canonical(layout.parent));
    // ...but the caller can now SEE that it is not its own directory.
    assert.equal(response.callerRoot, canonical(container));
    assert.equal(
      response.rootRedirected,
      true,
      "the shipper's container is not the resolved root, and the response must say so",
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("WF-495 state (b): a registered linked worktree reports no redirection", async () => {
  const layout = makeFleetLayout();
  try {
    const container = layout.container("aaa");
    git(layout.parent, "worktree", "add", "-b", "agent-aaa", container);

    const response = await resolveConfigFrom(container);

    assert.equal(response.workspaceRoot, canonical(container));
    assert.equal(response.callerRoot, response.workspaceRoot);
    assert.equal(
      response.rootRedirected,
      false,
      "the mandated dispatch shape must report a clean, un-redirected root",
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("WF-495: N concurrent registered worktrees yield N distinct roots, each reporting no redirection", async () => {
  const layout = makeFleetLayout();
  try {
    const ids = ["aaa", "bbb", "ccc"];
    const containers = ids.map((id) => {
      const path = layout.container(id);
      git(layout.parent, "worktree", "add", "-b", `agent-${id}`, path);
      return path;
    });

    const responses = await Promise.all(containers.map((path) => resolveConfigFrom(path)));

    // N distinct roots for N shippers — OUT-3's second success measure, now
    // asserted alongside the signal that proves each one is genuinely its own.
    const roots = responses.map((r) => r.workspaceRoot);
    assert.equal(new Set(roots).size, ids.length, `expected ${ids.length} distinct roots, got: ${roots.join(", ")}`);
    for (const [index, response] of responses.entries()) {
      assert.equal(response.workspaceRoot, canonical(containers[index]!));
      assert.equal(response.callerRoot, response.workspaceRoot);
      assert.equal(response.rootRedirected, false, `shipper ${ids[index]} reported a redirected root`);
    }
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("WF-495: an ordinary repository subdirectory reports a redirection, correctly and by design", async () => {
  const layout = makeFleetLayout();
  try {
    const subdirectory = join(layout.parent, "subdirectory");
    mkdirSync(subdirectory);

    const response = await resolveConfigFrom(subdirectory);

    // This is NOT a defect and NOT a false positive. Per WF-484 §4 (and fixture
    // case 5 above) the resolver provably cannot distinguish an ordinary
    // subdirectory call from an unregistered fleet container — they are the same
    // situation at the git level. The field reports the mechanical fact; the
    // consumer decides whether it matters. Narrowing it would require the
    // resolver to guess intent.
    assert.equal(response.workspaceRoot, canonical(layout.parent));
    assert.equal(response.callerRoot, canonical(subdirectory));
    assert.equal(response.rootRedirected, true);
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("WF-495: canonicalization converges, so an alias form of the resolved root is not a redirection", async () => {
  const layout = makeFleetLayout();
  try {
    const container = layout.container("aaa");
    git(layout.parent, "worktree", "add", "-b", "agent-aaa", container);

    // Each of these names the same directory by a different spelling. A
    // caller-side raw string comparison would call every one of them a
    // redirection; the resolver's canonicalization is exactly why the predicate
    // is computed server-side.
    //
    // The `..`-round-trip form is used rather than `join(container, ".")`,
    // which `path.join` collapses before it ever reaches the resolver and so
    // would silently degenerate into a repeat of the identity case.
    const symlinkAlias = join(layout.root, "alias-aaa");
    symlinkSync(container, symlinkAlias, "junction");

    const aliases = [
      `${container}/`,
      `${container}//`,
      join(container, "..", basename(container)),
      symlinkAlias, // the form every rationale doc leads with
    ];
    for (const alias of aliases) {
      const response = await resolveConfigFrom(alias);
      assert.equal(response.callerRoot, canonical(container), `alias ${alias} did not canonicalize`);
      assert.equal(response.workspaceRoot, canonical(container));
      assert.equal(response.rootRedirected, false, `alias ${alias} was wrongly reported as redirected`);
    }
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});

test("WF-495: a plain (non-Git) directory resolves to itself and reports no redirection", async () => {
  const plain = mkdtempSync(join(tmpdir(), "wf-worktree-isolation-plain-"));
  try {
    const response = await resolveConfigFrom(plain);

    assert.equal(response.workspaceRoot, canonical(plain));
    assert.equal(response.callerRoot, response.workspaceRoot);
    assert.equal(response.rootRedirected, false);
  } finally {
    rmSync(plain, { recursive: true, force: true });
  }
});

test("WF-495: describeCallerRoot is pure path identity — no Git call, no path parsing", () => {
  const layout = makeFleetLayout();
  try {
    const container = layout.container("aaa");
    mkdirSync(container);

    // Same directory in, same directory out: no redirection.
    assert.deepEqual(describeCallerRoot(container, canonical(container)), {
      callerRoot: canonical(container),
      rootRedirected: false,
    });
    // An enclosing root in: redirection, with the caller's own directory reported.
    assert.deepEqual(describeCallerRoot(container, canonical(layout.parent)), {
      callerRoot: canonical(container),
      rootRedirected: true,
    });
    // A directory that does not exist is rejected by the shared canonicalizer,
    // under the same `workspaceRoot` label request admission already uses.
    assert.throws(
      () => describeCallerRoot(join(container, "absent"), canonical(container)),
      /workspaceRoot does not exist/,
    );
  } finally {
    rmSync(layout.root, { recursive: true, force: true });
  }
});
