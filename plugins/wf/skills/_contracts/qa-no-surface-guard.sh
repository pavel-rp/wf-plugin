#!/usr/bin/env bash
# qa-no-surface-guard.sh — a task with no runnable surface (no browser route, no
# HTTP endpoint or callable service) must yield a 06_qa.md that /wf:qa-auto's
# "no runnable scenarios of any kind" edge case recognises: exactly one TC-NNN
# scenario, that one the N/A baseline, no runnable availability cell, and no
# API scenario. Anything else makes qa-auto dispatch an engine against a
# deliverable it cannot drive, and the QA tail never reaches PASS.
#
# Modes:
#   --check <plan.md>  evaluate one plan file against the shape (exit 0 = conforms)
#   --selftest         run --check over the seeded fixtures in qa-no-surface-fixtures/:
#                      pass-*.md must conform, fail-*.md must each be rejected
#   (no argument)      real-tree scan: qa-gen's SKILL.md and qa-template.md carry
#                      the no-runnable-surface rules, qa-auto still carries the skip
#                      predicate, and the shipped pass fixture conforms
#
# Model: claude-opus-5-5
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
FIXTURES="$DIR/qa-no-surface-fixtures"
QA_GEN="$ROOT/plugins/wf/skills/qa-gen/SKILL.md"
QA_TEMPLATE="$ROOT/plugins/wf/skills/qa-gen/references/qa-template.md"
QA_AUTO="$ROOT/plugins/wf/skills/qa-auto/SKILL.md"
NA_TOKEN='[N/A: no runnable surface'

# check_plan <file> — prints one reason per violation; returns 0 when the plan conforms.
check_plan() {
  local plan="$1" bad=0 headings na_headings
  if [ ! -f "$plan" ]; then
    echo "  plan file is absent: $plan"
    return 2
  fi
  headings="$(grep -cE '^### TC-[0-9]{3}:' "$plan")"
  if [ "$headings" -ne 1 ]; then
    echo "  expected exactly one TC-NNN scenario, found $headings"
    bad=1
  fi
  na_headings="$(grep -E '^### TC-[0-9]{3}:' "$plan" | grep -cF "$NA_TOKEN")"
  if [ "$na_headings" -ne 1 ]; then
    echo "  the N/A baseline scenario ('$NA_TOKEN ...') is not the plan's scenario"
    bad=1
  fi
  if grep -qE '\|[[:space:]]*runnable[[:space:]]*\|' "$plan"; then
    echo "  a coverage row carries a 'runnable' availability cell"
    bad=1
  fi
  if grep -qF '**Type:** API' "$plan"; then
    echo "  an API scenario is present"
    bad=1
  fi
  return "$bad"
}

# require_text <file> <label> <fixed-string> — real-tree anchor check.
require_text() {
  if [ ! -f "$1" ]; then
    echo "qa-no-surface-guard: file is absent: $1" >&2
    return 1
  fi
  if ! grep -qF -- "$3" "$1"; then
    echo "qa-no-surface-guard: $2 is missing its anchor: $3" >&2
    return 1
  fi
  return 0
}

case "${1:-}" in
  --check)
    if [ -z "${2:-}" ]; then
      echo "usage: qa-no-surface-guard.sh --check <plan.md>" >&2
      exit 2
    fi
    if check_plan "$2"; then
      echo "qa-no-surface-guard: $2 conforms to the no-runnable-surface plan shape."
      exit 0
    fi
    echo "qa-no-surface-guard: $2 does not conform to the no-runnable-surface plan shape." >&2
    exit 1
    ;;
  --selftest)
    fail=0
    seen_pass=0
    seen_fail=0
    for f in "$FIXTURES"/pass-*.md; do
      [ -f "$f" ] || continue
      seen_pass=$((seen_pass + 1))
      if ! out="$(check_plan "$f")"; then
        echo "qa-no-surface-guard: SELFTEST FAIL — rejected the conforming fixture $(basename "$f"):" >&2
        echo "$out" >&2
        fail=$((fail + 1))
      fi
    done
    for f in "$FIXTURES"/fail-*.md; do
      [ -f "$f" ] || continue
      seen_fail=$((seen_fail + 1))
      if check_plan "$f" >/dev/null; then
        echo "qa-no-surface-guard: SELFTEST FAIL — accepted the defective fixture $(basename "$f")" >&2
        fail=$((fail + 1))
      fi
    done
    if [ "$seen_pass" -eq 0 ] || [ "$seen_fail" -eq 0 ]; then
      echo "qa-no-surface-guard: SELFTEST FAIL — fixtures missing (pass: $seen_pass, fail: $seen_fail) under $FIXTURES" >&2
      exit 1
    fi
    if [ "$fail" -ne 0 ]; then
      echo "qa-no-surface-guard: self-test FAILED ($fail case(s))" >&2
      exit 1
    fi
    echo "qa-no-surface-guard: self-test passed — $seen_pass conforming fixture(s) accepted, $seen_fail defective fixture(s) rejected."
    exit 0
    ;;
  "")
    fail=0
    require_text "$QA_GEN" "qa-gen Phase 3" '**No runnable surface (decide once, before classifying).**' || fail=1
    require_text "$QA_GEN" "qa-gen Phase 3" 'never adapt a browser scenario into command-line' || fail=1
    require_text "$QA_GEN" "qa-gen Phase 3.5" 'emit the suite with exactly one scenario marked `[N/A: no runnable surface on this task]`' || fail=1
    require_text "$QA_GEN" "qa-gen Phase 3.6" '`Capability scenarios skipped — no runnable surface`' || fail=1
    require_text "$QA_TEMPLATE" "qa-template" '**Capability scenarios skipped — no runnable surface**' || fail=1
    require_text "$QA_TEMPLATE" "qa-template" 'No runnable surface on this task — every criterion is verified by build / automation below.' || fail=1
    require_text "$QA_AUTO" "qa-auto skip predicate" '[N/A: no runnable surface]' || fail=1
    if ! out="$(check_plan "$FIXTURES/pass-no-surface.md")"; then
      echo "qa-no-surface-guard: the shipped pass fixture no longer conforms:" >&2
      echo "$out" >&2
      fail=1
    fi
    if [ "$fail" -ne 0 ]; then
      exit 1
    fi
    echo "qa-no-surface-guard: real-tree scan passed — qa-gen and its template carry the no-runnable-surface rules and the shipped plan shape conforms to qa-auto's skip predicate."
    exit 0
    ;;
  *)
    echo "usage: qa-no-surface-guard.sh [--selftest | --check <plan.md>]" >&2
    exit 2
    ;;
esac
