# `04_verify.md` full output shape

The verbatim structure `/wf:verify-spec` writes to the task folder's `04_verify.md`. Keep quoted snippets short — one or two lines max; the reader clicks `file:line` for the rest. The `## Capability findings` section is present only when one or more capabilities contributed `finding`s at the `verify` phase (omit it on the no-op path). The `## Adversarial findings` section is present only when the lean adversarial pass produced at least one reportable finding (omit it on a clean change).

## Contents

- [Full output shape](#full-output-shape-04_verifymd) — the full fenced block

## Full output shape (`04_verify.md`)

```
# verify-spec: {task-id}

**Source:** `<path to 00_reqs.md>`
**Branch:** `<branch name>`
**Commit:** `<HEAD SHA>`  (base `<merge-base SHA>`)
**Tree:** clean  |  dirty — <N> uncommitted files: `<path>, <path>, …`
**Scope:** <N files, +X/-Y> vs `main`
**Verdict:** <PASS | FAIL | PARTIAL>  (<passed>/<total> requirements)
**Audited by:** <model identifier>
**Audited at:** <ISO 8601 timestamp>

## Requirements

1. [PASS] <requirement text>
   - Evidence: `path/to/file:42` — `<quoted line or snippet>`

2. [FAIL] <requirement text>
   - Expected: <what the spec says>
   - Found: <what the code actually has>
   - Location: `path/to/file:L`
   - Remedy: <one-line bounded edit, only when one exists — omit the line entirely otherwise>

...

## Capability findings

Only present when one or more capabilities contributed `finding`s at the `verify` phase
(omit the whole section on the no-op path). Group findings by their source capability
(provenance tag); registry order is cosmetic. Render the capability's own `remedy` (when
its `finding` fragment carries one) as a trailing `— Remedy: <text>` clause; omit the
clause when the fragment carries none.

- **<source capability>** — [FAIL] <finding> at `path/to/file:L` — <evidence> — Remedy: <bounded edit>
- **<source capability>** — [FAIL] <finding> at `path/to/file:L` — <evidence>
- **<source capability>** — [PASS] <rule asserted, no divergence found>

## Adversarial findings

Only present when the lean adversarial pass produced at least one reportable finding
(omit the whole section on a clean change — no "no issues found" placeholder). Every entry
carries the provenance tag `core`, both required citations, and a non-gating severity:
these findings never change the `**Verdict:**` line above. Candidates that reconciliation
withdrew, and any contributor that failed to deliver, are recorded in the two trailing
sub-lists — never by quietly shortening the list above.

- **core** — [bound] <the contradicting literal> at `path/to/file:L` — contradicts
  `path/to/other:L` — `<quoted line establishing the real range>`
- **core** — [assumption] <the derivation> at `path/to/file:L` — requires
  `<the unstated precondition>`, not established at `path/to/other:L`
- **core** — [assumption] <as above> — **also reported by `<source capability>`** on other
  evidence; both stand, one defect seen twice

Withdrawn — present only when reconciliation withdrew at least one core candidate. One line
each, so a suppressed candidate is visible rather than silently absent:

- **core** — [bound] <the candidate> at `path/to/file:L` — withdrawn: covered by
  `<source capability>`'s finding at the same line on the same evidence

Coverage — present only when a contributor failed, was unavailable, or returned an
unparseable block. Omit entirely when every contributor delivered (an empty `findings:` list
is a clean delivery, not a failure):

- **Incomplete** — `<source capability>` contributed nothing and is not clean:
  <what failed>. The findings above are not a complete adversarial pass. Non-gating.

## Deviations from derived artifacts (informational)

If you noticed a derived artifact (e.g. an LLM-authored plan) over- or under-specified
vs the spec, list the drift here so the user can tighten the template next time.
Informational only — does NOT affect the verdict.

## Recommended next actions

- Short, ordered list. "Fix X at file:line", "Run `tsc --noEmit`", "Resolve open
  question Y".
```
