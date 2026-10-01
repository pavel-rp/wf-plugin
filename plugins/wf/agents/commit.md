---
name: commit
description: Authors a terse conventional-style commit message from the pending change content in an isolated context and commits through the active delivery provider (optionally pushing), keeping the full diff out of the caller's transcript. The implementation behind /wf:commit.
argument-hint: '<id> (optional); push (bool); staged (bool)'
---

# wf:commit — Subagent (procedure loader)

You are the implementation of `/wf:commit`. Execute everything in your isolated context so the caller (a user-typed slash command, or another wf:* skill that invoked you via the **Task** tool) never sees the diff or the message-authoring reasoning.

Before the first bundled resolver MCP call in this agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Your procedure.** Obtain it via `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: commit`, `ref: procedure.md`) — never a raw `Read` of the plugin-cache path — and follow it exactly, from its Inputs through its Final Output. It is the same procedure a caller that cannot await children follows in its own context, so the two paths cannot drift. A spawn message's inputs (`id`, `push`, `staged`) and any forwarded `delivery` record are the procedure's inputs. At each **Loader step** it names, perform the matching step below. If `resolve_content` does not return `served`, emit `COMMIT — Error` with reason "commit procedure unresolvable: <status>" and stop.

## Loader steps

### Branch (procedure Step 2, item 3)

Call `resolve_routing` immediately before dispatch with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "branch"`, `unitIds: ["commit:branch"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "elevated", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit its compact metadata. If `status: stop` or `diagnostic` is non-null, return `COMMIT — Error` with the routing diagnostic and do not dispatch. Otherwise obey the returned `executionShape` per `invocation-runtime.ops.md` §"Resolver call root"; this evidence selects `isolated`, so invoke one **Task** with `subagent_type: wf:branch`, passing the task id `{task-id}` **and the forwarded `delivery` resolution record** from the procedure's Provider-resolution section (the optional spawn extension — `invocation-runtime.ops.md` §"Run-scoped provider forwarding"). Pass a non-null model selector and preserve inherited effort when null. Hand its block back to the procedure, which applies it:
   - On a successful branch block whose `Carry:` names a preserved entry/manual follow-up, the procedure returns `COMMIT — Error` and preserves the branch success.
   - On `BRANCH — Error` it returns `COMMIT — Error` with the subagent's reason. Ordinary dirty work never produces this result: the branch operation captures and reapplies it.

### Index (procedure Step 6)

Catalogue the commit by invoking `/wf:index {task-id} commit "<summary>"` through the **Skill** tool. The wrapper owns the fixed `index` routing decision and performs the read-modify-write of `index.md` inline in this agent's own context; never dispatch `wf:index` directly. Pass the resolved `{task-id}`, the literal slot `commit`, and the summary the procedure names.
