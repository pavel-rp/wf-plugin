// Selected-set planning contract tests (WF-447).
//
// Two layers, mirroring the discovery suite:
//   - the PURE JOIN (`planInstall`) is driven directly, because every
//     classification rule, applicability token, and ordering rule is a property
//     of that function and needs no filesystem, CLI, or snapshot;
//   - the SERVICE and TOOL surfaces are driven over the in-memory ports double
//     and a registration double, because byte-inertness and the typed
//     invalid-root envelope are properties of the WIRING.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  planInstall,
  type PlanCapabilityInput,
  type PlanInstallInput,
} from "../src/resolver/plan-install.js";
import { createDefaultPorts } from "../src/ports.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";
import {
  normalizeSlashes,
  resolveContainedCapabilityPath,
} from "../src/resolver/paths.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { sha256Hex } from "../src/resolver/fingerprint.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import {
  PLAN_ENVELOPE_VERSION,
  RESOLVER_GENERATOR,
  type DiscoveredPack,
  type DiscoveryInventory,
  type MachineBindingEvidence,
  type PlanAdmissionState,
  type PortablePackEvidence,
  type QuestionRecord,
  type ResolverSnapshot,
} from "../src/resolver/types.js";

// --- fixtures ---------------------------------------------------------------

const ADMITTED: PlanAdmissionState = {
  admitted: true,
  root: "/ws",
  source: "explicit",
  reason: null,
  diagnostic: null,
};

const TRUSTWORTHY: DiscoveryInventory = {
  confidence: "trustworthy",
  mayEstablishAbsence: true,
  observedCount: 1,
  issues: [],
};

function portable(over: Partial<PortablePackEvidence> = {}): PortablePackEvidence {
  return {
    pluginId: "wf-demo@local",
    version: "1.0.0",
    capabilities: ["demo"],
    manifestHashes: [{ path: "capabilities/demo/manifest.md", sha256: "a".repeat(64) }],
    declaredSourceHashes: [],
    ...over,
  };
}

function binding(over: Partial<MachineBindingEvidence> = {}): MachineBindingEvidence {
  return {
    pluginId: "wf-demo@local",
    canonicalRoot: "/ws/packs/wf-demo",
    cliScope: "user",
    enablement: "enabled",
    observedVersion: "1.0.0",
    localFingerprints: [],
    ...over,
  };
}

function question(over: Partial<QuestionRecord> = {}): QuestionRecord {
  return {
    pack: "demo",
    id: "team",
    destination: "team",
    prompt: "Which team owns this project?",
    schema: { type: "string", minLength: 1, maxLength: 64 },
    state: { status: "unresolved", source: null, value: null, suggestions: [] },
    ...over,
  };
}

/** A discovered pack. `evidence.comparison` defaults to `equal` so a test that
 *  is not about evidence never accidentally trips the legacy-proof gate. */
function pack(over: Partial<DiscoveredPack> = {}): DiscoveredPack {
  return {
    pluginId: "wf-demo@local",
    pluginName: "wf-demo",
    version: "1.0.0",
    scope: "user",
    enablement: "enabled",
    installPath: "/ws/packs/wf-demo",
    state: "active",
    registeredCapabilities: ["demo"],
    diagnostics: null,
    overlay: null,
    presence: "installed",
    evidence: { comparison: "equal", portable: portable(), binding: binding() },
    seedProposal: null,
    questions: [],
    selectable: true,
    ...over,
  };
}

function capability(over: Partial<PlanCapabilityInput> = {}): PlanCapabilityInput {
  return {
    pluginId: "wf-demo@local",
    name: "demo",
    requires: [],
    conflicts: [],
    providerScopes: [],
    ...over,
  };
}

function input(over: Partial<PlanInstallInput> = {}): PlanInstallInput {
  return {
    admission: ADMITTED,
    inventory: TRUSTWORTHY,
    packs: [pack()],
    capabilities: [capability()],
    selection: { desired: [], deregister: [], answers: [] },
    // WF-452: stated explicitly, never defaulted. `noRecoveryReport()` is the
    // byte-inert, non-blocking "this caller performs no recovery" report, so
    // every pre-existing planning property is asserted against exactly the
    // behaviour it had before the retrofit.
    recovery: noRecoveryReport(),
    ...over,
  };
}

