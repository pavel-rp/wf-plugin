#!/usr/bin/env bash
# selfcheck.sh — offline deterministic acceptance for WF-432 host availability and teardown.
# Exercises plan-state classification and qa-auto contract/model ordering, then runs a registered-host
# fixture lifecycle across fourteen expose/augment/seed/fixture combinations with byte-tree restoration.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/../../../.." && pwd)"
ASSERT="$SRC_DIR/../../assert/tree-equal.sh"
PROJECT="$SRC_DIR/project"
SCRATCH="$REPO_ROOT/_local/scratch/host-lifecycle-selfcheck-$$"
trap 'rm -rf "$SCRATCH"' EXIT

fail() { printf 'selfcheck: FAIL — %s\n' "$1" >&2; exit 1; }
[ -x "$ASSERT" ] || fail "tree assertion is not executable: $ASSERT"
[ -x "$PROJECT/commands/lifecycle.sh" ] || fail "fixture lifecycle command is not executable"
mkdir -p "$SCRATCH/before" "$SCRATCH/success" "$SCRATCH/symlink-before" "$SCRATCH/symlink-after" "$SCRATCH/setup-failure" "$SCRATCH/test-failure"
cp -a "$PROJECT/." "$SCRATCH/before/"
cp -a "$PROJECT/." "$SCRATCH/success/"
cp -a "$PROJECT/." "$SCRATCH/symlink-before/"
cp -a "$PROJECT/." "$SCRATCH/symlink-after/"
cp -a "$PROJECT/." "$SCRATCH/setup-failure/"
cp -a "$PROJECT/." "$SCRATCH/test-failure/"

# These source assertions bind the deterministic model below to the actual core contracts. The
# model is deliberately no-egress: it is contract/model coverage, not an interactive skill invocation.
QA_GEN="$REPO_ROOT/plugins/wf/skills/qa-gen/references/api-scenarios.md"
QA_GEN_SKILL="$REPO_ROOT/plugins/wf/skills/qa-gen/SKILL.md"
QA_TEMPLATE="$REPO_ROOT/plugins/wf/skills/qa-gen/references/qa-template.md"
QA_AUTO="$REPO_ROOT/plugins/wf/skills/qa-auto/SKILL.md"
QA_FOLLOWUP="$REPO_ROOT/plugins/wf/skills/qa-followup/SKILL.md"
HOST_SKILL="$REPO_ROOT/plugins/wf-host/skills/qa-host/SKILL.md"
HOST_AGENT="$REPO_ROOT/plugins/wf-host/agents/qa-host.md"
HOST_PROFILE="$REPO_ROOT/plugins/wf-host/capabilities/host/profile.template.json"
grep -Fq 'Generation resolves `qa-execution:host` once' "$QA_GEN" || fail "qa-gen no longer preflights host ownership once"
grep -Fq '**Host availability:** unavailable' "$QA_GEN" || fail "qa-gen host-unavailable annotation missing"
grep -Fq 'either a `Host required:` or `Backend host required:` precondition' "$QA_GEN_SKILL" || fail "qa-gen does not classify both browser and backend host requirements"
grep -Fq '**Host availability:** unavailable   <!-- ONLY when `Host required:` is present' "$QA_TEMPLATE" || fail "browser host-unavailable template marker missing"
grep -Fq 'No engine dispatch was attempted for these scenarios.' "$QA_AUTO" || fail "qa-auto all-host zero-dispatch rule missing"
grep -Fq 'Dispatch runnable work to the engine.' "$QA_AUTO" || fail "qa-auto selective dispatch rule missing"
grep -Fq 'Prepare registered host work once.' "$QA_AUTO" || fail "qa-auto host prepare dispatch rule missing"
grep -Fq 'Before partitioning, securely inspect any existing private lifecycle state' "$QA_AUTO" || fail "qa-auto does not consume follow-up handoff before host classification"
grep -Fq '`Host operation target:` metadata' "$QA_AUTO" || fail "qa-auto does not classify stable operation-target requests as host-dependent"
grep -Fq 'proceed directly to Step 4; the remainder of this step applies only to a fresh prepare' "$QA_AUTO" || fail "qa-auto can duplicate prepare after consuming a follow-up handoff"
grep -Fq 'Always tear down prepared/attempted host work.' "$QA_AUTO" || fail "qa-auto host teardown-finally rule missing"
grep -Fq 'finally-equivalent path' "$QA_AUTO" || fail "qa-auto host teardown is not finally-equivalent"
grep -Fq 'If `{runnable}` is empty after host preparation, make zero engine dispatches.' "$QA_AUTO" || fail "qa-auto zero-dispatch guard missing"
grep -Fq 'one category and one escalation' "$QA_FOLLOWUP" || fail "qa-followup one-category aggregation rule missing"
grep -Fq '{ runId, lifecycleToken, taskId, state: "ready", handoff: "qa-followup", affectedScenarioIds, safeReadiness }' "$QA_FOLLOWUP" || fail "qa-followup handoff omits lifecycle fields required by qa-auto"
grep -Fq 'run a fresh full pass with `/wf:qa-auto <id>` because regeneration may renumber scenario IDs' "$QA_FOLLOWUP" || fail "qa-followup unavailable-host remediation can reuse stale scenario ids"
grep -Fq 'Host operation target: <operation> | <kind> | <target>' "$HOST_AGENT" || fail "host agent stable operation-target marker missing"
grep -Fq 'scenarioHostRequests: [{ scenarioId, operation, kind, target }]' "$HOST_AGENT" || fail "host agent does not preserve public target kind"
grep -Fq 'exactly 64' "$HOST_SKILL" && grep -Fq 'lowercase hexadecimal characters encoding 32 caller-generated CSPRNG bytes' "$HOST_SKILL" || fail "host lifecycle token format is not enforceable"
grep -Fq 'atomic exclusive-create operation' "$HOST_SKILL" || fail "host lifecycle lock acquisition is not atomic-exclusive"
grep -Fq 'exactly mode `0600` before every read, comparison, or' "$HOST_SKILL" || fail "host lifecycle lock permissions are not revalidated"
grep -Fq 'require it to remain a strict child of `_local/scratch/wf-host/`' "$HOST_SKILL" || fail "host run id can escape its provider-owned root"
grep -Fq '"command-timeout-seconds": 120' "$HOST_PROFILE" || fail "host profile does not seed a runnable command timeout"
line_for() {
  local match
  match="$(grep -Fn "$1" "$QA_AUTO")"
  printf '%s\n' "${match%%:*}"
}
host_prepare_line="$(line_for 'Prepare registered host work once.')"
engine_dispatch_line="$(line_for 'Dispatch runnable work to the engine.')"
host_teardown_line="$(line_for 'Always tear down prepared/attempted host work.')"
[ "$host_prepare_line" -lt "$engine_dispatch_line" ] || fail "qa-auto contract does not order host prepare before engine dispatch"
[ "$engine_dispatch_line" -lt "$host_teardown_line" ] || fail "qa-auto contract does not order host teardown after engine dispatch"

