#!/usr/bin/env bash
#
# check-review-cause-slots.sh — shape guard for the recorded review outcome (WF-837).
#
# The pre-merge review step records a one-line summary — a capped merge's cause included — and
# core only renders it. Two grepped shapes carry it, and this guard pins both:
#
#   SHIP — `plugins/wf/skills/ship/SKILL.md`'s final-output fence carries a `Review:` slot that
#          sits immediately below `Lenses:` and immediately above `Next:`, its value padded to the
#          block's column 11, with the stated fallback `none — no review step ran`; the block-shape
#          list names `Lenses/Review/Next`.
#   FLEET — `plugins/wf/skills/fleet/SKILL.md` records each terminal item's value as a
#          `review: <value>` row token (fallback `unknown — <the mechanical reason>`), and the tick
#          REPORT line carries a `review:` segment appended after the `lenses:` one, with `none`
#          as its stated fallback.
#
# Both files are core, so both must also name no reviewer product.
#
# Usage:  bash check-review-cause-slots.sh              # the live repository tree
#         bash check-review-cause-slots.sh --selftest   # seeded defects in both polarities
#
# Model: claude-opus-5-5
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"
ROOT="$(craft_repo_root)"

fails=0
err() { printf 'ERROR: %s\n' "$*"; fails=$((fails + 1)); }
ok()  { printf 'OK: %s\n' "$*"; }

PRODUCT_NOUNS='copilot|coderabbit|github|gh pr'

