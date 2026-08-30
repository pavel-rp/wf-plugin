# linear tracker provider — runtime ops

**Version:** 1.6.0 (WF-525 — the tracker surface's `list_statuses` status-discovery read is bound to the team-scoped workflow-state enumeration this fragment already calls for name→id resolution, mapping each returned state's own `type` onto the contract's abstract `open`/`terminal` lifecycle pair; `list_by_status`'s output additively carries each issue's own last-updated moment; WF-213 — split out of the tracker fragment as the bounded runtime-ops half; mirrors the delivery split proven in WF-211; WF-158 — three read-only query operations bound: `list_by_status`, `list_milestones`, `list_cycles`; WF-282 — `resolve_config` distinguishes the relocatable capability registry from the fixed `_local/config.md` provider config; WF-300 — `resolve_config` reads the `## Linear` section from `_local/config.md` unconditionally, never from a relocated `registryPath`: provider config is not the capability registry; WF-315 — `list_blockers` bound to Linear's `blockedBy` relation; WF-476 — `linear-team` is a persisted lifecycle answer and is obtained through the resolver's typed `resolve_profile` surface, with a documented read-through fallback to the `## Linear` config section for existing projects; `linear-project` takes the same read-through down to its `none` default, because nothing persists it to the profile)
**Role:** the runtime-read half of the linear tracker provider — every input, guard, MCP tool binding, and outcome mapping a tracker operation follows. Read at every tracker-surface boot; self-sufficient (no step below requires opening another file).
**Reference (grounding legend, per-operation grounding status, scope framing, coverage table — never read at boot):** `tracker.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = tracker`, reads this file, and follows it in-context. No subagent, no phase gate.
**Model:** claude-opus-4-8

**Consumes, never derives:** every operation takes an already-resolved id / title / body / field value; composing those from a tracker record (branch name, commit subject, …) is the caller's job, not this file's. The no-provider local `T<NNN>` fallback is core's own behaviour for the unconfigured surface (`capability-registry.ops.md` §"The tracker provider surface") — this file does not implement it.

**Id shape:** `create_umbrella` / `create_child` return whatever identifier Linear's own `save_issue` response carries — `<LETTERS>-<NUMBER>` (e.g. `WF-136`). There is no local prefix to compose; Linear mints the whole identifier itself.

**Configuration.** Two values. Both are read **profile first, config section second**; what differs is whether anything ever writes the profile tier — which is decided by whether the lifecycle *asks* the value, not by where it is convenient to read:

- **Linear Team** (`linear-team`) — the team new issues are created under. Required for every write operation below. It is a **declared question the install lifecycle asks and persists**, so its authoritative home is the capability profile, obtained through the resolver's typed `resolve_profile({ workspaceRoot, capability: "linear" })` query; unset means **unconfigured** — see `resolve_config`.
- **Linear Project** (`linear-project`) — optional secondary scoping, and **not** an asked answer. Because nothing ever *writes* it to the profile (only answered questions are persisted there), it is read with the **same three-step read-through** `resolve_config` step 2 defines: the `resolve_profile` values first, then the `## Linear` config section, then the literal default `none`. Reading it from the profile alone would silently drop a configured project. The literal value `none` means "do not scope created issues to a project"; any other value is a project name to resolve.

**Team/project id resolution (shared by every write and query below).** `save_issue`, the status/label lookups, and the query operations all need Linear's internal `teamId` (and, when configured, `projectId`), not the human-readable name the **Linear Team** / **Linear Project** values carry (as resolved by `resolve_config` above). Resolve once per run and reuse:

1. `teamId` — call `mcp__claude_ai_Linear__list_teams`, match the configured **Linear Team** value against each team's key or name, take the matching team's id.
2. `projectId` — only when **Linear Project** is not the literal `none`: call `mcp__claude_ai_Linear__list_projects`, match the configured value against a project's name (scoped to the resolved team, when the tool supports narrowing), take the matching project's id.

Cache both within the run; **do not re-resolve per call**.

**Reducible probe list (spec pin):** none beyond what is already consolidated here. `resolve_config` is one typed `resolve_profile` (R4) query (plus a `resolve_gate` diagnosis only on resolver failure) and, only when a value is missing from it, the local `## Linear` section read the fallback needs — there is no probe pair to consolidate. Team/project id resolution above is already **resolve-once-per-run-and-cache** — the single probe consolidation this fragment carries. `set_status`'s status-id lookup is deliberately **per-call and uncached** (workflow states differ by team; a cached id is not portable) and must not be reduced. Every other operation is a single MCP call. Every other per-operation call count is unchanged by this split.

**Operations:** resolve_config · create_umbrella · create_child · update · get · list_children · post_comment · set_status · attach_link · list_by_status · list_statuses · list_milestones · list_cycles · list_blockers.

## resolve_config

**Inputs:** none.

**Procedure:**

1. Call `resolve_profile({ workspaceRoot, capability: "linear" })` — the resolver's typed **values** view of this capability's persisted profile. This is the surface the install lifecycle *writes* an answered question to, which is what makes it authoritative: reading the answer anywhere else is how an already-answered question gets asked again. It returns the persisted document as it stands — it merges in neither the profile template's defaults nor any other tier, so a key nothing has written is simply absent, which is exactly why step 2 exists. On a resolver failure (snapshot-missing/malformed/schema-incompatible/etc.) this query **throws rather than returning empty** — so call `resolve_gate` with `{ surface: "local-read", workspaceRoot }` and follow its `reaction`, continuing best-effort to step 2 per `capability-registry.ops.md` §"Resolver-failure semantics". **"The profile could not be read" is not "the profile holds no value"**: collapsing the two reports an already-configured project as `unconfigured` and silently drops it to local-only.
2. **Read-through fallback, for existing projects only.** When the profile yields no value for `linear-team` — or for `linear-project`, which nothing ever persists — read the `## Linear` section of `_local/config.md` — the location `/wf-linear:init` wrote provider config to before this capability moved its persisted answer onto the profile. **Profile first, config section second**; a value present in both is decided by the profile. This is a compatibility read, not a second home: nothing writes either value back to `_local/config.md`. (That section's location is a fixed convention, **independent of `registryPath`** — a project's `wf.config.js` may relocate the capability **registry** via `registryPath`, but core and provider config always stay in `_local/config.md`; never anchor this read to the resolver-supplied `registryPath`.)
3. **Configured** — a real **Linear Team** value resolved from either surface: not the `<...>` bracket placeholder `/wf-linear:init`'s template uses for an unset value, and not absent from both.
4. **Unconfigured** — no value from either surface, or still a placeholder. This is the silent local-only fallback the contract's degradation rules define — **no prompt, no error**. (**Linear Project**'s state never gates configured/unconfigured — it is a secondary scoping value, defaulted to the literal `none` when unset.)

