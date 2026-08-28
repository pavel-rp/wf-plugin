#!/usr/bin/env bash
# run-block-slot-guard.sh — the run blocks must obey the run-block slot convention.
#
# The "run blocks" are the two multi-run terminal blocks whose bodies are
# label-and-value tables downstream consumers grep: the fan-out orchestrator's
# `FLEET —` block and the single-task shipper's `SHIP —` block. WF-488 owns
# their shape and states the convention in
# `plugins/wf/skills/_shared/pipeline-conventions.md` §"Run-block slot
# convention"; later slot additions append to that convention rather than
# redefining it, so this guard is what stops two independent additions forking
# the shape.
#
# It is a STRUCTURAL assertion over the fenced template. For each block it finds
# the template by scanning for a FENCE whose first line begins with the bare
# `NAME — ` prefix (never a status token — the status list is an anticipated
# evolution surface), then asserts:
#
#   1. every label line's value starts at that block's PINNED column — 19 for
#      `FLEET —`, 11 for `SHIP —`. Pinned, not inferred: deriving the baseline
#      from the block's own first line would let a WHOLESALE column move pass,
#      and the two skill bodies quote these literal numbers to future authors.
#   2. the declared version slot is present;
#   3. `Next:` is the block's last LABEL line (continuation lines indented
#      beneath it belong to `Next:`, not to a slot below it);
#   4. no slot renders a blank value, since a slot always renders;
#   5. no in-fence line is unrecognized — a label whose name falls outside the
#      permitted charset is a VIOLATION, never a silent skip, because a skipped
#      line evades rules 1-4 entirely.
#
# WHAT IT DELIBERATELY DOES NOT ASSERT: that the version slot is the *last* slot.
# The convention's insertion point is the tail for the NEWEST slot; pinning one
# named slot there forever would reject the very next conforming addition. The
# selftest carries an `extended` fixture — a second slot appended above `Next:` —
# that the evaluator MUST ACCEPT, so this stays true as later slots land.
#
# It also asserts the third render site: the fleet scoreboard header stamp, which
# is the one site convention rule 5 (one label token per concept) was written for
# and the one site the two fenced blocks cannot cover.
#
# --selftest runs the same evaluator over seeded synthetic blocks and requires it
# to REJECT each defective one and ACCEPT both sound ones. A lint that scans a
# clean tree and finds nothing is indistinguishable from a lint that does
# nothing; the selftest is what makes a green live-tree run mean "the tree is
# clean". Rejections are checked for the guard's own violation exit (1), never a
# harness error (2), so a broken fixture cannot masquerade as a caught defect.
#
# Usage:  bash run-block-slot-guard.sh              # live-tree scan (what CI runs)
#         bash run-block-slot-guard.sh --selftest   # seeded fixtures only
#
# Exit 0 = every block conforms; exit 1 = at least one violation; exit 2 = the
# guard could not run (a target file is missing).
#
# Model: claude-opus-5[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"

# The declared slot every run block must carry, and the label that must stay last.
SLOT_LABEL="Version"
LAST_LABEL="Next"

fail=0
err() { printf 'run-block-slot-guard: %s\n' "$*" >&2; }

