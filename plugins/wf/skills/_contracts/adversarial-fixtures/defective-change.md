# Fixture change — carries both adversarial defect classes

The defect-bearing input for the core lean adversarial pass. Run core `verify` over this
fixture against the empty registry `../registry-fixtures/pass-empty.md`; the pass must
report **both** classes below.

Each defect is stated with **both** sides present in this file, so the two-sided citation
rule is satisfiable without reaching outside the fixture. The `EXPECT:` markers are the
machine-checkable assertions the guard reads; the pass itself is judged on whether its
report names the same two defects.

---

## Existing code under `unit-intake` (context — unchanged by the change)

```text
existing/unit-descriptor.txt
  1 | field: difficulty
  2 | range: 1..10          # the declared range for `difficulty`
  3 | required: yes
```

```text
existing/batch-source.txt
  1 | emit unit { difficulty: 9 }    # a caller that legally produces 9
  2 | emit unit { difficulty: 3 }
  3 | emit batch { members: [] }     # a caller that legally produces an empty member list
```

---

## The change under review

```text
changed/preflight-check.txt
  1 | reject unit when difficulty < 1 or difficulty > 5
  2 | on reject: abort the run
```

```text
changed/batch-summary.txt
  1 | mean := sum(batch.members) / count(batch.members)
  2 | report mean
```

---

## DEFECT-1 — out-of-range bound

EXPECT: class=bound
EXPECT: changed-side=changed/preflight-check.txt:1
EXPECT: existing-side=existing/unit-descriptor.txt:2

The change bounds `difficulty` at `1..5`. The descriptor declares the range for that same
quantity as `1..10`, and `existing/batch-source.txt:1` legally emits `9`. The new predicate
therefore rejects valid units, and `changed/preflight-check.txt:2` escalates that rejection
into an aborted run. Both sides cite; the contradiction is literal, not inferred.

## DEFECT-2 — unstated assumption behind a derivation

EXPECT: class=assumption
EXPECT: changed-side=changed/batch-summary.txt:1
EXPECT: existing-side=existing/batch-source.txt:3

The change derives `mean` by dividing by `count(batch.members)`. Its correctness depends on
the member list being non-empty. The change neither states nor enforces that precondition,
and `existing/batch-source.txt:3` legally emits a batch with an empty member list. Both
sides cite; the unmet precondition is established by an existing line, not by its absence.
