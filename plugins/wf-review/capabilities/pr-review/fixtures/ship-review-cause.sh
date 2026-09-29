#!/usr/bin/env bash
#
# ship-review-cause.sh — the capped-outcome cause and review-completeness switch guard (WF-837).
#
# The `ship.review` fill (fragments/ship-review.md) classifies every capped outcome's cause as
# `no-post` or `request-failed` from the delivery provider's `review-request-read`, and applies
# an off-by-default review-completeness switch read from `_local/config.md`. This guard proves
# both halves in two ways:
#
#   1. TEXT — the shipped fill carries every clause the decision depends on (the read, both
#      cause tokens, the never-unknown rule, the switch key, its exact-`on` rule, the hand-back,
#      the unchanged timeout block) and the pack documents the switch's default as `off`.
#   2. DECISION TABLE — `decide` encodes the fill's Step 2 / Step 2b table, and `switch_state` /
#      `lenses_complete` encode its switch and lens-coverage parsing. Table-driven cases pin
#      every branch with the switch off and on, so a later edit that changes a decision must
#      change this table in the same change.
#
# Modes:
#   bash ship-review-cause.sh             # text checks over the live fill + the decision table
#   bash ship-review-cause.sh --selftest  # seeded defects in both polarities
#
# Model: claude-opus-5-5
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP="$(cd "$DIR/.." && pwd)"
FILL="$CAP/fragments/ship-review.md"
ONBOARD="$CAP/references/onboarding.md"

fails=0
err() { printf 'FAIL: %s\n' "$*"; fails=$((fails + 1)); }
ok()  { printf 'ok:   %s\n' "$*"; }

