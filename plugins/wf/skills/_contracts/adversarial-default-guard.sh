#!/usr/bin/env bash
#
# adversarial-default-guard.sh — core lean adversarial default regression guard.
#
# Asserts the four properties the core adversarial default is accepted on, and the
# three it must NOT acquire:
#
#   1. verify-spec carries the lean adversarial pass, naming both closed defect
#      classes, the two-sided citation rule, and the explicit suppression list.
#   2. The pass reports rather than gates — no new stop, prompt, or gate — and the
#      grepped `VERIFY —` final-output block shape is unchanged.
#   3. The pass adds no dispatch: it names no Task/subagent invocation of its own,
#      so verify-dispatch-cost-guard.sh's invariants cannot be weakened by it.
#   4. The pass names no capability, and the three fixtures exist and carry their
#      declared markers (empty registry with zero rows; a defect-bearing change
#      citing both sides of both classes; a paired defect-free change expecting zero).
#
# Model: claude-opus-5[1m]
#
# Usage:
#   bash plugins/wf/skills/_contracts/adversarial-default-guard.sh

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
VERIFY="$ROOT/plugins/wf/skills/verify-spec/SKILL.md"
TEMPLATE="$ROOT/plugins/wf/skills/verify-spec/references/verify-template.md"
RATIONALE="$ROOT/plugins/wf/skills/verify-spec/references/adversarial-pass.md"
EMPTY_REG="$ROOT/plugins/wf/skills/_contracts/registry-fixtures/pass-empty.md"
FIX_DIR="$ROOT/plugins/wf/skills/_contracts/adversarial-fixtures"
DEFECTIVE="$FIX_DIR/defective-change.md"
CLEAN="$FIX_DIR/clean-change.md"
fail=0

report_fail() {
  printf 'FAIL: %s\n' "$1"
  fail=1
}

need() {
  # need <file> <label> <fixed-string>
  if ! grep -qF "$3" "$1"; then
    report_fail "$2"
  fi
}

# --- 1. The pass exists and is fully specified --------------------------------
need "$VERIFY" "verify-spec must carry the lean adversarial pass section" \
  '## The lean adversarial pass'
need "$VERIFY" "the pass must name the out-of-range bound class" \
  '**Out-of-range bound**'
need "$VERIFY" "the pass must name the unstated-assumption class" \
  '**Unstated assumption behind a derivation**'
need "$VERIFY" "the class list must be declared closed" \
  'this list is closed'
need "$VERIFY" "the pass must carry the two-sided citation rule" \
  '### The two-sided citation rule'
need "$VERIFY" "the pass must reject absence-as-evidence" \
  'an absence is not a citation'
need "$VERIFY" "the pass must reject speculation" \
  'a speculation'
need "$VERIFY" "the pass must state that a clean change is the expected result" \
  'is this pass working correctly, not failing'

# --- 2. It reports; it does not gate ------------------------------------------
need "$VERIFY" "the pass must declare itself non-gating" \
  'It reports; it does not gate.'
need "$VERIFY" "the pass must state it adds no new stop, prompt, or gate" \
  'no stop, no prompt, and no gate'

# The grepped final-output block shape must be byte-identical.
if ! grep -q '^VERIFY — <PASS | FAIL | PARTIAL>$' "$VERIFY"; then
  report_fail "the grepped VERIFY final-output block shape changed"
fi
if ! grep -q 'requirements, capability findings <none | N across M capabilities>' "$VERIFY"; then
  report_fail "the VERIFY block's second line changed"
fi

# --- 3. It adds no dispatch ----------------------------------------------------
# Extract just the pass section and prove it invokes nothing. Both the start heading
# and the terminator must exist: without the terminator the awk range would run to EOF
# and sweep in the dispatch section, misattributing its tokens to this one.
if ! grep -q '^## Fire the `verify` phase' "$VERIFY"; then
  report_fail "the pass section's terminator heading is missing — extraction would overrun"
fi

section="$(awk '/^## The lean adversarial pass$/{f=1} /^## Fire the `verify` phase/{f=0} f' "$VERIFY")"

if [ -z "$section" ]; then
  report_fail "could not extract the lean adversarial pass section"
fi

