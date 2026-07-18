#!/usr/bin/env bash
# assert-run.sh — evaluate the three structural assertion families against ONE run-output
# directory, given an expectations file (expect.json). Structural over transcript +
# workspace + op log; never an exact-match on transcript prose (locked decision 1).
#
# Sourcing this file defines the eval_* functions WITHOUT running; protocol.sh and
# compare.sh source it to evaluate each run in a set. Run directly for a single-run check:
#   assert-run.sh <run-dir> <expect.json>
#
# expect.json schema:
#   { "scenario": "<name>", "skill": "<invocation>",
#     "families": {
#       "terminal_block": { "name": "BRANCH", "status_ere": "^(created|already-active)$", "min_pass_rate": 1.0 },
#       "files_touched":  { "required_globs": ["_local/fake/op-log.jsonl"], "forbidden_globs": [], "min_pass_rate": 1.0 },
#       "ops_invoked":    { "required_ops": ["delivery:branch-create"], "min_pass_rate": 1.0 } } }
#
# Each eval_* prints one line: "<PASS|FAIL>\t<observed-canonical-value>". The observed
# value is the family's structural signature for that run — the protocol aggregates it
# across N runs to measure variance (drift vs regression).
set -uo pipefail

_ASSERT_RUN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$_ASSERT_RUN_DIR/lib.sh"

# eval_terminal_block <run-dir> <expect.json>
eval_terminal_block() {
  local run="$1" expect="$2" exp_name exp_status_ere observed name status verdict
  exp_name="$(jq -r '.families.terminal_block.name // empty' "$expect")"
  exp_status_ere="$(jq -r '.families.terminal_block.status_ere // ".+"' "$expect")"
  if ! observed="$(extract_terminal_block "$run/transcript.jsonl")"; then
    printf 'FAIL\t<no-terminal-block>\n'; return
  fi
  name="$(printf '%s' "$observed" | cut -f1)"
  status="$(printf '%s' "$observed" | cut -f2)"
  verdict=PASS
  [ -n "$exp_name" ] && [ "$name" != "$exp_name" ] && verdict=FAIL
  printf '%s' "$status" | grep -Eq "$exp_status_ere" || verdict=FAIL
  printf '%s\t%s|%s\n' "$verdict" "$name" "$status"
}

# eval_files_touched <run-dir> <expect.json>
eval_files_touched() {
  local run="$1" expect="$2" g verdict=PASS missing="" forbidden_hit=""
  while IFS= read -r g; do
    [ -n "$g" ] || continue
    workspace_has_glob "$run" "$g" || { verdict=FAIL; missing="$missing $g"; }
  done < <(jq -r '.families.files_touched.required_globs // [] | .[]' "$expect")
  while IFS= read -r g; do
    [ -n "$g" ] || continue
    workspace_has_glob "$run" "$g" && { verdict=FAIL; forbidden_hit="$forbidden_hit $g"; }
  done < <(jq -r '.families.files_touched.forbidden_globs // [] | .[]' "$expect")
  # Observed canonical value: the sorted snapshot file list, hashed to a short signature.
  local sig; sig="$(list_workspace_files "$run" | LC_ALL=C sort | cksum | awk '{print $1}')"
  local detail="files-sig:$sig"
  [ -n "$missing" ] && detail="$detail missing:$missing"
  [ -n "$forbidden_hit" ] && detail="$detail forbidden:$forbidden_hit"
  printf '%s\t%s\n' "$verdict" "$detail"
}

# eval_ops_invoked <run-dir> <expect.json>
eval_ops_invoked() {
  local run="$1" expect="$2" op verdict=PASS missing="" observed
  observed="$(extract_ops "$run" | tr '\n' ',' | sed 's/,$//')"
  while IFS= read -r op; do
    [ -n "$op" ] || continue
    case ",$observed," in *",$op,"*) : ;; *) verdict=FAIL; missing="$missing $op";; esac
  done < <(jq -r '.families.ops_invoked.required_ops // [] | .[]' "$expect")
  local detail="ops:[$observed]"
  [ -n "$missing" ] && detail="$detail missing:$missing"
  printf '%s\t%s\n' "$verdict" "$detail"
}

# assert_run_one <run-dir> <expect.json> — print the three family lines, tab-prefixed with
# the family name. Used by run-directly mode and (indirectly) by the protocol.
assert_run_one() {
  local run="$1" expect="$2"
  printf 'terminal_block\t%s\n' "$(eval_terminal_block "$run" "$expect")"
  printf 'files_touched\t%s\n'  "$(eval_files_touched  "$run" "$expect")"
  printf 'ops_invoked\t%s\n'    "$(eval_ops_invoked    "$run" "$expect")"
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  require_jq || exit 2
  [ $# -eq 2 ] || { echo "usage: assert-run.sh <run-dir> <expect.json>" >&2; exit 2; }
  assert_run_one "$1" "$2"
fi
