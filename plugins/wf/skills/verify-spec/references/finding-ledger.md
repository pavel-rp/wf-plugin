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
- [Rebuild algorithm](#rebuild-algorithm)
- [Round-number derivation](#round-number-derivation)
- [Match / insert / retire](#match--insert--retire)
- [Worked example](#worked-example)

## Ledger field set

One entry per distinct fingerprint ever seen across the current loop. Five fields, each
required on every entry:

- **fingerprint** — the finding's identity, `file:section|defect` (WF-566's shape,
  unchanged). The ledger key.
- **defect** — the `defect` half of the fingerprint, carried as its own field so a rendered
  row doesn't force a reader to parse it back out of the fingerprint string.
- **first-seen round** — the round number (see below) at which this fingerprint was first
  inserted. Never recomputed once set — a later round that re-matches the same fingerprint
  keeps this value unchanged.
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
  `fail`. Independent of `open`/`fixed`: a `warn` fingerprint can be `open` (still reported)
  or `fixed` (stopped recurring) exactly as a `fail` one can.
- **pre-existing** — the fingerprint's most recent match landed in the report's
  `## Pre-existing` bucket (anchored to neither a requirement nor the diff).
- **accepted** — the fingerprint's most recent match landed in `## Accepted warnings`.

A fingerprint's status is set from **where its most recent match rendered** (`## Capability
findings` → `open`/`warn` per severity, `## Pre-existing` → `pre-existing`, `## Accepted
warnings` → `accepted`), then overridden to `fixed` when the current run reports it nowhere
at all. `open`/`warn` and `pre-existing`/`accepted` are not layered — each entry carries
exactly one status, the one its most recent bucket implies.

## Rebuild algorithm

Run this **on every invocation**, before rendering `## Output`, entirely from artifacts —
never held in memory across runs:

1. **Gather the trail.** Parse every fingerprint-bearing finding bullet (the bullets under
   `## Capability findings`, `## Pre-existing`, and `## Accepted warnings` — every one
   already carries its fingerprint per WF-566) out of:
   - the current, not-yet-rotated `04_verify.md`, if it exists (this is the most recent
     entry in the trail, not yet part of the `.history.md` rotation), then
   - every entry in `04_verify.history.md`, if it exists, in the order they already appear
     there (newest-first — `_shared/pipeline-conventions.md`'s rotation convention prepends
     each newly-rotated entry, so file order already **is** recency order; do not re-sort).

   An entry with **no** fingerprint-bearing bullets at all (no `file:section|defect` marker
   anywhere in it — a report written before WF-566, or one whose registry was empty) is a
   **pre-fingerprint entry**. It contributes nothing to the ledger and is never itself
   assigned a round number; it only matters as a possible loop boundary (next section).

2. **Derive the round number** — see below.

3. **Match / insert / retire** the ledger against the current run's own aggregated findings
   (the three buckets already in hand at this point in `SKILL.md`, before `## Output`) — see
   below.

4. **Render** the `## Ledger` section per `verify-template.md`, and surface the round number
   wherever the report/chat summary already reference it.

## Round-number derivation

Walk the trail gathered in step 1, **most-recent-first** (current `04_verify.md`, then each
`.history.md` entry in its existing, already-newest-first order):

1. Find the **loop boundary** — the most recent entry, scanning most-recent-first, that is
   **either**:
   - carries `**Verdict:** PASS`, **or**
   - is a pre-fingerprint entry (no fingerprint markers at all).

   Stop at the first entry satisfying either test. That entry is the boundary. It is
   evaluated in trail order, so a `PASS` and a pre-fingerprint entry never need to be
   compared against each other by timestamp — whichever one the most-recent-first walk
   reaches first **is** "the later of the two", because most-recent-first walk order **is**
   recency order.

2. **Round = 1 + the count of fingerprint-bearing entries strictly more recent than the
   boundary** (i.e., encountered *before* the boundary in the most-recent-first walk). The
   boundary entry itself is never counted. Every entry at or before the boundary — including
   every pre-fingerprint entry older than the boundary — is outside the loop: it neither
   counts toward the round number nor raises an error for lacking fingerprints.

3. **No boundary found** (the trail holds only fingerprint-bearing, non-`PASS` entries all
   the way back, or the trail is empty) — round = 1 + the count of fingerprint-bearing
   entries in the whole trail (empty trail → round 1).

A fresh loop always restarts at round 1 immediately after a `PASS` — rule 1's first test
guarantees this, since a `PASS` entry is always eligible as a boundary regardless of whether
it carries fingerprints.

## Match / insert / retire

Against the ledger rebuilt through the boundary (every fingerprint inserted by a prior round
up to and including the round just derived, minus the derived round's own not-yet-applied
current-run findings) and the **current run's own aggregated findings** (the three buckets,
already fingerprinted, already in hand before `## Output`):

- **Matched** — a fingerprint present in both the rebuilt ledger and the current run. Keep
  the existing `first-seen` round unchanged. Update `status` from the current run's bucket
  (§"Status vocabulary") — if the prior status was `fixed`, this transition **reopens** it
  (status moves to whatever the current bucket implies, never staying `fixed` while the
  current run still reports it). Replace `contributing lenses` with the current run's tags
  for that fingerprint. Never recompute `first-seen` as if this were a new entry.
- **Inserted** — a fingerprint the current run reports that no rebuilt ledger entry names.
  Insert a new entry: `first-seen` = the round just derived, `status`/`contributing lenses`
  from the current run's bucket.
- **Retired** — a rebuilt-ledger fingerprint that the current run's aggregated findings do
  not name at all. Set `status: fixed`. Keep the entry — its `first-seen` round and
  `contributing lenses` stay exactly as last recorded (the last-known contributors, not
  cleared) — never drop it from the render.

`refuted` is never assigned by any rule above; see §"Status vocabulary".

## Worked example

`corpus-archive/verify-replay-wf554/rounds/round-01.md` through `round-07.md` are seven
real `04_verify.md` reports, each `**Verdict:** PARTIAL`, **none** carrying a fingerprint
marker (all predate WF-566). Rotated into `04_verify.history.md` in the shape the rotation
convention produces (newest-first: `round-07` topmost, `round-01` last), then two synthetic
fingerprint-bearing `PARTIAL` entries are appended **after** `round-07` — i.e. they are more
recent than all seven, sitting above `round-07` in the trail (one as the current,
not-yet-rotated `04_verify.md`, the other as the newest `.history.md` entry).

Walking most-recent-first: the two synthetic entries are fingerprint-bearing and not `PASS`,
so neither is a boundary — skip both, count = 2. `round-07` is the next entry: it carries no
fingerprint markers, so it **is** the boundary (rule 1's second test) — stop here. `round-01`
through `round-06`, all older than the boundary, are never reached by the walk and neither
count nor error.

Round = 1 + 2 = **3**. This is the fixture behind the plan's Success Criterion 3. Appending a
`PASS` entry anywhere in this trail (e.g. immediately after the two synthetic entries, as a
successful re-verify) would make that `PASS` entry the boundary instead — the walk reaches it
before either pre-fingerprint or older fingerprint-bearing entry — restarting the next run at
round 1 of a new loop.
