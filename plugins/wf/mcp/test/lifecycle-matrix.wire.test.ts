// WF-466 — the wire-layer companion to the lifecycle matrix.
//
// The matrix itself is driven at the SERVICE layer, for a reason recorded in the
// spec: `discoverPacksWithInspection` sources its inventory from
// `ports.listPlugins()` (`src/service.ts:1506`), whose production implementation
// shells out to the Claude CLI (`src/ports.ts:287-300`), so a fixture pack is
// discoverable over the wire only if it is installed in the host's real CLI
// inventory. Fake packs are not, and never should be.
//
// That leaves one obligation this file discharges: proving the service layer the
// matrix drives is the SAME surface the wire exposes, so 37 service-layer
// scenarios are not 37 proofs about a private back door. The claim is PARITY —
// for one representative journey, the wire's envelopes and the direct service's
// envelopes agree fact for fact, including the plan identity.
//
// It also pins the surface itself. The briefing's third environmental fact is
// that an older installed build exposes none of the lifecycle tools, so a matrix
// run against the wrong build would measure nothing; `tools/list` is asserted
// here rather than assumed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { normalizeSlashes } from "../src/resolver/paths.js";
import { registerResolverTools } from "../src/tools.js";
import {
  BETA_DESTINATION,
  SHARED_DESTINATION,
  makeMatrixWorkspace,
  qualifiedId,
  type MatrixWorkspace,
} from "./lifecycle-matrix.fixtures.js";

/** The four tools the whole lifecycle rides on. A build missing any one of them
 *  cannot run this matrix at all — which is precisely how a run can look green
 *  while measuring nothing. */
const LIFECYCLE_TOOLS = ["discover_packs", "plan_install", "apply_install", "repair_packs"];

interface WireClient {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
  /** Roots the dispatcher was asked to resolve, in order. */
  readonly requestedRoots: string[];
  close(): Promise<void>;
}

async function connect(ws: MatrixWorkspace): Promise<WireClient> {
  const requestedRoots: string[] = [];
  const server = new McpServer(
    { name: "wf-resolver-wf466", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  registerResolverTools(server, (requestedRoot: string) => {
    requestedRoots.push(normalizeSlashes(requestedRoot));
    return ws.service;
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const waiters = new Map<string, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if (!("id" in message)) return;
    const waiter = waiters.get(String(message.id));
    if (!waiter) return;
    waiters.delete(String(message.id));
    waiter(message);
  };

  let nextId = 1;
  const request = async (
    method: string,
    params: Record<string, unknown>,
  ): Promise<JSONRPCMessage> => {
    const id = nextId++;
    const response = new Promise<JSONRPCMessage>((resolveMessage, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`timed out waiting for MCP response ${id}`)),
        5_000,
      );
      waiters.set(String(id), (message) => {
        clearTimeout(timeout);
        resolveMessage(message);
      });
    });
    await clientTransport.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
    return response;
  };

  await server.connect(serverTransport);
  await clientTransport.start();
  const initialized = await request("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "wf466-wire", version: "0.0.0" },
  });
  assert.ok("result" in initialized, "the server must initialize");
  await clientTransport.send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  } as JSONRPCMessage);

  return {
    requestedRoots,
    async call(name, args) {
      const message = await request(
        name === "tools/list" ? "tools/list" : "tools/call",
        name === "tools/list" ? {} : { name, arguments: args },
      );
      assert.ok("result" in message, `${name} must return a JSON-RPC result`);
      const result = (message as { result: unknown }).result;
      if (name === "tools/list") return result;
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
      const text = content?.find((entry) => entry.type === "text")?.text;
      assert.equal(typeof text, "string", `${name} must return a text payload`);
      return JSON.parse(text as string);
    },
    async close() {
      await server.close();
    },
  };
}

async function withWire(body: (ws: MatrixWorkspace, wire: WireClient) => Promise<void>) {
  const ws = makeMatrixWorkspace({ packs: ["alpha", "beta", "gamma"] });
  assert.notEqual(
    ws.workspace,
    normalizeSlashes(process.cwd()),
    "the wire journey must also run off the cwd",
  );
  const wire = await connect(ws);
  try {
    await body(ws, wire);
  } finally {
    await wire.close();
    rmSync(ws.root, { recursive: true, force: true });
  }
}

