#!/usr/bin/env bash
# selfcheck.sh — daemon-independent verification of the hermetic runner.
#
# Docker may be absent in a verify environment, so this exercises everything provable
# WITHOUT a daemon: the auth/billing guards (function-level AND exec-level, proving no
# `claude` process starts before a guard fails), fingerprint determinism, and transcript
# parseability. Mirrors the wf-fake fixtures/run.sh style: set -uo pipefail, ok/err, a
# non-zero exit on any failure.
#
# Usage: bash plugins/wf-sandbox-testing/runner/selfcheck.sh
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTDATA="$SCRIPT_DIR/testdata"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

# Source the runner libraries (each defines functions; none runs its main when sourced).
# shellcheck source=entrypoint.sh
. "$SCRIPT_DIR/entrypoint.sh"
# shellcheck source=fingerprint.sh
. "$SCRIPT_DIR/fingerprint.sh"
# shellcheck source=run-skill.sh
. "$SCRIPT_DIR/run-skill.sh"

# ---------------------------------------------------------------------------
# 1 & 2. Auth/billing guards — function level
# ---------------------------------------------------------------------------
check_guards_functionlevel() {
  local before=$fail

  # ANTHROPIC_API_KEY set, no opt-in → reject.
  ( ANTHROPIC_API_KEY="sk-should-be-rejected" CLAUDE_CODE_OAUTH_TOKEN="tok"; guard_api_key 0 ) 2>/dev/null \
    && err "guard_api_key: accepted ANTHROPIC_API_KEY without --allow-api-key" \
    || ok "guard_api_key: rejects ANTHROPIC_API_KEY set without the opt-in"

  # ANTHROPIC_API_KEY set WITH the explicit opt-in → allowed.
  ( ANTHROPIC_API_KEY="sk-opted-in"; guard_api_key 1 ) 2>/dev/null \
    && ok "guard_api_key: honors the explicit --allow-api-key opt-in" \
    || err "guard_api_key: rejected even with --allow-api-key"

  # CLAUDE_CODE_OAUTH_TOKEN absent, no opt-in → reject.
  ( unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY; guard_oauth_token 0 ) 2>/dev/null \
    && err "guard_oauth_token: accepted a missing OAuth token" \
    || ok "guard_oauth_token: rejects an absent CLAUDE_CODE_OAUTH_TOKEN"

  # Token present → allowed.
  ( CLAUDE_CODE_OAUTH_TOKEN="tok"; unset ANTHROPIC_API_KEY; guard_oauth_token 0 ) 2>/dev/null \
    && ok "guard_oauth_token: accepts a present OAuth token" \
    || err "guard_oauth_token: rejected a present OAuth token"

  # --allow-api-key but no API key → reject (empty opt-in).
  ( unset ANTHROPIC_API_KEY CLAUDE_CODE_OAUTH_TOKEN; guard_oauth_token 1 ) 2>/dev/null \
    && err "guard_oauth_token: accepted --allow-api-key with no API key present" \
    || ok "guard_oauth_token: rejects --allow-api-key when ANTHROPIC_API_KEY is absent"

  [ "$fail" = "$before" ] && ok "guards (function level): all five checks passed"
}

# ---------------------------------------------------------------------------
# 3. Auth/billing guards — exec level (prove NO claude process starts on a guard failure)
# ---------------------------------------------------------------------------
check_guards_execlevel() {
  local before=$fail
  local shimdir sentinel rc
  shimdir="$(mktemp -d)"
  sentinel="$shimdir/claude-ran"
  # A fake `claude` that records it was invoked. If a guard leaks past, this fires.
  printf '#!/usr/bin/env bash\ntouch "%s"\nexit 0\n' "$sentinel" > "$shimdir/claude"
  chmod +x "$shimdir/claude"

  # a) ANTHROPIC_API_KEY set → non-zero exit, and the fake claude never ran.
  rm -f "$sentinel"
  env -i PATH="$shimdir:/usr/bin:/bin" WF_NO_EGRESS=0 \
      ANTHROPIC_API_KEY="sk-leaked" CLAUDE_CODE_OAUTH_TOKEN="tok" \
      bash "$SCRIPT_DIR/entrypoint.sh" --skill "/wf:branch FAKE-1" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then err "entrypoint(exec): exited 0 with ANTHROPIC_API_KEY set"
  elif [ -f "$sentinel" ]; then err "entrypoint(exec): a claude process started before the api-key guard failed"
  else ok "entrypoint(exec): ANTHROPIC_API_KEY set → non-zero exit ($rc), no claude ran"; fi

  # b) OAuth token absent → non-zero exit, and the fake claude never ran.
  rm -f "$sentinel"
  env -i PATH="$shimdir:/usr/bin:/bin" WF_NO_EGRESS=0 \
      bash "$SCRIPT_DIR/entrypoint.sh" --skill "/wf:branch FAKE-1" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then err "entrypoint(exec): exited 0 with no OAuth token"
  elif [ -f "$sentinel" ]; then err "entrypoint(exec): a claude process started before the token guard failed"
  else ok "entrypoint(exec): token absent → non-zero exit ($rc), no claude ran"; fi

  rm -rf "$shimdir"
  [ "$fail" = "$before" ] && ok "guards (exec level): misconfiguration is caught before any skill run"
}

