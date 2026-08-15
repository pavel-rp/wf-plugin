# implement.finish — close the implementation record and hand the task to review (slot fill)

**Version:** 1.0.0 (WF-408 — the `implement.finish` third of the C021 implement-phase mirror)
**Model:** claude-opus-5[1m]

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `linear` capability's fill for the `implement.finish` slot (`replace` policy). `/wf:implement`
reaches this point in Phase 5.5 — after the handoff checks have run and the final step is ticked, so
the work is finished and its outcome known, and before the completion report is emitted. Because
this is a `replace` fill it **supersedes** `implement`'s inline default (the no-op "nothing is
announced anywhere") wholesale, and `implement` follows this prose in its own context.

**Role framing.** This fill turns the in-flight `Impl:` record into a finished one — rewriting its
description into the full Summary / Audit / Tests / Log document, marking it Done, and moving the
umbrella to **In Review** so the task reads as awaiting review rather than still being written.

---

## Reconciliation with `tf` — the no-double-drive contract (read before changing anything)

`tf` already performs two tracker writes at finalize: `post_comment({task-id}, <resolution>)` and
`set_status({task-id}, <status>)`, where `{task-id}` **is the umbrella** and `<status>` is the
terminal value (default `Done`). This fill is deliberately disjoint from both, on three independent
axes, so no write is ever issued twice:

| Axis | this fill | `tf` |
|------|-----------|------|
| **Target** | the `Impl:` **child** (description + status), plus **one** umbrella transition | the **umbrella** only |
| **Umbrella status** | `In Review` — non-terminal, mid-conveyor | the terminal `Done` / `--status` value |
| **Umbrella comment** | **none, ever** | the single resolution comment |

Concretely, this fill **must never**:

- post a comment on the umbrella — that is `tf`'s sole write of its kind, and duplicating it is the
  exact failure the C021 charter names;
- set the umbrella to any terminal status — `In Review` only, so `tf`'s later terminal transition is
  still a real state change and not a no-op;
- touch `09_finalize.md`'s `**Resolution comment:**` / `**Closed:**` guard lines — those are `tf`'s
  own read-back state, and `tf` re-derives its behaviour from them unchanged;
- patch the task's own description — the `spec` Phase-0 backfill remains the only write to it.

The three umbrella transitions across the conveyor — `implement.start`'s In Progress, this fill's In
Review, and `tf`'s terminal close — are strictly ordered in time and strictly disjoint in value.
That ordering **is** the reconciliation; no change to `tf` was needed to achieve it.

---

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })` ("Direct provider
resolution"); obtain each operation's body via `resolve_content` (`workspaceRoot`,
`class: fragment`) from that record and follow it in-context — name no concrete tracker tool here.
The operations this fill uses: `update` and `set_status`. **No operation outside the already-defined
tracker contract is used, described, or implied.**

---

## Step 1 — Resolve the target, or return

Read back `**Tracker impl item:** <id>` and `**Tracker umbrella:** <id>` from `02_plan.md`.

**No impl item recorded → return immediately**, write nothing. There is no record to close: either
no tracker is bound, or `implement.start` never resolved. Do **not** create the record here —
creating it is `implement.start`'s job alone, and minting one at phase end would produce a record
that was never In Progress, misrepresenting the very lifecycle this mirror exists to show.

Also read back the `**Impl finished:**` line. If it already reads `done`, this phase was already
closed once (a resumed run): **return immediately**, rewrite nothing, re-transition nothing.

## Step 2 — Rewrite the record's description

Invoke `update(<impl-item-id>, description: <composed-document>)` **once**, replacing the short
placeholder body `implement.start` wrote with the finished document. Four sections, in this order:

- **`## Summary`** — what was actually implemented, in a short paragraph, drawn from `02_plan.md`'s
  `## Resolution Summary` when present and from the ticked steps' implementation notes otherwise.
  Deviations from the plan belong here.
- **`## Audit`** — the scope-confinement result from the handoff checks: the list of files the work
  touched, and an explicit statement of whether every one of them was named by a plan step.
- **`## Tests`** — the plan's verification command, its outcome, and each `## Done When` criterion
  with whether it was met. If no verification was run, say so plainly rather than omitting the
  section.
- **`## Log`** — the accumulated checkpoint entries, in the order they occurred, consolidated from
  the entries `implement.milestone` appended to this record's comment thread. This is the same log,
  given a single readable-back surface; the comments stay where they are and are **not** deleted,
  edited, or re-posted.

Touch no field other than `description`.

## Step 3 — Mark the record Done

Invoke `set_status(<impl-item-id>, "Done")`. The implementation pass is complete and its record is
now a finished document, not open work — leaving it In Progress would misrepresent the umbrella's
progress. On failure, state one line and continue.

## Step 4 — Move the umbrella to In Review

Invoke `set_status(<umbrella-id>, "In Review")` — **exactly one call, exactly this value.** The task
has been implemented and is awaiting review. Post **no** comment alongside it (see the reconciliation
table above). On failure, state one line and continue.

On success **or** stated failure-and-continue of both Step 3 and Step 4 — i.e. once this step is
reached and its `set_status` call has been attempted — record `**Impl finished:** done` in
`02_plan.md`. Writing the guard only here, after both `set_status` attempts, means an interrupted run
(e.g. the session ends between Step 2 and Step 4) still retries Steps 3–4 on resume instead of Step
1's own "already `done`" short-circuit skipping transitions that never actually ran.

## Step 5 — Return

Return quietly so `implement` emits its completion report unchanged. Carry a one-line summary (e.g.
`Closed Impl: <task title> (<impl-item-id>) as Done; <umbrella-id> moved to In Review`). Write the
model id nowhere on the tracker, and carry no AI-attribution trailer, "generated with" footer,
emoji, or promotional tagline into any title, description, or comment.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| `**Tracker impl item:**` absent | return immediately, write nothing, create nothing |
| `**Impl finished:** done` already recorded | return immediately — the record is already closed |
| `update` (description rewrite) fails | warn once naming the operation and the error, record no `**Impl finished:**` line, continue to the completion report |
| either `set_status` fails | state one line, continue — the description rewrite stands either way |
| Tracker unconfigured or unrecoverable | this fill never resolves at all; `implement` runs its no-op inline default instead |

A failure here never invalidates the work: the source changes are made, the plan's checkboxes are
ticked, and the completion report is emitted unchanged.

Rationale, the charter this fill belongs to, and the full `tf` reconciliation record:
[`../references/onboarding.md`](../references/onboarding.md) — read by authors, never at slot-fire.
