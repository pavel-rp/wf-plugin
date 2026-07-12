---
name: lite
description: Runs a condensed spec-plan-implement pass for small tasks in a single skill invocation. Fetches requirements from the active tracker when one is registered; when none is, works from an already-present local requirements file with no tracker fetch and no error, deferring to /wf:spec when a self-contained description isn't available. It then writes a combined mini-spec-and-plan, stops once for user approval, and implements and hands off. Use for S-complexity items where the full /wf:spec + /wf:plan + /wf:implement chain is overkill.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:lite — One-pass spec-plan-implement for small tasks

Handle a small task end-to-end in a single skill run. Fetches the work item from the active tracker when one is registered; when none is, works from an already-present local requirements file with no tracker fetch and no error, deferring to `/wf:spec` when a self-contained description isn't available. It then writes `00_reqs.md` and a combined `lite.md` (mini-spec + checkbox plan), pauses once for user approval, then implements and hands off — no commit. Intended for S-complexity items where the full spec→plan→implement chain burns more tokens than the task is worth.

**One approval gate. One combined artifact. No step-by-step ticking ceremony.**

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}` below come from that file — never hardcode it. A registered tracker capability resolves its own project-scoped config (e.g. a tracker project name) from its own fragment binding; core never reads it directly.

---

## When to use

Reach for `/wf:lite` when the task is clearly small — a 1–3 file change with a well-defined ask, no schema work, no new architectural decisions. Typical examples: tweak a validation rule, add a column to a view, fix a typo in a label, adjust a copy string.

**Do NOT use `/wf:lite` when:** the work item description is ambiguous, multiple valid approaches exist, the change touches shared infrastructure, or database migrations are involved. Use the full `/wf:spec` → `/wf:plan` → `/wf:implement` chain instead.

The choice is left to the user for now. A future ranker skill will advise which flow fits a given task.

---

## Command Syntax

```
/wf:lite <id> [--type feat|fix|chore|refactor|migration|docs|hotfix]
```

### Arguments

| Argument          | Required | Description                                                        |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `<id>`            | NO       | Task id — whatever shape the active tracker capability produces (opaque to core), or a local `T<NNN>` id when no tracker is registered. Falls back to inferring from the current branch. First run for a new task needs an explicit id. |
| `--type <type>`   | NO       | Branch type prefix. One of: `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`. When supplied, wins over `/wf:classify` and is treated as confidence `high`. Otherwise resolved per Phase 2.5 via `/wf:classify`. |

### Folder Resolution

- **Task folder:** `{task-root}/{task-id}/`.
- **Task id:** `{task-id}` — opaque: the active tracker capability's own shape when registered (e.g. a tracker-native identifier format), or the local `T<NNN>` scheme otherwise (see Validation below for how `{task-id}` is resolved).

### Validation

- **Resolve the tracker-surface state first** (direct provider resolution's scope-equality filter — "Direct provider resolution" below — applied at validation time, before any fetch): whether an active capability owns the `tracker` surface.
- **Tracker active:** `<id>` must be supplied or inferable — a real tracker record needs a real id. If `<id>` is provided, use it verbatim (opaque to core). If omitted, infer a numeric token via `current-branch-query`, reached through **direct provider resolution** to the `delivery` surface (see "Direct provider resolution" below): extract the first 3+-digit run from the resolved branch name. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (matching both a tracker-prefixed shape and the local `T<NNN>` scheme's own form uniformly). Exactly one match — reuse that folder's full name as `<id>` verbatim (this recovers the opaque shape a prior invocation already established; core never reconstructs it itself) and set `{task-id}` = `<id>`. Zero matches — stop: "No task id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:lite <id>`." More than one match — stop: "No task id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:lite <id>`." If no numeric token can be extracted from the branch at all, stop: "No task id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:lite <id>`."
- **No tracker active (the contract's id-shape rule, local scheme):** if `<id>` is explicitly provided, use it verbatim as `{task-id}`. Otherwise mint a fresh id: scan `{task-root}` for existing `T<NNN>`-prefixed folders, take the highest, +1, zero-pad to 3 digits. **No stop condition** — an empty registry always yields a deterministic local id with no tracker call at all.
- If `00_reqs.md` already exists, skip the tracker fetch and use the existing file.
- If `01_spec.md` or `02_plan.md` already exists, stop: "Full-flow artifacts found. Continue with `/wf:implement {id}` or delete them first."
- **Branch-name matching token.** Extract the first 3+-digit run from `<id>` (whatever its shape) — call it `{numeric-id}`. This token is used **only** by the Phase 2 branch-gate check (matching against an already-existing branch name); it plays no role in the task folder, the task id, or any tracker operation, all of which use the opaque `<id>`/`{task-id}` form verbatim.

**Type resolution:** If `--type` is provided, use it (treat as `Confidence: high`). Otherwise, defer until Phase 2.5, which delegates to `/wf:classify`. Do NOT keyword-scan inline — the rubric lives in the classifier.

### Direct provider resolution (how `get` is reached)

Every tracker operation below (`get`) is reached by the canonical resolve-once procedure — `invocation-runtime.ops.md` §"Direct provider resolution" (one `## Capabilities` read from `_local/config.md`, the default-absent `registryPath` value, plus one manifest+fragment read for the `tracker` surface). A plugin-anchored `Path` resolves through the self-heal home — `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal" (recorded-root-first, then the install-manifest self-heal) — so a dangling-but-recoverable recorded root self-heals in-memory and the `get` just works instead of silently dropping the fetch.

**Zero readable rows** — no capability's `tracker` manifest could be read (genuinely unconfigured, or registered-but-unrecoverable after the self-heal). Either way this `get` is a **read**, so it stays silent local-only — no tracker operation is attempted, no residual message, no capability term surfaces; every step below proceeds from local artifacts alone.

### Direct provider resolution (how `current-branch-query` is reached)

`current-branch-query` is reached by the canonical resolve-once procedure — `invocation-runtime.ops.md` §"Direct provider resolution" (one `## Capabilities` read from `_local/config.md`, the default-absent `registryPath` value, plus one manifest+fragment read for the `delivery` surface; a plugin-anchored `Path` resolves through the self-heal home, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"). With zero readable `delivery` rows, `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Use sourcebot MCP tools (`mcp__sourcebot__search_code`, `mcp__sourcebot__read_file`, `mcp__sourcebot__list_tree`) for code search — preferred over raw `Grep`/`Glob`.
- Read any file in the project.
- Use MSSQL extension tools (`mssql_*`) read-only for schema lookups.
- Invoke `get` via direct provider resolution to the tracker surface (read-only) for fetching the work item.
- Read-only resolution via `current-branch-query` (direct provider resolution to the delivery surface).
- Read-only diff/status review for the Phase 6 handoff summary (inspecting the working tree; not a delivery-provider operation).
- Write/create files inside the task folder (`{task-root}/{task-id}/`).
- Modify source files during Phase 5 (implementation) only.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 2 branch gate. The wf:branch subagent performs only non-destructive delivery actions — creating or switching to the task branch, fetching the base, and publishing the branch upstream; it never resets, force-pushes, deletes branches, or commits. Invoke the **Task** tool with `subagent_type: wf:classify` for Phase 2.5 type resolution (read-only).

**Forbidden:**

- Run builds, tests, or installs outside the verification command specified in the plan.
- Run any destructive version-control operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above).
- Commit, push, or open a PR — always hand off manually. (`push --set-upstream` performed by wf:branch is the one exception, and only for publishing the new task branch — never for pushing commits.)
- Expand scope beyond the approved `lite.md` plan. If the task looks bigger than expected mid-execution, stop and escalate to the full flow.

