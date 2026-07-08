# git delivery provider — runtime ops

**Version:** 1.3.0 (WF-211 — split out of the delivery fragment as the bounded runtime-ops half; push-upstream probe consolidation; WF-157 — six PR-interaction/merge/activity operations bound: `pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`, `pr-merge`, `activity-read`)
**Role:** the runtime-read half of the git delivery provider — every input, guard, error path, and outcome mapping a delivery operation follows. Read at every delivery-surface boot; self-sufficient (no step below requires opening another file).
**Reference (scope framing, rationale, edge-case matrix — never read at boot):** `delivery.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = delivery`, reads this file, and follows it in-context. No subagent, no phase gate.
**Model:** claude-opus-4-8

**Probe convention:** every git/gh probe below is judged by **exit code**, not stderr text — exit 0 means the probed thing exists/succeeded, non-zero means it does not. stderr is informational and discarded unless an operation's `Output` says to surface it as a reason.

**Consumes, never derives:** every operation takes an already-resolved `<branch-name>` / `<message>` / `<title>` / `<body>`; composing those from a tracker work item is the caller's job, not this file's.

**Operations:** branch-create · branch-switch · commit · push-upstream · pr-create · pr-detect · workspace-root-resolve · current-branch-query · last-commit-timestamp-query · pr-comments-read · pr-comment-post · checks-read · review-thread-resolve · pr-merge · activity-read.

## branch-create

**Inputs:** `<branch-name>` (already-resolved, required). `<base>` (optional; determined below when omitted).

**Procedure:**

1. **Detached-HEAD / already-on-target.** `git rev-parse --abbrev-ref HEAD`. Result `HEAD` → error: "Detached HEAD; cannot create branches from this state." Result equal to `<branch-name>` → valid no-op: `<state>` = `already-active`, skip to step 7.
2. **Dirty-worktree guard.** `git status --porcelain`. Non-empty → error: "Uncommitted changes detected. Commit or stash before switching branches."
3. **Existing branch of this exact name.** `git branch --list "<branch-name>"`. Match → `git checkout <branch-name>`; `<state>` = `switched`, `<base-source>` = `already existed`; skip to step 7.
4. **Determine the base.** Use `<base>` if supplied; else `git rev-parse --verify main` (exit 0 → `main`, non-zero → `master`).
5. **Detect a remote and fetch.** `git remote get-url origin` (exit 0 → `<has-remote>` = true, else false). When true: `git fetch origin <base>` — a non-zero exit here is a genuine error: "Failed to fetch `<base>` from origin." When false: skip the fetch and branch from the local base.
6. **Create and switch.** With a remote: `git checkout -b <branch-name> origin/<base>`, `<base-source>` = `origin/<base>`. Without: `git checkout -b <branch-name> <base>`, `<base-source>` = `<base>`. `<state>` = `created`.
7. **Tracking.** `created` + remote: `git push --set-upstream origin <branch-name>` (exit 0 → `<tracking>` = `origin/<branch-name>`; non-zero → `local-only (push failed)` — the local branch is still valid, do **not** abort). `created` without a remote: `<tracking>` = `local-only (no remote)`. `already-active` / `switched`: `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (exit 0 → its output; non-zero → `local-only (no upstream)`).

**Output:** `<state>` (`created` | `switched` | `already-active`), `<base-source>` (`origin/<base>` | `<base>` | `already existed`), `<tracking>` (`origin/<branch-name>` | `local-only (push failed)` | `local-only (no remote)` | `local-only (no upstream)`).

## branch-switch

**Inputs:** `<branch-name>` (already-resolved, required — must exist locally or on origin).

**Procedure:**

1. **Detached-HEAD guard** and **dirty-worktree guard** (branch-create steps 1 and 2).
2. **Local match.** `git branch --list "<branch-name>"`. Match → `git checkout <branch-name>`.
3. **Remote-only match.** No local match → `git branch -r --list "origin/<branch-name>"`. Match → `git checkout -t origin/<branch-name>` (creates the local branch tracking the remote).
4. **Not found.** Neither match → error: "Branch `<branch-name>` does not exist locally or on origin."
5. **Tracking.** `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (exit 0 → `<tracking>`; non-zero → `local-only (no upstream)`).

**Output:** `<state>` = `switched`, `<tracking>`.

## commit

**Inputs:** `<message>` (already-authored, required). `<staged-only>` (optional bool, default false).

**Procedure:**

