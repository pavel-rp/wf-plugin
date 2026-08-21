// Pack discovery contract tests (WF-446).
//
// Two layers, deliberately:
//   - the PURE JOIN (`discoverPacks`) is driven directly, because every
//     confidence token, overlay mapping, and ordering rule is a property of that
//     function and needs no filesystem, CLI, or snapshot to exercise;
//   - the SERVICE method is driven over the in-memory ports double, because
//     byte-inertness is a property of the wiring — it is only meaningful if the
//     real `readFile`/`writeFile`/`persist` surface is in play.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverPacks,
  parseEvidenceLedger,
  type DiscoveryInput,
  type DiscoveryPackInput,
} from "../src/resolver/discover-packs.js";
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
  RESOLVER_GENERATOR,
  type MachineBindingEvidence,
  type PackRecord,
  type PortablePackEvidence,
  type ResolverSnapshot,
} from "../src/resolver/types.js";

// --- fixtures ---------------------------------------------------------------

function installedPlugin(over: Partial<{
  id: string;
  name: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
}> = {}) {
  return {
    id: over.id ?? "wf-demo@local",
    name: over.name ?? "wf-demo",
    version: over.version ?? "1.0.0",
    scope: over.scope ?? "user",
    enabled: over.enabled ?? true,
    installPath: over.installPath ?? "/ws/packs/wf-demo",
  };
}

function packRecord(over: Partial<PackRecord> = {}): PackRecord {
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
    ...over,
  };
}

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

function packInput(over: Partial<DiscoveryPackInput> = {}): DiscoveryPackInput {
  return {
    record: packRecord(),
    expectedPortable: null,
    observedPortable: null,
    priorBinding: null,
    observedBinding: null,
    questions: [],
    inspectionValid: true,
    inspectionIssues: [],
    ...over,
  };
}

function input(over: Partial<DiscoveryInput> = {}): DiscoveryInput {
  return {
    workspaceRoot: "/ws",
    inventory: { ok: true, contractOk: true, issues: [], plugins: [installedPlugin()] },
    packs: [packInput()],
    // WF-451: the join ECHOES this and never consults it, so the byte-inert
    // `no-journal` report is the right default for every pure-join case here.
    recovery: noRecoveryReport(),
    ...over,
  };
}

test("the join echoes the recovery report verbatim and never derives one", () => {
  const report = noRecoveryReport();
  const out = discoverPacks(input({ recovery: report }));
  assert.deepEqual(out.recovery, report);
  assert.equal(out.recovery.state, "no-journal");
  assert.equal(out.recovery.proceeded, true);
  assert.equal(out.recovery.wroteBytes, false);
});

// --- criterion 10: the confidence token + its precedence ---------------------

test("a clean inventory is trustworthy and may establish absence", () => {
  const out = discoverPacks(input());
  assert.equal(out.inventory.confidence, "trustworthy");
  assert.equal(out.inventory.mayEstablishAbsence, true);
  assert.equal(out.inventory.observedCount, 1);
});

test("a VALID EMPTY inventory is trustworthy — observing nothing is an observation", () => {
  const out = discoverPacks(
    input({ inventory: { ok: true, contractOk: true, issues: [], plugins: [] }, packs: [] }),
  );
  assert.equal(out.inventory.confidence, "trustworthy");
  assert.equal(out.inventory.mayEstablishAbsence, true);
  assert.equal(out.inventory.observedCount, 0);
});

test("an unavailable CLI is `unavailable` and may NOT establish absence", () => {
  const out = discoverPacks(
    input({ inventory: { ok: false, contractOk: true, issues: [], plugins: [] } }),
  );
  assert.equal(out.inventory.confidence, "unavailable");
  assert.equal(out.inventory.mayEstablishAbsence, false);
});

test("a whole-output contract failure is `malformed`, not an empty trustworthy list", () => {
  for (const code of ["plugin-list/unparseable", "plugin-list/not-an-array"]) {
    const out = discoverPacks(
      input({
        inventory: {
          ok: true,
          contractOk: false,
          issues: [{ code, message: "broken" }],
          plugins: [],
        },
      }),
    );
    assert.equal(out.inventory.confidence, "malformed", code);
    assert.equal(out.inventory.mayEstablishAbsence, false, code);
  }
});

