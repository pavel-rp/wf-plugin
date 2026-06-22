---
name: commit
description: Commits the current task changes with a terse, auto-authored message — the first commit on the branch gets subject `<id>: <task name>`, every later commit `<id>: <concise summary>`, followed by a bulleted what-changed body. Diff reading and message authoring happen inside an isolated subagent so the main agent's context never sees the diff. Optional --push (off by default). Use to commit work on an ADO task branch — between implementation steps, once at the end, or whenever; safe to re-run (no-ops when there is nothing to commit).
allowed-tools: [Bash]
---

# /wf:commit — Brief commit, authored in isolation

User-facing slash command for committing the current task changes with a concise, auto-generated message. The implementation lives entirely in the `wf:commit` subagent (`agents/commit.md`); this skill body is a thin entry point that exists only for direct user invocation.

**Other wf:* skills that need to commit MUST invoke the **Task** tool with `subagent_type: wf:commit` — never the `/wf:commit` slash command.** Going through the slash command would load this SKILL.md into the caller's context, which is exactly what the subagent pattern avoids. The subagent is self-sufficient: it resolves config, gates the branch, reads the diff, authors the message, commits, optionally pushes, and updates `index.md` — all in its own isolated context, so the (potentially large) diff never reaches the caller.

---

## Command Syntax

```
/wf:commit [<ado-id>] [--push] [--staged]
```

| Argument    | Required | Description                                                                                                                                          |
| ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<ado-id>`  | NO       | ADO work item ID — numeric (`6396`) or prefixed (`ADO-6396`). Falls back to inferring from the current git branch.                                  |
| `--push`    | NO       | Push after committing. Off by default. When set, a push is attempted even if there was nothing new to commit (syncs any unpushed commits).          |
| `--staged`  | NO       | Commit only what is already staged. By default the skill stages all changes (`git add -A`; `_local/` is gitignored, so artifacts never leak in).    |

---

## Procedure

Invoke the **Task** tool with `subagent_type: wf:commit`, passing:

- `ado-id` — the user-supplied ID, or omit to let the subagent infer from the current branch.
- `push` — `true` if `--push` was passed, else `false`.
- `staged` — `true` if `--staged` was passed, else `false`.

Emit the subagent's Final Output block (`COMMIT — committed`, `COMMIT — nothing-to-commit`, or `COMMIT — Error`) verbatim. **No narrative before or after the block** — the subagent owns the user-facing output; the diff and message-authoring reasoning stay in its isolated context.

---

## Final Output (emitted by the subagent)

Success:

```
COMMIT — <committed | nothing-to-commit>

Task: {wi-prefix}-{id} — <title or n/a>
Subject: <id>: <subject>          (omitted when nothing-to-commit)
Files: <n> changed (+<a> -<d>)    (omitted when nothing-to-commit)
Push: <pushed (origin/<branch>) | up-to-date (origin/<branch>) | not-pushed | failed (<reason>)>
Next: /wf:pr <id>
```

Error:

```
COMMIT — Error

Reason: <one sentence — what went wrong>
```

**The block must always be the very last thing output to chat.** A caller (e.g. `wf:pr`) greps `COMMIT — committed`/`COMMIT — nothing-to-commit` to proceed and `COMMIT — Error` to abort, then reads the `Push:` line — a value starting with `failed` is fatal for any caller that needs a pushed branch.
