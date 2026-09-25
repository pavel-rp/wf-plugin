#!/usr/bin/env bash
#
# run.sh — fixture suite for the audit capability (and its sibling sr capability's gate map).
#
# CI discovers this file by the convention `plugins/*/capabilities/*/fixtures/run.sh`
# (see .github/workflows/ci.yml), so nothing had to be added to the workflow to gate it.
#
# It runs the gate-map drift fixture: the pack's shipped gate maps pass the unmodified core guard,
# and a label added to the lens finding contract, sr's self-review grammar, or the retrospective
# verdict fails it naming the label.
#
# Model: claude-opus-5-5
#
# Usage:
#   bash plugins/wf-audit/capabilities/audit/fixtures/run.sh

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass=0
fail=0

echo "=== Gate-map drift fixture ==="
if bash "$DIR/gate-map-drift.sh"; then
  printf 'PASS: %s\n' "gate-map drift fixture"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "gate-map drift fixture"
  fail=$((fail + 1))
fi

echo ""
printf 'Results: %s passed, %s failed.\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
