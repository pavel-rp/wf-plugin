# Operational lens rubric

**Owned by:** the audit capability (`plugins/wf-audit/capabilities/audit/`)
**Read by:** `wf-audit:operational-auditor` at the `verify` phase
**Model:** claude-opus-4-8

---

The adversarial checklist for **operational readiness** — the ways a correct-looking change
misbehaves in production. The caller supplies the **work under review**. For each check that
trips, emit one finding in the shared shape (`fragments/finding-contract.md`).

## Checks

1. **Dependency freshness.** A newly added or bumped dependency is stale, duplicated (two
   versions of one library resolvable at once), pinned to a yanked or known-vulnerable range,
   or a new capability is added without declaring the dependency it relies on. Evidence: the
   dependency-manifest entry. Severity: `warn`, `fail` on a known-bad version.

2. **Logging hygiene.** A mutating or failure path has no log where its siblings do (a blind
   spot on error), logs at the wrong level, records sensitive data, or logs so verbosely it
   drowns signal. Evidence: the path + the logging gap or excess. Severity: `warn`.

3. **Accessibility.** Where the change touches a user-facing surface, an interactive element
   lacks a name/label, a non-text element lacks a text alternative, or keyboard/focus
   handling is dropped. Evidence: the element. Severity: `warn`. (Only when a user-facing
   surface is in scope; otherwise not applicable.)

4. **Idempotency.** A mutating operation is not safe to run twice — a re-run double-applies,
   a retry duplicates a record, or an insert that should be an upsert. Evidence: the
   operation + the double-apply path. Severity: `fail` when a realistic retry corrupts.

5. **Data / schema migration safety.** A data or schema change is destructive without a
   guard, irreversible without a documented path back, or ordered so a partial apply leaves
   an inconsistent state. Evidence: the change + the unsafe property. Severity: `fail`.

6. **Configuration drift.** A new setting, flag, or threshold is introduced without a
   default, left undocumented, or hardcodes an environment-specific value that should be
   configurable. Evidence: the new config + the missing default/doc. Severity: `warn`,
   `fail` when a missing default breaks an environment.

## Discipline

- Report only issues with a concrete `file:line` and an observed operational hazard.
- One finding per real hazard; skip checks whose surface the change does not touch.
- Name the bounded remedy in `recommendation`; set `recommendation: escalate` when the safe
  operational approach depends on deployment context you cannot infer.