# ---------------------------------------------------------------------------
# The switch: `**Require Completed Review**` in a `## Review` section. On ONLY for the exact
# value `on` (case-insensitive; surrounding blanks and at most ONE matching outer backtick pair
# ignored); everything else off. An interior, unmatched or doubled backtick is part of the value,
# so a malformed cell such as `o`n never normalizes to on.
# ---------------------------------------------------------------------------
switch_state() {  # $1 = config text
  local v
  v=$(printf '%s\n' "$1" | awk '
    /^## / { insec = ($0 ~ /^## Review[[:space:]]*$/); next }
    insec && /\*\*Require Completed Review\*\*/ {
      n = split($0, cell, "|"); print cell[3]; exit
    }')
  v=$(printf '%s' "$v" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  case "$v" in
    \`*\`) v="${v#\`}"; v="${v%\`}" ;;   # one matching outer pair only (length >= 2 by the pattern)
  esac
  v=$(printf '%s' "$v" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | tr '[:upper:]' '[:lower:]')
  if [ "$v" = "on" ]; then echo on; else echo off; fi
}

# Complete in-run lens coverage: `<lc>/<le> completed` with le >= 1 and lc == le.
lenses_complete() {  # $1 = the **Lenses:** value, or empty when unreadable
  local lc le
  case "$1" in
    *[0-9]/[0-9]*" completed"*) ;;
    *) echo no; return ;;
  esac
  lc=$(printf '%s' "$1" | sed -E 's/^[^0-9]*([0-9]+)\/([0-9]+) completed.*/\1/')
  le=$(printf '%s' "$1" | sed -E 's/^[^0-9]*([0-9]+)\/([0-9]+) completed.*/\2/')
  if [ "$le" -ge 1 ] && [ "$lc" -eq "$le" ]; then echo yes; else echo no; fi
}

# The fill's decision for "no review present at HEAD_SHA".
#   $1 read-performed (true|false)  $2 pending  $3 request-events  $4 reviews
#   $5 who owns the wait (owned = --review-boundary without --review-lapsed | lapsed | none)
#   $6 switch (on|off)  $7 lenses value
# Prints: <decision> <cause>   where decision is one of
#   await   (request outstanding, the caller owns the wait — Handed-off, awaiting review; WF-944)
#   block   (deadline lapsed or not awaited — unknown, unchanged by the switch)
#   pass    (capped merge)
#   handback
decide() {
  local rp="$1" pending="$2" events="$3" reviews="$4" wait="$5" sw="$6" lenses="$7" cause
  if [ "$rp" = true ] && [ "$pending" -gt 0 ]; then
    if [ "$wait" = owned ]; then echo "await -"; return; fi
    echo "block no-post"; return
  fi
  # <requested> = any of pending, request-events or reviews above zero (review-request-read).
  if [ "$rp" = true ] && { [ "$events" -gt 0 ] || [ "$reviews" -gt 0 ]; }; then
    cause=no-post     # registered (or reviewed on an earlier commit), nothing at HEAD_SHA
  else
    cause=request-failed   # never registered, or the read could not be performed
  fi
  if [ "$sw" = off ]; then echo "pass $cause"; return; fi
  if [ "$(lenses_complete "$lenses")" = yes ]; then echo "pass $cause"; else echo "handback $cause"; fi
}

# ---------------------------------------------------------------------------
# TEXT — every clause the decision depends on is in the shipped fill.
# ---------------------------------------------------------------------------
check_fill_text() {  # $1 = fill path; prints FAIL lines, returns count via global
  local f="$1" before=$fails tok
  [ -f "$f" ] || { err "fill not found at $f"; return; }
  for tok in 'review-request-read' '`no-post`' '`request-failed`' 'never unknown' \
             '<request-events>' '<pending>' 'Step 2b' '**Require Completed Review**' '## Review' \
             'exactly `on`' 'The shipped default is off' 'hand back' 'Review: capped — <cause>' \
             "did not land by the caller's deadline (no-post)" 'not awaited — no caller-owned wait (no-post)' \
             'Built: awaiting review' '--review-lapsed' 'Never poll for it here' \
             '**Lenses:**' '<lc>` = `<le>`'; do
    grep -qF -- "$tok" "$f" || err "fill never states '$tok'"
  done
  if grep -qiE 'capped at a small number of attempts|within the capped polls' "$f"; then
    err "fill still polls a pending request a counted number of times — the wait is the caller's (WF-944)"
  fi
  grep -qF -- '| capped, switch on, no completed review | hand back' "$f" \
    || err "fill outcome table has no hand-back row for switch on without a completed review"
  grep -qF -- '| capped (`no-post` / `request-failed`), switch off | pass' "$f" \
    || err "fill outcome table has no capped-merge row for switch off"
  if grep -qiE 'reviewer-absent pass' "$f"; then
    err "fill still names a 'reviewer-absent pass' — that outcome is a capped merge with a recorded cause"
  fi
  [ "$fails" = "$before" ] && ok "fill text: the read, both causes, the switch and the hand-back are all stated"
}

check_onboarding_default() {
  local before=$fails
  [ -f "$ONBOARD" ] || { err "onboarding reference not found at $ONBOARD"; return; }
  grep -qF -- '| **Require Completed Review** | `off` |' "$ONBOARD" \
    || err "onboarding does not document the switch's template value as \`off\`"
  [ "$(switch_state "$(cat "$ONBOARD")")" = off ] || err "the documented template parses as ON"
  [ "$fails" = "$before" ] && ok "switch default: the documented template is off"
}

# ---------------------------------------------------------------------------
# DECISION TABLE — switch off and on.
# ---------------------------------------------------------------------------
expect() {  # label, expected, actual
  if [ "$2" = "$3" ]; then ok "$1 → $3"; else err "$1: expected '$2', got '$3'"; fi
}

check_decision_table() {
  local L='5/5 completed, 0 inline' P='1/5 completed, 4 inline' Z='0/0 completed, 0 inline'
  # switch off — today's decisions, cause recorded
  expect "off: pending, caller owns the wait"    "await -"                "$(decide true 1 1 0 owned  off "$P")"
  expect "off: pending, deadline lapsed"         "block no-post"          "$(decide true 1 1 0 lapsed off "$P")"
  expect "off: pending, nobody can wait"         "block no-post"          "$(decide true 1 1 0 none   off "$P")"
  expect "off: withdrawn request, nothing posted" "pass no-post"          "$(decide true 0 2 0 none   off "$P")"
  expect "off: withdrawn, caller owns a wait"    "pass no-post"           "$(decide true 0 2 0 owned  off "$P")"
  expect "off: never requested"                  "pass request-failed"    "$(decide true 0 0 0 none   off "$P")"
  expect "off: reviewed only on an earlier commit" "pass no-post"         "$(decide true 0 0 1 none   off "$P")"
  expect "off: read not performed"               "pass request-failed"    "$(decide false 0 0 0 none off "")"
  # switch on — a capped outcome needs complete in-run lens coverage
  expect "on: pending, caller owns the wait"     "await -"                "$(decide true 1 1 0 owned  on "$L")"
  expect "on: pending, deadline lapsed (unchanged)" "block no-post"       "$(decide true 1 1 0 lapsed on "$L")"
  expect "on: withdrawn, lenses complete"        "pass no-post"           "$(decide true 0 1 0 none   on "$L")"
  expect "on: withdrawn, lenses partial"         "handback no-post"       "$(decide true 0 1 0 none   on "$P")"
  expect "on: never requested, lenses partial"   "handback request-failed" "$(decide true 0 0 0 none on "$P")"
  expect "on: never requested, zero expected"    "handback request-failed" "$(decide true 0 0 0 none on "$Z")"
  expect "on: read not performed, no report"     "handback request-failed" "$(decide false 0 0 0 none on "")"
  # every outcome is a hand-back to the waiting caller or carries one of the two cause tokens —
  # never unknown, and an outstanding request is never a pass whoever owns the wait
  local rp p e sw w out
  for rp in true false; do for p in 0 1; do for e in 0 1; do for sw in on off; do for w in owned lapsed none; do
    out=$(decide "$rp" "$p" "$e" 0 "$w" "$sw" "$P")
    case "$out" in
      "await -"|"block no-post"|"pass no-post"|"pass request-failed"|"handback no-post"|"handback request-failed") ;;
      *) err "decide $rp $p $e 0 $w $sw → '$out' carries no closed cause" ;;
    esac
    if [ "$rp" = true ] && [ "$p" -gt 0 ]; then
      case "$out" in pass*) err "decide $rp $p $e 0 $w $sw → an outstanding request passed" ;; esac
    fi
  done; done; done; done; done
  # the switch parser
  expect "switch: absent section"  off "$(switch_state $'# x\n## Other\n| **Require Completed Review** | `on` |')"
  expect "switch: off"             off "$(switch_state $'## Review\n| Key | Value |\n| **Require Completed Review** | `off` |')"
  expect "switch: <none>"          off "$(switch_state $'## Review\n| **Require Completed Review** | `<none>` |')"
  expect "switch: empty"           off "$(switch_state $'## Review\n| **Require Completed Review** |  |')"
  expect "switch: near-miss"       off "$(switch_state $'## Review\n| **Require Completed Review** | `onn` |')"
  expect "switch: on"              on  "$(switch_state $'## Review\n| **Require Completed Review** | `on` |')"
  expect "switch: ON, bare"        on  "$(switch_state $'## Review\n| **Require Completed Review** | ON |')"
  expect "switch: padded \`On\`"    on  "$(switch_state $'## Review\n| **Require Completed Review** |   `On`   |')"
  expect "switch: interior backtick" off "$(switch_state $'## Review\n| **Require Completed Review** | `o`n |')"
  expect "switch: interior, wrapped" off "$(switch_state $'## Review\n| **Require Completed Review** | `o`n` |')"
  expect "switch: unmatched open"  off "$(switch_state $'## Review\n| **Require Completed Review** | `on |')"
  expect "switch: unmatched close" off "$(switch_state $'## Review\n| **Require Completed Review** | on` |')"
  expect "switch: doubled pair"    off "$(switch_state $'## Review\n| **Require Completed Review** | ``on`` |')"
  expect "switch: lone backtick"   off "$(switch_state $'## Review\n| **Require Completed Review** | ` |')"
  expect "lenses: complete"        yes "$(lenses_complete '3/3 completed, 0 inline')"
  expect "lenses: inline counted as expected" no "$(lenses_complete '2/3 completed, 1 inline')"
  expect "lenses: zero expected"   no  "$(lenses_complete '0/0 completed, 0 inline')"
  expect "lenses: unreadable"      no  "$(lenses_complete 'unknown — no verify report')"
}

