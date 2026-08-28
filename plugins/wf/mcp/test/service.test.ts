// Typed resolver service contract tests (WF-270).
//
// Drives ResolverService over an in-memory ports double (no real filesystem, no
// `claude` CLI) to assert the WF-270 acceptance criteria:
//   - every command action (inspect/refresh/invalidate + the read queries)
//     routes through the ONE service and does not duplicate discovery;
//   - the public query response/error contract EXCLUDES fragment bodies;
//   - register_pack rejects each invalid case WITHOUT writing, and refreshes the
//     snapshot (making the new capability resolvable) on success.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InMemoryTransport,
  LATEST_PROTOCOL_VERSION,
  McpServer,
  type JSONRPCMessage,
} from "@modelcontextprotocol/server";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveSnapshot } from "../src/resolver/engine.js";
import { sha256Hex } from "../src/resolver/fingerprint.js";
import { createDefaultPorts, resolveContainedRegistryWritePath } from "../src/ports.js";
import {
  normalizeSlashes,
  joinSlash,
  resolveContainedCapabilityPath,
} from "../src/resolver/paths.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import {
  MAX_NORMALIZED_QUESTION_BYTES,
  MAX_PROFILE_TEMPLATE_BYTES,
  MAX_QUESTION_DIAGNOSTICS,
} from "../src/resolver/questions.js";
import {
  ResolverService,
  readDeclaredCoreVersion,
  type ResolverServicePorts,
} from "../src/service.js";
import { registerResolverTools } from "../src/tools.js";
import { RESOLVER_GENERATOR, type ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";
const INSTALL = "/ws/packs/wf-demo";
/** The ports double's core plugin root. One constant, consumed by `makePorts`
 *  AND by the tests that seed a manifest under it — two independent copies could
 *  drift and leave the seeded path unread while the tests still passed. */
const CORE = "/core/plugins/wf";
const MCP_DIR = process.env.WF_MCP_DIR;
if (!MCP_DIR) throw new Error("WF_MCP_DIR is required");
const REPO_ROOT = normalizeSlashes(resolve(MCP_DIR, "../../.."));

const SECRET_MANIFEST = "SECRET_MANIFEST_PROSE_do_not_leak";
const SECRET_FRAGMENT = "SECRET_FRAGMENT_BODY_do_not_leak";
const SECRET_TEMPLATE = "SECRET_PROFILE_TEMPLATE_BODY_do_not_leak";

const DEMO_MANIFEST = `# demo capability

**Kind:** both

${SECRET_MANIFEST} — a manifest body paragraph the resolver must never echo.

article: demo-rule = required

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/thing.ops.md\` | delivery |

profile-template: profile.template.json
`;

const DEMO_FRAGMENT = `# thing fragment\n\n${SECRET_FRAGMENT} — never read into any response.\n`;
const SECRET_PAYLOAD_SOURCE = "SECRET_PAYLOAD_SOURCE_BODY_do_not_leak";
const PAYLOAD_MANIFEST = `${DEMO_MANIFEST}
## Payloads

| Source | Destination | Production | Refresh | Removal |
|--------|-------------|------------|---------|---------|
| assets/default.bin | .wf/default.bin | copy | replace-if-unmodified | delete-if-unmodified |
`;
const DEMO_TEMPLATE = JSON.stringify({
  ask: [
    {
      id: "project-name",
      destination: "project-name",
      prompt: "Project name?",
      schema: { type: "string", minLength: 2, maxLength: 12 },
      suggestedDefault: "demo",
    },
    {
      id: "mode",
      destination: "mode",
      prompt: "Operating mode?",
      schema: { type: "enum", values: ["safe", "fast"] },
    },
  ],
  mode: "safe",
  privateNote: SECRET_TEMPLATE,
});

const BASE_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |
`;

const PLUGIN_LIST = JSON.stringify([
  {
    id: "wf-demo@local",
    version: "1.2.3",
    scope: "user",
    enabled: true,
    installPath: INSTALL,
  },
]);

const DISABLED_LIST = JSON.stringify([
  { id: "wf-demo@local", version: "1.2.3", scope: "user", enabled: false, installPath: INSTALL },
]);

/** An in-memory ports double whose file map is mutated by writeFile, so a
 *  register write is visible to the next resolveFresh (real refresh behaviour). */
function makePorts(opts?: {
  pluginList?: string | null;
  files?: Record<string, string>;
  registryPath?: string;
}): ResolverServicePorts & {
  counts: { resolveFresh: number; persist: number; writeFile: number };
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  const seed: Record<string, string> = {
    [`${WS}/_local/config.md`]: BASE_CONFIG,
    [`${INSTALL}/capabilities/demo/manifest.md`]: DEMO_MANIFEST,
    [`${INSTALL}/capabilities/demo/profile.template.json`]: DEMO_TEMPLATE,
    [`${INSTALL}/capabilities/demo/fragments/thing.ops.md`]: DEMO_FRAGMENT,
    ...(opts?.files ?? {}),
  };
  for (const [k, v] of Object.entries(seed)) files.set(normalizeSlashes(k), v);

  const counts = { resolveFresh: 0, persist: 0, writeFile: 0 };
  let cache: ResolverSnapshot | null = null;
  const pluginListRaw = opts?.pluginList === undefined ? PLUGIN_LIST : opts.pluginList;

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
  const fingerprintContainedFile = (root: string, selectedPath: string, maxBytes: number) => {
    const path = resolveContainedCapabilityPath(root, selectedPath);
    if (path === null) return { status: "unsafe" as const, path: null, sha256: null, bytes: null };
    const content = readFile(path);
    if (content === null) return { status: "missing" as const, path, sha256: null, bytes: null };
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > maxBytes) {
      return { status: "too-large" as const, path, sha256: null, bytes: null };
    }
    return { status: "ok" as const, path, sha256: sha256Hex(content), bytes };
  };
  const io = { readFile, readContainedFile };

  return {
    counts,
    files,
    workspaceRoot: WS,
    corePluginRoot: CORE,
    resolveFresh() {
      counts.resolveFresh++;
      return resolveSnapshot({
        workspaceRoot: WS,
        io,
        pluginListRaw: pluginListRaw ?? undefined,
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
    fingerprintContainedFile,
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
    listPlugins: () => {
      if (pluginListRaw === null) return { plugins: [], ok: false, contractOk: true, issues: [] };
      const parsed = parsePluginList(pluginListRaw);
      return { plugins: parsed.plugins, ok: true, contractOk: parsed.contractOk, issues: parsed.issues };
    },
    registryRelPath: () => opts?.registryPath ?? "_local/config.md",
  };
}

// --- discovery routing / no duplication -----------------------------------

test("read queries share ONE discovery — no per-call rediscovery", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.resolveConfig();
  svc.resolveRegistry();
  svc.resolveProvider("delivery");
  const routed = svc.resolveRouting({
    role: "classify",
    shapeEvidence: {
      workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false,
      ambiguity: "bounded", risk: "low", toolWork: "bounded", validation: "judgment",
      contextIsolation: "useful", independentReview: false,
      returnContract: "mechanically-judgeable", requestedParallelism: 1,
    },
    supportsModelSelector: true,
    supportsEffortSelector: false,
    unitIds: ["classify:service-cache"],
    basis: "service-cache-basis",
  });
  assert.equal(routed.executionShape, "isolated");
  assert.equal(routed.model.value, "haiku");
  const escalated = svc.resolveRouting({
    role: "classify",
    shapeEvidence: routed.normalizedEvidence,
    supportsModelSelector: true,
    supportsEffortSelector: false,
    availableModels: ["claude-haiku-4-5", "claude-sonnet-4-6"],
    unitIds: routed.unitIds,
    basis: "service-cache-basis",
    postAttempt: {
      sufficient: false,
      signals: ["low-confidence"],
      prior: {
        role: routed.role,
        attempt: 1,
        executionShape: routed.executionShape,
        shapeEvidence: routed.normalizedEvidence,
        unitIds: routed.unitIds,
        model: routed.model,
        effort: routed.effort,
        basis: routed.basis,
        escalationOrigin: null,
        actualModel: "claude-haiku-4-5",
      },
    },
  });
  assert.equal(escalated.disposition, "retry");
  assert.equal(escalated.model.value, "sonnet");
  assert.equal(escalated.basis, "service-cache-basis");
  const incomplete = svc.resolveRouting({
    role: "classify",
    shapeEvidence: { workSurface: "caller-context" },
    supportsModelSelector: true,
    supportsEffortSelector: false,
  } as unknown as Parameters<typeof svc.resolveRouting>[0]);
  assert.equal(incomplete.status, "stop");
  assert.match(incomplete.diagnostic ?? "", /atomicity must be one of/);
  svc.resolvePluginRoot("wf-demo");
  assert.equal(ports.counts.resolveFresh, 1, "all read queries resolved from one snapshot");
});

test("inspect reports state without rebuilding; refresh rebuilds; invalidate forces the next query to rebuild", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);

  // Cold inspect: no cache, no build.
  const cold = svc.inspect();
  assert.equal(cold.valid, false);
  assert.equal(cold.cached, false);
  assert.equal(ports.counts.resolveFresh, 0);

  // refresh builds once and marks valid.
  const refreshed = svc.refresh();
  assert.equal(refreshed.valid, true);
  assert.equal(ports.counts.resolveFresh, 1);

  // A read query now reuses the refreshed snapshot (still 1 build).
  svc.resolveConfig();
  assert.equal(ports.counts.resolveFresh, 1);

  // invalidate marks it invalid without rebuilding...
  const invalid = svc.invalidate();
  assert.equal(invalid.valid, false);
  assert.equal(ports.counts.resolveFresh, 1);

  // ...and the next query rebuilds (fresh resolved view).
  svc.resolveRegistry();
  assert.equal(ports.counts.resolveFresh, 2);
  assert.equal(svc.inspect().valid, true);
});

// --- fragment-body exclusion ----------------------------------------------

test("no query/inspect response carries a manifest or fragment body", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  // Register so the capability is active and provider ownership is derived.
  const insp = svc.inspectPack("wf-demo@local");
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint!);
  assert.equal(reg.status, "registered");

  const blob = JSON.stringify([
    svc.resolveConfig(),
    svc.resolveRegistry(),
    svc.resolveProvider("delivery"),
    svc.resolveProfile("demo"),
    svc.resolvePluginRoot("wf-demo"),
    svc.inspect(),
    svc.inspectPack("wf-demo@local"),
    reg,
  ]);
  assert.ok(!blob.includes(SECRET_MANIFEST), "manifest body must not leak");
  assert.ok(!blob.includes(SECRET_FRAGMENT), "fragment body must not leak");
  assert.ok(!blob.includes(SECRET_TEMPLATE), "raw profile-template body must not leak");
  // The normalized declaration prompt is metadata; unrelated template fields are not.
  assert.ok(blob.includes("fragments/thing.ops.md"));
});

test("inspect_pack exposes complete ordered validated payload and lifecycle evidence without source bodies", () => {
  const ports = makePorts({
    files: {
      [`${INSTALL}/capabilities/demo/manifest.md`]: PAYLOAD_MANIFEST,
      [`${INSTALL}/capabilities/demo/assets/default.bin`]: SECRET_PAYLOAD_SOURCE,
    },
  });
  const inspected = new ResolverService(ports).inspectPack("wf-demo@local");

  assert.equal(inspected.valid, true);
  assert.deepEqual(inspected.capabilities[0].payloadDiagnostics, []);
  assert.deepEqual(inspected.capabilities[0].payloads, [
    {
      pluginId: "wf-demo@local",
      capability: "demo",
      source: "assets/default.bin",
      destination: ".wf/default.bin",
      production: "copy",
      refresh: "replace-if-unmodified",
      removal: "delete-if-unmodified",
    },
  ]);
  assert.ok(inspected.portableEvidence);
  assert.deepEqual(Object.keys(inspected.portableEvidence), [
    "pluginId",
    "version",
    "capabilities",
    "manifestHashes",
    "declaredSourceHashes",
  ]);
  assert.deepEqual(inspected.portableEvidence.declaredSourceHashes.map((record) => record.path), [
    "capabilities/demo/assets/default.bin",
  ]);
  assert.ok(inspected.machineBinding);
  assert.deepEqual(Object.keys(inspected.machineBinding), [
    "pluginId",
    "canonicalRoot",
    "cliScope",
    "enablement",
    "observedVersion",
    "localFingerprints",
  ]);
  assert.ok(!JSON.stringify(inspected).includes(SECRET_PAYLOAD_SOURCE));
});

test("inspect_pack fails closed when the installed root cannot be canonicalized", () => {
  const base = makePorts({
    files: {
      [`${INSTALL}/capabilities/demo/manifest.md`]: PAYLOAD_MANIFEST,
      [`${INSTALL}/capabilities/demo/assets/default.bin`]: SECRET_PAYLOAD_SOURCE,
    },
  });
  const inspected = new ResolverService({
    ...base,
    canonicalizeRoot: () => null,
  }).inspectPack("wf-demo@local");

  assert.equal(inspected.valid, false);
  assert.equal(inspected.machineBinding, null);
  assert.ok(
    inspected.issues.some((issue) =>
      issue.includes("machine-local binding evidence is incomplete or non-deterministic"),
    ),
  );
});

test("one malformed capability rejects the complete inspected pack payload set and registration", () => {
  const invalidManifest = `# other\n\n**Kind:** adapter\n\n## Payloads\n\n| Source | Destination | Production | Refresh | Removal |\n|---|---|---|---|---|\n| assets/other.bin | .wf/other.bin | render | retain | retain |\n`;
  const ports = makePorts({
    files: {
      [`${INSTALL}/capabilities/demo/manifest.md`]: PAYLOAD_MANIFEST,
      [`${INSTALL}/capabilities/demo/assets/default.bin`]: SECRET_PAYLOAD_SOURCE,
      [`${INSTALL}/capabilities/other/manifest.md`]: invalidManifest,
      [`${INSTALL}/capabilities/other/assets/other.bin`]: "other",
    },
  });
  const service = new ResolverService(ports);
  const inspected = service.inspectPack("wf-demo@local");

  assert.equal(inspected.valid, false);
  assert.equal(inspected.portableEvidence, null);
  assert.ok(inspected.capabilities.every((capability) => capability.payloads.length === 0));
  assert.ok(
    inspected.capabilities
      .flatMap((capability) => capability.payloadDiagnostics)
      .some((diagnostic) => diagnostic.code === "payload/production-invalid"),
  );
  assert.equal(service.registerPack("wf-demo@local", inspected.fingerprint!).status, "rejected");
  assert.equal(ports.counts.writeFile, 0);
});

