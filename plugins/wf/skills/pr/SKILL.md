---
name: pr
description: Opens a pull request for the current task branch — first commits and pushes any pending work (via the wf:commit subagent, push on), then composes a PR body from the task's wf artifacts (reqs, spec, plan resolution, verify, QA), links the work item through the active tracker capability, when one is registered, and creates the PR through the active delivery provider. Use when a task is implemented and ready for review. Pass --no-commit to open a PR against exactly what's already pushed, --draft for a draft PR.
allowed-tools: [Bash]
---

# /wf:pr — Push, then open a PR from the task's wf artifacts

Opens a PR for the current task through the project's active delivery provider. This skill is a **light orchestrator**, not a pure thin wrapper: it makes two host-level **Task** calls — first `wf:commit` (to commit + push), then `wf:pr` (to compose the body and create the PR). The orchestration lives in the host (not inside a subagent) on purpose: it keeps every nested **Task** call at the single level of depth this library has proven (host → agent → agent), while the heavy context (the full diff, all artifacts) still stays entirely inside the two subagents. The host only ever sees two short result blocks.

**How a PR is opened:** core opens and detects pull requests through the project's active **delivery provider** — it does not know or name which concrete tool implements that. The work item is linked through the active tracker capability's `attach_link` operation, when one is registered — a side-effecting embed of the tracker's own work-item link form (core doesn't know or name that concrete form, and the operation returns nothing observable), which the tracker attaches when the PR merges; with no tracker registered, the body carries no work-item link at all. Prerequisite: a delivery provider must be registered, and its underlying tool authenticated, before this operation can succeed.

---

## Prerequisites

Read `_local/config.md` for `{task-root}`. If missing, stop: "Run `/wf:init` first."

---

## Command Syntax

```
/wf:pr [<id>] [--draft] [--base <branch>] [--no-commit]
```

| Argument          | Required | Description                                                                                                       |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `<id>`            | NO       | Work item id — numeric or prefixed. Falls back to inferring from the current branch.                             |
| `--draft`         | NO       | Open the PR as a draft.                                                                                           |
| `--base <branch>` | NO       | Base branch for the PR. Defaults to the repo's `main` (or `master`).                                             |
| `--no-commit`     | NO       | Skip the commit+push step and open a PR against exactly what's already pushed. (The branch must already exist on the remote.) |

---

## Safety Rules

**Allowed:**

- Read `_local/config.md` and the task folder.
- Read-only resolution for ID/branch inference (`workspace-root-resolve`, `current-branch-query`).
- Invoke the **Task** tool with `subagent_type` `wf:commit` and `wf:pr`.

**Forbidden:**

- Modify any source file — this skill only orchestrates; the subagents invoke the delivery provider.
- Run any destructive delivery operation.
- Author commits or PR bodies inline — that is the subagents' job, and keeps the diff and artifacts out of this context.

---

## Phase 1 — Resolve the task ID

Resolve `{numeric-id}`: the passed value, or the current branch's first 3+-digit run (via `current-branch-query`). If neither, stop: "No id provided and none could be inferred from the current branch."

## Phase 2 — Commit and push (unless --no-commit)

Unless `--no-commit` was passed, invoke the **Task** tool with `subagent_type: wf:commit`, passing the work-item id `{numeric-id}` as its argument (which `wf:commit` otherwise infers from the task branch name), `push: true`, `staged: false`.

Gate on its `COMMIT —` block:

- `COMMIT — Error` → stop and surface the reason. Do not proceed to PR creation.
- `Push:` value starting with `failed` → stop: "Push failed — cannot open a PR against an unpushed branch. <push reason>"
- `COMMIT — committed` or `COMMIT — nothing-to-commit` with a non-failed push → proceed to Phase 3.

Surface a single one-line summary of the commit result (e.g. "Committed 4 files, pushed." or "Nothing new to commit; branch up to date."). Do **not** reprint the full `COMMIT` block — the `PR` block is this skill's final output.

If `--no-commit` was passed, skip straight to Phase 3.

## Phase 3 — Compose the body and create the PR

Invoke the **Task** tool with `subagent_type: wf:pr`, passing:

- `id` — `{numeric-id}`
- `draft` — `true` if `--draft` was passed, else `false`
- `base` — the `--base` value, or omit to let the subagent detect `main`/`master`

Emit the subagent's `PR —` block verbatim as this skill's final output.

---

## Edge Cases

- **Not on a task branch + `--no-commit`:** the subagent stops (`PR — Error`) — it won't create a branch in no-commit mode. Drop `--no-commit` (so `wf:commit` runs its branch gate) or run `/wf:branch` first.
- **No resolvable workspace root** — `PR — Error`; with a delivery provider active, `workspace-root-resolve` found no working tree to resolve.
- **Push failed in Phase 2:** stop before PR creation — the branch isn't on the remote.
- **PR already open for this branch:** the subagent returns `PR — exists` with the existing URL rather than creating a duplicate.
- **Delivery provider not authenticated:** the subagent returns `PR — Error` with the provider's own authentication-remedy hint.
- **No delivery provider registered:** the subagent returns `PR — Error` stating plainly that no delivery provider is registered and naming the remedy (register a capability that owns the `delivery` surface, e.g. install and run `/wf-git:init`). No delivery operation of any kind is attempted.
- **No tracker registered:** the composed body omits the Work-item link section and the "Resolves…" sentence entirely; no tracker operation is attempted and no capability term appears anywhere in the output.
- **Mid-run tracker failure:** a `get`/`attach_link` call that errors after a tracker was registered — the subagent warns once (naming the operation and the error) as a parenthetical on the `Body sources:` line, composes a local-only body with no work-item link, and PR creation still proceeds.

---

## Final Output (emitted by the wf:pr subagent)

```
PR — <created | exists>

Task: {task-id} — <title>
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
