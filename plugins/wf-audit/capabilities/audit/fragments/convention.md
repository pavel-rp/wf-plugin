# Convention lens rubric

**Owned by:** the audit capability (`plugins/wf-caps/capabilities/audit/`)
**Read by:** `wf-caps:convention-auditor` at the `verify` phase
**Model:** claude-opus-4-8

---

The adversarial checklist for **convention** — where a change fits the surrounding codebase
poorly. The caller supplies the **work under review**. For each check, compare the change
against its established siblings (grep the neighbors in the same area), and for each trip
emit one finding in the shared shape (`fragments/finding-contract.md`). This lens needs the
surrounding context, not just the changed lines.

## Checks

1. **Naming parity.** A new symbol, field, key, route, or parameter is named against the
   established convention of its siblings in the same area (casing, prefix, singular/plural,
   verb/noun shape). Evidence: the new name vs the neighboring pattern. Severity: `warn`.

2. **Behavioral parity.** An operation that has an established sibling is implemented a
   different way — different validation, different result shape, a different error contract —
   with no reason the change makes clear. Evidence: the change vs the sibling. Severity:
   `warn`, or `fail` when the divergence breaks a shared expectation callers rely on.

3. **Redundant work.** The change re-derives, re-fetches, or re-computes a value already
   available in scope — a passed argument, a prior result, an existing field. Evidence: the
   duplicate computation + the source already holding it. Severity: `warn`.

4. **Data over-fetching.** More data is retrieved or loaded than the change uses — a
   full-record fetch where a projection suffices, loading a collection to read one field,
   over-broad selection. Evidence: the fetch + the actual usage. Severity: `warn`.

5. **Type precision.** A value is typed looser than warranted — a wide/permissive type where
   a specific one is known, a nullable where non-null is guaranteed, a bare string where a
   fixed set of values applies — or an existing narrowing is dropped. Evidence: the
   declaration + the known-tighter shape. Severity: `warn`.

## Discipline

- Report only issues you can ground against a concrete neighboring pattern or an in-scope
  source — this lens is about parity with what already exists, not personal preference.
- One finding per real divergence; do not stack style nits.
- Reserve `fail` for a divergence that breaks a shared contract; consistency-of-style is
  `warn`.
- Name the matching convention in `recommendation` so the fix is mechanical.
