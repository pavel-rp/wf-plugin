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
# Requires bash 4+ (associative arrays, mapfile). No Docker, no network, no writes — it reads two
# files. The requirement is ENFORCED below, not merely documented: under bash 3.2 (still /bin/bash on
# macOS) the missing builtins fail non-fatally, and since this script deliberately omits `set -e` the
# run would otherwise limp to the "parity holds" line and exit 0 on a genuinely divergent pair.
set -uo pipefail

PROG="parity-check.sh"

if [ "${BASH_VERSINFO[0]:-0}" -lt 4 ]; then
  echo "parity-check.sh: ERROR — requires bash 4+ (found ${BASH_VERSION:-unknown}); refusing to run rather than risk a false pass (normalization.md §6)." >&2
  exit 2
fi
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
# Named log() to match the kit's established stderr helper (run-experiment.sh:57) — the same helper
# capture.md refers to when it calls the ignored stderr class "the log() narration".
log() { echo "$PROG: $*" >&2; }
fail() { echo "$PROG: FAIL — $*" >&2; fail_count=$((fail_count + 1)); }
die()  { echo "$PROG: ERROR — $*" >&2; exit 2; }

# Every piece of CAPTURE CONTENT that reaches a report goes through this first -- tokens, and equally
# the kit roots, unit keys and arm names derived from a capture. A candidate is an untrusted file: a
# string carrying `ESC[2K CR` would otherwise be interpreted by the operator's terminal and erase the
# very FAIL row that reports it, and an unreset `ESC[8m` would conceal every row printed after it.
# Each control byte is rendered as its own `\xNN`, not a flat placeholder, so two strings differing
# only in control bytes never render identically -- §6 requires a failure to name BOTH values. The
# quotes make an empty token visible as ''.
# san() sanitizes; q() sanitizes AND quotes. Two helpers because half the report sinks already sit
# inside their own quotes (`unit '$key'`) and would otherwise be double-quoted.
san() {
  local s="$1" out="" i ch
  for (( i = 0; i < ${#s}; i++ )); do
    ch="${s:i:1}"
    case "$ch" in
      [[:cntrl:]]) printf -v ch '\\x%02x' "'$ch" ;;
    esac
    out+="$ch"
  done
  printf '%s' "$out"
}
q() { printf "'%s'" "$(san "$1")"; }

# Declared input bounds (normalization.md §6, §7). split_tokens re-indexes its line per character, so
# cost grows with the square of the line length; and a per-line check alone bounds neither the file
# nor the buffer a single huge line is read into. All three are checked, cheapest first: total bytes
# before the file is opened, then line count and line length inside the read loop. The baseline is 6
# lines and well under 1 KiB per line, so every bound has orders of magnitude of headroom.
MAX_LINE_CHARS=8192
MAX_LINES=10000
MAX_FILE_BYTES=1048576

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
        # Inside double quotes a backslash escapes ONLY $ ` " and itself; before anything else it
        # is a literal backslash. Collapsing every \X would make `\9c99498` and `9c99498` normalize
        # alike and silently pass a §3.3 divergence, so the next character is inspected first.
        case "$ch" in
          '"') state="bare" ;;
          '\')
            case "${line:i+1:1}" in
              '$'|'`'|'"'|'\') esc=1 ;;
              *) tok+="$ch" ;;
            esac ;;
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
      # Only the per-run RANDOM DIRECTORY component is reduced (§2 N3, §4.5). Collapsing the
      # whole field to <tmp> would also discard a staged file's basename, and with it any arm
      # identity that basename carries -- which §3.6 declares compared. `/tmp/stage-1111/x.json`
      # and `/tmp/stage-9999/y.json` must differ; only their random directory may not.
      local tail="${field#/tmp/}"
      if [[ "$tail" == */* ]]; then field="<tmp>/${tail#*/}"; else field="<tmp>"; fi
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
  # Every ':'-separated field is inspected, not just the first — normalization.md §2 N4 keys off
  # "a path field", and the host half of a mount is not guaranteed to be the leading one.
  local rest
  for t in ${toks+"${toks[@]}"}; do
    rest="$t"
    while : ; do
      field="${rest%%:*}"
      if [ "${field#<kit>/results/gate-}" != "$field" ]; then
        printf 'gate:%s' "${field#<kit>/results/gate-}"; return 0
      fi
      if [ "${field#<kit>/results/run-}" != "$field" ]; then
        printf 'pilot:%s' "${field#<kit>/results/run-}"; return 0
      fi
      [[ "$rest" == *:* ]] || break
      rest="${rest#*:}"
    done
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
  # A directory passes `-r`, and redirecting from one makes `read` error on every call — which used
  # to leave `line` unset and trip `set -u`, aborting with no verdict line and exit 1 (the code
  # reserved for a real parity failure). Both halves matter: reject a non-regular file up front, and
  # initialise `line` so no read failure can abort the loop instead of ending it.
  { [ -f "$file" ] && [ -r "$file" ]; } || die "cannot read '$file'."

  # Cheapest bound first, before a single byte is read into the shell.
  local bytes
  bytes="$(wc -c < "$file")"
  bytes="${bytes//[[:space:]]/}"
  [ "$bytes" -le "$MAX_FILE_BYTES" ] || \
    die "'$file' is $bytes bytes, over the ${MAX_FILE_BYTES}-byte input bound (normalization.md §6)."

  local -a raw_lines=()
  local line="" lineno=0
  while IFS= read -r line || [ -n "$line" ]; do
    lineno=$((lineno + 1))
    [ "$lineno" -le "$MAX_LINES" ] || \
      die "'$file' exceeds the ${MAX_LINES}-line input bound (normalization.md §6)."
    # Blank / whitespace-only lines carry no command — an ignored class, enumerated at
    # normalization.md §4.7 so this skip is declared rather than silent.
    [ -z "${line//[[:space:]]/}" ] && continue
    # Declared bound, checked before tokenizing (normalization.md §6).
    [ "${#line}" -le "$MAX_LINE_CHARS" ] || \
      die "'$file' line $lineno is ${#line} characters, over the ${MAX_LINE_CHARS}-character per-line bound (normalization.md §6)."
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
      local shown="" nt
      for nt in ${norm+"${norm[@]}"}; do shown+="$(q "$nt") "; done
      fail "$side capture holds an unclassifiable command line (normalization.md §6): ${shown% }"
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

# --- Compare a unit as an unordered multiset of its occurrences (normalization.md §4.1) ---------
# A unit carrying more than one line on both sides must not fail on a pure reordering, since §4.1
# ignores ordering unconditionally. Identical occurrences are paired off first; only the leftovers
# are reported positionally, so the named divergence still points at a real difference.
compare_unit() {
  local key="$1" count="$2"
  local -a cand_free=() base_left=()
  local i j
  for (( j = 1; j <= count; j++ )); do cand_free+=("$j"); done
  for (( i = 1; i <= count; i++ )); do
    local matched=0
    for j in "${!cand_free[@]}"; do
      if [ "${BASE_TOK["$key#$i"]}" = "${CAND_TOK["$key#${cand_free[$j]}"]}" ]; then
        unset 'cand_free[j]'
        # Re-pack with the ARRAY-safe alternate expansion. `${cand_free+…}` tests element 0
        # alone, so unsetting index 0 -- the common case, since the first candidate usually
        # matches -- would expand to nothing and WIPE the array, leaving the leftover loop
        # below to index an unset element under `set -u`: an abort with no verdict line at all.
        cand_free=(${cand_free[@]+"${cand_free[@]}"})
        matched=1; break
      fi
    done
    [ "$matched" = 0 ] && base_left+=("$i")
  done
  local n=0
  for i in ${base_left+"${base_left[@]}"}; do
    # Bounded rather than trusting the caller's count check: report the unpaired occurrence
    # instead of indexing past the end, so no input shape can abort without a verdict.
    if [ "$n" -ge "${#cand_free[@]}" ]; then
      fail "unit '$(san "$key")': baseline occurrence $i has no candidate occurrence left to compare against (normalization.md §3.9)."
      n=$((n + 1)); continue
    fi
    compare_occurrence "$key" "$i" "${cand_free[$n]}"
    n=$((n + 1))
  done
  return 0
}

# --- Compare one unit occurrence pair, token by token (normalization.md §3.1-3.8, §6) -----------
compare_occurrence() {
  local key="$1" n="$2" m="$3"
  local -a b=() c=()
  tok_array "${BASE_TOK["$key#$n"]}"; b=("${OUT_TOKENS[@]}")
  tok_array "${CAND_TOK["$key#$m"]}"; c=("${OUT_TOKENS[@]}")

  local max=${#b[@]}; [ "${#c[@]}" -gt "$max" ] && max=${#c[@]}
  local i bt ct diverged=0
  for (( i = 0; i < max; i++ )); do
    bt="${b[i]-}"; ct="${c[i]-}"
    # Gate on PRESENCE as well as value. Comparing values alone lets a surplus or missing
    # *empty* token compare "" against "" and pass — a false PASS on a genuinely different
    # argv, and a direct contradiction of §6's "token count differs within a unit -> FAIL".
    # (The §3.7 `--packs ''` case survived only because its surplus run starts non-empty.)
    if [ "${b[i]+set}" != "${c[i]+set}" ] || [ "$bt" != "$ct" ]; then
      if [ -z "${c[i]+set}" ]; then
        fail "unit '$(san "$key")': candidate is missing the token at position $((i + 1)) — baseline has $(q "$bt")."
      elif [ -z "${b[i]+set}" ]; then
        fail "unit '$(san "$key")': candidate has a surplus token at position $((i + 1)) — $(q "$ct")."
      else
        fail "unit '$(san "$key")': diverging token at position $((i + 1)) — baseline $(q "$bt"), candidate $(q "$ct")."
      fi
      diverged=1
      break
    fi
  done
  return $diverged
}

# --- main --------------------------------------------------------------------------------------
# Help is handled before the arity gate, so `--help` exits 0 like the sibling kit scripts
# (run-experiment.sh:90, seed-workspace.sh:223) rather than falling through to the usage error.
# `-h`/`--help` is matched INSIDE the loop, not only at position 1, so a trailing `--help` prints
# usage and exits 0 like the sibling kit scripts do (run-experiment.sh:90) rather than being reported
# as an unknown argument. A mistyped flag is then rejected by name, the way every sibling ends its
# parse (build-arm.sh:84, run-experiment.sh:91, analyze.sh:63) — without which a leading-dash
# argument is consumed as a filename and reported as an unreadable capture, pointing at the wrong
# problem entirely.
for arg in "$@"; do
  case "$arg" in
    -h|--help) usage; exit 0 ;;
    -?*) echo "$PROG: unknown argument '$(san "$arg")'" >&2; usage; exit 2 ;;
  esac
done
[ $# -eq 2 ] || { usage; exit 2; }

BASELINE="$1" CANDIDATE="$2"

load_side "$BASELINE" BASE || { echo "$PROG: parity FAILED (baseline unreadable as a command surface)." >&2; exit 1; }
BASE_ROOT="$KIT_ROOT"
load_side "$CANDIDATE" CAND || { echo "$PROG: parity FAILED (candidate unreadable as a command surface)." >&2; exit 1; }
CAND_ROOT="$KIT_ROOT"

log "baseline:  $BASELINE  (kit root $(san "$BASE_ROOT"))"
log "candidate: $CANDIDATE  (kit root $(san "$CAND_ROOT"))"

# The baseline's arm set scopes the comparison (normalization.md §5).
declare -A BASE_ARMS=()
for key in "${!BASE_UNITS[@]}"; do BASE_ARMS["${key#*:}"]=1; done

# Every baseline unit must be matched, occurrence for occurrence (§3.9, §3.10).
# The emptiness guards matter: `printf '%s\n' "${!EMPTY[@]}"` emits one BLANK line, which would
# otherwise become a phantom unit '' and let the contractual verdict line go missing.
compared=0
sorted_base=()
if [ "${#BASE_UNITS[@]}" -gt 0 ]; then
  mapfile -t sorted_base < <(printf '%s\n' "${!BASE_UNITS[@]}" | LC_ALL=C sort)
fi
for key in ${sorted_base+"${sorted_base[@]}"}; do
  bcount="${BASE_UNITS[$key]}"
  ccount="${CAND_UNITS[$key]:-0}"
  if [ "$ccount" = 0 ]; then
    fail "unit '$(san "$key")' is present in the baseline and absent from the candidate (normalization.md §3.10)."
    continue
  fi
  if [ "$bcount" != "$ccount" ]; then
    fail "unit '$(san "$key")': line count differs — baseline $bcount, candidate $ccount (normalization.md §3.9)."
    continue
  fi
  compare_unit "$key" "$bcount"
  compared=$((compared + bcount))
done

# Candidate-only units: out of scope when the arm is unknown to the baseline, a divergence otherwise (§5).
outofscope=0
sorted_cand=()
if [ "${#CAND_UNITS[@]}" -gt 0 ]; then
  mapfile -t sorted_cand < <(printf '%s\n' "${!CAND_UNITS[@]}" | LC_ALL=C sort)
fi
for key in ${sorted_cand+"${sorted_cand[@]}"}; do
  [ -n "${BASE_UNITS[$key]:-}" ] && continue
  arm="${key#*:}"
  if [ -z "${BASE_ARMS[$arm]:-}" ]; then
    log "out of scope — unit '$(san "$key")' has no baseline counterpart arm '$(san "$arm")' (arm-scoping rule, normalization.md §5)."
    outofscope=$((outofscope + 1))
  else
    fail "unit '$(san "$key")' is an extra command for in-scope arm '$(san "$arm")' — arm-scoping does not excuse it (normalization.md §5)."
  fi
done

log "compared $compared command line(s) across ${#sorted_base[@]} unit(s); $outofscope out of scope."

# Findings first. A run that produced FAIL findings has ALREADY rejected, so it must exit 1 with
# its verdict line even if those same findings left nothing comparable behind (every candidate
# line unclassifiable, say). Testing the empty surface first would report the loudest possible
# divergence as exit 2 — "usage or input error" — and a caller routing on exit codes would file
# a real parity failure as a tooling problem.
if [ "$fail_count" -gt 0 ]; then
  echo "$PROG: parity FAILED — $fail_count diverging finding(s)." >&2
  exit 1
fi

# A run that compared nothing and found nothing is not a pass either. Without this, any path that
# leaves both sides empty would reach the "parity holds" line and exit 0.
if [ "$compared" -le 0 ]; then
  echo "$PROG: ERROR — compared 0 command lines; refusing to report parity over an empty surface (normalization.md §6)." >&2
  exit 2
fi

log "parity holds — every compared token is identical after normalization."
exit 0