const codes = (out: { findings: Array<{ code: string }> }): string[] =>
  out.findings.map((f) => f.code);

// --- SC1: an explicit desired set produces an ordered delta, without writes ---

test("an explicit desired set produces ordered additions, retentions, and deregistrations", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "z-new@local", pluginName: "z-new", state: "installed/inactive", registeredCapabilities: [] }),
        pack({ pluginId: "a-new@local", pluginName: "a-new", state: "installed/inactive", registeredCapabilities: [] }),
        pack({ pluginId: "keep@local", pluginName: "keep", registeredCapabilities: ["keep"] }),
        pack({ pluginId: "drop@local", pluginName: "drop", registeredCapabilities: ["drop"] }),
      ],
      capabilities: [
        capability({ pluginId: "z-new@local", name: "znew" }),
        capability({ pluginId: "a-new@local", name: "anew" }),
        capability({ pluginId: "keep@local", name: "keep" }),
        capability({ pluginId: "drop@local", name: "drop" }),
      ],
      selection: {
        desired: ["z-new@local", "a-new@local", "keep@local"],
        deregister: ["drop@local"],
        answers: [],
      },
    }),
  );

  assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION);
  assert.equal(out.byteInert, true);
  assert.deepEqual(
    out.registryDelta.additions.map((e) => e.pluginId),
    ["a-new@local", "z-new@local"],
    "additions sort by ascending pluginId",
  );
  assert.deepEqual(out.registryDelta.additions.map((e) => e.reason), [
    "selected-addition",
    "selected-addition",
  ]);
  assert.deepEqual(out.registryDelta.retentions.map((e) => e.pluginId), ["keep@local"]);
  assert.equal(out.registryDelta.retentions[0].reason, "selected-retention");
  assert.deepEqual(out.registryDelta.deregistrations.map((e) => e.pluginId), ["drop@local"]);
  assert.equal(out.registryDelta.deregistrations[0].reason, "explicit-deregistration");
  assert.equal(out.applicability, "applicable");
  assert.equal(out.workspaceRoot, "/ws");
  assert.deepEqual(out.inventory, TRUSTWORTHY, "the inventory confidence is carried verbatim");
});

test("an addition carries the capability names its pack would bring", () => {
  const out = planInstall(
    input({
      packs: [pack({ state: "installed/inactive", registeredCapabilities: [] })],
      capabilities: [
        capability({ name: "beta" }),
        capability({ name: "alpha" }),
        capability({ pluginId: "other@local", name: "elsewhere" }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.deepEqual(out.registryDelta.additions[0].capabilities, ["alpha", "beta"]);
});

// --- SC5: retention defaults -------------------------------------------------

test("omission never removes: a registered pack absent from the desired set is retained", () => {
  const out = planInstall(
    input({ selection: { desired: [], deregister: [], answers: [] } }),
  );
  assert.deepEqual(out.registryDelta.deregistrations, [], "nothing is removed by omission");
  assert.deepEqual(out.registryDelta.retentions.map((e) => e.reason), ["retained-by-omission"]);
  assert.equal(out.applicability, "no-change");
});

test("a DISABLED registration cannot become an implicit removal", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          state: "installed/disabled",
          enablement: "disabled",
          selectable: false,
          registeredCapabilities: ["demo"],
        }),
      ],
      selection: { desired: [], deregister: [], answers: [] },
    }),
  );
  assert.deepEqual(out.registryDelta.deregistrations, []);
  assert.deepEqual(out.registryDelta.retentions.map((e) => e.pluginId), ["wf-demo@local"]);
  assert.equal(out.registryDelta.retentions[0].enablement, "disabled");
});

