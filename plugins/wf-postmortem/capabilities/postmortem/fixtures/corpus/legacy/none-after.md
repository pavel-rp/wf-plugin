# Postmortem — legacy report that recorded no minted id while visible ids exist

**Model:** fixture
**Created:** 2026-08-04 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H3

- **H2** stale cache served after deploy — suggested from `/sessions/h.jsonl` — checked — source side failed
- **H3** lock released before flush — suggested from `/sessions/i.jsonl` — not checked — no locator

## Evidence Record

**Supporting**

- cache hit after deploy — locator: `/sessions/h.jsonl` | tier: reader-observed

**Disconfirming**

- none

## Continuation

**2026-09-04 09:00 follow-up:**
- Legacy state normalized: lock released before flush — assigned H3 (no id); recorded high-water none raised to H2
- Newly read this run: none
- Fallback evidence drawn this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: none
- Recommendation: unchanged (rule `4` still fires)

---

POSTMORTEM — written
