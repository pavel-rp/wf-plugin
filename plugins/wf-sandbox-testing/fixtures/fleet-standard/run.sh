#!/usr/bin/env bash
# run.sh — offline reset checks and the explicit paid two-run fleet driver.
set -euo pipefail

FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$FIXTURE_DIR/../.." && pwd)"
SEED="$FIXTURE_DIR/project.seed.json"
REFERENCE="$FIXTURE_DIR/reference.json"
SEEDER="$FIXTURE_DIR/seed.sh"
RUNNER="$PACK_DIR/runner/run-skill.sh"
ACCOUNT="$PACK_DIR/accounting/account-session.sh"

usage() {
  cat <<'EOF'
Usage:
  run.sh --selfcheck
  run.sh --seed DIR
  WF_FLEET_STANDARD_ALLOW_PAID=1 run.sh --live [--out DIR] [--plugin-source PATH|current] [--model NAME]

--selfcheck and --seed are offline and never invoke Claude. --live is the only
mode that invokes a model; it runs two fresh serial fleet sessions, accounts both
complete evidence bundles, validates state/operation/phase/role shape, and writes
reference.candidate.json under --out. It never overwrites committed reference.json.
EOF
}

die() { printf 'fleet-standard: %s\n' "$*" >&2; exit 1; }
sha_file() { sha256sum "$1" | cut -d' ' -f1; }

materialize_boundary() {
  local boundary="$1"
  [ ! -e "$boundary" ] || die "seed boundary already exists: $boundary"
  mkdir -p "$boundary/plugin-home/wf-fake/capabilities/fake"
  mkdir -p "$boundary/plugin-home/wf-audit/capabilities/audit"
  mkdir -p "$boundary/config-home" "$boundary/workspace" "$boundary/output"
  : > "$boundary/plugin-home/wf-fake/capabilities/fake/manifest.md"
  : > "$boundary/plugin-home/wf-audit/capabilities/audit/manifest.md"
  "$SEEDER" "$boundary/workspace" "$boundary/plugin-home/wf-fake" "$boundary/plugin-home/wf-audit" >/dev/null
  jq -n --arg root "$boundary" \
    '{boundary:$root,plugin_home:($root+"/plugin-home"),config_home:($root+"/config-home"),workspace:($root+"/workspace"),output:($root+"/output")}' \
    > "$boundary/boundary.json"
}

clean_fingerprint() {
  local boundary="$1" ws tmp
  ws="$boundary/workspace"
  tmp="$(mktemp)"
  {
    printf 'seed=%s\n' "$(jq -S -c . "$SEED" | sha256sum | cut -d' ' -f1)"
    printf 'head=%s\n' "$(git -C "$ws" rev-parse HEAD)"
    printf 'branch=%s\n' "$(git -C "$ws" branch --show-current)"
    printf 'remotes=%s\n' "$(git -C "$ws" remote | LC_ALL=C sort | tr '\n' ',')"
    printf 'tracked=%s\n' "$(git -C "$ws" ls-files -s | sha256sum | cut -d' ' -f1)"
    jq -S -c --arg root "$boundary" --arg ws "$ws" \
      'walk(if type=="string" then gsub($root;"__BOUNDARY__")|gsub($ws;"__WORKSPACE__") else . end)' \
      "$ws/_local/fake/scripts.json"
    find "$ws/_local/wf" "$ws/_local/profiles" -type f -printf '%P\n' | LC_ALL=C sort
  } > "$tmp"
  sha_file "$tmp"
  rm -f "$tmp"
}

assert_clean_seed() {
  local boundary="$1" ws
  ws="$boundary/workspace"
  [ ! -e "$ws/_local/fake/op-log.jsonl" ] || die "clean seed contains an operation log: $ws"
  [ "$(git -C "$ws" branch --format='%(refname:short)' | wc -l)" -eq 1 ] || die "clean seed inherited a branch: $ws"
  [ -z "$(git -C "$ws" remote)" ] || die "clean seed contains a remote: $ws"
  [ ! -e "$ws/_local/fleet" ] || die "clean seed inherited fleet state: $ws"
  [ -f "$ws/_local/wf/FLEET-100/00_reqs.md" ] || die "umbrella seed missing: $ws"
  [ -f "$ws/_local/wf/FLEET-101/00_reqs.md" ] || die "child seed missing: $ws"
  [ "$(jq '.topology.children|length' "$SEED")" -eq 1 ] || die "seed must define exactly one child"
  jq -e '.delivery and .tracker and (.delivery|has("pr-merge")) and (.tracker|has("list_children"))' \
    "$ws/_local/fake/scripts.json" >/dev/null || die "seeded fake scripts are incomplete: $ws"
}

