# Postmortem — legacy report whose recorded high-water equals the highest kept id

**Model:** fixture
**Created:** 2026-08-08 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H3

- **H3** lock released before flush — suggested from `/sessions/n.jsonl` — checked — source side failed
- **H1** stale cache served after deploy — suggested from `/sessions/o.jsonl` — not checked — no locator

## Evidence Record

**Supporting**

- flush after unlock — locator: `/sessions/n.jsonl` | tier: reader-observed

**Disconfirming**

- none

## Continuation

**2026-09-08 09:00 follow-up:**
- Legacy state normalized: none
- Newly read this run: none
- Fallback evidence drawn this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: none
- Recommendation: unchanged (rule `4` still fires)

---

POSTMORTEM — written