test("an ORPHANED registration stays visible and retained by default", () => {
  const out = planInstall(
    input({
      packs: [pack({ presence: "orphaned", state: "registered/unrecoverable", installPath: null })],
      selection: { desired: [], deregister: [], answers: [] },
    }),
  );
  assert.deepEqual(out.registryDelta.deregistrations, []);
  assert.equal(out.registryDelta.retentions[0].reason, "retained-orphaned");
  assert.equal(out.registryDelta.retentions[0].presence, "orphaned");
  assert.ok(codes(out).includes("plan/orphaned-registration"), "the orphan is visible as a finding");
  assert.equal(
    out.findings.find((f) => f.code === "plan/orphaned-registration")?.severity,
    "warning",
    "an orphan is visible, not fatal",
  );
});

test("an indeterminate absence is retained and reported, never treated as absent", () => {
  const out = planInstall(
    input({
      inventory: { confidence: "partial", mayEstablishAbsence: false, observedCount: 1, issues: [] },
      packs: [pack({ presence: "absence-indeterminate" })],
    }),
  );
  assert.equal(out.registryDelta.retentions[0].reason, "retained-absence-indeterminate");
  assert.ok(codes(out).includes("plan/absence-indeterminate"));
  assert.deepEqual(out.registryDelta.deregistrations, []);
});

test("a disabled registration CAN be removed when the removal is explicit", () => {
  const out = planInstall(
    input({
      packs: [pack({ state: "installed/disabled", enablement: "disabled", selectable: false })],
      selection: { desired: [], deregister: ["wf-demo@local"], answers: [] },
    }),
  );
  assert.deepEqual(out.registryDelta.deregistrations.map((e) => e.pluginId), ["wf-demo@local"]);
});

// --- SC2: proposed answers ---------------------------------------------------

test("a VALID proposed answer satisfies planning but stays PENDING", () => {
  const out = planInstall(
    input({
      packs: [pack({ questions: [question()] })],
      selection: {
        desired: ["wf-demo@local"],
        deregister: [],
        answers: [{ pluginId: "wf-demo@local", questionId: "team", value: "platform" }],
      },
    }),
  );
  assert.deepEqual(out.answers.unresolved, []);
  assert.equal(out.answers.writes.length, 1);
  assert.deepEqual(out.answers.writes[0], {
    pluginId: "wf-demo@local",
    pack: "demo",
    questionId: "team",
    destination: "team",
    value: "platform",
    source: "proposed",
    status: "pending",
  });
  assert.equal(out.applicability, "applicable", "a valid proposed answer does not block");
});

test("a MISSING answer blocks", () => {
  const out = planInstall(
    input({
      packs: [pack({ questions: [question()] })],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.deepEqual(out.answers.writes, []);
  assert.equal(out.answers.unresolved.length, 1);
  assert.equal(out.answers.unresolved[0].reason, "missing-answer");
  assert.equal(out.applicability, "blocked");
  assert.ok(codes(out).includes("plan/answer-missing"));
});

test("an INVALID proposed answer blocks and never becomes a write", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          questions: [question({ schema: { type: "enum", values: ["red", "green"] } })],
        }),
      ],
      selection: {
        desired: ["wf-demo@local"],
        deregister: [],
        answers: [{ pluginId: "wf-demo@local", questionId: "team", value: "purple" }],
      },
    }),
  );
  assert.deepEqual(out.answers.writes, []);
  assert.equal(out.answers.unresolved[0].reason, "invalid-proposed-answer");
  assert.equal(out.applicability, "blocked");
  assert.ok(codes(out).includes("plan/answer-invalid"));
});

test("an ALREADY-PERSISTED answer is neither a write nor an open question", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          questions: [
            question({
              state: { status: "resolved", source: "persisted", value: "platform", suggestions: [] },
            }),
          ],
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.deepEqual(out.answers.writes, []);
  assert.deepEqual(out.answers.unresolved, []);
  assert.equal(out.applicability, "no-change");
});

test("a SUGGESTION is not a resolution — the question still blocks", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          questions: [
            question({
              state: {
                status: "unresolved",
                source: null,
                value: null,
                suggestions: [{ source: "pack-default", value: "platform" }],
              },
            }),
          ],
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.equal(out.applicability, "blocked");
  assert.deepEqual(out.answers.unresolved[0].suggestions, [
    { source: "pack-default", value: "platform" },
  ]);
});

