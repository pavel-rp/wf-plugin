#!/usr/bin/env bash
# run-arm.sh — the ONE measured invocation for a single arm, run INSIDE that arm's container.
#
# Design doc §5/§8: exactly one measured claude -p "/wf:fleet <umbrella-id>" per arm, spaced >5min
# apart from its pair, same day, order coin-flipped. This script runs in-container (dispatched by
# runner/entrypoint.sh on --measured-fleet, after the auth/billing guards) and owns the full
# per-arm sequence so both arms are isolated by construction — a fresh container each, its own
# CLAUDE_CONFIG_DIR and its own seeded workspace, differing ONLY in the image's WF_REF:
#
#   1. seed  — clone the workload snapshot at ref W, run the arm's UNMEASURED /wf:init + pack init
#              skills + fake config, then the blinding gate (seed-workspace.sh). Needs egress to
#              the workload host (github), so it runs BEFORE no-egress is applied.
#   2. seal  — apply no-egress (blackhole tracker/delivery hosts) AFTER the seed, so the measured
#              run cannot reach a real tracker/delivery host; the fake provider answers in-memory.
#   3. measure — the ONE billed claude -p "/wf:fleet <umbrella-id>" (or --gate-skill for the cheap
#              dry-run gate, which exercises this exact seed+seal path with a cheaper skill).
#   4. archive — tar the isolated projects/ tree + op-log + workspace snapshot + run.json into the
#              mounted --out (default $WF_RUN_OUT=/work/run-output). run.json records the
#              measured session id AND the unmeasured setup sessions, so the split stays auditable.
#
# HOST INVOCATION (never run this script directly — it runs inside the arm container):
#   docker run --rm -e CLAUDE_CODE_OAUTH_TOKEN -v "$PWD/results/run-A:/work/run-output" \
#     fleet-ab:armA --measured-fleet --arm A --umbrella-id WF-405 \
#     --workload-ref "$WORKLOAD_REF" --fake-scripts fake-scripts.json
#
# Authored and bash -n syntax-checked only in this session — no Docker host here (WF-382 plan
# STEP-003). Spending a measured run requires the user's explicit go-ahead (spec Boundaries,
# "ask first" — each run is ≈$85-115 API-equivalent). Prove the path first with --gate-skill.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$SCRIPT_DIR/../../runner" && pwd)"
# shellcheck source=../../runner/fingerprint.sh
. "$RUNNER_DIR/fingerprint.sh"

DEFAULT_MODEL="claude-opus-4-8"
DEFAULT_PACKS="wf wf-audit wf-fake"

usage() {
  cat >&2 <<'EOF'
usage (in-container; dispatched by runner/entrypoint.sh on --measured-fleet):
  run-arm.sh --measured-fleet --arm A|B --umbrella-id <id>
             --workload-ref <ref> [--fake-scripts <path|name>]
             [--gate-skill "/wf:triage <id>"] [--model claude-opus-4-8]
             [--out <dir>] [--packs "wf wf-audit wf-fake"] [--repo-url <url>]
             [--build-json <build-<arm>.json>] [--on-quota fail|wait] [--allow-api-key]
  --gate-skill runs the given cheap skill instead of the measured /wf:fleet, over the SAME
  seed+seal path (the dry-run gate). --umbrella-id is then optional.
EOF
}

# assert_stream_json <file> — same CLI-drift guard as runner/run-skill.sh (kept local so this
# script has no runtime dependency beyond fingerprint.sh; logic intentionally byte-identical).
assert_stream_json() {
  local f="$1"
  if [ ! -s "$f" ]; then
    echo "FATAL [cli-drift]: transcript '$f' is empty — expected parseable stream-json." >&2
    return 6
  fi
  if command -v jq >/dev/null 2>&1; then
    jq -e . "$f" >/dev/null 2>&1 && return 0
    local n=0 bad=0 line
    while IFS= read -r line || [ -n "$line" ]; do
      [ -z "${line//[[:space:]]/}" ] && continue
      n=$((n + 1))
      printf '%s' "$line" | jq -e . >/dev/null 2>&1 || bad=$((bad + 1))
    done < "$f"
    [ "$n" -eq 0 ] && { echo "FATAL [cli-drift]: transcript '$f' contains no JSON lines." >&2; return 6; }
    [ "$bad" -ne 0 ] && { echo "FATAL [cli-drift]: transcript '$f' has $bad non-JSON line(s)." >&2; return 6; }
    return 0
  fi
  local first; first="$(tr -d '[:space:]' < "$f" | head -c1)"
  case "$first" in '{'|'[') return 0;; *) echo "FATAL [cli-drift]: '$f' not JSON." >&2; return 6;; esac
}

