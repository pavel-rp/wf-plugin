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
import { planRepair, type RepairPlanResult } from "./resolver/repair-plan.js";
import { selectWorkspaceRoot } from "./workspace-admission.js";
import { describeCallerRoot } from "./git-workspace.js";
import { invalidRootRecoveryReport } from "./resolver/lifecycle-recovery.js";
import {
  APPLY_ENVELOPE_VERSION,
  type ApplyInstallResponse,
  type DiscoverPacksResponse,
  type PlanInstallResponse,
  type RoutingInputs,
} from "./resolver/types.js";

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

// --- run evidence (WF-490) -------------------------------------------------
// `kind` and `subject` carry no `enum`, for the same reason `surfaceInput` above
// does not: the closed-set check lives in the service, so an out-of-set token
// surfaces the specific "the set is closed at: …" refusal rather than a generic
// MCP schema-validation error. The refusal is the more useful answer — it names
// the seven, so a caller learns the boundary instead of only that it missed one.

const runEvidenceKindProperty = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: safeTerminalStringPattern,
  description:
    "The run-evidence record kind: `phase-receipt` for a receipt-bearing phase's completion, or `gate-approval` for a per-gate self-approval record travelling this same emission path.",
};

const runEvidenceSubjectProperty = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: safeTerminalStringPattern,
  description:
    "What the record is about. For `phase-receipt` this is the receipt-bearing phase and the set is CLOSED — `spec`, `plan`, `implement`, `verify-spec`, `qa-gen`, `ship`, `tf` — and any other token is refused. For `gate-approval` it is the gate token.",
};

const runEvidenceTaskIdProperty = {
  type: "string",
  minLength: 1,
  maxLength: 128,
  pattern: safeTerminalStringPattern,
  description:
    "The task id, in whatever opaque shape the active tracker capability produced (or the local scheme when none is registered). Together with the admitted workspace root it is what the resolver derives the run identity from; the run identity itself is never a caller input.",
};

const recordRunEvidenceInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    kind: runEvidenceKindProperty,
    subject: runEvidenceSubjectProperty,
    taskId: runEvidenceTaskIdProperty,
    artifactPath: {
      type: "string",
      maxLength: 4096,
      pattern: safeTerminalStringPattern,
      description:
        "Workspace-relative path of the artifact this phase produced, when it produced one (omit for a phase that writes no artifact). The resolver reads and digests it ITSELF; an absent artifact is a refusal, not a receipt.",
    },
  },
  required: ["kind", "subject", "taskId"],
  additionalProperties: false,
}));

const readRunEvidenceInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: { taskId: runEvidenceTaskIdProperty },
  required: ["taskId"],
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

// --- apply_install (WF-453) -------------------------------------------------
// The mutator's input is the planner's input plus ONE field: the `planId` the
// caller approved. It is required and cannot be blank — an apply that accepted a
// missing plan identity would be an apply with no approval, which is exactly the
// thing the exact-plan gate exists to prevent.

const applyInstallInput = fromJsonSchema(withWorkspaceRoot({
  type: "object",
  properties: {
    expectedPlanId: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: safeTerminalStringPattern,
      description:
        "The `identity.planId` from the `plan_install` response the caller approved. Revalidated under the exclusive lock against a plan recomputed from current facts; any mismatch is `apply/plan-stale` and nothing is written.",
    },
    desired: pluginIdListProperty(
      "The SAME explicit desired selected set the approved plan was computed from, as plugin ids. A registered pack ABSENT from this list is retained, never removed.",
    ),
    deregister: pluginIdListProperty(
      "The SAME explicit deregistration set the approved plan was computed from. The only removal path.",
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
              "The proposed answer, carried so the recomputed plan matches the approved one. REVALIDATED under the lock against the capability's currently-declared question schema before it is persisted; a question that is no longer declared, or a value that no longer satisfies its schema, is `apply/answer-invalid` and nothing is written.",
          },
        },
        required: ["pluginId", "questionId", "value"],
        additionalProperties: false,
      },
      description:
        "The SAME proposed project answers the approved plan was computed from. Persisted (WF-454) as capability profile seeds, inside the same transaction as the registry and the evidence ledger — all of it or none of it.",
    },
  },
  required: ["expectedPlanId"],
  additionalProperties: false,
}));

type ApplyInstallArgs = PlanInstallArgs & { expectedPlanId: string };

/** The typed `invalid-root` apply envelope.
 *
 *  Composed at the tool boundary for the same reason the planner's is: an
 *  inadmissible root must never reach a root-bound service, and the mutator's
 *  root-bound ports are the ones that would take a lock and write bytes. Every
 *  field states the same thing — nothing happened: no transaction, no write, no
 *  recovery attempt, and explicitly no success. */
function applyInstallEnvelopeForRejection(
  source: string,
  reason: string,
  diagnostic: string,
  args: ApplyInstallArgs,
): ApplyInstallResponse {
  return {
    applyVersion: APPLY_ENVELOPE_VERSION,
    workspaceRoot: null,
    admission: { admitted: false, root: null, source, reason, diagnostic },
    status: "invalid-root",
    reason: "apply/invalid-root",
    transactionId: null,
    plan: {
      planId: null,
      expectedPlanId: args.expectedPlanId,
      matched: false,
      applicability: null,
      mode: null,
    },
    applied: [],
    deferred: [],
    rollback: null,
    selfCheck: "skipped",
    refreshed: false,
    recovery: invalidRootRecoveryReport(diagnostic),
    residue: {
      clean: true,
      journalRetained: false,
      backupsRetained: false,
      detail: "no transaction was created.",
    },
    diagnostics: [{ code: "apply/invalid-root", message: diagnostic }],
  };
}

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
    // The same `invalid-root` recovery report the discovery composer below
    // carries (WF-452). An inadmissible root is rejected before any root-bound
    // port exists, so no recovery was attempted — and saying so explicitly is
    // what stops a reader inferring "nothing needed recovering".
    recovery: invalidRootRecoveryReport(diagnostic),
  });
}

