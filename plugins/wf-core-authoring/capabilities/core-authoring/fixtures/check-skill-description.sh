#!/usr/bin/env bash
# check-skill-description.sh — craft-C4 check (2): the skill `description` field.
#
# `description` is the only content preloaded for auto-selection, so it has to
# stand alone. CLAUDE.md §5 states it as "third-person what + when", at most 1024
# characters. This check asserts three things:
#
#   D1. LENGTH — at most 1024 characters, reporting the measured length.
#   D2. THE "WHAT" HALF — the description does not open with a first- or
#       second-person verb form.
#   D3. THE "WHEN" HALF — the description carries a `Use ...` trigger clause.
#
# --- Why D2/D3 and not "is it third-person what+when?" ---
# "Third-person what + when" is a judgement about tone, and a shell script must
# never pretend to make one. D2 and D3 are the two MECHANICALLY DECIDABLE proxies
# for it, and they are deliberately the weakest honest test that still catches
# the two mistakes actually seen: an imperative rewrite ("Create a thing") and a
# description that says what a skill is but never when to reach for it.
#
# D2's decision procedure, in order — the first rule that applies wins:
#   a. the opening word is a personal pronoun (PRONOUNS below)      -> violation
#   b. the opening word ends in `s`                                 -> accept
#   c. the opening word is a bare imperative stem (IMPERATIVES)     -> violation
#   d. otherwise                                                    -> accept
#
# Rule (b) is the fast-accept that carries almost every conforming description:
# a third-person singular verb ("Updates", "Drives", "Explains") ends in `s`,
# and an imperative never does. Rule (d) is why a noun-phrase opening
# ("Stack-agnostic browser-automation QA engine.", "Dependency-ordered fan-out
# shipper.") passes untouched — those are valid third-person "what" statements
# and the check must not punish them.
#
# THE DENYLISTS ARE A CLOSED, DOCUMENTED PROXY SET, NOT A GRAMMAR. They exist to
# make D2 decidable. If a legitimate description is ever rejected by rule (c),
# the fix is to remove that stem from the list, not to weaken the check into a
# judgement call.
#
# D3 looks for a `Use ` clause in the DESCRIPTION VALUE ONLY. Scoping matters: a
# whole-file grep matches prose in every skill body in this repository, so a
# body-wide read would make D3 vacuously green everywhere. `craft_frontmatter_value`
# reads only the YAML block between the first `---` pair.
#
# Target set + structural fixture exclusions + the deference rule: skill-targets.sh.
#
# Usage:  check-skill-description.sh [<repo-root>]   check the live tree (default; used by run.sh)
#         check-skill-description.sh --selftest      drive the seeded fixtures and assert each behaves
#
# Exit 0 = clean; exit 1 = a violation (or a selftest fixture misbehaved).
#
# Model: claude-opus-5[1m]
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"

CHECK="check-skill-description"
MAXLEN=1024

# First/second-person personal pronouns. Checked BEFORE the ends-in-s fast-accept
# precisely because `us` would otherwise slip through it.
PRONOUNS="i we you your yours my mine our ours us me let's lets"

# Bare imperative (second-person) verb stems. The third-person form of each ends
# in `s` and is accepted by rule (b) above, so only the stem appears here.
IMPERATIVES="use create update run write generate add make build check drive
scaffold explain compose read fetch open merge score classify turn take parse
audit execute initialize onboard author decompose split review resolve walk
orchestrate finalize ship commit handle manage set configure install enable
apply ensure validate verify report list show print emit record track find
search detect infer derive bump fix repair clean remove delete move copy rename
format lint deploy publish register attach bind wire dispatch invoke call send
push pull sync import export load save store cache log trace measure count
compare match filter sort group join decide choose pick select"

in_list() { case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# lint_one <file> — echo one line per violation; silent when clean.
lint_one() {
  local file="$1" desc first lower
  desc="$(craft_frontmatter_value "$file" description)"

  if [ -z "$desc" ]; then
    echo "$file: frontmatter has no 'description' field — it is the only content preloaded for auto-selection, so it is required."
    return 0
  fi

  # D1 — length.
  if [ "${#desc}" -gt "$MAXLEN" ]; then
    echo "$file: description is ${#desc} characters — over the $MAXLEN-character limit (measured length ${#desc}, budget $MAXLEN)."
  fi

  # D2 — the "what" half: opening word is not a first/second-person verb form.
  first="${desc%% *}"                        # first whitespace-delimited word
  first="${first%%[.,;:!?]}"                 # drop one trailing punctuation mark
  lower="$(printf '%s' "$first" | tr '[:upper:]' '[:lower:]')"
  if in_list "$lower" "$PRONOUNS"; then
    echo "$file: description opens with the first/second-person pronoun '$first' — misses the 'what' half of the third-person what+when reduction (a description states what the skill does, in the third person)."
  elif [ "${lower%s}" = "$lower" ] && in_list "$lower" "$IMPERATIVES"; then
    echo "$file: description opens with the bare imperative '$first' — misses the 'what' half of the third-person what+when reduction (expected the third-person form, e.g. '${first}s')."
  fi

  # D3 — the "when" half: a `Use ...` trigger clause.
  case "$desc" in
    "Use "*|*" Use "*) ;;
    *) echo "$file: description carries no 'Use ...' trigger clause — misses the 'when' half of the third-person what+when reduction (state when to reach for the skill)." ;;
  esac
}

# --- --selftest: prove the check discriminates before it is trusted ------------
if [ "${1:-}" = "--selftest" ]; then
  FIX="$DIR/craft-fixtures/description"
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
  expect_clean     noun-phrase-opening
  expect_violation over-length   "over the $MAXLEN-character limit"
  expect_violation imperative    "bare imperative" "'what' half"
  expect_violation no-use-clause "no 'Use ...' trigger clause" "'when' half"

  if [ "$st" -ne 0 ]; then echo "$CHECK selftest: FAIL"; exit 1; fi
  echo "$CHECK selftest: PASS — every seeded violation is caught, each naming the half it missed, and both clean cases stay silent."
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
  echo "$CHECK: FAIL — skill 'description' frontmatter violations ($count skill bodies scanned):"
  printf '%s' "$hits"
  exit 1
fi
echo "$CHECK: PASS — all $count descriptions are <= $MAXLEN chars, open in the third person, and carry a 'Use ...' trigger clause."
exit 0
