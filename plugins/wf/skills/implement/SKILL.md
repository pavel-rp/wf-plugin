---
name: implement
description: Executes an ADO task's implementation plan (02_plan.md) step by step, ticking each checkbox on completion and stopping immediately on anything unexpected. Does not commit — hands off to the user. Use after /wf:plan to actually make the code changes.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:implement — Execute a plan step by step

Execute a task's implementation plan step by step. Accepts an ADO work item ID, resolves the task folder under `{task-root}/`, reads `02_plan.md`, implements each unchecked step in order, ticks the checkbox on completion, and stops immediately if anything unexpected is found.

**One task at a time. No skipping steps. No assumptions.**

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}`, `{ado-project}`, and `{wi-prefix}` below come from that file. Never hardcode these values.

---

## Command Syntax

```
/wf:implement <ado-id> [--steps <range>] [--mode <mode>]
```

### Arguments

| Argument                | Required | Description                                                   |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `<ado-id>`              | NO       | ADO work item ID — numeric (e.g. `6396`) or prefixed (e.g. `ADO-6396`). Falls back to inferring from the current git branch. |
| `--steps <range>`       | NO       | Restrict execution to a subset of steps. Accepts: a single step (`3`), a range (`2-5`), or a comma-separated list (`2,4,6`). When omitted, all unchecked steps are executed. |
| `--mode <mode>`         | NO       | `nonstop` (default) or `step`. Nonstop runs all steps without pausing. Step pauses after each step for review. |

### Folder Resolution

- Extract the numeric ID: `6396` from `6396`, `ADO-6396`, or `ADO_6396`.
- **Task folder:** `{task-root}/{wi-prefix}-{id}/` (e.g. `_local/ADO-6396/`).
- **Task ID:** `{wi-prefix}-{id}` (e.g. `ADO-6396`).

### Validation

- If `<ado-id>` is provided, use it. If omitted, infer from `git branch --show-current`: extract the first 3+-digit run. If no digit run exists (e.g., on `main`), stop: "No ADO ID provided and none could be inferred from the current branch. Pass the ID explicitly: `/wf:implement <ado-id>`."
- If the task folder doesn't exist, stop: "Task folder not found. Run `/wf:spec {id}` first."
- If `02_plan.md` does not exist in the task folder, stop: "No plan file found. Run `/wf:plan {id}` first."
- If all steps are already checked, report: "All steps complete for {wi-prefix}-{id}." and stop.
- **Task title:** read from `02_plan.md` heading, or from `01_spec.md`, or from `00_reqs.md`. First available wins.
- If `--steps` is provided, parse the range and validate that all referenced step numbers exist in the plan.

**`--steps` behavior:**

When `--steps` is provided, only the specified steps are executed (plus STEP-001 if unchecked — the gate is always enforced). Steps outside the range are skipped.

- Already-checked steps within the range are skipped (not re-executed)
- The verification and final handoff steps are only executed if they fall within the range
- When `--steps` excludes the final handoff step, do NOT run Phase 5 (manual handoff checks) or Phase 6 (final completion report). Output a partial progress summary instead.

**Tool preferences:**

- For searching symbols, references, or patterns across the codebase, prefer sourcebot MCP (`mcp__sourcebot__search_code`, `mcp__sourcebot__read_file`) over Grep/Glob — it's faster for cross-file lookups.
- Use MSSQL extension tools (`mssql_run_query`, `mssql_list_tables`, `mssql_list_views`) for database schema and data exploration when relevant to the task.

---

## Safety Rules (NON-NEGOTIABLE)

`/wf:implement` is the only wf:* skill that intentionally modifies source code outside `_local/`. The constraints below scope what that authorization covers.

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`); prefer sourcebot MCP for cross-file lookups.
- Use MSSQL extension tools (`mssql_*`) read-only for schema and data exploration.
- **Edit/Write source files** as the loaded `02_plan.md` step dictates — this is the skill's primary purpose.
- Read-only git commands (`git rev-parse`, `git branch`, `git status`, `git diff`).
- Run the verification command specified in the plan's verify step (e.g., the project's `npm test` / build), but only that command — never ad-hoc tests or installs.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 1 branch gate. The wf:branch subagent performs non-destructive git operations only (`checkout -b` / `checkout` of an existing branch, `fetch`, `push --set-upstream`); it never resets, force-pushes, deletes branches, or commits.

**Forbidden:**

- Commit, stage, push application code, or open a PR — always hand off to the user manually for review. (`push --set-upstream` performed by wf:branch is the one exception, and only for publishing the new task branch — never for pushing implementation commits.) The user runs `/wf:commit` and `/wf:pr` for that step; `wf:implement` itself still never commits.
- Run any destructive git operation directly (`git reset --hard`, `git push --force`, `git branch -D`, `git checkout --`, etc.).
- Run builds, tests, linters, or installs other than the verify command specified in the plan.
- Skip steps in `02_plan.md`, or expand scope beyond what's explicitly checked off in the loaded plan.
- Modify `00_reqs.md`, `01_spec.md`, or `02_plan.md` content other than ticking the plan's checkboxes as steps complete.

---

## Phase 1: Branch Gate

Before touching any code, verify the current git branch is correct for this task.

1. Run `git rev-parse --abbrev-ref HEAD` to get the current branch name.
2. **If the branch name contains `/{id}-`** (e.g. `feature/6396-...`, `fix/6396-...`, `chore/6396-...`, etc.) — already on the task branch, proceed to Phase 2.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing `ado-id: {id}`. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
   - On success (`BRANCH — created`/`switched`/`already-active`), continue directly to Phase 2.
   - On failure (`BRANCH — Error`), stop and surface the subagent's reason.