test("some records rejected but one surviving is `partial`", () => {
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: false,
        issues: [{ code: "plugin-list/missing-field", message: "record 1 missing `id`" }],
        plugins: [installedPlugin()],
      },
    }),
  );
  assert.equal(out.inventory.confidence, "partial");
  assert.equal(out.inventory.mayEstablishAbsence, false);
});

test("a non-empty array with EVERY record rejected is `invalid`", () => {
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: false,
        issues: [{ code: "plugin-list/record-not-an-object", message: "record 0" }],
        plugins: [],
      },
    }),
  );
  assert.equal(out.inventory.confidence, "invalid");
});

test("precedence is first-match-wins: unavailable outranks every later tier", () => {
  // `ok:false` alongside a whole-output issue AND duplicates: `unavailable` wins.
  const out = discoverPacks(
    input({
      inventory: {
        ok: false,
        contractOk: false,
        issues: [{ code: "plugin-list/unparseable", message: "x" }],
        plugins: [installedPlugin(), installedPlugin()],
      },
    }),
  );
  assert.equal(out.inventory.confidence, "unavailable");
});

test("precedence is first-match-wins: malformed outranks invalid and partial", () => {
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: false,
        issues: [
          { code: "plugin-list/not-an-array", message: "x" },
          { code: "plugin-list/missing-field", message: "y" },
        ],
        plugins: [],
      },
    }),
  );
  assert.equal(out.inventory.confidence, "malformed");
});

test("precedence is first-match-wins: invalid outranks partial", () => {
  // Duplicates AND a per-record rejection with a survivor — `partial` would be
  // the verdict on the issues alone, but ambiguity is the stronger fact.
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: false,
        issues: [{ code: "plugin-list/missing-field", message: "y" }],
        plugins: [installedPlugin(), installedPlugin()],
      },
    }),
  );
  assert.equal(out.inventory.confidence, "invalid");
});

// --- criterion 5: duplicate rejection ---------------------------------------

test("a duplicate stable id invalidates the WHOLE inventory — nothing classified or selectable", () => {
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: true,
        issues: [],
        plugins: [installedPlugin(), installedPlugin()],
      },
    }),
  );
  assert.equal(out.inventory.confidence, "invalid");
  assert.deepEqual(out.packs, []);
  assert.ok(out.diagnostics.some((d) => d.code === "discovery/duplicate-plugin-id"));
  assert.ok(out.diagnostics.some((d) => d.code === "discovery/inventory-invalid"));
});

test("a duplicate NAME under distinct ids invalidates the inventory too", () => {
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: true,
        issues: [],
        plugins: [
          installedPlugin({ id: "wf-demo@a" }),
          installedPlugin({ id: "wf-demo@b" }),
        ],
      },
    }),
  );
  assert.equal(out.inventory.confidence, "invalid");
  assert.deepEqual(out.packs, []);
  assert.ok(out.diagnostics.some((d) => d.code === "discovery/duplicate-plugin-name"));
});

test("duplicate rejection precedes classification — no plugin root is consulted", () => {
  // The pack input carries complete, EQUAL evidence: if classification ran at
  // all it would surface a pack with `overlay: null`. It must not run.
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: true,
        issues: [],
        plugins: [installedPlugin(), installedPlugin()],
      },
      packs: [
        packInput({
          expectedPortable: portable(),
          observedPortable: portable(),
          priorBinding: binding(),
          observedBinding: binding(),
        }),
      ],
    }),
  );
  assert.deepEqual(out.packs, []);
});

// --- criteria 2, 3, 9: the overlay is a total function of the comparison -----

test("equal evidence yields no overlay and no seed proposal", () => {
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          expectedPortable: portable(),
          observedPortable: portable(),
          priorBinding: binding(),
          observedBinding: binding(),
        }),
      ],
    }),
  );
  assert.equal(out.packs[0].evidence.comparison, "equal");
  assert.equal(out.packs[0].overlay, null);
  assert.equal(out.packs[0].seedProposal, null);
});

test("a portable mismatch is `source-changed` and is decided BEFORE the root is compared", () => {
  // The roots also differ. If root comparison ran first this would report
  // `root-moved`; portable identity must win.
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          expectedPortable: portable({ version: "1.0.0" }),
          observedPortable: portable({ version: "2.0.0" }),
          priorBinding: binding({ canonicalRoot: "/old/root" }),
          observedBinding: binding({ canonicalRoot: "/new/root" }),
        }),
      ],
    }),
  );
  assert.equal(out.packs[0].evidence.comparison, "portable-mismatch");
  assert.equal(out.packs[0].overlay, "pack/stale(source-changed)");
});

