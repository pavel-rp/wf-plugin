# `04_verify.md` full output shape

The verbatim structure `/wf:verify-spec` writes to the task folder's `04_verify.md`. Keep quoted snippets short — one or two lines max; the reader clicks `file:line` for the rest. The `## Capability findings` section is present only when one or more capabilities contributed `finding`s at the `verify` phase (omit it on the no-op path); when routing leaves it with no entry, it renders the single line `- none`. The `## Pre-existing`, `## Accepted warnings`, and `## Ledger` sections are **unconditional — always rendered, even empty**, so the report shape is stable across runs. A candidate the critic pass (`verify-spec/SKILL.md` §"Confirm candidate blocking findings") refutes or cannot verify also renders in `## Accepted warnings`, tagged `critic: DISAGREE`/`UNVERIFIABLE` with the citation — no separate section for it. The `## Adversarial findings` section is present whenever the run has anything to record — a surviving finding, a Withdrawn line, or a Coverage record — which subordinates the omission rule: omit the whole section on a clean change only, meaning a run that produced no surviving finding, withdrew no candidate, and had every contributor deliver.

**Mechanical-first ordering** (`SKILL.md` §"Fire the `verify` phase"): in `## Capability findings`, `## Pre-existing`, and `## Accepted warnings`, every finding marked `mechanical` renders before every unmarked finding, and its bullet ends with the tag `— mechanical`. With no marked finding, the order and bullet shape are unchanged.

## Contents

