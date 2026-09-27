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
#   O9  no host, vendor, or version-control tool noun appears;
#   O10 the scenario table keeps a row for every acceptance case.
#
# and on the consumers:
#
#   W1  the verify template renders the Certified and Drift re-verify lines;
#   W2  verify-spec points at the ops doc and the drift ledger;
#   W3  /wf:pr runs the drift check in Phase 2.2 and may invoke the Skill tool;
#   W4  the paired rationale doc exists;
#   W5  /wf:ship runs the drift check on every Phase 4.2 remediation push and
#       again before /wf:tf, may invoke the Skill tool for the one re-verify,
#       and blocks on a refuse outcome before any merge (WF-819);
#   W6  /wf-review:address-pr runs the drift check on every head it pushes,
#       reaching the ops doc through the resolver's content surface, with one
#       re-verify per drift event and a refuse that blocks the merge (WF-820);
#   W7  /wf:tf runs the drift check unconditionally before pr-merge and merges
#       nothing on a refuse outcome (WF-820).
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

  # O10 — the scenario table keeps a row for every acceptance case: carry-forward,
  # a re-verify that rebinds, residual-only findings, a second drift after rebind,
  # and refusal of an uncertified head.
  local rows pat
  rows=$(grep -E '^\| ' "$file")
  for pat in 'carried' 're-verify PASS' 'residuals' 'push to C' '\(.uncertified.\)'; do
    if ! printf '%s\n' "$rows" | grep -qE "$pat"; then
      printf '%s: [O10] the scenario table has no row matching /%s/\n' "$label" "$pat"
      bad=1
    fi
  done

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

# evaluate_ship <file> <label> — applies W5 to a /wf:ship skill body; returns 1
# on any violation. The CI-remediation push path must check every pushed head
# and the head about to merge, and must never reach the merge on a refuse.
evaluate_ship() {
  local file="$1" label="$2" bad=0
  require "$file" "$label" W5 'ship runs the drift check in Phase 4.2' '^   \*\*Drift check \(the certified commit\)\.\*\*' || bad=1
  require "$file" "$label" W5b 'ship resolves the ops doc' 'ref: certified-commit\.ops\.md' || bad=1
  require "$file" "$label" W5c 'ship re-checks the head before the merge' '^\*\*Drift check before the merge\.\*\*' || bad=1
  require "$file" "$label" W5d 'ship blocks on a refuse outcome' '\*\*.refuse.\*\* → \*\*`SHIP — Blocked`\*\*' || bad=1
  require "$file" "$label" W5e 'ship runs one re-verify per drift event' '\*\*exactly once\*\* for this drift event' || bad=1
  require "$file" "$label" W5f 'ship may invoke the Skill tool for the re-verify' '^allowed-tools: \[.*Skill.*\]' || bad=1
  # Scenario rows — one per CI-remediation acceptance case:
  require "$file" "$label" W5g 'scenario: a carry-forward push is recorded under the ship path' 'row to `04_drift\.md` with `Path` `ship`' || bad=1
  require "$file" "$label" W5h 'scenario: a second push after a rebind is its own B..C event' 'scoped from whatever the previous event rebound to' || bad=1
  require "$file" "$label" W5i 'scenario: a failed drift re-verify stops, no second round' 'never a trigger for another verify⇄fix round' || bad=1
  require "$file" "$label" W5j 'scenario: a re-invoked run cannot merge a head an earlier run refused' 'still cannot merge a head an earlier run refused' || bad=1
  [ "$bad" -eq 0 ] || return 1
  printf '%s: OK — drift check on every remediation push and before every merge, one re-verify per event, refuse blocks, all four ship scenarios pinned\n' "$label"
  return 0
}

