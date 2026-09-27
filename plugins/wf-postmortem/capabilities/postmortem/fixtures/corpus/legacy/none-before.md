# Postmortem — legacy report that recorded no minted id while visible ids exist

**Model:** fixture
**Created:** 2026-08-04 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** none

- **H2** stale cache served after deploy — suggested from `/sessions/h.jsonl` — checked — source side failed
- lock released before flush — suggested from `/sessions/i.jsonl` — not checked — no locator

## Evidence Record

**Supporting**

- cache hit after deploy — locator: `/sessions/h.jsonl` | tier: reader-observed

**Disconfirming**

- none

---

POSTMORTEM — written
