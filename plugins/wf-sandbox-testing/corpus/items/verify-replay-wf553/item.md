# Corpus item 16 — verify-replay: the WF-553 four-round PARTIAL loop

**Model:** claude-fable-5-1
**Kind:** round-replay (a recorded successive-round verify sequence, replayed through today's `verify-spec`/`run` and judged per round) · **Tier:** SMOKE
**Scenario:** `verify-replay-wf553` — four consecutive `/wf:verify-spec WF-553` audits, every one ending `PARTIAL` with **every generic requirement passing** and one to two capability `FAIL` findings carrying the verdict

## Provenance

**WF-553** — the charter-artifact size-budget task (`feature/553-wf-553`: per-`SUB-n`-block and
total-line budgets for `02_subtasks.md` and `01_charter.md`, with the reviewer's overrun check).
The source is that task's rotated audit history, `_local/_archive/WF-553/04_verify.history.md`,
transcribed verbatim into `rounds/` (the structured `rounds/*.json` records ship in the pack; the verbatim `.md` transcripts live outside it, in the repo-level `corpus-archive/<item>/rounds/`) by `experiments/verify-replay-baseline/kit/extract-rounds.mjs`.
**WF-564** — the **C033** verify-loop charter's baseline SUB — is the task that mined it. `_local/`
is gitignored, so the source path resolves only on a machine holding that archive; the `rounds/`
records are the committed copy.

## The recorded sequence

| Round | Audited at (UTC) | Commit | Verdict | Requirements | Capability findings (FAIL / WARN) |
|---|---|---|---|---|---|
| 1 | 2026-09-04 17:41 | `8151ce4` | PARTIAL | header only — see below | header only |
| 2 | 2026-09-04 18:04 | `89e74d9` | PARTIAL | 22/23 PASS · 1 N/A | 2 / 3 |
| 3 | 2026-09-04 18:23 | `c2c1a0c` | PARTIAL | 22/23 PASS · 1 N/A | 2 / 1 |
| 4 | 2026-09-04 18:32 | `158ab1b` | PARTIAL | 22/23 PASS · 1 N/A | 1 / 3 |

**Round 1 is header-only at the source.** The `/wf:verify-spec` run that rotated the history on
2026-09-04T18:23Z recorded a tooling error in its own note: it truncated the pre-existing history
tail, leaving round 1's header (branch, commit, tree, verdict `PARTIAL (22/22 requirements; 1
capability FAIL, 6 capability WARN)`, audited-at) but no `## Requirements` or `## Capability
findings` body. The record carries `body_truncated: true` and the verdict line's own tallies;
nothing is reconstructed. The replay **skips** round 1 with that flag as its stated reason, and the
corpus lint accepts an empty requirement list **only** under this flag.

This item's distinctive shape is a `PARTIAL` that no generic requirement produces: rounds 2–4 have
22 PASS and 1 N/A, and the verdict is `PARTIAL` because capability `FAIL` findings were aggregated
in — the same "findings decide the round" path as `verify-replay-wf552`, but landing on `PARTIAL`
rather than `FAIL`. That difference is exactly the aggregation-rule surface a later C033 SUB may
change, which is why both items are in the corpus.

## The invariant

For every round with a body, replaying the recorded requirement verdicts and the recorded
`## Capability findings` block through today's `verify-spec` aggregation and blocking must yield
the recorded **verdict**, the recorded **blocking set**, and — through today's `run` stop rule —
the recorded **stop decision** (`verify-fix` for rounds 1–2, `halt` from round 3 on, under the
two-cycle cap). The expectation is `experiments/verify-replay-baseline/results/baseline.json`.

## Canned-vs-real disclosure

`rounds/` is a **transcription of real audits** produced by live `/wf:verify-spec` runs on
2026-09-04 with the `audit` and `author-caps` capabilities registered. The **replay** of those
rounds through today's code is recorded canned — Docker plus `CLAUDE_CODE_OAUTH_TOKEN` were
unavailable where this item was mined — so `results/baseline.json` was derived mechanically from
these records and is disclosed as `provenance.path: canned` there. `replay-round.sh` regenerates
a live replay when a container is available; `replay-check.mjs` judges both the same way.

## Invocation

```
bash plugins/wf-sandbox-testing/corpus/run.sh
bash plugins/wf-sandbox-testing/experiments/verify-replay-baseline/selfcheck.sh
node plugins/wf-sandbox-testing/experiments/verify-replay-baseline/kit/derive-baseline.mjs --check
```