---

## Phase 2: STEP-001 Gate (Always Enforced)

STEP-001 is always "Read affected files and confirm approach."

**Execute it literally:**

1. Read every file listed in STEP-001's file list
2. Locate the specific code areas relevant to the task
3. Make a judgment:

**If the approach is sound and no conflicts exist:** Tick STEP-001's checkbox in `02_plan.md`, report what you found, proceed to the next step.

**If recent changes conflict with the plan:** Stop. Report exactly what was found. Do not proceed. The plan may need revision.

**If the task is already done** (already fully implemented): Stop. Report this. Tick STEP-001 and add a note:

```markdown
> ⚠️ Task already implemented as of YYYY-MM-DD. Confirmed by: [what you observed]. No implementation needed.
```

---

## Phase 3: Implement Steps in Order

For each unchecked step after STEP-001, in order:

**Before starting the step:**

- Read all files listed in that step's Files table
- Re-read the step's Goal and Changes description
- Confirm you understand what the change is and why

**Implement the step:**

- Make only the changes described in that step
- Do not fix other issues you notice along the way (note them, but do not touch them)
- Do not refactor beyond what the step requires
- Do not implement steps ahead of the current one

**After completing the step:**

- Re-read the changed file(s) to verify the change is correct
- Tick the step's checkbox in `02_plan.md`
- Write a one-line implementation note below the checkbox:

```markdown
### - [x] STEP-002: <title>

> Implemented: <one sentence describing what was actually done, or "as planned" if exact>
```

**If something unexpected is encountered mid-step:**

- Stop immediately
- Do not partially implement the step
- Revert any partial changes to that step's files
- Report what was found and why it blocks the step
- Leave the checkbox unchecked

---

## Phase 4: Verification Step

The second-to-last step is always a build/typecheck command.

**Step 4a — Run the plan's verification command** exactly as written.

**Step 4b — Verify Done When criteria.** Read each "Done When" criterion from the plan and verify it:
- If the criterion is a command, run it.
- If the criterion is an observable state, verify by reading the implementation.
- Record each criterion as PASS or FAIL.

**If all pass:** Tick the checkbox. Proceed to pre-commit checks.

**If anything fails:**

- Stop immediately. Do not commit.
- Report the full error output and which Done When criteria failed.
- Revert changes that caused the failure if they can be isolated.
- Add a failure note to `02_plan.md`:

```markdown
### - [ ] STEP-NNN: Run build/typecheck

> ⚠️ Failed on YYYY-MM-DD: [error summary]. Changes reverted. Needs investigation.
```

---

## Phase 5: Manual Handoff Checks

The final step is a handoff check. Do not commit, push, or open a PR.

**Run manual handoff checks (always):**

- Run `git diff --stat` to confirm only expected files were modified
- If unexpected files appear, stop and report
- Run `git diff` to show the full diff
- List every file that should be staged by the user

Tick the final step checkbox and add a ready-for-review note:

```markdown
### - [x] STEP-NNN+1: Commit

> Ready for review. Audit against spec with `/wf:verify-spec <id>`, QA it with `/wf:qa-gen <id>` then `/wf:qa-auto <id>` (or `/wf:qa-run <id>`), or ship it: `/wf:commit <id> --push` then `/wf:pr <id>` (or commit manually).
```

---

## Phase 6: Completion Report

After all steps are ticked, output a completion summary.

```
{wi-prefix}-{id} — <title>

Steps completed: N/N
Status: READY FOR REVIEW (not committed)
Verification: <PASS / NEEDS MANUAL CHECK>

Done When: "<done-when text from plan>"

Changed files:
- <list of modified files>

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

Notes:
- <any deviations from the plan>
- <any adjacent issues noticed but not fixed>
```

**The last line of the output block must always be the very last thing output to chat.**

---

## Phase 7: Update Plan

Append a `## Resolution Summary` section at the bottom of `02_plan.md`:

```markdown
## Resolution Summary

**Implemented by:** <model identifier>

<paragraph summarizing what was actually done — deviations from plan, key decisions made, and files changed>
```

**After appending the Resolution Summary**, invoke `/wf:index {id} plan "implemented · <n> steps"` to refresh the `plan` row's summary so the index reflects the post-implementation state. Substitute the total step count from the plan.

---

## Checkpoint Behavior

**`--mode step`:** After each step completes, pause and output:

```
STEP-00N complete: <title>
Next: STEP-00N+1 — <title>
Proceed? (or type 'stop' to pause here)
```

**`--mode nonstop` (default):** Execute all steps continuously. Still output the `STEP-00N complete` line after each step for visibility. Always stop on errors regardless of mode.

In both modes, if the session is interrupted, the plan's checkboxes record exactly where work stopped — re-running the skill will resume from the first unchecked step.

---

## Edge Cases

- **Package install required by the task:** Allowed only if the exact command appears in the plan's Approach section or a step's Changes. Do not install additional packages.
- **Task requires creating a new file:** Create it in the correct location. Add it to the git add list.
- **Step's file list is incomplete:** Stop. Report the unlisted file. Do not modify it without updating the plan first.
- **Complexity L task:** After STEP-001, output a warning: "This is an L-complexity item. Each step may take significant time."
- **Merge conflict:** Stop immediately. Do not attempt to resolve automatically.
- **No `02_plan.md`:** Stop and suggest `/wf:plan`.
- **All steps already checked:** Report complete and stop.
