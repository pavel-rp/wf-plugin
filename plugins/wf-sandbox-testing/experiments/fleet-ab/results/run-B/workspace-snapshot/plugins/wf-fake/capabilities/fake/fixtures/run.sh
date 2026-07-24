#!/usr/bin/env bash
# wf-fake deterministic self-checks.
#
# Auto-discovered by CI via the convention `plugins/*/capabilities/*/fixtures/run.sh`
# (.github/workflows/ci.yml, "Each capability's fixture suite" step). Capability-agnostic:
# CI never names wf-fake — it runs whatever fixtures run.sh a capability ships.
#
# Checks (all deterministic, no network, no model):
#   1. STATIC NO-EGRESS ASSERTION — no network-reaching tool token and no external
#      tracker/delivery host appears in any fragment, reference, script, or fixture.
#   2. OP-VOCABULARY COMPLETENESS — every contract op in op-vocabulary.txt is listed in
#      its surface fragment AND carries a sample-scripts.json entry (no partial seam).
#   3. LOUD-FAILURE GUARD — each fragment fails loudly on an unscripted op.
#   4. MANIFEST SURFACE SANITY — one delivery provider row and one tracker provider row.
#   5. SAMPLE-SCRIPTS JSON VALIDITY — sample-scripts.json parses (when jq is present).
#
# Usage:  run.sh            run every check (default; used by CI)
#         run.sh --selftest run only the no-egress regex scoping self-test
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="$(dirname "$SCRIPT_DIR")"          # capabilities/fake
FRAG_DIR="$CAP_DIR/fragments"
SCRIPTS="$SCRIPT_DIR/sample-scripts.json"
VOCAB="$SCRIPT_DIR/op-vocabulary.txt"
MANIFEST="$CAP_DIR/manifest.md"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

HAVE_JQ=0
command -v jq >/dev/null 2>&1 && HAVE_JQ=1

# Egress denylist (ERE). Any match in the scanned tree is a violation. Targets real
# network-reaching tool invocations and real external hosts — NOT the descriptive
# no-egress disclaimers in the fragments (which name no raw binary or host).
EGRESS_ERE='(github|gitlab|bitbucket)\.(com|org)|dev\.azure\.com|linear\.app|atlassian\.net|mcp__[A-Za-z0-9_]*(Linear|Gmail|GitHub|Github|Drive|Calendar|Slack)|\b(WebFetch|WebSearch)\b|\b(curl|wget|netcat)\b|\bgh (pr|api|auth|repo|issue|run|checks)\b|\bgit (push|fetch|clone|pull|remote)\b|\b(ssh|nc|telnet|scp|rsync)\b'

# All capability files except this script (which necessarily contains the denylist itself).
scan_files() { find "$CAP_DIR" -type f ! -path "$SCRIPT_DIR/run.sh"; }

url_violations() {  # print any URL whose host is not the synthetic fake.local
  scan_files | xargs grep -EnoH 'https?://[A-Za-z0-9._-]+' 2>/dev/null | grep -Ev '://fake\.local' || true
}

check_no_egress() {
  local hits urlhits
  hits=$(scan_files | xargs grep -EnH "$EGRESS_ERE" 2>/dev/null || true)
  urlhits=$(url_violations)
  if [ -n "$hits" ] || [ -n "$urlhits" ]; then
    err "no-egress: a network token or external host appears in a fragment/script/fixture:"
    [ -n "$hits" ]    && printf '%s\n' "$hits"    >&2
    [ -n "$urlhits" ] && printf '%s\n' "$urlhits" >&2
  else
    ok "no-egress: no network-reaching token or external host in any fragment/script/fixture"
  fi
}

