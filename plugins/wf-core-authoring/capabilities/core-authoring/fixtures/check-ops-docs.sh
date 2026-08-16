#!/usr/bin/env bash
#
# check-ops-docs.sh — CI drift guards for runtime-ops/reference doc splits.
#
# A runtime-read doc is split into a bounded runtime-ops half (`<name>.ops.md`,
# read at boot) and a reference half (never read at boot). Three families ship
# this shape and are guarded here:
#
#   - the frozen core contracts (WF-208): `<name>.ops.md` paired with
#     `<name>.contract.md`, 150-line ops budget.
#   - the wf-git delivery provider fragment (WF-211): delivery.ops.md paired
#     with delivery.md, 280-line ops budget — deliberately more generous than
#     the contracts' 150 to leave headroom for the delivery operations added to
#     this same growing file: WF-157 and WF-176 (Wave-4), then the two
#     review-thread operations WF-324 binds (`review-threads-read`,
#     `review-thread-reply`), which raised the ceiling from 250 to 280.
#   - the two tracker provider fragments (WF-213): the wf-ado and wf-linear
#     tracker.ops.md files, each paired with its tracker.md, 250-line ops budget
#     — the same generous ceiling as delivery, leaving headroom for the Wave-4
#     tracker query operations WF-158 adds (status/milestone/cycle enumeration)
#     to these same growing files.
#
# The per-family thresholds are the point: this script owns the ops<=150 budget
# check outright (WF-369), and it keeps three distinct ceilings rather than
# collapsing them to one number.
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
# --- TARGET-SET ANCHORING (WF-369) ---
# THIS SCRIPT LIVES IN THE PACK; ITS TARGETS LIVE IN THE REPOSITORY. Every
# covered folder is therefore resolved from the REPO ROOT — `craft_repo_root`
# out of the shared `skill-targets.sh` — never from `${BASH_SOURCE[0]}`'s own
# directory. Before WF-369 this script sat in `plugins/wf/skills/_contracts/`
# and derived its first target folder as "wherever I am"; copied to the pack
# path unchanged that idiom would resolve to this fixtures folder, find zero
# `.contract.md` pairs, and pass VACUOUSLY GREEN. The resolved target set is
# printed on every run and an empty one is a hard failure for exactly that
# reason: a check that inspects nothing has proven nothing.
#
# An ABSENT covered folder likewise stays a hard error, never a vacuous skip.
#
# --- DEFERENCE ---
# These are shell checks over authored files. Where a surface is also covered by
# the typed resolver validators (`validate_skill_interface`, `validate_manifest`,
# `validate_registry`), those are the authority; a check here must not contradict
# one. See the header of `skill-targets.sh`.
#
# Every failure names the offending file / heading / link. Exit 0 = all guards
# green; exit 1 = any failure.
#
# Usage:  bash check-ops-docs.sh              # the live repository tree
#         bash check-ops-docs.sh --selftest   # the seeded ops-docs-fixtures/
#
# Registered in this folder's run.sh CHECKS list; CI discovers that runner by
# convention, so this script needs no workflow entry of its own.
#
# Model: claude-opus-5[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"

ROOT="$(craft_repo_root)"
FIXROOT="$DIR/ops-docs-fixtures"

fails=0

err() { printf 'ERROR: %s\n' "$*"; fails=$((fails + 1)); }
ok()  { printf 'OK: %s\n' "$*"; }

# resolve_dir <repo-relative-path> — print the absolute folder when it exists,
# nothing when it does not (the caller turns an empty result into a hard err).
resolve_dir() {
  ( cd "$ROOT/$1" 2>/dev/null && pwd ) || true
}

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
# --selftest — drive the seeded ops-docs-fixtures/ corpus.
#
# A guard that scans a clean tree and reports nothing is indistinguishable from
# a guard that does nothing. These fixtures plant one violation per guard so a
# green live-tree run below means "the tree is clean", not "the check is inert".
# The corpus lives under a `*-fixtures/` folder so `craft_is_excluded` (E1) keeps
# its seeded files off every craft check's target set, by shape.
# ---------------------------------------------------------------------------
if [ "${1:-}" = "--selftest" ]; then
  st_fails=0

  if [ ! -d "$FIXROOT" ]; then
    printf 'ERROR: selftest fixtures not found at %s.\n' "$FIXROOT" >&2
    printf 'check-ops-docs selftest: FAIL — the fixture corpus is missing.\n' >&2
    exit 1
  fi

  # Run one guard over one fixture folder in a subshell so the global tally is
  # untouched; the captured output is the verdict.
  st_ops()   { ( fails=0; check_ops_docs "$FIXROOT/$1" "$2" "$3" ) 2>&1; }
  st_links() { ( fails=0; check_links "$FIXROOT/$1" ) 2>&1; }

  # st_expect <label> <expect:clean|defect> <output> [required-substring ...]
  st_expect() {
    local label="$1" expect="$2" out="$3"; shift 3
    local has=clean s
    case "$out" in *ERROR:*) has=defect;; esac
    if [ "$has" != "$expect" ]; then
      echo "selftest FAIL: $label — expected $expect, got $has:"; echo "$out"
      st_fails=$((st_fails + 1)); return
    fi
    for s in "$@"; do
      case "$out" in
        *"$s"*) ;;
        *) echo "selftest FAIL: $label — output missing '$s'. Got:"; echo "$out"
           st_fails=$((st_fails + 1)); return;;
      esac
    done
    echo "selftest ok ($expect): $label"
  }

  st_expect "clean pair"          clean  "$(st_ops clean 150 '.contract.md')"
  st_expect "over-budget ops doc" defect "$(st_ops over-budget 150 '.contract.md')" \
            "over the 150-line runtime-ops budget"
  st_expect "orphaned ## heading" defect "$(st_ops heading-orphan 150 '.contract.md')" \
            "heading parity broken"
  st_expect "unpaired ops doc"    defect "$(st_ops no-pair 150 '.contract.md')" \
            "has no paired reference file"
  st_expect "contract pointer"    defect "$(st_ops contract-pointer 150 '.contract.md')" \
            "points at a full contract outside the labeled never-read-at-boot line"
  st_expect "empty target folder" defect "$(st_ops empty 150 '.contract.md')" \
            "no *.ops.md files found"
  st_expect "broken link anchor"  defect "$(st_links bad-link)" \
            "link anchor does not resolve"

  echo ""
  if [ "$st_fails" -ne 0 ]; then
    echo "check-ops-docs selftest: FAIL — $st_fails fixture case(s) misbehaved."
    exit 1
  fi
  echo "check-ops-docs selftest: PASS — every planted violation is caught and the clean pair stays silent."
  exit 0
