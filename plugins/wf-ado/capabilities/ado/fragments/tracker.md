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

A core skill reaches the runtime-ops half through **direct provider resolution**: before resolver
MCP calls it runs `pwd -P` and explicitly passes the returned absolute current Agent/session
workspace directory as `workspaceRoot`; in a linked-worktree Agent, that cwd is its own worktree,
never an inherited parent root. Omission is a hard schema error with no default or fallback. It then resolves the registry row where
`contribution-kind = provider AND scope = tracker`, sees
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
- **Grounded — confirmed against the published tool catalog** — no skill in this
  codebase has called the tool yet, but a live ADO MCP connection was still unavailable
  (a third `ToolSearch` attempt, same result as the two below), so the tool name was
  instead confirmed against `microsoft/azure-devops-mcp`'s own published
  `docs/TOOLSET.md` — the upstream source of truth the connected MCP server's catalog is
  generated from. Naming matches the already-grounded `mcp_ado_wit_get_work_item` /
  `mcp_ado_wit_update_work_item` prefix convention. Still unexercised end-to-end; the next
  skill that actually calls it should fold this note into a plain **Grounded** once it
  has.
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
  before treating that binding as final. (`create_umbrella`, `create_child`,
  `list_children`, `post_comment` were resolved this way — see the tier above; the three
  read-only query operations below remain in this unresolved tier.)

---

## Per-operation rationale

The runtime procedure for each operation is in [`tracker.ops.md`](tracker.ops.md); the
notes below record each binding's grounding status and the load-bearing choices behind
it.

## resolve_config

- **Configured/unconfigured gate is behaviour-bearing, so it lives in the ops file.** It
  decides whether the tracker is live or the run degrades to the silent local-only
  fallback — not rationale, an outcome. **WF-280:** the registry-location half now comes
  from the bundled `wf-resolver` MCP tool's typed `resolve_config({ workspaceRoot: <current Agent/session absolute workspace directory> })` query (`registryPath`),
  instead of assuming the `_local/config.md` literal — a project's `wf.config.js` may
  relocate it.
- **WF-476: the two ASKED values moved to the profile; the template value did not.**
  `ado-organization` and `ado-project` are **declared questions** (`profile.template.json`
  `ask[]`) that the install lifecycle asks and then writes to
  `_local/profiles/ado.profile.json`. Reading them back from the `## Azure DevOps` config
  section meant they were written to one surface and read from another — the same class of
  defect as F-1 itself, where the lifecycle's own question path was blind to the answer
  apply had just persisted. Both now come from the resolver's typed `resolve_profile`
  query (values only, override-merged), under the project's settled decision that **the
  capability profile is the authoritative persisted-answer surface** and `_local/config.md`
  stays human-facing core/registry config rather than an answer store.
  - **Each value was checked against the profile template before being moved.**
    `Work Item ID Prefix` is *not* in `ask[]` — it is template data with the default `ADO` —
    so it is not a persisted answer and deliberately keeps its config-section read. Moving
    it would have been cargo-culting the fix rather than applying its rule.
  - **Read-through, not migration.** Existing projects already carry both values in their
    `## Azure DevOps` section, so the ops file documents a fallback read of that section
    when the profile yields nothing — **profile first, config second**, with the profile
    winning when both hold a value. Nothing writes these back to the config section, so the
    fallback decays as projects re-run init; a one-time migration was considered and
    deliberately not taken (it would need a write path this capability does not own).
  - The fallback read still needs the registry location, so the `resolve_config` query
    above is retained verbatim. The resolver snapshot's `providerConfig` field (consumer
    inventory §7 field #9) remains deliberately unpopulated by core — a provider-specific
    config-section name is domain knowledge core doesn't carry — which is why that half
    stays a direct local read, anchored to the resolver-supplied path rather than a
    hardcoded one.
- **Grounding:** Grounded — a typed `resolve_profile` query, plus the existing
  `resolve_config` query and a local read for the fallback and the prefix; no ADO tool
  involved.

## create_umbrella

- **Idempotency is the same metadata-line guard `pr-create` uses** in the `delivery`
  surface (`plugins/wf-git/capabilities/git/fragments/delivery.md` §"pr-create"): the
  returned id is recorded as a `**<label>:** <value>` line in the triggering artifact and
  read back before any re-invocation, so an umbrella is never created twice for the same
  artifact/slot.
