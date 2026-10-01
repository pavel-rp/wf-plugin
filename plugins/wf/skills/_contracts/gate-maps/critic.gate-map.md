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

A critic that did not run — a malformed or failed dispatch, or an unrecorded, failed or mismatched
critic-boundary hand-back — keeps every candidate blocking (fail-closed, reported `not run`); that
is a property of the dispatch, not of any verdict label, so it adds no row here. A verdict consumed
at the critic boundary is an independent run and maps through the rows above unchanged.
