# postmortem `{task-root}` containment gate

Runtime-read reference for `SKILL.md` Phase 3 steps 2.5 and 4, and Phase 4 step 2.5 — obtained via
`resolve_content({ workspaceRoot, ... })` (`class: references-template`, `plugin: wf-postmortem`, `skill:
postmortem`, `ref: task-root-containment.md`) at the start of each of those steps, never read at boot.
This is the full, behavior-bearing procedure `SKILL.md` points to rather than restates inline at each of
its three call sites, per this repo's skill-body-length budget; it is followed exactly, not merely
consulted for background.

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

1. **Phase 3 step 2.5** — before step 3's id-mint `Glob`. The first pass.
2. **Phase 3 step 4** — immediately before the folder `mkdir`, re-running the identical comparison from
   scratch (not reusing step 2.5's canonicalized value), since the id-mint scan between the two is not
   instantaneous. **Build the `mkdir` target from this re-check's own output** — join the canonicalized
   `{task-root}` string this `pwd -P` call just printed with the minted folder name — never a
   separately-held copy of the raw, pre-check `{task-root}` config value, so the create targets exactly
   the directory identity the re-check just verified, not a value that could have changed between the
   two.
3. **Phase 4 step 2.5** — immediately before the report `Write`, on **every** run, not only a
   `--report` follow-up (a follow-up instead re-runs `continuation.md` Part E in full, including its
   device/inode identity comparison). The elapsed time since step 2.5's first pass now includes all of
   Phase 3.5 — potentially many isolated `session-reader`/`excerpt-fetcher` dispatches, a far larger
   window than the id-mint `Glob` gap this gate was first built to close. **Build the write path from
   this re-check's own output** the same way step 4 builds the `mkdir` target — join the canonicalized
   `{task-root}` string with the already-minted `PM<NNN>__<slug>/report.md` suffix, never the raw
   pre-check value.

Each of the three re-runs the full comparison from scratch; none of them trusts a value canonicalized at
an earlier call site.

## Retry semantics at step 4

**"Retry" means re-running step 4's full sequence** — the canonicalization re-check above, then the
`mkdir` — on every one of the bounded 3 id-collision retry attempts, never only the bare `mkdir` on
attempts 2-3. Skipping the re-check on a retry would reopen, across that retry's own id-mint re-scan,
exactly the gap this gate exists to close.
