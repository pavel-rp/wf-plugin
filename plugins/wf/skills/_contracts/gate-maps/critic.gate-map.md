# Gate map — verify-spec critic

**Layer:** the isolated critic that confirms or refutes verify-spec's candidate blocking findings
**Grammar source:** `../../verify-spec/references/critic-verdict.md` · block `CRITIC —` · anchor `verdict:`
**Labels:** declared
**Model:** claude-opus-5-5

| Label | Eligibility | Basis |
|---|---|---|
| AGREE | may-block | `verify-spec/SKILL.md` — "`AGREE` blocks": a confirmed candidate stays in the blocking set |
| DISAGREE | advisory | `verify-spec/SKILL.md` — a `DISAGREE`d candidate moves to `## Accepted warnings` (ledger `refuted`) |
| UNVERIFIABLE | advisory | `verify-spec/SKILL.md` — an `UNVERIFIABLE` candidate moves to `## Accepted warnings` (ledger `warn`) |

A malformed or failed critic dispatch keeps every candidate blocking (fail-closed); that is a
property of the dispatch, not of any verdict label, so it adds no row here.
