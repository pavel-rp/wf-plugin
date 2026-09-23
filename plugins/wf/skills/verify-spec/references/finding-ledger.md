# The finding ledger — field set, algorithm, and round derivation

The paired reference for `verify-spec/SKILL.md`'s `## The finding ledger` section. Read at
runtime, at the rebuild step that section names — the same "followed in-context" role
`verify-template.md` and `chat-summary.md` already play at their own points, not the
"authoring companion only" role `adversarial-pass.md` plays. This split keeps the skill
body's own section a short pointer while the rebuild/match/insert/retire algorithm and the
round-number derivation rule — the actual behavior a rebuild must reproduce exactly — live
here in full.

## Contents

- [Ledger field set](#ledger-field-set)
- [Status vocabulary](#status-vocabulary)
- [Round-number derivation](#round-number-derivation)
- [Rebuild algorithm](#rebuild-algorithm)
- [Match / insert / retire (one round's step)](#match--insert--retire-one-rounds-step)
- [Worked example](#worked-example)

## Ledger field set

One entry per distinct fingerprint ever seen across the current loop. Five fields, each
required on every entry:

- **fingerprint** — the finding's identity, `file:section|defect` (WF-566's shape,
  unchanged). The ledger key.
- **defect** — the `defect` half of the fingerprint, carried as its own field so a rendered
  row doesn't force a reader to parse it back out of the fingerprint string.
- **first-seen round** — the round number (see below) of the **earliest** round, in the fold
  described under "Rebuild algorithm", whose own reported findings name this fingerprint.
  Never recomputed once set — a later round that re-matches the same fingerprint keeps this
  value unchanged (§"Match / insert / retire").
- **status** — one of the six values below.
- **contributing lenses** — the `<lens>/<check>` (or bare `<lens>`) provenance tags the most
  recent matching round reported, exactly as aggregation (`verify-spec/SKILL.md` §"Fire the
  `verify` phase") already collapsed them. Replaced wholesale on every match, never merged
  across rounds — a lens that stopped reporting a fingerprint is simply absent from this
  field as of the round that dropped it.

## Status vocabulary

- **open** — the fingerprint is in the current run's aggregated findings and has been since
  it was first seen or since it was last reopened.
- **fixed** — the fingerprint was in the ledger but no current-run finding names it; retired,
  never dropped.
- **refuted** — reserved. Nothing in this rebuild assigns it — no current rule in this file
  produces a `refuted` transition. It exists in the vocabulary because a later capability
  (an isolated critic verdict) is expected to assign it; a reader of this file looking for
  the assignment rule will not find one here, by design.
- **warn** — the fingerprint's most recent contributing severity is `warn` rather than
  `fail`. Independent of `open`/`fixed` **while a round still reports it**: a `warn`
  fingerprint can be `open` (still reported this round) or, on the round after it stops
  recurring, `fixed` — exactly as a `fail` one can.
- **pre-existing** — the fingerprint's most recent match landed in the report's
  `## Pre-existing` bucket (anchored to neither a requirement nor the diff).
- **accepted** — the fingerprint's most recent match landed in `## Accepted warnings`.

A fingerprint's status is set from **where its most recent match rendered** (`## Capability
findings` → `open`/`warn` per severity, `## Pre-existing` → `pre-existing`, `## Accepted
warnings` → `accepted`), then overridden to `fixed` when a round's own findings name it
nowhere at all. **Single-valued, not layered** — an entry carries exactly one status field,
so retiring a `warn` (or `pre-existing`/`accepted`) fingerprint to `fixed` deliberately
discards which non-`open` bucket it last matched: once nothing reports it, which bucket it
used to render in has no further consequence for anything this rebuild does, so there is no
second field to preserve it in. This is a stated simplification, not an oversight — if a
future consumer needs the pre-retirement bucket, that is a new field to add then, not a gap
in the rule as written today.

## Round-number derivation

Read this section before "Rebuild algorithm" below — the fold that section describes walks
the trail in the order this section establishes, oldest-first from the boundary it finds.

Walk the trail — the current, not-yet-rotated `04_verify.md` if it exists, then every entry
in `04_verify.history.md` in its existing, already-newest-first order (the rotation
convention prepends each newly-rotated entry, so file order already **is** recency order; do
not re-sort) — **most-recent-first**:

1. Find the **loop boundary** — the most recent entry, scanning most-recent-first, that is
   **either**:
   - carries `**Verdict:** PASS`, **or**
   - is a **pre-fingerprint-capable entry** — one whose report carries **neither** a
     `## Pre-existing` **nor** an `## Accepted warnings` heading, present or absent as a
     *structural* fact, independent of whether either section has any rows. Those two
     headings are unconditionally rendered — even empty, as a lone `- none` line — by every
     report the current `verify-template.md` shape produces, so their total *absence* is
     what marks an entry written under an older report shape (e.g. this repo's own
     `corpus-archive/verify-replay-wf554/rounds/*.md` fixture, confirmed to carry neither
     heading). **Do not** test for the fingerprint marker shape (`file:section|defect`)
     itself here — a current-shape entry that simply reported zero fingerprinted findings
     this round renders both headings anyway, each holding only `- none`, and would be
     wrongly mistaken for a pre-fingerprint entry by a marker-presence test, silently
     truncating the ledger built by the fold below. The two headings' presence, not their
     content, is the test.

   Stop at the first entry satisfying either test. That entry is the boundary. It is
   evaluated in trail order, so a `PASS` and a pre-fingerprint-capable entry never need to be
   compared against each other by timestamp — whichever one the most-recent-first walk
   reaches first **is** "the later of the two", because most-recent-first walk order **is**
   recency order.

2. **Round = 1 + the count of entries strictly more recent than the boundary** that carry at
   least one of the two unconditional headings (i.e., every entry the walk passed before
   reaching the boundary — an entry in the current report shape counts toward the round tally
   whether or not it happened to report any fingerprint this round; only a genuinely
   pre-fingerprint-capable entry, or the boundary itself, does not). The boundary entry itself
   is never counted. Every entry at or before the boundary is outside the loop: it neither
   counts toward the round number nor raises an error for lacking fingerprints.

3. **No boundary found** (the trail holds only current-shape, non-`PASS` entries all the way
   back, or the trail is empty) — round = 1 + the count of such entries in the whole trail
   (empty trail → round 1).

A fresh loop always restarts at round 1 immediately after a `PASS` — rule 1's first test
guarantees this, since a `PASS` entry is always eligible as a boundary regardless of its own
heading shape.

**De-duplicating a resumed rotation.** Before this walk, if the current, not-yet-rotated
`04_verify.md` and `04_verify.history.md`'s topmost entry carry an **identical** `**Commit:**`
**and** `**Audited at:**` pair, treat them as **one** entry (the not-yet-rotated
`04_verify.md`), not two. `## Output`'s rotate-then-overwrite is two separate writes
(`_shared/pipeline-conventions.md` §"Artifact rotation into `.history.md`", unchanged by this
task); a run resumed between the rotation and the overwrite would otherwise see the same
report counted twice in the trail, inflating the round tally and corrupting every
`first-seen` the fold below derives from it.

## Rebuild algorithm

Run this **on every invocation**, before rendering `## Output`, entirely from artifacts —
never held in memory across runs:

1. **Derive the round number** and the **loop boundary** per "Round-number derivation" above
   — this also identifies exactly which trail entries are strictly more recent than the
   boundary: call these, oldest-first, **prior rounds 1 .. N-1**, where **N** is the round
   number just derived for the current run. The fold below never reads at or past the
   boundary, so it is bounded by construction — it does not re-parse the unbounded tail of an
   ever-growing `.history.md` beyond that point.

2. **Fold the ledger forward, oldest-first, one round at a time — this is what establishes a
   correct `first-seen`.** A ledger is not re-derived from a single snapshot; it is built by
   replaying history in order:
   - Start from an **empty** ledger.
   - For each prior round `r` = 1 .. N-1, in oldest-first order (the reverse of the
     most-recent-first walk that found them): parse that entry's own fingerprint-bearing
     bullets (under its `## Capability findings`, `## Pre-existing`, `## Accepted warnings`)
     as **that round's own reported findings**, then apply §"Match / insert / retire" using
     round number `r` and the ledger-so-far. The result becomes the ledger-so-far for round
     `r+1`.
   - Finally, apply §"Match / insert / retire" **once more**, using round number `N` and the
     current run's own aggregated findings (the three buckets already in hand at this point
     in `SKILL.md`, before `## Output`) against the ledger-so-far carried out of the fold.

   A fingerprint's `first-seen` is therefore whichever fold step first inserted it — the
   earliest round (from 1 through N) whose own findings name it — recovered correctly because
   every intermediate round was actually replayed, not merely referenced.

3. **Render** the `## Ledger` section per `verify-template.md`, and surface the round number
   wherever the report/chat summary already reference it.

## Match / insert / retire (one round's step)

One application of this rule is what "Rebuild algorithm" step 2 runs once per prior round in
the fold, and once more for the current run. It always takes two inputs — **a round number**
and **that round's own reported findings** — against the ledger-so-far:

- **Matched** — a fingerprint present in both the ledger-so-far and this round's findings.
  Keep the existing `first-seen` round unchanged. Update `status` from this round's bucket
  (§"Status vocabulary") — if the prior status was `fixed`, this transition **reopens** it
  (status moves to whatever this round's bucket implies, never staying `fixed` while this
  round still reports it). Replace `contributing lenses` with this round's tags for that
  fingerprint. Never recompute `first-seen` as if this were a new entry.
- **Inserted** — a fingerprint this round reports that no ledger-so-far entry names. Insert a
  new entry: `first-seen` = this round's own number, `status`/`contributing lenses` from this
  round's bucket.
- **Retired** — a ledger-so-far fingerprint that this round's findings do not name at all.
  Set `status: fixed`. Keep the entry — its `first-seen` round and `contributing lenses` stay
  exactly as last recorded (the last-known contributors, not cleared) — never drop it from
  the render.

`refuted` is never assigned by any rule above; see §"Status vocabulary".

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
