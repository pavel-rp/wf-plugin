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
changed/validate-unit.txt
  1 | function validate(unit):
  2 |   if unit.owner == null: return unit   # early return, no guard below this line
  3 |   log(unit.owner.id)                    # dereferences owner with no null check
  4 |   audit_key = "sk_live_4242424242424242"  # hardcoded secret, unrelated to line 2-3
  5 |   return lookup(unit.owner.id, audit_key) # second dereference, feeds the secret onward
```

Same `validate` enclosing symbol — `changed/validate-unit.txt:validate` — as
`cross-lens-collapse.md`, plus two extra lines: line 4 carries a second, unrelated defect, and
line 5 is where the ambiguous pair below meets.

## No collapse

EXPECT: case=no-collapse
EXPECT: location=changed/validate-unit.txt:validate
EXPECT: defect-keys=2
EXPECT: findings=2

The two findings share `file:section` but name distinct defects, so the aggregator assigns
**two** distinct `defect` keys and keeps them as two separate findings — each keeping its
own lens, evidence, and `<lens>/<check>` provenance. Merging them on the shared location
alone would silently blend one defect's evidence into the other's, or drop one outright.

EXPECT: provenance=correctness/2,security/3

## On doubt, never merge

EXPECT: doubt-policy=keep-separate
EXPECT: ambiguous-case=same-line-different-checks
EXPECT: ambiguous-defect-keys=2
EXPECT: ambiguous-findings=2

An ambiguous pair: correctness reports line 5's second unguarded dereference of
`unit.owner.id` (check 2, absent-value handling), and security reports line 5 passing
`audit_key` onward to `lookup` (check 3, secrets exposure). Both cite the same line in the
same section, and both issue lines mention `unit.owner.id`. Whether they name one defect or
two cannot be told from the blocks alone. The aggregator keeps them separate, as two findings
with distinct `defect` keys, and drops neither. It never merges by guess.

## Whole-run totals

EXPECT: total-defect-keys=4
EXPECT: total-findings=4

The two pairs are four lens findings from one run over one change, all in the `validate`
section. `defect-keys=2` and `findings=2` above count the first pair only; the
`ambiguous-` lines count the ambiguous pair only. The pairs are counted apart and never
merged with each other: the ambiguous pair's line-5 dereference is not folded into the first
pair's line-3 missing-null-guard, on the same never-merge-on-doubt rule. So the run's report
carries **four** findings under four distinct fingerprints, not two:

- `changed/validate-unit.txt:validate|missing-null-guard` — `correctness/2` at `changed/validate-unit.txt:3`
- `changed/validate-unit.txt:validate|hardcoded-secret` — `security/3` at `changed/validate-unit.txt:4`
- `changed/validate-unit.txt:validate|second-unguarded-dereference` — `correctness/2` at `changed/validate-unit.txt:5`
- `changed/validate-unit.txt:validate|secret-passed-onward` — `security/3` at `changed/validate-unit.txt:5`

## Still not gated by mere existence

EXPECT: gating=none

Keeping the findings separate changes nothing about how either is classified: each is still
judged for the blocking set by its own anchoring (§"The blocking set").