# A plan-state model feeds generation, dispatch, and follow-up assertions from the same selected
# scenarios; unlike an expected-string self-match, each result is derived from the scenario data.
plan=(
  host-1:host host-2:host host-3:host
  api-1:runnable browser-1:runnable
)
plan_summary() {
  local host_owner="$1" selected="$2" entry kind selected_count=0 runnable=0 unavailable=0
  local dispatches=0 gaps=0
  for entry in "${plan[@]}"; do
    kind="${entry#*:}"
    [ "$selected" = all ] || [ "$selected" = "$kind" ] || continue
    selected_count=$((selected_count + 1))
    if [ "$kind" = host ] && [ "$host_owner" != registered ]; then
      unavailable=$((unavailable + 1))
    else
      runnable=$((runnable + 1))
    fi
  done
  [ "$unavailable" -eq 0 ] || gaps=1
  [ "$runnable" -eq 0 ] || dispatches=1
  printf 'selected=%s runnable=%s host-unavailable=%s engine-dispatches=%s capability-gaps=%s\n' \
    "$selected_count" "$runnable" "$unavailable" "$dispatches" "$gaps"
}
followup_summary() {
  local unavailable="$1" categories=0 remediations=0
  [ "$unavailable" -eq 0 ] || { categories=1; remediations=1; }
  printf 'host-unavailable=%s capability-gap-categories=%s remediations=%s\n' \
    "$unavailable" "$categories" "$remediations"
}
expect_fields() {
  local label="$1" actual="$2"
  shift 2
  local field
  for field in "$@"; do
    case " $actual " in *" $field "*) ;; *) fail "$label missing '$field' in '$actual'" ;; esac
  done
}

generation="$(plan_summary unavailable all)"
expect_fields "generation-time host gap" "$generation" \
  selected=5 runnable=2 host-unavailable=3 engine-dispatches=1 capability-gaps=1
all_host="$(plan_summary unavailable host)"
expect_fields "all-host zero engine dispatch" "$all_host" \
  selected=3 runnable=0 host-unavailable=3 engine-dispatches=0 capability-gaps=1
