#!/usr/bin/env bash
# seed.sh — materialize one fresh fleet-standard workspace from project.seed.json.
#
# Usage: seed.sh <empty-workspace-dir> <wf-fake-install-root> [wf-audit-install-root]
#
# The third argument may instead be supplied as WF_AUDIT_ROOT. When omitted, the
# script locates wf-audit beside a clean-installed wf-fake marketplace entry.
# This script is offline: it creates no remote, invokes no model, and never writes
# outside the target workspace.
set -euo pipefail

WS="${1:?usage: seed.sh <empty-workspace-dir> <wf-fake-install-root> [wf-audit-install-root]}"
WF_FAKE_ROOT="${2:?usage: seed.sh <empty-workspace-dir> <wf-fake-install-root> [wf-audit-install-root]}"
WF_AUDIT_ROOT="${3:-${WF_AUDIT_ROOT:-}}"

FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED="$FIXTURE_DIR/project.seed.json"

command -v jq >/dev/null 2>&1 || { echo "seed.sh: jq is required" >&2; exit 2; }
command -v git >/dev/null 2>&1 || { echo "seed.sh: git is required" >&2; exit 2; }
jq -e '.schema == "wf-sandbox-testing.fleet-standard.seed/v1"' "$SEED" >/dev/null || {
  echo "seed.sh: invalid or unsupported seed at $SEED" >&2
  exit 2
}

# The runner historically passes only wf-fake. A clean marketplace cache installs
# pack roots as siblings beneath <marketplace>/<plugin>/<version>, so locate audit
# there without consulting the network or a user config directory.
if [ -z "$WF_AUDIT_ROOT" ]; then
  marketplace_root="$(dirname "$(dirname "$WF_FAKE_ROOT")")"
  audit_manifest="$(find "$marketplace_root/wf-audit" -mindepth 3 -maxdepth 3 -type f -path '*/capabilities/audit/manifest.md' 2>/dev/null | sort | tail -n 1 || true)"
  [ -n "$audit_manifest" ] && WF_AUDIT_ROOT="${audit_manifest%/capabilities/audit/manifest.md}"
fi
[ -n "$WF_AUDIT_ROOT" ] || {
  echo "seed.sh: wf-audit root is required (third argument or WF_AUDIT_ROOT)" >&2
  exit 2
}

mkdir -p "$WS"
if find "$WS" -mindepth 1 -maxdepth 1 -print -quit | grep -q .; then
  echo "seed.sh: target workspace must be empty: $WS" >&2
  exit 2
fi

# Materialize every declared file. Reject absolute and traversal paths before any
# write so a malformed committed seed cannot escape this disposable workspace.
while IFS= read -r encoded; do
  entry="$(printf '%s' "$encoded" | base64 --decode)"
  rel="$(printf '%s' "$entry" | jq -r '.key')"
  case "/$rel/" in
    /*/../*|/*/./*) echo "seed.sh: unsafe workspace path in seed: $rel" >&2; exit 2;;
  esac
  case "$rel" in
    /*|""|_local/fake/op-log.jsonl) echo "seed.sh: forbidden workspace path in seed: $rel" >&2; exit 2;;
  esac
  mkdir -p "$WS/$(dirname "$rel")"
  printf '%s' "$entry" | jq -j '.value' > "$WS/$rel"
done < <(jq -r '.workspace.files | to_entries[] | @base64' "$SEED")

mkdir -p "$WS/_local/fake"
config="$(jq -r '.configTemplate' "$SEED")"
config="${config//__WF_FAKE_ROOT__/$WF_FAKE_ROOT}"
config="${config//__WF_AUDIT_ROOT__/$WF_AUDIT_ROOT}"
printf '%s\n' "$config" > "$WS/_local/config.md"

# Substitute only the disposable workspace token. The resulting scripts are a
# fresh, unconsumed copy; deliberately do not create op-log.jsonl.
jq --arg ws "$WS" 'walk(if type == "string" then gsub("__WORKSPACE_ROOT__"; $ws) else . end) | .fakeScripts' \
  "$SEED" > "$WS/_local/fake/scripts.json"
[ ! -e "$WS/_local/fake/op-log.jsonl" ] || {
  echo "seed.sh: internal error: operation log exists at clean start" >&2
  exit 3
}

# Deterministic local-only history. _local/ is intentionally ignored: machine-local
# plugin roots must not make the seed commit differ between disposable boundaries.
git -C "$WS" init -q -b "$(jq -r '.git.initialBranch' "$SEED")"
git -C "$WS" config user.name "$(jq -r '.git.userName' "$SEED")"
git -C "$WS" config user.email "$(jq -r '.git.userEmail' "$SEED")"
git -C "$WS" add -A
GIT_AUTHOR_DATE="$(jq -r '.git.timestamp' "$SEED")" \
GIT_COMMITTER_DATE="$(jq -r '.git.timestamp' "$SEED")" \
  git -C "$WS" commit -q -m "$(jq -r '.git.commitMessage' "$SEED")"

if [ -n "$(git -C "$WS" remote)" ]; then
  echo "seed.sh: internal error: disposable repository has a remote" >&2
  exit 3
fi

printf 'seed.sh: materialized fleet-standard in %s (local-only, op log absent)\n' "$WS"
