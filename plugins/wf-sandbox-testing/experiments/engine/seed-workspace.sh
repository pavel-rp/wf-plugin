#!/usr/bin/env bash
# seed-workspace.sh — materialize ONE arm's blinded, deterministic workspace, then run the
# arm's own unmeasured setup (clean plugin install already happened at container build; this
# script clones the WORKLOAD snapshot, runs /wf:init + the arm's pack init skills + writes the
# fake provider config) — and fails LOUD, before any measured spend, if blinding is violated.
#
# The blinding gate carries no vocabulary of its own: the banned-word pattern and the
# forbidden-path guards are both built from the experiment manifest, which validates that the
# vocabulary is non-empty before this script ever runs.
#
# Two invocations:
#
#   seed-workspace.sh <target-dir> --manifest <experiment.json> --workload-ref <ref>
#       --fake-scripts <path> [--repo-url <url>] [--config-dir <dir>] [--marketplace-dir <dir>]
#       [--marketplace-name <name>] [--packs "<a b c>"] [--out <setup-out-dir>]
#     The real per-arm-container seed: clone repo@ref, strip remote, deterministic timestamps,
#     run the unmeasured setup skills, write the fake config, then run the blinding gate.
#
#   seed-workspace.sh --prove-blinding --manifest <experiment.json> [<scratch-dir>]
#     Offline self-check (no network, no claude, no Docker): materializes only the
#     EXPERIMENT-INJECTED content (a clean synthetic _local/config.md + fake scripts.json) in a
#     throwaway scratch dir, proves the gate PASSES on clean content, plants a word drawn from
#     the manifest's own vocabulary, and proves the gate FAILS CLOSED — then does the same for
#     the manifest's first declared forbidden path.
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$ENGINE_DIR/../../runner" && pwd)"
# shellcheck source=manifest.sh
. "$ENGINE_DIR/manifest.sh"
# shellcheck source=../../runner/fingerprint.sh
. "$RUNNER_DIR/fingerprint.sh"
# shellcheck source=gh-token.sh
. "$ENGINE_DIR/gh-token.sh"

DEFAULT_REPO_URL="https://github.com/pavel-rp/wf-plugin.git"
DEFAULT_MARKETPLACE_NAME="wf-marketplace"

# The seeded tree's git identity is a FIXED neutral constant, never derived from the manifest.
# It lands in agent-visible `git log` output inside the measured workspace, which the blinding gate
# does not scan — so anything experiment-named here would leak past a PASSED gate.
SEED_IDENTITY_NAME="workload seed"
SEED_IDENTITY_EMAIL="seed@fake.local"

usage() {
  cat >&2 <<'EOF'
usage:
  seed-workspace.sh <target-dir> --manifest <experiment.json> --workload-ref <ref>
                     --fake-scripts <path> [--repo-url <url>] [--config-dir <dir>]
                     [--marketplace-dir <dir>] [--marketplace-name <name>]
                     [--packs "<a b c>"] [--out <setup-out-dir>]
  seed-workspace.sh --prove-blinding --manifest <experiment.json> [<scratch-dir>]
EOF
}

# escape_ere <word> — quote every ERE metacharacter so a vocabulary entry is matched literally.
escape_ere() { printf '%s' "$1" | sed -e 's/[][\\.^$*+?(){}|]/\\&/g'; }

# blinding_ere — the banned-word pattern, built from the manifest's vocabulary. Refuses (non-zero,
# printing nothing usable) on an empty vocabulary rather than emitting a degenerate pattern.
blinding_ere() {
  local out="" w
  for w in ${BLINDING_VOCAB+"${BLINDING_VOCAB[@]}"}; do
    [ -n "$out" ] && out="$out|"
    out="$out$(escape_ere "$w")"
  done
  if [ -z "$out" ]; then
    echo "seed-workspace.sh: BLINDING FAIL — the manifest declares an empty blinding vocabulary; refusing to build a degenerate pattern." >&2
    return 2
  fi
  printf '\\b(%s)\\b' "$out"
}

