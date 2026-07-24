#!/usr/bin/env bash
# seed.sh — deterministically materialize the accepted fleet-two-task fixture.
#
# The fixture's measured accounting inputs are a synthetic two-child session bundle
# (generate-bundle.mjs) — a set of raw transcripts that outcome 9 forbids committing, so they
# are regenerated fresh (byte-identical every run) into a throwaway projects root; only the
# DERIVED reference under reference/ is committed.
#
# "Durable fixture state" for this fixture is that generated bundle directory. This script
# resets it deterministically before materializing, so a re-seed can never inherit stale state.
#
# Usage:
#   seed.sh <target-dir> [<wf-fake-install-root>]
#       Reset + regenerate the synthetic bundle into <target-dir>/projects. When a wf-fake
#       install root is given, ALSO materialize the hermetic project workspace (config.md +
#       fake scripts + FLEET task folders + a local-only git history) under <target-dir>/workspace,
#       exactly as the demo-fake fixture does.
#
#   seed.sh --prove-reset [<scratch-dir>]
#       Prove the reset leaves NO leakage: materialize, plant a stray artifact inside the durable
#       bundle state, re-seed (reset), and prove the regenerated tree is byte-identical and the
#       stray artifact is gone. Exits 0 on proof, non-zero on any residue. Uses a scratch dir
#       under _local/scratch/ by default and cleans it up.
#
# Hermetic: touches only the target/scratch dir; reaches no network.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="$SRC_DIR/generate-bundle.mjs"
FLEET_COST="$SRC_DIR/../../accounting/fleet-cost.mjs"
PROJECT="$SRC_DIR/project"
SESSION="fleet-two-task-synthetic"

materialize_bundle() {
  # Deterministic reset happens inside generate-bundle.mjs (it rm -rf's the out dir first).
  node "$GEN" --out "$1"
}

materialize_workspace() {
  local ws="$1" fake_root="$2"
  mkdir -p "$ws/_local/fake" "$ws/_local/wf"
  sed "s#__WF_FAKE_ROOT__#${fake_root}#g" "$PROJECT/config.md" > "$ws/_local/config.md"
  cp "$PROJECT/fake-scripts.json" "$ws/_local/fake/scripts.json"
  cp -R "$PROJECT/wf/." "$ws/_local/wf/"
  if [ ! -d "$ws/.git" ]; then
    git -C "$ws" init -q
    git -C "$ws" config user.email "fixture@fake.local"
    git -C "$ws" config user.name "fleet-two-task fixture"
    git -C "$ws" add -A
    git -C "$ws" commit -q -m "FLEET-1: seed fleet-two-task fixture workspace"
  fi
}

tree_hash() {
  node "$FLEET_COST" evidence --session "$SESSION" --root "$1" --repo-root "$1" --tree "$1" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{process.stdout.write(JSON.parse(s).treeHash+"\n")})'
}

prove_reset() {
  local scratch="${1:-$SRC_DIR/../../../../_local/scratch/fleet-two-task-prove-$$}"
  mkdir -p "$scratch"
  # shellcheck disable=SC2064
  trap "rm -rf '$scratch'" EXIT

  local proj="$scratch/projects"
  materialize_bundle "$proj"
  local before; before="$(tree_hash "$proj")"

  # Plant a stray artifact inside the durable bundle state — a leakage a naive re-run would inherit.
  echo "leaked" > "$proj/$SESSION/subagents/agent-c1-99-leak.jsonl"
  echo '{"role":"leak"}' > "$proj/$SESSION/subagents/agent-c1-99-leak.meta.json"
  local leaked; leaked="$(tree_hash "$proj")"

  # Re-seed: the deterministic reset must wipe the stray artifact and restore the canonical tree.
  materialize_bundle "$proj"
  local after; after="$(tree_hash "$proj")"

  if [ -f "$proj/$SESSION/subagents/agent-c1-99-leak.jsonl" ]; then
    echo "seed.sh --prove-reset: FAIL — stray artifact survived the reset (leakage)" >&2
    exit 1
  fi
  if [ "$leaked" = "$before" ]; then
    echo "seed.sh --prove-reset: FAIL — planted leakage did not change the tree hash; the proof is vacuous" >&2
    exit 1
  fi
  if [ "$before" != "$after" ] || [ -z "$after" ]; then
    echo "seed.sh --prove-reset: FAIL — regenerated tree hash '$after' != pre-leak '$before'" >&2
    exit 1
  fi
  echo "seed.sh --prove-reset: PASS — reset restored the canonical tree ($after); no leakage"
}

main() {
  if [ "${1:-}" = "--prove-reset" ]; then
    prove_reset "${2:-}"
    return
  fi
  local target="${1:?usage: seed.sh <target-dir> [<wf-fake-install-root>] | seed.sh --prove-reset [<scratch-dir>]}"
  materialize_bundle "$target/projects"
  if [ -n "${2:-}" ]; then
    materialize_workspace "$target/workspace" "$2"
    echo "seed.sh: materialized fleet-two-task bundle ($target/projects) + project workspace ($target/workspace)"
  else
    echo "seed.sh: materialized fleet-two-task synthetic bundle into $target/projects"
  fi
}

main "$@"
