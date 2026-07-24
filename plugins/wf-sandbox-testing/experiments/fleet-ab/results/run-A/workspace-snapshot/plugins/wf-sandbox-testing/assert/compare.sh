#!/usr/bin/env bash
# compare.sh — baseline comparison of TWO run sets on the structural families.
#
# The comparison primitive the corpus flagship (WF-347) instantiates per slot: it compares
# a CURRENT-build run set against a PINNED-BASELINE run set (WF-345's pinned-build install
# option) and reports, per structural family, EQUIVALENCE or DIVERGENCE under the variance
# protocol. It compares the families' canonical STRUCTURAL signatures — terminal-block
# name+status, the resulting-workspace file set, the invoked-op set — NEVER a transcript
# exact-match. Drift within a set (variance below threshold) is not divergence; a changed
# modal signature between the sets is.
#
# Usage: compare.sh --current <set-dir> --baseline <set-dir> [--max-variance <0..1>] [--report <out-file>]
#   --max-variance  the per-set internal-variance ceiling (fraction of runs allowed off the
#                   modal signature) under which the two sets are still judged comparable;
#                   default 0.34 (a single outlier in a 3-run set is tolerated).
set -uo pipefail

_CMP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
. "$_CMP_DIR/lib.sh"

FAMILIES="terminal_block files_touched ops_invoked"

# observed_sig <run-dir> <family> — the family's canonical STRUCTURAL signature for one run.
observed_sig() {
  local run="$1" fam="$2"
  case "$fam" in
    terminal_block)
      local tb; tb="$(extract_terminal_block "$run/transcript.jsonl" 2>/dev/null)" \
        && printf '%s|%s' "$(printf '%s' "$tb" | cut -f1)" "$(printf '%s' "$tb" | cut -f2)" \
        || printf '<none>' ;;
    files_touched)
      list_workspace_files "$run" | cksum | awk '{print $1"-"$2}' ;;
    ops_invoked)
      extract_ops "$run" | tr '\n' ',' | sed 's/,$//' ;;
  esac
}

# modal_for_set <set-dir> <family> — print "modal_sig<TAB>off_count<TAB>n": the most common
# structural signature across the set's runs, the count of runs that differ from it, and n.
modal_for_set() {
  local set="$1" fam="$2" d n=0
  local -a sigs=()
  while IFS= read -r d; do
    sigs+=("$(observed_sig "$d" "$fam")"); n=$((n+1))
  done < <(list_run_dirs "$set")
  if [ "$n" -eq 0 ]; then printf '<empty>\t0\t0\n'; return; fi
  local modal off
  modal="$(printf '%s\n' "${sigs[@]}" | LC_ALL=C sort | uniq -c | LC_ALL=C sort -rn | head -n1 | sed -E 's/^ *[0-9]+ //')"
  off="$(printf '%s\n' "${sigs[@]}" | grep -Fvx -- "$modal" | grep -c . || true)"
  printf '%s\t%s\t%s\n' "$modal" "$off" "$n"
}

run_compare() {
  local cur="$1" base="$2" maxvar="${3:-0.34}"
  local overall=EQUIVALENT
  local hdr body="" fam
  hdr="=== wf-sandbox-testing baseline comparison ===
Current set:   $cur
Baseline set:  $base
Max internal variance: $maxvar (per set, fraction off the modal signature)"
  body="$body\nStructural families (comparison — never a transcript exact-match):"
  for fam in $FAMILIES; do
    local cm bm cmodal coff cn bmodal boff bn cvar bvar within result
    cm="$(modal_for_set "$cur" "$fam")"; bm="$(modal_for_set "$base" "$fam")"
    cmodal="$(printf '%s' "$cm" | cut -f1)"; coff="$(printf '%s' "$cm" | cut -f2)"; cn="$(printf '%s' "$cm" | cut -f3)"
    bmodal="$(printf '%s' "$bm" | cut -f1)"; boff="$(printf '%s' "$bm" | cut -f2)"; bn="$(printf '%s' "$bm" | cut -f3)"
    cvar="$(awk -v o="$coff" -v n="$cn" 'BEGIN{printf "%.3f",(n?o/n:1)}')"
    bvar="$(awk -v o="$boff" -v n="$bn" 'BEGIN{printf "%.3f",(n?o/n:1)}')"
    within="$(awk -v c="$cvar" -v b="$bvar" -v m="$maxvar" 'BEGIN{print (c<=m+1e-9 && b<=m+1e-9)?1:0}')"
    if [ "$cmodal" = "$bmodal" ] && [ "$within" = 1 ]; then
      result="EQUIVALENT"
    else
      result="DIVERGENT"; overall=DIVERGENT
    fi
    body="$body\n  $(printf '%-15s %-11s current-var %s baseline-var %s | current=%s baseline=%s' \
        "$fam" "$result" "$cvar" "$bvar" "$cmodal" "$bmodal")"
  done
  body="$body\nComparison verdict: $overall"
  local report; report="$(printf '%b' "$hdr$body")"
  printf '%s\n' "$report"
  if [ -n "${REPORT:-}" ]; then printf '%s\n' "$report" > "$REPORT"; fi
  [ "$overall" = EQUIVALENT ] && return 0 || return 1
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  require_jq || exit 2
  CUR=""; BASE=""; MAXVAR="0.34"; REPORT=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --current) CUR="${2:?}"; shift 2;;
      --baseline) BASE="${2:?}"; shift 2;;
      --max-variance) MAXVAR="${2:?}"; shift 2;;
      --report) REPORT="${2:?}"; shift 2;;
      *) echo "compare.sh: unknown argument '$1'" >&2; exit 2;;
    esac
  done
  [ -n "$CUR" ] && [ -n "$BASE" ] || { echo "usage: compare.sh --current <dir> --baseline <dir> [--max-variance f] [--report f]" >&2; exit 2; }
  export REPORT
  run_compare "$CUR" "$BASE" "$MAXVAR"
fi
