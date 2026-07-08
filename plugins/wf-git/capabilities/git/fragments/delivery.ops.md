# git delivery provider — runtime ops

**Version:** 1.2.0 (WF-211 — split out of the delivery fragment as the bounded runtime-ops half; push-upstream probe consolidation)
**Role:** the runtime-read half of the git delivery provider — every input, guard, error path, and outcome mapping a delivery operation follows. Read at every delivery-surface boot; self-sufficient (no step below requires opening another file).
**Reference (scope framing, rationale, edge-case matrix — never read at boot):** `delivery.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = delivery`, reads this file, and follows it in-context. No subagent, no phase gate.

**Probe convention:** every git/gh probe below is judged by **exit code**, not stderr text — exit 0 means the probed thing exists/succeeded, non-zero means it does not. stderr is informational and discarded unless an operation's `Output` says to surface it as a reason.

**Consumes, never derives:** every operation takes an already-resolved `<branch-name>` / `<message>` / `<title>` / `<body>`; composing those from a tracker work item is the caller's job, not this file's.

**Operations:** branch-create · branch-switch · commit · push-upstream · pr-create · pr-detect · workspace-root-resolve · current-branch-query · last-commit-timestamp-query.

---

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

---

## branch-switch

**Inputs:** `<branch-name>` (already-resolved, required — must exist locally or on origin).

**Procedure:**

1. **Detached-HEAD guard** and **dirty-worktree guard** (branch-create steps 1 and 2).
2. **Local match.** `git branch --list "<branch-name>"`. Match → `git checkout <branch-name>`.
3. **Remote-only match.** No local match → `git branch -r --list "origin/<branch-name>"`. Match → `git checkout -t origin/<branch-name>` (creates the local branch tracking the remote).
4. **Not found.** Neither match → error: "Branch `<branch-name>` does not exist locally or on origin."
5. **Tracking.** `git rev-parse --abbrev-ref --symbolic-full-name @{u}` (exit 0 → `<tracking>`; non-zero → `local-only (no upstream)`).

**Output:** `<state>` = `switched`, `<tracking>`.

---

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

---

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

---

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

---

## pr-detect

**Inputs:** `<branch>` (optional; defaults to the current branch).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`; its `HEAD` signal → error: "Detached HEAD; no branch to detect a PR for."
2. `gh pr view <branch> --json url,state`.
   - `gh` authentication error → error: "`gh` is not authenticated. Run `gh auth login`."
   - Found → return `<url>` + `<state>`.
   - Not found → a **valid "no open PR" result**, not an error.

**Output:** `<found>` (bool); on found, `<url>` + `<state>`.

---

## workspace-root-resolve (read)

**Inputs:** none.

**Procedure:**

1. `git rev-parse --show-toplevel`.
2. Success → that absolute path. Failure (not inside a git working tree) → a genuine **environment error** for a *registered* provider to surface plainly — distinct from core's no-provider plain-directory fallback, which this file does not implement.

**Output:** the absolute workspace root, or a plain environment error.

---

## current-branch-query (read)

**Inputs:** none.

**Procedure:**

1. `git rev-parse --abbrev-ref HEAD`.
2. The literal value `HEAD` is a **detached-HEAD signal**, not an error — return it as such. Otherwise return the branch name.

**Output:** the current branch name, or the literal `HEAD` (detached-HEAD signal).

---

## last-commit-timestamp-query (read)

**Inputs:** none.

**Procedure:**

1. `git log -1 --format=%cd`.
2. Success → the timestamp. Failure (no commits yet, or not inside a git working tree) → a genuine **environment error** to surface plainly — distinct from core's no-provider fallback, which this file does not implement.

**Output:** the last commit's timestamp, or a plain environment error.
