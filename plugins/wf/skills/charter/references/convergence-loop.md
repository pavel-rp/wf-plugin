# Charter convergence loop — evidence and rationale

Paired reference for `SKILL.md` Phase 4–5 and `charter-reviewer.md`'s round-conditional mandate.
Not read at runtime — the ops body states the rules; this doc explains why they exist. Extended
in place by later sub-tasks under C032 rather than redesigned (see the reserved sections below).

## The non-convergence pattern (why the old "zero findings" rule failed)

Before this change, `/wf:charter` Phase 5 converged only on a `CLEAN` reviewer output — zero
findings at any severity — while `charter-reviewer.md` ordered a fresh, unfiltered, exhaustive
audit every round with no memory of what a prior round already routed and fixed. Every revision
therefore re-opened the whole artifact set to the same scrutiny that produced the original
findings, plus whatever the fix itself introduced, so a converging run needed the reviewer to
independently reach zero on every dimension in the same pass — a coincidence, not an outcome the
mechanism worked toward.

The corpus of prior charters under `{task-root}` (`_local/`, gitignored — see each charter's own
`03_review-log.md`) shows the pattern directly:

- **C032 (this charter)** — round 1→4 finding counts ran 20 → 5 → 1 → 4, never reaching `CLEAN`
  under the old rule; convergence here came only from a host-improvised verification prompt typed
  by the invoking user, not from the shipped skill.
- **C031** — stopped `CHARTER — Blocked` at the round cap (`Reviews: 4 · Revisions used: 3 of 3`)
  with two residual findings that were *not* a repeat of round 3's set (the no-progress guard
  never fired) — the loop was still making real progress when the fixed 3-revision budget ran out.
- **C020** — the cap itself was extended by hand eight times with no defined choice set and no
  resume rule (`Reviews: 12 · Revisions used: 11 of 11 (8 user-authorized extensions)`), the closest
  thing the corpus has to a mid-flight cap-extension precedent (owned by SUB-4, not this slice).
- **C029** similarly shipped at an extended cap (`Reviews: 5 · Revisions used: 5 of 5`), confirming
  the extension pattern was not a one-off.
- **C025 (round 2)** and **C030 (round 4)** *did* reach `REVIEWER — Round N: CLEAN` — the only clean
  rounds in the corpus, and both are consistent with a verification-style late round rather than a
  fresh unfiltered audit finding nothing on its own.

Read together, the corpus shows a loop that reliably converges only when something outside the
shipped mechanism narrows what a late round is allowed to re-litigate. This slice (SUB-1) makes
that narrowing part of the mechanism itself, keyed on the `Round: <N>` the host already passes.

## Why the host persists state, not the reviewer

`charter-reviewer.md` is dispatched fresh each round as an isolated subagent with no memory of
its own prior invocations — that isolation is deliberate (fresh eyes catch what a self-consistent
reviewer would rationalize past) and is not something this change relaxes. Anything a round ≥2
reviewer needs to know about *prior* rounds — what was routed, what the artifacts looked like
before the fix — has to arrive as input from something that does persist across rounds. That is
the host (`SKILL.md`), which already re-reads `03_review-log.md` and the on-disk artifacts every
iteration and survives `/clear` by design (State model). Snapshotting is therefore a host
responsibility recorded in the charter folder, not a reviewer-side cache.

## Why a stored snapshot, not an in-memory or live-repo comparison

Three alternatives were available for "what changed since the last round": (a) keep a diff in the
host's own conversation memory, (b) compare against version control history, (c) write a
host-owned snapshot file the next round's reviewer reads and diffs against. (a) doesn't survive a
`/clear`, which the State model explicitly must (`_local/` artifacts are the only durable state).
(b) assumes a VCS is active and a commit exists per round, which charter's own Safety Rules
forbid it from creating (`charter` never runs a delivery operation) — the loop iterates on
uncommitted local files by design (Loop contract), so there is nothing to diff in version control
most rounds. (c) needs no capability beyond what `charter` already has (Write inside the charter
folder) and resumes correctly from any point, including the in-flight-folder case where no
snapshot exists yet (`SKILL.md` Edge Cases). (c) was chosen for exactly that reason.

The diff itself is by **section heading**, not a line-level or semantic diff: `01_charter.md` and
`02_subtasks.md` are both heading-structured documents (Outcomes, Scope, SUB-n blocks, …), the
reviewer's own findings are already anchored to a `file § location` matching that structure
(the existing fingerprint form `route|check|artifact-section`), and a section-level granularity is
the coarsest one that still distinguishes "the fixed section changed" from "an unrelated section
changed" without requiring the reviewer to reconstruct semantic diff tooling inside an isolated,
read-only context. Host-owned metadata lines (`**Status:**`, `**Tracker:**`, `**Adopted umbrella:**`,
the publish ledger) are excluded from the diff so a permitted host edit — the only kind `charter`
performs outside a role's own artifact — never itself counts as "changed text" and manufactures a
false blocking finding.

## Why blocking is CRITICAL-anywhere-or-HIGH-on-changed-text, not "zero"

CRITICAL findings block unconditionally because, per the reviewer's own severity rubric, a CRITICAL
finding means the charter is not implementable as written regardless of which round produced it —
there is no text scope for which that is acceptable to defer. HIGH findings block only on changed
text because an untouched HIGH is, by definition, one the current round's revision did not attempt
to address and could not have broken; re-blocking on it every round is exactly the mechanism that
kept the corpus from converging. MEDIUM/LOW never block on their own (unchanged from the original
design) — they route to the existing accept-as-is warnings gate, whose fingerprint suppression
(`## Accepted warnings`) already exists for this purpose and needed no change here.

## Reserved for later sub-tasks

The sections below are placeholders this doc's later C032 sub-tasks fill in — extend them in
place rather than restructuring this document.

### SUB-2 — scope freeze and growth authorization

*(reserved — SUB-2 adds its rationale for freezing charter scope after round 1 and gating growth
revisions here.)*

### SUB-3 — size-budget numbers and the OUT-4 blocking exception

*(reserved — SUB-3 adds the chosen per-SUB and total-line budget numbers and the rationale for why
a size overrun blocks unconditionally, the one exception to the changed-text rule this slice
names structurally in `SKILL.md` Phase 5 rule 4 without picking numbers.)*

### SUB-4 — the cap gate and user-authorized extensions

*(reserved — SUB-4 adds its rationale for the cap-hit user gate and how a user-authorized
extension is represented, building on the C020/C029 ad-hoc-extension precedent cited above.)*
