#!/usr/bin/env bash
# parity-check.sh — dry-run command-sequence parity comparator.
#
#   parity-check.sh <baseline-stdout> <candidate-stdout>
#
# Compares two captured `--dry-run` stdout streams under the normalization contract in
# normalization.md. This script is that contract's transcription: every rule below cites the
# section it implements, and the two files are changed together or not at all.
#
# Exit: 0 parity holds · 1 parity fails · 2 usage/input error.
#
# Requires bash 4+ (associative arrays). No Docker, no network, no writes — it reads two files.
set -uo pipefail

PROG="parity-check.sh"
usage() {
  cat >&2 <<'EOF'
usage: parity-check.sh <baseline-stdout> <candidate-stdout>

Compares two captured dry-run stdout streams per normalization.md.
Reads stdout captures only — a stderr capture is never an input (normalization.md §1).

exit 0  parity holds
exit 1  parity fails (the diverging token is named)
exit 2  usage or input error
EOF
}

fail_count=0
note() { echo "$PROG: $*"; }
fail() { echo "$PROG: FAIL — $*" >&2; fail_count=$((fail_count + 1)); }
die()  { echo "$PROG: ERROR — $*" >&2; exit 2; }

# --- N1: tokenize on unquoted, unescaped whitespace (normalization.md §2 N1, §4.2, §4.3) --------
# Whitespace separates tokens only outside quotes and only unescaped. A backslash escapes the next
# character; single quotes take everything literally to the closing quote; double quotes honour the
# backslash. The escaping/quoting STYLE is discarded, the resulting VALUE is kept -- so `\ `, "' '"
# and '" "' all yield the same token, while an explicitly empty token ('') survives as an empty
# token rather than vanishing (which is what keeps §3.7's --packs '' case a real divergence).
TOKENS=()
split_tokens() {
  local line="$1" tok="" esc=0 state="bare" started=0 i ch
  TOKENS=()
  for (( i = 0; i < ${#line}; i++ )); do
    ch="${line:i:1}"
    if [ "$esc" = 1 ]; then tok+="$ch"; esc=0; continue; fi
    case "$state" in
      sq) if [ "$ch" = "'" ]; then state="bare"; else tok+="$ch"; fi ;;
      dq)
        case "$ch" in
          '"') state="bare" ;;
          '\') esc=1 ;;
          *) tok+="$ch" ;;
        esac ;;
      *)
        case "$ch" in
          '\') esc=1; started=1 ;;
          "'") state="sq"; started=1 ;;
          '"') state="dq"; started=1 ;;
          ' '|$'\t') [ "$started" = 1 ] && { TOKENS+=("$tok"); tok=""; started=0; } ;;
          *) tok+="$ch"; started=1 ;;
        esac ;;
    esac
  done
  [ "$started" = 1 ] && TOKENS+=("$tok")
  return 0
}

# --- N3: reduce path fields (normalization.md §2 N3, §4.4, §4.5) --------------------------------
# Split the token on ':', reduce each field independently, rejoin. Only a field that IS the kit
# root or starts with "<kit-root>/" is rewritten, plus any field under /tmp/. Everything else --
# including the container-side mount half and a token that merely contains ':' -- round-trips.
reduce_token() {
  local token="$1" root="$2" out="" field first=1
  local -a fields=()
  local rest="$token"
  while [ -n "$rest" ]; do
    if [[ "$rest" == *:* ]]; then
      fields+=("${rest%%:*}")
      rest="${rest#*:}"
      [ -z "$rest" ] && fields+=("")
    else
      fields+=("$rest")
      rest=""
    fi
  done
  for field in ${fields+"${fields[@]}"}; do
    if [ -n "$root" ] && [ "$field" = "$root" ]; then
      field="<kit>"
    elif [ -n "$root" ] && [ "${field#"$root"/}" != "$field" ]; then
      field="<kit>/${field#"$root"/}"
    elif [ "${field#/tmp/}" != "$field" ]; then
      field="<tmp>"
    fi
    if [ "$first" = 1 ]; then out="$field"; first=0; else out="$out:$field"; fi
  done
  printf '%s' "$out"
}

