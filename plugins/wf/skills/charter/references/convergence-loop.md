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

**Why the authorization-consuming branches carry the same three outcomes.** The post-revision diff
has exactly three possible answers — no new id, the one id the authorization covers, and anything
else — and both paths that *consume* a recorded authorization state all three: rule 1's growth-
authorize branch and rule 4's blocking-findings revision. An authorization is not a licence for
*any* growth, only for the one id addressing its own recorded `<gap>`, so a second or mismatched
id is unauthorized growth on either path and lands on the same user-routed check. Rule 1's
ordinary-answer path deliberately names just one outcome: as the section above explains, an
ordinary answer's own new id is always auto-legitimized, so it has neither a "beyond what was
authorized" case nor a separate no-new-id case to state — the single clause covers both. Matching
each new id against an entry recorded *for the current round* — rather
than any unconsumed entry anywhere in the log — keeps a stale grant from an earlier round from
silently absorbing an unrelated id.

**Why the round snapshot is written at most once per round.** The snapshot is the pre-round
baseline the next round's reviewer diffs against, so it must capture the artifacts as the round
just reviewed saw them. A round can dispatch more than once — two authorized `[growth]` items, or
a growth item alongside an ordinary answer — and every dispatch mutates the artifacts; re-writing
the snapshot before the second would bake the first dispatch's new id into the baseline and hide
it from the next round's growth check. So the once-per-round rule lives on the single snapshot
write in rule 4 that every branch references, rather than being restated per branch where one copy
could drift. Discounting ids already consumed earlier in the same round when diffing is the other
half: one true baseline per round, with each authorization still judged on its own.

### SUB-3 — size-budget numbers and the OUT-4 blocking exception

**The numbers, and where they come from.** `02_subtasks.md`: 40 lines per `## SUB-n` block, 220
lines total. `01_charter.md`: 140 lines total. All three are the corpus's own converged ceiling,
not a headroom-padded guess. Measured directly off the four charter folders that reached
`Converged`, `02_subtasks.md` ran 112 lines (C026), 177 (C027), 198 (C028) and 220 (C025), and
`01_charter.md` ran 107 (C025), 111 (C028), 121 (C027) and 140 (C026) — a 112–220 and a 107–140
band respectively. (These are file measurements taken from the corpus itself, not a restatement of
"The non-convergence pattern" above, which discusses only which rounds came back clean.) Each budget is set at
the top of the range charters that actually reached `Converged` already lived inside — a budget any
of those four runs would have passed without a single size-related revision. The runaway cases
(`02_subtasks.md` 1793 lines in C029, 1436 in C030; `01_charter.md` 582 lines in C029) sit well over
these numbers — roughly 8.15x and 6.53x for the two decompositions, and roughly 4.16x for the
charter — so the budget separates the two populations cleanly on every one of the three figures
rather than splitting hairs at the margin. The per-SUB-block figure comes from the same bloat data at finer grain, measured
directly against the on-disk blocks rather than estimated: C029's `02_subtasks.md` has 19 `SUB-n`
blocks averaging 84.5 lines (range 57–147); C030's has 11 averaging 114.6 lines (range 58–169) —
combined, roughly 85–115 lines per block even in the two runaway files, well short of what an
1793-or-1436-line total alone would suggest, because a large share of the bloat sits in the two
files' `Coverage map`/`Dependency order` prose and inter-block repetition rather than in any single
block. Measured against `charter-decomposer.md`'s own template, which specifies thirteen required
fields per block (Covers, Complexity, Type, Depends on, Actor, Problem slice, Desired outcome,
In scope, Out of scope, Acceptance scenarios, Constraints, Assumptions, Verification evidence), the
40-line budget still cuts the observed per-block average by more than half (roughly three lines per
field against the template) — tight enough to force the prose fields back to one or two sentences without
being so tight that a compliant block becomes unwritable.

**Why the ceiling of the converged range, not its middle or a padded multiple.** A budget set at the
corpus *median* would flag artifacts the loop has already shown can converge, manufacturing findings
against a population this slice has no evidence is actually too large — the whole point of grounding
the number in the corpus is to bind the mechanism to observed reality, not to a fresh guess. A budget
padded well above the ceiling (say, 2x) would still catch the runaway cases but would stop being a
meaningful signal for anything short of a 2-4x blowout, silently permitting a slow re-drift back
toward C029/C030-scale bloat one moderately-oversized revision at a time. Setting the number at the
ceiling itself is the tightest bound the existing evidence supports without contradicting a single
converged data point.

**Why the 220-line total isn't reconciled against the 7–10 sub-task Count sanity band by raising
the total.** The decomposer's pre-existing Count sanity guidance (Procedure step 5) sanctions 7–10
sub-tasks for a multi-actor or rollout-boundary charter; ten bare-template blocks alone (roughly
21 lines each before real prose) already sit near 210 of the 220-line total, so a legitimately
wide charter can reach the top of both ranges at once. Raising the total to create headroom for
that case would undo the corpus grounding above — the fix would no longer bind to what actually
converged, only to what the largest sanctioned split could need. Instead a charter that reaches
both ceilings together reports through the same channel as an irreducible per-block overrun
(`Flags: product choice needed: <one line>`): the choice between a leaner split and an authorized
overrun is a product decision, not evidence that either number is wrong.

