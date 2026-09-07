#!/usr/bin/env bash
# selfcheck.sh — the verify-replay-baseline kit's own lint (WF-564).
#
# **Model:** claude-fable-5-1
#
# Same family/style as corpus/run.sh: set -uo pipefail, ok/err, deterministic, no network, no
# model, no container. Wired into corpus/run.sh check 12, so CI validates this kit through the
# corpus entrypoint. It checks:
#
#   1. MANIFEST     — experiment.json loads under the engine's frozen v1 validator
#                     (manifest.sh), declares ≥2 arms and ≥1 compare, and every mechanism signal
#                     is one of the two frozen kinds.
#   2. KIT FILES    — every file the runbook and the corpus items name exists and is executable
#                     where it is a script; every script parses (bash -n / node --check).
#   3. FIXTURE      — the fixture capability's manifest carries exactly one `verify | finding |
#                     inline:` row pointing at an existing fragment, and the fragment template
#                     carries the do-not-re-audit instruction block.
#   4. BASELINE     — results/baseline.json exists, is the deterministic derivation of the corpus
#                     records (derive-baseline.mjs --check), carries machine-readable provenance
#                     {path, reason} (canned vs real), and every replayable round names a
#                     verdict, a blocking set, and a stop decision.
#   5. SELF-COMPARE — replay-check.mjs judging the baseline against itself reports zero
#                     DIVERGE and exactly as many NOT-MEASURED rows as there are non-replayable
#                     rounds — proving the judge is wired and that it counts honestly.
#   6. BLINDING     — no word of the manifest's blinding vocabulary appears in anything the kit
#                     injects into a seeded workspace (the fixture manifest, the fragment
#                     template, fake-scripts.json).
#
# Usage: selfcheck.sh   (exit 0 on PASS, 1 on any FAIL)
set -uo pipefail
EXP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KIT="$EXP_DIR/kit"
PACK_DIR="$(cd "$EXP_DIR/../.." && pwd)"
ENGINE="$PACK_DIR/experiments/engine"
REPO_ROOT="$(cd "$PACK_DIR/../.." && pwd)"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }
command -v jq   >/dev/null 2>&1 || { echo "selfcheck.sh: jq is required" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "selfcheck.sh: node is required" >&2; exit 2; }

# 1. MANIFEST
if ( . "$ENGINE/manifest.sh" && manifest_load "$EXP_DIR/experiment.json" ) >/dev/null 2>"$EXP_DIR/.selfcheck-manifest.err"; then
  ok "manifest: experiment.json validates under engine/manifest.sh (frozen v1)"
else
  err "manifest: experiment.json rejected — $(head -1 "$EXP_DIR/.selfcheck-manifest.err")"
fi
rm -f "$EXP_DIR/.selfcheck-manifest.err"
[ "$(jq '.arms | length' "$EXP_DIR/experiment.json")" -ge 2 ] || err "manifest: fewer than two arms"
[ "$(jq '.compares | length' "$EXP_DIR/experiment.json")" -ge 1 ] || err "manifest: no compares entry"
jq -e '[.mechanism_signals[] | select(.kind != "record_match" and .kind != "dispatch_shape")] | length == 0' "$EXP_DIR/experiment.json" >/dev/null \
  || err "manifest: a mechanism signal names a kind outside the frozen {record_match, dispatch_shape} set"
jq -e '[.mechanism_signals[] | select(.kind == "dispatch_shape")] | length >= 5' "$EXP_DIR/experiment.json" >/dev/null \
  || err "manifest: expected ≥5 dispatch_shape signals (one per lens agent whose absence the replay asserts)"

# 2. KIT FILES
for f in experiment.json fake-scripts.json Dockerfile build-arm.sh analyze.sh README.md runbooks/experiment.md \
         kit/extract-rounds.mjs kit/derive-baseline.mjs kit/replay-check.mjs kit/materialize-round.sh kit/replay-round.sh \
         kit/fixture/verify-replay-fixture/manifest.md kit/fixture/verify-replay-fixture/fragments/findings.md \
         results/baseline.json; do
  [ -f "$EXP_DIR/$f" ] || err "kit-files: missing $f"
done
for f in build-arm.sh analyze.sh selfcheck.sh kit/materialize-round.sh kit/replay-round.sh; do
  [ -f "$EXP_DIR/$f" ] || continue
  bash -n "$EXP_DIR/$f" || err "kit-files: $f does not parse"
