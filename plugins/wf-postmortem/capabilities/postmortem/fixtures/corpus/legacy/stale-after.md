# Postmortem — legacy report whose recorded high-water fell behind its visible ids

**Model:** fixture
**Created:** 2026-08-02 10:00

---

## Contributing Factors

**Confirmed factors:**

- verdict consumed before write — `skills/verify/SKILL.md:20` at version `1.0.0` — locator: `/sessions/d.jsonl` — tier: `mechanically-observed` — retired id: H5

### Hypotheses

**Highest minted id:** H6

- **H1** lock file left behind — suggested from `/sessions/d.jsonl` — checked — source side failed
- **H6** timer never re-armed — suggested from `/sessions/e.jsonl` — not checked — no locator

## Evidence Record

**Supporting**

- verdict consumed at step 3 — locator: `/sessions/d.jsonl` | tier: reader-observed

**Disconfirming**

- none

## Continuation

**2026-09-02 09:00 follow-up:**
- Legacy state normalized: timer never re-armed — assigned H6 (no id); recorded high-water H2 raised to H5
- Newly read this run: none
- Fallback evidence drawn this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: none
- Recommendation: unchanged (rule `3` still fires)

---

POSTMORTEM — written
