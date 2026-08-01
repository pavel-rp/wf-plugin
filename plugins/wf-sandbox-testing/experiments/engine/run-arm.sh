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
             [--drive-to-terminal [--max-ticks <n>] [--resume-mode same|bare]
                                  [--terminal-states <ere>]
                                  [--resolve-gates [--max-gate-resolutions <n>]
                                                   [--operator-policy <path>]]]
  --gate-skill runs the given cheap skill instead of the measured skill, over the SAME
  seed+seal path (the dry-run gate). --umbrella-id is then optional.
  --resolve-gates (OFF by default, and only meaningful with --drive-to-terminal) resumes a drive
  that stopped at a human-decision gate: it dispatches a bounded, separately-attributed operator
  session carrying a fixed policy prompt, then ticks again. --max-gate-resolutions caps those
  sessions (default 5; exceeding it ends the drive with terminal "gate-cap"), and
  --operator-policy overrides the policy file (default: operator-policy.md beside this script).
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

# skill_block_prefix <skill> — the final-output block's leading token for a `/wf:<name>` skill
# (`/wf:ship FLEET-2` -> SHIP). Every wf skill ends with `<PREFIX> — <state>`.
skill_block_prefix() {
  local s="${1##*:}"; s="${s%% *}"
  printf '%s' "$s" | tr '[:lower:]-' '[:upper:]_'
}

# skill_terminal_state <transcript> <prefix> <states-regex> — print the skill's terminal state when
# its final-output block reports one, else nothing (the driver then ticks again).
#
# Only states the skill treats as an END are passed in. Non-terminal states are the whole point of
# the loop and must NOT be listed: fleet's `Running`/`Waiting` re-arm, and ship's `Handed-off` is a
# deliberate context-ceiling yield whose own Next: line says to invoke it again.
#
# Matched against the raw stream-json rather than a parsed field: the block is embedded in a result
# record's text and the separator is an em dash the CLI may emit raw or \u-escaped, so the pattern
# tolerates either instead of assuming an encoding.
skill_terminal_state() {
  grep -Eo "$2[^A-Za-z]{1,12}($3)" "$1" 2>/dev/null | grep -Eo "($3)" | tail -n1
}

# --- gate resolution --------------------------------------------------------------------------
# A drive can stop at a HUMAN-DECISION GATE — a terminal state that is not a genuine end but a
# skill correctly waiting for a person. Left alone, no drive reaches a terminal state unattended
# and end-to-end cost is not measurable. The block below supplies the missing actor: a scripted
# operator with a fixed, invariant decision policy, dispatched between ticks.

# The workflow task-folder root inside a seeded workspace. Engine knowledge about the seeded
# layout, exactly as the op-log copy further down already assumes `_local/fake/op-log.jsonl`.
GATE_TASK_ROOT="_local"

# The terminal states the drive treats as a GATE rather than an end. A subset of --terminal-states:
# a state listed here still ends the drive when gate resolution is off, and still ends it when the
# gate artifact carries no open question.
GATE_TERMINAL_STATES="Blocked"

# The per-session state the CLI writes into its OWN config dir, excluded from the isolation
# fingerprint so that what remains is the installed plugin tree (plus the static settings files,
# which the operator must not touch either). Fingerprinting the config dir whole would differ on
# every run — the operator's own transcript lands under `projects/` — so the guard would fail every
# run instead of catching a real write. Anything NOT listed here is hashed: an unenumerated new CLI
# state file fails the run loudly rather than opening a silent hole, which is the correct bias for
# the one constraint this whole path exists to protect.
CONFIG_VOLATILE_ERE='^\./(projects|sessions|session-env|todos|tasks|jobs|shell-snapshots|file-history|paste-cache|backups|statusline|statsig|daemon)/|^\./(history\.jsonl|daemon\.(log|lock|status\.json)|\.last-cleanup|\.last-update-result\.json|\.credentials\.json|mcp-needs-auth-cache\.json)$|^\./plugins/(\.last_inuse_sweep|plugin-catalog-cache\.json)$'