# ---------------------------------------------------------------------------------------------
# run_blinding_gate <workspace-dir> — fails loudly on any blinding violation. Greps ONLY the
# specific files this script itself injects (never the whole workspace tree — the workload
# snapshot's own historical docs are exempt and would fail a tree-wide gate permanently), and
# checks each forbidden-path guard the manifest declares.
# ---------------------------------------------------------------------------------------------
run_blinding_gate() {
  local ws="$1"
  local problems=0 ere
  ere="$(blinding_ere)" || return 3

  local pat
  for pat in ${FORBIDDEN_PATHS+"${FORBIDDEN_PATHS[@]}"}; do
    if compgen -G "$ws/$pat" > /dev/null 2>&1; then
      echo "seed-workspace.sh: BLINDING FAIL — seeded tree contains '$pat', which the manifest forbids at the workload ref" >&2
      problems=1
    fi
  done

  local injected=() f rc
  [ -f "$ws/_local/config.md" ] && injected+=("$ws/_local/config.md")
  [ -f "$ws/_local/fake/scripts.json" ] && injected+=("$ws/_local/fake/scripts.json")
  for f in ${injected+"${injected[@]}"}; do
    # Exempt literals are blanked out (not deleted) before matching, so the file keeps its line
    # structure and column offsets and a reported violation still points at the real line. Only
    # the exact declared strings are removed; every other occurrence of a banned word on the same
    # line — including a second, genuine one — still matches. Case-insensitive, matching the scan.
    local scan_src="$f" lit
    local -a _exempt=(${BLINDING_EXEMPT+"${BLINDING_EXEMPT[@]}"})
    if [ "${#_exempt[@]}" -gt 0 ]; then
      scan_src="$(mktemp)"
      cp "$f" "$scan_src"
      for lit in "${_exempt[@]}"; do
        # sed with a control-char delimiter: the literal may contain / and other punctuation.
        sed -i "s$(printf '\001')$(escape_ere "$lit")$(printf '\001')$(printf '\001')Ig" "$scan_src"
      done
    fi

    # grep exits 0=match, 1=no-match, 2=error. A fail-closed gate must treat an error (2+)
    # as a violation, never silently pass it as a no-match — so capture the real exit code
    # instead of folding 1 and 2 together in an `if grep` test.
    rc=0
    grep -iEn "$ere" "$scan_src" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -eq 0 ]; then
      echo "seed-workspace.sh: BLINDING FAIL — banned blinding vocabulary found in injected content '$f':" >&2
      grep -iEn "$ere" "$scan_src" >&2 || true
      problems=1
    elif [ "$rc" -ge 2 ]; then
      echo "seed-workspace.sh: BLINDING FAIL — grep errored (exit $rc) scanning injected content '$f' — failing closed" >&2
      problems=1
    fi
    [ "$scan_src" = "$f" ] || rm -f "$scan_src"
  done

  if [ "$problems" -ne 0 ]; then
    echo "seed-workspace.sh: blinding gate FAILED — refusing to hand this workspace to an agent." >&2
    return 3
  fi
  echo "seed-workspace.sh: blinding gate PASSED — no banned vocabulary in injected content, no forbidden path in the tree." >&2
  return 0
}

# ---------------------------------------------------------------------------------------------
# clone_and_strip <target-dir> <repo-url> <workload-ref> — fresh clone at the pinned workload
# ref, remote stripped, deterministic timestamps, LOCAL-ONLY single-commit history.
# ---------------------------------------------------------------------------------------------
clone_and_strip() {
  local target="$1" repo_url="$2" workload_ref="$3"
  rm -rf "$target"
  mkdir -p "$target"
  echo "seed-workspace.sh: cloning $repo_url @ $workload_ref into $target" >&2
  # A private source repository needs a credential here. It arrives as WF_SEED_GH_TOKEN and is
  # consumed ONLY by this clone: git_clone_maybe_authenticated keeps it out of argv, the remote
  # URL, and .git/config, the .git directory is deleted three lines down, and run-arm.sh unsets
  # the variable before the agent boots. An empty value is fine — a public repo needs none.
  git_clone_maybe_authenticated "$repo_url" "$target" "$(resolve_gh_token)"
  git -C "$target" checkout --quiet "$workload_ref"
  rm -rf "$target/.git"

  # Deterministic timestamps on every file BEFORE the fresh local-only commit, so the seeded
  # tree's content is a pure function of (repo_url, workload_ref) — never of wall-clock.
  find "$target" -type f -exec touch -d '2026-01-01T00:00:00Z' {} +

  export GIT_AUTHOR_NAME="$SEED_IDENTITY_NAME" GIT_AUTHOR_EMAIL="$SEED_IDENTITY_EMAIL"
  export GIT_COMMITTER_NAME="$SEED_IDENTITY_NAME" GIT_COMMITTER_EMAIL="$SEED_IDENTITY_EMAIL"
  export GIT_AUTHOR_DATE="2026-01-01T00:00:00Z" GIT_COMMITTER_DATE="2026-01-01T00:00:00Z"
  git -C "$target" init -q
  git -C "$target" add -A
  git -C "$target" commit -q -m "seed workload snapshot at ref $workload_ref (local-only history, no remote)"
  unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL GIT_AUTHOR_DATE GIT_COMMITTER_DATE
}

