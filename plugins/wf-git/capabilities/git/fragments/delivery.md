# git capability — the `delivery` fragment

**What this doc is:** an **inline reference doc**. A core skill reaches this file
through **direct provider resolution** — it resolves the registry row where
`contribution-kind = provider AND scope = delivery`, sees `dispatch: inline:
fragments/delivery.md`, reads this file, and **follows it in-context**. No subagent is
spawned; there is no phase-firing gate — any core skill, at any point in its own
procedure, may invoke any operation below.

**Scope note:** this file is scoped to the git/gh **mechanics** of each operation only.
Two concerns are explicitly **not** this file's job:

- **Tracker-specific derivation** — composing a branch name from a work-item id and
  title, composing a commit subject/PR title from a task's tracker record, or any
  other value that depends on a tracker's id shape. Every operation below **consumes**
  an already-resolved `<branch-name>` / `<message>` / `<title>` / `<body>` — it never
  derives one. That derivation is the caller's (core's) responsibility.
- **The no-provider plain-directory fallback.** When no capability owns the `delivery`
  surface, `workspace-root-resolve` resolves as a plain directory and writes state
  plainly that no delivery provider is registered — that is core's defined behaviour
  for the unconfigured case, not a procedure this file implements.

Every git probe below relies on **exit codes**, not stderr text: exit 0 means the
probed thing exists/succeeded; non-zero means it doesn't. The stderr message git or
`gh` prints is informational only and is discarded unless an operation's `Output`
explicitly says to surface it as an error reason.

---

## branch-create

**Inputs:** `<branch-name>` (already-resolved, required). `<base>` (optional; when
omitted, determine it per the procedure below).

**Procedure:**

1. **Detached-HEAD guard.** `git rev-parse --abbrev-ref HEAD`. If the result equals
   `HEAD` literally, return an error: "Detached HEAD; cannot create branches from this
   state."
2. **Already-on-target.** If the current branch already equals `<branch-name>`, this is
   a valid no-op — set `<state>` = `already-active` and skip to step 8 (tracking).
3. **Dirty-worktree guard.** `git status --porcelain`. Non-empty output → return an
   error: "Uncommitted changes detected. Commit or stash before switching branches."
4. **Existing branch of this exact name.** `git branch --list "<branch-name>"`. A match
   → `git checkout <branch-name>`, set `<state>` = `switched`, `<base-source>` =
   `already existed`, skip to step 8.
5. **Determine the base.** If `<base>` was supplied, use it. Otherwise: `git rev-parse
   --verify main` — exit 0 → `<base>` = `main`; non-zero → `<base>` = `master`. Discard
   stderr either way.
6. **Detect a remote and fetch.** `git remote get-url origin` — exit 0 → `<has-remote>`
   = true, else false. When `<has-remote>` is true, `git fetch origin <base>`; a
   non-zero exit here is a genuine error — return it: "Failed to fetch `<base>` from
   origin." When `<has-remote>` is false, skip the fetch and branch from the local
   base.
7. **Create and switch.** With a remote: `git checkout -b <branch-name>
   origin/<base>`, `<base-source>` = `origin/<base>`. Without one: `git checkout -b
   <branch-name> <base>`, `<base-source>` = `<base>` (local). Set `<state>` =
   `created`.
8. **Tracking.** With a remote: `git push --set-upstream origin <branch-name>`. Exit 0
   → `<tracking>` = `origin/<branch-name>`; non-zero (e.g. permissions) → `<tracking>`
   = `local-only (push failed)` — the local branch is still valid; do **not** abort.
   Without a remote: `<tracking>` = `local-only (no remote)`. For the `already-active`
   / `switched` paths, instead derive `<tracking>` via `git rev-parse --abbrev-ref
   --symbolic-full-name @{u}` (exit 0 → its output; non-zero → `local-only (no
   upstream)`).

**Output:** `<state>` (`created` | `switched` | `already-active`), `<base-source>`
(`origin/<base>` | `<base>` | `already existed`), `<tracking>` (`origin/<branch-name>`
| `local-only (push failed)` | `local-only (no remote)` | `local-only (no upstream)`).

---

## branch-switch

**Inputs:** `<branch-name>` (already-resolved, required — must already exist locally or
on the remote).

**Procedure:**

1. **Detached-HEAD guard** and **dirty-worktree guard**, identical to `branch-create`
   steps 1 and 3.
2. **Local match.** `git branch --list "<branch-name>"`. A match → `git checkout
   <branch-name>`.
