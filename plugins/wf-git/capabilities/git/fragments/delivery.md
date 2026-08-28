# git capability — the `delivery` fragment (reference)

**What this doc is:** the **reference half** of the git delivery provider — scope framing,
per-operation rationale, and the edge-case regression matrix. It is **not read at a
delivery-surface boot**; the runtime-read half is
[`delivery.ops.md`](delivery.ops.md) (every input, guard, error path, and outcome
mapping lives there). This file explains *why* those procedures are shaped as they are
and serves as the regression checklist behind them.

**Model:** claude-opus-4-8

---

## How a core skill reaches this provider

A core skill reaches the runtime-ops half through **direct provider resolution**: it
resolves the registry row where `contribution-kind = provider AND scope = delivery`,
sees `dispatch: inline: fragments/delivery.ops.md`, reads that file, and **follows it
in-context**. No subagent is spawned; there is no phase-firing gate — any core skill, at
any point in its own procedure, may invoke any operation. The full procedure this reuses
is `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider
resolution".

## Scope

The runtime-ops file is scoped to the git/gh **mechanics** of each operation only. Two
concerns are explicitly **not** its job:

- **Tracker-specific derivation** — composing a branch name from a work-item id and
  title, composing a commit subject / PR title from a task's tracker record, or any
  other value that depends on a tracker's id shape. Every operation **consumes** an
  already-resolved `<branch-name>` / `<message>` / `<title>` / `<body>` — it never
  derives one. That derivation is the caller's (core's) responsibility.
- **The no-provider plain-directory fallback.** When no capability owns the `delivery`
  surface, `workspace-root-resolve` resolves as a plain directory and writes state
  plainly that no delivery provider is registered — that is core's defined behaviour for
  the unconfigured case (see `capability-registry.ops.md` §"The delivery provider
  surface"), not a procedure the ops file implements.

**Why exit codes, not stderr.** Every git probe relies on **exit codes**: exit 0 means
the probed thing exists/succeeded; non-zero means it doesn't. The stderr message git or
`gh` prints is informational only and is discarded unless an operation's `Output`
explicitly says to surface it as an error reason. This keeps the guards robust across git
versions and locales, where stderr wording drifts but exit codes don't.

---

## Per-operation rationale

The runtime procedure for each operation is in [`delivery.ops.md`](delivery.ops.md); the
notes below record the load-bearing choices behind them.

## branch-create

- **Detached-HEAD first (step 1).** Creating a branch from a detached HEAD silently
  strands the new branch off no base; the guard refuses it up front.
- **Already-on-target is a no-op, not an error (step 1).** Re-running `branch` for the
  ticket you are already on must succeed idempotently, so the same current-branch probe
  that detects detached HEAD also short-circuits to `already-active`.
- **Dirty tree carries across the checkout, never blocks it (step 2).** A checkout used
  to refuse a dirty tree outright; now the in-progress edits are stashed before the
  checkout and reapplied after (step 7), so starting or resuming a task's branch with
  uncommitted work in progress is the common case, not an error. A conflicting reapply is
  left as a preserved stash rather than discarded or rolled back — the checkout itself
  already succeeded and never un-does. The captured entry's identity is pinned to a
  durable SHA the moment it's created (`stash@{0}` resolved immediately, not re-derived
  positionally later), so identity checks never reapply the wrong entry if the stash
  stack shifts — but `pop`/`drop` (unlike `apply`) don't accept that SHA directly, so
  every `pop`/`drop` call resolves the entry's *current* `stash@{N}` position fresh, right
  before using it.
- **A fetch failure restores the capture before erroring (step 5).** The capture (step 2)
  runs before the base is fetched, so a fetch failure — unrelated to the dirty-tree
  handling — must not silently strand the caller's uncommitted work in a stash they were
  never told about. Restoring it first keeps that failure path exactly as side-effect-free
  as it was before this change.
- **`main` → `master` base fallback (step 4).** Repos differ on the default trunk name;
  probing `main` first and falling back to `master` covers both without configuration.
- **A real attempt with a guaranteed rollback, not a dry-run predictor (step 7).** A
  textual dry run (`apply --check`) tests a patch application, not the three-way merge a
  stash `apply`/`pop` actually performs against its recorded base commit — the two can
  diverge, especially here, where the base has likely moved since the stash was captured.
  Trusting a dry run's exit code would let a real conflict slip through and leave the
  working tree half-merged with conflict markers dropped into files — exactly the
  mid-flight state this operation must never produce. Attempting the real `apply` (never
  `pop`, so a failed attempt can never drop the stash on its own) and, on conflict,
  hard-resetting the tree back to the clean just-checked-out state makes the outcome
  atomic from the caller's perspective: either it lands applied and the stash is dropped,
  or the tree ends up exactly as clean as right after the checkout and the stash survives
  untouched. The reset alone isn't sufficient, though: a `-u` stash restores its untracked
  files before a failed merge is even judged, so a conflicting apply can leave those files
  behind despite `reset --hard` clearing the tracked-file conflict — an explicit
  `clean -fd` (never `-x`, which would also sweep up gitignored files this stash never
  touched) is the step that actually returns the tree to the pre-attempt state.
- **Push-failure is non-fatal (step 8).** A permissions/network failure on the tracking
  push must not discard a valid local branch — it degrades to `local-only (push failed)`.

## branch-switch

- **Detached-HEAD guard shared with branch-create (step 1); dirty-worktree guard now its
  own.** Switching still shares the detached-HEAD precondition with branch-create. The
  dirty-worktree guard no longer transfers: branch-create's dirty-tree handling changed
  shape (a carry, not a refusal) as of WF-283, so branch-switch keeps its own unchanged
  hard-error guard inline rather than pointing at a step that no longer means the same
  thing.
- **Local before remote-only (steps 2–3).** A local branch of the exact name wins; only
  when none exists does a remote-only match create a tracking local branch via
  `checkout -t`, so the operation works both for a branch that exists here and one that
  only exists on origin.

## commit

- **Detached-HEAD guard (step 1).** A commit on a detached HEAD is unreachable by name;
  commits require a named branch.
- **Nothing-to-commit is a valid no-op (step 3).** An empty staged diff is not an error —
  re-running `commit` with nothing new returns `nothing-to-commit` rather than failing.
- **Message via a `.git/`-internal scratch file (steps 4–5).** Writing the message inside
  `.git/` (never tracked) keeps multi-line and special-character messages intact without
  ever dirtying the worktree.

## push-upstream

- **Read the upstream from `git config`, in one probe (step 2).** The two values
  (`branch.<b>.remote`, `branch.<b>.merge`) are read together with a single
  `git config --get-regexp "^branch\.<branch>\.(remote|merge)$"` — a **probe
  consolidation** (WF-211) that replaces the former two separate `git config --get`
  reads with one, outcomes identical. The abbreviated `<branch>@{u}` ref is deliberately
  **not** used: its remote and branch segments are joined by `/` with no escaping, so it
  cannot be split back apart when a remote or branch name itself contains a `/`.
- **Local-tracking branch (`remote == .`).** A branch tracking another local branch has
  nothing to push upstream — returned as an explicit `failed (...)` rather than a
  confusing push attempt.
- **Explicit two-sided refspec (step 3).** `git push <remote> <branch>:<remote-branch>`
  always names both sides. The same-name-only `git push <remote> <branch>` is unsafe:
  when `<remote-branch>` differs from `<branch>` (a real, supported git configuration),
  it silently creates a *new* same-named branch on the remote while leaving the tracked
  branch stale, with exit 0 and no error surfaced.
- **Push-failure is non-fatal (step 5).** A failed push never undoes a prior commit.

## pr-create

- **Forward the resolved `<head>` into push-upstream (step 2).** pr-create resolves
  `<head>` once (step 1) and passes it to `push-upstream`, so that operation does not
  re-run `current-branch-query` — no redundant branch re-resolution across the two.
- **Ensure-pushed before create (step 2).** An unpushed head yields an opaque
  `gh pr create` failure; pushing first turns it into the specific "cannot open a PR for
  an unpushed branch" error.
- **Existing-PR short-circuit (step 3).** `gh pr view` before create is a **safety net**
  against duplicate PRs; the *primary* guard is single-shot-publish idempotency below.
- **Body via a `.git/`-internal scratch file (steps 4–5).** Same rationale as `commit`'s
  message file — a rich PR body survives intact and never dirties the worktree.

**Single-shot-publish idempotency (explicit).** This operation's own `gh pr view` check
(step 3) is a **safety net**, not the primary guard. The *primary* guard is the caller:
before invoking `pr-create` again for the same artifact, the caller reads back a
`**PR:** <url>` metadata line already recorded in the artifact that triggered the first
call. A present value means the operation already ran and must be treated as
already-published — the caller never re-invokes `pr-create` for that artifact. This
mirrors the contract's metadata-line attribution shape used elsewhere (e.g. model
attribution). The same metadata-line shape is reused by the `tracker` surface's
`create_umbrella` / `create_child`.

## pr-detect

- **Not-found is not an error (step 2).** A branch with no open PR is a valid result
  (`<found>` = false), distinct from a `gh` authentication failure, which names the
  `gh auth login` remedy.

## workspace-root-resolve (read)

- **Failure is an environment error, not the no-provider fallback.** For a *registered*
  provider, being outside a git working tree is a genuine environment error surfaced
  plainly — explicitly distinct from core's own plain-directory resolution when the
  `delivery` surface has no owner at all (which this provider does not implement).

## current-branch-query (read)

- **`HEAD` is a signal, not an error.** The literal `HEAD` is returned verbatim as the
  detached-HEAD signal so each caller decides what to do (create refuses, push/PR error,
  etc.) rather than the read operation deciding for them.

## default-base-query (read)

- **`main` → `master` fallback, shared with branch-create.** A repo's default trunk is
  `main` or `master`; probing `main` first and falling back covers both without
  configuration — the identical fallback `branch-create` step 4 and `branch-changes-read`
  step 1 already apply. Exposing it as a standalone read closes a contract gap (WF-221):
  a core skill that needs the base *value* — `commit`'s first-commit count, `pr`'s PR base —
  now obtains it through the delivery contract rather than hardcoding a trunk name, the way
  `branch-create` already hides base determination for the branch case.

## last-commit-timestamp-query (read)

- **Failure is an environment error, not the no-provider fallback.** As with
  `workspace-root-resolve`, no commits yet / not a git working tree is a plain
  environment error for a registered provider — distinct from core's no-provider
  filesystem-read fallback.

## branch-changes-read (read)

- **Merge-base (three-dot) diff, so the base's own history never leaks in.**
  `git diff --name-status <base>...HEAD` diffs HEAD against the merge base of
  HEAD and `<base>`, so files already landed on `<base>` are excluded — the set
  is exactly what *this branch* changed, not everything that differs between two
  tips. The `main` → `master` base fallback matches `branch-create`, so a repo on
  either trunk name resolves without configuration.
- **Committed and uncommitted, one set.** A branch mid-implementation has both
  committed divergence and in-progress edits; folding `git status --porcelain`
  into the merge-base diff hands the caller every path the branch touched, not
  only the committed half. An empty set (no divergence, clean tree) is a valid
  result, never an error.
- **Failure is an environment error, not the no-provider fallback.** As with
  `workspace-root-resolve` / `last-commit-timestamp-query`, not being inside a git
  working tree is a plain environment error for a registered provider — distinct
  from core's no-provider plain-directory read fallback, which this fragment does
  not implement.

## pr-comments-read (read)

- **Not-found is an empty result, not an error.** A branch with no open PR yields
  an empty comment list (the read-side "always resolves to something usable"
  guarantee); only a `gh` authentication failure is surfaced, naming the
  `gh auth login` remedy — the same split as `pr-detect`.
- **Both comment surfaces in one read.** PR-level / review-summary comments and
  inline review-thread comments are distinct GitHub surfaces; reading both and
  merging them hands the caller the whole review conversation, not half of it.

## review-threads-read (read)

- **Complements `pr-comments-read`, never duplicates it.** `pr-comments-read`
  returns the whole review conversation as a flat comment list — no per-thread
  `isResolved` state, no head-commit scoping. `review-threads-read` returns the
  **structured review threads** (node id, file/line anchor, resolved/unresolved,
  body) **scoped to `HEAD_SHA`** — the shape a review gate needs to decide whether
  unresolved findings still stand against the current head.
- **GraphQL, because REST exposes neither the state nor the id.** A review
  thread's `isResolved` flag and its node id (the id `review-thread-resolve` and
  `review-thread-reply` consume) are GraphQL-only; the REST comments endpoint
  carries neither, so the read must be a GraphQL `reviewThreads` query.
- **HEAD_SHA scoping drops stale threads (never presents them as current).** Each
  thread's anchoring comment carries a `commit.oid`; keeping only threads whose
  oid equals the PR's `headRefOid` guarantees a finding from a superseded commit
  is never reported as if it were live at the current head. `isOutdated`
  corroborates but the oid equality is authoritative.
- **Typed degraded-empty (`<read-performed>`) satisfies the review-gate rule.**
  The output is typed with `<read-performed>`, true **only** when the PR's threads
  were actually read at `HEAD_SHA` (even a genuinely empty set at `HEAD_SHA`
  counts as a performed read). A no-branch / no-PR-context / bare-core empty
  returns `<read-performed>` = false, so it can **never** be presented as a
  performed `HEAD_SHA` read-back — the one read on this surface that departs from
  the plain silent-empty precedent, precisely because it backs a merge-blocking
  "no unresolved threads" claim.

## pr-comment-post

- **PR-existence guard before posting (via `pr-detect`).** Posting to a branch
  with no PR is meaningless; detecting first turns an opaque failure into the
  specific "no open PR to comment on" error.
- **Body via a `.git/`-internal scratch file.** Same rationale as `commit` /
  `pr-create` — a rich, multi-line comment body survives intact and never
  dirties the worktree.
- **`<reply-to>` threads the reply.** A plain PR comment and a reply within an
  existing review thread are different endpoints; `<reply-to>` routes to the
  reply API so a review conversation stays threaded.
- **Returned URL is the idempotency handle.** The posted comment's URL is
  recorded by the caller as a metadata line and read back before re-invoke
  (contract single-shot-publish), so a re-run never double-posts.

## checks-read (read)

- **Not-found / no-checks is an empty result.** A branch with no PR, or a PR
  with no configured checks, yields an empty check list — not an error; only a
  `gh` authentication failure is surfaced with the `gh auth login` remedy.

## review-thread-resolve

- **GraphQL, because REST has no resolve endpoint.** Resolving a review thread is
  exposed only through the `resolveReviewThread` GraphQL mutation, so the
  operation consumes a GraphQL thread **node id** (not a REST comment id) — the
  caller supplies the already-resolved id.

## review-thread-reply

- **Complements `pr-comment-post`'s `<reply-to>`, never duplicates it.**
  `pr-comment-post` threads a reply keyed by a REST review-**comment** id, in the
  general PR-comment flow. `review-thread-reply` posts on **one specific thread**
  keyed by the **thread node id** — the same identity `review-threads-read`
  returns and `review-thread-resolve` consumes. A consumer that read threads via
  `review-threads-read` replies on that same id with **no id-space translation**;
  `pr-comment-post` stays the path for a PR-level comment or a REST-comment-id
  reply.
- **GraphQL `addPullRequestReviewThreadReply`, keyed by the thread node id.** The
  mutation takes the `pullRequestReviewThreadId` directly, so a reply lands inside
  the intended review thread rather than as a detached comment — matching the id
  space of the read and resolve operations.
- **Body via a `.git/`-internal scratch file.** Same rationale as `commit` /
  `pr-create` / `pr-comment-post` — a rich, multi-line reply body survives intact
  and never dirties the worktree.

## pr-merge

- **Detect-first idempotency (step 2).** A PR already `MERGED` is a no-op
  returning `already-merged` — re-invoking `pr-merge` never double-merges. This
  is the write-side analogue of `pr-create`'s existing-PR short-circuit; unlike
  `pr-create`, no recorded metadata line is needed because the merged state is
  itself detectable.
- **Method is caller-chosen (consume, never derive).** `merge` / `squash` /
  `rebase` is a policy the caller decides; the operation consumes it (defaulting
  to `squash`) rather than baking a merge strategy into the provider.
- **Merge-blockers surface verbatim.** Failing required checks, unresolved
  conversations, or a not-mergeable state come back as `gh`'s own reason, so the
  caller sees exactly why a merge was refused.

## activity-read (read)

- **Harmless degrade over hard error (standup must never block).** Unlike
  `last-commit-timestamp-query`, a not-a-git-tree or unauthenticated-`gh` failure
  yields an **empty** commit / PR list rather than an environment error — a
  standup summary degrades to "no activity" and never blocks.
- **Two streams, one view.** Recent commits (`git log --since`) and recent pull
  requests (`gh pr list --search updated`) are independent sources; merging them
  gives the standup a single recent-activity view.

## newest-published-version-read (read)

- **The published tip of the default base *is* the published state.** A consumer
  installing this workspace receives what the default base's remote tip carries,
  so that tip — not a tag, not a release feed — is what "newest published" binds
  to here. Fetching it (step 2) is what makes the answer *newest*; reading a
  stale local tracking ref would reproduce the very staleness the operation
  exists to detect.
- **Fetch, then read the blob — never check anything out.** `git show
  FETCH_HEAD:<path>` reads the declaration straight out of the fetched object,
  so the operation never switches a branch, never touches the worktree, and is
  safe to invoke from an isolated worktree mid-run.
- **Typed degraded result, not an environment error.** `last-commit-timestamp-query`
  surfaces a not-a-git-tree failure as a plain environment error; this operation
  deliberately does not. Its consumer is making a *currency* claim, and an error
  it has to interpret invites exactly the silent-empty failure the contract
  forbids — so a failed fetch is `<read-performed>` = false, `<reason>` =
  `read-failed`, and the consumer can say "the check did not run" without
  inventing a verdict. Same discipline as `review-threads-read`, one level down.
- **A value-less read is `none-published`, never a bare true.** Unlike
  `review-threads-read` — where an empty thread set at `HEAD_SHA` is a genuine
  result — there is no useful "the published side declares no version" comparison.
  A missing declaration, an unparseable one, an absent field, or a blank value all
  resolve to `<read-performed>` = false with `<reason>` = `none-published`, so a
  true flag always means a comparable value is in hand.
- **`no-provider` is core's token, not this file's.** The three-token `<reason>`
  set is the contract's; a registered git provider can only ever produce
  `read-failed` or `none-published`. `no-provider` is what core returns when no
  capability owns the surface at all — the same boundary every other operation
  here observes.
- **Consumes, never derives.** The declaration path (and the optional field) come
  from the caller, and the local value the published one is compared against is
  the caller's to read. This operation reads only the published side.

---

## Edge cases reproduced

The regression checklist for the split: every row below must behave identically to the
pre-split single-file fragment. Step numbers reference [`delivery.ops.md`](delivery.ops.md).

- **Dirty tree** — the two operations now diverge (WF-283). `branch-create` (step 2)
  carries a dirty tree across the checkout via a stash, on both the `switched` and
  `created` outcomes, and reports a conflicting reapply as a distinct non-error `<carry>`
  outcome rather than a hard error (step 7). `branch-switch` (step 1) is unchanged — it
  still hard-errors on a dirty tree.
- **Existing branch** — `branch-create` step 3 (exact-name match → `switched`),
  `branch-switch` steps 2–3 (local or remote-only match).
- **No upstream** — `branch-create` step 8 (`local-only (no upstream)` derivation),
  `push-upstream` steps 2 & 4 (detects it, then bootstraps to `origin` when absent).
- **Existing PR** — `pr-create` step 3 (`exists`, never duplicated), `pr-detect` step 2
  (found vs. not-found, the latter not an error).
- **Detached HEAD** — `branch-create` step 1, `branch-switch` step 1, `commit` step 1,
  `push-upstream` step 1, `pr-detect` step 1, `pr-create` step 1 (the last three via
  `current-branch-query` when the branch input is omitted).
- **`gh`-not-authenticated** — `pr-create` step 3, `pr-detect` step 2,
  `pr-comments-read` step 2, `checks-read` step 2, `pr-comment-post` step 4,
  `review-thread-resolve` step 1, `pr-merge` step 2 (all name the `gh auth login`
  remedy). `activity-read` is the exception — it degrades an unauthenticated `gh`
  to an empty PR list rather than erroring.
- **No commits / not a git working tree** — `last-commit-timestamp-query` step 2 (plain
  environment error, distinct from core's no-provider fallback); `branch-changes-read`
  step 4 output (same plain environment error for a registered provider); `activity-read`
  step 1 degrades the same condition to an empty commit list instead.
- **No divergence / clean tree (read side)** — `branch-changes-read` step 4 (an empty
  changed-file set is a valid result, never an error).
- **No open PR (read side)** — `pr-comments-read` step 2, `checks-read` step 2 (a
  valid empty result, never an error — the read-side "always resolves to
  something usable" guarantee).
- **Already-merged PR** — `pr-merge` step 2 (`already-merged` no-op, never a
  double-merge — the detect-first idempotency).
- **HEAD_SHA-scoped read vs typed degraded-empty** — `review-threads-read` step 4
  (a thread anchored to a superseded commit is dropped, never presented as
  current) and steps 1–2 vs 3–4 (`<read-performed>` = false on no-branch /
  no-PR-context, true on a real read at `<head-sha>` even when the thread set is
  empty — the typed empty can never masquerade as a performed HEAD_SHA read-back).
  `gh`-not-authenticated at step 2 names the `gh auth login` remedy, joining the
  authenticated-read exceptions above.
- **Newest-published version — the performed return** — `newest-published-version-read`
  step 3: the declaration exists at the published tip and carries a non-blank value at
  `<version-field>` → `<read-performed>` = true, `<version>` = that value, **no**
  `<reason>`. This is the only shape a consumer may treat as a completed currency check.
- **Newest-published version — the typed degraded returns** — the same operation, three
  closed outcomes, each `<read-performed>` = false with **no** `<version>`: step 2 (not a
  git working tree, no `origin` remote, or the fetch failed) → `<reason>` = `read-failed`;
  step 3 (the declaration absent from the published state, unparseable, an absent
  `<version-field>`, or a blank value) → `<reason>` = `none-published`.
  None of these is thrown as an environment error, and none may be returned as a bare
  empty — the C011 failure the typing exists to prevent is a consumer reading an unrun
  check as "the installation is current". `no-provider`, the contract's third token, is
  core's bare-core result and is deliberately unreachable from this fragment.

Two further behaviours are preserved by the guard coverage above rather than as matrix
rows: **nothing-to-commit** (`commit` step 3, a valid no-op) and the **no-provider
plain-directory fallback** (core's own behaviour, which this fragment explicitly does not
implement).