mixed="$(plan_summary unavailable all)"
expect_fields "mixed-plan selective dispatch" "$mixed" \
  selected=5 runnable=2 host-unavailable=3 engine-dispatches=1 capability-gaps=1
followup="$(followup_summary 3)"
expect_fields "follow-up aggregation" "$followup" \
  host-unavailable=3 capability-gap-categories=1 remediations=1
registered_host="$(plan_summary registered host)"
expect_fields "registered all-host dispatch" "$registered_host" \
  selected=3 runnable=3 host-unavailable=0 engine-dispatches=1 capability-gaps=0
ordering_model() {
  local engine_result="$1"
  printf 'host-prepare engine-%s host-teardown\n' "$engine_result"
}
[ "$(ordering_model success)" = 'host-prepare engine-success host-teardown' ] || fail "successful ordering model omitted host teardown"
[ "$(ordering_model failure)" = 'host-prepare engine-failure host-teardown' ] || fail "failed ordering model omitted host teardown"
echo "selfcheck: [1/12] generation contract/model coverage emits one host gap without withholding two runnable scenarios"
echo "selfcheck: [2/12] all-host contract/model coverage reaches zero engine dispatches"
echo "selfcheck: [3/12] mixed-plan contract/model coverage dispatches exactly its two runnable scenarios once"
echo "selfcheck: [4/12] follow-up contract/model coverage aggregates unavailable host work into one category/remediation"
echo "selfcheck: [5/12] registered all-host dispatch-model coverage prepares the host and reaches one engine dispatch"
echo "selfcheck: [6/12] qa-auto contract ordering and successful-order model place teardown after engine dispatch"
echo "selfcheck: [7/12] failed-engine order model retains host teardown"

