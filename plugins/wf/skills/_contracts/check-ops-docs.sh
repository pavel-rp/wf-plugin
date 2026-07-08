#!/usr/bin/env bash
#
# check-ops-docs.sh — CI drift guards for runtime-ops/reference doc splits.
#
# A runtime-read doc is split into a bounded runtime-ops half (`<name>.ops.md`,
# read at boot) and a reference half (never read at boot). Two families ship
# this shape and are guarded here:
#
#   - the frozen core contracts in this folder (WF-208): `<name>.ops.md` paired
#     with `<name>.contract.md`, 150-line ops budget.
#   - the wf-git delivery provider fragment (WF-211):
#     ../../../wf-git/capabilities/git/fragments/delivery.ops.md paired with
#     delivery.md, 250-line ops budget — deliberately more generous than the
#     contracts' 150 to leave headroom for the Wave-4 delivery operations
#     WF-157 and WF-176 add to this same growing file.
#   - the two tracker provider fragments (WF-213):
#     ../../../wf-ado/capabilities/ado/fragments/tracker.ops.md and
#     ../../../wf-linear/capabilities/linear/fragments/tracker.ops.md, each
#     paired with its tracker.md, 250-line ops budget — the same generous
#     ceiling as delivery, leaving headroom for the Wave-4 tracker query
#     operations WF-158 adds (status/milestone/cycle enumeration) to these
#     same growing files.
#
# These guards keep each pair from drifting apart, with plain bash + grep/sed/awk
# — no new dependency:
#
#   GUARD 1 — line budget: every `*.ops.md` is <= its family's ceiling.
#   GUARD 2 — heading parity: every `## ` heading in `<name>.ops.md` exists
#             (verbatim text, any heading level, outside code fences) in its
#             paired reference — an ops section can never orphan.
#   GUARD 3 — cross-link anchors: every markdown link of the shape
#             `](<file>.md#<anchor>)` in a covered folder's `*.md` resolves —
#             the target file exists there and carries a heading whose slug
#             matches.
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
# Model: claude-opus-4-8
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WFGIT_DIR="$(cd "$DIR/../../../wf-git/capabilities/git/fragments" 2>/dev/null && pwd || true)"
WFADO_DIR="$(cd "$DIR/../../../wf-ado/capabilities/ado/fragments" 2>/dev/null && pwd || true)"
WFLINEAR_DIR="$(cd "$DIR/../../../wf-linear/capabilities/linear/fragments" 2>/dev/null && pwd || true)"
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

# GUARDS 1, 2, 4 — for every `*.ops.md` in a folder.
#   $1 = folder; $2 = line ceiling; $3 = reference suffix (replaces `.ops.md`).
check_ops_docs() {
  local dir="$1" max="$2" refsuffix="$3"
  local f base lines ref parity_fails h stray found=0
  for f in "$dir"/*.ops.md; do
    [ -e "$f" ] || continue
    found=1
    base="$(basename "$f")"

    # GUARD 1 — line budget.
    lines="$(wc -l < "$f" | tr -d '[:space:]')"
    if [ "$lines" -gt "$max" ]; then
      err "$base is $lines lines — over the $max-line runtime-ops budget. Move rationale/history to the paired reference file."
    else
      ok "$base line budget: $lines <= $max."
    fi

    # GUARD 2 — heading parity against the paired reference half.
    ref="$dir/${base%.ops.md}${refsuffix}"
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
  if [ "$found" -eq 0 ]; then
    err "no *.ops.md files found in $dir — the ops/reference split is missing."
  fi
}

# GUARD 3 — cross-link anchor resolution across every `*.md` in a folder.
check_links() {
  local dir="$1"
  local before=$fails
  local f base link inner target anchor tfile want found h
  for f in "$dir"/*.md; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    while IFS= read -r link; do
      [ -n "$link" ] || continue
      inner="${link#](}"; inner="${inner%)}"
      target="${inner%%#*}"
      anchor="${inner#*#}"
      tfile="$dir/$target"
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
  [ "$fails" -eq "$before" ] && ok "cross-link anchors resolved across $(basename "$dir")/*.md."
}

# ---------------------------------------------------------------------------
# Run the guards over both doc families.
# ---------------------------------------------------------------------------
check_ops_docs "$DIR" 150 ".contract.md"
if [ -n "$WFGIT_DIR" ]; then
  check_ops_docs "$WFGIT_DIR" 250 ".md"
else
  err "wf-git delivery fragments folder not found (expected at ../../../wf-git/capabilities/git/fragments)."
fi
if [ -n "$WFADO_DIR" ]; then
  check_ops_docs "$WFADO_DIR" 250 ".md"
else
  err "wf-ado tracker fragments folder not found (expected at ../../../wf-ado/capabilities/ado/fragments)."
fi
if [ -n "$WFLINEAR_DIR" ]; then
  check_ops_docs "$WFLINEAR_DIR" 250 ".md"
else
  err "wf-linear tracker fragments folder not found (expected at ../../../wf-linear/capabilities/linear/fragments)."
fi

check_links "$DIR"
[ -n "$WFGIT_DIR" ] && check_links "$WFGIT_DIR"
[ -n "$WFADO_DIR" ] && check_links "$WFADO_DIR"
[ -n "$WFLINEAR_DIR" ] && check_links "$WFLINEAR_DIR"

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
