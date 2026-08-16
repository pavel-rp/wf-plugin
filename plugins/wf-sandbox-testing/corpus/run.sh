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
#   6. ASSERTION ITEMS— items 3-5 (the WF-348 C014 retrofits): each runs-current set is green
#                       against its expect.json; each seeded-breakage set turns red naming a family.
#   7. COVERAGE LEDGER— every named C014/C015 item + WF-203 comment is accounted for
#                       (covered/subsumed/deferred) with a resolvable provenance link.
#   8. HOST AVAILABILITY — deterministic contract/model coverage plus an executed registered-host
#                       14-operation-scenario lifecycle.
#   9. BARE CORE      — (WF-414) with NO tracker pack registered the full conveyor completes with
#                       ZERO tracker calls and ZERO errors and every declared conveyor slot
#                       resolves {status: unfilled} onto its no-op inline default. ABSOLUTE, never
#                       variance-based: check 3's ops_invoked ceiling (0.34) tolerates one outlier
#                       in a 3-run set, which cannot express "zero". A seeded run whose inline
#                       default emits a tracker call must trip it.
#  10. ARMLESS META   — (WF-414) proves check 2's arm-less failure actually FIRES, by running the
#                       same enumeration + arm lookup against a synthetic declared slot.
#  11. DISCLOSURE     — (WF-414) every arm carries machine-readable provenance {path, reason}
#                       (canned vs real) plus its paired human-readable disclosure section.
#
# Usage: run.sh   (run every check; wired into CI as its own step)
set -uo pipefail

CORPUS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACK_DIR="$(cd "$CORPUS_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PACK_DIR/../.." && pwd)"
ASSERT="$PACK_DIR/assert"
MANIFEST="$CORPUS_DIR/manifest.md"
ITEMS="$CORPUS_DIR/items"
SLOT_EXEMPTIONS="$CORPUS_DIR/slot-exemptions.json"
MAXVAR="0.34"   # the governing comparison ceiling — the named per-family threshold decision (item.md)

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

command -v jq >/dev/null 2>&1 || { echo "corpus/run.sh: jq is required" >&2; exit 2; }

TMP="$REPO_ROOT/_local/scratch/corpus-selfcheck-$$"
mkdir -p "$TMP"
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
declared_slots_in() {
  # Mechanical: the opening <!-- wf:slot skill.point --> markers in real skill bodies
  # (<root>/plugins/*/skills/*/SKILL.md; the seeded slot-marker-fixtures/ live outside that
  # glob — since WF-369 under the wf-core-authoring pack's fixtures/ — and are not matched).
  # This is the same declared-slot surface the resolver reads
  # (WF-329). Parameterized on <root> so the WF-414 arm-less meta-check can run the SAME
  # enumeration against a synthetic tree instead of re-implementing it.
  grep -hoE '<!--[[:space:]]*wf:slot[[:space:]]+[a-z0-9-]+\.[a-z0-9-]+[[:space:]]*-->' \
    "$1"/plugins/*/skills/*/SKILL.md 2>/dev/null \
    | sed -E 's/.*wf:slot[[:space:]]+([a-z0-9-]+\.[a-z0-9-]+).*/\1/' | LC_ALL=C sort -u
}

declared_slots() { declared_slots_in "$REPO_ROOT"; }

exempt_slots() {
  # The slots deliberately carrying no per-slot corpus item, read from the single reason-bearing
  # exemption list (corpus/slot-exemptions.json). A slot lands there only when the declaring skill
  # is off the SDD conveyor the runner drives, so no arm could observe it and a fabricated one
  # would violate "observations, never speculation". Subtracted from the arm requirement ONLY —
  # check 9's bare-core slot-set accounting still enumerates every declared slot.
  jq -r '.exempt[]?.slot // empty' "$SLOT_EXEMPTIONS" 2>/dev/null | grep -v '^$' | LC_ALL=C sort -u
}

is_exempt_slot() { printf '%s\n' "$(exempt_slots)" | grep -qxF "$1"; }

slot_item_dir() {
  # ship.review -> items/empty-slot-ship-review
  printf '%s/empty-slot-%s' "$ITEMS" "$(printf '%s' "$1" | tr '.' '-')"
}

armless_slots() {
  # Print every slot declared under <root> that has NO empty-slot corpus item. The shared
  # detector behind both check_slot_enum's loud failure and the WF-414 meta-check that proves
  # that failure actually fires — an arm-less declared slot must be a red, never a silent pass.
  local slot
  while IFS= read -r slot; do
    [ -n "$slot" ] || continue
    is_exempt_slot "$slot" && continue
    [ -d "$(slot_item_dir "$slot")" ] || printf '%s\n' "$slot"
  done <<< "$(declared_slots_in "$1")"
}

