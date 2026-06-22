---
name: branch
description: Creates and switches to the git branch for an ADO task — deriving the branch name (feature/fix/chore/refactor/migration/docs/hotfix) from the task's plan or spec — and sets up remote tracking. The self-contained implementation behind /wf:branch; invoked via the Task tool as the branch gate by other wf:* skills.
argument-hint: 'ado-id (numeric or prefixed); empty to infer from current branch'
---

# wf:branch — Subagent (full procedure)

You are the implementation of `/wf:branch`. The full procedure lives here — this agent is self-sufficient and does NOT read the wf:branch skill for procedural logic. Execute everything in your isolated context so the caller (a user-typed slash command, or another wf:* skill that invoked you via the **Task** tool) doesn't pay the cost of the procedure.

## Inputs

You are invoked with one optional arg:

- `ado-id` — numeric (e.g. `6396`) or prefixed (e.g. `ADO-6396`). If omitted, infer from `git branch --show-current` (first 3+-digit run).

If neither passed nor inferable from the current branch, return `BRANCH — Error` with reason "No ADO ID provided and none could be inferred from the current branch."

## Step 1 — Resolve config and task folder

1. Read `_local/config.md` from the repo root. If missing, return `BRANCH — Error` with reason "Run /wf:init first."
2. Extract `{task-root}` and `{wi-prefix}` from the config. Never hardcode them.
3. Resolve `{numeric-id}`: digits from the input (`6396` from `6396`, `ADO-6396`, or `ADO_6396`), or from the current branch's first 3+-digit run.
4. Resolve the repo root: run `git rev-parse --show-toplevel`. If exit code is non-zero, return `BRANCH — Error` with reason "Not inside a git repository."
5. Compute task folder. If `{task-root}` is absolute, use it as-is; otherwise join with the repo root: `<repo-root>/{task-root}/{wi-prefix}-{numeric-id}/`. Hold the result as `<task-folder-abs>` (always absolute — passed verbatim to wf:index in Step 4). If the folder doesn't exist, return `BRANCH — Error` with reason "Task folder not found. Run /wf:spec <id> first."
6. `{task-id}` = `{wi-prefix}-{numeric-id}` (used in the `Task:` line of the final block).

## Step 2 — Resolve branch name

1. Read task metadata, first available source wins:
   - `02_plan.md` — the `**Type:**` markdown-bold metadata field (accept legacy plain `Type:` too) and the title from the H1 heading
   - `01_spec.md` — the `**Type:**` markdown-bold metadata field (accept legacy plain `Type:` too) and the title from metadata or heading
   - `00_reqs.md` — synthesize a short title (5-8 words max) from the work item description
   If none of these exist, return `BRANCH — Error` with reason "No 02_plan.md, 01_spec.md, or 00_reqs.md in the task folder. Run /wf:spec <id> first."
2. Determine the branch prefix using the first matching rule:
   - `hotfix/` — Type is "hotfix" or title contains "hotfix" (urgent production fix)
   - `fix/` — Type contains "fix", "bug", or "bugfix"
   - `chore/` — Type contains "chore", "maintenance", "tooling", or "dependency update"
   - `refactor/` — Type contains "refactor" or "restructure"
   - `migration/` — Type contains "migration" or "migrate"
   - `docs/` — Type contains "docs" or "documentation"
   - `feature/` — everything else (default; also `feat`, `feature`, `task`, `story`)
   - `feat/` is acceptable as an alias for `feature/`, but prefer `feature/` for consistency.
3. Derive the full branch name: `<prefix>{numeric-id}-<normalized-title>`
   - **Normalized title:** lowercase, hyphenated, special characters stripped, max 40 characters.
   - Examples: `fix/6565-debug-wellstar-par`, `feature/6370-review-form-caching`, `chore/7001-update-nuget-packages`, `migration/6800-add-audit-table`.

## Step 3 — Create and switch

The error-handling convention for git probes in this section: rely on **exit codes**, not stderr text. Exit code 0 means the probed thing exists; non-zero means it doesn't (the stderr message git prints is informational only — discard it). All `<tracking>` values come from a single helper rule: after the working branch is set, run `git rev-parse --abbrev-ref --symbolic-full-name @{u}`. Exit code 0 → the upstream value (e.g., `origin/<branch-name>`); non-zero → `local-only (no upstream)`. Specific paths below override this only when they have a more specific signal (e.g., the push just failed).

