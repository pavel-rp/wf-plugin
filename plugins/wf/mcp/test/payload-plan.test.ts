// Payload preview contract tests (WF-448).
//
// Three layers, each chosen because the property under test lives there:
//   - the PURE JOIN (`planPayloads`) is driven directly, because every
//     co-ownership, refusal, and ordering rule is a property of that function
//     and needs no filesystem at all;
//   - the REAL no-create resolver (`resolveContainedPayloadTarget`) is driven
//     against a REAL temporary directory holding a REAL escaping symlink,
//     because "canonicalize before deciding, and create nothing while deciding"
//     is only meaningfully provable against a real filesystem — a double would
//     merely restate the assumption;
//   - the ENVELOPE (`planInstall`) is driven to prove the preview folds into
//     WF-447's single plan lineage: one `payloads` block, findings on the one
//     shared list, and applicability reached through the existing precedence.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  emptyPayloadPreview,
  planPayloads,
  type PlanPayloadFact,
} from "../src/resolver/payload-plan.js";
import { resolveContainedPayloadTarget } from "../src/ports.js";
import { normalizeSlashes } from "../src/resolver/paths.js";
import {
  planInstall,
  type PlanCapabilityInput,
  type PlanInstallInput,
} from "../src/resolver/plan-install.js";
import { noRecoveryReport } from "../src/resolver/lifecycle-recovery.js";
import {
  PLAN_ENVELOPE_VERSION,
  type DiscoveredPack,
  type DiscoveryInventory,
  type MachineBindingEvidence,
  type PayloadSemantics,
  type PlanAdmissionState,
  type PortablePackEvidence,
} from "../src/resolver/types.js";

// --- fixtures ----------------------------------------------------------------

const COPY: PayloadSemantics = {
  production: "copy",
  refresh: "replace-if-unmodified",
  removal: "delete-if-unmodified",
};

const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);

function fact(over: Partial<PlanPayloadFact> = {}): PlanPayloadFact {
  return {
    pluginId: "wf-demo@local",
    capability: "demo",
    source: "payloads/thing.md",
    destination: ".wf/thing.md",
    semantics: { ...COPY },
    target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: false },
    identity: { ok: true, sha256: DIGEST_A, bytes: 12 },
    // The default destination has no bytes and no ledger record — the ordinary
    // first-install shape, on which the WF-476 eligibility test is inert.
    current: { ok: false, status: "missing" },
    recordedContentHash: null,
    ...over,
  };
}

const codes = (out: { findings: Array<{ code: string }> }): string[] =>
  out.findings.map((f) => f.code);

// --- SC1: a safe payload is described completely ------------------------------

test("a safe nested payload exposes target, digest, tuple, owners, and the intended write", () => {
  const out = planPayloads([
    fact({ destination: ".wf/nested/deep/thing.md", target: { ok: true, canonicalTarget: "/ws/.wf/nested/deep/thing.md", exists: false } }),
  ]);

  assert.deepEqual(out.findings, [], "a safe payload raises nothing");
  assert.deepEqual(out.preview.rejected, []);
  assert.deepEqual(out.preview.conflicts, []);
  assert.equal(out.preview.actions.length, 1);
  assert.deepEqual(out.preview.actions[0], {
    destination: ".wf/nested/deep/thing.md",
    canonicalTarget: "/ws/.wf/nested/deep/thing.md",
    identity: { sha256: DIGEST_A, bytes: 12 },
    semantics: { production: "copy", refresh: "replace-if-unmodified", removal: "delete-if-unmodified" },
    owners: [{ pluginId: "wf-demo@local", capability: "demo", source: "payloads/thing.md" }],
    write: "create",
  });
});

test("an EXISTING canonical target makes the intended write an overwrite, not a create", () => {
  const out = planPayloads([
    fact({ target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: true } }),
  ]);
  assert.equal(out.preview.actions[0].write, "overwrite");
});

// --- SC2: an unsafe destination never becomes an action -----------------------

for (const rejection of ["traversal", "absolute", "symlink-escape", "out-of-workspace"] as const) {
  test(`a ${rejection} destination is refused, not previewed`, () => {
    const out = planPayloads([fact({ target: { ok: false, rejection } })]);
    assert.deepEqual(out.preview.actions, [], "no action carries a guessed target");
    assert.deepEqual(out.preview.rejected, [
      {
        pluginId: "wf-demo@local",
        capability: "demo",
        destination: ".wf/thing.md",
        rejection,
      },
    ]);
    assert.deepEqual(codes(out), ["plan/payload-unsafe-target"]);
    assert.equal(out.findings[0].severity, "error");
    assert.match(out.findings[0].message, /nothing was created while checking/);
  });
}

