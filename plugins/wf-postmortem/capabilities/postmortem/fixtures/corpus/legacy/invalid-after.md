# Postmortem — legacy report whose recorded high-water is not a valid id

**Model:** fixture
**Created:** 2026-08-03 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H4

- **H3** cache key omits the branch — suggested from `/sessions/f.jsonl` — checked — session side failed
- **H1** queue drained twice — suggested from `/sessions/g.jsonl` — checked — source side failed
- **H4** retry budget shared across runs — suggested from `no locator` — not checked — no locator

## Evidence Record

**Supporting**

- key built from task id only — locator: `/sessions/f.jsonl` | tier: reader-observed

**Disconfirming**

- none

## Continuation

**2026-09-03 09:00 follow-up:**
- Legacy state normalized: retry budget shared across runs — assigned H4 (no id); invalid recorded high-water "H0x" ignored — highest minted id derived from visible ids (H3) — an id retired before this report recorded its high-water cannot be recovered
- Newly read this run: none
- Fallback evidence drawn this run: none
- Fallback evidence suppressed (duplicate key): none
- Sections changed: none
- Recommendation: unchanged (rule `4` still fires)

---

POSTMORTEM — written
