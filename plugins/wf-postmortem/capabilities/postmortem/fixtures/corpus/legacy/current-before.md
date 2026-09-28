# Postmortem — legacy report whose recorded high-water is above every kept id

**Model:** fixture
**Created:** 2026-08-07 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H5

- **H2** cache key omits the branch — suggested from `/sessions/l.jsonl` — checked — session side failed
- **H4** queue drained twice — suggested from `/sessions/m.jsonl` — checked — source side failed
- retry budget shared across runs — suggested from `no locator` — not checked — no locator

## Evidence Record

**Supporting**

- key built from task id only — locator: `/sessions/l.jsonl` | tier: reader-observed

**Disconfirming**

- none

---

POSTMORTEM — written
