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

This experiment is **data plus two dispatch shims**. All behaviour — orchestration, build,
seed, blinding gate, in-container per-arm run, analysis — lives in the shared, experiment-agnostic
engine at [`../engine/`](../engine/), whose manifest contract is [`../engine/schema.md`](../engine/schema.md).
Adding an arm here is a manifest edit, never a script edit.

| Path | Role |
|---|---|
| `Dockerfile` | Arm-buildable image. `ARG WF_REF` selects the arm's marketplace ref; the workload snapshot is resolved at container-run time by the engine's `seed-workspace.sh --workload-ref` (a run-time param, **not** a build ARG), never baked in. Copies the engine alongside this folder and sets `WF_EXPERIMENT_DIR`, so the manifest of record reaches the container through the environment and no flag is added to the measured `docker run` line. (A *non-default* manifest travels as one extra `-e WF_EXPERIMENT_MANIFEST=<name>` — see [`../engine/schema.md`](../engine/schema.md).) |
| `experiment.json` | **This experiment's manifest of record** — the two-arm declaration (`A` = `90cf319`, `B` = `c768673`), the constants held identical across arms, the declared pairwise compare, the reserved mechanism-signal slot, and the blinding vocabulary + forbidden-path guards. Every value the engine emits comes from here. |
| `experiment.r1.json` | The rung-added variant: `experiment.json` plus exactly one arm row (`R1` = `ff2eb70`) and one compare. A data-only delta — no engine or shim file differs between the two. **Not** the parity target; parity runs against `experiment.json` only. |
| `build-arm.sh` | 5-line dispatch shim → `../engine/build.sh --manifest experiment.json`. Builds `fleet-ab:arm<label>` per declared arm and fingerprints build inputs into `results/build-<label>.json`. |
| `analyze.sh` | 5-line dispatch shim → `../engine/analyze.sh --manifest experiment.json`. Offline, host-side only: `fleet-cost.mjs measure` per run, plus each compare the manifest declares, in its declared direction. |
| `fake-scripts.json` | Scripted tracker/delivery responses carrying the real WF-406/WF-409 texts (verbatim, checked against the blinding vocabulary list). |
| `runbooks/` | Machine-derived command documents (`run-experiment.sh --runbook`) — one per manifest that has one. `experiment.r1.md` is the R1 rung's spend-ready runbook: **derived, never executed.** Do not hand-edit; re-derive instead. |
| `baseline/` | WF-419's committed pre-retrofit parity oracle: `capture.md` (the recorded capture invocation and every parameter value it used), `dry-run-baseline.stdout.txt` (the compared command surface), and `dry-run-baseline.stderr.txt`. Read-only evidence — the retrofit is proved equivalent against it with [`../parity/parity-check.sh`](../parity/parity-check.sh). |
| `results/` | Everything committed: `build-*.json`, per-run `run.json` + transcript archives + workspace snapshots, `measure-*.json`, `totals-comparison.txt`, and `deltas.md` (the spend-free per-sub-task fixture-relative delta collation, ships with the kit itself — see below). **No mechanism table** — mechanism-signal evaluation is a reserved manifest slot the engine validates and never reads (`experiment.json`'s `mechanism_signals[]`, [`../engine/schema.md`](../engine/schema.md)); nothing in this kit produces one today. |

Everything under `experiments/fleet-ab/` is git-tracked — data, run records, transcript
archives, and the verdict — **never** under `_local/` (spec Constraints; design doc §5:
the historical baseline died of pruned transcripts, this one must not, and the kit
graduates into a pack skill once proven useful).

---

## Run protocol

Follow in order. Steps 1–2 cost nothing. Step 3 is the **ask-first checkpoint** — do not
proceed past it without the user's explicit go-ahead (each measured run is
≈$85–115 API-equivalent, spec Boundaries).

### 1. Freeze

The constants are already frozen **in `experiment.json`** — arm refs, workload ref, CLI version,
umbrella id, gate skill, measured skill, model pin, packs, and the inter-arm gap. Re-freezing means
editing that file, not exporting shell variables. Each value is overridable per invocation
(`--workload-ref`, `--cli-version`, `--wf-ref-<label>`, …) when you need a one-off.

Build every declared arm:

```sh
bash plugins/wf-sandbox-testing/experiments/fleet-ab/build-arm.sh --all
```

To see exactly what a phase would issue without issuing it — no build, no container, no spend:

```sh
bash plugins/wf-sandbox-testing/experiments/engine/run-experiment.sh \
  --manifest plugins/wf-sandbox-testing/experiments/fleet-ab/experiment.json \
  build gate analyze --dry-run
```

Naming `pilot` (or `all`, which includes it) additionally requires `--spend`: that gate is checked
*before* `--dry-run` short-circuits execution, deliberately, so acknowledging the cost is never
something a flag ordering can skip past.

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
  --workload-ref 9c99498 --fake-scripts fake-scripts.json
