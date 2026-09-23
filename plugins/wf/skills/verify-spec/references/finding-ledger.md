# The finding ledger — field set, algorithm, and round derivation

The paired ops half for `verify-spec/SKILL.md`'s `## The finding ledger` section — read at
runtime, at the rebuild step that section names. Rationale, the extended walkthrough, and a
worked example: `finding-ledger-rationale.md` (paired reference, never read at runtime).

## Ledger field set

One entry per distinct fingerprint ever seen across the current loop. Five required fields:
**fingerprint** (the finding's identity, `file:section|defect`, WF-566's shape — the ledger
key); **defect** (the `defect` half of the fingerprint, its own field); **first-seen round**
(the round number, below, of the **earliest** round, in the fold under "Rebuild algorithm",
whose findings name this fingerprint — never recomputed once set, §"Match / insert /
retire"); **status** (one of the six values below); **contributing lenses** (the
`<lens>/<check>` or bare `<lens>` provenance tags the most recent matching round reported,
exactly as aggregation, `verify-spec/SKILL.md` §"Fire the `verify` phase", already collapsed
them — replaced wholesale on every match, never merged).

## Status vocabulary

- **open** — in the current run's aggregated findings, since first seen or last reopened.
- **fixed** — was in the ledger but no current-run finding names it; retired, never dropped.
- **refuted** — most recent match landed in `## Accepted warnings` **and** carries the
  critic's `DISAGREE` tag (`verify-spec/SKILL.md` §"Confirm candidate blocking findings"),
  assigned only when a critic dispatch actually ran and returned that verdict; a candidate the
  critic never saw, or a failed/malformed dispatch, stays `open` (fail-closed).
- **warn** — most recent match in `## Accepted warnings` **and** carries the critic's
  `UNVERIFIABLE` tag.
- **pre-existing** — most recent match in `## Pre-existing` (a `fail` anchored to neither a
  requirement nor the diff).
- **accepted** — most recent match in `## Accepted warnings` **without** any critic tag —
  every originally-`warn`-severity finding, whatever its anchor.

Status is set from where the most recent match rendered: `## Capability findings` → `open`
(always), `## Pre-existing` → `pre-existing`, `## Accepted warnings` → per the tag test above
— then overridden to `fixed` when a round's findings name the fingerprint nowhere. One status
field per entry, never layered (rationale: `finding-ledger-rationale.md` §"Status vocabulary").

## Round-number derivation

Read before "Rebuild algorithm" — its fold walks the trail in the order established here,
oldest-first from the boundary found. Extended walkthrough: `finding-ledger-rationale.md`
§"Round-number derivation".

Walk the trail — the current, not-yet-rotated `04_verify.md` if it exists, then every entry in
`04_verify.history.md` in its existing newest-first order (do not re-sort) —
**most-recent-first**. Both tests below scope to a report's own structural lines only (its
metadata block and its own `##`-level headings) — never a quoted snippet or nested code block.

1. Find the **loop boundary** — the most recent entry, scanning most-recent-first, whose
   header `**Verdict:**` reads `PASS`, **or** that is a **pre-fingerprint-capable entry** — one
   whose report carries **neither** a `## Pre-existing` **nor** an `## Accepted warnings`
   heading (a trailing qualifier, e.g. `(non-blocking)`, is decoration), structurally,
   regardless of row content — never the fingerprint marker shape (`file:section|defect`)
   itself, since a current-shape entry reporting zero fingerprints still renders both headings
   (each `- none`). Stop at the first entry satisfying either test — that is the boundary.
2. **Round = 1 + the count of entries strictly more recent than the boundary** that carry at
   least one of the two unconditional headings (counts whether or not the entry reported a
   fingerprint; only a genuine pre-fingerprint entry, or the boundary itself, does not). The
   boundary is never counted; everything at or before it is outside the loop.
3. **No boundary found** (only current-shape, non-`PASS` entries throughout, or an empty
   trail) — round = 1 + the count of such entries in the whole trail (empty → round 1); unlike
   rule 1's path, this walk has no boundary to bound it.

