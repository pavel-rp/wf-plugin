#!/usr/bin/env bash
# selfcheck.sh — re-runnable proof that parity-check.sh still both accepts and rejects.
#
# checks.md records the verdicts in prose for a human reader; this script is the mechanical form,
# so a later edit to the comparator or the contract cannot quietly break either direction. It is
# the parity layer's equivalent of accounting/selfcheck.sh and runner/selfcheck.sh.
#
# No Docker, no network, no spend. Committed fixtures live in testdata/; the handful of cases that
# need a generated capture (a control-character token, an over-long line, a colon-bearing kit root)
# are built under _local/scratch/ and never alongside tracked files.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
PARITY="$ROOT/plugins/wf-sandbox-testing/experiments/parity"
BASELINE="$ROOT/plugins/wf-sandbox-testing/experiments/fleet-ab/baseline/dry-run-baseline.stdout.txt"
TESTDATA="$PARITY/testdata"
SCRATCH="$ROOT/_local/scratch/wf-419-parity"

mkdir -p "$SCRATCH"

LAST_OUT=""

# Run the comparator and assert its exit code. Every case states the code it expects, because the
# three codes are the contract (normalization.md §6): 0 holds, 1 fails, 2 usage/input error.
run_case() {
  local want="$1" label="$2"; shift 2
  local rc=0
  set +e
  LAST_OUT="$(bash "$PARITY/parity-check.sh" "$@" 2>&1)"
  rc=$?
  set -e
  if [ "$rc" != "$want" ]; then
    printf 'selfcheck: %s — expected exit %s, got %s\n%s\n' "$label" "$want" "$rc" "$LAST_OUT" >&2
    exit 1
  fi
}

expect() {
  local label="$1" needle="$2"
  case "$LAST_OUT" in
    *"$needle"*) : ;;
    *) printf 'selfcheck: %s — output did not contain %s\n%s\n' "$label" "$needle" "$LAST_OUT" >&2
       exit 1 ;;
  esac
}

refute() {
  local label="$1" needle="$2"
  case "$LAST_OUT" in
    *"$needle"*) printf 'selfcheck: %s — output unexpectedly contained %s\n%s\n' \
                   "$label" "$needle" "$LAST_OUT" >&2
                 exit 1 ;;
    *) : ;;
  esac
}

# --- 0. syntax -----------------------------------------------------------------------------------
bash -n "$PARITY/parity-check.sh"

# --- 1. self-parity: the contract accepts the capture it was written from (checks.md Check 1) -----
run_case 0 'self-parity' "$BASELINE" "$BASELINE"
expect 'self-parity' 'compared 6 command line(s) across 6 unit(s); 0 out of scope.'
expect 'self-parity' 'parity holds'

# --- 2. one mutated compared-class token is rejected BY NAME (checks.md Check 2) ------------------
run_case 1 'mutated image ref' "$BASELINE" "$TESTDATA/mutated-image-ref.stdout.txt"
expect 'mutated image ref' "diverging token at position 8 — baseline 'fleet-ab:armA', candidate 'fleet-ab:armB'."
expect 'mutated image ref' 'parity FAILED — 1 diverging finding(s).'

# --- 3. arm-scoping plus four ignored classes at once (checks.md Check 3) -------------------------
run_case 0 'extra arm R1' "$BASELINE" "$TESTDATA/extra-arm-r1.stdout.txt"
expect 'extra arm R1' "out of scope — unit 'pilot:R1' has no baseline counterpart arm 'R1'"
expect 'extra arm R1' 'parity holds'

# --- 4. a surplus TRAILING EMPTY token is a divergence, not a pass --------------------------------
# The regression this pins: comparing values alone made "" == "" and passed a different argv.
run_case 1 'surplus empty token' "$BASELINE" "$TESTDATA/surplus-empty-token.stdout.txt"
expect 'surplus empty token' "candidate has a surplus token at position 18 — ''."
refute 'surplus empty token' 'parity holds'

# --- 5. a unit carrying more than one line still reaches a verdict --------------------------------
# The regression this pins: the multiset-pairing re-pack wiped its own array and the run aborted
# under `set -u` with NO verdict line at all — neither "parity holds" nor "parity FAILED".
run_case 0 'two-line unit, self' "$TESTDATA/two-line-unit.stdout.txt" "$TESTDATA/two-line-unit.stdout.txt"
expect 'two-line unit, self' 'compared 4 command line(s) across 3 unit(s); 0 out of scope.'
expect 'two-line unit, self' 'parity holds'
refute 'two-line unit, self' 'unbound variable'

# --- 6. a two-line unit reordered across a different kit root still pairs off (§4.1, §4.4) --------
run_case 0 'two-line unit, reordered' \
  "$TESTDATA/two-line-unit.stdout.txt" "$TESTDATA/two-line-unit-reordered.stdout.txt"
expect 'two-line unit, reordered' 'parity holds'

# --- 7. a missing baseline unit fails (§3.10) ----------------------------------------------------
MISSING_UNIT="$SCRATCH/missing-analyze.stdout.txt"
grep -v '/analyze\.sh ' "$BASELINE" > "$MISSING_UNIT"
run_case 1 'missing unit' "$BASELINE" "$MISSING_UNIT"
expect 'missing unit' "unit 'analyze:both' is present in the baseline and absent from the candidate"

# --- 8. a duplicated unit fails on line count (§3.9) ---------------------------------------------
DUP_UNIT="$SCRATCH/duplicate-gate-a.stdout.txt"
cp "$BASELINE" "$DUP_UNIT"
grep 'results/gate-A:' "$BASELINE" >> "$DUP_UNIT"
run_case 1 'duplicate unit' "$BASELINE" "$DUP_UNIT"
expect 'duplicate unit' "unit 'gate:A': line count differs — baseline 1, candidate 2"

