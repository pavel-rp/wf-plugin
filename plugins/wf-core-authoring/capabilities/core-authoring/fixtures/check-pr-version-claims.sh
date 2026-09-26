#!/usr/bin/env bash
# check-pr-version-claims.sh — flags a composed pull-request body whose version
# claims disagree with the version fields the branch's diff actually sets
# (WF-757, charter C039 OUT-4).
#
# This is the executable form of this repository's release-version rule
# (CLAUDE.md §8): every change bumps a plugin's `plugin.json` `version`, the
# matching `.claude-plugin/marketplace.json` `plugins[]` entry, and the
# marketplace top-level `version`. A body that announces a version the diff does
# not set is the escape this check catches. It is reached at runtime through the
# core-authoring capability's `pr.body-check` slot fill
# (`fragments/pr-version-claims.md`), and proven here by `--selftest`.
#
# --- The rule ---
# SET   = every semver value on an ADDED diff line of the form
#         `"version": "X.Y.Z"` inside a file whose path ends in `plugin.json` or
#         `marketplace.json`. Removed lines and other files never contribute.
# CLAIM = on each body line that mentions "version" or "bump" (any case), the
#         semver token right after each arrow (`->` or `→`) when the line has
#         one; otherwise every semver token on the line. The left-hand side of an
#         arrow is the prior version, so it is never a claim.
# A CLAIM absent from SET is a mismatch. A body with no claims passes, and so
# does a diff that sets versions the body never mentions — the check compares
# what the body says, it never requires the body to say anything.
#
# Usage:
#   check-pr-version-claims.sh --body <file> --diff <file>
#   check-pr-version-claims.sh --selftest
#
# Exit 0 = no mismatch; 1 = at least one mismatched claim (each named on
# stdout); 2 = usage error or unreadable input — never a pass.
#
# Model: claude-opus-5-5
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURES="$DIR/pr-version-claims-fixtures"

usage() { printf 'usage: %s --body <file> --diff <file> | --selftest\n' "$(basename "$0")" >&2; exit 2; }

set_versions() {
  awk '
    /^\+\+\+ / { f = $2; sub(/^b\//, "", f); next }
    /^---/     { next }
    /^\+/ {
      if (f !~ /(^|\/)(plugin|marketplace)\.json$/) next
      line = $0
      while (match(line, /"version"[[:space:]]*:[[:space:]]*"[0-9]+\.[0-9]+\.[0-9]+"/)) {
        tok = substr(line, RSTART, RLENGTH)
        match(tok, /[0-9]+\.[0-9]+\.[0-9]+/)
        print substr(tok, RSTART, RLENGTH)
        line = substr(line, RSTART + RLENGTH)
      }
    }
  ' "$1" | LC_ALL=C sort -u
}

body_claims() {
  # Prints "<line-number> <semver>" per claim.
  awk '
    BEGIN { sv = "[0-9]+\\.[0-9]+\\.[0-9]+" }
    {
      low = tolower($0)
      if (low !~ /version|bump/) next
      line = $0
      gsub(/→/, "->", line)
      if (index(line, "->") > 0) {
        n = split(line, parts, "->")
        for (i = 2; i <= n; i++) {
          p = parts[i]
          sub(/^[[:space:]`*"]*v?/, "", p)
          if (match(p, "^" sv)) print NR, substr(p, RSTART, RLENGTH)
        }
      } else {
        rest = line
        while (match(rest, sv)) {
          print NR, substr(rest, RSTART, RLENGTH)
          rest = substr(rest, RSTART + RLENGTH)
        }
      }
    }
  ' "$1"
}

check() {
  local body="$1" diff="$2"
  [ -r "$body" ] || { printf 'check-pr-version-claims: body file not readable: %s\n' "$body" >&2; return 2; }
  [ -r "$diff" ] || { printf 'check-pr-version-claims: diff file not readable: %s\n' "$diff" >&2; return 2; }
  local set claims ln v bad=0
  set="$(set_versions "$diff")"
  claims="$(body_claims "$body")"
  while read -r ln v; do
    [ -n "${v:-}" ] || continue
    if ! printf '%s\n' "$set" | grep -qxF "$v"; then
      printf 'MISMATCH: body line %s claims version %s, which no changed version field in the diff sets (set: %s)\n' \
        "$ln" "$v" "$(printf '%s' "$set" | tr '\n' ' ' | sed 's/ $//')"
      bad=1
    fi
  done <<< "$claims"
  return "$bad"
}

selftest() {
  local fail=0 case expect rc
  for case in mismatch:1 match:0 no-claims:0 prior-version-only:0; do
    expect="${case#*:}"; case="${case%%:*}"
    rc=0
    check "$FIXTURES/$case/body.md" "$FIXTURES/$case/diff.patch" >/dev/null || rc=$?
    if [ "$rc" -eq "$expect" ]; then
      printf 'PR-VERSION-CLAIMS selftest: %s -> exit %s (expected %s) PASS\n' "$case" "$rc" "$expect"
    else
      printf 'PR-VERSION-CLAIMS selftest: %s -> exit %s (expected %s) FAIL\n' "$case" "$rc" "$expect" >&2
      fail=1
    fi
  done
  rc=0; check "$FIXTURES/missing/body.md" "$FIXTURES/missing/diff.patch" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 2 ]; then
    echo "PR-VERSION-CLAIMS selftest: unreadable input -> exit 2 PASS"
  else
    echo "PR-VERSION-CLAIMS selftest: unreadable input -> exit $rc (expected 2) FAIL" >&2; fail=1
  fi
  [ "$fail" -eq 0 ] && echo "PR-VERSION-CLAIMS: selftest PASS" || echo "PR-VERSION-CLAIMS: selftest FAIL" >&2
  return "$fail"
}

BODY="" DIFF=""
case "${1:-}" in
  --selftest) selftest; exit $? ;;
  "") usage ;;
esac
while [ $# -gt 0 ]; do
  case "$1" in
    --body) BODY="${2:-}"; shift 2 ;;
    --diff) DIFF="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$BODY" ] && [ -n "$DIFF" ] || usage
check "$BODY" "$DIFF"
exit $?
