# /wf:pr — interface declaration

The machine-readable, externally-bindable surface of `pr`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf:pr [<id>] [--draft] [--base <branch>] [--no-commit]`

## Terminal block

`PR — <created | exists | Error>`

## Slots

| slot (skill.point) | merge policy | purpose                                                                 |
|--------------------|--------------|-------------------------------------------------------------------------|
| pr.body-check      | append       | checks the composed pull-request body against the branch's own changes before the pull request is created (Phase 2.5, followed by the `wf:pr` agent); the inline default runs no check |

## Settings

_(none)_

## Safety rules

**Allowed:** read the task folder; obtain config via the `wf-resolver`
`resolve_config({ workspaceRoot, ... })` query; read-only resolution for id and
branch inference; resolve the `delivery` and `tracker` surfaces once per run and
forward the records to the subagents; resolve the `pr.body-check` slot once via
`resolve_content({ workspaceRoot, ... })` (`class: slot`) and forward a composed
body to the `wf:pr` agent unchanged; invoke the **Task** tool with
`subagent_type` `wf:commit` and `wf:pr`.

**Forbidden:** modify any source file; run any destructive delivery operation;
author commits or pull-request bodies inline in the host; improvise a check at
the `pr.body-check` marker when the slot is unfilled, unresolved, or refused;
create a pull request whose composed body a forwarded check flagged; write the
model id, any AI-attribution trailer, a "generated with" footer, an emoji, or
any promotional tagline into a title, body, or commit.
