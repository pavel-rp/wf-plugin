#!/usr/bin/env bash
#
# gate-map-drift.sh — proves this pack's gate-eligibility maps are really checked by the core
# gate-map guard, and that a grammar label added without a map row fails naming the label.
#
# The core guard (plugins/wf/skills/_contracts/gate-map-guard.sh) is run UNMODIFIED, inside a
# throwaway mirror tree holding: a copy of the guard, one stub core map (the guard needs at least
# one), and a copy of this pack's capability folders. In that mirror:
#
#   - positive control: the copied capabilities pass as shipped (so any later failure is the
#     injected drift, not a broken mirror);
#   - each drift case injects one label into a copied grammar source and requires exit 1 plus the
#     guard's own `unmapped label `<label>`` line.
#
# Model: claude-opus-5-5
#
# Usage:  bash plugins/wf-review/capabilities/pr-review/fixtures/gate-map-drift.sh

set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAPS="$(cd "$DIR/../.." && pwd)"
PACK="$(basename "$(cd "$CAPS/.." && pwd)")"
ROOT="$(cd "$DIR/../../../../.." && pwd)"
GUARD="$ROOT/plugins/wf/skills/_contracts/gate-map-guard.sh"

if [ ! -f "$GUARD" ]; then
  echo "gate-map-drift: core guard not found at $GUARD" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

fail=0

# mirror <name> — build $WORK/<name> and print its path.
mirror() {
  local m="$WORK/$1"
  mkdir -p "$m/plugins/wf/skills/_contracts/gate-maps" "$m/plugins/$PACK"
  cp "$GUARD" "$m/plugins/wf/skills/_contracts/gate-map-guard.sh"
  printf '%s\n' '# Gate map — stub' '' \
    '**Layer:** a stub core layer so the mirrored guard can run' \
    '**Grammar source:** none' '**Labels:** none' '**Model:** unknown' \
    > "$m/plugins/wf/skills/_contracts/gate-maps/stub.gate-map.md"
  cp -R "$CAPS" "$m/plugins/$PACK/"
  printf '%s' "$m"
}

# drift <case> <grammar path relative to capabilities/> <old text> <new text> <added label> <map>
# <map> is the map file (relative to capabilities/) that must be the one rejecting the drift.
drift() {
  local name="$1" rel="$2" old="$3" new="$4" label="$5" map="$6" m f body changed out rc
  m="$(mirror "$name")"
  f="$m/plugins/$PACK/capabilities/$rel"
  body="$(cat "$f")"
  changed="${body/"$old"/"$new"}"
  if [ "$changed" = "$body" ]; then
    printf 'FAIL: %s — anchor text not found in %s; the fixture no longer matches the grammar\n' "$name" "$rel"
    fail=$((fail + 1)); return
  fi
  printf '%s\n' "$changed" > "$f"
  out="$(bash "$m/plugins/wf/skills/_contracts/gate-map-guard.sh" 2>&1)"; rc=$?
  if [ "$rc" -ne 1 ]; then
    printf 'FAIL: %s — guard returned %s on a drifted grammar; expected 1\n' "$name" "$rc"
    printf '%s\n' "$out"; fail=$((fail + 1)); return
  fi
  if ! printf '%s' "$out" | grep -qF "capabilities/$map: unmapped label \`$label\`"; then
    printf 'FAIL: %s — guard rejected the drift but %s did not name `%s`\n' "$name" "$map" "$label"
    printf '%s\n' "$out"; fail=$((fail + 1)); return
  fi
  printf 'PASS: %s — a label added to %s fails the guard, naming `%s`\n' "$name" "$rel" "$label"
}

# Positive control.
m="$(mirror control)"
if out="$(bash "$m/plugins/wf/skills/_contracts/gate-map-guard.sh" 2>&1)"; then
  printf 'PASS: control — the shipped %s maps pass the unmodified guard in the mirror\n' "$PACK"
else
  printf 'FAIL: control — the shipped %s maps fail in the mirror\n' "$PACK"
  printf '%s\n' "$out"; fail=$((fail + 1))
fi

# Drift cases.
drift sweep-pr pr-review/fragments/closeout-review.md \
  '| unverifiable | absent>' '| unverifiable | absent | escalated>' escalated \
  pr-review/gate-maps/sweep-pr.gate-map.md

[ "$fail" -eq 0 ]