# --- 9. the double-quote escape set stays restricted (§2 N1) --------------------------------------
# Collapsing every \X inside "…" would make `\9c99498` and `9c99498` normalize alike.
DQ="$SCRATCH/dq-escape.stdout.txt"
sed 's|--workload-ref 9c99498 --fake-scripts fake-scripts.json --umbrella-id WF-405|--workload-ref "\\9c99498" --fake-scripts fake-scripts.json --umbrella-id WF-405|' \
  "$BASELINE" > "$DQ"
run_case 1 'restricted dq escapes' "$BASELINE" "$DQ"
expect 'restricted dq escapes' "baseline '9c99498', candidate '\\9c99498'."

# --- 10. /tmp reduction keeps the staged basename compared (§2 N3, §4.5) --------------------------
# Only the per-run random DIRECTORY is ignored; the basename can carry arm identity, which §3.6
# declares compared.
KROOT='/opt/kit/fleet-ab'
TMP_A="$SCRATCH/tmp-a.stdout.txt"
TMP_B="$SCRATCH/tmp-b.stdout.txt"
{
  printf '    bash %s/build-arm.sh --both\n' "$KROOT"
  printf '    docker run --rm -v /tmp/stage-1111/manifest-armA.json:/work/manifest.json -v %s/results/run-A:/work/run-output fleet-ab:armA --arm A\n' "$KROOT"
} > "$TMP_A"
{
  printf '    bash %s/build-arm.sh --both\n' "$KROOT"
  printf '    docker run --rm -v /tmp/stage-9999/manifest-armB.json:/work/manifest.json -v %s/results/run-A:/work/run-output fleet-ab:armA --arm A\n' "$KROOT"
} > "$TMP_B"
run_case 1 '/tmp basename compared' "$TMP_A" "$TMP_B"
expect '/tmp basename compared' "baseline '<tmp>/manifest-armA.json:/work/manifest.json'"

# The random directory itself is still ignored: same basename, different stage dir, parity holds.
TMP_C="$SCRATCH/tmp-c.stdout.txt"
sed 's|/tmp/stage-1111/|/tmp/stage-4242/|' "$TMP_A" > "$TMP_C"
run_case 0 '/tmp random dir ignored' "$TMP_A" "$TMP_C"
expect '/tmp random dir ignored' 'parity holds'

# --- 11. findings outrank the empty-surface guard: exit 1 with a verdict, never exit 2 ------------
# A kit root containing ':' defeats N3's field split, so every line is unclassifiable: the run
# produces FAIL findings AND compares nothing. That must still be a parity failure, not an input
# error, or a caller routing on exit codes files a real divergence as a tooling problem.
COLON="$SCRATCH/colon-root.stdout.txt"
sed 's|/opt/kit/fleet-ab|/opt/od:d/fleet-ab|g' "$TMP_A" > "$COLON"
run_case 1 'findings outrank empty surface' "$COLON" "$COLON"
expect 'findings outrank empty surface' 'unclassifiable command line'
expect 'findings outrank empty surface' 'parity FAILED'
refute 'findings outrank empty surface' 'refusing to report parity over an empty surface'

# --- 12. a control sequence in a candidate token cannot rewrite the terminal ----------------------
ESC=$'\033'
CR=$'\r'
CTRL_BASE="$SCRATCH/ctrl-base.stdout.txt"
CTRL_CAND="$SCRATCH/ctrl-cand.stdout.txt"
{
  printf '    bash %s/build-arm.sh --both\n' "$KROOT"
  printf '    docker run --rm -v %s/results/run-A:/work/run-output X\n' "$KROOT"
} > "$CTRL_BASE"
{
  printf '    bash %s/build-arm.sh --both\n' "$KROOT"
  printf '    docker run --rm -v %s/results/run-A:/work/run-output %s[2K%sX\n' "$KROOT" "$ESC" "$CR"
} > "$CTRL_CAND"
run_case 1 'control sequence rendered inert' "$CTRL_BASE" "$CTRL_CAND"
expect 'control sequence rendered inert' "candidate '?[2K?X'."
refute 'control sequence rendered inert' "$ESC"

# --- 13. the declared per-line bound is enforced as an input error (§6, §7) -----------------------
LONG="$SCRATCH/over-long-line.stdout.txt"
PAD="$(printf 'x%.0s' $(seq 1 9000))"
{
  printf '    bash %s/build-arm.sh --both\n' "$KROOT"
  printf '    docker run --rm -v %s/results/run-A:/work/run-output fleet-ab:armA --pad %s\n' "$KROOT" "$PAD"
} > "$LONG"
run_case 2 'per-line bound' "$LONG" "$LONG"
expect 'per-line bound' 'over the 8192-character per-line bound'

# --- 14. usage surface: --help, arity, unknown option ---------------------------------------------
run_case 0 'help' --help
expect 'help' 'usage: parity-check.sh <baseline-stdout> <candidate-stdout>'

run_case 2 'arity' "$BASELINE"
expect 'arity' 'usage: parity-check.sh'

run_case 2 'unknown option' --dry-run "$BASELINE" "$BASELINE"
expect 'unknown option' "unknown argument '--dry-run'"

run_case 2 'unreadable input' "$BASELINE" "$SCRATCH/does-not-exist.stdout.txt"
expect 'unreadable input' 'cannot read'

printf '%s\n' 'parity selfcheck: PASS'
