#!/usr/bin/env bash
#
# verify-dispatch-cost-guard.sh — caller-gate and contract-inlining regression guard.
#
# Model: gpt-5.6-sol

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
VERIFY="$ROOT/plugins/wf/skills/verify-spec/SKILL.md"
AUDIT_ROOT="$ROOT/plugins/wf-audit"
MANIFEST="$AUDIT_ROOT/capabilities/audit/manifest.md"
fail=0

report_fail() {
  printf 'FAIL: %s\n' "$1"
  fail=1
}

gate_line="$(grep -n 'optional contributor gate \*\*before any routing or' "$VERIFY" | cut -d: -f1)"
task_line="$(grep -n 'otherwise invoke one Task' "$VERIFY" | cut -d: -f1)"

if [ -z "$gate_line" ] || [ -z "$task_line" ] || [ "$gate_line" -ge "$task_line" ]; then
  report_fail "verify-spec must apply the optional contributor gate before Task dispatch"
fi

if ! grep -q 'resolve_profile({ workspaceRoot, capability: <source-capability> })' "$VERIFY"; then
  report_fail "verify-spec must resolve profile values caller-side"
fi

if ! grep -q 'finding contract inline in the dispatch prompt' "$VERIFY"; then
  report_fail "verify-spec must inline the finding contract in enabled dispatch prompts"
fi

agent_count=0
for agent in "$AUDIT_ROOT"/agents/{correctness,security,convention,consistency,operational}-auditor.md; do
  agent_count=$((agent_count + 1))
  if grep -q 'resolve_profile(' "$agent"; then
    report_fail "$(basename "$agent") still resolves its profile after boot"
  fi
  if grep -Eq 'resolve_content.*finding-contract|ref: fragments/finding-contract.md' "$agent"; then
    report_fail "$(basename "$agent") still fetches the finding contract"
  fi
  lens="$(basename "$agent" -auditor.md)"
  upper="$(printf '%s' "$lens" | tr '[:lower:]' '[:upper:]')"
  if ! grep -q "AUDIT-$upper — <clean | findings>" "$agent"; then
    report_fail "$(basename "$agent") lost its final-output shape"
  fi
done

if [ "$agent_count" -ne 5 ]; then
  report_fail "expected exactly five audited lens agents"
fi

manifest_rows="$(grep -Ec '^\| verify \| finding[[:space:]]+\| `subagent: wf-audit:(correctness|security|convention|consistency|operational)-auditor`' "$MANIFEST")"
if [ "$manifest_rows" -ne 5 ]; then
  report_fail "audit manifest must retain all five verify finding dispatch rows"
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

printf 'PASS: caller-side lens gate precedes Task dispatch\n'
printf 'PASS: five lens agents perform zero finding-contract/profile fetches\n'
printf 'PASS: five manifest rows and final-output shapes remain intact\n'
