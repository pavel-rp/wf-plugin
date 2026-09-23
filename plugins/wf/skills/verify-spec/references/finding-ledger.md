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
- [Pre-dispatch derivation (changed sections, round ≥2)](#pre-dispatch-derivation-changed-sections-round-2)
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
- **refuted** — the fingerprint's most recent match landed in `## Accepted warnings` **and**
  that match carries the critic's `DISAGREE` tag (`verify-spec/SKILL.md` §"Confirm candidate
  blocking findings") — a candidate the isolated critic returned `DISAGREE` on, cited code and
  all. Assigned only when a critic dispatch actually ran and returned that verdict for this
  fingerprint; a candidate the critic never saw (empty candidate set) or a dispatch that
  failed/was malformed never reaches this status — it stays `open` instead (fail-closed).
- **warn** — the fingerprint's most recent match landed in `## Accepted warnings` **and** that
  match carries the critic's `UNVERIFIABLE` tag — a candidate that was `fail`-severity and
  anchored until the critic could not confirm or refute it. Distinct from both `refuted` and
  `accepted` (below): all three bucket-match in `## Accepted warnings`, but each is read off a
  different tag state on that match — `DISAGREE` tag, `UNVERIFIABLE` tag, or no critic tag.
- **pre-existing** — the fingerprint's most recent match landed in the report's
  `## Pre-existing` bucket (a `fail` anchored to neither a requirement nor the diff).
- **accepted** — the fingerprint's most recent match landed in `## Accepted warnings` **without**
  any critic tag — every originally-`warn`-severity finding, whatever its anchor.

A fingerprint's status is set from **where its most recent match rendered** — the bucket
decides it, with one three-way tag branch inside a single bucket (`## Accepted warnings`,
`refuted` vs `warn` vs `accepted`, above) and none elsewhere: `## Capability findings` → `open`
(always; that bucket never holds anything but a critic-confirmed or fail-closed blocking
`fail`), `## Pre-existing` → `pre-existing`, `## Accepted warnings` → `refuted`/`warn`/`accepted`
per the tag test above — then overridden to `fixed` when a round's own findings name the
fingerprint nowhere at all. **Single-valued, not layered** — an
entry carries exactly one status field, so retiring a `pre-existing`/`accepted` fingerprint to
`fixed` deliberately discards which bucket it last matched: once nothing reports it, which
bucket it used to render in has no further consequence for anything this rebuild does, so
there is no second field to preserve it in. This is a stated simplification, not an
oversight — if a future consumer needs the pre-retirement bucket, that is a new field to add
then, not a gap in the rule as written today.

## Round-number derivation

Read this section before "Rebuild algorithm" below — the fold that section describes walks
the trail in the order this section establishes, oldest-first from the boundary it finds.

Walk the trail — the current, not-yet-rotated `04_verify.md` if it exists, then every entry
in `04_verify.history.md` in its existing, already-newest-first order (the rotation
convention prepends each newly-rotated entry, so file order already **is** recency order; do
not re-sort) — **most-recent-first**:

**Both tests below are scoped to the report's own structural lines only** — its top-of-file
metadata block and its own `##`-level section headings — **never** to an occurrence inside a
quoted snippet, evidence citation, or nested code block elsewhere in the same report. A
lens's own evidence can legitimately quote source text containing `**Verdict:** PASS` or
`## Accepted warnings` verbatim (this repo's own corpus fixture does exactly that — see
Worked example); matching such a substring anywhere in the document body would misidentify
the boundary. Concretely: the `**Verdict:**` test matches only the single such line in the
report's header block, before its first `##` heading; the heading test matches only an actual
`##`-level heading line (one starting the line with `## `), never text inside backticks, a
fenced code block, or a quoted bullet.

1. Find the **loop boundary** — the most recent entry, scanning most-recent-first, that is
   **either**:
   - its header's `**Verdict:**` line reads `PASS`, **or**
   - is a **pre-fingerprint-capable entry** — one whose report carries **neither** a
     `## Pre-existing` **nor** an `## Accepted warnings` heading (allowing an optional
     trailing qualifier on the latter, e.g. `## Accepted warnings (non-blocking)` — the
     qualifier is decoration, not a shape change), present or absent as a *structural* fact,
     independent of whether either section has any rows. Those two headings are
     unconditionally rendered — even empty, as a lone `- none` line — by every report the
     current `verify-template.md` shape produces, so their total *absence* is what marks an
     entry written under an older report shape (e.g. this repo's own
     `corpus-archive/verify-replay-wf554/rounds/*.md` fixture, confirmed to carry neither
     heading — and to carry a quoted, non-heading occurrence of the string `` `## Accepted
     warnings` `` inside one evidence bullet, which the structural scoping above correctly
     ignores). **Do not** test for the fingerprint marker shape (`file:section|defect`)
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
   (empty trail → round 1). This is the one path whose walk is **not** bounded by a boundary
   entry — see the note on "Rebuild algorithm" step 1 below for how far it can actually reach
   in practice.

A fresh loop always restarts at round 1 immediately after a `PASS` — rule 1's first test
guarantees this, since a `PASS` entry is always eligible as a boundary regardless of its own
heading shape.

**De-duplicating a resumed rotation.** Before this walk, collapse **every** adjacent pair in
the gathered trail — the current not-yet-rotated `04_verify.md` and `.history.md`'s topmost
entry, **and** any adjacent pair *within* `.history.md` itself — that carries an **identical**
`**Commit:**` **and** `**Audited at:**` pair, treating each such pair as **one** entry (the
more recent of the two). `## Output`'s rotate-then-overwrite is two separate writes
(the shared pipeline conventions doc, `resolve_content` `class: shared`,
`ref: pipeline-conventions.md`, §"Artifact rotation into `.history.md`" — left unchanged); a run resumed between the rotation and the overwrite
duplicates that one report into the trail permanently — not only in the resumed run's own
read, but as two adjacent, identical-header entries thereafter sitting in
`04_verify.history.md` for every later run to re-encounter. Scoping the collapse to *any*
adjacent duplicate pair, not only "current vs. history's topmost", is what makes this durable:
every later run's own gather step re-applies the same rule and re-collapses the same stray
pair again, so the one-time non-atomic write is permanently absorbed on the read side and
never corrupts a `first-seen` or a round tally, on this run or any future one.

## Rebuild algorithm

Run this **on every invocation**, before rendering `## Output`, entirely from artifacts —
never held in memory across runs:

1. **Derive the round number** and the **loop boundary** per "Round-number derivation" above
   — this also identifies exactly which trail entries are strictly more recent than the
   boundary: call these, oldest-first, **prior rounds 1 .. N-1**, where **N** is the round
   number just derived for the current run. The fold below never reads at or past a *found*
   boundary, so on that path it is bounded by construction — it does not re-parse the
   unbounded tail of an ever-growing `.history.md` beyond that point. The one exception is
   "Round-number derivation" rule 3's **no-boundary** fallback (no `PASS`, no
   pre-fingerprint-capable entry anywhere in the trail): that path genuinely walks the whole
   trail, with no cap of its own. Under `/wf:run` its verify⇄fix cap (2 cycles) bounds the
   trail; a direct `/wf:verify-spec` or `/wf:verify-fix` invocation outside `/wf:run` has no
   such bound, and this path then walks every current-shape entry back to the start of the
   history. That cost is accepted — the walk reads headers and finding bullets only.

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

