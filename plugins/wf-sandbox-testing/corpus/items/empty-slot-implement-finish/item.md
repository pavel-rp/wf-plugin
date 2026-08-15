# Corpus item 13 — the empty-slot invariant, `implement.finish`

**Model:** claude-opus-5[1m]
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `implement.finish` (`plugins/wf/skills/implement/interface.md` → `## Slots`; body marker in `implement/SKILL.md` Phase 5.5)

## The invariant (the same C014 kill-criterion, applied to the implement-finish point)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no capability contributes `implement.finish` and no personal
`_local/slots/implement.finish.md` override exists, the point resolves to `{status: unfilled}` and
`/wf:implement` runs its inline default: execution simply ends. No external record is opened,
updated or annotated, and **no operation of any kind** is emitted before the completion report.

## The hazard this point carries: it fires mid-conveyor, not at the end of it

`implement.finish` sits at the *phase* boundary, not the *task* boundary — `verify-spec`, `qa`,
`pr` and the finalize phase all still lie ahead. A fill here therefore has to move an external
record to a **non-terminal** state and leave the terminal transition to whatever runs last. The
unfilled case is the clean control for that: it emits nothing at all, so a run that reaches this
point and terminates an external record is unambiguously the fill's doing and not the phase's.

The seeded arm reflects exactly that shape — it consolidates the execution record and moves it to
a **non-terminal** review state, never a terminal one — so the divergence it produces is the
divergence a real fill would produce, not a louder stand-in.

## Per-family variance thresholds

Inherited unchanged from the flagship item's named spec-time decision
(`items/empty-slot-ship-review/item.md`) — the thresholds are a property of the assertion
families, not of the slot:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `IMPLEMENT — Complete` is the phase's contract with `verify-spec`, `commit` and `pr`; any variation is a regression, never benign drift. This point sits immediately before the completion report, so it is the one most able to perturb that block — hence zero tolerance. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | `implement` ticks the plan's checkboxes, appends the Resolution Summary, and refreshes the index row on top of the fixture's existing artifacts; the resulting file *set* is stable, but a benign index-row ordering outlier is drift, not divergence. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The op *set* is stable (`current-branch-query` alone). A record-updating or state-transitioning op appearing across the set is a regression (the seeded-breakage case). |

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
assert/compare.sh --current items/empty-slot-implement-finish/runs-current \
                  --baseline items/empty-slot-implement-finish/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — a registered slot **fill** that consolidates the
execution record and moves it, plus its umbrella, to a non-terminal review state) compared against
the same baseline → **DIVERGENT** on `ops_invoked` (the `get` / `update` / `set_status` writes
appear), which is how the item turns red and names the family.
