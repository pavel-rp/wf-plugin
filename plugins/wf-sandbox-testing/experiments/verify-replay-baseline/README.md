# verify-replay-baseline — replay the archived verify loops through today's rules (WF-564)

**Model:** claude-fable-5-1

**Status: canned baseline, buildable live arm.** The three corpus items this kit judges
(`corpus/items/verify-replay-wf552|wf553|wf554`) are verbatim transcriptions of real multi-round
`/wf:verify-spec` loops. The **baseline** in `results/baseline.json` is derived mechanically from
those records (verdict as recorded; blocking set and stop decision under today's documented
rules) and is disclosed as `provenance.path: canned` — no live replay ran where this kit was
authored (no Docker, no `CLAUDE_CODE_OAUTH_TOKEN`). Everything that can be checked without a
model **is** checked, deterministically, in CI (`corpus/run.sh` check 12 → `selfcheck.sh`).
Building the images and spending a live arm are **your** actions on a Docker-capable host.

**Why this kit exists.** The C033 charter changes the verify loop's rules — how findings
aggregate, what blocks, what the ledger holds, when `/wf:run` stops. A loop-rule change needs a
replayable corpus of *real* loops to show its effect on **before** an hours-long live verify run
is spent, and every later C033 SUB needs one fixed expectation to diff its own arm against. This
is that corpus and that expectation.

---

## What a round replay is

For one recorded round `N` of one task:

1. **Seed** a workload at the round's recorded commit (`seed-workspace.sh`, the engine's own step,
   with `wf` + `wf-fake` installed — `wf-fake` owns `delivery` and `tracker`, so no live host or
   tracker is reachable).
2. **Materialize** the round (`kit/materialize-round.sh`): the task folder the audit reads, the
   ledger the round saw (`04_verify.history.md` rebuilt from rounds `1..N-1`), and the
   **fixture capability** `verify-replay-fixture` — one static `verify | finding | inline:`
   contribution whose body is the round's recorded `## Capability findings`, registered in the
   seeded `_local/config.md`.
3. **Measure** one `claude -p "/wf:verify-spec <task>"` in the seeded workspace, in the same
   invocation shape as `engine/run-arm.sh`. The installed `verify-spec` aggregates the fixture's
   findings through its **real, unmodified** aggregation / blocking / ledger code, and because
   the contribution is `inline:`, **no lens agent, critic agent, or tracker operation is
   dispatched** — `experiment.json`'s mechanism signals assert that over the transcript.
4. **Read back** the fresh `04_verify.md` into a structured round record
   (`kit/extract-rounds.mjs --single`) and **judge** it (`kit/replay-check.mjs`): verdict,
   blocking set, stop decision, per round, against the baseline or against another arm.

The stop decision is `/wf:run` Phase 3's rule (PASS → `qa-gen`; FAIL/PARTIAL → `verify-fix`
while fewer than 2 verify⇄fix cycles are spent; then `halt`), derived per round from the loop's
own position in its recorded sequence. Every recorded loop ran past that cap — which is exactly
what the baseline shows, and what a later SUB's changed stop rule will move.

## Files