selfcheck() {
  command -v jq >/dev/null 2>&1 || die "jq is required"
  command -v git >/dev/null 2>&1 || die "git is required"
  command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
  jq -e '
    .schema=="wf-sandbox-testing.fleet-standard.seed/v1" and
    .fixture.invocation=="/wf:fleet FLEET-100 --max-parallel 1" and
    .fixture.providers.networkedProvidersAllowed==false and
    .fixture.plugins==["wf","wf-fake","wf-audit"] and
    (.topology.children|length)==1 and
    .topology.children[0].parent==.topology.umbrella.id and
    .expectedShape.parallelism==1 and
    .comparability.rejectUnlessPhaseAndRoleShapeMatches==true
  ' "$SEED" >/dev/null || die "seed contract validation failed"
  jq -e '
    .schema=="wf-sandbox-testing.fleet-standard.reference/v1" and
    .fixture_id=="fleet-standard-WF-373" and
    .task_id=="WF-373" and
    ((.publication.status=="published" and .comparability.accepted==true and (.figures|type)=="object") or
     (.publication.status=="unpublished" and .comparability.accepted==false and .figures==null))
  ' "$REFERENCE" >/dev/null || die "reference contract validation failed"
  [ "$(jq -r '.provenance.seed_fingerprint_sha256' "$REFERENCE")" = "$(jq -S -c . "$SEED" | sha256sum | cut -d' ' -f1)" ] ||
    die "reference seed fingerprint is stale"

  local root one two fp1 fp2
  root="$(mktemp -d)"; trap "rm -rf '$root'" EXIT
  one="$root/one"; two="$root/two"
  materialize_boundary "$one"; assert_clean_seed "$one"; fp1="$(clean_fingerprint "$one")"

  # Deliberately contaminate run one with every leak class the reset contract names.
  git -C "$one/workspace" branch leaked-branch
  mkdir -p "$one/workspace/_local/fleet" "$one/workspace/_local/wf/archive/FLEET-101"
  printf '%s\n' '{"seq":99,"surface":"tracker","op":"set_status","args":{},"response":{"state":"leaked"}}' \
    > "$one/workspace/_local/fake/op-log.jsonl"
  printf '%s\n' '{"consumed":true}' > "$one/workspace/_local/fake/scripts.json"
  printf '%s\n' leaked > "$one/workspace/_local/fleet/scoreboard.md"
  printf '%s\n' leaked > "$one/workspace/_local/wf/archive/FLEET-101/index.md"
  rm -f "$one/workspace/_local/wf/FLEET-101/00_reqs.md"

  materialize_boundary "$two"; assert_clean_seed "$two"; fp2="$(clean_fingerprint "$two")"
  [ "$one" != "$two" ] || die "disposable boundaries were reused"
  [ "$fp1" = "$fp2" ] || die "clean-start fingerprints differ: $fp1 != $fp2"
  [ ! -e "$two/workspace/_local/wf/archive/FLEET-101" ] || die "archived task leaked into run two"
  [ ! -e "$two/workspace/_local/fleet/scoreboard.md" ] || die "fleet scoreboard leaked into run two"

  if "$SEEDER" "$two/workspace" "$two/plugin-home/wf-fake" "$two/plugin-home/wf-audit" >/dev/null 2>&1; then
    die "seed.sh accepted a non-empty workspace"
  fi
  bash -n "$SEEDER"; bash -n "$0"
  printf 'fleet-standard selfcheck: PASS (offline; two clean fingerprints %s)\n' "$fp1"
}

session_id_from_run() {
  jq -r '.evidence.session_id // .session_evidence.session_id // .session.id // .run.session_id // empty' "$1/run.json"
}