---

## Phase 1: Fetch Requirements

Skip if `00_reqs.md` already exists in the task folder.

1. **Fetch the work item.** Invoke `get(<id>)` via direct provider resolution to the tracker surface (above).
   - **Unconfigured tracker** (the scope-equality filter matches zero rows), or a **registered-but-unrecoverable** tracker whose manifest couldn't be read after the self-heal — silent local-only fallback, no prompt, no error, no residual message (a `get` is a read): continue to step 2 with no fetched data.
   - **Configured and the fetch succeeds** — proceed with the fetched fields exactly as before.
   - **Mid-run failure** (a tracker was registered but the `get` call errors) — warn once, naming the operation and the error, then continue local-only from whatever context is available. The tracker call itself never hard-stops the run; lite's own empty-description gate (step 2) still applies when no usable description results.

2. **Skip parent fetch and discussion comments.** `/wf:lite` is for small tasks where the child description is expected to be sufficient. If the description is empty or minimal (including the unconfigured/failed-tracker case, where no description was fetched at all), stop: "Work item description is empty or minimal. Use `/wf:spec {id}` to fetch parent context." This content gate is independent of tracker state — `/wf:lite` needs a self-contained description to write a mini-spec, and `/wf:spec` is the flow that resolves an empty one from parent context.

3. **Create the task folder** `{task-root}/{task-id}/` if it doesn't exist.

4. **Write `00_reqs.md`**:

