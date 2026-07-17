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
with the contribution unregistered `/wf:ship` shows no review term at all.

## The five requirements → gate steps

1. **No "no review" claim without an API read-back at HEAD_SHA.** Step 1 calls
   `review-threads-read`, whose `<read-performed>` flag is `true` **only** when the PR's
   threads were actually read at HEAD_SHA. A `false` value (bare-core, no branch/PR context) is
   a typed degraded-empty that the op contract guarantees can never be presented as a performed
   read-back — the gate maps it to **unknown → block**, never to "no review landed".
2. **A poll timeout means unknown, never clean.** Step 2's "reviewer requested but not landed"
   branch re-reads a capped number of times, then blocks as **unknown** — it never converts
   "hasn't posted yet" into "no review exists" (root cause 3 of the incident: the capped-review
   rule raced the merge).
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
`ship`'s core body names no reviewer, and a project that has not registered `pr-review` sees a
review-free `/wf:ship`. Registration is via `/wf-review:init` (WF-325), whose `register_pack`
is idempotent and refreshes the resolver snapshot so the new `slot` row resolves.

## Interaction with `ship`'s own invariants

The gate can only ever *block earlier* or *pass through* — it can never cause a merge that
`ship` would otherwise refuse. `ship` still never merges red (Phase 4), and `/wf:tf`'s
`pr-merge` is detect-first and refuses a not-mergeable PR (failing required checks, unresolved
conversations). So even a gate pass is not a merge authorization on its own — it is one more
precondition ahead of the existing guards.
