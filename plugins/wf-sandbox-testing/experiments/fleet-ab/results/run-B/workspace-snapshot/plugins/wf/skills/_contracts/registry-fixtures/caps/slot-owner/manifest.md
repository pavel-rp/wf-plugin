# slot-owner capability manifest (fixture)

**Kind:** adapter

A `slot` (WF-323) contribution targets a per-skill composition point — its scope
`skill.point` (here `ship.review`) — **not** an SDD phase, so its phase cell is `—`.
The scope carries the skill.point plus a declared merge policy (`replace` =
single-owner; `append` = list-like). This manifest also carries a `verify | finding`
row to prove the seventh kind coexists with the six existing kinds in one manifest.

## Fragments

| phase  | contribution-kind | dispatch                        | scope               |
|--------|-------------------|---------------------------------|---------------------|
| —      | slot              | `inline: hooks/ship-review.md`  | ship.review replace |
| verify | finding           | `inline: hooks/rule-audit.md`   | —                   |