# evaluate_block <file> <bare-name-prefix> <block-name> <expected-column>
#
# Finds the fenced template whose first line begins with <bare-name-prefix> and
# evaluates the five rules against it. Prints a diagnostic per violation; returns
# 1 if any fired, 0 when clean.
evaluate_block() {
  local file="$1" opener="$2" name="$3" expected="$4"
  awk -v opener="$opener" -v name="$name" -v slot="$SLOT_LABEL" -v last="$LAST_LABEL" -v expected="$expected" '
    # Fence toggling. A block body is only ever read INSIDE a fence, so a prose
    # mention of the block header cannot redirect the scan.
    /^```/ {
      if (infence) { infence = 0; isours = 0 }
      else { infence = 1; expectheader = 1 }
      next
    }
    !infence { next }

    # The first line inside a fence decides whether this is our block.
    expectheader {
      expectheader = 0
      if (index($0, opener) == 1) { isours = 1; found++ }
      next
    }
    !isours { next }

    # --- inside our block body ---
    /^[[:space:]]*$/ { next }        # the blank line under the header
    /^[[:space:]]/   { next }        # a continuation line belongs to the label above

    {
      if (index($0, "\t") > 0) {
        printf "%s: line uses a tab for padding, which cannot hold a fixed value column: [%s]\n", name, $0
        bad = 1
        next
      }
      # Value optional, so a BLANK slot is collected (and caught by rule 4)
      # rather than silently skipped.
      if (match($0, /^[A-Za-z][A-Za-z0-9 ._\/-]*:[ ]*/)) {
        n++
        lbl = substr($0, 1, index($0, ":") - 1)
        label[n] = lbl
        col[n] = RLENGTH + 1
        value[n] = substr($0, RLENGTH + 1)
        next
      }
      # Rule 5 — an unrecognized in-fence line is a violation, not a skip.
      printf "%s: unrecognized line in the block body (not a label, not a continuation): [%s]\n", name, $0
      bad = 1
    }

    END {
      if (found == 0) { printf "%s: no fenced template opening with \"%s\" was found\n", name, opener; exit 1 }
      if (found > 1)  { printf "%s: %d fenced templates open with \"%s\" — the block must be unambiguous\n", name, found, opener; bad = 1 }
      if (n == 0)     { printf "%s: the template carries no label lines\n", name; exit 1 }

      # Rule 1 — every value starts at the PINNED column for this block.
      for (i = 1; i <= n; i++) {
        if (value[i] != "" && col[i] != expected) {
          printf "%s: slot \"%s\" starts its value at column %d, but this block'"'"'s pinned column is %d\n", name, label[i], col[i], expected
          bad = 1
        }
      }

      # Rule 4 — a slot always renders.
      for (i = 1; i <= n; i++) {
        v = value[i]
        gsub(/[[:space:]]/, "", v)
        if (v == "") { printf "%s: slot \"%s\" renders a blank value; a slot must always render a stated token\n", name, label[i]; bad = 1 }
      }

      # Rules 2-3 — the declared slot is present, and `Next:` is last.
      slotAt = 0; lastAt = 0
      for (i = 1; i <= n; i++) {
        if (label[i] == slot) slotAt = i
        if (label[i] == last) lastAt = i
      }
      if (slotAt == 0) { printf "%s: the declared \"%s:\" slot is absent from the block\n", name, slot; bad = 1 }
      if (lastAt == 0) { printf "%s: the block has no \"%s:\" line\n", name, last; bad = 1 }
      else if (lastAt != n) { printf "%s: \"%s:\" is not the last label line — \"%s\" appears below it\n", name, last, label[n]; bad = 1 }

      if (bad) exit 1
      printf "%s: OK — %d slots at pinned column %d, \"%s:\" present, \"%s:\" last\n", name, n, expected, slot, last
    }
  ' "$file"
}

# evaluate_header_stamp <file>
#
# The third render site. Convention rule 5 asks one label token per concept
# across EVERY render site; the durable scoreboard header is the site the two
# fenced blocks cannot cover, so it is asserted here or nowhere.
evaluate_header_stamp() {
  local file="$1"
  if grep -q '\*\*Version:\*\*' "$file"; then
    echo "HEADER: OK — the scoreboard header carries a **Version:** stamp"
    return 0
  fi
  echo "HEADER: the scoreboard header carries no **Version:** stamp; convention rule 5 requires the same label token at every render site"
  return 1
}

# --- selftest ---------------------------------------------------------------

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)" || { err "cannot create a temp dir"; exit 2; }
  trap 'rm -rf "$tmp"' EXIT

  # Sound: two padded slots, the declared slot present, `Next:` last.
  cat >"$tmp/sound.md" <<'SOUND'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Version:  <resolved | unknown>
Next:     <none — terminus>
```
SOUND

  # Sound: a SECOND slot appended above `Next:`, exactly as the convention
  # instructs the next author to do. This MUST be accepted — a guard that
  # rejected it would block the follow-on work it exists to protect.
  cat >"$tmp/extended.md" <<'EXTENDED'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Version:  <resolved | unknown>
Unproven: <count | unknown>
Next:     <none — terminus>
```
EXTENDED

  # Defect 1 — the declared slot is missing entirely.
  cat >"$tmp/absent.md" <<'ABSENT'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Next:     <none — terminus>
```
ABSENT

  # Defect 2 — one value off the pinned column.
  cat >"$tmp/misaligned.md" <<'MISALIGNED'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Version:      <resolved | unknown>
Next:     <none — terminus>
```
MISALIGNED

  # Defect 3 — the WHOLE block shifted off the pinned column. A guard that
  # inferred its baseline from the block's own first line would pass this.
  cat >"$tmp/shifted.md" <<'SHIFTED'
```
BLOCK — <A | B>

Task:       <id>
Merge:      <merged | not merged>
Version:    <resolved | unknown>
Next:       <none — terminus>
```
SHIFTED

  # Defect 4 — a slot placed BELOW `Next:`, which must always be last.
  cat >"$tmp/below-next.md" <<'BELOW'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Next:     <none — terminus>
Version:  <resolved | unknown>
```
BELOW

  # Defect 5 — a NON-declared slot renders nothing. Deliberately not the
  # `Version:` slot, so this case can only be caught by the blank-value rule and
  # never by the absent-slot rule.
  cat >"$tmp/blank.md" <<'BLANK'
```
BLOCK — <A | B>

Task:     <id>
Merge:
Version:  <resolved | unknown>
Next:     <none — terminus>
```
BLANK

  # Defect 6 — a label outside the permitted charset must be reported, not
  # skipped; a skipped line would evade every other rule.
  cat >"$tmp/odd-label.md" <<'ODD'
```
BLOCK — <A | B>

Task:     <id>
Merge!:   <merged | not merged>
Version:  <resolved | unknown>
Next:     <none — terminus>
```
ODD

  selftest_fail=0
  for case in absent misaligned shifted below-next blank odd-label; do
    evaluate_block "$tmp/$case.md" "BLOCK — " "selftest/$case" 11 >/dev/null 2>&1
    rc=$?
    if [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — seeded '$case' block returned exit $rc; expected 1 (a violation, not a harness error or a pass)"
      selftest_fail=$((selftest_fail + 1))
    fi
  done
  for case in sound extended; do
    if ! evaluate_block "$tmp/$case.md" "BLOCK — " "selftest/$case" 11 >/dev/null 2>&1; then
      err "SELFTEST FAIL — the evaluator REJECTED the seeded '$case' block"
      evaluate_block "$tmp/$case.md" "BLOCK — " "selftest/$case" 11 >&2
      selftest_fail=$((selftest_fail + 1))
    fi
  done

  # The header-stamp check must catch a missing stamp too.
  printf 'no stamp here\n' >"$tmp/nostamp.md"
  if evaluate_header_stamp "$tmp/nostamp.md" >/dev/null 2>&1; then
    err "SELFTEST FAIL — the header-stamp check ACCEPTED a file with no stamp"
    selftest_fail=$((selftest_fail + 1))
  fi

  if [ "$selftest_fail" -ne 0 ]; then
    err "self-test FAILED ($selftest_fail case(s))"
    exit 1
  fi
  echo "run-block-slot-guard: self-test passed — six seeded defects rejected (absent slot, misaligned value, wholesale column shift, slot below Next, blank value, unrecognized label), a missing header stamp rejected, and BOTH the sound block and a conforming second-slot addition accepted."
  exit 0
fi

# --- live-tree scan ---------------------------------------------------------

FLEET="$ROOT/plugins/wf/skills/fleet/SKILL.md"
SHIP="$ROOT/plugins/wf/skills/ship/SKILL.md"

for f in "$FLEET" "$SHIP"; do
  if [ ! -f "$f" ]; then
    err "target file is absent: $f"
    exit 2
  fi
done

evaluate_block "$FLEET" "FLEET — " "FLEET" 19 || fail=$((fail + 1))
evaluate_block "$SHIP" "SHIP — " "SHIP" 11 || fail=$((fail + 1))
evaluate_header_stamp "$FLEET" || fail=$((fail + 1))

if [ "$fail" -ne 0 ]; then
  err "FAIL — $fail run-block check(s) violate the run-block slot convention."
  exit 1
fi
echo "run-block-slot-guard: PASS — both run blocks carry the declared slot at their pinned column with \"$LAST_LABEL:\" last, and the scoreboard header carries the matching stamp."
