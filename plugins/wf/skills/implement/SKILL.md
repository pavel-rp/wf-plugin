---
name: implement
description: Executes a task's implementation plan (02_plan.md) step by step, ticking each checkbox on completion and stopping immediately on anything unexpected. Does not commit — hands off to the user. Use after /wf:plan to actually make the code changes.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:implement — Execute a plan step by step

Execute a task's implementation plan step by step. Accepts a task id, resolves the task folder under `{task-root}/`, reads `02_plan.md`, implements each unchecked step in order, ticks the checkbox on completion, and stops immediately if anything unexpected is found.

**One task at a time. No skipping steps. No assumptions.**

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}` below come from that file — never hardcode it. A registered tracker capability resolves its own project-scoped config from its own fragment binding; core never reads it directly.

`02_plan.md` is the authoritative input this skill executes. When the upstream `tasks` phase has run, a `03_tasks.md` decomposition also exists in the task folder — read it for the finer-grained, independently-testable ordering and let it guide how each plan step is carried out; the plan's checkboxes remain the units this skill ticks. When `03_tasks.md` is absent, execute the plan directly — the `tasks` phase is optional on the chain.

---

## Command Syntax

```
/wf:implement <id> [--steps <range>] [--mode <mode>]
```

### Arguments

| Argument                | Required | Description                                                   |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `<id>`                  | NO       | Task id — whatever shape the active tracker capability produced when the task folder was created (opaque to core), or a local `T<NNN>` id when none was registered. Falls back to inferring from the current branch. |
| `--steps <range>`       | NO       | Restrict execution to a subset of steps. Accepts: a single step (`3`), a range (`2-5`), or a comma-separated list (`2,4,6`). When omitted, all unchecked steps are executed. |
| `--mode <mode>`         | NO       | `nonstop` (default) or `step`. Nonstop runs all steps without pausing. Step pauses after each step for review. |

### Folder Resolution

- **Task id (the contract's id-shape rule):** `<id>` is opaque — the active tracker capability's own shape when one was registered at spec/plan time (e.g. a tracker-native identifier format), or the local `T<NNN>` scheme when none was. Core never reconstructs or re-derives it — use whatever `/wf:spec`/`/wf:plan` already established for this task folder.
- **Task folder:** `{task-root}/{task-id}/`.

### Validation

- If `<id>` is provided, use it verbatim. If omitted, infer a numeric token via `current-branch-query`, reached through **direct provider resolution** to the `delivery` surface (the same mechanism `plugins/wf/skills/plan/SKILL.md`'s Validation section uses): extract the first 3+-digit run from the resolved branch name, then **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `<PREFIX>-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` (this recovers the opaque shape a prior invocation already established; core still never reconstructs it itself). With zero matching delivery-provider rows, this falls back silently to the plain-directory case (no branch to infer from). Zero matches — stop: "No id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:implement <id>`." More than one match — ambiguous — stop: "No id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:implement <id>`." If no numeric token can be extracted from the branch at all, stop: "No id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:implement <id>`."
- **Branch-name matching token.** Extract the first 3+-digit run from `{task-id}` (whatever its shape) — call it `{numeric-id}`. This token is used **only** by the Phase 1 branch-gate quick-check (matching against an already-existing branch name); it plays no role in the task folder, the task id, or any tracker operation, all of which use the opaque `{task-id}` form verbatim.
- If the task folder doesn't exist, stop: "Task folder not found. Run `/wf:spec {id}` first."
- If `02_plan.md` does not exist in the task folder, stop: "No plan file found. Run `/wf:plan {id}` first."
- If all steps are already checked, report: "All steps complete for {task-id}." and stop.
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
- Read-only resolution via `current-branch-query` (direct provider resolution to the `delivery` surface), used by the Phase 1 branch gate when a delivery provider is registered.
- Run the verification command specified in the plan's verify step (e.g., the project's `npm test` / build), but only that command — never ad-hoc tests or installs.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 1 branch gate. The wf:branch subagent performs non-destructive git operations only (`checkout -b` / `checkout` of an existing branch, `fetch`, `push --set-upstream`); it never resets, force-pushes, deletes branches, or commits.

**Forbidden:**