```markdown
# {task-id}: {Work Item Title}

> Fetched from the active tracker (task #{id}) on {YYYY-MM-DD}, when a tracker capability is registered; otherwise a blank local requirements file.
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

1. **Resolve delivery-surface ownership first** — the scope-equality filter (`contribution-kind = provider` **and** `scope = delivery`) of **direct provider resolution** (see "Direct provider resolution" above), applied before any branch read. **Zero matching rows (bare-core mode)** — the branch gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no error and no hard stop. Report "Branch gate skipped — no delivery provider registered (bare-core mode)." and proceed to Phase 2.5. **One matching row** — resolve the current branch via `current-branch-query`, then apply steps 2–3.
2. **If the branch name contains `/{numeric-id}-`** — already on the task branch, proceed to Phase 2.5.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing the task id `{id}` **and the forwarded `delivery` resolution record** resolved in step 1 (the optional spawn extension — `invocation-runtime.ops.md` §"Run-scoped provider forwarding"), so `wf:branch` consumes it instead of re-resolving. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
   - On success (`BRANCH — created`/`switched`/`already-active`), continue to Phase 2.5.
   - On failure (`BRANCH — Error`), stop and surface the subagent's reason.

---

## Phase 2.5: Resolve Task Type

Determine the task's branch-type bucket (one of `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) before exploration so it can be persisted into the `lite.md` metadata.

1. **If `--type` was provided**, use that value. Set `Confidence: high`, `Alternative: —`. Skip the classifier call.
2. **Otherwise**, invoke the **Task** tool with `subagent_type: wf:classify`, passing `{id}` (resolved against `00_reqs.md`). Parse the `CLASSIFY — Complete` block for `Type`, `Confidence`, and `Alternative`. If the classifier returns `CLASSIFY — Error`, stop and surface the reason — do not guess a type inline.
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

The verbatim `lite.md` template — the metadata block, `## Objective`, `## Approach`, `## Files`, `## Plan`, and `## Done When` — lives at [`references/lite-template.md`](references/lite-template.md). It is read only on this write path (Phase 4), so it stays out of the boot body. Read it, then emit it with placeholders substituted.

**Plan sizing:** 2–4 checkbox steps total (one or two change steps + verify + handoff). If the natural step count exceeds 4, the task is too big for `/wf:lite` — stop and escalate to the full flow.

**After writing `lite.md`**, invoke `/wf:index {id} lite "plan ready · <n> steps"` to record it in the per-task index. Substitute the actual step count.

### Chat summary at the end of Phase 4

```
LITE — Plan Ready

Task: {task-id} — <title>
Files: <count>
Steps: <count>
Plan: {task-root}/{task-id}/lite.md

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
   - Review the changed-files summary — confirm only expected files were modified.
   - Review the full working-tree diff.
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

- **Tracker fetch outcome (configured / unconfigured / unrecoverable / failed):** **Unconfigured** (no active tracker-surface owner) — silent local-only fallback, no prompt, no error; proceed to Phase 1 step 2 with no fetched data. **Registered-but-unrecoverable** (a registered capability's manifest couldn't be read — recorded root dangled, self-heal recovered nothing) — the install-manifest self-heal recovers the root when it can, and the `get` just works; when it stays unrecoverable the `get` is a read, so it too stays silent local-only with no residual message. **Configured and the fetch succeeds** — proceed with the fetched fields exactly as before. **Configured but the `get` call fails mid-run** — warn once, naming the operation and the error, then continue local-only from whatever context is available. The tracker call itself never hard-stops the run; but with no usable description resulting (the unconfigured/unrecoverable/failed case with no pre-existing `00_reqs.md`), the empty-description gate below still applies — see the next bullet.
- **Empty/minimal description:** Stop. `/wf:lite` expects the child description to be self-contained. Direct the user to `/wf:spec {id}`. This gate is independent of tracker state — it fires on content, not on a tracker call.
- **Full-flow artifacts already exist** (`01_spec.md` or `02_plan.md`): Stop. The task is already in the full flow — continue with `/wf:implement {id}` instead.
- **`lite.md` already exists and has unchecked steps:** Resume from the first unchecked step. Do not re-fetch or re-explore. Skip straight to Phase 5.
- **`lite.md` already exists and is fully checked:** Report "All steps complete for {task-id}." and stop.
- **Exploration reveals >5 files or architectural work:** Stop. Escalate to full flow.
- **Mid-execution scope creep:** Stop. Revert partial edits. Escalate.
- **Verification fails:** Do not commit. Revert if isolatable. Leave a failure note in `lite.md`.
- **Merge conflict:** Stop. Do not auto-resolve.

---

## Final Output

```
LITE — Complete

Task: {task-id} — <title>
Type: <feat | fix | chore | refactor | migration | docs | hotfix>  (source: <flag | classify-high | classify-medium | classify-low-user-confirmed>)
Files changed: <count>
Status: READY FOR REVIEW (not committed)
Verification: <PASS / FAIL>
Artifact: {task-root}/{task-id}/lite.md

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
