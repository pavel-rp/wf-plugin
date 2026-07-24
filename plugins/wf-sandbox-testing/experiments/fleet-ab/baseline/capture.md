# fleet-ab pre-retrofit dry-run baseline — capture record

**Captured:** 2026-07-24
**Model:** claude-opus-5[1m]
**Kit sha (state captured):** `c768673` — the frozen `main` tip this capture's branch was cut from; no kit
script differs from that commit.
**Shell:** `GNU bash, version 5.2.21(1)-release (x86_64-pc-linux-gnu)`

This is the **parity oracle** for WF-420. It is the byte-exact output of the *current* (pre-retrofit)
`run-experiment.sh` under `--dry-run`, across the kit's full declared command surface — build, gate,
pilot, analyze. Once WF-420 replaces these scripts the oracle is unrecoverable from the working tree,
which is why it is captured and committed here, ahead of any script change.

The comparison rules that decide which of the tokens below are compared and which are ignored live in
[`../../parity/normalization.md`](../../parity/normalization.md); the executable form is
[`../../parity/parity-check.sh`](../../parity/parity-check.sh).

---

## Invocation

Run from the repository root, with `<kit>` = `plugins/wf-sandbox-testing/experiments/fleet-ab`:

```
bash <kit>/run-experiment.sh all --dry-run --spend \
  --workload-ref 9c99498 \
  --wf-ref-b c768673 \
  > <kit>/baseline/dry-run-baseline.stdout.txt \
  2> <kit>/baseline/dry-run-baseline.stderr.txt
```

Exactly this argv, in this order:

| # | argv token |
|---|---|
| 1 | `all` |
| 2 | `--dry-run` |
| 3 | `--spend` |
| 4 | `--workload-ref` |
| 5 | `9c99498` |
| 6 | `--wf-ref-b` |
| 7 | `c768673` |

`all` expands to the four phases `build gate pilot analyze` (`run-experiment.sh:68`), which run in
canonical order regardless of arg order (`:217-220`).

### Why `--spend` is present, and why nothing was spent

`--spend` clears one fail-fast check and nothing else. The `pilot` phase refuses to proceed without it
(`run-experiment.sh:100-102`), and that check runs **before** any dry-run bypass — so a four-phase
capture cannot be taken without it. Under `DRY_RUN=1` every execution site short-circuits first:

| Site | Line | Behaviour under `DRY_RUN=1` |
|---|---|---|
| `check_prereqs` | `:111` | returns immediately — no `docker`/`node` lookup, no token check |
| `require_image` | `:126` | returns immediately — no `docker image inspect` |
| `run_docker` | `:142` | prints the command and `return 0`s **before** `mkdir -p "$out"` (`:143`) |
| `confirm_spend` | `:149` | returns immediately — no TTY read, no prompt |
| `do_analyze` | `:200` | bypasses the `results/run-{A,B}/run.json` precondition |
| pilot inter-arm wait | `:188` | `sleep "$GAP"` is skipped |

`--force` was **not** passed and no TTY was required. No image was built, no container ran, no network
egress occurred, nothing was billed, and nothing was written under `results/` — `run_docker` returns
before its `mkdir`, so even the output directories were not created. `git status --porcelain` over
`experiments/fleet-ab/results/` was empty both before and after the capture.

---

## Recorded invocation parameter values

These are the values WF-420's retrofit manifest must declare **verbatim** as its experiment constants
and arm `wf_ref`s. Their parity classification is stated once, authoritatively, at `normalization.md`
§3.11 — compared, supplied identically to both sides, with `--gap-seconds` recorded-only. Both refs are
frozen literal shas; the moving ref `main` appears nowhere.

| Parameter | Value | Source | Reaches compared stdout? |
|---|---|---|---|
| `--workload-ref` | `9c99498` | passed explicitly | yes — every `docker run` line |
| `--wf-ref-a` | `90cf319` | **default** (`:20`) | yes — the `build-arm.sh` line |
| `--wf-ref-b` | `c768673` | passed explicitly | yes — the `build-arm.sh` line |
| `--cli-version` | `2.1.218` | **default** (`:21`) | yes — the `build-arm.sh` line |
| `--umbrella-id` | `WF-405` | **default** (`:22`) | yes — both pilot `docker run` lines |
| `--gate-skill` | `/wf:triage WF-406` | **default** (`:23`) | yes — both gate `docker run` lines |
| `--fake-scripts` | `fake-scripts.json` | **default** (`:25`) | yes — every `docker run` line |
| `--packs` | *(empty)* | **default** (`:62`) | no — the flag is **absent**, `:140` appends it only when non-empty |
| `--gap-seconds` | `330` | **default** (`:24`) | no — stderr narration only (`:183`, `:187`) |

