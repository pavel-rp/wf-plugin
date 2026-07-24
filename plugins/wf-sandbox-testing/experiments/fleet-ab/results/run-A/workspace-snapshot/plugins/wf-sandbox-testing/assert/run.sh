#!/usr/bin/env bash
# run.sh — wf-sandbox-testing assertion-layer self-checks (the CI entrypoint).
#
# Same family and style as validate-registry.sh / registry-fixtures/run.sh and the runner's
# selfcheck.sh: set -uo pipefail, ok/err, deterministic, no network, no model. It proves the
# WHOLE assertion layer against the committed CANNED run outputs (shaped exactly like the
# WF-345 runner's output tree) — real containerized model runs are neither required nor run
# here; the layer is scripts over transcript + workspace + op logs, so canned outputs
# exercise every criterion. It checks, in order:
#
#   1. GREEN REPORT   — the demonstration scenario passes; the report states run counts,
#                       variance, and per-run token cost, and exercises all three families.
#   2. RED REPORT     — the deliberately broken fixture fails and NAMES the failed assertion.
#   3. COMPARISON     — two run sets compared structurally: EQUIVALENT (current vs a pinned
#                       baseline) and DIVERGENT (current vs broken) — never a transcript exact-match.
#   4. SETTINGS KEY   — flipping the per-tier model settings key (env / override file / default)
#                       changes the resolved model with NO harness-code edit; SMOKE and
#                       STATISTICAL resolve distinct model + run counts.
#   5. UNIT           — the family extractors read terminal block / ops / token cost correctly.
#   6. GREP GUARDS    — no exact-match transcript comparison and no custom orchestration
#                       construct (scheduler / worker pool / job queue / parallel spawn) in
#                       any harness script; the /wf:fleet fleet-item shape is documented.
#
# Usage: run.sh   (run every check; used by CI)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCEN="$SCRIPT_DIR/scenarios"
README="$SCRIPT_DIR/README.md"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

command -v jq >/dev/null 2>&1 || { echo "run.sh: jq is required for the assertion suite" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------------------
# 1. GREEN REPORT — demonstration scenario passes; report is well-formed.
# ---------------------------------------------------------------------------
check_green() {
  local before=$fail rc=0 rep="$TMP/green.txt"
  REPORT="$rep" bash "$SCRIPT_DIR/tiers.sh" statistical --scenario "$SCEN/demo-branch" --report "$rep" >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 0 ] || err "green: demonstration scenario did not pass (exit $rc)"
  grep -q 'Verdict: PASS'        "$rep" 2>/dev/null || err "green: report missing 'Verdict: PASS'"
  grep -q 'Runs: 3'             "$rep" 2>/dev/null || err "green: report missing run count 'Runs: 3'"
  grep -q 'Token cost (per run)' "$rep" 2>/dev/null || err "green: report missing per-run token cost"
  grep -Eq 'terminal_block .*PASS' "$rep" 2>/dev/null || err "green: terminal_block family not exercised/passed"
  grep -Eq 'files_touched .*PASS'  "$rep" 2>/dev/null || err "green: files_touched family not exercised/passed"
  grep -Eq 'ops_invoked .*PASS'    "$rep" 2>/dev/null || err "green: ops_invoked family not exercised/passed"
  grep -Eq 'variance:drift'        "$rep" 2>/dev/null || err "green: expected a variance:drift signal (run-3 already-active) distinguishing drift from regression"
  [ "$fail" = "$before" ] && ok "green: demonstration scenario PASS — run counts, variance (incl. drift), and per-run token cost all reported"
}

# ---------------------------------------------------------------------------
# 2. RED REPORT — broken fixture fails and names the failed assertion.
# ---------------------------------------------------------------------------
check_red() {
  local before=$fail rc=0 rep="$TMP/red.txt"
  REPORT="$rep" bash "$SCRIPT_DIR/tiers.sh" statistical --scenario "$SCEN/broken-branch" --report "$rep" >/dev/null 2>&1 || rc=$?
  [ "$rc" -ne 0 ] || err "red: broken fixture unexpectedly passed (exit 0)"
  grep -q 'Verdict: FAIL' "$rep" 2>/dev/null || err "red: report missing 'Verdict: FAIL'"
  grep -Eq 'terminal_block .*FAIL' "$rep" 2>/dev/null || err "red: report does not NAME terminal_block as the failed assertion"
  grep -q 'regression' "$rep" 2>/dev/null || err "red: failed family not marked a regression"
  [ "$fail" = "$before" ] && ok "red: broken fixture FAIL — the report names terminal_block (regression) as the failed assertion"
}

