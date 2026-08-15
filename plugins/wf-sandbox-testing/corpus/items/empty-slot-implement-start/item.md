# Corpus item 11 — the empty-slot invariant, `implement.start`

**Model:** claude-opus-5[1m]
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `implement.start` (`plugins/wf/skills/implement/interface.md` → `## Slots`; body marker in `implement/SKILL.md` Phase 1.5)

## The invariant (the same C014 kill-criterion, applied to the implement-start point)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no capability contributes `implement.start` and no personal `_local/slots/implement.start.md`
override exists, the point resolves to `{status: unfilled}` and `/wf:implement` runs its inline
default: execution simply begins. No external record is opened, updated or annotated, and **no
operation of any kind** is emitted at that point.

`implement.start` is the first of the three lifecycle points to fire, and it is the one that
*creates* an external record when filled. That makes it the sharpest unfilled-case assertion of
the three: the divergence is not a changed field on an existing record but the existence of a
record that the unfilled run never brings into being. The seeded arm therefore mints exactly one
child record and transitions it — the shape the registered fill uses.

## Per-family variance thresholds

Inherited unchanged from the flagship item's named spec-time decision
(`items/empty-slot-ship-review/item.md`) — the thresholds are a property of the assertion
families, not of the slot:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `IMPLEMENT — Complete` is the phase's contract with `verify-spec`, `commit` and `pr`; any variation is a regression, never benign drift. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | `implement` ticks the plan's checkboxes, appends the Resolution Summary, and refreshes the index row on top of the fixture's existing artifacts; the resulting file *set* is stable, but a benign index-row ordering outlier is drift, not divergence. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The op *set* is stable (`current-branch-query` alone — the Phase 1 branch gate's only read; `implement` performs no tracker call of its own). A record-creating op appearing across the set is a regression (the seeded-breakage case). |

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
assert/compare.sh --current items/empty-slot-implement-start/runs-current \
                  --baseline items/empty-slot-implement-start/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — a registered slot **fill** that opens an external child
record for the execution and moves both it and its umbrella into progress) compared against the
same baseline → **DIVERGENT** on `ops_invoked` (the `get` / `create_child` / `update` /
`set_status` writes appear), which is how the item turns red and names the family.
