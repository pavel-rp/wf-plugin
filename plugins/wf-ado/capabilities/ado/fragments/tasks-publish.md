# tasks.publish — publish the task decomposition (slot fill)

**Version:** 1.0.0 (WF-413 — the `tasks.publish` half of the C021 mid-conveyor mirror, authored to parity with the `linear` fill; review-verified, never run live)
**Model:** claude-opus-5[1m]

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `ado` capability's fill for the `tasks.publish` slot (`replace` policy). `/wf:tasks`
reaches this point in Phase 5, **after** `03_tasks.md` is written and the per-task index row
recorded. Because this is a `replace` fill it **supersedes** `tasks`'s inline default (the no-op
"nothing is published anywhere") wholesale, and `tasks` follows this prose in its own context.

**Role framing.** This fill mirrors the finished decomposition to the tracker as a **child
artifact work item** beneath the task's umbrella, then marks it done. It never blocks the phase
and never invalidates the decomposition: `03_tasks.md` is already written and remains the source
of truth.

**Why a child work item and not a comment (the decision this fill implements).** The
decomposition is a durable conveyor artifact of the same class as the spec and the plan, so it
is published the same way — as a titled, re-readable record. A comment is a chronological remark
that later comments push out of view, and re-running `tasks` (which gates decomposition
separately from strategy, so regeneration is expected) would append a second full copy every
time. A child work item carries a recorded-id guard instead, so a re-run reuses the record. The
`Spec:` / `Plan:` / `Tasks:` prefix convention is what makes the artifact class legible in a list
of children.

**Reconciliation with the other artifact fills — read this before changing anything.** The
`spec.publish` and `plan.publish` fills create the `Spec:` and `Plan:` children. This fill
creates a **distinct** `Tasks:` child and records its id under a **distinct** metadata key in its
**own** local artifact, so no two fills ever touch the same field of the same item and nothing is
double-published. This fill must **never** patch the task's own description — the `spec` Phase-0
backfill remains the only write to it.

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })` ("Direct provider
resolution"); obtain each operation's body via `resolve_content` (`workspaceRoot`,
`class: fragment`) from that record and follow it in-context — name no concrete tracker tool
here. The operations this fill uses: `get`, `create_umbrella`, `create_child`, `update`, and
`set_status`. **No operation outside the already-defined tracker contract is used, described, or
implied.**

---

## Step 1 — Idempotency guard (read the lines back first)

Per `capability-registry.ops.md` §"Single-shot-publish idempotency", read back these metadata
lines from `03_tasks.md` — the local artifact that triggers this call — **before** writing
anything:

- `**Tracker umbrella:** <id>`
- `**Tracker tasks item:** <id>`

A present `**Tracker tasks item:**` value means this artifact was already published: **return
immediately**, create nothing, and let `tasks` emit its Final Output block. A present
`**Tracker umbrella:**` value with no tasks-item line means the umbrella exists but the artifact
does not — reuse that umbrella and continue at Step 3.

When neither line is present in `03_tasks.md`, also read back `**Tracker umbrella:** <id>` from
`02_plan.md`, else `01_spec.md` — an earlier artifact fill in the same task will have recorded it
there, and reusing it is what keeps every artifact of one task under **one** umbrella.

## Step 2 — Resolve or create the umbrella

The **umbrella** is the work item the task id already names — the item every artifact this
capability publishes hangs beneath. Resolve it in this order and stop at the first hit:

1. The `**Tracker umbrella:** <id>` line read back at Step 1 (from `03_tasks.md`, else
   `02_plan.md`, else `01_spec.md`). Use it as-is.
2. A `get({task-id})` succeeds — then `{task-id}` **is** the umbrella; reuse it.
3. Neither holds — the task has no tracker record (a local `T<NNN>` id). Invoke
   `create_umbrella(<task title>, <one-paragraph description from 02_plan.md>)` **once** to mint
   it.

Record the resolved or created id as `**Tracker umbrella:** <id>` in `03_tasks.md`'s metadata
block immediately, before Step 3 — so a failure below still leaves the umbrella reusable rather
than duplicated on the next run.

## Step 3 — Create the tasks child work item carrying the full artifact

Invoke `create_child` **once**:

- **parent** — the umbrella id from Step 2.
- **title** — `Tasks: <task title>` (the `Tasks:` prefix is what makes the artifact class legible
  at a glance in a list of children; `spec`/`plan`/`implement` fills use their own prefixes).
- **description** — the **full markdown body of `03_tasks.md`**, verbatim apart from stripping
  the `**Tracker umbrella:**` / `**Tracker tasks item:**` bookkeeping lines, which are local
  guard state and carry no meaning on the tracker. Do not summarise, truncate, or re-word the
  decomposition, and do **not** mint one child work item per `T-NNN` unit: the decomposition is
  published as **one** artifact record, exactly as the repository carries it.

Record the returned id as `**Tracker tasks item:** <id>` in `03_tasks.md` immediately.

## Step 4 — Tag the artifact (best effort, never fatal)

Invoke `update(<tasks-item-id>, tags: ["wf-artifact"])` to mark the child as a published
workflow artifact rather than a unit of work. The provider's `update` binding is an
**unrestricted field patch**, so this needs no operation of its own; the tag field is this
tracker's equivalent of the label field the sibling `linear` fill patches at the same step.
This is **best effort**: if the tag is rejected for any reason, state one line and continue —
a missing tag never fails the publish and never blocks the phase. Touch no other field.

## Step 5 — Mark the artifact done

Invoke `set_status(<tasks-item-id>, <the project's completed state>)` — `Closed` in the Agile
process template, `Done` in Scrum and Basic. The child is a **published document, not a unit of
work**: leaving it open would inflate the task's open-child count and misrepresent the
umbrella's progress. State names are process-template-dependent, so a project on a custom
template substitutes its own completed state; on failure, state one line and continue — the
artifact is published either way.

## Step 6 — Return

Return quietly so `tasks` emits its Final Output block unchanged. Carry a one-line summary
(e.g. `Published Tasks: <task title> as <tasks-item-id> under <umbrella-id>`). Write the model id
nowhere on the tracker, and carry no AI-attribution trailer, "generated with" footer, emoji, or
promotional tagline into any title, description, or comment.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| `**Tracker tasks item:**` already recorded | return immediately, create nothing |
| `create_umbrella` / `create_child` fails | warn once naming the operation and the error, record no guard line for the failed step, continue to the Final Output block |
| `update` (tag) fails or the tag is rejected | state one line, continue — never fatal |
| `set_status` fails, or the template has no matching state name | state one line, continue — the artifact is published |
| Tracker unconfigured or unrecoverable | this fill never resolves at all; `tasks` runs its no-op inline default instead |

Rationale, the charter this fill belongs to, the umbrella convention shared with the other
artifact fills, and the authored-not-tested status of this whole slot set:
[`../references/onboarding.md`](../references/onboarding.md) — read by authors, never at
slot-fire.
