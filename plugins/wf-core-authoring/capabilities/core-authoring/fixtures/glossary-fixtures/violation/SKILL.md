---
name: violation
description: Seeded-violation fixture for glossary-lint.sh. Never installed, never invoked.
allowed-tools: [Read]
---

# /wf:violation — seeded-violation fixture

This body is deliberately non-conformant against `glossary.fixture.md`. It is the
proof object for the charter's done-criterion: the lint must FAIL on this file,
naming the file, the offending term, and the canonical alternative.

It lives under a `*-fixtures/` folder, so the real-tree lint surface never reaches
it — only `--selftest`, which lifts that exclusion deliberately, does.

## Planted violations

Two, one per shape:

1. A forbidden synonym in ordinary prose — this step configures the wodget before
   the run begins, and a second sentence mentions two wodgets for good measure.
2. A banned construction rather than a synonym — the row below carries a bare
   dispatch value with no prefix:

   dispatch: bare

## Edge Cases

None. This fixture is never executed; it is only ever read by the lint.
