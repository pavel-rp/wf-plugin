#!/usr/bin/env bash
# run-arm.sh — the ONE measured invocation for a single arm, run INSIDE that arm's container.
#
# Exactly one measured `claude -p "<measured-skill> <umbrella-id>"` per arm, spaced apart from its
# pair, same day, order shuffled. This script runs in-container (dispatched by runner/entrypoint.sh
# on --measured-fleet, after the auth/billing guards) and owns the full per-arm sequence so every
# arm is isolated by construction — a fresh container each, its own CLAUDE_CONFIG_DIR and its own
# seeded workspace, differing ONLY in the image's WF_REF:
#
#   1. seed  — clone the workload snapshot at ref W, run the arm's UNMEASURED /wf:init + pack init
#              skills + fake config, then the blinding gate (seed-workspace.sh). Needs egress to
#              the workload host, so it runs BEFORE no-egress is applied.
#   2. seal  — apply no-egress AFTER the seed, so the measured run cannot reach a real
#              tracker/delivery host; the fake provider answers in-memory.
#   3. measure — the ONE billed measured skill (or --gate-skill for the cheap dry-run gate, which
#              exercises this exact seed+seal path with a cheaper skill).
#   4. archive — tar the isolated projects/ tree + op-log + workspace snapshot + run.json into the
#              mounted --out (default $WF_RUN_OUT=/work/run-output). run.json records the
#              measured session id AND the unmeasured setup sessions, so the split stays auditable.
#
# Experiment-agnostic: the arm labels this accepts, the measured skill, the umbrella id and the
# model pin all come from the experiment manifest, resolved from the experiment directory the
# container was pointed at ($WF_EXPERIMENT_DIR, exported by runner/entrypoint.sh).
#
# Never run this script directly on a host — it runs inside an arm container.
set -uo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(cd "$ENGINE_DIR/../../runner" && pwd)"
# shellcheck source=manifest.sh
. "$ENGINE_DIR/manifest.sh"
# shellcheck source=../../runner/fingerprint.sh
. "$RUNNER_DIR/fingerprint.sh"

usage() {
  cat >&2 <<'EOF'
usage (in-container; dispatched by runner/entrypoint.sh on --measured-fleet):
  run-arm.sh --measured-fleet --arm <label> [--umbrella-id <id>]
             --workload-ref <ref> [--fake-scripts <path|name>]
             [--gate-skill "<skill>"] [--model <model>] [--manifest <path>]
             [--out <dir>] [--packs "<a b c>"] [--repo-url <url>]
             [--build-json <build-<label>.json>] [--on-quota fail|wait] [--allow-api-key]
  --gate-skill runs the given cheap skill instead of the measured skill, over the SAME
  seed+seal path (the dry-run gate). --umbrella-id is then optional.
  The manifest resolves from --manifest, else $WF_EXPERIMENT_MANIFEST (an absolute path, or a
  bare name resolved against $WF_EXPERIMENT_DIR), else $WF_EXPERIMENT_DIR/experiment.json.
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
  # No pipe: `tr < big-file | head -c1` SIGPIPEs tr under pipefail. awk stops at the first char.
  local first; first="$(awk '{ gsub(/[[:space:]]/,""); if (length($0)) { printf "%s", substr($0,1,1); exit } }' "$f" 2>/dev/null || true)"
  case "$first" in '{'|'[') return 0;; *) echo "FATAL [cli-drift]: '$f' not JSON." >&2; return 6;; esac
}