test("equal portable evidence plus a moved known root is `root-moved`", () => {
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          expectedPortable: portable(),
          observedPortable: portable(),
          priorBinding: binding({ canonicalRoot: "/old/root" }),
          observedBinding: binding({ canonicalRoot: "/new/root" }),
        }),
      ],
    }),
  );
  assert.equal(out.packs[0].evidence.comparison, "root-moved");
  assert.equal(out.packs[0].overlay, "pack/stale(root-moved)");
});

test("an absent prior binding produces a SEED PROPOSAL and no overlay", () => {
  const observed = binding();
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          expectedPortable: portable(),
          observedPortable: portable(),
          priorBinding: null,
          observedBinding: observed,
        }),
      ],
    }),
  );
  assert.equal(out.packs[0].evidence.comparison, "binding-seed");
  assert.equal(out.packs[0].overlay, null);
  assert.deepEqual(out.packs[0].seedProposal, observed);
});

test("a same-root binding change is `binding-changed`", () => {
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          expectedPortable: portable(),
          observedPortable: portable(),
          priorBinding: binding({ enablement: "enabled" }),
          observedBinding: binding({ enablement: "disabled" }),
        }),
      ],
    }),
  );
  assert.equal(out.packs[0].evidence.comparison, "local-mismatch");
  assert.equal(out.packs[0].overlay, "pack/stale(binding-changed)");
});

test("a legacy registration stays SELECTED and operational with a non-persisted seed", () => {
  const observed = binding();
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          expectedPortable: null, // never recorded — the legacy case
          observedPortable: portable(),
          priorBinding: null,
          observedBinding: observed,
        }),
      ],
    }),
  );
  const pack = out.packs[0];
  assert.equal(pack.evidence.comparison, "evidence-missing");
  assert.equal(pack.overlay, "pack/stale(evidence-missing)");
  assert.deepEqual(pack.seedProposal, observed, "a seed is proposed");
  assert.equal(pack.selectable, true, "staleness does not de-select a legacy pack");
});

// --- criterion 8: PackState is not redefined --------------------------------

test("the overlay is a SEPARATE field — the pack keeps its own four-member state", () => {
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          record: packRecord({ state: "installed/disabled", enablement: "disabled" }),
          expectedPortable: portable({ version: "1.0.0" }),
          observedPortable: portable({ version: "9.9.9" }),
          priorBinding: binding(),
          observedBinding: binding(),
        }),
      ],
    }),
  );
  const pack = out.packs[0];
  assert.equal(pack.state, "installed/disabled", "state is untouched");
  assert.equal(pack.enablement, "disabled", "enablement is never flipped");
  assert.equal(pack.overlay, "pack/stale(source-changed)", "staleness is additional");
  assert.equal(pack.selectable, false);
});

// --- criteria 4, 6: presence and preserved registration ---------------------

test("a registered pack absent from a TRUSTWORTHY inventory is orphaned", () => {
  const out = discoverPacks(
    input({
      inventory: { ok: true, contractOk: true, issues: [], plugins: [] },
      packs: [packInput({ record: packRecord({ state: "registered/unrecoverable" }) })],
    }),
  );
  assert.equal(out.packs[0].presence, "orphaned");
  assert.ok(out.diagnostics.some((d) => d.code === "discovery/orphaned"));
});

for (const scenario of [
  { label: "unavailable", ok: false, contractOk: true, issues: [] as { code: string; message: string }[] },
  {
    label: "malformed",
    ok: true,
    contractOk: false,
    issues: [{ code: "plugin-list/unparseable", message: "x" }],
  },
]) {
  test(`a registered pack absent from an ${scenario.label} inventory is absence-indeterminate`, () => {
    const out = discoverPacks(
      input({
        inventory: {
          ok: scenario.ok,
          contractOk: scenario.contractOk,
          issues: scenario.issues,
          plugins: [],
        },
        packs: [packInput()],
      }),
    );
    assert.equal(out.packs[0].presence, "absence-indeterminate");
    assert.equal(out.inventory.mayEstablishAbsence, false);
    assert.ok(!out.diagnostics.some((d) => d.code === "discovery/orphaned"));
  });
}

