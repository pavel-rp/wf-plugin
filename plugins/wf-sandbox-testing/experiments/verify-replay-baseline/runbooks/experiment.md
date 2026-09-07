# verify-replay-baseline — runbook

**Derived from:** `experiment.json`
**Derived by:** `run-experiment.sh --runbook` (machine-derived — do not hand-edit)

The ordered command document for this experiment: build, then one gate per arm, then one
measured run per arm, then the analysis. Commands are shown in manifest declaration order;
at execution time the gate and measured phases shuffle arm order, which is a protocol
requirement and does not change any command below.

**Running this is a human decision.** The measured phase is billed. Nothing here has been
executed: this document was derived offline, without Docker, without egress, without spend.

Every path below is anchored on `$ROOT`. Set it once, in the shell you run these from:

```sh
ROOT="$(git rev-parse --show-toplevel)"
```

Arms (2), each identified by its own frozen ref:

| Arm | `wf_ref` | Image |
|---|---|---|
| `A` | `346baf0` | `verify-replay-baseline:armA` |
| `B` | `346baf0` | `verify-replay-baseline:armB` |

---

## 1. Build

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/build-arm.sh --both --wf-ref-a 346baf0 --wf-ref-b 346baf0 --cli-version 2.1.218 
```

## 2. Gate (cheap — prove the seed+container path per arm before any spend)

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/results/gate-A:/work/run-output verify-replay-baseline:armA --measured-fleet --arm A --workload-ref 346baf0 --fake-scripts fake-scripts.json --packs wf\ wf-fake --gate-skill /wf:triage\ WF-554 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/results/gate-B:/work/run-output verify-replay-baseline:armB --measured-fleet --arm B --workload-ref 346baf0 --fake-scripts fake-scripts.json --packs wf\ wf-fake --gate-skill /wf:triage\ WF-554 
```

## 3. Measured run — BILLED, ask first

One run per arm, order shuffled, at least 60 seconds apart, same host, same day.

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/results/run-A:/work/run-output verify-replay-baseline:armA --measured-fleet --arm A --workload-ref 346baf0 --fake-scripts fake-scripts.json --packs wf\ wf-fake --umbrella-id WF-554 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/results/run-B:/work/run-output verify-replay-baseline:armB --measured-fleet --arm B --workload-ref 346baf0 --fake-scripts fake-scripts.json --packs wf\ wf-fake --umbrella-id WF-554 
```

## 4. Analyze (offline, host-side, free)

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/analyze.sh --run-a $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/results/run-A --run-b $ROOT/plugins/wf-sandbox-testing/experiments/verify-replay-baseline/results/run-B 
```

## Declared comparisons

| Base | Against | Reported as |
|---|---|---|
| `A` | `B` | `B` minus `A` |
