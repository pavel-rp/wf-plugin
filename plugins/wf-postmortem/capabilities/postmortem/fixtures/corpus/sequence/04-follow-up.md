# Postmortem — verify loop repeats the same finding

**Model:** fixture
**Created:** 2026-09-01 10:00

---

## Summary

Fixture report, third follow-up: a new mechanism appears after every earlier id was retired; it is
minted H4, never H1.

## Contributing Factors

**Confirmed factors:**

- fix step re-applies a reverted edit — `skills/fix/SKILL.md:40` at version `1.2.0` — locator: `/sessions/s1.jsonl` — tier: `mechanically-observed` — retired id: H1
- audit rerun ignores the prior ledger — `skills/audit/SKILL.md:12` at version `1.2.0` — locator: `/sessions/s3.jsonl` — tier: `independently-verified` — retired id: H2
- run exits before writing its report — `skills/run/SKILL.md:88` at version `1.2.0` — locator: `/sessions/s3.jsonl` — tier: `independently-verified` — retired id: H3

### Hypotheses

**Highest minted id:** H4

- **H4** checker reads a stale artifact — suggested from `/sessions/s4.jsonl` — checked — session side failed

## Evidence Record

**Supporting**

- same finding listed in two rounds — locator: `/sessions/s1.jsonl` | tier: reader-observed
- round tally repeats — locator: `_local/T101` | tier: mechanically-observed [fallback evidence] · draw key: `(a) | /sessions/s1.jsonl | _local/T101 | H1`
- scoreboard shows two stalled attempts — locator: `_local/fleet/scoreboard.md` | tier: inferred [fallback evidence] · draw key: `(a) | no locator | _local/fleet/scoreboard.md | H2`
- task folder has a plan but no report — locator: `_local/T205` | tier: inferred [fallback evidence] · draw key: `(b-ii) | task:205`
- commit subject names the same task — locator: `delivery:c1` | tier: inferred [fallback evidence] · draw key: `(b-ii) | task:205`
- eval log records the ledger being skipped — locator: `logs/eval.log` | tier: inferred [fallback evidence] · draw key: `(a) | no locator | logs/eval.log | H2`
- scoreboard shows the checker reran twice — locator: `_local/fleet/scoreboard.md` | tier: inferred [fallback evidence] · draw key: `(a) | /sessions/s4.jsonl | _local/fleet/scoreboard.md | H4`

**Disconfirming**

- none

## Coverage

- `/sessions/s1.jsonl` — read · date: 2026-08-30 · model: small · tier: requested
- `/sessions/s2.jsonl` — read · date: 2026-08-31 · model: small · tier: requested
- `/sessions/s3.jsonl` — read · date: 2026-09-02 · model: small · tier: requested
- `/sessions/s4.jsonl` — read · date: 2026-09-06 · model: small · tier: requested

**Read cap:** 15 in force (default)

## Recommendation

**Rule fired:** 2 — three confirmed factors

## Continuation

**2026-09-03 09:00 follow-up:**
- Legacy state normalized: none
- Newly read this run: `/sessions/s3.jsonl`
- Newly capped this run: none
- Requested but not reached this run: none
- Retry failed, prior evidence retained: none
- Moved to "sessions this hunt cannot see": none
- Fallback evidence drawn this run: `(a) | no locator | logs/eval.log | H2` — trigger (a)
- Fallback evidence retired this run: none
- Fallback evidence suppressed (duplicate key): `(a) | /sessions/s1.jsonl | _local/T101 | H1` — already present, nothing drawn; `(a) | no locator | _local/fleet/scoreboard.md | H2` — already present, nothing drawn; `(b-ii) | task:205` — already present, nothing drawn
- Sections changed: none
- Recommendation: unchanged (rule `3` still fires)

**2026-09-05 09:00 follow-up:**
- Legacy state normalized: none
- Newly read this run: `/sessions/s3.jsonl`
- Newly capped this run: none
- Requested but not reached this run: none
- Retry failed, prior evidence retained: none
- Moved to "sessions this hunt cannot see": none
- Fallback evidence drawn this run: none
- Fallback evidence retired this run: `(a) | /sessions/s1.jsonl | _local/T101 | H1` — confirmed from sessions; no further fallback evidence drawn; `(a) | no locator | _local/fleet/scoreboard.md | H2` — confirmed from sessions; no further fallback evidence drawn; `(b-ii) | task:205` — confirmed from sessions; no further fallback evidence drawn
- Fallback evidence suppressed (duplicate key): none
- Sections changed: Summary | Contributing Factors | Component and Version | Localisation
- Recommendation: changed — rule `3` → rule `2`; Charter recommended — `/wf:charter`

**2026-09-07 09:00 follow-up:**
- Legacy state normalized: none
- Newly read this run: `/sessions/s4.jsonl`
- Newly capped this run: none
- Requested but not reached this run: none
- Retry failed, prior evidence retained: none
- Moved to "sessions this hunt cannot see": none
- Fallback evidence drawn this run: `(a) | /sessions/s4.jsonl | _local/fleet/scoreboard.md | H4` — trigger (a)
- Fallback evidence retired this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: Contributing Factors
- Recommendation: unchanged (rule `2` still fires)

---

POSTMORTEM — written