/** The typed `invalid-root` repair envelope (WF-460).
 *
 *  Composed here for exactly the reason the planner's is: an inadmissible root
 *  must never reach a root-bound service at all. The derived selection is empty
 *  because nothing was observed, and the recovery report says explicitly that no
 *  recovery was attempted rather than leaving a reader to infer that nothing
 *  needed recovering. */
function repairPacksEnvelopeForRejection(
  source: string,
  reason: string,
  diagnostic: string,
): RepairPlanResult {
  return planRepair({
    admission: { admitted: false, root: null, source, reason, diagnostic },
    inventory: { confidence: "unavailable", mayEstablishAbsence: false, observedCount: 0, issues: [] },
    packs: [],
    capabilities: [],
    recovery: invalidRootRecoveryReport(diagnostic),
  });
}

/** The typed `invalid-root` discovery envelope (WF-451).
 *
 *  Composed here for the same reason as the planner's: an inadmissible root must
 *  never reach a root-bound service at all. Returning a TYPED, byte-inert
 *  envelope rather than an MCP error is what makes "invalid roots fail safely"
 *  an observable property of the response instead of an error channel a caller
 *  has to interpret. The inventory reports `unavailable`, so a rejected run can
 *  never establish that a pack is absent. */
function discoverPacksEnvelopeForRejection(
  workspaceRoot: string,
  diagnostic: string,
): DiscoverPacksResponse {
  return {
    workspaceRoot,
    inventory: { confidence: "unavailable", mayEstablishAbsence: false, observedCount: 0, issues: [] },
    packs: [],
    diagnostics: [
      {
        pluginId: null,
        code: "discovery/invalid-root",
        message: diagnostic,
      },
    ],
    recovery: invalidRootRecoveryReport(diagnostic),
  };
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
        "Resolved core config + workspace root + registry location + id shape + the executing core plugin's declared version (`coreVersion`, null when unreadable) (R1). Also reports how the caller's own request relates to that resolved root: `callerRoot` is the canonicalized directory the caller passed, and `rootRedirected` is true when the resolved `workspaceRoot` is not that directory — the designated predicate a caller reads to detect that it is resolving an enclosing checkout rather than its own directory. Read `rootRedirected`; never compare the two paths caller-side. Metadata only; no fragment bodies.",
      _meta: RESIDENT,
    },
    // The caller-root signal is composed HERE, and only here, because this is the
    // one layer holding both the raw request argument and the resolved response:
    // `WorkspaceServiceRegistry.select` consumes the argument inside
    // `resolveWorkspaceIdentity` and then discards it, keying and passing only the
    // resolved root, so a root-bound service can never produce these fields.
    // Composing after `select` returns changes neither admission nor keying, and no
    // existing field's value or meaning moves (WF-495).
    async (args: WorkspaceArgs) =>
      selected(args, (service) => {
        const config = service.resolveConfig();
        return { ...config, ...describeCallerRoot(args.workspaceRoot, config.workspaceRoot) };
      }),
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
        "Persisted profile VALUES for a capability (R4) \u2014 the document as written, with no template tier and no override tier merged in (that is `resolve_settings`, a different surface). Values only; never a template or body.",
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
        "Recovery-first, then read-only byte-inert pack discovery (R6 + WF-451). BEFORE any lifecycle state is read it takes an EXCLUSIVE machine-local lock and recovers an interrupted transaction from the versioned machine-local journal; only then does it join the authoritative `claude plugin list --json` inventory, registry attribution, each pack's snapshot state, recorded-vs-observed lifecycle evidence, and declared questions into one deterministic inventory. Returns `{workspaceRoot, inventory{confidence, mayEstablishAbsence, observedCount, issues}, packs[], diagnostics[], recovery{...}}`. `confidence` is one of `trustworthy | unavailable | malformed | partial | invalid`, and ONLY `trustworthy` may establish that a registered pack is orphaned — every other value reports `absence-indeterminate` instead. A duplicate plugin id or name invalidates the whole inventory and classifies nothing. Each pack carries its unchanged `PackState` plus a separate nullable staleness `overlay`, a non-persisted `seedProposal`, and its declared questions. DISCOVERY NEVER CREATES A JOURNAL, a backup, or a transaction of its own — with no journal present it acquires and releases the lock, creates zero transaction state, and is byte-inert. RECOVERY WRITES ARE REPORTED SEPARATELY in `recovery`, never folded into discovery's output: `recovery.wroteBytes` states that recovery moved the baseline, and discovery's byte-inertness is asserted FROM THAT RECOVERED BASELINE, never from process start. `recovery.state` is one of `no-journal | recovered | incomplete | unsupported | malformed | lock-unavailable | invalid-root`, and `recovery.proceeded` is `true` only for `no-journal` and `recovered`. RECOVERY IS FAIL-SAFE AND IDEMPOTENT: a destination is restored to its exact prior existence and bytes only when the bytes on disk are still the ones the interrupted transaction wrote AND the backup reproduces the recorded prior hash; an external edit or a symlink is PRESERVED, an uncontained destination, a missing or mismatching backup, or a failed write is left UNRESOLVED, and any preserved or unresolved work RETAINS the journal and stops discovery — which then reports `unavailable` confidence and can never establish absence. A journal version this release does not understand is a STOP, never a best-effort parse. Concurrent entry (`lock-unavailable`) and an inadmissible workspace root (`invalid-root`, bound to the one canonical admission API) each return this same typed byte-inert envelope rather than an error. Writes nothing of its own: no ledger, no seed, no enablement change, no journal.",
      inputSchema: workspaceOnlyInput,
    },
    async (args: WorkspaceArgs) =>
      guard(() => {
        // The admitted root binds to WF-445's ONE canonical selection API, the
        // same binding `plan_install` uses. Discovery now WRITES on the recovery
        // path, so admitting the root before a root-bound service exists is not
        // hygiene — it is what keeps a restore from ever being attempted against
        // a root that was never admitted.
        const declared = selectWorkspaceRoot(
          { explicit: args.workspaceRoot, cwd: args.workspaceRoot },
          null,
        );
        if (!declared.ok) {
          return discoverPacksEnvelopeForRejection(args.workspaceRoot, declared.diagnostic);
        }

        let service: ResolverService;
        try {
          service = selectService(args.workspaceRoot);
        } catch (err) {
          // The worktree-FAMILY constraint stays where it already lives, in
          // `selectService`; its throw maps onto the same typed envelope rather
          // than being re-implemented here.
          return discoverPacksEnvelopeForRejection(
            args.workspaceRoot,
            terminalSafeDiagnostic(err),
          );
        }

        return service.discoverPacks();
      }),
  );

  // Deliberately NOT `RESIDENT`, for the same reason as `discover_packs`: no
  // skill body names `plan_install` as a mandatory pre-step, so it defers behind
  // the host's tool-search surface and costs no schema tokens elsewhere.
  server.registerTool(
    "plan_install",
    {
      title: "plan install",
      description:
        "Read-only, byte-inert preview of one explicit selected set (WF-447/WF-448/WF-449/WF-450) — the SOLE public plan-response lineage. Returns the versioned envelope `{planVersion, workspaceRoot, admission, applicability, mode, registryDelta{additions,retentions,deregistrations}, answers{writes,unresolved}, evidenceSeeds[], repairs[], payloads{actions,rejected,conflicts}, artifacts{deletable,retained,bootstrap,advance}, actions[], applicabilityBasis{applicability,blockingFindings,blockingQuestions,blocked}, identity{planId,algorithm,coveredFactClasses,factCount}, findings[], inventory, recovery{...}, byteInert}`. RECOVERY-FIRST (WF-452): BEFORE any lifecycle state is read — the snapshot, the CLI inventory, the evidence ledger, declared payload sources, managed-artifact bytes — planning takes the SAME exclusive machine-local lock discovery takes and recovers an interrupted transaction from the versioned machine-local journal. PLANNING NEVER CREATES A JOURNAL, a backup, or a transaction of its own: with no journal present it acquires and releases the lock, creates zero transaction state, and is byte-inert. RECOVERY WRITES ARE REPORTED SEPARATELY in `recovery`, never folded into the plan and never folded into `identity`: `recovery.state` is one of `no-journal | recovered | incomplete | unsupported | malformed | lock-unavailable | invalid-root`, `recovery.proceeded` is `true` only for `no-journal` and `recovered`, and `byteInert` is asserted FROM THAT RECOVERED BASELINE, never from process start. NO UNRESOLVED RECOVERY EVER FLOWS INTO PLAN GENERATION: when `recovery.proceeded` is `false` — unresolved external interference, an unreadable journal version, or a concurrent lifecycle entry — NONE of the five planner paths runs, so the response carries no registry delta, no answers, no seeds, no repairs, no payload or artifact preview and no actions, `mode` is `null`, `inventory` reports `unavailable` confidence and can never establish absence, and `findings[]` carries exactly one `plan/halted-unrecovered` error. ONE SCHEMA, ONE IDENTITY: install, reconcile, bootstrap, deregistration, deletion, upgrade, retained-divergence and repair are `mode`s of this ONE envelope — there is no second schema and no per-mode response family, and `mode` is derived from the plan's own content, never asserted by a caller. `actions[]` integrates EVERY action class — evidence repair and seed, registration, deregistration, payload and project-override write, artifact advance, bootstrap and delete, answer binding, constitution recomposition, and non-mutating registry and artifact retentions — into one deterministically ordered list carrying `{kind, order, pluginId, destination, mutating, summary, persisted:false}`. `no-change` implies no action is `mutating`; `applicable` implies at least one is. REPAIR-CAPABLE: a drifted lifecycle comparison (`portable-mismatch`, `root-moved`, `local-mismatch`) yields an explicit previewed repair scoped to the portable or machine-binding half, so a plan reporting drift also carries the effect that resolves it. NO BLOCKING CONDITION IS EVER A SILENT OMISSION: `applicabilityBasis` enumerates every blocking finding and blocking question from the SAME inputs the applicability decision consumed, and an action whose exact proof predicate fails — a `binding-seed` comparison with no observed binding proposal, or a missing-evidence bootstrap without complete observed proof — produces an explicit error finding, a preserved registration, and `not-applicable`, never a silent no-op. IDENTITY: `identity.planId` is a SHA-256 over exactly the enumerated mutation-relevant fact classes reported in `coveredFactClasses`, so a no-change plan has a stable id with zero writes and any change to a covered hash, tuple, binding, owner set, answer, destination, containment, symlink, registry or evidence fact changes it; a finding's code, severity and attribution are covered, its human-readable message deliberately is not. ARTIFACTS: every managed destination the ledger records or an installed pack declares is classified into exactly one evidence-backed form, and nothing wider — pruning unlisted files is out of scope. DELETION ELIGIBILITY IS CONJUNCTIVE AND FAIL-SAFE: an artifact is `deletable` only when every recorded owner is EXPLICITLY deselected AND the current bytes match the PRIOR LEDGER HASH AND ownership is exclusive AND the declared removal semantics permit it. Every missing, conflicting, ambiguous, shared-incomplete, mismatching, or non-reproducible proof class RETAINS the artifact with a closed reason token and grants NO deletion authority — missing evidence never infers permission. Ownerless payloads follow the same rules: an empty owner set is incomplete, not exclusive, ownership. A missing-ledger BOOTSTRAP is previewable only when a trustworthy complete inventory holds AND validated declarations prove canonical destination, reproduced bytes, source fingerprint, complete owners, and the full semantic tuple; it records FUTURE authority and never permits deletion in the same plan. UPGRADE IS HASH-GATED: a source-changed artifact advances only when the current bytes still match the prior ledger hash, and a locally edited file stays `divergent` and not fully upgraded rather than being overwritten. Each decision carries `runnerCandidate` — Node-runner candidacy surfaced in this same plan, never a separate API. Every decision's `persisted` is the literal `false`. PAYLOADS: every acted-on capability's declared `## Payloads` row is previewed as an action carrying the declared destination, the canonical workspace-contained target, the produced-byte SHA-256 and length, the complete `{production, refresh, removal}` tuple, the FULL owner set, and whether the write would create or overwrite. Containment is measured against the admitted workspace root and canonicalized BEFORE the decision, without creating the path being tested — traversal, an absolute path, a symlink that escapes the root, and an out-of-workspace target each make the plan not applicable. Co-ownership of one target is accepted ONLY for byte-identical output AND field-for-field equal generation, refresh and removal semantics; any byte or semantic mismatch blocks deterministically, with no first-writer, registry-order, or model arbitration. Payload workspace containment is distinct from plugin-root validation, which this never performs. `applicability` resolves FIRST-MATCH-WINS as `invalid-root` → `unrecovered` (recovery did not proceed, so no lifecycle state was read and NO claim is made about the selection) → `not-applicable` (a structural error finding) → `blocked` (a missing or invalid project answer) → `no-change` → `applicable`. OMISSION NEVER REMOVES: a registered pack absent from `desired` is retained, so an orphaned or disabled registration can never become an implicit removal — deregistration has its own explicit `deregister` input. A proposed answer is validated through the declared schema and reported as a PENDING write; it is not persisted evidence. A legacy registration's bootstrap seed is previewed only from complete observed proof — otherwise planning is not applicable and the registration is preserved. Writes nothing on any path: no ledger, no seed, no answer, no enablement change.",
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

  // Deliberately NOT `RESIDENT`, for the same reason as `plan_install`: no skill
  // body names `repair_packs` as a mandatory pre-step — it is a maintainer-
  // initiated diagnosis, so it defers behind the host's tool-search surface.
  server.registerTool(
    "repair_packs",
    {
      title: "repair packs",
      description:
        "Recovery-first, then read-only byte-inert production of the COMPLETE repair plan for registration and managed-artifact drift (WF-460). It PRODUCES AND NEVER EXECUTES: there is no repair mutator, and a confirmed repair is executed by handing `plan.identity.planId` to `apply_install`, which re-derives every decision under the exclusive lock. Returns `{plan, diagnosis[], withheldAdvances[]}`, where `plan` is the SAME frozen `plan_install` envelope — `planVersion: 1`, the thirteen-kind ordered `actions[]`, and the SHA-256 `identity.planId` over the same sixteen mutation-relevant fact classes. THERE IS NO SECOND SCHEMA, no `planVersion: 2`, and no new identity fact class. THE SELECTION IS DERIVED, NOT SUPPLIED: `desired` is every REGISTERED pack, and `deregister` is ALWAYS THE EMPTY SET. That is a structural guarantee, not a policy — an artifact reaches the `deletable` form only when every recorded owner is deselected, so with nothing deselected a repair plan CANNOT CONTAIN A DESTRUCTIVE CLAIM AT ALL: no `artifact-delete` action, no `deletable` decision, and no `deletionAuthority: true` anywhere. An installed-but-unregistered pack is deliberately NOT adopted — that would be an install, and repair is not an install surface. FIVE DRIFT STATES THAT DO NOT COLLAPSE, each reported per pack in `diagnosis[]` with its own remedy token: a portable tuple mismatch is `source-drift` and yields a `portable`-scoped `evidence-repair` REGARDLESS OF ROOT; equal portable tuples plus a moved known root is `root-map` and yields a `binding`-scoped repair; equal tuples with an unmoved root and drifted local fingerprints is `local-drift`, also `binding`-scoped and NOT the same observation as a moved root; a missing machine binding is `missing-binding`, which RETAINS the registration and offers a `binding-seed`; and missing portable evidence is `missing-legacy-evidence`, where the pack stays SELECTED AND OPERATIONAL pending a strict `legacy-bootstrap` whose exact proof predicate must hold. A comparison this build does not recognise is `indeterminate` and authorizes NOTHING. AN UNTRUSTWORTHY INVENTORY IS NOT MERELY FLAGGED: only a `trustworthy` inventory may establish that nobody owns a file, so a `duplicate` (reported as `invalid`), `unavailable`, `malformed`, `invalid`, or `partial` inventory raises a plan-level `plan/inventory-untrustworthy` error, making the plan `not-applicable` and enumerating it in `applicabilityBasis.blockingFindings` — on top of the structural guarantee above, so a reader who ignores the flag still finds no destructive claim to act on. THE DIAGNOSIS AGREES WITH THE MUTATOR IT FEEDS: a source-changed artifact whose recorded owner set has MOVED relative to the currently-declared one, or whose declared `{production, refresh, removal}` tuple no longer equals the recorded one, has its advance WITHHELD here and reported in `withheldAdvances[]` as `owner-set-moved` or `declared-tuple-changed`, because `apply_install`'s upgrade gate is obliged to refuse it. Hash-matching source-changed artifacts still advance; an EDITED file stays retained as `divergent`, which is what denies a fully-upgraded claim. Ownerless artifacts follow the established rules unchanged — an empty owner set is INCOMPLETE ownership, never exclusive ownership. IDEMPOTENT, WITH RETAINED DIVERGENCE STILL VISIBLE: two runs over unchanged facts produce an identical `planId`, an identical ordered `actions[]`, and deep-equal responses apart from `recovery`; a retained divergence is reported on EVERY run, because there is no `already-reported` suppression and the retained decision is folded into `planId`. RECOVERY IS REPORTED SEPARATELY AND NEVER FOLDED INTO THE PLAN: before any lifecycle state is read it takes the SAME exclusive machine-local lock `discover_packs` and `plan_install` take and recovers an interrupted transaction from the versioned machine-local journal; `plan.recovery` carries `{state, proceeded, wroteBytes, ...}`, is excluded from `identity`, and when `proceeded` is `false` no lifecycle state is read at all, `mode` is `null`, and one `plan/halted-unrecovered` error is reported. REPAIR NEVER CREATES A JOURNAL, a backup, or a transaction of its own; with none present it acquires and releases the lock and is BYTE-INERT FROM THE RECOVERED BASELINE ONWARD — `plan.byteInert` is the literal `true`. Works against a non-cwd admitted workspace root; an inadmissible declaration returns the same typed `invalid-root` envelope rather than an error, and writes nothing on any path.",
      inputSchema: workspaceOnlyInput,
    },
    async (args: WorkspaceArgs) =>
      guard(() => {
        // The same ONE canonical admission API and the same
        // typed-envelope-not-error contract the planner uses. Repair recovers, so
        // admitting the root before a root-bound service exists is not hygiene —
        // it is what keeps a restore from being attempted against a root that was
        // never admitted.
        const declared = selectWorkspaceRoot(
          { explicit: args.workspaceRoot, cwd: args.workspaceRoot },
          null,
        );
        if (!declared.ok) {
          return repairPacksEnvelopeForRejection(
            declared.source,
            declared.reason,
            declared.diagnostic,
          );
        }

        let service: ResolverService;
        try {
          service = selectService(args.workspaceRoot);
        } catch (err) {
          return repairPacksEnvelopeForRejection(
            declared.source,
            "out-of-family",
            terminalSafeDiagnostic(err),
          );
        }

        return service.repairPacks({
          admitted: true,
          root: declared.root,
          source: declared.source,
          reason: null,
          diagnostic: null,
        });
      }),
  );

  // Deliberately NOT `RESIDENT`, for the same reason as `plan_install`: no skill
  // body names it as a mandatory pre-step. It is also strictly downstream of
  // `plan_install`, so a caller that can reach the planner can reach this.
  server.registerTool(
    "apply_install",
    {
      title: "apply install",
      description:
        "The SOLE public mutator for an EXACT approved plan (WF-453, widened by WF-454, WF-455, WF-456, WF-458 and WF-459) — one guarded, crash-recoverable journaled transaction through refresh, snapshot, and self-check. Returns the versioned envelope `{applyVersion, workspaceRoot, admission, status, reason, transactionId, plan{planId,expectedPlanId,matched,applicability,mode}, applied[], deferred[], upgrade{noDrift,outcome,remaining[],advanced[],repaired[]}, rollback, selfCheck, refreshed, recovery{...}, residue{clean,journalRetained,backupsRetained,detail}, diagnostics[]}`. `status` is one of `applied | rejected | rolled-back | halted | invalid-root`. `upgrade` IS A SEPARATE, DELIBERATELY UNFLATTERING VERDICT, NOT A RESTATEMENT OF `status` (WF-459): `outcome` is one of `no-drift | fully-upgraded | partial | retained-divergence | not-assessed`, and `noDrift` is derived from `remaining` being empty and from nothing else. DOING NOTHING IS NOT THE SAME AS THERE BEING NOTHING TO DO: a run that wrote no artifact because every divergence was RETAINED reports `retained-divergence` with a non-empty `remaining[]`, while a genuinely settled workspace reports `no-drift` with an empty one — the two zero-write states are never conflated. A run that advanced or repaired something AND left anything unresolved is `partial`; `fully-upgraded` is reachable only with `remaining[]` empty. Each `remaining[]` entry names its `subject` and one class — `edited` (the file was changed by hand and is preserved untouched), `refresh-retained` (the declaration forbids replacing it), `unlisted` (advanceable now, but the confirmation does not list it), `ambiguous`, `unverifiable`, or `evidence-drifted` — so a preserved edit is REPORTED rather than absorbed into success. `not-assessed` claims nothing: the artifact world could not be observed. RECOVERY-FIRST AND REPORTED SEPARATELY: before anything is decided it recovers an interrupted transaction through the SAME frozen protocol `discover_packs` and `plan_install` use, and carries that outcome in `recovery`, never folded into `status`; when `recovery.proceeded` is `false` it HALTS with `apply/halted-unrecovered` and mutates nothing. EXACT PLAN ONLY: it takes the exclusive machine-local lock, recomputes the plan UNDER that lock, and requires `identity.planId` to equal the supplied `expectedPlanId` — a mismatch is `apply/plan-stale`, an applicability other than `applicable` is `apply/plan-not-applicable`, and neither writes. A BOUNDED SUPPORTED SET, FAILING LOUDLY AND EARLY: the supported action set is exactly `registry-add`, `registry-deregister`, `evidence-seed`, `answer-write`, `override-write`, `payload-write`, since WF-458 `artifact-bootstrap` and `artifact-delete`, and since WF-459 `artifact-advance` and `evidence-repair`; within `evidence-seed` the supported seed kinds are `binding-seed` and, since WF-458, `legacy-bootstrap`. `constitution-recompose` is CONDITIONALLY supported (WF-455): it is applied when the composed constitution record is already present, and reported in `deferred[]` with reason `no-constitution-record` plus its `/wf:constitution` follow-up when it is not — so a project that has never composed the record behaves exactly as it did before. ANY other mutating action — a retain kind (`registry-retain`, `artifact-retain`) reaching this operation as mutating — is `apply/unsupported-action` BEFORE a journal exists, and an unsupported seed kind refuses the whole plan the same way. Admission to the screen is permission to be CONSIDERED by the whole-plan gate that follows, never permission to write. THE WHOLE PLAN IS SCREENED BEFORE THE FIRST BYTE IS COMPOSED, so an unsupported action can never follow a supported subset that was already written. WHAT A NEW REGISTRATION PERSISTS, TOGETHER OR NOT AT ALL: the pack's exact observed portable tuple, its initial machine binding, its registry rows, the revalidated project answers as capability profile seeds, the selected evidence ledger, and the refreshed snapshot — one ordered target set under ONE journal. WHAT AN EXISTING REGISTRATION PERSISTS: an `evidence-seed` seeds ONLY the missing machine binding, and only when the committed portable tuple and the observed one are EXACTLY equal — not compatible, not a superset. The committed portable half never becomes a target on that path, so committed evidence stays byte-identical down to its inode; a pack that already has a recorded binding, or whose tuple has moved, is `apply/evidence-precondition` and nothing is written. WHAT AN APPROVED OVERRIDE PERSISTS: an `override-write` composes ONLY a declared committed project-override artifact — `.wf/slots/<skill>.<point>.md` — whose authority comes from the resolver's lifecycle ownership PLUS that declared artifact class, never from the `.wf/` path prefix; every owner's declared source is re-fingerprinted under the lock against the approved `identity.sha256`/`bytes`, and any drift is `apply/override-precondition` with nothing written. WHAT AN APPROVED PACK PAYLOAD PERSISTS: a `payload-write` installs a declared `## Payloads` destination for the SELECTED owning capabilities only — a bare core with zero selected packs composes no payload target, records no artifact evidence, and creates no directory. Under the lock it re-derives four facts and refuses on any of them with `apply/payload-precondition`, writing nothing: the destination re-resolves through the no-create containment boundary to the SAME canonical target the plan previewed (traversal, an absolute path, a symlink escape, an out-of-workspace target, a non-regular file, and an unresolvable probe each report their own closed token), every owner's declared source still reproduces the approved `identity.sha256`/`bytes`, every owner's currently-declared `{production, refresh, removal}` tuple is FIELD-FOR-FIELD equal to the approved one, and the set of capabilities declaring the destination is EXACTLY the approved owner set — an owner that appeared and an owner that vanished both refuse. Bytes and semantics are independent axes and are checked independently. The complete owner set, both digests and the full tuple are recorded as `ArtifactEvidence` in the ledger's portable `artifacts` section, in the SAME transaction as the payload itself, so ownership can never be recorded for a file that was not installed. A payload aimed at the committed project-override tier is refused — that is a different declared artifact class with its own action kind. WHAT AN APPROVED REMOVAL DOES, AND THE SIX THINGS IT NEVER DOES (WF-458): removals, ownership bootstraps and legacy seeds pass a SECOND whole-plan gate, run after the action screen and before a single target is composed. Deletion requires POSITIVE PROOF, re-derived from facts re-observed under the lock: the artifact is listed by the approved plan, still classifies as `deletable`, carries two WELL-FORMED and equal SHA-256 digests, has a non-empty recorded owner set every member of which this plan deselects, and declares `removal: delete-if-unmodified`. Absence of proof PRESERVES, and every preserved artifact is reported in `diagnostics[]` under exactly one named class — `retained`, `unlisted` (deletable now, but the confirmation does not list it: one confirmation authorizes only the exact listed actions), `shared` (a recorded owner survives the plan), `edited` (current bytes differ from the prior ledger hash), `ambiguous` (ownership or a digest is present but not trustworthy), or `unverifiable` (the bytes or the destination could not be established). A destination carrying BOTH a bootstrap and a deletion in one plan is `apply/bootstrap-delete-conflict` — reconstructing evidence never doubles as authority to act on it — and an ownership bootstrap RETAINS every candidate, records the complete owner set, and grants no same-plan deletion even when every proven owner is also deselected. Any changed bound precondition rejects the WHOLE plan with `apply/artifact-precondition`; nothing is written and nothing is removed. The removal target carries the proven digest INTO the transaction and the bytes are re-compared at observation time, one stage before the backup, so a file whose content moved between the decision and the entry is `apply/precondition-moved` with no journal created. The artifact's ownership proof is erased in the SAME transaction that removes the file, so a removed artifact can never leave a record that re-proposes it forever. WHAT AN APPROVED UPGRADE DOES, AND WHAT IT NEVER OVERWRITES (WF-459): artifact upgrades and evidence repairs pass a THIRD whole-plan gate, run after the removal gate and before a single target is composed. An advance requires POSITIVE PROOF re-derived from facts re-observed under the lock: the destination is listed by the approved plan, still classifies as `advance`, its current bytes still hash EXACTLY to the prior ledger digest (both digests well-formed), its recorded owner set is non-empty and has NOT moved relative to the currently-declared one, its declared `{production, refresh, removal}` tuple still equals the recorded one with `refresh: replace-if-unmodified`, and the newly declared source fingerprint is well-formed AND actually different from the recorded one. AN EDITED ARTIFACT IS NEVER OVERWRITTEN AND NEVER CONVERTED INTO SUCCESS — it is preserved byte-for-byte and named in `upgrade.remaining[]` as `edited`. A destination carrying BOTH an upgrade and a deletion in one plan refuses the whole plan, and an advance grants no deletion authority. The new bytes and the NEW ownership record are composed into the SAME transaction, so an upgrade is atomic: new bytes under a stale proof, or a new proof over stale bytes, both read as `edited` on the next run and are refused here instead. AN EVIDENCE REPAIR IS SCOPED, AND THE SCOPE IS RE-DERIVED FROM THE COMPARISON OBSERVED UNDER THE LOCK, never trusted from the approved action: a `portable` repair (the committed tuple disagrees with the installed pack) re-establishes the portable evidence AND the applicable machine binding; a `binding` repair (a moved root, drifted local fingerprints) re-establishes ONLY machine-local facts and may not touch the shared portable half. A repair whose drift has resolved itself, changed shape, or whose halves could not be reproduced is `apply/evidence-precondition`, and the existing record is preserved exactly as it was. Every rejection above happens before any journal, backup, or byte. WHAT A LEGACY BOOTSTRAP PERSISTS: the observed portable tuple WHOLE or not at all, plus the initial binding. Proof that could not be reproduced under the lock, a pack that has ACQUIRED portable evidence since the plan was approved, an incomplete tuple, and a tuple that is not EXACTLY the approved one are each `apply/evidence-precondition` — and each PRESERVES the existing registration exactly as it was rather than recording a partial tuple, which would look authoritative. WHAT A RECOMPOSITION PERSISTS: only the composed constitution's derived capability-articles section is re-rendered — the preamble, the core articles, and the project's own clause section are carried across BYTE-FOR-BYTE — and a record whose structure the composer does not recognize is `apply/constitution-precondition` rather than a silent reset. A rendered target whose bytes would not change is DROPPED, and a plan whose every target is a no-op is `apply/plan-not-applicable` rather than an empty transaction. Every rejection above, plus a stale identity-bound precondition, a destination that is a symlink or does not resolve inside the admitted workspace, and a journal already present, is decided BEFORE journal creation and BEFORE any mutation, so nothing can be left half-undone. CONCURRENT LIFECYCLE ENTRY IS REFUSED: a lock already held is `apply/lock-held`, and with no lock primitive available it refuses with `apply/lock-unavailable` rather than mutating unserialized. THE TRANSACTION IS CRASH-RECOVERABLE AT EVERY STAGE: the journal (recording the prior existence, type, inode, hash and the exact bytes this transaction will write) is created and durable BEFORE the backup and BEFORE the destination is touched, the backup is verified against the recorded prior hash, the destination's type/inode/hash are RE-CHECKED without following links immediately before the write, the replacement is a create-exclusive fsynced sibling temp file renamed into place, and completion removes the journal BEFORE the backups. An ordinary failure or a process kill at ANY stage therefore restores the exact prior state idempotently — the same restore runs on a second entry and converges. A FAILED SELF-CHECK IS TRANSACTION FAILURE, NOT A WARNING: after the write it refreshes and re-resolves the registry, asserting that every added capability resolves `ok`, that every deregistered one is gone, that every written override hashes back to its approved digest AND is seen as the committed project tier for its slot, that every installed payload hashes back to its approved digest AND reads back from the ledger's `artifacts` section carrying its COMPLETE owner set, that a recomposed constitution reads back still carrying its project-clause section, and — since WF-458 — that every removed artifact is BOTH absent from the workspace AND gone from the ledger's `artifacts` section, that every bootstrapped artifact still holds the exact bytes it was proven over and reads back with its complete owner set, and that every legacy-seeded pack's portable half reads back; and — since WF-459 — that every UPGRADED artifact now holds the new produced digest AND that its ledger record names the new declared source fingerprint with an unchanged complete owner set, and that every REPAIRED pack's machine binding reads back (plus its portable half, for a `portable`-scoped repair only); failure rolls back and reports `apply/self-check-failed`. NO SUCCESS IS CLAIMED WHEN ANYTHING IS UNRESOLVED: rollback runs through the frozen recovery decision — an external edit or a symlink swap is PRESERVED, an unaffected artifact is restored, an unverifiable one is left explicitly UNRESOLVED — and an incomplete rollback overrides the reported reason with `apply/rollback-incomplete`, retains the journal and backups, and reports `residue.clean:false`. `applied[]` is non-empty ONLY for `status: applied`, where the change is durable and the residue is clean. Works against a non-cwd admitted workspace. Out of scope, and never written by this operation: pack evidence removal — a deregistration deliberately leaves the pack's own evidence record standing, since a stale record re-proposes a seed while a wrongly-erased one loses the only proof the pack was ever installed; and any automatic resolution of an edited artifact, which is preserved and reported, never merged, converted, or overwritten. Removal, bootstrap, upgrade and repair ELIGIBILITY also stays out of scope, exactly as payload eligibility does — this operation executes the plan's canonical decisions and revalidates every one of them against current facts; it never re-decides one, and never widens a plan on its own authority. Slot precedence is unchanged — personal `_local/` override over committed project override over pack contribution over inline default.",
      inputSchema: applyInstallInput,
    },
    async (args: WorkspaceArgs & ApplyInstallArgs) =>
      guard(() => {
        // Same ONE canonical admission API and the same typed-envelope-not-error
        // contract as the planner. Admitting BEFORE a root-bound service exists is
        // load-bearing here rather than hygienic: this operation's ports take a
        // lock and write bytes, and neither must ever be attempted against a root
        // that was never admitted.
        const declared = selectWorkspaceRoot(
          { explicit: args.workspaceRoot, cwd: args.workspaceRoot },
          null,
        );
        if (!declared.ok) {
          return applyInstallEnvelopeForRejection(
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
          return applyInstallEnvelopeForRejection(
            declared.source,
            "out-of-family",
            terminalSafeDiagnostic(err),
            args,
          );
        }

        return service.applyInstall(
          { admitted: true, root: declared.root, source: declared.source, reason: null, diagnostic: null },
          toPlanSelection(args),
          args.expectedPlanId,
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

  // --- run evidence (WF-490) -----------------------------------------------
  //
  // The emission path and the read/match API for the machine-emitted run-evidence
  // class. Deliberately NOT `RESIDENT`: each is named at one call site inside a
  // skill body rather than on every skill's Prerequisites path, so it defers
  // behind tool-search like every other non-boot tool.
  //
  // NOTE THE INPUT SCHEMAS ARE SMALL ON PURPOSE. The caller supplies only what it
  // alone knows; there is deliberately no `runId`, `issuedAt`, `sequence`,
  // `workspaceRoot`-as-attestation, `sha256` or `seal` input, because a caller
  // able to supply any of those could compose a receipt — which is the exact
  // defect this mechanism exists to close.

  server.registerTool(
    "record_run_evidence",
    {
      title: "record run evidence",
      description:
        "Record one machine-emitted run-evidence entry — the resolver-issued receipt a receipt-bearing phase files at its actual completion point, and the same path a per-gate self-approval record travels. The caller names only `kind`, `subject` (the receipt-bearing phase, or the gate token) and `taskId`, plus the workspace-relative `artifactPath` the phase wrote when it wrote one; the resolver derives the run identity, workspace, timestamp, sequence and run mode itself, reads and digests the named artifact itself (over raw bytes, and only after resolving it inside the workspace), and seals the record with a machine-local issuer binding no tool serves. Returns `recorded` with the sealed entry's metadata — including `runMode` (`unattended` | `attended` | `unestablished`), the mode the resolver OBSERVED and sealed, never one the caller supplied — or `refused` with a stated reason: an unknown kind, a subject outside the closed receipt-bearing set, a named artifact that is absent or resolves outside the workspace (so an incomplete phase yields no receipt), or a ledger this release cannot read, whose refusal names the ledger destination and the remedy. Never returns a body, and never accepts a caller-supplied digest, identity, mode or seal.",
      inputSchema: recordRunEvidenceInput,
    },
    async (args: WorkspaceArgs & { kind: string; subject: string; taskId: string; artifactPath?: string | null }) =>
      selected(args, (service) =>
        service.recordRunEvidence({
          kind: args.kind,
          subject: args.subject,
          taskId: args.taskId,
          artifactPath: args.artifactPath ?? null,
        }),
      ),
  );

  server.registerTool(
    "read_run_evidence",
    {
      title: "read run evidence",
      description:
        "Read and match one task's run evidence — the read side of the resolver-issued receipt class. Returns three separate populations, never one blended count: `matched` entries whose seal the machine-local issuer proved, `unmatched` entries each carrying its own stated reason (`seal-absent` for a hand-written artifact, `seal-mismatch`, `record-inadmissible`, `run-mismatch`, `task-mismatch`, or `issuer-unavailable`), and a count of records too malformed to read at all. Each `matched` entry carries its sealed `kind`, `subject`, `evidenceClass` (`artifact-backed` | `invocation-only`) and `runMode` — the mode THAT record was issued under — plus `artifactState`, which the resolver computes at READ time by re-reading and re-digesting the named artifact: `fresh` (unchanged since it was approved), `stale` (the bytes have since changed), `missing` (no longer readable, or no longer resolving inside the workspace), or `n/a` (the record named no artifact). A consumer gating on an approval must check `artifactState`; nothing else reports that the approved artifact has since changed. The top-level `observedRunMode` is a different fact — the mode of the READING session — and the two legitimately differ. `provenPhases` lists only the receipt-bearing phases actually proven, counting `phase-receipt` records alone, so a `gate-approval` never proves a phase; `receiptBearingPhases` states the closed set they are drawn from. A ledger declaring an unrecognised `formatVersion` returns `unsupported` and refuses rather than improvising a match; an absent ledger returns `absent`. Nothing here rounds an unmatched entry up to a receipt.",
      inputSchema: readRunEvidenceInput,
    },
    async (args: WorkspaceArgs & { taskId: string }) =>
      selected(args, (service) => service.readRunEvidence(args.taskId)),
  );
}
