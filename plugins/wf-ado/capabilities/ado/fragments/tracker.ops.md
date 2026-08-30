# ado tracker provider — runtime ops

**Version:** 1.7.0 (WF-525 — the tracker surface's `list_statuses` status-discovery read is bound to the project's work-item-type state enumeration, mapping each state's own **category** onto the contract's abstract `open`/`terminal` lifecycle pair; `list_by_status`'s query and output additively carry each work item's own last-changed moment; the new binding carries the tool-name grounding marker below rather than a guessed tool name; WF-213 — split out of the tracker fragment as the bounded runtime-ops half; mirrors the delivery split proven in WF-211; WF-158 — three read-only query operations bound: `list_by_status`, `list_milestones`, `list_cycles`; WF-243 — `create_umbrella`, `create_child`, `list_children`, `post_comment` bound to confirmed tool names; WF-280 — `resolve_config` sources `registryPath` from the bundled `wf-resolver` MCP tool's typed `resolve_config` query instead of assuming the `_local/config.md` literal, with `resolve_gate` diagnostics on resolver failure; WF-315 — `list_blockers` bound to the predecessor dependency relations returned by `get`'s `expand: "all"` fetch; WF-476 — `ado-organization` and `ado-project` are persisted lifecycle answers and are obtained through the resolver's typed `resolve_profile` surface, with a documented read-through fallback to the `## Azure DevOps` config section for existing projects; `work-item-id-prefix` is template data, takes the same read-through down to its shipped `ADO` default, and no longer gates configured/unconfigured)
**Role:** the runtime-read half of the ado tracker provider — every input, guard, tool binding, and outcome mapping a tracker operation follows. Read at every tracker-surface boot; self-sufficient (no step below requires opening another file).
**Reference (scope framing, grounding legend, per-operation grounding status, coverage table — never read at boot):** `tracker.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = tracker`, reads this file, and follows it in-context. No subagent, no phase gate.
**Model:** claude-opus-4-8

**Consumes, never derives:** every operation takes an already-resolved id / title / body / field value; composing those from a tracker record (branch name, commit subject, …) is the caller's job, not this file's. The no-provider local `T<NNN>` fallback is core's own behaviour for the unconfigured surface (`capability-registry.ops.md` §"The tracker provider surface") — this file does not implement it.

**Id shape:** when `ado` owns the tracker surface a task id is `{wi-prefix}-{id}` (e.g. `ADO-6396`) — `{wi-prefix}` is `work-item-id-prefix` as `resolve_config` step 3 resolves it (default `ADO`), `{id}` the numeric Azure DevOps work item id.

**Tool-name grounding marker:** a `Tool:` line carrying the literal `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>` marker names an operation whose ADO MCP tool this codebase has never called — the marker must be replaced with the confirmed tool name (verified against a live ADO MCP catalog) before that binding is treated as final, never guessed. Grounded tool names are given verbatim.

**Reducible probe list (spec pin):** none. Each write is a single MCP call, `get` is a single `expand: "all"` fetch, and `resolve_config` is one typed `resolve_profile` (R4) query (plus a `resolve_gate` diagnosis only on resolver failure) plus, only when a value is missing from it, one `wf-resolver` `resolve_config` (R1) call and the local section read that fallback needs — there is no probe pair to consolidate. Every operation's call count is unchanged by this split.

**Operations:** resolve_config · create_umbrella · create_child · update · get · list_children · post_comment · set_status · attach_link · list_by_status · list_statuses · list_milestones · list_cycles · list_blockers.


Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.
## resolve_config

**Inputs:** none.

**Procedure:**

1. **`ado-organization` and `ado-project` — from the profile.** Call `resolve_profile({ workspaceRoot, capability: "ado" })` — the resolver's typed **values** view of the persisted profile (it returns what has been written, merging in neither the template's defaults nor any other tier). Both are **declared questions the install lifecycle asks and persists** (`profile.template.json` `ask[]`), so the capability profile is their authoritative home: reading an answered question from anywhere else is what makes it get asked again. On a resolver failure (snapshot-missing/malformed/schema-incompatible/etc.) this query **throws rather than returning empty** — so call `resolve_gate` with `{ surface: "local-read", workspaceRoot }` and follow its `reaction`, continuing best-effort to step 2 per `capability-registry.ops.md` §"Resolver-failure semantics". **"The profile could not be read" is not "the profile holds no value"**: collapsing the two reports an already-configured project as `unconfigured` and silently drops it to local-only.
2. **Read-through fallback, for existing projects only.** When the profile yields no value for one of them, fall back to the `## Azure DevOps` section of `_local/config.md`. That location is a **fixed convention, independent of `registryPath`**: a project's `wf.config.js` may relocate the capability **registry**, but core and provider config always stay in `_local/config.md`, so never anchor this read to the resolver-supplied `registryPath` (WF-300 — anchoring it there reads the wrong file whenever a project relocates the registry, and reports a configured tracker as unconfigured). **Profile first, config section second**; a value present in both is decided by the profile, and nothing writes these two back to the config section.
3. **`work-item-id-prefix` — same read-through, and it never gates.** It is **not** an asked answer — it is template data carrying the default `ADO` — so nothing persists it to the profile and nothing writes it to the config section any more. Read it the same three ways in order: the `resolve_profile` values, then the `## Azure DevOps` section's **Work Item ID Prefix** row, then the shipped default `ADO`. Because that default always resolves, this value is **never** a reason to report `unconfigured`.
4. **Configured** — both **asked** values (`ado-organization`, `ado-project`) resolve to a real value from their own surface: not the `<...>` bracket placeholder shape `/wf:init`'s template uses for an unset value, and not absent everywhere.
5. **Unconfigured** — either asked value is still a placeholder or absent from every surface. This is the silent local-only fallback the contract's degradation rules define — **no prompt, no error**. A value with a working default must not decide this gate, which is why step 3 sits outside it.
6. Beyond the typed `resolve_profile` query (and the `resolve_config` call the fallback/prefix read needs), no further MCP call — the config section's own values aren't a resolver-supplied fact (the snapshot's `providerConfig` field is populated by the owning provider surface itself, per WF-270, and isn't wired through any typed tool response today), so that part stays a direct local read anchored to the resolver-supplied path.

