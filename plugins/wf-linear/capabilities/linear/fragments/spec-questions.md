# spec.questions — publish the run's open questions (slot fill)

**Version:** 1.0.0 (WF-406 — the `spec.questions` half of the C021 tracker mirror)
**Model:** claude-opus-5[1m]

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `linear` capability's fill for the `spec.questions` slot (`replace` policy). `/wf:spec`
reaches this point in Phase 2 **after** the run's open questions are identified and **before**
the interactive `AskUserQuestion` prompt. Because this is a `replace` fill it **supersedes**
`spec`'s inline default (the no-op "nothing is published anywhere") wholesale, and `spec`
follows this prose in its own context.

**Role framing.** This fill posts **exactly one** comment and nothing else. It creates no
issue, changes no status, patches no field, and never blocks the phase: whatever happens
here, `spec` continues to the prompt. It is a mirror, not a gate.

**Tracker access.** Every operation below is a `tracker`-surface operation. `spec` already
resolved the `tracker` provider in Phase 0 ("Direct provider resolution"); obtain each
operation's body via `resolve_content` (`workspaceRoot`, `class: fragment`) from that record
and follow it in-context — name no concrete tracker tool here. The operations this fill uses:
`get` (umbrella confirmation) and `post_comment` (the single comment write). **No operation
outside the already-defined tracker contract is used, described, or implied.**

---

## Step 1 — Resolve the umbrella (never create one here)

The **umbrella** is the tracker issue the task id already names — the item every artifact this
capability publishes hangs beneath. Resolve it in this order and stop at the first hit:

1. A `**Tracker umbrella:** <id>` metadata line already present in the task folder's artifacts
   (`01_spec.md` first, then `00_reqs.md`) — a previous run recorded it. Use that id.
2. The Phase-0 `get` succeeded for `{task-id}` — then `{task-id}` **is** the umbrella. (Confirm
   with a single `get` only if the Phase-0 result is not still in context; never re-fetch
   otherwise.)
3. Neither holds — the task has no tracker record yet (a local `T<NNN>` id). **Skip this fill
   entirely**, state one line ("no umbrella resolved — open questions not published"), and
   return so `spec` proceeds to the prompt. Creating an umbrella is `spec.publish`'s job, never
   this fill's: a question comment must not be the thing that mints a tracker record.

## Step 2 — Idempotency guard (read the line back first)

Per `capability-registry.ops.md` §"Single-shot-publish idempotency", read back the
`**Tracker questions comment:** <value>` metadata line from `00_reqs.md` — the local artifact
that triggers this call — **before** writing anything. A present value means this run's
questions were already published for this artifact: **return immediately**, post nothing, and
let `spec` proceed to the prompt. Only an absent line permits the write below.

## Step 3 — Post one comment carrying every open question

Compose **one** body holding **all** of the run's open questions — never one comment per
question:

```
Open questions raised while specifying <task-id>:

1. <question, one line each>
2. <…>

Answers are being resolved interactively now; the finished specification follows.
```

Invoke `post_comment(<umbrella-id>, <body>)` **once**. Write the model id nowhere in the body,
and carry no AI-attribution trailer, "generated with" footer, emoji, or promotional tagline —
the comment reads as a plain note.

## Step 4 — Record the guard line, then return

Append (or update) the metadata line `**Tracker questions comment:** posted <YYYY-MM-DD HH:mm>`
in `00_reqs.md`, so a re-run reads it back at Step 2 and republishes nothing. `00_reqs.md` is
inside the task folder, the only place `spec` may write.

Then return quietly so `spec` continues to its interactive prompt.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| No umbrella resolvable (local id, no tracker record) | skip, state one line, continue to the prompt |
| Guard line already present | return immediately, post nothing |
| `post_comment` fails mid-run | warn once naming the operation and the error, do **not** record the guard line, continue to the prompt — the phase is never blocked by a tracker failure |
| No open questions identified | `spec` never reaches this point (Phase 2 skips to Phase 3) |

Rationale, the charter this fill belongs to, and the umbrella convention shared with
`spec.publish`: [`../references/onboarding.md`](../references/onboarding.md) — read by authors,
never at slot-fire.
