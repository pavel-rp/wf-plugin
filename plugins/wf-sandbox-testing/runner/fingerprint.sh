#!/usr/bin/env bash
# fingerprint.sh — deterministic content fingerprints for every runner input.
#
# Sourced by run-skill.sh (records fingerprints in run.json) and by selfcheck.sh
# (exercises the SAME code in the determinism guard, so the check can never drift
# from the runner). Defines functions only; running it directly is a no-op.
#
# Determinism contract: a fingerprint is a SHA-256 over file CONTENT ONLY, with
# entries sorted (LC_ALL=C) and volatile paths excluded (.git object churn, the
# run-output directory, the fake op log). Timestamps, inode order, and mtimes never
# enter the hash — so byte-identical inputs always produce byte-identical fingerprints.
set -uo pipefail

# fingerprint_tree <dir> [extra-exclude-ERE]
#   Prints a single 64-hex-char SHA-256 fingerprint of the tree's content.
fingerprint_tree() {
  local dir="$1"
  local extra_exclude="${2:-}"
  if [ ! -d "$dir" ]; then
    echo "fingerprint_tree: not a directory: $dir" >&2
    return 2
  fi
  (
    cd "$dir" || exit 2
    find . -type f \
      ! -path './.git/*' \
      ! -path '*/.git/*' \
      ! -path './run-output/*' \
      ! -name 'op-log.jsonl' \
      ! -name 'run.json' \
    | { if [ -n "$extra_exclude" ]; then grep -Ev "$extra_exclude"; else cat; fi; } \
    | LC_ALL=C sort \
    | while IFS= read -r f; do
        printf '%s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"
      done \
    | sha256sum | cut -d' ' -f1
  )
}

# fingerprint_cli — the claude CLI version string (a fingerprinted input, so CLI
# drift is a deliberate re-fingerprint event, never a silent behavior change).
fingerprint_cli() {
  claude --version 2>/dev/null | head -n1 | tr -d '\n'
}
