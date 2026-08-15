# /wf:implement — interface declaration

The machine-readable, externally-bindable surface of `implement`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:implement <id> [--steps <range>] [--mode nonstop|step]`

## Terminal block

`IMPLEMENT — Complete`

## Slots

| slot (skill.point)  | merge policy | purpose                                                                 |
|---------------------|--------------|-------------------------------------------------------------------------|
| implement.start     | replace      | the point where the phase announces that execution has begun, reached once the branch gate has cleared and before STEP-001 runs (Phase 1.5); the inline default announces nothing |
| implement.milestone | append       | the point where the phase announces reaching one defined checkpoint, reached once per checkpoint at the five boundaries Phase 2.5 enumerates; the accumulating-log point — every contributor runs, in registry order — and the inline default announces nothing |
| implement.finish    | replace      | the point where the phase announces that execution has ended, reached after the handoff checks and before the completion report (Phase 5.5); the inline default announces nothing |

`implement.milestone` is the only `append`-policy slot declared by this skill: it
fires repeatedly within one run and its contributions **accumulate** rather than
supersede one another. `implement.start` and `implement.finish` fire exactly once
per run and carry the `replace` default.

## Settings

_(none)_

## Safety rules

**Allowed:** read any file in the project; obtain config via the `wf-resolver`
`resolve_config({ workspaceRoot, ... })` query; read-only resolution via
`current-branch-query` (the `wf-resolver`
`resolve_provider({ workspaceRoot, surface: "delivery" })` query); create and
modify source files anywhere the loaded `02_plan.md` step dictates — this is the
one core skill authorized to write outside `_local/`; tick this task's plan
checkboxes and append its resolution summary; run **only** the verification
command the plan's verify step names; resolve the `implement.start`,
`implement.milestone` and `implement.finish` slots via
`resolve_content({ workspaceRoot, ... })` (`class: slot`, `skill: implement`) —
one call per marker, and once per checkpoint for `implement.milestone` — and,
only on a `composed` outcome, follow the served body as prose in this skill's own
context, which authorizes **exactly** the operations that body names (a bound
fill may perform contract-bound provider writes; an unfilled, unresolved, or
refused slot authorizes none); dispatch the **Task** tool to the `wf:branch`
subagent for the Phase 1 branch gate, behind its own routing decision made in the
body.

**Forbidden:** commit, stage, push, or open a pull request; run any destructive
version-control operation directly; run builds, tests, linters, or installs other
than the plan's named verification command; skip a plan step or expand scope
beyond what the loaded plan states; modify `00_reqs.md`, `01_spec.md`, or
`02_plan.md` other than ticking checkboxes and appending the resolution summary;
write, from this skill's own body, any external record of any kind (a composed
slot body's own named operations are authorized by the Allowed clause above,
never by improvisation here); improvise an announcement, a log entry, or any
other operation at a slot marker whose slot is unfilled, unresolved, or refused —
an unfilled slot executes its inline default **exactly**.
