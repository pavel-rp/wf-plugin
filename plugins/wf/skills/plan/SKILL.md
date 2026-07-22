---
name: plan
description: Builds a checkbox-driven implementation plan (02_plan.md) with 3–7 independently verifiable steps, derived from the task's spec or requirements and grounded in codebase exploration. Use after /wf:spec to translate the spec into executable steps before implementing.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:plan — Checkbox-driven implementation plan from a spec

Create an implementation plan (`02_plan.md`) for a task. Accepts a task id, resolves the task folder under `{task-root}/`, explores the codebase, and builds an informed checkbox-driven plan. Reads `01_spec.md` from the folder if it exists, otherwise reads `00_reqs.md`.

**Planning only — never modifies source code.**

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). All references to `{task-root}` below come from `coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. A registered tracker capability resolves its own project-scoped config from its own fragment binding; core never reads it directly.

---

## Command Syntax

```
/wf:plan <id> [--type feat|fix|chore|refactor|migration|docs|hotfix] [--complexity S|M|L]
```

### Arguments

| Argument          | Required | Description                                                        |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `<id>`            | NO       | Task id — whatever shape the active tracker capability produced when `/wf:spec` created the task folder (opaque to core), or a local `T<NNN>` id when none was registered. Falls back to inferring from the current branch. |
| `--type <type>`   | NO       | One of: `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`. When supplied, wins over `01_spec.md` metadata and `/wf:classify`; treated as confidence `high`. Otherwise resolved per Phase 0.5 (spec metadata first, classifier fallback). |
| `--complexity <c>`| NO       | `S`, `M`, or `L`. Resolution order: `--complexity` flag → `01_spec.md` metadata → `triage.md` Size field → `M` default. |

### Folder Resolution

- **Task id (the contract's id-shape rule):** `<id>` is opaque — the active tracker capability's own shape when one was registered at spec time (e.g. a tracker-native identifier format), or the local `T<NNN>` scheme when none was. Core never reconstructs or re-derives it — use whatever `/wf:spec` already established for this task folder. (When `<id>` is inferred from the branch name rather than passed explicitly, Validation below resolves the inferred token back to whichever existing folder already carries it — it looks the shape up, it never invents one.)
- **Task folder:** `{task-root}/{task-id}/`.

### Validation

- If `<id>` is provided, use it verbatim. If omitted, infer a numeric token via `current-branch-query`, reached by resolving the `delivery` surface with the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query (the same resolver call `spec`'s Phase 0.5 Branch Gate uses) and obtaining its body via the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`) and following it: extract the first 3+-digit run from the resolved branch name, then **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `<PREFIX>-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` (this recovers the opaque shape `/wf:spec` already established; core still never reconstructs it itself). With zero matching delivery-provider rows, this falls back silently to the plain-directory case (no branch to infer from). Zero matches — stop: "No task id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:plan <id>`." More than one match — ambiguous — stop: "No task id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:plan <id>`." If no numeric token can be extracted from the branch at all, stop: "No task id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:plan <id>`."
- If the task folder doesn't exist, stop: "Task folder not found. Run `/wf:spec {id}` first."
- If `01_spec.md` exists, read it as the spec (primary source).
- If no `01_spec.md` but `00_reqs.md` exists, use that.
- If neither exists, stop: "No spec or requirements found. Run `/wf:spec {id}` first."
- **Task title:** read from `01_spec.md` heading, or from `00_reqs.md` (synthesize a short title, 5-8 words max). First available wins.
- **Branch-name matching token.** Extract the first 3+-digit run from `<id>` (whatever its shape) — call it `{numeric-id}`. This token is used **only** by the Phase 0 branch-gate quick-check (matching against an already-existing branch name); it plays no role in the task folder, the task id, or any tracker operation.

**Type resolution:** If `--type` is provided, use it (treat as `Confidence: high`). Otherwise, defer until Phase 0.5, which prefers `01_spec.md` metadata and falls back to `/wf:classify`. Do NOT keyword-scan inline — the rubric lives in the classifier.

**Complexity resolution:** Apply in order, first match wins.
1. If `--complexity` is provided, use it. Source: `flag`.
2. Else, if `01_spec.md` exists and has a `**Complexity:** <S|M|L>` line in its metadata, use that value (it was already resolved by `/wf:spec`). Source: `spec`.
3. Else, if `{task-root}/{task-id}/triage.md` exists and has a `**Size:** <S|M|L>` field (not `—`), use that value. Source: `triage`.
4. Else, default to `M`. Source: `default`.