**Output:** `configured` or `unconfigured`.

## create_umbrella

**Inputs:** task title, task description.

**Procedure:**

1. Create the top-level work item for the task in `{ado-project}` (as resolved by `resolve_config`), using the supplied title/description.
2. Tool: `mcp_ado_wit_create_work_item`.

**Idempotency guard:** the returned id is recorded as a `**<label>:** <value>` metadata line in the local artifact that triggered the call. Before invoking `create_umbrella` again for the same artifact/slot, read that line back first; a present value means the umbrella already exists — **never** re-invoke for that artifact.

**Output:** the created work item's numeric id.

## create_child

**Inputs:** parent work item id, child title, child description.

**Procedure:**

1. Create a work item nested under the given parent in `{ado-project}` (as resolved by `resolve_config`), using the supplied title/description. Used both for a task's own child work items and for further nesting beneath those.
2. Tool: `mcp_ado_wit_add_child_work_items`.

**Idempotency guard:** identical to `create_umbrella` — the returned child id is recorded as a metadata line in the triggering local artifact; read it back before ever re-invoking `create_child` for the same artifact/slot.

**Output:** the created child work item's numeric id.

## update

**Inputs:** work item id, one or more fields to patch.

**Procedure:**

1. Patch the named field(s) on the given work item in `{ado-project}` (as resolved by `resolve_config`).
2. Tool: `mcp_ado_wit_update_work_item` (or its batch variant).

**Unrestricted binding:** `update` accepts whatever field(s) the caller supplies — it is not limited to any particular field; the tool itself is general-purpose.

**Output:** confirmation the patch applied (or the tool's error, surfaced by the caller per the contract's mid-run-failure degradation rule).

## get

**Inputs:** work item id.

**Procedure:**

1. Fetch the work item from `{ado-project}` (as resolved by `resolve_config`) with `expand: "all"` (to get description, acceptance criteria, and relations) — a single fetch, no separate follow-up reads.
2. Tool: `mcp_ado_wit_get_work_item`.

**Output:** the work item's current fields, state, and relations.

## list_children

**Inputs:** parent work item id.

**Procedure:**

1. Enumerate the existing child work items nested under the given parent in `{ado-project}` (as resolved by `resolve_config`).
2. Tool: `mcp_ado_wit_get_work_item` (the same grounded `get` tool) on the parent id with `expand: "relations"`; filter the returned relations for `rel: "System.LinkTypes.Hierarchy-Forward"` to collect the child ids, then resolve their titles with `mcp_ado_wit_get_work_items_batch_by_ids`. No dedicated "list children" tool exists in the ADO MCP catalog — this composes the already-grounded `get` tool with one further read rather than guessing a bespoke listing tool.

**Output:** the parent's existing child work items (id + title, at minimum).

## post_comment

**Inputs:** work item id, comment body.

**Procedure:**

1. Post the given comment body onto the work item in `{ado-project}` (as resolved by `resolve_config`).
2. Tool: `mcp_ado_wit_add_work_item_comment`.

