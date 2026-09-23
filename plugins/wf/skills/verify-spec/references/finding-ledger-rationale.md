# Finding ledger — rationale and worked example

The paired reference for `finding-ledger.md` (read at runtime, at the rebuild step
`verify-spec/SKILL.md`'s `## The finding ledger` section names). **Never read at runtime** —
consulted only when authoring, reviewing, or debugging the ledger rebuild. Split out (WF-655)
because the runtime-read half had grown to 300 lines, well past the 150-behavior-bearing-line
runtime-doc budget (`CLAUDE.md` §"Shared conventions": "Runtime-read docs split ops/reference —
the ops doc is ≤150 behavior-bearing lines, rationale in a paired reference never read at
runtime"). The rebuild/match/insert/retire algorithm and the round-number derivation rule
itself — the actual behavior a rebuild must reproduce exactly — stay in full in
`finding-ledger.md`; this file holds only the "why" behind specific rules, plus a full worked
example, neither of which the rebuild step needs to consult to execute correctly.

## Status vocabulary

**Why single-valued, not layered.** A fingerprint's status is set from where its most recent
match rendered, with one three-way tag branch inside `## Accepted warnings`
(`refuted`/`warn`/`accepted`) and none elsewhere. An entry carries exactly one status field, so
retiring a `pre-existing`/`accepted` fingerprint to `fixed` deliberately discards which bucket
it last matched: once nothing reports it, which bucket it used to render in has no further
consequence for anything the rebuild does, so there is no second field preserving it. This is a
stated simplification, not an oversight — if a future consumer needs the pre-retirement bucket,
that is a new field to add then, not a gap in the rule as written today.

## Round-number derivation

**Why the boundary tests scope to structural lines only.** A lens's own evidence can
legitimately quote source text containing `**Verdict:** PASS` or `## Accepted warnings`
verbatim — this repo's own corpus fixture (see "Worked example" below) does exactly that.
Matching such a substring anywhere in the document body, rather than only in the report's own
header block or an actual `##`-level heading line, would misidentify the loop boundary.
Concretely: the `**Verdict:**` test matches only the single such line in the report's header
block, before its first `##` heading; the heading test matches only an actual `##`-level
heading line (starting the line with `## `), never text inside backticks, a fenced code block,
or a quoted bullet.

**Why the heading-presence test, not a fingerprint-marker test.** Both unconditional headings
(`## Pre-existing`, `## Accepted warnings`) are rendered — even empty, as a lone `- none` line
— by every report the current `verify-template.md` shape produces, so their total *absence* is
what marks an entry written under an older report shape (e.g. this repo's own
`corpus-archive/verify-replay-wf554/rounds/*.md` fixture, confirmed to carry neither heading).
Testing for the fingerprint marker shape (`file:section|defect`) instead would wrongly treat a
current-shape entry that simply reported zero fingerprinted findings this round as
pre-fingerprint-capable, silently truncating the ledger the fold builds.

**Why boundary evaluation needs no timestamp comparison.** The boundary is evaluated in trail
order, so a `PASS` entry and a pre-fingerprint-capable entry never need to be compared against
each other by timestamp — whichever one the most-recent-first walk reaches first *is* "the
later of the two", because most-recent-first walk order *is* recency order.

## De-duplicating a resumed rotation

**Why this dedup rule exists.** `## Output`'s rotate-then-overwrite (the shared pipeline
conventions doc, `resolve_content` `class: shared`, `ref: pipeline-conventions.md`,
§"Artifact rotation into `.history.md`") is two separate writes. A run resumed between the
rotation and the overwrite duplicates that one report into the trail permanently — not only in
the resumed run's own read, but as two adjacent, identical-header entries thereafter sitting in
`04_verify.history.md` for every later run to re-encounter. Scoping the collapse to *any*
adjacent duplicate pair, not only "current vs. history's topmost", is what makes this durable:
every later run's own gather step re-applies the same rule and re-collapses the same stray pair
again, so the one-time non-atomic write is permanently absorbed on the read side and never
corrupts a `first-seen` or a round tally, on this run or any future one.

## Pre-dispatch derivation

**Why a second diff, distinct from `SKILL.md`'s branch-vs-`main` diff.** "Implementation
scope" answers "what does this task change against `main`" — the spec-conformance frame. The
pre-dispatch diff answers a narrower, round-scoped question: "what changed since the ledger
was last rebuilt" — the prior round's `**Commit:**` to the current working tree — so round ≥2
lenses can be narrowed to sections a fix pass actually touched, plus every still-open
fingerprint, instead of re-auditing the whole implementation scope every round. The two diffs
serve different consumers and would silently swap purposes if collapsed into one.

**Why round ≥2 reads the working tree, never `HEAD`.** `verify-fix` never commits between
rounds — its fixes sit uncommitted between one `verify-spec` round and the next — so `HEAD`
is stale the moment round ≥2 begins. Reading the working tree is what makes `changed_sections`
and the rendered `**Tree:**` list describe the change a round ≥2 audit is actually looking at,
dirty files included.

## Gate-accept demotion

**Why the demotion hook can't use this invocation's own round `N`.** `/wf:run`'s stop gate fires
at round `N` (a `FAIL`/`PARTIAL`), reads `N` verbatim off the just-written `04_verify.md`'s own
`**Round:**` line, and mints `verify-loop:l<L>:r<N>:accept` under that value (`run/SKILL.md`
§"The verify⇄fix stop gate"). An `accept` choice then re-invokes `/wf:verify-spec` once more —
"an extra invocation, not a verify⇄fix cycle" — and this fresh invocation derives its *own*
round via the ordinary walk (§"Round-number derivation"). At that moment `04_verify.md` on disk
is still the round-`N` report (rotation into `.history.md` happens later, at the write step),
so the walk counts it as one more current-shape entry more recent than the boundary — deriving
`N + 1` for this invocation. That derivation is *correct* for this invocation's own new report
(each bare `verify-spec` re-invocation is genuinely a new round by the walk's own rule, per
`run/SKILL.md`'s "Round `N` … counts `verify-spec` re-invocations alone"), but it is the wrong
value to look up the accept record under: the record was filed as `r<N>`, and a lookup keyed
on `r<N+1>` never matches, so the demotion silently never fires (the WF-671 defect). Reading
`N_stop` directly off that same not-yet-rotated `04_verify.md`'s `**Round:**` line — the exact
value `/wf:run` used to mint the record — sidesteps the mismatch entirely rather than trying to
thread `/wf:run`'s `N` through the re-invocation's own command line.

## Worked example

`corpus-archive/verify-replay-wf554/rounds/round-01.md` through `round-07.md` are seven real
`04_verify.md` reports, each `**Verdict:** PARTIAL`, confirmed to carry **neither** a
`## Pre-existing` nor an `## Accepted warnings` heading (all predate WF-565/566's report
shape). Rotated into `04_verify.history.md` in the shape the rotation convention produces
(newest-first: `round-07` topmost, `round-01` last), then two synthetic entries in the
current report shape (each carrying both unconditional headings, each reporting one
fingerprinted `fail` finding, `**Verdict:** PARTIAL`) are appended **after** `round-07` — i.e.
they are more recent than all seven, sitting above `round-07` in the trail (one as the
current, not-yet-rotated `04_verify.md`, the other as the newest `.history.md` entry). No
duplicate-header pair is present, so the resumed-rotation de-dup rule doesn't fire here.

**Round-number derivation.** Walking most-recent-first: the two synthetic entries each carry
both unconditional headings and are not `PASS`, so neither is the boundary — skip both,
count = 2. `round-07` is next: it carries neither heading, so it **is** the boundary (rule
1's second test) — stop here. `round-01` through `round-06`, all older than the boundary, are
never reached by the walk and neither count nor error. Round = 1 + 2 = **3** — the fixture
behind the plan's Success Criterion 3.

**The fold.** Prior rounds 1..2 are the two synthetic entries, oldest-first: the older one
(round 1) inserts its fingerprint with `first-seen: 1`; the newer one (round 2) — say it
names the *same* fingerprint again — matches it by lookup, leaving `first-seen: 1` unchanged.
The current run (round 3) then matches or inserts against that folded ledger. A fingerprint
that appeared only in round 1 and not round 2 would already have been retired to `fixed` by
the round-2 fold step, then reopened to `open` if round 3's own findings name it again —
exactly the SC1/SC2 behavior the reqs describe, now reproducible because each intermediate
round was actually replayed rather than assumed.

Appending a `PASS` entry anywhere in this trail (e.g. immediately after the two synthetic
entries, as a successful re-verify) would make that `PASS` entry the boundary instead — the
walk reaches it before either the pre-fingerprint-capable or older current-shape entries —
restarting the next run at round 1 of a new loop with an empty fold.