test("a `partial` inventory cannot establish absence for a pack it did not list", () => {
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: false,
        issues: [{ code: "plugin-list/missing-field", message: "y" }],
        plugins: [installedPlugin({ id: "other@local", name: "other" })],
      },
      packs: [packInput()],
    }),
  );
  assert.equal(out.inventory.confidence, "partial");
  assert.equal(out.packs[0].presence, "absence-indeterminate");
});

test("an inspection-invalid pack keeps its state and registration, and its issues are attributed", () => {
  const out = discoverPacks(
    input({
      packs: [
        packInput({
          inspectionValid: false,
          inspectionIssues: ["no readable manifest."],
        }),
      ],
    }),
  );
  assert.deepEqual(out.packs[0].registeredCapabilities, ["demo"]);
  assert.equal(out.packs[0].state, "active");
  const issue = out.diagnostics.find((d) => d.code === "discovery/inspection-issue");
  assert.ok(issue);
  assert.equal(issue.pluginId, "wf-demo@local");
});

// --- criterion 11: deterministic ordering -----------------------------------

test("packs sort by ascending pluginId and diagnostics by (pluginId, code, message)", () => {
  const out = discoverPacks(
    input({
      inventory: {
        ok: true,
        contractOk: true,
        issues: [],
        plugins: [
          installedPlugin({ id: "c@local", name: "c" }),
          installedPlugin({ id: "a@local", name: "a" }),
          installedPlugin({ id: "b@local", name: "b" }),
        ],
      },
      packs: [
        packInput({
          record: packRecord({ pluginId: "c@local", pluginName: "c" }),
          inspectionIssues: ["zeta", "alpha"],
        }),
        packInput({ record: packRecord({ pluginId: "a@local", pluginName: "a" }) }),
        packInput({ record: packRecord({ pluginId: "b@local", pluginName: "b" }) }),
      ],
    }),
  );
  assert.deepEqual(
    out.packs.map((p) => p.pluginId),
    ["a@local", "b@local", "c@local"],
  );
  const keys = out.diagnostics.map((d) => `${d.pluginId ?? ""}|${d.code}|${d.message}`);
  assert.deepEqual(keys, [...keys].sort((l, r) => l.localeCompare(r)));
});

test("two runs over identical inputs are deep-equal", () => {
  const build = () =>
    input({
      packs: [
        packInput({
          expectedPortable: portable(),
          observedPortable: portable({ version: "2.0.0" }),
          priorBinding: binding(),
          observedBinding: binding(),
          inspectionIssues: ["b", "a"],
        }),
        packInput({
          record: packRecord({ pluginId: "a@local", pluginName: "a" }),
        }),
      ],
    });
  assert.deepEqual(discoverPacks(build()), discoverPacks(build()));
});

test("the admitted workspace root is echoed verbatim, never re-derived", () => {
  const out = discoverPacks(input({ workspaceRoot: "/some/admitted/root" }));
  assert.equal(out.workspaceRoot, "/some/admitted/root");
});

// --- the recorded-evidence ledger reader ------------------------------------

test("an absent or unparseable ledger yields no recorded evidence rather than throwing", () => {
  for (const raw of [null, "not json", "[]", '"scalar"']) {
    const ledger = parseEvidenceLedger(raw);
    assert.equal(ledger.portable.size, 0, String(raw));
    assert.equal(ledger.binding.size, 0, String(raw));
  }
});

test("a well-formed ledger round-trips through the frozen WF-442 constructors", () => {
  const raw = JSON.stringify({
    portable: { "wf-demo@local": portable() },
    binding: { "wf-demo@local": binding() },
  });
  const ledger = parseEvidenceLedger(raw);
  assert.deepEqual(ledger.portable.get("wf-demo@local"), portable());
  assert.deepEqual(ledger.binding.get("wf-demo@local"), binding());
});

test("a partially corrupt ledger contributes only its well-formed entries", () => {
  const raw = JSON.stringify({
    portable: {
      "good@local": portable({ pluginId: "good@local" }),
      "bad@local": { pluginId: "bad@local" }, // missing `version` — rejected
    },
    binding: {},
  });
  const ledger = parseEvidenceLedger(raw);
  assert.equal(ledger.portable.size, 1);
  assert.ok(ledger.portable.has("good@local"));
});

// --- criterion 7: byte-inertness, over the real service wiring --------------

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
        now: () => new Date("2026-07-16T00:00:00.000Z"),
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