**Output:** confirmation the comment was posted (id or timestamp, per the tool's response shape once confirmed).

## set_status

**Inputs:** work item id, target status name.

**Procedure:**

1. Move the work item to the named workflow status in `{ado-project}` (as resolved by `resolve_config`).
2. Tool: `mcp_ado_wit_update_work_item` — the same `update` tool, patching the `System.State` field.

**Output:** confirmation the status changed.

## attach_link

**Inputs:** work item id, URL.

**Procedure:**

1. **Not an API call.** Embed the literal `AB#<id>` string in the PR body — Azure Boards parses this autolink server-side on merge and attaches the PR URL to the work item automatically.
2. Zero MCP calls — the "attachment" is a side effect of Azure Boards' own PR-body parsing, triggered by the literal text making it into the merged PR.

**Output:** none directly observable by the caller; the link appears on the work item once Azure Boards processes the merge.

## list_by_status

**Inputs:** target status name; project scope (`{ado-project}`, as resolved by `resolve_config`).

**Procedure:**

1. Enumerate the work items currently in the named workflow status within `{ado-project}` (as resolved by `resolve_config`) — a work-item query filtered on `[System.State] = <status>` (WIQL shape: `SELECT [System.Id], [System.Title], [System.State], [System.ChangedDate] FROM WorkItems WHERE [System.State] = '<status>' AND [System.TeamProject] = '{ado-project}'`).
2. Tool: `<VERIFY: WIQL/work-item-query tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>`.

**Output:** the matching work items (id + title + state + `updated-at`, the item's own last-changed moment taken verbatim from the `[System.ChangedDate]` field the same query already selects), or an empty list when none match — a read never writes. `updated-at` is the contract's additive enumeration key; it is selected on the same single query, so it costs no extra request. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_statuses

**Inputs:** project scope (`{ado-project}`, as resolved by `resolve_config`).

**Procedure:**

1. Enumerate the workflow states defined for the work item types of `{ado-project}` (as resolved by `resolve_config`). Azure DevOps publishes each state with a **state category** alongside its name — the closed set `Proposed`, `InProgress`, `Resolved`, `Completed`, `Removed` — which is the process-template-independent classification this operation reads.
2. Tool: `<VERIFY: work-item-type-states/classification tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>`.
3. Map each state's **category** onto the contract's abstract `<lifecycle>` pair: `Completed` and `Removed` are **terminal**; `Proposed`, `InProgress` and `Resolved` are **open**. The mapping keys on the category, **never** on the state's display name — a process template may rename any state, and a name carries no lifecycle meaning.
4. De-duplicate by state name across work item types, so a state several types share is reported once.

**Output:** `<operation-supported>` = `true` plus the project's workflow statuses, each carrying its name and its `open`/`terminal` classification; an empty status list when the project defines none — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_milestones

**Inputs:** project scope (`{ado-project}`, as resolved by `resolve_config`).

**Procedure:**

1. Enumerate the project's milestone markers in `{ado-project}` (as resolved by `resolve_config`). Azure DevOps has no first-class milestone entity; its native schedule markers are **iteration paths** — enumerate the project's iteration classification nodes (the Iteration hierarchy), each node standing in for a milestone.
2. Tool: `<VERIFY: classification-node/iteration tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>`.

**Output:** the project's milestones (name + path, plus a date where the node carries one), or an empty list — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_cycles

**Inputs:** scope as resolved by `resolve_config` — the team whose cycles to enumerate (`{ado-project}`'s default team unless a team is configured).

**Procedure:**

1. Enumerate the time-boxed cycles the team is working in — in Azure DevOps, a **team's iterations** (the sprints the team subscribes to via team settings), distinct from the project-wide iteration paths `list_milestones` reads.
2. Tool: `<VERIFY: team-iterations tool name against live ADO MCP catalog during /wf:ti — not yet confirmed>`.

**Output:** the team's cycles (name + start/finish where present), or an empty list — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_blockers

**Inputs:** work item id — the blocked task whose blocking predecessors to read.

**Procedure:**

1. Fetch the work item from `{ado-project}` (as resolved by `resolve_config`) with `expand: "all"` — the same grounded `get` fetch, which already returns the item's relations; no separate call is needed.
2. Filter the returned relations for the **predecessor** dependency link type `rel: "System.LinkTypes.Dependency-Reverse"` (Azure DevOps' "Predecessor" — a work item that must complete before this one, i.e. that blocks it). From each matching relation's `url`, take the trailing work item id.
3. Tool: `mcp_ado_wit_get_work_item`.

**Output:** the set of blocking work item ids, or an **empty set** when the item has no predecessor links — a read never writes, and no-blockers is not an error. On tool error, the caller applies the contract's mid-run-failure degradation rule.
