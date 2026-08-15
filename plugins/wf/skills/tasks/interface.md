# /wf:tasks — interface declaration

The machine-readable, externally-bindable surface of `tasks`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:tasks <id>`

## Terminal block

`TASKS — Complete`

## Slots

| slot (skill.point) | merge policy | purpose                                                                 |
|--------------------|--------------|-------------------------------------------------------------------------|
| tasks.publish      | replace      | the point where the finished task decomposition is published, reached after `03_tasks.md` is written and indexed (Phase 5); the inline default publishes nothing |

## Settings

_(none)_

## Safety rules

**Allowed:** read any file in the project; obtain config via the `wf-resolver`
`resolve_config({ workspaceRoot, ... })` query; obtain the ordered active
capability registry via the `wf-resolver` `resolve_registry({ workspaceRoot, ... })`
query and dispatch the `tasks`-phase `task-list` fragments it names; read-only
resolution via `current-branch-query` (the `wf-resolver`
`resolve_provider({ workspaceRoot, surface: "delivery" })` query); write or
create files only inside the task folder `{task-root}/{task-id}/`; resolve the
`tasks.publish` slot via `resolve_content({ workspaceRoot, ... })`
(`class: slot`, `skill: tasks`) — one call per marker — and, only on a
`composed` outcome, follow the served body as prose in this skill's own context,
which authorizes **exactly** the operations that body names (a bound fill may
perform contract-bound provider writes; an unfilled, unresolved, or refused slot
authorizes none).

**Forbidden:** modify any source file, the spec, the plan, or any artifact other
than `03_tasks.md` and the index row; run builds, tests, linters, installs, or
any destructive version-control operation; skip the plan — the plan is the
authoritative input; write, from this skill's own body, any external record of
any kind (a composed slot body's own named operations are authorized by the
Allowed clause above, never by improvisation here); improvise a publish, a
comment, or any other operation at a slot marker whose slot is unfilled,
unresolved, or refused — an unfilled slot executes its inline default
**exactly**.