# ---------------------------------------------------------------------------
# 3. COMPARISON — equivalence (vs a pinned baseline) and divergence (vs broken).
# ---------------------------------------------------------------------------
check_comparison() {
  local before=$fail
  # Derive a pinned-baseline run set from the demonstration current set: identical structure,
  # only the run.json plugin-build fingerprint rewritten (a pinned earlier build).
  local base="$TMP/demo-baseline"; mkdir -p "$base"
  cp -R "$SCEN/demo-branch/runs-current/." "$base/"
  local rj
  while IFS= read -r rj; do
    jq '.fingerprints.plugin_build = "fp-pinned-xyz" | .plugin_source = "/pinned/build"' "$rj" > "$rj.tmp" && mv "$rj.tmp" "$rj"
  done < <(find "$base" -name run.json)

  local rc=0 rep="$TMP/cmp-eq.txt"
  REPORT="$rep" bash "$SCRIPT_DIR/compare.sh" --current "$SCEN/demo-branch/runs-current" --baseline "$base" --report "$rep" >/dev/null 2>&1 || rc=$?
  [ "$rc" -eq 0 ] || err "comparison: current vs pinned-baseline should be EQUIVALENT (exit $rc)"
  grep -q 'Comparison verdict: EQUIVALENT' "$rep" 2>/dev/null || err "comparison: equivalence verdict missing"

  rc=0; rep="$TMP/cmp-div.txt"
  REPORT="$rep" bash "$SCRIPT_DIR/compare.sh" --current "$SCEN/demo-branch/runs-current" --baseline "$SCEN/broken-branch/runs-current" --report "$rep" >/dev/null 2>&1 || rc=$?
  [ "$rc" -ne 0 ] || err "comparison: current vs broken should be DIVERGENT (exit 0)"
  grep -q 'Comparison verdict: DIVERGENT' "$rep" 2>/dev/null || err "comparison: divergence verdict missing"
  grep -Eq 'terminal_block .*DIVERGENT' "$rep" 2>/dev/null || err "comparison: divergence not attributed to the terminal_block family"
  [ "$fail" = "$before" ] && ok "comparison: EQUIVALENT vs a pinned baseline, DIVERGENT vs the broken set — structural, no transcript exact-match"
}

# ---------------------------------------------------------------------------
# 4. SETTINGS KEY — per-tier model resolves through override>default, no code edit.
# ---------------------------------------------------------------------------
check_settings_key() {
  local before=$fail default_stat smoke_line stat_model smoke_model env_model ovr_model
  default_stat="$(bash "$SCRIPT_DIR/tiers.sh" statistical --print-model 2>/dev/null)"
  smoke_line="$(bash "$SCRIPT_DIR/tiers.sh" smoke --print-model 2>/dev/null)"
  stat_model="$(printf '%s' "$default_stat" | sed -E 's/.*model=([^ ]+).*/\1/')"
  smoke_model="$(printf '%s' "$smoke_line" | sed -E 's/.*model=([^ ]+).*/\1/')"
  [ -n "$stat_model" ] && [ -n "$smoke_model" ] || err "settings: could not resolve tier models"
  [ "$stat_model" != "$smoke_model" ] || err "settings: SMOKE and STATISTICAL resolved the SAME model ($stat_model) — tiers must differ"
  printf '%s' "$smoke_line" | grep -Eq 'runs=[0-9]+' || err "settings: SMOKE did not resolve a run count"

  # (a) env override — highest precedence, no file/code edit.
  env_model="$(WF_ASSERT_STATISTICAL_MODEL='env-override-model' bash "$SCRIPT_DIR/tiers.sh" statistical --print-model 2>/dev/null | sed -E 's/.*model=([^ ]+).*/\1/')"
  [ "$env_model" = "env-override-model" ] || err "settings: env WF_ASSERT_STATISTICAL_MODEL did not override the model (got '$env_model')"
  [ "$env_model" != "$stat_model" ] || err "settings: env override did not CHANGE the model from the default"

  # (b) override file — the downstream settings override, no harness-code edit.
  local ovr="$TMP/override.settings.json"
  jq -n '{tiers:{statistical:{model:"file-override-model",runs:9}}}' > "$ovr"
  ovr_model="$(WF_ASSERT_SETTINGS_OVERRIDE="$ovr" bash "$SCRIPT_DIR/tiers.sh" statistical --print-model 2>/dev/null | sed -E 's/.*model=([^ ]+).*/\1/')"
  [ "$ovr_model" = "file-override-model" ] || err "settings: override file did not supersede the default model (got '$ovr_model')"

  [ "$fail" = "$before" ] && ok "settings: per-tier model resolves via override>default (env + file both flip it) with no harness-code edit; SMOKE!=STATISTICAL"
}

