# Postmortem — legacy report with no high-water line and no valid visible id

**Model:** fixture
**Created:** 2026-08-05 10:00

---

## Contributing Factors

**Confirmed factors:**

- none

### Hypotheses

- worker exits before the ack is flushed — suggested from `/sessions/j.jsonl` — checked — source side failed
- lease renewed with a stale clock — suggested from `no locator` — not checked — no locator

## Evidence Record

**Supporting**

- ack written after exit — locator: `/sessions/j.jsonl` | tier: reader-observed

**Disconfirming**

- none

---

POSTMORTEM — written
