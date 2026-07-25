# scaffold-selftest — runbook

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
| `A` | `1e78c19` | `scaffold-selftest:armA` |
| `B` | `890d35d` | `scaffold-selftest:armB` |

---

## 1. Build

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/build-arm.sh --both --wf-ref-a 1e78c19 --wf-ref-b 890d35d --cli-version 2.1.218 
```

## 2. Gate (cheap — prove the seed+container path per arm before any spend)

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/results/gate-A:/work/run-output scaffold-selftest:armA --measured-fleet --arm A --workload-ref c768673 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ SELF-423 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/results/gate-B:/work/run-output scaffold-selftest:armB --measured-fleet --arm B --workload-ref c768673 --fake-scripts fake-scripts.json --gate-skill /wf:triage\ SELF-423 
```

## 3. Measured run — BILLED, ask first

One run per arm, order shuffled, at least 330 seconds apart, same host, same day.

### Arm `A`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/results/run-A:/work/run-output scaffold-selftest:armA --measured-fleet --arm A --workload-ref c768673 --fake-scripts fake-scripts.json --umbrella-id SELF-422 
```

### Arm `B`

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/results/run-B:/work/run-output scaffold-selftest:armB --measured-fleet --arm B --workload-ref c768673 --fake-scripts fake-scripts.json --umbrella-id SELF-422 
```

## 4. Analyze (offline, host-side, free)

```sh
bash $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/analyze.sh --run-a $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/results/run-A --run-b $ROOT/plugins/wf-sandbox-testing/experiments/scaffold-selftest/results/run-B 
```

## Declared comparisons

| Base | Against | Reported as |
|---|---|---|
| `A` | `B` | `B` minus `A` |