**Output:** `configured` or `unconfigured`.

## create_umbrella

**Inputs:** task title, task description.

**Procedure:**

1. Resolve `teamId` (and `projectId`, if **Linear Project** is configured) per "Team/project id resolution" above.
2. Call `mcp__claude_ai_Linear__save_issue` with `title`, `teamId`, `projectId` (if resolved), `description`. No `parentId` — this is the top-level issue.

**Idempotency guard:** the returned id is recorded as a `**<label>:** <value>` metadata line in the local artifact that triggered the call. Before invoking `create_umbrella` again for the same artifact/slot, read that line back first; a present value means the umbrella already exists — **never** re-invoke for that artifact.

**Output:** the created issue's identifier (`<LETTERS>-<NUMBER>`, e.g. `WF-136`).

## create_child

**Inputs:** parent issue id, child title, child description.

**Procedure:**

1. Resolve `teamId` the same way as `create_umbrella` (a child issue inherits the configured team unless the caller supplies a different one explicitly).
2. Call `save_issue` with `title`, `teamId`, `parentId: <parent-issue-id>`, `description`. Used both for a task's own child issues and for further nesting beneath those.

**Idempotency guard:** identical to `create_umbrella` — the returned child id is recorded as a metadata line in the triggering local artifact; read it back before ever re-invoking `create_child` for the same artifact/slot.

**Output:** the created child issue's identifier.

## update

**Inputs:** issue id, one or more fields to patch.

**Procedure:**

1. Call `mcp__claude_ai_Linear__save_issue` with `id: <issue-id>` and only the changed field(s) (title/description/labels/estimate/etc.). `save_issue` is the single create-or-update primitive: passing an `id` selects the update path, omitting it (per `create_umbrella` / `create_child`) selects create.

**Unrestricted binding:** `update` accepts whatever field(s) the caller supplies — `save_issue` is general-purpose; this fragment does not narrow it to any particular field.

**Output:** confirmation the patch applied (or the tool's error, surfaced by the caller per the contract's mid-run-failure degradation rule).

## get

**Inputs:** issue id.

**Procedure:**

1. Call `mcp__claude_ai_Linear__get_issue` with `id: <issue-id>`.

**Output:** the issue's current title, description, status, parent, and labels.

## list_children

**Inputs:** parent issue id.

**Procedure:**

