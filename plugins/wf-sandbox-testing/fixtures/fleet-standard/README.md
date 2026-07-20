# WF-373 fleet-standard fixture

`fleet-standard` is the disposable one-task fleet measurement fixture. It retains the orchestration shape needed for later WF-372 before/after comparisons without reusing a shipped repository or contacting a real tracker, delivery host, or remote repository.

## Fixture contract

The immutable definition is [`project.seed.json`](project.seed.json):

- umbrella `FLEET-100` has exactly one child, `FLEET-101`;
- the child changes the one-line target `src/counter.txt` from `0` to `1`;
- the exact invocation is `/wf:fleet FLEET-100 --max-parallel 1`;
- `fake` is the sole tracker and delivery provider;
- `audit` registers the correctness, security, convention, consistency, and operational verify lenses;
- every provider response is committed synthetic data, and every URL uses inert `fake.local` data;
- the repository is local-only and has no remote.

Each execution must retain the main fleet orchestrator, an isolated shipper, the complete `spec → plan → tasks → implement → verify → qa` `/wf:run` spine, `/wf:ship` gate clearing, and the registered audit roles. Publication is rejected unless the accounted evidence contains that phase and role shape and the required fake-operation shape.

This fixture intentionally reduces the historical fleet to one child, fixes parallelism at one, replaces remote operations with scripts, has no real remote, uses a tiny implementation, and therefore targets lower absolute spend. It is shape-comparable, not workload- or dollar-equivalent.

## Offline commands

These commands never invoke Claude and are safe for CI:

```bash
plugins/wf-sandbox-testing/fixtures/fleet-standard/run.sh --selfcheck
plugins/wf-sandbox-testing/fixtures/fleet-standard/run.sh --seed /tmp/wf-fleet-standard-seed
```

`--seed` refuses an existing boundary. It creates fresh `plugin-home/`, `config-home/`, `workspace/`, and `output/` directories, reconstructs the workspace from `project.seed.json`, initializes deterministic local-only git history, copies unconsumed fake scripts, and deliberately leaves `_local/fake/op-log.jsonl` absent.

`--selfcheck` seeds two distinct boundaries, contaminates the first with a branch, archived task, scoreboard, consumed scripts, and prior operation log, then proves the second remains clean and has the same clean-start fingerprint. It also validates the one-child, fake-only, serial, audit, and reference contracts.

## Explicit paid reference run

The live command makes model calls and is never run by CI or by an offline check. It requires an explicit billing acknowledgement:

```bash
WF_FLEET_STANDARD_ALLOW_PAID=1 \
  plugins/wf-sandbox-testing/fixtures/fleet-standard/run.sh --live \
  --out /tmp/wf-fleet-standard-reference
```

The driver performs two sequential runner invocations. The runner supplies a fresh Claude config/plugin install and workspace for each invocation; the fixture supplies fresh local git, task inputs, scripts, and absent operation log. The driver then:

1. accounts each complete `session-evidence/` bundle with `account-session.sh`;
2. requires sequence numbers to start at one and rejects `__UNSCRIPTED__` operations;
3. requires identical provider-operation sequences and final artifact inventories;
4. verifies scripts were not consumed or modified;
5. checks fleet, ship, run-phase, phase-runner, and all five audit roles;
6. writes derived figures only to `reference.candidate.json` under the chosen output directory.

The driver never overwrites committed [`reference.json`](reference.json). Review a candidate and replace the committed reference only when `comparability.accepted` is true. The reference is deliberately task-specific (`fleet-standard-WF-373` / `WF-373`) and its seed and session fingerprints must not be reused for another fixture. Until an authorized paid run passes, the committed reference remains honestly `unpublished` with `figures: null`; no figures are guessed.

## Failure triage

- **Clean fingerprints differ:** inspect `project.seed.json` and deterministic git metadata; do not weaken normalization to hide mutable state.
- **Operation sequences differ or an operation is unscripted:** fix the committed fake response set or the workflow divergence before publishing.
- **Accounting fails:** retain the machine-local run output and repair missing/corrupt main or nested evidence; never commit transcript JSONL.
- **Phase or role shape fails:** treat the candidate as non-comparable. Do not publish costs from a run that skipped fleet, ship, a run phase, phase isolation, or a claimed audit lens.
- **Quota or model failure:** the runner stops without a candidate. Re-run explicitly after the subscription window resets; never silently continue with an API key.
