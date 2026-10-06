# Corpus item 20 — the empty-slot invariant, `qa-gen.publish`

**Model:** claude-opus-5-5
**Kind:** comparison (per declared slot) · **Tier:** SMOKE
**Declared slot:** `qa-gen.publish` (`plugins/wf/skills/qa-gen/interface.md` → `## Slots`; body marker in `qa-gen/SKILL.md` Phase 5 step 3)

## The invariant (the same C014 kill-criterion, applied to the QA-plan publish point)

> For each declared slot, an **unfilled** slot yields behavior **equivalent** to the
> **pre-slot baseline** — where "equivalent" means *statistically indistinguishable on the
> structural assertion families* (terminal-block shape, files touched, contract ops invoked)
> under the N-run variance protocol — **never** a transcript exact-match.

When no capability contributes `qa-gen.publish` and no `_local/slots/qa-gen.publish.md` or
`.wf/slots/qa-gen.publish.md` override exists, the point resolves to `{status: unfilled}` and
`/wf:qa-gen` runs its inline default: `06_qa.md`, its index row and its phase receipt are the
run's only outputs, no external record is opened, updated or annotated, no `publication/` record
is written, and **no operation of any kind** is emitted. The fill this slot admits performs
*creating* writes and records an identity file, so the unfilled case must stay provably silent.
If a future edit to the slot machinery makes an unfilled slot leak behavior (mint a record, write
a publication record, change the terminal block), this item diverges and turns red.

## Per-family variance thresholds

Inherited unchanged from the flagship item's named spec-time decision
(`items/empty-slot-ship-review/item.md`) — the thresholds are a property of the assertion
families, not of the slot:

| Family | Threshold (max fraction of runs off the modal signature) | Rationale |
|--------|----------------------------------------------------------|-----------|
| `terminal_block` | **0.00** — zero drift tolerated | An unfilled slot must not change the terminal block. `QA-GEN — Complete` is the phase's contract with the QA run-assistants; any variation is a regression. |
| `files_touched` | **0.34** — one outlier in a 3-run set tolerated | `qa-gen` writes `06_qa.md` and the index row on top of the fixture's existing artifacts and nothing else; a `publication/` file appearing is the seeded-fill signature, never the unfilled one. |
| `ops_invoked` | **0.34** — one outlier in a 3-run set tolerated | The op *set* is stable (`current-branch-query` alone — `qa-gen` has no tracker call site); a record-creating op appearing across the set is a regression (the seeded-breakage case). |

The **governing ceiling** passed to `assert/compare.sh --max-variance` is **0.34**. Both sets
settle on a single signature per family with zero internal variance, so every family is
EQUIVALENT well inside even the stricter `terminal_block` threshold. These are **structural**
signatures — never a transcript exact-match.

## The baseline arm (owned and produced here)

`baseline/arm.json` records the pinned pre-slot build's fingerprint (`fp-preslot-qagen-7e2b14`)
and the per-run fingerprints of the baseline set. The arm is the pre-slot `qa-gen` build — the one
before the `qa-gen.publish` marker pair was introduced (WF-1077) — installed as the run source.

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
assert/compare.sh --current items/empty-slot-qa-gen-publish/runs-current \
                  --baseline items/empty-slot-qa-gen-publish/baseline/runs \
                  --max-variance 0.34
# → Comparison verdict: EQUIVALENT   (each family EQUIVALENT: same modal signature, variance within threshold)
```

Seeded breakage (`seeded-breakage/runs` — a registered slot **fill** that publishes `06_qa.md` as a
child record, marks it done, and records its identity in `publication/qa-gen.publish.md`) compared
against the same baseline → **DIVERGENT** on `ops_invoked` (the `get` / `create_child` /
`set_status` writes appear) and on `files_touched` (the publication record appears), which is how
the item turns red and names the family.