A fresh loop always restarts at round 1 immediately after a `PASS` (rule 1's first test).

**De-duplicating a resumed rotation.** Before this walk, collapse every adjacent pair in the
gathered trail — current `04_verify.md` + `.history.md`'s topmost entry, and any adjacent pair
*within* `.history.md` — sharing an **identical** `**Commit:**` **and** `**Audited at:**` pair,
into **one** entry (the more recent). Absorbs a run resumed mid-rotation (rationale:
`finding-ledger-rationale.md` §"De-duplicating a resumed rotation").

## Rebuild algorithm

Run on every invocation, before rendering `## Output`, entirely from artifacts — never held in
memory across runs:

1. **Derive the round number** and the **loop boundary** per "Round-number derivation" —
   identifying which trail entries are strictly more recent than the boundary: call these,
   oldest-first, **prior rounds 1 .. N-1** (**N** = the round just derived). The fold below
   never reads at or past a *found* boundary; rule 3's no-boundary fallback walks the whole
   trail instead, bounded in practice under `/wf:run` by its verify⇄fix cap (2 cycles) — a
   direct `/wf:verify-spec`/`/wf:verify-fix` invocation has no such bound.
2. **Fold the ledger forward, oldest-first, one round at a time** — this establishes a correct
   `first-seen`. Start from an **empty** ledger. For each prior round `r` = 1 .. N-1,
   oldest-first: parse that entry's fingerprint-bearing bullets (under `## Capability
   findings`, `## Pre-existing`, `## Accepted warnings`) as that round's reported findings,
   apply §"Match / insert / retire" with round `r` against the ledger-so-far; the result feeds
   round `r+1`. Finally apply §"Match / insert / retire" once more with round `N` and the
   current run's own aggregated findings against the ledger-so-far the fold produced.
3. **Render** `## Ledger` per `verify-template.md`, including its `**Round:**` line — the only place the report carries round `N`.

## Match / insert / retire (one round's step)

Runs once per prior round in the fold above, and once more for the current run — a round
number and that round's reported findings, against the ledger-so-far:

- **Matched** — fingerprint in both ledger-so-far and this round's findings: keep `first-seen`
  unchanged; update `status` from this round's bucket (a prior `fixed` **reopens**); replace
  `contributing lenses` with this round's tags. Never recompute `first-seen`.
- **Inserted** — fingerprint this round reports that no ledger-so-far entry names: insert with
  `first-seen` = this round's number, `status`/`contributing lenses` from this round's bucket.
- **Retired** — ledger-so-far fingerprint this round's findings don't name: set `status:
  fixed`; keep `first-seen` and `contributing lenses` as last recorded — never drop the entry.

A matched/inserted fingerprint's `status` is whatever this round's bucket assigns — including
`refuted`/`warn` on `critic: DISAGREE` / `critic: UNVERIFIABLE` tags — derived the same way for
every status, from the bucket the fold reads.

## Pre-dispatch derivation (changed sections, round ≥2)

`verify-spec/SKILL.md` derives round `N` under §"Inputs to load" item 3, then runs the
prior-rounds fold **before** dispatch (Rebuild algorithm steps 1–2 over rounds `1 .. N-1`; step
2's final pass runs after aggregation). At round ≥2 it also derives a second diff — distinct
from `SKILL.md`'s branch-vs-`main` diff under "Implementation scope" — between the **prior
round's `**Commit:**`** (off the same trail entry the boundary walk reads) and the **current
working tree**, dirty files included, never `HEAD`. Map each changed hunk's location through
the same `section` derivation the aggregator uses for fingerprints (`verify-template.md`
§"Pre-existing"), dedupe into `changed_sections` (a `file:section` list). Round 1 skips this.

**`open_fingerprints`** (round ≥2): every ledger-so-far entry whose `status` is `open`, off the
fold just produced — render `fingerprint`, `defect`, and `last seen: <lens>/<check>` verbatim
off `contributing lenses`. **Working-tree narrowing:** round 1 verifies against `HEAD`
(`SKILL.md`'s "Uncommitted changes"); round ≥2 the working tree *is* the audited change
(`verify-fix` never commits between rounds) — the `**Tree:**` list and `changed_sections` both
read the working tree, not `HEAD`.

## Loop identity (L)

Paired with round `N` to key a `/wf:run` verify-loop stop-gate record
(`verify-loop:l<L>:r<N>:<choice>`, `run/SKILL.md` §"The verify⇄fix stop gate") so a record
from a prior, finished loop can never answer a later loop's stop. **L = the count of
`04_verify.history.md` entries whose header carries `**Verdict:** PASS`** — one per loop this
task has finished. `L = 0` on a fresh task, +1 per completed loop. Computed identically by
`/wf:run` (minting a stop-gate subject) and `verify-spec`'s gate-accept demotion (looking one
up) — both read only `04_verify.history.md`, never the current not-yet-rotated `04_verify.md`.

## Gate-accept demotion

Applied by `verify-spec/SKILL.md` §"The blocking set" as its own last step, after its three
buckets are assembled and before `**Verdict:**` is derived. Using round `N` and loop identity
`L`, call `read_run_evidence({ workspaceRoot, taskId })` for a `matched` entry `kind:
gate-approval`, `subject: verify-loop:l<L>:r<N>:accept`. **No match** — proceed exactly as
`verify-spec/SKILL.md` already specifies. **Matched** — move every fingerprint under `##
Capability findings` (never a requirement `FAIL`/`PARTIAL`) into `## Accepted warnings`,
tagged `accepted: gate` alongside its provenance, and update the ledger fold for each to
`status: accepted`. Recompute `**Verdict:**` from the reduced blocking set: `PASS` when empty,
otherwise the requirement-driven `FAIL`/`PARTIAL` already carried. Consumes no record and sets
no flag of its own — matching the same subject again later reapplies the same demotion
idempotently; never applies to a different round or loop.
