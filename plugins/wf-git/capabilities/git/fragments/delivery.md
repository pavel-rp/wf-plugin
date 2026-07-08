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
- **Dirty-worktree guard (step 2).** A checkout would carry uncommitted changes across
  branches; refusing keeps the two branches' states clean.
- **`main` → `master` base fallback (step 4).** Repos differ on the default trunk name;
  probing `main` first and falling back to `master` covers both without configuration.
- **Push-failure is non-fatal (step 7).** A permissions/network failure on the tracking
  push must not discard a valid local branch — it degrades to `local-only (push failed)`.

## branch-switch

- **Same detached/dirty guards as branch-create (step 1).** Switching shares the two
  preconditions that make a checkout safe.
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

## last-commit-timestamp-query (read)

- **Failure is an environment error, not the no-provider fallback.** As with
  `workspace-root-resolve`, no commits yet / not a git working tree is a plain
  environment error for a registered provider — distinct from core's no-provider
  filesystem-read fallback.

---

## Edge cases reproduced

The regression checklist for the split: every row below must behave identically to the
pre-split single-file fragment. Step numbers reference [`delivery.ops.md`](delivery.ops.md).

- **Dirty tree** — `branch-create` step 2, `branch-switch` step 1.
- **Existing branch** — `branch-create` step 3 (exact-name match → `switched`),
  `branch-switch` steps 2–3 (local or remote-only match).
- **No upstream** — `branch-create` step 7 (`local-only (no upstream)` derivation),
  `push-upstream` steps 2 & 4 (detects it, then bootstraps to `origin` when absent).
- **Existing PR** — `pr-create` step 3 (`exists`, never duplicated), `pr-detect` step 2
  (found vs. not-found, the latter not an error).
- **Detached HEAD** — `branch-create` step 1, `branch-switch` step 1, `commit` step 1,
  `push-upstream` step 1, `pr-detect` step 1, `pr-create` step 1 (the last three via
  `current-branch-query` when the branch input is omitted).
- **`gh`-not-authenticated** — `pr-create` step 3, `pr-detect` step 2 (both name the
  `gh auth login` remedy).
- **No commits / not a git working tree** — `last-commit-timestamp-query` step 2 (plain
  environment error, distinct from core's no-provider fallback).

Two further behaviours are preserved by the guard coverage above rather than as matrix
rows: **nothing-to-commit** (`commit` step 3, a valid no-op) and the **no-provider
plain-directory fallback** (core's own behaviour, which this fragment explicitly does not
implement).
