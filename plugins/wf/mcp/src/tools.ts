// wf resolver — typed MCP query tools (WF-270).
//
// Registers the plugin-local typed resolver service (service.ts) as MCP tools
// on the bundled server. These tools ARE the resolver service surface every
// normal skill and isolated subagent calls; there is no shell/CLI/plugin-root
// probe for a normal consumer. Every response is bounded metadata / normalized
// paths / enums / small maps — the public query response/error contract
// EXCLUDES fragment bodies (the service only ever projects the body-free
// snapshot; it never reads a fragment/skill/prompt body).
//
// Input schemas are declared as JSON Schema and adapted via the SDK's
// `fromJsonSchema`, so no zod dependency is added and the pinned
// @modelcontextprotocol/server v2-beta schema contract is honored.

import { McpServer, fromJsonSchema } from "@modelcontextprotocol/server";
import type { ResolverService } from "./service.js";
import type { ContentRef } from "./resolver/content.js";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/** Wrap a JSON-serializable payload as a text-content + structuredContent result. */
function ok(payload: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

/** Run a service call, mapping any unexpected throw to an MCP error result. */
function guard(fn: () => unknown): ToolResult {
  try {
    return ok(fn());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `resolver error: ${message}` }],
      isError: true,
    };
  }
}

const surfaceInput = fromJsonSchema({
  type: "object",
  properties: {
    surface: {
      type: "string",
      description:
        "Provider surface to resolve: `delivery`, `tracker`, `qa-execution:engine`, or `qa-execution:host`.",
    },
  },
  required: ["surface"],
  additionalProperties: false,
});

const surfaceClassInput = fromJsonSchema({
  type: "object",
  properties: {
    surface: {
      type: "string",
      enum: ["local-read", "tracker-write", "delivery-write"],
      description:
        "The surface class about to act: `local-read` (best-effort read), `tracker-write`, or `delivery-write`.",
    },
  },
  required: ["surface"],
  additionalProperties: false,
});

const capabilityInput = fromJsonSchema({
  type: "object",
  properties: {
    capability: { type: "string", description: "Registered capability name." },
  },
  required: ["capability"],
  additionalProperties: false,
});

const pluginInput = fromJsonSchema({
  type: "object",
  properties: {
    plugin: { type: "string", description: "Plugin name (left of `@`)." },
  },
  required: ["plugin"],
  additionalProperties: false,
});

const pluginIdInput = fromJsonSchema({
  type: "object",
  properties: {
    pluginId: {
      type: "string",
      description: "Stable plugin id (`<name>@<marketplace>` or bare `<name>`).",
    },
  },
  required: ["pluginId"],
  additionalProperties: false,
});

const contentInput = fromJsonSchema({
  type: "object",
  properties: {
    class: {
      type: "string",
      enum: ["fragment", "contract", "shared", "references-template", "profile-template"],
      description:
        "The logical content-ref class: `fragment` (a capability fragment body), `contract` (a `_contracts/*` ops doc), `shared` (a `_shared/*` convention doc), `references-template` (a skill `references/*` template), or `profile-template` (a pack's `profile.template.json` body). Skill bodies and CI-only fixtures are not served.",
    },
    capability: {
      type: "string",
      description: "Registered capability name — required for `fragment` and `profile-template`.",
    },
    plugin: {
      type: "string",
      description:
        "Plugin name for a pack-owned `references-template`; omit (or use `wf`/`core`) for a core-plugin skill.",
    },
    skill: {
      type: "string",
      description: "Skill slug — required for `references-template`.",
    },
    ref: {
      type: "string",
      description:
        "The relative doc ref: within the capability folder, subfolder included — e.g. `fragments/tracker.ops.md`, never the bare filename (`fragment`); a bare filename (`contract` / `shared`); or within the skill's `references/` folder (`references-template`). Unused by `profile-template`.",
    },
  },
  required: ["class"],
  additionalProperties: false,
});

const registerInput = fromJsonSchema({
  type: "object",
  properties: {
    pluginId: {
      type: "string",
      description: "Stable plugin id (`<name>@<marketplace>` or bare `<name>`).",
    },
    expectedFingerprint: {
      type: "string",
      description:
        "The pack fingerprint returned by a prior inspect_pack; a mismatch rejects the write.",
    },
  },
  required: ["pluginId", "expectedFingerprint"],
  additionalProperties: false,
});

const reasonsInput = fromJsonSchema({
  type: "object",
  properties: {
    reasons: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional typed suspected-stale reasons (one short message each) recorded as diagnostics on the resulting lifecycle state.",
    },
  },
  additionalProperties: false,
});

/** Map optional caller-supplied reason strings to typed StaleReasons. */
function toReasons(reasons: string[] | undefined, code: string): Array<{ code: string; message: string }> {
  return (reasons ?? [])
    .filter((r) => typeof r === "string" && r.trim().length > 0)
    .map((message) => ({ code, message: message.trim() }));
}

