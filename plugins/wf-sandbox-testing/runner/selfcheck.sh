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
# 6. Session block — real session id + isolated projects/transcript root (WF-401 outcome 5)
# ---------------------------------------------------------------------------
check_session_block() {
  local before=$fail
  local work; work="$(mktemp -d)"

  # A transcript stamped with a session id → extract_session_id recovers it verbatim.
  printf '{"type":"system","session_id":"sess-abc-123"}\n{"type":"assistant","session_id":"sess-abc-123"}\n' \
    > "$work/with-session.jsonl"
  local sid; sid="$(extract_session_id "$work/with-session.jsonl")"
  if [ "$sid" = "sess-abc-123" ]; then ok "session: extract_session_id recovers the stamped session id"
  else err "session: extract_session_id returned '$sid' (expected sess-abc-123)"; fi

  # A transcript with no session id → empty (drives resolved:false), never a spurious value.
  printf '{"type":"assistant","message":{"id":"m1"}}\n' > "$work/no-session.jsonl"
  local none; none="$(extract_session_id "$work/no-session.jsonl")"
  if [ -z "$none" ]; then ok "session: a transcript with no session id yields empty"
  else err "session: extract_session_id fabricated '$none' from a session-less transcript"; fi

  # discover_transcript_bundle finds the isolated bundle; absent tree → empty (no crash).
  mkdir -p "$work/projects/slug"
  printf '{}\n' > "$work/projects/slug/sess-abc-123.jsonl"
  local bundle; bundle="$(discover_transcript_bundle "$work/projects")"
  if [ "$bundle" = "$work/projects/slug/sess-abc-123.jsonl" ]; then ok "session: discover_transcript_bundle resolves the isolated bundle path"
  else err "session: discover_transcript_bundle returned '$bundle'"; fi
  local absent; absent="$(discover_transcript_bundle "$work/nope")"
  if [ -z "$absent" ]; then ok "session: an absent projects tree yields empty (no crash)"
  else err "session: discover_transcript_bundle invented '$absent' for an absent tree"; fi

  # write_run_json emits a machine-readable session block carrying id + isolated root + resolved.
  local out="$work/out"; mkdir -p "$out"
  ( unset ANTHROPIC_API_KEY; CLAUDE_CODE_OAUTH_TOKEN="tok"; \
    write_run_json "$out" "/wf:branch FAKE-1" "/wf:branch FAKE-1" "demo-fake" "current" \
      "sha256:fixfp" "sha256:plugfp" "cli-1.2.3" 0 "fail" 0 true "ok" "" \
      "sess-abc-123" "$work/projects" "$bundle" 1 )
  if grep -q '"session_id": "sess-abc-123"' "$out/run.json" \
     && grep -q '"projects_root": "'"$work"'/projects"' "$out/run.json" \
     && grep -q '"resolved": true' "$out/run.json"; then
    ok "session: run.json carries session_id + projects_root + resolved:true"
  else
    err "session: run.json session block missing or malformed"
    cat "$out/run.json" >&2
  fi

  rm -rf "$work"
  [ "$fail" = "$before" ] && ok "session: real session id + isolated projects/transcript root recorded"
}

echo "== wf-sandbox-testing runner self-checks (daemon-independent) =="
check_guards_functionlevel
check_guards_execlevel
check_fingerprint_determinism
check_parseability
check_session_block

if [ "$fail" -ne 0 ]; then
  echo "wf-sandbox-testing self-checks: FAIL" >&2
  exit 1
fi
echo "wf-sandbox-testing self-checks: PASS"
