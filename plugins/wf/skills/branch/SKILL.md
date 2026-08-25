---
name: branch
description: Creates and switches to a dedicated branch for a task, deriving the branch name (feature/<id>-…, fix/<id>-…, chore/<id>-…, etc.) from the task's plan or spec — or, when neither exists yet, a single tracker lookup or the bare task id — and setting up remote tracking through the active delivery provider. Works from any state; never blocks on a missing task folder. Thin slash-command wrapper — the full procedure lives in the wf:branch subagent (config resolution, branch derivation, delivery-provider dispatch, index update all happen there). Use directly via /wf:branch <id> for ad-hoc invocation, OR invoke the Task tool with subagent_type wf:branch from another wf:* skill that needs a branch gate (required when called from another skill — bypasses the slash-command's caller-side cost).
allowed-tools: [Task, Bash]
---

# /wf:branch — Task branch from a plan or spec

User-facing slash command for creating and switching to a task branch. The implementation lives entirely in the `wf:branch` subagent (`agents/branch.md`); this skill body is a thin entry point that exists only for direct user invocation.

**Other wf:* skills that need a branch gate MUST invoke the **Task** tool with `subagent_type: wf:branch` — never the `/wf:branch` slash command.** Going through the slash command would load this SKILL.md into the caller's context, which is exactly what the subagent pattern is designed to avoid. The subagent is self-sufficient: it resolves config, derives the branch name, invokes the delivery provider to create or switch the branch, and updates `index.md` (via an inline `wf:index` write) all in its own isolated context.

---

## Command Syntax

```
/wf:branch [<id>]
```

| Argument    | Required | Description                                                                                                          |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `<id>`      | NO       | Task id — the opaque shape the active tracker capability produced, or the local `T<NNN>` scheme when none is registered. Falls back to inferring from the current branch. |

---

## Procedure

Before dispatch, run `pwd -P` and use that absolute current session directory as `workspaceRoot`. Call the bundled `wf-resolver` MCP tool `resolve_routing` immediately before delegation with `role: "branch"`, `unitIds: ["branch:single"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "elevated", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`; the elevated risk reflects that this unit may create, switch, or publish a branch. Also pass any selector availability, host enforcement, or actual-model facts the runtime already exposes, and omit facts it does not expose rather than probing. Emit the decision's compact metadata. If `status: stop` or `diagnostic` is non-null, emit `BRANCH — Error` with the routing diagnostic and do not dispatch. Otherwise obey `executionShape` exactly per `invocation-runtime.ops.md` §"Resolver call root"; this evidence selects `isolated`, so invoke one **Task**. Pass the returned model selector only when `model.value` is non-null; `effort.value: null` means preserve inherited effort.

For the selected `isolated` shape, invoke the **Task** tool with `subagent_type: wf:branch`, passing:

- `id` — the user-supplied id, or omit to let the subagent infer from the current branch.