check_completeness() {
  local surface op frag before=$fail
  [ -f "$VOCAB" ] || { err "completeness: op-vocabulary.txt missing"; return; }
  while read -r surface op _rest; do
    case "$surface" in ''|'#'*) continue;; esac
    [ -n "${op:-}" ] || continue
    frag="$FRAG_DIR/$surface.ops.md"
    if [ ! -f "$frag" ]; then err "completeness: fragment $surface.ops.md missing"; continue; fi
    grep -qF -- "$op" "$frag" || err "completeness: op '$op' not listed in $surface.ops.md"
    if [ "$HAVE_JQ" = 1 ]; then
      jq -e --arg s "$surface" --arg o "$op" '.[$s] | has($o)' "$SCRIPTS" >/dev/null 2>&1 \
        || err "completeness: op '$op' has no scripts.$surface.$op entry in sample-scripts.json"
    else
      grep -qF -- "\"$op\"" "$SCRIPTS" \
        || err "completeness: op '$op' not found in sample-scripts.json"
    fi
  done < "$VOCAB"
  [ "$fail" = "$before" ] && ok "completeness: every contract op listed in its fragment and scripted"
}

check_loud_failure() {
  local s before=$fail
  for s in delivery tracker; do
    { grep -qiF "unscripted" "$FRAG_DIR/$s.ops.md" && grep -qF "__UNSCRIPTED__" "$FRAG_DIR/$s.ops.md"; } \
      || err "loud-failure guard missing in $s.ops.md (needs 'unscripted' + '__UNSCRIPTED__')"
  done
  [ "$fail" = "$before" ] && ok "loud-failure: both fragments fail loudly on an unscripted op"
}

check_manifest() {
  local before=$fail
  grep -Eq '\|[[:space:]]*implement[[:space:]]*\|[[:space:]]*provider[[:space:]]*\|[^|]*\|[[:space:]]*delivery[[:space:]]*\|' "$MANIFEST" \
    || err "manifest: no 'implement | provider | ... | delivery' row"
  grep -Eq '\|[[:space:]]*spec[[:space:]]*\|[[:space:]]*provider[[:space:]]*\|[^|]*\|[[:space:]]*tracker[[:space:]]*\|' "$MANIFEST" \
    || err "manifest: no 'spec | provider | ... | tracker' row"
  [ "$fail" = "$before" ] && ok "manifest: sole owner of both delivery and tracker provider surfaces"
}

check_json() {
  if [ "$HAVE_JQ" = 1 ]; then
    jq empty "$SCRIPTS" 2>/dev/null && ok "json: sample-scripts.json parses" \
      || err "json: sample-scripts.json does not parse"
  else
    ok "json: jq absent — skipping JSON parse (grep fallback used for completeness)"
  fi
}

# Prove the no-egress scan actually catches egress and does not false-positive on clean prose.
selftest() {
  local before=$fail b g
  local bad=('run curl https://github.com/x' 'gh pr merge 1' 'git push origin main' \
             'mcp__claude_ai_Linear__get_issue' 'see https://api.evil.example/x' 'ssh host cmd')
  local good=('https://fake.local/pr/1' 'the delivery surface, no version-control command' \
              'FAKE-1' 'reads _local/fake/scripts.json' 'wf-git binds the tracker surface')
  for b in "${bad[@]}"; do
    if printf '%s\n' "$b" | grep -Eq "$EGRESS_ERE" \
       || printf '%s\n' "$b" | grep -Eo 'https?://[A-Za-z0-9._-]+' | grep -qv '://fake\.local'; then :; \
    else err "selftest MISS (egress not caught): $b"; fi
  done
  for g in "${good[@]}"; do
    if printf '%s\n' "$g" | grep -Eq "$EGRESS_ERE"; then err "selftest FALSE POSITIVE: $g"
    elif printf '%s\n' "$g" | grep -Eo 'https?://[A-Za-z0-9._-]+' | grep -qv '://fake\.local'; then
      err "selftest FALSE POSITIVE (url): $g"; fi
  done
  [ "$fail" = "$before" ] && ok "selftest: no-egress scan catches all egress samples, clears all clean samples"
}

if [ "${1:-}" = "--selftest" ]; then
  selftest
else
  echo "== wf-fake capability self-checks =="
  check_no_egress
  check_completeness
  check_loud_failure
  check_manifest
  check_json
  selftest
fi

if [ "$fail" -ne 0 ]; then
  echo "wf-fake self-checks: FAIL" >&2
  exit 1
fi
echo "wf-fake self-checks: PASS"