**Why a size-budget trim may cross sub-tasks or sections a routed finding didn't name.** The
decomposer's revision-mode byte-stability rule and the writer's "no drive-by rewrites" rule both
exist to stop an *unrelated* finding from causing collateral rewrites elsewhere in the artifact —
but a **total**-budget overrun is, by definition, a property of the whole file, not of any one
block or section a reviewer finding could single out (checklist row 15's pass condition is a
conjunction of the total and every per-block figure). Confining a total-budget trim to only the
finding's named location would make the total budget unenforceable in exactly the case it exists
to catch: every individual block within its own cap, the file over its total anyway. The two
existing rules are therefore stated to bind unrelated findings, and this one is named as the
exception, not a general licence to rewrite at will.

**Why an overrun blocks unconditionally instead of following the changed-text rule.** WF-551's
round ≥2 rule blocks a HIGH finding only when the reviewer's snapshot diff marks its section as
changed — the rule exists because an untouched HIGH is, by construction, one the current revision
did not introduce and could not have broken (see "Why blocking is CRITICAL-anywhere-or-HIGH-on-
changed-text, not zero" above). Size does not have that property: `02_subtasks.md` or
`01_charter.md` can cross its budget through *cumulative* drift across several rounds' worth of
small, individually-innocuous additions — findings elsewhere in the loop legitimately add a
qualifying scenario, a constraint, or a clarified edge case round after round — with no single round
being the one whose diff the snapshot would mark as the offending change. A rule that only blocks on
changed text would let exactly this drift through indefinitely, reproducing the C029/C030 pattern
one small, individually-defensible revision at a time. Blocking unconditionally — reading the
artifact's current line count, never the diff — is therefore the one check in the checklist that
cannot be a changed-text exception without defeating its own purpose; `charter-reviewer.md` states
this directly (Mandate section, verification step 3) as a named exception beside the changed-text
rule, and `SKILL.md` Phase 5 rule 4 already assumed exactly this shape before this slice supplied
the numbers.

**Why the round-1 half of that is a severity floor rather than a host rule.** The Mandate exception
alone only reaches round ≥2, because it is worded against the changed-text diff and round 1 has no
diff to except from. Round 1 is governed instead by `SKILL.md` Phase 5 rules 3 and 4, which read
*severity* — "no CRITICAL or HIGH" routes to the warnings-only path, where a headless run auto-
accepts MEDIUM/LOW. A check-15 finding scored MEDIUM or LOW in round 1 would therefore have
converged with a live overrun in place: the exact drift the check exists to stop. Two fixes were
available — teach Phase 5 rules 3/4 to read the `blocking:` tag in round 1, or floor check 15's
severity at HIGH so the rules already there catch it. The floor wins on cost: it is one clause in
the role contract that already owns severity, against an edit to a host ops doc this slice is
required not to grow, and it removes rather than adds a contradiction — the Severity section's
"LOW never blocks on its own" no longer has a check-15 case pulling the other way. It also keeps
the OUT-4 row exactly the single blocking class outside "CRITICAL anywhere or HIGH on changed text"
that OUT-1 and OUT-2 name it as, with no second mechanism in the host to keep in sync.

**Why overrun is a finding, never a truncation.** Cutting an artifact by machine to fit a budget
would silently delete acceptance scenarios, outcomes, constraints, or non-goals with no author in
the loop to judge whether the cut content was load-bearing — trading one failure mode (bloat) for a
worse one (silent scope loss no later round would ever detect, since the deleted text leaves no
trace to review). Routing the overrun as an ordinary reviewer finding keeps a human-legible author
in the loop: `decomposer`/`charter-writer` trims prose first, and the existing `Flags:` /
`## Open questions` escape hatch — already wired for `[growth]` and other product choices — carries
the rare case where no cut is possible without dropping acceptance content, so that decision reaches
the user explicitly instead of disappearing into an auto-truncation.

**Why a successful trim is reported too, not just an irreducible one — and what "reported" means
here.** The ordinary case — a routed overrun finding gets fixed within budget — should be visible
somewhere, the same way an irreducible overrun is visible via `Flags:`/`## Open questions`, rather
than vanishing the moment the fix succeeds. The decomposer already had a generic `Flags:` line to
extend. The writer's output contract had no equivalent free-text field — `Charter:`, `Outcomes:`,
`Scope changed:`, and `Assumptions:` are all narrowly typed — so this slice adds one `Flags:` line
to `charter-writer.md`'s output contract, used only for `trimmed to size budget: <one line>` (the
irreducible case keeps using `## Open questions`, unchanged). **This makes the fact visible in the
subagent's own terminal output for the dispatch that made it — it does not, by itself, make the
trim durable the way the reviewer's block (appended verbatim to `03_review-log.md`) or a routed
decomposer `Flags:` entry (read and acted on by `SKILL.md` Phase 3) already are.** Wiring
`SKILL.md` to read and durably record this new field is out of this slice's touched-file set (its
constraint scopes `SKILL.md` changes to "ask first"), so that wiring is a deliberate, named,
deferred gap rather than a silent one — a fast-follow, not a claim this slice already closes.
Adding a line to a role's grepped output-block shape is exactly the case `CLAUDE.md` §8 reserves
for a MINOR bump even pre-1.0; this
slice ships as MINOR rather than PATCH for that reason alone — nothing else in it changes shape.

### SUB-4 — the cap gate and user-authorized extensions

*(reserved — SUB-4 adds its rationale for the cap-hit user gate and how a user-authorized
extension is represented, building on the C020/C029 ad-hoc-extension precedent cited above.)*
