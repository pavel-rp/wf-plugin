#!/usr/bin/env bash
#
# check-ops-docs.sh — CI drift guards for the _contracts ops/reference split (WF-208).
#
# The two frozen contracts are split into a bounded runtime-ops doc
# (`<name>.ops.md`, the runtime-read half) and a reference half
# (`<name>.contract.md`, never read at boot). These guards keep the pair from
# drifting apart, with plain bash + grep/sed/awk — no new dependency:
#
#   GUARD 1 — line budget: every `*.ops.md` in this folder is <= MAX_LINES (150),
#             the pinned per-surface runtime-read ceiling.
#   GUARD 2 — heading parity: every `## ` heading in `<name>.ops.md` exists
#             (verbatim text, any heading level, outside code fences) in its
#             paired `<name>.contract.md` — an ops section can never orphan.
#   GUARD 3 — cross-link anchors: every markdown link of the shape
#             `](<file>.md#<anchor>)` in any `_contracts/*.md` resolves — the
#             target file exists here and carries a heading whose slug matches.
#   GUARD 4 — contract-pointer ban: the token `contract.md` may appear in an
#             ops doc only on a line containing "never read at boot" — a
#             runtime-ops doc must never instruct a full-contract read.
#
# Every failure names the offending file / heading / link. Exit 0 = all guards
# green; exit 1 = any failure. Invoked by registry-fixtures/run.sh (the CI
# entry point), and runnable standalone:
#
#   bash plugins/wf/skills/_contracts/check-ops-docs.sh
#
# Model: claude-fable-5
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAX_LINES=150
fails=0

err() { printf 'ERROR: %s\n' "$*"; fails=$((fails + 1)); }
ok()  { printf 'OK: %s\n' "$*"; }

# Print heading text (hash prefix stripped) outside ``` fences.
#   $1 = file; $2 = "h2" (exactly two hashes) or "any" (any heading level).
# No awk interval regexes ({n,m}) — mawk (the ubuntu-latest default awk) does
# not support them.
headings() {
  awk -v mode="$2" '
    /^```/ { infence = !infence; next }
    infence { next }
    mode == "h2"  && /^## /     { sub(/^##[ \t]+/, "");  print; next }
    mode == "any" && /^#+[ \t]/ { sub(/^#+[ \t]+/, ""); print }
  ' "$1"
}

# GitHub-style anchor slug, hyphen-collapsed on both comparison sides so the
# double-hyphen artifacts of stripped punctuation never cause a false mismatch:
# lowercase; drop everything but [a-z0-9 -]; spaces -> hyphens; collapse runs.
slugify() {
  printf '%s' "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed -e 's/[^a-z0-9 -]//g' -e 's/ /-/g' -e 's/--*/-/g' -e 's/^-//' -e 's/-$//'
}

# ---------------------------------------------------------------------------
# GUARDS 1, 2, 4 — per ops doc.
# ---------------------------------------------------------------------------
ops_found=0
for f in "$DIR"/*.ops.md; do
  [ -e "$f" ] || continue
  ops_found=1
  base="$(basename "$f")"

  # GUARD 1 — line budget.
  lines="$(wc -l < "$f" | tr -d '[:space:]')"
  if [ "$lines" -gt "$MAX_LINES" ]; then
    err "$base is $lines lines — over the $MAX_LINES-line runtime-ops budget. Move rationale/history to the paired reference file."
  else
    ok "$base line budget: $lines <= $MAX_LINES."
  fi

  # GUARD 2 — heading parity against the paired contract (reference half).
  ref="$DIR/${base%.ops.md}.contract.md"
  if [ ! -f "$ref" ]; then
    err "$base has no paired reference file (expected $(basename "$ref"))."
  else
    parity_fails=0
    while IFS= read -r h; do
      [ -n "$h" ] || continue
      if ! headings "$ref" any | grep -Fxq "$h"; then
        err "$base heading \"$h\" has no counterpart heading in $(basename "$ref") — heading parity broken."
        parity_fails=$((parity_fails + 1))
      fi
    done < <(headings "$f" h2)
    [ "$parity_fails" -eq 0 ] && ok "$base heading parity against $(basename "$ref")."
  fi

  # GUARD 4 — contract-pointer ban.
  stray="$(grep -n 'contract\.md' "$f" | grep -v 'never read at boot' || true)"
  if [ -n "$stray" ]; then
    err "$base points at a full contract outside the labeled never-read-at-boot line: $stray"
  else
    ok "$base contract-pointer ban (contract.md only on the labeled line)."
  fi
done

if [ "$ops_found" -eq 0 ]; then
  err "no *.ops.md files found in $DIR — the ops/reference split is missing."
fi

# ---------------------------------------------------------------------------
# GUARD 3 — cross-link anchor resolution across every _contracts/*.md.
# ---------------------------------------------------------------------------
fails_before_links=$fails
for f in "$DIR"/*.md; do
  [ -e "$f" ] || continue
  base="$(basename "$f")"
  while IFS= read -r link; do
    [ -n "$link" ] || continue
    inner="${link#](}"; inner="${inner%)}"
    target="${inner%%#*}"
    anchor="${inner#*#}"
    tfile="$DIR/$target"
    if [ ! -f "$tfile" ]; then
      err "$base links to missing file: ($inner)."
      continue
    fi
    want="$(slugify "$anchor")"
    found=0
    while IFS= read -r h; do
      if [ "$(slugify "$h")" = "$want" ]; then found=1; break; fi
    done < <(headings "$tfile" any)
    if [ "$found" -eq 0 ]; then
      err "$base link anchor does not resolve: ($inner) — no heading in $target slugs to \"$want\"."
    fi
  done < <(grep -oE '\]\([A-Za-z0-9._-]+\.md#[A-Za-z0-9-]+\)' "$f" || true)
done
[ "$fails" -eq "$fails_before_links" ] && ok "cross-link anchors resolved across _contracts/*.md."

# ---------------------------------------------------------------------------
# Summary + exit.
# ---------------------------------------------------------------------------
echo ""
if [ "$fails" -gt 0 ]; then
  printf 'check-ops-docs: FAILED (%s error(s)).\n' "$fails"
  exit 1
fi
printf 'check-ops-docs: all guards green.\n'
exit 0