# evaluate_address_pr <file> <label> — applies W6 to the /wf-review:address-pr
# skill body; returns 1 on any violation. A review-fix push must be checked, the
# ops doc must be reached through the content surface (the skill lives in a pack),
# and a refuse must never be reported as mergeable.
evaluate_address_pr() {
  local file="$1" label="$2" bad=0
  require "$file" "$label" W6 'address-pr runs the drift check after its push' '^## Phase 8 — Drift check \(the certified commit\)' || bad=1
  require "$file" "$label" W6b 'address-pr reaches the ops doc through the content surface' '`class: contract`, `ref: certified-commit\.ops\.md`' || bad=1
  require "$file" "$label" W6c 'address-pr runs one re-verify per drift event' '\*\*exactly once\*\* for this drift event' || bad=1
  require "$file" "$label" W6d 'address-pr reports a refuse as unmergeable' '\*\*.refuse.\*\* → report' || bad=1
  require "$file" "$label" W6e 'address-pr may invoke the Skill tool for the re-verify' '^allowed-tools: \[.*Skill.*\]' || bad=1
  require "$file" "$label" W6f 'address-pr renders the Drift line' '^Drift: <' || bad=1
  # Scenario rows — one per address-pr acceptance case:
  require "$file" "$label" W6g 'scenario: a carry-forward push is recorded under the address-pr path' '`04_drift\.md` with `Path` `address-pr`' || bad=1
  require "$file" "$label" W6h 'scenario: a second push after a rebind is its own B..C event' 're-verifies B\.\.C only' || bad=1
  require "$file" "$label" W6i 'scenario: fresh findings on unchanged code become drift residuals' 'into drift residuals' || bad=1
  require "$file" "$label" W6j 'scenario: a failed drift re-verify stops, no second round' 'never a trigger for another' || bad=1
  if grep -qE '(Read|Glob|cat).*plugins/wf/skills/_contracts' "$file"; then
    printf '%s: [W6k] the pack reads a core contract by filesystem path; reach it through resolve_content\n' "$label"
    bad=1
  fi
  [ "$bad" -eq 0 ] || return 1
  printf '%s: OK — drift check after every address-pr push via the content surface, one re-verify per event, refuse unmergeable, all four address-pr scenarios pinned\n' "$label"
  return 0
}