test("missing declared source fails closed with attributed diagnostics", () => {
  const ports = makePorts({
    files: { [`${INSTALL}/capabilities/demo/manifest.md`]: PAYLOAD_MANIFEST },
  });
  const inspected = new ResolverService(ports).inspectPack("wf-demo@local");
  assert.equal(inspected.valid, false);
  assert.deepEqual(inspected.capabilities[0].payloads, []);
  assert.ok(
    inspected.capabilities[0].payloadDiagnostics.some(
      (diagnostic) =>
        diagnostic.code === "payload/source-missing" &&
        diagnostic.pluginId === "wf-demo@local" &&
        diagnostic.capability === "demo",
    ),
  );
});

test("declared source bytes participate in the inspect/register stale fingerprint", () => {
  const sourcePath = `${INSTALL}/capabilities/demo/assets/default.bin`;
  const ports = makePorts({
    files: {
      [`${INSTALL}/capabilities/demo/manifest.md`]: PAYLOAD_MANIFEST,
      [sourcePath]: "first",
    },
  });
  const service = new ResolverService(ports);
  const first = service.inspectPack("wf-demo@local");
  assert.equal(first.valid, true);
  ports.files.set(sourcePath, "second");
  const second = service.inspectPack("wf-demo@local");
  assert.equal(second.valid, true);
  assert.notEqual(first.fingerprint, second.fingerprint);
  const rejected = service.registerPack("wf-demo@local", first.fingerprint!);
  assert.equal(rejected.status, "rejected");
  assert.match(rejected.reason ?? "", /stale fingerprint/);
});

