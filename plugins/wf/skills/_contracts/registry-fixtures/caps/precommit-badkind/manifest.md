# precommit-badkind capability manifest (fixture — the seam is `finding`, not a bespoke kind)

**Kind:** adapter

The `pre-commit` seam reuses the frozen `finding` kind. A manifest that invents a
bespoke `self-review` kind for it is a misuse: the phase `pre-commit` is valid, but
`self-review` is not one of the taxonomy kinds, so validation must reject the row and
name the offender.

## Fragments

| phase      | contribution-kind | dispatch                       | scope |
|------------|-------------------|--------------------------------|-------|
| pre-commit | self-review       | `inline: hooks/self-review.md` | —     |