test("a question on a pack the plan does NOT act on is not this plan's business", () => {
  const out = planInstall(input({ packs: [pack({ questions: [question()] })] }));
  assert.deepEqual(out.answers.unresolved, []);
  assert.equal(out.applicability, "no-change");
});

// --- SC3 / SC4: evidence seeds ----------------------------------------------

test("matching portable evidence with no local binding carries a reviewable seed", () => {
  const proposal = binding();
  const out = planInstall(
    input({
      packs: [
        pack({
          evidence: { comparison: "binding-seed", portable: portable(), binding: proposal },
          seedProposal: proposal,
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.equal(out.evidenceSeeds.length, 1);
  assert.equal(out.evidenceSeeds[0].kind, "binding-seed");
  assert.equal(out.evidenceSeeds[0].comparison, "binding-seed");
  assert.deepEqual(out.evidenceSeeds[0].binding, proposal);
  assert.equal(out.evidenceSeeds[0].persisted, false, "a seed is reviewed, never written");
  assert.equal(out.applicability, "applicable");
});

test("a legacy registration is bootstrapped ONLY from complete proof", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          evidence: { comparison: "evidence-missing", portable: portable(), binding: binding() },
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.equal(out.evidenceSeeds.length, 1);
  assert.equal(out.evidenceSeeds[0].kind, "legacy-bootstrap");
  assert.deepEqual(out.evidenceSeeds[0].portable, portable());
  assert.equal(out.evidenceSeeds[0].persisted, false);
  assert.ok(codes(out).includes("plan/legacy-bootstrap-previewed"));
  assert.equal(out.applicability, "applicable");
});

test("INCOMPLETE legacy proof makes planning non-applicable and PRESERVES registration", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          presence: "orphaned",
          state: "registered/unrecoverable",
          installPath: null,
          evidence: { comparison: "evidence-missing", portable: null, binding: null },
        }),
      ],
      // The pack is EXPLICITLY deregistered, and the registration still survives.
      selection: { desired: [], deregister: ["wf-demo@local"], answers: [] },
    }),
  );
  assert.deepEqual(out.evidenceSeeds, [], "no bootstrap is previewed without proof");
  assert.ok(codes(out).includes("plan/legacy-proof-incomplete"));
  assert.equal(out.applicability, "not-applicable");
  assert.deepEqual(out.registryDelta.deregistrations, [], "registration is preserved");
  assert.equal(out.registryDelta.retentions[0].reason, "retained-legacy-proof-incomplete");
});

test("incomplete proof on an UNTOUCHED registration is a warning, not a blocked plan", () => {
  // Scoping the legacy-proof gate to acted-on packs is what lets an orphaned
  // registration stay retained and visible without making every plan fail.
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "orphan@local", pluginName: "orphan", presence: "orphaned", evidence: { comparison: "evidence-missing", portable: null, binding: null } }),
        pack({ pluginId: "wf-demo@local", state: "installed/inactive", registeredCapabilities: [] }),
      ],
      capabilities: [capability({ pluginId: "orphan@local", name: "orphan" }), capability()],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.ok(!codes(out).includes("plan/legacy-proof-incomplete"));
  assert.equal(out.applicability, "applicable");
  assert.deepEqual(out.registryDelta.additions.map((e) => e.pluginId), ["wf-demo@local"]);
});

test("drifted evidence on an acted-on pack is a WARNING — staleness never clears selectability", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          overlay: "pack/stale(source-changed)",
          evidence: { comparison: "portable-mismatch", portable: portable(), binding: binding() },
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  const stale = out.findings.find((f) => f.code === "plan/stale-evidence");
  assert.ok(stale);
  assert.equal(stale.severity, "warning");
  assert.equal(out.registryDelta.retentions[0].overlay, "pack/stale(source-changed)");
  assert.notEqual(out.applicability, "not-applicable");
});

// --- SC7: structural findings over the post-plan capability set --------------

