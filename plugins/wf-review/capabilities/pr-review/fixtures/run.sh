#!/usr/bin/env bash
#
# run.sh — fixture suite for the pr-review capability.
#
# CI discovers this file by the convention `plugins/*/capabilities/*/fixtures/run.sh`
# (see .github/workflows/ci.yml), so nothing had to be added to the workflow to gate it.
#
# It runs the post-merge review sweep guard (WF-522) in both modes:
#
#   - --selftest, over seeded text in both polarities. This is what proves the guard is
#     not inert: a checker wired only to the real tree passes just as quietly when its
#     literals have drifted out of the prose as when the prose is correct.
#   - the default live-tree scan, which asserts the shipped sweep satisfies every
#     obligation the three fixtures in `sweep-fixtures/` declare.
#
# Model: claude-opus-5[1m]
#
# Usage:
#   bash plugins/wf-review/capabilities/pr-review/fixtures/run.sh

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

pass=0
fail=0

echo "=== Post-merge review sweep guard — seeded self-test ==="
if bash "$DIR/closeout-sweep-guard.sh" --selftest; then
  printf 'PASS: %s\n' "closeout sweep guard self-test"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "closeout sweep guard self-test"
  fail=$((fail + 1))
fi

echo ""
echo "=== Post-merge review sweep guard — live-tree scan ==="
if bash "$DIR/closeout-sweep-guard.sh"; then
  printf 'PASS: %s\n' "closeout sweep guard live-tree scan"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "closeout sweep guard live-tree scan"
  fail=$((fail + 1))
fi

echo ""
printf 'Results: %s passed, %s failed.\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
