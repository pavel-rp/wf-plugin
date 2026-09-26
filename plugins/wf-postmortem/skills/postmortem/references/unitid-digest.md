# postmortem UnitId digest primitive

Runtime-read reference for `SKILL.md` Phase 3.5 step 3 (`session-reader:` UnitIds) and
`version-resolution.md` step 6 (`excerpt-fetcher:` UnitIds) — obtained via `resolve_content({
workspaceRoot, ... })` (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`,
`ref: unitid-digest.md`) before the first dispatch that needs a UnitId, never read at boot. It is the
one way this skill derives either digest; both paths use this same definition. Rationale:
`reader-dispatch-consistency.md` §2 (paired reference, never read at runtime).

## Input

One already-resolved absolute path — the session path step 3 dispatches, or the one real path
`version-resolution.md` step 6 resolved from a locator. Never session content, and never the
compound `locator:` string.

## Procedure — one digest at a time

Every relative path below resolves against `workspaceRoot` (the session's own `pwd -P`, which is
also the `Bash` working directory). Run each `Bash` step as its own single command.

1. **Preflight the scratch root.** `test -d '_local/scratch'` must succeed, and both
   `test -L '_local'` and `test -L '_local/scratch'` must fail — a missing or symlinked scratch root
   is a failure.
2. **Take an exclusive preimage directory.** `mktemp -d '_local/scratch/postmortem-unitid.XXXXXXXX'`.
   Its printed name must match `^_local/scratch/postmortem-unitid\.[A-Za-z0-9]{8}$`; call it
   `<dir>`. `mktemp` creates it fresh, owner-only, and fails rather than reuse an existing name, so
   no other invocation shares it and nothing was planted inside it.
3. **Write the preimage.** `Write` the path string — UTF-8, exactly its characters, no trailing
   newline, nothing else — to `<dir>/preimage`. This is the one scratch write exempt from the
   redacting write path (`redaction.md`): redacting it would change the digest.
4. **Hash it.** `test -L '<dir>/preimage'` must fail; then `sha256sum '<dir>/preimage'` (BSD:
   `shasum -a 256 '<dir>/preimage'`). The output's first field must match `^[0-9a-f]{64}$`; the
   digest is its first 16 characters.
5. **Remove it — always, after step 2 succeeded, whatever steps 3-4 did.** `rm -f '<dir>/preimage'`,
   then `rmdir '<dir>'`, then `test -e '<dir>'` must fail (the directory is confirmed gone).

The path is data in a file, never text on a command line: no command above contains it, so quotes,
spaces, `$(...)`, `;` and backticks in a path are hashed, never executed. `<dir>` is built only
from the fixed prefix and `mktemp`'s alphanumeric suffix, validated before use.

## Output

`session-reader:<digest>` (plus `:window-<n>` when windowed; every window of one session shares the
digest) or `excerpt-fetcher:<digest>`.

## Failure

- **Steps 1-4 fail** (a preflight, `mktemp`, the write, the leaf check, the hash, or the format
  check): no digest; the unit is **not dispatched** — step 3 records `skipped (reader error: unit id
  digest failed)`, step 6 treats the session side as **failed**. Step 5 still runs when `<dir>`
  exists.
- **Step 5 fails** (the preimage or `<dir>` is still present): the digest is **discarded** and the
  unit is not dispatched, exactly as above. Derive **no further digest this run** — every remaining
  unit takes the same outcome — and name the residual `<dir>` in that unit's recorded reason
  (`skipped (reader error: unit id digest cleanup failed — <dir>)`) so it can be removed by hand.