3. **Remote-only match.** No local match → `git branch -r --list "origin/<branch-name>"`.
   A match → `git checkout -t origin/<branch-name>` (creates the local branch tracking
   the remote one).
4. **Not found.** Neither a local nor a remote match → return an error: "Branch
   `<branch-name>` does not exist locally or on origin."
5. **Tracking.** `git rev-parse --abbrev-ref --symbolic-full-name @{u}` — exit 0 → its
   output is `<tracking>`; non-zero → `local-only (no upstream)`.

**Output:** `<state>` = `switched`, `<tracking>`.

---

## commit

**Inputs:** `<message>` (already-authored, required). `<staged-only>` (optional bool,
default false).

**Procedure:**

1. **Detached-HEAD guard**, identical to `branch-create` step 1 — commits require a
   named branch.
2. **Stage.** Unless `<staged-only>` is true, `git add -A`.
3. **Nothing-to-commit check.** `git diff --staged --quiet`. Exit 0 (empty staged diff)
   → this is a valid no-op, not an error — return `<state>` = `nothing-to-commit` and
   stop here.
4. **Write the message to a scratch file inside `.git/`** (never tracked, never dirties
   the worktree) — e.g. `.git/WF_COMMITMSG`.
5. `git commit -F <that file>`. Non-zero exit → return an error with the git failure
   reason; remove the scratch file regardless of outcome (best effort).
6. **Capture the stat.** `git show --stat --format= HEAD` (or `git diff --stat
   HEAD~1 HEAD`) → a short "`<n>` changed (+`<a>` -`<d>`)" summary.

**Output:** `<state>` (`committed` | `nothing-to-commit`), and on `committed` the
short diffstat summary.

---

## push-upstream

