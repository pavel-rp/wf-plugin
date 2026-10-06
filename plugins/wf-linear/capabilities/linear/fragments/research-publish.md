# research.publish — publish and refresh finished research (slot fill)

**Version:** 1.0.0 (WF-1078 — the linear half of charter C045's research publisher)
**Model:** claude-opus-5-5

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

The `linear` capability's fill for the `research.publish` slot (`replace` policy). `/wf:research`
reaches this point in Phase 8, once per pass that ends `RESEARCH — Complete` with the challenge
done and the intake decided, and again on a Done-state resume. It hands this fill `<research-id>`,
`<title>`, `<research-folder>`, `<findings>`, `<verdict>`, `<verdict-value>`, `<confidence>`,
`<intake>` and `<publication-record>` (`research/interface.md` §"Slot inputs").

**Role framing.** This fill mirrors the **finished** research — the final, post-challenge
`01_findings.md` and `02_verdict.md` together — to the tracker as **one standalone research item**,
and keeps that one item current across re-runs. It never blocks the pass and never changes the
research: the local artifacts are the source of truth.

**Refresh, not single-shot — read this before changing anything.** The `spec`/`plan`/`tasks`
publish fills follow `capability-registry.ops.md` §"Single-shot-publish idempotency": a recorded
id means *never re-invoke*. This fill deliberately does **not**: research is superseded and
re-run, and a single-shot guard would leave the tracker carrying stale findings. Here a recorded
id means **refresh that item in place**. Its identity lives in `<publication-record>`, the one
file this fill writes; supersession never moves it, so every later pass finds it.

**What it never does.** It never creates a task, a child issue, an implementation item, or a
charter; it never adopts or seeds anything; it never reads, writes or acts on `<intake>`
(informational only); and it never edits `00_brief.md`, `01_findings.md`, `02_verdict.md`, or any
intake. Every verdict publishes the same way — a `Not practical — <reason>` verdict is published
exactly like `Practical`, because a recorded "no" is as worth reading as a "yes".

**Tracker access.** Every operation below is a `tracker`-surface operation. Resolve the `tracker`
provider via `resolve_provider({ workspaceRoot, surface: "tracker" })` ("Direct provider
resolution"); obtain each operation's body via `resolve_content` (`workspaceRoot`,
`class: fragment`) from that record and follow it in-context — name no concrete tracker tool here.
The operations this fill uses: `create_umbrella`, `update`, and `set_status`. **No operation
outside the already-defined tracker contract is used, described, or implied.**

---

## Step 1 — Read the publication record first

Before any tracker operation, read `<publication-record>`. A `**Publication:** <id>` line in it
means this research was already published: take the **refresh path** (Step 3) with that id. No
file, or no such line, means nothing was published yet: take the **create path** (Step 2).

## Step 2 — Create path (no record)

Compose the item:

- **title** — `Research: <title>`.
- **description** — `## Findings` followed by the full body of `<findings>`, then `## Verdict`
  followed by the full body of `<verdict>`, each verbatim. Do not summarise, truncate, or re-word
  either: the point of the mirror is that the tracker carries what the repository carries.

Invoke `create_umbrella(<title>, <description>)` **once** — a top-level item with no parent, since
research has no task of its own. On failure, end `Publish: failed — create_umbrella: <error>`;
nothing was created, so the next completion simply tries again.

**Immediately** after it returns — before any other operation, and before the outcome line —
write `<publication-record>` (creating its `publication/` folder if absent):

```markdown
# research.publish — publication record

**Publication:** <returned id>
**Destination:** linear
**Published at:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>
```

Writing the record before anything else is what keeps a retry duplicate-free: once the create has
returned, every later failure leaves the identity on disk, so the next pass refreshes this item
instead of creating another. If the record write itself fails, end
`Publish: failed — published <id> but could not record it: <error>`, naming the id so the gap is
visible, and stop there. Otherwise continue at Step 4.

## Step 3 — Refresh path (record present)

Invoke `update(<id>, title: <title>, description: <description>)`, composed exactly as in Step 2
from the current `<findings>` and `<verdict>`. **Never invoke a create operation on this path** —
not when the update fails, and not when the item looks missing: a record is a commitment to one
identity, and creating a second item is the duplicate this fill exists to prevent.

- On success, add or replace a `**Refreshed at:** <YYYY-MM-DD HH:mm>` line in
  `<publication-record>` (best effort; the `**Publication:**` line is never changed) and continue at
  Step 4.
- On failure, keep the record exactly as it is and end `Publish: failed — update <id>: <error>`;
  the next completion retries the refresh against the same id.

## Step 4 — Label and close (best effort, never fatal)

Invoke `update(<id>, labels: ["wf-artifact"])`, then `set_status(<id>, "Done")` — the item is a
published document, not a unit of work. Each is best effort: on failure state one line and
continue. Neither ever changes the outcome.

## Step 5 — Outcome

End with exactly one line: `Publish: published <id>` after the create path, or
`Publish: refreshed <id>` after the refresh path (or the `Publish: failed — …` line a step above
named). Write the model id nowhere on the tracker, and carry no AI-attribution trailer, "generated
with" footer, emoji, or promotional tagline into any title or description.

---

## Degradation

| Situation | Behaviour |
|-----------|-----------|
| record present | refresh that id via `update`; never create |
| `create_umbrella` fails | `Publish: failed — …`; no record written; next completion retries the create |
| record write fails after a create | `Publish: failed — published <id> but could not record it …` |
| refresh `update` fails | `Publish: failed — …`; record kept; next completion retries the same id |
| label or `set_status` fails | one line, continue — the outcome is unchanged |
| Tracker unconfigured or unrecoverable | this fill never resolves at all; `research` runs its no-op inline default instead |

Rationale and the residual window between a create and its record:
[`../references/onboarding.md`](../references/onboarding.md) — read by authors, never at slot-fire.
