# ado capability — the `tracker` fragment

**What this doc is:** an **inline reference doc**. A core skill reaches this file
through **direct provider resolution** — it resolves the registry row where
`contribution-kind = provider AND scope = tracker`, sees `dispatch: inline:
fragments/tracker.md`, reads this file, and **follows it in-context**. No subagent is
spawned; there is no phase-firing gate — any core skill, at any point in its own
procedure, may invoke any operation below.

**Scope note:** this file is scoped to the Azure DevOps **mechanics** of each operation
only. Two concerns are explicitly **not** this file's job:

- **Deriving a value from a tracker record** — composing a branch name or commit
  subject from a work item's id and title, or any other value that depends on the
  tracker's shape. Every operation below **consumes** an already-resolved id / title /
  body / field value — it never derives one. That derivation is the caller's (core's)
  responsibility.
- **The no-provider local-id fallback.** When no capability owns the `tracker` surface,
  core falls back to its own local `T<NNN>` id scheme — that is core's defined
  behaviour for the unconfigured case, not a procedure this file implements.

**Id shape.** When `ado` is the active tracker owner, a task id has the shape
`{wi-prefix}-{id}` (e.g. `ADO-6396`) — the same id-shape rule the contract already
names as core vocabulary. `{wi-prefix}` comes from `_local/config.md`'s **Work Item ID
Prefix** row (default `ADO`); `{id}` is the numeric Azure DevOps work item id.

**Grounding legend.** Each operation below is tagged with how firmly its ADO MCP tool
name is established in this codebase, per the plan's "ask first" boundary — a tool
name this codebase has never called must be verified against the live tool catalog,
not guessed:

- **Grounded** — this codebase already calls exactly this tool for exactly this
  purpose.
- **Grounded — field usage to confirm** — the tool itself is grounded, but this
  operation's specific field/parameter shape has never been exercised.
- **Unverified — tool name not yet confirmed** — no skill in this codebase has
  ever exercised this operation in this direction; the tool name is marked with the
  literal `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet
  confirmed>` marker rather than invented. A live ADO MCP catalog check was attempted
  twice — once during planning and once during this capability's own implementation
  (both via `ToolSearch` for ado/azure-devops/work-item tools) — and both returned
  **zero** ADO tools: no ADO MCP server was connected in either environment, so this
  marker could not be resolved to a real tool name and is carried forward unresolved,
  exactly as the plan anticipates. Whoever next implements a tracker-consuming core
  skill against this fragment, with a live ADO MCP catalog available, must replace the
  marker with the confirmed tool name before treating that binding as final.

---

## resolve_config

**Inputs:** none.

**Procedure:**

1. Read the `## Azure DevOps` section of `_local/config.md`.
2. **Configured** — all three rows (`ADO Project`, `ADO Organization`, `Work Item ID
   Prefix`) hold a real value (not the `<...>` bracket placeholder shape `/wf:init`'s
   own template uses for unset values, and not a missing section/file).
3. **Unconfigured** — any row is still a placeholder, or the section/file is missing
   entirely. This is the silent local-only fallback the contract's degradation rules
   define — no prompt, no error.
4. No MCP call either way — this operation is purely a local config read.

**Output:** `configured` or `unconfigured`.

**Grounding:** Grounded — local-only, no tool involved.

---

## create_umbrella

**Inputs:** task title, task description.

**Procedure:**

1. Create the top-level work item for the task in `{ado-project}` (from config),
   using the supplied title/description.
2. Tool: `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet
   confirmed>`.

**Output:** the created work item's numeric id.

**Single-shot-publish idempotency (explicit).** The returned id is recorded as a
`**<label>:** <value>` metadata line in the local artifact that triggered the call
(the same metadata-line shape `pr-create` uses in the `delivery` surface — see
`plugins/wf-git/capabilities/git/fragments/delivery.md` §"pr-create"). Before invoking
`create_umbrella` again for the same artifact/slot, the caller reads that metadata
line back first; a present value means the umbrella already exists and this operation
is never re-invoked for that artifact.

**Grounding:** Unverified — tool name not yet confirmed. No skill in this
codebase has ever created a work item; only read/update paths are exercised today.

---

## create_child

**Inputs:** parent work item id, child title, child description.

**Procedure:**

1. Create a work item nested under the given parent in `{ado-project}` (from config),
   using the supplied title/description. Used both for a task's own child work items
   and for further nesting beneath those.
2. Tool: `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet
   confirmed>` (same marker as `create_umbrella`).

**Output:** the created child work item's numeric id.

**Single-shot-publish idempotency.** Identical rule to `create_umbrella` — the
returned child id is recorded as a metadata line in the triggering local artifact;
the caller reads it back before ever re-invoking `create_child` for the same
artifact/slot.

**Grounding:** Unverified — tool name not yet confirmed. No skill in this
codebase has ever created a child work item.

---

## update

**Inputs:** work item id, one or more fields to patch.

**Procedure:**

