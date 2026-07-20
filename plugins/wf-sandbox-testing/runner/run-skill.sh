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
  first="$(tr -d '[:space:]' < "$f" | head -c1)"
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

# fixture_pack_names <fixture-dir> — print the deterministic plugin install set.
# `wf` and `wf-fake` are always present. A fixture may add packs through the
# `fixture.plugins` array in project.seed.json or an optional runner-packs.txt
# (one bare marketplace plugin name per line). Invalid names fail before install.
fixture_pack_names() {
  local fixture_dir="$1" packs_file="$1/runner-packs.txt" seed_file="$1/project.seed.json"
  local -a packs=(wf wf-fake) declared=()
  local raw pack seen existing
  if [ -f "$seed_file" ]; then
    command -v jq >/dev/null 2>&1 || {
      echo "run-skill.sh: jq is required to read fixture.plugins from $seed_file" >&2
      return 2
    }
    jq -e '(.fixture.plugins // []) as $packs | ($packs | type == "array") and all($packs[]; type == "string")' "$seed_file" >/dev/null 2>&1 || {
      echo "run-skill.sh: invalid fixture.plugins declaration in $seed_file" >&2
      return 2
    }
    mapfile -t declared < <(jq -r '.fixture.plugins // [] | .[]' "$seed_file")
  fi
  if [ -f "$packs_file" ]; then
    while IFS= read -r raw || [ -n "$raw" ]; do
      raw="${raw%%#*}"
      raw="${raw#"${raw%%[![:space:]]*}"}"
      raw="${raw%"${raw##*[![:space:]]}"}"
      [ -z "$raw" ] || declared+=("$raw")
    done < "$packs_file"
  fi
  for pack in "${declared[@]}"; do
    case "$pack" in
      [a-z0-9]* ) ;;
      *) echo "run-skill.sh: invalid fixture plugin name '$pack'" >&2; return 2;;
    esac
    case "$pack" in
      *[!a-z0-9-]*|*- ) echo "run-skill.sh: invalid fixture plugin name '$pack'" >&2; return 2;;
    esac
    seen=0
    for existing in "${packs[@]}"; do
      [ "$existing" = "$pack" ] && seen=1 && break
    done
    [ "$seen" -eq 1 ] || packs+=("$pack")
  done
  printf '%s\n' "${packs[@]}"
}

# new_session_id — Claude Code requires an explicit UUID for --session-id. Keeping
# the id known up front makes persisted evidence discovery exact rather than relying
# on timestamps or "newest file" heuristics.
new_session_id() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    tr 'A-F' 'a-f' < /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-F' 'a-f'
  else
    local hex
    hex="$(printf '%s' "$(date +%s%N)-$$-${RANDOM:-0}-${RANDOM:-0}" | sha256sum | cut -c1-32)"
    printf '%s-%s-%s-%s-%s\n' "${hex:0:8}" "${hex:8:4}" "${hex:12:4}" "${hex:16:4}" "${hex:20:12}"
  fi
}