| Path | Role |
|---|---|
| `experiment.json` | the frozen v1 manifest: two arms (both at today's frozen ref — see "Adding an arm"), one compare, seven mechanism signals (fixture served; five lens dispatches absent; tracker writes absent), blinding vocabulary |
| `fake-scripts.json` | the scripted delivery/tracker reads a replayed round needs; `materialize-round.sh` re-points the branch / head reads from the round record and derives the changed-file set from the host repository's recorded base..commit range (plus any `--edits` set) per round into `generated/` |
| `kit/extract-rounds.mjs` | history → `rounds/round-NN.json` + `sequence.json` in the item, and the verbatim `round-NN.md` transcripts into the repo-level `corpus-archive/<item>/rounds/` (`--archive` / `$WF_CORPUS_ARCHIVE`) — the pack ships records only; `--single` reads one fresh report back |
| `kit/rule.mjs` | the one source of the verify⇄fix stop rule (cycle cap + its documented origin) that `derive-baseline.mjs` records and `replay-check.mjs` judges by |
| `kit/derive-baseline.mjs` | corpus records → `results/baseline.json`; `--check` proves the committed file is that derivation |
| `kit/materialize-round.sh` | lays one round into a seeded workspace (task folder, ledger, fixture, scripts; `--edits`, `--critic`) |
| `kit/replay-round.sh` | the live driver: seed → materialize → measure → read back, per round or `--all`; dry-run unless `--spend` |
| `kit/replay-check.mjs` | the judge: base vs against, per round, MATCH / DIVERGE / NOT-MEASURED; exit 1 on DIVERGE |
| `kit/fixture/verify-replay-fixture/` | the fixture capability (manifest + the fragment template) |
| `results/baseline.json` | today's per-round expectation, `provenance.path: canned` |
| `selfcheck.sh` | the kit's lint (manifest, files, fixture, baseline consistency, self-compare, blinding); CI-wired via `corpus/run.sh` |
| `Dockerfile` · `build-arm.sh` · `analyze.sh` · `runbooks/experiment.md` | the engine kit shape; the runbook is machine-derived (`run-experiment.sh --runbook`) |

## Running it

```sh
ROOT="$(git rev-parse --show-toplevel)"
K="$ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline"

bash "$K/selfcheck.sh"                                   # no spend: lint + baseline consistency + self-compare
node "$K/kit/replay-check.mjs" --against "$K/results/baseline.json"   # the self-compare, printed

# A live arm (billed; needs docker or a host with the claude CLI, a token, and the gitignored
# archive of the replayed tasks at _local/_archive/<task>/ or --task-src):
bash "$K/kit/replay-round.sh" --arm A --all                          # dry run: prints every command
bash "$K/kit/replay-round.sh" --arm A --all --spend                  # runs them
node "$K/kit/replay-check.mjs" --against "$K/results/arms/A" --against-label A
```

## Adding an arm (Journey 2 — a later SUB's branch)

Repoint `arms[1].wf_ref` in `experiment.json` at the SUB's branch ref, rebuild that arm's image
(`build-arm.sh`), replay it (`replay-round.sh --arm B --all --spend`), and compare **pairwise**:

```sh
node "$K/kit/replay-check.mjs" --base "$K/results/arms/A" --against "$K/results/arms/B" --base-label A --against-label B
```

The report names, per round, which of verdict / blocking-set size / stop decision diverged and
how. No manifest-shape change is needed: the second arm was declared from the start, pointing at
the baseline ref so that today it self-compares to zero divergence.

## Input hooks for later SUBs

- **Uncommitted edit set** — `materialize-round.sh --edits <patch>` applies a patch on top of the
  round's commit before the audit. WF-554 rounds 6–7 audited a dirty tree; without a patch the
  replay audits the commit alone and says so (a stated deviation, never silent). A SUB replaying
  a round ≥ 2 under a locally-modified `verify-spec`/`run` uses the same hook with a patch to the
  *installed* skill tree (the workload) — the arm's `wf_ref` still names the base.
- **Recorded critic stub** — `materialize-round.sh --critic <file>` attaches the file as a second
  `inline:` finding fragment of the same fixture capability, so a critic's recorded output enters
  the aggregation exactly like the lens findings do, with no live critic dispatch.

## Canned-vs-real disclosure

Every corpus round is a real audit. The baseline's *replay* is canned (derived, not run), and
says so in `results/baseline.json` `provenance`. A live arm written by `replay-round.sh` is real
and is judged by the same `replay-check.mjs`. A judge row the live arm did not produce is
reported **NOT-MEASURED**, never MATCH — the engine's honest-non-measurement rule.

## Boundaries this kit keeps

No file under `plugins/wf/` or `plugins/wf-audit/` is read at replay time except through the
installed plugin; no engine script is edited — the driver *composes* `seed-workspace.sh` with
its own overlay because `run-arm.sh` has no hook between seeding and measuring (raised here
rather than patched, per the task's "ask first" boundary). The kit writes only under a seeded
workspace, `generated/`, and `results/`.