3. **Render** the `## Ledger` section per `verify-template.md`, including its `**Round:**`
   line — the only place the report carries round `N`; the chat summary does not.

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

A matched or inserted fingerprint's `status` is whatever this round's bucket assigns
(§"Status vocabulary") — including `refuted` and `warn`, when the round's own report tags the
match `critic: DISAGREE` / `critic: UNVERIFIABLE` respectively. This rule does not special-case
those two statuses; it derives every status the same way, from the bucket the fold above reads.

## Pre-dispatch derivation (changed sections, round ≥2)

`verify-spec/SKILL.md` derives round `N` (above) under §"Inputs to load" item 3, and at the start
of §"Fire the `verify` phase" runs the prior-rounds fold **before** dispatch — "Rebuild algorithm"
step 1 and step 2's loop over rounds `1 .. N-1`; step 2's final "once more" pass over the current
run's findings runs after aggregation. At round ≥2 it also derives a second diff, distinct from `SKILL.md`'s branch-vs-`main` diff gathered
under "Implementation scope", between the **prior round's `**Commit:**`** (parsed off the same
most-recent trail entry the round-derivation boundary walk reads) and the **current working
tree**, dirty files included, never `HEAD`. Map every changed hunk's location through the same
`section` derivation the aggregator already uses for fingerprints (`verify-template.md`
§"Pre-existing" — the enclosing markdown heading for prose, the enclosing symbol/declaration for
source, the file itself when neither exists), and dedupe into a `file:section` list —
`changed_sections`. This runs the section-key function forward (from a diff, to build a list)
rather than backward (from a finding's citation, to key it); no new section-key rule is
authored. Round 1 skips this entirely — there is no prior round to diff against.

**`open_fingerprints` derivation.** Also at round ≥2: read `open_fingerprints` off the same
ledger-so-far the fold above just produced — every entry whose `status` field (§"Status
vocabulary") is `open`, and only those; `fixed`/`pre-existing`/`accepted` entries are not
carried into the dispatch prompt. For each, render its `fingerprint`, its `defect` field, and
`last seen: <lens>/<check>` read verbatim off that entry's `contributing lenses` field (the
provenance already recorded there, unchanged by this read). No new field or status is
introduced — this is a read of the ledger-so-far the fold already built.

**Working-tree narrowing.** At round 1, `SKILL.md`'s "Uncommitted changes" edge case still
applies — verify against `HEAD`. At round ≥2 the working tree *is* the audited change
(`verify-fix` never commits between rounds), so both the report header's `**Tree:**` dirty-file
list and the `changed_sections` diff above read the working tree, not `HEAD`.

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
