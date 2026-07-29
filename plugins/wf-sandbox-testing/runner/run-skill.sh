#!/usr/bin/env bash
# run-skill.sh — execute ONE real headless skill invocation against a canned fixture,
# from a clean in-image marketplace install (or a pinned earlier build), fingerprinting
# every input and asserting the transcript is parseable stream-json up front.
#
# It assumes entrypoint.sh has already passed the auth/billing guards — but it re-records
# the environment's guard state in run.json so the output is self-describing regardless.
#
# Sourcing this file defines its functions (assert_stream_json, detect_quota) WITHOUT
# running; selfcheck.sh sources it to exercise the parseability assertion offline.
#
# Clean-install discipline (the C008 precedent, the WF-319 bug class): the plugin under
# test installs fresh into an ISOLATED CLAUDE_CONFIG_DIR — never the dev-machine ~/.claude,
# never a mounted _local/ — so nothing from outside the fixture can leak into the run.
set -uo pipefail

RUNNER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$RUNNER_DIR/.." && pwd)"
# shellcheck source=fingerprint.sh
. "$RUNNER_DIR/fingerprint.sh"

# assert_stream_json <file> — the CLI-drift guard. A parseable stream-json transcript is
# either a single JSON array or JSON-lines (one JSON value per non-empty line). Anything
# else means the CLI's --output-format stream-json contract drifted: fail LOUD, non-zero,
# so a drifted run is never recorded as a passing verdict.
assert_stream_json() {
  local f="$1"
  if [ ! -s "$f" ]; then
    echo "FATAL [cli-drift]: transcript '$f' is empty — expected parseable stream-json." >&2
    return 6
  fi
  if command -v jq >/dev/null 2>&1; then
    if jq -e . "$f" >/dev/null 2>&1; then
      return 0   # whole file is a single JSON value (array/object)
    fi
    local n=0 bad=0 line
    while IFS= read -r line || [ -n "$line" ]; do
      [ -z "${line//[[:space:]]/}" ] && continue
      n=$((n + 1))
      printf '%s' "$line" | jq -e . >/dev/null 2>&1 || bad=$((bad + 1))
    done < "$f"
    if [ "$n" -eq 0 ]; then
      echo "FATAL [cli-drift]: transcript '$f' contains no JSON lines." >&2
      return 6
    fi
    if [ "$bad" -ne 0 ]; then
      echo "FATAL [cli-drift]: transcript '$f' has $bad non-JSON line(s) — stream-json format drifted." >&2
      return 6
    fi
    return 0
  fi
  # jq absent — minimal structural check.
  local first
  # No pipe: `tr < big-file | head -c1` SIGPIPEs tr under pipefail. awk stops at the first char.
  first="$(awk '{ gsub(/[[:space:]]/,""); if (length($0)) { printf "%s", substr($0,1,1); exit } }' "$f" 2>/dev/null || true)"
  case "$first" in
    '{'|'[') return 0;;
    *) echo "FATAL [cli-drift]: transcript '$f' does not begin with a JSON object/array." >&2; return 6;;
  esac
}

# detect_quota <transcript> <stderr-log> — best-effort subscription-quota signal.
# Prints "1" when the run hit a usage/quota/rate limit, "0" otherwise. Kept a pure
# text scan so it never itself bills anything.
detect_quota() {
  local transcript="$1" stderr_log="$2"
  if grep -Eqi 'usage limit|quota (exceeded|exhausted)|rate.?limit|overloaded|status.{0,3}429|insufficient_quota' \
      "$transcript" "$stderr_log" 2>/dev/null; then
    echo 1
  else
    echo 0
  fi
}

