---
name: commit
description: Commits the current task changes with a terse, auto-authored message — the first commit on the branch gets a subject of the id then the task name, every later commit the id then a concise summary, followed by a bulleted what-changed body. Diff reading and message authoring happen inside an isolated subagent so the main agent's context never sees the diff. Optional --push (off by default). Use to commit work on a task branch — between implementation steps, once at the end, or whenever; safe to re-run (no-ops when there is nothing to commit).
allowed-tools: [Task]
---

# /wf:commit — Brief commit, authored in isolation

User-facing slash command for committing the current task changes with a concise, auto-generated message. The implementation lives entirely in the `wf:commit` subagent (`agents/commit.md`); this skill body is a thin entry point that exists only for direct user invocation.

**Other wf:* skills that need to commit MUST invoke the **Task** tool with `subagent_type: wf:commit` — never the `/wf:commit` slash command.** Going through the slash command would load this SKILL.md into the caller's context, which is exactly what the subagent pattern avoids. The subagent is self-sufficient: it resolves config, gates the branch, reads the diff, authors the message, commits through the active delivery provider, optionally pushes, and updates `index.md` — all in its own isolated context, so the (potentially large) diff never reaches the caller.

---

## Command Syntax

```
/wf:commit [<id>] [--push] [--staged]
```

| Argument    | Required | Description                                                                                                                                          |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<id>`      | NO       | Task id — the opaque shape the active tracker capability produced, or the local `T<NNN>` scheme when none is registered. Falls back to inferring from the current branch. |
| `--push`    | NO       | Push after committing. Off by default. When set, a push is attempted even if there was nothing new to commit (syncs any unpushed commits).          |
| `--staged`  | NO       | Commit only what is already staged. By default the delivery provider's `commit` operation stages all outstanding changes first (`_local/` is excluded from version control, so artifacts never leak in). |

---

## Procedure

Invoke the **Task** tool with `subagent_type: wf:commit`, passing:

- `id` — the user-supplied id, or omit to let the subagent infer from the current branch.
- `push` — `true` if `--push` was passed, else `false`.
- `staged` — `true` if `--staged` was passed, else `false`.

This is a **direct invocation** — the top of its own delivery chain — so **no forwarded resolution record is passed**; the `wf:commit` subagent self-resolves the `delivery` surface once and forwards it to any `wf:branch` it nests (`invocation-runtime.ops.md` §"Run-scoped provider forwarding"). When another `wf:*` skill invokes `wf:commit` via the **Task** tool as part of a larger run, that parent forwards the record instead and the subagent consumes it.

Emit the subagent's Final Output block (`COMMIT — committed`, `COMMIT — nothing-to-commit`, or `COMMIT — Error`) verbatim. **No narrative before or after the block** — the subagent owns the user-facing output; the diff and message-authoring reasoning stay in its isolated context.

---

## Edge Cases

The subagent owns every stop condition; each surfaces through the Final Output block below. It returns:

- **Nothing staged** — `COMMIT — nothing-to-commit`; the staged set is empty (the default mode stages everything via the delivery provider first, so this means a clean tree; under `--staged` it means nothing is staged, even if the working tree has unstaged changes). A no-op commit path — a `--push` still syncs any unpushed commits.
- **Not on the task branch** — the subagent invokes its branch gate (`wf:branch`); if that gate fails (e.g. a dirty tree blocks the switch), it returns `COMMIT — Error` with the branch reason. To commit into a task branch you must already be on it.
- **Detached HEAD** — `COMMIT — Error`; task work cannot be committed from a detached HEAD.
- **Unresolvable task ID** — `COMMIT — Error`; no ID was passed and none could be inferred from the current branch.
- **Missing config / no resolvable workspace** — `COMMIT — Error`; `_local/config.md` is absent (run `/wf:init` first), or `workspace-root-resolve` failed with a delivery provider active (a genuine environment error — no working tree found).
- **Commit failure** — `COMMIT — Error` with the delivery provider's reason; the `commit` operation returning a failure aborts.
- **Push failure under `--push`** — non-fatal to the commit; the `Push:` line reads `failed (<reason>)` while the commit itself stays intact.
- **Index update failure** — non-fatal; the commit still succeeds and ` (index update failed)` is appended to the `Push:` line.
- **No readable delivery provider (two-mode diagnosis)** — `COMMIT — Error`; no delivery operation is attempted. The subagent splits the reason by cause: **(a) genuinely unconfigured** (every registered manifest is readable and none is scoped to `delivery`) — states plainly that no delivery provider is registered and names the remedy (register a capability that owns the `delivery` surface, e.g. install and run `/wf-git:init`); **(b) registered-but-unrecoverable** (a registered capability's manifest can't be read — its recorded root dangled and the install-manifest self-heal recovered nothing) — names the unreadable-manifest pack(s) as hedged candidates ("if one is your `delivery` provider, fix its stale root / re-run its init"), never asserting one owns the surface and never telling you to register a provider you already have.

---

## Final Output (emitted by the subagent)

Success:

```
COMMIT — <committed | nothing-to-commit>

Task: {task-id} — <title or n/a>
Subject: <id>: <subject>          (omitted when nothing-to-commit)
Files: <n> changed (+<a> -<d>)    (omitted when nothing-to-commit)
Push: <pushed (<remote>/<remote-branch>) | up-to-date (<remote>/<remote-branch>) | not-pushed | failed (<reason>)>
Next: /wf:pr <id>
```

Error:

```
COMMIT — Error

Reason: <one sentence — what went wrong>
```

**The block must always be the very last thing output to chat.** A caller (e.g. `wf:pr`) greps `COMMIT — committed`/`COMMIT — nothing-to-commit` to proceed and `COMMIT — Error` to abort, then reads the `Push:` line — a value starting with `failed` is fatal for any caller that needs a pushed branch.
