# linear capability — the `tracker` fragment (reference)

**What this doc is:** the **reference half** of the linear tracker provider — scope
framing, the two-axis grounding legend, per-operation grounding status and rationale, and
the contract coverage table. It is **not read at a tracker-surface boot**; the
runtime-read half is [`tracker.ops.md`](tracker.ops.md) (every input, guard, MCP tool
binding, and outcome mapping lives there). This file explains *why* those bindings are
shaped as they are and records how firmly each is grounded.

**Model:** claude-opus-4-8

---

## How a core skill reaches this provider

A core skill reaches the runtime-ops half through **direct provider resolution**: it
resolves the registry row where `contribution-kind = provider AND scope = tracker`, sees
`dispatch: inline: fragments/tracker.ops.md`, reads that file, and **follows it
in-context**. No subagent is spawned; there is no phase-firing gate — any core skill, at
any point in its own procedure, may invoke any operation. The full procedure this reuses
is `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider
resolution".

## Scope

The runtime-ops file is scoped to the Linear **mechanics** of each operation only. Two
concerns are explicitly **not** its job:

- **Deriving a value from a tracker record** — composing a branch name or commit subject
  from an issue's id and title, or any other value that depends on the tracker's shape.
  Every operation **consumes** an already-resolved id / title / body / field value — it
  never derives one. That derivation is the caller's (core's) responsibility.
- **The no-provider local-id fallback.** When no capability owns the `tracker` surface,
  core falls back to its own local `T<NNN>` id scheme — that is core's defined behaviour
  for the unconfigured case (see `capability-registry.ops.md` §"The tracker provider
  surface"), not a procedure the ops file implements.

## Id shape — why there is no local prefix

When `linear` owns the tracker surface a task id has the shape `<LETTERS>-<NUMBER>` (e.g.
`WF-136`) — Linear's own identifier format, which the contract's id-shape rule
accommodates as an opaque, provider-supplied id. The contract prescribes **no** specific
format: it treats the active provider's id as opaque, with `T<NNN>` only as the
no-provider fallback. Unlike Azure DevOps' `{wi-prefix}-{id}` (a locally-configured prefix
glued to a bare numeric id), Linear **mints the whole identifier itself** from the issue's
team key plus a per-team sequence number — there is no local "prefix" config value to
carry, which is why the ops file's `create_umbrella` / `create_child` simply return
whatever identifier `save_issue`'s response contains.

## Failure handling — warn-once-continue

Any operation whose MCP call fails after the tracker was configured (auth error, rate
limit, MCP unavailable) is surfaced with a **single** warning naming the failing operation
and the error, then the caller continues in **local-only** mode for the remainder of the
run — no retry, no repeated warnings for the same run. A tracker failure never blocks a
local artifact write; the local file is always the source of truth. This is core's own
degradation behaviour, stated verbatim in `capability-registry.ops.md` §"The tracker
provider surface" ("Degradation rules") — the ops file surfaces the tool's error to the
caller, which applies this rule.

## Local-first writes (caller discipline)

The caller (a core skill) always writes its local artifact first; a tracker call is a
**publish** step layered on top, never the primary write. `create_umbrella` and
`create_child` state this explicitly as single-shot-publish idempotency; every other
operation (`update`, `post_comment`, `set_status`, `attach_link`) is likewise invoked only
after the corresponding local state already exists.

## Grounding legend

Each operation is tagged on **two independent axes**, since the confidence backing them
differs:

- **Tool name** — whether the named `mcp__claude_ai_Linear__*` tool is a real,
  currently-connected MCP tool. Every tool named is **confirmed** — it appears verbatim in
  this session's live MCP tool catalog (the deferred-tool list Claude Code exposes for the
  connected `claude.ai Linear` MCP server), strictly stronger evidence than the ADO
  tracker fragment could obtain (no ADO MCP server was connected in either environment
  that authored it).
- **Parameter shape** — whether the exact field names (`teamId`, `parentId`, `stateId`, …)
  and call pattern are drawn from an independent live call in this codebase, or from the
  worked draft this fragment follows
  (`_local/research/high-specs/findings/07-tracker-capability.md`, itself citing a skill
  implementation in a *different* installed plugin cache — `dev-workflow/wf/1.0.0`, not
  this repo). No call in *this* repo has exercised any of these operations yet, so every
  parameter shape below is **draft-sourced**, not independently re-verified against a live
  response schema.

Every operation is therefore tagged **"tool confirmed; parameter shape per draft"** —
never bare "Grounded" — so a future implementer knows exactly what has and hasn't been
independently exercised.

---

## Per-operation rationale

The runtime procedure for each operation is in [`tracker.ops.md`](tracker.ops.md); the
notes below record each binding's grounding status and the load-bearing choices behind it.

## resolve_config

- **Configured/unconfigured gate is behaviour-bearing, so it lives in the ops file.** It
  decides whether the tracker is live or the run degrades to the silent local-only
  fallback. **Linear Project** never gates it — a secondary scoping value, defaulted to
  the literal `none`. **WF-300:** the `## Linear` provider-config section is read from
  `_local/config.md` **unconditionally**, never from a relocated `registryPath`. The
  resolver's `registryPath` (from `wf.config.js`) governs where the capability **registry**
  — the `## Capabilities` table — lives; it does **not** move core or provider config,
  which always stay in `_local/config.md`. The resolver models this split directly: it
  reads core/provider config from `_local/config.md` unconditionally
  (`engine.ts` `DEFAULT_REGISTRY_RELPATH`) and honors a relocated `registryPath` only for
  the registry table, and it fingerprints `registry` and `core-config` as two distinct
  source inputs. The Linear fragment never reads the registry table, so it has no use for
  `registryPath` — an earlier revision (WF-282) wrongly anchored the section read to the
  resolver-supplied `registryPath`, which reads the wrong file whenever a project relocates
  the registry, treating a validly configured tracker as unconfigured. The Linear section's
  own values still remain a direct local read: the resolver's snapshot has a
  `providerConfig` field reserved for exactly this (consumer inventory §7 field #9), but it
  is deliberately left unpopulated by core — a provider-specific config-section name is
  domain knowledge core doesn't carry — and no typed tool exposes it yet, so this fragment
  reads its own section directly from `_local/config.md`.
- **Grounding:** Grounded — a direct local read of `_local/config.md`, no resolver query
  and no Linear tool involved.

## create_umbrella

- **Idempotency is the same metadata-line guard `pr-create` uses** in the `delivery`
  surface (`plugins/wf-git/capabilities/git/fragments/delivery.md` §"pr-create"): the
  returned id is recorded as a `**<label>:** <value>` line in the triggering artifact and
  read back before any re-invocation, so an umbrella is never created twice for the same
  artifact/slot.
- **Grounding:** Tool confirmed (`save_issue` is live in this session's MCP catalog);
  parameter shape per draft.

## create_child

- **Same idempotency guard as `create_umbrella`.** Linear's sub-issue nesting carries no
  depth limit this fragment needs to guard against (see
  `_local/research/high-specs/findings/07-tracker-capability.md` for the depth-limit
  research this binding relies on).
- **Grounding:** Tool confirmed; parameter shape per draft.

## update

- **`save_issue` is the single create-or-update primitive** for every Linear write — an
  `id` selects update, its absence selects create. The binding is unrestricted.
- **Grounding:** Tool confirmed; parameter shape per draft.

## get

- **Grounding:** Tool confirmed; parameter shape per draft.

## list_children

- **Grounding:** Tool confirmed; parameter shape per draft.

## post_comment

- **Grounding:** Tool confirmed; parameter shape per draft.

## set_status

- **Why the status lookup is fresh each call.** Workflow states differ by team, and a
  state id cached from one team's workflow is not portable to another — so the ops file
  resolves `status_name → stateId` via `list_issue_statuses` per call rather than caching
  it across the run.
- **Grounding:** Tool confirmed; parameter shape per draft.

## attach_link

- **An explicit MCP call, not a passive convention.** Unlike ado's `AB#<id>` autolink (a
  zero-MCP-call side effect of Azure Boards parsing PR bodies at merge time), this fragment
  makes no claim that Linear auto-links a PR from body text alone — that would depend on a
  workspace-level Linear↔GitHub integration this fragment cannot assume is configured.
  `attach_link` is always an unconditional, explicit `create_attachment` call.
- **Grounding:** Tool confirmed; parameter shape per draft.

## list_by_status

- **Reuses `set_status`'s fresh-lookup discipline.** The status name is resolved to a
  `stateId` per call via `list_issue_statuses` (states differ by team; a cached id is not
  portable), then `list_issues` is filtered by that state and the resolved team/project
  scope. A read: an unconfigured tracker returns an empty result and never warns.
- **Grounding:** Tool confirmed (`list_issues`, `list_issue_statuses` are live in this
  session's MCP catalog); filter shape unexercised here.

## list_milestones

- **Linear milestones are project-scoped.** `list_milestones` enumerates a project's
  milestones; with no project configured (**Linear Project** = `none`) there is nothing to
  enumerate, so the op returns an empty list rather than erroring.
- **Grounding:** Tool confirmed (`list_milestones`); filter shape unexercised here.

## list_cycles

- **Linear cycles are team-scoped.** `list_cycles` enumerates the resolved team's cycles —
  Linear's first-class time-boxed iteration, a cleaner match than ado's iteration-path
  stand-in for the same abstract operation.
- **Grounding:** Tool confirmed (`list_cycles`); filter shape unexercised here.

## list_blockers

- **Linear surfaces blocking relations first-class as `blockedBy`.** The contract's abstract
  "task ids that block a given task" maps directly onto Linear's `blockedBy` relation set —
  no derivation, no heuristic. `get_issue` with `includeRelations: true` returns the issue's
  `relations` object (`blocks` / `blockedBy` / `relatedTo` / `duplicateOf`); this operation
  reads only `blockedBy`. No separate list tool is needed — one enriched `get_issue` fetch
  carries the whole relation set.
- **An empty set is the no-blockers answer, never an error** — a task with no `blockedBy`
  edge returns `[]`, per the contract's read-degradation rule.
- **Grounding:** Tool confirmed — `mcp__claude_ai_Linear__get_issue` is live in this session's
  MCP catalog and its `includeRelations` parameter and `relations.blockedBy` response field
  were exercised directly against a real issue during this task's own authoring (the WF-315
  fetch returned a populated `relations.blockedBy`), so the relation-field usage is
  independently observed, not draft-sourced.

---

## Coverage table

Completeness self-check — every operation the tracker contract names
(`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker provider
surface", whose normative runtime text is `capability-registry.ops.md` §"The tracker
provider surface"), bound to exactly one `## ` section in `tracker.ops.md`, none unbound:

| Contract operation | ops.md section  | Grounding status                          |
|--------------------|-----------------|-------------------------------------------|
| `resolve_config`   | `resolve_config`| tool confirmed (local-only, no tool)      |
| `create_umbrella`  | `create_umbrella`| tool confirmed; parameter shape per draft |
| `create_child`     | `create_child`  | tool confirmed; parameter shape per draft |
| `update`           | `update`        | tool confirmed; parameter shape per draft |
| `get`              | `get`           | tool confirmed; parameter shape per draft |
| `list_children`    | `list_children` | tool confirmed; parameter shape per draft |
| `post_comment`     | `post_comment`  | tool confirmed; parameter shape per draft |
| `set_status`       | `set_status`    | tool confirmed; parameter shape per draft |
| `attach_link`      | `attach_link`   | tool confirmed; parameter shape per draft |
| `list_by_status`   | `list_by_status`| tool confirmed; filter shape unexercised  |
| `list_milestones`  | `list_milestones`| tool confirmed; filter shape unexercised  |
| `list_cycles`      | `list_cycles`   | tool confirmed; filter shape unexercised  |
| `list_blockers`    | `list_blockers` | tool confirmed (`get_issue`); `blockedBy` observed |

All thirteen operations are bound; none is unbound.

**Not e2e-observed (accepted, per WF-136's scope):** `create_umbrella`, `create_child`,
and `update` have no create-consuming core touchpoint in this codebase today — no core
skill currently calls them end-to-end. They are bound at the fragment level (procedure,
parameters, idempotency) but are **not** e2e-tested here; that is expected until a core
skill exercises the create path.