# --- N4: derive the unit key from the line's own content (normalization.md §2 N4) ---------------
# Returns "phase:arm", or the empty string when the line is unclassifiable (§6 -> FAIL).
unit_key() {
  local -a toks=("$@")
  local t field
  for t in ${toks+"${toks[@]}"}; do
    [ "$t" = "<kit>/build-arm.sh" ] && { printf 'build:both'; return 0; }
    [ "$t" = "<kit>/analyze.sh" ] && { printf 'analyze:both'; return 0; }
  done
  for t in ${toks+"${toks[@]}"}; do
    field="${t%%:*}"
    if [ "${field#<kit>/results/gate-}" != "$field" ]; then
      printf 'gate:%s' "${field#<kit>/results/gate-}"; return 0
    fi
    if [ "${field#<kit>/results/run-}" != "$field" ]; then
      printf 'pilot:%s' "${field#<kit>/results/run-}"; return 0
    fi
  done
  printf ''
  return 0
}

# --- Load one side: tokenize, derive its kit root, reduce, key by unit --------------------------
# Populates, for the side named by $2 ("BASE" or "CAND"):
#   <side>_UNITS[key]   -> occurrence count for that unit (normalization.md §3.9)
#   <side>_TOK[key#n]   -> the n-th occurrence's tokens, newline-joined
declare -A BASE_UNITS=() BASE_TOK=() CAND_UNITS=() CAND_TOK=()
KIT_ROOT=""

load_side() {
  local file="$1" side="$2"
  [ -r "$file" ] || die "cannot read '$file'."

  local -a raw_lines=()
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    [ -z "${line//[[:space:]]/}" ] && continue
    raw_lines+=("$line")
  done < "$file"

  [ "${#raw_lines[@]}" -gt 0 ] || { fail "$side capture '$file' holds no command lines."; return 1; }

  # N2 — the side declares its own kit root via its build-arm.sh token (§2 N2, §6).
  local root="" t
  for line in "${raw_lines[@]}"; do
    split_tokens "$line"
    for t in ${TOKENS+"${TOKENS[@]}"}; do
      if [ "${t%/build-arm.sh}" != "$t" ]; then root="${t%/build-arm.sh}"; break; fi
    done
    [ -n "$root" ] && break
  done
  if [ -z "$root" ]; then
    fail "$side capture '$file' has no build-arm.sh command line, so its kit root cannot be derived — the build phase is missing (normalization.md §6)."
    return 1
  fi
  KIT_ROOT="$root"

  local key idx joined
  for line in "${raw_lines[@]}"; do
    split_tokens "$line"
    local -a norm=()
    for t in ${TOKENS+"${TOKENS[@]}"}; do
      norm+=("$(reduce_token "$t" "$root")")
    done
    key="$(unit_key ${norm+"${norm[@]}"})"
    if [ -z "$key" ]; then
      fail "$side capture holds an unclassifiable command line (normalization.md §6): ${norm[*]}"
      continue
    fi
    printf -v joined '%s\n' ${norm+"${norm[@]}"}
    if [ "$side" = "BASE" ]; then
      idx=$(( ${BASE_UNITS[$key]:-0} + 1 )); BASE_UNITS["$key"]=$idx; BASE_TOK["$key#$idx"]="$joined"
    else
      idx=$(( ${CAND_UNITS[$key]:-0} + 1 )); CAND_UNITS["$key"]=$idx; CAND_TOK["$key#$idx"]="$joined"
    fi
  done
  return 0
}

tok_array() { # $1 = newline-joined tokens -> global OUT_TOKENS
  OUT_TOKENS=()
  local l
  while IFS= read -r l; do OUT_TOKENS+=("$l"); done <<< "${1%$'\n'}"
}

