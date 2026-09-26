# postmortem `{task-root}` containment gate

Runtime-read reference for `SKILL.md` Phase 3 steps 2.5 and 4 (including the fresh-mint identity
capture), and Phase 4 step 2.5 (the fresh-mint target validation) — obtained via
`resolve_content({ workspaceRoot, ... })` (`class: references-template`, `plugin: wf-postmortem`, `skill:
postmortem`, `ref: task-root-containment.md`) at the start of each of those steps, never read at boot.
This is the full, behavior-bearing procedure `SKILL.md` points to rather than restates inline at each of
its three call sites, per this repo's skill-body-length budget; it is followed exactly, not merely
consulted for background.

## Contents

- [Why this gate exists](#why-this-gate-exists)
- [The primitive, and why it must run in a subshell](#the-primitive-and-why-it-must-run-in-a-subshell)
- [The comparison](#the-comparison)
- [Where this runs](#where-this-runs--three-call-sites-one-procedure-re-run-fresh-each-time)
- [Fresh-mint target identity](#fresh-mint-target-identity) — capture after `mkdir`, validation before `Write`
- [Retry semantics at step 4](#retry-semantics-at-step-4)

## Why this gate exists

`{task-root}` (`coreConfig.taskRoot`) is editable project config, and the resolver's own value
normalization never rejects an absolute path or a `..` segment — so an unchecked root would let the
id-mint `Glob` scan, the folder `mkdir`, and the report `Write` all reach outside the resolved workspace.
This reuses the same containment idiom `continuation.md` Part A step 2 uses for a `--report` path:
canonicalize both sides with the host's own filesystem, never a string comparison of the raw paths.

## The primitive, and why it must run in a subshell

`Bash`: `(cd '<path>' && pwd -P)` — **always in a subshell (the parentheses)**. A bare `cd` (no
parentheses) would move this agent's own persistent shell working directory for the rest of the run,
which could then corrupt every later resolution in the same session — including a *later* call to this
same gate, which would then resolve against a drifted cwd instead of `workspaceRoot`. The subshell
confines the directory change to just that one check. Every `'` in the value being canonicalized is
replaced by `'\''` first, wrapped in single quotes, before substitution.

## The comparison

Canonicalize `{task-root}` this way, and canonicalize the already-resolved absolute `workspaceRoot`
(`resolve_config`) the same way. Require the canonicalized `{task-root}` to be character-for-character
identical to, or a path-component-bounded descendant of, the canonicalized `workspaceRoot` — **never** a
string-prefix match (`<workspaceRoot>evil/...` must not pass). The `cd` itself failing (the directory
does not exist yet, or is unreadable) is also **not** contained.

**On failure** (does not resolve, or resolves outside `workspaceRoot`): stop, write nothing. Reason:
`"task root does not resolve inside the workspace — <the resolved {task-root} value>"`.

## Where this runs — three call sites, one procedure, re-run fresh each time

1. **Phase 3 step 2.5** — before step 3's id-mint `Glob`. The first pass. **Step 3's `Glob` scans this check's own printed canonical output, never a fresh read of the raw `{task-root}` config value** — the same discipline steps 4 and Phase 4 step 2.5 below already apply to the `mkdir`/`Write` targets, closing the same gap for the scan that precedes them.
2. **Phase 3 step 4** — immediately before the folder `mkdir`, re-running the identical comparison from
   scratch (not reusing step 2.5's canonicalized value), since the id-mint scan between the two is not
   instantaneous. **Build the `mkdir` target from this re-check's own output** — join the canonicalized
   `{task-root}` string this `pwd -P` call just printed with the minted folder name — never a
   separately-held copy of the raw, pre-check `{task-root}` config value, so the create targets exactly
   the directory identity the re-check just verified, not a value that could have changed between the
   two. On the fresh-mint path this re-check runs as the bound lookup and yields R1 and R2 (§"Fresh-mint target
   identity", Capture) before the `mkdir`.
3. **Phase 4 step 2.5** — immediately before the report `Write`, on **every** run, not only a
   `--report` follow-up (a follow-up instead re-runs `continuation.md` Part E in full, including its
   device/inode identity comparison). The elapsed time since step 2.5's first pass now includes all of
   Phase 3.5 — potentially many isolated `session-reader`/`excerpt-fetcher` dispatches, a far larger
   window than the id-mint `Glob` gap this gate was first built to close. On a fresh mint this call
   site is the **full target validation** in §"Fresh-mint target identity" below, of which the
   containment comparison is only the first predicate; the write path is built as that section states.

Each of the three re-runs the full comparison from scratch; none of them trusts a value canonicalized at
an earlier call site.

## Fresh-mint target identity

Containment alone proves only that `{task-root}` still resolves inside the workspace. It does not
bind the write to the folder this run created, so swapping the minted folder, `{task-root}` or an
ancestor, or pre-placing something at `report.md`, during Phase 3.5 would pass it. A fresh mint
therefore records the identity of what it created, then re-proves that identity before writing.

**The bound lookup.** Every path-and-identity pair below comes from **one** subshelled command,
`Bash`: `(cd '<path>' && pwd -P && stat -c '%d:%i' .)` (BSD: `stat -f '%d:%i' .`). The `cd`
resolves the path once, and both the canonical path it prints and the identity of `.` describe
that same resolved directory, never a second lookup of the path. The only other primitives are
`test -L '<path>'` and `test -e '<path>'`. Every value is single-quoted with `'` → `'\''` first.

**Capture (Phase 3 step 4).** Never on a `--report` follow-up (Part A step 2 records that identity
instead). The root half is taken **inside** the step 4 re-check that authorizes the create, and
the folder half only after `mkdir` exits 0, never on a collision attempt:

- **R1, R2:** the step 4 re-check runs its canonicalization of `{task-root}` as the bound lookup,
  **before** the `mkdir`. R1 is its printed canonical path and R2 is its printed identity, so
  both describe the one directory that passed the containment comparison.
- **J:** the expected folder path, joined root-aware: `/<minted folder name>` when R1 is exactly
  `/`, otherwise `<R1>/<minted folder name>`. Never a bare textual `<R1>/…` join.
- **After `mkdir` exits 0:** run the bound lookup on R1 and require both of its printed values to
  equal R1 and R2, so a root or ancestor replaced between the authorizing re-check and the create
  is rejected, never recorded.
- **R3, R4:** the bound lookup on J. R3 is the printed canonical path, which must equal J character
  for character, and R4 is the printed identity.

Any capture command failing, the root identity not equalling R2, or R3 not equalling J, means the
folder is not what `mkdir` just created under the authorized root. Stop, reason `"report target
changed between folder creation and write — nothing written"`, and write nothing. The folder stays
as it is and its id stays taken.

**Validation (Phase 4 step 2.5, the last action before the `Write`).** Re-derive every value fresh
and compare it only against R1–R4. Require **all** of the following, in order:

1. The containment comparison above passes, re-run from scratch as the bound lookup on
   `{task-root}`. Its printed canonical path equals R1 character for character and its printed
   identity equals R2. A replaced `{task-root}` or ancestor fails here, either by canonicalizing
   elsewhere or by carrying a different identity.
2. `test -e '<R3>/report.md'` **fails** and `test -L '<R3>/report.md'` **fails**. No file and no
   symlink (dangling or not) may occupy the slot. An absent `report.md` is the expected state of a
   first run, never an error.
3. `test -L '<R3>'` **fails**, meaning the minted folder is not a symlink.
4. **Last, immediately before the `Write`:** the bound lookup on R3 prints R3 and R4 exactly. A
   folder that was moved, replaced or redirected, including during the checks above, fails here.

Any predicate failing → stop `POSTMORTEM — stopped`, reason `"report target changed between folder
creation and write — nothing written"`. Write nothing: no report, no partial, no scratch copy.
**Never re-canonicalize the replacement and proceed.** A mismatch is a stop, never a new path to
accept. All passing → build the write path as `<R3>/report.md`, from the recorded values, never the
raw config value.

**Guarantee, stated plainly.** This, like `continuation.md` Part E, is a check immediately before
the write. It is **not atomic**. No primitive available here creates or writes through an
already-validated descriptor. Each bound lookup is internally consistent, but the gaps between
lookups remain, each a few consecutive tool calls wide:

- between the authorizing re-check and the `mkdir`, where the post-`mkdir` root lookup detects a
  root replaced by another directory but not one swapped and restored within the gap;
- between `mkdir` and the R3/R4 lookup, where capture looks the folder up by path rather than
  binding the created object, so a replacement made in that gap is recorded as if created;
- between validation predicate 4 (the folder identity) and the `Write`.

The checks narrow exposure from the whole Phase 3 to Phase 4 span to those three gaps; they do not
close them (rationale: `continuation-rationale.md` §"Why Part E re-verifies from scratch").

## Retry semantics at step 4

**"Retry" means re-running step 4's full sequence** — the canonicalization re-check above, then the
`mkdir` — on every one of the bounded 3 id-collision retry attempts, never only the bare `mkdir` on
attempts 2-3. Skipping the re-check on a retry would reopen, across that retry's own id-mint re-scan,
exactly the gap this gate exists to close.
