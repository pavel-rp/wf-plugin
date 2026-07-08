# ado capability — the `tracker` fragment (reference)

**What this doc is:** the **reference half** of the ado tracker provider — scope framing,
the grounding legend, per-operation grounding status and rationale, and the contract
coverage table. It is **not read at a tracker-surface boot**; the runtime-read half is
[`tracker.ops.md`](tracker.ops.md) (every input, guard, tool binding, and outcome
mapping lives there). This file explains *why* those bindings are shaped as they are and
records how firmly each is grounded.

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

The runtime-ops file is scoped to the Azure DevOps **mechanics** of each operation only.
Two concerns are explicitly **not** its job:

- **Deriving a value from a tracker record** — composing a branch name or commit subject
  from a work item's id and title, or any other value that depends on the tracker's
  shape. Every operation **consumes** an already-resolved id / title / body / field value
  — it never derives one. That derivation is the caller's (core's) responsibility.
- **The no-provider local-id fallback.** When no capability owns the `tracker` surface,
  core falls back to its own local `T<NNN>` id scheme — that is core's defined behaviour
  for the unconfigured case (see `capability-registry.ops.md` §"The tracker provider
  surface"), not a procedure the ops file implements.

## Grounding legend

Each operation below is tagged with how firmly its ADO MCP tool name is established in
this codebase, per the plan's "ask first" boundary — a tool name this codebase has never
called must be verified against the live tool catalog, not guessed:

- **Grounded** — this codebase already calls exactly this tool for exactly this purpose.
- **Grounded — field usage to confirm** — the tool itself is grounded, but this
  operation's specific field/parameter shape has never been exercised.
- **Unverified — tool name not yet confirmed** — no skill in this codebase has ever
  exercised this operation in this direction; the ops file's `Tool:` line carries the
  literal `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet
  confirmed>` marker rather than an invented name. A live ADO MCP catalog check was
  attempted twice — once during planning and once during this capability's own
  implementation (both via `ToolSearch` for ado/azure-devops/work-item tools) — and both
  returned **zero** ADO tools: no ADO MCP server was connected in either environment, so
  the marker could not be resolved to a real tool name and is carried forward unresolved.
  Whoever next implements a tracker-consuming core skill against this fragment, with a
  live ADO MCP catalog available, must replace the marker with the confirmed tool name
  before treating that binding as final.

---

## Per-operation rationale

The runtime procedure for each operation is in [`tracker.ops.md`](tracker.ops.md); the
notes below record each binding's grounding status and the load-bearing choices behind
it.

## resolve_config

- **Configured/unconfigured gate is behaviour-bearing, so it lives in the ops file.** It
  decides whether the tracker is live or the run degrades to the silent local-only
  fallback — not rationale, an outcome. A pure local config read, no MCP call.
- **Grounding:** Grounded — local-only, no tool involved.

## create_umbrella

- **Idempotency is the same metadata-line guard `pr-create` uses** in the `delivery`
  surface (`plugins/wf-git/capabilities/git/fragments/delivery.md` §"pr-create"): the
  returned id is recorded as a `**<label>:** <value>` line in the triggering artifact and
  read back before any re-invocation, so an umbrella is never created twice for the same
  artifact/slot.
- **Grounding:** Unverified — tool name not yet confirmed. No skill in this codebase has
  ever created a work item; only read/update paths are exercised today.

## create_child

- **Same idempotency guard as `create_umbrella`** — the child id is recorded and read
  back before re-invocation. Used both for a task's own child work items and for further
  nesting beneath those.
- **Grounding:** Unverified — tool name not yet confirmed. No skill in this codebase has
  ever created a child work item.

## update

- **Grounded tool, narrower usage today.** `mcp_ado_wit_update_work_item` is the same
  tool `plugins/wf/skills/spec/SKILL.md` Phase 0 step 4 already calls to backfill an empty
  `Dev` child's `System.Description` from its parent. Today's only core usage patches
  exactly one field under narrow backfill conditions; the ops binding is deliberately
  **not** limited to that field — the narrowness lives in core's calling convention, not
  in this operation's contract.
- **Grounding:** Grounded — tool confirmed; field usage as exercised today is narrower
  than this operation's full scope.

## get

- **The most heavily exercised operation in this codebase.** The `expand: "all"` fetch is
  the same call shape `plugins/wf/skills/spec/SKILL.md` Phase 0 step 1,
  `plugins/wf/skills/lite/SKILL.md` Phase 1 step 1, and `plugins/wf/skills/triage/SKILL.md`
  Phase 1 step 1 already use — one fetch returns description, acceptance criteria, and
  relations together, so no probe pair exists to consolidate.
- **Grounding:** Grounded.

## list_children

- **Reverse of the exercised direction.** Today's codebase only ever resolves a child's
  *parent* (`get`'s relations expansion, consumed by `spec`'s Phase 0 step 2
  parent-context resolution) — never a parent's *children*. This direction has never been
  exercised.
- **Grounding:** Unverified — tool name not yet confirmed.

## post_comment

- **Read, never written, today.** The codebase only **reads** comments
  (`plugins/wf/skills/spec/SKILL.md` Phase 0 step 5, via
  `mcp_ado_wit_list_work_item_comments`, grounded for reading) — it has never posted one.
- **Grounding:** Unverified — tool name not yet confirmed.

## set_status

- **Grounded tool, unexercised field.** Plausibly `mcp_ado_wit_update_work_item` — the
  same already-grounded `update` tool, patching the `System.State` field. The tool is
  grounded; the `System.State` field-shape usage specifically has never been exercised by
  any skill in this codebase, so it is marked **to confirm** rather than asserted.
- **Grounding:** Grounded — field usage to confirm.

## attach_link

- **A zero-MCP-call convention, not an API call.** Embedding the literal `AB#<id>` in the
  PR body lets Azure Boards autolink the PR to the work item server-side on merge. This is
  exactly the convention `plugins/wf/agents/pr.md`'s PR body template already uses
  (`Resolves AB#{numeric-id}.`, §"Work-item link"); `plugins/wf/skills/pr/SKILL.md`
  corroborates it in prose ("linked by putting `AB#<id>` in the PR body").
- **Grounding:** Grounded — the literal-embed convention is already in production use in
  `plugins/wf/agents/pr.md`, corroborated by `plugins/wf/skills/pr/SKILL.md`.

## list_by_status

- **A work-item query, unexercised in this codebase.** ADO filters work items by
  `[System.State]` through a WIQL query; no skill here has ever run a WIQL query (only
  single-id `get`/`update` calls), so the query-tool name is unverified. A read: an
  unconfigured tracker returns an empty result and never warns, per the contract's
  degradation rules.
- **Grounding:** Unverified — tool name not yet confirmed.

## list_milestones

- **ADO has no first-class milestone entity — iteration paths stand in.** The project's
  iteration classification nodes (the Iteration hierarchy) are ADO's native coarse
  schedule markers; enumerating them is the honest binding for an abstract "milestone"
  enumeration. Deliberately distinct from `list_cycles` (a team's subscribed iterations),
  so the two do not collapse into one call.
- **Grounding:** Unverified — tool name not yet confirmed.

## list_cycles

- **A team's iterations (sprints) are ADO's time-boxed cycles.** Read via the team's
  iteration subscription (team settings), distinct from the project-wide iteration paths
  `list_milestones` reads. Never exercised here.
- **Grounding:** Unverified — tool name not yet confirmed.

---

## Coverage table

Completeness self-check — every operation the tracker contract names
(`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker provider
surface", whose normative runtime text is `capability-registry.ops.md` §"The tracker
provider surface"), bound to exactly one `## ` section in `tracker.ops.md`, none unbound:

| Contract operation | ops.md section  | Grounding status                         |
|--------------------|-----------------|------------------------------------------|
| `resolve_config`   | `resolve_config`| grounded                                 |
| `create_umbrella`  | `create_umbrella`| unverified — tool name not yet confirmed |
| `create_child`     | `create_child`  | unverified — tool name not yet confirmed |
| `update`           | `update`        | grounded                                 |
| `get`              | `get`           | grounded                                 |
| `list_children`    | `list_children` | unverified — tool name not yet confirmed |
| `post_comment`     | `post_comment`  | unverified — tool name not yet confirmed |
| `set_status`       | `set_status`    | grounded — field usage to confirm        |
| `attach_link`      | `attach_link`   | grounded                                 |
| `list_by_status`   | `list_by_status`| unverified — tool name not yet confirmed |
| `list_milestones`  | `list_milestones`| unverified — tool name not yet confirmed |
| `list_cycles`      | `list_cycles`   | unverified — tool name not yet confirmed |

All twelve operations are bound; none is unbound.
