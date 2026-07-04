---
name: branch
description: Creates and switches to the task's dedicated branch for an ADO task — deriving the branch name (feature/fix/chore/refactor/migration/docs/hotfix) from the task's plan or spec — and sets up remote tracking through the active delivery provider. The self-contained implementation behind /wf:branch; invoked via the Task tool as the branch gate by other wf:* skills.
argument-hint: 'ado-id (numeric or prefixed); empty to infer from current branch'
---

# wf:branch — Subagent (full procedure)

You are the implementation of `/wf:branch`. The full procedure lives here — this agent is self-sufficient and does NOT read the wf:branch skill for procedural logic. Execute everything in your isolated context so the caller (a user-typed slash command, or another wf:* skill that invoked you via the **Task** tool) doesn't pay the cost of the procedure.

## Inputs

You are invoked with one optional arg:

- `ado-id` — numeric (e.g. `6396`) or prefixed (e.g. `ADO-6396`). If omitted, infer from the current branch name — resolved via `current-branch-query` (first 3+-digit run).

If neither passed nor inferable from the current branch, return `BRANCH — Error` with reason "No ADO ID provided and none could be inferred from the current branch."

## Direct provider resolution (how every operation below is reached)

Every operation this file invokes — `workspace-root-resolve`, `current-branch-query`, `branch-create` — is reached the same way, per `invocation-runtime.contract.md` §"Direct provider resolution":

1. Read the `## Capabilities` registry at its `registryPath`-resolved location (default `_local/config.md` — already loaded in Step 1).
2. Select the row(s) where `contribution-kind = provider` **and** `scope = delivery`, across the whole registry (a scope filter, independent of which phase value the row itself carries).
3. Read that capability's `manifest.md` at its registry path, then dispatch its fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the referenced file and follow it in-context; no subagent is spawned).
4. **Zero matching rows** — no capability owns the `delivery` surface. Reads (`workspace-root-resolve`, `current-branch-query`) fall back silently to the plain-directory / already-known-branch value; a write (`branch-create`) cannot proceed — see Step 3's no-delivery-provider path.

## Step 1 — Resolve config, workspace root, and task folder

1. Read `_local/config.md` from the current working directory — a plain read; it needs no delivery-provider call at all (the registry lives in this same file, consulted from here on). If missing, return `BRANCH — Error` with reason "Run /wf:init first."
2. Extract `{task-root}` and `{wi-prefix}` from the config. Never hardcode them.
3. Resolve `{numeric-id}`: digits from the input (`6396` from `6396`, `ADO-6396`, or `ADO_6396`), or from the current branch's first 3+-digit run (via `current-branch-query`).
4. Resolve the absolute workspace root via `workspace-root-resolve` (direct provider resolution above). With no delivery provider registered this resolves as a plain directory (the contract's fallback — not an error). With a provider registered but no working tree to resolve, return `BRANCH — Error` with reason "Not inside a resolvable workspace."
5. Compute task folder. If `{task-root}` is absolute, use it as-is; otherwise join with the resolved workspace root: `<workspace-root>/{task-root}/{wi-prefix}-{numeric-id}/`. Hold the result as `<task-folder-abs>` (always absolute — passed verbatim to wf:index in Step 4). If the folder doesn't exist, return `BRANCH — Error` with reason "Task folder not found. Run /wf:spec <id> first."
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

## Step 3 — Invoke `branch-create`

Derive `<branch-name>` from Step 2 (unchanged, tracker-side logic — out of scope for this rewrite), then invoke `branch-create(<branch-name>)` via direct provider resolution.

1. **No-delivery-provider path.** If the scope-equality filter (`provider` + `scope: delivery`) matches zero rows across the registry, return `BRANCH — Error` immediately with reason "No delivery provider is registered. Register a capability that owns the `delivery` surface (e.g. install and run `/wf-git:init`)." No delivery operation is attempted.
2. **Invoke `branch-create(<branch-name>)`.** This single operation absorbs the detached-HEAD guard, the dirty-worktree guard, the exact-name existing-branch check, base determination, remote detection and fetch, branch creation/switch, and upstream tracking — all internal to the delivery provider's own implementation.
3. **Detached HEAD** and **dirty working tree** both surface as an error result from `branch-create` itself — propagate its reason verbatim into `BRANCH — Error`.
4. **Base-branch fetch failure** — a remote exists but the provider's fetch of the latest base fails — surfaces as an error result from `branch-create`; propagate its reason. With no remote, `branch-create` silently branches from the local base instead (no error).
5. **Map the result** onto the unchanged Final Output block (Step 5): `<state>` (`created` | `switched` | `already-active`), `<base-source>` (`origin/<base>` | `<base>` | `already existed`), `<tracking>` (`origin/<branch-name>` | `local-only (push failed)` | `local-only (no remote)` | `local-only (no upstream)`).

**Two v1 safety nets have no equivalent operation and are intentionally dropped** — not a fresh gap discovered here, already accepted at planning time:

- The ID-glob existing-branch search for a branch whose *title* drifted between two invocations — `branch-create` matches only by exact name. Accepted because the branch name is derived deterministically from the same static plan/spec source every time (Step 2), so no title drift occurs in practice.
- The branch-name-collision-with-a-different-task numeric-suffix guard — no operation covers this rare case. If a real collision surfaces in practice it needs either a contract change or a core-side pre-check before invoking `branch-create` — it is not silently invented here.

## Step 4 — Update the index

After a successful path through Step 3 (`created`, `switched`, or `already-active`), invoke the **Task** tool with `subagent_type: wf:index`, passing:

- `task-folder` — `<task-folder-abs>` (the absolute path computed in Step 1, step 5 — never the relative `{task-root}/...` form)
- `slot` — the literal string `branch`
- `summary` — the resolved `<branch-name>` (no quotes)
- `calling-skill` — the literal string `/wf:branch`

If the wf:index subagent returns `INDEX — Error`, do NOT fail the branch operation — the branch was created/switched successfully and that's the primary contract. Append the index failure as a parenthetical to `<tracking>` (e.g., `origin/<branch-name> (index update failed)`) but still emit the `BRANCH — <state>` success block.

## Step 5 — Final Output

Emit ONLY the Final Output block. No narrative before or after — branch-derivation reasoning and intermediate results stay in your isolated context.

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
