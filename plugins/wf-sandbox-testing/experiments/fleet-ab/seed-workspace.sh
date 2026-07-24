#!/usr/bin/env bash
# seed-workspace.sh — materialize ONE arm's blinded, deterministic workspace, then run the
# arm's own unmeasured setup (clean plugin install already happened at container build; this
# script clones the WORKLOAD snapshot, runs /wf:init + the arm's pack init skills + writes the
# fake provider config) — and fails LOUD, before any measured spend, if blinding is violated.
#
# Two invocations:
#
#   seed-workspace.sh <target-dir> --workload-ref <ref> --fake-scripts <path> \
#       [--repo-url <url>] [--config-dir <dir>] [--marketplace-dir <dir>] \
#       [--marketplace-name <name>] [--packs "wf wf-audit wf-fake"] [--out <setup-out-dir>]
#     The real per-arm-container seed: clone repo@ref, strip remote, deterministic timestamps,
#     run the unmeasured setup skills, write the fake config, then run the blinding gate.
#
#   seed-workspace.sh --prove-blinding [<scratch-dir>]
#     Offline self-check (no network, no claude, no Docker): materializes only the
#     EXPERIMENT-INJECTED content (a clean synthetic _local/config.md + fake scripts.json) in a
#     throwaway scratch dir, proves the gate PASSES on clean content, plants a banned word into
#     the injected content, and proves the gate FAILS CLOSED. Exits 0 on proof, non-zero on any
#     unproven case. Mirrors fleet-two-task/seed.sh --prove-reset's leakage-proof shape.
#
# Hermetic scope note: this script is authored and bash -n syntax-checked only in this session —
# no Docker, no git clone, no claude invocation is exercised here. --prove-blinding is the one
# mode that IS actually run, because it needs none of those.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/../../runner" && pwd)"
# shellcheck source=../../runner/fingerprint.sh
. "$RUNNER_DIR/fingerprint.sh"

DEFAULT_REPO_URL="https://github.com/pavel-rp/wf-plugin.git"
DEFAULT_PACKS="wf wf-audit wf-fake"
DEFAULT_MARKETPLACE_NAME="wf-marketplace"
# Design doc §6: banned in anything the EXPERIMENT injects — never a tree-wide grep (the
# workload snapshot's own historical docs are exempt and would fail a tree-wide gate permanently).
BANNED_WORDS_ERE='\b(experiment|experiments|baseline|baselines|measurement|measurements|token-efficiency|arm|arms|A/B)\b'

usage() {
  cat >&2 <<'EOF'
usage:
  seed-workspace.sh <target-dir> --workload-ref <ref> --fake-scripts <path>
                     [--repo-url <url>] [--config-dir <dir>] [--marketplace-dir <dir>]
                     [--marketplace-name <name>] [--packs "wf wf-audit wf-fake"]
                     [--out <setup-out-dir>]
  seed-workspace.sh --prove-blinding [<scratch-dir>]
EOF
}

