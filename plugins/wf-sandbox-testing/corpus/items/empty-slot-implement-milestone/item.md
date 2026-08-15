# Corpus item 12 — the empty-slot invariant, `implement.milestone` (the first `append` point)

**Model:** claude-opus-5[1m]
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `implement.milestone` (`plugins/wf/skills/implement/interface.md` → `## Slots`; body marker in `implement/SKILL.md` Phase 2.5)

## The invariant (the same C014 kill-criterion, applied to the implement-milestone point)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no capability contributes `implement.milestone` and no personal
`_local/slots/implement.milestone.md` override exists, the point resolves to `{status: unfilled}`
and `/wf:implement` runs its inline default at every checkpoint: the checkpoint is reached and
execution continues. No external record is opened, updated or annotated, and **no operation of any
kind** is emitted. The plan's own checkboxes and step notes remain the run's only progress record.

## What makes this item different from the five `replace` items

`implement.milestone` is the charter's **only `append`-policy composition point**. The four
earlier empty-slot items (`ship.review`, `spec.questions`, `spec.publish`, `plan.publish`,
`tasks.publish`) and its sibling `implement.start` / `implement.finish` are all `replace`: the
single highest-precedence body supersedes the inline default wholesale, so a seeded fill has
exactly one author. Under `append` the resolver concatenates **every** contribution in **registry
order**, with any personal `_local/` override last, and the inline default kept as the first part.

That difference is what this item's seeded arm asserts, and it is a materially different assertion
from the `replace` items:

1. **Every contributor runs — none is selected away.** The seeded set registers **two**
   contributors to the same point and both appear. A `replace`-shaped regression would leave only
   the last one standing; the seeded op log would then be half its length.
2. **Registry order is preserved.** The seeded op log's `seq` ordering is the general-to-specific
   registry order (`cap-general` before `cap-specific`) at **every** checkpoint, never interleaved
   and never reversed.
3. **The point fires repeatedly.** `implement.milestone` is reached once per plan step plus at the
   four fixed boundaries, so the seeded run emits a *thread* of entries, not a single write. The
   unfilled case must emit **zero**, not "fewer than the fill would".

**Honest scope of the mechanical assertion.** `assert/compare.sh`'s `ops_invoked` signature is the
*sorted, unique* `surface:op` set, so it is order-insensitive **by construction** — it names the
family that diverged, it does not itself rank the contributors. The ordering and
both-contributors-present evidence is carried by the seeded arm's own `op-log.jsonl`: `seq` order
plus the `contributor` argument on each entry, which a reader (and any future order-aware family)
checks directly. Nothing here claims a mechanical ordering assertion the harness does not make.

## Per-family variance thresholds

Inherited unchanged from the flagship item's named spec-time decision
(`items/empty-slot-ship-review/item.md`) — the thresholds are a property of the assertion
families, not of the slot:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `IMPLEMENT — Complete` is the phase's contract with `verify-spec`, `commit` and `pr`; any variation is a regression, never benign drift. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | `implement` ticks the plan's checkboxes, appends the Resolution Summary, and refreshes the index row on top of the fixture's existing artifacts; the resulting file *set* is stable, but a benign index-row ordering outlier is drift, not divergence. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The op *set* is stable (`current-branch-query` alone). An annotation op appearing across the set is a regression (the seeded-breakage case) — and under `append` it appears once per contributor per checkpoint, which is why the seeded log is a thread rather than a single entry. |

The **governing ceiling** passed to `assert/compare.sh --max-variance` is **0.34**. Both sets
here settle on a single signature per family with zero internal variance, so every family is
EQUIVALENT well inside even the stricter `terminal_block` threshold. These are **structural**
signatures — never a transcript exact-match.

## The baseline arm (owned and produced here)

`baseline/arm.json` records the pinned pre-slot build's fingerprint (`fp-preslot-implement-a31f74`)
and the per-run fingerprints of the baseline set. The arm is the pre-slot `implement` build — the
one before the three lifecycle marker pairs were introduced — installed as the run source. The
three `implement` points each own a separate arm even though all three markers landed in the same
change, because the enumeration asserts **per declared slot**, never once per change.

### Canned-vs-real disclosure (honest by construction)

Real containerized runs need Docker **and** a `CLAUDE_CODE_OAUTH_TOKEN`, both absent in the
authoring/CI environment — the same constraint WF-345/WF-346/WF-347 hit and WF-406/WF-407
recorded. The baseline, current and seeded run sets here are therefore **canned artifacts shaped
exactly like the WF-345 runner's output tree** (`transcript.jsonl` + `run.json` +
`workspace-snapshot/.../op-log.jsonl`), following the flagship item's precedent. The pinned
pre-slot build was **not** re-installed and executed in a live container; when Docker and a token
are available, `runner/run-skill.sh` regenerates these sets from the real pinned build and the
comparison is re-run unchanged — the assertion machinery does not change, only the provenance of
the run bytes.

## Comparison invocation

```
assert/compare.sh --current items/empty-slot-implement-milestone/runs-current \
                  --baseline items/empty-slot-implement-milestone/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — **two** registered contributions to the same `append`
point, each annotating the external record at every checkpoint) compared against the same baseline
→ **DIVERGENT** on `ops_invoked` (the annotation writes appear), which is how the item turns red
and names the family. The seeded log's `seq`+`contributor` ordering is the registry-order evidence
described above.
