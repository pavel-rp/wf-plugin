---
name: tasks
description: Decomposes an approved implementation plan (02_plan.md) into an ordered list of small, independently testable units (03_tasks.md) — the last reviewable artifact before code exists. Gates decomposition separately from strategy, so a task list can be regenerated without re-planning. Use after /wf:plan and before /wf:implement.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:tasks — Decomposition gate between plan and implement

Turn an approved implementation plan into an ordered **task list** (`03_tasks.md`): small, independently testable units of work, each one a TDD-sized increment. This is the canonical Spec-Driven Development decomposition phase (Specify → Plan → **Tasks** → Implement) — the last reviewable artifact before any code is written.

`tasks` gates **decomposition** separately from **strategy**: the plan settled *what to change and why*; `tasks` settles *the exact order of small steps to get there*. Because the two are separate gates, a task list can be regenerated when the breakdown is wrong without re-running the whole plan.

**Decomposition only — never modifies source code.** It reads the approved plan and writes one artifact (plus its index row). It derives, it does not implement.

This phase is **lighter** than the `spec` and `implement` authoring hubs: decomposition mostly *derives* from the already-approved spec and plan, so the generic skeleton does most of the work and any capability contribution is additive on top.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). All references to `{task-root}` below come from `coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. A registered tracker capability resolves its own project-scoped config from its own fragment binding; core never reads it directly.

---

## Command Syntax

```
/wf:tasks <id>
```

### Arguments

| Argument | Required | Description                                                                 |
| -------- | -------- | ---------------------------------------------------------------------------- |
| `<id>`   | NO       | Task id — whatever shape the active tracker capability produced when the task folder was created (opaque to core), or a local `T<NNN>` id when none was registered. Falls back to inferring from the current branch. |

### Folder Resolution

- **Task id (the contract's id-shape rule):** `<id>` is opaque — the active tracker capability's own shape when one was registered at spec/plan time (e.g. a tracker-native identifier format), or the local `T<NNN>` scheme when none was. Core never reconstructs or re-derives it — use whatever `/wf:spec`/`/wf:plan` already established for this task folder.
- **Task folder:** `{task-root}/{task-id}/`.

### Validation

- If `<id>` is provided, use it verbatim. If omitted, infer a numeric token via `current-branch-query`, reached by resolving the `delivery` surface with the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query (the same resolver call `plugins/wf/skills/plan/SKILL.md`'s Validation section uses) and obtaining its body via the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`) and following it: extract the first 3+-digit run from the resolved branch name, then **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `<PREFIX>-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` (this recovers the opaque shape a prior invocation already established; core still never reconstructs it itself). With zero matching delivery-provider rows, this falls back silently to the plain-directory case (no branch to infer from). Zero matches — stop: "No id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:tasks <id>`." More than one match — ambiguous — stop: "No id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:tasks <id>`." If no numeric token can be extracted from the branch at all, stop: "No id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:tasks <id>`."
- If the task folder doesn't exist, stop: "Task folder not found. Run `/wf:spec {id}` first."
- If `02_plan.md` does not exist in the task folder, stop: "No plan found. Run `/wf:plan {id}` first."
- **Task title:** read from `02_plan.md` heading, or from `01_spec.md`, or from `00_reqs.md`. First available wins.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`); prefer sourcebot MCP for cross-file lookups when available.
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query).
- Write/create files ONLY inside the task folder (`{task-root}/{task-id}/`) — its single artifact is `03_tasks.md`, plus the index row.

**Forbidden:**

- Modify any source file, the spec, the plan, or any other artifact. This skill is read-mostly — its only write is `03_tasks.md` and the index row.
- Run builds, tests, linters, installs, or any destructive version-control operation.
- Skip the plan: the plan is the authoritative input. Decompose what the plan settled; do not re-strategize, re-scope, or introduce work the plan didn't call for.

---

## Phase 1: Resolve and read the plan

1. **Resolve `<id>`** per the Validation section above — from the passed argument, or inferred via `current-branch-query` and resolved against `{task-root}`. If neither yields an id, stop with the validation message above.

2. **Locate the task folder.** Compute `{task-root}/{task-id}/`. If it doesn't exist, stop: "Task folder not found. Run `/wf:spec {id}` first."

3. **Read the approved plan** `02_plan.md` as the authoritative input. Extract:
   - The plan's `Type:` and `Complexity:` metadata.
   - The Approach section — the settled strategy.
   - The Relevant Files lists (Must change / May change).
   - The Execution Plan steps — these are the strategy-level units to decompose into smaller, independently testable ones.
   - The Done When criteria.
   If `02_plan.md` is missing, stop: "No plan found. Run `/wf:plan {id}` first."

4. **Read the spec for acceptance grounding.** Read `01_spec.md` if present (else `00_reqs.md`) only to recover the acceptance criteria each task increment must move toward. Don't re-derive scope from it — the plan already settled scope.

---

## Phase 2: Derive the decomposition

Break the plan into an ordered list of **tasks** — the smallest independently testable units that, executed in order, satisfy the plan. This is a derivation: every task traces to the plan's strategy, never beyond it.

**Decomposition rules:**

- **Independently testable.** Each task names what would prove it done — a behavior to observe, a command to run, or an artifact to check. A task with no way to tell it's finished is too vague; split or sharpen it.
- **Small and ordered.** Order tasks so each builds only on the ones before it. Prefer test-first increments: where a behavior is verifiable, the task pairs the change with the check that proves it.
- **Derives from the plan.** A plan step that bundles several distinct changes becomes several tasks; a plan step that is already atomic becomes one. Never add a task the plan didn't motivate.
- **Each task is self-contained.** It names the file(s) it touches and the single change it makes. No task touches more than a handful of files.

Number tasks `T-001`, `T-002`, … in execution order. Keep the list flat unless the plan's structure genuinely nests; depth obscures the order that makes the list reviewable.

---

## Phase 3: Fire the `tasks` phase (aggregate capability task-lists)

After deriving the generic decomposition, fire the **`tasks`** phase and aggregate any **`task-list`** contributions the registered capabilities attach to it. Obtain the ordered active registry as metadata from the `wf-resolver` MCP service — do **not** read `## Capabilities` or any `manifest.md` yourself — referencing the taxonomy by **phase name / contribution-kind name**, never by heading:

