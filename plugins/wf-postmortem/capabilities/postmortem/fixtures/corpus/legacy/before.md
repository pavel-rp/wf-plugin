# Postmortem — legacy report written before the report-state contract

**Model:** fixture
**Created:** 2026-08-01 10:00

---

## Contributing Factors

**Confirmed factors:**

- gate skipped on resume — `skills/run/SKILL.md:10` at version `1.0.0` — locator: `/sessions/a.jsonl` — tier: `mechanically-observed`

### Hypotheses

- **H2** retry counter resets — suggested from `/sessions/a.jsonl` — checked — source side failed
- ledger written after exit — suggested from `no locator` — not checked — no locator
- **H2** cap applied twice — suggested from `/sessions/b.jsonl` — checked — session side failed
- **H07** stale branch reused — suggested from `/sessions/c.jsonl` — not checked — malformed locator

## Evidence Record

**Supporting**

- counter reset observed — locator: `/sessions/a.jsonl` | tier: reader-observed
- scoreboard shows the ledger missing — locator: `_local/fleet/scoreboard.md` | tier: inferred [fallback evidence]

**Disconfirming**

- none

---

POSTMORTEM — written
