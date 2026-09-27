#!/usr/bin/env bash
# check-legacy-progress-fallback.sh — the read-only legacy progress fallback must
# not outlive its removal window.
#
# WF-830 moved every implement write out of the approved plan into the phase's own
# progress record, so the plan stays byte-identical after its gate is approved.
# Tasks implemented before that change carry their progress in the plan instead,
# so each consumer of implement progress keeps a READ-ONLY fallback to the plan,
# and every such fallback carries one shared, greppable marker token. The fallback
# exists only to carry in-flight tasks across the change; left in place forever it
# would keep a second source of truth alive.
#
# This guard holds the core version the fallback shipped in as a literal. It reads
# the current core version and greps the tree for the marker:
#
#   - current MINOR <  shipped MINOR + WINDOW  → pass, whatever the marker count;
#   - current MINOR >= shipped MINOR + WINDOW  → fail while any marker remains,
#     naming every file that still carries one.
#
# The failure is the reminder: once the window closes, removing the fallbacks and
# this guard's wiring is the only way back to green.
#
# --selftest drives the same evaluator over seeded synthetic trees and requires it
# to ACCEPT a marker below the window, REJECT a marker at the window, and ACCEPT
# a clean tree at the window. Rejections are checked for the guard's own violation
# exit (1), never a harness error (2), so a broken fixture cannot pass as a catch.
#
# Usage:  bash check-legacy-progress-fallback.sh              # live-tree scan (CI)
#         bash check-legacy-progress-fallback.sh --selftest   # seeded fixtures only
#
# Exit 0 = inside the window, or no marker left; exit 1 = window closed and a
# marker remains; exit 2 = the guard could not run (version file unreadable).
#
# Model: claude-opus-5-5
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
SELF="$DIR/$(basename "${BASH_SOURCE[0]}")"

# The core version the fallback shipped in, and how many MINOR releases it lives.
SHIPPED_VERSION="0.163.0"
WINDOW=3
MARKER="wf-legacy-progress-fallback"

err() { printf 'check-legacy-progress-fallback: %s\n' "$*" >&2; }

# minor_of <semver> — prints the MINOR component, or nothing when unparseable.
minor_of() {
  printf '%s\n' "$1" | sed -n 's/^[0-9][0-9]*\.\([0-9][0-9]*\)\.[0-9][0-9]*.*$/\1/p'
}

# evaluate <version-file> <search-root> <shipped-version>
evaluate() {
  local version_file="$1" search_root="$2" shipped="$3"
  local current current_minor shipped_minor limit hits

  if [ ! -r "$version_file" ]; then
    err "version file not readable: $version_file"
    return 2
  fi
  current="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*$/\1/p' "$version_file" | head -n 1)"
  current_minor="$(minor_of "$current")"
  shipped_minor="$(minor_of "$shipped")"
  if [ -z "$current_minor" ] || [ -z "$shipped_minor" ]; then
    err "cannot parse a version (current '$current', shipped '$shipped')"
    return 2
  fi
  limit=$((shipped_minor + WINDOW))

  hits="$(grep -rlF --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=workspace-snapshot \
    "$MARKER" "$search_root" 2>/dev/null | grep -vxF "$SELF" | sort)"

  if [ "$current_minor" -lt "$limit" ]; then
    return 0
  fi
  if [ -n "$hits" ]; then
    err "core is at $current; the legacy progress fallback shipped in $shipped and its removal window closed at MINOR $limit."
    err "remove the read-only fallback (marker '$MARKER') from:"
    printf '%s\n' "$hits" | sed "s|^$search_root/|  |" >&2
    return 1
  fi
  return 0
}

selftest() {
  local tmp rc ok=0 bad=0
  tmp="$(mktemp -d)" || { err "mktemp failed"; return 2; }

  # seed <case> <core version> <with-marker: yes|no>
  seed() {
    mkdir -p "$tmp/$1/tree/skills/reader"
    printf '{\n  "name": "core",\n  "version": "%s"\n}\n' "$2" > "$tmp/$1/plugin.json"
    if [ "$3" = yes ]; then
      printf 'Read-only fallback — `%s`.\n' "$MARKER" > "$tmp/$1/tree/skills/reader/SKILL.md"
    else
      printf 'No fallback here.\n' > "$tmp/$1/tree/skills/reader/SKILL.md"
    fi
  }
  # expect <case> <exit-code> <description>
  expect() {
    evaluate "$tmp/$1/plugin.json" "$tmp/$1/tree" "0.10.0" 2>/dev/null
    rc=$?
    if [ "$rc" -eq "$2" ]; then
      printf 'PASS: %s\n' "$3"; ok=$((ok + 1))
    else
      printf 'FAIL: %s (exit %s, expected %s)\n' "$3" "$rc" "$2"; bad=$((bad + 1))
    fi
  }

  seed below-window 0.12.4 yes
  seed at-window 0.13.0 yes
  seed past-window 0.15.2 yes
  seed at-window-clean 0.13.0 no
  seed shipped-release 0.10.0 yes

  expect shipped-release 0 "marker in the shipping release passes"
  expect below-window 0 "marker below the window passes"
  expect at-window 1 "marker at the window is rejected"
  expect past-window 1 "marker past the window is rejected"
  expect at-window-clean 0 "clean tree at the window passes"

  rm -rf "$tmp"
  printf 'Self-test: %s passed, %s failed.\n' "$ok" "$bad"
  [ "$bad" -eq 0 ]
}

if [ "${1:-}" = "--selftest" ]; then
  selftest
  exit $?
fi

evaluate "$ROOT/plugins/wf/.claude-plugin/plugin.json" "$ROOT/plugins" "$SHIPPED_VERSION"
exit $?
