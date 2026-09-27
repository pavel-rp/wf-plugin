# implement.start — open the implementation record (slot fill)

**Version:** 1.2.0 (WF-413 — the `implement.start` third of the C021 implement-phase mirror, authored to parity with the `linear` fill; review-verified, never run live; WF-830 — every write moves to the implement-owned `02_progress.md`, the approved `02_plan.md` is read-only; WF-832 — the legacy plan-copy half of Step 0 is retired with the closed removal window)
**Model:** claude-opus-5[1m]

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `ado` capability's fill for the `implement.start` slot (`replace` policy). `/wf:implement`
reaches this point in Phase 1.5 — after the branch gate has cleared and **before** STEP-001 runs, so
it fires exactly once, at the moment implementation genuinely begins. Because this is a `replace`
fill it **supersedes** `implement`'s inline default (the no-op "nothing is announced anywhere")
wholesale, and `implement` follows this prose in its own context.

**Role framing.** This fill opens the **`Impl:` child work item** — the durable record of the
implementation pass — and moves both it and the umbrella to the project's work-started state, so a
team watching the tracker sees work start. It never blocks the phase: implementation proceeds
whether or not any of these operations succeed.

**Why a child work item, continuing the artifact family.** `spec.publish`, `plan.publish` and
`tasks.publish` create `Spec:`, `Plan:` and `Tasks:` children beneath the task umbrella. The
implementation pass is a record of the same class, so it is published the same way and carries the
`Impl:` prefix — which is what makes the umbrella's children legible as a conveyor at a glance. It
differs from the other three in one respect only: it is created **at the start** of its phase rather
than the end, because its value is precisely that it is visible while the work is in flight.
`implement.finish` fills in its body and closes it.

**Reconciliation — read this before changing anything.** This fill creates a **distinct** `Impl:`
child and records its id under a **distinct** metadata key (`**Tracker impl item:**`) in its **own**
local artifact (`02_progress.md`), so no two fills ever touch the same field of the same item. The
approved `02_plan.md` is **read-only** here — a gate approval digests its raw bytes, so any write
would stale it; the umbrella description below is still *sourced* from it, read-only. It must
**never** patch the task's own description — the `spec` Phase-0 backfill remains the only write to
it — and it must never post a comment on the umbrella, which is `tf`'s sole write of that kind.

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })` ("Direct provider
resolution"); obtain each operation's body via `resolve_content` (`workspaceRoot`,
`class: fragment`) from that record and follow it in-context — name no concrete tracker tool here.
The operations this fill uses: `get`, `create_umbrella`, `create_child`, `update`, and `set_status`.
**No operation outside the already-defined tracker contract is used, described, or implied.**

---

## Step 0 — Carry guard lines across a re-plan (once)

After a re-plan, `/wf:implement` sets the old record aside as `02_progress.superseded.md`. When
`02_progress.md` carries **none** of this fill's guard lines — `**Tracker impl item:**`,
`**Impl log:**` and `**Impl finished:**` — and that file exists, copy only its
`**Tracker umbrella:**` and `**Tracker impl item:**` lines forward into `02_progress.md`'s metadata
block (creating the file with its H1 and `**Plan:** 02_plan.md` line if absent), so the new pass
reuses the same records; the per-pass `**Impl log:**` and `**Impl finished:**` lines stay behind.
`02_plan.md` is never read for guard lines and never written. Once this step has run, this fill,
`implement.milestone` and `implement.finish` read every guard line from `02_progress.md` alone, so
no later step needs a fallback of its own. When `02_progress.md` already carries any of the three,
or `02_progress.superseded.md` is absent or carries no line to copy, do nothing.

## Step 1 — Idempotency guard (read the lines back first)

Per `capability-registry.ops.md` §"Single-shot-publish idempotency", read back these metadata lines
**before** writing anything:

- `**Tracker impl item:** <id>` — from `02_progress.md`, the implement-owned progress artifact
  (after Step 0, the only place any implement guard line lives). An absent file means no line.
- `**Tracker umbrella:** <id>` — from `02_plan.md` (read-only — `plan.publish` records it there before
  approval), else `03_tasks.md`, else `02_progress.md`, else `01_spec.md`.

A present `**Tracker impl item:**` value means this phase was already started once (a resumed run
after an interruption): **do not create a second record**. Reuse that id for the rest of the run,
skip to Step 5, and re-assert the statuses there — re-running `/wf:implement` to resume from the
first unchecked step is normal and must not mint a duplicate.

A present `**Tracker umbrella:**` value with no impl-item line means the umbrella exists but the
record does not — reuse that umbrella and continue at Step 3.

The umbrella fallback order exists because an earlier artifact fill in the same task (or an
earlier run of this one) will have recorded the line in one of those files, and reusing it is what
keeps every artifact of one task under **one** umbrella.

## Step 2 — Resolve or create the umbrella

The **umbrella** is the work item the task id already names — the item every artifact this
capability publishes hangs beneath. Resolve it in this order and stop at the first hit:

1. The `**Tracker umbrella:** <id>` line read back at Step 1 (from `02_plan.md`, else `03_tasks.md`,
   else `02_progress.md`, else `01_spec.md`). Use it as-is.
2. A `get({task-id})` succeeds — then `{task-id}` **is** the umbrella; reuse it.
3. Neither holds — the task has no tracker record (a local `T<NNN>` id). Invoke
   `create_umbrella(<task title>, <one-paragraph description from 02_plan.md>)` **once** to mint it
   (the description is read from the plan; the plan is never written).

When the id was not already recorded in `02_plan.md`, record the resolved or created id as
`**Tracker umbrella:** <id>` in `02_progress.md`'s metadata block — never in `02_plan.md` —
immediately, before Step 3, so a failure below still leaves the umbrella reusable rather than
duplicated on the next run. If `02_progress.md` does not exist yet, create it with its H1
`# {task-id} — Implementation progress` and a `**Plan:** 02_plan.md` line, then add the guard line.