# ---------------------------------------------------------------------------------------------
# run_unmeasured_setup <workspace> <config-dir> <out> <packs...> — the arm's OWN /wf:init + pack
# init skills, run headless, UNMEASURED (a separate claude invocation from the measured session
# run-arm.sh drives). Every one of these init skills takes no arguments and is non-interactive.
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
    # --verbose is REQUIRED alongside -p --output-format stream-json (the CLI refuses the
    # combination without it and emits a plain-text error where stream-json is expected).
    ( cd "$ws" && CLAUDE_CONFIG_DIR="$cfg" claude -p "$skill" \
        --output-format stream-json --verbose --dangerously-skip-permissions ) > "$transcript" 2>&1
    # Single-pass, NO pipe: `grep … | head -n1` over a large transcript makes grep die of SIGPIPE
    # the moment head closes the pipe, and `set -o pipefail` turns that into a fatal exit 141 —
    # a seed that already succeeded then reports as a failed run. awk stops itself instead.
    sid="$(awk 'match($0, /"session_id"[[:space:]]*:[[:space:]]*"[^"]+"/) {
                  s = substr($0, RSTART, RLENGTH)
                  sub(/^"session_id"[[:space:]]*:[[:space:]]*"/, "", s)
                  sub(/"$/, "", s)
                  print s; exit
                }' "$transcript" 2>/dev/null || true)"
    [ "$first" = 1 ] || printf ',\n' >> "$sessions_json"
    first=0
    printf '  { "skill": "%s", "session_id": "%s", "transcript": "%s" }' \
      "$skill" "$sid" "$transcript" >> "$sessions_json"
  done
  printf '\n]\n' >> "$sessions_json"
  echo "seed-workspace.sh: unmeasured setup done — sessions recorded in $sessions_json" >&2
}

# ---------------------------------------------------------------------------------------------
# write_fake_config <workspace> <fake-scripts-path> — materializes the fake capability's scripts
# file. The registry row itself was already written by run_unmeasured_setup's init call; this
# only seeds the scripts file the fake capability reads.
# ---------------------------------------------------------------------------------------------
write_fake_config() {
  local ws="$1" fake_scripts="$2"
  mkdir -p "$ws/_local/fake"
  cp "$fake_scripts" "$ws/_local/fake/scripts.json"
}

# ---------------------------------------------------------------------------------------------
# prove_blinding [<scratch-dir>] — offline proof the gate fails closed (no network, no claude).
# Every planted violation is drawn from the loaded manifest, so this proof stays honest for any
# conforming experiment rather than re-asserting one experiment's vocabulary.
# ---------------------------------------------------------------------------------------------
prove_blinding() {
  local scratch="${1:-}"
  [ -n "$scratch" ] || scratch="$ENGINE_DIR/../../../../_local/scratch/prove-blinding-$$"
  mkdir -p "$scratch/clean/_local/fake" "$scratch/dirty/_local/fake"
  # shellcheck disable=SC2064
  trap "rm -rf '$scratch'" EXIT

  local planted="${BLINDING_VOCAB[0]}"
  local total=2
  [ "${#FORBIDDEN_PATHS[@]}" -gt 0 ] && total=3

  # Clean injected content: a synthetic config + scripts file carrying no banned vocabulary.
  cat > "$scratch/clean/_local/config.md" <<'EOF'
# Skills Configuration
Canned fixture project. Fake capability owns delivery + tracker.
EOF
  cat > "$scratch/clean/_local/fake/scripts.json" <<'EOF'
{ "tracker": { "get": { "id": "WF-1", "title": "A normal backlog item", "description": "Ship a small feature." } } }
EOF

  if ! run_blinding_gate "$scratch/clean" >/dev/null 2>&1; then
    echo "prove-blinding: FAIL — the gate rejected CLEAN injected content (false positive)" >&2
    exit 1
  fi
  echo "prove-blinding: [1/$total] clean injected content passes the gate"

  # Dirty injected content: plant the manifest's own first vocabulary word inside the scripted
  # description — exactly the kind of leak the gate exists to catch.
  cp -R "$scratch/clean/_local/." "$scratch/dirty/_local/"
  printf '{ "tracker": { "get": { "id": "WF-1", "title": "A normal backlog item", "description": "Ship a small feature faster than the committed %s." } } }\n' \
    "$planted" > "$scratch/dirty/_local/fake/scripts.json"

  if run_blinding_gate "$scratch/dirty" >/dev/null 2>&1; then
    echo "prove-blinding: FAIL — the gate ACCEPTED injected content carrying a banned word (fails open)" >&2
    exit 1
  fi
  echo "prove-blinding: [2/$total] a planted banned word ('$planted') is caught — the gate fails closed"

  # And prove the forbidden-path guard fires, when the manifest declares one.
  if [ "${#FORBIDDEN_PATHS[@]}" -gt 0 ]; then
    local pat="${FORBIDDEN_PATHS[0]}"
    # A glob pattern is materialized by replacing each wildcard run with a literal token, so the
    # planted path is a real file the guard's own compgen will match.
    local rel; rel="$(printf '%s' "$pat" | sed -e 's/[*?]\+/x/g' -e 's/\[[^]]*\]/x/g')"
    mkdir -p "$scratch/dirty2/$(dirname "$rel")"
    cp -R "$scratch/clean/_local" "$scratch/dirty2/_local"
    touch "$scratch/dirty2/$rel"
    if run_blinding_gate "$scratch/dirty2" >/dev/null 2>&1; then
      echo "prove-blinding: FAIL — the gate ACCEPTED a tree carrying the forbidden path '$pat'" >&2
      exit 1
    fi
    echo "prove-blinding: [3/$total] a planted forbidden path ('$rel') is caught — the presence guard fails closed"
  fi

  echo "prove-blinding: PASS — the blinding gate fails closed on vocabulary AND presence violations"
}

main() {
  if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then usage; exit 0; fi

  # The manifest is resolved before anything else: it owns the vocabulary the gate is built from.
  local manifest="" i=0
  local -a argv=("$@")
  while [ "$i" -lt "${#argv[@]}" ]; do
    case "${argv[$i]}" in
      --manifest) i=$((i + 1)); manifest="${argv[$i]:-}";;
      --manifest=*) manifest="${argv[$i]#*=}";;
    esac
    i=$((i + 1))
  done
  [ -n "$manifest" ] || manifest="$(manifest_env_path "$ENGINE_DIR")"
  manifest_load "$manifest" || { echo "seed-workspace.sh: could not load the experiment manifest ($manifest)" >&2; exit 2; }

  if [ "${1:-}" = "--prove-blinding" ]; then
    shift
    local scratch=""
    while [ $# -gt 0 ]; do
      case "$1" in
        --manifest) shift 2;;
        --manifest=*) shift;;
        *) scratch="$1"; shift;;
      esac
    done
    prove_blinding "$scratch"
    return
  fi

  local target="${1:?$(usage)}"; shift
  local workload_ref="" fake_scripts="" repo_url="$DEFAULT_REPO_URL" \
        config_dir="" marketplace_dir="${WF_MARKETPLACE_DIR:-/opt/wf-marketplace-src}" \
        marketplace_name="$DEFAULT_MARKETPLACE_NAME" packs="$ENGINE_DEFAULT_PACKS" out=""

  while [ $# -gt 0 ]; do
    case "$1" in
      --manifest) shift 2;;
      --manifest=*) shift;;
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

  # Direct invocation may fall back to the manifest's pinned workload ref; the container path never
  # exercises that fallback, because run-arm.sh requires --workload-ref explicitly and forwards it.
  [ -n "$workload_ref" ] || workload_ref="$CONST_WORKLOAD_REF"
  [ -n "$workload_ref" ] || { echo "seed-workspace.sh: --workload-ref is required — the manifest declares no workload ref to fall back to" >&2; exit 2; }
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