This is a **direct invocation** — the top of its own delivery chain — so **no forwarded resolution record is passed**; the `wf:branch` subagent self-resolves the `delivery` surface once via the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query. When another `wf:*` skill invokes `wf:branch` via the **Task** tool as part of a larger run (e.g. `wf:commit`'s branch gate), that parent forwards its resolved `delivery` record and the subagent consumes it instead of re-resolving.

Emit the subagent's Final Output block (`BRANCH — created`, `BRANCH — switched`, `BRANCH — already-active`, or `BRANCH — Error`) verbatim. **No narrative before or after the block** — the subagent already owns the user-facing output.

---

## Edge Cases

The subagent owns every stop condition; each surfaces through the Final Output block below. It returns:

- **Already on the task branch** — `BRANCH — already-active`; no new branch is created. The subagent recognises this two ways: the delivery provider's exact-name match on a name it derived itself, and — for a branch whose shape it would not have derived, such as a tracker-prefixed `feat/{task-id}-…` — a current-branch check on `/{task-id}-`, compared case-insensitively and gated on `{task-id}` differing from `{numeric-id}` (when the two are equal the id is a bare numeric token, so the check is skipped rather than risking a collision). That check is deliberately narrower than the shared branch gate's two-arm predicate: a bare-numeric arm cannot distinguish two tasks sharing a numeric run, so it would risk handing back another task's branch.
- **Branch already exists for this task** — `BRANCH — switched`; checks out the existing branch rather than recreating it.
- **Dirty working tree** — uncommitted changes do not block the switch: the delivery provider captures and reapplies them. Clean reapply returns success with `Carry: applied`; a conflicting reapply still returns branch success with a preserved entry and an explicit manual follow-up to finish reapplying and resolve it.
- **Detached HEAD** — `BRANCH — Error`; branches cannot be created from a detached HEAD.
- **Unresolvable task ID** — `BRANCH — Error`; no ID was passed and none could be inferred from the current branch.
- **Missing config** — `BRANCH — Error`; the resolver reports the project is uninitialized (absent `_local/config.md` — run `/wf:init` first).
- **Missing task folder or plan/spec/reqs artifacts** — not an error; the subagent works from any state. It falls back to a single tracker `get` (when a tracker is registered) or, failing that, the bare task id, to derive the branch name — never blocking on `/wf:spec` having run first.
- **No resolvable workspace root** — `BRANCH — Error`; with a delivery provider active, `workspace-root-resolve` found no working tree to resolve.
- **Base-branch fetch failure** — `BRANCH — Error` when the delivery provider's remote exists but fetching the latest base fails; with no remote configured it silently branches from the local base instead.
- **Index update failure** — non-fatal; the branch still succeeds and `<tracking>` carries an appended ` (index update failed)`.
- **No readable delivery provider (two-mode diagnosis)** — `BRANCH — Error`; no delivery operation of any kind is attempted. The subagent splits the reason on the `resolve_provider({ workspaceRoot, surface: "delivery" })` record's `state`: **(a) `state: unconfigured`** (no capability owns `delivery`) — states plainly that no delivery provider is registered and names the remedy (register a capability that owns the `delivery` surface, e.g. install and run `/wf-git:init`); **(b) `state: unrecoverable`** (the registered `delivery` owner's manifest can't be read — its recorded root dangled and the install-manifest self-heal recovered nothing) — names the record's `owner`, surfaces its optional `diagnostics`, and instructs the user to fix that stale root / re-run its init, never telling them to register a provider they already have.

---

## Final Output (emitted by the subagent)

Success:

```
BRANCH — <created | switched | already-active>

Task: {task-id} — <title>
Branch: <branch-name>
Base: <base-source>
Tracking: <tracking>
Carry: <none | applied | preserved entry — manual follow-up required>
```

`<base-source>` variants (provider-supplied tokens, emitted verbatim): `<remote>/<base>` (created with the remote fetched), `<base>` (created locally, no remote), `already existed` (switched-to-existing or already-active).

`<tracking>` variants (provider-supplied tokens, emitted verbatim): `<remote>/<branch-name>` (push succeeded, or upstream already configured), `local-only (push failed)`, `local-only (no remote)`, `local-only (no upstream)`. May carry an appended ` (index update failed)` when the inline `/wf:index` write returned an error.

`<carry>` is forwarded from the successful branch result: `none`, `applied`, or a sanitized conflict outcome naming a preserved entry and the manual follow-up required to finish reapplying and resolve it. A conflict carry remains `BRANCH — created`/`switched`, never `BRANCH — Error`; callers must inspect `Carry:` before continuing source-mutating work.

Error:

```
BRANCH — Error

Reason: <one sentence — what went wrong>
```

**The block must always be the very last thing output to chat.** Downstream skills grep for `BRANCH — created`/`BRANCH — switched`/`BRANCH — already-active` to detect success and `BRANCH — Error` to detect failure.
