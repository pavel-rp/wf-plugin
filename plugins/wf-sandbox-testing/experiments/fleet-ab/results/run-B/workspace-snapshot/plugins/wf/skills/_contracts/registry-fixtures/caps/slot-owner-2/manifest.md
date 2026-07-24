# slot-owner-2 capability manifest (fixture)

**Kind:** adapter

A second capability that also `replace`-claims the `ship.review` slot skill.point.
Two `replace` claims on the same skill.point is single-owner overlap — a validation
error naming both offenders (CHECK 5).

## Fragments

| phase | contribution-kind | dispatch                        | scope               |
|-------|-------------------|---------------------------------|---------------------|
| —     | slot              | `inline: hooks/ship-review.md`  | ship.review replace |
