---
name: pr
description: Opens a GitHub pull request for the current ADO task branch — first commits and pushes any pending work (via the wf:commit subagent, push on), then composes a PR body from the task's wf artifacts (reqs, spec, plan resolution, verify, QA), links the work item with AB#<id>, and runs gh pr create. Use when a task is implemented and ready for review. Pass --no-commit to open a PR against exactly what's already pushed, --draft for a draft PR.
allowed-tools: [Bash]
---

# /wf:pr — Push, then open a PR from the task's wf artifacts

Opens a GitHub PR for the current task. This skill is a **light orchestrator**, not a pure thin wrapper: it makes two host-level **Task** calls — first `wf:commit` (to commit + push), then `wf:pr` (to compose the body and create the PR). The orchestration lives in the host (not inside a subagent) on purpose: it keeps every nested **Task** call at the single level of depth this library has proven (host → agent → agent), while the heavy context (the full diff, all artifacts) still stays entirely inside the two subagents. The host only ever sees two short result blocks.

**Why GitHub:** the downstream repo is hosted on GitHub with its work items in Azure Boards. PRs are created with `gh pr create`; the work item is linked by putting `AB#<id>` in the PR body (the GitHub ↔ Azure Boards bridge). Prerequisite: `gh auth status` must pass.

---

## Prerequisites

Read `_local/config.md` for `{task-root}` and `{wi-prefix}`. If missing, stop: "Run `/wf:init` first."

---

## Command Syntax

```
/wf:pr [<ado-id>] [--draft] [--base <branch>] [--no-commit]
```

| Argument          | Required | Description                                                                                                       |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `<ado-id>`        | NO       | ADO work item ID — numeric or prefixed. Falls back to inferring from the current branch.                         |
| `--draft`         | NO       | Open the PR as a draft.                                                                                           |
| `--base <branch>` | NO       | Base branch for the PR. Defaults to the repo's `main` (or `master`).                                             |
| `--no-commit`     | NO       | Skip the commit+push step and open a PR against exactly what's already pushed. (The branch must already exist on the remote.) |

---

## Safety Rules

**Allowed:**

- Read `_local/config.md` and the task folder.
- Read-only git for ID/branch inference (`git rev-parse`, `git branch`).
- Invoke the **Task** tool with `subagent_type` `wf:commit` and `wf:pr`.

**Forbidden:**

- Modify any source file — this skill only orchestrates; the subagents do the git/gh work.
- Run any destructive git operation.
- Author commits or PR bodies inline — that is the subagents' job, and keeps the diff and artifacts out of this context.

---

## Phase 1 — Resolve the task ID

Resolve `{numeric-id}`: the passed value, or `git branch --show-current` first 3+-digit run. If neither, stop: "No ADO ID provided and none could be inferred from the current branch."

## Phase 2 — Commit and push (unless --no-commit)

Unless `--no-commit` was passed, invoke the **Task** tool with `subagent_type: wf:commit`, passing `ado-id: {numeric-id}`, `push: true`, `staged: false`.

Gate on its `COMMIT —` block:

- `COMMIT — Error` → stop and surface the reason. Do not proceed to PR creation.
- `Push:` value starting with `failed` → stop: "Push failed — cannot open a PR against an unpushed branch. <push reason>"
- `COMMIT — committed` or `COMMIT — nothing-to-commit` with a non-failed push → proceed to Phase 3.

Surface a single one-line summary of the commit result (e.g. "Committed 4 files, pushed." or "Nothing new to commit; branch up to date."). Do **not** reprint the full `COMMIT` block — the `PR` block is this skill's final output.

If `--no-commit` was passed, skip straight to Phase 3.

## Phase 3 — Compose the body and create the PR

Invoke the **Task** tool with `subagent_type: wf:pr`, passing:

- `ado-id` — `{numeric-id}`
- `draft` — `true` if `--draft` was passed, else `false`
- `base` — the `--base` value, or omit to let the subagent detect `main`/`master`

Emit the subagent's `PR —` block verbatim as this skill's final output.

---

## Edge Cases

- **Not on a task branch + `--no-commit`:** the subagent stops (`PR — Error`) — it won't create a branch in no-commit mode. Drop `--no-commit` (so `wf:commit` runs its branch gate) or run `/wf:branch` first.
- **Push failed in Phase 2:** stop before PR creation — the branch isn't on the remote.
- **PR already open for this branch:** the subagent returns `PR — exists` with the existing URL rather than creating a duplicate.
- **`gh` not authenticated:** the subagent returns `PR — Error` with the `gh auth login` hint.

---

## Final Output (emitted by the wf:pr subagent)

```
PR — <created | exists>

Task: {wi-prefix}-{id} — <title>
PR: <url>
Base: <base> ← <branch>
Body sources: <comma-separated artifacts that fed the body, e.g. reqs, spec, plan, verify, qa>
Next: none — terminus; share <url> for review
```

Error:

```
PR — Error

Reason: <one sentence — what went wrong>
```

**The block must always be the very last thing output to chat.**
