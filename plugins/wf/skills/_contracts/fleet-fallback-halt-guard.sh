#!/usr/bin/env bash
# fleet-fallback-halt-guard.sh — the fleet dispatch brief's project-pipeline
# fallback chain must halt a non-success item BEFORE its pull-request and
# finalize edges.
#
# This is a reachability assertion over the chain's decision graph, not a
# re-read of its wording: the evaluator resolves each routed step by its
# routing tokens, derives which pipeline-driver outcomes that step admits, and
# then asserts the recorded per-item outcome for each outcome token.
#
# It also asserts the halt is READABLE: the orchestrator must map a reported
# halt onto the item's `blocked` row state and the row must state a rendering
# for a state and its reason, so a halt is never inferred from an absent row.
#
# --selftest runs the same evaluator over six seeded synthetic chains,
# including the exact pre-fix shape (both trailing steps unconditional), and
# requires the evaluator to reject every defective one and accept the sound one.
#
# Model: claude-opus-5[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
FLEET="$ROOT/plugins/wf/skills/fleet/SKILL.md"

command -v python3 >/dev/null 2>&1 || {
  echo "fleet-fallback-halt-guard: python3 is required" >&2
  exit 2
}

evaluate() {
  python3 "$DIR/fleet-fallback-halt-eval.py" "$1"
}

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)" || { echo "fleet-fallback-halt-guard: cannot create temp dir" >&2; exit 2; }
  trap 'rm -rf "$tmp"' EXIT
  if ! python3 "$DIR/fleet-fallback-halt-eval.py" --emit-fixtures "$tmp"; then
    echo "fleet-fallback-halt-guard: could not synthesize self-test fixtures" >&2
    exit 2
  fi
  selftest_fail=0
  for name in pre-fix halt-clause-incomplete gated-step-damaged row-recording-absent halt-clause-masks-step; do
    if evaluate "$tmp/$name.md" >/dev/null 2>&1; then
      echo "fleet-fallback-halt-guard: SELFTEST FAIL — the evaluator accepted the seeded '$name' chain" >&2
      selftest_fail=$((selftest_fail + 1))
    fi
  done
  if ! evaluate "$tmp/sound.md" >/dev/null 2>&1; then
    echo "fleet-fallback-halt-guard: SELFTEST FAIL — the evaluator rejected the seeded sound chain" >&2
    evaluate "$tmp/sound.md" >&2
    selftest_fail=$((selftest_fail + 1))
  fi
  if [ "$selftest_fail" -ne 0 ]; then
    echo "fleet-fallback-halt-guard: self-test FAILED ($selftest_fail case(s))" >&2
    exit 1
  fi
  echo "fleet-fallback-halt-guard: self-test passed — the evaluator rejects the pre-fix, incomplete-halt, damaged-gated-step, unrecorded-halt and halt-clause-masked chains and accepts the sound one."
  exit 0
fi

if [ ! -f "$FLEET" ]; then
  echo "fleet-fallback-halt-guard: dispatch-brief file is absent: $FLEET" >&2
  exit 2
fi

if evaluate "$FLEET"; then
  exit 0
fi
exit 1
