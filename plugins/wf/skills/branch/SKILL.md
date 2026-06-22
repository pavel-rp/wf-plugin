---
name: branch
description: Creates and switches to a git branch for an ADO task, deriving the branch name (feature/<id>-…, fix/<id>-…, chore/<id>-…, etc.) from the task's plan or spec and setting up remote tracking. Thin slash-command wrapper — the full procedure lives in the wf:branch subagent (config resolution, branch derivation, git execution, index update all happen there). Use directly via /wf:branch <id> for ad-hoc invocation, OR invoke the Task tool with subagent_type wf:branch from another wf:* skill that needs a branch gate (required when called from another skill — bypasses the slash-command's caller-side cost).
allowed-tools: [Bash]
---

# /wf:branch — Task branch from a plan or spec

User-facing slash command for creating and switching to a task branch. The implementation lives entirely in the `wf:branch` subagent (`agents/branch.md`); this skill body is a thin entry point that exists only for direct user invocation.

**Other wf:* skills that need a branch gate MUST invoke the **Task** tool with `subagent_type: wf:branch` — never the `/wf:branch` slash command.** Going through the slash command would load this SKILL.md into the caller's context, which is exactly what the subagent pattern is designed to avoid. The subagent is self-sufficient: it resolves config, derives the branch name, runs git, and updates `index.md` (via a nested **Task** call to `wf:index`) all in its own isolated context.

---

## Command Syntax

```
/wf:branch [<ado-id>]
```

| Argument    | Required | Description                                                                                                          |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `<ado-id>`  | NO       | ADO work item ID — numeric (`6396`) or prefixed (`ADO-6396`). Falls back to inferring from the current git branch.   |

---

## Procedure

Invoke the **Task** tool with `subagent_type: wf:branch`, passing:

- `ado-id` — the user-supplied ID, or omit to let the subagent infer from the current branch.

Emit the subagent's Final Output block (`BRANCH — created`, `BRANCH — switched`, `BRANCH — already-active`, or `BRANCH — Error`) verbatim. **No narrative before or after the block** — the subagent already owns the user-facing output.

---

## Final Output (emitted by the subagent)

Success:

```
BRANCH — <created | switched | already-active>

Task: {wi-prefix}-{id} — <title>
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