test("an unsatisfied dependency in the post-plan set is an error", () => {
  const out = planInstall(
    input({
      packs: [pack({ state: "installed/inactive", registeredCapabilities: [] })],
      capabilities: [capability({ requires: ["absent"] })],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.ok(codes(out).includes("plan/dependency-unsatisfied"));
  assert.equal(out.applicability, "not-applicable");
});

test("a satisfied dependency raises nothing", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "wf-demo@local", state: "installed/inactive", registeredCapabilities: [] }),
        pack({ pluginId: "base@local", pluginName: "base", registeredCapabilities: ["base"] }),
      ],
      capabilities: [
        capability({ requires: ["base"] }),
        capability({ pluginId: "base@local", name: "base" }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.ok(!codes(out).includes("plan/dependency-unsatisfied"));
});

test("a co-active conflict in the post-plan set is an error", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "wf-demo@local", state: "installed/inactive", registeredCapabilities: [] }),
        pack({ pluginId: "foe@local", pluginName: "foe", registeredCapabilities: ["foe"] }),
      ],
      capabilities: [
        capability({ conflicts: ["foe"] }),
        capability({ pluginId: "foe@local", name: "foe" }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  const conflict = out.findings.find((f) => f.code === "plan/capability-conflict");
  assert.ok(conflict);
  assert.match(conflict.message, /`demo`.+`foe`/);
  assert.equal(out.applicability, "not-applicable");
});

test("an overlapping provider surface in the post-plan set names BOTH offenders", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "wf-demo@local", state: "installed/inactive", registeredCapabilities: [] }),
        pack({ pluginId: "other@local", pluginName: "other", registeredCapabilities: ["other"] }),
      ],
      capabilities: [
        capability({ providerScopes: ["delivery"] }),
        capability({ pluginId: "other@local", name: "other", providerScopes: ["delivery"] }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  const overlap = out.findings.find((f) => f.code === "plan/provider-overlap");
  assert.ok(overlap);
  assert.match(overlap.message, /`demo`/);
  assert.match(overlap.message, /`other`/);
  assert.match(overlap.message, /`delivery`/);
  assert.equal(out.applicability, "not-applicable");
});

test("a DEREGISTERED capability leaves the post-plan set, clearing its overlap", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "wf-demo@local", registeredCapabilities: ["demo"] }),
        pack({ pluginId: "other@local", pluginName: "other", registeredCapabilities: ["other"] }),
      ],
      capabilities: [
        capability({ providerScopes: ["delivery"] }),
        capability({ pluginId: "other@local", name: "other", providerScopes: ["delivery"] }),
      ],
      selection: { desired: [], deregister: ["other@local"], answers: [] },
    }),
  );
  assert.ok(!codes(out).includes("plan/provider-overlap"));
  assert.equal(out.applicability, "applicable");
});

// --- selection defects -------------------------------------------------------

test("a plugin id in BOTH sets is contradictory — it neither registers nor removes", () => {
  const out = planInstall(
    input({
      selection: { desired: ["wf-demo@local"], deregister: ["wf-demo@local"], answers: [] },
    }),
  );
  assert.ok(codes(out).includes("plan/contradictory-selection"));
  assert.equal(out.applicability, "not-applicable");
  assert.deepEqual(out.registryDelta.deregistrations, []);
  assert.deepEqual(out.registryDelta.additions, []);
  assert.equal(out.registryDelta.retentions[0].reason, "retained-by-omission");
});

test("an unknown selection is an error, not a silent no-op", () => {
  const out = planInstall(
    input({ selection: { desired: ["ghost@local"], deregister: [], answers: [] } }),
  );
  assert.ok(codes(out).includes("plan/unknown-selection"));
  assert.equal(out.applicability, "not-applicable");
});

test("selecting a DISABLED pack for registration is an error", () => {
  const out = planInstall(
    input({
      packs: [
        pack({
          state: "installed/disabled",
          enablement: "disabled",
          selectable: false,
          registeredCapabilities: [],
        }),
      ],
      selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
    }),
  );
  assert.ok(codes(out).includes("plan/not-selectable"));
  assert.equal(out.applicability, "not-applicable");
  assert.deepEqual(out.registryDelta.additions, [], "a disabled pack is never added");
});

