# ado tracker provider — runtime ops

**Version:** 1.3.0 (WF-213 — split out of the tracker fragment as the bounded runtime-ops half; mirrors the delivery split proven in WF-211; WF-158 — three read-only query operations bound: `list_by_status`, `list_milestones`, `list_cycles`; WF-243 — `create_umbrella`, `create_child`, `list_children`, `post_comment` bound to confirmed tool names)
**Role:** the runtime-read half of the ado tracker provider — every input, guard, tool binding, and outcome mapping a tracker operation follows. Read at every tracker-surface boot; self-sufficient (no step below requires opening another file).
**Reference (scope framing, grounding legend, per-operation grounding status, coverage table — never read at boot):** `tracker.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = tracker`, reads this file, and follows it in-context. No subagent, no phase gate.
**Model:** claude-opus-4-8

**Consumes, never derives:** every operation takes an already-resolved id / title / body / field value; composing those from a tracker record (branch name, commit subject, …) is the caller's job, not this file's. The no-provider local `T<NNN>` fallback is core's own behaviour for the unconfigured surface (`capability-registry.ops.md` §"The tracker provider surface") — this file does not implement it.

**Id shape:** when `ado` owns the tracker surface a task id is `{wi-prefix}-{id}` (e.g. `ADO-6396`) — `{wi-prefix}` from `_local/config.md`'s **Work Item ID Prefix** row (default `ADO`), `{id}` the numeric Azure DevOps work item id.

**Tool-name grounding marker:** a `Tool:` line carrying the literal `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>` marker names an operation whose ADO MCP tool this codebase has never called — the marker must be replaced with the confirmed tool name (verified against a live ADO MCP catalog) before that binding is treated as final, never guessed. Grounded tool names are given verbatim.

**Reducible probe list (spec pin):** none. Each write is a single MCP call, `get` is a single `expand: "all"` fetch, and `resolve_config` is a pure local read — there is no probe pair to consolidate. Every operation's call count is unchanged by this split.

**Operations:** resolve_config · create_umbrella · create_child · update · get · list_children · post_comment · set_status · attach_link · list_by_status · list_milestones · list_cycles.

## resolve_config

**Inputs:** none.

**Procedure:**

1. Read the `## Azure DevOps` section of `_local/config.md`.
2. **Configured** — all three rows (`ADO Project`, `ADO Organization`, `Work Item ID Prefix`) hold a real value: not the `<...>` bracket placeholder shape `/wf:init`'s template uses for an unset value, and not a missing section/file.
3. **Unconfigured** — any row is still a placeholder, or the section/file is missing entirely. This is the silent local-only fallback the contract's degradation rules define — **no prompt, no error**.
4. No MCP call either way — this operation is purely a local config read.

**Output:** `configured` or `unconfigured`.

## create_umbrella

**Inputs:** task title, task description.

**Procedure:**

1. Create the top-level work item for the task in `{ado-project}` (from config), using the supplied title/description.
2. Tool: `mcp_ado_wit_create_work_item`.

**Idempotency guard:** the returned id is recorded as a `**<label>:** <value>` metadata line in the local artifact that triggered the call. Before invoking `create_umbrella` again for the same artifact/slot, read that line back first; a present value means the umbrella already exists — **never** re-invoke for that artifact.

**Output:** the created work item's numeric id.

## create_child

**Inputs:** parent work item id, child title, child description.

**Procedure:**

1. Create a work item nested under the given parent in `{ado-project}` (from config), using the supplied title/description. Used both for a task's own child work items and for further nesting beneath those.
2. Tool: `mcp_ado_wit_add_child_work_items`.

**Idempotency guard:** identical to `create_umbrella` — the returned child id is recorded as a metadata line in the triggering local artifact; read it back before ever re-invoking `create_child` for the same artifact/slot.

**Output:** the created child work item's numeric id.

## update

**Inputs:** work item id, one or more fields to patch.

**Procedure:**

