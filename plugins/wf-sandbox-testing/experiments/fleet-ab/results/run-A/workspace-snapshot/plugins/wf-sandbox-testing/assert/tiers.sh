#!/usr/bin/env bash
# tiers.sh — the two invocable assertion tiers, SMOKE and STATISTICAL, each runnable to
# completion from a SINGLE command that emits ONE report.
#
#   tiers.sh smoke       --scenario <dir> [--runs-dir <dir>] [--report <f>]
#   tiers.sh statistical --scenario <dir> [--runs-dir <dir>] [--report <f>]
#   tiers.sh <tier>      --scenario <dir> --print-model      # resolve + print the tier model/runs, run nothing
#
# SMOKE = cheap model + few runs (a fast trust check); STATISTICAL = the full N-run
# protocol (schedulable by the host operator into idle windows). The PER-TIER MODEL is a
# settings key resolved through the override machinery below — changing it changes the
# model the tier runs with and NEVER touches harness code.
#
# Model/runs resolution precedence (override > default — the same hybrid precedence the
# resolver applies to capability profiles and per-skill settings; adopted here in file
# form because the harness is shell, not a slotted skill the MCP resolver can query — the
# WF-346 Assumption-5 spec-time decision, see README.md):
#   1. env  WF_ASSERT_<TIER>_MODEL / WF_ASSERT_<TIER>_RUNS           (host-operator override)
#   2. file WF_ASSERT_SETTINGS_OVERRIDE            .tiers.<tier>.{model,runs}
#   3. file <workspace>/_local/wf-sandbox-testing/tiers.settings.json .tiers.<tier>.{model,runs}
#   4. committed default  tiers.settings.json      .tiers.<tier>.{model,runs}
#
# Run PRODUCTION vs CONSUMPTION: this entrypoint CONSUMES a run set (a directory of
# run-output dirs) and judges it. Producing the run set is the WF-345 runner's job; when a
# container runner and credentials are available a wrapper can drive runner/run-skill.sh N
# times with the resolved --model, but the assertion layer itself neither requires a
# container nor schedules anything — parallel production is /wf:fleet's job (see README.md).
set -uo pipefail

_TIERS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=protocol.sh
. "$_TIERS_DIR/protocol.sh"

DEFAULT_SETTINGS="$_TIERS_DIR/tiers.settings.json"

# workspace_root — best-effort project root for the downstream override file.
workspace_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

# resolve_setting <tier> <key> — apply the override>default precedence; print the value.
resolve_setting() {
  local tier="$1" key="$2" up val envname
  up="$(printf '%s' "$tier" | tr '[:lower:]' '[:upper:]')"
  envname="WF_ASSERT_${up}_$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')"
  # 1. direct env override
  val="${!envname:-}"
  [ -n "$val" ] && { printf '%s' "$val"; return; }
  # 2. explicit override file
  if [ -n "${WF_ASSERT_SETTINGS_OVERRIDE:-}" ] && [ -f "$WF_ASSERT_SETTINGS_OVERRIDE" ]; then
    val="$(jq -r --arg t "$tier" --arg k "$key" '.tiers[$t][$k] // empty' "$WF_ASSERT_SETTINGS_OVERRIDE" 2>/dev/null)"
    [ -n "$val" ] && { printf '%s' "$val"; return; }
  fi
  # 3. downstream project override
  local proj; proj="$(workspace_root)/_local/wf-sandbox-testing/tiers.settings.json"
  if [ -f "$proj" ]; then
    val="$(jq -r --arg t "$tier" --arg k "$key" '.tiers[$t][$k] // empty' "$proj" 2>/dev/null)"
    [ -n "$val" ] && { printf '%s' "$val"; return; }
  fi
  # 4. committed default
  jq -r --arg t "$tier" --arg k "$key" '.tiers[$t][$k] // empty' "$DEFAULT_SETTINGS" 2>/dev/null
}

main() {
  require_jq || exit 2
  local tier="${1:-}"; shift || true
  case "$tier" in smoke|statistical) : ;; *)
    echo "usage: tiers.sh <smoke|statistical> --scenario <dir> [--runs-dir <dir>] [--report <f>] [--print-model]" >&2
    exit 2;; esac

  local scenario="" runs_dir="" report="" print_model=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --scenario) scenario="${2:?}"; shift 2;;
      --runs-dir) runs_dir="${2:?}"; shift 2;;
      --report) report="${2:?}"; shift 2;;
      --print-model) print_model=1; shift;;
      *) echo "tiers.sh: unknown argument '$1'" >&2; exit 2;;
    esac
  done

  local model runs
  model="$(resolve_setting "$tier" model)"
  runs="$(resolve_setting "$tier" runs)"
  [ -n "$model" ] || { echo "tiers.sh: no model resolved for tier '$tier' — check tiers.settings.json" >&2; exit 2; }

  if [ "$print_model" = 1 ]; then
    printf 'tier=%s model=%s runs=%s\n' "$tier" "$model" "$runs"
    return 0
  fi

  [ -n "$scenario" ] || { echo "tiers.sh: --scenario <dir> is required" >&2; exit 2; }
  [ -n "$runs_dir" ] || runs_dir="$scenario/runs-current"
  local expect="$scenario/expect.json"
  [ -f "$expect" ] || { echo "tiers.sh: expectations file not found: $expect" >&2; exit 2; }
  [ -d "$runs_dir" ] || { echo "tiers.sh: run set not found: $runs_dir" >&2; exit 2; }

  export REPORT="$report"
  run_protocol "$runs_dir" "$expect" "$tier" "$model"
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
