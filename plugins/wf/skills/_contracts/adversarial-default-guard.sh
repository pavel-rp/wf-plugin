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
# WF-486 adds the fifth property — the reconciliation between the core default and a
# registered contributor:
#
#   5. The rule exists, is stated over the contribution taxonomy (never a capability
#      noun), adds no dispatch, and is ONE-DIRECTIONAL: it may withdraw or annotate a
#      core candidate but may never drop, edit or withhold a contributed finding, so
#      the lenses' provenance-tagged findings survive registration. Both overlap
#      outcomes (withdraw / retain-both) are pinned, a failed contributor cannot cause
#      a withdrawal, and the one-row registry plus its two expectation fixtures exist.
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
CONSUMER="$ROOT/plugins/wf/skills/verify-fix/SKILL.md"
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

# "Closed at two classes" must be ENFORCED, not merely asserted in prose — otherwise a
# third class could be added and every other assertion here would still pass.
class_count="$(printf '%s' "$section" | grep -cE '^[0-9]+\. \*\*')"
if [ "$class_count" -ne 2 ]; then
  report_fail "the defect-class list must stay closed at exactly 2 (found $class_count)"
fi

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

# WF-486 (C029 OUT-4): the pass section still compares nothing — the reconciliation
# happens after the phase, where both sets are in hand. The section-scoped capability-noun
# check above already covers the pass; assert the same for the reconciliation section, which
# is where a capability name would be most tempting to write.
need "$VERIFY" "the pass section must still defer the comparison" \
  'compares nothing. They are reconciled against the phase below'

# --- 5. The reconciliation rule (WF-486) ---------------------------------------
need "$VERIFY" "verify-spec must carry the reconciliation section" \
  '### Reconcile against the lean pass'

if ! grep -q '^### Reconcile against the lean pass$' "$VERIFY"; then
  report_fail "the reconciliation section heading is missing — extraction would overrun"
fi
# Both ends must exist, for the same reason the pass section asserts its terminator:
# without it the awk range runs to EOF and every section-scoped check below goes silent.
if [ "$(grep -c '^## Output$' "$VERIFY")" -ne 1 ]; then
  report_fail "the reconciliation section's terminator heading is missing — extraction would overrun"
fi

recon="$(awk '/^### Reconcile against the lean pass$/{f=1} /^## Output$/{f=0} f' "$VERIFY")"

if [ -z "$recon" ]; then
  report_fail "could not extract the reconciliation section"
fi

# Core Article 8: the rule is stated over the contribution taxonomy, never over a
# capability noun. Derived from the tree for the same reason as the check above.
for cap_dir in "$ROOT"/plugins/*/capabilities/*/; do
  [ -d "$cap_dir" ] || continue
  cap="$(basename "$cap_dir")"
  case "$recon" in
    *"\`$cap\`"*)
      report_fail "the reconciliation rule names the capability '$cap' (Core Article 8)" ;;
  esac
done

# It compares two sets already in hand — it must not acquire dispatch of its own either.
case "$recon" in
  *'subagent_type'*|*'Task tool'*|*'invoke one Task'*|*'resolve_routing'*)
    report_fail "the reconciliation rule must add no routing or Task dispatch" ;;
esac

# Obligation 1: the reconciliation may only ever act on the CORE side. Without this the
# rule could be "fixed" by dropping lens findings, which is the exact regression OUT-4
# forbids — the five lenses' findings must still appear.
if ! printf '%s' "$recon" | grep -qF '**One-directional.**'; then
  report_fail "the reconciliation rule must declare itself one-directional"
fi
if ! printf '%s' "$recon" | grep -qF 'never dropped, edited, re-tagged, merged, reordered, or withheld'; then
  report_fail "the reconciliation rule must protect contributed findings verbatim"
fi
if ! printf '%s' "$recon" | grep -qF 'can never cause a withdrawal'; then
  report_fail "a failed or empty contributor must never be able to withdraw a core candidate"
fi

# Obligation 2: BOTH outcomes must survive. Keeping only "withdraw" silently collapses a
# genuine second perspective; keeping only "retain" duplicates. The success measure needs
# both, so assert both rather than the section merely existing.
if ! printf '%s' "$recon" | grep -qF '**withdraw**'; then
  report_fail "the reconciliation rule must specify the withdraw outcome"
fi
if ! printf '%s' "$recon" | grep -qF '**retain both**'; then
  report_fail "the reconciliation rule must specify the retain-both outcome"
fi
if ! printf '%s' "$recon" | grep -qF 'never silently collapsed or doubled'; then
  report_fail "an overlap must be visible, not silently collapsed or doubled"
fi
# The overlap test must stay citation-anchored, matching the two-sided citation rule.
if ! printf '%s' "$recon" | grep -qF 'changed-side'; then
  report_fail "the overlap test must be anchored on the candidate's changed-side citation"
fi

# The incomplete-coverage obligation: silence is not cleanliness.
need "$VERIFY" "a failed contributor must mark the adversarial coverage incomplete" \
  'mark the adversarial coverage **incomplete**'
