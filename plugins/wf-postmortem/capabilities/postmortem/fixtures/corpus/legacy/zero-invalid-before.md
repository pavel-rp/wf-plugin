# Postmortem — legacy report whose invalid recorded high-water leaves no valid visible id

**Model:** fixture
**Created:** 2026-08-06 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

**Highest minted id:** H0

- schema cache survives a migration — suggested from `/sessions/k.jsonl` — checked — session side failed

## Evidence Record

**Supporting**

- cached column list after migrate — locator: `/sessions/k.jsonl` | tier: reader-observed

**Disconfirming**

- none

---

POSTMORTEM — written
