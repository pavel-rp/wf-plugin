# /wf:qa-gen — interface declaration

The machine-readable, externally-bindable surface of `qa-gen`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, the inputs a
slot fill receives, settings keys, safety rules).

## Invocation

`/wf:qa-gen [<id>] [smoke|happy|full]`

## Terminal block

`QA-GEN — Complete`

## Slots

| slot (skill.point) | merge policy | purpose                                                                 |
|--------------------|--------------|-------------------------------------------------------------------------|
| qa-gen.publish     | replace      | the point where the finished test plan is published — reached once per run after `06_qa.md` is written, its index row recorded and the phase receipt requested (Phase 5), immediately before the final block; the inline default publishes nothing |

## Slot inputs

**`qa-gen.publish`** — values already resolved in the host's context when the
marker is reached (paths absolute, forward slashes):

- `<task-id>`, `<task-folder>`
- `<qa-plan>` = `<task-folder>/06_qa.md` — the finalized test plan; never a run report
- `<scope>` and `<scenario-count>`
- `<publication-record>` = `<task-folder>/publication/qa-gen.publish.md`

**Publication record.** The one file a fill may write to keep its opaque
publication identity, so a later generation refreshes the same publication
instead of duplicating it. Core never creates, parses or interprets its
contents, and never moves, renames or deletes it: overwriting `06_qa.md`, or
renaming an annotated one aside, touches only `06_qa.md`, so the `publication/`
folder survives every regeneration.

**Fill write scope.** A followed fill performs exactly the operations its served
body names, limited to writing its own `<publication-record>` and invoking
contract-bound provider operations. It never modifies `06_qa.md` (whose phase
receipt is bound to its digest) or any other task artifact, and never publishes
`07_qa-report.md` or any execution result.

**Outcome line.** A fill ends by stating exactly one line: `Publish: published
<ref>`, `Publish: refreshed <ref>`, or `Publish: failed — <reason>`. The host
prints `failed — …`, an absent or unrecognized outcome, and an
`unresolved`/`refused` resolution as one warning line before the final block; no
outcome changes the status token, `06_qa.md`, the receipt, the index row, or
`Next:`.

## Settings

_(none)_

## Safety rules

**Allowed:** read any file in the project; read-only resolution via
`current-branch-query`; dispatch the `wf:branch` subagent for the branch gate;
update the per-task index row; write `06_qa.md` only inside the resolved task folder; request
the phase receipt; resolve the `qa-gen.publish` slot via
`resolve_content({ workspaceRoot, ... })` (`class: slot`, `skill: qa-gen`) — one
call per run — and, only on a `composed` outcome, follow the served body as
prose in this skill's own context, which authorizes **exactly** the operations
that body names within the fill write scope above.

**Forbidden:** modify any source file, spec, plan, or other artifact; run builds,
tests, installs, or any destructive version-control operation; derive scenarios
from implementation bodies; write outside `_local/`; improvise a publish, a
comment, or any other operation at a slot marker whose slot is unfilled,
unresolved, or refused — an unfilled slot executes its inline default
**exactly**.