# evaluate_tf <file> <label> — applies W7 to the /wf:tf skill body; returns 1 on
# any violation. The finalizer must re-check the head before every merge, on
# every run, and must merge nothing on a refuse.
evaluate_tf() {
  local file="$1" label="$2" bad=0
  require "$file" "$label" W7 'tf runs the drift check before the merge' '\*\*Drift check before the merge \(the certified commit\)\.\*\*' || bad=1
  require "$file" "$label" W7b 'tf resolves the ops doc' 'ref: certified-commit\.ops\.md' || bad=1
  require "$file" "$label" W7c 'tf checks unconditionally, whoever pushed last' 'unconditionally, whoever pushed last' || bad=1
  require "$file" "$label" W7d 'tf merges nothing on a refuse outcome' '\*\*.refuse.\*\* → \*\*no `pr-merge`\*\*' || bad=1
  require "$file" "$label" W7e 'tf runs one re-verify per drift event' '\*\*exactly once\*\* for this drift event' || bad=1
  require "$file" "$label" W7f 'tf may invoke the Skill tool for the re-verify' '^allowed-tools: \[.*Skill.*\]' || bad=1
  [ "$bad" -eq 0 ] || return 1
  printf '%s: OK — drift check before every merge on every run, one re-verify per event, refuse merges nothing\n' "$label"
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

| Given | Check returns | Ledger after |
|---|---|---|
| push to B only moved the base | `carried` | carry-forward row |
| push to B edits code | `reverify` then `bound` | re-verify PASS row |
| findings only on unchanged code | `bound` | residuals accepted |
| certified at B; second push to C edits code | `reverify` | re-verify row |
| latest verdict FAIL | `refuse` (`uncertified`) | unchanged |
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
  sound_doc | grep -v 'second push to C' >"$tmp/no-rebind-scenario.md"
  sound_doc >"$tmp/over-budget.md"
  i=0
  while [ "$i" -lt 150 ]; do printf 'padding\n' >>"$tmp/over-budget.md"; i=$((i + 1)); done

  selftest_fail=0
  for case in no-refuse unbounded-reverify no-per-event fail-open no-kind no-reason tool-noun no-rebind-scenario over-budget; do
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

  sound_ship() {
    cat <<'SHIP'
allowed-tools: [Read, Skill, Edit, Write]

   **Drift check (the certified commit).** Follow `ref: certified-commit.ops.md` on every pushed head.
   - `carried` → the check appended its `carry-forward` row to `04_drift.md` with `Path` `ship`.
   - **`reverify`** → invoke the audit **exactly once** for this drift event.
   - **`refuse`** → **`SHIP — Blocked`** before any merge; never a trigger for another verify⇄fix round.
   Each push is its own event, scoped from whatever the previous event rebound to.

**Drift check before the merge.** Re-run the check on every run, so a re-invoked run still cannot merge a head an earlier run refused.
SHIP
  }

  sound_ship >"$tmp/ship-sound.md"
  sound_ship | grep -v 'Drift check (the certified commit)' >"$tmp/ship-no-push-check.md"
  sound_ship | grep -v 'Drift check before the merge' >"$tmp/ship-no-premerge-check.md"
  sound_ship | grep -v '`refuse`' >"$tmp/ship-refuse-proceeds.md"
  sound_ship | sed 's/\*\*exactly once\*\* for this drift event/as often as needed/' >"$tmp/ship-unbounded-reverify.md"
  sound_ship | sed 's/Skill, //' >"$tmp/ship-no-skill.md"
  sound_ship | sed 's/, so a re-invoked run still cannot merge a head an earlier run refused//' >"$tmp/ship-resume-bypass.md"
  sound_ship | grep -v 'scoped from whatever' >"$tmp/ship-no-rebind-scenario.md"

  for case in ship-no-push-check ship-no-premerge-check ship-refuse-proceeds ship-unbounded-reverify ship-no-skill ship-resume-bypass ship-no-rebind-scenario; do
    evaluate_ship "$tmp/$case.md" "selftest/$case" >/dev/null 2>&1
    rc=$?
    if [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — seeded '$case' ship doc returned exit $rc; expected 1"
      selftest_fail=$((selftest_fail + 1))
    fi
  done

  if ! evaluate_ship "$tmp/ship-sound.md" "selftest/ship-sound" >/dev/null 2>&1; then
    err "SELFTEST FAIL — the ship evaluator REJECTED the seeded sound ship doc"
    evaluate_ship "$tmp/ship-sound.md" "selftest/ship-sound" >&2
    selftest_fail=$((selftest_fail + 1))
  fi

  sound_address_pr() {
    cat <<'ADDR'
allowed-tools: [Read, Edit, Task, Skill]

## Phase 8 — Drift check (the certified commit)

Follow the check (`resolve_content`, `class: contract`, `ref: certified-commit.ops.md`) on the pushed head.
- `carried` → the check appended its row to `04_drift.md` with `Path` `address-pr`.
- **`reverify`** → invoke the audit **exactly once** for this drift event; it turns fresh findings on unchanged code into drift residuals.
- **`refuse`** → report the head as unmergeable; never a trigger for another verify⇄fix round.
A second push to C after a rebind to B re-verifies B..C only.

Drift: <inert | bound | carried | refused — reason | n/a>
ADDR
  }

  sound_address_pr >"$tmp/addr-sound.md"
  sound_address_pr | grep -v '^## Phase 8' >"$tmp/addr-no-check.md"
  sound_address_pr | sed 's/`class: contract`, `ref: certified-commit\.ops\.md`/`ref: certified-commit.ops.md`/' >"$tmp/addr-no-content-surface.md"
  sound_address_pr >"$tmp/addr-raw-read.md"
  printf 'Read plugins/wf/skills/_contracts/certified-commit.ops.md directly.\n' >>"$tmp/addr-raw-read.md"
  sound_address_pr | sed 's/\*\*exactly once\*\* for this drift event/as often as needed/' >"$tmp/addr-unbounded-reverify.md"
  sound_address_pr | grep -v '`refuse`' >"$tmp/addr-refuse-mergeable.md"
  sound_address_pr | sed 's/, Skill//' >"$tmp/addr-no-skill.md"
  sound_address_pr | grep -v '^Drift: ' >"$tmp/addr-no-drift-line.md"
  sound_address_pr | grep -v 'B\.\.C only' >"$tmp/addr-no-rebind-scenario.md"
  sound_address_pr | sed 's/; it turns fresh findings on unchanged code into drift residuals//' >"$tmp/addr-no-residuals.md"

  for case in addr-no-check addr-no-content-surface addr-raw-read addr-unbounded-reverify addr-refuse-mergeable addr-no-skill addr-no-drift-line addr-no-rebind-scenario addr-no-residuals; do
    evaluate_address_pr "$tmp/$case.md" "selftest/$case" >/dev/null 2>&1
    rc=$?
    if [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — seeded '$case' address-pr doc returned exit $rc; expected 1"
      selftest_fail=$((selftest_fail + 1))
    fi
  done

  if ! evaluate_address_pr "$tmp/addr-sound.md" "selftest/addr-sound" >/dev/null 2>&1; then
    err "SELFTEST FAIL — the address-pr evaluator REJECTED the seeded sound doc"
    evaluate_address_pr "$tmp/addr-sound.md" "selftest/addr-sound" >&2
    selftest_fail=$((selftest_fail + 1))
  fi

  sound_tf() {
    cat <<'TF'
allowed-tools: [Read, Write, Skill]

5. **Drift check before the merge (the certified commit).** Follow `ref: certified-commit.ops.md` on every run — unconditionally, whoever pushed last.
   - **`reverify`** → invoke the audit **exactly once** for this drift event.
   - **`refuse`** → **no `pr-merge`**; stop the finalize.
TF
  }

  sound_tf >"$tmp/tf-sound.md"
  sound_tf | grep -v 'Drift check before the merge' >"$tmp/tf-no-check.md"
  sound_tf | sed 's/ — unconditionally, whoever pushed last//' >"$tmp/tf-conditional.md"
  sound_tf | grep -v '`refuse`' >"$tmp/tf-refuse-merges.md"
  sound_tf | sed 's/\*\*exactly once\*\* for this drift event/as often as needed/' >"$tmp/tf-unbounded-reverify.md"
  sound_tf | sed 's/, Skill//' >"$tmp/tf-no-skill.md"

  for case in tf-no-check tf-conditional tf-refuse-merges tf-unbounded-reverify tf-no-skill; do
    evaluate_tf "$tmp/$case.md" "selftest/$case" >/dev/null 2>&1
    rc=$?
    if [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — seeded '$case' tf doc returned exit $rc; expected 1"
      selftest_fail=$((selftest_fail + 1))
    fi
  done

  if ! evaluate_tf "$tmp/tf-sound.md" "selftest/tf-sound" >/dev/null 2>&1; then
    err "SELFTEST FAIL — the tf evaluator REJECTED the seeded sound doc"
    evaluate_tf "$tmp/tf-sound.md" "selftest/tf-sound" >&2
    selftest_fail=$((selftest_fail + 1))
  fi

  if [ "$selftest_fail" -ne 0 ]; then
    err "self-test FAILED ($selftest_fail case(s))"
    exit 1
  fi
  echo "certified-commit-guard: self-test passed — nine seeded ops-doc defects rejected (dropped refuse outcome, unbounded re-verify, no per-event bound, fail-open, missing kind, missing reason, a tool noun, a dropped rebind scenario, an over-budget doc), seven seeded ship-wiring defects rejected (no push check, no pre-merge check, refuse proceeds, unbounded re-verify, no Skill tool, a resume that bypasses a refusal, a dropped rebind scenario), nine seeded address-pr defects rejected (no check, no content surface, a raw core read, unbounded re-verify, refuse reported mergeable, no Skill tool, no Drift line, a dropped rebind scenario, no drift residuals), five seeded tf defects rejected (no pre-merge check, a conditional check, refuse merges, unbounded re-verify, no Skill tool), and all four sound docs accepted."
  exit 0
fi

# --- live-tree scan ---------------------------------------------------------

OPS="$ROOT/plugins/wf/skills/_contracts/certified-commit.ops.md"
CONTRACT="$ROOT/plugins/wf/skills/_contracts/certified-commit.contract.md"
TEMPLATE="$ROOT/plugins/wf/skills/verify-spec/references/verify-template.md"
VERIFY="$ROOT/plugins/wf/skills/verify-spec/SKILL.md"
PR="$ROOT/plugins/wf/skills/pr/SKILL.md"
SHIP="$ROOT/plugins/wf/skills/ship/SKILL.md"
TF="$ROOT/plugins/wf/skills/tf/SKILL.md"
ADDRESS_PR="$ROOT/plugins/wf-review/skills/address-pr/SKILL.md"

for f in "$OPS" "$TEMPLATE" "$VERIFY" "$PR" "$SHIP" "$TF" "$ADDRESS_PR"; do
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

evaluate_ship "$SHIP" "SHIP" || fail=$((fail + 1))
evaluate_address_pr "$ADDRESS_PR" "ADDRESS-PR" || fail=$((fail + 1))
evaluate_tf "$TF" "TF" || fail=$((fail + 1))

if [ "$fail" -ne 0 ]; then
  err "FAIL — the certified-commit contract or its consumer wiring is incomplete."
  exit 1
fi
echo "certified-commit-guard: PASS — the ops doc keeps every outcome, reason, kind and bound; verify-spec certifies and runs drift mode; /wf:pr runs the drift check before any pull request exists; /wf:ship runs it on every CI-remediation push and before the merge; /wf-review:address-pr runs it on every review-fix push; /wf:tf runs it before every merge."