Record the resolved value and source — both appear in the Final Output block so the user can see where the sizing came from.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Use sourcebot MCP tools (`mcp__sourcebot__search_code`, `mcp__sourcebot__read_file`, `mcp__sourcebot__list_tree`) for code search — preferred over raw `Grep`/`Glob` because it's indexed and cross-repo
- Read any file in the project (`Read`, `Glob`, `Grep`) — fall back when sourcebot is unavailable or for file-pattern search
- Use MSSQL extension tools (`mssql_run_query`, `mssql_list_tables`, `mssql_list_views`, `mssql_list_schemas`) for database schema and data exploration
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query)
- Write/create files ONLY inside the task folder (`{task-root}/{task-id}/`)
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 0 branch gate. The wf:branch subagent performs only non-destructive delivery actions — creating or switching to the task branch, fetching the base, and publishing the branch upstream; it never resets, force-pushes, deletes branches, or commits. Invoke the **Task** tool with `subagent_type: wf:classify` for Phase 0.5 type resolution (read-only).

**Forbidden:**

- Modify any source file outside the task folder
- Run builds, tests, linters, or installs
- Run any destructive version-control operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above)

---

## Phase 0: Branch Gate

Before any other work, verify the current branch is correct for this task.

1. **Resolve delivery-surface ownership first** — call `resolve_provider({ workspaceRoot, surface: "delivery" })` on the `wf-resolver` MCP service (resolving the same `delivery` surface `wf:branch` acts on), before any branch read; the returned record carries `{ owner, fragmentPath, state, … }`. **`state: unconfigured` (bare-core mode)** — the branch gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no error and no hard stop. Report "Branch gate skipped — no delivery provider registered (bare-core mode)." and continue directly to Phase 0.5. **`state: ok`** — resolve the current branch via `current-branch-query` (obtain its body via `resolve_content({ workspaceRoot, ... })` and follow it), then apply steps 2–3.
2. **If the branch name contains `/{numeric-id}-`** (e.g. `feature/6396-...`, `fix/6396-...`, `chore/6396-...`, etc.) — already on the task branch, continue directly to Phase 0.5.
3. **Otherwise** — call `resolve_routing` immediately before dispatch with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "branch"`, `unitIds: ["plan:branch"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "elevated", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit its compact metadata. If `status: stop` or `diagnostic` is non-null, stop and surface the routing diagnostic. Otherwise obey the returned `executionShape` per `invocation-runtime.ops.md` §"Resolver call root"; this evidence selects `isolated`, so invoke one **Task** with `subagent_type: wf:branch`, passing the task id `{id}`. Pass a non-null model selector and preserve inherited effort when null. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
   - On success (`BRANCH — created`/`switched`/`already-active`), inspect `Carry:`. `none`/`applied` continues directly to Phase 0.5. A preserved-entry/manual-follow-up carry stops here and surfaces that follow-up; the branch itself remains successful.
   - On failure (`BRANCH — Error`), stop and surface the subagent's reason.

---

## Phase 0.5: Resolve Task Type

Determine the task's branch-type bucket (one of `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) before exploration so it can be persisted into the plan metadata. Re-running `/wf:plan` after `/wf:spec` should reuse the spec's verdict instead of re-classifying.

Apply in order, first match wins:

1. **`--type` flag** — if provided, use it. Set `Confidence: high`, `Alternative: —`. Skip the classifier call.
2. **`01_spec.md` metadata** — if `01_spec.md` exists and has a `**Type:** <one-of-seven>` line, reuse that value. Also pick up `**Alternative:** <type>` if present (medium-confidence path from `/wf:spec`). Set `Confidence: high` for plan purposes — the spec already settled it. Skip the classifier call.
3. **`wf:classify`** — call `resolve_routing` immediately before dispatch with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "classify"`, `unitIds: ["plan:classify"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "low", toolWork: "bounded", validation: "judgment", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit its compact metadata. If `status: stop` or `diagnostic` is non-null, stop and surface the routing diagnostic. Otherwise obey the returned `executionShape` per `invocation-runtime.ops.md` §"Resolver call root"; this evidence selects `isolated`, so invoke one **Task** with `subagent_type: wf:classify`, passing `{id}` (resolved against `01_spec.md`, or `00_reqs.md` if no spec). Pass a non-null model selector and preserve inherited effort when null. Parse the `CLASSIFY — Complete` block for `Type`, `Confidence`, and `Alternative`. If the classifier returns `CLASSIFY — Error`, stop and surface the reason — do not guess a type inline. Branch on confidence:
   - `high` — use the type silently. `Alternative` is `—`.
   - `medium` — use the primary type. Record the `Alternative` so it can appear in the plan metadata.
   - `low` — raise an `AskUserQuestion` offering the primary and alternative types as options ("Pick the task type — classifier was uncertain"). Use the user's pick as the resolved type; the unpicked option becomes the Alternative.

Hold the resolved `(type, alternative)` pair in memory for Phase 2, where it is written into the plan metadata.

---

## Phase 1: Explore the Codebase

Before writing the plan, explore the project to understand what files are relevant to the task.

**When a spec exists** (`01_spec.md`), use it to guide exploration:
- The spec's Objective, Success Criteria, and Scope sections define what to look for
- The spec's Context section may already identify key files — verify they're still current
- The spec's Constraints section informs which patterns and APIs to follow

**When only `00_reqs.md` exists**, explore from scratch:

1. **Analyze the description** to identify key concepts, modules, components, or areas of the codebase that are likely involved.
2. **Search the codebase** — try sourcebot MCP first (`mcp__sourcebot__search_code`); fall back to Glob/Grep if sourcebot is unavailable or for file-pattern searches. Find:
  - Files that implement the relevant functionality
  - Files that would need to change for this task
  - Related types and configuration files
  - Dependencies and imports between relevant files
3. **Explore database schema** using MSSQL extension tools (`mssql_list_tables`, `mssql_list_views`, `mssql_run_query`) if the task involves data models, persistence, or queries.
4. **Read key files** to understand the current implementation state.
5. **Build a file list** of all files that are relevant to this task, categorized as:
  - **Must change:** files that definitely need modification
  - **May change:** files that might need modification depending on approach
  - **Read-only context:** files that inform the approach but won't change
6. **Save extensive research** to `research/` subfolder if exploration is large. Keep the plan itself clean.

---

## Phase 2: Build the Plan

**Step 2a — Build the checklist** (3–7 steps). Apply these rules:

- **First step:** `STEP-001`: Read all affected files. Confirm the approach is sound and no recent changes conflict.
- **Last two steps:** Run verification command, then a ready-for-review handoff — `/wf:implement` doesn't commit; it ticks this step and records a suggested commit message (`feat(<task-id>): <lowercase title>` or `fix(<task-id>): <lowercase title>`) for whichever commit step runs next (`/wf:commit`, or a manual commit).
- **Middle steps:** One per distinct file or logical change area. Split by concern.

**Step heading format:** `### - [ ] STEP-NNN: <title>`

**Step quality rules:**

- Each step is independently verifiable
- No step touches more than 5 files
- No exact code — describe the change in plain language

**Step 2b — Write `02_plan.md`** using the Plan Template at `plan-template.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: plan`, `ref: plan-template.md`), never a raw `Read` of the plugin-cache path — see "Plan Template" below. **Overwrite if it exists** (version-control history preserves prior versions).

**Step 2c — Update the index.** After the file is written, invoke `/wf:index {id} plan "<n> steps; verify=<verify-command>"` to record it in the per-task index. Substitute the actual step count and the verify command from `_local/config.md` (e.g. `5 steps; verify=npm run typecheck`). Escape any `|` in the verify command as `\|` so the index table doesn't break.

---

## Plan Template

The verbatim `02_plan.md` template — the metadata block, `## Progress` checklist, and `## Execution Plan` step shape (`### - [ ] STEP-NNN:`) that `/wf:implement` ticks — lives at `plan-template.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: plan`, `ref: plan-template.md`), never a raw `Read` of the plugin-cache path. It is read only on this write path, so it stays out of the boot body. Follow it, then emit it with placeholders substituted.

---

## Edge Cases

- **No spec or requirements:** Stop: "No spec or requirements found in the task folder. Run `/wf:spec {id}` first."
- **Complexity is L:** Add a note at the top: "This is an L-complexity item. Consider breaking it into sub-tasks before executing."
- **Folder already has `02_plan.md`:** Overwrite it.
- **Dependency on another task:** If during exploration you discover this task depends on another planned task, note it in the `Depends on` field.
- **No project files found:** Ask the user for the project root path to explore.

---

## Final Output

```
PLAN — Complete

Task: {task-id} — <title>
Type: <feat | fix | chore | refactor | migration | docs | hotfix>  (source: <flag | spec | classify-high | classify-medium | classify-low-user-confirmed>)
Complexity: <S | M | L>  (source: <flag | spec | triage | default>)
Steps: <N>
Folder: {task-root}/{task-id}/
Spec: {task-root}/{task-id}/01_spec.md (or "none")
Plan: {task-root}/{task-id}/02_plan.md
Next: /wf:tasks {id}      — decompose the plan into small, independently testable units (or /wf:implement {id} to skip straight to execution)
```

**The final output block must always be the very last thing output to chat.**
