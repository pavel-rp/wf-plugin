# cost-program-ab — operator handoff

**Purpose:** everything a fresh agent needs to run this experiment immediately, with no
rediscovery. Read this top to bottom before touching anything.

**Branch:** `feat/experiment-build-secret-seam` · **PR:** #221 · **Repo:** `pavel-rp/wf-plugin` (PRIVATE)

---

## 0a. VERIFIED STATE as of 2026-07-29

Everything below was re-verified on this date, against the current tree at commit `c74d549`.

| Precondition | State |
|---|---|
| Blinding proof | **PASS** — fails closed on a planted word AND a planted path |
| Images built | **FRESH** — all three rebuilt after `c74d549` |
| `IS_SANDBOX=1` baked | **YES** — armA, armB, armC |
| `WF_ARM_REF` per arm | **CORRECT** — `554f7c4` / `ff2eb70` / `3b9f00b` |
| Token resolution | **OK** — `CLAUDE_CODE_OAUTH_TOKEN` 108 chars, `WF_SEED_GH_TOKEN` 40 chars |
| Seed path (clone→install→3× init→fingerprint) | **COMPLETES** |
| Blinding gate in-container | **PASSED** |
| Gate completion (all 3 arms) | **BLOCKED — subscription quota exhausted** |
| Op-log ordering check | **NOT POSSIBLE YET** — no op-log exists; the run dies before the skill executes, so nothing is recorded |
| Measured arms spent | **ZERO** |

**The single remaining blocker is quota.** Every kit-side precondition is green. The last gate
attempt (arm B, shuffled first) reached `blinding gate PASSED` and then hit
`FATAL [quota]: subscription quota exhausted; --on-quota=fail`.

**Resume procedure when quota returns — no rebuild needed unless the tree changed:**

1. Export both tokens (§4).
2. `bash $R/engine/run-experiment.sh --manifest $M gate` — all three arms must show
   `blinding gate PASSED` and complete.
3. Do the op-log ordering check (§5) — **this has never been performed**.
4. `bash $R/engine/run-experiment.sh --manifest $M pilot --spend`.
5. `bash $R/engine/run-experiment.sh --manifest $M analyze`, report per §6.

Rebuild (§4 phase 2) only if anything under `experiments/engine/`, `runner/`, or the kit has
changed since `c74d549` — the Dockerfile bakes those in.

---

## 0. The one-paragraph situation

