# /wf:fleet — interface declaration

The machine-readable, externally-bindable surface of `fleet`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:fleet <id> [<id> …]` — an explicit item list.
`/wf:fleet <umbrella-id>` — a tracker umbrella; ship all its children (tracker mode only).
`/wf:fleet` — resume: re-read the scoreboard and continue.

Flags, in any of the three forms: `[--model <name>]` (pin one model for every shipper subagent;
omitted, each item's model is resolved from its own complexity evidence), `[--max-parallel <N>]`
(positive integer cap on concurrent shippers, bounded by the core maximum of 4; default 4), and
`[--after "<id>:<blocker>,<blocker>; …"]` (extra dependency edges beyond the tracker graph, used to
encode same-file contention).

## Terminal block

`FLEET — <Running | Waiting | Complete | Blocked>`

## Slots

| slot (skill.point)    | merge policy | purpose                                                                 |
|-----------------------|--------------|-------------------------------------------------------------------------|
| fleet.closeout-review | replace      | the post-merge review sweep over the run's whole merged set, run at Closeout after the parent-status step and before the undeleted-branches listing; the inline default runs no sweep |

## Settings

_(none)_

## Safety rules

**Allowed:** obtain config via the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query and
resolve the `delivery` and `tracker` surfaces via `resolve_provider({ workspaceRoot, ... })`; invoke
the tracker provider's read operations `list_children` and `list_blockers` and its write operations
`post_comment` / `set_status` at closeout (tracker mode only), each by obtaining the op body via
`resolve_content({ workspaceRoot, ... })` (`class: fragment`) and following it in this skill's own
context; invoke the delivery provider's read operations `activity-read`, `pr-detect` and
`checks-read` the same way, plus `newest-published-version-read` once at Prerequisites for the
currency check; query the local install inventory read-only via `discover_packs` on the currency
check's provider-less branch only; read an item's run-evidence receipts read-only via
`read_run_evidence({ workspaceRoot, taskId })`; resolve the `fleet.closeout-review` slot via
`resolve_content({ workspaceRoot, ... })` (`class: slot`, `skill: fleet`, `point: closeout-review`)
and, on a `composed` outcome, follow the served body as prose in this skill's own context, supplying
per merged row its recorded branch, PR reference, filing parent (tracker mode only) and already-filed
ids, and appending that row's `swept: <ids | none>` idempotency record to its own scoreboard `notes`
cell — a scoreboard write, covered by the scoreboard clause below and needing no further authority;
read and write the scoreboard and any breadcrumb **under `_local/`** only, and read the composed constitution
from `_local/constitution.md` to carry it into each shipper's dispatch prompt; read a terminal item's
task-artifact set read-only from the worktree path its own scoreboard row records, write that set
into this run's declared task-artifact persistence destination inside the resolved task root, and
invoke `/wf:index` through the Skill tool once per persisted artifact; dispatch shipper subagents via
the Agent tool and invoke `/wf:ship`, `/wf:run` (and each gated `/wf:<phase>` it names), `/wf:pr`,
`/wf:tf` through the Skill tool.

**Forbidden:** write or edit any file **outside `_local/`** — the orchestrator authors no source and
no artifact, and every source write belongs to the shipper subagents; run any raw version-control or
delivery command, or name any concrete tracker, delivery, or review tool — delivery and tracker state
is reached **only** through the abstract provider operations above; force-remove, delete, or
otherwise destructively touch any branch or worktree — closeout **lists** leftovers from the
scoreboard's recorded state and never removes them; mutate a worktree an agent owns, or merge a pull
request an agent is actively rebasing; improvise a review sweep at the `fleet.closeout-review` marker
when the slot is unfilled or unresolved — the inline default states that no sweep ran and changes
nothing else; accept as proof of ceremony anything a dispatched agent can author, or widen the
receipt match to turn an unproven item proven; write the runtime model id aside, write any
AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into the
scoreboard, a comment, or any output.