done
for f in kit/extract-rounds.mjs kit/derive-baseline.mjs kit/replay-check.mjs; do
  [ -f "$EXP_DIR/$f" ] || continue
  node --check "$EXP_DIR/$f" 2>/dev/null || err "kit-files: $f does not parse"
done
[ "$fail" -eq 0 ] && ok "kit-files: every declared file present; every script parses"

# 3. FIXTURE
fx="$KIT/fixture/verify-replay-fixture"
rows="$(grep -cE '^\| verify +\| finding +\| `inline: fragments/findings.md` +\| — +\|' "$fx/manifest.md" 2>/dev/null || true)"
[ "${rows:-0}" -eq 1 ] || err "fixture: manifest.md must carry exactly one 'verify | finding | inline: fragments/findings.md | —' row (found ${rows:-0})"
grep -q 'Do \*\*not\*\* open, read, or re-audit' "$fx/fragments/findings.md" \
  || err "fixture: fragments/findings.md template lacks the do-not-re-audit instruction block"
grep -qE '^\|.*subagent:' "$fx/manifest.md" && err "fixture: the fixture must dispatch inline: only — a subagent: fragments row would be a live dispatch"
[ "$fail" -eq 0 ] && ok "fixture: one inline finding row, template carries the recorded-findings instruction"

# 4. BASELINE
bl="$EXP_DIR/results/baseline.json"
if [ -f "$bl" ]; then
  if node "$KIT/derive-baseline.mjs" --check >/dev/null 2>"$EXP_DIR/.selfcheck-baseline.err"; then
    ok "baseline: results/baseline.json is the deterministic derivation of the corpus records"
  else
    err "baseline: $(grep -m1 FAIL "$EXP_DIR/.selfcheck-baseline.err" || echo 'derive-baseline.mjs --check failed')"
  fi
  rm -f "$EXP_DIR/.selfcheck-baseline.err"
  case "$(jq -r '.provenance.path // empty' "$bl")" in
    canned|real) ;;
    "") err "baseline: no provenance.path — the baseline must disclose canned vs real";;
    *) err "baseline: provenance.path must be exactly 'canned' or 'real'";;
  esac
  [ -n "$(jq -r '.provenance.reason // empty' "$bl")" ] || err "baseline: provenance.reason is empty"
  jq -e '[.items[].rounds[] | select(.replayable) | select(.verdict == null or .blocking_set == null or .stop_decision == null)] | length == 0' "$bl" >/dev/null \
    || err "baseline: a replayable round lacks a verdict, a blocking set, or a stop decision"
  [ "$(jq '.items | length' "$bl")" -ge 3 ] || err "baseline: expected the three WF-564 items, found $(jq '.items | length' "$bl")"
else
  err "baseline: results/baseline.json missing — run kit/derive-baseline.mjs"
fi

# 5. SELF-COMPARE
if [ -f "$bl" ]; then
  rep="$(node "$KIT/replay-check.mjs" --against "$bl" 2>&1)"; rc=$?
  nr="$(jq '[.items[].rounds[] | select(.replayable | not)] | length' "$bl")"
  if [ "$rc" -eq 0 ] && printf '%s' "$rep" | grep -q "0 DIVERGE · $nr NOT-MEASURED"; then
    ok "self-compare: replay-check.mjs over the baseline itself — 0 DIVERGE, $nr NOT-MEASURED (the non-replayable rounds, counted honestly)"
  else
    err "self-compare: replay-check.mjs did not report 0 DIVERGE / $nr NOT-MEASURED on the baseline self-compare (rc=$rc)"
  fi
fi

# 6. BLINDING
while IFS= read -r word; do
  [ -n "$word" ] || continue
  for f in "$fx/manifest.md" "$fx/fragments/findings.md" "$EXP_DIR/fake-scripts.json"; do
    grep -qiF -- "$word" "$f" && err "blinding: vocabulary word '$word' appears in injected content ${f#$EXP_DIR/}"
  done
done < <(jq -r '.blinding.vocabulary[]' "$EXP_DIR/experiment.json")
[ "$fail" -eq 0 ] && ok "blinding: no vocabulary word in the fixture manifest, fragment template, or fake scripts"

if [ "$fail" -ne 0 ]; then
  echo "verify-replay-baseline selfcheck: FAIL" >&2
  exit 1
fi
echo "verify-replay-baseline selfcheck: PASS"