1. Call `mcp__claude_ai_Linear__list_issues` filtered to `parentId: <parent-issue-id>`.

**Output:** the parent's existing child issues (id + title, at minimum).

## post_comment

**Inputs:** issue id, comment body.

**Procedure:**

1. Call `mcp__claude_ai_Linear__save_comment` with `issueId: <issue-id>`, `body`.

**Output:** confirmation the comment was posted.

## set_status

**Inputs:** issue id, target status name.

**Procedure:**

1. Resolve `status_name` to a state id via `mcp__claude_ai_Linear__list_issue_statuses` scoped to the issue's team. Do this lookup **fresh each call** — do not cache status ids across a run (workflow states can differ by team, and a cached id from one team's workflow is not portable to another).
2. Call `mcp__claude_ai_Linear__save_issue` with `id: <issue-id>`, `stateId: <resolved-id>`.

**Output:** confirmation the status changed.

## attach_link

**Inputs:** issue id, URL.

**Procedure:**

1. Call `mcp__claude_ai_Linear__create_attachment` with `issueId: <issue-id>`, `url`. Always an unconditional, explicit attachment call — this fragment makes no claim that Linear auto-links a PR from body text (that would depend on a workspace-level Linear↔GitHub integration this fragment cannot assume).

**Output:** confirmation the link is attached (the tool's response).

## list_by_status

**Inputs:** target status name; team scope (and project scope when **Linear Project** is configured).

**Procedure:**

1. Resolve `status_name` to a state id via `mcp__claude_ai_Linear__list_issue_statuses` scoped to the resolved team. Do this lookup **fresh each call** — do not cache status ids across a run (workflow states differ by team; a cached id is not portable). Same discipline as `set_status`.
2. Call `mcp__claude_ai_Linear__list_issues` filtered to that `stateId`, scoped by the resolved `teamId` (and `projectId` when **Linear Project** is configured).

**Output:** the matching issues (id + title + status + `updated-at`, the issue's own last-updated moment taken verbatim from the `updatedAt` value `list_issues` already returns per issue), or an empty list when none match — a read never writes. `updated-at` is the contract's additive enumeration key; it is read off the same single call, so it costs no extra request. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_statuses

**Inputs:** team scope (the resolved `teamId`; Linear's workflow states are team-scoped).

**Procedure:**

1. Call `mcp__claude_ai_Linear__list_issue_statuses` scoped to the resolved `teamId` (from "Team/project id resolution" above) — the same enumeration `set_status` and `list_by_status` already issue to resolve one status name to a state id, called here for the whole set instead of one match. **One call per run's discovery read**; the caller reuses the returned list rather than re-enumerating.
2. Map each returned state's own `type` onto the contract's abstract `<lifecycle>` pair: `completed` and `canceled` are **terminal**; every other type (`triage`, `backlog`, `unstarted`, `started`) is **open**. The mapping keys on the state's `type`, **never** on its display name — a team may rename any state, and a name carries no lifecycle meaning.

**Output:** `<operation-supported>` = `true` plus the team's workflow statuses, each carrying its name and its `open`/`terminal` classification; an empty status list when the team defines none — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_milestones

**Inputs:** project scope (the resolved `projectId`; Linear milestones are a project-scoped concept).

**Procedure:**

1. Call `mcp__claude_ai_Linear__list_milestones` scoped to the resolved `projectId` (from "Team/project id resolution" above). When **Linear Project** is the literal `none` (no project configured), there is no project to enumerate milestones for — return an **empty list**, not an error.

**Output:** the project's milestones (id + name + target date where present), or an empty list — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_cycles

**Inputs:** team scope (the resolved `teamId`; Linear cycles are a team-scoped concept).

**Procedure:**

1. Call `mcp__claude_ai_Linear__list_cycles` filtered to the resolved `teamId` (from "Team/project id resolution" above).

**Output:** the team's cycles (id + name + start/end where present), or an empty list — a read never writes. On tool error, the caller applies the contract's mid-run-failure degradation rule.

## list_blockers

**Inputs:** task (issue) id — the blocked task whose blocking predecessors to read.

**Procedure:**

1. Call `mcp__claude_ai_Linear__get_issue` with `id: <issue-id>` and `includeRelations: true` — Linear returns the issue's relations, including the `blockedBy` set (the issues that block this one).
2. Read the `blockedBy` relation set from the response; each entry's identifier (`<LETTERS>-<NUMBER>`) is a blocking predecessor.

**Output:** the set of blocking issue identifiers, or an **empty set** when the issue has no `blockedBy` relations — a read never writes, and no-blockers is not an error. On tool error, the caller applies the contract's mid-run-failure degradation rule.