// --- SC3 / SC4: co-ownership is exact-equality-only ---------------------------

test("byte-identical, tuple-equal co-owners share ONE action carrying the full owner set", () => {
  const out = planPayloads([
    fact({ pluginId: "z@local", capability: "zeta", source: "payloads/z.md" }),
    fact({ pluginId: "a@local", capability: "alpha", source: "payloads/a.md" }),
  ]);

  assert.deepEqual(out.findings, []);
  assert.deepEqual(out.preview.conflicts, []);
  assert.equal(out.preview.actions.length, 1, "one target is one action, however many own it");
  assert.deepEqual(out.preview.actions[0].owners, [
    { pluginId: "a@local", capability: "alpha", source: "payloads/a.md" },
    { pluginId: "z@local", capability: "zeta", source: "payloads/z.md" },
  ]);
});

test("a DIGEST mismatch blocks — no first writer, no registry order, no arbitration", () => {
  const out = planPayloads([
    fact({ pluginId: "a@local", capability: "alpha", identity: { ok: true, sha256: DIGEST_A, bytes: 12 } }),
    fact({ pluginId: "b@local", capability: "beta", identity: { ok: true, sha256: DIGEST_B, bytes: 12 } }),
  ]);

  assert.deepEqual(out.preview.actions, [], "neither owner wins the target");
  assert.deepEqual(codes(out), ["plan/payload-conflict-bytes"]);
  assert.equal(out.findings[0].severity, "error");
  assert.equal(out.preview.conflicts.length, 1);
  assert.equal(out.preview.conflicts[0].kind, "bytes");
  assert.deepEqual(
    out.preview.conflicts[0].owners.map((o) => o.pluginId),
    ["a@local", "b@local"],
    "the conflict names EVERY owner",
  );
});

test("a LENGTH mismatch at an identical digest still blocks", () => {
  const out = planPayloads([
    fact({ pluginId: "a@local", identity: { ok: true, sha256: DIGEST_A, bytes: 12 } }),
    fact({ pluginId: "b@local", identity: { ok: true, sha256: DIGEST_A, bytes: 13 } }),
  ]);
  assert.deepEqual(codes(out), ["plan/payload-conflict-bytes"]);
  assert.deepEqual(out.preview.actions, []);
});

for (const field of ["refresh", "removal"] as const) {
  test(`a ${field} mismatch blocks even when the bytes are identical`, () => {
    const out = planPayloads([
      fact({ pluginId: "a@local" }),
      fact({ pluginId: "b@local", semantics: { ...COPY, [field]: "retain" } as PayloadSemantics }),
    ]);
    assert.deepEqual(codes(out), ["plan/payload-conflict-semantics"]);
    assert.deepEqual(out.preview.actions, []);
    assert.equal(out.preview.conflicts[0].kind, "semantics");
  });
}

test("a collision that differs on BOTH axes reports both — the axes are independent", () => {
  const out = planPayloads([
    fact({ pluginId: "a@local" }),
    fact({
      pluginId: "b@local",
      identity: { ok: true, sha256: DIGEST_B, bytes: 99 },
      semantics: { production: "copy", refresh: "retain", removal: "retain" },
    }),
  ]);
  assert.deepEqual(codes(out).sort(), [
    "plan/payload-conflict-bytes",
    "plan/payload-conflict-semantics",
  ]);
  assert.deepEqual(
    out.preview.conflicts.map((c) => c.kind),
    ["bytes", "semantics"],
  );
});

test("two DIFFERENT canonical targets never collide, however similar the rows", () => {
  const out = planPayloads([
    fact({ pluginId: "a@local", destination: ".wf/a.md", target: { ok: true, canonicalTarget: "/ws/.wf/a.md", exists: false } }),
    fact({ pluginId: "b@local", destination: ".wf/b.md", target: { ok: true, canonicalTarget: "/ws/.wf/b.md", exists: false }, identity: { ok: true, sha256: DIGEST_B, bytes: 4 } }),
  ]);
  assert.deepEqual(out.findings, []);
  assert.deepEqual(out.preview.actions.map((a) => a.canonicalTarget), [
    "/ws/.wf/a.md",
    "/ws/.wf/b.md",
  ]);
});

