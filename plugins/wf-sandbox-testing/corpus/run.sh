#!/usr/bin/env bash
# run.sh — the wf-sandbox-testing CORPUS self-check (WF-347).
#
# Same family/style as assert/run.sh and validate-registry.sh: set -uo pipefail, ok/err,
# deterministic, no network, no model, no container. It judges the two structurally-heaviest
# first-corpus items (charter OUT-6) entirely against committed CANNED run outputs shaped
# exactly like the WF-345 runner's output tree — real containerized runs are neither required
# nor run here (Docker + CLAUDE_CODE_OAUTH_TOKEN are unavailable; see each item.md). It checks:
#
#   1. PROVENANCE     — every corpus item in manifest.md carries a resolvable provenance link
#                       (a WF-<n> comment/issue or a C0<n> charter watch-list line). Zero
#                       unprovenanced items (charter OUT-6 / WF-347 success criterion 1).
#   2. SLOT ENUM      — the declared-slot set is enumerated MECHANICALLY from source (the
#                       <!-- wf:slot skill.point --> markers). Each declared slot must have a
#                       matching empty-slot corpus item (baseline arm + current + seeded set).
#                       A newly declared slot with no arm fails loudly — never silently unchecked.
#   3. FLAGSHIP       — per declared slot: the current (unfilled) set is EQUIVALENT to the
#                       recorded pinned-build baseline arm on the structural families; a seeded
#                       slot-FILL set is DIVERGENT (naming ops_invoked). Never a transcript match.
#   4. ARM RECORD     — each baseline arm.json carries the pinned build's fingerprint and the
#                       run fingerprints of its baseline set (WF-347 success criterion 3).
#   5. REVIEW-GATE    — the five-requirements scenario runs green against wf-fake's scripted
#                       threads (op log shows all five requirement ops); a seeded "merged while
#                       claiming no review landed" run turns red naming the failed assertion.
#
# Usage: run.sh   (run every check; wired into CI as its own step)
set -uo pipefail

CORPUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$CORPUS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PACK_DIR/../.." && pwd)"
ASSERT="$PACK_DIR/assert"
MANIFEST="$CORPUS_DIR/manifest.md"
ITEMS="$CORPUS_DIR/items"
MAXVAR="0.34"   # the governing comparison ceiling — the named per-family threshold decision (item.md)

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

command -v jq >/dev/null 2>&1 || { echo "corpus/run.sh: jq is required" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ---------------------------------------------------------------------------
# 1. PROVENANCE — every manifest item row carries a resolvable provenance link.
# ---------------------------------------------------------------------------
check_provenance() {
  local before=$fail rows n=0 unprov=0 line num prov
  [ -f "$MANIFEST" ] || { err "provenance: manifest.md not found at $MANIFEST"; return; }
  # Item rows begin "| <number> |" in the Items table. The provenance is the LAST cell.
  while IFS= read -r line; do
    num="$(printf '%s' "$line" | sed -E 's/^\|[[:space:]]*([0-9]+)[[:space:]]*\|.*/\1/')"
    case "$num" in ''|*[!0-9]*) continue;; esac
    n=$((n+1))
    # The provenance is the row's last non-empty cell; scan the whole row (rows carry their
    # tracker/charter refs only in the provenance cell) for a resolvable reference.
    prov="$(printf '%s' "$line" | awk -F'|' '{for(i=NF;i>=1;i--){gsub(/^[[:space:]]+|[[:space:]]+$/,"",$i); if($i!=""){print $i; break}}}')"
    # A resolvable link mentions a WF-<n> tracker ref or a C0<n> charter watch-list line.
    if printf '%s' "$prov" | grep -Eq 'WF-[0-9]+|C0[0-9]+'; then
      ok "provenance: corpus item $num links to $(printf '%s' "$prov" | grep -oE 'WF-[0-9]+|C0[0-9]+' | tr '\n' ' ')"
    else
      err "provenance: corpus item $num has NO resolvable provenance link (WF-<n> or C0<n>) — unprovenanced items are forbidden"
      unprov=$((unprov+1))
    fi
  done < "$MANIFEST"
  [ "$n" -ge 2 ] || err "provenance: expected at least the 2 WF-347 corpus items in the manifest, found $n"
  [ "$unprov" -eq 0 ] && [ "$fail" = "$before" ] && ok "provenance: all $n corpus items carry a resolvable provenance link — zero unprovenanced"
}

# ---------------------------------------------------------------------------
# 2. SLOT ENUM — enumerate declared slots from source; every slot has a corpus item.
# ---------------------------------------------------------------------------
declared_slots() {
  # Mechanical: the opening <!-- wf:slot skill.point --> markers in real skill bodies
  # (plugins/*/skills/*/SKILL.md; the _contracts/slot-marker-fixtures live one level deeper
  # and are not matched). This is the same declared-slot surface the resolver reads (WF-329).
  grep -hoE '<!--[[:space:]]*wf:slot[[:space:]]+[a-z0-9-]+\.[a-z0-9-]+[[:space:]]*-->' \
    "$REPO_ROOT"/plugins/*/skills/*/SKILL.md 2>/dev/null \
    | sed -E 's/.*wf:slot[[:space:]]+([a-z0-9-]+\.[a-z0-9-]+).*/\1/' | LC_ALL=C sort -u
}

