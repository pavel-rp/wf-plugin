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
# It is a STRUCTURAL assertion over the fenced template, not a re-read of the
# surrounding prose. For each block it parses the fence, then asserts:
#
#   1. every label line's value starts at that block's fixed column;
#   2. the declared version slot is present;
#   3. `Next:` is the block's last LABEL line (continuation lines indented
#      beneath it are part of `Next:`, not slots below it);
#   4. the version slot sits immediately above `Next:` — the convention's single
#      stable insertion point;
#   5. the block carries no blank-valued label, since a slot always renders.
#
# The fixed column is derived from the block's own FIRST label line rather than
# hardcoded, so the guard measures the shape instead of restating it — a block
# that moved its column wholesale is still caught by rule 1 on every other line.
#
# --selftest runs the same evaluator over seeded synthetic blocks — version slot
# absent, value misaligned off the column, a slot placed below `Next:`, and a
# blank-valued slot — and requires the evaluator to REJECT each one and ACCEPT
# the sound one. A lint that scans a clean tree and finds nothing is
# indistinguishable from a lint that does nothing; the selftest is what makes a
# green live-tree run mean "the tree is clean".
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

# evaluate_block <file> <fence-opening-prefix> <block-name>
#
# Extracts the fenced template whose first line starts with <fence-opening-prefix>
# and evaluates the five rules against it. Prints a diagnostic per violation and
# returns non-zero if any fired.
evaluate_block() {
  local file="$1" opener="$2" name="$3"
  awk -v opener="$opener" -v name="$name" -v slot="$SLOT_LABEL" -v last="$LAST_LABEL" '
    # Enter the template at the fence line that opens with the block header.
    !inblock && index($0, opener) == 1 { inblock = 1; found = 1; next }
    inblock && /^```[[:space:]]*$/ { inblock = 0; next }
    !inblock { next }

    # A label line is `Label:` followed by at least one space then a value.
    # Continuation lines (indented) belong to the label above them.
    /^[A-Za-z][A-Za-z ]*:[[:space:]]/ {
      n++
      label[n] = substr($0, 1, index($0, ":") - 1)
      match($0, /^[A-Za-z][A-Za-z ]*:[ ]+/)
      col[n] = RLENGTH + 1
      value[n] = substr($0, RLENGTH + 1)
      line[n] = $0
      next
    }

    END {
      if (!found) { printf "%s: the fenced template opening with \"%s\" was not found\n", name, opener; exit 1 }
      if (n == 0) { printf "%s: the template carries no label lines\n", name; exit 1 }

      bad = 0
      fixed = col[1]   # measured from the block itself, never hardcoded

      # Rule 1 — every value starts at the block'"'"'s fixed column.
      for (i = 1; i <= n; i++) {
        if (col[i] != fixed) {
          printf "%s: slot \"%s\" starts its value at column %d, but this block'"'"'s fixed column is %d\n", name, label[i], col[i], fixed
          bad = 1
        }
      }

      # Rule 5 — a slot always renders, so no value may be blank.
      for (i = 1; i <= n; i++) {
        v = value[i]
        gsub(/[[:space:]]/, "", v)
        if (v == "") { printf "%s: slot \"%s\" renders a blank value; a slot must always render a stated token\n", name, label[i]; bad = 1 }
      }

      # Rules 2-4 — the declared slot is present, `Next:` is last, and the slot
      # sits immediately above it.
      slotAt = 0; lastAt = 0
      for (i = 1; i <= n; i++) {
        if (label[i] == slot) slotAt = i
        if (label[i] == last) lastAt = i
      }
      if (slotAt == 0) { printf "%s: the declared \"%s:\" slot is absent from the block\n", name, slot; bad = 1 }
      if (lastAt == 0) { printf "%s: the block has no \"%s:\" line\n", name, last; bad = 1 }
      else if (lastAt != n) { printf "%s: \"%s:\" is not the last label line — \"%s\" appears below it\n", name, last, label[n]; bad = 1 }
      if (slotAt > 0 && lastAt > 0 && slotAt != lastAt - 1) {
        printf "%s: \"%s:\" is not immediately above \"%s:\" — the convention'"'"'s insertion point is the tail slot\n", name, slot, last
        bad = 1
      }

      if (bad) exit 1
      printf "%s: OK — %d slots, value column %d, \"%s:\" immediately above a last-line \"%s:\"\n", name, n, fixed, slot, last
    }
  ' "$file"
}

# --- selftest ---------------------------------------------------------------

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)" || { err "cannot create a temp dir"; exit 2; }
  trap 'rm -rf "$tmp"' EXIT

  # A sound block: two padded slots, the declared slot immediately above a
  # last-line `Next:`.
  cat >"$tmp/sound.md" <<'SOUND'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Version:  <resolved | unknown>
Next:     <none — terminus>
```
SOUND

  # Defect 1 — the declared slot is missing entirely.
  cat >"$tmp/absent.md" <<'ABSENT'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Next:     <none — terminus>
```
ABSENT

  # Defect 2 — the slot's value is off the block's fixed column.
  cat >"$tmp/misaligned.md" <<'MISALIGNED'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Version:      <resolved | unknown>
Next:     <none — terminus>
```
MISALIGNED

  # Defect 3 — a slot placed BELOW `Next:`, which must always be last.
  cat >"$tmp/below-next.md" <<'BELOW'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Next:     <none — terminus>
Version:  <resolved | unknown>
```
BELOW

  # Defect 4 — the slot is present but renders nothing.
  cat >"$tmp/blank.md" <<'BLANK'
```
BLOCK — <A | B>

Task:     <id>
Merge:    <merged | not merged>
Version:
Next:     <none — terminus>
```
BLANK

  # Defect 5 — the slot is present and last, but not adjacent to `Next:`.
  cat >"$tmp/not-adjacent.md" <<'NOTADJ'
```
BLOCK — <A | B>

Task:     <id>
Version:  <resolved | unknown>
Merge:    <merged | not merged>
Next:     <none — terminus>
```
NOTADJ

  selftest_fail=0
  for case in absent misaligned below-next blank not-adjacent; do
    if evaluate_block "$tmp/$case.md" "BLOCK — <A" "selftest/$case" >/dev/null 2>&1; then
      err "SELFTEST FAIL — the evaluator ACCEPTED the seeded '$case' block"
      selftest_fail=$((selftest_fail + 1))
    fi
  done
  if ! evaluate_block "$tmp/sound.md" "BLOCK — <A" "selftest/sound" >/dev/null 2>&1; then
    err "SELFTEST FAIL — the evaluator REJECTED the seeded sound block"
    evaluate_block "$tmp/sound.md" "BLOCK — <A" "selftest/sound" >&2
    selftest_fail=$((selftest_fail + 1))
  fi

  if [ "$selftest_fail" -ne 0 ]; then
    err "self-test FAILED ($selftest_fail case(s))"
    exit 1
  fi
  echo "run-block-slot-guard: self-test passed — the evaluator rejects the absent-slot, misaligned, below-Next, blank-value and non-adjacent blocks and accepts the sound one."
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

evaluate_block "$FLEET" "FLEET — <Running" "FLEET" || fail=$((fail + 1))
evaluate_block "$SHIP" "SHIP — <Merged" "SHIP" || fail=$((fail + 1))

if [ "$fail" -ne 0 ]; then
  err "FAIL — $fail run block(s) violate the run-block slot convention."
  exit 1
fi
echo "run-block-slot-guard: PASS — both run blocks carry the declared slot at their fixed column, immediately above a last-line \"$LAST_LABEL:\"."
