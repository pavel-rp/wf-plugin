#!/usr/bin/env bash
# check-skill-name.sh — craft-C4 check (1): the skill `name` frontmatter field.
#
# CLAUDE.md §5 states two rules for `name` that nothing asserted until now:
#   R1. it is at most 64 characters;
#   R2. it matches its containing directory exactly.
#
# R2 is the one that breaks silently: a `name` that disagrees with its folder
# makes the skill fail to load with no error anywhere, and a `wf`/`wf-` prefix
# (the other classic mistake) is caught by the same equality — the namespace
# comes from the plugin, so `name: wf-spec` in `skills/spec/` is a mismatch.
#
# Target set + structural fixture exclusions + the deference rule: skill-targets.sh.
#
# Usage:  check-skill-name.sh [<repo-root>]   check the live tree (default; used by run.sh)
#         check-skill-name.sh --selftest      drive the seeded fixtures and assert each behaves
#
# Exit 0 = clean; exit 1 = a violation (or a selftest fixture misbehaved).
#
# Model: claude-opus-5[1m]
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"

CHECK="check-skill-name"
MAXLEN=64

# lint_one <file> — echo one line per violation; silent when clean.
lint_one() {
  local file="$1" name dir
  dir="$(basename "$(dirname "$file")")"
  name="$(craft_frontmatter_value "$file" name)"

  if [ -z "$name" ]; then
    echo "$file: frontmatter has no 'name' field — every skill declares a bare name matching its directory ('$dir')."
    return 0
  fi
  if [ "${#name}" -gt "$MAXLEN" ]; then
    echo "$file: name is ${#name} characters — over the $MAXLEN-character limit (rule: name <= $MAXLEN chars)."
  fi
  if [ "$name" != "$dir" ]; then
    echo "$file: name '$name' does not match its directory '$dir' (rule: name matches its directory exactly — the plugin supplies the namespace, so no wf/wf- prefix)."
  fi
}

# --- --selftest: prove the check discriminates before it is trusted ------------
if [ "${1:-}" = "--selftest" ]; then
  FIX="$DIR/craft-fixtures/name"
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

  # The over-length fixture's DIRECTORY carries the same 67-character name as its
  # `name` field, so the length rule fires in isolation and the assertion cannot
  # be satisfied by an incidental directory mismatch.
  LONG=over-length-skill-name-that-deliberately-exceeds-the-sixty-four-cap

  expect_clean     clean
  expect_violation "$LONG"    "over the $MAXLEN-character limit"
  expect_violation mismatched "does not match its directory"

  if [ "$st" -ne 0 ]; then echo "$CHECK selftest: FAIL"; exit 1; fi
  echo "$CHECK selftest: PASS — every seeded violation is caught and the clean case stays silent."
  exit 0
fi

# --- Default: scan the live target set ----------------------------------------
ROOT="${1:-$(craft_repo_root)}"
hits=""
count=0
while IFS= read -r f; do
  [ -n "$f" ] || continue
  count=$((count + 1))
  out="$(lint_one "$f")"
  [ -n "$out" ] && hits="$hits$out"$'\n'
done < <(craft_skill_targets "$ROOT")

craft_require_nonempty "$count" "$CHECK" || exit 1

if [ -n "$hits" ]; then
  echo "$CHECK: FAIL — skill 'name' frontmatter violations ($count skill bodies scanned):"
  printf '%s' "$hits"
  exit 1
fi
echo "$CHECK: PASS — all $count skill bodies declare a name <= $MAXLEN chars matching their directory."
exit 0
