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
import {
  planInstall as planInstallJoin,
  type PlanSelectionInput,
} from "./resolver/plan-install.js";
import { selectWorkspaceRoot } from "./workspace-admission.js";
import type { PlanInstallResponse, RoutingInputs } from "./resolver/types.js";

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

const safeTerminalStringPattern = "^[^\\u0000-\\u001F\\u007F-\\u009F]*$";

function terminalSafeDiagnostic(value: unknown): string {
  const message = value instanceof Error ? value.message : String(value);
  return message.replace(/\p{C}/gu, "?").slice(0, 512);
}

/** Run a service call, mapping any unexpected throw to an MCP error result. */
function guard(fn: () => unknown): ToolResult {
  try {
    return ok(fn());
  } catch (err) {
    const message = terminalSafeDiagnostic(err);
    return {
      content: [{ type: "text", text: `resolver error: ${message}` }],
      isError: true,
    };
  }
}

type WorkspaceArgs = { workspaceRoot: string };
type ServiceSelector = (workspaceRoot: string) => ResolverService;

const workspaceRootProperty = {
  type: "string",
  minLength: 1,
  maxLength: 4096,
  pattern: safeTerminalStringPattern,
  description: "Absolute path to a directory in the launch repository's main/linked worktree family.",
};

function withWorkspaceRoot(schema: {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  allOf?: unknown[];
}): Record<string, unknown> {
  return {
    ...schema,
    properties: { workspaceRoot: workspaceRootProperty, ...(schema.properties ?? {}) },
    required: ["workspaceRoot", ...(schema.required ?? [])],
  };
}

const workspaceOnlyInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {},
  additionalProperties: false,
}));

// Deliberately no `enum` here (unlike `surfaceClassInput` below): the
// KNOWN_SURFACES check lives in `resolveProvider` itself so an unrecognized
// token surfaces the service's specific "expected one of: …" message via
// `guard()`'s `isError` channel, not a generic MCP schema-validation error.
const surfaceInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    surface: {
      type: "string",
      description:
        "Provider surface to resolve: `delivery`, `tracker`, `engine`, `host`, or the composite `qa-execution:engine` / `qa-execution:host` (equivalent to the bare `engine` / `host` forms — both resolve to the same ownership record). An unrecognized token is an invalid argument and returns an MCP error result, distinct from a genuine `state: \"unconfigured\"` response.",
    },
  },
  required: ["surface"],
  additionalProperties: false,
}));

// --- plan_install (WF-447) -------------------------------------------------
// The selection unit is the PACK (`pluginId`), matching `discover_packs` and
// `register_pack(pluginId, …)`. `deregister` is a SEPARATE explicit input on
// purpose: it is what makes "omission never removes" a property of the interface
// rather than a convention the implementation must remember.

const PLAN_MAX_SELECTION = 256;
const PLAN_MAX_ANSWERS = 512;

const pluginIdListProperty = (description: string) => ({
  type: "array",
  maxItems: PLAN_MAX_SELECTION,
  uniqueItems: true,
  items: { type: "string", minLength: 1, maxLength: 256, pattern: safeTerminalStringPattern },
  description,
});

const planInstallInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    desired: pluginIdListProperty(
      "The explicit desired selected set, as plugin ids. A registered pack ABSENT from this list is retained, never removed.",
    ),
    deregister: pluginIdListProperty(
      "The explicit deregistration set, as plugin ids. The only removal path — omission from `desired` never implies removal, so an orphaned or disabled registration cannot become an implicit removal.",
    ),
    answers: {
      type: "array",
      maxItems: PLAN_MAX_ANSWERS,
      items: {
        type: "object",
        properties: {
          pluginId: { type: "string", minLength: 1, maxLength: 256, pattern: safeTerminalStringPattern },
          questionId: { type: "string", minLength: 1, maxLength: 256, pattern: safeTerminalStringPattern },
          value: {
            description:
              "The proposed answer, validated against the question's declared schema. Not persisted evidence — a valid value is reported as a PENDING write.",
          },
        },
        required: ["pluginId", "questionId", "value"],
        additionalProperties: false,
      },
      description:
        "Proposed project answers. Validated through the same declared-schema path a persisted value takes; never written.",
    },
  },
  additionalProperties: false,
}));

type PlanInstallArgs = {
  desired?: string[];
  deregister?: string[];
  answers?: Array<{ pluginId: string; questionId: string; value: unknown }>;
};

function toPlanSelection(args: PlanInstallArgs): PlanSelectionInput {
  return {
    desired: args.desired ?? [],
    deregister: args.deregister ?? [],
    answers: (args.answers ?? []).map((answer) => ({
      pluginId: answer.pluginId,
      questionId: answer.questionId,
      value: answer.value,
    })),
  };
}

