# qa-gen.publish — publish and refresh the test plan (slot fill)

**Version:** 1.0.0 (WF-1078 — the linear half of charter C045's QA-plan publisher)
**Model:** claude-opus-5-5

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `linear` capability's fill for the `qa-gen.publish` slot (`replace` policy). `/wf:qa-gen`
reaches this point in Phase 5, once per run, after `06_qa.md` is written, its index row recorded
and its phase receipt requested. It hands this fill `<task-id>`, `<task-folder>`, `<qa-plan>`,
`<scope>`, `<scenario-count>` and `<publication-record>` (`qa-gen/interface.md` §"Slot inputs").

**Role framing.** This fill mirrors the **finished test plan** — `<qa-plan>`, and nothing else — to
the tracker as a `QA plan:` child issue of the task's own tracker item, and keeps that one child
current across regenerations. It never blocks the phase and never changes the plan: `06_qa.md` is
the source of truth.

**Refresh, not single-shot — read this before changing anything.** The `spec`/`plan`/`tasks`
publish fills follow `capability-registry.ops.md` §"Single-shot-publish idempotency": a recorded
id means *never re-invoke*. This fill deliberately does **not**: `/wf:qa-gen` regenerates and
overwrites `06_qa.md`, and a single-shot guard would leave the tracker carrying a stale plan. Here
a recorded id means **refresh that child in place**. Its identity lives in `<publication-record>`,
the one file this fill writes; overwriting `06_qa.md` never touches it.

**What it never does.** It never reads or publishes `07_qa-report.md` or any other execution
result — only the plan. It never modifies `06_qa.md` (its phase receipt is bound to that file's
digest, so the receipt stays `fresh` after every publish, refresh and failure) or any other task
artifact, and it never creates an umbrella: the plan belongs in its task's existing context.

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })` ("Direct provider
resolution"); obtain each operation's body via `resolve_content` (`workspaceRoot`,
`class: fragment`) from that record and follow it in-context — name no concrete tracker tool here.
The operations this fill uses: `get`, `create_child`, `update`, and `set_status`. **No operation
outside the already-defined tracker contract is used, described, or implied.**

---

## Step 1 — Read the publication record first

Before any tracker operation, read `<publication-record>`. A `**Publication:** <id>` line in it
means this plan was already published: take the **refresh path** (Step 4) with that id. No file,
or no such line, means nothing was published yet: continue at Step 2.

## Step 2 — Resolve the task's tracker item (read-only)

The parent is the task's own tracker item. Resolve it in this order and stop at the first hit:

1. A `**Tracker umbrella:** <id>` line in `<task-folder>/01_spec.md`, else
   `<task-folder>/02_plan.md` — read only; neither file is ever written.
2. A `get(<task-id>)` succeeds — then `<task-id>` **is** the parent.

Neither holds → the task has no tracker item to publish into. Create nothing — no umbrella, no
child — and end `Publish: failed — no tracker item for <task-id>`.

Take `<task title>` from the parent's title as `get` returns it, else from the `01_spec.md` heading,
else `<task-id>`.

## Step 3 — Create path (no record)

Invoke `create_child` **once**:

- **parent** — the item from Step 2.
- **title** — `QA plan: <task title>`.
- **description** — the full body of `<qa-plan>`, verbatim. Do not summarise, truncate, or re-word
  it, and append nothing from any run report.

On failure, end `Publish: failed — create_child: <error>`; nothing was created, so the next
generation simply tries again.

**Immediately** after it returns — before any other operation, and before the outcome line —
write `<publication-record>` (creating its `publication/` folder if absent):

```markdown
# qa-gen.publish — publication record

**Publication:** <returned id>
**Parent:** <parent id>
**Destination:** linear
**Published at:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>
```

Writing the record before anything else is what keeps a retry duplicate-free: once the create has
returned, every later failure leaves the identity on disk, so the next generation refreshes this
child instead of creating another. If the record write itself fails, end
`Publish: failed — published <id> but could not record it: <error>`, naming the id so the gap is
visible, and stop there. Otherwise continue at Step 5.

## Step 4 — Refresh path (record present)

Invoke `update(<id>, title: QA plan: <task title>, description: <the full current body of
<qa-plan>>)` — `<task title>` resolved as in Step 2's last paragraph, without creating anything.
**Never invoke a create operation on this path** — not when the update fails, and not when the
child looks missing: a record is a commitment to one identity, and creating a second child is the
duplicate this fill exists to prevent.

- On success, add or replace a `**Refreshed at:** <YYYY-MM-DD HH:mm>` line in
  `<publication-record>` (best effort; the `**Publication:**` line is never changed) and continue at
  Step 5.
- On failure, keep the record exactly as it is and end `Publish: failed — update <id>: <error>`;
  the next generation retries the refresh against the same id.

## Step 5 — Label and close (best effort, never fatal)

Invoke `update(<id>, labels: ["wf-artifact"])`, then `set_status(<id>, "Done")` — the child is a
published document, not a unit of work, and leaving it open would inflate the task's open-child
count. Each is best effort: on failure state one line and continue. Neither ever changes the
outcome.

## Step 6 — Outcome

End with exactly one line: `Publish: published <id>` after the create path, or
`Publish: refreshed <id>` after the refresh path (or the `Publish: failed — …` line a step above
named). Write the model id nowhere on the tracker, and carry no AI-attribution trailer, "generated
with" footer, emoji, or promotional tagline into any title or description.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| record present | refresh that id via `update`; never create |
| no tracker item for the task | `Publish: failed — no tracker item …`; nothing created |
| `create_child` fails | `Publish: failed — …`; no record written; next generation retries the create |
| record write fails after a create | `Publish: failed — published <id> but could not record it …` |
| refresh `update` fails | `Publish: failed — …`; record kept; next generation retries the same id |
| label or `set_status` fails | one line, continue — the outcome is unchanged |
| Tracker unconfigured or unrecoverable | this fill never resolves at all; `qa-gen` runs its no-op inline default instead |

Rationale and the residual window between a create and its record:
[`../references/onboarding.md`](../references/onboarding.md) — read by authors, never at slot-fire.
