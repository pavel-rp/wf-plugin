# linear capability — the `tracker` fragment

**What this doc is:** an **inline reference doc**. A core skill reaches this file
through **direct provider resolution** — it resolves the registry row where
`contribution-kind = provider AND scope = tracker`, sees `dispatch: inline:
fragments/tracker.md`, reads this file, and **follows it in-context**. No subagent is
spawned; there is no phase-firing gate — any core skill, at any point in its own
procedure, may invoke any operation below.

**Scope note:** this file is scoped to the Linear **mechanics** of each operation
only. Two concerns are explicitly **not** this file's job:

- **Deriving a value from a tracker record** — composing a branch name or commit
  subject from an issue's id and title, or any other value that depends on the
  tracker's shape. Every operation below **consumes** an already-resolved id / title /
  body / field value — it never derives one. That derivation is the caller's (core's)
  responsibility.
- **The no-provider local-id fallback.** When no capability owns the `tracker` surface,
  core falls back to its own local `T<NNN>` id scheme — that is core's defined
  behaviour for the unconfigured case, not a procedure this file implements.

**Id shape.** When `linear` is the active tracker owner, a task id has the shape
`<LETTERS>-<NUMBER>` (e.g. `WF-136`) — Linear's own identifier format, which the
contract's id-shape rule accommodates as an opaque, provider-supplied id. The contract
prescribes **no** specific format: it treats the active provider's id as opaque, with
`T<NNN>` only as the no-provider fallback; `<LETTERS>-<NUMBER>` is linear's instance of
that opaque shape, not a format the contract itself names. Unlike Azure DevOps'
`{wi-prefix}-{id}` (a locally-configured
prefix glued to a bare numeric id), Linear **mints the whole identifier itself** from
the issue's team key plus a per-team sequence number — there is no local "prefix"
config value to carry; `create_umbrella`/`create_child` simply return whatever
identifier Linear's own `save_issue` response carries.

**Configuration.** Read the `## Linear` section of `_local/config.md` (written by
`/wf-linear:init` — see `plugins/wf-linear/skills/init/SKILL.md`):

- **Linear Team** — the team new issues are created under. Required for every write
  operation below; unset (still the `<...>` bracket placeholder shape, or the section
  missing entirely) means **unconfigured** — see `resolve_config`.
- **Linear Project** — optional secondary scoping. The literal value `none` (no
  brackets) means "do not scope created issues to a project"; any other non-bracketed
  value is a project name to resolve.

**Team/project id resolution (shared by every write below).** `save_issue` and the
status/label lookups need Linear's internal `teamId` (and, when configured,
`projectId`), not the human-readable team/project name recorded in config. Resolve
once per run and reuse:

1. `teamId` — call `mcp__claude_ai_Linear__list_teams`, match the configured
   **Linear Team** value against each team's key or name, take the matching team's id.
2. `projectId` — only when **Linear Project** is not the literal `none`: call
   `mcp__claude_ai_Linear__list_projects`, match the configured value against a
   project's name (scoped to the resolved team, when the tool supports narrowing),
   take the matching project's id.

Cache both within the run; do not re-resolve per call.

**Failure handling — warn-once-continue.** Any operation below whose MCP call fails
after the tracker was configured (auth error, rate limit, MCP unavailable) is
surfaced with a **single** warning naming the failing operation and the error, then
the caller continues in **local-only** mode for the remainder of the run — no retry,
no repeated warnings for the same run. A tracker failure never blocks a local
artifact write; the local file is always the source of truth. This mirrors the
contract's degradation rule verbatim (`capability-registry.contract.md` §"The tracker
provider surface", "Degradation rules").

**Local-first writes (caller discipline, restated here for completeness).** The
caller (a core skill) always writes its local artifact first; a tracker call is a
**publish** step layered on top, never the primary write. `create_umbrella` and
`create_child` below state this explicitly as single-shot-publish idempotency; every
other operation (`update`, `post_comment`, `set_status`, `attach_link`) is likewise
invoked only after the corresponding local state already exists.

**Grounding legend.** Each operation below is tagged on **two independent axes**,
since the confidence backing them differs:

