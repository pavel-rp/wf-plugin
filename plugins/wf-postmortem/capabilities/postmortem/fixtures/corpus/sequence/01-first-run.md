# Postmortem — verify loop repeats the same finding

**Model:** fixture
**Created:** 2026-09-01 10:00

---

## Summary

Fixture report, first run.

## Contributing Factors

**Confirmed factors:** none confirmed this run — every mechanism below is checked two-sided before promotion; none passed both sides.

### Hypotheses

**Highest minted id:** H3

- **H1** fix step re-applies a reverted edit — suggested from `/sessions/s1.jsonl` — checked — source side failed
- **H2** audit rerun ignores the prior ledger — suggested from `no locator` — not checked — no locator
- **H3** run exits before writing its report — suggested from `task:205` — fallback evidence only — trigger (b): matched run left no session record

## Evidence Record

**Supporting**

- same finding listed in two rounds — locator: `/sessions/s1.jsonl` | tier: reader-observed
- round tally repeats — locator: `_local/T101` | tier: mechanically-observed [fallback evidence] · draw key: `(a) | /sessions/s1.jsonl | _local/T101 | H1`
- scoreboard shows two stalled attempts — locator: `_local/fleet/scoreboard.md` | tier: inferred [fallback evidence] · draw key: `(a) | no locator | _local/fleet/scoreboard.md | H2`
- task folder has a plan but no report — locator: `_local/T205` | tier: inferred [fallback evidence] · draw key: `(b-ii) | task:205`
- commit subject names the same task — locator: `delivery:c1` | tier: inferred [fallback evidence] · draw key: `(b-ii) | task:205`

**Disconfirming**

- none

## Coverage

- `/sessions/s1.jsonl` — read · date: 2026-08-30 · model: small · tier: requested
- `/sessions/s2.jsonl` — read · date: 2026-08-31 · model: small · tier: requested

**Read cap:** 15 in force (default)

## Recommendation

**Rule fired:** 3 — fix direction resting on an open choice

---

POSTMORTEM — written
