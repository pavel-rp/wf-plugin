# slot-nopolicy capability manifest (fixture)

**Kind:** adapter

A slot row whose scope names a well-formed skill.point but declares NO merge policy.
The validator rejects it — a slot row must state `replace` or `append` (CHECK 6c).

## Fragments

| phase | contribution-kind | dispatch                        | scope        |
|-------|-------------------|---------------------------------|--------------|
| —     | slot              | `inline: hooks/ship-review.md`  | ship.review  |