/** The typed `invalid-root` envelope. Composed here rather than in the service
 *  because an inadmissible root must never reach a root-bound service at all. */
function planInstallEnvelopeForRejection(
  source: string,
  reason: string,
  diagnostic: string,
  args: PlanInstallArgs,
): PlanInstallResponse {
  return planInstallJoin({
    admission: { admitted: false, root: null, source, reason, diagnostic },
    inventory: { confidence: "unavailable", mayEstablishAbsence: false, observedCount: 0, issues: [] },
    packs: [],
    capabilities: [],
    selection: toPlanSelection(args),
  });
}

const surfaceClassInput = fromJsonSchema(withWorkspaceRoot({
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
}));

const safeRoutingStringPattern = safeTerminalStringPattern;
const unitIdPattern = "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$";
const routingSignalValues = [
  "low-confidence",
  "failed-validation",
  "conflicting-or-incomplete-evidence",
  "repeated-failure",
  "increased-risk-or-scope",
  "high-severity-review-uncertainty",
];

const routingShapeProperties = {
  workSurface: { type: "string", enum: ["caller-context", "external-context"] },
  atomicity: { type: "string", enum: ["atomic", "composite"] },
  unitCount: { type: "integer", minimum: 1, maximum: 4 },
  unitsIndependent: { type: "boolean" },
  ambiguity: { type: "string", enum: ["none", "bounded", "material"] },
  risk: { type: "string", enum: ["low", "elevated"] },
  toolWork: { type: "string", enum: ["none", "bounded", "material"] },
  validation: { type: "string", enum: ["mechanical", "judgment"] },
  contextIsolation: { type: "string", enum: ["none", "useful", "required"] },
  independentReview: { type: "boolean" },
  returnContract: { type: "string", enum: ["mechanically-judgeable", "judgment"] },
  requestedParallelism: { type: "integer", minimum: 1 },
};
const routingShapeRequired = Object.keys(routingShapeProperties);
const routingChoiceSchema = (maxLength: number) => ({
  type: "object",
  properties: {
    value: { type: ["string", "null"], maxLength, pattern: safeRoutingStringPattern },
    source: { type: "string", enum: ["host", "invocation", "project", "shipped-default", "inheritance"] },
    requested: { type: ["string", "null"], maxLength, pattern: safeRoutingStringPattern },
    requestedSource: { type: "string", enum: ["host", "invocation", "project", "shipped-default", "inheritance"] },
    masked: { type: "boolean" },
    fallback: { type: ["string", "null"], enum: ["malformed", "unavailable", "selector-unsupported", null] },
  },
  required: ["value", "source", "requested", "requestedSource", "masked", "fallback"],
  additionalProperties: false,
});

const routingInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    role: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$", maxLength: 64 },
    shapeEvidence: {
      type: "object",
      properties: routingShapeProperties,
      additionalProperties: false,
    },
    unitIds: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 128, pattern: unitIdPattern }, uniqueItems: true },
    invocationModel: { type: ["string", "null"], maxLength: 128, pattern: safeRoutingStringPattern }, invocationEffort: { type: ["string", "null"], maxLength: 16, pattern: safeRoutingStringPattern },
    requireModel: { type: "boolean" }, requireEffort: { type: "boolean" },
    supportsModelSelector: { type: "boolean" }, supportsEffortSelector: { type: "boolean" },
    hostModel: { type: ["string", "null"], maxLength: 128, pattern: safeRoutingStringPattern }, hostEffort: { type: ["string", "null"], maxLength: 16, pattern: safeRoutingStringPattern },
    availableModels: { type: ["array", "null"], maxItems: 64, items: { type: "string", minLength: 1, maxLength: 128, pattern: safeRoutingStringPattern }, uniqueItems: true },
    basis: { type: ["string", "null"], maxLength: 256, pattern: safeRoutingStringPattern }, attempt: { type: "integer", minimum: 1, maximum: 3 },
    escalationOrigin: { type: ["string", "null"], maxLength: 256, pattern: safeRoutingStringPattern }, actualModel: { type: ["string", "null"], maxLength: 128, pattern: safeRoutingStringPattern },
    postAttempt: {
      type: "object",
      properties: {
        sufficient: { type: "boolean" },
        signals: { type: "array", maxItems: 6, items: { type: "string", enum: routingSignalValues }, uniqueItems: true },
        units: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          items: {
            type: "object",
            properties: {
              unitId: { type: "string", minLength: 1, maxLength: 128, pattern: unitIdPattern },
              sufficient: { type: "boolean" },
              signals: { type: "array", maxItems: 6, items: { type: "string", enum: routingSignalValues }, uniqueItems: true },
            },
            required: ["unitId", "sufficient", "signals"],
            additionalProperties: false,
          },
        },
        prior: {
          type: "object",
          properties: {
            role: { type: "string", pattern: "^[a-z][a-z0-9-]{0,63}$", maxLength: 64 },
            attempt: { type: "integer", minimum: 1, maximum: 3 },
            executionShape: { type: "string", enum: ["inline", "isolated", "bounded-parallel"] },
            shapeEvidence: { type: "object", properties: routingShapeProperties, required: routingShapeRequired, additionalProperties: false },
            unitIds: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 128, pattern: unitIdPattern }, uniqueItems: true },
            model: routingChoiceSchema(128),
            effort: routingChoiceSchema(16),
            basis: { type: ["string", "null"], maxLength: 256, pattern: safeRoutingStringPattern },
            escalationOrigin: { type: ["string", "null"], maxLength: 256, pattern: safeRoutingStringPattern },
            actualModel: { type: ["string", "null"], maxLength: 128, pattern: safeRoutingStringPattern },
          },
          required: ["role", "attempt", "executionShape", "shapeEvidence", "unitIds", "model", "effort", "basis", "escalationOrigin"],
          additionalProperties: false,
        },
      },
      required: ["sufficient", "signals", "prior"],
      additionalProperties: false,
    },
  },
  // NOTE: the "no postAttempt ⇒ attempt===1 and escalationOrigin===null" invariant is
  // enforced in resolveRouting() (resolver/routing.ts), which returns an `invalid-stop`
  // decision on violation. It is deliberately NOT expressed as a top-level `allOf`/`if`
  // here: the Anthropic Messages API rejects a tool `input_schema` that uses top-level
  // allOf/anyOf/oneOf, which makes Claude Code silently skip this tool at registration.
  required: ["role", "shapeEvidence", "supportsModelSelector", "supportsEffortSelector"],
  additionalProperties: false,
}));

