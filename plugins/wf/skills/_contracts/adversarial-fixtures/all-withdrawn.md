# Fixture expectations — reconciliation withdraws every core candidate

Fourth fixture in the reconciliation set. Same registry as `audit-registered.md`
(`../registry-fixtures/pass-audit-only.md`) and the same change under review
(`defective-change.md`); the only variable is that reconciliation withdraws **both** core
candidates instead of one, so **zero** survive.

The distinction this fixture exists to pin down is that **the omission rule is subordinate to
the records it would suppress**. A withdrawal is not a disappearance: the Withdrawn record is
what makes a suppressed candidate visible rather than silently absent, so a run that withdrew
everything has *more* to report than a clean one, not less.

---

## The section is present even though nothing survived

EXPECT: section=present
EXPECT: findings=0

Both core candidates are withdrawn, so the surviving-findings list is empty. The
`## Adversarial findings` section is still rendered: the run has something to record, and the
omission rule applies only to a run that has nothing. Rendering an empty-of-findings section
here is correct, not a placeholder — the section carries the Withdrawn lines below.

## Every withdrawal is rendered, one line each

EXPECT: withdrawn=rendered
EXPECT: withdrawn-count=2

Each withdrawn candidate gets its own Withdrawn line naming the candidate, its changed-side
citation, and the reason it was withdrawn. Neither is quietly dropped from the list above and
neither is merged into the other. This is the record that would vanish under the unconditional
reading of the omission rule, and it is exactly why the rule is subordinated.

## Withdrawal is still one-directional

EXPECT: lens-findings=preserved

Withdrawal acts on the **core** side only. The contributor's own findings are untouched — not
dropped, edited, re-tagged, merged, reordered, or withheld — and still render with their
provenance. Nothing about an all-withdrawn run relaxes that.

## Still not a stop

EXPECT: gating=none

An all-withdrawn run remains a no-op for the verdict: it is reported, not raised. No STOP, no
changed requirement verdict, and no change to the grepped `VERIFY —` final-output block.
