---
name: lite
description: Runs a condensed spec-plan-implement pass for small ADO tasks in a single skill invocation. Fetches requirements, writes a combined mini-spec-and-plan, stops once for user approval, then implements and hands off. Use for S-complexity items where the full /wf:spec + /wf:plan + /wf:implement chain is overkill.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:lite — One-pass spec-plan-implement for small tasks

Handle a small ADO task end-to-end in a single skill run. Fetches the work item, writes `00_reqs.md` and a combined `lite.md` (mini-spec + checkbox plan), pauses once for user approval, then implements and hands off — no commit. Intended for S-complexity items where the full spec→plan→implement chain burns more tokens than the task is worth.

**One approval gate. One combined artifact. No step-by-step ticking ceremony.**

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}`, `{ado-project}`, and `{wi-prefix}` below come from that file. Never hardcode these values.

---

## When to use

Reach for `/wf:lite` when the task is clearly small — a 1–3 file change with a well-defined ask, no schema work, no new architectural decisions. Typical examples: tweak a validation rule, add a column to a view, fix a typo in a label, adjust a copy string.

**Do NOT use `/wf:lite` when:** the work item description is ambiguous, multiple valid approaches exist, the change touches shared infrastructure, or database migrations are involved. Use the full `/wf:spec` → `/wf:plan` → `/wf:implement` chain instead.

The choice is left to the user for now. A future ranker skill will advise which flow fits a given task.

---

## Command Syntax

```
/wf:lite <ado-id> [--type feat|fix|chore|refactor|migration|docs|hotfix]
```

### Arguments

| Argument          | Required | Description                                                        |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `<ado-id>`        | NO       | ADO work item ID — numeric (e.g. `6396`) or prefixed (e.g. `ADO-6396`). Falls back to inferring from the current git branch. First run for a new task needs an explicit ID. |
| `--type <type>`   | NO       | Branch type prefix. One of: `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`. When supplied, wins over `/wf:classify` and is treated as confidence `high`. Otherwise resolved per Phase 2.5 via `/wf:classify`. |

### Folder Resolution

- Extract the numeric ID: `6396` from `6396`, `ADO-6396`, or `ADO_6396`.
- **Task folder:** `{task-root}/{wi-prefix}-{id}/` (e.g. `_local/ADO-6396/`).
- **Task ID:** `{wi-prefix}-{id}` (e.g. `ADO-6396`).

### Validation

- If `<ado-id>` is provided, use it. If omitted, infer from `git branch --show-current`: extract the first 3+-digit run. If no digit run exists (e.g., on `main`), stop: "No ADO ID provided and none could be inferred from the current branch. Pass the ID explicitly: `/wf:lite <ado-id>`."
- If `00_reqs.md` already exists, skip the ADO fetch and use the existing file.
- If `01_spec.md` or `02_plan.md` already exists, stop: "Full-flow artifacts found. Continue with `/wf:implement {id}` or delete them first."

**Type resolution:** If `--type` is provided, use it (treat as `Confidence: high`). Otherwise, defer until Phase 2.5, which delegates to `/wf:classify`. Do NOT keyword-scan inline — the rubric lives in the classifier.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Use sourcebot MCP tools (`mcp__sourcebot__search_code`, `mcp__sourcebot__read_file`, `mcp__sourcebot__list_tree`) for code search — preferred over raw `Grep`/`Glob`.
- Read any file in the project.
- Use MSSQL extension tools (`mssql_*`) read-only for schema lookups.
- Use ADO MCP tools read-only for fetching the work item.
- Read-only git commands (`git rev-parse`, `git branch`, `git log`, `git status`, `git diff`).
- Write/create files inside the task folder (`{task-root}/{wi-prefix}-{id}/`).
- Modify source files during Phase 5 (implementation) only.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 2 branch gate. The wf:branch subagent performs non-destructive git operations only (`checkout -b` / `checkout` of an existing branch, `fetch`, `push --set-upstream`); it never resets, force-pushes, deletes branches, or commits. Invoke the **Task** tool with `subagent_type: wf:classify` for Phase 2.5 type resolution (read-only).

**Forbidden:**

- Run builds, tests, or installs outside the verification command specified in the plan.
- Run any destructive git operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above).
- Commit, push, or open a PR — always hand off manually. (`push --set-upstream` performed by wf:branch is the one exception, and only for publishing the new task branch — never for pushing commits.)
- Expand scope beyond the approved `lite.md` plan. If the task looks bigger than expected mid-execution, stop and escalate to the full flow.

---

## Phase 1: Fetch ADO and Write Requirements

Skip if `00_reqs.md` already exists in the task folder.

1. **Fetch the work item** using `mcp_ado_wit_get_work_item`:
   - `id`: the extracted numeric ID
   - `project`: `{ado-project}` (from config)
   - `expand`: `"all"`
   - If the call fails, stop: "ADO work item #{id} not found or inaccessible."

2. **Skip parent fetch and discussion comments.** `/wf:lite` is for small tasks where the child description is expected to be sufficient. If the description is empty or minimal, stop: "Work item description is empty or minimal. Use `/wf:spec {id}` to fetch parent context."

3. **Create the task folder** `{task-root}/{wi-prefix}-{id}/` if it doesn't exist.

4. **Write `00_reqs.md`**:

```markdown
# {wi-prefix}-{id}: {Work Item Title}

