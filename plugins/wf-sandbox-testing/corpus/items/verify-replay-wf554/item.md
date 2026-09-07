# Corpus item 17 — verify-replay: the WF-554 seven-round PARTIAL loop with a verify-fix pass

**Model:** claude-fable-5-1
**Kind:** round-replay (a recorded successive-round verify sequence, replayed through today's `verify-spec`/`run` and judged per round) · **Tier:** SMOKE
**Scenario:** `verify-replay-wf554` — seven consecutive `/wf:verify-spec WF-554` audits, all `PARTIAL` at **16/17 requirements** (one UNVERIFIABLE, accepted in scope), with one `/wf:verify-fix` pass between rounds 5 and 6 and the last two rounds auditing an **uncommitted** working-tree edit

## Provenance

**WF-554** — "Offer one explicit user gate when the revision cap is hit with blocking findings
left" (`feature/554-offer-one-explicit-user-gate-when-the`). The sources are that task's rotated
audit history, `_local/_archive/WF-554/04_verify.history.md`, and its rotated fix log,
`_local/_archive/WF-554/05_verify-fix.history.md`, transcribed verbatim into `rounds/` by
`experiments/verify-replay-baseline/kit/extract-rounds.mjs`. **WF-564** — the **C033** verify-loop
charter's baseline SUB — is the task that mined it. `_local/` is gitignored, so the source paths
resolve only on a machine holding that archive; the `rounds/` records are the committed copy.

## The recorded sequence

| Seq | Record | Audited at (UTC) | Commit | Tree | Verdict | Capability findings (FAIL / WARN) |
|---|---|---|---|---|---|---|
| 1 | round 1 | 2026-09-04 19:50 | `d045beb` | clean | PARTIAL (16/17) | 2 / 4 |
| 2 | round 2 | 2026-09-04 20:05 | `ba0351d` | clean | PARTIAL (16/17) | 1 / 3 |
| 3 | round 3 | 2026-09-04 20:13 | `84868d6` | clean | PARTIAL (16/17) | 1 / 2 |
| 4 | round 4 | 2026-09-04 20:36 | `bbbb06a` | clean | PARTIAL (16/17) | 1 / 4 |
| 5 | round 5 | 2026-09-04 21:10 | `55e292a` | clean | PARTIAL (16/17) | 1 / 2 |
| 6 | verify-fix after round 5 | 2026-09-05 | `55e292a` | clean at start | 1 auto-fixed · 0 awaiting · 3 skipped | — |
| 7 | round 6 | 2026-09-05 08:38 | `55e292a` | **dirty** (2 uncommitted files) | PARTIAL (16/17) | 1 / 5 |
| 8 | round 7 | 2026-09-05 08:52 | `55e292a` | **dirty** (2 uncommitted files) | PARTIAL (16/17) | 2 / 2 |

Three things make this the heaviest item of the three. The verdict never moved across seven
rounds while the blocking finding set kept changing shape — the loop was converging on findings,
not on requirements. A `verify-fix` pass sits inside the sequence, so the replay's stop rule
sees a genuine verify⇄fix cycle rather than back-to-back audits. And rounds 6–7 audited an
**uncommitted** edit on top of `55e292a`, which is the case the kit's optional uncommitted-edit-set
input exists for: replaying those rounds needs the working-tree diff the audit saw, not just the
commit.

## The invariant

For every audit round, replaying the recorded requirement verdicts and the recorded
`## Capability findings` block through today's `verify-spec` aggregation and blocking must yield
the recorded **verdict** (`PARTIAL`, 16/17, every round), the recorded **blocking set**, and —
through today's `run` stop rule — the recorded **stop decision**. The expectation is
`experiments/verify-replay-baseline/results/baseline.json`; the verify-fix record is carried in
`sequence.json` so the cycle count the stop rule reads is the one the loop actually ran.

## Canned-vs-real disclosure

`rounds/` is a **transcription of real audits and one real fix pass** produced by live runs on
2026-09-04/05 with the `audit` and `author-caps` capabilities registered. The **replay** of those
rounds through today's code is recorded canned — Docker plus `CLAUDE_CODE_OAUTH_TOKEN` were
unavailable where this item was mined — so `results/baseline.json` was derived mechanically from
these records and is disclosed as `provenance.path: canned` there. `replay-round.sh` regenerates
a live replay when a container is available (rounds 6–7 additionally need the recorded
uncommitted edit set); `replay-check.mjs` judges both the same way.

## Invocation

```
bash plugins/wf-sandbox-testing/corpus/run.sh
bash plugins/wf-sandbox-testing/experiments/verify-replay-baseline/selfcheck.sh
node plugins/wf-sandbox-testing/experiments/verify-replay-baseline/kit/derive-baseline.mjs --check
```
