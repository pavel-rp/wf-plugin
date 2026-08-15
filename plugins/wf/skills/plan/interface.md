# /wf:plan — interface declaration

The machine-readable, externally-bindable surface of `plan`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:plan <id> [--type feat|fix|chore|refactor|migration|docs|hotfix] [--complexity S|M|L]`

## Terminal block

`PLAN — Complete`

## Slots

| slot (skill.point) | merge policy | purpose                                                                 |
|--------------------|--------------|-------------------------------------------------------------------------|
| plan.publish       | replace      | the point where the finished implementation plan is published, reached after `02_plan.md` is written and indexed (Phase 3); the inline default publishes nothing |

## Settings

_(none)_

## Safety rules

**Allowed:** read any file in the project; obtain config via the `wf-resolver`
`resolve_config({ workspaceRoot, ... })` query; read-only resolution via
`current-branch-query` (the `wf-resolver`
`resolve_provider({ workspaceRoot, surface: "delivery" })` query); write or
create files only inside the task folder `{task-root}/{task-id}/`; obtain the
plan template via `resolve_content({ workspaceRoot, ... })`
(`class: references-template`, `skill: plan`); resolve the `plan.publish` slot
via `resolve_content({ workspaceRoot, ... })` (`class: slot`, `skill: plan`) —
one call per marker — and, only on a `composed` outcome, follow the served body
as prose in this skill's own context, which authorizes **exactly** the
operations that body names (a bound fill may perform contract-bound provider
writes; an unfilled, unresolved, or refused slot authorizes none); dispatch
the **Task** tool to the `wf:branch` subagent for the Phase 0 branch gate and
to the `wf:classify` subagent for Phase 0.5 type resolution, each behind its own
routing decision made in the body.

**Forbidden:** modify any source file outside the task folder; run builds, tests,
linters, or installs; run any destructive version-control operation directly;
write, from this skill's own body, any external record of any kind (a composed
slot body's own named operations are authorized by the Allowed clause above,
never by improvisation here); improvise a publish, a comment, or any other
operation at a slot marker whose slot is unfilled, unresolved, or refused — an
unfilled slot executes its inline default **exactly**.