# ---------------------------------------------------------------------------
# --selftest — seeded defects must be caught, a clean copy must stay clean.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  st=0
  run_text() { ( fails=0; check_fill_text "$1"; exit "$fails" ) >/dev/null 2>&1; echo $?; }
  cp "$FILL" "$tmp/clean.md"
  [ "$(run_text "$tmp/clean.md")" = 0 ] || { echo "selftest FAIL: the clean fill copy reports defects"; st=1; }
  sed 's/`no-post`/`no-reply`/g' "$FILL" > "$tmp/no-cause.md"
  [ "$(run_text "$tmp/no-cause.md")" != 0 ] || { echo "selftest FAIL: a fill without the no-post cause passed"; st=1; }
  sed 's/exactly `on`/`on` or `yes`/' "$FILL" > "$tmp/loose-switch.md"
  [ "$(run_text "$tmp/loose-switch.md")" != 0 ] || { echo "selftest FAIL: a fill with a loosened switch passed"; st=1; }
  { cat "$FILL"; echo 'Re-read the review, capped at a small number of attempts (2).'; } > "$tmp/polls.md"
  [ "$(run_text "$tmp/polls.md")" != 0 ] || { echo "selftest FAIL: a fill reintroducing the counted poll passed"; st=1; }
  sed 's/--review-lapsed/--review-done/g' "$FILL" > "$tmp/no-lapse.md"
  [ "$(run_text "$tmp/no-lapse.md")" != 0 ] || { echo "selftest FAIL: a fill without the lapsed-deadline branch passed"; st=1; }
  { cat "$FILL"; echo 'This is an honest reviewer-absent pass.'; } > "$tmp/absent.md"
  [ "$(run_text "$tmp/absent.md")" != 0 ] || { echo "selftest FAIL: a fill reintroducing the reviewer-absent pass passed"; st=1; }
  # the decision table must reject a planted wrong decision
  planted=$( ( fails=0; expect "planted" "pass no-post" "handback no-post"; exit "$fails" ) >/dev/null 2>&1; echo $? )
  [ "$planted" != 0 ] || { echo "selftest FAIL: expect() accepted a mismatched decision"; st=1; }
  if [ "$st" -ne 0 ]; then echo "ship-review-cause selftest: FAIL"; exit 1; fi
  echo "ship-review-cause selftest: PASS — seeded defects caught, the clean copy stays clean"
  exit 0
fi

echo "== ship.review capped-cause and review-completeness guard =="
check_fill_text "$FILL"
check_onboarding_default
check_decision_table
if [ "$fails" -ne 0 ]; then
  echo "ship-review-cause: FAIL ($fails)"
  exit 1
fi
echo "ship-review-cause: PASS"