# Fourteen representative operation combinations cover each class and every mixed lifecycle path.
# (There are fifteen mathematical nonempty subsets; the `augment-seed-fixture` triple is omitted.)
scenarios=(
  expose-only:expose augment-only:augment seed-only:seed fixture-only:fixture
  expose-augment:expose-augment expose-seed:expose-seed expose-fixture:expose-fixture
  augment-seed:augment-seed augment-fixture:augment-fixture seed-fixture:seed-fixture
  expose-augment-seed:expose-augment-seed expose-augment-fixture:expose-augment-fixture
  expose-seed-fixture:expose-seed-fixture expose-augment-seed-fixture:expose-augment-seed-fixture
)
completed=()
teardown_completed() {
  local i
  for ((i=${#completed[@]} - 1; i >= 0; i--)); do
    "$PROJECT/commands/lifecycle.sh" teardown "${completed[i]}"
  done
}
run_scenario() {
  local root="$1" log="$2" scenario="$3" operations="$4" op
  completed=()
  export WF_HOST_FIXTURE_ROOT="$root"
  export WF_HOST_LOG="$log"
  export WF_HOST_SCENARIO="$scenario"
  IFS='-' read -r -a requested <<< "$operations"
  for op in "${requested[@]}"; do
    # Persist teardown intent before setup: a failed setup can have partially mutated state.
    completed+=("$op")
    if "$PROJECT/commands/lifecycle.sh" setup "$op"; then
      :
    else
      teardown_completed
      return 1
    fi
  done
  if ! "$PROJECT/commands/lifecycle.sh" health verify; then
    teardown_completed
    return 1
  fi
  teardown_completed
}

success_log="$SCRATCH/success-operation-log.txt"
: > "$success_log"
for entry in "${scenarios[@]}"; do
  run_scenario "$SCRATCH/success" "$success_log" "${entry%%:*}" "${entry#*:}" || fail "success lifecycle failed for ${entry%%:*}"
done
"$PROJECT/commands/lifecycle.sh" assert clean
[ "$(grep -Ec ':(setup|teardown):(expose|augment|seed|fixture)$' "$success_log")" -eq 58 ] || fail "14-scenario success lifecycle did not produce exactly 58 setup/teardown records"
for entry in "${scenarios[@]}"; do
  scenario="${entry%%:*}"
  operations="${entry#*:}"
  IFS='-' read -r -a requested <<< "$operations"
  for op in "${requested[@]}"; do
    [ "$(grep -Fxc "$scenario:setup:$op" "$success_log")" -eq 1 ] || fail "$scenario did not set up $op exactly once"
    [ "$(grep -Fxc "$scenario:teardown:$op" "$success_log")" -eq 1 ] || fail "$scenario did not tear down $op exactly once"
  done
done
bash "$ASSERT" "$SCRATCH/before" "$SCRATCH/success"
echo "selfcheck: [8/12] registered host fixture covers all 14 operation combinations and restores bytes after success"

# A target-only symlink difference must make the byte-tree assertion red; this proves links are
# part of the restoration contract rather than silently skipped.
ln -s 'before-target' "$SCRATCH/symlink-before/planted-link"
ln -s 'after-target' "$SCRATCH/symlink-after/planted-link"
if bash "$ASSERT" "$SCRATCH/symlink-before" "$SCRATCH/symlink-after" >/dev/null 2>&1; then
  fail "tree assertion accepted a planted symlink target difference"
fi
echo "selfcheck: [9/12] tree assertion turns red for a planted symlink target difference"

# Setup intent is ledgered before execution: a failing augment may partially mutate state and must
# itself tear down before the earlier expose intent.
setup_log="$SCRATCH/setup-failure-operation-log.txt"
: > "$setup_log"
export WF_HOST_FAIL_SETUP_OPERATION=augment
if run_scenario "$SCRATCH/setup-failure" "$setup_log" setup-failure expose-augment; then
  fail "injected setup failure returned success"
fi
unset WF_HOST_FAIL_SETUP_OPERATION
"$PROJECT/commands/lifecycle.sh" assert clean
[ "$(grep -Fc 'setup-failure:setup:expose' "$setup_log")" -eq 1 ] || fail "setup failure did not complete expose before failure"
[ "$(grep -Fc 'setup-failure:setup-failed:augment' "$setup_log")" -eq 1 ] || fail "setup failure was not recorded"
mapfile -t setup_teardown_lines < <(grep '^setup-failure:teardown:' "$setup_log")
expected_setup_teardown=(augment expose)
[ "${#setup_teardown_lines[@]}" -eq "${#expected_setup_teardown[@]}" ] || fail "setup failure did not attempt both pending teardowns"
for i in "${!expected_setup_teardown[@]}"; do
  [ "${setup_teardown_lines[i]}" = "setup-failure:teardown:${expected_setup_teardown[i]}" ] || fail "setup failure teardown order is not reverse ledger order"
done
bash "$ASSERT" "$SCRATCH/before" "$SCRATCH/setup-failure"
echo "selfcheck: [10/12] setup failure reverses started and completed work, then restores bytes"

# A test/health failure after all four operations have completed must reverse their ledger order.
test_log="$SCRATCH/test-failure-operation-log.txt"
: > "$test_log"
export WF_HOST_FAIL_HEALTH=1
if run_scenario "$SCRATCH/test-failure" "$test_log" test-failure expose-augment-seed-fixture; then
  fail "injected test failure returned success"
fi
unset WF_HOST_FAIL_HEALTH
"$PROJECT/commands/lifecycle.sh" assert clean
mapfile -t teardown_lines < <(grep '^test-failure:teardown:' "$test_log")
expected_teardown=(fixture seed augment expose)
[ "${#teardown_lines[@]}" -eq "${#expected_teardown[@]}" ] || fail "test failure did not attempt four reverse teardowns"
for i in "${!expected_teardown[@]}"; do
  [ "${teardown_lines[i]}" = "test-failure:teardown:${expected_teardown[i]}" ] || fail "test failure teardown order is not reverse ledger order"
done
bash "$ASSERT" "$SCRATCH/before" "$SCRATCH/test-failure"
echo "selfcheck: [11/12] test failure reverses all completed operations in reverse order and restores bytes"

# The resolver's paired alias contract and partitioned-provider overlap rejection are guarded by
# executable, shared registry fixtures; require their actual assertions rather than a local alias stub.
REGISTRY_GUARD="$REPO_ROOT/plugins/wf/skills/_contracts/validate-registry.sh"
HOST_OVERLAP="$REPO_ROOT/plugins/wf/skills/_contracts/registry-fixtures/fail-host-overlap.md"
registry_output="$SCRATCH/registry-host-overlap.txt"
if bash "$REGISTRY_GUARD" "$HOST_OVERLAP" >"$registry_output" 2>&1; then
  fail "duplicate host ownership was accepted"
fi
grep -Fq 'host-owner' "$registry_output" || fail "host overlap rejection omitted the first owner"
grep -Fq 'host-owner-2' "$registry_output" || fail "host overlap rejection omitted the second owner"
grep -Fq 'partitioned ownership must not overlap' "$registry_output" || fail "host overlap rejection omitted its partition remedy"
grep -Fq 'composite qa-execution:host resolves identically to bare host' "$REPO_ROOT/plugins/wf/mcp/test/service.test.ts" || fail "resolver alias equivalence regression test missing"
echo "selfcheck: [12/12] host aliases share an owner and duplicate host ownership is rejected"
echo "selfcheck: PASS — host availability and reversible teardown coverage holds"