# ---------------------------------------------------------------------------
# 4. Fingerprint determinism
# ---------------------------------------------------------------------------
check_fingerprint_determinism() {
  local before=$fail
  local tree; tree="$(mktemp -d)"
  mkdir -p "$tree/a/b"
  printf 'alpha\n' > "$tree/a/one.txt"
  printf 'beta\n'  > "$tree/a/b/two.txt"

  local h1 h2
  h1="$(fingerprint_tree "$tree")"
  # touch mtimes without changing content — determinism must ignore this.
  touch "$tree/a/one.txt" "$tree/a/b/two.txt"
  h2="$(fingerprint_tree "$tree")"

  if [ -z "$h1" ]; then err "fingerprint_tree: produced empty output"
  elif [ "$h1" != "$h2" ]; then err "fingerprint_tree: NOT deterministic ($h1 != $h2 after mtime touch)"
  else ok "fingerprint determinism: unchanged content (mtimes touched) → identical fingerprint"; fi

  # A content change must change the fingerprint (it is not a constant).
  printf 'GAMMA\n' > "$tree/a/one.txt"
  local h3; h3="$(fingerprint_tree "$tree")"
  if [ "$h3" = "$h1" ]; then err "fingerprint_tree: content change did not change the fingerprint"
  else ok "fingerprint determinism: a content change changes the fingerprint"; fi

  rm -rf "$tree"
  [ "$fail" = "$before" ] && ok "fingerprint: deterministic over content, sensitive to change"
}

# ---------------------------------------------------------------------------
# 5. Transcript parseability (valid passes, corrupt/empty fail — CLI drift fails loud)
# ---------------------------------------------------------------------------
check_parseability() {
  local before=$fail

  if assert_stream_json "$TESTDATA/sample-transcript.jsonl" 2>/dev/null; then
    ok "parseability: a valid stream-json sample passes"
  else
    err "parseability: rejected a valid stream-json sample"
  fi

  if assert_stream_json "$TESTDATA/corrupt-transcript.jsonl" 2>/dev/null; then
    err "parseability: accepted a corrupt (non-JSON-line) transcript"
  else
    ok "parseability: a corrupt transcript fails loudly (CLI-drift guard fires)"
  fi

  local empty; empty="$(mktemp)"
  if assert_stream_json "$empty" 2>/dev/null; then
    err "parseability: accepted an empty transcript"
  else
    ok "parseability: an empty transcript fails"
  fi
  rm -f "$empty"

  [ "$fail" = "$before" ] && ok "parseability: asserts up front, fails loud on drift"
}