# extract_session_id <transcript> — the real session id the CLI stamped on every stream-json
# event. Pure text scan (first "session_id":"<id>" match); prints empty when none is present.
extract_session_id() {
  # Single-pass, NO pipe — grep|head under `set -o pipefail` becomes a fatal 141 (SIGPIPE) on a
  # large transcript. awk stops itself on the first match, so nothing writes into a closed pipe.
  awk 'match($0, /"session_id"[[:space:]]*:[[:space:]]*"[^"]+"/) {
         s = substr($0, RSTART, RLENGTH)
         sub(/^"session_id"[[:space:]]*:[[:space:]]*"/, "", s)
         sub(/"$/, "", s)
         print s; exit
       }' "$1" 2>/dev/null || true
}

# discover_transcript_bundle <projects-root> — the isolated bundle path the CLI wrote under the
# throwaway CLAUDE_CONFIG_DIR/projects tree (the runner also captures a copy to transcript.jsonl).
# Prints empty when the tree is absent. First match, stable-sorted.
discover_transcript_bundle() {
  [ -d "$1" ] || return 0
  find "$1" -type f -name '*.jsonl' 2>/dev/null | LC_ALL=C sort | head -n1
}

# write_run_json — assemble the self-describing run record.
write_run_json() {
  local out="$1" task="$2" skill="$3" fixture="$4" plugin_source="$5" \
        fp_fixture="$6" fp_plugin="$7" cli_version="$8" \
        allow_api_key="$9" on_quota="${10}" exit_code="${11}" \
        parseable="${12}" verdict="${13}" reason="${14}" \
        session_id="${15}" projects_root="${16}" transcript_bundle="${17}" session_resolved="${18}"
  local api_key_unset="true"; [ -n "${ANTHROPIC_API_KEY:-}" ] && api_key_unset="false"
  local token_present="true"; [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && token_present="false"
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg task "$task" --arg skill "$skill" --arg fixture "$fixture" \
      --arg plugin_source "$plugin_source" --arg cli_version "$cli_version" \
      --arg fp_fixture "$fp_fixture" --arg fp_plugin "$fp_plugin" \
      --argjson api_key_unset "$api_key_unset" --argjson token_present "$token_present" \
      --argjson allow_api_key "$([ "$allow_api_key" = 1 ] && echo true || echo false)" \
      --arg on_quota "$on_quota" --argjson exit_code "$exit_code" \
      --argjson parseable "$parseable" --arg verdict "$verdict" --arg reason "$reason" \
      --arg session_id "$session_id" --arg projects_root "$projects_root" \
      --arg transcript_bundle "$transcript_bundle" \
      --argjson session_resolved "$([ "$session_resolved" = 1 ] && echo true || echo false)" \
      '{
        task: $task, skill: $skill, fixture: $fixture, plugin_source: $plugin_source,
        cli_version: $cli_version,
        fingerprints: { fixture: $fp_fixture, plugin_build: $fp_plugin, cli_version: $cli_version },
        guards: { anthropic_api_key_unset: $api_key_unset, oauth_token_present: $token_present,
                  allow_api_key: $allow_api_key, on_quota: $on_quota },
        run: { exit_code: $exit_code, transcript: "transcript.jsonl",
               transcript_parseable: $parseable, workspace_snapshot: "workspace-snapshot" },
        session: { session_id: $session_id, projects_root: $projects_root,
                   transcript_bundle: $transcript_bundle, resolved: $session_resolved },
        verdict: $verdict, reason: $reason
      }' > "$out/run.json"
  else
    {
      printf '{\n'
      printf '  "task": "%s", "skill": "%s", "fixture": "%s", "plugin_source": "%s",\n' "$task" "$skill" "$fixture" "$plugin_source"
      printf '  "cli_version": "%s",\n' "$cli_version"
      printf '  "fingerprints": { "fixture": "%s", "plugin_build": "%s", "cli_version": "%s" },\n' "$fp_fixture" "$fp_plugin" "$cli_version"
      printf '  "guards": { "anthropic_api_key_unset": %s, "oauth_token_present": %s, "allow_api_key": %s, "on_quota": "%s" },\n' \
        "$api_key_unset" "$token_present" "$([ "$allow_api_key" = 1 ] && echo true || echo false)" "$on_quota"
      printf '  "run": { "exit_code": %s, "transcript": "transcript.jsonl", "transcript_parseable": %s, "workspace_snapshot": "workspace-snapshot" },\n' "$exit_code" "$parseable"
      printf '  "session": { "session_id": "%s", "projects_root": "%s", "transcript_bundle": "%s", "resolved": %s },\n' \
        "$session_id" "$projects_root" "$transcript_bundle" "$([ "$session_resolved" = 1 ] && echo true || echo false)"
      printf '  "verdict": "%s", "reason": "%s"\n' "$verdict" "$reason"
      printf '}\n'
    } > "$out/run.json"
  fi
}

main() {
  local plugin_source="current" skill="/wf:branch FAKE-1" fixture="demo-fake" \
        out="" on_quota="fail" allow_api_key=0 model=""
  local marketplace_name="wf-marketplace"

  while [ $# -gt 0 ]; do
    case "$1" in
      --plugin-source) plugin_source="${2:?}"; shift 2;;
      --plugin-source=*) plugin_source="${1#*=}"; shift;;
      --skill) skill="${2:?}"; shift 2;;
      --skill=*) skill="${1#*=}"; shift;;
      --fixture) fixture="${2:?}"; shift 2;;
      --fixture=*) fixture="${1#*=}"; shift;;
      # --model threads the tier-resolved model (e.g. the cheap SMOKE model) into the real
      # `claude -p` invocation below. Empty (the default, and every existing caller) leaves the
      # invocation byte-identical to before this flag existed — no behavior change for the canned
      # suites or selfcheck.sh.
      --model) model="${2:?}"; shift 2;;
      --model=*) model="${1#*=}"; shift;;
      --out) out="${2:?}"; shift 2;;
      --out=*) out="${1#*=}"; shift;;
      --on-quota) on_quota="${2:?}"; shift 2;;
      --on-quota=*) on_quota="${1#*=}"; shift;;
      --allow-api-key) allow_api_key=1; shift;;
      *) echo "run-skill.sh: unknown argument '$1'" >&2; return 2;;
    esac
  done

  local marketplace_dir="${WF_MARKETPLACE_DIR:-/opt/wf-marketplace}"
  local fixtures_dir="$PACK_DIR/fixtures"
  [ -d "$fixtures_dir/$fixture" ] || { echo "run-skill.sh: fixture '$fixture' not found under $fixtures_dir" >&2; return 2; }

  # Resolve the install source: the current in-image build, or a pinned earlier build.
  local src
  case "$plugin_source" in
    current) src="$marketplace_dir";;
    *)       src="$plugin_source";;
  esac
  [ -d "$src" ] || { echo "run-skill.sh: plugin source '$src' not found (--plugin-source $plugin_source)" >&2; return 2; }

  [ -n "$out" ] || out="${WF_RUN_OUT:-/work/run-output}"
  rm -rf "$out"; mkdir -p "$out"

  # --- clean install into an ISOLATED config dir (no dev-machine ~/.claude) ---
  local cfg; cfg="$(mktemp -d)"; export CLAUDE_CONFIG_DIR="$cfg"
  echo "run-skill.sh: clean install from '$src' into isolated CLAUDE_CONFIG_DIR=$cfg" >&2
  claude plugin marketplace add "$src" >&2
  claude plugin install "wf@${marketplace_name}" "wf-fake@${marketplace_name}" >&2

  # Resolve the clean-installed wf-fake root (where the fake capability manifest landed).
  local wf_fake_manifest wf_fake_root
  wf_fake_manifest="$(find "$cfg" -type f -path '*/wf-fake/*/capabilities/fake/manifest.md' 2>/dev/null | head -n1)"
  [ -n "$wf_fake_manifest" ] || { echo "run-skill.sh: clean install produced no wf-fake capabilities/fake/manifest.md under $cfg" >&2; return 7; }
  wf_fake_root="${wf_fake_manifest%/capabilities/fake/manifest.md}"

  # --- materialize the fixture workspace (real _local/ + git history) ---
  local ws; ws="$(mktemp -d)/workspace"; mkdir -p "$ws"
  bash "$fixtures_dir/$fixture/seed.sh" "$ws" "$wf_fake_root" >&2

  # --- fingerprint every input (authored fixture tree, plugin build, CLI) ---
  local fp_fixture fp_plugin cli_version
  fp_fixture="$(fingerprint_tree "$fixtures_dir/$fixture/project")"
  fp_plugin="$(fingerprint_tree "$src")"
  cli_version="$(fingerprint_cli)"
  echo "run-skill.sh: fingerprints — fixture=$fp_fixture plugin=$fp_plugin cli='$cli_version'" >&2

  # --- run ONE real headless skill invocation, stream-json, pre-approved permissions ---
  # When --model was supplied (e.g. the tier-resolved cheap SMOKE model) it is applied here; when
  # omitted, model_args expands to nothing and the invocation is byte-identical to the pre-flag form.
  local transcript="$out/transcript.jsonl" stderr_log="$out/stderr.log"
  local -a model_args=()
  [ -n "$model" ] && model_args=(--model "$model")
  local rc=0
  (
    cd "$ws" && \
    claude -p "$skill" --output-format stream-json --verbose --dangerously-skip-permissions "${model_args[@]}"
  ) > "$transcript" 2> "$stderr_log" || rc=$?

  # --- capture the real session id + isolated projects/transcript root (machine-readable) ---
  # The run executed in the throwaway CLAUDE_CONFIG_DIR ($cfg), so its projects/transcript tree is
  # fully isolated from any dev-machine ~/.claude. Record the session id the CLI stamped and where
  # its transcript bundle landed, so a downstream accounting pass can resolve the run deterministically.
  local session_id projects_root transcript_bundle session_resolved=0
  session_id="$(extract_session_id "$transcript")"
  projects_root="$cfg/projects"
  transcript_bundle="$(discover_transcript_bundle "$projects_root")"
  [ -n "$session_id" ] && session_resolved=1
  echo "run-skill.sh: session — id='${session_id:-<none>}' projects_root=$projects_root resolved=$session_resolved" >&2

  # --- quota policy: never a silent API-billed continuation, never a half-run as a pass ---
  local verdict="ok" reason="" parseable=true
  if [ "$(detect_quota "$transcript" "$stderr_log")" = "1" ]; then
    verdict="quota-exhausted"
    if [ "$on_quota" = "wait" ]; then
      reason="subscription quota exhausted; --on-quota=wait — re-run once the usage window resets."
    else
      reason="subscription quota exhausted; --on-quota=fail — terminated without an API-billed continuation."
    fi
    write_run_json "$out" "$skill" "$skill" "$fixture" "$plugin_source" \
      "$fp_fixture" "$fp_plugin" "$cli_version" "$allow_api_key" "$on_quota" \
      "$rc" false "$verdict" "$reason" \
      "$session_id" "$projects_root" "$transcript_bundle" "$session_resolved"
    echo "FATAL [quota]: $reason" >&2
    return 8
  fi

  # --- transcript parseability, asserted up front (CLI drift fails loud) ---
  if ! assert_stream_json "$transcript"; then
    parseable=false; verdict="cli-drift"
    reason="transcript did not parse as stream-json — CLI --output-format contract drifted."
    write_run_json "$out" "$skill" "$skill" "$fixture" "$plugin_source" \
      "$fp_fixture" "$fp_plugin" "$cli_version" "$allow_api_key" "$on_quota" \
      "$rc" "$parseable" "$verdict" "$reason" \
      "$session_id" "$projects_root" "$transcript_bundle" "$session_resolved"
    return 6
  fi

  if [ "$rc" -ne 0 ]; then
    verdict="skill-error"
    reason="claude exited $rc — see stderr.log; transcript parsed but the skill run did not complete cleanly."
  fi

  # --- snapshot the resulting workspace (excluding the throwaway .git objects) ---
  local snap="$out/workspace-snapshot"; mkdir -p "$snap"
  ( cd "$ws" && find . -path ./.git -prune -o -type f -print0 \
      | while IFS= read -r -d '' f; do
          mkdir -p "$snap/$(dirname "$f")"; cp "$f" "$snap/$f"
        done )

  write_run_json "$out" "$skill" "$skill" "$fixture" "$plugin_source" \
    "$fp_fixture" "$fp_plugin" "$cli_version" "$allow_api_key" "$on_quota" \
    "$rc" "$parseable" "$verdict" "$reason" \
    "$session_id" "$projects_root" "$transcript_bundle" "$session_resolved"

  echo "run-skill.sh: done — verdict=$verdict, run output in $out" >&2
  [ "$verdict" = "ok" ] && return 0 || return 9
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
