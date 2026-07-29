# cost-program-ab — runbook

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

Arms (3), each identified by its own frozen ref:

| Arm | `wf_ref` | Image |
|---|---|---|
| `A` | `554f7c4` | `cost-program-ab:armA` |
| `B` | `ff2eb70` | `cost-program-ab:armB` |
| `C` | `3b9f00b` | `cost-program-ab:armC` |

---

## 1. Build

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/build-arm.sh --both --wf-ref-a 554f7c4 --wf-ref-b ff2eb70 --wf-ref-c 3b9f00b --cli-version 2.1.218 
```

## 2. Gate (cheap — prove the seed+container path per arm before any spend)

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/gate-A:/work/run-output cost-program-ab:armA --measured-fleet --arm A --workload-ref c768673 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ FLEET-2 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/gate-B:/work/run-output cost-program-ab:armB --measured-fleet --arm B --workload-ref c768673 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ FLEET-2 
```

### Arm `C`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/gate-C:/work/run-output cost-program-ab:armC --measured-fleet --arm C --workload-ref c768673 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ FLEET-2 
```

## 3. Measured run — BILLED, ask first

One run per arm, order shuffled, at least 330 seconds apart, same host, same day.

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/run-A:/work/run-output cost-program-ab:armA --measured-fleet --arm A --workload-ref c768673 --fake-scripts fake-scripts.json --umbrella-id FLEET-1 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/run-B:/work/run-output cost-program-ab:armB --measured-fleet --arm B --workload-ref c768673 --fake-scripts fake-scripts.json --umbrella-id FLEET-1 
```

### Arm `C`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/run-C:/work/run-output cost-program-ab:armC --measured-fleet --arm C --workload-ref c768673 --fake-scripts fake-scripts.json --umbrella-id FLEET-1 
```

## 4. Analyze (offline, host-side, free)

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/analyze.sh --run-a $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/run-A --run-b $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/run-B --run-c $ROOT/plugins/wf-sandbox-testing/experiments/cost-program-ab/results/run-C 
```

## Declared comparisons

| Base | Against | Reported as |
|---|---|---|
| `A` | `B` | `B` minus `A` |
| `B` | `C` | `C` minus `B` |
| `A` | `C` | `C` minus `A` |
