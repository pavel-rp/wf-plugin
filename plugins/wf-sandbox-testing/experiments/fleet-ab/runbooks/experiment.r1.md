# fleet-ab — runbook

**Derived from:** `experiment.r1.json`
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
| `A` | `90cf319` | `fleet-ab:armA` |
| `B` | `c768673` | `fleet-ab:armB` |
| `R1` | `ff2eb70` | `fleet-ab:armR1` |

---

## 1. Build

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/build-arm.sh --both --wf-ref-a 90cf319 --wf-ref-b c768673 --wf-ref-r1 ff2eb70 --cli-version 2.1.218 
```

## 2. Gate (cheap — prove the seed+container path per arm before any spend)

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/gate-A:/work/run-output fleet-ab:armA --measured-fleet --arm A --workload-ref 9c99498 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ WF-406 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/gate-B:/work/run-output fleet-ab:armB --measured-fleet --arm B --workload-ref 9c99498 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ WF-406 
```

### Arm `R1`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/gate-R1:/work/run-output fleet-ab:armR1 --measured-fleet --arm R1 --workload-ref 9c99498 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ WF-406 
```

## 3. Measured run — BILLED, ask first

One run per arm, order shuffled, at least 330 seconds apart, same host, same day.

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-A:/work/run-output fleet-ab:armA --measured-fleet --arm A --workload-ref 9c99498 --fake-scripts fake-scripts.json --umbrella-id WF-405 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-B:/work/run-output fleet-ab:armB --measured-fleet --arm B --workload-ref 9c99498 --fake-scripts fake-scripts.json --umbrella-id WF-405 
```

### Arm `R1`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-R1:/work/run-output fleet-ab:armR1 --measured-fleet --arm R1 --workload-ref 9c99498 --fake-scripts fake-scripts.json --umbrella-id WF-405 
```

## 4. Analyze (offline, host-side, free)

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/analyze.sh --run-a $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-A --run-b $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-B --run-r1 $ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-R1 
```

## Declared comparisons

| Base | Against | Reported as |
|---|---|---|
| `A` | `B` | `B` minus `A` |
| `B` | `R1` | `R1` minus `B` |
