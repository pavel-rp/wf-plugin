#!/usr/bin/env bash
# certified-commit-guard.sh — the certified-commit contract must keep its whole
# outcome set, its one-re-verify-per-drift-event bound, and its consumer wiring.
#
# A /wf:verify-spec PASS binds to the tree it audited (certified-commit.ops.md).
# A guarded push path runs the drift check before its guarded action and acts on
# exactly one outcome. The failure mode is silent: an edit that drops the
# `refuse` outcome, the fail-closed clause, or the one-per-event bound leaves
# every other guard green while re-opening the post-PASS escape the contract
# closes. So this guard asserts, on the ops doc:
#
#   O1  all five outcome tokens: inert, bound, carried, reverify, refuse;
#   O2  all three refuse reasons: uncertified, reverified-fail, unreadable;
#   O3  the closed change-kind set: base-sync, version-bump, code;
#   O4  the re-verify runs exactly once and the check is not re-entered;
#   O5  the one-re-verify-per-drift-event bound is stated;
#   O6  fail closed on an unreadable record;
#   O7  drift residuals and carried requirement items are defined;
#   O8  the doc stays within the 150-line runtime ops budget;
#   O9  no host, vendor, or version-control tool noun appears.
#
# and on the consumers:
#
#   W1  the verify template renders the Certified and Drift re-verify lines;
#   W2  verify-spec points at the ops doc and the drift ledger;
#   W3  /wf:pr runs the drift check in Phase 2.2 and may invoke the Skill tool;
#   W4  the paired rationale doc exists.
#
# --selftest runs the ops-doc evaluator over seeded synthetic docs and requires
# it to REJECT each defective one (exit 1, never a harness error) and ACCEPT the
# sound one.
#
# Usage:  bash certified-commit-guard.sh              # live-tree scan (what CI runs)
#         bash certified-commit-guard.sh --selftest   # seeded fixtures only
#
# Exit 0 = conforms; exit 1 = at least one violation; exit 2 = a target is missing.
#
# Model: claude-opus-5-5
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"

err() { printf 'certified-commit-guard: %s\n' "$*" >&2; }

BANNED_NOUNS='github|gitlab|bitbucket|\bgit\b|\bsvn\b|mercurial|\bhg\b|rev-parse|write-tree|stash create'

# require <file> <label> <rule-id> <description> <extended-regex>
require() {
  local file="$1" label="$2" rule="$3" desc="$4" pattern="$5"
  if grep -qE "$pattern" "$file"; then
    return 0
  fi
  printf '%s: [%s] %s — no line matches /%s/\n' "$label" "$rule" "$desc" "$pattern"
  return 1
}

# evaluate_ops <file> <label> — applies O1..O9; returns 1 on any violation.
evaluate_ops() {
  local file="$1" label="$2" bad=0 tok n

  for tok in inert bound carried reverify refuse; do
    if ! grep -qE "\*\*.${tok}.\*\*" "$file"; then
      printf '%s: [O1] outcome `%s` is not defined as a bold outcome token\n' "$label" "$tok"
      bad=1
    fi
  done
  for tok in uncertified reverified-fail unreadable; do
    if ! grep -qE "\(.${tok}." "$file"; then
      printf '%s: [O2] refuse reason `%s` is absent\n' "$label" "$tok"
      bad=1
    fi
  done
  for tok in base-sync version-bump code; do
    if ! grep -qE "^[0-9]+\. \*\*.${tok}.\*\*" "$file"; then
      printf '%s: [O3] change kind `%s` is not a numbered entry of the closed set\n' "$label" "$tok"
      bad=1
    fi
  done
  require "$file" "$label" O4 'the re-verify runs exactly once' '\*\*exactly once\*\*' || bad=1
  require "$file" "$label" O4b 'the re-check never re-enters the re-verify step' 'without re-entering step' || bad=1
  require "$file" "$label" O5 'the one-re-verify-per-drift-event bound is stated' '\*\*One re-verify per drift event\.\*\*' || bad=1
  require "$file" "$label" O5b 'the total is bounded by the drift events' 'never exceeds the number of drift events' || bad=1
  require "$file" "$label" O6 'unreadable state fails closed' 'Fail closed' || bad=1
  require "$file" "$label" O7 'drift residuals are defined' 'drift residual' || bad=1
  require "$file" "$label" O7b 'carried requirement items are defined' '\(carried from' || bad=1

  n=$(wc -l <"$file")
  if [ "$n" -gt 150 ]; then
    printf '%s: [O8] %d lines exceeds the 150-line runtime ops budget; move rationale to the paired contract doc\n' "$label" "$n"
    bad=1
  fi

  n=$(grep -icE "$BANNED_NOUNS" "$file")
  if [ "$n" -ne 0 ]; then
    printf '%s: [O9] %d line(s) name a host, vendor, or version-control tool; core describes outcomes only\n' "$label" "$n"
    grep -inE "$BANNED_NOUNS" "$file" | head -5
    bad=1
  fi

  [ "$bad" -eq 0 ] || return 1
  printf '%s: OK — five outcomes, three refuse reasons, closed kind set, single re-verify, per-event bound, fail-closed, residuals, budget, no tool nouns\n' "$label"
  return 0
}