# ---------------------------------------------------------------------------------------------
# run_blinding_gate <workspace-dir> — fails loudly on any blinding violation. Greps ONLY the
# specific files this script itself injects (never the whole workspace tree), and checks the
# two presence guards (design doc §6.2: W must predate this doc / the kit).
# ---------------------------------------------------------------------------------------------
run_blinding_gate() {
  local ws="$1"
  local problems=0

  if compgen -G "$ws/docs/wf382-*" > /dev/null 2>&1; then
    echo "seed-workspace.sh: BLINDING FAIL — seeded tree contains docs/wf382-* (the design doc must not exist at ref W)" >&2
    problems=1
  fi
  if [ -d "$ws/experiments" ]; then
    echo "seed-workspace.sh: BLINDING FAIL — seeded tree contains an experiments/ directory (the kit must not exist at ref W)" >&2
    problems=1
  fi

  local injected=() f rc
  [ -f "$ws/_local/config.md" ] && injected+=("$ws/_local/config.md")
  [ -f "$ws/_local/fake/scripts.json" ] && injected+=("$ws/_local/fake/scripts.json")
  for f in "${injected[@]}"; do
    # grep exits 0=match, 1=no-match, 2=error. A fail-closed gate must treat an error (2+)
    # as a violation, never silently pass it as a no-match — so capture the real exit code
    # instead of folding 1 and 2 together in an `if grep` test.
    rc=0
    grep -iEn "$BANNED_WORDS_ERE" "$f" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "seed-workspace.sh: BLINDING FAIL — banned blinding vocabulary found in injected content '$f':" >&2
      grep -iEn "$BANNED_WORDS_ERE" "$f" >&2 || true
      problems=1
    elif [ "$rc" -ge 2 ]; then
      echo "seed-workspace.sh: BLINDING FAIL — grep errored (exit $rc) scanning injected content '$f' — failing closed" >&2
      problems=1
    fi
  done

  if [ "$problems" -ne 0 ]; then
    echo "seed-workspace.sh: blinding gate FAILED — refusing to hand this workspace to an agent." >&2
    return 3
  fi
  echo "seed-workspace.sh: blinding gate PASSED — no banned vocabulary in injected content, no wf382-*/experiments/ in the tree." >&2
  return 0
}

# ---------------------------------------------------------------------------------------------
# clone_and_strip <target-dir> <repo-url> <workload-ref> — fresh clone at the pinned workload
# ref, remote stripped, deterministic timestamps, LOCAL-ONLY single-commit history (design doc
# §3: "fresh clone, local-only history, no remote, deterministic _local/ init").
# ---------------------------------------------------------------------------------------------
clone_and_strip() {
  local target="$1" repo_url="$2" workload_ref="$3"
  rm -rf "$target"
  mkdir -p "$target"
  echo "seed-workspace.sh: cloning $repo_url @ $workload_ref into $target" >&2
  git clone --quiet "$repo_url" "$target"
  git -C "$target" checkout --quiet "$workload_ref"
  rm -rf "$target/.git"

  # Deterministic timestamps on every file BEFORE the fresh local-only commit, so the seeded
  # tree's content is a pure function of (repo_url, workload_ref) — never of wall-clock.
  find "$target" -type f -exec touch -d '2026-01-01T00:00:00Z' {} +

  export GIT_AUTHOR_NAME="fleet-ab seed" GIT_AUTHOR_EMAIL="fleet-ab@fake.local"
  export GIT_COMMITTER_NAME="fleet-ab seed" GIT_COMMITTER_EMAIL="fleet-ab@fake.local"
  export GIT_AUTHOR_DATE="2026-01-01T00:00:00Z" GIT_COMMITTER_DATE="2026-01-01T00:00:00Z"
  git -C "$target" init -q
  git -C "$target" add -A
  git -C "$target" commit -q -m "fleet-ab: seed workload snapshot at ref $workload_ref (local-only history, no remote)"
  unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_AUTHOR_DATE GIT_COMMITTER_DATE
}

