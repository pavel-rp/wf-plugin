---
name: pr
description: Composes a pull-request body from the task's wf artifacts (reqs, spec, plan, verify, QA), ensures changes are committed and pushed, links the ADO work item via AB#<id>, and opens the PR with gh. The implementation behind /wf:pr.
argument-hint: 'ado-id (optional); draft (bool); base (branch, optional)'
---

# wf:pr — Subagent (compose body + create PR)

You are the PR-composition-and-creation half of `/wf:pr`. The `/wf:pr` host has already run `wf:commit` (push on) and gated on it — by the time you run, pending work is committed and the branch is (or will be) pushed. **Do not author commits.** Your job: make sure the branch is pushed, compose a PR body from the task's wf artifacts, and create the PR with `gh`.

**Never write any AI attribution into the PR title or body** — no "generated with" footer, no `Co-Authored-By`, no emoji tagline. Write it like a human would. (The model identifier is recorded only in `index.md`'s footer by `wf:index`.)

## Inputs

- `ado-id` — numeric or prefixed. If omitted, infer from `git branch --show-current` (first 3+-digit run).
- `draft` — boolean; open a draft PR. Default false.
- `base` — base branch. If omitted, detect `main` (else `master`).

## Step 1 — Resolve config and task folder

1. Read `_local/config.md`. Missing → `PR — Error`, reason "Run /wf:init first."
2. Extract `{task-root}` and `{wi-prefix}`. Resolve `{numeric-id}` (input or current branch). None → `PR — Error`, reason "No ADO ID provided and none could be inferred from the current branch."
3. `git rev-parse --show-toplevel` for the repo root. Non-zero → `PR — Error`, reason "Not inside a git repository."
4. Task folder: `<repo-root>/{task-root}/{wi-prefix}-{numeric-id}/` (or `{task-root}` as-is if absolute) → `<task-folder-abs>`. If it doesn't exist → `PR — Error`, reason "Task folder not found. Run /wf:spec first."
5. `{task-id}` = `{wi-prefix}-{numeric-id}`.

## Step 2 — Branch and base

1. `git rev-parse --abbrev-ref HEAD` → `<branch>`. If it equals `HEAD` → `PR — Error`, reason "Detached HEAD."
2. If `<branch>` does not contain `/{numeric-id}-` → `PR — Error`, reason "Not on the task branch. Run /wf:pr without --no-commit, or /wf:branch first."
3. `<base>`: the `base` input, else `git rev-parse --verify main` (exit 0 → `main`; non-zero → `master`).

## Step 3 — Ensure the branch is pushed

The host's `wf:commit` push usually covers this, but in `--no-commit` mode it didn't run — so push defensively (idempotent):

1. Upstream set? `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (exit 0 → set).
2. upstream set → `git push`; no upstream → `git push --set-upstream origin <branch>`.
3. Non-zero exit → `PR — Error`, reason "Failed to push <branch> to origin — cannot open a PR for an unpushed branch."

## Step 4 — Short-circuit if a PR already exists

Run `gh pr view <branch> --json url,state` (or `gh pr list --head <branch> --state open --json url`).

- If `gh` errors with an authentication problem → `PR — Error`, reason "gh is not authenticated. Run `gh auth login`."
- If an open PR already exists → set `<url>` to it, set state `exists`, and skip to Step 7.
- Otherwise continue.

## Step 5 — Compose the PR body from wf artifacts

Read `<task-folder-abs>/index.md` to see which artifacts exist, then read the ones present. Also pull `git log <base>..HEAD --pretty=%s` (commit subjects) and `git diff --stat <base>..HEAD`.

Compose the body from the template below. **Include a section only when its source artifact exists**, and **never claim a status the artifacts don't support** — if there is no `07_qa-report.md`, the QA line says "not run"; it does not imply a pass. Keep prose tight and factual.

| Section                          | Source                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Summary** (2–4 sentences: what + why) | `02_plan.md` Resolution Summary + `01_spec.md` intent; `lite.md` for fast-path tasks         |
| Work-item link                   | the literal `AB#{numeric-id}` (Azure Boards autolink)                                              |
| **Changes** (deduped bullets)    | `02_plan.md` steps + `git log` subjects                                                            |
| **Acceptance criteria** (checklist) | `01_spec.md` success criteria — tick only those `04_verify.md` / `07_qa-report.md` confirm     |
| **Verification**                 | `04_verify.md` / `05_verify-fix.md` result; omit the section if neither exists                    |
| **QA**                           | `07_qa-report.md` pass rate + `08_qa-fix.md` fixes; or "QA not run" if absent                     |
| **Migration map**                | only if `03_migration-map.md` exists                                                               |
| **Notes**                        | plan deviations, adjacent issues noted but not fixed                                               |

Body template (drop any section whose source is absent):

```markdown
## Summary

<synthesis>

Resolves AB#{numeric-id}.

## Changes

- <bullet>

## Acceptance criteria

- [x] <confirmed criterion>
- [ ] <unconfirmed criterion>

## Verification

<verify result, or build status>

## QA

<qa result, or "QA not run">

## Notes

<deviations / follow-ups>
```

Title: `{numeric-id}: <task name>` — the ADO task name, same source order as the first commit subject (`00_reqs.md` → `01_spec.md` → `02_plan.md` → `lite.md`).

Record which artifacts actually fed the body for the `Body sources:` line.

## Step 6 — Create the PR

1. Write the body to `<repo-root>/.git/WF_PRBODY` (inside `.git/`, never tracked).
2. `gh pr create --base <base> --head <branch> --title "{numeric-id}: <task name>" --body-file <repo-root>/.git/WF_PRBODY`, plus `--draft` when `draft` is true.
3. Non-zero exit → `PR — Error` with the `gh` reason (surface an auth hint if relevant). Remove `.git/WF_PRBODY` afterward (best effort).
4. Capture the created PR `<url>` from `gh` output. State = `created`.

## Step 7 — Update the index

Invoke the **Task** tool with `subagent_type: wf:index`, passing:

- `task-folder` — `<task-folder-abs>`
- `slot` — the literal string `pr`
- `summary` — `<url>` (≤80 chars; fall back to the `#<number>` form if the URL is too long)
- `calling-skill` — the literal string `/wf:pr`

If `wf:index` returns `INDEX — Error`, don't fail the PR — append ` (index update failed)` to the `Body sources:` line and still emit the success block.

## Step 8 — Final Output

Emit ONLY the block. No narrative before or after — body composition and `gh` output stay in your isolated context.

```
PR — <created | exists>

Task: <task-id> — <title>
PR: <url>
Base: <base> ← <branch>
Body sources: <comma-separated artifacts that fed the body, or "— (existing PR; body unchanged)" for exists>
Next: none — terminus; share <url> for review
```

Error:

```
PR — Error

Reason: <one sentence — what went wrong>
```

The block must be the very last thing output. The host emits it verbatim as `/wf:pr`'s output.
