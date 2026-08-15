#!/usr/bin/env bash
# check-skill-body-length.sh — craft-C4 check (3): the skill body-length budget.
#
# CLAUDE.md §5: "Body budget: keep under ~500 lines; split into references/<topic>.md
# one level deep." This check asserts the numeric half of that rule and nothing
# else — a body of 500 lines or more is a violation, because "under 500" makes
# 500 itself the first non-conforming length.
#
# WHAT THIS CHECK IS NOT
# It measures the WHOLE FILE, frontmatter included, because that is what an author
# sees in an editor and what the guidance is written against. It says nothing about
# where the overflow should go — splitting into `references/` one level deep is the
# author's call, and the failure message points at the rule rather than prescribing
# a split.
#
# It is also NOT the ops-doc budget. The ≤150-line ceiling on a runtime-read ops
# doc is a DIFFERENT rule over a DIFFERENT target set (`_contracts/*.ops.md`, not
# `SKILL.md`), and it is already owned and enforced elsewhere in this repository by
# `plugins/wf/skills/_contracts/check-ops-docs.sh` GUARD 1. Do not add an ops-budget
# assertion here: two scripts asserting one budget is how the two drift apart.
#
# Target set + structural fixture exclusions + the deference rule: skill-targets.sh.
#
# Usage:  check-skill-body-length.sh [<repo-root>]   check the live tree (default; used by run.sh)
#         check-skill-body-length.sh --selftest      drive the seeded fixtures and assert each behaves
#
# Exit 0 = clean; exit 1 = a violation (or a selftest fixture misbehaved).
#
# Model: claude-opus-5[1m]
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"

CHECK="check-skill-body-length"
MAXLINES=500   # "under ~500 lines" — 500 is the first non-conforming length.

# lint_one <file> — echo one line per violation; silent when clean.
lint_one() {
  local file="$1" lines
  lines="$(wc -l < "$file")"
  lines="${lines// /}"
  if [ "$lines" -ge "$MAXLINES" ]; then
    echo "$file: body is $lines lines — at or over the $MAXLINES-line budget (rule: keep a skill body under $MAXLINES lines; split the overflow into references/<topic>.md, one level deep)."
  fi
}

# --- --selftest: prove the check discriminates before it is trusted ------------
if [ "${1:-}" = "--selftest" ]; then
  FIX="$DIR/craft-fixtures/body-length"
  st=0
  expect_clean() {
    local out; out="$(lint_one "$FIX/$1/SKILL.md")"
    if [ -n "$out" ]; then
      echo "selftest FAIL: $1 — expected CLEAN, got:"; echo "$out"; st=1
    else
      echo "selftest ok (clean): $1"
    fi
  }
  expect_violation() {
    local fx="$1"; shift
    local out; out="$(lint_one "$FIX/$fx/SKILL.md")"
    if [ -z "$out" ]; then
      echo "selftest FAIL: $fx — expected a violation, got CLEAN."; st=1; return
    fi
    local s
    for s in "$@"; do
      case "$out" in *"$s"*) ;; *) echo "selftest FAIL: $fx — output missing '$s'. Got:"; echo "$out"; st=1 ;; esac
    done
    [ "$st" -eq 0 ] && echo "selftest ok (violation): $fx"
  }

  expect_clean     clean
  expect_violation over-budget "at or over the $MAXLINES-line budget"

  # The boundary is the whole point of the rule, so assert it directly rather than
  # trusting that the over-budget fixture happens to sit on the right side of it.
  overlines="$(wc -l < "$FIX/over-budget/SKILL.md")"
  overlines="${overlines// /}"
  if [ "$overlines" -lt "$MAXLINES" ]; then
    echo "selftest FAIL: over-budget fixture is only $overlines lines — it no longer exceeds the $MAXLINES-line budget it exists to trip."; st=1
  fi

  if [ "$st" -ne 0 ]; then echo "$CHECK selftest: FAIL"; exit 1; fi
  echo "$CHECK selftest: PASS — the over-budget fixture ($overlines lines) is caught and the clean case stays silent."
  exit 0
fi

# --- Default: scan the live target set ----------------------------------------
ROOT="${1:-$(craft_repo_root)}"
hits=""
count=0
longest=0
longest_file=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  count=$((count + 1))
  n="$(wc -l < "$f")"
  n="${n// /}"
  if [ "$n" -gt "$longest" ]; then longest="$n"; longest_file="$f"; fi
  out="$(lint_one "$f")"
  [ -n "$out" ] && hits="$hits$out"$'\n'
done < <(craft_skill_targets "$ROOT")

craft_require_nonempty "$count" "$CHECK" || exit 1

if [ -n "$hits" ]; then
  echo "$CHECK: FAIL — skill bodies over the $MAXLINES-line budget ($count skill bodies scanned):"
  printf '%s' "$hits"
  exit 1
fi
echo "$CHECK: PASS — all $count skill bodies are under $MAXLINES lines (longest: $longest lines, $longest_file)."
exit 0
