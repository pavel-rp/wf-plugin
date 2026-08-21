// Content surface contract tests (WF-302, C011 SUB-1).
//
// The frozen validator + fixtures for the resolver MCP content tool. Drives
// ResolverService.resolveContent over an in-memory ports double (no real
// filesystem, no `claude` CLI) to assert:
//   - each of the FIVE served ref classes returns the correct `{path, content}`,
//     read by the server's own fs port — with no wrong-body leak;
//   - a ref whose recorded plugin root dangles and self-heal recovers nothing
//     reports the matching `resolve_gate` degradation class (registry-invalid,
//     local-read → continue) with a `/wf:resolve` recovery path — never a
//     wrong-path body, never a raw-read fall-through;
//   - a ref that joins to a nonexistent file under a VALID resolved root is the
//     caller-input `ref-not-found` (never `registry-invalid`), with a recovery
//     naming the subfolder-inclusive ref shape;
//   - a skill body / CI-only fixture / traversal / malformed ref is REFUSED;
//   - the metadata-query snapshot stays BODY-FREE (C008 invariant intact) — the
//     served bodies never leak into any metadata response.

import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSnapshot } from "../src/resolver/engine.js";
import {
  joinSlash,
  normalizeSlashes,
  type ContainedFileReadResult,
} from "../src/resolver/paths.js";
import { parsePluginList } from "../src/resolver/plugin-list.js";
import { MAX_PROFILE_TEMPLATE_BYTES } from "../src/resolver/questions.js";
import { ResolverService, type ResolverServicePorts } from "../src/service.js";
import type { ResolverSnapshot } from "../src/resolver/types.js";

const WS = "/ws";
const CORE = "/core/plugins/wf";
const PACK = "/ws/packs/wf-demo";

// Distinctive bodies, one per served doc, so a wrong-path body is caught.
const FRAG_BODY = "FRAGMENT_BODY_delivery_ops_marker";
const PROFILE_BODY = '{ "PROFILE_TEMPLATE_BODY_marker": true }';
const CONTRACT_BODY = "CONTRACT_OPS_BODY_invocation_runtime_marker";
const SHARED_BODY = "SHARED_CONVENTION_BODY_pipeline_marker";
const CORE_REFS_BODY = "CORE_REFERENCES_TEMPLATE_BODY_marker";
const PACK_REFS_BODY = "PACK_REFERENCES_TEMPLATE_BODY_marker";
const SECRET_MANIFEST = "SECRET_MANIFEST_PROSE_marker";

const MANIFEST = `# demo capability

**Kind:** both

${SECRET_MANIFEST} — a manifest paragraph metadata queries must never echo.

profile-template: profile.template.json

## Fragments

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| implement | provider | \`inline: fragments/delivery.ops.md\` | delivery |
`;

const REGISTRY = `# Config

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | \`_local\` |

## Plugin Roots

| Plugin  | Root              |
|---------|-------------------|
| wf-demo | /ws/packs/wf-demo |

## Capabilities

| Capability | Path                              |
|------------|-----------------------------------|
| demo       | plugin:wf-demo/capabilities/demo  |
`;

/** A registry whose `wf-demo` root dangles (points at an empty dir) with NO
 *  installed pack to self-heal from — so `demo` resolves unrecoverable. */
const REGISTRY_DANGLING = REGISTRY.replace("/ws/packs/wf-demo |", "/ws/dangling/void |");

const PLUGIN_LIST = JSON.stringify([
  { id: "wf-demo@local", version: "1.0.0", scope: "user", enabled: true, installPath: PACK },
]);

