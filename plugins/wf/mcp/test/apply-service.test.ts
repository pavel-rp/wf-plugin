// `applyInstall`'s guarded entry — service-level contract tests (WF-453).
//
// The gate's decision table lives in `apply-install.test.ts` and the transaction
// in `apply-transaction.test.ts`. What is only observable HERE is the ORDER the
// service imposes before either of them runs: admit, then recover, then lock,
// then revalidate. Each test below stops the run at one of those steps and
// asserts that nothing further was reached — no snapshot resolved, no plan
// computed, no registry read, and no byte written.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import type { RecoveryPorts } from "../src/resolver/lifecycle-recovery.js";
import type { PlanAdmissionState } from "../src/resolver/types.js";

const PLAN_ID = "e".repeat(64);

const ADMITTED: PlanAdmissionState = {
  admitted: true,
  root: "/ws",
  source: "explicit",
  reason: null,
  diagnostic: null,
};

const INADMISSIBLE: PlanAdmissionState = {
  admitted: false,
  root: null,
  source: "explicit",
  reason: "not-found",
  diagnostic: "explicit workspace root does not exist.",
};

const SELECTION = { desired: [], deregister: [], answers: [] };

interface Counts {
  resolveFresh: number;
  writeFile: number;
  readFile: number;
  registryRelPath: number;
  createApply: number;
  acquire: number;
  release: number;
}

/** A ports double that FAILS LOUDLY on anything the guarded prefix must not
 *  reach. Every path under test stops before the planner, so a call to
 *  `resolveFresh` or `writeFile` here is the defect, not a missing stub. */
function makePorts(over: { recovery?: RecoveryPorts | undefined } = {}): {
  ports: ResolverServicePorts;
  counts: Counts;
} {
  const counts: Counts = {
    resolveFresh: 0,
    writeFile: 0,
    readFile: 0,
    registryRelPath: 0,
    createApply: 0,
    acquire: 0,
    release: 0,
  };
  const ports = {
    workspaceRoot: "/ws",
    corePluginRoot: "/core/plugins/wf",
    resolveFresh: () => {
      counts.resolveFresh++;
      throw new Error("the guarded prefix must not resolve a snapshot");
    },
    persist: () => {},
    readCache: () => null,
    readFile: () => {
      counts.readFile++;
      return null;
    },
    writeFile: () => {
      counts.writeFile++;
      throw new Error("the guarded prefix must not write");
    },
    listDirs: () => [],
    listPlugins: () => ({ ok: false, plugins: [], issues: [], contractIssues: [] }),
    registryRelPath: () => {
      counts.registryRelPath++;
      return "_local/config.md";
    },
    createApply: () => {
      counts.createApply++;
      throw new Error("the guarded prefix must not build apply ports");
    },
    recovery: over.recovery,
  } as unknown as ResolverServicePorts;
  return { ports, counts };
}

/** Recovery ports whose lock outcome is scripted per acquisition. `null` in the
 *  script means "granted"; a string means refused with that reason. */
function scriptedRecovery(
  counts: Counts,
  script: Array<null | "held-by-other" | "unavailable">,
): RecoveryPorts {
  let index = 0;
  return {
    acquireLock: () => {
      counts.acquire++;
      const outcome = script[index++] ?? null;
      if (outcome === null) return { ok: true };
      return { ok: false, reason: outcome, diagnostic: `the lock is ${outcome}.` };
    },
    releaseLock: () => {
      counts.release++;
    },
    readJournal: () => null,
    observeDestination: () => ({ kind: "absent" }),
    hashBackup: () => ({ ok: false, reason: "missing", diagnostic: "no backup" }),
    restoreBytes: () => ({ ok: true }),
    removeDestination: () => ({ ok: true }),
    discardJournal: () => {},
  };
}

test("an inadmissible root returns the typed invalid-root envelope and reaches nothing", () => {
  const { ports, counts } = makePorts();
  const out = new ResolverService(ports).applyInstall(INADMISSIBLE, SELECTION, PLAN_ID);

  assert.equal(out.status, "invalid-root");
  assert.equal(out.reason, "apply/invalid-root");
  assert.equal(out.workspaceRoot, null);
  assert.equal(out.transactionId, null, "no transaction was created");
  assert.deepEqual(out.applied, []);
  assert.equal(out.selfCheck, "skipped");
  assert.equal(out.refreshed, false);
  assert.equal(out.residue.clean, true);
  assert.equal(out.plan.matched, false);
  assert.equal(out.plan.expectedPlanId, PLAN_ID);
  assert.equal(counts.resolveFresh, 0);
  assert.equal(counts.writeFile, 0);
  assert.equal(counts.acquire, 0, "an inadmissible root never takes the lock");
});

test("with no lock primitive available the mutator REFUSES rather than mutating unserialized", () => {
  const { ports, counts } = makePorts({ recovery: undefined });
  const out = new ResolverService(ports).applyInstall(ADMITTED, SELECTION, PLAN_ID);

  assert.equal(out.status, "halted");
  assert.equal(out.reason, "apply/lock-unavailable");
  assert.equal(out.transactionId, null);
  assert.deepEqual(out.applied, []);
  assert.equal(counts.resolveFresh, 0, "no plan was computed");
  assert.equal(counts.writeFile, 0);
  assert.ok(out.diagnostics.some((d) => d.code === "apply-lock-unavailable"));
});

