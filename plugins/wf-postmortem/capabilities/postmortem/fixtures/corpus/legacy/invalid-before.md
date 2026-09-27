# Postmortem — legacy report whose recorded high-water is not a valid id

**Model:** fixture
**Created:** 2026-08-03 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H0x

- **H3** cache key omits the branch — suggested from `/sessions/f.jsonl` — checked — session side failed
- **H1** queue drained twice — suggested from `/sessions/g.jsonl` — checked — source side failed
- retry budget shared across runs — suggested from `no locator` — not checked — no locator

## Evidence Record

**Supporting**

- key built from task id only — locator: `/sessions/f.jsonl` | tier: reader-observed

**Disconfirming**

- none

---

POSTMORTEM — written