check_slot_enum() {
  local before=$fail slot dir count=0
  local slots; slots="$(declared_slots)"
  [ -n "$slots" ] || { err "slot-enum: no declared slots found in source — the enumeration is broken (expected at least ship.review)"; return; }
  # Exemptions first: each must carry a non-empty reason (an unexplained exemption is a hiding
  # place), and must NOT also have a corpus item (a stale exemption silently weakens the gate).
  local exempt bad_reason stale=""
  exempt="$(exempt_slots)"
  bad_reason="$(jq -r '[.exempt[]? | select((.reason // "") == "") | .slot] | join(" ")' "$SLOT_EXEMPTIONS" 2>/dev/null)"
  [ -z "$bad_reason" ] || err "slot-enum: exempt slot(s) [$bad_reason] carry no reason — an exemption must state why no arm can observe the slot"
  while IFS= read -r slot; do
    [ -n "$slot" ] || continue
    printf '%s\n' "$slots" | grep -qxF "$slot" || stale="$stale $slot"
    [ -d "$(slot_item_dir "$slot")" ] && stale="$stale $slot(has-item)"
  done <<< "$exempt"
  [ -z "$stale" ] || err "slot-enum: stale exemption(s)$stale in corpus/slot-exemptions.json — an exemption whose slot is undeclared, or which does have a corpus item, must be removed"

  local n_exm=0
  while IFS= read -r slot; do
    [ -n "$slot" ] || continue
    if is_exempt_slot "$slot"; then n_exm=$((n_exm+1)); continue; fi
    count=$((count+1))
    dir="$(slot_item_dir "$slot")"
    [ -d "$dir" ] || { err "slot-enum: declared slot '$slot' has NO empty-slot corpus item at ${dir#$REPO_ROOT/}"; continue; }
    [ -f "$dir/baseline/arm.json" ] || err "slot-enum: '$slot' item missing baseline/arm.json"
    [ -d "$dir/runs-current" ]      || err "slot-enum: '$slot' item missing runs-current/"
    [ -d "$dir/seeded-breakage/runs" ] || err "slot-enum: '$slot' item missing seeded-breakage/runs/"
  done <<< "$slots"
  [ "$fail" = "$before" ] && ok "slot-enum: $count declared slot(s) each have a per-slot empty-slot corpus item, $n_exm reason-bearing exemption(s) [$(printf '%s' "$exempt" | tr '\n' ' ')] (per declared slot, not one global)"
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
    # A slot carrying a reason-bearing entry in slot-exemptions.json has no arm by design
    # (check 2 owns that list and fails a stale entry); demanding its arm record here would
    # re-impose the requirement check 2 deliberately waived.
    is_exempt_slot "$slot" && continue
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

# ---------------------------------------------------------------------------
# 6. ASSERTION ITEMS — items 3-5 (the WF-348 C014 retrofits): each runs-current set
#    is green against its expect.json; each seeded-breakage set turns red naming a family.
# ---------------------------------------------------------------------------
check_assertion_items() {
  local before=$fail name dir rc rep
  for name in contribution-survival model-swap-drift orphaned-override; do
    dir="$ITEMS/$name"
    [ -d "$dir" ]            || { err "assertion-item: '$name' directory missing at ${dir#$REPO_ROOT/}"; continue; }
    [ -f "$dir/expect.json" ] || { err "assertion-item[$name]: expect.json missing"; continue; }
    [ -d "$dir/seeded-breakage/runs" ] || err "assertion-item[$name]: seeded-breakage/runs/ missing"
    # (a) green: runs-current PASSes the assertion.
    rc=0; rep="$TMP/ai-green-$name.txt"
    REPORT="$rep" bash "$ASSERT/tiers.sh" smoke --scenario "$dir" --report "$rep" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -eq 0 ] && grep -q 'Verdict: PASS' "$rep" 2>/dev/null; then
      ok "assertion-item[$name]: runs-current is green against expect.json"
    else
      err "assertion-item[$name]: runs-current did NOT run green (exit $rc)"; [ -f "$rep" ] && sed 's/^/    /' "$rep" >&2
    fi
    # (b) seeded-red: the seeded set FAILs, naming a structural family.
    rc=0; rep="$TMP/ai-red-$name.txt"
    REPORT="$rep" bash "$ASSERT/tiers.sh" smoke --scenario "$dir" --runs-dir "$dir/seeded-breakage/runs" --report "$rep" >/dev/null 2>&1 || rc=$?
    if [ "$rc" -ne 0 ] && grep -q 'Verdict: FAIL' "$rep" 2>/dev/null \
         && grep -Eq '(terminal_block|files_touched|ops_invoked) +FAIL' "$rep" 2>/dev/null; then
      ok "assertion-item[$name]: seeded breakage turns red naming a failed family"
    else
      err "assertion-item[$name]: seeded breakage did not turn red naming a family (exit $rc)"; [ -f "$rep" ] && sed 's/^/    /' "$rep" >&2
    fi
  done
  [ "$fail" = "$before" ] && ok "assertion-items: items 3-5 (C014 retrofits) each run green on current + turn red on seeded breakage"
}

