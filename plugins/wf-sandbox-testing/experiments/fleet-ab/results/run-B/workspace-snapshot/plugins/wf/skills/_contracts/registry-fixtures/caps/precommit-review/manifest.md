# precommit-review capability manifest (fixture)

**Kind:** adapter

The `finding` kind now spans two phases: `verify` (post-implementation conformance)
and `pre-commit` (the operation-time commit-path self-review seam, WF-154). This
capability attaches at both, proving the seam reuses `finding` with no new kind.

## Fragments

| phase      | contribution-kind | dispatch                       | scope |
|------------|-------------------|--------------------------------|-------|
| verify     | finding           | `inline: hooks/rule-audit.md`  | —     |
| pre-commit | finding           | `inline: hooks/self-review.md` | —     |
