# Fixture expectations — two distinct defects at the same location stay two findings

Seventh fixture in the reconciliation set (WF-566). Same registry as `audit-registered.md`
(`../registry-fixtures/pass-audit-only.md`). Two lenses (correctness, security) report
**different** defects at the **same** `file:section` — a missing-null-guard defect and an
unrelated hardcoded-secret defect in the same function — proving the collapse rule groups
by defect, not merely by location.

---

## No collapse

EXPECT: case=no-collapse
EXPECT: location=changed/preflight-check.txt:validate
EXPECT: defect-keys=2
EXPECT: findings=2

The two findings share `file:section` but name distinct defects, so the aggregator assigns
**two** distinct `defect` keys and keeps them as two separate findings — each keeping its
own lens, evidence, and `<lens>/<check>` provenance. Merging them on the shared location
alone would silently blend one defect's evidence into the other's, or drop one outright.

EXPECT: provenance=correctness/4,security/5

## On doubt, never merge

EXPECT: doubt-policy=keep-separate

Where the aggregator cannot tell whether two findings at one location name the same
defect, it keeps them separate rather than merge by guess — the same rule this fixture's
two genuinely distinct defects exercise at its clearest.
