# /wf:spec — interface declaration

The machine-readable, externally-bindable surface of `spec`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:spec <id> [--type feat|fix|chore|refactor|migration|docs|hotfix] [--complexity S|M|L]`

## Terminal block

`SPEC — Complete`

## Slots

| slot (skill.point) | merge policy | purpose                                                                 |
|--------------------|--------------|-------------------------------------------------------------------------|
| spec.questions     | replace      | the point where the run's open questions are published, reached after they are identified and before the interactive prompt (Phase 2); the inline default publishes nothing |
| spec.publish       | replace      | the point where the finished specification artifact is published, reached after `01_spec.md` is written and indexed (Phase 4); the inline default publishes nothing |

## Settings

_(none)_

## Safety rules

**Allowed:** read any file in the project; obtain config via the `wf-resolver`
`resolve_config({ workspaceRoot, ... })` query; invoke `get`/`update` via the
`wf-resolver` `resolve_provider({ workspaceRoot, surface: "tracker" })` query —
read-only **in this skill's own body**, with exactly one write exception, the
Phase 0 step 3 empty-`Dev` description backfill; read-only resolution via
`current-branch-query`; write or
create files only inside the task folder `{task-root}/{task-id}/`; resolve the
`spec.questions` and `spec.publish` slots via `resolve_content({ workspaceRoot, ... })`
(`class: slot`, `skill: spec`) — one call per marker — and, only on a `composed`
outcome, follow the served body as prose in this skill's own context, which
authorizes **exactly** the operations that body names (a bound fill may perform
contract-bound provider writes; an unfilled, unresolved, or refused slot
authorizes none); dispatch
the **Task** tool to the `wf:branch` subagent for the Phase 0.5 branch gate and
to the `wf:classify` subagent for Phase 0.7 type resolution, each behind its own
routing decision made in the body.

**Forbidden:** modify any source file outside the task folder; run builds, tests,
linters, or installs; run any destructive version-control operation directly;
create implementation plans or step-by-step checklists (that is `/wf:plan`'s
job); write, from this skill's own body, any field or work item beyond the single
Phase 0 backfill exception (a composed slot body's own named operations are
authorized by the Allowed clause above, never by improvisation here);
improvise a publish, a comment, or any other operation at a slot marker whose
slot is unfilled, unresolved, or refused — an unfilled slot executes its inline
default **exactly**.
