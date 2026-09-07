# Corpus item 15 — verify-replay: the WF-552 five-round FAIL loop

**Model:** claude-fable-5-1
**Kind:** round-replay (a recorded successive-round verify sequence, replayed through today's `verify-spec`/`run` and judged per round) · **Tier:** SMOKE
**Scenario:** `verify-replay-wf552` — five consecutive `/wf:verify-spec WF-552` audits, every one ending `FAIL`, gated by capability findings rather than by any generic requirement from round 4 on

## Provenance

**WF-552** — "Freeze charter scope after round 1" (`feature/552-freeze-charter-scope-after-round-1`).
The source is that task's rotated audit history, `_local/_archive/WF-552/04_verify.history.md`
(the `04_verify.history.md` trail the shared pipeline conventions' artifact-rotation rule leaves
behind every re-audit), transcribed verbatim into `rounds/` (the structured `rounds/*.json` records ship in the pack; the verbatim `.md` transcripts live outside it, in the repo-level `corpus-archive/<item>/rounds/`) by
`experiments/verify-replay-baseline/kit/extract-rounds.mjs`. **WF-564** — "Replay the archived
verify histories as a regression corpus with a recorded baseline", the **C033** verify-loop charter's
baseline SUB, is the task that mined it. `_local/` is gitignored, so the source path resolves only on
a machine holding that archive; the `rounds/` records are the committed copy and carry every byte
the replay needs.

## The recorded sequence

| Round | Audited at (UTC) | Commit | Verdict | Requirements | Capability findings (FAIL / WARN) |
|---|---|---|---|---|---|
| 1 | 2026-09-04 15:05 | `d9bb9a5` | FAIL | 17/22 PASS · 4 FAIL · 1 UNVERIFIABLE | 7 / 3 |
| 2 | 2026-09-04 15:30 | `dbcf564` | FAIL | 19/22 PASS · 2 FAIL · 1 UNVERIFIABLE | 9 / 4 |
| 3 | 2026-09-04 15:40 | `262f555` | FAIL | 19/22 PASS · 2 PARTIAL · 1 UNVERIFIABLE | 6 / 4 |
| 4 | 2026-09-04 16:05 | `febf533` | FAIL | 21/22 PASS · 1 UNVERIFIABLE | 4 / 2 |
| 5 | 2026-09-04 16:14 | `2ae1037` | FAIL | 21/22 PASS · 1 UNVERIFIABLE | 4 / 3 |

Rounds 4 and 5 are the shape this item exists for: **every generic requirement passes** (one
UNVERIFIABLE, accepted in scope) and the verdict is `FAIL` **solely on capability findings** — the
aggregation and blocking rule, not the requirement audit, decided the round. The loop ran five
rounds against `/wf:run`'s stated two-cycle verify⇄fix cap, so the stop decision this item replays
is `halt` from round 3 on.

## The invariant

For every round `n`, replaying the round's recorded requirement verdicts and its recorded
`## Capability findings` block through today's `verify-spec` aggregation and blocking must yield
the recorded **verdict**, the recorded **blocking set** (the FAIL/PARTIAL requirements plus every
FAIL-severity finding), and — through today's `run` stop rule — the recorded **stop decision**.
The machine-readable expectation is `experiments/verify-replay-baseline/results/baseline.json`;
`rounds/round-NN.json` is the per-round input; `corpus-archive/verify-replay-wf552/rounds/round-NN.md` (repo-level, outside the pack) is the verbatim transcript.

## Canned-vs-real disclosure

`rounds/` is a **transcription of real audits** — every round was produced by a live
`/wf:verify-spec` run on 2026-09-04 with the `audit` and `author-caps` capabilities registered —
not a synthetic fixture. The **replay** of those rounds through today's code, however, is
recorded canned: real containerized replays need Docker plus `CLAUDE_CODE_OAUTH_TOKEN`, unavailable
where this item was mined, so `results/baseline.json` was derived mechanically from these records
(`derive-baseline.mjs`) and is disclosed as `provenance.path: canned` there. The kit's
`replay-round.sh` regenerates a live per-round replay when a container is available; the judging
machinery (`replay-check.mjs`) is identical either way.

## Invocation

```
bash plugins/wf-sandbox-testing/corpus/run.sh                                 # the corpus check (lints this item's records)
bash plugins/wf-sandbox-testing/experiments/verify-replay-baseline/selfcheck.sh # the kit's own lint + baseline consistency
node plugins/wf-sandbox-testing/experiments/verify-replay-baseline/kit/derive-baseline.mjs --check
```
