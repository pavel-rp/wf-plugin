# Consistency lens rubric

**Owned by:** the audit capability (`plugins/wf-caps/capabilities/audit/`)
**Read by:** `wf-caps:consistency-auditor` at the `verify` phase
**Model:** claude-opus-4-8

---

The adversarial checklist for **consistency** — where the hunks of one change contradict
each other. The caller supplies the **work under review**. This lens reasons **across** the
whole change, not one file in isolation: read every hunk, then check that they agree. For
each trip, emit one finding in the shared shape (`fragments/finding-contract.md`).

## Checks

1. **Derivation consistency.** The same value is computed or derived one way in one hunk and
   a different way in another — a different formula, rounding, unit, or source — so the two
   can disagree on real inputs. Evidence: the two derivations. Severity: `fail` when they can
   diverge; `warn` when only cosmetic.

2. **Persistence / response alignment.** What is stored, what is returned, and what is
   surfaced for the same concept disagree — a field written but never returned, returned but
   never populated, or renamed on one side of the change only. Evidence: the two sides.
   Severity: `fail` when a consumer sees the mismatch.

3. **Guard completeness.** A validation, guard, or permission check added in one hunk is
   missing from a parallel hunk that needs the same protection — one of two sibling paths
   guarded, the other left open. Evidence: the guarded path vs the unguarded sibling.
   Severity: `fail`.

4. **Naming alignment.** The same concept is spelled two ways across hunks — a variable, key,
   constant, or identifier for one thing named inconsistently — risking a silent mismatch.
   Evidence: the two names for the one concept. Severity: `warn`, or `fail` when a lookup or
   comparison keys on the mismatched name.

## Discipline

- Read the entire change before judging — a single hunk cannot reveal a contradiction.
- Report only pairs you can cite on both sides with `file:line`.
- One finding per contradicting pair.
- Name the side that should change in `recommendation`; set `recommendation: escalate` when
  either side could be the intended one and you cannot tell.
