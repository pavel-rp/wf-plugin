# Security lens rubric

**Owned by:** the audit capability (`plugins/wf-caps/capabilities/audit/`)
**Read by:** `wf-caps:security-auditor` at the `verify` phase
**Model:** claude-opus-4-8

---

The adversarial checklist for **security** — the ways a change opens a hole. The caller
supplies the **work under review**. Read every changed unit and, for each check that trips,
emit one finding in the shared shape (`fragments/finding-contract.md`). Trace untrusted data
to where it is used; assume any value crossing a trust boundary is hostile.

## Checks

1. **Injection.** Untrusted data flows into an interpreter, query, command, markup, or
   filesystem path without parameterization or escaping — dynamic query construction, shell
   or process execution, dynamic evaluation, template/markup assembly, path building from
   input. Evidence: the sink + the untrusted source reaching it. Severity: `fail`.

2. **Auth / authorization gaps.** A protected operation runs without verifying identity or
   permission; a check present on one path is missing on a sibling; or an object reference is
   honored without an ownership check (one caller acting on another's data). Evidence: the
   operation + the absent check. Severity: `fail`.

3. **Secrets exposure.** Credentials, tokens, keys, or connection strings are hardcoded,
   written into a persisted artifact, or emitted to an output or log stream. Evidence: the
   literal or the sink. Severity: `fail`.

4. **Resource limits.** An input, loop, allocation, or recursion is unbounded; an expensive
   or remote call has no timeout or pagination; a caller can force unbounded work. Evidence:
   the unbounded construct + the caller-controlled size. Severity: `fail` when caller-
   triggerable exhaustion; else `warn`.

5. **Concurrency safety.** Shared state is read-modified-written without synchronization, a
   check-then-act races (time-of-check/time-of-use), or an assumption of serial execution is
   violated under real concurrency. Evidence: the shared state + the interleaving that breaks
   it. Severity: `fail` when it can corrupt or leak; else `warn`.

6. **Error leakage.** An error path returns internal detail — stack traces, internal paths,
   raw query text, system internals — to a consumer across a trust boundary. Evidence: the
   error sink crossing the boundary. Severity: `warn`, or `fail` when it discloses
   exploitable internals.

## Discipline

- Report only issues with a concrete `file:line` and an observed data-flow or missing check.
- One finding per real hole; do not inflate a single flaw into several.
- Do not flag defense-in-depth niceties as `fail` — reserve `fail` for a reachable exposure.
- Name a bounded fix in `recommendation`; set `recommendation: escalate` when the correct
  mitigation depends on a threat model you cannot infer.