case "$section" in
  *'subagent_type'*|*'Task tool'*|*'invoke one Task'*|*'resolve_routing'*)
    report_fail "the lean adversarial pass must add no routing or Task dispatch" ;;
esac

if ! printf '%s' "$section" | grep -qF 'It adds no dispatch.'; then
  report_fail "the pass must state that it adds no dispatch"
fi
if ! printf '%s' "$section" | grep -qF 'runs inline, in this skill'; then
  report_fail "the pass must state that it runs inline in the caller's context"
fi

# --- 4. Core names no capability; the fixtures exist ---------------------------
# The pass section must name no capability shipped in this marketplace. The list is
# DERIVED from the tree, never transcribed — a hardcoded list silently stops covering
# every pack added after it was written.
caps_checked=0
for cap_dir in "$ROOT"/plugins/*/capabilities/*/; do
  [ -d "$cap_dir" ] || continue
  cap="$(basename "$cap_dir")"
  caps_checked=$((caps_checked + 1))
  case "$section" in
    *"\`$cap\`"*)
      report_fail "the lean adversarial pass names the capability '$cap' (Core Article 8)" ;;
  esac
done

if [ "$caps_checked" -eq 0 ]; then
  report_fail "derived zero capability names — the capability-noun check would pass vacuously"
fi

need "$VERIFY" "the pass must state that dedup against registered contributors is out of scope" \
  'is out of scope here'

need "$TEMPLATE" "the report shape must declare the Adversarial findings section" \
  '## Adversarial findings'
need "$TEMPLATE" "the Adversarial findings section must be omitted on a clean change" \
  'omit the whole section on a clean change'

if [ ! -f "$RATIONALE" ]; then
  report_fail "the paired rationale reference adversarial-pass.md is missing"
fi

# Empty-registry fixture: a Capabilities table with a header and ZERO rows.
if [ ! -f "$EMPTY_REG" ]; then
  report_fail "the purpose-built empty-registry fixture is missing"
else
  if ! grep -q '^## Capabilities$' "$EMPTY_REG"; then
    report_fail "the empty-registry fixture has no ## Capabilities heading"
  fi
  # Data rows only: table lines that are neither the header nor the `---` separator.
  rows="$(grep -E '^\|' "$EMPTY_REG" | grep -vcE '^\|[[:space:]]*(Capability|-)')"
  if [ "$rows" -ne 0 ]; then
    report_fail "the empty-registry fixture must carry zero capability rows (found $rows)"
  fi
fi

# Defect-bearing fixture: both classes, each with both citation sides.
if [ ! -f "$DEFECTIVE" ]; then
  report_fail "the defect-bearing fixture is missing"
else
  need "$DEFECTIVE" "the defect fixture must carry the bound class" 'EXPECT: class=bound'
  need "$DEFECTIVE" "the defect fixture must carry the assumption class" 'EXPECT: class=assumption'
  changed_sides="$(grep -c '^EXPECT: changed-side=' "$DEFECTIVE")"
  existing_sides="$(grep -c '^EXPECT: existing-side=' "$DEFECTIVE")"
  if [ "$changed_sides" -ne 2 ] || [ "$existing_sides" -ne 2 ]; then
    report_fail "the defect fixture must cite both sides of both classes (got $changed_sides/$existing_sides)"
  fi
fi

# Defect-free fixture: expects zero findings.
if [ ! -f "$CLEAN" ]; then
  report_fail "the paired defect-free fixture is missing"
else
  # Both checks anchor identically, so the negative one cannot go inert while the
  # positive one still passes on a differently-shaped marker.
  if ! grep -q '^EXPECT: findings=0$' "$CLEAN"; then
    report_fail "the clean fixture must expect zero findings on a bare EXPECT line"
  fi
  if grep -q '^EXPECT: class=' "$CLEAN"; then
    report_fail "the clean fixture must declare no defect class"
  fi
fi

if [ "$fail" -ne 0 ]; then
  exit 1
fi

printf 'PASS: lean adversarial pass present — both classes, two-sided citation, suppression list\n'
printf 'PASS: pass reports without gating; VERIFY block shape unchanged\n'
printf 'PASS: pass adds no routing or Task dispatch and names no capability\n'
printf 'PASS: empty-registry, defect-bearing and defect-free fixtures intact\n'