/** Register every typed resolver tool on the server, backed by one service. */
export function registerResolverTools(server: McpServer, service: ResolverService): void {
  server.registerTool(
    "resolve_config",
    {
      title: "resolve config",
      description:
        "Resolved core config + workspace root + registry location + id shape (R1). Metadata only; no fragment bodies.",
    },
    async () => guard(() => service.resolveConfig()),
  );

  server.registerTool(
    "resolve_registry",
    {
      title: "resolve registry",
      description:
        "The ordered active capability registry as metadata (R2): name, kind, resolved/manifest paths, provenance, validity, fragment dispatch metadata, articles, requires/conflicts. Never a fragment body.",
    },
    async () => guard(() => service.resolveRegistry()),
  );

  server.registerTool(
    "resolve_provider",
    {
      title: "resolve provider",
      description:
        "One provider surface's resolution record (R3): owner, dispatch fragment path, state, and the degradation class a consumer reproduces. No fragment body.",
      inputSchema: surfaceInput,
    },
    async (args: { surface: string }) => guard(() => service.resolveProvider(args.surface)),
  );

  server.registerTool(
    "resolve_profile",
    {
      title: "resolve profile",
      description:
        "Override-merged profile VALUES for a capability (R4). Values only; never a template or body.",
      inputSchema: capabilityInput,
    },
    async (args: { capability: string }) =>
      guard(() => service.resolveProfile(args.capability)),
  );

  server.registerTool(
    "resolve_plugin_root",
    {
      title: "resolve plugin root",
      description:
        "A plugin's resolved install root + provenance, post-self-heal (R5). One path record.",
      inputSchema: pluginInput,
    },
    async (args: { plugin: string }) => guard(() => service.resolvePluginRoot(args.plugin)),
  );

  server.registerTool(
    "resolve_content",
    {
      title: "resolve content",
      description:
        "Resolve + read a bundled-doc BODY for one of five logical content-ref classes (fragment | contract | shared | references-template | profile-template), read by the server's own Node fs. Returns `{status: served, path, content}` on success; on an unresolvable/unrecoverable ref returns `{status: unresolved}` with the matching resolve_gate degradation class + a `/wf:resolve` recovery path (never a wrong-path body, never a raw-read fall-through); an out-of-class ref (skill body, CI-only fixture) returns `{status: refused}`. The distinct body-serving path — the metadata queries stay body-free.",
      inputSchema: contentInput,
    },
    async (args: ContentRef) => guard(() => service.resolveContent(args)),
  );

  server.registerTool(
    "inspect_pack",
    {
      title: "inspect pack",
      description:
        "Read-only pack inspection (R6): resolves a plugin id via `claude plugin list --json`, validates enabled state / version / installPath and the pack manifest(s), and returns a fingerprint. Writes nothing.",
      inputSchema: pluginIdInput,
    },
    async (args: { pluginId: string }) => guard(() => service.inspectPack(args.pluginId)),
  );

  server.registerTool(
    "register_pack",
    {
      title: "register pack",
      description:
        "Mutating pack registration (R6). Rejects a missing / disabled / stale-fingerprint / path-invalid / manifest-invalid request WITHOUT writing; on success owns the registry write, refreshes the snapshot, and self-checks. Core does not infer skill provenance.",
      inputSchema: registerInput,
    },
    async (args: { pluginId: string; expectedFingerprint: string }) =>
      guard(() => service.registerPack(args.pluginId, args.expectedFingerprint)),
  );

  server.registerTool(
    "resolve_gate",
    {
      title: "resolve gate",
      description:
        "Surface-specific resolver-failure gate (WF-272). Given the current resolver health and the acting surface (`local-read` | `tracker-write` | `delivery-write`), returns the reaction (continue | warn | block), the failure categories, categorized diagnostics with a `/wf:resolve` recovery path, and a marker proving the failure path never re-walks folders or probes the environment. A local read continues best-effort, a tracker write warns and continues, a delivery write blocks before any mutation.",
      inputSchema: surfaceClassInput,
    },
    async (args: { surface: "local-read" | "tracker-write" | "delivery-write" }) =>
      guard(() => service.assessSurface(args.surface)),
  );

  // --- lifecycle (the /wf:resolve skill routes through these) --------------
  server.registerTool(
    "resolve_inspect",
    {
      title: "resolve inspect",
      description:
        "Lifecycle state of the resolved view: validity, cache presence, generatedAt, counts, and diagnostics. Does not rebuild.",
    },
    async () => guard(() => service.inspect()),
  );

  server.registerTool(
    "resolve_refresh",
    {
      title: "resolve refresh",
      description:
        "Rebuild the resolved view from current inputs and persist it. Returns the fresh lifecycle state. Optional `reasons` are recorded as diagnostics explaining the refresh.",
      inputSchema: reasonsInput,
    },
    async (args: { reasons?: string[] }) =>
      guard(() => service.refresh(toReasons(args?.reasons, "explicit-request"))),
  );

  server.registerTool(
    "resolve_invalidate",
    {
      title: "resolve invalidate",
      description:
        "Mark the resolved view invalid so the next query (or an explicit refresh) rebuilds it. Typed consumers may pass `reasons` (suspected-stale messages) which surface as diagnostics. Returns the lifecycle state.",
      inputSchema: reasonsInput,
    },
    async (args: { reasons?: string[] }) =>
      guard(() => service.invalidate(toReasons(args?.reasons, "suspected-stale"))),
  );
}