1. Patch the named field(s) on the given work item in `{ado-project}` (from config).
2. Tool: `mcp_ado_wit_update_work_item` (or its batch variant).

**Unrestricted binding:** `update` accepts whatever field(s) the caller supplies — it is not limited to any particular field; the tool itself is general-purpose.

**Output:** confirmation the patch applied (or the tool's error, surfaced by the caller per the contract's mid-run-failure degradation rule).

## get

**Inputs:** work item id.

**Procedure:**

1. Fetch the work item from `{ado-project}` (from config) with `expand: "all"` (to get description, acceptance criteria, and relations) — a single fetch, no separate follow-up reads.
2. Tool: `mcp_ado_wit_get_work_item`.

**Output:** the work item's current fields, state, and relations.

## list_children

**Inputs:** parent work item id.

**Procedure:**

1. Enumerate the existing child work items nested under the given parent in `{ado-project}` (from config).
2. Tool: `mcp_ado_wit_get_work_item` (the same grounded `get` tool) on the parent id with `expand: "relations"`; filter the returned relations for `rel: "System.LinkTypes.Hierarchy-Forward"` to collect the child ids, then resolve their titles with `mcp_ado_wit_get_work_items_batch_by_ids`. No dedicated "list children" tool exists in the ADO MCP catalog — this composes the already-grounded `get` tool with one further read rather than guessing a bespoke listing tool.

**Output:** the parent's existing child work items (id + title, at minimum).

## post_comment

**Inputs:** work item id, comment body.

**Procedure:**

1. Post the given comment body onto the work item in `{ado-project}` (from config).
2. Tool: `mcp_ado_wit_add_work_item_comment`.

**Output:** confirmation the comment was posted (id or timestamp, per the tool's response shape once confirmed).

## set_status

**Inputs:** work item id, target status name.

**Procedure:**

1. Move the work item to the named workflow status in `{ado-project}` (from config).
2. Tool: `mcp_ado_wit_update_work_item` — the same `update` tool, patching the `System.State` field.

**Output:** confirmation the status changed.

## attach_link

**Inputs:** work item id, URL.

**Procedure:**

1. **Not an API call.** Embed the literal `AB#<id>` string in the PR body — Azure Boards parses this autolink server-side on merge and attaches the PR URL to the work item automatically.
2. Zero MCP calls — the "attachment" is a side effect of Azure Boards' own PR-body parsing, triggered by the literal text making it into the merged PR.

**Output:** none directly observable by the caller; the link appears on the work item once Azure Boards processes the merge.

## list_by_status

**Inputs:** target status name; project scope from config (`{ado-project}`).

**Procedure:**

1. Enumerate the work items currently in the named workflow status within `{ado-project}` (from config) — a work-item query filtered on `[System.State] = <status>` (WIQL shape: `SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.State] = '<status>' AND [System.TeamProject] = '{ado-project}'`).
2. Tool: `<VERIFY: WIQL/work-item-query tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>`.

**Output:** the matching work items (id + title + state), or an empty list when none match — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_milestones

**Inputs:** project scope from config (`{ado-project}`).

**Procedure:**

1. Enumerate the project's milestone markers in `{ado-project}` (from config). Azure DevOps has no first-class milestone entity; its native schedule markers are **iteration paths** — enumerate the project's iteration classification nodes (the Iteration hierarchy), each node standing in for a milestone.
2. Tool: `<VERIFY: classification-node/iteration tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>`.

**Output:** the project's milestones (name + path, plus a date where the node carries one), or an empty list — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_cycles

**Inputs:** scope from config — the team whose cycles to enumerate (`{ado-project}`'s default team unless a team is configured).

**Procedure:**

1. Enumerate the time-boxed cycles the team is working in — in Azure DevOps, a **team's iterations** (the sprints the team subscribes to via team settings), distinct from the project-wide iteration paths `list_milestones` reads.
2. Tool: `<VERIFY: team-iterations tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>`.

**Output:** the team's cycles (name + start/finish where present), or an empty list — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.