// --- SC6: no-change and invalid-root are explicit ----------------------------

test("no-change is explicit and carries empty collections", () => {
  const out = planInstall(
    input({ selection: { desired: ["wf-demo@local"], deregister: [], answers: [] } }),
  );
  assert.equal(out.applicability, "no-change");
  assert.deepEqual(out.registryDelta.additions, []);
  assert.deepEqual(out.registryDelta.deregistrations, []);
  assert.deepEqual(out.answers.writes, []);
  assert.deepEqual(out.evidenceSeeds, []);
  assert.equal(out.byteInert, true);
});

test("an empty selection over an empty project is no-change, not applicable", () => {
  const out = planInstall(input({ packs: [], capabilities: [] }));
  assert.equal(out.applicability, "no-change");
  assert.deepEqual(out.findings, []);
});

test("an inadmissible root yields the typed invalid-root envelope, not an error", () => {
  const out = planInstall(
    input({
      admission: {
        admitted: false,
        root: null,
        source: "environment",
        reason: "out-of-family",
        diagnostic: "outside the launch workspace family.",
      },
      selection: { desired: ["wf-demo@local"], deregister: ["x@local"], answers: [] },
    }),
  );
  assert.equal(out.applicability, "invalid-root");
  assert.equal(out.workspaceRoot, null);
  assert.equal(out.admission.admitted, false);
  assert.equal(out.admission.reason, "out-of-family");
  assert.deepEqual(out.registryDelta, { additions: [], retentions: [], deregistrations: [] });
  assert.deepEqual(out.answers, { writes: [], unresolved: [] });
  assert.deepEqual(out.evidenceSeeds, []);
  assert.deepEqual(out.findings, [], "nothing was read, so nothing is claimed");
  assert.equal(out.inventory.observedCount, 0);
  assert.equal(out.inventory.mayEstablishAbsence, false);
  assert.equal(out.byteInert, true);
});

// --- SC8: determinism --------------------------------------------------------

test("two runs over identical inputs are deep-equal", () => {
  const build = () =>
    input({
      packs: [
        pack({ pluginId: "z@local", pluginName: "z", state: "installed/inactive", registeredCapabilities: [], questions: [question({ id: "b" }), question({ id: "a" })] }),
        pack({ pluginId: "a@local", pluginName: "a", presence: "orphaned" }),
        pack({ pluginId: "m@local", pluginName: "m", registeredCapabilities: ["m"] }),
      ],
      capabilities: [capability({ pluginId: "z@local", name: "z" }), capability({ pluginId: "m@local", name: "m" })],
      selection: {
        desired: ["z@local"],
        deregister: ["m@local"],
        answers: [{ pluginId: "z@local", questionId: "a", value: "one" }],
      },
    });
  assert.deepEqual(planInstall(build()), planInstall(build()));
});

test("every collection sorts on a stable key", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "z@local", pluginName: "z", presence: "orphaned" }),
        pack({ pluginId: "a@local", pluginName: "a", presence: "orphaned" }),
        pack({ pluginId: "m@local", pluginName: "m", presence: "orphaned" }),
      ],
      capabilities: [],
    }),
  );
  assert.deepEqual(out.registryDelta.retentions.map((e) => e.pluginId), [
    "a@local",
    "m@local",
    "z@local",
  ]);
  const ids = out.findings.map((f) => f.pluginId ?? "");
  assert.deepEqual(ids, [...ids].sort((l, r) => l.localeCompare(r)));
});

test("input arrays are never mutated", () => {
  const packs = [pack()];
  const capabilities = [capability()];
  const desired = ["wf-demo@local"];
  planInstall(input({ packs, capabilities, selection: { desired, deregister: [], answers: [] } }));
  assert.equal(packs.length, 1);
  assert.equal(capabilities.length, 1);
  assert.deepEqual(desired, ["wf-demo@local"]);
});

// --- byte-inertness over the real service wiring -----------------------------

const WS = "/ws";
const INSTALL = "/ws/packs/wf-demo";

const DEMO_MANIFEST = `# demo capability

**Kind:** both

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/thing.ops.md\` | delivery |
`;

const CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Plugin Roots

| Plugin | Root |
|---|---|
| wf-demo | ${INSTALL} |

## Capabilities

| Capability | Path |
|---|---|
| demo | plugin:wf-demo/capabilities/demo |
`;

const PLUGIN_LIST = JSON.stringify([
  { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: true, installPath: INSTALL },
]);

function makePorts(extraFiles: Record<string, string> = {}): ResolverServicePorts & {
  counts: { resolveFresh: number; persist: number; writeFile: number };
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const seed: Record<string, string> = {
    [`${WS}/_local/config.md`]: CONFIG,
    [`${INSTALL}/capabilities/demo/manifest.md`]: DEMO_MANIFEST,
    [`${INSTALL}/capabilities/demo/fragments/thing.ops.md`]: "# thing\n",
    ...extraFiles,
  };
  for (const [k, v] of Object.entries(seed)) files.set(normalizeSlashes(k), v);

  const counts = { resolveFresh: 0, persist: 0, writeFile: 0 };
  let cache: ResolverSnapshot | null = null;
  const readFile = (p: string): string | null => files.get(normalizeSlashes(p)) ?? null;
  const readContainedFile = (root: string, selectedPath: string, maxBytes: number) => {
    const path = resolveContainedCapabilityPath(root, selectedPath);
    if (path === null) return { status: "unsafe" as const, path: null, content: null };
    const content = readFile(path);
    if (content === null) return { status: "missing" as const, path, content: null };
    if (Buffer.byteLength(content, "utf8") > maxBytes) {
      return { status: "too-large" as const, path, content: null };
    }
    return { status: "ok" as const, path, content };
  };

  return {
    counts,
    files,
    workspaceRoot: WS,
    corePluginRoot: "/core/plugins/wf",
    resolveFresh() {
      counts.resolveFresh++;
      return resolveSnapshot({
        workspaceRoot: WS,
        io: { readFile, readContainedFile },
        pluginListRaw: PLUGIN_LIST,
        now: () => new Date("2026-08-21T00:00:00.000Z"),
        generator: RESOLVER_GENERATOR,
      });
    },
    persist(snap) {
      counts.persist++;
      cache = snap;
    },
    readCache: () => cache,
    readFile,
    readContainedFile,
    fingerprintContainedFile: (root, selectedPath, maxBytes) => {
      const path = resolveContainedCapabilityPath(root, selectedPath);
      if (path === null) return { status: "unsafe" as const, path: null, sha256: null, bytes: null };
      const content = readFile(path);
      if (content === null) return { status: "missing" as const, path, sha256: null, bytes: null };
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes > maxBytes) return { status: "too-large" as const, path, sha256: null, bytes: null };
      return { status: "ok" as const, path, sha256: sha256Hex(content), bytes };
    },
    canonicalizeRoot: (root) => normalizeSlashes(root),
    writeFile(p, content) {
      counts.writeFile++;
      files.set(normalizeSlashes(p), content);
    },
    listDirs(dir) {
      const prefix = normalizeSlashes(dir).replace(/\/+$/, "") + "/";
      const names = new Set<string>();
      for (const key of files.keys()) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        const seg = rest.split("/")[0];
        if (seg && rest.includes("/")) names.add(seg);
      }
      return [...names];
    },
    listPlugins: () => ({ ...parsePluginList(PLUGIN_LIST), ok: true }),
    registryRelPath: () => "_local/config.md",
  };
}

test("planning writes NO byte — no writeFile, no ledger, no seed, no answer", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveConfig(); // warm the snapshot so `persist` is not attributed to us
  const persistBefore = ports.counts.persist;
  const filesBefore = new Map(ports.files);

  const out = svc.planInstall(ADMITTED, {
    desired: ["wf-demo@local"],
    deregister: [],
    answers: [{ pluginId: "wf-demo@local", questionId: "team", value: "platform" }],
  });

  assert.equal(out.byteInert, true);
  assert.equal(ports.counts.writeFile, 0, "planning never calls writeFile");
  assert.equal(ports.counts.persist, persistBefore, "planning does not re-persist a warm snapshot");
  assert.equal(ports.files.size, filesBefore.size, "no file was created");
  assert.ok(!ports.files.has(`${WS}/.wf/install-state.json`), "the committed ledger is untouched");
  assert.ok(!ports.files.has(`${WS}/_local/install-state.json`), "the local ledger is untouched");
  for (const [key, value] of filesBefore) {
    assert.equal(ports.files.get(key), value, `\`${key}\` is byte-identical`);
  }
});