> Auto-fetched from Azure DevOps work item #{id} on {YYYY-MM-DD}
> Type: {work item type} | State: {state} | Assigned: {assigned to}
> Fetched by: <model identifier>

## Description

{Work item description field — strip HTML to clean markdown}

## Acceptance Criteria

{Acceptance criteria field if present, otherwise omit this section}
```

5. **Update the index.** Invoke `/wf:index {id} reqs "<work item title>"` to record the requirements artifact (truncate the title to 80 chars if longer; escape any `|` as `\|` so the index table doesn't break).

---

## Phase 2: Branch Gate

1. Run `git rev-parse --abbrev-ref HEAD`.
2. **If the branch name contains `/{id}-`** — already on the task branch, proceed to Phase 2.5.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing `ado-id: {id}`. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
   - On success (`BRANCH — created`/`switched`/`already-active`), continue to Phase 2.5.
   - On failure (`BRANCH — Error`), stop and surface the subagent's reason.

---

## Phase 2.5: Resolve Task Type

Determine the task's branch-type bucket (one of `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) before exploration so it can be persisted into the `lite.md` metadata.

1. **If `--type` was provided**, use that value. Set `Confidence: high`, `Alternative: —`. Skip the classifier call.
2. **Otherwise**, invoke `/wf:classify {id}` against `00_reqs.md`. Parse the `CLASSIFY — Complete` block for `Type`, `Confidence`, and `Alternative`. If the classifier returns `CLASSIFY — Error`, stop and surface the reason — do not guess a type inline.
3. **Branch on confidence:**
   - `high` — use the type silently. `Alternative` is `—`.
   - `medium` — use the primary type. Record the `Alternative` for inclusion in the lite.md metadata.
   - `low` — raise an `AskUserQuestion` offering the primary and alternative types as options ("Pick the task type — classifier was uncertain"). Use the user's pick as the resolved type; the unpicked option becomes the Alternative.

Hold the resolved `(type, alternative)` pair in memory for Phase 4, where it is written into the `lite.md` metadata.

---

## Phase 3: Quick Explore

Short, focused — enough to name the files that change, nothing more.

1. Read `00_reqs.md`.
2. Search for the 2–4 files the task most likely touches — try sourcebot first, fall back to Grep/Glob.
3. Read those files to confirm they are the right targets and to identify the exact change site.
4. Do NOT save exploration notes to `research/` — keep it all in memory. Full-flow skills own the research artifacts.

If exploration reveals the task is larger than expected (more than ~5 files, a new architectural decision, or a schema change), **stop** and report: "Task is larger than lite-scope. Run `/wf:spec {id}` then `/wf:plan {id}` instead." Do not proceed.

---

## Phase 4: Write lite.md and Stop for Approval

Write `lite.md` in the task folder using the template below, then emit a short summary to chat and stop. Wait for the user's explicit approval (`ok`, `go`, `proceed`, or similar) before moving to Phase 5. If the user asks for revisions, update `lite.md` and re-present — do not implement until approved.

### lite.md Template

```markdown
# {wi-prefix}-{id} — <title>

**Type:** <feat | fix | chore | refactor | migration | docs | hotfix>
**Alternative:** <type | —>   <!-- always include; use the alternative type only when /wf:classify returned medium confidence, otherwise write — -->
**Flow:** lite
**Created:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>

---

## Objective

<1–2 sentences distilled from 00_reqs.md — what to build/fix and why.>

---

## Approach

<2–4 sentences: what will change and why, grounded in the files found during Phase 3.>

---

## Files

- `path/to/file.ts` — <why>
- `path/to/other.ts` — <why>

---

## Plan

- [ ] STEP-001: <short title — the actual change>
- [ ] STEP-002: <if a second distinct change is needed>
- [ ] STEP-NNN: Verify — `{verify-command}` (from `_local/config.md`)
- [ ] STEP-NNN+1: Hand off — stage files and produce commit-ready diff

---

## Done When

- <1–2 machine-verifiable criteria, at least one runnable as a command>
```

