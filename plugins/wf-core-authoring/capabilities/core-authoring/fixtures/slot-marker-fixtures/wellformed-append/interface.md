# /wf:wellformed-append — interface declaration (fixture)

## Invocation

`/wf:wellformed-append <id>`

## Terminal block

`WELLFORMED-APPEND — <state>`

## Slots

| slot (skill.point)      | merge policy | purpose                                   |
|-------------------------|--------------|-------------------------------------------|
| wellformed-append.step  | append       | capabilities append extra steps after the default |

## Settings

_(none)_

## Safety rules

Reads only; writes nothing outside `_local/`.