# ---------------------------------------------------------------------------------------------
# run_unmeasured_setup <workspace> <config-dir> <packs...> — the arm's OWN /wf:init + pack init
# skills (design doc §3 "Registration"), run headless, UNMEASURED (a separate claude invocation
# from the measured /wf:fleet session run-arm.sh drives). Every one of these init skills takes
# no arguments and is non-interactive (confirmed against plugins/wf/skills/init/SKILL.md and
# plugins/wf-fake/skills/init/SKILL.md — no prompt/answer plumbing needed).
# ---------------------------------------------------------------------------------------------
run_unmeasured_setup() {
  local ws="$1" cfg="$2" out="$3"; shift 3
  local -a packs=("$@")
  mkdir -p "$out/setup"
  local sessions_json="$out/setup-sessions.json"
  printf '[\n' > "$sessions_json"
  local first=1 pack skill transcript sid
  for pack in "${packs[@]}"; do
    case "$pack" in
      wf) skill="/wf:init" ;;
      *)  skill="/${pack}:init" ;;
    esac
    transcript="$out/setup/$(echo "$pack" | tr -c 'A-Za-z0-9' '-').jsonl"
    echo "seed-workspace.sh: unmeasured setup — invoking '$skill'" >&2
    ( cd "$ws" && CLAUDE_CONFIG_DIR="$cfg" claude -p "$skill" \
        --output-format stream-json --dangerously-skip-permissions ) > "$transcript" 2>&1
    sid="$(grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]+"' "$transcript" 2>/dev/null \
      | head -n1 | sed -E 's/.*"([^"]+)"$/\1/')"
    [ "$first" = 1 ] || printf ',\n' >> "$sessions_json"
    first=0
    printf '  { "skill": "%s", "session_id": "%s", "transcript": "%s" }' \
      "$skill" "$sid" "$transcript" >> "$sessions_json"
  done
  printf '\n]\n' >> "$sessions_json"
  echo "seed-workspace.sh: unmeasured setup done — sessions recorded in $sessions_json" >&2
}

# ---------------------------------------------------------------------------------------------
# write_fake_config <workspace> <fake-scripts-path> — materializes the fake capability's config
# section + scripts file (wf-fake owns BOTH delivery and tracker — design doc §3 "Providers").
# The registry row itself was already written by run_unmeasured_setup's /wf-fake:init call; this
# only seeds the scripts file the fake capability reads.
# ---------------------------------------------------------------------------------------------
write_fake_config() {
  local ws="$1" fake_scripts="$2"
  mkdir -p "$ws/_local/fake"
  cp "$fake_scripts" "$ws/_local/fake/scripts.json"
}

# ---------------------------------------------------------------------------------------------
# prove_blinding [<scratch-dir>] — offline proof the gate fails closed (no network, no claude).
# ---------------------------------------------------------------------------------------------
prove_blinding() {
  local scratch="${1:-$SCRIPT_DIR/../../../../_local/scratch/fleet-ab-prove-blinding-$$}"
  mkdir -p "$scratch/clean/_local/fake" "$scratch/dirty/_local/fake"
  # shellcheck disable=SC2064
  trap "rm -rf '$scratch'" EXIT

  # Clean injected content: a synthetic config + scripts file carrying no banned vocabulary.
  cat > "$scratch/clean/_local/config.md" <<'EOF'
# Skills Configuration
Canned fleet-ab fixture project. Fake capability owns delivery + tracker.
EOF
  cat > "$scratch/clean/_local/fake/scripts.json" <<'EOF'
{ "tracker": { "get": { "id": "WF-1", "title": "A normal backlog item", "description": "Ship a small feature." } } }
EOF

  if ! run_blinding_gate "$scratch/clean" >/dev/null 2>&1; then
    echo "prove-blinding: FAIL — the gate rejected CLEAN injected content (false positive)" >&2
    exit 1
  fi
  echo "prove-blinding: [1/2] clean injected content passes the gate"

  # Dirty injected content: plant a banned word ("baseline") inside the scripted description —
  # exactly the kind of leak the gate exists to catch.
  cp -R "$scratch/clean/_local/." "$scratch/dirty/_local/"
  cat > "$scratch/dirty/_local/fake/scripts.json" <<'EOF'
{ "tracker": { "get": { "id": "WF-1", "title": "A normal backlog item", "description": "Ship a small feature faster than the committed baseline." } } }
EOF

  if run_blinding_gate "$scratch/dirty" >/dev/null 2>&1; then
    echo "prove-blinding: FAIL — the gate ACCEPTED injected content carrying a banned word (fails open)" >&2
    exit 1
  fi
  echo "prove-blinding: [2/2] a planted banned word ('baseline') is caught — the gate fails closed"

  # Also prove the docs/wf382-*  and experiments/ presence guards fire.
  mkdir -p "$scratch/dirty2/docs"
  cp -R "$scratch/clean/_local" "$scratch/dirty2/_local"
  touch "$scratch/dirty2/docs/wf382-ab-experiment-design.md"
  if run_blinding_gate "$scratch/dirty2" >/dev/null 2>&1; then
    echo "prove-blinding: FAIL — the gate ACCEPTED a tree carrying docs/wf382-*" >&2
    exit 1
  fi
  echo "prove-blinding: [3/3] a planted docs/wf382-* file is caught — the presence guard fails closed"

  echo "prove-blinding: PASS — the blinding gate fails closed on vocabulary AND presence violations"
}

