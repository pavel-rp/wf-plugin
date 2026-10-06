# Corpus item 19 — the empty-slot invariant, `research.publish`

**Model:** claude-opus-5-5
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `research.publish` (`plugins/wf/skills/research/interface.md` → `## Slots`; body marker in `research/SKILL.md` Phase 8)

## The invariant (the same C014 kill-criterion, applied to the research publish point)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no capability contributes `research.publish` and no `_local/slots/research.publish.md` or
`.wf/slots/research.publish.md` override exists, the point resolves to `{status: unfilled}` and
`/wf:research` runs its inline default at Phase 8: the research folder's artifacts and their index
rows are the pass's only outputs, no external record is opened, updated or annotated, no
`publication/` record is written, and **no operation of any kind** is emitted. The fixture resumes
a finished research folder at its Done state — the state that reaches Phase 8 without any web
fetch — with a `Not practical` verdict, since the slot publishes every finished verdict. If a
future edit to the slot machinery makes an unfilled slot leak behavior, this item diverges and
turns red.

## Per-family variance thresholds

Inherited unchanged from the flagship item's named spec-time decision
(`items/empty-slot-ship-review/item.md`) — the thresholds are a property of the assertion
families, not of the slot:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `RESEARCH — Complete` (with its `Warnings:` line unchanged) is the skill's contract with its caller; any variation is a regression. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | The Done-state resume writes nothing new; the folder's artifact set is stable, and a `publication/` file appearing is the seeded-fill signature, never the unfilled one. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The op *set* is empty — `research` has no delivery or tracker call site of its own. A record-creating op appearing across the set is a regression (the seeded-breakage case). |

The **governing ceiling** passed to `assert/compare.sh --max-variance` is **0.34**. Both sets
settle on a single signature per family with zero internal variance, so every family is
EQUIVALENT well inside even the stricter `terminal_block` threshold. These are **structural**
signatures — never a transcript exact-match.

## The baseline arm (owned and produced here)

`baseline/arm.json` records the pinned pre-slot build's fingerprint (`fp-preslot-research-3c9a57`)
and the per-run fingerprints of the baseline set. The arm is the pre-slot `research` build — the
one before the `research.publish` marker pair was introduced (WF-1077) — installed as the run
source.

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
assert/compare.sh --current items/empty-slot-research-publish/runs-current \
                  --baseline items/empty-slot-research-publish/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — a registered slot **fill** that publishes the findings
and verdict as a standalone record, marks it done, and records its identity in
`publication/research.publish.md`) compared against the same baseline → **DIVERGENT** on
`ops_invoked` (the `create_umbrella` / `set_status` writes appear) and on `files_touched`, which is
how the item turns red and names the family.
