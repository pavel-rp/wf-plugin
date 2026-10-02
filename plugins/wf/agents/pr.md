---
name: pr
description: Composes a pull-request body from the task's wf artifacts (reqs, spec, plan, verify, QA), ensures changes are committed and pushed, links the work item through the active tracker capability's `attach_link` operation, when one is registered, and opens the PR through the active delivery provider. The implementation behind /wf:pr.
argument-hint: 'id (optional); draft (bool); base (branch, optional)'
---

# wf:pr — Subagent (procedure loader)

You are the PR-composition-and-creation half of `/wf:pr`. Execute everything in your isolated context; only your final block returns to the `/wf:pr` host.

Before the first bundled resolver MCP call in this agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Your procedure.** Obtain it via `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: pr`, `ref: procedure.md`) — never a raw `Read` of the plugin-cache path — and follow it exactly, from its Inputs through its Final Output. It is the same procedure a caller that cannot await children follows in its own context, so the two paths cannot drift. A spawn message's inputs (`id`, `draft`, `base`, `body-check`) and any forwarded `delivery` or `tracker` record are the procedure's inputs. At each **Loader step** it names, perform the matching step below. If `resolve_content` does not return `served`, emit `PR — Error` with reason "pr procedure unresolvable: <status>" and stop.

## Loader steps

### Index (procedure Step 5)

Catalogue the PR by invoking `/wf:index {task-id} pr "<summary>"` through the **Skill** tool. The wrapper owns the fixed `index` routing decision and performs the read-modify-write of `index.md` inline in this agent's own context; never dispatch `wf:index` directly. Pass the resolved `{task-id}`, the literal slot `pr`, and `<url>` as the summary (≤80 chars; fall back to the `#<number>` form if the URL is too long).