fi

# ---------------------------------------------------------------------------
# Resolve the target set from the REPOSITORY ROOT, and print it.
# ---------------------------------------------------------------------------
CONTRACTS_DIR="$(resolve_dir "plugins/wf/skills/_contracts")"
WFGIT_DIR="$(resolve_dir "plugins/wf-git/capabilities/git/fragments")"
WFADO_DIR="$(resolve_dir "plugins/wf-ado/capabilities/ado/fragments")"
WFLINEAR_DIR="$(resolve_dir "plugins/wf-linear/capabilities/linear/fragments")"

opsdoc_count=0

print_targets() {
  local label="$1" dir="$2" rel f n=0
  if [ -z "$dir" ]; then
    printf '  %s: NOT FOUND\n' "$label"
    return
  fi
  rel="${dir#"$ROOT"/}"
  printf '  %s: %s\n' "$label" "$rel"
  for f in "$dir"/*.ops.md; do
    [ -e "$f" ] || continue
    printf '    - %s\n' "$(basename "$f")"
    n=$((n + 1))
  done
  [ "$n" -eq 0 ] && printf '    (no *.ops.md files)\n'
  opsdoc_count=$((opsdoc_count + n))
}

echo "check-ops-docs: repository root resolved to $ROOT"
echo "check-ops-docs: resolved target set —"
print_targets "core contracts (<=150)"  "$CONTRACTS_DIR"
print_targets "wf-git delivery (<=280)" "$WFGIT_DIR"
print_targets "wf-ado tracker (<=250)"  "$WFADO_DIR"
print_targets "wf-linear tracker (<=250)" "$WFLINEAR_DIR"
echo ""

# A target set that resolved empty has proven nothing — fail LOUDLY rather than
# passing vacuously. This is the guard that catches a mis-anchored move.
if [ "$opsdoc_count" -eq 0 ]; then
  printf 'ERROR: the resolved target set contains 0 *.ops.md files.\n'
  printf '       A check that inspects nothing cannot pass. This is a MIS-ANCHORED MOVE, not a clean tree —\n'
  printf '       verify craft_repo_root() in skill-targets.sh still resolves to the repository root.\n'
  printf 'check-ops-docs: FAILED (empty target set).\n'
  exit 1
fi

# ---------------------------------------------------------------------------
# Run the guards over every doc family. An ABSENT folder is a hard error.
# ---------------------------------------------------------------------------
if [ -n "$CONTRACTS_DIR" ]; then
  check_ops_docs "$CONTRACTS_DIR" 150 ".contract.md"
else
  err "core contracts folder not found (expected at plugins/wf/skills/_contracts)."
fi
if [ -n "$WFGIT_DIR" ]; then
  check_ops_docs "$WFGIT_DIR" 280 ".md"
else
  err "wf-git delivery fragments folder not found (expected at plugins/wf-git/capabilities/git/fragments)."
fi
if [ -n "$WFADO_DIR" ]; then
  check_ops_docs "$WFADO_DIR" 250 ".md"
else
  err "wf-ado tracker fragments folder not found (expected at plugins/wf-ado/capabilities/ado/fragments)."
fi
if [ -n "$WFLINEAR_DIR" ]; then
  check_ops_docs "$WFLINEAR_DIR" 250 ".md"
else
  err "wf-linear tracker fragments folder not found (expected at plugins/wf-linear/capabilities/linear/fragments)."
fi

[ -n "$CONTRACTS_DIR" ] && check_links "$CONTRACTS_DIR"
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