account_run() {
  local run="$1" session evidence
  session="$(session_id_from_run "$run")"
  [ -n "$session" ] || die "run metadata has no captured session id: $run/run.json"
  evidence="$run/session-evidence"
  [ -f "$evidence/$session.jsonl" ] || die "captured main transcript missing: $evidence/$session.jsonl"
  "$ACCOUNT" --source-root "$evidence" --session-id "$session" --output "$run/accounting.json"
}

operation_sequence() {
  local log="$1" out="$2"
  [ -s "$log" ] || die "fake operation log missing or empty: $log"
  jq -s -e 'all(.[]; .response!="__UNSCRIPTED__")' "$log" >/dev/null || die "unscripted fake operation in $log"
  jq -s '[.[] | {surface,op}]' "$log" > "$out"
  jq -s -e 'to_entries | all(.[]; .value.seq == (.key+1))' "$log" >/dev/null || die "operation sequence is not clean-start contiguous: $log"
}

validate_required_operations() {
  local sequence="$1"
  jq -e --slurpfile seed "$SEED" '
    . as $actual |
    all($seed[0].expectedShape.requiredOperations | to_entries[];
      .key as $surface | all(.value[]; . as $op | any($actual[]; .surface==$surface and .op==$op)))
  ' "$sequence" >/dev/null || die "provider operation shape is incomplete: $sequence"
}

validate_account_shape() {
  local account="$1" evidence="$2"
  jq -e '
    ([.by_phase[].phase] | index("fleet orchestration")!=null) and
    ([.by_phase[].phase] | index("ship orchestration")!=null) and
    ((["spec","plan","tasks","implement","verify","qa"] - [.by_phase[].phase]) | length)==0 and
    .reconciliation.status=="reconciled"
  ' "$account" >/dev/null || die "accounted fleet/ship/run phase shape is not comparable: $account"
  for role in correctness security convention consistency operational; do
    grep -Rqi "${role}.*auditor\|${role}.*lens" "$evidence" || die "missing exercised audit role '$role': $evidence"
  done
  grep -Rqi 'phase-runner' "$evidence" || die "missing isolated phase-runner role: $evidence"
}

scripts_unchanged() {
  local snapshot="$1" normalized expected
  normalized="$(mktemp)"; expected="$(mktemp)"
  jq -S --arg ws "$(jq -r '.delivery."workspace-root-resolve"' "$snapshot/_local/fake/scripts.json")" \
    'walk(if type=="string" then gsub($ws;"__WORKSPACE_ROOT__") else . end)' \
    "$snapshot/_local/fake/scripts.json" > "$normalized"
  jq -S '.fakeScripts' "$SEED" > "$expected"
  cmp -s "$normalized" "$expected" || { rm -f "$normalized" "$expected"; die "fake scripts were consumed or changed: $snapshot"; }
  rm -f "$normalized" "$expected"
}

