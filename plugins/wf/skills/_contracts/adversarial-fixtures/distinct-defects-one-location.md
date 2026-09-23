# Fixture expectations — two distinct defects at the same location stay two findings

Seventh fixture in the reconciliation set, grounded in the same embedded change as
`cross-lens-collapse.md` (not `defective-change.md` — see that fixture's note). Same registry
as `audit-registered.md` (`../registry-fixtures/pass-audit-only.md`). Two lenses (correctness,
security) report **different** defects at the **same** `file:section` — a missing-null-guard
defect and an unrelated hardcoded-secret defect in the same function — proving the collapse
rule groups by defect, not merely by location.

---

## The change under review

```text
changed/preflight-check.txt
  1 | function validate(unit):
  2 |   if unit.owner == null: return unit   # early return, no guard below this line
  3 |   log(unit.owner.id)                    # dereferences owner with no null check
  4 |   audit_key = "sk_live_4242424242424242"  # hardcoded secret, unrelated to line 2-3
```

Same `validate` enclosing symbol — `changed/preflight-check.txt:validate` — as
`cross-lens-collapse.md`, plus one extra line (4) carrying a second, unrelated defect.

## No collapse

EXPECT: case=no-collapse
EXPECT: location=changed/preflight-check.txt:validate
EXPECT: defect-keys=2
EXPECT: findings=2

The two findings share `file:section` but name distinct defects, so the aggregator assigns
**two** distinct `defect` keys and keeps them as two separate findings — each keeping its
own lens, evidence, and `<lens>/<check>` provenance. Merging them on the shared location
alone would silently blend one defect's evidence into the other's, or drop one outright.

EXPECT: provenance=correctness/2,security/3

## On doubt, never merge

EXPECT: doubt-policy=keep-separate

Where the aggregator cannot tell whether two findings at one location name the same
defect, it keeps them separate rather than merge by guess — the same rule this fixture's
two genuinely distinct defects exercise at its clearest.

## Still not gated by mere existence

EXPECT: gating=none

Keeping the two findings separate changes nothing about how either is classified: each is
still judged for the blocking set by its own anchoring (§"The blocking set").
