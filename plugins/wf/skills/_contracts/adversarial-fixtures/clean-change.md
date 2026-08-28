# Fixture change — defect-free, paired control

The clean input for the core lean adversarial pass, paired with `defective-change.md`. Run
core `verify` over this fixture against the empty registry
`../registry-fixtures/pass-empty.md`; the pass must report **zero** adversarial findings and
omit the report's `## Adversarial findings` section entirely.

This is the measurement that a lean default shipped to every project does not fabricate.
The fixture is deliberately built to *bait* each suppressed form and offer no second
citation for any of them.

---

## Existing code under `unit-intake` (context — unchanged by the change)

```text
existing/unit-descriptor.txt
  1 | field: difficulty
  2 | range: 1..10
  3 | required: yes
```

```text
existing/batch-source.txt
  1 | emit unit { difficulty: 9 }
  2 | emit unit { difficulty: 3 }
  3 | emit batch { members: [] }
```

---

## The change under review

```text
changed/preflight-check.txt
  1 | reject unit when difficulty < 1 or difficulty > 10
  2 | on reject: record the unit and continue
```

```text
changed/batch-summary.txt
  1 | when count(batch.members) = 0: report mean = none
  2 | otherwise mean := sum(batch.members) / count(batch.members)
  3 | report mean
```

```text
changed/retry-policy.txt
  1 | retries: 2
```

---

## Expected result

EXPECT: findings=0

Neither defect class is present, and each suppressed form is baited and unsupported:

- **No out-of-range bound.** `changed/preflight-check.txt:1` bounds `difficulty` at `1..10`,
  matching `existing/unit-descriptor.txt:2` exactly. No existing line contradicts it, so no
  second citation exists.
- **No unstated assumption.** `changed/batch-summary.txt:1` states and enforces the
  non-empty precondition the derivation on line 2 depends on, covering
  `existing/batch-source.txt:3`. The precondition is met, not merely unmentioned.
- **Absence-as-evidence is baited.** The fixture carries no test file, no error handler, and
  no logging for either changed unit. Each of those is an *absence*, has no line number, and
  is therefore not citable — so none of them is reportable.
- **Restated risk is baited.** `changed/retry-policy.txt:1` lowers a retry count. Nothing in
  the fixture defines a different value for that quantity and no derivation depends on the
  old one, so "lowering retries could cause failures under load" restates the change as a
  hazard without contradicting any line. No second citation, no finding.
- **Style nits are baited.** The three changed files use three different phrasings for the
  same conditional shape. Preference is out of scope for both classes.