main() {
  if [ "${1:-}" = "--prove-blinding" ]; then
    prove_blinding "${2:-}"
    return
  fi
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then usage; exit 0; fi

  local target="${1:?$(usage)}"; shift
  local workload_ref="" fake_scripts="" repo_url="$DEFAULT_REPO_URL" \
        config_dir="" marketplace_dir="${WF_MARKETPLACE_DIR:-/opt/wf-marketplace-src}" \
        marketplace_name="$DEFAULT_MARKETPLACE_NAME" packs="$DEFAULT_PACKS" out=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --workload-ref) workload_ref="${2:?}"; shift 2;;
      --workload-ref=*) workload_ref="${1#*=}"; shift;;
      --fake-scripts) fake_scripts="${2:?}"; shift 2;;
      --fake-scripts=*) fake_scripts="${1#*=}"; shift;;
      --repo-url) repo_url="${2:?}"; shift 2;;
      --repo-url=*) repo_url="${1#*=}"; shift;;
      --config-dir) config_dir="${2:?}"; shift 2;;
      --config-dir=*) config_dir="${1#*=}"; shift;;
      --marketplace-dir) marketplace_dir="${2:?}"; shift 2;;
      --marketplace-dir=*) marketplace_dir="${1#*=}"; shift;;
      --marketplace-name) marketplace_name="${2:?}"; shift 2;;
      --marketplace-name=*) marketplace_name="${1#*=}"; shift;;
      --packs) packs="${2:?}"; shift 2;;
      --packs=*) packs="${1#*=}"; shift;;
      --out) out="${2:?}"; shift 2;;
      --out=*) out="${1#*=}"; shift;;
      *) echo "seed-workspace.sh: unknown argument '$1'" >&2; usage; exit 2;;
    esac
  done

  [ -n "$workload_ref" ] || { echo "seed-workspace.sh: --workload-ref is required (pinned ref W — never defaulted)" >&2; exit 2; }
  [ -n "$fake_scripts" ] || { echo "seed-workspace.sh: --fake-scripts <path> is required" >&2; exit 2; }
  [ -f "$fake_scripts" ] || { echo "seed-workspace.sh: --fake-scripts path not found: $fake_scripts" >&2; exit 2; }
  [ -n "$out" ] || out="$(dirname "$target")/setup-output"
  [ -n "$config_dir" ] || config_dir="$(mktemp -d)"

  clone_and_strip "$target" "$repo_url" "$workload_ref"
  export CLAUDE_CONFIG_DIR="$config_dir"
  echo "seed-workspace.sh: clean install of {${packs}} from '$marketplace_dir' into isolated CLAUDE_CONFIG_DIR=$config_dir" >&2
  claude plugin marketplace add "$marketplace_dir" >&2
  # shellcheck disable=SC2086
  claude plugin install $(for p in $packs; do printf '%s@%s ' "$p" "$marketplace_name"; done) >&2

  read -r -a pack_arr <<< "$packs"
  run_unmeasured_setup "$target" "$config_dir" "$out" "${pack_arr[@]}"
  write_fake_config "$target" "$fake_scripts"

  local fp_workload; fp_workload="$(fingerprint_tree "$target")"
  echo "seed-workspace.sh: workload fingerprint=$fp_workload" >&2

  run_blinding_gate "$target"
  echo "seed-workspace.sh: seeded $target (workload ref=$workload_ref, config-dir=$config_dir, setup-out=$out)"
}

main "$@"
