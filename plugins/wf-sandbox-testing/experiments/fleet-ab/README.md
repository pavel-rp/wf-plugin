# fleet-ab — the WF-382 controlled A/B experiment kit

**Status: buildable, no-spend deliverable.** This kit is authored and self-verified
(`bash -n`, the blinding-gate proof, the repo build gate) without Docker, without cloning
the workload, and without spending a single measured `claude -p` call. Building the
images, running the dry-run gate, and spending the pilot are **your** actions on your
Docker-capable host — the kit does not do them for you and `/wf:implement` never invokes
them autonomously.

**Authoritative design:** [`docs/wf382-ab-experiment-design.md`](../../../../docs/wf382-ab-experiment-design.md)
(arms, constants, blinding rules §6, pre-registered analysis §7, run protocol §8). This
README states the *procedure*; the design doc states the *rationale*. Read the design doc
first if anything here is unclear about *why*.

---

## What this measures

Arm A (`90cf319`, wf 0.79.0 — the committed $114.55 baseline's version identity) against
arm B (`main` at freeze, ≥ wf 0.86.1) over one identical two-child backlog umbrella
(WF-406 + WF-409), everything else held constant (workload snapshot, Docker image
lineage, CLI version, model pin, fake providers, machine, same-day). The goal is a
defensible dollar delta plus a set of per-mechanism assertions (design doc §7.2) and a
blind quality comparison (§7.3) — never a number alone.

---

## Layout

| Path | Role |
|---|---|
| `Dockerfile` | Arm-buildable image. `ARG WF_REF` selects the arm's marketplace ref; the workload snapshot is resolved at container-run time by `seed-workspace.sh --workload-ref` (a run-time param, **not** a build ARG), never baked in. |
| `build-arm.sh` | Builds `fleet-ab:armA` / `fleet-ab:armB`; fingerprints build inputs into `results/build-<arm>.json`. |
| `seed-workspace.sh` | Clones the workload snapshot at ref W, strips the remote, runs the arm's own unmeasured `/wf:init` + pack-init skills + fake config, then the blinding gate. Called by `run-arm.sh` inside the container (before no-egress). `--prove-blinding` self-checks the gate offline (no network/Docker needed). |
| `run-arm.sh` | The in-container per-arm orchestrator (dispatched by `runner/entrypoint.sh` on `--measured-fleet`): **seed → seal (no-egress) → the one measured `claude -p "/wf:fleet <umbrella-id>"` → archive**. Collects the isolated `CLAUDE_CONFIG_DIR/projects` archive, the fake op-log, a workspace snapshot, and `run.json`. `--gate-skill` runs the cheap dry-run gate over the same path. **Never run directly in the WF-382 implement session** — authored/`bash -n`-checked only. |
| `fake-scripts.json` | Scripted tracker/delivery responses carrying the real WF-406/WF-409 texts (verbatim, checked against the blinding vocabulary list). |
| `analyze.sh` | Offline, host-side only: `fleet-cost.mjs measure` per run, the arm B vs arm A dollar delta, and the §7.2 mechanism table. |
| `results/` | Everything committed: `build-*.json`, per-run `run.json` + transcript archives + workspace snapshots, `measure-*.json`, `totals-comparison.txt`, `mechanism-table.json`, and `deltas.md` (the spend-free per-sub-task fixture-relative delta collation, ships with the kit itself — see below). |

Everything under `experiments/fleet-ab/` is git-tracked — kit, run records, transcript
archives, and the verdict — **never** under `_local/` (spec Constraints; design doc §5:
the historical baseline died of pruned transcripts, this one must not, and the kit
graduates into a pack skill once proven useful).

---

## Run protocol

Follow in order. Steps 1–2 cost nothing. Step 3 is the **ask-first checkpoint** — do not
proceed past it without the user's explicit go-ahead (each measured run is
≈$85–115 API-equivalent, spec Boundaries).

### 1. Freeze

Pin the four constants and record them:

```sh
WF_REF_A=90cf319                 # arm A — never changes, the baseline's version identity
WF_REF_B=<main-tip-sha-at-freeze>  # arm B — frozen explicitly, never re-resolved from "main"
WORKLOAD_REF=<pinned main-tip predating docs/wf382-* and experiments/>
CLI_VERSION=2.1.218              # or whatever is frozen; identical in both arms
```

Build both images:

```sh
bash plugins/wf-sandbox-testing/experiments/fleet-ab/build-arm.sh --both \
  --wf-ref-a "$WF_REF_A" --wf-ref-b "$WF_REF_B" --cli-version "$CLI_VERSION"
```

### 2. Dry-run gate (cheap)