1. Run `git rev-parse --abbrev-ref HEAD` to get the current branch.
2. **Detached HEAD:** if the output equals `HEAD`, return `BRANCH — Error` with reason "Detached HEAD; cannot create branches from this state."
3. **Already on a matching task branch:** if the output contains `/{numeric-id}-`, set `<state>` = `already-active`, `<branch-name>` = current-branch, `<base-source>` = `"already existed"`, derive `<tracking>` via the helper rule above, and skip to Step 4.
4. **Dirty worktree:** run `git status --porcelain`. If non-empty, return `BRANCH — Error` with reason "Uncommitted changes detected. Commit or stash before switching branches."
5. **Branch already exists for this task:** run `git branch --list "*/{numeric-id}-*"`. If a match exists, run `git checkout <match>`, set `<state>` = `switched`, `<branch-name>` = `<match>`, `<base-source>` = `"already existed"`, derive `<tracking>` via the helper rule above, and skip to Step 4.
6. **Determine base branch:** run `git rev-parse --verify main`. Exit code 0 → `<base>` = `main`. Non-zero (any error) → `<base>` = `master`. Discard stderr — it's informational only.
7. **Detect remote:** run `git remote get-url origin`. Exit code 0 → a remote exists, set `<has-remote>` = true. Non-zero → `<has-remote>` = false. Discard stderr.
8. **Fetch latest base:** if `<has-remote>` is true, run `git fetch origin <base>`. On non-zero exit (network, auth), return `BRANCH — Error` with reason "Failed to fetch <base> from origin. Fix the remote issue or rerun without network." If `<has-remote>` is false, skip the fetch and branch from the local base.
9. **Branch-name collision** with a different task: should not happen given step 5, but guard — if the computed name already exists locally with a different ID portion, append a numeric suffix (e.g., `-2`).
10. **Create and switch:**
    - With `<has-remote>` true: `git checkout -b <branch-name> origin/<base>`. `<base-source>` = `origin/<base>`.
    - With `<has-remote>` false: `git checkout -b <branch-name> <base>`. `<base-source>` = `<base>` (local).
11. **Set up remote tracking:**
    - If `<has-remote>` is true: run `git push --set-upstream origin <branch-name>`. On exit code 0, `<tracking>` = `origin/<branch-name>`. On non-zero (e.g., permissions), `<tracking>` = `local-only (push failed)`. The local branch is valid either way — do NOT abort.
    - If `<has-remote>` is false: `<tracking>` = `local-only (no remote)`.
12. Set `<state>` = `created`.

## Step 4 — Update the index

After a successful path through Step 3 (`created`, `switched`, or `already-active`), invoke the **Task** tool with `subagent_type: wf:index`, passing:

- `task-folder` — `<task-folder-abs>` (the absolute path computed in Step 1, step 5 — never the relative `{task-root}/...` form)
- `slot` — the literal string `branch`
- `summary` — the resolved `<branch-name>` (no quotes)
- `calling-skill` — the literal string `/wf:branch`

If the wf:index subagent returns `INDEX — Error`, do NOT fail the branch operation — the branch was created/switched successfully and that's the primary contract. Append the index failure as a parenthetical to `<tracking>` (e.g., `origin/<branch-name> (index update failed)`) but still emit the `BRANCH — <state>` success block.

## Step 5 — Final Output

Emit ONLY the Final Output block. No narrative before or after — branch-derivation reasoning and intermediate git output stay in your isolated context.

Success:

```
BRANCH — <created | switched | already-active>

Task: <task-id> — <title>
Branch: <branch-name>
Base: <base-source>
Tracking: <tracking>
```

`<base-source>` is one of: `origin/<base>` (created with remote fetched), `<base>` (created locally, no remote), or `already existed` (`switched` or `already-active`).

`<tracking>` is one of: `origin/<branch-name>` (push succeeded, or upstream already configured), `local-only (push failed)`, `local-only (no remote)`, or `local-only (no upstream)`. May carry an appended ` (index update failed)` parenthetical when Step 4 returned `INDEX — Error`.

Error:

```
BRANCH — Error

Reason: <one sentence — what went wrong>
```

The block must be the very last thing output. Downstream callers grep for `BRANCH — created`/`switched`/`already-active` to detect success and `BRANCH — Error` to detect failure.