- **Grounding:** Grounded — confirmed against the published tool catalog
  (`mcp_ado_wit_create_work_item`, per `microsoft/azure-devops-mcp`'s `docs/TOOLSET.md`).
  No skill in this codebase has created a work item yet; only read/update paths are
  exercised today.

## create_child

- **Same idempotency guard as `create_umbrella`** — the child id is recorded and read
  back before re-invocation. Used both for a task's own child work items and for further
  nesting beneath those.
- **Grounding:** Grounded — confirmed against the published tool catalog
  (`mcp_ado_wit_add_child_work_items`, per `microsoft/azure-devops-mcp`'s
  `docs/TOOLSET.md`). No skill in this codebase has created a child work item yet.

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
  exercised. No dedicated "list children" tool exists in the ADO MCP catalog, so the
  binding composes the already-grounded `get` tool (`expand: "relations"`, filtered to
  `System.LinkTypes.Hierarchy-Forward`) with a batch title lookup rather than a single
  bespoke call.
- **Grounding:** Grounded — confirmed against the published tool catalog
  (`mcp_ado_wit_get_work_item` + `mcp_ado_wit_get_work_items_batch_by_ids`, per
  `microsoft/azure-devops-mcp`'s `docs/TOOLSET.md`).

## post_comment

- **Read, never written, today.** The codebase only **reads** comments
  (`plugins/wf/skills/spec/SKILL.md` Phase 0 step 5, via
  `mcp_ado_wit_list_work_item_comments`, grounded for reading) — it has never posted one.
- **Grounding:** Grounded — confirmed against the published tool catalog
  (`mcp_ado_wit_add_work_item_comment`, per `microsoft/azure-devops-mcp`'s
  `docs/TOOLSET.md`; sibling write tool to the already-grounded
  `mcp_ado_wit_list_work_item_comments` read).

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

## list_blockers

- **ADO models blocking as the Predecessor/Successor dependency link.** The contract's
  abstract "task ids that block a given task" maps onto Azure DevOps' **Predecessor** links —
  a predecessor must complete before the current item, i.e. it blocks it. On a work item the
  predecessor edge is the relation `System.LinkTypes.Dependency-Reverse` ("Predecessor");
  its `Dependency-Forward` counterpart ("Successor") is the reverse direction and is **not**
  read here.
- **Composes the already-grounded `get`, exactly like `list_children`.** `get`'s
  `expand: "all"` fetch already returns the item's relations, so no separate or bespoke call
  is needed — filter those relations for the predecessor link type and collect the linked
  ids. This mirrors `list_children`'s compose-`get`-and-filter shape rather than guessing a
  dedicated dependency-query tool.
- **An empty set is the no-blockers answer, never an error** — an item with no predecessor
  link returns `[]`, per the contract's read-degradation rule.
- **Grounding:** Grounded — confirmed against the published tool catalog
  (`mcp_ado_wit_get_work_item`, per `microsoft/azure-devops-mcp`'s `docs/TOOLSET.md`; the
  same tool `get`/`list_children` already use). The predecessor-relation **filter** shape has
  not been exercised end-to-end here.

---

## Coverage table

Completeness self-check — every operation the tracker contract names
(`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker provider
surface", whose normative runtime text is `capability-registry.ops.md` §"The tracker
provider surface"), bound to exactly one `## ` section in `tracker.ops.md`, none unbound:

| Contract operation | ops.md section  | Grounding status                         |
|--------------------|-----------------|------------------------------------------|
| `resolve_config`   | `resolve_config`| grounded                                 |
| `create_umbrella`  | `create_umbrella`| grounded — confirmed against catalog    |
| `create_child`     | `create_child`  | grounded — confirmed against catalog     |
| `update`           | `update`        | grounded                                 |
| `get`              | `get`           | grounded                                 |
| `list_children`    | `list_children` | grounded — confirmed against catalog     |
| `post_comment`     | `post_comment`  | grounded — confirmed against catalog     |
| `set_status`       | `set_status`    | grounded — field usage to confirm        |
| `attach_link`      | `attach_link`   | grounded                                 |
| `list_by_status`   | `list_by_status`| unverified — tool name not yet confirmed |
| `list_milestones`  | `list_milestones`| unverified — tool name not yet confirmed |
| `list_cycles`      | `list_cycles`   | unverified — tool name not yet confirmed |
| `list_blockers`    | `list_blockers` | grounded — confirmed against catalog     |

All thirteen operations are bound; none is unbound.