**Inputs:** `<branch>` (optional; defaults to the current branch).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`. Its detached-HEAD
   signal (the literal `HEAD`) → return an error: "Detached HEAD; no branch to push."
   Otherwise use its result as `<branch>`.
2. **Detect the configured upstream, scoped to `<branch>`** — via `git config`, never
   the abbreviated `<branch>@{u}` ref (its remote and branch segments are joined by
   `/` with no escaping, so it cannot be split back apart when a remote name or branch
   name itself contains a `/`). Run `git config --get branch.<branch>.remote`.
   - Non-zero exit (or empty output) → no upstream configured; skip to step 4.
   - Output is the literal `.` → `<branch>` tracks another **local** branch, not a
     remote — there is nothing to push upstream; return
     `failed (tracks a local branch, not a remote)`.
   - Otherwise → capture the output verbatim as `<remote>`, then run
     `git config --get branch.<branch>.merge` and strip its `refs/heads/` prefix to
     get `<remote-branch>`.
3. **Push with an explicit two-sided refspec, scoped to `<branch>`.**
   `git push <remote> <branch>:<remote-branch>`. Always name both sides explicitly —
   **never** `git push <remote> <branch>` alone: when `<remote-branch>` differs from
   `<branch>` (a real, supported git configuration), the same-name-only form silently
   creates a *new* same-named branch on the remote while leaving the actually-tracked
   branch stale, with exit 0 and no error surfaced. Skip to step 5.
4. **No upstream configured — bootstrap to `origin`.**
   `git push --set-upstream origin <branch>` (bootstrapping a new upstream still
   defaults to `origin`, matching this capability's single-default-remote convention
   elsewhere).
5. **Map the outcome.** Exit 0 → `pushed (<remote>/<remote-branch>)` on the
   has-upstream path (or `up-to-date (<remote>/<remote-branch>)` when git reports
   nothing to push and that can be distinguished), or `pushed (origin/<branch>)` on
   the bootstrap path. Non-zero → `failed (<short reason>)` — this failure is
   **non-fatal** to any prior commit; do not undo it.

**Output:** `<state>` (`pushed` | `up-to-date` | `failed (<reason>)`).

---

## pr-create

**Inputs:** `<title>`, `<body>` (both already-composed, required). `<base>` (required).
`<head>` (optional; defaults to the current branch). `<draft>` (optional bool, default
false).

**Procedure:**

1. **Resolve `<head>` if omitted.** Run `current-branch-query`. Its detached-HEAD
   signal (the literal `HEAD`) → return an error: "Detached HEAD; no branch to open a
   PR from." Otherwise use its result as `<head>`.
2. **Ensure `<head>` is pushed.** Run `push-upstream` for `<head>` defensively — this is
   idempotent even if the branch is already pushed. Check its returned `<state>`: on
   `failed (<reason>)`, stop here and return an error — "Failed to push `<head>` —
   cannot open a PR for an unpushed branch" — rather than letting an unpushed head fall
   through to a less specific `gh pr create` failure in step 5.
3. **Short-circuit on an existing PR.** `gh pr view <head> --json url,state`.
   - `gh` errors with an authentication problem → return an error naming the remedy:
     "`gh` is not authenticated. Run `gh auth login`."
   - An open PR is found → return `<state>` = `exists` with its URL. **Never** create a
     duplicate.
   - Otherwise continue.
4. **Write `<body>` to a scratch file inside `.git/`** (never tracked) — e.g.
   `.git/WF_PRBODY`.
5. `gh pr create --base <base> --head <head> --title "<title>" --body-file <that
   file>`, adding `--draft` when `<draft>` is true. Non-zero exit → return an error
   with the `gh` failure reason (surface an auth hint if relevant). Remove the scratch
   file regardless of outcome (best effort).
6. **Capture the created PR URL** from `gh`'s output. `<state>` = `created`.

**Output:** `<state>` (`created` | `exists`), `<url>`.

**Single-shot-publish idempotency (explicit).** This operation's own `gh pr view`
check (step 3) is a **safety net**, not the primary guard. The *primary* guard is the
caller: before invoking `pr-create` again for the same artifact, the caller reads back
a `**PR:** <url>` metadata line already recorded in the artifact that triggered the
first call. A present value means the operation already ran and must be treated as
already-published — the caller never re-invokes `pr-create` for that artifact. This
mirrors the contract's metadata-line attribution shape used elsewhere (e.g. model
attribution).

---

## pr-detect

**Inputs:** `<branch>` (optional; defaults to the current branch).

**Procedure:**

1. **Resolve `<branch>` if omitted.** Run `current-branch-query`. Its detached-HEAD
   signal (the literal `HEAD`) → return an error: "Detached HEAD; no branch to detect
   a PR for." Otherwise use its result as `<branch>`.
2. `gh pr view <branch> --json url,state`.
   - `gh` errors with an authentication problem → return an error naming the remedy
     ("`gh` is not authenticated. Run `gh auth login`.").
   - Found → return the `<url>` and `<state>`.
   - Not found → this is a **valid "no open PR" result**, not an error.

**Output:** `<found>` (bool), and on found, `<url>` + `<state>`.

---

## workspace-root-resolve (read)

**Inputs:** none.

**Procedure:**

1. `git rev-parse --show-toplevel`.
2. Success → return that absolute path.
3. Failure (not inside a git working tree) — this is a genuine **environment error**
   for a *registered* provider to surface plainly. This is explicitly distinct from
   the contract's "no provider registered" plain-directory fallback, which is core's
   own behaviour when the `delivery` surface has no owner at all — not something this
   file implements.

**Output:** the absolute workspace root, or a plain environment error.

---

## current-branch-query (read)

**Inputs:** none.

**Procedure:**

1. `git rev-parse --abbrev-ref HEAD`.
2. The literal value `HEAD` is a **detached-HEAD signal**, not an error — return it as
   such so the caller can decide what to do.
3. Otherwise return the branch name.

**Output:** the current branch name, or the literal `HEAD` (detached-HEAD signal).

---

## Edge cases reproduced

A completeness self-check against today's `branch.md` / `commit.md` / `pr.md`:

- **Dirty tree** — `branch-create` step 3, `branch-switch` step 1.
- **Existing branch** — `branch-create` step 4 (exact-name match → `switched`),
  `branch-switch` steps 2–3 (local or remote-only match).
- **No upstream** — `branch-create` step 8 (`local-only (no upstream)` derivation),
  `push-upstream` steps 2 & 4 (detects it, then bootstraps to `origin` when absent).
- **Existing PR** — `pr-create` step 3 (`exists`, never duplicated), `pr-detect` step 2
  (found vs. not-found, the latter not an error).
- **Detached HEAD** — `branch-create` step 1, `branch-switch` step 1, `commit` step 1,
  `push-upstream` step 1, `pr-detect` step 1, `pr-create` step 1 (the latter three via
  `current-branch-query` when the branch input is omitted).
- **`gh`-not-authenticated** — `pr-create` step 3, `pr-detect` step 2 (both name the
  `gh auth login` remedy).