extract_session_id() {
  # Single-pass, NO pipe. `grep … | head -n1` dies of SIGPIPE the instant head closes the pipe,
  # and `set -o pipefail` promotes that to a fatal 141 — on a MEASURED transcript that would
  # discard a run that actually succeeded. awk terminates itself on the first match instead.
  awk 'match($0, /"session_id"[[:space:]]*:[[:space:]]*"[^"]+"/) {
         s = substr($0, RSTART, RLENGTH)
         sub(/^"session_id"[[:space:]]*:[[:space:]]*"/, "", s)
         sub(/"$/, "", s)
         print s; exit
       }' "$1" 2>/dev/null || true
}

discover_transcript_bundle() {
  [ -d "$1" ] || return 0
  find "$1" -type f -name '*.jsonl' 2>/dev/null | LC_ALL=C sort | head -n1
}

# Mirrors runner/run-skill.sh's detect_quota — see the rationale there. A bare `rate.?limit`
# substring is not a signal: the CLI stamps a benign `rate_limit_event` ("status":"allowed") on
# every run, so matching it reported quota-exhausted on every clean run.
detect_quota() {
  if grep -Eqi 'usage limit|quota (exceeded|exhausted)|rate.?limit(_| )(error|exceeded)|overloaded|status.{0,3}429|insufficient_quota' \
      "$1" "$2" 2>/dev/null; then
    echo 1
    return 0
  fi
  if awk '/"type"[[:space:]]*:[[:space:]]*"rate_limit_event"/ &&
          !/"status"[[:space:]]*:[[:space:]]*"allowed"/ { found = 1; exit }
          END { exit !found }' "$1" 2>/dev/null; then
    echo 1
    return 0
  fi
  echo 0
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
  local arm="" umbrella="" workload_ref="" fake_scripts="" gate_skill="" model="" \
        out="" packs="" repo_url="" build_json="" on_quota="fail" manifest=""

  # --- resolve the manifest first: the arm set and the experiment constants come from it ---------
  local -a argv=("$@")
  local i=0
  while [ "$i" -lt "${#argv[@]}" ]; do
    case "${argv[$i]}" in
      --manifest) i=$((i + 1)); manifest="${argv[$i]:-}";;
      --manifest=*) manifest="${argv[$i]#*=}";;
    esac
    i=$((i + 1))
  done
  [ -n "$manifest" ] || manifest="$(manifest_env_path "$ENGINE_DIR")"
  manifest_load "$manifest" || { echo "run-arm.sh: could not load the experiment manifest ($manifest)" >&2; return 2; }

  model="$CONST_MODEL"

  while [ $# -gt 0 ]; do
    case "$1" in
      --measured-fleet) shift;;                       # dispatch sentinel (consumed by entrypoint too)
      --manifest) shift 2;;
      --manifest=*) shift;;
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

  # The arm label must be one the manifest declares — no fixed arm set lives in this script.
  [ -n "$arm" ] || { echo "run-arm.sh: --arm <label> is required" >&2; usage; return 2; }
  manifest_require_arm "$arm" "run-arm.sh" || return 2
  # The workload ref is required on the container path and NEVER defaulted from the manifest: the
  # host composes every measured line with an explicit --workload-ref, so a missing one here means
  # the caller bypassed the orchestrator, and silently substituting a default would hide that.
  [ -n "$workload_ref" ] || { echo "run-arm.sh: --workload-ref <ref W> is required on the container path (never defaulted here — the host always passes it explicitly)" >&2; return 2; }
  [ -n "$packs" ] || packs="$ENGINE_DEFAULT_PACKS"

  # The measured skill: the manifest's measured skill applied to the umbrella, or a cheaper
  # --gate-skill over the same seed+seal path.
  local skill=""
  if [ -n "$gate_skill" ]; then
    skill="$gate_skill"
  else
    # SPEND GUARD (container-side): the billed measured run requires an EXPLICIT --umbrella-id.
    # The manifest's umbrella is deliberately not a fall-through here — this is the last gate on
    # the `docker run` path an operator drives by hand, where the host's --spend confirmation never
    # ran, so naming neither --umbrella-id nor --gate-skill must refuse, not bill.
    [ -n "$umbrella" ] || { echo "run-arm.sh: --umbrella-id <id> is required for the BILLED measured run (or pass --gate-skill to take the cheap dry-run gate over the same seed+seal path). The manifest's umbrella is never a silent default on the billed path." >&2; return 2; }
    skill="$CONST_MEASURED_SKILL $umbrella"
  fi

  # Resolve --fake-scripts: absolute/relative path as given, else the experiment's declared name
  # resolved against the image-baked experiment directory.
  [ -n "$fake_scripts" ] || fake_scripts="$CONST_FAKE_SCRIPTS"
  [ -f "$fake_scripts" ] || fake_scripts="$KIT_DIR/$fake_scripts"
  [ -f "$fake_scripts" ] || { echo "run-arm.sh: --fake-scripts not found: $fake_scripts" >&2; return 2; }

  [ -n "$out" ] || out="${WF_RUN_OUT:-/work/run-output}"
  rm -rf "$out"; mkdir -p "$out"

  local host_name started_at
  host_name="$(hostname 2>/dev/null || echo unknown)"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  # --- 1. seed (egress OPEN — the workload clone needs the workload host) -------------------------
  local cfg ws; cfg="$(mktemp -d)"; ws="$(mktemp -d)/workspace"; mkdir -p "$ws"
  export CLAUDE_CONFIG_DIR="$cfg"
  echo "run-arm.sh: arm=$arm — seeding workload @ $workload_ref into $ws (config=$cfg)" >&2
  local -a seed_args=("$ws" --manifest "$MANIFEST_PATH" --workload-ref "$workload_ref"
                      --fake-scripts "$fake_scripts" --config-dir "$cfg" --out "$out/setup"
                      --packs "$packs")
  [ -n "$repo_url" ] && seed_args+=(--repo-url "$repo_url")
  local seed_rc=0
  bash "$ENGINE_DIR/seed-workspace.sh" "${seed_args[@]}" >&2 || seed_rc=$?

  # The seed is the ONLY step entitled to the source-repo credential. Drop it here — before the
  # seal, before the agent, and on the failure path too, so no branch reaches the agent with it
  # still set. Unsetting in seed-workspace.sh would not help: that runs in a child process.
  unset WF_SEED_GH_TOKEN GH_TOKEN GITHUB_TOKEN

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
    claude -p "$skill" --output-format stream-json --verbose \
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
    # measured runs (the analysis diffs the two). Neither policy actually waits here; the
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
    reason="claude exited $rc — see stderr.log; transcript parsed but the run did not complete cleanly."
  fi

  # --- 4. archive raw transcripts immediately (a measured run's transcripts are the evidence; a
  #        pruned archive destroys it) + snapshot the resulting workspace ------------------------
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