Two entries are worth flagging as *capture facts*, with their parity classification left to
`normalization.md`, which owns it:

- **`--packs` is empty, so the flag is absent from every printed `docker run` line** (`:140` appends it
  only when non-empty). Classified at `normalization.md` §3.7.
- **`--gap-seconds 330` never reaches stdout.** It appears only in stderr narration (`:183`, `:187`) and
  in a `sleep` that dry-run skips (`:188`). It is recorded here for WF-420's manifest; classified at
  `normalization.md` §3.11.

### Ref selection

- `--wf-ref-b c768673` — the frozen `main` tip at capture time. Never bare `main`.
- `--workload-ref 9c99498` — `c768673`'s parent. The kit requires a workload ref predating
  `docs/wf382-*` and `experiments/` (`run-experiment.sh:107`, `README.md`); `git log --diff-filter=A`
  names `c768673` as the commit that introduced `plugins/wf-sandbox-testing/experiments`, so its parent
  qualifies.
- `--wf-ref-a 90cf319` — left at the kit default, which is arm A's identity per the kit README.

---

## What was captured

| File | Stream | Content |
|---|---|---|
| `dry-run-baseline.stdout.txt` | stdout | the six printed command lines — the compared surface |
| `dry-run-baseline.stderr.txt` | stderr | the `log()` narration (`:57`) — an ignored class |

The two streams are captured to **separate files** deliberately: stdout and stderr buffer independently
under redirection, so any interleaved single-file capture would not be reproducible. Neither file is
re-encoded or reformatted — they are the byte-exact bytes the script emitted.

`dry-run-baseline.stdout.txt` contains exactly **six** lines, one per phase-and-arm unit of the command
surface:

| Line | Phase | Arm | Identified by |
|---|---|---|---|
| 1 | build | both | `build-arm.sh --both` |
| 2 | gate | A | mount target `results/gate-A:/work/run-output`, image `fleet-ab:armA` |
| 3 | gate | B | mount target `results/gate-B:/work/run-output`, image `fleet-ab:armB` |
| 4 | pilot | B | mount target `results/run-B:/work/run-output`, image `fleet-ab:armB` |
| 5 | pilot | A | mount target `results/run-A:/work/run-output`, image `fleet-ab:armA` |
| 6 | analyze | both | `analyze.sh --run-a … --run-b …` |

Every line is self-identifying: its executable basename or its `results/{gate,run}-{A,B}` mount names
both the phase and the arm — the property `normalization.md` §1 relies on.

Each line is emitted as four leading spaces, then `printf '%q '` per token, then a newline
(`:142`, `:160`, `:204`) — hence the trailing space on every line and the `\`-escaped space in
`/wf:triage\ WF-406`.

---

## One capture, not N — arm ordering is legitimately random

`coin_order()` (`:131`) shuffles the arm order per phase with `$((RANDOM % 2))`, independently for gate
(`:171`) and pilot (`:182`). **This capture happens to record gate order A,B and pilot order B,A.** A
re-capture may legitimately produce any of the four orderings; that is not a divergence and must never
be read as one.

This is why the baseline is a single capture rather than a set of N runs. How that randomness is
absorbed is `normalization.md`'s call, not this file's — see its §4.1: line ordering is an ignored
class, and the comparator keys each normalized line by its own `phase:arm` unit rather than by
position. Phase-canonical order (build → gate → pilot → analyze) is enforced by the script's own
control flow at `:217-220` and is not a parity concern.

---

## Host-specific facts that are ignored, not compared

The absolute path prefix embedded in every line is this capture host's checkout location:

```
/workspace/wf-plugin/.claude/worktrees/agent-ab49b270496cb1339/plugins/wf-sandbox-testing/experiments/fleet-ab
```

`SCRIPT_DIR`/`RESULTS_DIR` (`:17-18`) resolve to wherever the kit sits, so this prefix differs on every
host and every checkout. `printf '%q'` escaping is likewise bash-version dependent; it was produced here
by bash 5.2.21.

Both are facts about *this capture*, which is what this file records. Their parity classification is
`normalization.md`'s to state — see its §4.4 (absolute root prefixes) and §4.2 (quoting form).
