#!/usr/bin/env bash
# seed.sh — materialize the demo-fake fixture into a throwaway workspace.
#
# The committed fixture keeps its wf project tree under project/ because the repo
# gitignores every _local/ directory (so a literal _local/ could not be committed).
# This script reconstructs the real _local/ layout a wf skill boots from, substitutes
# the wf-fake plugin-root placeholder with the actual clean-install path, and gives the
# workspace a real (throwaway) git history — all at runtime, inside the container.
#
# Usage: seed.sh <target-workspace-dir> <wf-fake-install-root>
#
# Hermetic: touches only the target dir; reaches no network. The git history it creates
# is local-only (no remote), so `git` here performs no egress.
set -euo pipefail

WS="${1:?usage: seed.sh <target-workspace-dir> <wf-fake-install-root>}"
WF_FAKE_ROOT="${2:?usage: seed.sh <target-workspace-dir> <wf-fake-install-root>}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="$SRC_DIR/project"

[ -d "$PROJECT" ] || { echo "seed.sh: fixture project tree not found at $PROJECT" >&2; exit 1; }

mkdir -p "$WS/_local/fake" "$WS/_local/wf"

# config.md — substitute the plugin-root placeholder with the real install path.
sed "s#__WF_FAKE_ROOT__#${WF_FAKE_ROOT}#g" "$PROJECT/config.md" > "$WS/_local/config.md"

# scripted responses + task folders
cp "$PROJECT/fake-scripts.json" "$WS/_local/fake/scripts.json"
cp -R "$PROJECT/wf/." "$WS/_local/wf/"

# a real, local-only git history (no remote → no egress)
if [ ! -d "$WS/.git" ]; then
  git -C "$WS" init -q
  git -C "$WS" config user.email "fixture@fake.local"
  git -C "$WS" config user.name "demo-fake fixture"
  git -C "$WS" add -A
  git -C "$WS" commit -q -m "FAKE-1: seed demo-fake fixture workspace"
fi

echo "seed.sh: materialized demo-fake fixture into $WS (wf-fake root: $WF_FAKE_ROOT)"
