# slot-append-2 capability manifest (fixture)

**Kind:** adapter

A second `append`-policy contribution to the same `ship.review` skill.point. Two
`append` claims on one skill.point compose (aggregate) — never a conflict, unlike
two `replace` claims.

## Fragments

| phase | contribution-kind | dispatch                        | scope              |
|-------|-------------------|---------------------------------|--------------------|
| —     | slot              | `inline: hooks/ship-note-2.md`  | ship.review append |