# The fenced block that opens with a `SHIP — ` line.
ship_fence() {
  awk '
    /^```/ { if (inb) exit; pend = 1; next }
    pend && /^SHIP — / { inb = 1 }
    pend { pend = 0 }
    inb { print }
  ' "$1"
}

check_ship() {  # $1 = ship SKILL.md
  local f="$1" before=$fails fence prev_label next_label review_line
  [ -f "$f" ] || { err "ship skill not found at $f"; return; }
  fence="$(ship_fence "$f")"
  [ -n "$fence" ] || { err "ship: no SHIP — final-output fence found"; return; }
  review_line="$(printf '%s\n' "$fence" | grep -E '^Review:' || true)"
  if [ -z "$review_line" ]; then
    err "ship: the SHIP block carries no Review: slot"
  else
    printf '%s\n' "$review_line" | grep -qE '^Review:   <' \
      || err "ship: the Review: value is not padded to column 11"
    printf '%s\n' "$review_line" | grep -qF 'none — no review step ran' \
      || err "ship: the Review: slot states no 'none — no review step ran' fallback"
    prev_label="$(printf '%s\n' "$fence" | grep -B1 -E '^Review:' | head -1 | cut -d: -f1)"
    next_label="$(printf '%s\n' "$fence" | grep -A1 -E '^Review:' | tail -1 | cut -d: -f1)"
    [ "$prev_label" = "Lenses" ] || err "ship: Review: must sit immediately below Lenses: (found '$prev_label' above it)"
    [ "$next_label" = "Next" ] || err "ship: Review: must sit immediately above Next: (found '$next_label' below it)"
  fi
  grep -qF 'Lenses/Review/Next' "$f" || err "ship: the block-shape list does not name Lenses/Review/Next"
  if grep -qiE "$PRODUCT_NOUNS" "$f"; then
    err "ship: core names a reviewer or host product ($(grep -oiE "$PRODUCT_NOUNS" "$f" | head -1))"
  fi
  [ "$fails" = "$before" ] && ok "ship: Review: slot below Lenses:, above Next:, column 11, stated fallback, no product noun"
}

check_fleet() {  # $1 = fleet SKILL.md
  local f="$1" before=$fails report review_seg
  [ -f "$f" ] || { err "fleet skill not found at $f"; return; }
  grep -qF '**Review outcome.**' "$f" || err "fleet: OBSERVE carries no Review outcome step"
  grep -qF 'as `review: <value>`' "$f" || err "fleet: the review outcome is not recorded as a 'review: <value>' row token"
  grep -qF 'record `unknown — <the mechanical reason>` — no shipper report arrived' "$f" \
    || err "fleet: the review outcome states no unknown fallback"
  report="$(grep -E '^One line: `<merged>/<total> done' "$f" || true)"
  if [ -z "$report" ]; then
    err "fleet: no tick REPORT line found"
  else
    # Isolate the review: segment itself — it ends at the next ' — shape:' segment or the closing
    # backtick — so a later segment's own '| none' can never stand in for the review fallback.
    review_seg="$(printf '%s\n' "$report" | sed -n 's/.*— lenses: .* — review: \(<id> .*\)$/\1/p' | sed 's/ — shape: .*$//; s/`.*$//')"
    printf '%s\n' "$review_seg" | grep -qE -- '^<id> .*\| none$' \
      || err "fleet: the tick REPORT line carries no 'review:' segment after 'lenses:' ending in the 'none' fallback"
  fi
  if grep -qiE 'copilot|coderabbit' "$f"; then
    err "fleet: core names a reviewer product"
  fi
  [ "$fails" = "$before" ] && ok "fleet: review: row token, unknown fallback, tick REPORT review: segment, no product noun"
}

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  st=0
  SHIP="$ROOT/plugins/wf/skills/ship/SKILL.md"
  FLEET="$ROOT/plugins/wf/skills/fleet/SKILL.md"
  probe() { ( fails=0; "$1" "$2" >/dev/null; exit "$fails" ); echo $?; }
  seed() {  # label, expect(clean|defect), function, file
    local got; got=$(probe "$3" "$4")
    if { [ "$2" = clean ] && [ "$got" = 0 ]; } || { [ "$2" = defect ] && [ "$got" != 0 ]; }; then
      echo "selftest ok ($2): $1"
    else
      echo "selftest FAIL: $1 — expected $2"; st=1
    fi
  }
  cp "$SHIP" "$tmp/ship-clean.md";  seed "ship clean copy" clean check_ship "$tmp/ship-clean.md"
  cp "$FLEET" "$tmp/fleet-clean.md"; seed "fleet clean copy" clean check_fleet "$tmp/fleet-clean.md"
  grep -vE '^Review:   <' "$SHIP" > "$tmp/ship-noslot.md";        seed "ship slot removed" defect check_ship "$tmp/ship-noslot.md"
  sed -E 's/^Review:   </Review: </' "$SHIP" > "$tmp/ship-pad.md"; seed "ship slot misaligned" defect check_ship "$tmp/ship-pad.md"
  sed 's/ | none — no review step ran>/>/' "$SHIP" > "$tmp/ship-fb.md"; seed "ship fallback dropped" defect check_ship "$tmp/ship-fb.md"
  awk '/^Review:   </ { held = $0; next } { print } /^Next:     </ && held { print held; held = "" }' "$SHIP" > "$tmp/ship-order.md"
  seed "ship slot below Next" defect check_ship "$tmp/ship-order.md"
  { cat "$SHIP"; echo 'The Copilot review is requested here.'; } > "$tmp/ship-noun.md"; seed "ship names a product" defect check_ship "$tmp/ship-noun.md"
  sed 's/ — review: <id> <recorded review summary> | <id> unknown — <reason>, … | none//' "$FLEET" > "$tmp/fleet-seg.md"
  seed "fleet REPORT segment removed" defect check_fleet "$tmp/fleet-seg.md"
  sed 's/ | <id> unknown — <reason>, … | none — shape:/ | <id> unknown — <reason>, … — shape:/' "$FLEET" > "$tmp/fleet-fb.md"
  seed "fleet REPORT review fallback dropped" defect check_fleet "$tmp/fleet-fb.md"
  sed 's/as `review: <value>`/as `rev: <value>`/' "$FLEET" > "$tmp/fleet-tok.md"; seed "fleet row token renamed" defect check_fleet "$tmp/fleet-tok.md"
  if [ "$st" -ne 0 ]; then echo "check-review-cause-slots selftest: FAIL"; exit 1; fi
  echo "check-review-cause-slots selftest: PASS — every seeded defect is caught and the clean copies stay silent."
  exit 0
fi

echo "check-review-cause-slots: repository root resolved to $ROOT"
check_ship "$ROOT/plugins/wf/skills/ship/SKILL.md"
check_fleet "$ROOT/plugins/wf/skills/fleet/SKILL.md"
if [ "$fails" -gt 0 ]; then
  printf 'check-review-cause-slots: FAILED (%s error(s)).\n' "$fails"
  exit 1
fi
echo "check-review-cause-slots: all guards green."