1. Patch the named field(s) on the given work item in `{ado-project}` (from config).
2. Tool: `mcp_ado_wit_update_work_item` (or its batch variant) — the same tool this
   codebase's `spec/SKILL.md` Phase 0 step 4 already calls to backfill an empty `Dev`
   child's `System.Description` from its parent.

**This binding is unrestricted.** Today's only core usage patches exactly one field
(`System.Description`, and only under narrow backfill conditions); this fragment's
binding is **not** limited to that field — `update` accepts whatever field(s) the
caller supplies, since the tool itself is general-purpose. The narrowness lives in
core's calling convention, not in this operation's contract.

**Output:** confirmation the patch applied (or the tool's error, surfaced by the
caller per the contract's mid-run-failure degradation rule).

**Grounding:** Grounded — tool confirmed; field usage as exercised today is narrower
than this operation's full scope, per above.

---

## get

**Inputs:** work item id.

**Procedure:**

1. Fetch the work item from `{ado-project}` (from config) with `expand: "all"` (to get
   description, acceptance criteria, and relations) — the same call shape
   `spec/SKILL.md` Phase 0 step 1, `lite/SKILL.md` Phase 1 step 1, and
   `triage/SKILL.md` Phase 1 step 1 already use.
2. Tool: `mcp_ado_wit_get_work_item`.

**Output:** the work item's current fields, state, and relations.

**Grounding:** Grounded — the most heavily exercised operation in this codebase.

---

## list_children

**Inputs:** parent work item id.

**Procedure:**

1. Enumerate the existing child work items nested under the given parent in
   `{ado-project}` (from config).
2. Tool: `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet
   confirmed>`.

**Output:** the parent's existing child work items (id + title, at minimum).

**Grounding:** Unverified — tool name not yet confirmed. Today's codebase only
ever resolves a child's *parent* (`get`'s relations expansion, consumed by `spec`'s
Phase 0 step 2 parent-context resolution) — never a parent's *children*. This is the
reverse direction and has never been exercised.

---

## post_comment

**Inputs:** work item id, comment body.

**Procedure:**

1. Post the given comment body onto the work item in `{ado-project}` (from config).
2. Tool: `<VERIFY: tool name against live ADO MCP catalog during /wf:ti — not yet
   confirmed>`.

**Output:** confirmation the comment was posted (id or timestamp, per the tool's
response shape once confirmed).

**Grounding:** Unverified — tool name not yet confirmed. Today's codebase only
**reads** comments (`spec/SKILL.md` Phase 0 step 5, via `mcp_ado_wit_list_work_item_comments`,
grounded for reading) — it has never posted one.

---

## set_status

**Inputs:** work item id, target status name.

**Procedure:**

1. Move the work item to the named workflow status in `{ado-project}` (from config).
2. Tool: plausibly `mcp_ado_wit_update_work_item` — the same already-grounded `update`
   tool, patching the `System.State` field.

**Output:** confirmation the status changed.

**Grounding:** Grounded — field usage to confirm. The tool itself is grounded (see
`update` above); the `System.State` field-shape usage specifically has never been
exercised by any skill in this codebase, so it is marked **to confirm** rather than
asserted as fact.

---

## attach_link

**Inputs:** work item id, URL.

**Procedure:**

1. **Not an API call.** Embed the literal `AB#<id>` string in the PR body — Azure
   Boards parses this autolink server-side on merge and attaches the PR URL to the
   work item automatically. This is exactly the convention `agents/pr.md`'s PR body
   template already uses (`Resolves AB#{numeric-id}.`, `agents/pr.md` §"Work-item
   link"); `skills/pr/SKILL.md` corroborates the same convention in prose ("linked by
   putting `AB#<id>` in the PR body") without repeating the literal template.
2. Zero MCP calls — the "attachment" is a side effect of Azure Boards' own PR-body
   parsing, triggered by the literal text making it into the merged PR.

**Output:** none directly observable by the caller; the link appears on the work item
once Azure Boards processes the merge.

**Grounding:** Grounded — the literal-embed convention is already in production use in
`agents/pr.md`, corroborated in prose by `skills/pr/SKILL.md`.

---

## Coverage table

Completeness self-check — every contract operation named
(`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker provider
surface"), bound to exactly one section above, none unbound:

| Contract operation  | Fragment section     | Grounding status                          |
|----------------------|-----------------------|--------------------------------------------|
| `resolve_config`     | `resolve_config`      | grounded                                    |
| `create_umbrella`    | `create_umbrella`     | unverified — tool name not yet confirmed |
| `create_child`       | `create_child`        | unverified — tool name not yet confirmed |
| `update`             | `update`              | grounded                                    |
| `get`                | `get`                 | grounded                                    |
| `list_children`      | `list_children`       | unverified — tool name not yet confirmed |
| `post_comment`       | `post_comment`        | unverified — tool name not yet confirmed |
| `set_status`         | `set_status`          | grounded — field usage to confirm           |
| `attach_link`        | `attach_link`         | grounded                                    |

All nine operations are bound; none is unbound.