extract_session_id() {
  grep -oE '"session_id"[[:space:]]*:[[:space:]]*"[^"]+"' "$1" 2>/dev/null \
    | head -n1 | sed -E 's/.*"([^"]+)"$/\1/'
}

discover_transcript_bundle() {
  [ -d "$1" ] || return 0
  find "$1" -type f -name '*.jsonl' 2>/dev/null | LC_ALL=C sort | head -n1
}

detect_quota() {
  grep -Eqi 'usage limit|quota (exceeded|exhausted)|rate.?limit|overloaded|status.{0,3}429|insufficient_quota' \
    "$1" "$2" 2>/dev/null && echo 1 || echo 0
}

write_run_json() {
  local out="$1" arm="$2" umbrella="$3" skill="$4" model="$5" wall_seconds="$6" \
        cli_version="$7" fp_workload="$8" build_json="$9" setup_json="${10}" \
        exit_code="${11}" parseable="${12}" verdict="${13}" reason="${14}" \
        session_id="${15}" projects_root="${16}" transcript_bundle="${17}" session_resolved="${18}" \
        workload_ref="${19}" host_name="${20}" started_at="${21}"
  local build_obj="null" setup_obj="[]"
  [ -n "$build_json" ] && [ -f "$build_json" ] && build_obj="$(cat "$build_json")"
  [ -n "$setup_json" ] && [ -f "$setup_json" ] && setup_obj="$(cat "$setup_json")"
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg arm "$arm" --arg umbrella "$umbrella" --arg skill "$skill" --arg model "$model" \
      --argjson wall_seconds "$wall_seconds" --arg cli_version "$cli_version" \
      --arg fp_workload "$fp_workload" --argjson build "$build_obj" --argjson setup "$setup_obj" \
      --argjson exit_code "$exit_code" --argjson parseable "$parseable" \
      --arg verdict "$verdict" --arg reason "$reason" --arg session_id "$session_id" \
      --arg projects_root "$projects_root" --arg transcript_bundle "$transcript_bundle" \
      --argjson session_resolved "$([ "$session_resolved" = 1 ] && echo true || echo false)" \
      --arg workload_ref "$workload_ref" --arg host "$host_name" --arg started_at "$started_at" \
      '{
        arm: $arm, umbrella_id: $umbrella, measured_skill: $skill, model: $model,
        wall_clock_seconds: $wall_seconds, cli_version: $cli_version,
        provenance: { host: $host, run_started_at: $started_at, workload_ref: $workload_ref },
        fingerprints: { workload: $fp_workload, build: $build },
        setup_sessions: $setup,
        measured_session: { session_id: $session_id, projects_root: $projects_root,
                             transcript_bundle: $transcript_bundle, resolved: $session_resolved },
        run: { exit_code: $exit_code, transcript: "transcript.jsonl", transcript_parseable: $parseable,
               workspace_snapshot: "workspace-snapshot" },
        verdict: $verdict, reason: $reason
      }' > "$out/run.json"
  else
    printf '{"arm":"%s","umbrella_id":"%s","measured_skill":"%s","model":"%s","wall_clock_seconds":%s,"cli_version":"%s","provenance":{"host":"%s","run_started_at":"%s","workload_ref":"%s"},"verdict":"%s","reason":"%s"}\n' \
      "$arm" "$umbrella" "$skill" "$model" "$wall_seconds" "$cli_version" "$host_name" "$started_at" "$workload_ref" "$verdict" "$reason" > "$out/run.json"
  fi
}

