# `04_verify.md` full output shape

The verbatim structure `/wf:verify-spec` writes to the task folder's `04_verify.md`. Keep quoted snippets short — one or two lines max; the reader clicks `file:line` for the rest. The `## Capability findings` section is present only when one or more capabilities contributed `finding`s at the `verify` phase (omit it on the no-op path).

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

## Deviations from derived artifacts (informational)

If you noticed a derived artifact (e.g. an LLM-authored plan) over- or under-specified
vs the spec, list the drift here so the user can tighten the template next time.
Informational only — does NOT affect the verdict.

## Recommended next actions

- Short, ordered list. "Fix X at file:line", "Run `tsc --noEmit`", "Resolve open
  question Y".
```