# ---------------------------------------------------------------------------
# 7. COVERAGE LEDGER — every named C014/C015 item + WF-203 comment is accounted for
#    (covered / subsumed / deferred) with a resolvable provenance link. Zero silently dropped.
# ---------------------------------------------------------------------------
check_ledger() {
  local before=$fail want missing="" undeferred
  [ -f "$MANIFEST" ] || { err "ledger: manifest.md not found at $MANIFEST"; return; }
  grep -q 'Watch-list coverage ledger' "$MANIFEST" || err "ledger: the 'Watch-list coverage ledger' section is missing"
  grep -q 'Subsumption record'         "$MANIFEST" || err "ledger: the 'Subsumption record' section is missing (C014-1 must name its covering flagship)"
  # The explicitly-deferred watch-list items must each be present by name (never silently dropped).
  for want in "constitution payload presence" "dedupe across re-fires" "fleet-shipper coverage" "/wf:tc"; do
    grep -qF "$want" "$MANIFEST" || missing="$missing [$want]"
  done
  [ -z "$missing" ] || err "ledger: a deferred watch-list item is not accounted for in the manifest:$missing"
  # Every 'deferred with rationale' ledger row must carry a resolvable provenance link on its line.
  undeferred="$(grep 'deferred with rationale' "$MANIFEST" | grep -Ev 'WF-[0-9]+|C0[0-9]+' || true)"
  [ -z "$undeferred" ] || err "ledger: a 'deferred with rationale' row lacks a WF-<n>/C0<n> provenance link"
  [ "$fail" = "$before" ] && ok "ledger: all named C014/C015 items + WF-203 comments accounted for (covered/subsumed/deferred), each provenance-linked — zero silently dropped"
}

# ---------------------------------------------------------------------------
# 8. HOST AVAILABILITY — deterministic contract/model coverage for generation/run/follow-up,
#    plus an executed registered-host fixture lifecycle over 14 scenarios.
# ---------------------------------------------------------------------------
check_host_availability() {
  local before=$fail host_fixture="$PACK_DIR/fixtures/host-lifecycle/selfcheck.sh"
  if bash "$host_fixture" >/dev/null 2>&1; then
    ok "host-availability: generation/run/follow-up contract-model coverage, qa-auto ordering model, alias/overlap, symlink-negative assertion, and executed 14-scenario teardown paths pass"
  else
    err "host-availability: host contract/model or fixture lifecycle coverage failed"
  fi
  [ "$fail" = "$before" ] || true
}

