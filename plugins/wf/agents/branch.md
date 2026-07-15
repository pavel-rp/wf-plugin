---
name: branch
description: Creates and switches to the task's dedicated branch — deriving the branch name (feature/fix/chore/refactor/migration/docs/hotfix) from the task's plan or spec, falling back to a single tracker lookup or the bare task id when neither exists yet — and sets up remote tracking through the active delivery provider. Works from any state; never blocks on a missing task folder. The self-contained implementation behind /wf:branch; invoked via the Task tool as the branch gate by other wf:* skills.
argument-hint: '<id> (opaque task id); empty to infer from current branch'
---

# wf:branch — Subagent (full procedure)

You are the implementation of `/wf:branch`. The full procedure lives here — this agent is self-sufficient and does NOT read the wf:branch skill for procedural logic. Execute everything in your isolated context so the caller (a user-typed slash command, or another wf:* skill that invoked you via the **Task** tool) doesn't pay the cost of the procedure.

## Inputs

You are invoked with one optional arg:

- `id` — the opaque task id (whatever shape the active tracker capability produced, or the local `T<NNN>` scheme when none is registered). If omitted, infer from the current branch name — resolved via `current-branch-query` (first 3+-digit run).

If neither passed nor inferable from the current branch, return `BRANCH — Error` with reason "No task id provided and none could be inferred from the current branch."

## Provider resolution (resolve once, or consume a forwarded record)

Every operation this file invokes unconditionally — `workspace-root-resolve`, `current-branch-query`, `branch-create` — is a **`delivery`-surface** operation. This agent obtains the `delivery` surface **once**, up front, then dispatches every operation against it, per `invocation-runtime.ops.md` §"Run-scoped provider forwarding" and §"Direct provider resolution":

1. **Consume a forwarded record when present.** If the spawn message carried a forwarded run-scoped resolution record for the `delivery` surface (a parent boot — e.g. the `wf:commit` that nested this one — already resolved it), use its provider identity and resolved fragment path directly — perform **no** registry/manifest/fragment read of your own.
2. **Otherwise self-resolve once** as the top of your own chain. Read the `## Capabilities` registry from `_local/config.md` — the default-absent `registryPath` value — via the plain, cwd-relative bootstrap read Step 1 performs below; select the single row where `contribution-kind = provider` **and** `scope = delivery` across the whole registry (a scope filter, independent of the row's phase value); read that capability's `manifest.md` once and dispatch its fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the referenced file and follow it in-context; no subagent). A plugin-anchored `Path` resolves through the self-heal home — `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal". **Known limitation, unchanged from today:** this bootstrap read precedes any provider resolution, so it cannot honor a project-configured non-default `registryPath`, and assumes the current working directory is the repo root.
3. **Zero `delivery` owner** (self-resolve matched no row, or the forwarded record marks the surface unconfigured/unrecoverable). Reads (`workspace-root-resolve`, `current-branch-query`) fall back silently to the plain-directory / already-known-branch value; a write (`branch-create`) cannot proceed — see Step 3's no-delivery-provider path.

**The `tracker` surface is resolved lazily, not here.** Step 2 needs it only on its no-local-artifact path — the common artifacts-present path never touches the tracker, so this agent doesn't pay a second manifest/fragment read on every invocation to serve a rare fallback. When Step 2 reaches that path, it resolves `tracker` there: consume a forwarded tracker record if the spawn message carried one (same rule as above), otherwise self-resolve — the `## Capabilities` table is already in hand from Step 1's read, so this is a single additional manifest+fragment read (`contribution-kind = provider` **and** `scope = tracker`), never a second registry walk. Zero readable `tracker` rows (unconfigured, or registered-but-unrecoverable) falls straight through to the bare-id fallback — a read, so it stays silent local-only, no residual message, no capability term surfaces.

## Step 1 — Resolve config, workspace root, and task folder