# capture_session_evidence <config-dir> <session-id> <run-output>
# Copies the persisted main session and every nested transcript/metadata pair into
# the durable run output. It validates the pair set before publishing the bundle,
# then prints six tab-separated fields consumed by run.json:
# bundle-path, main-path, main-count, subagent-count, metadata-count, fingerprint.
capture_session_evidence() {
  local cfg="$1" session_id="$2" out="$3"
  local projects="$cfg/projects" main main_dir session_dir
  local bundle_rel="session-evidence"
  local bundle="$out/$bundle_rel" stage="$out/.session-evidence.$$"
  local -a mains=() transcripts=() metadata=()
  [ -d "$projects" ] || { echo "FATAL [session-evidence]: no persisted projects directory under $cfg" >&2; return 10; }
  mapfile -d '' -t mains < <(find "$projects" -type f -name "$session_id.jsonl" -print0 2>/dev/null)
  if [ "${#mains[@]}" -ne 1 ]; then
    echo "FATAL [session-evidence]: expected exactly one main transcript for session $session_id, found ${#mains[@]}." >&2
    return 10
  fi
  main="${mains[0]}"; main_dir="$(dirname "$main")"; session_dir="$main_dir/$session_id"
  if [ -d "$session_dir/subagents" ]; then
    mapfile -d '' -t transcripts < <(find "$session_dir/subagents" -type f -name 'agent-*.jsonl' -print0 2>/dev/null | LC_ALL=C sort -z)
    mapfile -d '' -t metadata < <(find "$session_dir/subagents" -type f -name 'agent-*.meta.json' -print0 2>/dev/null | LC_ALL=C sort -z)
  fi

  local f mate
  for f in "${transcripts[@]}"; do
    mate="${f%.jsonl}.meta.json"
    [ -f "$mate" ] || { echo "FATAL [session-evidence]: transcript has no metadata sibling: $f" >&2; return 10; }
  done
  for f in "${metadata[@]}"; do
    mate="${f%.meta.json}.jsonl"
    [ -f "$mate" ] || { echo "FATAL [session-evidence]: metadata has no transcript sibling: $f" >&2; return 10; }
  done
  if [ "${#transcripts[@]}" -ne "${#metadata[@]}" ]; then
    echo "FATAL [session-evidence]: nested transcript/metadata counts differ (${#transcripts[@]} != ${#metadata[@]})." >&2
    return 10
  fi

  rm -rf "$stage"; mkdir -p "$stage"
  cp "$main" "$stage/$session_id.jsonl" || { rm -rf "$stage"; return 10; }
  for f in "${transcripts[@]}" "${metadata[@]}"; do
    [ -n "$f" ] || continue
    local rel="${f#"$session_dir/"}"
    mkdir -p "$stage/$(dirname "$rel")"
    cp "$f" "$stage/$rel" || { rm -rf "$stage"; return 10; }
  done
  rm -rf "$bundle"; mv "$stage" "$bundle"
  local fp; fp="$(fingerprint_tree "$bundle")" || return 10
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' \
    "$bundle_rel" "$bundle_rel/$session_id.jsonl" 1 \
    "${#transcripts[@]}" "${#metadata[@]}" "$fp"
}

cleanup_run_state() {
  local state_root="${1:-}"
  [ -z "$state_root" ] || rm -rf -- "$state_root"
}

bundle_path_array() {
  local out="$1" bundle="$2" pattern="$3" first=1 f
  printf '['
  if [ -n "$bundle" ] && [ -d "$out/$bundle/subagents" ]; then
    while IFS= read -r f; do
      [ "$first" -eq 1 ] || printf ','
      printf '"%s/subagents/%s"' "$bundle" "$(basename "$f")"
      first=0
    done < <(find "$out/$bundle/subagents" -maxdepth 1 -type f -name "$pattern" -print | LC_ALL=C sort)
  fi
  printf ']'
}