1. **Call `resolve_registry({ workspaceRoot, ... })`** on the `wf-resolver` service. It returns the ordered active `capabilities[]` (**in registry order**, general → specific), each already resolved from the registry and its `manifest.md`: `{ name, kind, manifestPath, fragments[] { phase, contributionKind, dispatch, scope }, articles[], provenance, validity }`. The resolver has done the registry iteration, per-capability manifest read, and plugin-anchored root self-heal; core reads only this metadata. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry (WF-272 diagnostics/recovery).
2. **Collect** only the fragment rows (across the returned `capabilities[]`, preserving registry order) whose `phase` is `tasks` and whose `contributionKind` is `task-list`. All other rows are ignored for this firing.
3. **Dispatch each collected fragment** on its `dispatch` metadata (the metadata queries return paths/metadata only; the fragment body comes from the resolver's `resolve_content({ workspaceRoot, ... })` content surface, read prompt-free in this skill's own context):
   - `inline: <rel-path>` → obtain the fragment body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, the capability name, `ref: <rel-path>`) and **follow it in-context**, producing tasks in the generic `task-list` shape (the same `T-NNN` / `Proves done:` contract as Phase 2, numbered in the global sequence).
   - `subagent: <agent>` → invoke the **Task** tool with `subagent_type: <agent>`, passing the work under review **and the generic `task-list` shape**; only its final block returns. Aggregate the tasks it returns in that shape. Core never parses a capability-specific output format to extract tasks — a capability that has not yet emitted the generic `task-list` shape simply yields nothing to aggregate.
4. **Aggregate (additive, registry order).** `task-list` aggregates by **appending every contributor's tasks in registry order** (general → specific). Append the aggregated capability tasks **after** the generic decomposition, continuing the global `T-NNN` sequence. This kind carries no provenance tag and no ownership scope — it is additive, so registry order is the only composition knob.

**No-op (the only permitted branch is "zero `tasks` `task-list` fragments" vs "one or more"):** if `resolve_registry({ workspaceRoot, ... })` returns an empty `capabilities[]`, no fragment row matches the `tasks` phase under the `task-list` kind, a dispatched fragment returns an empty list, or a `dispatch` is malformed (neither `inline:` nor `subagent:`), that contributor — or the whole phase — produces **nothing**. The generic decomposition then stands alone: no capability tasks appended, no capability/stack/domain term surfaced, no broken subagent reference, no STOP. **Never** name a concrete capability, count the registry, or carry a per-capability code path. An aggregated task rolls into the list on the same footing as a generic task.

---

## Phase 4: Write `03_tasks.md`

Write the decomposition to `{task-root}/{task-id}/03_tasks.md` using the template below. **Overwrite if it exists** (the task folder is excluded from version control — there's no history to fall back on; warn the user first if the existing file carries execution annotations).

Then **update the index.** Invoke `/wf:index {id} tasks "<n> tasks; derived from 02_plan.md"`, substituting the actual task count.

---

## Template: `03_tasks.md`

```markdown
# {task-id} — Task Decomposition

**Generated:** <YYYY-MM-DD HH:mm>
**Generated by:** <model identifier>
**Plan:** `02_plan.md`
**Spec:** `01_spec.md` (or `00_reqs.md`)

This is the ordered, independently-testable decomposition of the approved plan. Each task is a small increment with its own way to prove it done. Execute them in order with `/wf:implement`.

---

## Tasks

### T-001: <title — name the increment>

**Derives from:** <plan STEP-NNN, or the Approach element it implements>
**Proves done:** <the observable behavior, command result, or artifact that confirms this task is complete>

**Change:**

- <plain-language description of the single change this task makes>

**Files:**
| File | Action |
|------|--------|
| `path/to/file` | modify / create |

---

### T-002: <title>

...

---

<!-- Capability tasks, if any, are appended here in registry order — see Phase 3. -->
```

---

## Edge Cases

- **No plan:** Stop: "No plan found. Run `/wf:plan {id}` first." The plan is the required input — `tasks` never decomposes from the spec alone.
- **`03_tasks.md` already exists with execution annotations** (e.g. progress markers from a prior `/wf:implement`): warn and ask before overwriting, since regenerating discards the recorded progress.
- **Plan is a single atomic step:** A valid decomposition can be a single task. Don't pad the list to look thorough — one well-formed task is correct when the plan is genuinely atomic.
- **Complexity L plan:** Note at the top of the task list that the decomposition is large; favor more, smaller tasks so each increment stays independently testable.
- **Plan and spec disagree:** The plan is authoritative for *what to do*; the spec is authoritative for *acceptance*. If a plan step has no acceptance grounding in the spec, decompose it anyway but flag it with a `<!-- NO SPEC GROUNDING: <task> -->` comment for the reviewer.

---

## Final Output

```
TASKS — Complete

Task:  {task-id} — <title>
Tasks: <N>, derived from 02_plan.md
File:  {task-root}/{task-id}/03_tasks.md

Next:  /wf:implement {id}
```

**The final output block must always be the very last thing output to chat.**