const routingOutput = fromJsonSchema({
  type: "object",
  properties: {
    role: { type: "string", maxLength: 64 },
    executionShape: { type: "string", enum: ["inline", "isolated", "bounded-parallel"] },
    normalizedEvidence: { type: "object", properties: routingShapeProperties, required: routingShapeRequired, additionalProperties: false },
    unitIds: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 128, pattern: unitIdPattern }, uniqueItems: true },
    shapeReason: { type: "string", enum: ["atomic-caller-context", "single-isolation-worthy-unit", "dependent-or-nonmaterial-units", "nonmaterial-units-inline", "independent-material-units"] },
    effectiveParallelism: { type: "integer", minimum: 1, maximum: 4 },
    model: routingChoiceSchema(128),
    effort: routingChoiceSchema(16),
    source: { type: "string", enum: ["host", "invocation", "project", "shipped-default", "inheritance"] },
    basis: { type: ["string", "null"], maxLength: 256, pattern: safeRoutingStringPattern },
    attempt: { type: "integer", minimum: 1, maximum: 3 },
    escalationOrigin: { type: ["string", "null"], maxLength: 256, pattern: safeRoutingStringPattern },
    fallback: { type: ["string", "null"], enum: ["malformed", "unavailable", "selector-unsupported", null] },
    masked: { type: "boolean" },
    actualModel: { type: "string", maxLength: 128, pattern: safeRoutingStringPattern },
    status: { type: "string", enum: ["dispatch", "retain", "stop"] },
    disposition: { type: "string", enum: ["dispatch", "retain", "retry", "exhausted", "invalid-stop"] },
    retry: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          properties: {
            attempt: { type: "integer", minimum: 2, maximum: 3 },
            signals: { type: "array", minItems: 1, maxItems: 6, items: { type: "string", enum: routingSignalValues }, uniqueItems: true },
            unitIds: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 128, pattern: unitIdPattern }, uniqueItems: true },
            priorTier: { type: "string", enum: ["haiku", "sonnet", "opus"] },
            nextTier: { type: "string", enum: ["haiku", "sonnet", "opus"] },
            escalationOrigin: { type: "string", minLength: 1, maxLength: 256, pattern: safeRoutingStringPattern },
            priorExecutionShape: { type: "string", enum: ["inline", "isolated", "bounded-parallel"] },
            shapeChanged: { type: "boolean" },
          },
          required: ["attempt", "signals", "unitIds", "priorTier", "nextTier", "escalationOrigin", "priorExecutionShape", "shapeChanged"],
          additionalProperties: false,
        },
      ],
    },
    retainedUnitIds: { type: "array", maxItems: 4, items: { type: "string", minLength: 1, maxLength: 128, pattern: unitIdPattern }, uniqueItems: true },
    diagnostic: { type: ["string", "null"] },
  },
  required: ["role", "executionShape", "normalizedEvidence", "unitIds", "shapeReason", "effectiveParallelism", "model", "effort", "source", "basis", "attempt", "escalationOrigin", "fallback", "masked", "status", "disposition", "retry", "retainedUnitIds", "diagnostic"],
  additionalProperties: false,
});

const capabilityInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    capability: { type: "string", description: "Registered capability name." },
  },
  required: ["capability"],
  additionalProperties: false,
}));

const pluginInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    plugin: { type: "string", description: "Plugin name (left of `@`)." },
  },
  required: ["plugin"],
  additionalProperties: false,
}));

const pluginIdInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    pluginId: {
      type: "string",
      description: "Stable plugin id (`<name>@<marketplace>` or bare `<name>`).",
    },
  },
  required: ["pluginId"],
  additionalProperties: false,
}));

const skillInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    skill: {
      type: "string",
      description: "Slotted skill slug whose declared settings keys to resolve (lowercase, hyphenated).",
    },
  },
  required: ["skill"],
  additionalProperties: false,
}));

const contentInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    class: {
      type: "string",
      enum: ["fragment", "contract", "shared", "references-template", "profile-template", "slot"],
      description:
        "The logical content-ref class: `fragment` (a capability fragment body), `contract` (a `_contracts/*` ops doc), `shared` (a `_shared/*` convention doc), `references-template` (a skill `references/*` template), `profile-template` (a pack's `profile.template.json` body), or `slot` (the single composed body for a per-skill composition point — see `skill`+`point`). Skill bodies and CI-only fixtures are not served.",
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
      description: "Skill slug — required for `references-template`; the `<skill>` segment for `slot`.",
    },
    point: {
      type: "string",
      description:
        "The `<point>` segment for a `slot` ref — the composition point inside the named skill (the pair forms the `<skill>.<point>` id, e.g. skill `ship` + point `review`).",
    },
    ref: {
      type: "string",
      description:
        "The relative doc ref: within the capability folder, subfolder included — e.g. `fragments/tracker.ops.md`, never the bare filename (`fragment`); a bare filename (`contract` / `shared`); or within the skill's `references/` folder (`references-template`). Unused by `profile-template` / `slot`.",
    },
  },
  required: ["class"],
  additionalProperties: false,
}));

// --- authoring validators (WF-352) -----------------------------------------
// Each takes only the slots its consumers need (the scaffolders and the
// acceptance test); the surface is semi-frozen once those land, so it stays
// deliberately narrow — every domain argument is optional where documented;
// workspaceRoot remains mandatory for every call.

const validateManifestInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "A capability folder or a `manifest.md` path (absolute, or relative to the workspace root). Omit to check every active registry capability's manifest.",
    },
  },
  additionalProperties: false,
}));

const validateSkillInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    plugin: {
      type: "string",
      description: "Plugin name to scope the scan to (e.g. `wf`). Omit to scan every plugin.",
    },
    skill: {
      type: "string",
      description: "Skill slug to scope the scan to. Omit to scan every skill in scope.",
    },
  },
  additionalProperties: false,
}));

const validateReferencesInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    path: {
      type: "string",
      description:
        "A skill body, an agent file, or a folder to scan (absolute, or relative to the workspace root). Omit to scan every plugin's `skills/` and `agents/`.",
    },
  },
  additionalProperties: false,
}));

const previewCompositionInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    phase: {
      type: "string",
      description:
        "SDD phase to preview (e.g. `verify`, `qa-execution`). Omit to preview every phase.",
    },
  },
  additionalProperties: false,
}));

const registerInput = fromJsonSchema(withWorkspaceRoot({
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
}));

const reasonsInput = fromJsonSchema(withWorkspaceRoot({
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
}));

/** Map optional caller-supplied reason strings to typed StaleReasons. */
function toReasons(reasons: string[] | undefined, code: string): Array<{ code: string; message: string }> {
  return (reasons ?? [])
    .filter((r) => typeof r === "string" && r.trim().length > 0)
    .map((message) => ({ code, message: message.trim() }));
}

/**
 * Keeps a tool's schema resident in the host's context instead of deferring it
 * behind the host's tool-search surface.
 *
 * The host defers EVERY MCP tool by default; a tool is resident only if its
 * server config sets `alwaysLoad` or the tool itself carries this `_meta` key.
 * Marking the whole server resident costs ~8.1K tokens of schema in every
 * context that boots the resolver — including each isolated subagent. Only the
 * ops a skill body names as a mandatory step are marked here; the rest defer
 * and cost one tool-search round trip on the rare paths that reach them.
 *
 * Attach to a tool ONLY when a skill or agent body names it as a step that runs
 * before the work it gates — not merely because it is called often.
 */
const RESIDENT = { "anthropic/alwaysLoad": true } as const;

