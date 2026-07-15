# git delivery provider — runtime ops

**Version:** 1.6.0 (WF-283 — `branch-create`'s dirty-worktree guard replaced with a stash-based carry across both the `switched` and `created` outcomes, adding a `<carry>` output field; WF-221 — `default-base-query` read operation added so core commit/pr obtain the base branch through the contract instead of hardcoding a trunk name; WF-211 — split out of the delivery fragment as the bounded runtime-ops half; push-upstream probe consolidation; WF-157 — six PR-interaction/merge/activity operations bound: `pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`, `pr-merge`, `activity-read`; WF-176 — the branch-changes enumeration read operation bound: `branch-changes-read`)
**Role:** the runtime-read half of the git delivery provider — every input, guard, error path, and outcome mapping a delivery operation follows. Read at every delivery-surface boot; self-sufficient (no step below requires opening another file).
**Reference (scope framing, rationale, edge-case matrix — never read at boot):** `delivery.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = delivery`, reads this file, and follows it in-context. No subagent, no phase gate.
**Model:** claude-opus-4-8

**Probe convention:** every git/gh probe below is judged by **exit code**, not stderr text — exit 0 means the probed thing exists/succeeded, non-zero means it does not. stderr is informational and discarded unless an operation's `Output` says to surface it as a reason.

**Consumes, never derives:** every operation takes an already-resolved `<branch-name>` / `<message>` / `<title>` / `<body>`; composing those from a tracker work item is the caller's job, not this file's.

**Operations:** branch-create · branch-switch · commit · push-upstream · pr-create · pr-detect · workspace-root-resolve · current-branch-query · default-base-query · last-commit-timestamp-query · branch-changes-read · pr-comments-read · pr-comment-post · checks-read · review-thread-resolve · pr-merge · activity-read.

## branch-create

**Inputs:** `<branch-name>` (already-resolved, required). `<base>` (optional; determined below when omitted).

**Procedure:**

1. **Detached-HEAD / already-on-target.** `git rev-parse --abbrev-ref HEAD`. Result `HEAD` → error: "Detached HEAD; cannot create branches from this state." Result equal to `<branch-name>` → valid no-op: `<state>` = `already-active`, `<carry>` = `none` (no checkout happens, so nothing is ever captured), skip to step 8.
2. **Capture a dirty tree.** `git status --porcelain`. Empty → `<carry>` = `none`, nothing to reapply later; continue to step 3. Non-empty → set aside everything, tracked and untracked, in one stash tagged with `<branch-name>`: `git stash push -u -m "<branch-name>"`, then immediately pin the created entry's identity — `git rev-parse -q --verify stash@{0}` — and hold that SHA as `<captured-stash>` for steps 5 and 7. This SHA is a durable **identity** check, not a ready-to-use ref for every subcommand: `apply` accepts a bare commit-ish directly, but `pop`/`drop` require the entry's *current* `stash@{N}` position — resolve that fresh at each use (`git stash list --format='%H %gd'`, matched against `<captured-stash>`), never assumed positionally in advance, since the stack's top can shift. Non-zero exit on either command in this step (rare — e.g. an unresolved merge state) is a genuine error, distinct from the old dirty-tree wording: "Failed to set aside uncommitted changes: `<reason>`."
3. **Existing branch of this exact name.** `git branch --list "<branch-name>"`. Match → `git checkout <branch-name>`; `<state>` = `switched`, `<base-source>` = `already existed`; skip to step 7 — the capture in step 2 applies to this outcome too.
4. **Determine the base.** Use `<base>` if supplied; else `git rev-parse --verify main` (exit 0 → `main`, non-zero → `master`).
5. **Detect a remote and fetch.** `git remote get-url origin` (exit 0 → `<has-remote>` = true, else false). When true: `git fetch origin <base>` — a non-zero exit here is a genuine error: "Failed to fetch `<base>` from origin." When false: skip the fetch and branch from the local base. **On the fetch-failure error, if step 2 captured `<captured-stash>`, restore it first** — resolve its current position (per step 2's lookup) and run `git stash pop <resolved-position>` — before returning the error: a fetch failure is unrelated to the dirty-tree carry, and it must not silently strand the caller's uncommitted work in a stash they were never told about (no checkout has happened yet at this point, so restoring lands cleanly on the original branch).
6. **Create and switch.** With a remote: `git checkout -b <branch-name> origin/<base>`, `<base-source>` = `origin/<base>`. Without: `git checkout -b <branch-name> <base>`, `<base-source>` = `<base>`. `<state>` = `created`.
7. **Reapply a captured stash.** Skip entirely when step 2 recorded `<carry>` = `none` — nothing follows. Otherwise attempt the real reapply directly (a textual dry run cannot reliably predict a stash's three-way-merge outcome, so no separate check step precedes this): `git stash apply <captured-stash>` — deliberately `apply`, not `pop` (and the SHA form works directly for `apply`), so this step alone never drops the stash regardless of outcome.
   - Exit 0 (clean) → resolve `<captured-stash>`'s current position (same lookup as step 5) and drop it explicitly now that the apply is confirmed clean: `git stash drop <resolved-position>`. `<carry>` = `applied` — the changes land uncommitted on the resulting branch, same as a clean-tree run would look with those edits already present.
   - Non-zero (conflicting) → the failed merge may have left tracked-file conflict markers **and** reintroduced the stash's untracked files into the tree (a `-u` stash restores untracked content before the tracked-file merge is judged, so untracked files can land even when the merge itself fails). Restore the tree to the clean just-checked-out state in two steps: `git reset --hard HEAD` (safe here: HEAD hasn't moved since the checkout in step 3/6) clears the tracked-file conflict, then `git clean -fd` (never `-x` — that would also delete gitignored files this stash never touched) removes the reintroduced untracked files. The stash itself is never dropped by a failed `apply`. `<carry>` = ``conflict (stash preserved, tagged `<branch-name>` — run `git stash list` to find it, then `git stash pop` that entry to finish reapplying and resolve)``. The checkout already completed in step 3 or step 6 — this never blocks or rolls it back.
8. **Tracking.** `created` + remote: `git push --set-upstream origin <branch-name>` (exit 0 → `<tracking>` = `origin/<branch-name>`; non-zero → `local-only (push failed)` — the local branch is still valid, do **not** abort). `created` without a remote: `<tracking>` = `local-only (no remote)`. `already-active` / `switched`: `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (exit 0 → its output; non-zero → `local-only (no upstream)`).

**Output:** `<state>` (`created` | `switched` | `already-active`), `<base-source>` (`origin/<base>` | `<base>` | `already existed`), `<tracking>` (`origin/<branch-name>` | `local-only (push failed)` | `local-only (no remote)` | `local-only (no upstream)`), `<carry>` (`none` — either the tree was already clean, or the run was the `already-active` no-op where no checkout occurs so nothing is ever captured, dirty tree or not — | `applied` | ``conflict (stash preserved, tagged `<branch-name>` — run `git stash list` to find it, then `git stash pop` that entry to finish reapplying and resolve)``).

## branch-switch

**Inputs:** `<branch-name>` (already-resolved, required — must exist locally or on origin).

**Procedure:**

1. **Detached-HEAD guard** (branch-create step 1) and this operation's own **dirty-worktree guard** — `git status --porcelain` non-empty → error: "Uncommitted changes detected. Commit or stash before switching branches." (branch-create no longer shares this guard shape — see `delivery.md`.)
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

## default-base-query (read)

**Inputs:** none.

**Procedure:**

1. `git rev-parse --verify main` (exit 0 → `main`; non-zero → `master`) — the same trunk-name fallback `branch-create` step 4 and `branch-changes-read` step 1 apply, so a repo on either default trunk resolves without configuration.

**Output:** the repository's default base branch name (`main` or `master`). A read never errors; a caller needing the base *value* (a first-commit count, a PR base) obtains it here instead of naming a trunk itself.

## last-commit-timestamp-query (read)

**Inputs:** none.

**Procedure:**

1. `git log -1 --format=%cd`.
2. Success → the timestamp. Failure (no commits yet, or not inside a git working tree) → a genuine **environment error** to surface plainly — distinct from core's no-provider fallback, which this file does not implement.

**Output:** the last commit's timestamp, or a plain environment error.

## branch-changes-read (read)

**Inputs:** `<base>` (optional; the ref the branch is diffed against — determined below when omitted).

**Procedure:**

1. **Resolve the base.** Use `<base>` if supplied; else `git rev-parse --verify main` (exit 0 → `main`, non-zero → `master`) — the same base fallback `branch-create` uses.
2. **Committed divergence.** `git diff --name-status <base>...HEAD` — the three-dot (merge-base) diff, so files already on `<base>` never appear; each line is a change status (`A`/`M`/`D`/`R…`) and its path.
3. **Uncommitted working-tree changes.** `git status --porcelain` — fold in any staged, unstaged, or untracked path not already present, so a branch's in-progress edits are visible too.
4. **Merge** the two into one changed-file set keyed by path (a path present in both keeps its most-recent status); an empty set is a valid result (no divergence and a clean tree).

**Output:** the changed-file set (each entry a path + its change status), or an empty set. Not inside a git working tree → a genuine **environment error** to surface plainly — distinct from core's no-provider plain-directory fallback, which this file does not implement.

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
