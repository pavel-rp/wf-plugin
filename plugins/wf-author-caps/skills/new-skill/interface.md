# /wf-author-caps:new-skill — interface declaration

The machine-readable, externally-bindable surface of `new-skill`. A resolver reads
this file for the skill's declared slots and settings — **never** the SKILL.md
body. Everything in the body outside the declared slot markers is freely
rewordable implementation; the five sections below are the stable, contracted
surface (invocation shape, terminal block, slots + merge policies, settings
keys, safety rules).

## Invocation

`/wf-author-caps:new-skill [<name>] [--plugin <plugin-name>]`

## Terminal block

`NEW-SKILL — <Delivered | Stopped>`

## Slots

| slot (skill.point)     | merge policy | purpose                                                                 |
|------------------------|--------------|-------------------------------------------------------------------------|
| new-skill.constraints  | append       | additional constraints the emitted skill must satisfy, reached once the emission template has stated the scaffolder's own rules and before the check set runs; the inline default adds no constraint |

## Settings

_(none)_

## Safety rules

**Allowed:** read any file in the workspace, and glob it to detect the target
plugin and slug collisions; obtain the shared scaffolder loop and any other
authoring template via `resolve_content({ workspaceRoot, ... })`
(`class: references-template`, `plugin: wf-author-caps`, `skill: new-skill`) and
follow it as prose; resolve the `wf` plugin root via
`resolve_plugin_root({ workspaceRoot, plugin: "wf" })`; write and edit files
**only** under the resolved `plugins/<plugin-name>/skills/<name>/` folder; run the
resolver's `validate_skill_interface({ workspaceRoot, plugin: <plugin-name>, skill: <name> })`
tool and the repository's `glossary-lint.sh` over the emitted file; resolve the
`new-skill.constraints` slot via `resolve_content({ workspaceRoot, ... })`
(`class: slot`, `skill: new-skill`, `point: constraints`) — one call per marker —
and, only on a `composed` outcome, follow the served body as prose in this
skill's own context, which authorizes **exactly** the constraints that body names
(an unfilled, unresolved, or refused slot authorizes none).

**Forbidden:** write or edit anything outside the target skill folder — no
manifest, no registry row, no version manifest, no existing skill body (this
skill emits one skill folder and nothing else); emit a file containing `TODO`,
`FIXME`, `XXX`, or any fill-me-in marker; hand back an artifact carrying an open
finding, or report a check as clean without running it; overwrite an existing
`SKILL.md` without asking first; improvise a constraint, a check, or any other
operation at the `new-skill.constraints` marker when the slot is unfilled,
unresolved, or refused — the inline-default region is executed **exactly**; write
the current model id as an AI-attribution trailer, a "generated with" footer, an
emoji, or a promotional tagline into any emitted file.
