# The critic dispatch — prompt contract and verdict shape

The paired reference for `verify-spec/SKILL.md`'s §"Confirm candidate blocking findings". Read
at runtime, at the dispatch step that section names — the same "followed in-context" role
`verify-template.md` and `chat-summary.md` already play at their own points. Keeps the skill
body's own section a short decision-rule pointer while the dispatch prompt, the verdict block
shape, and the malformed-output handling — the actual bytes a caller sends and must parse — live
here in full.

## Contents

- [Why a critic](#why-a-critic)
- [Dispatch prompt](#dispatch-prompt)
- [Verdict block](#verdict-block)
- [Malformed or failed dispatch](#malformed-or-failed-dispatch)
- [Worked example](#worked-example)

## Why a critic

A lens `fail` blocks on assertion alone today; the eventual `PASS` on a re-verify comes from an
auditor reinterpreting the gate rather than from grounded refutation, and a false `fail` keeps
the verify⇄fix loop alive for no reason. The critic is a **second, isolated pair of eyes**,
dispatched fresh — it never receives the lens's own reasoning, only the candidate's citations
and the frozen artifact — so it cannot simply agree with itself. It **confirms or refutes**,
never re-derives a new finding of its own: a critic dispatch that reports a defect the candidate
set never named is a malformed response (§"Malformed or failed dispatch"), not a bonus finding.

## Dispatch prompt

The caller (`verify-spec/SKILL.md`) sends exactly one message, covering the whole candidate set:

```text
You are auditing candidate blocking findings from a code-verification pass. For each
candidate below, read the cited evidence against the actual source and return exactly one
verdict: AGREE (the defect is real — quote the file:line establishing it, in your own
words or verbatim), DISAGREE (the defect is not real, or the citation does not establish it
— cite the actual code that refutes it), or UNVERIFIABLE (you cannot confirm or refute it
from static reading alone — say why in one line).

Task under audit: {task-id} — read {task-folder}/00_reqs.md for context only; do not
re-derive requirements or report anything outside the candidate list below.

The artifact is frozen: do not re-run the audit, re-read the diff for new defects, or
report a candidate not listed here.

Candidates:
1. fingerprint: <file:section|defect>
   finding: <the aggregated finding's own one-line description>
   cited lines: <every contributor's file:L, from the report's own citation>
   evidence: <the aggregated finding's own evidence, verbatim>

2. ...

Return only the verdict block below — one entry per candidate, in the order given, no
additional commentary.
```

Never sent: the requirement checklist, any `PASS`/`N/A`/`UNVERIFIABLE` requirement row, or a
lens's own reasoning/prompt — the critic reads citations and code, not another agent's
narrative. This is what "requirement verdicts never enter the critic" means operationally.

## Verdict block

```text
CRITIC — <verdict>

1. fingerprint: <file:section|defect>
   verdict: <AGREE | DISAGREE | UNVERIFIABLE>
   citation: <file:L> — "<quoted line, AGREE or DISAGREE>" | <one-line reason, UNVERIFIABLE>

2. ...
```

`<verdict>` on the header line is `confirmed` when every candidate is `AGREE`, `mixed` when the
candidates split across `AGREE`/`DISAGREE`/`UNVERIFIABLE`, and `refuted` when every candidate is
`DISAGREE`. The header is a summary only — the caller applies each numbered entry's own
`verdict:` field, never the header, to that candidate.

**Parsing contract.** The block is well-formed only when: it carries exactly one entry per
candidate sent, each entry paired to its candidate by `fingerprint` — never by position, so a
response that lists its entries in a different order from the candidates sent is still
well-formed as long as every candidate's fingerprint has exactly one matching entry; every
entry's `verdict:` is one of the three closed tokens; and every `AGREE`/`DISAGREE` entry
carries a non-empty `citation:` naming a `file:L`. Anything short of this — a missing
candidate, an extra entry, an unrecognized `verdict:` token, an `AGREE`/`DISAGREE` with no
citation, or no parseable block at all — is malformed.

## Malformed or failed dispatch

The Task erroring outright, returning no block, or returning a block that fails the parsing
contract above are the same outcome from the caller's side: **every candidate in this
dispatch stays blocking, unconfirmed** (fail-closed) — none is silently dropped, none is
treated as refuted or demoted. The report names the failure once, next to the candidates it
covers:

```
- **critic** — dispatch <failed | malformed>: <one-line reason> — <N> candidate(s) held
  blocking, unconfirmed: <fingerprint>, <fingerprint>, …
```

This line renders in `## Capability findings` beside the affected bullets' own `— critic: not
confirmed — dispatch <failed | malformed>` tags (`verify-template.md` §"Full output shape"), not
as a separate section — a fail-closed candidate is still a blocking-set member, not a
non-gating aside.

**Distinct from a per-finding `UNVERIFIABLE`.** A well-formed block naming one candidate
`UNVERIFIABLE` is not a dispatch failure — the critic ran, read the evidence, and made a
considered call that it cannot be confirmed or refuted from static reading. That candidate
demotes to `warn` (§"Verdict block" above; `verify-spec/SKILL.md` §"The blocking set"). Only the
dispatch-level failure (Task error, no block, or a block failing the parsing contract) triggers
the fail-closed path.

## Worked example

Three candidates dispatched — a nil-check gap, a stale enum value, and a missing test guard.
The critic returns:

```
CRITIC — mixed

1. fingerprint: src/auth/session.ts:validateToken|missing-null-check
   verdict: AGREE
   citation: src/auth/session.ts:47 — "return payload.sub.toLowerCase()" — payload.sub is
   typed optional two lines above and never narrowed before this call.

2. fingerprint: src/config/limits.ts:RATE_CAP|stale-bound
   verdict: DISAGREE
   citation: src/config/limits.ts:12 — "const RATE_CAP = 500" is the value the lens flagged as
   stale, but src/config/limits.test.ts:8 asserts exactly 500 as the current intended cap —
   the lens's cited "old" value (200) is a comment describing a past migration, not live code.

3. fingerprint: src/jobs/retry.ts:scheduleRetry|no-test
   verdict: UNVERIFIABLE
   citation: static reading cannot establish whether the missing branch is exercised by an
   integration suite outside this diff; no test file changed in this branch to check.
```

Candidate 1 stays blocking (`## Capability findings`, confirmed). Candidate 2 leaves the
blocking set into `## Accepted warnings` tagged `critic: DISAGREE` (ledger status `refuted`).
Candidate 3 also moves to `## Accepted warnings`, tagged `critic: UNVERIFIABLE` (ledger status
`warn`). The `**Verdict:**` line reflects only candidate 1 plus any unconditional requirement
`FAIL`/`PARTIAL` — never candidates 2 or 3.
