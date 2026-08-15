# Corpus item 9 — the empty-slot invariant, `plan.publish`

**Model:** claude-opus-5[1m]
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `plan.publish` (`plugins/wf/skills/plan/interface.md` → `## Slots`; body marker in `plan/SKILL.md` Phase 3)

## The invariant (the same C014 kill-criterion, applied to the plan-publish point)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no capability contributes `plan.publish` and no personal `_local/slots/plan.publish.md`
override exists, the point resolves to `{status: unfilled}` and `/wf:plan` runs its inline
default: `02_plan.md` and the per-task index row are the run's only outputs, no external record
is opened, updated or annotated, and **no operation of any kind** is emitted. Like
`spec.publish`, this slot's fill performs *creating* writes, so the unfilled case must stay
provably silent. If a future edit to the slot machinery makes an unfilled slot leak behavior
(mint a record, change the terminal block, surface a publish term), this item diverges and turns
red.

## Per-family variance thresholds

Inherited unchanged from the flagship item's named spec-time decision
(`items/empty-slot-ship-review/item.md`) — the thresholds are a property of the assertion
families, not of the slot:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `PLAN — Complete` is the phase's contract with the next phase; any variation is a regression, never benign drift. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | `plan` writes `02_plan.md` and the index row on top of the fixture's existing `00_reqs.md`/`01_spec.md` and nothing else; the resulting file *set* is stable, but a benign index-row ordering outlier is drift, not divergence. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The op *set* is stable (`current-branch-query` alone — `plan` performs no tracker read of its own); a single benign extra read on one run is drift. A record-creating op appearing across the set is a regression (the seeded-breakage case). |

The **governing ceiling** passed to `assert/compare.sh --max-variance` is **0.34**. Both sets
here settle on a single signature per family with zero internal variance, so every family is
EQUIVALENT well inside even the stricter `terminal_block` threshold. These are **structural**
signatures — never a transcript exact-match.

## The baseline arm (owned and produced here)

`baseline/arm.json` records the pinned pre-slot build's fingerprint (`fp-preslot-plan-a91c33`)
and the per-run fingerprints of the baseline set. The arm is the pre-slot `plan` build — the one
before the `plan.publish` marker pair was introduced — installed as the run source. `plan` and
`tasks` each own a separate arm even though both markers landed in the same change, because the
enumeration asserts **per declared slot**, never once per change.

### Canned-vs-real disclosure (honest by construction)

Real containerized runs need Docker **and** a `CLAUDE_CODE_OAUTH_TOKEN`, both absent in the
authoring/CI environment — the same constraint WF-345/WF-346/WF-347 hit and WF-406 recorded. The
baseline, current and seeded run sets here are therefore **canned artifacts shaped exactly like
the WF-345 runner's output tree** (`transcript.jsonl` + `run.json` +
`workspace-snapshot/.../op-log.jsonl`), following the flagship item's precedent. The pinned
pre-slot build was **not** re-installed and executed in a live container; when Docker and a token
are available, `runner/run-skill.sh` regenerates these sets from the real pinned build and the
comparison is re-run unchanged — the assertion machinery does not change, only the provenance of
the run bytes.

## Comparison invocation

```
assert/compare.sh --current items/empty-slot-plan-publish/runs-current \
                  --baseline items/empty-slot-plan-publish/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — a registered slot **fill** that publishes the plan as a
child artifact record and marks it done) compared against the same baseline → **DIVERGENT** on
`ops_invoked` (the `get` / `create_child` / `update` / `set_status` writes appear), which is how
the item turns red and names the family.
