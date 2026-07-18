#!/usr/bin/env bash
# smoke-gate.sh — the SMOKE-tier gate wrapper: produce N fresh runs, then judge them.
#
# This is the ONE command the CI smoke job and a downstream host operator both call. It ties the
# pack's own primitives together WITHOUT re-implementing produce or judge logic:
#
#   1. resolve the SMOKE tier's model + run count from the pack's settings key
#      (`assert/tiers.sh smoke --print-model` → `tiers.settings.json`) — never a hardcoded model;
#   2. build (or reuse) the hermetic runner image from `runner/Dockerfile` (build context = repo
#      root; NO token is ever a build arg or image layer);
#   3. drive `runner/` N times against the gate scenario — each container invocation is ONE real
#      headless run producing one run-output dir into a fresh run set;
#   4. judge that fresh run set with `assert/tiers.sh smoke`, emitting the variance-aware report and
#      propagating its exit code (non-zero = a named failed assertion) as this script's exit code.
#
# TOKEN HYGIENE (non-negotiable — spec locked-decision 5):
#   - CLAUDE_CODE_OAUTH_TOKEN reaches the container ONLY as `docker run -e CLAUDE_CODE_OAUTH_TOKEN`
#     (name-only passthrough from the environment — the VALUE is never written on a command line);
#   - the token value is never echoed/printed, never a build arg, never baked into an image layer,
#     never persisted to a cache, the report, or any artifact;
#   - ANTHROPIC_API_KEY is never set here — billing is the subscription via the OAuth token.
# `set -x` is deliberately never enabled anywhere in this script, and `set +x` is asserted up front,
# so no token-bearing command line can ever be traced into a log.
set -uo pipefail
set +x  # never trace — a traced `docker run -e TOKEN=...`-shaped line must be impossible

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$CI_DIR/.." && pwd)"
RUNNER_DIR="$PACK_DIR/runner"
ASSERT_DIR="$PACK_DIR/assert"
REPO_ROOT="$(cd "$PACK_DIR/../.." && pwd)"   # the marketplace repo root = the Dockerfile build context

die() { echo "smoke-gate: $*" >&2; exit 2; }

# --- arguments (all optional; defaults gate the demonstration scenario) ---
scenario="$ASSERT_DIR/scenarios/demo-branch"
fixture="demo-fake"
skill=""                              # default: read from the scenario's expect.json
report=""                             # default: a temp file, always echoed to stdout
runs_dir=""                           # default: a temp run set
image_tag="wf-sandbox-runner:smoke"

while [ $# -gt 0 ]; do
  case "$1" in
    --scenario) scenario="${2:?}"; shift 2;;
    --scenario=*) scenario="${1#*=}"; shift;;
    --fixture) fixture="${2:?}"; shift 2;;
    --fixture=*) fixture="${1#*=}"; shift;;
    --skill) skill="${2:?}"; shift 2;;
    --skill=*) skill="${1#*=}"; shift;;
    --report) report="${2:?}"; shift 2;;
    --report=*) report="${1#*=}"; shift;;
    --runs-dir) runs_dir="${2:?}"; shift 2;;
    --runs-dir=*) runs_dir="${1#*=}"; shift;;
    --image) image_tag="${2:?}"; shift 2;;
    --image=*) image_tag="${1#*=}"; shift;;
    -h|--help)
      grep '^#' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0;;
    *) die "unknown argument '$1'";;
  esac
done

command -v docker >/dev/null 2>&1 || die "docker is required to produce runs (build the runner image + run it)."
command -v jq     >/dev/null 2>&1 || die "jq is required."
[ -f "$scenario/expect.json" ] || die "scenario expectations not found: $scenario/expect.json"

# The token must be present to bill the run (the container entrypoint refuses without it). Test its
# presence WITHOUT printing it — the CI job only invokes this wrapper when the secret is present, and
# a host operator must have minted one via `claude setup-token`.
[ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] || die "CLAUDE_CODE_OAUTH_TOKEN is not set; mint one with 'claude setup-token' and export it (or add it as the CI repo secret). Refusing to run without subscription auth."

# --- 1. resolve the SMOKE model + run count from the pack settings key (never hardcoded here) ---
model_line="$(bash "$ASSERT_DIR/tiers.sh" smoke --scenario "$scenario" --print-model)" \
  || die "could not resolve the SMOKE tier model/runs via tiers.sh --print-model."
model="$(printf '%s' "$model_line" | sed -E 's/.*model=([^ ]+).*/\1/')"
runs="$(printf '%s'  "$model_line" | sed -E 's/.*runs=([0-9]+).*/\1/')"
[ -n "$model" ] || die "tiers.sh resolved no SMOKE model."
case "$runs" in ''|*[!0-9]*) runs=2;; esac   # defensive: a missing/garbled run count falls back to 2
[ -n "$skill" ] || skill="$(jq -r '.skill // empty' "$scenario/expect.json")"
[ -n "$skill" ] || die "no skill to run (pass --skill or set .skill in the scenario expect.json)."

echo "smoke-gate: tier=smoke model=$model runs=$runs scenario=$scenario fixture=$fixture skill=$skill"

# --- 2. build (or reuse) the runner image — build context = repo root; no token is ever a build arg ---
echo "smoke-gate: building runner image '$image_tag' (context=$REPO_ROOT)"
docker build -f "$RUNNER_DIR/Dockerfile" -t "$image_tag" "$REPO_ROOT" >&2 \
  || die "runner image build failed."

# --- 3. drive the runner N times, producing one fresh run set (sequential — no orchestration) ---
[ -n "$runs_dir" ] || runs_dir="$(mktemp -d)/runs-smoke"
mkdir -p "$runs_dir"
i=1
while [ "$i" -le "$runs" ]; do
  out="$runs_dir/run-$i"
  mkdir -p "$out"
  echo "smoke-gate: run $i/$runs"
  # Token passthrough is NAME-ONLY (-e CLAUDE_CODE_OAUTH_TOKEN); its value never appears on this line.
  # NET_ADMIN lets the container's default no-egress self-check apply (non-fatal if the runner denies it).
  docker run --rm --cap-add=NET_ADMIN \
    -e CLAUDE_CODE_OAUTH_TOKEN \
    -v "$out:/work/run-output" \
    "$image_tag" \
    --skill "$skill" --fixture "$fixture" --model "$model" >&2 \
    || echo "smoke-gate: run $i exited non-zero — its run-output is still judged below (a produced transcript is graded, a missing one is skipped)." >&2
  i=$((i + 1))
done

# Guard: at least one run must have produced a gradeable transcript, else there is nothing to judge.
produced="$(find "$runs_dir" -mindepth 2 -maxdepth 2 -name transcript.jsonl 2>/dev/null | wc -l | tr -d ' ')"
[ "$produced" -ge 1 ] || die "no run produced a transcript.jsonl under $runs_dir — nothing to judge (check the container auth/billing guard output above)."

# --- 4. judge the fresh run set; its exit code is the gate verdict ---
[ -n "$report" ] || report="$(mktemp)"
rc=0
bash "$ASSERT_DIR/tiers.sh" smoke --scenario "$scenario" --runs-dir "$runs_dir" --report "$report" >/dev/null 2>&1 || rc=$?
echo "===== SMOKE report ====="
cat "$report"
echo "========================"
exit "$rc"
