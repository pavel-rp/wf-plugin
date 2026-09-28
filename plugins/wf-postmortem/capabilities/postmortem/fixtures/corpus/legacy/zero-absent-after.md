# Postmortem — legacy report with no high-water line and no valid visible id

**Model:** fixture
**Created:** 2026-08-05 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H2

- **H1** worker exits before the ack is flushed — suggested from `/sessions/j.jsonl` — checked — source side failed
- **H2** lease renewed with a stale clock — suggested from `no locator` — not checked — no locator

## Evidence Record

**Supporting**

- ack written after exit — locator: `/sessions/j.jsonl` | tier: reader-observed

**Disconfirming**

- none

## Continuation

**2026-09-05 09:00 follow-up:**
- Legacy state normalized: worker exits before the ack is flushed — assigned H1 (no id); lease renewed with a stale clock — assigned H2 (no id); highest minted id derived from visible ids (none) — an id retired before this report recorded its high-water cannot be recovered
- Newly read this run: none
- Fallback evidence drawn this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: none
- Recommendation: unchanged (rule `4` still fires)

---

POSTMORTEM — written
