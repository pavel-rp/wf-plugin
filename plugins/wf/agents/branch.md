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

Every operation this file invokes unconditionally — `workspace-root-resolve`, `current-branch-query`, `branch-create` — is a **`delivery`-surface** operation. This agent obtains the `delivery` surface **once**, up front, then dispatches every operation against it:

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

1. **Consume a forwarded record when present.** If the spawn message carried a forwarded run-scoped resolution record for the `delivery` surface (a parent boot — e.g. the `wf:commit` that nested this one — already resolved it via the resolver), use its `owner` and forwarded fragment `ref` directly — perform **no** provider *re-resolution* of your own (each op's body still comes from `resolve_content({ workspaceRoot, ... })`).
2. **Otherwise self-resolve once** as the top of your own chain by calling the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface: "delivery" })` — the typed query returns the run-scoped record `{ surface, owner, fragmentPath, state, candidates?, degradation }`. The resolver has already read the `## Capabilities` registry (honoring any project-configured `registryPath`), the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); you perform **no** registry / manifest / fragment / plugin-root read of your own. Obtain each op's body through the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in your own context to dispatch each op — never a raw `Read` of the path (the metadata queries return only paths/metadata; the body comes from `resolve_content({ workspaceRoot, ... })`). If the `wf-resolver` service is unavailable, return `BRANCH — Error` with reason "resolver runtime not loaded (restart Claude Code)" — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery). *(The former cwd-relative bootstrap read's known limitation — that it could not honor a non-default `registryPath` — is gone: the resolver honors it.)*
3. **Zero `delivery` owner** (the record's `state` is `unconfigured`/`unrecoverable`, whether self-resolved or forwarded). Reads (`workspace-root-resolve`, `current-branch-query`) fall back silently to the plain-directory / already-known-branch value; a write (`branch-create`) cannot proceed — see Step 3's no-delivery-provider path.

**The `tracker` surface is resolved lazily, not here.** Step 2 needs it only on its no-local-artifact path — the common artifacts-present path never touches the tracker, so this agent doesn't call the resolver for it on every invocation to serve a rare fallback. When Step 2 reaches that path, it resolves `tracker` there: consume a forwarded tracker record if the spawn message carried one (same rule as above), otherwise call `resolve_provider({ workspaceRoot, surface: "tracker" })`. A record whose `state` is `unconfigured` or `unrecoverable` falls straight through to the bare-id fallback — a read, so it stays silent local-only, no residual message, no capability term surfaces.

## Step 1 — Resolve config, workspace root, and task folder

1. Obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md`. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), return `BRANCH — Error` with reason "Run /wf:init first." If the `wf-resolver` service is unavailable, return `BRANCH — Error` with reason "resolver runtime not loaded (restart Claude Code)."
2. Take `{task-root}` from `coreConfig.taskRoot`. Never hardcode it.
3. **Resolve `{task-id}`** (the opaque task id — used for the task folder and the `Task:` line). When `<id>` is passed, use it verbatim. When inferring from the current branch, extract the first 3+-digit run from the resolved branch name (via `current-branch-query`) as a token, then resolve it against `{task-root}` — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token. **Exactly one match** — reuse that folder's full name as `{task-id}` verbatim (never reconstruct it from a prefix). **More than one match** — return `BRANCH — Error` with reason "Ambiguous id: the branch-inferred token `<token>` matches more than one task folder; pass the id explicitly." **Zero matches** — hold the bare token as `{task-id}`; this is not fatal (step 5 no longer treats a missing task folder as an error — Step 2 resolves a title without one). (No numeric token at all was already handled by the Inputs section's no-id error.) Also derive **`{numeric-id}`** — the first 3+-digit run of `{task-id}` — used **only** for deriving the branch name in Step 2, never for the folder or the `Task:` line. Step 3's already-active check matches on `{task-id}` alone, so `{numeric-id}` plays no part in any match this agent performs.
4. Take the absolute workspace root from the `resolve_config({ workspaceRoot, ... })` `workspaceRoot` value (its already-normalized `workspace-root-resolve` result). With no delivery provider registered this is the plain-directory resolution (not an error). With a provider registered but no working tree to resolve, return `BRANCH — Error` with reason "Not inside a resolvable workspace."
5. Compute task folder. If `{task-root}` is absolute, use it as-is; otherwise join with the resolved workspace root: `<workspace-root>/{task-root}/{task-id}/`. Hold the result as `<task-folder-abs>` (always absolute — the task folder Step 4's inline index update resolves). **A missing task folder is not fatal** — this agent works from any state. Hold whether it exists as `<task-folder-exists>`; Step 2 resolves a title with or without it, and Step 4's index update already tolerates a nonexistent target non-fatally (its own established behavior, unchanged here).
6. `{task-id}` is used in the `Task:` line of the final block.

## Step 2 — Resolve branch name

**Works from any state — a missing task folder or missing artifacts never blocks this step; the chain below always terminates in a usable title source.**

1. Read task metadata, first available source wins:
   - `02_plan.md` — the `**Type:**` markdown-bold metadata field (accept legacy plain `Type:` too) and the title from the H1 heading
   - `01_spec.md` — the `**Type:**` markdown-bold metadata field (accept legacy plain `Type:` too) and the title from metadata or heading
   - `00_reqs.md` — synthesize a short title (5-8 words max) from the work item description
   - **No local artifact** (`<task-folder-exists>` is false, or the folder exists but holds none of the three files above) — resolve title/type without blocking, in the order that costs least:
     - **Resolve the `tracker` surface** (lazily, per "Provider resolution" above — a forwarded record if one arrived, otherwise a `resolve_provider({ workspaceRoot, surface: "tracker" })` call). If a `tracker` owner resolves (`state: ok`): invoke `get({task-id})` — a single fetch, never `list_children` or any other multi-item enumeration; this is the tracker's one general-purpose record fetch (not a bespoke title-only query — no such operation exists in the contract today), so it may return more than the title (description, relations) as a side effect of being one call rather than several. Use the returned title as the title source; if the returned fields carry a work-item-type or label, use it exactly as a `**Type:**` field would be used in step 2 below — otherwise there's no type signal and step 2 falls through to its `feature/` default. A **mid-run failure** (tracker configured but the `get` call errors) warns once per the contract's degradation rules, then falls through to the next bullet — never blocks.
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

**First, the already-active name substitution — before deriving any name.** `branch-create` matches only by *exact* name (see the accepted residual at the end of this step), so a caller already sitting on a valid task branch whose name this agent would not itself have derived — a tracker-prefixed or externally-suggested form such as `feat/{task-id}-…` — would otherwise fall through to Step 2's derivation and create a redundant second branch. Resolve the current branch via `current-branch-query`: **if it contains `/{task-id}-`, compared case-insensitively**, the caller is already on the task branch. Take the resolved current branch name **verbatim** as `<branch-name>` in place of Step 2's derivation, then continue into the normal `branch-create(<branch-name>)` invocation below. Only Step 2's **name derivation** (its steps 2–3) is replaced — its **title/type resolution** (step 1) still runs, because the Final Output block's `Task:` line needs `<title>` either way. On the artifacts-present path that costs nothing; on the no-local-artifact path it is the one case where the substitution still reaches the tracker.

This is a **name substitution, not an early return** — nothing is synthesized here. `branch-create`'s own exact-name match on that name is what legitimately produces `already-active`, `Base: already existed`, the provider-reported `<tracking>`, and `Carry: none`; this agent never fabricates a tracking token (the delivery contract exposes no tracking read of its own), and routing through the normal path keeps Step 4's index update on the flow. The result is that an unattended `ship`/`fleet` run on such a branch neither mints a spurious branch nor leaves a later pull request pointed at a head carrying none of the task's commits.

The match uses `/{task-id}-` **only**, deliberately narrower than the shared branch gate's two-arm predicate. Step 2 drops the tracker prefix when it derives a name (`<prefix>{numeric-id}-<title>`), so a bare-numeric arm could not distinguish two tasks sharing a numeric run — `WF-479` and `NEU-479` both derive `feature/479-…` — and would hand another task's branch back as this one's, with no collision guard behind it (see the second accepted residual below). `{task-id}` normally carries the prefix, which is what makes it collision-proof — but **not always**: Step 1's zero-folder-match path holds the bare numeric token as `{task-id}`, collapsing it onto `{numeric-id}` and reopening exactly that collision. So **gate the substitution on `{task-id}` differing from `{numeric-id}`**; when the two are equal, skip it and fall through to Step 2's derivation as before. Nothing is lost by either the narrowing or the gate: a bare-numeric branch this agent itself minted is already matched exactly by `branch-create`. The lower-casing is for comparison only — the emitted `Task:` line and `<branch-name>` keep their verbatim form. On a detached HEAD, or when no delivery provider is readable, skip this check and fall through to the existing handling below.

Otherwise derive `<branch-name>` from Step 2 (unchanged, tracker-side logic — out of scope for this rewrite), then invoke `branch-create(<branch-name>)` against the resolved `delivery` record (obtain its body via `resolve_content({ workspaceRoot, ... })` and follow it in-context).

1. **No readable delivery provider — the two-mode residual diagnosis.** A write cannot proceed when the `delivery` record's `state` is `unconfigured` or `unrecoverable` — whether self-resolved via `resolve_provider({ workspaceRoot, surface: "delivery" })` or carried on a consumed forwarded record. Return `BRANCH — Error` immediately and attempt no delivery operation; a delivery write surfaces the residual **loudly** (it blocks). Split the reason on the record's `state` (the resolver already performed the residual diagnosis of `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal", `<S>` = `delivery`):
   - **(a) `state: unconfigured`** — no capability owns `delivery`: the plain message "No delivery provider is registered. Register a capability that owns the `delivery` surface (e.g. install and run `/wf-git:init`)."
   - **(b) `state: unrecoverable`** — one or more registered capabilities have an unrecoverable manifest (recorded root dangled and the self-heal recovered nothing), surfaced in the record's `candidates`: name those pack(s) as hedged **candidates** — "registered pack(s) [X, …] have an unrecoverable manifest at that path; if one is your `delivery` provider, fix its stale root / re-run its init." List every pack in `candidates`; **never** assert a candidate owns `delivery`, and **never** tell the user to register a provider they already have.
   A consumed forwarded record already carries the `state` (and, for (b), the `candidates`), so the boot emits the identical diagnosis without any resolver call.
2. **Invoke `branch-create(<branch-name>)`.** This single operation absorbs the detached-HEAD guard, the dirty-tree capture-and-reapply (no longer a refusal — see item 3), the exact-name existing-branch check, base determination, remote detection and fetch, branch creation/switch, and upstream tracking — all internal to the delivery provider's own implementation.
3. **Detached HEAD** surfaces as an error result from `branch-create` itself — propagate its reason verbatim into `BRANCH — Error`. A **dirty working tree** is no longer an error path: `branch-create` carries it automatically across the checkout and, when the carry cannot reapply cleanly onto the fresh base, still completes and returns a distinct non-error outcome naming a preserved entry that needs a manual follow-up to finish reapplying and resolve.
4. **Base-branch fetch failure** — a remote exists but the provider's fetch of the latest base fails — surfaces as an error result from `branch-create`; propagate its reason. With no remote, `branch-create` silently branches from the local base instead (no error).
5. **Map the result** onto the Final Output block (Step 5). `<state>` / `<base-source>` / `<tracking>` are provider-supplied tokens carried through **verbatim** — core never re-derives or assumes a remote name: `<state>` (`created` | `switched` | `already-active`), `<base-source>` (`<remote>/<base>` | `<base>` | `already existed`), `<tracking>` (`<remote>/<branch-name>` | `local-only (push failed)` | `local-only (no remote)` | `local-only (no upstream)`). `<carry>` (`none` | `applied` | a conflict outcome) is the one exception to verbatim passthrough: its conflict value, as the provider defines it, names a literal git command — this file (like every core skill/agent body) stays free of literal git/gh command strings (the OUT-1 gate enforces this across `plugins/wf/skills/` and `plugins/wf/agents/`), so core rewrites only that value's phrasing to name the recoverable follow-up abstractly (e.g. "a preserved entry — a manual follow-up is needed to finish reapplying and resolve it") before it reaches the Final Output block, never passing the provider's literal string through.

**Two v1 safety nets have no equivalent operation and are intentionally dropped** — not a fresh gap discovered here, already accepted at planning time:

- The ID-glob existing-branch search for a branch whose *title* drifted between two invocations — `branch-create` matches only by exact name. Accepted because the branch name is derived deterministically from the same static plan/spec source every time (Step 2), so no title drift occurs in practice. The separate case of an *already-checked-out* branch whose whole shape this agent would not derive is covered without a search: the name substitution at the top of this step hands that branch's own name to `branch-create`, so its exact-name match resolves it.
- The branch-name-collision-with-a-different-task numeric-suffix guard — no operation covers this rare case. If a real collision surfaces in practice it needs either a contract change or a core-side pre-check before invoking `branch-create` — it is not silently invented here. This unguarded collision is why the substitution above matches on `/{task-id}-` only: matching a bare numeric run would walk straight into it.

## Step 4 — Update the index

After a successful path through Step 3 (`created`, `switched`, or `already-active`), catalogue the branch by invoking `/wf:index {task-id} branch "<branch-name>"` through the **Skill** tool. The wrapper owns the fixed `index` routing decision and performs the read-modify-write of `index.md` inline in this agent's own context; never dispatch `wf:index` directly. Pass the resolved `{task-id}` (Step 1), the literal slot `branch`, and the resolved `<branch-name>` as the summary.

If the wrapper returns `INDEX — Error`, do NOT fail the branch operation — the branch was created/switched successfully and that's the primary contract. Append the index failure as a parenthetical to `<tracking>` (e.g., `<remote>/<branch-name> (index update failed)`) but still emit the `BRANCH — <state>` success block.

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