# ---------------------------------------------------------------------------
# 6. Fixture-declared pack installation (pure declaration parsing; no installs)
# ---------------------------------------------------------------------------
check_fixture_packs() {
  local before=$fail root defaults declared invalid
  root="$(mktemp -d)"

  defaults="$(fixture_pack_names "$root")" || err "fixture packs: default declaration failed"
  if [ "$defaults" = $'wf\nwf-fake' ]; then
    ok "fixture packs: wf and wf-fake are always installed by default"
  else
    err "fixture packs: unexpected defaults: ${defaults//$'\n'/,}"
  fi

  if command -v jq >/dev/null 2>&1; then
    cat > "$root/project.seed.json" <<'JSON'
{"fixture":{"plugins":["wf","wf-fake","wf-audit","wf-audit"]}}
JSON
    declared="$(fixture_pack_names "$root")" || err "fixture packs: project.seed.json declaration failed"
    if [ "$declared" = $'wf\nwf-fake\nwf-audit' ]; then
      ok "fixture packs: project.seed.json adds wf-audit and deduplicates defaults"
    else
      err "fixture packs: declared install set was not deterministic: ${declared//$'\n'/,}"
    fi

    cat > "$root/project.seed.json" <<'JSON'
{"fixture":{"plugins":["wf","bad/name"]}}
JSON
    if fixture_pack_names "$root" >/dev/null 2>&1; then
      err "fixture packs: accepted an invalid marketplace plugin name"
    else
      ok "fixture packs: invalid fixture declarations fail before installation"
    fi
  else
    ok "fixture packs: jq absent; project.seed.json branch skipped (runner reports this prerequisite)"
  fi

  rm -rf "$root"
  [ "$fail" = "$before" ] && ok "fixture packs: deterministic defaults and fixture additions"
}

