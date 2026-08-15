# plan.publish — publish the implementation plan (slot fill)

**Version:** 1.0.0 (WF-407 — the `plan.publish` half of the C021 mid-conveyor mirror)
**Model:** claude-opus-5[1m]

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `linear` capability's fill for the `plan.publish` slot (`replace` policy). `/wf:plan`
reaches this point in Phase 3, **after** `02_plan.md` is written and the per-task index row
recorded. Because this is a `replace` fill it **supersedes** `plan`'s inline default (the no-op
"nothing is published anywhere") wholesale, and `plan` follows this prose in its own context.

**Role framing.** This fill mirrors the finished implementation plan to the tracker as a **child
artifact issue** beneath the task's umbrella, then marks it done. It never blocks the phase and
never invalidates the plan: `02_plan.md` is already written and remains the source of truth.

**Reconciliation with the other artifact fills — read this before changing anything.** The
`spec.publish` fill (WF-406) creates a `Spec:` child; this fill creates a **`Plan:`** child, and
`tasks.publish` creates a **`Tasks:`** child. Each writes a **distinct** child issue and records
its id under a **distinct** metadata key in its **own** local artifact, so no two fills ever
touch the same field of the same item and nothing is double-published. This fill must **never**
patch the task's own description — the `spec` Phase-0 backfill remains the only write to it.

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
lines from `02_plan.md` — the local artifact that triggers this call — **before** writing
anything:

- `**Tracker umbrella:** <id>`
- `**Tracker plan item:** <id>`

A present `**Tracker plan item:**` value means this artifact was already published: **return
immediately**, create nothing, and let `plan` emit its Final Output block. A present
`**Tracker umbrella:**` value with no plan-item line means the umbrella exists but the artifact
does not — reuse that umbrella and continue at Step 3.

When neither line is present in `02_plan.md`, also read back `**Tracker umbrella:** <id>` from
`01_spec.md` if that file exists — an earlier `spec.publish` in the same task will have recorded
it there, and reusing it is what keeps every artifact of one task under **one** umbrella.

## Step 2 — Resolve or create the umbrella

The **umbrella** is the tracker issue the task id already names — the item every artifact this
capability publishes hangs beneath. Resolve it in this order and stop at the first hit:

1. The `**Tracker umbrella:** <id>` line read back at Step 1 (from `02_plan.md`, else
   `01_spec.md`). Use it as-is.
2. A `get({task-id})` succeeds — then `{task-id}` **is** the umbrella; reuse it.
3. Neither holds — the task has no tracker record (a local `T<NNN>` id). Invoke
   `create_umbrella(<task title>, <one-paragraph description from 02_plan.md>)` **once** to mint
   it.

Record the resolved or created id as `**Tracker umbrella:** <id>` in `02_plan.md`'s metadata
block immediately, before Step 3 — so a failure below still leaves the umbrella reusable rather
than duplicated on the next run.

## Step 3 — Create the plan child issue carrying the full artifact

Invoke `create_child` **once**:

- **parent** — the umbrella id from Step 2.
- **title** — `Plan: <task title>` (the `Plan:` prefix is what makes the artifact class legible
  at a glance in a list of children; `spec`/`tasks`/`implement` fills use their own prefixes).
- **description** — the **full markdown body of `02_plan.md`**, verbatim apart from stripping
  the `**Tracker umbrella:**` / `**Tracker plan item:**` bookkeeping lines, which are local
  guard state and carry no meaning on the tracker. Do not summarise, truncate, or re-word the
  plan: the point of the mirror is that the tracker carries what the repository carries.

Record the returned id as `**Tracker plan item:** <id>` in `02_plan.md` immediately.

## Step 4 — Label the artifact (best effort, never fatal)

Invoke `update(<plan-item-id>, labels: ["wf-artifact"])` to mark the child as a published
workflow artifact rather than a unit of work. This is **best effort**: if the label does not
exist in the workspace, or the patch is rejected for any reason, state one line and continue —
a missing label never fails the publish and never blocks the phase. Touch no other field.

## Step 5 — Mark the artifact done

Invoke `set_status(<plan-item-id>, "Done")`. The child is a **published document, not a unit of
work**: leaving it open would inflate the task's open-child count and misrepresent the umbrella's
progress. On failure, state one line and continue — the artifact is published either way.

## Step 6 — Return

Return quietly so `plan` emits its Final Output block unchanged. Carry a one-line summary
(e.g. `Published Plan: <task title> as <plan-item-id> under <umbrella-id>`). Write the model id
nowhere on the tracker, and carry no AI-attribution trailer, "generated with" footer, emoji, or
promotional tagline into any title, description, or comment.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| `**Tracker plan item:**` already recorded | return immediately, create nothing |
| `create_umbrella` / `create_child` fails | warn once naming the operation and the error, record no guard line for the failed step, continue to the Final Output block |
| `update` (label) fails or the label is unknown | state one line, continue — never fatal |
| `set_status` fails | state one line, continue — the artifact is published |
| Tracker unconfigured or unrecoverable | this fill never resolves at all; `plan` runs its no-op inline default instead |

Rationale, the charter this fill belongs to, and the umbrella convention shared with the other
artifact fills: [`../references/onboarding.md`](../references/onboarding.md) — read by authors,
never at slot-fire.