function makePorts(opts?: {
  registry?: string;
  pluginList?: string | null;
  containedStatus?: Exclude<ContainedFileReadResult["status"], "ok">;
}): ResolverServicePorts & { files: Map<string, string>; readFileCalls: string[] } {
  const files = new Map<string, string>();
  const seed: Record<string, string> = {
    [`${WS}/_local/config.md`]: opts?.registry ?? REGISTRY,
    [`${PACK}/capabilities/demo/manifest.md`]: MANIFEST,
    [`${PACK}/capabilities/demo/fragments/delivery.ops.md`]: FRAG_BODY,
    [`${PACK}/capabilities/demo/profile.template.json`]: PROFILE_BODY,
    [`${PACK}/skills/init/references/onboard.md`]: PACK_REFS_BODY,
    [`${CORE}/skills/_contracts/invocation-runtime.ops.md`]: CONTRACT_BODY,
    [`${CORE}/skills/_shared/pipeline-conventions.md`]: SHARED_BODY,
    [`${CORE}/skills/qa-gen/references/thing.md`]: CORE_REFS_BODY,
  };
  for (const [k, v] of Object.entries(seed)) files.set(normalizeSlashes(k), v);

  const pluginListRaw = opts?.pluginList === undefined ? PLUGIN_LIST : opts.pluginList;
  const readFileCalls: string[] = [];
  const readFile = (p: string): string | null => {
    const normalized = normalizeSlashes(p);
    readFileCalls.push(normalized);
    return files.get(normalized) ?? null;
  };
  const readContainedFile = (
    capabilityRoot: string,
    selectedPath: string,
    maxBytes: number,
  ): ContainedFileReadResult => {
    const path = normalizeSlashes(joinSlash(capabilityRoot, selectedPath));
    if (opts?.containedStatus) {
      return { status: opts.containedStatus, path, content: null };
    }
    const content = files.get(path);
    if (content === undefined) return { status: "missing", path, content: null };
    if (Buffer.byteLength(content, "utf8") > maxBytes) {
      return { status: "too-large", path, content: null };
    }
    return { status: "ok", path, content };
  };
  const io = { readFile, readContainedFile };
  let cache: ResolverSnapshot | null = null;

  return {
    files,
    readFileCalls,
    workspaceRoot: WS,
    corePluginRoot: CORE,
    resolveFresh: () =>
      resolveSnapshot({
        workspaceRoot: WS,
        io,
        pluginListRaw: pluginListRaw ?? undefined,
        now: () => new Date("2026-07-16T00:00:00.000Z"),
        generator: { name: "wf-resolver", version: "0.3.0" },
      }),
    persist: (snap) => {
      cache = snap;
    },
    readCache: () => cache,
    readFile,
    readContainedFile,
    writeFile: (p, content) => files.set(normalizeSlashes(p), content),
    listDirs: () => [],
    listPlugins: () => {
      if (pluginListRaw === null) return { plugins: [], ok: false, contractOk: true, issues: [] };
      const parsed = parsePluginList(pluginListRaw);
      return { plugins: parsed.plugins, ok: true, contractOk: parsed.contractOk, issues: parsed.issues };
    },
    registryRelPath: () => "_local/config.md",
  };
}

// --- all five served classes ----------------------------------------------

test("serves a capability FRAGMENT body by capability + rel ref", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "fragment", capability: "demo", ref: "fragments/delivery.ops.md" });
  assert.equal(r.status, "served");
  if (r.status !== "served") return;
  assert.equal(r.refClass, "fragment");
  assert.equal(r.content, FRAG_BODY);
  assert.match(r.path, /packs\/wf-demo\/capabilities\/demo\/fragments\/delivery\.ops\.md$/);
});

test("serves a CONTRACT ops doc from the core plugin root", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "contract", ref: "invocation-runtime.ops.md" });
  assert.equal(r.status, "served");
  if (r.status !== "served") return;
  assert.equal(r.content, CONTRACT_BODY);
  assert.equal(r.path, `${CORE}/skills/_contracts/invocation-runtime.ops.md`);
});

test("serves a SHARED convention doc from the core plugin root", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "shared", ref: "pipeline-conventions.md" });
  assert.equal(r.status, "served");
  if (r.status !== "served") return;
  assert.equal(r.content, SHARED_BODY);
  assert.equal(r.path, `${CORE}/skills/_shared/pipeline-conventions.md`);
});

test("serves a core skill REFERENCES-TEMPLATE (plugin omitted → core)", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "references-template", skill: "qa-gen", ref: "thing.md" });
  assert.equal(r.status, "served");
  if (r.status !== "served") return;
  assert.equal(r.content, CORE_REFS_BODY);
  assert.equal(r.path, `${CORE}/skills/qa-gen/references/thing.md`);
});

test("serves a pack skill REFERENCES-TEMPLATE via the resolved plugin root", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "references-template", plugin: "wf-demo", skill: "init", ref: "onboard.md" });
  assert.equal(r.status, "served");
  if (r.status !== "served") return;
  assert.equal(r.content, PACK_REFS_BODY);
  assert.match(r.path, /packs\/wf-demo\/skills\/init\/references\/onboard\.md$/);
});

test("serves a pack PROFILE-TEMPLATE body through the bounded contained-file port", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  const r = svc.resolveContent({ class: "profile-template", capability: "demo" });
  assert.equal(r.status, "served");
  if (r.status !== "served") return;
  assert.equal(r.content, PROFILE_BODY);
  assert.match(r.path, /packs\/wf-demo\/capabilities\/demo\/profile\.template\.json$/);
  assert.equal(
    ports.readFileCalls.filter((path) => path.endsWith("/profile.template.json")).length,
    0,
    "profile templates must never use unrestricted readFile",
  );
});

for (const scenario of ["symlink", "non-regular file"]) {
  test(`rejects a ${scenario} PROFILE-TEMPLATE body without path or content`, () => {
    const ports = makePorts({ containedStatus: "unsafe" });
    const svc = new ResolverService(ports);
    const r = svc.resolveContent({ class: "profile-template", capability: "demo" });
    assert.equal(r.status, "unresolved");
    if (r.status !== "unresolved") return;
    assert.equal(r.category, "registry-invalid");
    assert.equal(r.refClass, "profile-template");
    assert.ok(!("content" in r));
    assert.ok(!("path" in r));
    assert.equal(
      ports.readFileCalls.filter((path) => path.endsWith("/profile.template.json")).length,
      0,
      "rejected templates must never fall back to unrestricted readFile",
    );
  });
}