/** Register every typed resolver tool with request-scoped service selection. */
export function registerResolverTools(server: McpServer, selectService: ServiceSelector): void {
  const selected = <T>(args: WorkspaceArgs, fn: (service: ResolverService) => T): ToolResult =>
    guard(() => fn(selectService(args.workspaceRoot)));

  server.registerTool(
    "resolve_config",
    {
      title: "resolve config",
      inputSchema: workspaceOnlyInput,
      description:
        "Resolved core config + workspace root + registry location + id shape (R1). Metadata only; no fragment bodies.",
      _meta: RESIDENT,
    },
    async (args: WorkspaceArgs) => selected(args, (service) => service.resolveConfig()),
  );

  server.registerTool(
    "resolve_registry",
    {
      title: "resolve registry",
      inputSchema: workspaceOnlyInput,
      description:
        "The ordered active capability registry as metadata (R2): name, kind, resolved/manifest paths, provenance, validity, fragment dispatch metadata, articles, requires/conflicts. Never a fragment body.",
      _meta: RESIDENT,
    },
    async (args: WorkspaceArgs) => selected(args, (service) => service.resolveRegistry()),
  );

  server.registerTool(
    "resolve_provider",
    {
      title: "resolve provider",
      description:
        "One provider surface's resolution record (R3): owner, dispatch fragment path, state, and the degradation class a consumer reproduces. No fragment body.",
      inputSchema: surfaceInput,
      _meta: RESIDENT,
    },
    async (args: WorkspaceArgs & { surface: string }) => selected(args, (service) => service.resolveProvider(args.surface)),
  );

  server.registerTool(
    "resolve_profile",
    {
      title: "resolve profile",
      description:
        "Override-merged profile VALUES for a capability (R4). Values only; never a template or body.",
      inputSchema: capabilityInput,
    },
    async (args: WorkspaceArgs & { capability: string }) =>
      selected(args, (service) => service.resolveProfile(args.capability)),
  );

  server.registerTool(
    "resolve_settings",
    {
      title: "resolve settings",
      description:
        "Override-merged per-skill SETTINGS values (WF-328). Resolves a slotted skill's declared settings keys under the hybrid precedence override > declared default — the same seeded-override pattern as capability profiles, re-keyed per skill on `_local/profiles/<skill>.settings.json`. A skill with no override resolves to its declared defaults (no override seeded); a divergent override value wins per key; an override carrying a key the skill's `interface.md` does not declare is rejected loudly (`registry-invalid`, naming the key and the skill). Values only; never a skill body or interface prose.",
      inputSchema: skillInput,
    },
    async (args: WorkspaceArgs & { skill: string }) => selected(args, (service) => service.resolveSettings(args.skill)),
  );

  server.registerTool(
    "resolve_routing",
    {
      title: "resolve routing",
      description: "Mandatory decision surface immediately before every fixed core-owned child execution. Selects execution shape plus independent model/effort selectors from the fingerprint-fresh cached configuration; callers must obey the shape exactly and pass selectors only when their returned values are non-null. With postAttempt evidence, retains sufficient work, resolves one bounded parent-owned next-tier retry for only insufficient units, or stops on invalid/exhausted state. The bounded output is the canonical compact operational record: role, shape/reason, model and effort value/source/fallback, basis, attempt, escalation origin, masking, actual model when supplied, diagnostic, retained units, and retry disposition. It preserves precedence and provenance and is never artifact model attribution or a measurement sink. Body-free.",
      inputSchema: routingInput,
      outputSchema: routingOutput,
      _meta: RESIDENT,
    },
    async (args: WorkspaceArgs & RoutingInputs) => {
      const { workspaceRoot, ...inputs } = args;
      return selected({ workspaceRoot }, (service) => service.resolveRouting(inputs));
    },
  );

  server.registerTool(
    "resolve_plugin_root",
    {
      title: "resolve plugin root",
      description:
        "A plugin's resolved install root + provenance, post-self-heal (R5). One path record.",
      inputSchema: pluginInput,
    },
    async (args: WorkspaceArgs & { plugin: string }) => selected(args, (service) => service.resolvePluginRoot(args.plugin)),
  );

  server.registerTool(
    "resolve_content",
    {
      title: "resolve content",
      description:
        "Resolve + read a bundled-doc BODY, read by the server's own Node fs. Five single-path classes (fragment | contract | shared | references-template | profile-template) return `{status: served, path, content}`. The `slot` class composes a per-skill composition point (`skill`+`point`) into exactly ONE body under the precedence personal `_local/` override > pack contribution, returning `{status: composed, content, policy, parts}` (`replace` = single winner; `append` = registry-ordered concatenation, override last); a slot with no contribution and no override returns `{status: unfilled}` directing the caller to the inline default. On an unresolvable/unrecoverable ref: `{status: unresolved}` with the matching resolve_gate degradation class + a `/wf:resolve` recovery path (never a wrong-path body, never a raw-read fall-through); an out-of-class ref (skill body, CI-only fixture) returns `{status: refused}`. The distinct body-serving path — the metadata queries stay body-free.",
      inputSchema: contentInput,
      _meta: RESIDENT,
    },
    async (args: WorkspaceArgs & ContentRef) => {
      const { workspaceRoot, ...ref } = args;
      return selected({ workspaceRoot }, (service) => service.resolveContent(ref as ContentRef));
    },
  );

  server.registerTool(
    "inspect_pack",
    {
      title: "inspect pack",
      description:
        "Read-only pack inspection (R6): resolves a plugin id via `claude plugin list --json`, validates enabled state / version / installPath and the pack manifest(s), and returns a fingerprint. Writes nothing.",
      inputSchema: pluginIdInput,
    },
    async (args: WorkspaceArgs & { pluginId: string }) => selected(args, (service) => service.inspectPack(args.pluginId)),
  );

  // Deliberately NOT `RESIDENT`. No skill body names `discover_packs` as a
  // mandatory pre-step — it is a maintainer-initiated inventory, so it defers
  // behind the host's tool-search surface like every other non-gating op and
  // costs no schema tokens in the contexts that never reach it.
  server.registerTool(
    "discover_packs",
    {
      title: "discover packs",
      description:
        "Read-only, byte-inert pack discovery (R6). Joins the authoritative `claude plugin list --json` inventory, registry attribution, each pack's existing snapshot state, recorded-vs-observed lifecycle evidence, and declared questions into one deterministic inventory a maintainer inspects before choosing a lifecycle change. Returns `{workspaceRoot, inventory{confidence, mayEstablishAbsence, observedCount, issues}, packs[], diagnostics[]}`. `confidence` is one of `trustworthy | unavailable | malformed | partial | invalid`, and ONLY `trustworthy` may establish that a registered pack is orphaned — every other value reports `absence-indeterminate` instead. A duplicate plugin id or name invalidates the whole inventory and classifies nothing. Each pack carries its unchanged `PackState` plus a separate nullable staleness `overlay`, a non-persisted `seedProposal`, and its declared questions. Writes nothing: no ledger, no seed, no enablement change.",
      inputSchema: workspaceOnlyInput,
    },
    async (args: WorkspaceArgs) => selected(args, (service) => service.discoverPacks()),
  );

  // Deliberately NOT `RESIDENT`, for the same reason as `discover_packs`: no
  // skill body names `plan_install` as a mandatory pre-step, so it defers behind
  // the host's tool-search surface and costs no schema tokens elsewhere.
  server.registerTool(
    "plan_install",
    {
      title: "plan install",
      description:
        "Read-only, byte-inert preview of one explicit selected set (WF-447) — the SOLE public plan-response lineage. Returns the versioned envelope `{planVersion, workspaceRoot, admission, applicability, registryDelta{additions,retentions,deregistrations}, answers{writes,unresolved}, evidenceSeeds[], findings[], inventory, byteInert}`. `applicability` resolves FIRST-MATCH-WINS as `invalid-root` → `not-applicable` (a structural error finding) → `blocked` (a missing or invalid project answer) → `no-change` → `applicable`. OMISSION NEVER REMOVES: a registered pack absent from `desired` is retained, so an orphaned or disabled registration can never become an implicit removal — deregistration has its own explicit `deregister` input. A proposed answer is validated through the declared schema and reported as a PENDING write; it is not persisted evidence. A legacy registration's bootstrap seed is previewed only from complete observed proof — otherwise planning is not applicable and the registration is preserved. Writes nothing on any path: no ledger, no seed, no answer, no enablement change.",
      inputSchema: planInstallInput,
    },
    async (args: WorkspaceArgs & PlanInstallArgs) =>
      guard(() => {
        // The admitted root binds to WF-445's ONE canonical selection API, so an
        // inadmissible root returns the typed `invalid-root` ENVELOPE rather than
        // an MCP error — the criterion is that invalid-root behaviour is explicit
        // and byte-inert, and an error channel is neither.
        //
        // `selectWorkspaceRoot(..., null)` classifies the declaration itself
        // (blank / non-absolute / missing / not-a-directory) and canonicalizes it;
        // the worktree-FAMILY constraint stays where it already lives, in
        // `selectService`, whose throw maps to the same closed `out-of-family`
        // token rather than being re-implemented here.
        const declared = selectWorkspaceRoot(
          { explicit: args.workspaceRoot, cwd: args.workspaceRoot },
          null,
        );
        if (!declared.ok) {
          return planInstallEnvelopeForRejection(
            declared.source,
            declared.reason,
            declared.diagnostic,
            args,
          );
        }

        let service: ResolverService;
        try {
          service = selectService(args.workspaceRoot);
        } catch (err) {
          return planInstallEnvelopeForRejection(
            declared.source,
            "out-of-family",
            terminalSafeDiagnostic(err),
            args,
          );
        }

        return service.planInstall(
          { admitted: true, root: declared.root, source: declared.source, reason: null, diagnostic: null },
          toPlanSelection(args),
        );
      }),
  );

  server.registerTool(
    "register_pack",
    {
      title: "register pack",
      description:
        "Mutating pack registration (R6). Rejects a missing / disabled / stale-fingerprint / path-invalid / manifest-invalid request WITHOUT writing; on success owns the registry write, refreshes the snapshot, and self-checks. Core does not infer skill provenance.",
      inputSchema: registerInput,
    },
    async (args: WorkspaceArgs & { pluginId: string; expectedFingerprint: string }) =>
      selected(args, (service) => service.registerPack(args.pluginId, args.expectedFingerprint)),
  );

  server.registerTool(
    "resolve_gate",
    {
      title: "resolve gate",
      description:
        "Surface-specific resolver-failure gate (WF-272). Given the current resolver health and the acting surface (`local-read` | `tracker-write` | `delivery-write`), returns the reaction (continue | warn | block), the failure categories, categorized diagnostics with a `/wf:resolve` recovery path, and a marker proving the failure path never re-walks folders or probes the environment. A local read continues best-effort, a tracker write warns and continues, a delivery write blocks before any mutation.",
      inputSchema: surfaceClassInput,
    },
    async (args: WorkspaceArgs & { surface: "local-read" | "tracker-write" | "delivery-write" }) =>
      selected(args, (service) => service.assessSurface(args.surface)),
  );

  // --- authoring validators (WF-352) --------------------------------------
  // The in-session twin of the CI shell guards (`validate-registry.sh`,
  // `skill-slot-marker-lint.sh`): same rule sources, same check/defect ids,
  // agreeing verdicts — an additional surface, never a replacement. All three
  // are read-only and share the frozen `ValidationVerdict` shape.

  server.registerTool(
    "validate_manifest",
    {
      title: "validate manifest",
      description:
        "Check a capability `manifest.md` against manifest schema v2 (WF-352). Returns the frozen ValidationVerdict `{tool, status: pass|fail|error, target, findings[{rule, severity, file, line, message}], ruleSources[], summary}`. Rule ids mirror `validate-registry.sh` (`CHECK-6` phase/kind tokens, `CHECK-6b` dispatch, `CHECK-6c` slot scope + merge policy, `CHECK-HEADING` heading typos). The phase spine, contribution kinds, and merge policies are derived LIVE from `capability-registry.ops.md` on every call — no rule is transcribed. A syntactically broken manifest returns `status: \"error\"` with rule `input-unparseable`; an unreadable rule source returns `rule-source-unresolvable` — never a crash, never a silent pass. Omit `path` to check every active capability.",
      inputSchema: validateManifestInput,
    },
    async (args: WorkspaceArgs & { path?: string }) => selected(args, (service) => service.validateManifest(args.path)),
  );

  server.registerTool(
    "validate_registry",
    {
      title: "validate registry",
      inputSchema: workspaceOnlyInput,
      description:
        "Check the resolved capability registry (WF-352): the `## Capabilities` and `## Plugin Roots` tables plus every resolvable capability manifest — the same set `validate-registry.sh` folds into one exit code, and it agrees with that guard's verdict. Returns the frozen ValidationVerdict. Rule ids are the guard's own: `CHECK-1` registryPath shape, `CHECK-2` duplicate names, `CHECK-3` filesystem-safe names, `CHECK-4` path resolves + carries a manifest, `CHECK-4a`/`CHECK-4b` plugin-root shape/uniqueness, `CHECK-5` overlapping partitioned ownership (naming both offenders), `CHECK-6`/`6b`/`6c` fragment-row rules, `CHECK-7` requires satisfied, `CHECK-8` co-active conflicts, `CHECK-9` contradictory article clauses. Takes no arguments — it validates the registry the resolver already resolved.",
    },
    async (args: WorkspaceArgs) => selected(args, (service) => service.validateRegistry()),
  );

  server.registerTool(
    "validate_skill_interface",
    {
      title: "validate skill interface",
      description:
        "Check skill slot markers against their `interface.md` `## Slots` declarations (WF-352), agreeing with `skill-slot-marker-lint.sh` and reusing its defect ids: `D1` malformed declaration, `D2` malformed marker, `D3` undeclared marker, `D4` unbalanced/duplicate marker, `D5` declared-but-unmarked. Returns the frozen ValidationVerdict with file/line diagnostics only — never any skill-body content (the `resolve_content` body-serving refusal is unchanged). A skill declaring no slots and carrying no markers passes clean (the inert case). Omit both arguments to scan every skill under `plugins/*/skills/*/`.",
      inputSchema: validateSkillInput,
    },
    async (args: WorkspaceArgs & { plugin?: string; skill?: string }) =>
      selected(args, (service) => service.validateSkillInterface(args.plugin, args.skill)),
  );

  // --- reference existence + composition preview (WF-354) ------------------
  // Neither has a shell-guard counterpart — they answer questions no CI guard
  // owns — so neither claims agreement with one. `validate_references` still
  // reuses the frozen verdict shape; `preview_composition` deliberately does
  // NOT, because a preview has no pass/fail semantics (D-4).

  server.registerTool(
    "validate_references",
    {
      title: "validate references",
      description:
        "Resolve every cross-reference in skill bodies and agent files against the real tree (WF-354) — the dead-reference class no structural validator catches (a body instructing invocation of a removed skill). Checks `/wf:<skill>`, `/wf-<pack>:<skill>`, `subagent_type: wf:<agent>`, and `${CLAUDE_PLUGIN_ROOT}` path tokens, but ONLY on invocation-instruction lines: the instruction-vs-prose classifier is DERIVED at call time by parsing the `p1`/`p2` assignments out of `out4-skill-read-guard.sh` (recorded in `ruleSources`), so a bare prose mention — a README skill table, a cited call shape — never turns red. Returns the frozen ValidationVerdict with rule ids `REF-1` (unresolvable skill/agent invocation reference) and `REF-2` (unresolvable `${CLAUDE_PLUGIN_ROOT}` path token), alongside `input-unparseable` / `rule-source-unresolvable`. A reference whose owning plugin root is not resolvable in this workspace is indeterminate, not dead: it is excluded from `findings` and counted in `summary`. Omit `path` to scan every plugin's skills and agents.",
      inputSchema: validateReferencesInput,
    },
    async (args: WorkspaceArgs & { path?: string }) => selected(args, (service) => service.validateReferences(args.path)),
  );

  server.registerTool(
    "preview_composition",
    {
      title: "preview composition",
      description:
        "Dry-run preview of what the capability registry would compose (WF-354): every fragment that would fire at a phase, in registry order, each carrying its provenance (owning capability, resolved dispatch target, scope, resolved/manifest paths, how the path resolved). Rendered purely off the already-resolved snapshot — no manifest is re-parsed, no path re-resolved, and no fragment BODY is ever read or returned (follow the named `dispatch` for that). Read-only: it neither refreshes nor invalidates the snapshot. NOT a ValidationVerdict — a preview has no pass/fail semantics — so it returns its own narrow record, and zero entries is a first-class inert outcome (an empty registry composes nothing, which is the contract's designed behaviour, not an error). Omit `phase` to preview every phase.",
      inputSchema: previewCompositionInput,
    },
    async (args: WorkspaceArgs & { phase?: string }) => selected(args, (service) => service.previewComposition(args.phase)),
  );

  // --- lifecycle (the /wf:resolve skill routes through these) --------------
  server.registerTool(
    "resolve_inspect",
    {
      title: "resolve inspect",
      inputSchema: workspaceOnlyInput,
      description:
        "Lifecycle state of the resolved view: validity, cache presence, generatedAt, counts, per-slot composition provenance (each composed `skill.point` → winning source → tier, plus override presence), the per-skill settings-override presence index, and diagnostics. Does not rebuild.",
    },
    async (args: WorkspaceArgs) => selected(args, (service) => service.inspect()),
  );

  server.registerTool(
    "resolve_refresh",
    {
      title: "resolve refresh",
      description:
        "Rebuild the resolved view from current inputs and persist it. Returns the fresh lifecycle state. Optional `reasons` are recorded as diagnostics explaining the refresh.",
      inputSchema: reasonsInput,
    },
    async (args: WorkspaceArgs & { reasons?: string[] }) =>
      selected(args, (service) => service.refresh(toReasons(args.reasons, "explicit-request"))),
  );

  server.registerTool(
    "resolve_invalidate",
    {
      title: "resolve invalidate",
      description:
        "Mark the resolved view invalid so the next query (or an explicit refresh) rebuilds it. Typed consumers may pass `reasons` (suspected-stale messages) which surface as diagnostics. Returns the lifecycle state.",
      inputSchema: reasonsInput,
    },
    async (args: WorkspaceArgs & { reasons?: string[] }) =>
      selected(args, (service) => service.invalidate(toReasons(args.reasons, "suspected-stale"))),
  );
}
