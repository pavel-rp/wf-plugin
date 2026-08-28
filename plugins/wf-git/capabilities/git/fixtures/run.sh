#!/usr/bin/env bash
# wf-git deterministic self-checks.
#
# Auto-discovered by CI via the convention `plugins/*/capabilities/*/fixtures/run.sh`
# (.github/workflows/ci.yml, "Each capability's fixture suite" step). Capability-agnostic:
# CI never names wf-git — it runs whatever fixtures run.sh a capability ships.
#
# Checks (all deterministic, no network, no model):
#   1. OP-LIST INTEGRITY — every op on the fragment's `**Operations:**` line has its own
#      `## <op>` section in delivery.ops.md (no op announced but unimplemented).
#   2. CONTRACT PARITY — every op the fragment lists is also named in the core capability
#      registry's NORMATIVE runtime half (capability-registry.ops.md §"The delivery provider
#      surface") — no op invented by an owner alone. The reference half
#      (capability-registry.contract.md) is prose about that surface, not the op oracle.
#   3. CROSS-OWNER PARITY — the delivery op set here is identical to the fixture owner's
#      (plugins/wf-fake). Two owners of one partitioned surface must never diverge, or a
#      consumer can be written against a surface only one of them honours.
#   4. TYPED-RESULT DISCIPLINE — each typed read documents its `<read-performed>` flag, and
#      newest-published-version-read documents every `<reason>` token reachable from a
#      registered provider plus the performed return.
#
# Usage:  run.sh    run every check (default; used by CI)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="$(dirname "$SCRIPT_DIR")"                  # capabilities/git
PLUGINS_DIR="$(cd "$CAP_DIR/../../.." && pwd)"      # plugins/
OPS="$CAP_DIR/fragments/delivery.ops.md"
CONTRACT="$PLUGINS_DIR/wf/skills/_contracts/capability-registry.ops.md"
PEER_OPS="$PLUGINS_DIR/wf-fake/capabilities/fake/fragments/delivery.ops.md"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

# The declared op list: the `**Operations:**` line, split on the middot separator.
op_list() {  # $1 = an ops fragment
  grep -m1 '^\*\*Operations:\*\*' "$1" \
    | sed -e 's/^\*\*Operations:\*\* *//' -e 's/\.$//' -e 's/ *· */\n/g' \
    | sed -e 's/^ *//' -e 's/ *$//' \
    | grep -v '^$' \
    | sort
}

check_op_sections() {
  local op before=$fail
  [ -f "$OPS" ] || { err "op-sections: $OPS missing"; return; }
  while read -r op; do
    grep -qE "^## $op( |$)" "$OPS" \
      || err "op-sections: op '$op' is on the Operations line but has no '## $op' section"
  done < <(op_list "$OPS")
  [ "$fail" = "$before" ] && ok "op-sections: every declared op has its own procedure section"
}

check_contract_parity() {
  local op before=$fail
  [ -f "$CONTRACT" ] || { err "contract-parity: $CONTRACT missing"; return; }
  while read -r op; do
    grep -qF -- "\`$op\`" "$CONTRACT" \
      || err "contract-parity: op '$op' is bound here but named nowhere in the core contract"
  done < <(op_list "$OPS")
  [ "$fail" = "$before" ] && ok "contract-parity: every bound op is a contract-named operation"
}

check_cross_owner_parity() {
  local before=$fail diff_out
  if [ ! -f "$PEER_OPS" ]; then
    ok "cross-owner parity: no peer delivery owner vendored — skipped"
    return
  fi
  diff_out=$(diff <(op_list "$OPS") <(op_list "$PEER_OPS") || true)
  if [ -n "$diff_out" ]; then
    err "cross-owner parity: the delivery op sets of the two owners differ (< git, > fake):"
    printf '%s\n' "$diff_out" >&2
  fi
  [ "$fail" = "$before" ] && ok "cross-owner parity: both delivery owners bind an identical op set"
}

# Reads whose result is TYPED with a <read-performed> flag, so a degraded result can never be
# mistaken for a performed read (capability-registry contract, "Degradation shape").
TYPED_READS=(review-threads-read newest-published-version-read)

check_typed_results() {
  local op before=$fail token
  for op in "${TYPED_READS[@]}"; do
    grep -qE "^## $op( |$)" "$OPS" \
      || { err "typed-result: typed read '$op' has no section in delivery.ops.md"; continue; }
  done
  grep -qF -- 'read-performed' "$OPS" \
    || err "typed-result: delivery.ops.md documents no 'read-performed' flag at all"
  # A registered provider can reach exactly these two degraded reasons; no-provider is core's.
  for token in read-failed none-published; do
    grep -qF -- "\`$token\`" "$OPS" \
      || err "typed-result: newest-published-version-read documents no '$token' reason token"
  done
  grep -qF -- 'no-provider' "$OPS" \
    || err "typed-result: delivery.ops.md does not record that 'no-provider' is core's own token"
  [ "$fail" = "$before" ] && ok "typed-result: typed reads document read-performed and every reachable reason token"
}

echo "== wf-git capability self-checks =="
check_op_sections
check_contract_parity
check_cross_owner_parity
check_typed_results

if [ "$fail" -ne 0 ]; then
  echo "wf-git self-checks: FAIL" >&2
  exit 1
fi
echo "wf-git self-checks: PASS"