# ---------------------------------------------------------------------------
# 9. BARE CORE — the C021 OUT-4 invariant (WF-414): with NO tracker pack registered the full
#    conveyor completes with ZERO tracker calls and ZERO errors, and every declared conveyor
#    slot resolves {status: unfilled} and runs its no-op inline default.
#
#    ABSOLUTE, never variance-based. The empty-slot comparison items (3.) judge an unfilled
#    slot against a tracker-REGISTERED control under an ops_invoked ceiling of 0.34 — "one
#    outlier in a 3-run set tolerated" — so a no-op default emitting a tracker call on a
#    minority of runs is classified drift and passes there. "Zero tracker calls" is not
#    expressible as a variance threshold, so this check calls compare.sh not at all.
# ---------------------------------------------------------------------------
check_barecore() {
  local before=$fail
  local dir="$ITEMS/barecore-conveyor"
  local arm="$dir/arm.json"
  [ -d "$dir" ] || { err "barecore: item directory missing at ${dir#$REPO_ROOT/}"; return; }
  [ -f "$arm" ] || { err "barecore: arm.json missing at ${arm#$REPO_ROOT/}"; return; }

  # (a) Slot-set completeness — covered + exempt must equal the mechanically enumerated
  #     declared-slot set, so a NEWLY declared slot appearing in neither list fails loudly.
  local slots union uncovered slot n_cov n_exm bad_reason
  slots="$(declared_slots)"
  n_cov="$(jq -r '.slots_covered // [] | length' "$arm")"
  n_exm="$(jq -r '.slots_exempt  // [] | length' "$arm")"
  union="$( { jq -r '.slots_covered[]?' "$arm"; jq -r '.slots_exempt[]?.slot' "$arm"; } | grep -v '^$' | LC_ALL=C sort -u )"
  uncovered=""
  while IFS= read -r slot; do
    [ -n "$slot" ] || continue
    printf '%s\n' "$union" | grep -qxF "$slot" || uncovered="$uncovered $slot"
  done <<< "$slots"
  if [ -n "$uncovered" ]; then
    err "barecore: declared slot(s)$uncovered appear in neither slots_covered nor slots_exempt — a newly declared slot must be covered by the bare-core arm or explicitly exempted with a reason"
  else
    ok "barecore: slot-set complete — $n_cov covered + $n_exm exempt covers every declared slot"
  fi
  # Every exemption must carry a non-empty reason (an unexplained exemption is a hiding place).
  bad_reason="$(jq -r '[.slots_exempt[]? | select((.reason // "") == "") | .slot] | join(" ")' "$arm")"
  [ -z "$bad_reason" ] || err "barecore: exempt slot(s) [$bad_reason] carry no reason — an exemption must state why the slot is unreachable in bare core"

  # (b)-(d) Over every run in the current set: per-slot unfilled resolution, zero tracker
  #         records (absolute), and a clean exit.
  local run rc_runs=0 log ntrk exit_code verdict missing_slot cov
  cov="$(jq -r '.slots_covered[]?' "$arm")"
  for run in "$dir"/runs-current/run-*; do
    [ -d "$run" ] || continue
    rc_runs=$((rc_runs+1))
    # per-slot unfilled -> inline-default
    missing_slot=""
    while IFS= read -r slot; do
      [ -n "$slot" ] || continue
      jq -e --arg s "$slot" \
        'any(.slot_resolutions[]?; .slot == $s and .status == "unfilled" and .executed == "inline-default")' \
        "$run/run.json" >/dev/null 2>&1 || missing_slot="$missing_slot $slot"
    done <<< "$cov"
    [ -z "$missing_slot" ] || err "barecore[$(basename "$run")]: slot(s)$missing_slot not recorded as {status: unfilled} executing the no-op inline default"
    # ZERO tracker-surface records — absolute, no tolerated outlier.
    log="$run/workspace-snapshot/_local/fake/op-log.jsonl"
    ntrk=0
    [ -f "$log" ] && ntrk="$(jq -s '[.[] | select(.surface == "tracker")] | length' "$log" 2>/dev/null || echo 0)"
    [ "${ntrk:-0}" -eq 0 ] || err "barecore[$(basename "$run")]: op log records ${ntrk} tracker-surface op(s) — a bare-core conveyor must emit ZERO tracker calls: $(jq -r 'select(.surface == "tracker") | "slot=\(.slot // "?") op=\(.op)"' "$log" | tr '\n' ' ')"
    # ZERO errors — in bare core an attempted tracker call cannot silently succeed.
    exit_code="$(jq -r '.run.exit_code // 1' "$run/run.json")"
    verdict="$(jq -r '.verdict // "?"' "$run/run.json")"
    { [ "$exit_code" = "0" ] && [ "$verdict" = "ok" ]; } \
      || err "barecore[$(basename "$run")]: run did not complete cleanly (exit_code=$exit_code verdict=$verdict) — the bare-core invariant requires zero errors"
  done
  [ "$rc_runs" -ge 2 ] || err "barecore: expected an N-run set (>=2 runs) in runs-current/, found $rc_runs"

  # (e) The seeded set must turn this check RED — the negative control proving the detector
  #     can actually observe a tracker call rather than passing vacuously.
  local sdir="$dir/seeded-breakage/runs" seen_trk=0 seen_err=0
  for run in "$sdir"/run-*; do
    [ -d "$run" ] || continue
    log="$run/workspace-snapshot/_local/fake/op-log.jsonl"
    if [ -f "$log" ] && [ "$(jq -s '[.[] | select(.surface == "tracker")] | length' "$log" 2>/dev/null || echo 0)" -gt 0 ]; then seen_trk=1; fi
    [ "$(jq -r '.run.exit_code // 0' "$run/run.json")" = "0" ] || seen_err=1
  done
  if [ "$seen_trk" -eq 1 ] && [ "$seen_err" -eq 1 ]; then
    ok "barecore: seeded breakage carries a tracker-surface op AND a non-zero exit — it fails both the zero-call and the zero-error assertions, proving the check is load-bearing"
  else
    err "barecore: the seeded breakage set does not trip both assertions (tracker-op seen=$seen_trk, error seen=$seen_err) — without it, 'zero tracker records' could pass vacuously"
  fi

  [ "$fail" = "$before" ] && ok "barecore: $rc_runs-run bare-core conveyor set — zero tracker calls, zero errors, every covered slot unfilled on its no-op inline default (absolute, no variance ceiling)"
}

# ---------------------------------------------------------------------------
# 10. ARM-LESS META — prove the arm-less-declared-slot failure actually FIRES (WF-414).
#     check_slot_enum implements it; nothing exercised it. A guard nobody has seen go red is
#     indistinguishable from a guard that cannot.
# ---------------------------------------------------------------------------
check_armless_meta() {
  local before=$fail synth="$TMP/armless/plugins/synthpack/skills/ghost" detected real_armless
  mkdir -p "$synth"
  {
    printf '# /wf:ghost — synthetic fixture skill (WF-414 meta-check, never installed)\n\n'
    printf '<!-- wf:slot ghost.nonexistent -->\n'
    printf 'A synthetic no-op inline default. This body exists only inside the corpus\n'
    printf 'self-check temp dir for the length of one run.\n'
    printf '<!-- wf:slot-end ghost.nonexistent -->\n'
  } > "$synth/SKILL.md"

  # The SAME enumeration + arm lookup the real check uses, pointed at the synthetic tree.
  detected="$(armless_slots "$TMP/armless" | tr '\n' ' ' | sed 's/ *$//')"
  if [ "$detected" = "ghost.nonexistent" ]; then
    ok "armless-meta: a declared slot with no matching arm IS detected as arm-less ('$detected') — the suite fails loudly rather than passing silently"
  else
    err "armless-meta: the arm-less detector did NOT flag the synthetic declared slot (got '$detected', expected 'ghost.nonexistent') — an arm-less declared slot could pass silently"
  fi

  # Control: the real tree must have zero arm-less slots, or check_slot_enum is already red.
  real_armless="$(armless_slots "$REPO_ROOT" | tr '\n' ' ' | sed 's/ *$//')"
  [ -z "$real_armless" ] || err "armless-meta: the shipped tree has arm-less declared slot(s) [$real_armless]"
  [ "$fail" = "$before" ] && ok "armless-meta: detector proven in both directions — fires on a synthetic arm-less slot, silent on the shipped tree"
}

# ---------------------------------------------------------------------------
# 11. DISCLOSURE — every arm states, machine-readably, whether it was produced by a real
#     containerized run or canned, and why (WF-414). Prose alone is not auditable.
# ---------------------------------------------------------------------------
check_disclosure() {
  local before=$fail arm p r n=0 rel
  for arm in "$ITEMS"/empty-slot-*/baseline/arm.json "$ITEMS"/barecore-conveyor/arm.json; do
    [ -f "$arm" ] || { err "disclosure: expected arm.json missing at ${arm#$REPO_ROOT/}"; continue; }
    n=$((n+1)); rel="${arm#$ITEMS/}"
    p="$(jq -r '.provenance.path   // empty' "$arm")"
    r="$(jq -r '.provenance.reason // empty' "$arm")"
    case "$p" in
      canned|real) ;;
      "") err "disclosure: $rel carries no provenance.path — every arm must disclose canned vs real"; continue;;
      *)  err "disclosure: $rel has provenance.path '$p' — must be exactly 'canned' or 'real'"; continue;;
    esac
    [ -n "$r" ] || err "disclosure: $rel is '$p' but carries no provenance.reason — a canned arm must say why a live run was not used"
  done
  # The paired human-readable disclosure section must exist alongside the machine-readable field.
  local item
  for item in "$ITEMS"/empty-slot-*/item.md "$ITEMS"/barecore-conveyor/item.md; do
    [ -f "$item" ] || { err "disclosure: item.md missing at ${item#$REPO_ROOT/}"; continue; }
    grep -qi 'Canned-vs-real disclosure' "$item" \
      || err "disclosure: ${item#$ITEMS/} has no 'Canned-vs-real disclosure' section"
  done
  [ "$fail" = "$before" ] && ok "disclosure: all $n arms carry a machine-readable provenance {path, reason} plus a paired canned-vs-real disclosure section"
}

check_provenance
check_slot_enum
check_flagship
check_arm_record
check_review_gate
check_assertion_items
check_ledger
check_host_availability
check_barecore
check_armless_meta
check_disclosure

if [ "$fail" -ne 0 ]; then
  echo "wf-sandbox-testing corpus self-checks: FAIL" >&2
  exit 1
fi
echo "wf-sandbox-testing corpus self-checks: PASS"