# gate_open_questions <workspace> — the summed `<n>` across every `## Awaiting user (<n>)` heading
# in every `<task-root>/*/05_verify-fix.md` under the workspace. Prints 0 when there is none.
#
# GLOBBED, never composed from the umbrella id: the observed gate's artifact sat under a CHILD id
# while the drive had been invoked on the umbrella, so an id-composed path would have missed it.
gate_open_questions() {
  local ws="$1" total=0 f n
  for f in "$ws/$GATE_TASK_ROOT"/*/05_verify-fix.md; do
    [ -f "$f" ] || continue
    n="$(grep -Eo '^##[[:space:]]+Awaiting user[[:space:]]*\([0-9]+\)' "$f" 2>/dev/null \
         | grep -Eo '[0-9]+' | awk '{ s += $1 } END { printf "%d", s + 0 }')"
    total=$(( total + ${n:-0} ))
  done
  printf '%d' "$total"
}

# is_gate <terminal-state> <workspace> — prints 1 when this terminal state is a human-decision gate
# carrying at least one open question, else 0. `n = 0` and a missing heading are BOTH "no gate",
# never "a gate with zero questions": a skill that ended Blocked for some other reason has nothing
# an operator could answer, and dispatching one would burn a session on nothing.
is_gate() {
  local state="$1" ws="$2"
  [ -n "$state" ] || { printf '0'; return 0; }
  printf '%s' "$state" | grep -Eq "^($GATE_TERMINAL_STATES)$" || { printf '0'; return 0; }
  if [ "$(gate_open_questions "$ws")" -gt 0 ]; then printf '1'; else printf '0'; fi
}

# extract_result_cost <transcript> — the session's own `total_cost_usd`, read from the LAST record
# carrying it (the stream's terminating `result` record). Prints 0 when the field never appears.
# No `exit` in the match block, so later records win; no pipe, for the SIGPIPE reason
# extract_session_id documents.
extract_result_cost() {
  awk 'match($0, /"total_cost_usd"[[:space:]]*:[[:space:]]*-?[0-9.]+([eE][-+]?[0-9]+)?/) {
         s = substr($0, RSTART, RLENGTH)
         sub(/^"total_cost_usd"[[:space:]]*:[[:space:]]*/, "", s)
         v = s + 0
       }
       END { printf "%.10g", v + 0 }' "$1" 2>/dev/null || printf '0'
}

# config_manifest <config-dir> <out-file> — a `<sha>  <path>` line per hashed file, under the SAME
# exclusions the isolation fingerprint uses. Diagnostics only: the fingerprint is the verdict, and
# this is what makes a breach actionable instead of a bare pair of hashes.
config_manifest() {
  ( cd "$1" 2>/dev/null || exit 0
    find . -type f ! -path './.git/*' 2>/dev/null \
      | grep -Ev "$CONFIG_VOLATILE_ERE" \
      | LC_ALL=C sort \
      | while IFS= read -r f; do printf '%s  %s\n' "$(sha256sum "$f" | cut -d' ' -f1)" "$f"; done
  ) > "$2" 2>/dev/null || true
}

