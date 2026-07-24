# slot-badphase capability manifest (fixture)

**Kind:** adapter

A slot row that wrongly names an SDD phase (`spec`) in its phase column. A slot
targets a skill point (its scope), not a phase, so its phase cell must be `—`; the
validator rejects the misfiled row (CHECK 6).

## Fragments

| phase | contribution-kind | dispatch                        | scope               |
|-------|-------------------|---------------------------------|---------------------|
| spec  | slot              | `inline: hooks/ship-review.md`  | ship.review replace |
