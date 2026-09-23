# `04_verify.md` full output shape

The verbatim structure `/wf:verify-spec` writes to the task folder's `04_verify.md`. Keep quoted snippets short — one or two lines max; the reader clicks `file:line` for the rest. The `## Capability findings` section is present only when one or more capabilities contributed `finding`s at the `verify` phase (omit it on the no-op path); when routing leaves it with no entry, it renders the single line `- none`. The `## Pre-existing` and `## Accepted warnings` sections are **unconditional — always rendered, even empty**, so the ledger shape is stable across runs. The `## Adversarial findings` section is present whenever the run has anything to record — a surviving finding, a Withdrawn line, or a Coverage record — which subordinates the omission rule: omit the whole section on a clean change only, meaning a run that produced no surviving finding, withdrew no candidate, and had every contributor deliver.

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

This section carries the `fail`-severity aggregated findings that made the **blocking set** —
those that are requirement- or change-anchored. A `fail` or `warn` that did not make it is
recorded in exactly one of the two non-gating sections below instead of here, so every
aggregated finding appears exactly once in the report and none is ever dropped. A `[PASS]`
assertion row carries no severity, is not a finding, and is never routed — it always stays here.
The section's presence rule, its grouping, and its bullet shape are unchanged by that routing;
when the routing leaves it with no entry at all, render the single line `- none`.

- **<source capability>** — [FAIL] <finding> at `path/to/file:L` — <evidence> — Remedy: <bounded edit>
- **<source capability>** — [FAIL] <finding> at `path/to/file:L` — <evidence>
- **<source capability>** — [PASS] <rule asserted, no divergence found>
- none

A finding collapsed from multiple lenses (the same `defect` at one `file:section`, per the
aggregation step) renders as one bullet naming every contributing lens, with each lens's own
evidence and `<lens>/<check>` provenance nested beneath it — never one bullet per lens, and
never a single evidence field standing in for all of them:

- **<source capability>** — [FAIL] <finding> at `path/to/file:<section>|<defect>` — collapsed from <N> lenses:
  - `<lens>/<check>` — <that lens's own evidence>
  - `<lens>/<check>` — <that lens's own evidence>

The collapsed headline is keyed by the same fingerprint `## Pre-existing` uses — never a bare
`file:L` — because the contributing lenses may cite different lines within the shared
`file:section`; no single lens's line is privileged. Every nested contributor line stays a
**cited line** of the finding, so anchoring and lean-pass overlap match on any of them.

## Pre-existing

**Always rendered, even when empty** — unlike the conditional `## Adversarial findings` section
below, this one and `## Accepted warnings` are unconditional, so the ledger shape is stable
across runs. On an empty registry it renders with no entries; never omit it, and never replace
an empty render with a "none found" placeholder beyond the single `- none` line.

One entry per aggregated `fail`-severity finding that is anchored to neither a contradicted
requirement nor a line in the branch diff, and that the dirty-file / empty-diff carve-out does
not claim — non-blocking, tagged with its source capability.
Entries are keyed by the full fingerprint `file:section|defect`, where `section` is the
enclosing markdown heading for prose, the enclosing symbol or declaration for source, and the
file itself when neither exists, and `defect` is the aggregator-assigned key naming the
specific defect at that location. A pre-existing entry never dismisses a requirement
`FAIL`/`PARTIAL`.

- **<source capability>** — `path/to/file:<section>|<defect>` — <finding> — <evidence>
- none

A pre-existing entry collapsed from multiple lenses uses the same nested shape as
`## Capability findings` above — one bullet naming every contributing lens beneath it, each
with its own evidence and `<lens>/<check>` provenance:

- **<source capability>** — `path/to/file:<section>|<defect>` — <finding> — collapsed from <N> lenses:
  - `<lens>/<check>` — <that lens's own evidence>
  - `<lens>` — <evidence from a contributor that carries no `check:`>

## Accepted warnings

**Always rendered, even when empty**, on the same unconditional rule as `## Pre-existing` above.

One entry per aggregated `warn`-severity finding, whatever its anchor — a `warn` is
non-blocking by severity alone and needs no anchor check — tagged with its source capability.

- **<source capability>** — <finding> at `path/to/file:L` — <evidence>
- none

A `warn` collapsed from multiple lenses is keyed by its fingerprint and nests every
contributor exactly as `## Capability findings` does:

- **<source capability>** — <finding> at `path/to/file:<section>|<defect>` — collapsed from <N> lenses:
  - `<lens>/<check>` — <that lens's own evidence>

## Adversarial findings

Present whenever the run has anything to record — a surviving finding, a Withdrawn line, or a
Coverage record. The omission rule is subordinate to that: omit the whole section on a clean change only
— a run that produced no surviving finding, withdrew no candidate, and had every contributor
deliver — and never emit a "no issues found" placeholder. A section carrying only Withdrawn lines,
or only a Coverage record, is a correct render, not an empty one. Every entry
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
  `<source capability>`'s finding `path/to/file:<section>|<defect>`, one of whose cited lines
  is the same line, on the same evidence

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