# ---------------------------------------------------------------------------
# 7. Complete persisted-session capture (synthetic evidence; no Claude invocation)
# ---------------------------------------------------------------------------
check_session_evidence() {
  local before=$fail root cfg out session record bundle main_path mains agents metas fp
  root="$(mktemp -d)"; cfg="$root/config"; out="$root/run-one"
  session="11111111-2222-4333-8444-555555555555"
  mkdir -p "$cfg/projects/-fixture/$session/subagents" "$out"
  printf '{"type":"main"}\n' > "$cfg/projects/-fixture/$session.jsonl"
  printf '{"type":"agent","id":1}\n' > "$cfg/projects/-fixture/$session/subagents/agent-a.jsonl"
  printf '{"agentId":"a"}\n' > "$cfg/projects/-fixture/$session/subagents/agent-a.meta.json"
  printf '{"type":"agent","id":2}\n' > "$cfg/projects/-fixture/$session/subagents/agent-b.jsonl"
  printf '{"agentId":"b"}\n' > "$cfg/projects/-fixture/$session/subagents/agent-b.meta.json"

  if record="$(capture_session_evidence "$cfg" "$session" "$out" 2>/dev/null)"; then
    IFS=$'\t' read -r bundle main_path mains agents metas fp <<< "$record"
  else
    err "session evidence: rejected one main transcript plus two valid nested pairs"
    cleanup_run_state "$root"
    return
  fi

  [ "$bundle" = "session-evidence" ] && [ "$main_path" = "session-evidence/$session.jsonl" ] \
    || err "session evidence: bundle-relative main paths are incorrect"
  [ "$mains" = 1 ] && [ "$agents" = 2 ] && [ "$metas" = 2 ] \
    && ok "session evidence: reports one main transcript and two nested transcript/meta pairs" \
    || err "session evidence: incorrect counts main=$mains agents=$agents metadata=$metas"
  [ -f "$out/$main_path" ] \
    && [ -f "$out/$bundle/subagents/agent-a.jsonl" ] \
    && [ -f "$out/$bundle/subagents/agent-a.meta.json" ] \
    && [ -f "$out/$bundle/subagents/agent-b.jsonl" ] \
    && [ -f "$out/$bundle/subagents/agent-b.meta.json" ] \
    && ok "session evidence: copied the complete bundle into the run output" \
    || err "session evidence: one or more copied evidence files are missing"

  local computed; computed="$(fingerprint_tree "$out/$bundle")"
  [ "$fp" = "$computed" ] && ok "session evidence: bundle fingerprint matches copied content" \
    || err "session evidence: reported fingerprint does not match copied bundle"

  # Source cleanup must not remove durable evidence.
  rm -rf "$cfg"
  [ -f "$out/$main_path" ] && [ -f "$out/$bundle/subagents/agent-b.meta.json" ] \
    && ok "session evidence: durable bundle survives isolated config cleanup" \
    || err "session evidence: bundle depended on temporary source state"

  # run.json must expose identity, all relative paths, counts, and the same fingerprint.
  write_run_json "$out" "WF-373" "/wf:fleet FLEET-100" "fleet-standard" "current" \
    fixture-fp plugin-fp cli-version 0 fail 0 true ok "" \
    "$session" "$bundle" "$main_path" "$mains" "$agents" "$metas" "$fp" complete
  if command -v jq >/dev/null 2>&1; then
    if jq -e --arg sid "$session" --arg fp "$fp" '
      .session_evidence.status == "complete" and
      .session_evidence.session_id == $sid and
      .session_evidence.bundle == "session-evidence" and
      .session_evidence.main_transcript == ("session-evidence/" + $sid + ".jsonl") and
      (.session_evidence.subagent_transcripts | length) == 2 and
      (.session_evidence.subagent_metadata | length) == 2 and
      .session_evidence.counts.main_transcripts == 1 and
      .session_evidence.counts.subagent_transcripts == 2 and
      .session_evidence.counts.subagent_metadata == 2 and
      .session_evidence.counts.transcripts == 3 and
      .session_evidence.counts.evidence_files == 5 and
      .session_evidence.fingerprint == $fp and
      .fingerprints.session_evidence == $fp
    ' "$out/run.json" >/dev/null; then
      ok "run.json: records session id, relative paths, counts, and evidence fingerprint"
    else
      err "run.json: complete session evidence metadata is missing or inconsistent"
    fi
  fi

  # A second output is isolated from the first and cannot overwrite its evidence.
  local cfg2="$root/config-two" out2="$root/run-two" session2="aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
  mkdir -p "$cfg2/projects/-fixture/$session2/subagents" "$out2"
  printf '{"type":"second-main"}\n' > "$cfg2/projects/-fixture/$session2.jsonl"
  record="$(capture_session_evidence "$cfg2" "$session2" "$out2" 2>/dev/null)" || err "session evidence: second isolated capture failed"
  [ -f "$out/$bundle/$session.jsonl" ] && [ -f "$out2/session-evidence/$session2.jsonl" ] \
    && [ ! -e "$out/session-evidence/$session2.jsonl" ] \
    && ok "session evidence: unique run outputs remain isolated" \
    || err "session evidence: one run output contaminated another"

  # Orphans and duplicate main transcripts fail before publishing a partial bundle.
  local bad="$root/bad" badout="$root/bad-out"
  mkdir -p "$bad/projects/a/$session/subagents" "$badout"
  printf '{}\n' > "$bad/projects/a/$session.jsonl"
  printf '{}\n' > "$bad/projects/a/$session/subagents/agent-orphan.jsonl"
  if capture_session_evidence "$bad" "$session" "$badout" >/dev/null 2>&1; then
    err "session evidence: accepted an orphaned nested transcript"
  elif [ -e "$badout/session-evidence" ]; then
    err "session evidence: published a partial bundle after orphan rejection"
  else
    ok "session evidence: orphaned nested evidence fails loudly without partial publication"
  fi
  rm -rf "$bad" "$badout"; mkdir -p "$bad/projects/a" "$bad/projects/b" "$badout"
  printf '{}\n' > "$bad/projects/a/$session.jsonl"
  printf '{}\n' > "$bad/projects/b/$session.jsonl"
  if capture_session_evidence "$bad" "$session" "$badout" >/dev/null 2>&1; then
    err "session evidence: accepted duplicate main transcripts"
  else
    ok "session evidence: duplicate main transcripts fail loudly"
  fi

  # The same cleanup primitive used by every main() return removes config and workspace.
  local disposable="$root/disposable"
  mkdir -p "$disposable/config" "$disposable/workspace"
  cleanup_run_state "$disposable"
  [ ! -e "$disposable" ] && ok "cleanup: isolated configuration and workspace state are removed" \
    || err "cleanup: temporary state root survived cleanup"

  cleanup_run_state "$root"
  [ "$fail" = "$before" ] && ok "session evidence: complete boundary and failure cases pass"
}