- **Tool name** — whether the named `mcp__claude_ai_Linear__*` tool is a real,
  currently-connected MCP tool. Every tool named below is **confirmed** — it appears
  verbatim in this session's own live MCP tool catalog (the deferred-tool list Claude
  Code exposes for the connected `claude.ai Linear` MCP server), which is strictly
  stronger evidence than the ADO tracker fragment could obtain (no ADO MCP server was
  connected in either environment that authored it).
- **Parameter shape** — whether the exact field names (`teamId`, `parentId`,
  `stateId`, …) and call pattern are drawn from an **independent live call in this
  codebase**, or from the worked draft this fragment follows
  (`_local/research/high-specs/findings/07-tracker-capability.md`, itself citing an
  existing skill implementation in a *different* installed plugin cache —
  `dev-workflow/wf/1.0.0`, not this repo). No call in *this* repo has exercised any of
  these operations yet, so every parameter shape below is **draft-sourced**, not
  independently re-verified against a live response schema.

Every operation below is therefore tagged **"tool confirmed; parameter shape per
draft"** — never bare "Grounded" — so a future implementer knows exactly what has and
hasn't been independently exercised.

---

## resolve_config

**Inputs:** none.

**Procedure:**

1. Read the `## Linear` section of `_local/config.md`.
2. **Configured** — the **Linear Team** row holds a real value (not the `<...>`
   bracket placeholder shape `/wf-linear:init`'s own template uses for an unset value,
   and not a missing section/file).
3. **Unconfigured** — **Linear Team** is still a placeholder, or the section/file is
   missing entirely. This is the silent local-only fallback the contract's
   degradation rules define — no prompt, no error. (**Linear Project**'s state never
   gates configured/unconfigured — it is a secondary scoping value, defaulted to the
   literal `none` when unset.)
4. No MCP call either way — this operation is purely a local config read.

**Output:** `configured` or `unconfigured`.

**Grounding:** Tool confirmed — no tool involved (local-only read).

---

## create_umbrella

**Inputs:** task title, task description.

**Procedure:**

1. Resolve `teamId` (and `projectId`, if **Linear Project** is configured) per "Team/
   project id resolution" above.
2. Call `mcp__claude_ai_Linear__save_issue` with `title`, `teamId`, `projectId` (if
   resolved), `description`. No `parentId` — this is the top-level issue.

**Output:** the created issue's identifier (`<LETTERS>-<NUMBER>`, e.g. `WF-136`).

**Single-shot-publish idempotency (explicit).** The returned id is recorded as a
`**<label>:** <value>` metadata line in the local artifact that triggered the call
(the same metadata-line shape `pr-create` uses in the `delivery` surface — see
`plugins/wf-git/capabilities/git/fragments/delivery.md` §"pr-create"). Before invoking
`create_umbrella` again for the same artifact/slot, the caller reads that metadata
line back first; a present value means the umbrella already exists and this operation
is never re-invoked for that artifact.

