#!/usr/bin/env bash
# gh-token.sh — resolve a GitHub credential for cloning a PRIVATE source repository.
#
# Sourced, never executed. Two consumers, two very different exposure profiles:
#
#   build.sh   — hands the value to `docker build` as a BuildKit secret. Never a layer.
#   run-arm.sh — the value crosses into the container as an environment variable so the
#                workload seed can clone. run-arm.sh MUST unset it after the seed and before
#                the agent boots; the seeding step is the only thing entitled to see it.
#
# SHAPE CHECK, not decoration: `gh auth token` does not exist before gh 2.9, and older gh
# prints its usage error to STDOUT. An unchecked capture therefore yields a multi-line error
# message in place of a credential, which then corrupts whatever consumes it. Every candidate
# is validated before it is accepted.

# looks_like_token <candidate> — 0 when the value is shaped like a credential.
looks_like_token() {
  local t="$1"
  [ -n "$t" ] || return 1
  [ "$(printf '%s' "$t" | wc -l)" -eq 0 ] || return 1   # no embedded newline
  case "$t" in *[[:space:]]*) return 1;; esac
  [ "${#t}" -ge 20 ] || return 1
}

# resolve_gh_token — echo a credential, or nothing. Never fails: a public source repository
# needs no credential, so "none found" is a legitimate outcome and the caller's clone decides.
# Order is most-explicit-first, so an operator can always override what gh has stored.
resolve_gh_token() {
  local t
  for t in "${WF_SEED_GH_TOKEN:-}" "${GH_TOKEN:-}" "${GITHUB_TOKEN:-}"; do
    if looks_like_token "$t"; then printf '%s' "$t"; return 0; fi
  done
  if command -v gh >/dev/null 2>&1; then
    t="$(gh auth token 2>/dev/null || true)"
    if looks_like_token "$t"; then printf '%s' "$t"; return 0; fi
  fi
  # gh < 2.9 has no `auth token` subcommand; read its stored credential directly.
  local hosts="${GH_CONFIG_DIR:-$HOME/.config/gh}/hosts.yml"
  if [ -r "$hosts" ]; then
    # Single-pass, NO pipe — the same SIGPIPE class fixed in the transcript scanners. A
    # multi-host hosts.yml yields more matches than `head -n1` reads, so `sed | head` leaves
    # sed writing into a closed pipe: exit 141, promoted to fatal by the `set -euo pipefail`
    # in the scripts that source this file. awk stops itself on the first match.
    t="$(awk '/^[[:space:]]*oauth_token:[[:space:]]*/ {
                sub(/^[[:space:]]*oauth_token:[[:space:]]*/, "")
                gsub(/["\047]/, "")
                print; exit
              }' "$hosts" 2>/dev/null || true)"
    if looks_like_token "$t"; then printf '%s' "$t"; return 0; fi
  fi
  return 0
}

# git_clone_maybe_authenticated <repo-url> <target> — clone, using <token> only if non-empty.
#
# The credential never enters argv, the remote URL, or .git/config: a throwaway helper script
# reads it from a file descriptor-backed temp file at the moment git asks. Callers that must
# leave no trace strip the remote afterwards (clone_and_strip already does).
git_clone_maybe_authenticated() {
  local repo_url="$1" target="$2" token="$3"
  if [ -z "$token" ]; then
    git clone --quiet "$repo_url" "$target"
    return $?
  fi
  local tokfile helper rc
  tokfile="$(mktemp)"; helper="$(mktemp)"
  chmod 600 "$tokfile" "$helper"
  printf '%s' "$token" > "$tokfile"
  printf '#!/bin/sh\necho username=x-access-token\necho "password=$(cat %s)"\n' "$tokfile" > "$helper"
  chmod 700 "$helper"
  GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=credential.helper GIT_CONFIG_VALUE_0="$helper" \
    git clone --quiet "$repo_url" "$target"
  rc=$?
  rm -f "$tokfile" "$helper"
  return $rc
}