test("discovery writes NO byte — no writeFile, no ledger, no seed persisted", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveConfig(); // warm the snapshot so `persist` is not attributed to us
  const persistBefore = ports.counts.persist;
  const filesBefore = new Map(ports.files);

  const out = svc.discoverPacks();

  assert.equal(ports.counts.writeFile, 0, "discovery never calls writeFile");
  assert.equal(ports.counts.persist, persistBefore, "discovery does not re-persist a warm snapshot");
  assert.equal(ports.files.size, filesBefore.size, "no file was created");
  assert.ok(!ports.files.has(`${WS}/.wf/install-state.json`), "the committed ledger is untouched");
  assert.ok(!ports.files.has(`${WS}/_local/install-state.json`), "the local ledger is untouched");
  for (const [key, value] of filesBefore) {
    assert.equal(ports.files.get(key), value, `\`${key}\` is byte-identical`);
  }
  assert.equal(out.workspaceRoot, WS, "the admitted root is consumed, not re-derived");
});

test("discovery is repeatable over the service and stays byte-inert on a second run", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const first = svc.discoverPacks();
  const persistAfterFirst = ports.counts.persist;
  const second = svc.discoverPacks();
  assert.deepEqual(first, second);
  assert.equal(ports.counts.writeFile, 0);
  assert.equal(ports.counts.persist, persistAfterFirst, "a warm snapshot is not re-persisted");
});

test("a seed proposal offered by the service is never written to a ledger", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const out = svc.discoverPacks();
  const seeded = out.packs.filter((p) => p.seedProposal !== null);
  assert.ok(seeded.length > 0, "the fixture has no recorded evidence, so a seed is proposed");
  assert.equal(ports.counts.writeFile, 0);
  assert.ok(!ports.files.has(`${WS}/_local/install-state.json`));
});

test("the service reads recorded evidence and reports `equal` when it matches", () => {
  // Two passes over the same fixture: the first observes the evidence, the
  // second is handed that exact evidence back as the recorded ledger. If the
  // ledger read were not wired, the second pass would still say
  // `evidence-missing`.
  const probe = new ResolverService(makePorts()).discoverPacks();
  const observed = probe.packs.find((p) => p.evidence.portable !== null);
  assert.ok(observed, "the fixture yields observable portable evidence");
  assert.equal(observed.evidence.comparison, "evidence-missing", "nothing is recorded yet");

  const ledger = JSON.stringify({
    portable: { [observed.pluginId]: observed.evidence.portable },
    binding: { [observed.pluginId]: observed.evidence.binding },
  });
  const ports = makePorts({
    [`${WS}/.wf/install-state.json`]: ledger,
    [`${WS}/_local/install-state.json`]: ledger,
  });
  const out = new ResolverService(ports).discoverPacks();
  const pack = out.packs.find((p) => p.pluginId === observed.pluginId);
  assert.ok(pack);
  assert.equal(pack.evidence.comparison, "equal");
  assert.equal(pack.overlay, null);
  assert.equal(ports.counts.writeFile, 0, "reading a ledger is still byte-inert");
});

// --- criterion 12: the tool is registered NON-RESIDENT ----------------------

test("`discover_packs` is registered without the alwaysLoad marker", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-discover-"));
  try {
    mkdirSync(join(dir, "_local"), { recursive: true });
    writeFileSync(join(dir, "_local", "config.md"), CONFIG);
    const svc = new ResolverService(createDefaultPorts(normalizeSlashes(dir), "/core/plugins/wf"));
    const { McpServer } = await import("@modelcontextprotocol/server");
    const { registerResolverTools } = await import("../src/tools.js");
    const registered = new Map<string, { _meta?: Record<string, unknown> }>();
    const server = {
      registerTool(name: string, config: { _meta?: Record<string, unknown> }) {
        registered.set(name, config);
      },
    } as unknown as InstanceType<typeof McpServer>;
    registerResolverTools(server, () => svc);

    const discover = registered.get("discover_packs");
    assert.ok(discover, "discover_packs is registered");
    assert.equal(
      discover._meta?.["anthropic/alwaysLoad"],
      undefined,
      "discover_packs must not be resident",
    );
    // Guard the comparison itself: a resident tool DOES carry the marker, so an
    // assertion that always passes would be silently useless.
    assert.equal(registered.get("resolve_config")?._meta?.["anthropic/alwaysLoad"], true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