test("an unresolved pre-entry recovery HALTS before the lock, and is reported SEPARATELY", () => {
  // The recovery driver's own lock acquisition is refused, so recovery reports
  // `lock-unavailable` and does not proceed. That is a fact about the workspace,
  // carried in `recovery`, never folded into `status`.
  const { ports, counts } = makePorts();
  const withRecovery = {
    ...(ports as unknown as Record<string, unknown>),
    recovery: scriptedRecovery(counts, ["held-by-other"]),
  } as unknown as ResolverServicePorts;

  const out = new ResolverService(withRecovery).applyInstall(ADMITTED, SELECTION, PLAN_ID);

  assert.equal(out.status, "halted");
  assert.equal(out.reason, "apply/halted-unrecovered");
  assert.equal(out.recovery.proceeded, false);
  assert.equal(out.recovery.state, "lock-unavailable");
  assert.equal(out.transactionId, null);
  assert.deepEqual(out.applied, []);
  assert.equal(counts.resolveFresh, 0, "no plan was computed over an unrecovered workspace");
  assert.equal(counts.writeFile, 0);
});

test("CONCURRENT LIFECYCLE ENTRY is rejected when the apply lock is already held", () => {
  // Recovery takes and releases the lock first; the apply lock is the SECOND
  // acquisition, and it is the one refused here.
  const { ports, counts } = makePorts();
  const withRecovery = {
    ...(ports as unknown as Record<string, unknown>),
    recovery: scriptedRecovery(counts, [null, "held-by-other"]),
  } as unknown as ResolverServicePorts;

  const out = new ResolverService(withRecovery).applyInstall(ADMITTED, SELECTION, PLAN_ID);

  assert.equal(out.status, "rejected");
  assert.equal(out.reason, "apply/lock-held");
  assert.equal(out.recovery.proceeded, true, "recovery itself completed");
  assert.equal(out.transactionId, null, "no transaction was created");
  assert.deepEqual(out.applied, []);
  assert.equal(out.residue.clean, true);
  assert.equal(counts.resolveFresh, 0, "the plan is recomputed only UNDER the lock");
  assert.equal(counts.writeFile, 0);
  assert.equal(counts.createApply, 0);
  assert.ok(out.diagnostics.some((d) => d.code === "apply-lock-held-by-other"));
});

test("an unavailable apply lock is reported as its own class, not as a concurrent holder", () => {
  const { ports, counts } = makePorts();
  const withRecovery = {
    ...(ports as unknown as Record<string, unknown>),
    recovery: scriptedRecovery(counts, [null, "unavailable"]),
  } as unknown as ResolverServicePorts;

  const out = new ResolverService(withRecovery).applyInstall(ADMITTED, SELECTION, PLAN_ID);
  assert.equal(out.status, "rejected");
  assert.equal(out.reason, "apply/lock-unavailable");
  assert.equal(counts.writeFile, 0);
});

async function registerTools(selector: (root: string) => ResolverService) {
  const { McpServer } = await import("@modelcontextprotocol/server");
  const { registerResolverTools } = await import("../src/tools.js");
  const registered = new Map<
    string,
    { config: { _meta?: Record<string, unknown> }; handler: (args: never) => Promise<unknown> }
  >();
  const server = {
    registerTool(
      name: string,
      config: { _meta?: Record<string, unknown> },
      handler: (args: never) => Promise<unknown>,
    ) {
      registered.set(name, { config, handler });
    },
  } as unknown as InstanceType<typeof McpServer>;
  registerResolverTools(server, selector);
  return registered;
}

test("`apply_install` is registered on the tool surface without the alwaysLoad marker", async () => {
  const { ports } = makePorts();
  const registered = await registerTools(() => new ResolverService(ports));

  const tool = registered.get("apply_install");
  assert.ok(tool !== undefined, "`apply_install` must be registered");
  assert.equal(
    tool.config._meta?.["anthropic/alwaysLoad"],
    undefined,
    "the mutator defers behind tool search like every other non-gating op",
  );
  // Guard the comparison itself: a resident tool DOES carry the marker.
  assert.equal(registered.get("resolve_config")?.config._meta?.["anthropic/alwaysLoad"], true);
});

test("the tool returns the invalid-root ENVELOPE for a blank declaration, not an MCP error", async () => {
  const registered = await registerTools(() => {
    throw new Error("selectService must never be reached for an invalid declaration");
  });
  const apply = registered.get("apply_install");
  assert.ok(apply);

  const result = (await apply.handler({
    workspaceRoot: "   ",
    expectedPlanId: PLAN_ID,
  } as never)) as { isError?: boolean; structuredContent?: Record<string, unknown> };

  assert.notEqual(result.isError, true, "an inadmissible root is an envelope, not an error result");
  assert.equal(result.structuredContent?.status, "invalid-root");
  assert.equal(result.structuredContent?.reason, "apply/invalid-root");
  assert.equal(result.structuredContent?.transactionId, null);
  assert.deepEqual(result.structuredContent?.applied, []);
  assert.equal(
    (result.structuredContent?.admission as { reason?: string })?.reason,
    "declaration-empty",
  );
  assert.equal(
    (result.structuredContent?.residue as { clean?: boolean })?.clean,
    true,
    "no transaction state was created",
  );
});
