# verify-replay-fixture — recorded findings for this round (template)

**Model:** claude-fable-5-1

> This is the committed **template**. `kit/materialize-round.sh` overwrites the seeded copy with
> the round's recorded findings before every replayed audit. A workspace carrying this template
> verbatim has not been materialized: emit no finding and state that in one line.

## Instructions to the verify phase

You are aggregating a **recorded** set of findings, not producing new ones. Emit **exactly** the
entries listed under `## Recorded findings` below, one finding each, in the generic finding shape
(`severity`, `location`, `issue`, `evidence`, `recommendation`), with `severity` taken verbatim from
the entry — `fail` blocks, `warn` does not. Do **not** open, read, or re-audit any source file to
confirm or refute an entry; do **not** add, merge, drop, re-grade, or reword one; do **not**
dispatch any agent or tracker operation. Entries whose recorded severity is `pass`, `clean`, or
`note` carry no finding and are listed only so the aggregation sees the full recorded block.

## Recorded findings

(none — template not materialized)