1. Read `_local/config.md` from the current working directory — a plain bootstrap read needing no delivery-provider call (this is the same registry file the Direct-provider-resolution section above consults). If missing, return `BRANCH — Error` with reason "Run /wf:init first."
2. Extract `{task-root}` from the config. Never hardcode it.
3. **Resolve `{task-id}`** (the opaque task id — used for the task folder and the `Task:` line). When `<id>` is passed, use it verbatim. When inferring from the current branch, extract the first 3+-digit run from the resolved branch name (via `current-branch-query`) as a token, then resolve it against `{task-root}` — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token. **Exactly one match** — reuse that folder's full name as `{task-id}` verbatim (never reconstruct it from a prefix). **More than one match** — return `BRANCH — Error` with reason "Ambiguous id: the branch-inferred token `<token>` matches more than one task folder; pass the id explicitly." **Zero matches** — hold the bare token as `{task-id}`; this is not fatal (step 5 no longer treats a missing task folder as an error — Step 2 resolves a title without one). (No numeric token at all was already handled by the Inputs section's no-id error.) Also derive **`{numeric-id}`** — the first 3+-digit run of `{task-id}` — used **only** for the branch name in Step 2, never for the folder or the `Task:` line.
4. Resolve the absolute workspace root via `workspace-root-resolve` (direct provider resolution above). With no delivery provider registered this resolves as a plain directory (the contract's fallback — not an error). With a provider registered but no working tree to resolve, return `BRANCH — Error` with reason "Not inside a resolvable workspace."
5. Compute task folder. If `{task-root}` is absolute, use it as-is; otherwise join with the resolved workspace root: `<workspace-root>/{task-root}/{task-id}/`. Hold the result as `<task-folder-abs>` (always absolute — passed verbatim to wf:index in Step 4). **A missing task folder is not fatal** — this agent works from any state. Hold whether it exists as `<task-folder-exists>`; Step 2 resolves a title with or without it, and Step 4's index update already tolerates a nonexistent target non-fatally (its own established behavior, unchanged here).
6. `{task-id}` is used in the `Task:` line of the final block.

## Step 2 — Resolve branch name

**Works from any state — a missing task folder or missing artifacts never blocks this step; the chain below always terminates in a usable title source.**

1. Read task metadata, first available source wins:
   - `02_plan.md` — the `**Type:**` markdown-bold metadata field (accept legacy plain `Type:` too) and the title from the H1 heading
   - `01_spec.md` — the `**Type:**` markdown-bold metadata field (accept legacy plain `Type:` too) and the title from metadata or heading
   - `00_reqs.md` — synthesize a short title (5-8 words max) from the work item description
   - **No local artifact** (`<task-folder-exists>` is false, or the folder exists but holds none of the three files above) — resolve title/type without blocking, in the order that costs least:
     - **Resolve the `tracker` surface** (lazily, per "Provider resolution" above — a forwarded record if one arrived, otherwise one manifest+fragment read; the registry itself is already in hand from Step 1). If a `tracker` owner resolves: invoke `get({task-id})` — a single fetch, never `list_children` or any other multi-item enumeration; this is the tracker's one general-purpose record fetch (not a bespoke title-only query — no such operation exists in the contract today), so it may return more than the title (description, relations) as a side effect of being one call rather than several. Use the returned title as the title source; if the returned fields carry a work-item-type or label, use it exactly as a `**Type:**` field would be used in step 2 below — otherwise there's no type signal and step 2 falls through to its `feature/` default. A **mid-run failure** (tracker configured but the `get` call errors) warns once per the contract's degradation rules, then falls through to the next bullet — never blocks.
     - **No tracker owner, or the tracker fetch produced nothing usable** — fall back to `{task-id}` itself as the title source. No error.
   This chain never returns `BRANCH — Error` for a missing folder or missing artifacts — it degrades, step by step, down to the bare id.
2. Determine the branch prefix using the first matching rule:
   - `hotfix/` — Type is "hotfix" or title contains "hotfix" (urgent production fix)
   - `fix/` — Type contains "fix", "bug", or "bugfix"
   - `chore/` — Type contains "chore", "maintenance", "tooling", or "dependency update"
   - `refactor/` — Type contains "refactor" or "restructure"
   - `migration/` — Type contains "migration" or "migrate"
   - `docs/` — Type contains "docs" or "documentation"
   - `feature/` — everything else (default; also `feat`, `feature`, `task`, `story`); also the default when the title source carries no `Type:`/type signal at all (the bare-id fallback case)
   - `feat/` is acceptable as an alias for `feature/`, but prefer `feature/` for consistency.
3. Derive the full branch name: `<prefix>{numeric-id}-<normalized-title>`
   - **Normalized title:** lowercase, hyphenated, special characters stripped, max 40 characters. When the title source is the bare `{task-id}` fallback, normalize `{task-id}` itself (e.g. `feature/240-wf-240`) — redundant with `{numeric-id}` but still a valid, unambiguous branch name.
   - Examples: `fix/6565-debug-wellstar-par`, `feature/6370-review-form-caching`, `chore/7001-update-nuget-packages`, `migration/6800-add-audit-table`.

## Step 3 — Invoke `branch-create`

Derive `<branch-name>` from Step 2 (unchanged, tracker-side logic — out of scope for this rewrite), then invoke `branch-create(<branch-name>)` via direct provider resolution.

1. **No readable delivery provider — the two-mode residual diagnosis.** A write cannot proceed when **zero readable** `delivery` providers resolve — whether self-resolution's scope-equality filter (`provider` + `scope: delivery`) matched no row, **or** a consumed forwarded record marks the surface unconfigured/unrecoverable. Return `BRANCH — Error` immediately and attempt no delivery operation; a delivery write surfaces the residual **loudly** (it blocks). Split the reason per the residual diagnosis in `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal" (`<S>` = `delivery`):
   - **(a) Genuinely unconfigured** — every registered manifest is readable and none is scoped to `delivery`: the unchanged plain message "No delivery provider is registered. Register a capability that owns the `delivery` surface (e.g. install and run `/wf-git:init`)."
   - **(b) Registered-but-unrecoverable** — one or more registered capabilities have an unrecoverable manifest (recorded root dangled and the self-heal recovered nothing): name those pack(s) from the `## Capabilities` row as hedged **candidates** — "registered pack(s) [X, …] have an unrecoverable manifest at that path; if one is your `delivery` provider, fix its stale root / re-run its init." List every such pack; **never** assert a candidate owns `delivery`, and **never** tell the user to register a provider they already have.
   A consumed forwarded record already carries which sub-case applies (and, for (b), the candidate pack name(s)), so the boot emits the identical diagnosis without re-reading the registry.
2. **Invoke `branch-create(<branch-name>)`.** This single operation absorbs the detached-HEAD guard, the dirty-tree capture-and-reapply (no longer a refusal — see item 3), the exact-name existing-branch check, base determination, remote detection and fetch, branch creation/switch, and upstream tracking — all internal to the delivery provider's own implementation.
3. **Detached HEAD** surfaces as an error result from `branch-create` itself — propagate its reason verbatim into `BRANCH — Error`. A **dirty working tree** is no longer an error path: `branch-create` carries it automatically across the checkout and, when the carry cannot reapply cleanly onto the fresh base, still completes and returns a distinct non-error outcome naming a preserved entry that needs a manual follow-up to finish reapplying and resolve.
4. **Base-branch fetch failure** — a remote exists but the provider's fetch of the latest base fails — surfaces as an error result from `branch-create`; propagate its reason. With no remote, `branch-create` silently branches from the local base instead (no error).
5. **Map the result** onto the Final Output block (Step 5). `<state>` / `<base-source>` / `<tracking>` are provider-supplied tokens carried through **verbatim** — core never re-derives or assumes a remote name: `<state>` (`created` | `switched` | `already-active`), `<base-source>` (`<remote>/<base>` | `<base>` | `already existed`), `<tracking>` (`<remote>/<branch-name>` | `local-only (push failed)` | `local-only (no remote)` | `local-only (no upstream)`). `<carry>` (`none` | `applied` | a conflict outcome) is the one exception to verbatim passthrough: its conflict value, as the provider defines it, names a literal git command — this file (like every core skill/agent body) stays free of literal git/gh command strings (the OUT-1 gate enforces this across `plugins/wf/skills/` and `plugins/wf/agents/`), so core rewrites only that value's phrasing to name the recoverable follow-up abstractly (e.g. "a preserved entry — a manual follow-up is needed to finish reapplying and resolve it") before it reaches the Final Output block, never passing the provider's literal string through.

**Two v1 safety nets have no equivalent operation and are intentionally dropped** — not a fresh gap discovered here, already accepted at planning time:

- The ID-glob existing-branch search for a branch whose *title* drifted between two invocations — `branch-create` matches only by exact name. Accepted because the branch name is derived deterministically from the same static plan/spec source every time (Step 2), so no title drift occurs in practice.
- The branch-name-collision-with-a-different-task numeric-suffix guard — no operation covers this rare case. If a real collision surfaces in practice it needs either a contract change or a core-side pre-check before invoking `branch-create` — it is not silently invented here.

## Step 4 — Update the index

After a successful path through Step 3 (`created`, `switched`, or `already-active`), invoke the **Task** tool with `subagent_type: wf:index`, passing:

- `task-folder` — `<task-folder-abs>` (the absolute path computed in Step 1, step 5 — never the relative `{task-root}/...` form)
- `slot` — the literal string `branch`
- `summary` — the resolved `<branch-name>` (no quotes)
- `calling-skill` — the literal string `/wf:branch`

If the wf:index subagent returns `INDEX — Error`, do NOT fail the branch operation — the branch was created/switched successfully and that's the primary contract. Append the index failure as a parenthetical to `<tracking>` (e.g., `<remote>/<branch-name> (index update failed)`) but still emit the `BRANCH — <state>` success block.

## Step 5 — Final Output

Emit ONLY the Final Output block. No narrative before or after — branch-derivation reasoning and intermediate results stay in your isolated context.

Success:

```
BRANCH — <created | switched | already-active>

Task: <task-id> — <title>
Branch: <branch-name>
Base: <base-source>
Tracking: <tracking>
Carry: <carry>
```

`<base-source>` is the provider-supplied token, one of: `<remote>/<base>` (created with the remote fetched), `<base>` (created locally, no remote), or `already existed` (`switched` or `already-active`).

`<tracking>` is the provider-supplied token, one of: `<remote>/<branch-name>` (push succeeded, or upstream already configured), `local-only (push failed)`, `local-only (no remote)`, or `local-only (no upstream)`. May carry an appended ` (index update failed)` parenthetical when Step 4 returned `INDEX — Error`.

`<carry>` reflects any uncommitted changes that were in progress before this operation ran, one of: `none` (nothing was carried — either the working tree was already clean, or the run was the `already-active` no-op, where no checkout occurs so nothing is ever captured, dirty tree or not), `applied` (they were carried across and reapplied cleanly — present, uncommitted, on the resulting branch), or a conflict outcome (the carry could not reapply cleanly onto the fresh base; nothing was lost, but finishing the reapply and resolving it is a manual follow-up — name it as "a preserved entry" and point at the follow-up, never the provider's literal conflict string, per item 5 above). This is always an additive line in the success block, never an error.

Error:

```
BRANCH — Error

Reason: <one sentence — what went wrong>
```

The block must be the very last thing output. Downstream callers grep for `BRANCH — created`/`switched`/`already-active` to detect success and `BRANCH — Error` to detect failure.