// --- SC6: an unreadable source never becomes a fabricated digest --------------

for (const status of ["missing", "too-large", "unsafe", "unreadable"] as const) {
  test(`a \`${status}\` payload source is reported unreadable, never previewed`, () => {
    const out = planPayloads([fact({ identity: { ok: false, status } })]);
    assert.deepEqual(out.preview.actions, [], "no action carries a fabricated digest");
    assert.deepEqual(out.preview.rejected, [], "the DESTINATION was fine — only the source was not");
    assert.deepEqual(codes(out), ["plan/payload-source-unreadable"]);
    assert.equal(out.findings[0].severity, "error");
    assert.match(out.findings[0].message, new RegExp(status));
  });
}

test("an unsafe target is decided BEFORE the source is read — one refusal, not two", () => {
  const out = planPayloads([
    fact({ target: { ok: false, rejection: "traversal" }, identity: { ok: false, status: "missing" } }),
  ]);
  assert.deepEqual(codes(out), ["plan/payload-unsafe-target"]);
});

// --- determinism --------------------------------------------------------------

test("permuting the input order produces a deep-equal result", () => {
  const rows = [
    fact({ pluginId: "m@local", capability: "mid", destination: ".wf/m.md", target: { ok: true, canonicalTarget: "/ws/.wf/m.md", exists: false } }),
    fact({ pluginId: "a@local", capability: "alpha", destination: ".wf/a.md", target: { ok: true, canonicalTarget: "/ws/.wf/a.md", exists: true } }),
    fact({ pluginId: "z@local", capability: "zeta", destination: "../escape.md", target: { ok: false, rejection: "traversal" } }),
    fact({ pluginId: "q@local", capability: "quo", destination: ".wf/a.md", target: { ok: true, canonicalTarget: "/ws/.wf/a.md", exists: true }, identity: { ok: true, sha256: DIGEST_B, bytes: 7 } }),
  ];
  const forward = planPayloads(rows);
  const reversed = planPayloads([...rows].reverse());
  assert.deepEqual(forward, reversed);
});

test("a shared canonical target reports the smallest declared spelling, order-independently", () => {
  const rows = [
    fact({ pluginId: "a@local", destination: "z/dir/../thing.md" }),
    fact({ pluginId: "b@local", destination: ".wf/thing.md" }),
  ];
  assert.equal(planPayloads(rows).preview.actions[0].destination, ".wf/thing.md");
  assert.equal(planPayloads([...rows].reverse()).preview.actions[0].destination, ".wf/thing.md");
});

test("input facts are never mutated", () => {
  const rows = [fact()];
  const before = JSON.parse(JSON.stringify(rows)) as unknown;
  planPayloads(rows);
  assert.deepEqual(JSON.parse(JSON.stringify(rows)) as unknown, before);
});

test("an empty preview is a fresh object every time — no response aliases another", () => {
  const first = emptyPayloadPreview();
  const second = emptyPayloadPreview();
  assert.deepEqual(first, second);
  first.actions.push({
    destination: "x",
    canonicalTarget: "/ws/x",
    identity: { sha256: DIGEST_A, bytes: 1 },
    semantics: { ...COPY },
    owners: [],
    write: "create",
  });
  assert.deepEqual(second.actions, [], "mutating one preview cannot reach another");
});

// --- SC2 against the REAL filesystem: canonicalize, and create nothing --------
//
// The production resolver is exercised directly here. A double would only
// restate the assumption these cases exist to test: that an escaping symlink is
// RESOLVED and then measured (not followed), and that probing a path does not
// bring it into existence.