live_run() {
  local out="$1" plugin_source="$2" model="$3"
  [ "${WF_FLEET_STANDARD_ALLOW_PAID:-0}" = 1 ] || die "--live requires WF_FLEET_STANDARD_ALLOW_PAID=1 (paid model execution is explicit)"
  [ -x "$RUNNER" ] || die "runner missing: $RUNNER"
  [ -x "$ACCOUNT" ] || die "accountant missing: $ACCOUNT"
  [ ! -e "$out" ] || die "output boundary already exists: $out"
  mkdir -p "$out"

  local preflight one two fp1 fp2 invocation
  preflight="$(mktemp -d)"; trap "rm -rf '$preflight'" EXIT
  materialize_boundary "$preflight/one"; assert_clean_seed "$preflight/one"; fp1="$(clean_fingerprint "$preflight/one")"
  materialize_boundary "$preflight/two"; assert_clean_seed "$preflight/two"; fp2="$(clean_fingerprint "$preflight/two")"
  [ "$fp1" = "$fp2" ] || die "two clean-start fingerprints differ before execution"
  invocation="$(jq -r '.fixture.invocation' "$SEED")"

  local -a model_args=()
  [ -n "$model" ] && model_args=(--model "$model")
  one="$out/run-1"; two="$out/run-2"
  "$RUNNER" --fixture fleet-standard --skill "$invocation" --plugin-source "$plugin_source" --out "$one" --on-quota fail "${model_args[@]}"
  "$RUNNER" --fixture fleet-standard --skill "$invocation" --plugin-source "$plugin_source" --out "$two" --on-quota fail "${model_args[@]}"

  account_run "$one"; account_run "$two"
  for run in "$one" "$two"; do
    scripts_unchanged "$run/workspace-snapshot"
    operation_sequence "$run/workspace-snapshot/_local/fake/op-log.jsonl" "$run/operation-sequence.json"
    validate_required_operations "$run/operation-sequence.json"
    validate_account_shape "$run/accounting.json" "$run/session-evidence"
    grep -Rqs 'FLEET — Complete' "$run/session-evidence" || die "fleet did not complete: $run"
    grep -Rqs 'SHIP — Merged' "$run/session-evidence" || die "ship ceremony proof missing: $run"
  done
  cmp -s "$one/operation-sequence.json" "$two/operation-sequence.json" || die "fake operation sequences differ across fresh runs"

  local seq_fp inventory1 inventory2 inventory_fp seed_fp
  seq_fp="$(sha_file "$one/operation-sequence.json")"
  inventory1="$(mktemp)"; inventory2="$(mktemp)"
  (cd "$one/workspace-snapshot" && find . -type f -printf '%P\n' | LC_ALL=C sort) > "$inventory1"
  (cd "$two/workspace-snapshot" && find . -type f -printf '%P\n' | LC_ALL=C sort) > "$inventory2"
  cmp -s "$inventory1" "$inventory2" || die "final artifact shape differs across fresh runs"
  inventory_fp="$(sha_file "$inventory1")"; seed_fp="$(jq -S -c . "$SEED" | sha256sum | cut -d' ' -f1)"
  rm -f "$inventory1" "$inventory2"

  jq -n --slurpfile a "$one/accounting.json" --slurpfile b "$two/accounting.json" --slurpfile seed "$SEED" \
    --arg generated "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg seed_fp "$seed_fp" --arg clean_fp "$fp1" \
    --arg seq_fp "$seq_fp" --arg inventory_fp "$inventory_fp" '
    {schema:"wf-sandbox-testing.fleet-standard.reference/v1",fixture_id:$seed[0].fixture.id,task_id:$seed[0].fixture.task,
     publication:{status:"candidate",generated_at:$generated,source:"two fresh paid fixture executions"},
     provenance:{seed_fingerprint_sha256:$seed_fp,clean_start_fingerprint_sha256:$clean_fp,
                 operation_sequence_fingerprint_sha256:$seq_fp,final_shape_fingerprint_sha256:$inventory_fp,
                 session_input_fingerprints:[$a[0].provenance.input_fingerprint_sha256,$b[0].provenance.input_fingerprint_sha256]},
     comparability:{accepted:true,preserves:$seed[0].comparability.preserves,reduces:$seed[0].comparability.reduces,divergences:[]},
     figures:{runs:[$a[0].totals,$b[0].totals],mean_cost_usd:(($a[0].totals.cost_usd+$b[0].totals.cost_usd)/2),
              by_phase:[$a[0].by_phase,$b[0].by_phase],by_role:[$a[0].by_role,$b[0].by_role]}}
  ' > "$out/reference.candidate.json"

  printf 'fleet-standard live run: PASS\noutput: %s\ncandidate: %s\n' "$out" "$out/reference.candidate.json"
}

mode=""; target=""; out=""; plugin_source="current"; model=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --selfcheck) [ -z "$mode" ] || die "choose one mode"; mode="selfcheck"; shift ;;
    --seed) [ -z "$mode" ] || die "choose one mode"; mode="seed"; target="${2:?--seed requires DIR}"; shift 2 ;;
    --live) [ -z "$mode" ] || die "choose one mode"; mode="live"; shift ;;
    --out) out="${2:?--out requires DIR}"; shift 2 ;;
    --plugin-source) plugin_source="${2:?--plugin-source requires a value}"; shift 2 ;;
    --model) model="${2:?--model requires a value}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

case "$mode" in
  selfcheck) selfcheck ;;
  seed) materialize_boundary "$target"; assert_clean_seed "$target"; jq . "$target/boundary.json" ;;
  live) [ -n "$out" ] || out="${TMPDIR:-/tmp}/wf-fleet-standard-$(date -u +%Y%m%dT%H%M%SZ)-$$"; live_run "$out" "$plugin_source" "$model" ;;
  *) usage >&2; exit 2 ;;
esac