slot_item_dir() {
  # ship.review -> items/empty-slot-ship-review
  printf '%s/empty-slot-%s' "$ITEMS" "$(printf '%s' "$1" | tr '.' '-')"
}

check_slot_enum() {
  local before=$fail slot dir count=0
  local slots; slots="$(declared_slots)"
  [ -n "$slots" ] || { err "slot-enum: no declared slots found in source — the enumeration is broken (expected at least ship.review)"; return; }
  while IFS= read -r slot; do
    [ -n "$slot" ] || continue
    count=$((count+1))
    dir="$(slot_item_dir "$slot")"
    [ -d "$dir" ] || { err "slot-enum: declared slot '$slot' has NO empty-slot corpus item at ${dir#$REPO_ROOT/}"; continue; }
    [ -f "$dir/baseline/arm.json" ] || err "slot-enum: '$slot' item missing baseline/arm.json"
    [ -d "$dir/runs-current" ]      || err "slot-enum: '$slot' item missing runs-current/"
    [ -d "$dir/seeded-breakage/runs" ] || err "slot-enum: '$slot' item missing seeded-breakage/runs/"
  done <<< "$slots"
  [ "$fail" = "$before" ] && ok "slot-enum: $count declared slot(s) [$(printf '%s' "$slots" | tr '\n' ' ')] each have a per-slot empty-slot corpus item (per declared slot, not one global)"
}

# ---------------------------------------------------------------------------
# 3. FLAGSHIP — per declared slot: current EQUIVALENT to baseline; seeded DIVERGENT.
# ---------------------------------------------------------------------------
check_flagship() {
  local before=$fail slot dir rc rep
  local slots; slots="$(declared_slots)"
  while IFS= read -r slot; do
    [ -n "$slot" ] || continue
    dir="$(slot_item_dir "$slot")"
    [ -d "$dir" ] || continue
    # (a) unfilled current set is EQUIVALENT to the pinned-build baseline arm.
    rc=0; rep="$TMP/flag-eq-$(printf '%s' "$slot" | tr '.' '-').txt"
    REPORT="$rep" bash "$ASSERT/compare.sh" --current "$dir/runs-current" --baseline "$dir/baseline/runs" --max-variance "$MAXVAR" --report "$rep" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -eq 0 ] && grep -q 'Comparison verdict: EQUIVALENT' "$rep" 2>/dev/null; then
      ok "flagship[$slot]: unfilled-slot current set is EQUIVALENT to the pinned pre-slot baseline arm on all structural families"
    else
      err "flagship[$slot]: empty-slot invariant did NOT hold — current vs baseline is not EQUIVALENT (exit $rc)"; [ -f "$rep" ] && sed 's/^/    /' "$rep" >&2
    fi
    # (b) a seeded slot-FILL set must DIVERGE (proving the item turns red).
    rc=0; rep="$TMP/flag-div-$(printf '%s' "$slot" | tr '.' '-').txt"
    REPORT="$rep" bash "$ASSERT/compare.sh" --current "$dir/seeded-breakage/runs" --baseline "$dir/baseline/runs" --max-variance "$MAXVAR" --report "$rep" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ne 0 ] && grep -Eq 'ops_invoked +DIVERGENT' "$rep" 2>/dev/null; then
      ok "flagship[$slot]: seeded slot-fill set is DIVERGENT (ops_invoked) vs the baseline — a seeded breakage turns the item red, naming the family"
    else
      err "flagship[$slot]: seeded breakage did NOT diverge on ops_invoked as expected (exit $rc)"; [ -f "$rep" ] && sed 's/^/    /' "$rep" >&2
    fi
  done <<< "$slots"
  [ "$fail" = "$before" ] && ok "flagship: the empty-slot invariant is asserted per declared slot against owned, fingerprinted baseline arms"
}

