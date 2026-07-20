#!/usr/bin/env bash
# Offline proof of strict validation, max-field dedup, reconciliation and diffing.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNT="$SCRIPT_DIR/account-session.sh"
DIFF="$SCRIPT_DIR/diff-baseline.sh"
# shellcheck source=../runner/fingerprint.sh
source "$SCRIPT_DIR/../runner/fingerprint.sh"
fail() { printf 'accounting selfcheck: FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'accounting selfcheck: PASS: %s\n' "$1"; }
for command in jq sha256sum; do command -v "$command" >/dev/null || fail "missing command: $command"; done

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
make_bundle() {
  local root="$1" sid="$2"
  local sub="$root/$sid/subagents"
  mkdir -p "$sub"
  cat >"$root/$sid.jsonl" <<'JSONL'
{"type":"assistant","message":{"id":"m-main","model":"claude-opus-4-8","usage":{"input_tokens":1,"cache_creation_input_tokens":10,"cache_read_input_tokens":20,"output_tokens":1},"content":[{"type":"tool_use","id":"tool-main","name":"Read"}]}}
{"type":"assistant","message":{"id":"m-main","model":"claude-opus-4-8","usage":{"input_tokens":2,"cache_creation_input_tokens":5,"cache_read_input_tokens":25,"output_tokens":3},"content":[{"type":"tool_use","id":"tool-main","name":"Read"}]}}
JSONL
  cat >"$sub/agent-a1.meta.json" <<'JSON'
{"agentType":"wf:phase-runner","description":"Run tasks phase for T1","toolUseId":"spawn-1","spawnDepth":1,"model":"opus"}
JSON
  cat >"$sub/agent-a1.jsonl" <<'JSONL'
{"type":"assistant","message":{"id":"m-agent","model":"claude-opus-4-8","usage":{"input_tokens":1,"cache_creation_input_tokens":100,"cache_read_input_tokens":20,"output_tokens":5},"content":[{"type":"tool_use","id":"tool-agent","name":"Bash"}]}}
{"type":"assistant","message":{"id":"m-agent","model":"claude-opus-4-8","usage":{"input_tokens":3,"cache_creation_input_tokens":50,"cache_read_input_tokens":200,"output_tokens":2},"content":[{"type":"tool_use","id":"tool-agent","name":"Bash"}]}}
{"type":"assistant","message":{"id":"m-agent-2","model":"claude-opus-4-8","usage":{"input_tokens":4,"cache_creation_input_tokens":5,"cache_read_input_tokens":6,"output_tokens":7},"content":[{"type":"tool_use","id":"tool-agent-2","name":"Read"}]}}
JSONL
}

root="$tmp/good"; sid="session-1"; make_bundle "$root" "$sid"
report="$tmp/report.json"
"$ACCOUNT" --source-root "$root" --session-id "$sid" --output "$report"
jq -e '
  .schema=="wf-session-accounting/v1" and .totals.agent_count==2 and .totals.message_count==3 and
  .totals.usage=={input_tokens:9,cache_creation_input_tokens:115,cache_read_input_tokens:231,output_tokens:15} and
  (.tool_inventory|length)==3 and ([.tool_inventory[].id]|unique|length)==3 and
  (.by_agent[]|select(.agent_id=="a1").usage)=={input_tokens:7,cache_creation_input_tokens:105,cache_read_input_tokens:206,output_tokens:12} and
  (.by_agent[]|select(.agent_id=="a1").context)=={first:303,last:15,peak:303,growth:-288} and
  ([.by_phase[].phase]|index("tasks"))!=null and
  .reconciliation.status=="reconciled" and .reconciliation.phase_usage_matches and .reconciliation.role_usage_matches
' "$report" >/dev/null || fail "max-field dedup, tool dedup, context, or reconciliation"
pass "deduplication, attribution, context and reconciliation"

expect_failure() {
  local label="$1" root="$2" sid="$3" needle="$4"
  local out="$tmp/failure-$label.json" stdout="$tmp/failure-$label.stdout" stderr="$tmp/failure-$label.stderr"
  rm -f "$out"
  if "$ACCOUNT" --source-root "$root" --session-id "$sid" --output "$out" >"$stdout" 2>"$stderr"; then fail "$label unexpectedly succeeded"; fi
  [ ! -e "$out" ] || fail "$label emitted a report"
  [ ! -s "$stdout" ] || fail "$label emitted accounting tables"
  grep -F "$needle" "$stderr" >/dev/null || fail "$label did not identify '$needle'"
  pass "$label rejected before output"
}

cp -a "$root" "$tmp/missing-main"; rm "$tmp/missing-main/$sid.jsonl"
expect_failure missing-main "$tmp/missing-main" "$sid" "$tmp/missing-main/$sid.jsonl"
cp -a "$root" "$tmp/missing-meta"; rm "$tmp/missing-meta/$sid/subagents/agent-a1.meta.json"
expect_failure missing-meta "$tmp/missing-meta" "$sid" "agent-a1.meta.json"
cp -a "$root" "$tmp/orphan-meta"; mv "$tmp/orphan-meta/$sid/subagents/agent-a1.jsonl" "$tmp/orphan-meta/$sid/subagents/not-an-agent.txt"
expect_failure orphan-meta "$tmp/orphan-meta" "$sid" "agent-a1.meta.json"
cp -a "$root" "$tmp/corrupt"; printf '{not json}\n' >>"$tmp/corrupt/$sid/subagents/agent-a1.jsonl"
expect_failure corrupt "$tmp/corrupt" "$sid" "agent-a1.jsonl"
cp -a "$root" "$tmp/unmapped"; jq '.agentType="general-purpose"|.description="Do an inexplicable thing"' "$tmp/unmapped/$sid/subagents/agent-a1.meta.json" >"$tmp/meta"; mv "$tmp/meta" "$tmp/unmapped/$sid/subagents/agent-a1.meta.json"
expect_failure unmapped "$tmp/unmapped" "$sid" "agent-a1.meta.json"
cp -a "$root" "$tmp/unknown"; sed -i 's/claude-opus-4-8/claude-unknown-9/g' "$tmp/unknown/$sid/subagents/agent-a1.jsonl"
expect_failure unknown-model "$tmp/unknown" "$sid" "agent-a1.jsonl"

copy="$tmp/copied"; make_bundle "$copy" copied-session
fp1="$(fingerprint_session_bundle "$root" "$sid")"; fp2="$(fingerprint_session_bundle "$copy" copied-session)"
[ "$fp1" = "$fp2" ] || fail "fingerprint changed after byte-identical copy"
printf ' ' >>"$copy/copied-session/subagents/agent-a1.meta.json"
fp3="$(fingerprint_session_bundle "$copy" copied-session)"
[ "$fp1" != "$fp3" ] || fail "fingerprint ignored changed content"
pass "exact-bundle fingerprint determinism and sensitivity"

chmod +x "$DIFF"
"$DIFF" --baseline "$report" --current "$report" --tolerance-percent 1 | jq -e '.status=="tolerance-equal" and .equal' >/dev/null || fail "unchanged baseline was not equal"
for field in derivation fingerprint pricing figure; do
  changed="$tmp/changed-$field.json"
  case "$field" in
    derivation) jq '.derivation="changed"' "$report" >"$changed" ;;
    fingerprint) jq '.provenance.input_fingerprint_sha256="changed"' "$report" >"$changed" ;;
    pricing) jq '.pricing.models["claude-opus-4-8"].input_tokens=99' "$report" >"$changed" ;;
    figure) jq '.totals.cost_usd *= 2' "$report" >"$changed" ;;
  esac
  set +e; "$DIFF" --baseline "$report" --current "$changed" --tolerance-percent 1 >"$tmp/diff-$field"; status=$?; set -e
  [ "$status" -eq 1 ] || fail "$field change did not return non-equal"
  jq -e '.status=="non-equal" and (.equal|not)' "$tmp/diff-$field" >/dev/null || fail "$field change lacked non-equal result"
done
pass "baseline equality and derivation/rate/fingerprint/figure differences"

printf 'accounting selfcheck: all checks passed\n'
