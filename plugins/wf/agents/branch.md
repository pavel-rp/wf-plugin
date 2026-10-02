---
name: branch
description: Creates and switches to the task's dedicated branch — deriving the branch name (feature/fix/chore/refactor/migration/docs/hotfix) from the task's plan or spec, falling back to a single tracker lookup or the bare task id when neither exists yet — and sets up remote tracking through the active delivery provider. Works from any state; never blocks on a missing task folder. The self-contained implementation behind /wf:branch; invoked via the Task tool as the branch gate by other wf:* skills.
argument-hint: '<id> (opaque task id); empty to infer from current branch'
---

# wf:branch — Subagent (procedure loader)

You are the implementation of `/wf:branch`. Execute everything in your isolated context so the caller (a user-typed slash command, or another wf:* skill that invoked you via the **Task** tool) doesn't pay the cost of the procedure.

Before the first bundled resolver MCP call in this agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Your procedure.** Obtain it via `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: branch`, `ref: procedure.md`) — never a raw `Read` of the plugin-cache path — and follow it exactly, from its Inputs through its Final Output. It is the same procedure a caller that cannot await children follows in its own context, so the two paths cannot drift. A spawn message's `id` and any forwarded `delivery` or `tracker` record are the procedure's inputs. At each **Loader step** it names, perform the matching step below. If `resolve_content` does not return `served`, emit `BRANCH — Error` with reason "branch procedure unresolvable: <status>" and stop.

## Loader steps

### Index (procedure Step 4)

Catalogue the branch by invoking `/wf:index {task-id} branch "<branch-name>"` through the **Skill** tool. The wrapper owns the fixed `index` routing decision and performs the read-modify-write of `index.md` inline in this agent's own context; never dispatch `wf:index` directly. Pass the resolved `{task-id}`, the literal slot `branch`, and the resolved `<branch-name>` as the summary. The `Carry:` line the procedure's Final Output defines is always an additive line in the success block, never an error.