**Grounding:** Tool confirmed (`save_issue` is live in this session's MCP catalog);
parameter shape per draft.

---

## create_child

**Inputs:** parent issue id, child title, child description.

**Procedure:**

1. Resolve `teamId` the same way as `create_umbrella` (a child issue inherits the
   configured team unless the caller supplies a different one explicitly).
2. Call `save_issue` with `title`, `teamId`, `parentId: <parent-issue-id>`,
   `description`. Used both for a task's own child issues and for further nesting
   beneath those — Linear's own sub-issue nesting carries no depth limit this
   fragment needs to guard against (see
   `_local/research/high-specs/findings/07-tracker-capability.md` for the
   depth-limit research this binding relies on).

**Output:** the created child issue's identifier.

**Single-shot-publish idempotency.** Identical rule to `create_umbrella` — the
returned child id is recorded as a metadata line in the triggering local artifact;
the caller reads it back before ever re-invoking `create_child` for the same
artifact/slot.

**Grounding:** Tool confirmed; parameter shape per draft.

---

## update

**Inputs:** issue id, one or more fields to patch.

**Procedure:**

1. Call `mcp__claude_ai_Linear__save_issue` with `id: <issue-id>` and only the
   changed field(s) (title/description/labels/estimate/etc.) — `save_issue` is the
   single create-or-update primitive for every Linear write this fragment uses;
   passing an `id` selects the update path, omitting it (per `create_umbrella`/
   `create_child` above) selects create.

**This binding is unrestricted.** `update` accepts whatever field(s) the caller
supplies, since `save_issue` itself is general-purpose — this fragment does not
narrow it to any particular field.

**Output:** confirmation the patch applied (or the tool's error, surfaced by the
caller per the contract's mid-run-failure degradation rule).

**Grounding:** Tool confirmed; parameter shape per draft.

---

## get

**Inputs:** issue id.

**Procedure:**

1. Call `mcp__claude_ai_Linear__get_issue` with `id: <issue-id>`.

**Output:** the issue's current title, description, status, parent, and labels.

**Grounding:** Tool confirmed; parameter shape per draft.

---

## list_children

**Inputs:** parent issue id.

**Procedure:**

1. Call `mcp__claude_ai_Linear__list_issues` filtered to `parentId: <parent-issue-id>`.

**Output:** the parent's existing child issues (id + title, at minimum).

**Grounding:** Tool confirmed; parameter shape per draft.

---

## post_comment

**Inputs:** issue id, comment body.

**Procedure:**

1. Call `mcp__claude_ai_Linear__save_comment` with `issueId: <issue-id>`, `body`.

**Output:** confirmation the comment was posted.

**Grounding:** Tool confirmed; parameter shape per draft.

---

## set_status

**Inputs:** issue id, target status name.

**Procedure:**

1. Resolve `status_name` to a state id via `mcp__claude_ai_Linear__list_issue_statuses`
   scoped to the issue's team. Do this lookup **fresh each call** — do not cache
   status ids across a run (workflow states can differ by team, and a cached id from
   one team's workflow is not portable to another).
2. Call `mcp__claude_ai_Linear__save_issue` with `id: <issue-id>`, `stateId:
   <resolved-id>`.

**Output:** confirmation the status changed.

**Grounding:** Tool confirmed; parameter shape per draft.

---

## attach_link

**Inputs:** issue id, URL.

**Procedure:**

1. Call `mcp__claude_ai_Linear__create_attachment` with `issueId: <issue-id>`, `url`.

**This is an explicit MCP call, not a passive convention.** Unlike ado's `AB#<id>`
autolink (a zero-MCP-call side effect of Azure Boards parsing PR bodies at merge
time), this fragment makes no claim that Linear auto-links a PR from body text alone
— that would depend on a workspace-level Linear↔GitHub integration this fragment
cannot assume is configured. `attach_link` here is always an unconditional,
explicit attachment call.

**Output:** confirmation the link is attached (the tool's response).

**Grounding:** Tool confirmed; parameter shape per draft.

---

## Coverage table

Completeness self-check — every contract operation named
(`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker
provider surface"), bound to exactly one section above, none unbound:

| Contract operation  | Fragment section     | Grounding status                          |
|----------------------|-----------------------|--------------------------------------------|
| `resolve_config`     | `resolve_config`      | tool confirmed (local-only, no tool)        |
| `create_umbrella`    | `create_umbrella`     | tool confirmed; parameter shape per draft   |
| `create_child`       | `create_child`        | tool confirmed; parameter shape per draft   |
| `update`             | `update`              | tool confirmed; parameter shape per draft   |
| `get`                | `get`                 | tool confirmed; parameter shape per draft   |
| `list_children`      | `list_children`       | tool confirmed; parameter shape per draft   |
| `post_comment`       | `post_comment`        | tool confirmed; parameter shape per draft   |
| `set_status`         | `set_status`          | tool confirmed; parameter shape per draft   |
| `attach_link`        | `attach_link`         | tool confirmed; parameter shape per draft   |

All nine operations are bound; none is unbound. No contract defect was found — every
operation the contract names has a clean Linear binding; nothing required forcing an
awkward fit or flagging a gap back to the contract.

**Not e2e-observed (accepted, per WF-136's scope):** `create_umbrella`, `create_child`,
and `update` have no create-consuming core touchpoint in this codebase today — no core
skill currently calls them end-to-end. They are bound at the fragment level per the
draft above (procedure, parameters, idempotency) but are **not** e2e-tested here; that
is expected until a core skill exercises the create path.