# ---------------------------------------------------------------------------
# 4. ARM RECORD — arm.json carries the pinned build fingerprint + run fingerprints.
# ---------------------------------------------------------------------------
check_arm_record() {
  local before=$fail slot dir arm pf runs rn
  local slots; slots="$(declared_slots)"
  while IFS= read -r slot; do
    [ -n "$slot" ] || continue
    dir="$(slot_item_dir "$slot")"; arm="$dir/baseline/arm.json"
    [ -f "$arm" ] || { err "arm[$slot]: baseline/arm.json missing"; continue; }
    pf="$(jq -r '.pinned_build.fingerprint // empty' "$arm" 2>/dev/null)"
    [ -n "$pf" ] || err "arm[$slot]: arm.json has no pinned_build.fingerprint"
    runs="$(jq -r '.runs // [] | length' "$arm" 2>/dev/null)"
    [ "${runs:-0}" -ge 1 ] || err "arm[$slot]: arm.json records no baseline runs"
    rn="$(jq -r '[.runs[]? | select((.fingerprint // "") == "")] | length' "$arm" 2>/dev/null)"
    [ "${rn:-1}" -eq 0 ] || err "arm[$slot]: a baseline run in arm.json is missing its run fingerprint"
    # Every declared run dir named in arm.json exists and its run.json fingerprint matches.
    local i d fp expect
    for i in $(seq 0 $((runs-1))); do
      d="$(jq -r --argjson i "$i" '.runs[$i].dir' "$arm")"
      expect="$(jq -r --argjson i "$i" '.runs[$i].fingerprint' "$arm")"
      fp="$(jq -r '.fingerprints.run // empty' "$dir/baseline/$d/run.json" 2>/dev/null)"
      [ "$fp" = "$expect" ] || err "arm[$slot]: run '$d' fingerprint '$fp' != arm.json '$expect'"
    done
    [ -n "$pf" ] && ok "arm[$slot]: baseline arm carries pinned build fp '$pf' and $runs run fingerprint(s), all matching the recorded run artifacts"
  done <<< "$slots"
  [ "$fail" = "$before" ] || true
}

# ---------------------------------------------------------------------------
# 5. REVIEW-GATE — green against scripted threads; seeded "merged while claiming no review" red.
# ---------------------------------------------------------------------------
check_review_gate() {
  local before=$fail dir="$ITEMS/review-gate" rc rep
  [ -d "$dir" ] || { err "review-gate: item directory missing"; return; }
  # (a) green: the five requirement ops present + terminal SHIP — Blocked (the gate held).
  rc=0; rep="$TMP/rg-green.txt"
  REPORT="$rep" bash "$ASSERT/tiers.sh" smoke --scenario "$dir" --report "$rep" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -eq 0 ] && grep -q 'Verdict: PASS' "$rep" 2>/dev/null; then
    # Confirm the op log itself exercises all five requirement ops (belt-and-braces over expect.json).
    local log missing="" want o
    log="$dir/runs-current/run-1/workspace-snapshot/_local/fake/op-log.jsonl"
    for o in review-threads-read checks-read pr-comments-read review-thread-reply review-thread-resolve; do
      grep -q "\"op\":\"$o\"" "$log" 2>/dev/null || missing="$missing $o"
    done
    # requirement 2 evidence: an UNKNOWN (read-performed:false) read and a PENDING poll, never treated as clean.
    grep -q '"read-performed":false' "$log" 2>/dev/null || missing="$missing read-performed:false(req2)"
    grep -q '"files-reviewed":0'     "$log" 2>/dev/null || missing="$missing files-reviewed:0(req3)"
    if [ -z "$missing" ]; then
      ok "review-gate: green — all five WF-313 requirement paths exercised against wf-fake scripted threads; gate held (SHIP — Blocked)"
    else
      err "review-gate: green report passed but the op log is missing requirement evidence:$missing"
    fi
  else
    err "review-gate: the five-requirements scenario did not run green (exit $rc)"; [ -f "$rep" ] && sed 's/^/    /' "$rep" >&2
  fi
  # (b) seeded: a "merged while claiming no review landed" run turns red, naming the assertion.
  rc=0; rep="$TMP/rg-red.txt"
  REPORT="$rep" bash "$ASSERT/tiers.sh" smoke --scenario "$dir" --runs-dir "$dir/seeded-breakage/runs" --report "$rep" >/dev/null 2>&1 || rc=$?
  if [ "$rc" -ne 0 ] && grep -q 'Verdict: FAIL' "$rep" 2>/dev/null \
       && grep -Eq 'ops_invoked +FAIL' "$rep" 2>/dev/null \
       && grep -Eq 'terminal_block +FAIL' "$rep" 2>/dev/null; then
    ok "review-gate: seeded 'merged while claiming no review landed' turns red — names ops_invoked (missing read-back/replies) and terminal_block (Merged, not Blocked)"
  else
    err "review-gate: seeded breakage did not turn red naming the failed assertions (exit $rc)"; [ -f "$rep" ] && sed 's/^/    /' "$rep" >&2
  fi
  [ "$fail" = "$before" ] || true
}

echo "== wf-sandbox-testing CORPUS self-checks (canned run outputs) =="
check_provenance
check_slot_enum
check_flagship
check_arm_record
check_review_gate

if [ "$fail" -ne 0 ]; then
  echo "wf-sandbox-testing corpus self-checks: FAIL" >&2
  exit 1
fi
echo "wf-sandbox-testing corpus self-checks: PASS"
