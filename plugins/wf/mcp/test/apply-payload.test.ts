// Apply-time payload composition and re-binding — contract tests (WF-456).
//
// `apply-install.test.ts` proves the SCREEN (which action kinds may reach the
// write half at all) and `apply-transaction.test.ts` proves the WRITE (journal,
// backup, rollback). What is only observable here is the step between them: the
// composer that takes an approved `payload-write` action and RE-DERIVES, under
// the lock, every fact the approval rested on.
//
// This file also closes WF-455's fourth warn — that the apply-time re-binding of
// a declared source had no direct test. The property is the same for a project
// override and a pack payload ("the plan is an approval, not evidence"), and it
// is stated here explicitly: each of the four re-derived facts is moved on its
// own, and each must independently refuse.
//
// Every test drives `composeApplyTargets`, which is deterministic and writes
// nothing — so "no byte moved" is proved by the function under test being
// structurally incapable of moving one, not by inspecting a filesystem
// afterwards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { ResolverService, type InspectPackResponse, type ResolverServicePorts } from "../src/service.js";
import type {
  ContainedFileFingerprintResult,
  PayloadSemantics,
  PlanAction,
  PlanInstallResponse,
  PlanPayloadAction,
  PlanRegistryEntry,
} from "../src/resolver/types.js";
import type { PayloadTargetResolution } from "../src/resolver/payload-plan.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";

