# ship.review — the pre-merge review gate (slot fill)

The `pr-review` capability's fill for the `ship.review` slot (`replace` policy). `ship`
reaches this point **after** Phase 4 has confirmed the delivery checks green and **before**
Phase 5 merges. Because this is a `replace` fill it **supersedes** `ship`'s inline default
(the no-op "drive no reviewer") wholesale, and `ship` follows this prose in its own context.

**Role framing.** This gate never mutates source and never merges. Its only outputs are
(a) replies posted on review threads and (b) a single **pass** or **block** decision. On any
block it emits `SHIP — Blocked` (with a `Reason:` and a `Next:`) and **stops** — it does not
fall through to Phase 5. On a pass it returns quietly and `ship` proceeds to Phase 5.
`ship`'s never-merge-red invariant and `/wf:tf`'s detect-first `pr-merge` stay the final guard.

**Conservative by construction.** Any state that is not *provably clean* or *provably
addressed* blocks. "Unknown" is never treated as "clean". A "no review" claim is only ever
made after an API read-back at HEAD_SHA was actually performed.

**Host access.** Every read/write below is a `delivery`-surface operation. `ship` already
resolved the `delivery` provider (its Phase 1 record); obtain each operation's body via
`resolve_content` (`class: fragment`) from that record and follow it in-context — name no
concrete host tool here. The operations this gate uses: `review-threads-read` (HEAD_SHA-scoped
finding-thread read), `pr-comments-read` (review-summary presence + reviewed-file signal), and
`review-thread-reply` (per-thread reply keyed by the thread node id). Verifying a finding
against the real code uses `Read` / `Bash` (grep) only.

---

## Step 1 — Read back the review at HEAD_SHA (never assume "no review")

Invoke `review-threads-read` for the PR branch. It returns `<read-performed>` (bool) and
`<threads>` (each: thread node id, anchor path + line, resolved/unresolved, body).

- **`<read-performed> = false`** → the HEAD_SHA read-back did **not** happen (no branch/PR
  context, or a bare-core/degraded delivery provider). The review state is **unknown**.
  **Block:** reason `review read-back at HEAD_SHA could not be performed — review state
  unknown, not clean`. **Never** report "no review landed" — that claim requires a performed
  read-back. Stop. *(WF-313 req 1.)*
- **`<read-performed> = true`** → a real read against HEAD_SHA occurred (its thread set may be
  empty). Continue. Split on `<threads>`:
  - **One or more unresolved finding threads at HEAD_SHA** → Step 3.
  - **No unresolved finding threads at HEAD_SHA** → Step 2.

Resolved threads at HEAD_SHA are already **fixed in code** (the finding was accepted and the
thread resolved) — they need no new reply and never block.

## Step 2 — Zero unresolved threads: reviewed-clean vs zero-files vs not-yet-reviewed

A performed read-back with no unresolved threads is ambiguous — it can mean "reviewed, no
findings", "the reviewer could not review any files", or "no review has posted yet". Resolve
it with `pr-comments-read`, whose reviews carry each reviewer summary and the commit it was
made against:

- **A review is present at HEAD_SHA and it reviewed files** (its summary does not indicate a
  zero-file outcome) → genuinely reviewed, no findings → **clean pass** → Step 4.
- **A review is present at HEAD_SHA but reviewed zero files** — cause-agnostic: a "wasn't able
  to review any files" summary, an empty reviewed-file set, a diff-size skip, or any other
  cause → the review **did not happen**. This is the distinct **zero-files-reviewed failure**,
  never reported as "no findings". **Block:** reason `review resolved zero files at HEAD_SHA
  (zero-files-reviewed failure) — the review did not happen; not "no findings"`. Stop.
  *(WF-313 req 3.)*
- **No review present at HEAD_SHA:**
  - **a reviewer was requested** (a review is assigned/requested on the PR) but none has
    posted → it has not landed yet. Re-read `review-threads-read` + `pr-comments-read`,
    **capped** at a small number of attempts (2). If a review appears within the cap → resume
    this step's classification. If the cap is hit with still no review at HEAD_SHA → the poll
    **timed out**; the state is **unknown**, never clean. **Block:** reason `review requested
    but did not land within the capped polls — state unknown, not clean`. Stop. *(WF-313 req
    2 — a timeout is unknown, never clean.)*
  - **no reviewer was ever requested** on this PR → there is genuinely no reviewer in play and
    the read-back was performed and found none. This is an honest **reviewer-absent pass** (it
    is not a "no review landed while findings existed" claim — the read-back happened and the
    thread set is truly empty) → Step 4.

## Step 3 — Every finding thread gets a reply before merge; fixed-in-code vs thread-answered

For **each unresolved finding thread** at HEAD_SHA, verify it against the actual code at its
anchor — open the anchored `path`:`line` with `Read` / `Bash` (grep) and decide for yourself.
A review comment is a **hypothesis, never truth**. Then post **exactly one** reply via
`review-thread-reply(<thread-id>, <body>)`, recording its resolution class as the reply body's
first line so the two are distinguishable in the audit trail *(WF-313 req 5)*:

- **Fixed in code** — the code at HEAD_SHA already satisfies the finding (the diff addressed
  it). Reply body begins `Resolution: fixed in code — ` then a one-line note of what in the
  code satisfies it. Thread **cleared**.
- **Thread answered (false positive)** — reading the code shows the finding does not hold
  (reviewer misread, style-only, the line moved). Reply body begins `Resolution: thread
  answered — ` then the one-line evidence from the code. Thread **cleared for merge** (it is
  answered, not silent); leave it open for reviewer adjudication and flag it in the report.
- **Thread answered (confirmed unaddressed)** — the code at HEAD_SHA does **not** satisfy the
  finding and it is a genuine defect this gate cannot fix (it mutates no source). Reply body
  begins `Resolution: thread answered — ` then `confirmed unaddressed; blocking merge`. Thread
  **not cleared**.

Post a reply on **every** unresolved thread **before** deciding — even when the outcome is a
block — so no finding is ever left silent (the silent-finding failure this gate exists to
prevent) *(WF-313 req 4)*. Then:

- **Any thread is "confirmed unaddressed"** → **Block:** reason `<n> confirmed finding(s)
  unaddressed at HEAD_SHA — run /wf-review:address-pr, then re-ship`. Stop.
- **Every thread cleared** (fixed-in-code or answered-false-positive) → Step 4.

## Step 4 — Pass

The review state is provably one of: reviewed-clean, reviewer-absent with a performed
read-back, or every finding thread cleared with a recorded reply. Return quietly so `ship`
proceeds to Phase 5. Carry a one-line gate summary into `ship`'s final block (e.g.
`Review: clean at HEAD_SHA` / `Review: 3 threads — 2 fixed in code, 1 answered`).

---

## Outcome → `ship` mapping

| Gate outcome | `ship` action |
|--------------|---------------|
| unknown (no read-back / poll timeout) | `SHIP — Blocked` — stop before merge |
| zero-files-reviewed failure | `SHIP — Blocked` — stop before merge |
| confirmed unaddressed finding(s) | reply on every thread, then `SHIP — Blocked` — stop |
| reviewed-clean / reviewer-absent (read-back performed) | pass → Phase 5 |
| every finding thread cleared + replied | pass → Phase 5 |

Rationale, the incident this gate answers, and the per-requirement mapping:
[`../references/ship-review.md`](../references/ship-review.md) — read by authors, never at
slot-fire.