function withWorkspace(run: (root: string, outside: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), "wf-payload-"));
  try {
    const root = join(base, "ws");
    const outside = join(base, "outside");
    mkdirSync(join(root, ".wf"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.md"), "not yours\n");
    run(root, outside);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

test("a destination through an ESCAPING SYMLINK is caught, not followed", () => {
  withWorkspace((root, outside) => {
    symlinkSync(outside, join(root, "escape"));
    const out = resolveContainedPayloadTarget(normalizeSlashes(root), "escape/secret.md");
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.rejection, "symlink-escape");
  });
});

test("a NOT-YET-EXISTING destination under an escaping symlink is still caught", () => {
  withWorkspace((root, outside) => {
    symlinkSync(outside, join(root, "escape"));
    const out = resolveContainedPayloadTarget(normalizeSlashes(root), "escape/nested/new.md");
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.rejection, "symlink-escape");
    assert.ok(!existsSync(join(outside, "nested")), "the probe created nothing outside the workspace");
  });
});

test("a DANGLING symlink fails closed rather than being guessed at", () => {
  withWorkspace((root) => {
    symlinkSync(join(root, "nowhere"), join(root, "dangling"));
    const out = resolveContainedPayloadTarget(normalizeSlashes(root), "dangling");
    assert.equal(out.ok, false);
    assert.equal(out.ok === false && out.rejection, "symlink-escape");
  });
});

test("a symlink that stays INSIDE the workspace is contained, not refused", () => {
  withWorkspace((root) => {
    mkdirSync(join(root, "real"), { recursive: true });
    symlinkSync(join(root, "real"), join(root, "link"));
    const out = resolveContainedPayloadTarget(normalizeSlashes(root), "link/thing.md");
    assert.equal(out.ok, true);
    assert.equal(out.ok === true && out.exists, false);
    assert.ok(
      out.ok === true && out.canonicalTarget.endsWith("/real/thing.md"),
      "the target is reported CANONICALLY, through the resolved link",
    );
  });
});

test("traversal and absolute destinations are refused lexically, before any probe", () => {
  withWorkspace((root) => {
    const traversal = resolveContainedPayloadTarget(normalizeSlashes(root), "../outside/secret.md");
    assert.equal(traversal.ok === false && traversal.rejection, "traversal");
    const absolute = resolveContainedPayloadTarget(normalizeSlashes(root), "/etc/passwd");
    assert.equal(absolute.ok === false && absolute.rejection, "absolute");
    const drive = resolveContainedPayloadTarget(normalizeSlashes(root), "C:/windows/system32");
    assert.equal(drive.ok === false && drive.rejection, "absolute");
    const backslash = resolveContainedPayloadTarget(normalizeSlashes(root), ".wf\\thing.md");
    assert.equal(backslash.ok === false && backslash.rejection, "malformed");
  });
});

test("a DIRECTORY target is refused — an overwrite claim against it would be a lie", () => {
  withWorkspace((root) => {
    const out = resolveContainedPayloadTarget(normalizeSlashes(root), ".wf");
    assert.equal(out.ok === false && out.rejection, "target-not-a-file");
  });
});

test("resolving a deep unborn destination creates NOTHING", () => {
  withWorkspace((root) => {
    const before = readdirSync(root).sort();
    const out = resolveContainedPayloadTarget(
      normalizeSlashes(root),
      ".wf/deeply/nested/unborn/thing.md",
    );
    assert.equal(out.ok, true);
    assert.equal(out.ok === true && out.exists, false, "the target does not exist yet");
    assert.ok(!existsSync(join(root, ".wf", "deeply")), "the probe did not materialize the path");
    assert.deepEqual(readdirSync(root).sort(), before, "the workspace is byte-for-byte unchanged");
    assert.deepEqual(readdirSync(join(root, ".wf")), [], "no ancestor was created either");
  });
});

test("an existing FILE target resolves as existing, so the write is an overwrite", () => {
  withWorkspace((root) => {
    writeFileSync(join(root, ".wf", "thing.md"), "hello\n");
    const out = resolveContainedPayloadTarget(normalizeSlashes(root), ".wf/thing.md");
    assert.equal(out.ok, true);
    assert.equal(out.ok === true && out.exists, true);
    assert.equal(lstatSync(join(root, ".wf", "thing.md")).isFile(), true);
  });
});

test("an unresolvable ROOT is refused rather than probed", () => {
  const out = resolveContainedPayloadTarget("/nope/does/not/exist", ".wf/thing.md");
  assert.equal(out.ok === false && out.rejection, "unresolvable");
});

// --- the payload preview folds into WF-447's ONE envelope ---------------------

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
    manifestHashes: [{ path: "capabilities/demo/manifest.md", sha256: DIGEST_A }],
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
    // WF-452: the byte-inert, non-blocking report, so the payload-safety path is
    // asserted against exactly its pre-retrofit behaviour.
    recovery: noRecoveryReport(),
    ...over,
  };
}

/** Selecting the pack for addition is what makes it ACTED-ON. */
const ADDING = {
  packs: [pack({ state: "installed/inactive" as const, registeredCapabilities: [] })],
  selection: { desired: ["wf-demo@local"], deregister: [], answers: [] },
};

