#!/usr/bin/env bash
# replay-round.sh — the LIVE per-round replay driver (billed; needs the claude CLI + a token).
#
# **Model:** claude-fable-5-1
#
# One replayed round = seed a workload at the round's recorded commit (the engine's own
# seed-workspace.sh, unchanged) → materialize the round (materialize-round.sh) → ONE
# `claude -p "/wf:verify-spec <task>"` in the seeded workspace, in exactly the invocation shape
# the engine's run-arm.sh uses → read the fresh 04_verify.md back into a structured round record
# (extract-rounds.mjs --single) under `--out/<arm>/<task>/round-NN.json`, beside the transcript.
# `replay-check.mjs --against-dir <out>/<arm>` then judges the arm against results/baseline.json.
#
# Why this driver exists rather than run-experiment.sh alone: the engine's arm runner seeds and
# measures in one fixed sequence with no hook between them, and a replayed round needs a task
# folder, a rebuilt ledger, and a fixture capability laid in AFTER seeding. This script composes
# the engine's seed step with that overlay instead of editing any engine file (the task's stated
# "ask first" boundary). The measured invocation is byte-shaped like run-arm.sh's so the
# transcript the mechanism signals read is the same kind of record.
#
# Nothing here runs without `--spend`: the default is a dry run that prints every command.
#
# usage: replay-round.sh --arm <label> --item <corpus item dir> --round <NN> [--out <dir>]
#                        [--task-src <dir>] [--edits <patch>] [--critic <file>]
#                        [--config-dir <CLAUDE_CONFIG_DIR>] [--model <model>] [--spend]
#        replay-round.sh --arm <label> --all [--out <dir>] [--spend]     # every replayable round
set -euo pipefail
# manifest.sh (sourced below) sets its own KIT_DIR/EXP-style names; this script keeps VR_-prefixed paths.
VR_KIT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VR_EXP="$(cd "$VR_KIT/.." && pwd)"
PACK_DIR="$(cd "$VR_EXP/../.." && pwd)"
ENGINE_DIR="$PACK_DIR/experiments/engine"
REPO_ROOT="$(cd "$PACK_DIR/../.." && pwd)"

die() { echo "replay-round.sh: ERROR — $*" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || die "jq is required"
command -v node >/dev/null 2>&1 || die "node is required"

arm="" item="" round="" out="$VR_EXP/results/arms" task_src="" edits="" critic="" cfg="" model="" spend=0 all=0
while [ $# -gt 0 ]; do
  case "$1" in
    --arm) arm="${2:?}"; shift 2;;          --item) item="${2:?}"; shift 2;;
    --round) round="${2:?}"; shift 2;;      --out) out="${2:?}"; shift 2;;
    --task-src) task_src="${2:?}"; shift 2;; --edits) edits="${2:?}"; shift 2;;
    --critic) critic="${2:?}"; shift 2;;    --config-dir) cfg="${2:?}"; shift 2;;
    --model) model="${2:?}"; shift 2;;      --spend) spend=1; shift;;
    --all) all=1; shift;;
    *) die "unknown argument: $1";;
  esac
done
[ -n "$arm" ] || die "--arm <label> is required (a label declared in experiment.json)"
# shellcheck source=../../engine/manifest.sh
. "$ENGINE_DIR/manifest.sh"
manifest_load "$VR_EXP/experiment.json" >/dev/null
[ -n "$model" ] || model="$CONST_MODEL"

run_one() {
  local item="$1" round="$2"
  round="$(printf '%02d' "$((10#$round))")"
  local rec="$item/rounds/round-$round.json"
  [ -f "$rec" ] || die "round record not found: $rec"
  if [ "$(jq -r '.body_truncated // false' "$rec")" = "true" ]; then
    echo "replay-round.sh: skip $(jq -r .task "$rec") round $round — body_truncated at the source (stated in the record)" >&2
    return 0
  fi
  local task commit ws seed_out dest
  task="$(jq -r '.task' "$rec")"; commit="$(jq -r '.commit' "$rec")"
  dest="$out/$arm/$task"
  mkdir -p "$dest"
  mkdir -p "$REPO_ROOT/_local/scratch"; ws="$(mktemp -d "$REPO_ROOT/_local/scratch/vr-replay-XXXXXX")/workspace"; mkdir -p "$ws"
  seed_out="$dest/seed-r$round"
  local seed_cmd=(bash "$ENGINE_DIR/seed-workspace.sh" "$ws" --manifest "$VR_EXP/experiment.json" --workload-ref "$commit" --fake-scripts "$VR_EXP/fake-scripts.json" --packs "$CONST_PACKS" --out "$seed_out")
  [ -n "$cfg" ] && seed_cmd+=(--config-dir "$cfg")
  local mat_cmd=(bash "$VR_KIT/materialize-round.sh" --item "$item" --round "$round" --workspace "$ws")
  [ -n "$task_src" ] && mat_cmd+=(--task-src "$task_src")
  [ -n "$edits" ] && mat_cmd+=(--edits "$edits")
  [ -n "$critic" ] && mat_cmd+=(--critic "$critic")
  local measure=(claude -p "$CONST_MEASURED_SKILL $task" --model "$model" --output-format stream-json --verbose --dangerously-skip-permissions)
  local readback=(node "$VR_KIT/extract-rounds.mjs" --single "$ws/_local/$task/04_verify.md" --task "$task" --round "$((10#$round))")
  echo "replay-round.sh: [$arm] $task round $round @ $commit"
  echo "  seed:      ${seed_cmd[*]}"
  echo "  overlay:   ${mat_cmd[*]}"
  echo "  measure:   (cd $ws && ${cfg:+CLAUDE_CONFIG_DIR=$cfg }${measure[*]} > $dest/round-$round.transcript.jsonl 2>&1)"
  echo "  read-back: ${readback[*]} > $dest/round-$round.json"
  if [ "$spend" -ne 1 ]; then echo "  (dry run — pass --spend to execute)"; return 0; fi
  command -v claude >/dev/null 2>&1 || die "the claude CLI is not on PATH"
  "${seed_cmd[@]}" >&2
  "${mat_cmd[@]}" >&2
  (cd "$ws" && env ${cfg:+"CLAUDE_CONFIG_DIR=$cfg"} "${measure[@]}" > "$dest/round-$round.transcript.jsonl" 2>&1)
  [ -f "$ws/_local/$task/04_verify.md" ] || die "the replayed audit wrote no 04_verify.md — see $dest/round-$round.transcript.jsonl"
  "${readback[@]}" > "$dest/round-$round.json"
  cp "$ws/_local/$task/04_verify.md" "$dest/round-$round.md"
  cp "$ws/_local/fake/op-log.jsonl" "$dest/round-$round.op-log.jsonl" 2>/dev/null || true
  echo "replay-round.sh: [$arm] $task round $round → $(jq -r '.verdict' "$dest/round-$round.json") (recorded $(jq -r '.verdict' "$rec"))"
}

if [ "$all" -eq 1 ]; then
  for it in "$PACK_DIR"/corpus/items/verify-replay-*; do
    for r in "$it"/rounds/round-*.json; do
      run_one "$it" "$(basename "$r" .json | sed 's/round-//')"
    done
  done
else
  [ -n "$item" ] && [ -n "$round" ] || die "--item and --round are required (or --all)"
  run_one "$item" "$round"
fi
