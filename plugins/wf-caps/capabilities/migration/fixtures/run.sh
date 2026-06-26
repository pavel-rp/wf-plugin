#!/usr/bin/env bash
#
# run.sh — fixture test runner for validate-profile.sh.
#
# Runs the validator against every fixture in this directory and asserts each
# one's exit code and that its output names the specific bad slot / row / path.
# The fixtures ARE the test suite for the validator (this repo has no unit/
# integration harness), and this script makes that suite reproducible: it exits
# 0 only when every case behaves as specified, non-zero otherwise.
#
# Model: claude-opus-4-8
#
# Usage:
#   bash plugins/wf-caps/capabilities/migration/fixtures/run.sh

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$DIR/../validate-profile.sh"

pass=0
fail=0

# assert <name> <fixture> <expected-exit> [required-substring ...]
#
# Runs the validator on <fixture>, then checks the exit code matches and that
# every required substring appears in the output. Output is captured (not a
# TTY), so the validator emits no color codes — plain-text matching is exact.
assert() {
  local name="$1" fixture="$2" want_exit="$3"; shift 3
  local out got_exit ok=1 sub

  out="$(bash "$VALIDATOR" "$DIR/$fixture" 2>&1)"
  got_exit=$?

  if [ "$got_exit" -ne "$want_exit" ]; then
    ok=0
    printf 'FAIL: %s — expected exit %s, got %s\n' "$name" "$want_exit" "$got_exit"
  fi
  for sub in "$@"; do
    case "$out" in
      *"$sub"*) ;;
      *) ok=0; printf 'FAIL: %s — output missing expected text: %s\n' "$name" "$sub" ;;
    esac
  done

  if [ "$ok" -eq 1 ]; then
    printf 'PASS: %s\n' "$name"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

assert "valid profile passes"        valid-profile.json 0
assert "missing slot named"          missing-slot.json  1 "missing required slot" "rule-checks"
assert "malformed row named"         malformed-row.json 1 "type-map" "row 1" "source-type"
assert "dangling hook path named"    dangling-path.json 1 "dangling" "playbooks"

echo ""
printf 'Results: %s passed, %s failed.\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