## Step 3 — Create the implementation record

Invoke `create_child` **once**:

- **parent** — the umbrella id from Step 2.
- **title** — `Impl: <task title>` (the `Impl:` prefix continues the `Spec:` / `Plan:` / `Tasks:`
  family, making the artifact class legible at a glance in a list of children).
- **description** — a short opening body: the task title, a one-line statement that implementation
  is in progress, the plan's step count, and the plan's `## Done When` criteria verbatim. Keep it
  brief — `implement.finish` rewrites this description in full at phase end, so this is a placeholder
  a reader can act on, not the final record. Do **not** copy the whole plan in here.

Record the returned id as `**Tracker impl item:** <id>` in `02_progress.md`'s metadata block
immediately (creating the file as in Step 2 if it is still absent).

## Step 4 — Tag the record (best effort, never fatal)

Invoke `update(<impl-item-id>, tags: ["wf-artifact"])` to mark the child as a published workflow
artifact rather than an independent unit of work. The provider's `update` binding is an
**unrestricted field patch**, so this needs no operation of its own; the tag field is this tracker's
equivalent of the label field the sibling `linear` fill patches at the same step. This is **best
effort**: if the tag is rejected for any reason, state one line and continue — a missing tag never
fails the phase. Touch no other field.

## Step 5 — Move both items to the work-started state

Two `set_status` calls, in this order, each to **the project's work-started state** — `Active` in the
Agile process template, `Committed` in Scrum, `Doing` in Basic:

1. `set_status(<impl-item-id>, <work-started state>)` — the implementation record is now active work.
2. `set_status(<umbrella-id>, <work-started state>)` — the task as a whole is now being implemented.

State names are process-template-dependent, so a project on a custom template substitutes its own
work-started state; the **transition** is what this fill contracts for, not the literal string.

The umbrella transition is the one this fill makes to a **shared** item, and it is safe: the
work-started state is a non-terminal, mid-conveyor state that no other fill and no other skill sets.
`tf` later moves the umbrella to its terminal status; `implement.finish` moves it to the
awaiting-review state in between. The three transitions are strictly ordered in time and strictly
disjoint in value, so the umbrella lifecycle is never double-driven.

On failure of either call, state one line naming the operation and the error, and continue — a
status that did not move never blocks implementation.

## Step 6 — Return

Return quietly so `implement` proceeds to Phase 2 (the STEP-001 gate) unchanged. Carry a one-line
summary (e.g. `Opened Impl: <task title> as <impl-item-id> under <umbrella-id>; both started`).
Write the model id nowhere on the tracker, and carry no AI-attribution trailer, "generated with"
footer, emoji, or promotional tagline into any title, description, or comment.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| `**Tracker impl item:**` already recorded | reuse it, create nothing, re-assert the Step 5 statuses |
| `create_umbrella` / `create_child` fails | warn once naming the operation and the error, record no guard line for the failed step, continue into Phase 2 |
| `update` (tag) fails or the tag is rejected | state one line, continue — never fatal |
| either `set_status` fails, or the template has no matching state name | state one line, continue — the record exists either way |
| Tracker unconfigured or unrecoverable | this fill never resolves at all; `implement` runs its no-op inline default instead |

Rationale, the charter this fill belongs to, the umbrella convention shared with the other artifact
fills, the `tf` reconciliation in full, and the authored-not-tested status of this whole slot set:
[`../references/onboarding.md`](../references/onboarding.md) — read by authors, never at slot-fire.