test("real contained source fingerprinting hashes raw bytes and rejects symlinks", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-payload-source-"));
  try {
    const workspace = normalizeSlashes(join(root, "workspace"));
    const install = normalizeSlashes(join(root, "wf-demo"));
    const capability = joinSlash(install, "capabilities/demo");
    mkdirSync(join(workspace, "_local"), { recursive: true });
    mkdirSync(join(capability, "assets"), { recursive: true });
    writeFileSync(join(workspace, "_local/config.md"), BASE_CONFIG);
    writeFileSync(join(capability, "manifest.md"), PAYLOAD_MANIFEST.replace("profile-template: profile.template.json", ""));
    const raw = Buffer.from([0x00, 0xff, 0x61, 0x80]);
    writeFileSync(join(capability, "assets/default.bin"), raw);
    const pluginListRaw = JSON.stringify([
      {
        id: "wf-demo@local",
        version: "1.2.3",
        scope: "user",
        enabled: true,
        installPath: install,
      },
    ]);
    const production = createDefaultPorts(workspace);
    const ports: ResolverServicePorts = {
      ...production,
      listPlugins: () => ({ ...parsePluginList(pluginListRaw), ok: true }),
      resolveFresh: () =>
        resolveSnapshot({ workspaceRoot: workspace, pluginListRaw, now: () => new Date("2026-08-20T00:00:00.000Z") }),
    };
    const service = new ResolverService(ports);
    const inspected = service.inspectPack("wf-demo@local");
    assert.equal(inspected.valid, true);
    assert.equal(
      inspected.portableEvidence?.declaredSourceHashes[0].sha256,
      "b04d8c327a36f532f52b6c9fa7600c8281f14b2fcd4ba2f522e183e8808cbc6a",
    );

    rmSync(join(capability, "assets/default.bin"));
    writeFileSync(join(root, "outside.bin"), raw);
    symlinkSync(join(root, "outside.bin"), join(capability, "assets/default.bin"));
    const linked = service.inspectPack("wf-demo@local");
    assert.equal(linked.valid, false);
    assert.ok(
      linked.capabilities[0].payloadDiagnostics.some(
        (diagnostic) => diagnostic.code === "payload/source-unsafe",
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspect_pack exposes complete ordered validated question metadata", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const inspected = svc.inspectPack("wf-demo@local");

  assert.equal(inspected.valid, true);
  assert.deepEqual(
    inspected.capabilities[0].questions.map((question) => question.id),
    ["project-name", "mode"],
  );
  assert.ok(inspected.capabilities[0].questions.every((question) => question.pack === "demo"));
  assert.deepEqual(inspected.capabilities[0].questionDiagnostics, []);
  assert.deepEqual(inspected.capabilities[0].questions[1].state.suggestions, [
    { source: "pack-default", value: "safe" },
  ]);
});

test("real tracker manifests expose normalized template paths and complete question records", () => {
  const fixtures = [
    {
      plugin: "wf-ado",
      capability: "ado",
      installPath: joinSlash(REPO_ROOT, "plugins/wf-ado"),
      templateSuffix: "plugins/wf-ado/capabilities/ado/profile.template.json",
      rawOnlyField: "work-item-id-prefix",
      expected: [
        {
          pack: "ado",
          id: "ado-organization",
          destination: "ado-organization",
          prompt: "Azure DevOps organization slug (the <org> segment in dev.azure.com/<org>)?",
          schema: { type: "string" },
        },
        {
          pack: "ado",
          id: "ado-project",
          destination: "ado-project",
          prompt: "Azure DevOps project name?",
          schema: { type: "string" },
        },
      ],
    },
    {
      plugin: "wf-linear",
      capability: "linear",
      installPath: joinSlash(REPO_ROOT, "plugins/wf-linear"),
      templateSuffix: "plugins/wf-linear/capabilities/linear/profile.template.json",
      rawOnlyField: "linear-project",
      expected: [
        {
          pack: "linear",
          id: "linear-team",
          destination: "linear-team",
          prompt: "Linear team key or name for new issues?",
          schema: { type: "string" },
        },
      ],
    },
  ] as const;

  for (const fixture of fixtures) {
    const root = mkdtempSync(join(tmpdir(), `wf-real-${fixture.capability}-`));
    const workspace = normalizeSlashes(join(root, "workspace"));
    mkdirSync(join(workspace, "_local"), { recursive: true });
    writeFileSync(
      join(workspace, "_local", "config.md"),
      `${BASE_CONFIG}\n## Plugin Roots\n\n| Plugin | Root |\n|---|---|\n| ${fixture.plugin} | ${fixture.installPath} |\n\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| ${fixture.capability} | plugin:${fixture.plugin}/capabilities/${fixture.capability} |\n`,
    );
    const pluginListRaw = JSON.stringify([
      {
        id: `${fixture.plugin}@local`,
        version: "0.0.0",
        scope: "user",
        enabled: true,
        installPath: fixture.installPath,
      },
    ]);
    const production = createDefaultPorts(workspace);
    const ports: ResolverServicePorts = {
      ...production,
      listPlugins: () => ({ ...parsePluginList(pluginListRaw), ok: true }),
      resolveFresh: () =>
        resolveSnapshot({
          workspaceRoot: workspace,
          pluginListRaw,
          now: () => new Date("2026-08-20T00:00:00.000Z"),
        }),
    };

    try {
      const service = new ResolverService(ports);
      const inspected = service.inspectPack(`${fixture.plugin}@local`);
      assert.equal(inspected.valid, true, fixture.plugin);
      assert.deepEqual(
        inspected.capabilities[0].questions.map((question) => question.id),
        fixture.expected.map((question) => question.id),
      );

      const registry = service.resolveRegistry();
      assert.equal(registry.capabilities.length, 1, fixture.capability);
      const active = registry.capabilities[0];
      assert.equal(active.name, fixture.capability);
      assert.equal(active.validity, "ok");
      assert.ok(active.profileTemplatePath?.endsWith(fixture.templateSuffix));
      assert.deepEqual(
        active.questions.map(({ pack, id, destination, prompt, schema }) => ({
          pack,
          id,
          destination,
          prompt,
          schema,
        })),
        fixture.expected,
      );
      assert.ok(
        active.questions.every(
          (question) =>
            question.state.status === "unresolved" &&
            question.state.source === null &&
            question.state.value === null &&
            question.state.suggestions.length === 0,
        ),
      );
      assert.ok(!JSON.stringify(active).includes(fixture.rawOnlyField));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("real MCP tools/call dispatch exposes on-disk question metadata without template bodies", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-tools-call-"));
  const workspace = normalizeSlashes(join(root, "workspace"));
  const install = normalizeSlashes(join(root, "wf-demo"));
  const capability = joinSlash(install, "capabilities/demo");
  mkdirSync(join(workspace, "_local"), { recursive: true });
  mkdirSync(join(capability, "fragments"), { recursive: true });
  mkdirSync(join(capability, "assets"), { recursive: true });
  writeFileSync(
    join(workspace, "_local", "config.md"),
    `${BASE_CONFIG}\n## Plugin Roots\n\n| Plugin | Root |\n|---|---|\n| wf-demo | ${install} |\n\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| demo | plugin:wf-demo/capabilities/demo |\n`,
  );
  writeFileSync(join(capability, "manifest.md"), PAYLOAD_MANIFEST);
  writeFileSync(join(capability, "profile.template.json"), DEMO_TEMPLATE);
  writeFileSync(join(capability, "fragments", "thing.ops.md"), DEMO_FRAGMENT);
  writeFileSync(join(capability, "assets", "default.bin"), SECRET_PAYLOAD_SOURCE);

  const pluginListRaw = JSON.stringify([
    {
      id: "wf-demo@local",
      version: "1.2.3",
      scope: "user",
      enabled: true,
      installPath: install,
    },
  ]);
  const production = createDefaultPorts(workspace);
  const ports: ResolverServicePorts = {
    ...production,
    listPlugins: () => ({ ...parsePluginList(pluginListRaw), ok: true }),
    resolveFresh: () =>
      resolveSnapshot({
        workspaceRoot: workspace,
        pluginListRaw,
        now: () => new Date("2026-08-20T00:00:00.000Z"),
      }),
  };
  const service = new ResolverService(ports);
  const server = new McpServer(
    { name: "wf-resolver-test", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  registerResolverTools(server, (requestedRoot) => {
    assert.equal(normalizeSlashes(requestedRoot), workspace);
    return service;
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const waiters = new Map<string, (message: JSONRPCMessage) => void>();
  clientTransport.onmessage = (message) => {
    if (!("id" in message)) return;
    const resolve = waiters.get(String(message.id));
    if (!resolve) return;
    waiters.delete(String(message.id));
    resolve(message);
  };
  const request = async (
    id: number,
    method: string,
    params: Record<string, unknown>,
  ): Promise<JSONRPCMessage> => {
    const response = new Promise<JSONRPCMessage>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`timed out waiting for MCP response ${id}`)),
        2_000,
      );
      waiters.set(String(id), (message) => {
        clearTimeout(timeout);
        resolve(message);
      });
    });
    await clientTransport.send({ jsonrpc: "2.0", id, method, params } as JSONRPCMessage);
    return response;
  };
  const payload = (message: JSONRPCMessage): unknown => {
    assert.ok("result" in message, "tools/call must return a JSON-RPC result");
    if (!("result" in message)) return null;
    const result = message.result as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = result.content?.find((entry) => entry.type === "text")?.text;
    assert.equal(typeof text, "string");
    return JSON.parse(text as string);
  };

  try {
    await server.connect(serverTransport);
    await clientTransport.start();
    const initialized = await request(1, "initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "wf-resolver-test-client", version: "0.0.0" },
    });
    assert.ok("result" in initialized);
    await clientTransport.send({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    } as JSONRPCMessage);

    const inspected = payload(
      await request(2, "tools/call", {
        name: "inspect_pack",
        arguments: { workspaceRoot: workspace, pluginId: "wf-demo@local" },
      }),
    ) as {
      valid: boolean;
      capabilities: Array<{
        questions: Array<{ id: string }>;
        payloads: Array<{ destination: string }>;
      }>;
      portableEvidence: { declaredSourceHashes: Array<{ path: string }> } | null;
    };
    const registry = payload(
      await request(3, "tools/call", {
        name: "resolve_registry",
        arguments: { workspaceRoot: workspace },
      }),
    ) as { capabilities: Array<{ name: string; questions: Array<{ id: string }> }> };

    assert.equal(inspected.valid, true);
    assert.deepEqual(
      inspected.capabilities[0].questions.map((question) => question.id),
      ["project-name", "mode"],
    );
    assert.deepEqual(
      inspected.capabilities[0].payloads.map((payload) => payload.destination),
      [".wf/default.bin"],
    );
    assert.deepEqual(inspected.portableEvidence?.declaredSourceHashes.map((record) => record.path), [
      "capabilities/demo/assets/default.bin",
    ]);
    assert.deepEqual(
      registry.capabilities[0].questions.map((question) => question.id),
      ["project-name", "mode"],
    );
    assert.ok(!JSON.stringify([inspected, registry]).includes(SECRET_TEMPLATE));
    assert.ok(!JSON.stringify(inspected).includes(SECRET_PAYLOAD_SOURCE));
  } finally {
    await clientTransport.close();
    await server.close();
    await serverTransport.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("profile-template paths cannot escape their installed capability folder", () => {
  const sentinel = "PROFILE_PATH_SECRET_7fd";
  for (const candidate of [
    "../outside.json",
    "/outside.json",
    "..\\outside.json",
    `${sentinel}/../outside.json`,
  ]) {
    const escapedRead = joinSlash(INSTALL, "capabilities/demo", candidate);
    const ports = makePorts({
      files: {
        [`${INSTALL}/capabilities/demo/manifest.md`]: DEMO_MANIFEST.replace(
          "profile.template.json",
          candidate,
        ),
        [escapedRead]: DEMO_TEMPLATE,
      },
    });
    const inspected = new ResolverService(ports).inspectPack("wf-demo@local");

    assert.equal(inspected.valid, false, candidate);
    assert.deepEqual(inspected.capabilities[0].questions, [], candidate);
    assert.ok(
      inspected.capabilities[0].questionDiagnostics.some(
        (diagnostic) => diagnostic.code === "question/template-path-invalid",
      ),
      candidate,
    );
    assert.ok(!JSON.stringify(inspected).includes(sentinel), candidate);
  }
});

test("symlinked profile templates fail installed-pack and active discovery", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-template-link-"));
  try {
    const workspace = join(root, "workspace");
    const install = join(root, "wf-demo");
    const capability = join(install, "capabilities", "demo");
    const outside = join(root, "outside.json");
    mkdirSync(join(workspace, "_local"), { recursive: true });
    mkdirSync(capability, { recursive: true });
    writeFileSync(
      join(workspace, "_local", "config.md"),
      `${BASE_CONFIG}\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| demo | plugin:wf-demo/capabilities/demo |\n`,
    );
    writeFileSync(join(capability, "manifest.md"), DEMO_MANIFEST);
    writeFileSync(outside, DEMO_TEMPLATE);
    symlinkSync(outside, join(capability, "profile.template.json"));

    const pluginListRaw = JSON.stringify([
      {
        id: "wf-demo@local",
        version: "1.2.3",
        scope: "user",
        enabled: true,
        installPath: normalizeSlashes(install),
      },
    ]);
    const production = createDefaultPorts(normalizeSlashes(workspace));
    const templateLink = normalizeSlashes(join(capability, "profile.template.json"));
    const ports: ResolverServicePorts = {
      ...production,
      readFile: (path) => {
        assert.notEqual(
          normalizeSlashes(path),
          templateLink,
          "profile-template freshness must not use unrestricted readFile",
        );
        return production.readFile(path);
      },
      listPlugins: () => ({ ...parsePluginList(pluginListRaw), ok: true }),
      resolveFresh: () =>
        resolveSnapshot({
          workspaceRoot: normalizeSlashes(workspace),
          pluginListRaw,
          now: () => new Date("2026-08-19T00:00:00.000Z"),
        }),
    };
    const service = new ResolverService(ports);

    const inspected = service.inspectPack("wf-demo@local");
    assert.equal(inspected.valid, false);
    assert.deepEqual(inspected.capabilities[0].questions, []);
    assert.ok(
      inspected.capabilities[0].questionDiagnostics.some(
        (diagnostic) => diagnostic.code === "question/template-path-invalid",
      ),
    );

    const active = service.resolveRegistry().capabilities.find(
      (candidate) => candidate.name === "demo",
    );
    assert.ok(active);
    assert.deepEqual(active.questions, []);
    assert.ok(
      service.inspect().diagnostics.some(
        (diagnostic) => diagnostic.code === "question/template-path-invalid",
      ),
    );
    const served = service.resolveContent({
      class: "profile-template",
      capability: "demo",
    });
    assert.equal(served.status, "unresolved");
    if (served.status === "unresolved") {
      assert.equal(served.category, "registry-invalid");
      assert.ok(!("content" in served));
      assert.ok(!("path" in served));
    }
    assert.doesNotThrow(() => service.resolveRegistry());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a non-regular profile-template path is never body-served", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-template-directory-"));
  try {
    const workspace = join(root, "workspace");
    const install = join(root, "wf-demo");
    const capability = join(install, "capabilities", "demo");
    mkdirSync(join(workspace, "_local"), { recursive: true });
    mkdirSync(join(capability, "profile.template.json"), { recursive: true });
    writeFileSync(
      join(workspace, "_local", "config.md"),
      `${BASE_CONFIG}\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| demo | plugin:wf-demo/capabilities/demo |\n`,
    );
    writeFileSync(join(capability, "manifest.md"), DEMO_MANIFEST);

    const pluginListRaw = JSON.stringify([
      {
        id: "wf-demo@local",
        version: "1.2.3",
        scope: "user",
        enabled: true,
        installPath: normalizeSlashes(install),
      },
    ]);
    const production = createDefaultPorts(normalizeSlashes(workspace));
    const ports: ResolverServicePorts = {
      ...production,
      listPlugins: () => ({ ...parsePluginList(pluginListRaw), ok: true }),
      resolveFresh: () =>
        resolveSnapshot({
          workspaceRoot: normalizeSlashes(workspace),
          pluginListRaw,
          now: () => new Date("2026-08-20T00:00:00.000Z"),
        }),
    };
    const served = new ResolverService(ports).resolveContent({
      class: "profile-template",
      capability: "demo",
    });
    assert.equal(served.status, "unresolved");
    if (served.status !== "unresolved") return;
    assert.equal(served.category, "registry-invalid");
    assert.ok(!("content" in served));
    assert.ok(!("path" in served));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("oversized profile templates fail before installed-pack and active parsing", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-template-size-"));
  try {
    const workspace = join(root, "workspace");
    const install = join(root, "wf-demo");
    const capability = join(install, "capabilities", "demo");
    mkdirSync(join(workspace, "_local"), { recursive: true });
    mkdirSync(capability, { recursive: true });
    writeFileSync(
      join(workspace, "_local", "config.md"),
      `${BASE_CONFIG}\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| demo | plugin:wf-demo/capabilities/demo |\n`,
    );
    writeFileSync(join(capability, "manifest.md"), DEMO_MANIFEST);
    writeFileSync(
      join(capability, "profile.template.json"),
      "x".repeat(MAX_PROFILE_TEMPLATE_BYTES + 1),
    );

    const pluginListRaw = JSON.stringify([
      {
        id: "wf-demo@local",
        version: "1.2.3",
        scope: "user",
        enabled: true,
        installPath: normalizeSlashes(install),
      },
    ]);
    const production = createDefaultPorts(normalizeSlashes(workspace));
    const ports: ResolverServicePorts = {
      ...production,
      listPlugins: () => ({ ...parsePluginList(pluginListRaw), ok: true }),
      resolveFresh: () =>
        resolveSnapshot({
          workspaceRoot: normalizeSlashes(workspace),
          pluginListRaw,
          now: () => new Date("2026-08-19T00:00:00.000Z"),
        }),
    };
    const service = new ResolverService(ports);

    const inspected = service.inspectPack("wf-demo@local");
    assert.equal(inspected.valid, false);
    assert.ok(
      inspected.capabilities[0].questionDiagnostics.some(
        (diagnostic) => diagnostic.code === "question/template-too-large",
      ),
    );

    assert.deepEqual(
      service.resolveRegistry().capabilities.find((candidate) => candidate.name === "demo")
        ?.questions,
      [],
    );
    assert.ok(
      service.inspect().diagnostics.some(
        (diagnostic) => diagnostic.code === "question/template-too-large",
      ),
    );
    const served = service.resolveContent({
      class: "profile-template",
      capability: "demo",
    });
    assert.equal(served.status, "unresolved");
    if (served.status === "unresolved") {
      assert.equal(served.category, "registry-invalid");
      assert.ok(!("content" in served));
      assert.ok(!("path" in served));
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("active metadata keeps folder provenance when a registry row is aliased", () => {
  const ports = makePorts({
    files: {
      [`${WS}/_local/config.md`]: `${BASE_CONFIG}\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| alias | plugin:wf-demo/capabilities/demo |\n`,
    },
  });
  const svc = new ResolverService(ports);
  const inspected = svc.inspectPack("wf-demo@local");
  const active = svc.resolveRegistry().capabilities.find((capability) => capability.name === "alias");

  assert.ok(active);
  assert.ok(inspected.capabilities[0].questions.every((question) => question.pack === "demo"));
  assert.ok(active.questions.every((question) => question.pack === "demo"));
});

test("active discovery rejects profile-template traversal before reading", () => {
  const capabilityRoot = `${WS}/capabilities/bad`;
  const ports = makePorts({
    files: {
      [`${WS}/_local/config.md`]: `${BASE_CONFIG}\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| bad | capabilities/bad |\n`,
      [`${capabilityRoot}/manifest.md`]: `# bad\n\n**Kind:** adapter\n\nprofile-template: ../outside.json\n`,
      [joinSlash(capabilityRoot, "../outside.json")]: DEMO_TEMPLATE,
    },
  });
  const svc = new ResolverService(ports);
  const active = svc.resolveRegistry().capabilities.find((capability) => capability.name === "bad");

  assert.ok(active);
  assert.deepEqual(active.questions, []);
  assert.ok(
    svc.inspect().diagnostics.some(
      (diagnostic) => diagnostic.code === "question/template-path-invalid",
    ),
  );
});

test("active registry metadata resolves only valid explicitly persisted profile answers", () => {
  const ports = makePorts({
    files: {
      [`${WS}/_local/profiles/demo.profile.json`]: JSON.stringify({
        "project-name": "omega",
      }),
    },
  });
  const svc = new ResolverService(ports);
  const inspected = svc.inspectPack("wf-demo@local");
  assert.equal(inspected.valid, true);
  assert.equal(svc.registerPack("wf-demo@local", inspected.fingerprint!).status, "registered");

  const active = svc.resolveRegistry().capabilities.find((capability) => capability.name === "demo");
  assert.ok(active);
  assert.deepEqual(
    active.questions.map((question) => question.id),
    ["project-name", "mode"],
  );
  assert.deepEqual(active.questions[0].state, {
    status: "resolved",
    source: "persisted",
    value: "omega",
    suggestions: [{ source: "suggested-default", value: "demo" }],
  });
  assert.equal(active.questions[1].state.status, "unresolved");
});

test("inspect_pack rejects malformed question metadata with complete attribution", () => {
  const ports = makePorts({
    files: {
      [`${INSTALL}/capabilities/demo/profile.template.json`]: JSON.stringify({
        ask: [
          {
            id: "duplicate",
            destination: "same",
            prompt: "First?",
            schema: { type: "boolean", unexpected: true },
          },
          {
            id: "duplicate",
            destination: "same",
            prompt: "Second?",
            schema: { type: "integer", minimum: 1 },
          },
        ],
      }),
    },
  });
  const svc = new ResolverService(ports);
  const inspected = svc.inspectPack("wf-demo@local");

  assert.equal(inspected.valid, false);
  assert.deepEqual(inspected.capabilities[0].questions, []);
  assert.ok(inspected.capabilities[0].questionDiagnostics.length >= 3);
  assert.ok(
    inspected.capabilities[0].questionDiagnostics.every(
      (issue) => issue.pack === "demo" && issue.question !== null && issue.field.length > 0,
    ),
  );
  assert.ok(inspected.issues.every((issue) => issue.includes("pack `demo`")));
  const registered = svc.registerPack("wf-demo@local", inspected.fingerprint!);
  assert.equal(registered.status, "rejected");
  assert.match(registered.reason ?? "", /invalid pack metadata/);
  assert.equal(ports.counts.writeFile, 0);
});

test("inspect_pack bounds combined question issues after all capabilities", () => {
  const invalidTemplate = JSON.stringify({
    ask: [
      {
        ...Object.fromEntries(
          Array.from({ length: 200 }, (_, index) => [`unknown-${index}`, true]),
        ),
        id: "name",
        destination: "name",
        prompt: "Name?",
        schema: { type: "string" },
      },
    ],
  });
  const ports = makePorts({
    files: {
      [`${INSTALL}/capabilities/demo/profile.template.json`]: invalidTemplate,
      [`${INSTALL}/capabilities/other/manifest.md`]: DEMO_MANIFEST,
      [`${INSTALL}/capabilities/other/profile.template.json`]: invalidTemplate,
    },
  });
  const inspected = new ResolverService(ports).inspectPack("wf-demo@local");

  assert.equal(inspected.valid, false);
  assert.equal(
    inspected.issues.at(-1),
    "additional question diagnostics omitted after aggregate limit.",
  );
  assert.ok(inspected.issues.length <= MAX_QUESTION_DIAGNOSTICS);
  assert.ok(
    Buffer.byteLength(JSON.stringify(inspected.issues), "utf8") <=
      MAX_NORMALIZED_QUESTION_BYTES,
  );

  const diagnostics = inspected.capabilities.flatMap(
    (capability) => capability.questionDiagnostics,
  );
  assert.equal(diagnostics.at(-1)?.code, "question/diagnostics-truncated");
  assert.ok(diagnostics.length <= MAX_QUESTION_DIAGNOSTICS);
  assert.ok(
    Buffer.byteLength(JSON.stringify(diagnostics), "utf8") <=
      MAX_NORMALIZED_QUESTION_BYTES,
  );
});

test("active invalid persisted values fail metadata exposure without a partial question set", () => {
  const ports = makePorts({
    files: {
      [`${WS}/_local/profiles/demo.profile.json`]: JSON.stringify({ mode: "unknown" }),
    },
  });
  const svc = new ResolverService(ports);
  const inspected = svc.inspectPack("wf-demo@local");
  assert.equal(svc.registerPack("wf-demo@local", inspected.fingerprint!).status, "registered");

  const active = svc.resolveRegistry().capabilities.find((capability) => capability.name === "demo");
  assert.ok(active);
  assert.deepEqual(active.questions, []);
  const lifecycle = svc.inspect();
  assert.ok(
    lifecycle.diagnostics.some(
      (entry) => entry.code === "question/value-enum" && entry.message.includes("question `mode`"),
    ),
  );
});

test("malformed persisted-profile diagnostics never echo parser excerpts", () => {
  const sentinel = "PERSISTED_SECRET_4e8a";
  const ports = makePorts({
    files: {
      [`${WS}/_local/profiles/demo.profile.json`]: `{"mode":"${sentinel}",`,
    },
  });
  const svc = new ResolverService(ports);
  const inspected = svc.inspectPack("wf-demo@local");
  assert.equal(svc.registerPack("wf-demo@local", inspected.fingerprint!).status, "registered");

  const lifecycle = svc.inspect();
  const issue = lifecycle.diagnostics.find(
    (entry) => entry.code === "question/persisted-unparseable",
  );
  assert.equal(
    issue?.message,
    "pack `demo`, field `profile`: persisted question answers must be valid JSON.",
  );
  assert.ok(!JSON.stringify(lifecycle.diagnostics).includes(sentinel));
  assert.deepEqual(
    svc.resolveRegistry().capabilities.find((capability) => capability.name === "demo")
      ?.questions,
    [],
  );
});

test("active malformed template metadata emits pack-attributed resolver diagnostics", () => {
  const ports = makePorts({
    files: {
      [`${WS}/_local/config.md`]: `${BASE_CONFIG}\n## Capabilities\n\n| Capability | Path |\n|---|---|\n| bad | capabilities/bad |\n`,
      [`${WS}/capabilities/bad/manifest.md`]: `# bad\n\n**Kind:** adapter\n\nprofile-template: profile.template.json\n`,
      [`${WS}/capabilities/bad/profile.template.json`]: JSON.stringify({
        ask: [
          {
            id: "broken",
            destination: "broken",
            prompt: "Broken?",
            schema: { type: "integer", maximum: 2 },
          },
        ],
      }),
    },
  });
  const svc = new ResolverService(ports);
  svc.refresh();

  const bad = svc.resolveRegistry().capabilities.find((capability) => capability.name === "bad");
  assert.ok(bad);
  assert.deepEqual(bad.questions, []);
  assert.ok(
    svc.inspect().diagnostics.some(
      (entry) =>
        entry.code === "question/schema-incomplete-bounds" &&
        entry.message.includes("pack `bad`, question `broken`"),
    ),
  );
});

// --- register_pack: success path ------------------------------------------

test("register_pack writes the registry, refreshes, and self-checks ok", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);

  // Before: the capability is not registered.
  assert.equal(svc.resolveRegistry().capabilities.length, 0);

  const insp = svc.inspectPack("wf-demo@local");
  assert.equal(insp.valid, true);
  assert.equal(insp.capabilities.length, 1);
  assert.equal(insp.capabilities[0].path, "plugin:wf-demo/capabilities/demo");

  const before = ports.counts.resolveFresh;
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint!);
  assert.equal(reg.status, "registered");
  assert.equal(reg.selfCheck, "ok");
  assert.deepEqual(reg.capabilities, ["demo"]);

  // The registry file gained both rows.
  const written = ports.files.get(normalizeSlashes(`${WS}/_local/config.md`))!;
  assert.match(written, /## Plugin Roots/);
  assert.match(written, /wf-demo\s*\|\s*\/ws\/packs\/wf-demo/);
  assert.match(written, /## Capabilities/);
  assert.match(written, /demo\s*\|\s*plugin:wf-demo\/capabilities\/demo/);

  // The snapshot was refreshed (rebuilt) so the capability is now resolvable.
  assert.ok(ports.counts.resolveFresh > before, "register triggered a refresh");
  const view = svc.resolveRegistry();
  assert.ok(view.capabilities.some((c) => c.name === "demo" && c.validity === "ok"));
  const provider = svc.resolveProvider("delivery");
  assert.equal(provider.owner, "demo");
  assert.equal(provider.state, "ok");
});

// --- register_pack: every rejection writes nothing ------------------------

test("register_pack rejects a not-installed pack without writing", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const reg = svc.registerPack("wf-absent@local", "anything");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /not installed/);
  assert.equal(ports.counts.writeFile, 0);
});

test("register_pack rejects a disabled pack without writing", () => {
  const ports = makePorts({ pluginList: DISABLED_LIST });
  const svc = new ResolverService(ports);
  const insp = svc.inspectPack("wf-demo@local");
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint ?? "x");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /disabled/);
  assert.equal(ports.counts.writeFile, 0);
});

test("register_pack rejects a stale fingerprint without writing", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const reg = svc.registerPack("wf-demo@local", "stale-fingerprint-value");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /stale fingerprint/);
  assert.equal(ports.counts.writeFile, 0);
});

test("register_pack rejects a pack with no readable manifest without writing", () => {
  // Pack installed + enabled, but no capabilities/*/manifest.md present.
  const ports = makePorts({
    files: {},
  });
  // Remove the demo manifest so the pack has no valid capability.
  ports.files.delete(normalizeSlashes(`${INSTALL}/capabilities/demo/manifest.md`));
  const svc = new ResolverService(ports);
  const insp = svc.inspectPack("wf-demo@local");
  assert.equal(insp.valid, false);
  const reg = svc.registerPack("wf-demo@local", insp.fingerprint ?? "x");
  assert.equal(reg.status, "rejected");
  assert.match(reg.reason ?? "", /path-invalid or manifest-invalid/);
  assert.equal(ports.counts.writeFile, 0);
});

test("register_pack rejects invalid registryPath shapes without writing", () => {
  const cases = [
    ["../outside.md", /\.\.' segment/],
    ["/outside.md", /absolute path/],
    ["C:/outside.md", /drive-prefixed path/],
    ["_local\\config.md", /backslash/],
  ] as const;

  for (const [registryPath, reason] of cases) {
    const ports = makePorts({ registryPath });
    const svc = new ResolverService(ports);
    const inspected = svc.inspectPack("wf-demo@local");
    const registered = svc.registerPack("wf-demo@local", inspected.fingerprint!);
    assert.equal(registered.status, "rejected", registryPath);
    assert.match(registered.reason ?? "", reason, registryPath);
    assert.equal(ports.counts.writeFile, 0, registryPath);
  }
});

test("register_pack rejects a symlink escape before mutation", () => {
  const fixture = mkdtempSync(join(tmpdir(), "wf-registry-containment-"));
  try {
    const workspace = join(fixture, "workspace");
    const outside = join(fixture, "outside");
    mkdirSync(workspace);
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, "linked"), "junction");

    const ports = makePorts({ registryPath: "linked/config.md" });
    ports.resolveRegistryWritePath = (registryPath) =>
      resolveContainedRegistryWritePath(workspace, registryPath);
    const svc = new ResolverService(ports);
    const inspected = svc.inspectPack("wf-demo@local");
    const registered = svc.registerPack("wf-demo@local", inspected.fingerprint!);
    assert.equal(registered.status, "rejected");
    assert.match(registered.reason ?? "", /escapes the selected workspace/);
    assert.equal(ports.counts.writeFile, 0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

// --- inspect_pack graceful CLI-unavailable --------------------------------

test("inspect_pack reports a CLI-unavailable failure without throwing", () => {
  const ports = makePorts({ pluginList: null });
  const svc = new ResolverService(ports);
  const insp = svc.inspectPack("wf-demo@local");
  assert.equal(insp.installed, false);
  assert.equal(insp.valid, false);
  assert.ok(insp.issues.some((i) => /unavailable/.test(i)));
});

// --- provider degradation for an unowned surface --------------------------

test("resolve_provider on an unowned surface degrades per class (no throw)", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  const delivery = svc.resolveProvider("delivery");
  assert.equal(delivery.state, "unconfigured");
  assert.equal(delivery.degradation, "delivery-block");
  const tracker = svc.resolveProvider("tracker");
  assert.equal(tracker.degradation, "tracker-warn");
});

// --- WF-319: composite <-> bare qa-execution surface resolution -----------

const ENGINE_MANIFEST = `# engine-cap capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| qa-execution | provider | \`subagent: wf-browser-qa:qa-engine\` | engine |
`;

const HOST_MANIFEST = `# host-cap capability

**Kind:** adapter

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| qa-execution | provider | \`subagent: wf-angular:qa-host\` | host |
`;

const ENGINE_HOST_CONFIG = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Capabilities

| Capability | Path |
|------------|------|
| engine-cap | capabilities/engine-cap |
| host-cap   | capabilities/host-cap |
`;

/** A ports double with `engine-cap` / `host-cap` pre-registered (repo-relative
 *  paths — no plugin/install indirection needed) so resolveProvider can be
 *  exercised against a real owner without going through register_pack. */
function makeEngineHostPorts() {
  return makePorts({
    files: {
      [`${WS}/_local/config.md`]: ENGINE_HOST_CONFIG,
      [`${WS}/capabilities/engine-cap/manifest.md`]: ENGINE_MANIFEST,
      [`${WS}/capabilities/host-cap/manifest.md`]: HOST_MANIFEST,
    },
  });
}

test("resolve_provider: composite qa-execution:engine resolves identically to bare engine", () => {
  const ports = makeEngineHostPorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  const composite = svc.resolveProvider("qa-execution:engine");
  const bare = svc.resolveProvider("engine");
  assert.equal(composite.owner, "engine-cap");
  assert.equal(composite.state, "ok");
  assert.equal(composite.degradation, "ok");
  assert.equal(bare.owner, "engine-cap");
  assert.equal(bare.state, "ok");
  assert.equal(bare.degradation, "ok");
  assert.equal(composite.owner, bare.owner);
  assert.equal(composite.state, bare.state);
  assert.equal(composite.degradation, bare.degradation);
  assert.equal(composite.fragmentPath, bare.fragmentPath);
});

test("resolve_provider: composite qa-execution:host resolves identically to bare host", () => {
  const ports = makeEngineHostPorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  const composite = svc.resolveProvider("qa-execution:host");
  const bare = svc.resolveProvider("host");
  assert.equal(composite.owner, "host-cap");
  assert.equal(composite.state, "ok");
  assert.equal(composite.degradation, "ok");
  assert.equal(bare.owner, "host-cap");
  assert.equal(bare.state, "ok");
  assert.equal(bare.degradation, "ok");
  assert.equal(composite.owner, bare.owner);
  assert.equal(composite.state, bare.state);
  assert.equal(composite.degradation, bare.degradation);
  assert.equal(composite.fragmentPath, bare.fragmentPath);
});

test("resolve_provider: bare delivery/tracker/engine/host still resolve as before (regression guard)", () => {
  // Bare delivery/tracker on an unowned registry (existing behaviour, untouched).
  const bareOnly = makePorts();
  const svcBare = new ResolverService(bareOnly);
  svcBare.refresh();
  assert.equal(svcBare.resolveProvider("delivery").state, "unconfigured");
  assert.equal(svcBare.resolveProvider("delivery").degradation, "delivery-block");
  assert.equal(svcBare.resolveProvider("tracker").state, "unconfigured");
  assert.equal(svcBare.resolveProvider("tracker").degradation, "tracker-warn");

  // Bare engine/host on a registry where they ARE owned — the documented
  // workaround this fix must not regress.
  const ports = makeEngineHostPorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  assert.equal(svc.resolveProvider("engine").owner, "engine-cap");
  assert.equal(svc.resolveProvider("engine").state, "ok");
  assert.equal(svc.resolveProvider("host").owner, "host-cap");
  assert.equal(svc.resolveProvider("host").state, "ok");
});

test("resolve_provider: genuine no-owner qa-execution:engine returns unconfigured with engine-block degradation", () => {
  const ports = makePorts(); // default fixture — no engine/host capability registered
  const svc = new ResolverService(ports);
  svc.refresh();
  const composite = svc.resolveProvider("qa-execution:engine");
  assert.equal(composite.state, "unconfigured");
  assert.equal(composite.owner, null);
  assert.equal(composite.degradation, "engine-block");
  const bare = svc.resolveProvider("engine");
  assert.equal(bare.state, "unconfigured");
  assert.equal(bare.degradation, "engine-block");
});

test("resolve_provider: unrecognized surface token throws a distinct signal, not state:unconfigured", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  svc.refresh();
  assert.throws(() => svc.resolveProvider("qa-exec:engine"), /unknown surface/);
  assert.throws(() => svc.resolveProvider("bogus"), /unknown surface/);
});

// --- WF-488: the executing core plugin's declared version -------------------
//
// The defect this closes: a full unattended run executed a CACHED plugin version
// while trunk had already moved, and nothing in any artifact recorded which
// version had actually run. The version must therefore be SERVED, and — because
// `resolve_config` is the one query every skill makes before it does anything —
// an unreadable manifest must degrade to a reportable `null` rather than throw.

const CORE_MANIFEST = `${CORE}/.claude-plugin/plugin.json`;

test("coreVersion: resolve_config serves the declared version of the EXECUTING core plugin", () => {
  const ports = makePorts({
    files: { [CORE_MANIFEST]: JSON.stringify({ name: "wf", version: "9.9.9" }) },
  });
  const svc = new ResolverService(ports);
  assert.equal(svc.resolveConfig().coreVersion, "9.9.9");
});

test("coreVersion: the version is read from the plugin root the SERVER runs from, not the workspace", () => {
  // A workspace-local manifest carrying a DIFFERENT version must not win: the
  // reported version is the one executing, which is precisely the distinction
  // that went unnoticed when a cached install trailed trunk.
  const ports = makePorts({
    files: {
      [CORE_MANIFEST]: JSON.stringify({ version: "0.116.0" }),
      [`${WS}/plugins/wf/.claude-plugin/plugin.json`]: JSON.stringify({ version: "0.117.0" }),
    },
  });
  const svc = new ResolverService(ports);
  assert.equal(svc.resolveConfig().coreVersion, "0.116.0");
});

test("coreVersion: an unreadable manifest degrades to null and resolve_config still answers", () => {
  const ports = makePorts(); // the default fixture seeds no core plugin manifest
  const svc = new ResolverService(ports);
  const config = svc.resolveConfig();
  assert.equal(config.coreVersion, null);
  // Degradation is confined to the one field — the query is otherwise unaffected.
  assert.equal(config.workspaceRoot, WS);
  assert.equal(config.registryPath, "_local/config.md");
});

test("coreVersion: every malformed-manifest shape degrades to null and nothing throws", () => {
  const cases: Array<[string, string]> = [
    ["not JSON at all", "{{{ not json"],
    ["JSON that is not an object", '"just a string"'],
    ["a JSON array", '[{"version":"1.2.3"}]'],
    ["an object with no version key", '{"name":"wf"}'],
    ["a non-string version", '{"version":123}'],
    ["a null version", '{"version":null}'],
    ["an empty version", '{"version":""}'],
    ["a whitespace-only version", '{"version":"   "}'],
  ];
  for (const [label, body] of cases) {
    const ports = makePorts({ files: { [CORE_MANIFEST]: body } });
    const svc = new ResolverService(ports);
    assert.equal(svc.resolveConfig().coreVersion, null, `expected null for ${label}`);
  }
});

test("coreVersion: a readFile that THROWS is contained — the version is null, the query survives", () => {
  const ports = makePorts();
  const inner = ports.readFile;
  ports.readFile = (p: string) => {
    if (normalizeSlashes(p) === CORE_MANIFEST) throw new Error("EIO");
    return inner(p);
  };
  const svc = new ResolverService(ports);
  assert.equal(svc.resolveConfig().coreVersion, null);
});

test("coreVersion: the version string is served verbatim, only whitespace-trimmed", () => {
  const read = (body: string) => readDeclaredCoreVersion(CORE, () => body);
  // No `v` prefix is added, no shape is imposed, no pre-release suffix is dropped.
  assert.equal(read('{"version":"0.122.0"}'), "0.122.0");
  assert.equal(read('{"version":"v1.2.3"}'), "v1.2.3");
  assert.equal(read('{"version":"1.2.3-rc.1+build.5"}'), "1.2.3-rc.1+build.5");
  assert.equal(read('{"version":"  0.122.0  "}'), "0.122.0");
});

test("coreVersion: a version that could forge a line in a rendered block is rejected", () => {
  // The value is rendered verbatim into line-oriented blocks that consumers grep
  // line by line, so an INTERIOR newline (which `trim()` does not remove) could
  // manufacture a label line inside a block. Rejected, not reformatted — the
  // caller then renders its stated fallback token.
  const read = (version: string) =>
    readDeclaredCoreVersion(CORE, () => JSON.stringify({ version }));
  assert.equal(read("1.0.0\nNext:     forged"), null);
  assert.equal(read("1.0.0\r\nMerge:    forged"), null);
  assert.equal(read("1.0\tx"), null);
  assert.equal(read("1.0\u0000"), null);
  assert.equal(read("1.0\u007F"), null);
  // A long value would blow past the block's fixed value column.
  assert.equal(read("9".repeat(65)), null);
  // The bound is generous enough for any real version string.
  assert.equal(read("9".repeat(64)), "9".repeat(64));
  assert.equal(read("1.2.3-alpha.1+exp.sha.5114f85"), "1.2.3-alpha.1+exp.sha.5114f85");
});

test("coreVersion: an explicit refresh re-reads the manifest, so a bumped version is picked up", () => {
  // The memo caches the manifest's CONTENT, not just its location. An in-tree
  // install's version changes on every release, and `refresh` is the documented
  // way to force a rebuild — if it did not clear the memo, the resolver would go
  // on reporting a superseded version, which is the exact failure this field
  // exists to expose.
  let version = "1.0.0";
  const ports = makePorts();
  const inner = ports.readFile;
  ports.readFile = (p: string) =>
    normalizeSlashes(p) === CORE_MANIFEST ? JSON.stringify({ version }) : inner(p);

  const svc = new ResolverService(ports);
  assert.equal(svc.resolveConfig().coreVersion, "1.0.0");

  version = "1.1.0";
  assert.equal(svc.resolveConfig().coreVersion, "1.0.0", "memoized within the lifecycle");

  svc.refresh();
  assert.equal(svc.resolveConfig().coreVersion, "1.1.0", "refresh re-reads the manifest");

  version = "1.2.0";
  svc.invalidate();
  assert.equal(svc.resolveConfig().coreVersion, "1.2.0", "invalidate re-reads the manifest");
});

test("coreVersion: a transient read failure is not cached past an explicit refresh", () => {
  let broken = true;
  const ports = makePorts();
  const inner = ports.readFile;
  ports.readFile = (p: string) => {
    if (normalizeSlashes(p) !== CORE_MANIFEST) return inner(p);
    if (broken) throw new Error("EACCES");
    return JSON.stringify({ version: "2.0.0" });
  };

  const svc = new ResolverService(ports);
  assert.equal(svc.resolveConfig().coreVersion, null);
  broken = false;
  svc.refresh();
  assert.equal(svc.resolveConfig().coreVersion, "2.0.0");
});

test("coreVersion: the manifest is read at most ONCE per process, so the prerequisite stays cheap", () => {
  const ports = makePorts({
    files: { [CORE_MANIFEST]: JSON.stringify({ version: "1.0.0" }) },
  });
  const inner = ports.readFile;
  let manifestReads = 0;
  ports.readFile = (p: string) => {
    if (normalizeSlashes(p) === CORE_MANIFEST) manifestReads++;
    return inner(p);
  };
  const svc = new ResolverService(ports);
  svc.resolveConfig();
  svc.resolveConfig();
  svc.resolveConfig();
  assert.equal(manifestReads, 1);
});

test("coreVersion: an absent manifest is a CACHED null — repeated queries do not re-probe", () => {
  const ports = makePorts();
  const inner = ports.readFile;
  let manifestReads = 0;
  ports.readFile = (p: string) => {
    if (normalizeSlashes(p) === CORE_MANIFEST) manifestReads++;
    return inner(p);
  };
  const svc = new ResolverService(ports);
  assert.equal(svc.resolveConfig().coreVersion, null);
  assert.equal(svc.resolveConfig().coreVersion, null);
  assert.equal(manifestReads, 1);
});

test("coreVersion: serving the version leaks no body into the metadata response", () => {
  const ports = makePorts({
    files: { [CORE_MANIFEST]: JSON.stringify({ version: "1.0.0", description: "SECRET-BODY" }) },
  });
  const svc = new ResolverService(ports);
  const metadata = JSON.stringify(svc.resolveConfig());
  assert.ok(!metadata.includes("SECRET-BODY"));
  assert.ok(metadata.includes("1.0.0"));
});