The kit was authored but had never run end to end. Six latent defects were found and fixed
(all committed, all on PR #221). The pipeline now reaches `blinding gate PASSED`. **No measured
arm has ever been spent.** The last gate attempt died on **exhausted subscription quota**, not
on a kit defect. What remains is: confirm the gate passes on all three arms, do the op-log
ordering check, then run the billed pilot.

---

## 1. Non-negotiable protocol rules (from the operator)

- **One billed run per arm, n=1.** NEVER re-run a measured arm on your own initiative — it
  double-spends and breaks the protocol.
- **On a quota error or a failed arm: STOP and report.** Do not retry.
- **Phases 0–3 must pass in order before the pilot.** Each is a precondition for the billed
  run being worth anything.
- **Never hand-edit** `runbooks/experiment.md` (machine-derived) or use raw `docker` — always
  `run-experiment.sh`, which owns the arm shuffle and the 330s gaps (both protocol requirements).
- The billed phase **is pre-authorized**. Do not pause to ask for spend approval.

---

## 2. Environment facts you would otherwise rediscover the hard way

| Fact | Value / consequence |
|---|---|
| Repo visibility | **PRIVATE**. Both the build-time and run-time clones need credentials. |
| `gh` version | **2.4.0** (2022) — has **no** `gh auth token`, and prints its usage error to **stdout**. Token comes from `~/.config/gh/hosts.yml`. `engine/gh-token.sh` handles this; don't re-derive it. |
| `gh pr checks` | `--json` unsupported at 2.4.0 — use the plain text form. |
| Container user | **root**. The CLI refuses `--dangerously-skip-permissions` as root; `IS_SANDBOX=1` in the Dockerfile is what clears it. |
| CLI pin | `2.1.218`. Requires `--verbose` with `-p --output-format stream-json`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Persisted in `~/.claude/settings.json` under `env` (perms 600). **Not** in the tool shell until a session restart — see the export snippet in §4. |
| Node (host) | v22.20.0. `_local/_testkit/run.mjs` wants 23.6+ for type stripping. Irrelevant to this experiment. |
| Docker | 28.2.2, overlayfs. BuildKit snapshotter corrupted once (`parent snapshot does not exist`); fix is `docker builder prune -f` then rebuild. |
| `results/` ownership | Everything under `results/gate-*` and `results/run-*` is written by the container as **root**. A host-side `rm -rf` fails with `Permission denied` and will abort an `&&` chain. Clear them through a container instead (see below). |

**Clearing stale result dirs** — do not `rm` them from the host:

```sh
RES="$(pwd)/plugins/wf-sandbox-testing/experiments/cost-program-ab/results"
docker run --rm -v "$RES:/r" --entrypoint sh alpine:latest -c 'rm -rf /r/gate-A /r/gate-B /r/gate-C'
```

Note the engine tolerates a pre-existing dir (it logs a harmless
`rm: cannot remove '/work/run-output': Device or resource busy` on the mount point), so clearing
is only needed when you want a clean op-log baseline rather than mixed-run leftovers.

---

## 3. The six defects already fixed (do not "re-fix" these)

| # | Defect | Where |
|---|---|---|
| 1 | Build-time clone of a private repo had no credentials | `cost-program-ab/Dockerfile` (BuildKit secret), `engine/build.sh`, `engine/gh-token.sh` (new) |
| 2 | Run-time workload clone, same problem | `engine/seed-workspace.sh`, `engine/run-experiment.sh`, `engine/run-arm.sh` (`WF_SEED_GH_TOKEN`, unset before the agent boots) |
| 3 | Container runs as root; CLI refuses `--dangerously-skip-permissions` | `Dockerfile` (`IS_SANDBOX=1`) |
| 4 | `stream-json` requires `--verbose` — **was on the measured path** | `seed-workspace.sh`, `run-arm.sh`, `runner/run-skill.sh` |
| 5 | `grep\|head` SIGPIPE → fatal 141 under `pipefail`, killing an already-successful seed | same three files |
| 6 | Blinding vocabulary collides with the product's own `baseline` term | `engine/manifest.sh`, `engine/seed-workspace.sh`, `experiment.json` (`exempt_literals`) |

Plus a review fix in `c74d549`: `sed|head` in `gh-token.sh` had the same SIGPIPE class.

**Defect 6 detail** — `/wf:init` writes a config key documented as "QA Baseline Ignore", so the
system under test emits a banned word as its own normal output. `blinding.exempt_literals`
declares exactly three literals: `QA Baseline Ignore`, `Baseline health`, `baseline check`.
These cover **all four** occurrences in `config-template.md` and are **identical across all
three arm refs**, so they cannot skew one arm against another. The mechanism is narrow —
exact literals only, blanked (not deleted) so violation line numbers stay accurate, and the
validator rejects any literal containing no vocabulary word. Verified still caught: bare
`baseline`, `BASELINE`, `baseline arm`, a leak sharing a line with an exempted string.

---

## 4. Running it — exact commands

Every run needs both tokens exported. `CLAUDE_CODE_OAUTH_TOKEN` lives in settings.json and does
**not** reach a fresh tool shell without a session restart, so source it explicitly:

```sh
cd /home/recky/.local/share/claude-sandbox/workspace/wf-plugin
export CLAUDE_CODE_OAUTH_TOKEN="$(python3 -c "
import json,pathlib
print(json.loads((pathlib.Path.home()/'.claude/settings.json').read_text())['env']['CLAUDE_CODE_OAUTH_TOKEN'])
")"
export WF_SEED_GH_TOKEN="$(bash -c '. plugins/wf-sandbox-testing/experiments/engine/gh-token.sh && resolve_gh_token')"

R=plugins/wf-sandbox-testing/experiments
M=$R/cost-program-ab/experiment.json
```

Sanity check both are non-empty (`echo ${#CLAUDE_CODE_OAUTH_TOKEN} ${#WF_SEED_GH_TOKEN}` → expect
`108 40`) before proceeding.

### Phase 1 — blinding (free, offline, seconds)

```sh
bash $R/engine/seed-workspace.sh --prove-blinding --manifest $M
```

Must print `PASS` and show it failing closed on **both** a planted word and a planted path.
If it does not fail closed: **STOP, do not spend.**

### Phase 2 — build (free, ~5 min)

```sh
bash $R/engine/run-experiment.sh --manifest $M build
```

Rebuild whenever anything under `experiments/engine/`, `runner/`, or the kit changes — the
Dockerfile bakes those in, and `build-<arm>.json` fingerprints attest to them.

Verify afterwards:

```sh
for a in armA armB armC; do
  docker inspect cost-program-ab:$a --format '{{range .Config.Env}}{{println .}}{{end}}' \
    | grep -E '^(IS_SANDBOX|WF_ARM_REF)='
done
```

Expect `IS_SANDBOX=1` in all three, and `WF_ARM_REF` = `554f7c4` / `ff2eb70` / `3b9f00b`.

### Phase 3 — gate (small spend, one `/wf:triage` per arm)

```sh
bash $R/engine/run-experiment.sh --manifest $M gate
```

Every arm must show `blinding gate PASSED`. Then do the **op-log ordering check** (§5).

### Phase 4 — pilot (BILLED, pre-authorized)

```sh
bash $R/engine/run-experiment.sh --manifest $M pilot --spend
```

Shuffled order, 330s gaps, ~15+ min. **Do not interrupt. Do not re-run a completed arm.**

### Phase 5 — analyze (free)

```sh
bash $R/engine/run-experiment.sh --manifest $M analyze
```

---

## 5. The op-log ordering check (NEVER YET PERFORMED — do this before the pilot)

After a clean gate, compare the op-log in each `results/gate-<label>/` against
`cost-program-ab/fake-scripts.json`.

A scripted JSON **array** is an ordered sequence indexed by the count of **prior calls to that
same `(surface, op)` pair**, blind to arguments; past the end the last element repeats.

If the observed call order differs from the scripted order:

- **REORDER the existing sequences** to match. Do **not** invent new responses. Do **not**
  change `FLEET-1` / `FLEET-2` / `FLEET-3`.
- Every string you touch is blinding-scanned: it must not contain *experiment(s)*,
  *baseline(s)*, *measurement(s)*, *arm(s)*, *A/B*, *treatment*, *control*, *cost-program*.
- **Re-run the gate after any edit** and only continue once clean.

Why it matters: a wrong call order makes the billed arms diverge for reasons that have nothing
to do with the treatment.

Watch specifically for `tracker.get`, scripted `[FLEET-1, FLEET-2, FLEET-3]`. The gate skill is
`/wf:triage FLEET-2`; since sequences index on prior-call count and ignore arguments, a single
`get` returns FLEET-1's payload. Confirm whether that is what the measured `/wf:fleet FLEET-1`
run actually wants before assuming it needs reordering.

---

## 6. What to report at the end

- Token totals per arm.
- The three comparisons as **AGAINST MINUS BASE**: `B−A` (routing's share), `C−B` (mechanical
  cuts), `C−A` (full program).
- Each signal's `{status, count, basis}`: `routing_record_present`, `audit_lens_boots`,
  `gated_off_lens_boots`, `index_dispatch`, `dispatch_model_tier`.
- `index_dispatch` is an **ABSENCE** signal — zero in a later arm means index inlining fired,
  **not** a broken measurement.
- n=1 per arm: report **observations, not significance**.

---

## 7. Known-stale / cosmetic, not blockers

- **Kit fingerprints differ across arms** in `build-<arm>.json` (`b10a0b…`, `93b22b…`, `108d5b…`).
  Cause: `results/` lives inside the kit dir and is not excluded from `fingerprint_tree`, so each
  build hashes the previous builds' receipts. Arm A's value is the true kit hash. The kit was
  **identical** for all three builds — this is a receipt artifact, not a treatment difference.
  One-line fix available (pass `'^\./results/'` as the extra-exclude) but deliberately not applied
  mid-run.
- `results/` is untracked by design, matching `fleet-ab`.

---

## 8. Open design questions (documented, deliberately unresolved)

See `docs/experiment-engine-followups.md` — the `baseline` vocabulary collision, and the fact
that a pinned CLI version is never validated against the kit. Neither blocks a run.