# --- Compare one unit's occurrence, token by token (normalization.md §3.1-3.8, §6) --------------
compare_occurrence() {
  local key="$1" n="$2"
  local -a b=() c=()
  tok_array "${BASE_TOK["$key#$n"]}"; b=("${OUT_TOKENS[@]}")
  tok_array "${CAND_TOK["$key#$n"]}"; c=("${OUT_TOKENS[@]}")

  local max=${#b[@]}; [ "${#c[@]}" -gt "$max" ] && max=${#c[@]}
  local i bt ct diverged=0
  for (( i = 0; i < max; i++ )); do
    bt="${b[i]-}"; ct="${c[i]-}"
    if [ "$bt" != "$ct" ]; then
      if [ -z "${c[i]+set}" ]; then
        fail "unit '$key': candidate is missing the token at position $((i + 1)) — baseline has '$bt'."
      elif [ -z "${b[i]+set}" ]; then
        fail "unit '$key': candidate has a surplus token at position $((i + 1)) — '$ct'."
      else
        fail "unit '$key': diverging token at position $((i + 1)) — baseline '$bt', candidate '$ct'."
      fi
      diverged=1
      break
    fi
  done
  return $diverged
}

# --- main --------------------------------------------------------------------------------------
[ $# -eq 2 ] || { usage; exit 2; }
case "${1:-}" in -h|--help) usage; exit 0 ;; esac

BASELINE="$1" CANDIDATE="$2"

load_side "$BASELINE" BASE || { echo "$PROG: parity FAILED (baseline unreadable as a command surface)." >&2; exit 1; }
BASE_ROOT="$KIT_ROOT"
load_side "$CANDIDATE" CAND || { echo "$PROG: parity FAILED (candidate unreadable as a command surface)." >&2; exit 1; }
CAND_ROOT="$KIT_ROOT"

note "baseline:  $BASELINE  (kit root $BASE_ROOT)"
note "candidate: $CANDIDATE  (kit root $CAND_ROOT)"

# The baseline's arm set scopes the comparison (normalization.md §5).
declare -A BASE_ARMS=()
for key in "${!BASE_UNITS[@]}"; do BASE_ARMS["${key#*:}"]=1; done

# Every baseline unit must be matched, occurrence for occurrence (§3.9, §3.10).
compared=0
mapfile -t sorted_base < <(printf '%s\n' "${!BASE_UNITS[@]}" | LC_ALL=C sort)
for key in "${sorted_base[@]}"; do
  bcount="${BASE_UNITS[$key]}"
  ccount="${CAND_UNITS[$key]:-0}"
  if [ "$ccount" = 0 ]; then
    fail "unit '$key' is present in the baseline and absent from the candidate (normalization.md §3.10)."
    continue
  fi
  if [ "$bcount" != "$ccount" ]; then
    fail "unit '$key': line count differs — baseline $bcount, candidate $ccount (normalization.md §3.9)."
    continue
  fi
  for (( n = 1; n <= bcount; n++ )); do
    compare_occurrence "$key" "$n"
  done
  compared=$((compared + bcount))
done

# Candidate-only units: out of scope when the arm is unknown to the baseline, a divergence otherwise (§5).
outofscope=0
mapfile -t sorted_cand < <(printf '%s\n' "${!CAND_UNITS[@]}" | LC_ALL=C sort)
for key in "${sorted_cand[@]}"; do
  [ -n "${BASE_UNITS[$key]:-}" ] && continue
  arm="${key#*:}"
  if [ -z "${BASE_ARMS[$arm]:-}" ]; then
    note "out of scope — unit '$key' has no baseline counterpart arm '$arm' (arm-scoping rule, normalization.md §5)."
    outofscope=$((outofscope + 1))
  else
    fail "unit '$key' is an extra command for in-scope arm '$arm' — arm-scoping does not excuse it (normalization.md §5)."
  fi
done

note "compared $compared command line(s) across ${#sorted_base[@]} unit(s); $outofscope out of scope."

if [ "$fail_count" -gt 0 ]; then
  echo "$PROG: parity FAILED — $fail_count diverging finding(s)." >&2
  exit 1
fi
note "parity holds — every compared token is identical after normalization."
exit 0
