# Postmortem — legacy report whose recorded high-water fell behind its visible ids

**Model:** fixture
**Created:** 2026-08-02 10:00

---

## Contributing Factors

**Confirmed factors:**

- verdict consumed before write — `skills/verify/SKILL.md:20` at version `1.0.0` — locator: `/sessions/d.jsonl` — tier: `mechanically-observed` — retired id: H5

### Hypotheses

**Highest minted id:** H2

- **H1** lock file left behind — suggested from `/sessions/d.jsonl` — checked — source side failed
- timer never re-armed — suggested from `/sessions/e.jsonl` — not checked — no locator

## Evidence Record

**Supporting**

- verdict consumed at step 3 — locator: `/sessions/d.jsonl` | tier: reader-observed

**Disconfirming**

- none

---

POSTMORTEM — written