1. **Detached-HEAD guard** (branch-create step 1) — commits require a named branch.
2. **Stage.** Unless `<staged-only>` is true, `git add -A`.
3. **Nothing-to-commit.** `git diff --staged --quiet`. Exit 0 (empty staged diff) → valid no-op: `<state>` = `nothing-to-commit`, stop.
4. **Message file.** Write `<message>` to `.git/WF_COMMITMSG` (inside `.git/`, never tracked, never dirties the worktree).
5. **Commit.** `git commit -F .git/WF_COMMITMSG`. Non-zero → error with git's failure reason. Remove the scratch file regardless of outcome (best effort).
6. **Diffstat.** `git show --stat --format= HEAD` → a short "`<n>` changed (+`<a>` -`<d>`)" summary.

**Output:** `<state>` (`committed` | `nothing-to-commit`); on `committed`, the diffstat summary.

## push-upstream

**Inputs:** `<branch>` (optional; defaults to the current branch).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`; its `HEAD` signal → error: "Detached HEAD; no branch to push."
2. **Read the configured upstream in one probe, scoped to `<branch>`.** `git config --get-regexp "^branch\.<branch>\.(remote|merge)$"`. From its output take `<remote>` (the `remote` line's value) and `<remote-branch>` (the `merge` line's value with its `refs/heads/` prefix stripped). Never derive these from the abbreviated `<branch>@{u}` ref.
   - Non-zero exit / no output → no upstream configured; skip to step 4.
   - `<remote>` is the literal `.` → `<branch>` tracks a **local** branch, not a remote — nothing to push upstream; return `failed (tracks a local branch, not a remote)`.
3. **Push with an explicit two-sided refspec.** `git push <remote> <branch>:<remote-branch>` — always name both sides explicitly, never `git push <remote> <branch>` alone. Skip to step 5.
4. **No upstream — bootstrap to `origin`.** `git push --set-upstream origin <branch>`.
5. **Map the outcome.** Exit 0 → `pushed (<remote>/<remote-branch>)` (or `up-to-date (<remote>/<remote-branch>)` when git reports nothing to push and that can be distinguished) on the has-upstream path, or `pushed (origin/<branch>)` on the bootstrap path. Non-zero → `failed (<short reason>)` — **non-fatal** to any prior commit; do not undo it.

**Output:** `<state>` (`pushed` | `up-to-date` | `failed (<reason>)`).

## pr-create

**Inputs:** `<title>`, `<body>` (both already-composed, required). `<base>` (required). `<head>` (optional; defaults to the current branch). `<draft>` (optional bool, default false).

**Procedure:**

1. **Resolve `<head>` if omitted.** Run `current-branch-query`; its `HEAD` signal → error: "Detached HEAD; no branch to open a PR from."
2. **Ensure `<head>` is pushed.** Run `push-upstream` **passing `<head>`** (so it does not re-resolve the branch); idempotent even if already pushed. On its `failed (<reason>)`, stop: "Failed to push `<head>` — cannot open a PR for an unpushed branch."
3. **Short-circuit on an existing PR.** `gh pr view <head> --json url,state`.
   - `gh` authentication error → error: "`gh` is not authenticated. Run `gh auth login`."
   - Open PR found → `<state>` = `exists` with its URL. **Never** create a duplicate.
   - Otherwise continue.
4. **Body file.** Write `<body>` to `.git/WF_PRBODY` (never tracked).
5. **Create.** `gh pr create --base <base> --head <head> --title "<title>" --body-file .git/WF_PRBODY`, adding `--draft` when `<draft>` is true. Non-zero → error with `gh`'s failure reason (surface an auth hint if relevant). Remove the scratch file regardless of outcome (best effort).
6. **Capture** the created PR URL from `gh`'s output. `<state>` = `created`.

**Output:** `<state>` (`created` | `exists`), `<url>`.

## pr-detect

**Inputs:** `<branch>` (optional; defaults to the current branch).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`; its `HEAD` signal → error: "Detached HEAD; no branch to detect a PR for."
2. `gh pr view <branch> --json url,state`.
   - `gh` authentication error → error: "`gh` is not authenticated. Run `gh auth login`."
   - Found → return `<url>` + `<state>`.
   - Not found → a **valid "no open PR" result**, not an error.

**Output:** `<found>` (bool); on found, `<url>` + `<state>`.

## workspace-root-resolve (read)

**Inputs:** none.

**Procedure:**

1. `git rev-parse --show-toplevel`.
2. Success → that absolute path. Failure (not inside a git working tree) → a genuine **environment error** for a *registered* provider to surface plainly — distinct from core's no-provider plain-directory fallback, which this file does not implement.

**Output:** the absolute workspace root, or a plain environment error.

## current-branch-query (read)

**Inputs:** none.

**Procedure:**

1. `git rev-parse --abbrev-ref HEAD`.
2. The literal value `HEAD` is a **detached-HEAD signal**, not an error — return it as such. Otherwise return the branch name.

**Output:** the current branch name, or the literal `HEAD` (detached-HEAD signal).

## last-commit-timestamp-query (read)

**Inputs:** none.

**Procedure:**