test("the service reports the registered pack and stays repeatable", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const first = svc.planInstall(ADMITTED, { desired: [], deregister: [], answers: [] });
  const second = svc.planInstall(ADMITTED, { desired: [], deregister: [], answers: [] });
  assert.deepEqual(first, second);
  assert.equal(ports.counts.writeFile, 0);
  assert.equal(first.workspaceRoot, "/ws");
  assert.equal(first.inventory.confidence, "trustworthy");
  assert.ok(
    first.registryDelta.retentions.some((e) => e.pluginId === "wf-demo@local"),
    "the registered pack is retained by omission",
  );
});

test("the service admits an inadmissible root as the typed envelope without touching the snapshot", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const out = svc.planInstall(
    {
      admitted: false,
      root: null,
      source: "explicit",
      reason: "not-found",
      diagnostic: "explicit workspace root does not exist.",
    },
    { desired: [], deregister: [], answers: [] },
  );
  assert.equal(out.applicability, "invalid-root");
  assert.equal(ports.counts.resolveFresh, 0, "an inadmissible root never resolves a snapshot");
  assert.equal(ports.counts.writeFile, 0);
});

// --- the tool surface --------------------------------------------------------

async function registerTools(svc: ResolverService, selector?: (root: string) => ResolverService) {
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
  registerResolverTools(server, selector ?? (() => svc));
  return registered;
}

test("`plan_install` is registered without the alwaysLoad marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-plan-"));
  try {
    mkdirSync(join(dir, "_local"), { recursive: true });
    writeFileSync(join(dir, "_local", "config.md"), CONFIG);
    const svc = new ResolverService(createDefaultPorts(normalizeSlashes(dir), "/core/plugins/wf"));
    const registered = await registerTools(svc);

    const plan = registered.get("plan_install");
    assert.ok(plan, "plan_install is registered");
    assert.equal(
      plan.config._meta?.["anthropic/alwaysLoad"],
      undefined,
      "plan_install must not be resident",
    );
    // Guard the comparison itself: a resident tool DOES carry the marker.
    assert.equal(registered.get("resolve_config")?.config._meta?.["anthropic/alwaysLoad"], true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the tool returns the invalid-root ENVELOPE for a blank declaration, not an MCP error", async () => {
  const svc = new ResolverService(makePorts());
  const registered = await registerTools(svc, () => {
    throw new Error("selectService must never be reached for an invalid declaration");
  });
  const plan = registered.get("plan_install");
  assert.ok(plan);

  const result = (await plan.handler({ workspaceRoot: "   " } as never)) as {
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
  assert.notEqual(result.isError, true, "an inadmissible root is an envelope, not an error result");
  assert.equal(result.structuredContent?.applicability, "invalid-root");
  assert.equal(result.structuredContent?.byteInert, true);
  assert.equal(
    (result.structuredContent?.admission as { reason?: string })?.reason,
    "declaration-empty",
    "WF-445's closed reason token is carried verbatim",
  );
});

test("the tool maps an out-of-family root onto the closed out-of-family token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-plan-family-"));
  try {
    const svc = new ResolverService(makePorts());
    const registered = await registerTools(svc, () => {
      throw new Error("workspaceRoot is outside the launch repository's worktree family");
    });
    const plan = registered.get("plan_install");
    assert.ok(plan);

    const result = (await plan.handler({ workspaceRoot: normalizeSlashes(dir) } as never)) as {
      isError?: boolean;
      structuredContent?: Record<string, unknown>;
    };
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent?.applicability, "invalid-root");
    assert.equal(
      (result.structuredContent?.admission as { reason?: string })?.reason,
      "out-of-family",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