test("rejects a profile template one byte over the body-serving limit", () => {
  const ports = makePorts();
  ports.files.set(
    `${PACK}/capabilities/demo/profile.template.json`,
    "x".repeat(MAX_PROFILE_TEMPLATE_BYTES + 1),
  );
  const svc = new ResolverService(ports);
  const r = svc.resolveContent({ class: "profile-template", capability: "demo" });
  assert.equal(r.status, "unresolved");
  if (r.status !== "unresolved") return;
  assert.equal(r.category, "registry-invalid");
  assert.match(r.message, /maximum allowed size/);
  assert.ok(!("content" in r));
  assert.ok(!("path" in r));
  assert.equal(
    ports.readFileCalls.filter((path) => path.endsWith("/profile.template.json")).length,
    0,
    "oversized templates must never fall back to unrestricted readFile",
  );
});

// --- dangling / unrecoverable → resolve_gate degradation, no body ----------

test("a dangling+unrecoverable capability fragment reports the resolve_gate class, no body", () => {
  const svc = new ResolverService(makePorts({ registry: REGISTRY_DANGLING, pluginList: null }));
  const r = svc.resolveContent({ class: "fragment", capability: "demo", ref: "fragments/delivery.ops.md" });
  assert.equal(r.status, "unresolved");
  if (r.status !== "unresolved") return;
  assert.equal(r.category, "registry-invalid");
  assert.equal(r.reaction, "continue");
  assert.match(r.recovery, /\/wf:resolve/);
  // Never a wrong-path body and never a raw-read fall-through.
  assert.ok(!("content" in r));
  assert.ok(!("path" in r));
});

test("an absent-but-resolved doc is unresolved as ref-not-found (never a raw-read fall-through)", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "contract", ref: "does-not-exist.md" });
  assert.equal(r.status, "unresolved");
  if (r.status !== "unresolved") return;
  assert.equal(r.category, "ref-not-found");
  assert.equal(r.reaction, "continue");
  // The recovery targets the caller's ref shape, not a snapshot refresh.
  assert.match(r.recovery, /subfolder/);
  assert.match(r.recovery, /fragmentPath/);
  assert.match(r.message, /skills\/_contracts\/does-not-exist\.md/);
});

test("a fragment ref missing its subfolder segment is ref-not-found, not registry-invalid", () => {
  // The field-report scenario (WF-312): a registered capability with a valid
  // resolved root, ref given as the bare filename while the doc lives under
  // `fragments/` — a caller-input error, not a registry/pack-root problem.
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "fragment", capability: "demo", ref: "delivery.ops.md" });
  assert.equal(r.status, "unresolved");
  if (r.status !== "unresolved") return;
  assert.equal(r.category, "ref-not-found");
  assert.equal(r.reaction, "continue");
  assert.match(r.message, /capabilities\/demo\/delivery\.ops\.md/);
  assert.match(r.recovery, /fragments\//);
  // Never a wrong-path body and never a raw-read fall-through.
  assert.ok(!("content" in r));
  assert.ok(!("path" in r));
});

// --- refusals: out of the five served classes ------------------------------

test("a skill-body request is refused (class outside the five)", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "skill", skill: "qa-gen", ref: "SKILL.md" } as never);
  assert.equal(r.status, "refused");
});

test("a fragment ref naming SKILL.md is refused as a skill body", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "fragment", capability: "demo", ref: "SKILL.md" });
  assert.equal(r.status, "refused");
  if (r.status !== "refused") return;
  assert.match(r.reason, /skill body/i);
});

test("a CI-only fixture under a sub-path is refused (contract stays bare-filename)", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "contract", ref: "registry-fixtures/installed_plugins.fixture.json" });
  assert.equal(r.status, "refused");
});

test("a non-.md validator script is refused", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "contract", ref: "validate-registry.sh" });
  assert.equal(r.status, "refused");
});

test("a path-traversal ref is refused", () => {
  const svc = new ResolverService(makePorts());
  const r = svc.resolveContent({ class: "fragment", capability: "demo", ref: "../../../etc/passwd.md" });
  assert.equal(r.status, "refused");
});

// --- C008 body-free invariant intact ---------------------------------------

test("serving content never leaks bodies into the metadata snapshot queries", () => {
  const ports = makePorts();
  const svc = new ResolverService(ports);
  // Serve every class first (populates nothing persistent — bodies are read on
  // demand), then confirm the metadata queries carry no served body.
  svc.resolveContent({ class: "fragment", capability: "demo", ref: "fragments/delivery.ops.md" });
  svc.resolveContent({ class: "profile-template", capability: "demo" });

  const metadata = JSON.stringify([svc.resolveConfig(), svc.resolveRegistry(), svc.inspect()]);
  for (const body of [FRAG_BODY, PROFILE_BODY, CONTRACT_BODY, SHARED_BODY, SECRET_MANIFEST]) {
    assert.ok(!metadata.includes(body), `metadata leaked a body: ${body}`);
  }
  // The dispatch PATH metadata is still expected in the registry projection.
  assert.ok(metadata.includes("fragments/delivery.ops.md"));
});
