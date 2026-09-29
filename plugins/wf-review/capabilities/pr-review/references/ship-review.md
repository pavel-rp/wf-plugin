# ship.review gate — rationale and requirement mapping (reference, never read at slot-fire)

This file is authoring background for `fragments/ship-review.md` (the served `ship.review`
slot fill). The resolver never serves this file; the slot body is self-sufficient. Read this
only when editing the gate.

## The incident this gate answers (WF-313)

On a fleet run of 13 PRs, Copilot posted 25 inline review findings. 23 were never answered and
several were never seen; the shippers reported the PRs as "reviewed or review-unavailable" and
merged anyway. Four shippers stated as fact that **no review existed** when findings existed on
all four. Three PRs attached a reviewer that resolved **zero files** ("wasn't able to review
any files") and that was read as a clean pass. WF-313 distilled five hardening requirements;
this gate is their single home, homed in the contributing pack so that — per CLAUDE.md §2 —
with the contribution unregistered `/wf:ship` runs no review step, and its `Review:` slot reads core's
own `none — no review step ran` fallback.

## The five requirements → gate steps

1. **No "no review" claim without an API read-back at HEAD_SHA.** Step 1 calls
   `review-threads-read`, whose `<read-performed>` flag is `true` **only** when the PR's
   threads were actually read at HEAD_SHA. A `false` value (bare-core, no branch/PR context) is
   a typed degraded-empty that the op contract guarantees can never be presented as a performed
   read-back — the gate maps it to **unknown → block**, never to "no review landed".
2. **An unanswered request means unknown, never clean.** Step 2's "reviewer requested but not
   landed" branch hands back to a caller that owns the wait, and otherwise blocks as **unknown**
   — it never converts "hasn't posted yet" into "no review exists" (root cause 3 of the
   incident: the capped-review rule raced the merge). It originally re-read a capped number of
   times first; WF-944 removed that (below).
3. **Zero-files-reviewed is a distinct, cause-agnostic failure.** Step 2 detects a review that
   resolved zero files from its summary and blocks with a **zero-files-reviewed** reason,
   explicitly *not* "no findings". WF-313's corrected root cause 1 shows the cause is most
   likely a silent per-file diff-size cap, not gitignore — so the gate is deliberately
   cause-agnostic: any zero-file outcome is a failure regardless of why.
4. **A reply on every finding thread before merge.** Step 3 posts a `review-thread-reply` on
   **every** unresolved finding thread before it decides — even when it is about to block — so a
   landed finding never leaves the merge with no trace of having been seen (23 of 25 threads
   were silent, which is why the incident went undetected for a day).
5. **"Fixed in code" distinguishable from "thread answered".** Each reply's first line is a
   `Resolution: fixed in code — …` or `Resolution: thread answered — …` marker. Two incident
   shippers did fix findings but never replied, so the audit trail could not tell a fixed
   finding from an ignored one; the marker makes the recorded resolution unambiguous.

## Capped outcomes: a recorded cause and the review-completeness switch (WF-837)

About half of unattended pull requests merged with no completed review, and every one of them
recorded the same thing — "no review" — so nobody could say whether the reviewer never received
the request or received it and never answered (charter C040, H5/H6; research R008, assumption
A6 untested). Step 2 therefore verifies the request through the delivery provider's
`review-request-read` before it decides anything, and every capped outcome carries one of two
causes:

- **`no-post`** — the request registered and nobody posted. Either it is still outstanding when
  the capped polls lapse (the existing WF-313 timeout **block**, unchanged), or the host
  withdrew it with nothing posted — which the pending list alone cannot see, and which is why
  the read also counts review-request events on the pull request's history.
- **`request-failed`** — no request ever registered, or the read that would show one could not
  be performed. An unverifiable request is treated as one that did not demonstrably register;
  "unknown" is deliberately not a cause.

**Switch off (the shipped default) changes no decision.** Every outcome that blocked before still
blocks and every outcome that passed still passes; the former reviewer-absent pass is now named
what it is — a capped merge — with its cause. A first draft turned the timeout block into a
merge to match the fleet's capped-review rule; that would have weakened an existing gate, so it
was dropped.

**Switch on** (`## Review` → `**Require Completed Review**` = `on` in `_local/config.md`)
requires at least one completed review before a capped outcome may merge: an external review
(already handled — Steps 2 and 3 only reach Step 2b when none exists) or complete in-run lens
coverage, read from the task's `04_verify.md` `**Lenses:**` line under verify-spec's own count
(an inline lens is expected, never completed). Without either, the item is handed back. This is
R008 option 4-A+ (ii); it stays off until the lens path that makes in-run coverage routinely
complete has landed (WF-836), because until then roughly half of all items would hand back.

`ship` core renders the recorded summary verbatim in its `Review:` slot and never interprets it;
fleet copies it per item. Neither names a reviewer.

## The pending request waits on the caller's clock, not a poll count (WF-944)

The pending branch used to re-read twice before blocking. Unattended, two re-reads land seconds
apart, so a reviewer that answers in minutes was always counted as absent — and the fleet's own
"poll at most twice" rule did the same one level up. A count of polls cannot express a wall-clock
wait, so the gate no longer polls at all. Instead it asks who owns the wait, which `ship`'s flags
already say:

- **`--review-boundary` without `--review-lapsed`** — an orchestrator owns the wait. The gate hands
  back `Built: awaiting review`; the orchestrator records a deadline from `Review Wait Minutes`,
  wakes once it has passed, and re-invokes with `--review-lapsed`. A review that lands before that
  is read by Step 1 on the resumed run. The gate itself never counts, sleeps, or measures time.
- **`--review-lapsed`** — the wait happened and ran out. The existing timeout block stands:
  `no-post`, unknown, not clean. Turning it into a merge would weaken the gate (the same reason
  WF-837 declined to).
- **No `--review-boundary`** — nothing can wait, so the review is **not awaited** and blocks the
  same way. An attended operator simply re-runs once the review lands.

A withdrawn request (`<pending>` = 0) is unchanged: it is a capped outcome decided by the WF-837
switch.

## Why the gate does not fix code itself

`ship` is a pure orchestrator that mutates no source; the gate inherits that. It verifies each
finding against the real code (the load-bearing discipline shared with `/wf-review:address-pr`:
a review comment is a hypothesis, never truth) only to choose an honest reply and a pass/block
decision. A confirmed, unaddressed defect **blocks** and routes the user to
`/wf-review:address-pr` (the pack's own verify-and-fix skill), which fixes the valid findings on
the branch; a re-ship then re-enters the gate against the new HEAD_SHA. This keeps the gate
conservative and single-purpose, and keeps all code-mutation in the one skill built for it.

## Why a `replace` slot, and why homed here

`ship.review` is declared `replace` in `skills/ship/interface.md`: the review step is a single
coherent behaviour with one owner, not an additive list, so a fill supersedes the inline
default wholesale rather than appending to it. Homing the fill in `pr-review` (charter
Assumption #2, confirmed at spec time) keeps every review term inside the contributing pack:
`ship`'s core body names no reviewer, and a project that has not registered `pr-review` gets a
`/wf:ship` that runs no review step (its `Review:` slot reads core's `none — no review step ran`). Registration is via `/wf-review:init` (WF-325), a compatibility alias
onto the canonical `/wf:init` lifecycle whose apply is idempotent and refreshes the resolver
snapshot so the new `slot` row resolves.

## Interaction with `ship`'s own invariants

The gate can only ever *block earlier* or *pass through* — it can never cause a merge that
`ship` would otherwise refuse. `ship` still never merges red (Phase 4), and `/wf:tf`'s
`pr-merge` is detect-first and refuses a not-mergeable PR (failing required checks, unresolved
conversations). So even a gate pass is not a merge authorization on its own — it is one more
precondition ahead of the existing guards.