1. `git log -1 --format=%cd`.
2. Success → the timestamp. Failure (no commits yet, or not inside a git working tree) → a genuine **environment error** to surface plainly — distinct from core's no-provider fallback, which this file does not implement.

**Output:** the last commit's timestamp, or a plain environment error.

## pr-comments-read (read)

**Inputs:** `<branch>` (optional; defaults to the current branch).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`; its `HEAD` signal → no branch context → return an **empty result** (no PR to read comments from).
2. **Resolve the PR number.** `gh pr view <branch> --json number` — `gh` authentication error → error: "`gh` is not authenticated. Run `gh auth login`." No open PR → a valid **empty result**, not an error.
3. **Read the comments in one pass.** `gh pr view <branch> --json comments,reviews` for the PR-level and review-summary comments, and `gh api repos/{owner}/{repo}/pulls/<number>/comments --paginate` for the inline review-thread comments. Discard nothing; merge both into one list.

**Output:** the review comments (author, body, and thread/anchor where present), or an empty list.

## pr-comment-post

**Inputs:** `<body>` (already-composed, required). `<branch>` (optional; defaults to the current branch). `<reply-to>` (optional; a review-thread/comment id to reply within an existing thread).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`; its `HEAD` signal → error: "Detached HEAD; no branch to comment on."
2. **Ensure a PR exists.** Run `pr-detect` for `<branch>`; not found → error: "No open PR for `<branch>` to comment on."
3. **Body file.** Write `<body>` to `.git/WF_PRCOMMENT` (inside `.git/`, never tracked).
4. **Post.** No `<reply-to>` → `gh pr comment <branch> --body-file .git/WF_PRCOMMENT`. With `<reply-to>` → `gh api repos/{owner}/{repo}/pulls/<number>/comments --field body=@.git/WF_PRCOMMENT --field in_reply_to=<reply-to>` (a threaded reply). Non-zero → error with `gh`'s reason. Remove the scratch file regardless of outcome (best effort).
5. **Capture** the posted comment's URL from `gh`'s output.

**Output:** `<state>` = `posted`, `<url>`.

## checks-read (read)

**Inputs:** `<branch>` (optional; defaults to the current branch).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`; its `HEAD` signal → return an **empty result** (no PR to read checks from).
2. `gh pr checks <branch> --json name,state,bucket,link`.
   - `gh` authentication error → error: "`gh` is not authenticated. Run `gh auth login`."
   - No open PR, or no checks configured → a valid **empty result** (no checks), not an error.

**Output:** the checks (name, state, link), or an empty list.

## review-thread-resolve

**Inputs:** `<thread-id>` (already-resolved review-thread node id, required — REST exposes no resolve endpoint, so the id is a GraphQL node id).

**Procedure:**

1. `gh api graphql -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' -F t=<thread-id>`.
   - `gh` authentication error → error: "`gh` is not authenticated. Run `gh auth login`."
   - Non-zero → error with `gh`'s reason (an unknown thread id, or one already resolved).

**Output:** `<state>` = `resolved`.

## pr-merge

**Inputs:** `<branch>` (optional; defaults to the current branch). `<method>` (optional; `merge` | `squash` | `rebase`, default `squash`). `<delete-branch>` (optional bool, default false).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`; its `HEAD` signal → error: "Detached HEAD; no branch to merge a PR for."
2. **Detect-first (idempotency).** `gh pr view <branch> --json url,state`. `gh` authentication error → error: "`gh` is not authenticated. Run `gh auth login`." State `MERGED` → valid no-op: `<state>` = `already-merged` with its URL, stop — **never** re-merge. No open PR → error: "No open PR for `<branch>` to merge."
3. **Merge.** `gh pr merge <branch> --<method>` (from `<method>`), adding `--delete-branch` when `<delete-branch>` is true. Non-zero → error with `gh`'s reason (failing required checks, unresolved conversations, or a not-mergeable state — surface it).
4. **Capture** the merged PR URL.

**Output:** `<state>` (`merged` | `already-merged`), `<url>`.

## activity-read (read)

**Inputs:** `<since>` (optional; a git approxidate / duration window, default a recent window such as one day). `<limit>` (optional cap on pull requests).

**Procedure:**

1. **Recent commits.** `git log --since="<since>" --format=%h%x09%cd%x09%s` (reachable from HEAD). Not inside a git working tree → an **empty commit list** — a read never blocks a standup.
2. **Recent pull requests.** `gh pr list --state all --limit <limit> --json number,title,state,updatedAt,url --search "updated:>=<since-date>"`. Any `gh` failure (unauthenticated, no remote) → an **empty PR list** — harmless degrade, never an error.
3. **Merge** the two streams into a recent-activity view.

**Output:** the recent commits + pull-request activity, or an empty result.