need "$VERIFY" "a failed contributor must be stated with its provenance" \
  'contributed nothing *and is not clean*'

# The reconciliation set: the audit-registered and lens-failure expectations over the SAME
# defect-bearing change, against the purpose-built one-row registry.
AUDIT_REG="$ROOT/plugins/wf/skills/_contracts/registry-fixtures/pass-audit-only.md"
REGISTERED="$FIX_DIR/audit-registered.md"
LENS_FAIL="$FIX_DIR/lens-failure.md"

if [ ! -f "$AUDIT_REG" ]; then
  report_fail "the purpose-built one-capability registry fixture is missing"
else
  if ! grep -q '^## Capabilities$' "$AUDIT_REG"; then
    report_fail "the audit-only registry fixture has no ## Capabilities heading"
  fi
  # Exactly ONE data row — the whole point of the fixture. This repo's own eight-row
  # registry would pollute the non-duplication comparison. Scope the count to the
  # `## Capabilities` table: the fixture's prose carries other tables, and counting those
  # too would make this assertion depend on how the prose happens to be formatted.
  areg_rows="$(awk '/^## Capabilities$/{f=1; next} /^## /{f=0} f' "$AUDIT_REG" \
    | grep -E '^\|' | grep -vcE '^\|[[:space:]]*(Capability|-)')"
  if [ "$areg_rows" -ne 1 ]; then
    report_fail "the audit-only registry fixture must carry exactly one capability row (found $areg_rows)"
  fi
fi

if [ ! -f "$REGISTERED" ]; then
  report_fail "the contributor-registered expectations fixture is missing"
else
  # Same change, different registry — assert the shared input explicitly, or the two runs
  # stop being a comparison.
  need "$REGISTERED" "the registered fixture must reuse the same defect-bearing change" \
    'defective-change.md'
  need "$REGISTERED" "the registered fixture must reuse the empty-registry control" \
    'pass-empty.md'
  need "$REGISTERED" "the registered fixture must assert the fan-out is unchanged" \
    'EXPECT: fanout=5'
  need "$REGISTERED" "the registered fixture must assert lens findings survive" \
    'EXPECT: lens-findings=preserved'
  need "$REGISTERED" "the registered fixture must assert lens provenance is tagged" \
    'EXPECT: lens-provenance=tagged'
  need "$REGISTERED" "the registered fixture must assert the withdraw case" \
    'EXPECT: case=withdraw'
  need "$REGISTERED" "the registered fixture must assert the retain-both case" \
    'EXPECT: case=retain-both'
  need "$REGISTERED" "the registered fixture must assert the no-overlap case" \
    'EXPECT: case=no-overlap'
fi

if [ ! -f "$LENS_FAIL" ]; then
  report_fail "the contributor-failure fixture is missing"
else
  need "$LENS_FAIL" "the failure fixture must assert the failure is stated with provenance" \
    'EXPECT: failure-provenance=stated'
  need "$LENS_FAIL" "the failure fixture must assert the pass is marked incomplete" \
    'EXPECT: coverage=incomplete'
  need "$LENS_FAIL" "the failure fixture must distinguish an empty return from a failure" \
    'EXPECT: empty-return=clean'
  need "$LENS_FAIL" "the failure fixture must block withdrawal on a failed contributor" \
    'EXPECT: withdrawal=blocked-on-failure'
fi

need "$TEMPLATE" "the report shape must declare the Adversarial findings section" \
  '## Adversarial findings'
need "$TEMPLATE" "the Adversarial findings section must be omitted on a clean change" \
  'omit the whole section on a clean change'

if [ ! -f "$RATIONALE" ]; then
  report_fail "the paired rationale reference adversarial-pass.md is missing"
fi

# The report's downstream consumer must declare the new section explicitly, so it is
# skipped by contract rather than dropped silently.
need "$CONSUMER" "the report consumer must declare the Adversarial findings section" \
  '## Adversarial findings'

# Empty-registry fixture: a Capabilities table with a header and ZERO rows.
if [ ! -f "$EMPTY_REG" ]; then
  report_fail "the purpose-built empty-registry fixture is missing"
else
  if ! grep -q '^## Capabilities$' "$EMPTY_REG"; then
    report_fail "the empty-registry fixture has no ## Capabilities heading"
  fi
  # The zero-rows count alone passes vacuously if the table body is deleted outright,
  # so assert the header POSITIVELY first — "a header and zero rows", not "no table".
  if ! grep -qE '^\|[[:space:]]*Capability[[:space:]]*\|' "$EMPTY_REG"; then
    report_fail "the empty-registry fixture must keep its Capabilities table header row"
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
printf 'PASS: reconciliation is one-directional, dispatch-free and names no capability\n'
printf 'PASS: both overlap outcomes pinned; a failed contributor withdraws nothing\n'
printf 'PASS: one-row registry plus registered/lens-failure expectation fixtures intact\n'