- Commit, stage, push application code, or open a PR — always hand off to the user manually for review. (`push --set-upstream` performed by wf:branch is the one exception, and only for publishing the new task branch — never for pushing implementation commits.) The user runs `/wf:commit` and `/wf:pr` for that step; `wf:implement` itself still never commits.
- Run any destructive git operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above).
- Run builds, tests, linters, or installs other than the verify command specified in the plan.
- Skip steps in `02_plan.md`, or expand scope beyond what's explicitly checked off in the loaded plan.
- Modify `00_reqs.md`, `01_spec.md`, or `02_plan.md` content other than ticking the plan's checkboxes as steps complete.

---

## Phase 1: Branch Gate

Before touching any code, verify the current branch is correct for this task — but only when a delivery provider is registered. `implement` is the one designated source-mutating skill, so this gate degrades gracefully rather than erroring out in bare-core mode: a missing delivery capability is not a reason to block an otherwise-safe implementation run.

### Direct provider resolution (how `current-branch-query` and the wf:branch subagent's `branch-create` are reached)

Reached the same way `plugins/wf/skills/plan/SKILL.md`'s Phase 0 and `plugins/wf/agents/branch.md` already use, per `plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution":

1. Read the `## Capabilities` registry from `_local/config.md`.
2. Select the row(s) where `contribution-kind = provider` **and** `scope = delivery`, across the whole registry (a scope filter, independent of which phase value the row itself carries).
3. Read that capability's `manifest.md` at its registry path, then dispatch its fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the referenced file and follow it in-context; no subagent is spawned).
4. **Zero matching rows** — no capability owns the `delivery` surface.

**Gate procedure:**

1. **Resolve the delivery-surface ownership state first** (the scope-equality filter above, applied before any branch read).
2. **Zero matching rows (bare-core mode)** — the gate degrades to a no-op: do not invoke `current-branch-query`, do not invoke the wf:branch subagent, no error, no hard stop. Report: "Branch gate skipped — no delivery provider registered (bare-core mode)." Continue directly to Phase 2.
3. **One matching row** — resolve the current branch via `current-branch-query` (direct provider resolution above).
   - **If the branch name contains `/{numeric-id}-`** (e.g. `feature/6396-...`, `fix/6396-...`, `chore/6396-...`, etc.) — already on the task branch, proceed to Phase 2.
   - **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing the task id `{id}` as its argument. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
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

- **Scope-confinement guard.** Cross-check every file this run modified — across all steps, **including any side effect of the Phase 4 verification command** (a build/test run may write lockfiles, generated artifacts, snapshots, or coverage output) — against the union of every executed step's Files table (plus STEP-001's confirmed target files). If a file was modified that no step's Files table names and no verify-command side effect explains, stop and report it — this is the "unexpected files" guard, expressed against the plan's own bookkeeping rather than a live repository diff. On a resumed run, re-derive the modified-file set from the plan's ticked steps (not just this session's own edits) so files touched by an earlier, interrupted session are still covered.
- **Contract-completeness gap, documented, not worked around.** The delivery contract's operation set (`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The delivery provider surface") has no changed-files/diff-review operation today — reviewing the accumulated diff content itself is left to whatever review step the user runs next (`/wf:commit`, `/wf:pr`, or a manual review), not reproduced here.
- List every file that should be staged by the user (the same file list the scope-confinement guard checked against).

Tick the final step checkbox and add a ready-for-review note:

```markdown
### - [x] STEP-NNN+1: Commit

> Ready for review. Audit against spec with `/wf:verify-spec <id>`, QA it with `/wf:qa-gen <id>` then `/wf:qa-auto <id>` (or `/wf:qa-run <id>`), or ship it: `/wf:commit <id> --push` then `/wf:pr <id>` (or commit manually).
```

---

## Phase 6: Completion Report

After all steps are ticked, output a completion summary.

```
{task-id} — <title>

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

- **No delivery provider registered (bare-core mode):** the Phase 1 branch gate degrades to a no-op with a stated reason and proceeds directly to Phase 2 — never a raw git error, never a hard block.
- **Package install required by the task:** Allowed only if the exact command appears in the plan's Approach section or a step's Changes. Do not install additional packages.
- **Task requires creating a new file:** Create it in the correct location. Add it to the list of files to stage.
- **Step's file list is incomplete:** Stop. Report the unlisted file. Do not modify it without updating the plan first.
- **Complexity L task:** After STEP-001, output a warning: "This is an L-complexity item. Each step may take significant time."
- **Merge conflict:** Stop immediately. Do not attempt to resolve automatically.
- **No `02_plan.md`:** Stop and suggest `/wf:plan`.
- **All steps already checked:** Report complete and stop.