# run_operator <workspace> <policy-file> <model> <transcript-out> <stderr-out> — ONE bounded
# operator session, in the seeded workspace, with the policy file's CONTENT as its prompt.
#
# Its own `claude -p` session, its own transcript, and its own stderr: its tokens never land in a
# measured tick's stream, and it gets its own session id, so `fleet-cost.mjs measure --session`
# excludes it by construction. Returns the CLI's exit code.
run_operator() {
  local ws="$1" policy="$2" opmodel="$3" op_out="$4" op_err="$5" orc=0 prompt=""
  prompt="$(cat "$policy")" || return 3
  (
    cd "$ws" && \
    claude -p "$prompt" --output-format stream-json --verbose \
      --dangerously-skip-permissions --model "$opmodel"
  ) > "$op_out" 2> "$op_err" || orc=$?
  return "$orc"
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
  local drive_to_terminal=0 max_ticks=12 resume_mode="same" terminal_states="Complete|Blocked|Merged"
  # Gate resolution, OFF by default: an absent flag leaves every existing path — single-shot and
  # the committed --drive-to-terminal drive alike — running exactly as before.
  local resolve_gates=0 max_gate_resolutions=5 operator_policy=""

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
      --drive-to-terminal) drive_to_terminal=1; shift;;
      --resume-mode) resume_mode="${2:?}"; shift 2;;
      --resume-mode=*) resume_mode="${1#*=}"; shift;;
      --terminal-states) terminal_states="${2:?}"; shift 2;;
      --terminal-states=*) terminal_states="${1#*=}"; shift;;
      --max-ticks) max_ticks="${2:?}"; shift 2;;
      --max-ticks=*) max_ticks="${1#*=}"; shift;;
      --resolve-gates) resolve_gates=1; shift;;
      --max-gate-resolutions) max_gate_resolutions="${2:?}"; shift 2;;
      --max-gate-resolutions=*) max_gate_resolutions="${1#*=}"; shift;;
      --operator-policy) operator_policy="${2:?}"; shift 2;;
      --operator-policy=*) operator_policy="${1#*=}"; shift;;
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

  # The operator policy file and its SHA-256, resolved whether or not gate resolution is on. The
  # hash is recorded on EVERY drive — the invariance check compares arms, so an arm that happened
  # never to stop at a gate must still prove which policy it carried. An unresolvable file is a hard
  # error only when --resolve-gates is on; otherwise the hash stays empty and is reported as "not
  # recorded" downstream rather than silently passing for a match.
  [ -n "$operator_policy" ] || operator_policy="$ENGINE_DIR/operator-policy.md"
  local operator_policy_sha256=""
  if [ -f "$operator_policy" ]; then
    operator_policy_sha256="$(sha256sum "$operator_policy" | cut -d' ' -f1)"
  elif [ "$resolve_gates" = 1 ]; then
    echo "run-arm.sh: --resolve-gates was requested but the operator policy file was not found: $operator_policy" >&2
    return 2
  fi

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

  # --- 3. measure — the billed invocation(s) -----------------------------------------------------
  # Default: ONE invocation, the original contract (and what the cheap gate uses).
  #
  # With --drive-to-terminal: the opening invocation is followed by resume ticks (`<skill>` with no
  # argument re-reads the scoreboard and continues) until the skill reports a terminal state or the
  # tick cap is hit. Without this, an arm stops wherever the headless session happens to hit
  # end_turn — which is a function of how far its subagents got before the process exited, not of
  # the treatment. Arms then complete unequal amounts of work and their totals are not comparable.
  local transcript="$out/transcript.jsonl" stderr_log="$out/stderr.log"
  local start_ts end_ts rc=0 ticks=0 terminal=""
  # Gate-resolution accumulators. All zero/empty on the single-shot and resolve-gates-off paths, so
  # the drive.json write below never has to distinguish "absent" from "zero".
  local gate_stops=0 open_questions_total=0 operator_sessions=0 operator_session_ids="" \
        operator_cost_usd=0 isolation_breach=0 isolation_reason=""
  local resume_skill="$skill"
  [ "$resume_mode" = "bare" ] && resume_skill="${skill%% *}"
  local block_prefix; block_prefix="$(skill_block_prefix "$skill")"
  mkdir -p "$out/ticks"
  start_ts="$(date -u +%s)"

  while :; do
    ticks=$(( ticks + 1 ))
    local tick_out="$out/ticks/tick-$ticks.jsonl" tick_prompt="$skill" trc=0
    [ "$ticks" -gt 1 ] && tick_prompt="$resume_skill"
    [ "$ticks" -gt 1 ] && echo "run-arm.sh: arm=$arm resume tick $ticks — '$tick_prompt'" >&2
    (
      cd "$ws" && \
      claude -p "$tick_prompt" --output-format stream-json --verbose \
        --dangerously-skip-permissions --model "$model"
    ) > "$tick_out" 2>> "$stderr_log" || trc=$?
    # The first tick owns the run's exit code; a failing resume ends the drive without
    # relabelling an opening invocation that already succeeded.
    [ "$ticks" -eq 1 ] && rc=$trc

    terminal="$(skill_terminal_state "$tick_out" "$block_prefix" "$terminal_states")"
    [ "$drive_to_terminal" = 1 ] || break
    [ "$trc" -eq 0 ] || { echo "run-arm.sh: tick $ticks exited $trc — ending the drive." >&2; break; }

    # --- the gate branch, BEFORE the terminal-state break -----------------------------------
    # A gate is not an end: dispatch the operator, then clear `terminal` so control falls through
    # to the tick cap and the quota check and the loop ticks again. Falling through rather than
    # `continue`ing is deliberate — a `continue` would jump over both of those bounds, and a drive
    # that resolves gates is exactly the drive that most needs them.
    if [ "$resolve_gates" = 1 ] && [ "$(is_gate "$terminal" "$ws")" = 1 ]; then
      local open_q; open_q="$(gate_open_questions "$ws")"
      gate_stops=$(( gate_stops + 1 ))
      open_questions_total=$(( open_questions_total + open_q ))
      echo "run-arm.sh: arm=$arm gate on tick $ticks — terminal '$terminal', $open_q open question(s)." >&2

      # The cap ENDS the drive; it is not an error verdict. An arm that ran out of operator
      # sessions did less work than one that did not, which is a fact the analysis must see —
      # so it is recorded as its own terminal value rather than as a failure.
      if [ "$operator_sessions" -ge "$max_gate_resolutions" ]; then
        echo "run-arm.sh: arm=$arm gate-resolution cap ($max_gate_resolutions) reached — ending the drive." >&2
        terminal="gate-cap"
        break
      fi

      mkdir -p "$out/operator"
      local op_n=$(( operator_sessions + 1 ))
      local op_out="$out/operator/operator-$op_n.jsonl" op_err="$out/operator/operator-$op_n.err"
      local fp_cfg_before fp_cfg_after orc=0
      config_manifest "$cfg" "$out/operator/config-manifest-$op_n.before.txt"
      fp_cfg_before="$(fingerprint_tree "$cfg" "$CONFIG_VOLATILE_ERE")"

      run_operator "$ws" "$operator_policy" "$model" "$op_out" "$op_err" || orc=$?

      fp_cfg_after="$(fingerprint_tree "$cfg" "$CONFIG_VOLATILE_ERE")"
      config_manifest "$cfg" "$out/operator/config-manifest-$op_n.after.txt"

      # THE hard constraint: the operator may edit the seeded workload, never the installed plugin
      # tree under $CLAUDE_CONFIG_DIR. A difference ends the run with its own verdict — never a
      # warning, never a silent pass — because every arm's treatment IS that tree.
      if [ "$fp_cfg_before" != "$fp_cfg_after" ]; then
        isolation_breach=1
        isolation_reason="treatment-isolation guard: operator session $op_n changed the installed plugin tree under \$CLAUDE_CONFIG_DIR (fingerprint $fp_cfg_before -> $fp_cfg_after; diff operator/config-manifest-$op_n.before.txt against .after.txt)"
        echo "FATAL [isolation]: $isolation_reason" >&2
        diff "$out/operator/config-manifest-$op_n.before.txt" \
             "$out/operator/config-manifest-$op_n.after.txt" >&2 || true
        break
      fi

      operator_sessions="$op_n"
      local op_sid op_cost
      op_sid="$(extract_session_id "$op_out")"
      op_cost="$(extract_result_cost "$op_out")"
      [ -n "$op_sid" ] && operator_session_ids="$operator_session_ids $op_sid"
      operator_cost_usd="$(awk -v a="$operator_cost_usd" -v b="$op_cost" 'BEGIN { printf "%.10g", a + b }')"
      echo "run-arm.sh: arm=$arm operator session $op_n — id='${op_sid:-<none>}' cost=\$$op_cost exit=$orc" >&2

      if [ "$orc" -ne 0 ]; then
        echo "run-arm.sh: arm=$arm operator session $op_n exited $orc — ending the drive at the gate." >&2
        break
      fi
      if [ "$(detect_quota "$op_out" "$op_err")" = "1" ]; then
        echo "run-arm.sh: arm=$arm quota signal in operator session $op_n — ending the drive at the gate." >&2
        break
      fi

      # The gate was resolved. Fall through to the tick cap and the quota check, then tick again.
      terminal=""
    fi

    [ -z "$terminal" ] || { echo "run-arm.sh: arm=$arm reached terminal state '$terminal' after $ticks tick(s)." >&2; break; }
    if [ "$ticks" -ge "$max_ticks" ]; then
      echo "run-arm.sh: arm=$arm hit the tick cap ($max_ticks) without a terminal state." >&2
      break
    fi
    # A quota wall mid-drive must stop the drive rather than burn the remaining ticks against it.
    if [ "$(detect_quota "$tick_out" "$stderr_log")" = "1" ]; then
      echo "run-arm.sh: arm=$arm quota signal on tick $ticks — ending the drive." >&2
      break
    fi
  done

  # JSONL concatenates cleanly, so downstream record scans (mechanism signals, session-id
  # extraction, quota detection) see the whole drive as one stream, oldest tick first. Counted
  # rather than globbed: `tick-*.jsonl` sorts lexicographically, which puts tick-10 before tick-2
  # and would hand session-id extraction the wrong opening record.
  : > "$transcript"
  local t
  for t in $(seq 1 "$ticks"); do
    [ -f "$out/ticks/tick-$t.jsonl" ] && cat "$out/ticks/tick-$t.jsonl" >> "$transcript"
  done
  end_ts="$(date -u +%s)"
  local wall_seconds=$(( end_ts - start_ts ))
  echo "run-arm.sh: arm=$arm drive complete — ticks=$ticks terminal='${terminal:-none}' gate-stops=$gate_stops operator-sessions=$operator_sessions" >&2
  # The drive outcome is DATA, not just a log line. An arm that stopped at the tick cap, or on a
  # non-success terminal state, did unequal work — and a cost comparison that cannot see that will
  # silently compare unlike runs. Emitted beside run.json so the analysis can gate on it.
  #
  # Every gate-resolution field is emitted with a DEFINED zero/empty value on the single-shot and
  # resolve-gates-off paths: a reader must never have to guess which run wrote the file in order to
  # tell "absent" from "zero". The five original keys keep their exact names and shapes.
  # Deliberately unquoted: the accumulated ids are a space-separated list being split into elements.
  # shellcheck disable=SC2086
  local operator_ids_json="[]"
  [ -n "${operator_session_ids// /}" ] && operator_ids_json="$(printf '%s\n' $operator_session_ids \
    | awk 'BEGIN { printf "[" } { printf "%s\"%s\"", (NR > 1 ? "," : ""), $0 } END { printf "]" }')"
  printf '{"ticks":%d,"terminal":"%s","resume_mode":"%s","max_ticks":%d,"drive_to_terminal":%s,"resolve_gates":%s,"max_gate_resolutions":%d,"gate_stops":%d,"open_questions_total":%d,"operator_sessions":%d,"operator_session_ids":%s,"operator_cost_usd":%s,"operator_policy_sha256":"%s"}\n' \
    "$ticks" "${terminal:-}" "$resume_mode" "$max_ticks" \
    "$([ "$drive_to_terminal" = 1 ] && echo true || echo false)" \
    "$([ "$resolve_gates" = 1 ] && echo true || echo false)" \
    "$max_gate_resolutions" "$gate_stops" "$open_questions_total" "$operator_sessions" \
    "$operator_ids_json" "$operator_cost_usd" "$operator_policy_sha256" > "$out/drive.json"

  local session_id projects_root transcript_bundle session_resolved=0
  session_id="$(extract_session_id "$transcript")"
  projects_root="$cfg/projects"
  transcript_bundle="$(discover_transcript_bundle "$projects_root")"
  [ -n "$session_id" ] && session_resolved=1
  echo "run-arm.sh: measured session id='${session_id:-<none>}' wall=${wall_seconds}s resolved=$session_resolved" >&2

  local verdict="ok" reason="" parseable=true

  # The isolation breach outranks every other outcome below. An arm whose installed plugin tree was
  # written to during the run is not a measurement of that ref at all, so it is reported as its own
  # verdict before quota, drift, or exit-code handling can relabel it as something recoverable.
  if [ "$isolation_breach" -ne 0 ]; then
    verdict="treatment-touched"
    reason="$isolation_reason"
    write_run_json "$out" "$arm" "$umbrella" "$skill" "$model" "$wall_seconds" "$cli_version" "$fp_workload" \
      "$build_json" "$out/setup/setup-sessions.json" "$rc" false "$verdict" "$reason" \
      "$session_id" "$projects_root" "$transcript_bundle" "$session_resolved" \
      "$workload_ref" "$host_name" "$started_at"
    return 10
  fi

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
