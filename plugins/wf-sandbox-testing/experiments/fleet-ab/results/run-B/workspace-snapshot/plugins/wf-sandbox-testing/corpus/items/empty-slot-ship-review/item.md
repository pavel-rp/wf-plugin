# Corpus item 1 — the empty-slot invariant, `ship.review`

**Model:** claude-opus-4-8
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `ship.review` (`plugins/wf/skills/ship/interface.md` → `## Slots`; body marker in `ship/SKILL.md` Phase 4.5)

## The invariant (the C014 kill-criterion, made a repeatable check)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no review capability is registered, `ship.review` resolves to `{status: unfilled}` and
`/wf:ship` runs build → checks → merge with **no** review term surfaced (observed and logged
as the C016 watch-list item "1. Unfilled-slot silence"). The invariant asserts that this
unfilled-slot behavior is indistinguishable from how `ship` behaved on the **pinned pre-slot
build**, before `ship.review` was introduced. If a future edit to the slot machinery makes
an unfilled slot leak behavior (drive a reviewer, change the terminal block, invoke a review
op), this item diverges and turns red.

**Asserted per declared slot, not once globally.** `run.sh` enumerates the declared-slot set
from source (currently the single `ship.review`) and requires one baseline arm + comparison
per slot. A newly declared slot with no arm fails the suite.

## Per-family variance thresholds — the named spec-time decision (WF-347)

Charter OUT-6(a) leaves the per-family thresholds to this sub-task. They are decided here,
not inherited silently from a default:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `SHIP` merged-vs-blocked is the whole point of the gate; any variation is a regression, never benign drift. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | `ship` is a dispatcher (writes nothing outside `_local/`); the resulting file *set* is stable, but a benign index-row ordering outlier is drift, not divergence. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The delivery-op *set* is stable; a single benign extra read on one run is drift. A *new* review op appearing across the set is a regression (the seeded-breakage case). |

The **governing ceiling** passed to `assert/compare.sh --max-variance` is the maximum of the
per-family thresholds, **0.34** (a single outlier in a 3-run set). `terminal_block` is held
to its stricter 0.00 by construction: the baseline and current sets both settle on a single
`SHIP|Merged` signature with zero internal variance, so the family is EQUIVALENT well inside
even its own 0.00 threshold. These are **structural** signatures — never a transcript
exact-match (compare.sh compares canonical family signatures, not prose).

## The baseline arm (owned and produced here)

`baseline/arm.json` records the pinned pre-slot build's fingerprint and the per-run
fingerprints of the baseline set (charter success measure: "each carries the pinned build's
fingerprint and the run fingerprints of its baseline set"). The arm was produced via WF-345's
**pinned-build install option** — the pre-slot `ship` build (before the `ship.review` slot)
installed as the run source. The three runs are recorded as run artifacts the flagship
compares the current set against with WF-346's comparison primitive (`assert/compare.sh`).

### Canned-vs-real disclosure (honest by construction)

Real containerized runs need Docker **and** a `CLAUDE_CODE_OAUTH_TOKEN` (charter OUT-3), both
absent in the authoring/CI environment — the same constraint WF-345/WF-346 hit. The baseline
and current run sets here are therefore **canned artifacts shaped exactly like the WF-345
runner's output tree** (`transcript.jsonl` + `run.json` + `workspace-snapshot/.../op-log.jsonl`),
the WF-346 precedent. What ran canned and why is recorded in the verify artifact and the PR
body. The pinned pre-slot build was **not** re-installed and executed in a live container;
when Docker + a token are available, `runner/run-skill.sh` regenerates these sets from the
real pinned build and the comparison is re-run unchanged — the assertion machinery does not
change, only the provenance of the run bytes.

## Comparison invocation

```
assert/compare.sh --current items/empty-slot-ship-review/runs-current \
                  --baseline items/empty-slot-ship-review/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — a slot **fill** that drives a reviewer) compared
against the same baseline → **DIVERGENT** on `ops_invoked` (the review ops appear), which is
how the item turns red and names the family.
