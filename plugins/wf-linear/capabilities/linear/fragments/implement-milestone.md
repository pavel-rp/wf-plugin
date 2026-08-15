# implement.milestone — append one entry to the running implementation log (slot fill)

**Version:** 1.0.0 (WF-408 — the `implement.milestone` third of the C021 implement-phase mirror)
**Model:** claude-opus-5[1m]

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `linear` capability's fill for the `implement.milestone` slot — the **only `append`-policy point
in the C021 set**. `/wf:implement` reaches it in Phase 2.5, **once per checkpoint**, at each of the
five checkpoints that phase enumerates. `implement` follows this prose in its own context each time.

**What `append` means here, and what it does not.** The policy governs how **contributions compose**:
the resolver concatenates every registered contribution to `implement.milestone` in registry order,
personal `_local/slots/implement.milestone.md` override last, and serves the result as one body — so
this fill runs **alongside** any other capability's fill at the same checkpoint rather than
superseding it, and the inline default is kept as the first part rather than discarded. It does
**not** mean this fill may assume it is the only contributor, and it does **not** mean this fill
re-posts earlier entries: each firing appends exactly its own one entry for the checkpoint that
triggered it.

**Role framing.** The `Impl:` child's **comment thread is the running implementation log.** Each
checkpoint appends one comment to it; prior entries stay exactly where they are and are never
rewritten or replaced. This is what satisfies "appended to the running log — prior entries retained"
using only operations the tracker contract already declares: there is deliberately **no**
comment-edit operation in the contract, and this fill does not invent one. At phase end,
`implement.finish` consolidates every entry into the record's description `## Log` section via
`update`, giving the same log a single readable-back surface.

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })` ("Direct provider
resolution"); obtain each operation's body via `resolve_content` (`workspaceRoot`,
`class: fragment`) from that record and follow it in-context — name no concrete tracker tool here.
The operations this fill uses: `post_comment`. **No operation outside the already-defined tracker
contract is used, described, or implied.**

---

## Step 1 — Resolve the target, or return

Read back `**Tracker impl item:** <id>` from `02_plan.md`.

**Absent → return immediately, post nothing.** There is no implementation record to log against:
either no tracker is bound, or `implement.start` did not resolve (it was unfilled, it failed, or the
run resumed from a session that never reached it). A checkpoint with nowhere to go is silent — never
create the record here, and never fall back to logging on the umbrella. Creating records is
`implement.start`'s job alone.

## Step 2 — Per-checkpoint idempotency guard

`/wf:implement` resumes from the first unchecked step, so a re-run legitimately re-reaches
checkpoints an earlier session already logged. Read back the `**Impl log:**` line from `02_plan.md`
— a single line carrying the comma-separated list of checkpoint keys already posted this task, e.g.
`**Impl log:** approach, step-002, step-003`.

Derive this firing's **checkpoint key** from the checkpoint `implement` is reporting:

| Checkpoint (Phase 2.5) | Key |
|------------------------|-----|
| 1 — approach confirmed | `approach` |
| 2 — plan step completed | `step-<NNN>` (the step's own number — one key per step, which is why this checkpoint repeats) |
| 3 — verification run | `verify` |
| 4 — acceptance criteria resolved | `criteria` |
| 5 — handoff checks complete | `handoff` |

If the key is already present in `**Impl log:**`, **return immediately and post nothing** — the
entry is already in the thread. Otherwise continue.

## Step 3 — Append the entry

Invoke `post_comment(<impl-item-id>, <entry-body>)` **once**. The entry is short and factual — a
log line, not a report:

- A heading line naming the checkpoint in plain language and the moment it was reached.
- One to three lines of what was actually observed: for `approach`, the files confirmed and that the
  approach holds; for `step-<NNN>`, the step title and its one-line implementation note; for
  `verify`, the verification command's outcome; for `criteria`, each acceptance criterion and
  whether it was met; for `handoff`, the file list the work touched.
- Nothing else. Do not restate the plan, do not paste diffs or file contents, and do not repeat
  entries already posted — the thread accumulates them.

If the checkpoint is a step that **halted unfinished** rather than completing, say so plainly and
name the blocker in one line. A blocked step is exactly the kind of thing the log exists to make
visible, so it is logged, not suppressed.

Append the checkpoint key to `**Impl log:**` in `02_plan.md` immediately after a successful post.

## Step 4 — Return

Return quietly so `implement` continues the phase unchanged. Carry no summary line for routine
entries — this point fires many times in one run and a per-firing summary would drown the phase's
own output. Write the model id nowhere on the tracker, and carry no AI-attribution trailer,
"generated with" footer, emoji, or promotional tagline into any comment.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| `**Tracker impl item:**` absent | return immediately, post nothing, create nothing |
| checkpoint key already in `**Impl log:**` | return immediately — the entry is already in the thread |
| `post_comment` fails | state one line naming the checkpoint and the error, record no key for it, continue the phase; a later checkpoint still fires normally |
| Tracker unconfigured or unrecoverable | this fill never resolves at all; `implement` runs its no-op inline default instead |

A failure at any checkpoint never blocks execution and never un-ticks a step: `02_plan.md`'s
checkboxes remain the run's durable progress record either way.

Rationale, the charter this fill belongs to, and why the log is a comment thread rather than one
edited comment: [`../references/onboarding.md`](../references/onboarding.md) — read by authors,
never at slot-fire.
