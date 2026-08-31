# closeout-review — rationale (read by authors, never at slot-fire)

The paired reference for [`../fragments/closeout-review.md`](../fragments/closeout-review.md). The
fragment carries only behaviour; everything that explains *why* it is shaped that way lives here and
is never read at runtime.

---

## The incident

The C029 fleet run (WF-480) shipped 21 pull requests unattended. The capped-review rule held — no
run waited indefinitely on a reviewer — but across eight of those pull requests (#277, #278, #280,
#283, #287, #291, #293, #296) the automated reviewer's verdict landed *minutes after* the caps
expired and the merge completed. Nothing in the pipeline revisits a merged pull request, so those
verdicts sat unread until a manual sweep filed WF-503–WF-506, which in turn surfaced one confirmed
contract bug, one confirmed hardening gap, and a behavioural escalation (WF-521).

The instances were symptoms. The mechanism is the gap: **feedback that arrives after ceremony is
systematically orphaned**, and no amount of tuning the caps closes it, because the caps are correct.
WF-490/WF-491 established that receipts prove a ceremony *ran*; this sweep closes the sibling gap of
what arrives *after* one.

## Why a fragment with two callers, and not two skills

The sweep has two natural attachment points — a fleet run's Closeout, over the whole merged set, and
a standalone invocation for a single already-shipped task. Writing it twice would guarantee drift:
the two copies would diverge on the disposition vocabulary first and the verification discipline
second, and the second divergence is the one that launders reviewer noise into the tracker.

So the procedure is written **once**, as this capability's fragment, and both call sites follow it.
The fleet side reaches it through the `fleet.closeout-review` slot (`replace`) — composition through
the registry, so core `fleet` names no review term and runs entirely inert when this capability is
not registered. The standalone side reaches it by resolving the same fragment directly. Neither
holds a copy.

This mirrors the architecture WF-331 established for `ship.review`, deliberately: a reader who knows
one knows the other.

## Post-merge thread reachability — the analysis behind Step 1

`review-threads-read` scopes its results to the pull request's head commit, dropping any thread
anchored to a superseded commit. That raises two separate questions post-merge, and conflating them
is the trap.

**The head-commit scoping is correct, unchanged, after a merge.** A pull request's head ref is the
final commit on its source branch. Merging does not move it, and `wf` never force-pushes or rewrites
a branch after opening its pull request. A host anchors every inline comment — including one filed
after the merge, from the pull request's own file view — to that same final commit, because a merged
pull request's diff is always presented against its actual head rather than against an intermediate,
already-superseded commit. So a thread the read would have dropped as stale *before* the merge is
exactly as correctly stale *after* it. Nothing about this filter needed changing, and the fragment
consumes the read's output unmodified.

**The real gap is reachability once the source branch is gone.** The read resolves its input through
the host's pull-request lookup. `wf` itself deletes no branch — `/wf:tf` sweeps only scratch, and
`/wf:fleet`'s Closeout *lists* undeleted branches for manual cleanup rather than removing them — but
a repository's own auto-delete-on-merge setting can remove one regardless. Then a branch name
resolves nothing.

That is a **caller-side identity problem, not a contract gap**. The host's lookup takes a pull
request number or URL in the very same positional input it takes a branch name, and
`review-threads-read`'s contract never asserts that its input *looks like* a branch. Both call sites
already hold a durable non-branch identity by the time they sweep: the fleet scoreboard's own `PR`
column, persisted per row through the merged run, and the task's `**Pull request:**`
single-shot-publish metadata line written by `/wf:pr`. So the fragment tries the branch first
(cheapest, and usually still there) and falls back to the recorded reference.

**No new delivery operation is added.** This is a different *value* flowing into an existing input,
which is exactly why the task's own scope line ruling out new contract operations is satisfied
rather than escalated. Only when *neither* identity resolves does the pull request become `absent`,
with that stated reason — never silently skipped, and never folded into `moot`.

## Why four dispositions, and why `absent` is not `moot`

Three of the four say something about a **candidate finding** that was read and judged: it holds
(`issue filed`), it does not hold (`verified-invalid`), or it held once and no longer does (`moot`).

`absent` says something about the **review** instead: there was nothing to judge, because the read
could not be performed, the pull request could not be reached, or the review genuinely produced
nothing by read time. Folding it into `moot` would report an unread pull request as a clean one —
the precise failure mode this whole task exists to end, reproduced inside the mechanism meant to fix
it. The success criterion "absence is recorded as absence, not as clean" is this distinction.

The tally reflects the same split: `<filed> + <invalid> + <moot>` equals `<found>`, and `<absent>` is
counted apart rather than inside it.

## Why verify-before-file is non-negotiable

The C029 manual triage dropped roughly 60% of the reviewer's post-merge claims against the real
code. A sweep that filed candidates unverified would have created a tracker full of noise and taught
every reader to ignore it — strictly worse than the silence it replaced. So a candidate becomes an
issue only after current source has been opened at the anchor it names and confirms it, and the
filed issue carries that evidence so a reader can re-check it without re-deriving it.

Current source, not the merged diff, is the authority here: between the review landing and the sweep
running, another merge may already have fixed the thing. That case is `moot`, and it is only
distinguishable by reading the code as it stands.

## Why the sweep fixes nothing

Remediation is a gated, plan-then-implement flow with a human in it. A sweep that also fixed would
be an unattended source-mutating step keyed off untrusted review output — the same shape the `ship`
Phase-4.2 write-target test exists to bound, but without a bound. So the sweep reads, verifies, and
files; the filed issues carry the remediation.
