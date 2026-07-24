# heading-typo capability manifest (fixture — `## Fragments` heading miscased, WF-239)

**Kind:** adapter

The heading below is `## fragments` (lowercase), not the exact `## Fragments`. Without
the heading guard, the fragments block parses to zero rows and the manifest passes
vacuously; the guard rejects the near-miss heading, naming the offender.

## fragments

| phase  | contribution-kind | dispatch             | scope |
|--------|-------------------|----------------------|-------|
| verify | finding           | `inline: hooks/x.md` | —     |
