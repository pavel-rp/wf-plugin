#!/usr/bin/env bash
# selfcheck.sh — the one exact, placeholder-free acceptance command for the fleet-two-task fixture.
#
# Run it with no arguments:
#
#     bash plugins/wf-sandbox-testing/fixtures/fleet-two-task/selfcheck.sh
#
# It fails closed: any missing evidence, any pipeline error, or any expected-failure case that does
# NOT fail, aborts with a non-zero exit. It regenerates the synthetic bundle in a throwaway scratch
# dir under _local/scratch/ and removes it on exit — nothing outside that scratch dir is written.
#
# What it proves (WF-401 outcomes):
#   - determinism + immutable baseline B: a fresh measure reproduces reference/baseline-B.json byte-for-byte.
#   - structural evidence: a fresh evidence run reproduces reference/evidence.json and its assertions
#     (exactly two children, five audit lenses, the full required role mix) hold.
#   - directional 10% band: candidate C compares in-band to baseline B (structure/shape exact).
#   - out-of-band fail-closed: an output-inflated candidate breaches the band (non-zero exit).
#   - missing-input fail-closed: measuring an absent bundle exits non-zero rather than passing empty.
#   - no raw transcripts committed (outcome 9): the tracked fixture carries only derived evidence.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SRC_DIR/../../../.." && pwd)"
FLEET_COST="$SRC_DIR/../../accounting/fleet-cost.mjs"
GEN="$SRC_DIR/generate-bundle.mjs"
REF="$SRC_DIR/reference"
SESSION="fleet-two-task-synthetic"
REQUIRED_ROLES="ship orchestrator,spec/plan/triage,implement,verify-spec/fix,audit lens,qa,bookkeeping"

SCRATCH="$REPO_ROOT/_local/scratch/fleet-two-task-selfcheck-$$"
mkdir -p "$SCRATCH"
# shellcheck disable=SC2064
trap "rm -rf '$SCRATCH'" EXIT

fail() { echo "selfcheck: FAIL — $1" >&2; exit 1; }

for f in baseline-B.json candidate-C.json evidence.json; do
  [ -f "$REF/$f" ] || fail "missing committed reference evidence: reference/$f"
done

# 1. Determinism vs the immutable baseline B.
PROJ="$SCRATCH/projects"
node "$GEN" --out "$PROJ" >/dev/null
node "$FLEET_COST" measure --session "$SESSION" --root "$PROJ" --capture-date 2026-07-22 --output "$SCRATCH/actual.json"
diff -q "$SCRATCH/actual.json" "$REF/baseline-B.json" >/dev/null || fail "fresh measure diverged from the immutable baseline reference/baseline-B.json"
echo "selfcheck: [1/6] measure reproduces baseline-B byte-for-byte"

# 2. Structural evidence + fail-closed assertions.
node "$FLEET_COST" evidence --session "$SESSION" --root "$PROJ" --repo-root "$PROJ" \
  --expect-children 2 --expect-lenses 5 --expect-roles "$REQUIRED_ROLES" --output "$SCRATCH/evidence.json"
diff -q "$SCRATCH/evidence.json" "$REF/evidence.json" >/dev/null || fail "fresh evidence diverged from reference/evidence.json"
echo "selfcheck: [2/6] evidence reproduces reference + asserts 2 children / 5 lenses / full role mix"

# 3. Directional 10% band: candidate C in-band vs baseline B.
node "$FLEET_COST" compare --actual "$REF/candidate-C.json" --reference "$REF/baseline-B.json" --band 0.10 >/dev/null \
  || fail "candidate-C is not within the ±10% band of baseline-B"
echo "selfcheck: [3/6] candidate-C compares in-band (±10%, structure/shape exact) to baseline-B"

# 4. Out-of-band fail-closed: an output-inflated candidate MUST breach the band.
INFL="$SCRATCH/inflated"
node "$GEN" --out "$INFL" --inflate-output 1.2 >/dev/null
node "$FLEET_COST" measure --session "$SESSION" --root "$INFL" --capture-date 2026-07-22 --output "$SCRATCH/inflated.json"
if node "$FLEET_COST" compare --actual "$SCRATCH/inflated.json" --reference "$REF/baseline-B.json" --band 0.10 >/dev/null 2>&1; then
  fail "an output-inflated candidate passed the ±10% band — the band is not enforced"
fi
echo "selfcheck: [4/6] output-inflated candidate correctly breaches the band (fail-closed)"

# 5. Missing-input fail-closed.
if node "$FLEET_COST" measure --session "$SESSION" --root "$SCRATCH/absent" --output "$SCRATCH/missing.json" >/dev/null 2>&1; then
  fail "measuring an absent bundle succeeded — the tool does not fail closed on missing evidence"
fi
echo "selfcheck: [5/6] measuring an absent bundle fails closed"

# 6. Raw-transcript guard (outcome 9): the tracked fixture must carry no raw transcript bundle.
LEAKED="$(git -C "$REPO_ROOT" ls-files 'plugins/wf-sandbox-testing/fixtures/fleet-two-task/**/*.jsonl' 'plugins/wf-sandbox-testing/fixtures/fleet-two-task/*.jsonl' || true)"
[ -z "$LEAKED" ] || fail "raw transcript(s) are tracked under the fixture (outcome 9 forbids committing them): $LEAKED"
echo "selfcheck: [6/6] no raw transcripts are tracked — only derived evidence is committed"

echo "selfcheck: PASS — fleet-two-task fixture acceptance holds"
