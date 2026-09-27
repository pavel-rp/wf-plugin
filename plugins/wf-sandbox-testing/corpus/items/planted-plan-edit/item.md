# Corpus item 18 — planted plan edit: an approved plan written after approval halts before any PR

**Model:** claude-opus-5-5

**Provenance:** **WF-834** — "Re-baseline the eval-corpus plan snapshots to the progress-artifact
shape" (charter **C040**, umbrella **WF-829**), the negative control its re-baseline owes; the
invariant itself is **WF-830** — "Keep the approved plan byte-identical by moving implement progress
to its own artifact" — whose legacy plan-tick fallbacks **WF-832** removed.

## What this item guards

Since WF-830, `/wf:implement` writes every step status, note and its Resolution Summary to
`02_progress.md`; the approved `02_plan.md` is read-only, because the `gate:plan` approval binds it
by the sha256 of its raw bytes. WF-834 re-cut every corpus plan snapshot to that shape. A re-baseline
is exactly the change that can hide a regression — so this item plants one: a build whose implement
writes into the approved plan again. The item passes only if that planted edit **halts the run before
any pull request exists**, and the clean control passes only if the plan stays byte-identical.

## The run sets

| Set | Plan bytes vs `gate:plan` digest | Terminal | Op log |
|-----|----------------------------------|----------|--------|
| `runs-current/run-1` (clean control) | identical | `SHIP — Merged` | `pr-create` … `pr-merge` |
| `seeded-breakage/runs/run-1` (planted edit) | changed (step ticks + a note written into the plan) | `SHIP — Blocked`, `Gates: halted at gate:plan — stale` | zero `pr-create` |

## Assertions (`check_plan_identity` in `run.sh`, check 13)

1. Recompute sha256 of each run's `02_plan.md` and compare with the `gate:plan` digest in its
   `run.json` — the verdict is computed, never read from the canned run.
2. Clean control: digest matches (and matches `02_progress.md`'s `**Plan digest:**`), the op log
   carries a `pr-create`, the terminal block is `SHIP — Merged`.
3. Planted run: digest differs, the terminal block is `SHIP — Blocked` naming `gate:plan` as halted,
   and the op log carries **zero** `pr-create` operations — the run halted before any PR existed.
4. A canned outcome that disagrees with the recomputed digest verdict fails the check either way.

The same check also asserts byte-identity (`**Plan digest:**` = sha256 of the sibling plan) on every
other progress-bearing corpus snapshot, forbids progress marks in any other `02_plan.md`, and plants
an edit into a scratch copy of every such plan to prove the detector fires on each.

## Canned-vs-real disclosure

Both runs are **canned** (`arm.json` → `provenance`): Docker and `CLAUDE_CODE_OAUTH_TOKEN` are absent
here, the WF-345/346/347 constraint. What is *not* canned is the digest comparison — check 13
recomputes it from the committed bytes on every run, so an edit to either plan file changes the
verdict. `runner/run-skill.sh` regenerates the run bytes from a live container when one is available;
the assertion does not change.
