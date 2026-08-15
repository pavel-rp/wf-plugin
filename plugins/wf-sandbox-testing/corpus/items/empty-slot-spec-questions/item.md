# Corpus item 7 — the empty-slot invariant, `spec.questions`

**Model:** claude-opus-5[1m]
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `spec.questions` (`plugins/wf/skills/spec/interface.md` → `## Slots`; body marker in `spec/SKILL.md` Phase 2 step 2)

## The invariant (the same C014 kill-criterion, applied to a second slot)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no capability contributes `spec.questions` and no personal `_local/slots/spec.questions.md`
override exists, the point resolves to `{status: unfilled}` and `/wf:spec` runs its inline
default: the run's open questions stay local and are carried straight into the interactive
prompt, with **no operation of any kind** emitted. The invariant asserts that this unfilled-slot
behavior is indistinguishable from how `spec` behaved on the **pinned pre-slot build**, before
the composition point existed. If a future edit to the slot machinery makes an unfilled slot
leak behavior (emit a comment, change the terminal block, surface a publish term), this item
diverges and turns red.

**Asserted per declared slot, not once globally.** `run.sh` enumerates the declared-slot set
from source and requires one baseline arm + comparison per slot; the two `spec` slots each own
their own arm rather than sharing the `ship.review` one.

## Per-family variance thresholds

Inherited unchanged from the flagship item's named spec-time decision
(`items/empty-slot-ship-review/item.md`) — the thresholds are a property of the assertion
families, not of the slot:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `SPEC — Complete` is the phase's contract with the next phase; any variation is a regression, never benign drift. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | `spec` writes `00_reqs.md`, `01_spec.md` and the index row and nothing else; the resulting file *set* is stable, but a benign index-row ordering outlier is drift, not divergence. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The op *set* is stable (`current-branch-query` + the tracker `get`); a single benign extra read on one run is drift. A *publish* op appearing across the set is a regression (the seeded-breakage case). |

The **governing ceiling** passed to `assert/compare.sh --max-variance` is **0.34**, the maximum
of the per-family thresholds. Both sets here settle on a single signature per family with zero
internal variance, so every family is EQUIVALENT well inside even the stricter `terminal_block`
threshold. These are **structural** signatures — never a transcript exact-match.

## The baseline arm (owned and produced here)

`baseline/arm.json` records the pinned pre-slot build's fingerprint (`fp-preslot-spec-b4d7e1`)
and the per-run fingerprints of the baseline set. The arm is the pre-slot `spec` build — the
one before the `spec.questions` marker pair was introduced — installed as the run source.

### Canned-vs-real disclosure (honest by construction)

Real containerized runs need Docker **and** a `CLAUDE_CODE_OAUTH_TOKEN`, both absent in the
authoring/CI environment — the same constraint WF-345/WF-346/WF-347 hit. The baseline, current
and seeded run sets here are therefore **canned artifacts shaped exactly like the WF-345
runner's output tree** (`transcript.jsonl` + `run.json` + `workspace-snapshot/.../op-log.jsonl`),
following the flagship item's precedent. The pinned pre-slot build was **not** re-installed and
executed in a live container; when Docker and a token are available, `runner/run-skill.sh`
regenerates these sets from the real pinned build and the comparison is re-run unchanged — the
assertion machinery does not change, only the provenance of the run bytes.

## Comparison invocation

```
assert/compare.sh --current items/empty-slot-spec-questions/runs-current \
                  --baseline items/empty-slot-spec-questions/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — a registered slot **fill** that publishes the open
questions as a tracker comment) compared against the same baseline → **DIVERGENT** on
`ops_invoked` (the `post_comment` write appears), which is how the item turns red and names the
family.