test("a previewed payload rides the SAME plan envelope — one lineage, not a second schema", () => {
  const out = planInstall(input({ ...ADDING, payloads: [fact()] }));
  assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION, "still envelope version 1");
  assert.equal(out.byteInert, true);
  assert.equal(out.payloads.actions.length, 1);
  assert.equal(out.payloads.actions[0].canonicalTarget, "/ws/.wf/thing.md");
  assert.equal(out.applicability, "applicable");
});

test("an unsafe payload target makes the whole plan NOT-APPLICABLE", () => {
  const out = planInstall(
    input({ ...ADDING, payloads: [fact({ target: { ok: false, rejection: "symlink-escape" } })] }),
  );
  assert.equal(out.applicability, "not-applicable");
  assert.ok(codes(out).includes("plan/payload-unsafe-target"));
  assert.deepEqual(out.payloads.actions, []);
  assert.equal(out.payloads.rejected.length, 1);
  assert.equal(out.byteInert, true, "a refusal is still reached without a single write");
});

test("a non-identical co-ownership collision makes the whole plan NOT-APPLICABLE", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "a@local", pluginName: "a", state: "installed/inactive", registeredCapabilities: [] }),
        pack({ pluginId: "b@local", pluginName: "b", state: "installed/inactive", registeredCapabilities: [] }),
      ],
      capabilities: [capability({ pluginId: "a@local", name: "alpha" }), capability({ pluginId: "b@local", name: "beta" })],
      selection: { desired: ["a@local", "b@local"], deregister: [], answers: [] },
      payloads: [
        fact({ pluginId: "a@local", capability: "alpha" }),
        fact({ pluginId: "b@local", capability: "beta", identity: { ok: true, sha256: DIGEST_B, bytes: 12 } }),
      ],
    }),
  );
  assert.equal(out.applicability, "not-applicable");
  assert.ok(codes(out).includes("plan/payload-conflict-bytes"));
});

test("a payload on a pack the plan does NOT act on is not this plan's business", () => {
  // The same scoping rule the legacy-proof gate uses: a retained registration's
  // declaration must not make every unrelated plan fail.
  const out = planInstall(
    input({
      payloads: [
        fact({ pluginId: "orphan@local", target: { ok: false, rejection: "traversal" } }),
      ],
    }),
  );
  assert.ok(!codes(out).includes("plan/payload-unsafe-target"));
  assert.deepEqual(out.payloads.rejected, []);
  assert.equal(out.applicability, "no-change");
});

test("a DEREGISTERED pack contributes no previewed write — removal is not a placement", () => {
  // `acting` is `wanted || removing`, so acted-on alone would preview a write for
  // a pack the plan is removing. The scope is the post-plan set, matching how a
  // deregistration already clears a `plan/provider-overlap`.
  const out = planInstall(
    input({
      selection: { desired: [], deregister: ["wf-demo@local"], answers: [] },
      payloads: [fact()],
    }),
  );
  assert.deepEqual(out.payloads.actions, [], "a removed pack places nothing");
  assert.deepEqual(out.registryDelta.deregistrations.map((e) => e.pluginId), ["wf-demo@local"]);
  assert.equal(out.applicability, "applicable");
});

test("deregistering a pack CLEARS the co-ownership collision it would have caused", () => {
  const out = planInstall(
    input({
      packs: [
        pack({ pluginId: "keep@local", pluginName: "keep", registeredCapabilities: ["keep"] }),
        pack({ pluginId: "drop@local", pluginName: "drop", registeredCapabilities: ["drop"] }),
      ],
      capabilities: [
        capability({ pluginId: "keep@local", name: "keep" }),
        capability({ pluginId: "drop@local", name: "drop" }),
      ],
      selection: { desired: ["keep@local"], deregister: ["drop@local"], answers: [] },
      payloads: [
        fact({ pluginId: "keep@local", capability: "keep" }),
        fact({ pluginId: "drop@local", capability: "drop", identity: { ok: true, sha256: DIGEST_B, bytes: 12 } }),
      ],
    }),
  );
  assert.ok(!codes(out).includes("plan/payload-conflict-bytes"), "the departing owner is gone");
  assert.deepEqual(out.payloads.actions.map((a) => a.owners.map((o) => o.pluginId)), [["keep@local"]]);
});

