# Fixture expectations — a contributor fails on a run with zero core candidates

Fifth fixture in the reconciliation set. Same registry as `audit-registered.md`
(`../registry-fixtures/pass-audit-only.md`), but run over the defect-free change
(`clean-change.md`) so the lean pass raises **no** core candidates; the only variable is that
one contributor errors and returns an unparseable block.

This is the sharpest case the omission rule can suppress. With zero candidates and zero
surviving findings, an unconditional omission would drop the section — and with it the
incomplete-coverage mark — making a **failed** adversarial pass render byte-for-byte like a
clean one. That is precisely the outcome the "silence is not cleanliness" rule forbids, so the
section must render on the Coverage record alone.

---

## The section is present on the Coverage record alone

EXPECT: section=present
EXPECT: candidates=0
EXPECT: findings=0

The lean pass raised no candidates and nothing was withdrawn, so both lists above the Coverage
record are empty. The `## Adversarial findings` section is still rendered, because the run has
something to record. A section carrying only a Coverage record is a correct render.

## The failure is stated, with its provenance, and marks coverage incomplete

EXPECT: contributor=failed
EXPECT: failure-provenance=stated
EXPECT: coverage=incomplete

The run names which contributor failed, tagged with the same source-capability provenance a
delivered finding would carry, and marks the adversarial coverage **incomplete**.

## A failed pass is never presented as a clean one

EXPECT: clean-run=distinguishable

This fixture and `clean-change.md` share the same change under review, and both end with zero
findings. They must **not** produce the same report: the clean run omits the section entirely,
this run renders it carrying the incomplete-coverage mark. If the two ever render alike, the
omission rule has re-acquired precedence over the Coverage record and this fixture has
regressed.

## Still not a stop

EXPECT: gating=none

A failed contributor remains a no-op for the verdict: it is reported, not raised. No STOP, no
changed requirement verdict, and no change to the grepped `VERIFY —` final-output block. The
generic audit still stands.