Before spending a fleet run, prove each arm image over the **exact seed+seal path the pilot
takes** — the container clones the workload, runs `/wf:init` + pack registrations + fake
config + the blinding gate, applies no-egress, then runs one cheap `/wf:triage` instead of
the billed `/wf:fleet`. `--gate-skill` is the only difference from step 3, so a green gate
validates the real path (not a divergent one). Run once per arm image on your Docker host:

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN \
  -v "$PWD/plugins/wf-sandbox-testing/experiments/fleet-ab/results/gate-A:/work/run-output" \
  fleet-ab:armA --measured-fleet --arm A --gate-skill "/wf:triage WF-406" \
  --workload-ref "$WORKLOAD_REF" --fake-scripts fake-scripts.json
# repeat for fleet-ab:armB (→ results/gate-B)
```

If either arm's dry run fails, fix the seeding/registration issue before proceeding — a
failed dry run is infrastructure, never charged against the pilot.

**Validate `fake-scripts.json`'s call-sequencing during this gate**, per the comment at
the top of that file: confirm the observed tracker `get` call order actually matches the
scripted 3-element sequence (umbrella, then each child) before trusting the pilot's
scripted responses; reorder the array if the observed order differs.

### 3. ASK FIRST — spend the pilot

**Stop here and get the user's explicit go-ahead before any measured `docker run`.**
Each run is a real, billed `claude -p` session.

One run per arm, order **coin-flipped**, **more than 5 minutes apart** (prompt-cache TTL),
same host, same day. Each arm runs in its **own** container (`fleet-ab:armA` vs
`fleet-ab:armB`) with its **own** mounted output dir — the two arms share no workspace, no
config, and no state; they differ only in the image's `WF_REF`. `run-arm.sh` seeds a fresh
workspace + isolated config inside each container, applies no-egress, runs the measured
`/wf:fleet WF-405`, and archives the transcripts + `run.json` into `/work/run-output`:

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN \
  -v "$PWD/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-A:/work/run-output" \
  fleet-ab:armA --measured-fleet --arm A --umbrella-id WF-405 \
  --workload-ref "$WORKLOAD_REF" --fake-scripts fake-scripts.json
# wait > 5 minutes
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN \
  -v "$PWD/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-B:/work/run-output" \
  fleet-ab:armB --measured-fleet --arm B --umbrella-id WF-405 \
  --workload-ref "$WORKLOAD_REF" --fake-scripts fake-scripts.json
```

**Archive raw transcripts immediately** (`run-arm.sh` already tars the isolated
`projects/` tree into `results/run-<arm>/projects-archive.tar.gz` inside the mounted
volume) — commit it. The historical $114.55 baseline died of pruned transcripts; this
experiment must not repeat that mistake.

### 4. Decide

```sh
bash plugins/wf-sandbox-testing/experiments/fleet-ab/analyze.sh \
  --run-a results/run-A --run-b results/run-B
```

- If the delta is large and the §7.2 mechanism table is clean → **stop, write the
  verdict.**
- If ambiguous → **ask first again** before spending one more interleaved pair
  (A, B, B, A overall), then stop regardless (design doc §8.4).

### 5. Retry / stall policy

- A run failing for **infrastructure** reasons (container death, auth, a fake-script
  gap) is **discarded and re-run**, with the failure logged in the verdict's provenance.
- A run that completes **expensively or with bad findings is data, never discarded.** No
  cherry-picking.
- A run exceeding ~3× baseline wall-clock (> 12h) is **killed, archived, and counted as an
  infrastructure failure**, partial transcripts kept.

---

## Blinding — what must never leak

Design doc §6 in full; the short version enforced mechanically by
`seed-workspace.sh`'s gate (`--prove-blinding` proves this offline, no Docker needed):

1. No experiment vocabulary in anything **this kit injects** — not the umbrella/task
   texts, the seeded `_local/config.md`, the fake scripts, or branch names. The workload
   snapshot's own historical docs are exempt (equally visible in the baseline era).
2. The workload ref **W** must predate `docs/wf382-*` and `experiments/` existing on
   `main` — the gate fails loudly if either is present in the seeded tree.
3. Measurement is offline — nothing in either container ever runs `analyze.sh` or
   references the harness.
4. The quality judge is blind too (§7.3) — anonymize before comparing.

---

## Per-sub-task fixture-relative deltas (independent of this A/B)

`results/deltas.md` collates every shipped C024 sub-task's before/after delta over the
WF-373/WF-401 `fleet-two-task` fixture — spend-free, ships with the kit itself (plan
STEP-004), and does not require the pilot above to have run. Read it before writing the
umbrella verdict: a missing delta **blocks** the verdict per the spec's success criteria
(WF-376's is the one stated indicative-only exception; WF-381 is a legitimate
closed-unmet, not a blocker).

---

## What is downstream of this kit (out of scope here)

The blind quality panel, the verdict document, and shipping WF-406/WF-409 for real are
all downstream of an actual pilot run and are **not** part of this buildable plan
(`_local/WF-382/02_plan.md` STEP-006). This README stops at "you have `analyze.sh`'s
output" — writing the verdict from it is the next, separate step.