**Plan sizing:** 2–4 checkbox steps total (one or two change steps + verify + handoff). If the natural step count exceeds 4, the task is too big for `/wf:lite` — stop and escalate to the full flow.

**After writing `lite.md`**, invoke `/wf:index {id} lite "plan ready · <n> steps"` to record it in the per-task index. Substitute the actual step count.

### Chat summary at the end of Phase 4

```
LITE — Plan Ready

Task: {wi-prefix}-{id} — <title>
Files: <count>
Steps: <count>
Plan: {task-root}/{wi-prefix}-{id}/lite.md

Reply `ok` to implement, or describe revisions.
```

Stop. Wait for user input.

---

## Phase 5: Implement

On approval, implement all steps in one pass.

- Make only the changes described in the plan's Files and Approach sections.
- Do not fix unrelated issues noticed along the way — note them in the Resolution block instead.
- Do not add new abstractions, helpers, or "while I'm here" refactors.
- After each file edit, re-read the changed region to verify the change is correct.
- Tick each step's checkbox in `lite.md` as you complete it.

If something unexpected blocks a step (merge conflict, missing dependency, the change turns out to require schema work), stop immediately, revert partial edits to that step's files, and report: "Mid-execution block: <reason>. Consider escalating to `/wf:plan {id}`."

---

## Phase 6: Verify and Hand Off

1. **Run the verification command** from the plan's verify step (always `{verify-command}` from `_local/config.md`). Tick the checkbox on pass.
2. **Verify Done When criteria.** Run commands or read the implementation to confirm each.
3. **Stage handoff:**
   - Run `git diff --stat` — confirm only expected files were modified.
   - Run `git diff` — show the full diff.
   - List files the user should stage.
4. **Tick the handoff checkbox.**
5. **Append Resolution block** to `lite.md`:

```markdown
---

## Resolution

<2–4 sentences: what was actually done. Note any deviations from the plan, adjacent issues observed but not fixed, and files changed.>
```

6. **Update the index.** Invoke `/wf:index {id} lite "implemented · <n> changes"` to refresh the `lite` row's summary so the index reflects the post-implementation state. Substitute the count of changed files.

7. **Emit final output** (see below).

If verification fails, do not commit. Report the error, revert if isolatable, add a failure note to `lite.md`, and stop.

---

## Edge Cases

- **ADO work item not found:** Stop: "ADO work item #{id} not found or inaccessible."
- **Empty/minimal description:** Stop. `/wf:lite` expects the child description to be self-contained. Direct the user to `/wf:spec {id}`.
- **Full-flow artifacts already exist** (`01_spec.md` or `02_plan.md`): Stop. The task is already in the full flow — continue with `/wf:implement {id}` instead.
- **`lite.md` already exists and has unchecked steps:** Resume from the first unchecked step. Do not re-fetch or re-explore. Skip straight to Phase 5.
- **`lite.md` already exists and is fully checked:** Report "All steps complete for {wi-prefix}-{id}." and stop.
- **Exploration reveals >5 files or architectural work:** Stop. Escalate to full flow.
- **Mid-execution scope creep:** Stop. Revert partial edits. Escalate.
- **Verification fails:** Do not commit. Revert if isolatable. Leave a failure note in `lite.md`.
- **Merge conflict:** Stop. Do not auto-resolve.

---

## Final Output

```
LITE — Complete

Task: {wi-prefix}-{id} — <title>
Type: <feat | fix | chore | refactor | migration | docs | hotfix>  (source: <flag | classify-high | classify-medium | classify-low-user-confirmed>)
Files changed: <count>
Status: READY FOR REVIEW (not committed)
Verification: <PASS / FAIL>
Artifact: {task-root}/{wi-prefix}-{id}/lite.md

Next — pick a fork:
  Audit against spec:
    /wf:verify-spec {id}      # audit the implementation against 00_reqs.md before shipping
  Ship it:
    /wf:commit {id} --push    # commit current changes (terse auto-message) and push
    /wf:pr {id}               # open a PR from the wf artifacts
    (or commit manually)
  QA it first:
    /wf:qa-gen {id}           # generate a manual browser QA plan (06_qa.md), traced to spec criteria
    /wf:qa-auto {id}          # then run it autonomously  (or /wf:qa-run {id} to drive it yourself)
```

**The final output block must always be the very last thing output to chat.**
