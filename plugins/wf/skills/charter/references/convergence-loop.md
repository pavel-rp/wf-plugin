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

**The problem this closes.** Before this change, a revision-mode writer or decomposer could add a
new `OUT-n`/`SUB-n` id while fixing an unrelated finding, so the artifact a round reviewed was
never the one reviewed before — the corpus shows this directly (C031 grew 4→8 sub-tasks across its
revisions, C020 10→27). A round's own fix could therefore seed the next round's findings on
material the previous round never saw, which is a second, independent source of non-convergence
alongside the "stale full audit" problem SUB-1 closes.

**Why the host is the sole growth detector, not the writer/decomposer/reviewer.** The writer and
decomposer are isolated, stateless subagents dispatched fresh each round (per "Why the host
persists state, not the reviewer" above) — neither has a view of what ids existed *before* its own
dispatch, so neither can self-certify "I did not grow scope." The reviewer is read-only and
already has a narrower job (routing, not counting). Only the host survives across rounds and
already owns the prior-round snapshot SUB-1 introduced, so comparing the post-revision artifacts'
active ids against that snapshot — immediately after every revision dispatch, before the next
review — is the only place in the loop where "did an id appear that wasn't authorized" can be
checked mechanically rather than trusted to self-report.

**Why a textual `[growth]` marker instead of a new output-block field.** The spec constraint ruled
out a new writer/decomposer output-block field (no schema growth for a mechanism this narrow), and
the charter's own review log (F2.1, round 2) already flagged that the writer's contract had no
room for a structured growth signal without one. A literal substring inside an existing free-text
field — `## Open questions` for the writer, `Flags:` for the decomposer, the finding/question text
for the reviewer — needs no contract change and is trivially greppable by the host, which is all
the mechanism needs: the host does not parse structure out of the tag, it only checks for its
presence before deciding whether to defer a question to the two-option gate.

**Why growth is detected from the id diff, never from `Scope changed:`.** `Scope changed: yes` was
already overloaded before this slice — a reword or a retirement legitimately changes scope-bearing
text without growing the id count, and the charter's own accepted assumptions (see the umbrella
outcomes table, OUT-3) require distinguishing the two. Only a strict comparison against the
prior-round snapshot's id set can tell "this outcome's wording changed" from "the outcome count
grew," which is why the check reuses SUB-1's snapshot mechanism directly rather than adding a
second one.

**Why the gate is exactly two options, recorded in the review log.** This mirrors the existing
accept-as-is warnings gate (`## Accepted warnings`) precisely — same shape (a two-option
`AskUserQuestion`), same host-owned durable record (`03_review-log.md`), same resume discipline
(re-read before re-asking). A gap that turns out to need new scope is not a defect to route back
silently; it is a genuine product decision (ship without it and warn, or spend a revision growing
scope), and the existing warnings-gate precedent already established that such decisions belong to
the user, recorded, not re-litigated on resume.

**Why a rule-1 answer auto-authorizes rather than asking twice.** When an *ordinary* (non-
`[growth]`) user answer is folded in under Phase 5 rule 1 and its integration turns out to need a
new id, the user has already made the decision that produced the id — asking a second time
("would you like to authorize the id your own answer just required?") would be pure friction with
only one sane response. The charter's own intake answer (Q4.1) confirmed this reading; the
post-revision check auto-records that answer as the authorization instead of raising a redundant
gate.

**Why every id-diff branch carries the same three outcomes.** The post-revision diff has exactly
three possible answers — no new id, the one id the authorization covers, and anything else — and
every dispatch path that can grow the artifacts states all three. An authorized dispatch is not a
licence for *any* growth, only for the one id addressing its own recorded `<gap>`, so a second or
mismatched id is unauthorized growth on the authorized path exactly as it is on the blocking-
findings path, and lands on the same user-routed check. Matching against *this dispatch's own*
entry, rather than any unconsumed one, keeps a stale grant from an earlier round from silently
absorbing an unrelated id.

**Why the round snapshot is written at most once per round.** The snapshot is the pre-round
baseline the next round's reviewer diffs against, so it must capture the artifacts as the round
just reviewed saw them. A round can authorize more than one `[growth]` item, and each authorized
dispatch mutates the artifacts; re-writing the snapshot before the second dispatch would bake the
first dispatch's new id into the baseline and hide it from the next round's growth check. Writing
it once per round — and discounting ids already consumed earlier in the same round when diffing —
keeps one true baseline per round while still letting each authorization be judged on its own.

### SUB-3 — size-budget numbers and the OUT-4 blocking exception

*(reserved — SUB-3 adds the chosen per-SUB and total-line budget numbers and the rationale for why
a size overrun blocks unconditionally, the one exception to the changed-text rule this slice
names structurally in `SKILL.md` Phase 5 rule 4 without picking numbers.)*

### SUB-4 — the cap gate and user-authorized extensions

*(reserved — SUB-4 adds its rationale for the cap-hit user gate and how a user-authorized
extension is represented, building on the C020/C029 ad-hoc-extension precedent cited above.)*
