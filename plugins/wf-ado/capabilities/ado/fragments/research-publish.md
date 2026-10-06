# research.publish — publish and refresh finished research (slot fill)

**Version:** 1.0.0 (WF-1079 — the ADO half of the C045 completion-publishing fills; authored to parity, review-verified, never run live)
**Model:** claude-opus-5-5

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `ado` capability's fill for the `research.publish` slot (`replace` policy). `/wf:research`
reaches this point once per pass that ends `RESEARCH — Complete` with `**Challenge:** done` —
after the challenge revisions and after any intake decision — and follows this prose in its own
context. It supersedes the inline default ("nothing is published") wholesale.

**Role framing.** This fill publishes the **final** `01_findings.md` and `02_verdict.md` together
as **one standalone work item** — not a child of any task — and keeps that item current: every
later pass **refreshes the same item** instead of creating a second one. It publishes every
verdict, `Not practical — <reason>` included. It never blocks research: the local artifacts are
already written and remain the source of truth.

**What this fill never does.** It creates no implementation task, seeds no charter, adopts no
charter, and creates no child under any task. It never edits `00_brief.md`, `01_findings.md`,
`02_verdict.md` or any intake, and never changes a verdict. The only file it writes is its own
`<publication-record>`.

**Inputs (resolved by the host).** `<research-id>`, `<title>`, `<research-folder>`, `<findings>`,
`<verdict>`, `<verdict-value>`, `<confidence>`, `<intake>`, `<publication-record>` =
`<research-folder>/publication/research.publish.md`.

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })`; obtain each operation's
body via `resolve_content` (`workspaceRoot`, `class: fragment`) from that record and follow it
in-context — name no concrete tracker tool here. The operations this fill uses:
`create_umbrella`, `update`, and `set_status`. **No operation outside the already-defined tracker
contract is used, described, or implied.**

---

## Step 1 — Read the publication record first

Read `<publication-record>` before any tracker call. Three cases, decided by the file alone:

- **Absent** — this research has never been published. Continue at Step 2 (create).
- **Present with exactly one `**Publication item:** <id>` line carrying a non-empty id** — this
  research was published before. Continue at Step 4 (refresh). **Never create** on this path.
- **Present but unreadable** (no such line, more than one, or an empty value) — the identity cannot
  be trusted, and creating would risk a duplicate. Create nothing, change nothing, and end with
  `Publish: failed — publication record unreadable at <publication-record>`.

## Step 2 — Compose the item (shared by create and refresh)

- **title** — `Research: <title>`.
- **description** — the full markdown body of `<findings>`, then a horizontal rule (`---`), then
  the full markdown body of `<verdict>`, both verbatim. Do not summarise, truncate or re-word
  either file: the item carries exactly what the research folder carries, final post-challenge
  revisions included.

## Step 3 — Create path: create, then record immediately

1. Invoke `create_umbrella(<title>, <description>)` **once** — the contract operation that creates a
   top-level work item with no parent. On failure, write no record and end with
   `Publish: failed — create_umbrella: <error>`.
2. **Immediately** after it returns an id, and **before any further operation**, write
   `<publication-record>` (create the `publication/` folder if absent):

   ```markdown
   # research.publish — publication record

   **Publication item:** <id>
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

## Step 4 — Refresh path: update the recorded item

1. Invoke `update(<recorded-id>, title: <title>, description: <description>)` **once**, with the
   Step 2 values. Never `create_umbrella` here, whatever the error.
2. On failure, leave `<publication-record>` exactly as it is — so the next pass retries the same
   item — and end with `Publish: failed — update <recorded-id>: <error>`. If the item was deleted on
   the tracker, removing the record is the operator's explicit choice to publish anew; this fill
   never makes it.
3. On success, end with `Publish: refreshed <recorded-id>`. The record is unchanged.

## Step 5 — Outcome

State **exactly one** outcome line, as the last thing this fill emits: `Publish: published <ref>`,
`Publish: refreshed <ref>`, or `Publish: failed — <reason>`. The host turns `failed` into a warning;
no outcome changes its status token, artifacts, index rows or `Next:`. Write the model id nowhere
on the tracker, and carry no AI-attribution trailer, "generated with" footer, emoji, or
promotional tagline into any title, description or comment.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| record absent | create, record immediately, tag + status best effort → `published` |
| record readable | `update` the recorded item → `refreshed`; never create |
| record unreadable | nothing created or changed → `failed` |
| `create_umbrella` fails | no record written → `failed`; the next pass creates |
| record write fails after create | → `failed`, naming the created id |
| tag or status fails | one line stated → still `published` |
| refresh `update` fails | record kept → `failed`; the next pass refreshes the same item |
| Tracker unconfigured or unrecoverable | this fill never resolves; `research` runs its no-op inline default |

Rationale, the refresh model shared with `qa-gen.publish`, and the authored-not-tested status:
[`../references/onboarding.md`](../references/onboarding.md) — read by authors, never at slot-fire.
