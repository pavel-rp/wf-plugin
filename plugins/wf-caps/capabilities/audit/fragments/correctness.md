# Adversarial-correctness rubric (owned)

**Owned by:** the audit capability (`plugins/wf-caps/capabilities/audit/`)
**Read by:** `wf-caps:correctness-auditor` at the `verify` phase; **reused** by the WF-160
`sr` self-review lens over the working change — this is the **single owned copy**, never
re-authored elsewhere.
**Model:** claude-opus-4-8

---

The adversarial checklist for **correctness** — the bugs a confident author systematically
misses. It is authored caller-agnostic: the caller supplies the **work under review** (a
changed unit, a set of files, a scope). Read every changed unit and, for each check that
trips, emit one finding in the shared shape (`fragments/finding-contract.md`). Attack the
change — assume it is wrong until the evidence says otherwise. Skip nothing because it
"looks like a one-liner."

## Checks

1. **Ignored return values.** A call whose return carries a result, a status, or an
   error-signal is made but the value is discarded or unused. Look especially for functions
   that report failure *by return* (not by throwing) whose result is dropped. Evidence: the
   call site with no assignment/check. Severity: `fail` when the ignored value signals an
   error or carries the only copy of data; else `warn`.

2. **Null / undefined / absent handling.** A value that can be null/undefined/missing is
   dereferenced, indexed, spread, or destructured without a guard. Check optional lookups,
   map/dictionary access, first/last of a possibly-empty collection, and results of a call
   that can return "nothing found." Evidence: the unguarded access + the source that can be
   absent. Severity: `fail` when it can crash or corrupt; `warn` when only a degraded path.

3. **Silent data loss.** A write overwrites without merging, a mapping drops entries on key
   collision, a conversion truncates, a partial success is treated as full, or an
   accumulation resets. Evidence: the overwrite/convert site and the data that vanishes.
   Severity: `fail`.

4. **State / control-flow gaps.** A conditional or state transition omits a reachable case:
   a missing `else`/`default`, an unhandled state or enum member, an early-return that skips
   required cleanup, or re-entrancy the code does not tolerate. Evidence: the enumerated
   cases vs the ones handled. Severity: `fail` when the unhandled case is reachable with
   real inputs; else `warn`.

5. **Error handling.** An error is swallowed (empty catch, caught-and-ignored), caught too
   broadly (hiding unrelated failures), logged-but-not-propagated where the caller must
   know, or the failure leaves state half-updated. Evidence: the catch/guard and what it
   suppresses. Severity: `fail` when a real failure is hidden or state is left inconsistent.

6. **Unvalidated external data.** Input from outside the unit's trust boundary (arguments
   from callers not under review, parsed content, configuration, boundary values) is used
   without validating shape, range, or presence. Evidence: the use site + the untrusted
   source. Severity: `fail` when a malformed value corrupts or crashes; `warn` otherwise.
   (Injection-specific validation is the security lens's concern — cross-reference, don't
   duplicate.)

7. **Backward compatibility.** A change alters a shape, signature, default, or output that
   existing callers or persisted artifacts depend on, without preserving the old contract.
   Look for renamed/removed fields, reordered/added-required parameters, and changed default
   behavior. Evidence: the old contract (a call site or artifact still expecting it) vs the
   new. Severity: `fail` when an existing consumer breaks.

8. **Boundary conditions.** Off-by-one in ranges/indices/slices, empty-collection and
   single-element edges, zero/negative/overflow values, and inclusive-vs-exclusive bound
   mistakes. Evidence: the boundary expression + the edge input that breaks it. Severity:
   `fail` when a realistic edge is wrong.

9. **Untested branches.** A new branch, error path, or edge case has no exercising test
   where the surrounding code is otherwise tested, so a regression there is silent. Evidence:
   the branch + the absence of any test that reaches it. Severity: `warn` (a coverage gap),
   or `fail` when the untested branch is the change's core behavior.

## Discipline

- Report only issues you can cite with a concrete `file:line` and observed evidence.
- One finding per real defect; do not inflate one bug into several.
- Do not restate spec requirements the generic verify audit already checks — this lens adds
  the correctness defects a spec does not enumerate.
- When a defect has a bounded fix, name it in `recommendation`; when the right fix depends
  on intent you cannot infer, set `recommendation: escalate`.
