# /wf:wellformed-replace — interface declaration (fixture)

The machine-readable, externally-bindable surface of this skill. A resolver
reads this file for the skill's declared slots and settings — never the SKILL.md
body. Body prose is freely rewordable implementation; everything below is the
contracted, stable surface.

## Invocation

`/wf:wellformed-replace <id>`

## Terminal block

`WELLFORMED-REPLACE — <state>`

## Slots

| slot (skill.point)        | merge policy | purpose                              |
|---------------------------|--------------|--------------------------------------|
| wellformed-replace.review | replace      | a single owner replaces the default review step |

## Settings

_(none)_

## Safety rules

Reads only; writes nothing outside `_local/`.
