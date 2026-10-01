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
omitted, each shipper resolves to the top tier, stepping down one tier once if the host lacks it), `[--max-parallel <N>]`
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
`read_family_run_evidence({ workspaceRoot, memberRoot, taskId })`, `memberRoot` being the worktree
the item's own scoreboard row records (admitted by the resolver only on a same-family proof and
verified against that worktree's own issuer binding); name the resolver's `prepare_workspace` and
`run_workspace_setup` operations in each shipper's dispatch prompt, for the shipper to call against its
own worktree before the ceremony (never against the orchestrator's own workspace); resolve the `fleet.closeout-review` slot via
`resolve_content({ workspaceRoot, ... })` (`class: slot`, `skill: fleet`, `point: closeout-review`)
and, on a `composed` outcome, follow the served body as prose in this skill's own context — which at
that point only authorizes exactly the operations that body names: the delivery reads
`pr-detect`, `review-threads-read`, `pr-comments-read` and `merged-ref-read` (once per swept pull
request, exporting its merge commit to the fixed `_local/scratch/wf-sweep-merged-ref` so
verification never reads the orchestrator's own checkout), the tracker write `create_child`
(tracker mode only, at most 10 per swept pull request),
one `wf:context-distiller` Task dispatch per swept pull request, and `Read`/`Grep` of a source file at a review-supplied
anchor plus six `Bash` purposes the served body names (claim verification is not among
them — the served body requires the `Grep` tool for that) — the served body's scratch safety
check (one read-only stat of the fixed `_local/scratch/` path and each existing component
above it, the workspace root and `_local` included, each owned by the current user and writable by
no one else, and,
when it is absent, one
`umask 077` creation of that same fixed path, never derived from review text), one
real-path resolution per candidate, under the merged-ref root, to bound the anchor, the removal of
the fixed `_local/scratch/wf-sweep-merged-ref` export (any earlier interrupted run's leftover before
each swept pull request's identity probe, whatever that pull request holds, and the export after
each swept pull request, regardless of outcome), and one SHA-256 digest per ingested entry that
carries no thread node id (at most one per entry in each swept pull request's single 100-entry
ingest) for its
idempotency key, whose preimage is written to the fixed `_local/scratch/wf-sweep-digest.bin` (mode
`0600`) and hashed there rather than
placed on a command line, that file being removed before the first write and after each hash regardless of outcome — with the merged-ref
removal and the scratch-directory creation, one of the three non-read-only `Bash` purposes — bounded by that body to an
anchor every character of which is drawn from `A`-`Z`, `a`-`z`, `0`-`9`, `.`, `_`, `/` and `-`
(checked before any `Bash` call, since the real-path resolution puts the anchor on a command line),
which is relative and free of any `..` segment, no component of which is a symlink, whose
resolved real path is inside the merged-ref root, itself inside the workspace root,
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
the **Skill** tool; and dispatch shipper subagents via the Agent tool, each ceremony carrying
`--review-boundary <SOURCE-ROOT>/_local/fleet/lenses/<id>`. **At the review boundary only**, for an
item whose shipper reported a review-boundary hand-back — a closed list: read that item's
`04_lens-request.md` read-only from the task folder under the worktree its own row records; dispatch
each requested row as this orchestrator's own foreground child via the Agent tool (the row's agent
token and prompt verbatim, routed first, no worktree isolation); write each returned block and then
`manifest.md` (carrying the request's tree and round) into
`_local/fleet/lenses/<id>/<tree>/r<round>/`, `<id>` accepted only as a single safe path segment, and only after a canonical-containment check before any write or directory creation — no existing component from `_local/` down to each target file a symlink, and the resolved real path of the item folder and of the destination (each, or its nearest existing ancestor when not yet created) a strict descendant of `_local/` inside the workspace root; a path failing the check is never written, is recorded `unsafe exchange path`, and the shipper is continued without the review boundary; and send that same shipper one continuation
message to re-invoke its ceremony. A row that fails is recorded failed and never re-run or applied by
the orchestrator itself. **At the critic boundary only**, for an item whose shipper reported a
critic-boundary hand-back — the same closed list against the critic request instead: read that
item's `04_critic-request.md` read-only; dispatch its one unit as this orchestrator's own foreground
child, accepted only when its agent token is the core critic agent, its prompt verbatim, from the
item's recorded worktree as the working directory; write `critic.md` and then `manifest.md` into
`_local/fleet/lenses/<id>/<tree>/r<round>/critic/` behind the same containment check (a failing path
recorded `unsafe exchange path`, never written); and send that same shipper one continuation message
to continue in place. A critic unit that fails is recorded failed and never re-run or applied.

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
receipt match to turn an unproven item proven; present the self-reported shape ledger a shipper
returns (or the `Shape:` axis rendered from it) as proof of anything, let a shape state change an
item's proof-of-ceremony class or count, or leave an orchestrator takeover unrecorded in that item's
row or render it as an as-routed run; write the runtime model id aside, write any
AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into the
scoreboard, a comment, or any output.
