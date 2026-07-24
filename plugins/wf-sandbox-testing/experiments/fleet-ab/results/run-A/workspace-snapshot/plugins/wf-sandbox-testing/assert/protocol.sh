#!/usr/bin/env bash
# protocol.sh — the statistical N-run assertion protocol over a run SET.
#
# Given a directory OF run-output dirs (one per run of the same scenario) and an
# expectations file, it evaluates the three structural families on every run, then judges
# each family variance-aware: a per-assertion tunable threshold (min_pass_rate) turns N
# per-run booleans into ONE verdict that distinguishes DRIFT (some runs vary but the pass
# rate holds at/above threshold) from REGRESSION (pass rate falls below threshold). It
# emits ONE report with per-family pass/fail, run counts, variance, and per-run token cost
# parsed from each transcript. It NEVER exact-matches transcript prose.
#
# The protocol runs sequentially over already-produced run outputs — it schedules nothing
# and spawns no workers; parallel PRODUCTION of run sets is /wf:fleet's job (see README.md).
#
# Usage: protocol.sh --set <run-set-dir> --expect <expect.json> [--tier <name>] \
#                    [--model <id>] [--report <out-file>]
set -uo pipefail

_PROTO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=assert-run.sh
. "$_PROTO_DIR/assert-run.sh"

FAMILIES="terminal_block files_touched ops_invoked"

# run_protocol writes the report to stdout (and, if REPORT is set, tees to that file) and
# returns 0 when every family passes, 1 when any family regresses.
run_protocol() {
  local set_dir="$1" expect="$2" tier="${3:-statistical}" model="${4:-<unset>}"
  local scenario; scenario="$(jq -r '.scenario // "unnamed"' "$expect")"

  # Collect run dirs.
  local -a runs=()
  local d
  while IFS= read -r d; do runs+=("$d"); done < <(list_run_dirs "$set_dir")
  local n=${#runs[@]}

  # Per-family accumulators (pass count + distinct observed signatures).
  local fam
  declare -A pass_count seen_sigs distinct
  for fam in $FAMILIES; do pass_count[$fam]=0; distinct[$fam]=0; seen_sigs[$fam]=""; done

  # Token cost per run.
  local -a cost_usd=() cost_tok=()

  local idx=0
  for d in "${runs[@]}"; do
    idx=$((idx + 1))
    # families
    local out line v sig
    out="$(assert_run_one "$d" "$expect")"
    while IFS=$'\t' read -r fam v sig; do
      [ -n "$fam" ] || continue
      [ "$v" = PASS ] && pass_count[$fam]=$(( ${pass_count[$fam]} + 1 ))
      case " ${seen_sigs[$fam]} " in
        *" $sig "*) : ;;
        *) seen_sigs[$fam]="${seen_sigs[$fam]} $sig"; distinct[$fam]=$(( ${distinct[$fam]} + 1 ));;
      esac
    done <<< "$out"
    # token cost
    local tc u t
    tc="$(parse_token_cost "$d/transcript.jsonl")"
    u="$(printf '%s' "$tc" | sed -E 's/.*usd=([^ ]+).*/\1/')"
    t="$(printf '%s' "$tc" | sed -E 's/.*tokens=([^ ]+).*/\1/')"
    cost_usd+=("$u"); cost_tok+=("$t")
  done

  # Mean token cost (awk for the float mean; integer token mean).
  local mean_usd=0 mean_tok=0
  if [ "$n" -gt 0 ]; then
    mean_usd="$(printf '%s\n' "${cost_usd[@]}" | awk '{s+=$1} END{printf "%.6f", (NR? s/NR:0)}')"
    mean_tok="$(printf '%s\n' "${cost_tok[@]}" | awk '{s+=$1} END{printf "%d", (NR? s/NR:0)}')"
  fi

  # Compose the report.
  local overall=PASS
  local body="" hdr
  hdr="=== wf-sandbox-testing assertion report ===
Scenario:  $scenario
Tier:      $tier    Model: $model    Runs: $n"
  body="$body\nAssertion families (structural — never a transcript exact-match):"
  if [ "$n" -eq 0 ]; then
    overall=FAIL
    body="$body\n  (no run outputs found in $set_dir — nothing to judge)"
  fi
  for fam in $FAMILIES; do
    [ "$n" -gt 0 ] || break
    local thr pr k dcount verdict variance note
    thr="$(jq -r --arg f "$fam" '.families[$f].min_pass_rate // 1.0' "$expect")"
    k=${pass_count[$fam]}
    dcount=${distinct[$fam]}
    # pass_rate = k/n; PASS when pass_rate >= threshold.
    pr="$(awk -v k="$k" -v n="$n" 'BEGIN{printf "%.3f", (n? k/n:0)}')"
    verdict="$(awk -v pr="$pr" -v thr="$thr" 'BEGIN{print (pr+1e-9>=thr)?"PASS":"FAIL"}')"
    if [ "$dcount" -le 1 ] && [ "$k" -eq "$n" ]; then
      variance="none"; note="stable across all runs"
    elif [ "$verdict" = PASS ]; then
      variance="drift"; note="observed variance within threshold (drift, not regression)"
    else
      variance="regression"; note="pass rate $pr below threshold $thr — REGRESSION"
    fi
    [ "$verdict" = FAIL ] && overall=FAIL
    body="$body\n  $(printf '%-15s %-5s pass-rate %s (%d/%d)  distinct-obs %d  threshold %s  variance:%s — %s' \
        "$fam" "$verdict" "$pr" "$k" "$n" "$dcount" "$thr" "$variance" "$note")"
  done

  # Per-run token cost line.
  local costline="" i
  for i in $(seq 0 $(( n - 1 )) ); do
    [ "$n" -gt 0 ] || break
    costline="$costline run$((i+1))=\$${cost_usd[$i]}(${cost_tok[$i]}tok)"
  done
  body="$body\nToken cost (per run): ${costline:- n/a}"
  body="$body\nToken cost (mean):    \$$mean_usd ($mean_tok tok)"
  body="$body\nVerdict: $overall"

  local report; report="$(printf '%b' "$hdr$body")"
  printf '%s\n' "$report"
  if [ -n "${REPORT:-}" ]; then printf '%s\n' "$report" > "$REPORT"; fi
  [ "$overall" = PASS ] && return 0 || return 1
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  require_jq || exit 2
  SET_DIR=""; EXPECT=""; TIER="statistical"; MODEL="<unset>"; REPORT=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --set) SET_DIR="${2:?}"; shift 2;;
      --expect) EXPECT="${2:?}"; shift 2;;
      --tier) TIER="${2:?}"; shift 2;;
      --model) MODEL="${2:?}"; shift 2;;
      --report) REPORT="${2:?}"; shift 2;;
      *) echo "protocol.sh: unknown argument '$1'" >&2; exit 2;;
    esac
  done
  [ -n "$SET_DIR" ] && [ -n "$EXPECT" ] || { echo "usage: protocol.sh --set <dir> --expect <expect.json> [--tier t] [--model id] [--report f]" >&2; exit 2; }
  export REPORT
  run_protocol "$SET_DIR" "$EXPECT" "$TIER" "$MODEL"
fi
