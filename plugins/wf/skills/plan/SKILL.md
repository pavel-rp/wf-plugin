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

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}` below come from that file — never hardcode it. A registered tracker capability resolves its own project-scoped config from its own fragment binding; core never reads it directly.

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

- If `<id>` is provided, use it verbatim. If omitted, infer a numeric token via `current-branch-query`, reached through **direct provider resolution** to the `delivery` surface (the same mechanism `spec`'s Phase 0.5 Branch Gate uses): extract the first 3+-digit run from the resolved branch name, then **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `<PREFIX>-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` (this recovers the opaque shape `/wf:spec` already established; core still never reconstructs it itself). With zero matching delivery-provider rows, this falls back silently to the plain-directory case (no branch to infer from). Zero matches — stop: "No task id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:plan <id>`." More than one match — ambiguous — stop: "No task id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:plan <id>`." If no numeric token can be extracted from the branch at all, stop: "No task id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:plan <id>`."
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
- Read-only resolution via `current-branch-query` (direct provider resolution to the `delivery` surface)
- Write/create files ONLY inside the task folder (`{task-root}/{task-id}/`)
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 0 branch gate. The wf:branch subagent performs only non-destructive delivery actions — creating or switching to the task branch, fetching the base, and publishing the branch upstream; it never resets, force-pushes, deletes branches, or commits. Invoke the **Task** tool with `subagent_type: wf:classify` for Phase 0.5 type resolution (read-only).

**Forbidden:**

- Modify any source file outside the task folder
- Run builds, tests, linters, or installs
- Run any destructive version-control operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above)

---

## Phase 0: Branch Gate

Before any other work, verify the current branch is correct for this task.

1. **Resolve delivery-surface ownership first** — the scope-equality filter (`contribution-kind = provider` **and** `scope = delivery`) of **direct provider resolution** (`plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution", the same mechanism `plugins/wf/agents/branch.md` uses), applied before any branch read. **Zero matching rows (bare-core mode)** — the branch gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no error and no hard stop. Report "Branch gate skipped — no delivery provider registered (bare-core mode)." and continue directly to Phase 0.5. **One matching row** — resolve the current branch via `current-branch-query`, then apply steps 2–3.
2. **If the branch name contains `/{numeric-id}-`** (e.g. `feature/6396-...`, `fix/6396-...`, `chore/6396-...`, etc.) — already on the task branch, continue directly to Phase 0.5.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing the task id `{id}` as its argument. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
   - On success (`BRANCH — created`/`switched`/`already-active`), continue directly to Phase 0.5.
   - On failure (`BRANCH — Error`), stop and surface the subagent's reason.

---

## Phase 0.5: Resolve Task Type

Determine the task's branch-type bucket (one of `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) before exploration so it can be persisted into the plan metadata. Re-running `/wf:plan` after `/wf:spec` should reuse the spec's verdict instead of re-classifying.

Apply in order, first match wins:

1. **`--type` flag** — if provided, use it. Set `Confidence: high`, `Alternative: —`. Skip the classifier call.
2. **`01_spec.md` metadata** — if `01_spec.md` exists and has a `**Type:** <one-of-seven>` line, reuse that value. Also pick up `**Alternative:** <type>` if present (medium-confidence path from `/wf:spec`). Set `Confidence: high` for plan purposes — the spec already settled it. Skip the classifier call.
3. **`wf:classify`** — invoke the **Task** tool with `subagent_type: wf:classify`, passing `{id}` (resolved against `01_spec.md`, or `00_reqs.md` if no spec). Parse the `CLASSIFY — Complete` block for `Type`, `Confidence`, and `Alternative`. If the classifier returns `CLASSIFY — Error`, stop and surface the reason — do not guess a type inline. Branch on confidence:
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

**Step 2b — Write `02_plan.md`** using the Plan Template below. **Overwrite if it exists** (version-control history preserves prior versions).

**Step 2c — Update the index.** After the file is written, invoke `/wf:index {id} plan "<n> steps; verify=<verify-command>"` to record it in the per-task index. Substitute the actual step count and the verify command from `_local/config.md` (e.g. `5 steps; verify=npm run typecheck`). Escape any `|` in the verify command as `\|` so the index table doesn't break.

---

## Plan Template

```markdown
# {task-id} — <title>

**Type:** <feat | fix | chore | refactor | migration | docs | hotfix>
**Alternative:** <type | —>   <!-- always include; use the alternative type only when /wf:classify returned medium confidence (or it was carried over from 01_spec.md), otherwise write — -->
**Complexity:** <S | M | L>
**Depends on:** <task-id(s) or —>
**Created:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>
**Spec:** <01_spec.md, or —>

---

## Description

<for feat: description of the feature to implement>
<for fix: description of the problem to solve>

---

## Approach

<high-level approach derived from codebase exploration — what will change and why>

---

## Relevant Files

**Must change:**
- `path/to/file.ts` — <why>

**May change:**
- `path/to/file.ts` — <why>

**Read-only context:**
- `path/to/file.ts` — <why>

---

## Progress

- [ ] STEP-001: Read affected files and confirm approach
- [ ] STEP-002: <title>
- [ ] ...
- [ ] STEP-NNN: Run build/typecheck — confirm no regressions
- [ ] STEP-NNN+1: Ready for review — suggested commit message `<type>(<task-id>): <lowercase title>`

---

## Execution Plan

### - [ ] STEP-001: Read affected files and confirm approach

**Goal:** Verify the planned approach is sound. Check that no recent changes conflict with the plan and that the identified files are still the right targets.

**Files to read:**
<list from exploration phase>

**Depends on:** —

---

### - [ ] STEP-002: <title>

**Goal:** <1-2 sentences: what this step achieves>

**Changes:**

- <plain-language description of the change, not code>
- <another change if applicable>

**Files:**
| File | Action |
|------|--------|
| `path/to/file.ts` | modify |
| `path/to/new-file.ts` | create |

**Depends on:** STEP-001

---

<... repeat for each middle step ...>

---

### - [ ] STEP-NNN: Run build/typecheck — confirm no regressions

**Goal:** Verify the changes compile and do not break existing functionality.

**Command:** `{verify-command}` — substituted from `_local/config.md`. Never hardcode a command here.

**Depends on:** STEP-<previous>

---

### - [ ] STEP-NNN+1: Ready for review

**Goal:** Hand off the implemented change for review. `/wf:implement` does not commit, push, or open a PR — it ticks this step and records a suggested commit message for whichever step commits next (`/wf:commit`, or a manual commit).

**Suggested commit message:** `<type>(<task-id>): <lowercase title>`

**Depends on:** STEP-NNN

---

## Done When

<1-3 machine-verifiable criteria. At least one must be checkable by running a command (build output, CLI output, API response).
Not acceptable: "the feature works", "it handles errors correctly"
Acceptable: "POST /api/auth/login returns 200 with a valid JWT when given correct credentials",
"`{verify-command}` exits 0".>
```

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