# --- self-test --------------------------------------------------------------

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT

  sound_doc() {
    cat <<'SOUND'
Fail closed: an unreadable record is `refuse` (`unreadable`).

1. **`base-sync`** — carry-forward.
2. **`version-bump`** — carry-forward.
3. **`code`** — needs a re-verify.

1. No report → **`inert`**.
2. Unbound → **`refuse`**: reason `reverified-fail` (`reverified-fail`), else (`uncertified`).
3. Same tree → **`bound`**.
4. Carry-forward kind → **`carried`**.
5. `code` → **`reverify`**: invoke the audit **exactly once**, then re-run this check once without re-entering step 5.

**One re-verify per drift event.** The total never exceeds the number of drift events.

A drift residual renders as an accepted warning; an untouched item is (carried from <A>).
SOUND
  }

  sound_doc >"$tmp/sound.md"
  sound_doc | grep -v '→ \*\*`refuse`\*\*' >"$tmp/no-refuse.md"
  sound_doc | sed 's/\*\*exactly once\*\*/as often as needed/' >"$tmp/unbounded-reverify.md"
  sound_doc | sed 's/\*\*One re-verify per drift event\.\*\*//' >"$tmp/no-per-event.md"
  sound_doc | sed 's/Fail closed/Proceed/' >"$tmp/fail-open.md"
  sound_doc | grep -v 'version-bump' >"$tmp/no-kind.md"
  sound_doc | sed 's/(`uncertified`)/(no reason)/' >"$tmp/no-reason.md"
  sound_doc >"$tmp/tool-noun.md"
  printf 'Compute the tree with git write-tree.\n' >>"$tmp/tool-noun.md"
  sound_doc >"$tmp/over-budget.md"
  i=0
  while [ "$i" -lt 150 ]; do printf 'padding\n' >>"$tmp/over-budget.md"; i=$((i + 1)); done

  selftest_fail=0
  for case in no-refuse unbounded-reverify no-per-event fail-open no-kind no-reason tool-noun over-budget; do
    evaluate_ops "$tmp/$case.md" "selftest/$case" >/dev/null 2>&1
    rc=$?
    if [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — seeded '$case' doc returned exit $rc; expected 1"
      selftest_fail=$((selftest_fail + 1))
    fi
  done

  if ! evaluate_ops "$tmp/sound.md" "selftest/sound" >/dev/null 2>&1; then
    err "SELFTEST FAIL — the evaluator REJECTED the seeded sound doc"
    evaluate_ops "$tmp/sound.md" "selftest/sound" >&2
    selftest_fail=$((selftest_fail + 1))
  fi

  if [ "$selftest_fail" -ne 0 ]; then
    err "self-test FAILED ($selftest_fail case(s))"
    exit 1
  fi
  echo "certified-commit-guard: self-test passed — eight seeded defects rejected (dropped refuse outcome, unbounded re-verify, no per-event bound, fail-open, missing kind, missing reason, a tool noun, an over-budget doc), and the sound doc accepted."
  exit 0
fi

# --- live-tree scan ---------------------------------------------------------

OPS="$ROOT/plugins/wf/skills/_contracts/certified-commit.ops.md"
CONTRACT="$ROOT/plugins/wf/skills/_contracts/certified-commit.contract.md"
TEMPLATE="$ROOT/plugins/wf/skills/verify-spec/references/verify-template.md"
VERIFY="$ROOT/plugins/wf/skills/verify-spec/SKILL.md"
PR="$ROOT/plugins/wf/skills/pr/SKILL.md"

for f in "$OPS" "$TEMPLATE" "$VERIFY" "$PR"; do
  if [ ! -f "$f" ]; then
    err "target file is absent: $f"
    exit 2
  fi
done

fail=0
evaluate_ops "$OPS" "OPS" || fail=$((fail + 1))

bad=0
require "$TEMPLATE" TEMPLATE W1 'the header renders the Certified line' '^\*\*Certified:\*\* commit' || bad=1
require "$TEMPLATE" TEMPLATE W1b 'the header renders the Drift re-verify line' '^\*\*Drift re-verify:\*\*' || bad=1
require "$TEMPLATE" TEMPLATE W1c 'the template renders drift residuals' 'drift: residual' || bad=1
require "$VERIFY" VERIFY W2 'verify-spec points at the ops doc' 'ref: certified-commit\.ops\.md' || bad=1
require "$VERIFY" VERIFY W2b 'verify-spec names the drift ledger' '04_drift\.md' || bad=1
require "$PR" PR W3 'pr runs the drift check in Phase 2.2' '^## Phase 2\.2 — Drift check' || bad=1
require "$PR" PR W3b 'pr resolves the ops doc' 'ref: certified-commit\.ops\.md' || bad=1
require "$PR" PR W3c 'pr may invoke the Skill tool for the one re-verify' '^allowed-tools: \[.*Skill.*\]' || bad=1
require "$PR" PR W3d 'pr refuses on a refuse outcome' '\*\*.refuse.\*\* → stop' || bad=1
if [ ! -f "$CONTRACT" ]; then
  printf 'CONTRACT: [W4] the paired rationale doc is absent: %s\n' "$CONTRACT"
  bad=1
fi
[ "$bad" -eq 0 ] || fail=$((fail + 1))

if [ "$fail" -ne 0 ]; then
  err "FAIL — the certified-commit contract or its consumer wiring is incomplete."
  exit 1
fi
echo "certified-commit-guard: PASS — the ops doc keeps every outcome, reason, kind and bound; verify-spec certifies and runs drift mode; /wf:pr runs the drift check before any pull request exists."