const PLAN_ID = "d".repeat(64);
const ROOT = "/ws";
const DESTINATION = "_local/tooling/helper.mjs";
const CANONICAL = "/ws/_local/tooling/helper.mjs";
const BODY = "export const answer = 42;\n";
const SEMANTICS: PayloadSemantics = {
  production: "copy",
  refresh: "replace-if-unmodified",
  removal: "retain",
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const BODY_SHA = sha256(BODY);
const BODY_BYTES = Buffer.byteLength(BODY, "utf8");

interface Owner {
  pluginId: string;
  capability: string;
  source: string;
}

const ALPHA: Owner = { pluginId: "alpha@1.0.0", capability: "alpha", source: "payloads/helper.mjs" };
const BETA: Owner = { pluginId: "beta@1.0.0", capability: "beta", source: "payloads/helper.mjs" };

function capabilityRoot(owner: Owner): string {
  return `/packs/${owner.pluginId}/capabilities/${owner.capability}`;
}

/** One inspected pack per owner, each declaring the destination with the tuple
 *  it is given. The `semantics` override is what lets a test move ONE owner's
 *  declaration while leaving the other alone. */
function inspect(owners: readonly { owner: Owner; semantics?: PayloadSemantics }[]) {
  const map = new Map<string, InspectPackResponse>();
  for (const { owner, semantics } of owners) {
    map.set(owner.pluginId, {
      pluginId: owner.pluginId,
      pluginName: owner.pluginId,
      installed: true,
      enabled: true,
      version: "1.0.0",
      installPath: `/packs/${owner.pluginId}`,
      capabilities: [
        {
          name: owner.capability,
          path: `plugin:${owner.pluginId}/capabilities/${owner.capability}`,
          manifestPath: `${capabilityRoot(owner)}/manifest.md`,
          kind: "feature",
          questions: [],
          payloads: [
            {
              pluginId: owner.pluginId,
              capability: owner.capability,
              source: owner.source,
              destination: DESTINATION,
              ...(semantics ?? SEMANTICS),
            },
          ],
          payloadDiagnostics: [],
          questionDiagnostics: [],
        },
      ],
      portableEvidence: null,
      machineBinding: null,
      fingerprint: "f".repeat(64),
      valid: true,
      issues: [],
    });
  }
  return map;
}

function payloadAction(over: Partial<PlanPayloadAction> = {}): PlanPayloadAction {
  return {
    destination: DESTINATION,
    canonicalTarget: CANONICAL,
    identity: { sha256: BODY_SHA, bytes: BODY_BYTES },
    semantics: SEMANTICS,
    owners: [ALPHA],
    write: "create",
    ...over,
  };
}

function action(over: Partial<PlanAction> = {}): PlanAction {
  return {
    order: 0,
    kind: "payload-write",
    pluginId: ALPHA.pluginId,
    destination: DESTINATION,
    mutating: true,
    summary: "install the declared payload",
    persisted: false,
    ...over,
  };
}

/** A registry retention row for one pack. The mutator's declaring-capability
 *  precondition scopes its comparison to the packs the plan ACTED ON (WF-476),
 *  so a synthetic plan has to be able to say which those are. */
function retained(pluginId: string): PlanRegistryEntry {
  return {
    pluginId,
    pluginName: pluginId,
    capabilities: [],
    reason: "already-registered",
    presence: "installed",
    state: "enabled",
    enablement: "enabled",
    overlay: null,
  };
}

function plan(
  actions: PlanPayloadAction[],
  actedOn: readonly string[] = [],
): PlanInstallResponse {
  return {
    planVersion: 1,
    workspaceRoot: ROOT,
    admission: { admitted: true, root: ROOT, source: "explicit", reason: null, diagnostic: null },
    applicability: "applicable",
    mode: "install",
    registryDelta: { additions: [], retentions: actedOn.map(retained), deregistrations: [] },
    answers: { writes: [], unresolved: [] },
    evidenceSeeds: [],
    repairs: [],
    payloads: { actions, rejected: [], conflicts: [] },
    artifacts: { deletable: [], retained: [], bootstrap: [], advance: [] },
    actions: [action()],
    findings: [],
    applicabilityBasis: {
      applicability: "applicable",
      blockingFindings: [],
      blockingQuestions: [],
      blocked: false,
    },
    identity: { planId: PLAN_ID, algorithm: "sha256", coveredFactClasses: [], factCount: 0 },
    inventory: {
      confidence: "trustworthy",
      mayEstablishAbsence: true,
      observedCount: 1,
      issues: [],
    },
    recovery: noRecoveryReport(),
    byteInert: true,
  };
}

interface Scene {
  /** Raw bytes each capability-relative source currently observes as. A source
   *  absent from the map fingerprints as `missing`. */
  sources?: Map<string, string>;
  /** Current workspace bytes, keyed by absolute path. */
  files?: Map<string, string>;
  target?: PayloadTargetResolution;
}

/** A service whose ports answer only what the composer asks. Anything else
 *  throws, so a composer that grew a hidden dependency fails loudly rather than
 *  silently reading a stub. */
function service(scene: Scene = {}): ResolverService {
  const sources = scene.sources ?? new Map([[`${capabilityRoot(ALPHA)}/${ALPHA.source}`, BODY]]);
  const files = scene.files ?? new Map<string, string>();

  const ports = {
    workspaceRoot: ROOT,
    corePluginRoot: "/core/plugins/wf",
    resolveFresh: () => {
      throw new Error("the composer must not resolve a snapshot");
    },
    persist: () => {},
    readCache: () => null,
    readFile: (path: string) => files.get(path) ?? null,
    writeFile: () => {
      throw new Error("the composer must not write");
    },
    listDirs: () => [],
    listPlugins: () => ({ ok: false, plugins: [], issues: [], contractIssues: [] }),
    registryRelPath: () => "_local/config.md",
    fingerprintContainedFile: (
      root: string,
      relPath: string,
    ): ContainedFileFingerprintResult => {
      const body = sources.get(`${root}/${relPath}`);
      if (body === undefined) {
        return { status: "missing", path: null, sha256: null, bytes: null };
      }
      return {
        status: "ok",
        path: `${root}/${relPath}`,
        sha256: sha256(body),
        bytes: Buffer.byteLength(body, "utf8"),
      };
    },
    readContainedFile: (root: string, relPath: string) => {
      const body = sources.get(`${root}/${relPath}`);
      if (body === undefined) return { status: "missing", path: null, content: null };
      return { status: "ok", path: `${root}/${relPath}`, content: body };
    },
    resolvePayloadTarget: (): PayloadTargetResolution =>
      scene.target ?? { ok: true, canonicalTarget: CANONICAL, exists: false },
  } as unknown as ResolverServicePorts;

  return new ResolverService(ports);
}

type ComposeInput = Parameters<
  (ResolverService & {
    composeApplyTargets: (input: never) => never;
  })["composeApplyTargets"]
>[0];

type ComposeResult =
  | {
      ok: true;
      targets: { destination: string; newContent: string }[];
      payloadsRecorded: {
        destination: string;
        sha256: string;
        owners: { pluginId: string; capability: string; source: string }[];
      }[];
    }
  | { ok: false; reason: string; detail: string };

/** The composer is private by design — it is an internal step of `applyInstall`,
 *  not a second public mutator. Reaching it directly is deliberate here: these
 *  are white-box contract tests of exactly that step. */
function compose(
  svc: ResolverService,
  input: {
    plan: PlanInstallResponse;
    inspected: Map<string, InspectPackResponse>;
    supported: PlanAction[];
  },
): ComposeResult {
  const reach = svc as unknown as {
    composeApplyTargets: (arg: unknown) => ComposeResult;
  };
  return reach.composeApplyTargets({
    ...input,
    admittedRoot: ROOT,
    registryRel: "_local/config.md",
    registryContent: "# Config\n",
    registryChanged: false,
    // The WF-458 authorized sets. Empty here on purpose: these are the PAYLOAD
    // contract tests, and a payload compose that starts emitting removals because
    // the destructive sets defaulted would be exactly the silent widening the
    // whole-plan gate exists to prevent.
    removals: [],
    bootstraps: [],
    legacy: [],
    // The WF-459 authorized sets, empty for exactly the same reason: a payload
    // compose that started upgrading artifacts or rewriting evidence because a
    // constructive set defaulted would be the same silent widening from the other
    // direction. Stated rather than defaulted, so a future axis cannot arrive
    // here as an implicit empty.
    advances: [],
    repairs: [],
  } satisfies Record<string, unknown> as unknown as ComposeInput);
}

// ---------------------------------------------------------------------------
// The happy path — SC-2 and SC-3
// ---------------------------------------------------------------------------

test("an approved payload composes its target AND its complete ownership record", () => {
  const result = compose(service(), {
    plan: plan([payloadAction()]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action()],
  });

  assert.ok(result.ok, result.ok ? "" : result.detail);
  const payload = result.targets.find((t) => t.destination === DESTINATION);
  assert.ok(payload, "the payload destination must be composed as a target");
  assert.equal(payload.newContent, BODY, "the target carries the approved source bytes");

  // The ledger's artifact record rides in the SAME transaction — the proof and
  // the file it describes are never written apart.
  const ledger = result.targets.find((t) => t.destination === ".wf/install-state.json");
  assert.ok(ledger, "the ownership record must be composed alongside the payload");
  const parsed = JSON.parse(ledger.newContent) as {
    artifacts: Record<string, { owners: unknown[]; producedContentHash: string; removal: string }>;
  };
  const record = parsed.artifacts[DESTINATION];
  assert.ok(record, "the ledger must carry an artifacts entry for the destination");
  assert.equal(record.producedContentHash, BODY_SHA);
  assert.equal(record.removal, "retain");
  assert.deepEqual(record.owners, [ALPHA]);

  assert.deepEqual(result.payloadsRecorded, [
    { destination: DESTINATION, sha256: BODY_SHA, owners: [ALPHA] },
  ]);
});

test("SC-3: a co-owned target records EVERY owner, not the first one", () => {
  // The whole point of the recorded set. A later removal decision reads it to
  // establish exclusivity, so "alpha only" would license deleting a file beta
  // still declares.
  const sources = new Map([
    [`${capabilityRoot(ALPHA)}/${ALPHA.source}`, BODY],
    [`${capabilityRoot(BETA)}/${BETA.source}`, BODY],
  ]);
  const result = compose(service({ sources }), {
    plan: plan([payloadAction({ owners: [ALPHA, BETA] })]),
    inspected: inspect([{ owner: ALPHA }, { owner: BETA }]),
    supported: [action()],
  });

  assert.ok(result.ok, result.ok ? "" : result.detail);
  assert.deepEqual(result.payloadsRecorded[0].owners, [ALPHA, BETA]);
});

test("an unchanged payload composes NO target — the second apply is a genuine no-op", () => {
  // WF-454 defect class B, restated for this artifact class. A destination that
  // already holds the approved bytes is not a target, so the transaction never
  // journals, backs up, or rewrites it.
  const files = new Map([[`${ROOT}/${DESTINATION}`, BODY]]);
  const result = compose(service({ files }), {
    plan: plan([payloadAction({ write: "overwrite" })]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action()],
  });

  // The ledger record is still composed (the proof did not exist yet), but the
  // payload path itself is absent from the target set.
  assert.ok(result.ok, result.ok ? "" : result.detail);
  assert.equal(
    result.targets.some((t) => t.destination === DESTINATION),
    false,
    "a payload whose bytes already match must not be rewritten",
  );
  // It is still ASSERTED against: the end state is "holds the approved bytes",
  // which a dropped target satisfies and must still be checked for.
  assert.deepEqual(result.payloadsRecorded[0].sha256, BODY_SHA);
});

// ---------------------------------------------------------------------------
// The four re-derived facts — each moved on its own (WF-455 warn 4)
// ---------------------------------------------------------------------------

test("RE-BINDING 1/4: a source edited between plan and apply refuses, and nothing is written", () => {
  const sources = new Map([[`${capabilityRoot(ALPHA)}/${ALPHA.source}`, "export const answer = 43;\n"]]);
  const result = compose(service({ sources }), {
    plan: plan([payloadAction()]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action()],
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "apply/payload-precondition");
  assert.ok(!result.ok && result.detail.includes("no longer reproduces the approved bytes"));
});

test("RE-BINDING 2/4: a destination that no longer resolves contained refuses by its own token", () => {
  for (const rejection of [
    "traversal",
    "absolute",
    "symlink-escape",
    "out-of-workspace",
    "target-not-a-file",
    "unresolvable",
  ] as const) {
    const result = compose(service({ target: { ok: false, rejection } }), {
      plan: plan([payloadAction()]),
      inspected: inspect([{ owner: ALPHA }]),
      supported: [action()],
    });
    assert.equal(result.ok, false, `\`${rejection}\` must refuse`);
    assert.ok(!result.ok && result.reason === "apply/payload-precondition");
    // The PRECISE class, never a plausible neighbour: a maintainer chasing a
    // symlink escape would never look for it under a generic "not contained".
    assert.ok(!result.ok && result.detail.includes(rejection));
  }
});

test("RE-BINDING 2/4b: a destination that now canonicalizes elsewhere refuses", () => {
  const result = compose(
    service({ target: { ok: true, canonicalTarget: "/ws/somewhere/else.mjs", exists: false } }),
    {
      plan: plan([payloadAction()]),
      inspected: inspect([{ owner: ALPHA }]),
      supported: [action()],
    },
  );
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("canonicalizes to a different target"));
});

test("RE-BINDING 3/4: a tuple that diverged on ONE field refuses — bytes are not enough", () => {
  // The two axes are independent (WF-448). These owners still agree byte-for-byte
  // and would pass an identity-only check; they have diverged on removal policy,
  // which is precisely the difference that must block.
  const sources = new Map([
    [`${capabilityRoot(ALPHA)}/${ALPHA.source}`, BODY],
    [`${capabilityRoot(BETA)}/${BETA.source}`, BODY],
  ]);
  const result = compose(service({ sources }), {
    plan: plan([payloadAction({ owners: [ALPHA, BETA] })]),
    inspected: inspect([
      { owner: ALPHA },
      { owner: BETA, semantics: { ...SEMANTICS, removal: "delete-if-unmodified" } },
    ]),
    supported: [action()],
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "apply/payload-precondition");
  assert.ok(!result.ok && result.detail.includes("generation/refresh/removal tuple"));
});

test("RE-BINDING 4/4: an owner that APPEARED since the plan refuses rather than recording a stale set", () => {
  // The fail-safe direction. Recording alpha's set while beta also declares the
  // destination would be recording an INCOMPLETE owner set — the exact defect the
  // self-check's owner assertion exists to catch, caught here instead, before any
  // write.
  //
  // Beta is SELECTED by this plan (it is in the registry delta) and picked up a
  // declaration the approval never listed: a genuine mid-flight pack edit, which
  // WF-476's narrowing deliberately leaves refusing.
  const sources = new Map([
    [`${capabilityRoot(ALPHA)}/${ALPHA.source}`, BODY],
    [`${capabilityRoot(BETA)}/${BETA.source}`, BODY],
  ]);
  const result = compose(service({ sources }), {
    plan: plan([payloadAction({ owners: [ALPHA] })], [ALPHA.pluginId, BETA.pluginId]),
    inspected: inspect([{ owner: ALPHA }, { owner: BETA }]),
    supported: [action()],
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("has changed since the plan was approved"));
});

test("RE-BINDING 4/4c: an UNSELECTED co-declarer does not refuse an ordinary install", () => {
  // WF-476 F-4, at the unit level. Beta is installed and co-declares the
  // destination, but this plan does not act on it — so it was never in the scope
  // the approved owner set was built from, and comparing against it compares two
  // differently-scoped sets. The install proceeds; only the SELECTED packs are
  // held to the approval.
  const sources = new Map([
    [`${capabilityRoot(ALPHA)}/${ALPHA.source}`, BODY],
    [`${capabilityRoot(BETA)}/${BETA.source}`, BODY],
  ]);
  const result = compose(service({ sources }), {
    plan: plan([payloadAction({ owners: [ALPHA] })], [ALPHA.pluginId]),
    inspected: inspect([{ owner: ALPHA }, { owner: BETA }]),
    supported: [action()],
  });

  assert.equal(result.ok, true, !result.ok ? result.detail : "");
});

test("RE-BINDING 4/4b: an owner that VANISHED since the plan refuses too", () => {
  const result = compose(service(), {
    plan: plan([payloadAction({ owners: [ALPHA, BETA] })]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action()],
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("has changed since the plan was approved"));
});

// ---------------------------------------------------------------------------
// Binding to the approved plan — SC-5's "executes only canonical decisions"
// ---------------------------------------------------------------------------

test("a payload action the approved plan never previewed refuses", () => {
  const result = compose(service(), {
    plan: plan([]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action()],
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("0 previewed payload action"));
});

test("two previewed actions for one destination refuse rather than picking one", () => {
  // There is deliberately no first-writer rule and no tiebreak anywhere in this
  // slice; an ambiguous approval is not something the mutator may resolve.
  const result = compose(service(), {
    plan: plan([payloadAction(), payloadAction()]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action()],
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("2 previewed payload action"));
});

test("a payload aimed at the committed project-override tier refuses — the classes stay separate", () => {
  // WF-444's authority test is two-part: lifecycle ownership PLUS a declared
  // artifact class. The override tier has its own class and its own action kind,
  // and a payload must not reach it through the payload path.
  const destination = ".wf/slots/ship.review.md";
  const result = compose(service(), {
    plan: plan([payloadAction({ destination, canonicalTarget: `${ROOT}/${destination}` })]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action({ destination })],
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "apply/payload-precondition");
  assert.ok(!result.ok && result.detail.includes("committed project-override artifact"));
});

test("a payload action carrying no destination refuses", () => {
  const result = compose(service(), {
    plan: plan([payloadAction()]),
    inspected: inspect([{ owner: ALPHA }]),
    supported: [action({ destination: null })],
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.detail.includes("carries no destination"));
});

// ---------------------------------------------------------------------------
// SC-1 — bare core with zero selected packs
// ---------------------------------------------------------------------------

test("SC-1: with no selected pack there is no payload target, no record, and no directory", () => {
  // The requirement is ABSENCE, not conditionality. With nothing selected the
  // composer produces no payload target, no `artifacts` ledger section, and
  // therefore nothing that could create `_local/tooling/` — the plan refuses as
  // not-applicable because it would change nothing at all.
  const result = compose(service(), {
    plan: plan([]),
    inspected: new Map(),
    supported: [],
  });

  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason === "apply/plan-not-applicable");
});

test("SC-1b: a selection carrying only a registry change writes no artifacts section at all", () => {
  const reach = service() as unknown as {
    composeApplyTargets: (arg: unknown) => ComposeResult;
  };
  const result = reach.composeApplyTargets({
    plan: plan([]),
    inspected: new Map(),
    supported: [],
    admittedRoot: ROOT,
    registryRel: "_local/config.md",
    registryContent: "# Config\n\n## Capabilities\n",
    registryChanged: true,
    removals: [],
    bootstraps: [],
    legacy: [],
    advances: [],
    repairs: [],
  });

  assert.ok(result.ok, result.ok ? "" : result.detail);
  assert.deepEqual(
    result.targets.map((t) => t.destination),
    ["_local/config.md"],
    "only the registry is written; no ledger, no payload, no scaffolding",
  );
  assert.deepEqual(result.payloadsRecorded, []);
});
