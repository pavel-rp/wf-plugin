#!/usr/bin/env bash
# lib.sh — shared assertion primitives over ONE run-output directory produced by the
# WF-345 hermetic runner (plugins/wf-sandbox-testing/runner/run-skill.sh).
#
# A run-output directory has the shape run-skill.sh writes:
#   <run>/transcript.jsonl              stream-json (a single JSON array, or JSON-lines)
#   <run>/run.json                      self-describing record { verdict, fingerprints{ plugin_build, … }, … }
#   <run>/workspace-snapshot/…          the resulting workspace files (excl. .git)
#   <run>/workspace-snapshot/_local/fake/op-log.jsonl   the fake provider op log
#
# These functions READ those outputs; they never run a container and never reach the
# network. Sourcing this file defines the functions WITHOUT running anything (like the
# runner's fingerprint.sh) — protocol.sh, compare.sh, tiers.sh and run.sh source it.
#
# Assertions are STRUCTURAL over transcript + workspace + op log — never an exact-match
# on transcript prose (locked decision 1). The three families:
#   terminal_block  — the fenced `NAME — status` block a skill ends with (name + status token)
#   files_touched   — paths present in the resulting workspace snapshot
#   ops_invoked     — the set of `surface:op` pairs the fake op log recorded
set -uo pipefail

# require_jq — the JSON parsing here needs jq (same policy as validate-profile.sh: an
# absent jq is an environment error, exit 2, never a silent skip that fakes a pass).
require_jq() {
  command -v jq >/dev/null 2>&1 && return 0
  echo "assert/lib.sh: jq is required (JSON transcript/op-log/settings parsing) — install jq." >&2
  return 2
}

# transcript_values <transcript> — emit each top-level stream-json message as one compact
# JSON line, whether the file is a single JSON array or JSON-lines. Normalizes the two
# parseable shapes run-skill.sh's assert_stream_json accepts.
transcript_values() {
  local f="$1"
  [ -s "$f" ] || return 1
  if jq -e 'type=="array"' "$f" >/dev/null 2>&1; then
    jq -c '.[]' "$f" 2>/dev/null
  else
    jq -c '.' "$f" 2>/dev/null
  fi
}

# TERMINAL_BLOCK_ERE — a well-formed final-output header line: an uppercase block NAME
# (one or more uppercase words) then the em-dash separator then a status. Structural: it
# matches the SHAPE every skill's final block ends with, not any specific prose.
TERMINAL_BLOCK_ERE='^[A-Z][A-Z0-9-]*( [A-Z0-9-]+)* — .+'

# extract_terminal_block <transcript> — print "NAME<TAB>STATUS" for the LAST well-formed
# terminal-block header found across the transcript's result + assistant text, or nothing
# (exit 1) when no block-shaped line is present. STATUS is the first token after the dash.
extract_terminal_block() {
  local f="$1" line name status last=""
  # Candidate strings: the result payload, plus every assistant text block.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    if printf '%s' "$line" | grep -Eq "$TERMINAL_BLOCK_ERE"; then
      last="$line"
    fi
  done < <(
    transcript_values "$f" | jq -r '
      if .type=="result" then (.result // empty)
      elif .type=="assistant" then ((.message.content // [])[] | select(.type=="text") | .text)
      else empty end' 2>/dev/null \
      | sed $'s/\r//g' | tr '\n' '\n'
  )
  [ -n "$last" ] || return 1
  name="$(printf '%s' "$last" | sed -E 's/ — .*$//')"
  status="$(printf '%s' "$last" | sed -E 's/^[^—]* — //' | awk '{print $1}')"
  printf '%s\t%s\n' "$name" "$status"
}

# extract_ops <run-dir> — print the sorted, unique "surface:op" pairs the op log recorded.
# The op log lives in the workspace snapshot; an absent log prints nothing (a run that
# invoked no provider op), which the families treat as an empty observed set.
extract_ops() {
  local run="$1" log="$1/workspace-snapshot/_local/fake/op-log.jsonl"
  [ -f "$log" ] || return 0
  jq -r 'select(.surface and .op) | "\(.surface):\(.op)"' "$log" 2>/dev/null | LC_ALL=C sort -u
}

# list_workspace_files <run-dir> — print snapshot-relative file paths in the resulting
# workspace (evidence of what the run touched), sorted for determinism.
list_workspace_files() {
  local snap="$1/workspace-snapshot"
  [ -d "$snap" ] || return 0
  ( cd "$snap" && find . -type f | sed 's#^\./##' | LC_ALL=C sort )
}

# workspace_has_glob <run-dir> <glob> — 0 if any snapshot file path matches <glob>.
workspace_has_glob() {
  local run="$1" glob="$2" f
  while IFS= read -r f; do
    # shellcheck disable=SC2254
    case "$f" in $glob) return 0;; esac
  done < <(list_workspace_files "$run")
  return 1
}

# parse_token_cost <transcript> — print "usd=<X> tokens=<N>" parsed from the stream-json
# result message. total_cost_usd is used when the CLI emitted it; tokens is the sum of the
# result usage input+output. Missing fields print 0 — token cost is logged, never invented.
parse_token_cost() {
  local f="$1" usd tokens
  usd="$(transcript_values "$f" | jq -s -r '
      map(select(.type=="result")) | (last // {}) | (.total_cost_usd // 0)' 2>/dev/null)"
  tokens="$(transcript_values "$f" | jq -s -r '
      map(select(.type=="result")) | (last // {}) | (.usage // {})
      | ((.input_tokens // 0) + (.output_tokens // 0))' 2>/dev/null)"
  [ -n "$usd" ] || usd=0
  [ -n "$tokens" ] || tokens=0
  printf 'usd=%s tokens=%s\n' "$usd" "$tokens"
}

# run_plugin_build <run-dir> — print the fingerprinted plugin build id recorded in
# run.json (distinguishes a current-build run set from a pinned-baseline run set for the
# comparison assertion). Empty when run.json is absent.
run_plugin_build() {
  local rj="$1/run.json"
  [ -f "$rj" ] || return 0
  jq -r '(.fingerprints.plugin_build // .fingerprints.pluginBuild // "")' "$rj" 2>/dev/null
}

# list_run_dirs <set-dir> — print each immediate child directory that looks like a run
# output (has a transcript.jsonl), sorted. A run set is a directory OF run-output dirs.
list_run_dirs() {
  local set="$1" d
  [ -d "$set" ] || return 0
  for d in "$set"/*/; do
    [ -d "$d" ] || continue
    [ -f "${d%/}/transcript.jsonl" ] || continue
    printf '%s\n' "${d%/}"
  done | LC_ALL=C sort
}
