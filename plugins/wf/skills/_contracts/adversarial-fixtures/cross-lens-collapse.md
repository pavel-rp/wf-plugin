# Fixture expectations — four lenses report the same defect at one location

Sixth fixture in the reconciliation set, grounded in its own embedded change below rather
than `defective-change.md`: that fixture's `changed/preflight-check.txt` carries no enclosing
symbol, so it cannot exercise a `file:section` shared by several lenses. Same registry as
`audit-registered.md` (`../registry-fixtures/pass-audit-only.md`) — the real five lenses,
unchanged. Unlike the other fixtures in this set (which cover the lean-pass/lens
reconciliation), this one tests the cross-lens collapse rule in isolation: four of the five
lenses (correctness, security, convention, consistency) each independently report the
**same** real defect at the **same** `file:section`, on their own evidence and their own
rubric `check:` number. The fifth lens (operational) is clean.

---

## The change under review

```text
changed/validate-unit.txt
  1 | function validate(unit):
  2 |   if unit.owner == null: return unit   # early return, no guard below this line
  3 |   log(unit.owner.id)                    # dereferences owner with no null check
```

The path is this fixture's own — `changed/preflight-check.txt` already names different
content in `defective-change.md`, so one path never names two files across the set. The
enclosing symbol is `validate` (a function declaration), so `file:section` resolves to
`changed/validate-unit.txt:validate` per the existing location derivation (enclosing
symbol/declaration for source).

## The collapse

EXPECT: case=collapse
EXPECT: fingerprint=changed/validate-unit.txt:validate|missing-null-guard
EXPECT: lenses=correctness,security,convention,consistency
EXPECT: defect-keys=1

Four lens findings at one location, naming the same defect (line 3's dereference of
`unit.owner.id` is unguarded on the path where `unit.owner` is not the early-returned
`null` case but some other falsy/absent shape the guard misses), collapse into **one**
finding. Each lens reaches it through its own rubric item: correctness through absent-value
handling (2), security through error leakage (6), because the thrown dereference error
carries the unit's internals to the caller, convention through behavioral parity (2),
because the file's sibling validators guard `owner` before use, and consistency through
guard completeness (3). The collapsed finding lists all four contributing lenses, each lens's own
`evidence` string, and each lens's own `<lens>/<check>` provenance — none dropped, edited,
or re-tagged. The fifth lens (operational) delivered a clean result and contributes
nothing at this location.

EXPECT: provenance=correctness/2,security/6,convention/2,consistency/3
EXPECT: evidence=preserved-per-lens

## Severity disagreement

EXPECT: severity-case=disagreement
EXPECT: contributor-severities=correctness:fail,security:warn
EXPECT: collapsed-severity=fail
EXPECT: anchor-if-any=true

Correctness reports this defect as `fail`, citing the changed line 3; security reports it
as `warn`, citing line 2. The collapsed finding takes the higher severity — `fail` — and is
anchored because at least one contributor (correctness) anchors it. A collapsed finding's
severity is never averaged, downgraded to the weakest contributor, or decided by which lens
happened to report first.

## Identity is the fingerprint, matched on any cited line

EXPECT: identity=fingerprint
EXPECT: cited-lines=changed/validate-unit.txt:2,changed/validate-unit.txt:3
EXPECT: identity-match=any-cited-line

The contributors cite different lines (2 and 3) inside the shared `validate` section, so the
collapsed finding's identity is its fingerprint, and both lines stay its cited lines. Every
identity test matches on any of them: the blocking-set anchor test finds line 3 inside the
diff, and a core lean-pass candidate whose changed-side citation is line 2 overlaps this
finding although the anchoring contributor cited line 3. No single lens's line decides the
match.

## Every lens and its cited line survive the render

EXPECT: cited-line=kept-per-contributor
EXPECT: dropped-lens=rejected

The collapsed finding renders under its fingerprint with one nested line per contributor,
each naming its `<lens>/<check>` **and** its own cited `file:L` — the line `/wf:verify-fix`
edits at. The guard's collapse evaluator accepts the first block below and must reject the
other two: one drops a contributing lens (`security/6`), the other keeps every lens but drops
the cited lines.

```render-accepted
- **audit** — [FAIL] owner is dereferenced without a null guard at `changed/validate-unit.txt:validate|missing-null-guard` — collapsed from 4 lenses:
  - `correctness/2` at `changed/validate-unit.txt:3` — `log(unit.owner.id)` runs with no owner check — Remedy: guard `unit.owner` before line 3
  - `security/6` at `changed/validate-unit.txt:2` — the early return leaves the thrown dereference error reaching the caller
  - `convention/2` at `changed/validate-unit.txt:3` — sibling validators guard `owner` before use
  - `consistency/3` at `changed/validate-unit.txt:3` — the guard at line 2 does not cover the line-3 dereference
```

```render-dropped-lens
- **audit** — [FAIL] owner is dereferenced without a null guard at `changed/validate-unit.txt:validate|missing-null-guard` — collapsed from 3 lenses:
  - `correctness/2` at `changed/validate-unit.txt:3` — `log(unit.owner.id)` runs with no owner check
  - `convention/2` at `changed/validate-unit.txt:3` — sibling validators guard `owner` before use
  - `consistency/3` at `changed/validate-unit.txt:3` — the guard at line 2 does not cover the line-3 dereference
```

```render-dropped-line
- **audit** — [FAIL] owner is dereferenced without a null guard at `changed/validate-unit.txt:validate|missing-null-guard` — collapsed from 4 lenses:
  - `correctness/2` — `log(unit.owner.id)` runs with no owner check
  - `security/6` — the early return leaves the thrown dereference error reaching the caller
  - `convention/2` — sibling validators guard `owner` before use
  - `consistency/3` — the guard at line 2 does not cover the line-3 dereference
```

## Still not gated by mere existence

EXPECT: gating=none

The collapse changes the finding **count**, never the blocking-set classification of the
survivor: whether the collapsed finding blocks is still decided by anchoring (§"The
blocking set"), unchanged by this fixture.
