# Postmortem — legacy report whose invalid recorded high-water leaves no valid visible id

**Model:** fixture
**Created:** 2026-08-06 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H1

- **H1** schema cache survives a migration — suggested from `/sessions/k.jsonl` — checked — session side failed

## Evidence Record

**Supporting**

- cached column list after migrate — locator: `/sessions/k.jsonl` | tier: reader-observed

**Disconfirming**

- none

## Continuation

**2026-09-06 09:00 follow-up:**
- Legacy state normalized: schema cache survives a migration — assigned H1 (no id); invalid recorded high-water "H0" ignored — highest minted id derived from visible ids (none) — an id retired before this report recorded its high-water cannot be recovered
- Newly read this run: none
- Fallback evidence drawn this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: none
- Recommendation: unchanged (rule `4` still fires)

---

POSTMORTEM — written