- [Full output shape](#full-output-shape-04_verifymd) — the full fenced block
- [Lens count](#lens-count) — how the `**Lenses:**` header value is counted

## Full output shape (`04_verify.md`)

```
# verify-spec: {task-id}

**Source:** `<path to 00_reqs.md>`
**Branch:** `<branch name>`
**Commit:** `<HEAD SHA>`  (base `<merge-base SHA>`)
**Tree:** clean  |  dirty — <N> uncommitted files: `<path>, <path>, …`
**Scope:** <N files, +X/-Y> vs `main`
**Verdict:** <PASS | FAIL | PARTIAL>  (<passed>/<total> requirements)
**Certified:** commit `<HEAD SHA>`, tree `<audited tree identity>`  |  none — verdict <FAIL | PARTIAL>
**Drift re-verify:** `<certified commit>`..`<HEAD SHA>` (<change kind>)   ← drift mode only; omit the line otherwise
**Lenses:** <c>/<e> completed, <i> inline[ — incomplete: <role>, …]   ← always; `0/0 completed, 0 inline` when no `verify`/`finding` row exists; the suffix only when `<c> < <e>`
**Critic:** none — no candidates  |  ran — independent[, via hand-back] (<a> AGREE, <d> DISAGREE, <u> UNVERIFIABLE)  |  ran — inline, not independent (<a> AGREE, <h> held)  |  not run — <reason>   ← always; `not run` is fail-closed, never a `DISAGREE`
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
   - Disposition: <pending | escalated>

3. [UNVERIFIABLE] <requirement text>
   - Found: <why it cannot be verified>
   - Disposition: accepted

4. [PASS] <requirement text> (carried from `<certified commit>`)   ← drift mode: evidence cites no drifted file
   - Evidence: `path/to/file:42` — `<quoted line, copied from the certified report>`

...

## Capability findings

Only present when one or more capabilities contributed `finding`s at the `verify` phase
(omit the whole section on the no-op path). Group findings by their source capability
(provenance tag); registry order is cosmetic. Render the capability's own `remedy` (when
its `finding` fragment carries one) as a trailing `— Remedy: <text>` clause; omit the
clause when the fragment carries none.

This section carries the `fail`-severity aggregated findings that made the **blocking set** —
requirement-anchored candidates the critic confirmed (`AGREE`), plus every candidate when the critic did not
run (fail-closed, unconfirmed — `critic-verdict.md` §"Malformed or failed dispatch"), plus every candidate an inline critic
(caller cannot await) returned `DISAGREE` or `UNVERIFIABLE` (held, unconfirmed). A `fail` or `warn` that did not make
it is recorded in exactly one of the two non-gating sections below instead of here, so every
aggregated finding appears exactly once in the report and none is ever dropped. A `[PASS]`
assertion row carries no severity, is not a finding, and is never routed — it always stays here.
The section's presence rule, its grouping, and its bullet shape are unchanged by that routing;
when the routing leaves it with no entry at all, render the single line `- none`.

A confirmed bullet appends the critic's own confirmation, `` — critic: AGREE at `path/to/file:L`
— "<quoted evidence>"``; a bullet standing here because the critic did not run appends
`` — critic: not run — <reason>`` instead, and one
an inline critic held appends `` — critic: not confirmed — inline, not independent`` (an inline
`AGREE` keeps the confirmed form with ` (critic run inline)` after it), so a reader can tell a
grounded confirmation from a fail-closed default at a glance.

Every finding bullet in this report — here, under `## Pre-existing`, and under
`## Accepted warnings`, collapsed or not — is keyed by its fingerprint
`path/to/file:<section>|<defect>` — never a bare `file:L` in its place — and names its
`<lens>/<check>` provenance (bare `<lens>` when the contributor carries no `check:`) **with
that contributor's cited `file:L` beside it**: `` `<lens>/<check>` at `path/to/file:L` ``.
The fingerprint is the finding's identity; the cited `file:L` is where `/wf:verify-fix`
applies the remedy, so a contributor line never drops it. A single-lens finding is a collapse
of one:

- **<source capability>** — [FAIL] <finding> at `path/to/file:<section>|<defect>` — `<lens>/<check>` at `path/to/file:L` — <evidence> — Remedy: <bounded edit>
- **<source capability>** — [FAIL] <finding> at `path/to/file:<section>|<defect>` — `<lens>/<check>` at `path/to/file:L` — <evidence>
- **<source capability>** — [PASS] <rule asserted, no divergence found>
- none

A finding collapsed from multiple lenses (the same `defect` at one `file:section`, per the
aggregation step) renders as one bullet naming every contributing lens, with each lens's own
evidence, `<lens>/<check>` provenance, cited `file:L`, and remedy nested beneath it — never
one bullet per lens, and never a single evidence field standing in for all of them:

- **<source capability>** — [FAIL] <finding> at `path/to/file:<section>|<defect>` — collapsed from <N> lenses:
  - `<lens>/<check>` at `path/to/file:L` — <that lens's own evidence> — Remedy: <that lens's recommendation>
  - `<lens>/<check>` at `path/to/file:L` — <that lens's own evidence>

The headline takes the fingerprint, not any one lens's line, because the contributing lenses
may cite different lines within the shared `file:section`; no single lens's line is
privileged. Each nested contributor line keeps its own cited `file:L`, and every one stays a
**cited line** of the finding, so `/wf:verify-fix`, anchoring
and lean-pass overlap match on any of them. When the contributors span more than one source
capability, the headline tag lists every one (`**<capability>, <capability>**`) and each
nested line prefixes its lens with its own capability (`<capability>:<lens>/<check>`), so no
contribution loses its provenance.

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

- **<source capability>** — `path/to/file:<section>|<defect>` — <finding> — `<lens>/<check>` at `path/to/file:L` — <evidence>
- none

A pre-existing entry collapsed from multiple lenses uses the same nested shape as
`## Capability findings` above — one bullet naming every contributing lens beneath it, each
with its own evidence, `<lens>/<check>` provenance, and cited `file:L`:

- **<source capability>** — `path/to/file:<section>|<defect>` — <finding> — collapsed from <N> lenses:
  - `<lens>/<check>` at `path/to/file:L` — <that lens's own evidence> — Remedy: <that lens's recommendation>
  - `<lens>` at `path/to/file:L` — <evidence from a contributor that carries no `check:`>

## Accepted warnings

**Always rendered, even when empty**, on the same unconditional rule as `## Pre-existing` above.

One entry per aggregated `warn`-severity finding, whatever its anchor — a `warn` is
non-blocking by severity alone and needs no anchor check — tagged with its source capability.

- **<source capability>** — <finding> at `path/to/file:<section>|<defect>` — `<lens>/<check>` at `path/to/file:L` — <evidence>
- none

A `warn` collapsed from multiple lenses is keyed by its fingerprint and nests every
contributor exactly as `## Capability findings` does:

- **<source capability>** — <finding> at `path/to/file:<section>|<defect>` — collapsed from <N> lenses:
  - `<lens>/<check>` at `path/to/file:L` — <that lens's own evidence> — Remedy: <that lens's recommendation>

An **advisory** `fail` — change-anchored (or under the dirty-file / empty-diff carve-out) but
naming no requirement it contradicts (`verify-spec/SKILL.md` §"The blocking set") — also renders
here, never routed to the critic and never blocking, tagged `advisory: not requirement-anchored`
(ledger status `accepted`, disposition `accepted`). It nests contributors exactly as a collapsed
`warn` does:

- **<source capability>** — <finding> at `path/to/file:<section>|<defect>` — `<lens>/<check>` at `path/to/file:L` — <evidence> — advisory: not requirement-anchored

A candidate the critic pass classified also renders here — never dropped, and never dismissing a
requirement `FAIL`/`PARTIAL` (which never reaches the critic at all):

- a `DISAGREE`d candidate — refuted, tagged `critic: DISAGREE` with the critic's own citation
  (ledger status `refuted`; `finding-ledger.md` §"Status vocabulary"):
  `` - **<source capability>** — `path/to/file:<section>|<defect>` — <finding> — critic: DISAGREE at `path/to/file:L` — "<cited code>"``
- a drift residual (drift mode only, `certified-commit.ops.md` §"Drift-mode audit") — a fresh finding
  whose every cited line lies outside the drift diff, tagged with the certified commit it was
  unchanged since (ledger status `warn`, disposition `accepted`):
  `` - **<source capability>** — <finding> at `path/to/file:<section>|<defect>` — `<lens>/<check>` at `path/to/file:L` — drift: residual (unchanged since `<certified commit>`)``
- a candidate the critic returned `UNVERIFIABLE` on — it was `fail`-severity and anchored until
  the critic could not confirm or refute it — tagged `critic: UNVERIFIABLE` with the critic's
  own one-line reason (ledger status `warn`, distinct from an originally-`warn` finding's
  `accepted`). The critic's contract (`critic-verdict.md` §"Verdict block") gives an
  `UNVERIFIABLE` verdict a reason, not a `file:L` citation — render the reason and never
  require a location this verdict does not carry:
  `` - **<source capability>** — <finding> at `path/to/file:<section>|<defect>` — critic: UNVERIFIABLE — "<critic's one-line reason>"``

## Ledger

**Always rendered, even when empty**, on the same unconditional rule as `## Pre-existing` and
`## Accepted warnings` above — a stable ledger shape across runs is the point. One row per
fingerprint the rebuild (`verify-spec/SKILL.md` §"The finding ledger") carries after this run's
match/insert/retire pass — every fingerprint ever seen in the current loop, not only this run's:
an entry a prior round saw but this run doesn't stays here as `fixed`, never dropped. The
`**Round:**` line always renders first, even when the table is empty — it is the one place the
report carries the round number this run derived.

Every row carries exactly one `Disposition`, derived from its `Status` per `finding-disposition.md`
§"Ledger-row derivation" — no row is ever left undisposed. `## Counterparts` and
`## Adversarial findings` entries never appear here and carry no disposition
(`finding-disposition.md` §"Exclusions").

**Round:** <N> of the current loop

| Fingerprint | Defect | First-seen round | Status | Disposition | Contributing lenses |
|---|---|---|---|---|---|
| `path/to/file:<section>\|<defect>` | `<defect>` | `<first-seen round>` | `<open \| fixed \| refuted \| warn \| pre-existing \| accepted>` | `<pending \| escalated \| fixed \| refuted \| accepted>` | `<lens>/<check>, <lens>/<check>` |
| none | | | | | |

`none` renders as the single row above only when the ledger is empty (no round of the current
loop has inserted a fingerprint yet); otherwise every ledger entry gets its own row, in any
stable order.

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
- **Incomplete** — `<source capability>`/`<lens>` run inline, not independent: its rubric was
  executed in the verifying agent's own context, not an isolated dispatch. Counted in the
  `**Lenses:**` inline figure, never as completed. Non-gating.
- **Incomplete** — `<source capability>`/`<role>` did not complete at the review boundary:
  <the recorded reason — `failed — <reason>`, `not in manifest`, `block unreadable`,
  `malformed block`, or `manifest unreadable`>. Its rubric was not applied by this run. Non-gating.

Every Coverage entry is also reflected in the header's `**Lenses:**` count (§"Lens count"
below), which renders even when this sub-list is omitted.

## Counterparts

This section is present only when `list_counterparts` returned a listing, a suppressed key, a map
diagnostic, or an `unavailable` status, or when a contributor returned a finding marked
`counterpart`. Omit it otherwise, so a project with no declared map and no extractor sees no
counterpart term. Every entry is advisory `warn`. It never changes `**Verdict:**`, never enters the
ledger, carries no disposition (`finding-disposition.md` §"Exclusions"), and `/wf:verify-fix` skips
it; a copy left unchanged on purpose is a normal outcome.
Entries marked `mechanical` render first.

- **core** — `<key>` (<kind>) changed at `path/to/file:L` — unchanged: `path/to/copy:L, L`,
  `path/to/other` (missing) — mechanical
- **core** — `<key>` (<kind>) changed at `path/to/file:L` — unchanged: `path/to/copy:L` —
  <total> occurrences, first 10 shown — mechanical
- **<source capability>** — `<key>` changed at `path/to/file:L` — unchanged: `path/to/copy:L`

Suppressed — `<key>` — too short to be distinctive; not listed.

Map — `<diagnostic>` (one line per map diagnostic the tool returned).

Incomplete — counterpart listing unavailable: <diagnostic>. Non-gating.

## Deviations from derived artifacts (informational)

If you noticed a derived artifact (e.g. an LLM-authored plan) over- or under-specified
vs the spec, list the drift here so the user can tighten the template next time.
Informational only — does NOT affect the verdict.

## Recommended next actions

- Short, ordered list. "Fix X at file:line", "Run `tsc --noEmit`", "Resolve open
  question Y".
- Draw only from requirement `FAIL`/`PARTIAL` items, blocking-set members, and open
  questions — never from `## Pre-existing` or `## Accepted warnings` entries (advisory ones
  included), which are recorded, not to-dos. With the blocking set empty, write
  `- none — requirements met; remaining capability findings are advisory`.
```

## Lens count

The `**Lenses:**` header value — `<c>/<e> completed, <i> inline` — counts this round's
`verify`/`finding` contributor rows once, after dispatch (`SKILL.md` §"Fire the `verify` phase").
The same value is echoed verbatim by the chat summary's `Lenses:` line, the `VERIFY —` block's
`Lenses:` line, and downstream by the run blocks that report it.

- **`<e>` expected** — every row collected for this phase that the contributor gate left
  enabled. A row the gate skipped was deliberately disabled and is not expected; a row with a
  malformed `dispatch`, or whose Agent target is unavailable, is expected.
- **`<c>` completed** — expected rows that delivered a well-formed block through their declared
  dispatch: an `inline:` row whose body was followed in-context, a `subagent:` row whose own
  isolated Agent returned, or — at the review boundary (`review-boundary.md`) — a `subagent:` row
  whose block the caller's own isolated child returned and recorded for the audited tree. A clean
  block with an empty `findings:` list is completed.
- **`<i>` inline** — `subagent:` rows whose rubric the verifying agent executed in its own context
  instead of an isolated Agent (for example, because it could not dispatch one). They count in
  `<e>` and **never** in `<c>`: a rubric the auditing agent applies to its own work is not an
  independent lens run. Each is also recorded under Coverage as `run inline, not independent`.

- **Incomplete suffix** — whenever `<c> < <e>`, the value ends ` — incomplete: <role>[, <role>…]`,
  one derived role per expected row not in `<c>` (inline, failed, unavailable, malformed, or not
  recorded at the review boundary), in registry order. A full count carries no suffix, so a lens
  that did not complete is always named and never reads as full.

An empty registry, or no `verify`/`finding` row, renders `0/0 completed, 0 inline` — the line is
never omitted. The count is reporting only: it never enters the blocking set, the critic, the
ledger, or `**Verdict:**`.
