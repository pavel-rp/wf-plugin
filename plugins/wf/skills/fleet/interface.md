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
and, on a `composed` outcome, follow the served body as prose in this skill's own context — which at
that point only authorizes exactly the operations that body names: the delivery reads
`pr-detect`, `review-threads-read` and `pr-comments-read`, the tracker write `create_child`
(tracker mode only, at most 10 per swept pull request),
one `wf:context-distiller` Task dispatch per swept pull request, and `Read`/`Grep` of a source file at a review-supplied
anchor plus three `Bash` purposes the served body names (claim verification is not among
them — the served body requires the `Grep` tool for that) — one
real-path resolution per candidate to bound the anchor, and one SHA-256 digest per ingested entry that
carries no thread node id (at most one per entry in each swept pull request's single 100-entry
ingest) for its
idempotency key, whose preimage is written to the fixed `_local/scratch/wf-sweep-digest.bin` (mode
`0600`) and hashed there rather than
placed on a command line, that file being removed after each hash regardless of outcome — the third
and only non-read-only `Bash` purpose — bounded by that body to an
anchor every character of which is drawn from `A`-`Z`, `a`-`z`, `0`-`9`, `.`, `_`, `/` and `-`
(checked before any `Bash` call, since the real-path resolution puts the anchor on a command line),
which is relative and free of any `..` segment, no component of which is a symlink, whose
resolved real path is inside the workspace root,
and which does not resolve into a secret-bearing or machine-state location — the version-control
metadata directory, the resolver's committed lifecycle tree, the resolved task root, any
dot-prefixed path component, at most 25 per pull request — supplying
per merged row its recorded branch, PR reference, filing parent (tracker mode only), already-filed
`<key>`=`<issue-id>` pairs, and appending that row's `swept: <key>=<id>, … | none` idempotency record to its own scoreboard `notes`
cell — a scoreboard write, covered by the scoreboard clause below and needing no further authority;
read and write the scoreboard and any breadcrumb **under `_local/`** only, and read the composed constitution
from `_local/constitution.md` to carry it into each shipper's dispatch prompt; read a terminal item's
task-artifact set read-only from the worktree path its own scoreboard row records, write that set
into this run's declared task-artifact persistence destination inside the resolved task root, and
record each persisted artifact through the per-task index writer, once per artifact; drive each
item's build chain and finalize step through the sibling `wf:*` commands named in `SKILL.md`, via
the **Skill** tool; and dispatch shipper subagents via the Agent tool.

**Forbidden:** write or edit any file **outside `_local/`** — the orchestrator authors no source and
no artifact, and every source write belongs to the shipper subagents; run any raw version-control or
delivery command, or name any concrete tracker, delivery, or review tool — delivery and tracker state
is reached **only** through the abstract provider operations above, the slot-scoped set included and
exhaustive for that point; force-remove, delete, or
otherwise destructively touch any branch or worktree — closeout **lists** leftovers from the
scoreboard's recorded state and never removes them; mutate a worktree an agent owns, or merge a pull
request an agent is actively rebasing; improvise a review sweep at the `fleet.closeout-review` marker
when the slot is unfilled or unresolved — the inline default states that no sweep ran and changes
nothing else; accept as proof of ceremony anything a dispatched agent can author, or widen the
receipt match to turn an unproven item proven; write the runtime model id aside, write any
AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into the
scoreboard, a comment, or any output.
