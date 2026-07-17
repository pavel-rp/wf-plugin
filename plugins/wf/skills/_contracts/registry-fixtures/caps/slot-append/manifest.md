# slot-append capability manifest (fixture)

**Kind:** adapter

An `append`-policy slot contribution to the `ship.review` skill.point. `append`
mirrors aggregation — multiple contributors to one skill.point compose, so this
composes cleanly with slot-append-2 below (no partition collision).

## Fragments

| phase | contribution-kind | dispatch                        | scope              |
|-------|-------------------|---------------------------------|--------------------|
| —     | slot              | `inline: hooks/ship-note.md`    | ship.review append |