test("a previewed payload write is an EFFECT, so the plan is never no-change", () => {
  const out = planInstall(
    input({ selection: { desired: ["wf-demo@local"], deregister: [], answers: [] }, payloads: [fact()] }),
  );
  assert.deepEqual(out.registryDelta.additions, [], "the pack is already registered");
  assert.equal(out.applicability, "applicable", "the payload alone carries the plan");
});

// --- SC5: registration-only planning is unchanged -----------------------------

test("registration-only planning stays usable and exposes an EMPTY preview", () => {
  const out = planInstall(input({ ...ADDING }));
  assert.deepEqual(out.payloads, { actions: [], rejected: [], conflicts: [] });
  assert.equal(out.applicability, "applicable");
  assert.equal(out.planVersion, PLAN_ENVELOPE_VERSION);
  assert.deepEqual(out.registryDelta.additions.map((e) => e.pluginId), ["wf-demo@local"]);
});

test("an inadmissible root carries the empty preview, claiming nothing it did not read", () => {
  const out = planInstall(
    input({
      admission: {
        admitted: false,
        root: null,
        source: "environment",
        reason: "out-of-family",
        diagnostic: "outside the launch workspace family.",
      },
      payloads: [fact()],
    }),
  );
  assert.equal(out.applicability, "invalid-root");
  assert.deepEqual(out.payloads, { actions: [], rejected: [], conflicts: [] });
  assert.deepEqual(out.findings, []);
});

// --- WF-476 follow-up: a MANAGED destination belongs to the artifact arm ------
//
// The two arms plan the same destination from different evidence. Once the
// ledger records it, every transition it can undergo — advance, divergent
// retention, refresh-retain — is the artifact arm's decision, made from that
// record. The payload arm's job is to establish destinations the ledger does not
// yet manage. Overlapping is not merely redundant: two actions on one
// destination is a whole-plan refusal.

test("a ledger-recorded destination whose SOURCE moved composes no payload action", () => {
  // The ordinary upgrade. The destination still holds exactly what the lifecycle
  // wrote (so it is not a hand-edit), and the pack now declares different bytes.
  // The artifact arm composes its hash-gated advance for this; a payload write
  // alongside it would put two actions on one destination and refuse the plan.
  const recorded = "c".repeat(64);
  const out = planPayloads([
    fact({
      identity: { ok: true, sha256: DIGEST_B, bytes: 20 },
      current: { ok: true, sha256: recorded, bytes: 12 },
      recordedContentHash: recorded,
      target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: true },
    }),
  ]);

  assert.deepEqual(out.preview.actions, [], "the payload arm duplicated an artifact advance");
  assert.deepEqual(out.findings, []);
});

test("a ledger-recorded destination with UNREADABLE bytes composes no payload action", () => {
  // Fail-closed: `too-large` proves nothing about whether the file was edited, so
  // it may not license an overwrite of a file the lifecycle manages.
  const out = planPayloads([
    fact({
      current: { ok: false, status: "too-large" },
      recordedContentHash: "c".repeat(64),
      target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: true },
    }),
  ]);

  assert.deepEqual(out.preview.actions, [], "an unreadable managed destination was overwritten");
});

test("a ledger-recorded destination that is ABSENT is still restored", () => {
  // The safe exception, pinned so a later tightening cannot swallow it.
  const out = planPayloads([
    fact({
      current: { ok: false, status: "missing" },
      recordedContentHash: "c".repeat(64),
      target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: false },
    }),
  ]);

  assert.equal(out.preview.actions.length, 1, "a deleted managed artifact was not restored");
  assert.equal(out.preview.actions[0]?.write, "create");
});

test("`refresh: retain` never overwrites a destination that already exists", () => {
  const out = planPayloads([
    fact({
      semantics: { ...COPY, refresh: "retain" },
      current: { ok: true, sha256: DIGEST_B, bytes: 9 },
      target: { ok: true, canonicalTarget: "/ws/.wf/thing.md", exists: true },
    }),
  ]);

  assert.deepEqual(out.preview.actions, [], "a `retain` refresh composed an overwrite");
});

test("`refresh: retain` still CREATES a destination that does not exist yet", () => {
  // `retain` governs replacement, not establishment — production is what decides
  // whether the file appears at all.
  const out = planPayloads([fact({ semantics: { ...COPY, refresh: "retain" } })]);

  assert.equal(out.preview.actions.length, 1);
  assert.equal(out.preview.actions[0]?.write, "create");
});