# repeat for fleet-ab:armB (→ results/gate-B)
```

Or let the engine issue both for you — `run-experiment.sh --manifest experiment.json gate`. The
container-entry contract is unchanged either way; the manifest of record reaches the container
through `WF_EXPERIMENT_DIR` (set in the image), never as a flag on this line. Selecting a
different manifest adds exactly one `-e WF_EXPERIMENT_MANIFEST=<name>` and nothing else.

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
config, and no state; they differ only in the image's `WF_REF`. The engine's `run-arm.sh` seeds a
fresh workspace + isolated config inside each container, applies no-egress, runs the manifest's
measured skill against its umbrella id, and archives the transcripts + `run.json` into
`/work/run-output`:

```sh
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN \
  -v "$PWD/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-A:/work/run-output" \
  fleet-ab:armA --measured-fleet --arm A --umbrella-id WF-405 \
  --workload-ref 9c99498 --fake-scripts fake-scripts.json
# wait > 5 minutes
docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN \
  -v "$PWD/plugins/wf-sandbox-testing/experiments/fleet-ab/results/run-B:/work/run-output" \
  fleet-ab:armB --measured-fleet --arm B --umbrella-id WF-405 \
  --workload-ref 9c99498 --fake-scripts fake-scripts.json
```

**Archive raw transcripts immediately** (the engine's `run-arm.sh` already tars the isolated
`projects/` tree into `results/run-<arm>/projects-archive.tar.gz` inside the mounted
volume) — commit it. The historical $114.55 baseline died of pruned transcripts; this
experiment must not repeat that mistake.

### 4. Decide

```sh
bash plugins/wf-sandbox-testing/experiments/fleet-ab/analyze.sh \
  --run-a results/run-A --run-b results/run-B
```

One `--run-<label>` per declared arm. Each compare the manifest declares is reported in its
declared direction (**against minus base**), so the sign convention is pinned by data, not by the
order files happen to be read in.

- If the delta is large → **stop, write the verdict** on the dollar comparison alone.
- If ambiguous → **ask first again** before spending one more interleaved pair
  (A, B, B, A overall), then stop regardless (design doc §8.4).

The design doc's §7.2 mechanism table is **not** part of this gate: `mechanism_signals[]` is a
reserved manifest slot the engine validates and never reads, and no script here produces a
mechanism table. Judging the delta against per-mechanism assertions is a later, separate step —
until it lands, a verdict rests on the dollar comparison plus the blind quality read (§7.3).

### 5. Retry / stall policy

- A run failing for **infrastructure** reasons (container death, auth, a fake-script
  gap) is **discarded and re-run**, with the failure logged in the verdict's provenance.
- A run that completes **expensively or with bad findings is data, never discarded.** No
  cherry-picking.
- A run exceeding ~3× baseline wall-clock (> 12h) is **killed, archived, and counted as an
  infrastructure failure**, partial transcripts kept.

---

## Blinding — what must never leak

Design doc §6 in full; the short version enforced mechanically by the engine's
`seed-workspace.sh` gate, which carries **no vocabulary of its own** — the banned words come from
`experiment.json`'s `blinding.vocabulary[]` and the presence guards from its
`blinding.forbidden_paths[]`. An empty vocabulary is rejected at manifest load, before any image
build and before any spend. Prove the gate offline (no network, no Docker):

```sh
bash plugins/wf-sandbox-testing/experiments/engine/seed-workspace.sh --prove-blinding \
  --manifest plugins/wf-sandbox-testing/experiments/fleet-ab/experiment.json
```

1. No experiment vocabulary in anything **this experiment injects** — not the umbrella/task
   texts, the seeded `_local/config.md`, the fake scripts, or branch names. The workload
   snapshot's own historical docs are exempt (equally visible in the baseline era).
2. The workload ref **W** must predate `docs/wf382-*` and `experiments/` existing on
   `main` — both are declared in `blinding.forbidden_paths[]`, and the gate fails loudly if
   either is present in the seeded tree.
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

## The R1 rung — ready, not run

`experiment.r1.json` adds one arm (`R1` = `ff2eb70`) and one compare (`R1` relative to `B`) to the
manifest of record. Nothing else differs between the two files, and no engine or shim file differs
at all — that data-only delta is the point: another rung on the ref ladder costs a manifest edit.

`runbooks/experiment.r1.md` is its spend-ready command document, **derived** by
`run-experiment.sh --runbook` and never executed. Re-derive it rather than editing it:

```sh
bash plugins/wf-sandbox-testing/experiments/engine/run-experiment.sh \
  --manifest plugins/wf-sandbox-testing/experiments/fleet-ab/experiment.r1.json --runbook
```

Running it is a human decision under the same ask-first checkpoint as step 3 above. Parity against
`baseline/` is proved for `experiment.json` only — the variant is never the parity target.

---

## What is downstream of this kit (out of scope here)

The blind quality panel, the verdict document, and shipping WF-406/WF-409 for real are
all downstream of an actual pilot run and are **not** part of this buildable plan
(`_local/WF-382/02_plan.md` STEP-006). This README stops at "you have `analyze.sh`'s
output" — writing the verdict from it is the next, separate step.
