# Fixture expectations — a contributor errors or returns nothing

Third fixture in the reconciliation set. Same registry as `audit-registered.md`
(`../registry-fixtures/pass-audit-only.md`) and the same change under review
(`defective-change.md`); the only variable is that one contributor does not deliver.

The distinction this fixture exists to pin down is **silence is not cleanliness**. A
contributor that returns an empty `findings:` list has done its job and found nothing. A
contributor that errored, was unavailable, or returned an unparseable block has done *no*
job — and the two must not read the same way in the report.

---

## The failing contributor is stated, with its provenance

EXPECT: contributor=failed
EXPECT: failure-provenance=stated
EXPECT: coverage=incomplete

The run states which contributor failed, tagged with the same source-capability provenance a
delivered finding would carry, and marks the adversarial coverage **incomplete**. The
surviving findings are never presented as a complete adversarial pass.

## An empty return is not a failure

EXPECT: empty-return=clean

A contributor that returns a well-formed block with an empty `findings:` list is **clean**,
not failed. It raises no incompleteness and appears in no failure list. Conflating the two
would make every quiet run look broken.

## A failed contributor can never withdraw a core candidate

EXPECT: withdrawal=blocked-on-failure

Withdrawal requires a matching finding **actually in hand**. A contributor that failed
delivered none, so it can overlap nothing and can suppress nothing: every core candidate that
would have rendered in the empty-registry run still renders here. This is the safety property
that keeps a broken lens from silently shrinking the report — the failure mode that would
otherwise turn an outage into a quiet loss of findings.

## Still not a stop

EXPECT: gating=none

A failed contributor remains a no-op for the verdict, exactly as before: it is reported, not
raised. No STOP, no changed requirement verdict, and no change to the grepped `VERIFY —`
final-output block. The generic audit still stands.
