---
name: branch
description: Creates and switches to a dedicated branch for a task, deriving the branch name (feature/<id>-…, fix/<id>-…, chore/<id>-…, etc.) from the task's plan or spec and setting up remote tracking through the active delivery provider. Thin slash-command wrapper — the full procedure lives in the wf:branch subagent (config resolution, branch derivation, delivery-provider dispatch, index update all happen there). Use directly via /wf:branch <id> for ad-hoc invocation, OR invoke the Task tool with subagent_type wf:branch from another wf:* skill that needs a branch gate (required when called from another skill — bypasses the slash-command's caller-side cost).
allowed-tools: [Task]
---

# /wf:branch — Task branch from a plan or spec

User-facing slash command for creating and switching to a task branch. The implementation lives entirely in the `wf:branch` subagent (`agents/branch.md`); this skill body is a thin entry point that exists only for direct user invocation.

**Other wf:* skills that need a branch gate MUST invoke the **Task** tool with `subagent_type: wf:branch` — never the `/wf:branch` slash command.** Going through the slash command would load this SKILL.md into the caller's context, which is exactly what the subagent pattern is designed to avoid. The subagent is self-sufficient: it resolves config, derives the branch name, invokes the delivery provider to create or switch the branch, and updates `index.md` (via a nested **Task** call to `wf:index`) all in its own isolated context.

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

Invoke the **Task** tool with `subagent_type: wf:branch`, passing:

- `id` — the user-supplied id, or omit to let the subagent infer from the current branch.

This is a **direct invocation** — the top of its own delivery chain — so **no forwarded resolution record is passed**; the `wf:branch` subagent self-resolves the `delivery` surface once (`invocation-runtime.ops.md` §"Run-scoped provider forwarding"). When another `wf:*` skill invokes `wf:branch` via the **Task** tool as part of a larger run (e.g. `wf:commit`'s branch gate), that parent forwards its resolved `delivery` record and the subagent consumes it instead of re-resolving.

Emit the subagent's Final Output block (`BRANCH — created`, `BRANCH — switched`, `BRANCH — already-active`, or `BRANCH — Error`) verbatim. **No narrative before or after the block** — the subagent already owns the user-facing output.

---

## Edge Cases

The subagent owns every stop condition; each surfaces through the Final Output block below. It returns:

- **Already on the task branch** — `BRANCH — already-active`; no new branch is created (the current branch already carries `/{id}-`).
- **Branch already exists for this task** — `BRANCH — switched`; checks out the existing branch rather than recreating it.
- **Dirty working tree** — `BRANCH — Error`; uncommitted changes block the base switch. Commit or stash first.
- **Detached HEAD** — `BRANCH — Error`; branches cannot be created from a detached HEAD.
- **Unresolvable task ID** — `BRANCH — Error`; no ID was passed and none could be inferred from the current branch.
- **Missing config / task folder / plan sources** — `BRANCH — Error`; `_local/config.md`, the task folder, or a plan/spec/reqs file is absent (run `/wf:init` / `/wf:spec` first).
- **No resolvable workspace root** — `BRANCH — Error`; with a delivery provider active, `workspace-root-resolve` found no working tree to resolve.
- **Base-branch fetch failure** — `BRANCH — Error` when the delivery provider's remote exists but fetching the latest base fails; with no remote configured it silently branches from the local base instead.
- **Index update failure** — non-fatal; the branch still succeeds and `<tracking>` carries an appended ` (index update failed)`.
- **No readable delivery provider (two-mode diagnosis)** — `BRANCH — Error`; no delivery operation of any kind is attempted. The subagent splits the reason by cause: **(a) genuinely unconfigured** (every registered manifest is readable and none is scoped to `delivery`) — states plainly that no delivery provider is registered and names the remedy (register a capability that owns the `delivery` surface, e.g. install and run `/wf-git:init`); **(b) registered-but-unrecoverable** (a registered capability's manifest can't be read — its recorded root dangled and the install-manifest self-heal recovered nothing) — names the unreadable-manifest pack(s) as hedged candidates ("if one is your `delivery` provider, fix its stale root / re-run its init"), never asserting one owns the surface and never telling you to register a provider you already have.

---

## Final Output (emitted by the subagent)

Success:

```
BRANCH — <created | switched | already-active>

Task: {task-id} — <title>
Branch: <branch-name>
Base: <base-source>
Tracking: <tracking>
```

`<base-source>` variants: `origin/<base>` (created with remote fetched), `<base>` (created locally, no remote), `already existed` (switched-to-existing or already-active).

`<tracking>` variants: `origin/<branch-name>` (push succeeded, or upstream already configured), `local-only (push failed)`, `local-only (no remote)`, `local-only (no upstream)`. May carry an appended ` (index update failed)` when the nested wf:index call returned an error.

Error:

```
BRANCH — Error

Reason: <one sentence — what went wrong>
```

**The block must always be the very last thing output to chat.** Downstream skills grep for `BRANCH — created`/`BRANCH — switched`/`BRANCH — already-active` to detect success and `BRANCH — Error` to detect failure.