# ---------------------------------------------------------------------------
# 5. UNIT — the family extractors.
# ---------------------------------------------------------------------------
check_unit() {
  local before=$fail
  # shellcheck source=lib.sh
  . "$SCRIPT_DIR/lib.sh"
  local r1="$SCEN/demo-branch/runs-current/run-1"
  local tb; tb="$(extract_terminal_block "$r1/transcript.jsonl")"
  [ "$tb" = "$(printf 'BRANCH\tcreated')" ] || err "unit: extract_terminal_block returned '$tb' (want BRANCH<TAB>created)"
  local ops; ops="$(extract_ops "$r1" | tr '\n' ',' | sed 's/,$//')"
  [ "$ops" = "delivery:branch-create,delivery:current-branch-query" ] || err "unit: extract_ops returned '$ops'"
  local tc; tc="$(parse_token_cost "$r1/transcript.jsonl")"
  printf '%s' "$tc" | grep -q 'usd=0.0121' || err "unit: parse_token_cost usd wrong: '$tc'"
  printf '%s' "$tc" | grep -q 'tokens=2060' || err "unit: parse_token_cost tokens wrong: '$tc'"
  [ "$fail" = "$before" ] && ok "unit: terminal-block, ops, and token-cost extractors read the run outputs correctly"
}

# ---------------------------------------------------------------------------
# 6. GREP GUARDS — no exact-match transcript compare, no orchestrator, fleet documented.
# ---------------------------------------------------------------------------
check_grep_guards() {
  local before=$fail
  # Scan the harness scripts only (exclude THIS script, which carries the denylist regexes).
  local scripts=()
  local f
  for f in "$SCRIPT_DIR"/*.sh; do
    [ "$f" = "$SCRIPT_DIR/run.sh" ] && continue
    scripts+=("$f")
  done

  # (a) no exact-match transcript comparison anywhere.
  local exact_ere='(diff|cmp|sha256sum|md5sum)[^#]*transcript|transcript[^#]*(diff|cmp|sha256sum|md5sum)'
  local exact_hits; exact_hits="$(grep -EnH "$exact_ere" "${scripts[@]}" 2>/dev/null || true)"
  if [ -n "$exact_hits" ]; then err "grep-guard: an exact-match transcript comparison appears in a harness script:"; printf '%s\n' "$exact_hits" >&2; else
    ok "grep-guard: no exact-match transcript comparison (diff/cmp/hash on a transcript) in any harness script"; fi

  # (b) no custom orchestration construct. Strip full-line comments so the README/comment
  # DENIALS of these nouns are not themselves counted as constructs.
  local codeonly="$TMP/codeonly.txt"
  grep -hEv '^[[:space:]]*#' "${scripts[@]}" > "$codeonly" 2>/dev/null || true
  local orch_ere='xargs[^|]*-P|[^&|>]&[[:space:]]*$|(^|[[:space:]])parallel[[:space:]]|mkfifo|nohup|[[:space:]]disown|jobs[[:space:]]+-p|wait[[:space:]]+-n|worker[_ -]?pool|job[_ -]?queue|thread[_ -]?pool|scheduler'
  local orch_hits; orch_hits="$(grep -EnH "$orch_ere" "$codeonly" 2>/dev/null || true)"
  if [ -n "$orch_hits" ]; then err "grep-guard: a custom orchestration construct appears in harness code:"; printf '%s\n' "$orch_hits" >&2; else
    ok "grep-guard: no scheduler / worker pool / job queue / parallel-spawn construct in any harness script"; fi

  # (c) the /wf:fleet fleet-item invocation shape is documented.
  [ -f "$README" ] || err "grep-guard: README.md (tier docs + fleet-item shape) missing"
  grep -q '/wf:fleet' "$README" 2>/dev/null || err "grep-guard: README does not document the /wf:fleet dispatcher"
  grep -qi 'fleet item' "$README" 2>/dev/null || err "grep-guard: README does not document the fleet-item invocation shape"
  [ "$fail" = "$before" ] && ok "grep-guard: no exact-match / no orchestrator; the /wf:fleet fleet-item shape is documented"
}

echo "== wf-sandbox-testing assertion-layer self-checks (canned run outputs) =="
check_green
check_red
check_comparison
check_settings_key
check_unit
check_grep_guards

if [ "$fail" -ne 0 ]; then
  echo "wf-sandbox-testing assertion self-checks: FAIL" >&2
  exit 1
fi
echo "wf-sandbox-testing assertion self-checks: PASS"
