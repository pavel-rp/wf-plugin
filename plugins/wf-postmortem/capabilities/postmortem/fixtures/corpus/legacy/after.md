# Postmortem — legacy report written before the report-state contract

**Model:** fixture
**Created:** 2026-08-01 10:00

---

## Contributing Factors

**Confirmed factors:**

- gate skipped on resume — `skills/run/SKILL.md:10` at version `1.0.0` — locator: `/sessions/a.jsonl` — tier: `mechanically-observed` — retired id: H3

### Hypotheses

**Highest minted id:** H6

- **H2** retry counter resets — suggested from `/sessions/a.jsonl` — checked — source side failed
- **H4** ledger written after exit — suggested from `no locator` — not checked — no locator
- **H5** cap applied twice — suggested from `/sessions/b.jsonl` — checked — session side failed
- **H6** stale branch reused — suggested from `/sessions/c.jsonl` — not checked — malformed locator

## Evidence Record

**Supporting**

- counter reset observed — locator: `/sessions/a.jsonl` | tier: reader-observed
- scoreboard shows the ledger missing — locator: `_local/fleet/scoreboard.md` | tier: inferred [fallback evidence]

**Disconfirming**

- none

## Continuation

**2026-09-01 09:00 follow-up:**
- Legacy state normalized: gate skipped on resume — assigned H3 (no id); ledger written after exit — assigned H4 (no id); cap applied twice — assigned H5 (duplicate of H2); stale branch reused — assigned H6 (invalid id "H07"); highest minted id derived from visible ids (H2) — an id retired before this report recorded its high-water cannot be recovered; fallback entry without draw key kept: `_local/fleet/scoreboard.md`
- Newly read this run: none
- Fallback evidence drawn this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: Contributing Factors
- Recommendation: unchanged (rule `3` still fires)

---

POSTMORTEM — written