main() {
  local arm="" umbrella="" workload_ref="" fake_scripts="" gate_skill="" model="$DEFAULT_MODEL" \
        out="" packs="$DEFAULT_PACKS" repo_url="" build_json="" on_quota="fail"

  while [ $# -gt 0 ]; do
    case "$1" in
      --measured-fleet) shift;;                       # dispatch sentinel (consumed by entrypoint too)
      --arm) arm="${2:?}"; shift 2;;
      --arm=*) arm="${1#*=}"; shift;;
      --umbrella-id) umbrella="${2:?}"; shift 2;;
      --umbrella-id=*) umbrella="${1#*=}"; shift;;
      --workload-ref) workload_ref="${2:?}"; shift 2;;
      --workload-ref=*) workload_ref="${1#*=}"; shift;;
      --fake-scripts) fake_scripts="${2:?}"; shift 2;;
      --fake-scripts=*) fake_scripts="${1#*=}"; shift;;
      --gate-skill) gate_skill="${2:?}"; shift 2;;
      --gate-skill=*) gate_skill="${1#*=}"; shift;;
      --model) model="${2:?}"; shift 2;;
      --model=*) model="${1#*=}"; shift;;
      --out) out="${2:?}"; shift 2;;
      --out=*) out="${1#*=}"; shift;;
      --packs) packs="${2:?}"; shift 2;;
      --packs=*) packs="${1#*=}"; shift;;
      --repo-url) repo_url="${2:?}"; shift 2;;
      --repo-url=*) repo_url="${1#*=}"; shift;;
      --build-json) build_json="${2:?}"; shift 2;;
      --build-json=*) build_json="${1#*=}"; shift;;
      --on-quota) on_quota="${2:?}"; shift 2;;
      --on-quota=*) on_quota="${1#*=}"; shift;;
      --allow-api-key) shift;;                        # guard already ran in entrypoint; accept+ignore
      -h|--help) usage; exit 0;;
      *) echo "run-arm.sh: unknown argument '$1'" >&2; usage; exit 2;;
    esac
  done

  case "$arm" in A|B) ;; *) echo "run-arm.sh: --arm must be A or B (got '$arm')" >&2; exit 2;; esac
  [ -n "$workload_ref" ] || { echo "run-arm.sh: --workload-ref <ref W> is required (never defaulted)" >&2; exit 2; }

  # The measured skill: the pilot's /wf:fleet, or a cheaper --gate-skill over the same seed+seal path.
  local skill=""
  if [ -n "$gate_skill" ]; then
    skill="$gate_skill"
  else
    [ -n "$umbrella" ] || { echo "run-arm.sh: --umbrella-id <id> is required (or pass --gate-skill for the dry-run gate)" >&2; exit 2; }
    skill="/wf:fleet $umbrella"
  fi

  # Resolve --fake-scripts: absolute/relative path as given, else the image-baked copy beside this script.
  [ -n "$fake_scripts" ] || fake_scripts="$SCRIPT_DIR/fake-scripts.json"
  [ -f "$fake_scripts" ] || fake_scripts="$SCRIPT_DIR/$fake_scripts"
  [ -f "$fake_scripts" ] || { echo "run-arm.sh: --fake-scripts not found: $fake_scripts" >&2; exit 2; }

  [ -n "$out" ] || out="${WF_RUN_OUT:-/work/run-output}"
  rm -rf "$out"; mkdir -p "$out"

  local host_name started_at
  host_name="$(hostname 2>/dev/null || echo unknown)"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # --- 1. seed (egress OPEN — the workload clone needs github) ------------------------------------
  local cfg ws; cfg="$(mktemp -d)"; ws="$(mktemp -d)/workspace"; mkdir -p "$ws"
  export CLAUDE_CONFIG_DIR="$cfg"
  echo "run-arm.sh: arm=$arm — seeding workload @ $workload_ref into $ws (config=$cfg)" >&2
  local -a seed_args=("$ws" --workload-ref "$workload_ref" --fake-scripts "$fake_scripts"
                      --config-dir "$cfg" --out "$out/setup" --packs "$packs")
  [ -n "$repo_url" ] && seed_args+=(--repo-url "$repo_url")
  local seed_rc=0
  bash "$SCRIPT_DIR/seed-workspace.sh" "${seed_args[@]}" >&2 || seed_rc=$?
  if [ "$seed_rc" -ne 0 ]; then
    write_run_json "$out" "$arm" "$umbrella" "$skill" "$model" 0 "$(fingerprint_cli)" "" \
      "$build_json" "$out/setup/setup-sessions.json" "$seed_rc" false "seed-failed" \
      "seed-workspace.sh exited $seed_rc (clone / install / init / blinding gate) — before any measured spend" \
      "" "$cfg/projects" "" 0 "$workload_ref" "$host_name" "$started_at"
    echo "FATAL [seed]: seed-workspace.sh exited $seed_rc — refusing to spend a measured run." >&2
    return 3
  fi

  # --- 2. seal (apply no-egress AFTER the seed; the measured run must not reach a real host) ------
  if [ "${WF_NO_EGRESS:-0}" = "1" ]; then
    # shellcheck source=../../runner/no-egress.sh
    . "$RUNNER_DIR/no-egress.sh"
    apply_no_egress || echo "run-arm.sh: no-egress requested but not fully applied (see warning above)." >&2
  fi

  local fp_workload cli_version
  fp_workload="$(fingerprint_tree "$ws")"
  cli_version="$(fingerprint_cli)"
  echo "run-arm.sh: arm=$arm workload-fp=$fp_workload cli=$cli_version model=$model skill='$skill'" >&2

  # --- 3. measure — the ONE billed invocation ----------------------------------------------------
  local transcript="$out/transcript.jsonl" stderr_log="$out/stderr.log"
  local start_ts end_ts rc=0
  start_ts="$(date -u +%s)"
  (
    cd "$ws" && \
    claude -p "$skill" --output-format stream-json \
      --dangerously-skip-permissions --model "$model"
  ) > "$transcript" 2> "$stderr_log" || rc=$?
  end_ts="$(date -u +%s)"
  local wall_seconds=$(( end_ts - start_ts ))

  local session_id projects_root transcript_bundle session_resolved=0
  session_id="$(extract_session_id "$transcript")"
  projects_root="$cfg/projects"
  transcript_bundle="$(discover_transcript_bundle "$projects_root")"
  [ -n "$session_id" ] && session_resolved=1
  echo "run-arm.sh: measured session id='${session_id:-<none>}' wall=${wall_seconds}s resolved=$session_resolved" >&2

  local verdict="ok" reason="" parseable=true
  if [ "$(detect_quota "$transcript" "$stderr_log")" = "1" ]; then
    verdict="quota-exhausted"
    # Mirror run-skill.sh's fail/wait wording so run.json reads consistently across gate and
    # measured-fleet runs (analyze.sh diffs the two). Neither policy actually waits here; the
    # distinction is the recorded reason.
    if [ "$on_quota" = "wait" ]; then
      reason="subscription quota exhausted; --on-quota=wait — re-run once the usage window resets."
    else
      reason="subscription quota exhausted; --on-quota=fail — terminated without an API-billed continuation."
    fi
    write_run_json "$out" "$arm" "$umbrella" "$skill" "$model" "$wall_seconds" "$cli_version" "$fp_workload" \
      "$build_json" "$out/setup/setup-sessions.json" "$rc" false "$verdict" "$reason" \
      "$session_id" "$projects_root" "$transcript_bundle" "$session_resolved" \
      "$workload_ref" "$host_name" "$started_at"
    echo "FATAL [quota]: $reason" >&2
    return 8
  fi

  if ! assert_stream_json "$transcript"; then
    parseable=false; verdict="cli-drift"
    reason="transcript did not parse as stream-json — CLI --output-format contract drifted."
    write_run_json "$out" "$arm" "$umbrella" "$skill" "$model" "$wall_seconds" "$cli_version" "$fp_workload" \
      "$build_json" "$out/setup/setup-sessions.json" "$rc" "$parseable" "$verdict" "$reason" \
      "$session_id" "$projects_root" "$transcript_bundle" "$session_resolved" \
      "$workload_ref" "$host_name" "$started_at"
    return 6
  fi

  if [ "$rc" -ne 0 ]; then
    verdict="skill-error"
    reason="claude exited $rc — see stderr.log; transcript parsed but the fleet run did not complete cleanly."
  fi

  # --- 4. archive raw transcripts immediately (design doc §5: the historical baseline died of
  #        pruned transcripts; this one must not) + snapshot the resulting workspace --------------
  # Archiving is load-bearing evidence. This script has no `set -e`, so a silent tar/cp/snapshot
  # failure would otherwise leave verdict=ok with missing artifacts — track failures and downgrade.
  local archive_problems=0
  if [ -d "$projects_root" ]; then
    tar -C "$(dirname "$projects_root")" -czf "$out/projects-archive.tar.gz" "$(basename "$projects_root")" \
      || { echo "run-arm.sh: WARNING — failed to archive projects tree to projects-archive.tar.gz" >&2; archive_problems=1; }
  fi
  if [ -f "$ws/_local/fake/op-log.jsonl" ]; then
    cp "$ws/_local/fake/op-log.jsonl" "$out/op-log.jsonl" \
      || { echo "run-arm.sh: WARNING — failed to copy op-log.jsonl" >&2; archive_problems=1; }
  fi

  local snap="$out/workspace-snapshot"; mkdir -p "$snap"
  if ! ( cd "$ws" && find . -path ./.git -prune -o -type f -print0 \
      | while IFS= read -r -d '' f; do
          mkdir -p "$snap/$(dirname "$f")" && cp "$f" "$snap/$f" || exit 1
        done ); then
    echo "run-arm.sh: WARNING — workspace snapshot was incomplete" >&2
    archive_problems=1
  fi

  # A completed-but-unarchived run is degraded evidence, not a clean pass: downgrade an otherwise-ok
  # verdict so run.json never records verdict=ok while its evidence artifacts are missing/partial.
  if [ "$archive_problems" -ne 0 ] && [ "$verdict" = "ok" ]; then
    verdict="archive-incomplete"
    reason="measured run completed but archiving/snapshotting evidence failed — see stderr; artifacts may be missing or partial."
  fi

  write_run_json "$out" "$arm" "$umbrella" "$skill" "$model" "$wall_seconds" "$cli_version" "$fp_workload" \
    "$build_json" "$out/setup/setup-sessions.json" "$rc" "$parseable" "$verdict" "$reason" \
    "$session_id" "$projects_root" "$transcript_bundle" "$session_resolved" \
    "$workload_ref" "$host_name" "$started_at"

  echo "run-arm.sh: done — verdict=$verdict, run output in $out" >&2
  [ "$verdict" = "ok" ] && return 0 || return 9
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