# ---------------------------------------------------------------------------
# 8. Whole-run ordering/cleanup with a fake CLI (never starts a model)
# ---------------------------------------------------------------------------
check_main_capture_integration() {
  local before=$fail root shim out src log rc cfg_path sid
  root="$(mktemp -d)"; shim="$root/shim"; out="$root/output"; src="$root/marketplace"; log="$root/claude.log"
  mkdir -p "$shim" "$src"
  cat > "$shim/claude" <<'SHIM'
#!/usr/bin/env bash
set -u
printf 'CFG=%s ARGS=%s\n' "${CLAUDE_CONFIG_DIR:-}" "$*" >> "${SHIM_LOG:?}"
if [ "${1:-}" = "--version" ]; then
  printf 'claude-fake 1.0\n'
  exit 0
fi
if [ "${1:-}" = "plugin" ]; then
  if [ "${2:-}" = "install" ]; then
    mkdir -p "$CLAUDE_CONFIG_DIR/cache/wf-marketplace/wf-fake/1/capabilities/fake"
    printf '# fake manifest\n' > "$CLAUDE_CONFIG_DIR/cache/wf-marketplace/wf-fake/1/capabilities/fake/manifest.md"
  fi
  exit 0
fi
sid=""
while [ $# -gt 0 ]; do
  if [ "$1" = "--session-id" ]; then sid="${2:?}"; shift 2; else shift; fi
done
[ -n "$sid" ] || { printf 'missing --session-id\n' >&2; exit 41; }
base="$CLAUDE_CONFIG_DIR/projects/-synthetic"
mkdir -p "$base/$sid/subagents"
printf '{"type":"main","session":"%s"}\n' "$sid" > "$base/$sid.jsonl"
printf '{"type":"agent"}\n' > "$base/$sid/subagents/agent-one.jsonl"
printf '{"agentId":"one"}\n' > "$base/$sid/subagents/agent-one.meta.json"
printf '{"type":"result","result":"synthetic"}\n'
SHIM
  chmod +x "$shim/claude"

  PATH="$shim:$PATH" SHIM_LOG="$log" WF_MARKETPLACE_DIR="$src" \
    main --fixture demo-fake --out "$out" --skill "/wf:branch FAKE-1" >/dev/null 2>&1
  rc=$?
  if [ "$rc" -eq 0 ]; then
    ok "whole-run synthetic CLI: completed without starting a model"
  else
    err "whole-run synthetic CLI: runner failed with exit $rc"
  fi

  if [ -f "$out/transcript.jsonl" ] && [ -f "$out/run.json" ]; then
    ok "whole-run synthetic CLI: retains streamed transcript and run record"
  else
    err "whole-run synthetic CLI: lost transcript.jsonl or run.json"
  fi
  if command -v jq >/dev/null 2>&1; then
    sid="$(jq -r '.session_evidence.session_id' "$out/run.json" 2>/dev/null)"
    if [ -n "$sid" ] && [ "$sid" != null ] \
      && [ -f "$out/session-evidence/$sid.jsonl" ] \
      && [ -f "$out/session-evidence/subagents/agent-one.jsonl" ] \
      && [ -f "$out/session-evidence/subagents/agent-one.meta.json" ] \
      && jq -e '.session_evidence.status == "complete" and .session_evidence.counts.evidence_files == 3' "$out/run.json" >/dev/null; then
      ok "whole-run synthetic CLI: captures persisted evidence before runner teardown"
    else
      err "whole-run synthetic CLI: complete evidence bundle was not recorded"
    fi
  fi
  if grep -Eq -- '--session-id [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$log"; then
    ok "whole-run synthetic CLI: invokes Claude with an explicit UUID session id"
  else
    err "whole-run synthetic CLI: invocation omitted a valid explicit session id"
  fi

  cfg_path="$(grep ' ARGS=-p ' "$log" | tail -n1 | sed -E 's/^CFG=([^ ]+) .*/\1/')"
  if [ -n "$cfg_path" ] && [ ! -e "$cfg_path" ]; then
    ok "whole-run synthetic CLI: temporary config and workspace root are cleaned after capture"
  else
    err "whole-run synthetic CLI: isolated state survived at '$cfg_path'"
  fi

  rm -rf "$root"
  [ "$fail" = "$before" ] && ok "whole-run synthetic CLI: evidence ordering and cleanup pass offline"
}

echo "== wf-sandbox-testing runner self-checks (daemon-independent) =="
check_guards_functionlevel
check_guards_execlevel
check_fingerprint_determinism
check_parseability
check_fixture_packs
check_session_evidence
check_main_capture_integration

if [ "$fail" -ne 0 ]; then
  echo "wf-sandbox-testing self-checks: FAIL" >&2
  exit 1
fi
echo "wf-sandbox-testing self-checks: PASS"