test("W-1: THIS build exposes the four lifecycle tools over the wire", async () => {
  await withWire(async (_ws, wire) => {
    const listed = (await wire.call("tools/list", {})) as { tools: Array<{ name: string }> };
    const names = listed.tools.map((tool) => tool.name);
    for (const expected of LIFECYCLE_TOOLS) {
      assert.ok(names.includes(expected), `the build under test does not expose \`${expected}\``);
    }
    // The surface assertion is only worth making if it could fail: a build with
    // no tools at all, or a stub list, must not satisfy it.
    assert.ok(names.length > LIFECYCLE_TOOLS.length, "the tool list looks like a stub");
  });
});

test("W-2: the wire and the service agree fact for fact on the same non-cwd root", async () => {
  await withWire(async (ws, wire) => {
    const selection = {
      desired: [qualifiedId("alpha"), qualifiedId("beta"), qualifiedId("gamma")],
      deregister: [] as string[],
      answers: [{ pluginId: qualifiedId("beta"), questionId: "beta-mode", value: "safe" }],
    };

    // PLAN — over the wire, then directly. Planning is byte-inert on both paths,
    // so running it twice is legitimate and the two must be identical.
    const wirePlan = (await wire.call("plan_install", {
      workspaceRoot: ws.workspace,
      ...selection,
    })) as Record<string, unknown>;
    const directPlan = ws.service.planInstall(ws.admission, selection);

    // The plan identity is the sharpest single fact: a SHA-256 over 16 fact
    // classes. Equal ids mean the two paths saw the same world.
    assert.equal(
      (wirePlan.identity as { planId: string }).planId,
      directPlan.identity.planId,
      "the wire and the service disagree about the plan",
    );
    assert.equal(wirePlan.applicability, directPlan.applicability);
    assert.equal(wirePlan.byteInert, true);
    assert.deepEqual(
      (wirePlan.actions as Array<{ kind: string; destination: string | null }>).map(
        (action) => `${action.kind}:${action.destination}`,
      ),
      directPlan.actions.map((action) => `${action.kind}:${action.destination}`),
    );

    // The dispatcher really was asked for the non-cwd root, by that exact name.
    assert.ok(wire.requestedRoots.length > 0, "no root was resolved");
    for (const root of wire.requestedRoots) {
      assert.equal(root, ws.workspace, "the wire resolved a root other than the one requested");
    }

    // APPLY — over the wire. This is the one call that may not be duplicated, so
    // the wire performs it and the service observes the result.
    const applied = (await wire.call("apply_install", {
      workspaceRoot: ws.workspace,
      ...selection,
      expectedPlanId: directPlan.identity.planId,
    })) as {
      status: string;
      applied: Array<{ destination: string | null }>;
      residue: { clean: boolean; detail: string };
    };
    assert.equal(applied.status, "applied", "the wire journey did not complete");
    assert.equal(applied.residue.clean, true, applied.residue.detail);
    const touched = applied.applied.map((entry) => entry.destination);
    for (const destination of [BETA_DESTINATION, SHARED_DESTINATION]) {
      assert.ok(touched.includes(destination), `${destination} was not written over the wire`);
    }

    // And the service, reading the same root afterwards, sees the wire's work —
    // one world, two doors.
    const registry = ws.service.resolveRegistry();
    assert.deepEqual(
      registry.capabilities.map((capability) => capability.name),
      ["alpha", "beta", "gamma"],
    );
  });
});

test("W-3: `repair_packs` and `plan_install` agree across the wire boundary too", async () => {
  await withWire(async (ws, wire) => {
    const wireRepair = (await wire.call("repair_packs", {
      workspaceRoot: ws.workspace,
    })) as { plan: { identity: { planId: string }; applicability: string; byteInert: boolean } };
    const directRepair = ws.service.repairPacks(ws.admission);

    assert.equal(wireRepair.plan.identity.planId, directRepair.plan.identity.planId);
    assert.equal(wireRepair.plan.applicability, directRepair.plan.applicability);
    assert.equal(wireRepair.plan.byteInert, true);

    // A discovery read agrees on the pack set and on the inventory verdict, so
    // the matrix's G1 conjuncts mean the same thing on both paths.
    const wireDiscovery = (await wire.call("discover_packs", {
      workspaceRoot: ws.workspace,
    })) as {
      packs: Array<{ pluginId: string; presence: string }>;
      inventory: { confidence: string };
    };
    const directDiscovery = ws.service.discoverPacks();
    assert.equal(wireDiscovery.inventory.confidence, directDiscovery.inventory.confidence);
    assert.deepEqual(
      wireDiscovery.packs.map((pack) => `${pack.pluginId}:${pack.presence}`),
      directDiscovery.packs.map((pack) => `${pack.pluginId}:${pack.presence}`),
    );
  });
});