# write_run_json — assemble the self-describing run record.
write_run_json() {
  local out="$1" task="$2" skill="$3" fixture="$4" plugin_source="$5" \
        fp_fixture="$6" fp_plugin="$7" cli_version="$8" \
        allow_api_key="$9" on_quota="${10}" exit_code="${11}" \
        parseable="${12}" verdict="${13}" reason="${14}" \
        session_id="${15:-}" evidence_bundle="${16:-}" evidence_main="${17:-}" \
        main_count="${18:-0}" subagent_count="${19:-0}" metadata_count="${20:-0}" \
        evidence_fp="${21:-}" evidence_status="${22:-not-captured}"
  local api_key_unset="true"; [ -n "${ANTHROPIC_API_KEY:-}" ] && api_key_unset="false"
  local token_present="true"; [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && token_present="false"
  local transcript_count=$((main_count + subagent_count)) evidence_count=$((main_count + subagent_count + metadata_count))
  local transcript_paths metadata_paths
  transcript_paths="$(bundle_path_array "$out" "$evidence_bundle" 'agent-*.jsonl')"
  metadata_paths="$(bundle_path_array "$out" "$evidence_bundle" 'agent-*.meta.json')"
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg task "$task" --arg skill "$skill" --arg fixture "$fixture" \
      --arg plugin_source "$plugin_source" --arg cli_version "$cli_version" \
      --arg fp_fixture "$fp_fixture" --arg fp_plugin "$fp_plugin" \
      --argjson api_key_unset "$api_key_unset" --argjson token_present "$token_present" \
      --argjson allow_api_key "$([ "$allow_api_key" = 1 ] && echo true || echo false)" \
      --arg on_quota "$on_quota" --argjson exit_code "$exit_code" \
      --argjson parseable "$parseable" --arg verdict "$verdict" --arg reason "$reason" \
      --arg session_id "$session_id" --arg evidence_status "$evidence_status" \
      --arg evidence_bundle "$evidence_bundle" --arg evidence_main "$evidence_main" \
      --argjson main_count "$main_count" --argjson subagent_count "$subagent_count" \
      --argjson metadata_count "$metadata_count" --argjson transcript_count "$transcript_count" \
      --argjson evidence_count "$evidence_count" --arg evidence_fp "$evidence_fp" \
      --argjson transcript_paths "$transcript_paths" --argjson metadata_paths "$metadata_paths" \
      '{
        task: $task, skill: $skill, fixture: $fixture, plugin_source: $plugin_source,
        cli_version: $cli_version,
        fingerprints: { fixture: $fp_fixture, plugin_build: $fp_plugin, cli_version: $cli_version,
                        session_evidence: $evidence_fp },
        guards: { anthropic_api_key_unset: $api_key_unset, oauth_token_present: $token_present,
                  allow_api_key: $allow_api_key, on_quota: $on_quota },
        run: { exit_code: $exit_code, transcript: "transcript.jsonl",
               transcript_parseable: $parseable, workspace_snapshot: "workspace-snapshot" },
        session_evidence: {
          status: $evidence_status, session_id: $session_id,
          bundle: $evidence_bundle, main_transcript: $evidence_main,
          subagent_transcripts: $transcript_paths, subagent_metadata: $metadata_paths,
          counts: { main_transcripts: $main_count, subagent_transcripts: $subagent_count,
                    subagent_metadata: $metadata_count, transcripts: $transcript_count,
                    evidence_files: $evidence_count },
          fingerprint: $evidence_fp
        },
        verdict: $verdict, reason: $reason
      }' > "$out/run.json"
  else
    {
      printf '{\n'
      printf '  "task": "%s", "skill": "%s", "fixture": "%s", "plugin_source": "%s",\n' "$task" "$skill" "$fixture" "$plugin_source"
      printf '  "cli_version": "%s",\n' "$cli_version"
      printf '  "fingerprints": { "fixture": "%s", "plugin_build": "%s", "cli_version": "%s", "session_evidence": "%s" },\n' "$fp_fixture" "$fp_plugin" "$cli_version" "$evidence_fp"
      printf '  "guards": { "anthropic_api_key_unset": %s, "oauth_token_present": %s, "allow_api_key": %s, "on_quota": "%s" },\n' \
        "$api_key_unset" "$token_present" "$([ "$allow_api_key" = 1 ] && echo true || echo false)" "$on_quota"
      printf '  "run": { "exit_code": %s, "transcript": "transcript.jsonl", "transcript_parseable": %s, "workspace_snapshot": "workspace-snapshot" },\n' "$exit_code" "$parseable"
      printf '  "session_evidence": { "status": "%s", "session_id": "%s", "bundle": "%s", "main_transcript": "%s", "subagent_transcripts": %s, "subagent_metadata": %s, "counts": { "main_transcripts": %s, "subagent_transcripts": %s, "subagent_metadata": %s, "transcripts": %s, "evidence_files": %s }, "fingerprint": "%s" },\n' \
        "$evidence_status" "$session_id" "$evidence_bundle" "$evidence_main" "$transcript_paths" "$metadata_paths" "$main_count" "$subagent_count" "$metadata_count" "$transcript_count" "$evidence_count" "$evidence_fp"
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

  # Keep every disposable runner path under one root. The RETURN trap covers normal,
  # quota, parseability, evidence, and setup failures after allocation.
  local state_root; state_root="$(mktemp -d)"
  trap 'cleanup_run_state "$state_root"; trap - RETURN' RETURN

  # --- clean install into an ISOLATED config dir (no dev-machine ~/.claude) ---
  local cfg="$state_root/config"; mkdir -p "$cfg"; export CLAUDE_CONFIG_DIR="$cfg"
  local -a pack_names=() install_specs=()
  local pack_output
  if ! pack_output="$(fixture_pack_names "$fixtures_dir/$fixture")"; then return 2; fi
  mapfile -t pack_names <<< "$pack_output"
  [ "${#pack_names[@]}" -ge 2 ] || { echo "run-skill.sh: fixture plugin declaration could not be resolved" >&2; return 2; }
  local pack
  for pack in "${pack_names[@]}"; do install_specs+=("$pack@${marketplace_name}"); done
  echo "run-skill.sh: clean install from '$src' into isolated CLAUDE_CONFIG_DIR=$cfg" >&2
  claude plugin marketplace add "$src" >&2 || return 7
  claude plugin install "${install_specs[@]}" >&2 || return 7

  # Resolve roots needed while materializing the fixture. The default wf + wf-fake
  # behavior remains unchanged; fixtures declaring wf-audit receive its clean root.
  local wf_fake_manifest wf_fake_root wf_audit_manifest="" wf_audit_root=""
  wf_fake_manifest="$(find "$cfg" -type f -path '*/wf-fake/*/capabilities/fake/manifest.md' 2>/dev/null | head -n1)"
  [ -n "$wf_fake_manifest" ] || { echo "run-skill.sh: clean install produced no wf-fake capabilities/fake/manifest.md under $cfg" >&2; return 7; }
  wf_fake_root="${wf_fake_manifest%/capabilities/fake/manifest.md}"
  for pack in "${pack_names[@]}"; do
    if [ "$pack" = "wf-audit" ]; then
      wf_audit_manifest="$(find "$cfg" -type f -path '*/wf-audit/*/capabilities/audit/manifest.md' 2>/dev/null | head -n1)"
      [ -n "$wf_audit_manifest" ] || { echo "run-skill.sh: declared wf-audit pack was not found after clean install" >&2; return 7; }
      wf_audit_root="${wf_audit_manifest%/capabilities/audit/manifest.md}"
    fi
  done

  # --- materialize the fixture workspace (real _local/ + git history) ---
  local ws="$state_root/workspace"; mkdir -p "$ws"
  WF_AUDIT_ROOT="$wf_audit_root" bash "$fixtures_dir/$fixture/seed.sh" "$ws" "$wf_fake_root" "$wf_audit_root" >&2 || return 7

  # --- fingerprint every input (authored fixture tree, plugin build, CLI) ---
  local fp_fixture fp_plugin cli_version fixture_fp_root="$fixtures_dir/$fixture/project"
  [ -d "$fixture_fp_root" ] || fixture_fp_root="$fixtures_dir/$fixture"
  fp_fixture="$(fingerprint_tree "$fixture_fp_root")"
  fp_plugin="$(fingerprint_tree "$src")"
  cli_version="$(fingerprint_cli)"
  echo "run-skill.sh: fingerprints — fixture=$fp_fixture plugin=$fp_plugin cli='$cli_version'" >&2

  # --- run ONE real headless skill invocation, stream-json, pre-approved permissions ---
  # When --model was supplied (e.g. the tier-resolved cheap SMOKE model) it is applied here; when
  # omitted, model_args expands to nothing and the invocation is byte-identical to the pre-flag form.
  local transcript="$out/transcript.jsonl" stderr_log="$out/stderr.log"
  local -a model_args=()
  [ -n "$model" ] && model_args=(--model "$model")
  local session_id; session_id="$(new_session_id)"
  local rc=0
  (
    cd "$ws" && \
    claude -p "$skill" --output-format stream-json --dangerously-skip-permissions \
      --session-id "$session_id" "${model_args[@]}"
  ) > "$transcript" 2> "$stderr_log" || rc=$?

  # Capture the complete persisted session before quota inspection, stream parsing,
  # workspace snapshots, any early return, or removal of the isolated config tree.
  local evidence_record evidence_bundle="" evidence_main="" evidence_fp=""
  local main_count=0 subagent_count=0 metadata_count=0 evidence_status="complete"
  if ! evidence_record="$(capture_session_evidence "$cfg" "$session_id" "$out")"; then
    evidence_status="failed"
    local evidence_reason="persisted session evidence was missing, duplicate, or had orphaned nested files."
    write_run_json "$out" "$skill" "$skill" "$fixture" "$plugin_source" \
      "$fp_fixture" "$fp_plugin" "$cli_version" "$allow_api_key" "$on_quota" \
      "$rc" false "session-evidence-error" "$evidence_reason" \
      "$session_id" "" "" 0 0 0 "" "$evidence_status"
    echo "FATAL [session-evidence]: $evidence_reason" >&2
    return 10
  fi
  IFS=$'\t' read -r evidence_bundle evidence_main main_count subagent_count metadata_count evidence_fp <<< "$evidence_record"

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
      "$session_id" "$evidence_bundle" "$evidence_main" "$main_count" \
      "$subagent_count" "$metadata_count" "$evidence_fp" "$evidence_status"
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
      "$session_id" "$evidence_bundle" "$evidence_main" "$main_count" \
      "$subagent_count" "$metadata_count" "$evidence_fp" "$evidence_status"
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
    "$session_id" "$evidence_bundle" "$evidence_main" "$main_count" \
    "$subagent_count" "$metadata_count" "$evidence_fp" "$evidence_status"

  echo "run-skill.sh: done — verdict=$verdict, run output in $out" >&2
  [ "$verdict" = "ok" ] && return 0 || return 9
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  main "$@"
fi
