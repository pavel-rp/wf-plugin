# qa-gen.publish — publish and refresh the finished test plan (slot fill)

**Version:** 1.0.0 (WF-1079 — the ADO half of the C045 completion-publishing fills; authored to parity, review-verified, never run live)
**Model:** claude-opus-5-5

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `ado` capability's fill for the `qa-gen.publish` slot (`replace` policy). `/wf:qa-gen` reaches
this point once per run, after `06_qa.md` is written, its index row recorded and its phase receipt
requested — and follows this prose in its own context. It supersedes the inline default ("nothing
is published") wholesale.

**Role framing.** This fill publishes the finished **test plan** — `06_qa.md` and nothing else —
as a `QA plan:` child work item beneath the task's existing umbrella, and keeps it current: every
regeneration **refreshes the same item** instead of creating a second one. It never blocks the
phase: `06_qa.md` is already written and remains the source of truth.

**What this fill never does.** It never reads or publishes `07_qa-report.md` or any execution
result. It never modifies `06_qa.md` — its phase receipt is bound to that file's digest, so the
receipt stays `fresh` — and never writes any other task artifact. The only file it writes is its
own `<publication-record>`.

**Inputs (resolved by the host).** `<task-id>`, `<task-folder>`, `<qa-plan>` =
`<task-folder>/06_qa.md`, `<scope>`, `<scenario-count>`, `<publication-record>` =
`<task-folder>/publication/qa-gen.publish.md`.

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })`; obtain each operation's
body via `resolve_content` (`workspaceRoot`, `class: fragment`) from that record and follow it
in-context — name no concrete tracker tool here. The operations this fill uses: `get`,
`create_child`, `update`, and `set_status`. **No operation outside the already-defined tracker
contract is used, described, or implied.**

---

## Step 1 — Read the publication record first

Read `<publication-record>` before any tracker call. Three cases, decided by the file alone:

- **Absent** — this plan has never been published. Continue at Step 2 (create).
- **Present with exactly one `**Publication item:** <id>` line carrying a non-empty id** — a plan
  for this task was published before. Continue at Step 5 (refresh). **Never create** on this path.
- **Present but unreadable** (no such line, more than one, or an empty value) — create nothing,
  change nothing, and end with `Publish: failed — publication record unreadable at <publication-record>`.

## Step 2 — Resolve the task context (create path only)

The **umbrella** is the work item the task id already names. Resolve it read-only, in this order,
and stop at the first hit:

1. A `**Tracker umbrella:** <id>` line read back from `<task-folder>/03_tasks.md`, else
   `02_plan.md`, else `01_spec.md` — an earlier artifact fill recorded it there. Read only; never
   write these files.
2. A `get(<task-id>)` succeeds — then `<task-id>` **is** the umbrella.

Neither holds → this fill has no task context and may not mint one (its write scope forbids
recording a guard line in a task artifact). Create nothing and end with
`Publish: failed — no tracker work item for <task-id>`.

## Step 3 — Compose the item (shared by create and refresh)

- **title** — `QA plan: <task title>`, the task title taken from `06_qa.md`'s H1 (else
  `01_spec.md`'s).
- **description** — the full markdown body of `<qa-plan>`, verbatim. Do not summarise, truncate or
  re-word it, and append no run results.

## Step 4 — Create path: create, then record immediately

1. Invoke `create_child(<umbrella-id>, <title>, <description>)` **once**. On failure, write no
   record and end with `Publish: failed — create_child: <error>`.
2. **Immediately** after it returns an id, and **before any further operation**, write
   `<publication-record>` (create the `publication/` folder if absent):

   ```markdown
   # qa-gen.publish — publication record

   **Publication item:** <id>
   **Publication parent:** <umbrella-id>
   **Published:** <YYYY-MM-DD HH:mm>
   ```

   This ordering is the duplicate guard: once an id exists on the tracker it is on disk before
   anything else can fail, so every retry refreshes that item. If the record write itself fails,
   end with `Publish: failed — item <id> created but its record could not be written: <error>`,
   naming the id so it is not lost.
3. **Best effort, never fatal:** `update(<id>, tags: ["wf-artifact"])`, then
   `set_status(<id>, <the project's completed state>)` — `Closed` in Agile, `Done` in Scrum and
   Basic, a custom template's own completed state otherwise. On either failure, state one line and
   continue; the outcome stays `published`.
4. End with `Publish: published <id>`.

## Step 5 — Refresh path: update the recorded item

1. Invoke `update(<recorded-id>, title: <title>, description: <description>)` **once**, with the
   Step 3 values. Never `create_child` here, whatever the error.
2. On failure, leave `<publication-record>` exactly as it is — so the next run retries the same
   item — and end with `Publish: failed — update <recorded-id>: <error>`. If the item was deleted on
   the tracker, removing the record is the operator's explicit choice to publish anew; this fill
   never makes it.
3. On success, end with `Publish: refreshed <recorded-id>`. The record is unchanged.

## Step 6 — Outcome

State **exactly one** outcome line, as the last thing this fill emits: `Publish: published <ref>`,
`Publish: refreshed <ref>`, or `Publish: failed — <reason>`. The host prints `failed` as one warning
line; no outcome changes its status token, `06_qa.md`, the receipt, the index row or `Next:`. Write
the model id nowhere on the tracker, and carry no AI-attribution trailer, "generated with" footer,
emoji, or promotional tagline into any title, description or comment.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| record absent, umbrella resolved | create child, record immediately, tag + status best effort → `published` |
| record absent, no umbrella | nothing created → `failed` |
| record readable | `update` the recorded item → `refreshed`; never create |
| record unreadable | nothing created or changed → `failed` |
| `create_child` fails | no record written → `failed`; the next run creates |
| record write fails after create | → `failed`, naming the created id |
| tag or status fails | one line stated → still `published` |
| refresh `update` fails | record kept → `failed`; the next run refreshes the same item |
| Tracker unconfigured or unrecoverable | this fill never resolves; `qa-gen` runs its no-op inline default |

Rationale, the refresh model shared with `research.publish`, and the authored-not-tested status:
[`../references/onboarding.md`](../references/onboarding.md) — read by authors, never at slot-fire.
