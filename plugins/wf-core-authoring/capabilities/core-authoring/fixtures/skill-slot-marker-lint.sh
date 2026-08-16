#!/usr/bin/env bash
# skill-slot-marker-lint.sh — CI lint for the skill interface slot-marker syntax
# (WF-326, charter C014 / WF-322 SUB-3).
#
# WF-326 formalized the skill interface as a contracted shape: a skill's
# externally-bindable surface (invocation shape, terminal block, declared slots
# with merge policies, declared settings keys, safety rules) is declared in a
# machine-readable sidecar — `skills/<name>/interface.md` — so a resolver can
# learn a skill's slots/settings WITHOUT reading its SKILL.md body (the
# resolver's `resolve_content` refuses skill-body reads). A slot is placed in a
# SKILL.md body with a grep-validatable marker pair. This lint keeps the body
# markers and the interface declaration honest against each other.
#
# Full syntax + rationale: capability-registry.contract.md
# ("The skill interface declaration + slot markers"); the runtime-followed rules
# are in capability-registry.ops.md (same heading).
#
# --- The marker syntax (what a well-formed marker is) ---
# A slot occupies a body region delimited by an HTML-comment pair, each marker
# ALONE on its line (surrounding whitespace tolerated), naming the same slot id:
#
#     <!-- wf:slot <skill>.<point> -->
#     ...the inline-default region (executed verbatim when the slot is unfilled)...
#     <!-- wf:slot-end <skill>.<point> -->
#
# The slot id is a `skill.point` token (WF-323 vocabulary): two segments joined
# by a single dot, each segment lowercase letters / digits / hyphens; the first
# segment (`<skill>`) MUST equal the skill's folder name.
#
# --- The declaration (interface.md ## Slots) ---
# `skills/<name>/interface.md` declares each slot in a `## Slots` table whose
# first column is the `skill.point` id and second column the merge policy
# (`replace` | `append`, the WF-323 policies). The lint reads ONLY this table
# for the declared set — never the SKILL.md body prose.
#
# --- What the lint flags (each with file:line and the defect) ---
#   D1 malformed declaration — a `## Slots` row whose id is not a well-formed
#      `skill.point`, whose first segment is not the folder name, or whose merge
#      policy is absent / not `replace`|`append`.
#   D2 malformed marker — a `<!-- wf:slot… -->` comment that is not EXACTLY an
#      opening or closing marker with a well-formed id on its own line.
#   D3 undeclared marker — a well-formed marker whose slot id has no matching
#      `## Slots` declaration in the same skill's interface.md.
#   D4 unbalanced marker — an opening marker with no matching close (or a close
#      with no open), or a duplicate opening marker for one slot.
#   D5 declared-but-unmarked — a declared slot with no opening marker in SKILL.md.
#
# --- Why it is inert on the existing tree ---
# A skill with no `## Slots` declarations and no `<!-- wf:slot… -->` markers
# produces zero declared ids and zero marker hits — every loop body is empty, so
# it emits nothing. The whole current skill tree (which declares no slots yet)
# passes unchanged.
#
# --- Scope (path) ---
# Scanned:  plugins/*/skills/*/ — every skill folder across ALL packs (a folder
#           counts as a skill only if it holds a SKILL.md).
# NOT scanned: plugins/*/skills/_contracts/** — the frozen contract layer, THIS
#           script, and slot-marker-fixtures/ (the deliberate pass/fail cases the
#           --selftest exercises). `_contracts/` itself holds no SKILL.md, and the
#           fixtures sit two levels deeper than the `plugins/*/skills/*/` glob, so
#           the real-tree scan never reaches them.
#
# Requires GNU/PCRE grep (`grep -P`; present on the Linux CI runner and Git Bash).
# Exit 0 = clean; exit 1 = a defect was found; exit 2 = grep/PCRE error (never a
# silent pass). With `--selftest`: runs the linter over slot-marker-fixtures/ and
# asserts each planted pass/fail case behaves as specified — proving the linter
# discriminates before it is trusted on the real tree.
#
# Wired into CI by registry-fixtures/run.sh (the established guard chain that
# .github/workflows/ci.yml invokes) — this lint is NOT auto-discovered.
#
# Model: claude-opus-4-8
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"   # -> repo root
FIXROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/slot-marker-fixtures"

# A well-formed skill.point: two dot-joined segments, each [a-z0-9-]+.
idre='[a-z0-9-]+\.[a-z0-9-]+'

# trim leading/trailing whitespace.
trim() { printf '%s' "$1" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//'; }

# in_set <needle> <space-separated-haystack> — 0 if present.
in_set() { case " $2 " in *" $1 "*) return 0;; *) return 1;; esac; }

# lint_skill_dir <dir> — lints one skill folder, echoing one line per defect
# (nothing when clean). Reads interface.md for the declared slots and SKILL.md
# only for its own markers.
lint_skill_dir() {
  local dir="${1%/}"
  local skill body iface
  skill="$(basename "$dir")"
  body="$dir/SKILL.md"
  iface="$dir/interface.md"
  [ -f "$body" ] || return 0    # not a skill folder — inert

  # --- 1. declared slots from interface.md's ## Slots table -----------------
  local declared="" decl_lines="" inslots=0 lineno=0 line c1 c2 rest seg1
  if [ -f "$iface" ]; then
    while IFS= read -r line; do
      lineno=$((lineno + 1))
      case "$line" in
        '## Slots'*) inslots=1; continue;;
        '## '*)      inslots=0;;
      esac
      [ "$inslots" -eq 1 ] || continue
      case "$line" in '|'*) ;; *) continue;; esac   # a table row only
      c1="${line#|}"; c1="${c1%%|*}"
      rest="${line#|}"; rest="${rest#*|}"; c2="${rest%%|*}"
      c1="$(trim "$c1")"; c2="$(trim "$c2")"
      # Skip the header row and the |---| separator: a declared id has no space
      # or paren, contains an alnum, and is not a pure-dash rule.
      case "$c1" in ''|*' '*|*'('*) continue;; esac
      case "$c1" in *[a-z0-9]*) ;; *) continue;; esac
      if ! printf '%s' "$c1" | grep -Pq "^${idre}\$"; then
        echo "$iface:$lineno: malformed slot declaration '$c1' — a slot id must be <skill>.<point> (each segment lowercase letters/digits/hyphens, exactly one dot)."
        continue
      fi
      seg1="${c1%%.*}"
      if [ "$seg1" != "$skill" ]; then
        echo "$iface:$lineno: slot id '$c1' names skill '$seg1' but is declared under skill '$skill' — the id's first segment must match the skill folder name."
        continue
      fi
      case "$c2" in
        replace|append) ;;
        '') echo "$iface:$lineno: slot '$c1' declares no merge policy (expected 'replace' or 'append')."; continue;;
        *)  echo "$iface:$lineno: slot '$c1' has unknown merge policy '$c2' (expected 'replace' or 'append')."; continue;;
      esac
      declared="$declared $c1"
      decl_lines="$decl_lines $c1:$lineno"
    done < "$iface"
  fi

  # --- 2. scan SKILL.md markers --------------------------------------------
  local opens="" closes="" hit lno content trimmed id rc
  local open_re="^<!-- wf:slot (${idre}) -->\$"
  local close_re="^<!-- wf:slot-end (${idre}) -->\$"
  local grep_out
  grep_out="$(grep -Pn '<!--\s*wf:slot' "$body")"
  rc=$?
  if [ "$rc" -ge 2 ]; then
    echo "$body: ERROR — grep failed (rc=$rc); this lint requires PCRE grep (grep -P)."
    return 2
  fi
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    lno="${hit%%:*}"; content="${hit#*:}"
    trimmed="$(trim "$content")"
    if [[ "$trimmed" =~ $open_re ]]; then
      id="${BASH_REMATCH[1]}"
      if in_set "$id" "$opens"; then
        echo "$body:$lno: duplicate opening marker for slot '$id'."
      fi
      opens="$opens $id"
      if ! in_set "$id" "$declared"; then
        echo "$body:$lno: slot marker '$id' is not declared in $skill/interface.md (## Slots)."
      fi
    elif [[ "$trimmed" =~ $close_re ]]; then
      id="${BASH_REMATCH[1]}"
      closes="$closes $id"
    else
      echo "$body:$lno: malformed slot marker: '$trimmed' — expected exactly '<!-- wf:slot <skill.point> -->' or '<!-- wf:slot-end <skill.point> -->' alone on its line."
    fi
  done <<EOF
$grep_out
EOF

  # --- 3. balance + declared-has-marker ------------------------------------
  local pair dl
  for id in $opens; do
    in_set "$id" "$closes" || echo "$body: opening marker for slot '$id' has no matching '<!-- wf:slot-end $id -->' close."
  done
  for id in $closes; do
    in_set "$id" "$opens" || echo "$body: closing marker for slot '$id' has no matching opening marker."
  done
  for pair in $decl_lines; do
    id="${pair%%:*}"; dl="${pair##*:}"
    in_set "$id" "$opens" || echo "$iface:$dl: declared slot '$id' has no '<!-- wf:slot $id -->' marker in $skill/SKILL.md."
  done
  return 0
}

# --- --selftest: drive the fixtures --------------------------------------------
if [ "${1:-}" = "--selftest" ]; then
  st_fails=0
  # check_pass <fixture>
  check_pass() {
    local out; out="$(lint_skill_dir "$FIXROOT/$1")"
    if [ -n "$out" ]; then
      echo "selftest FAIL: $1 — expected CLEAN, got defects:"; echo "$out"
      st_fails=$((st_fails + 1))
    else
      echo "selftest ok (pass): $1"
    fi
  }
  # check_fail <fixture> <required-substring>...
  check_fail() {
    local fx="$1"; shift
    local out; out="$(lint_skill_dir "$FIXROOT/$fx")"
    if [ -z "$out" ]; then
      echo "selftest FAIL: $fx — expected a defect, got CLEAN."
      st_fails=$((st_fails + 1)); return
    fi
    local s ok=1
    for s in "$@"; do
      case "$out" in *"$s"*) ;; *) ok=0; echo "selftest FAIL: $fx — output missing '$s'. Got:"; echo "$out";; esac
    done
    [ "$ok" -eq 1 ] && echo "selftest ok (fail): $fx"
  }

  # Passing cases — the linter must stay silent.
  check_pass slotfree
  check_pass wellformed-replace
  check_pass wellformed-append

  # Failing cases — one defect class each, defect must name file:line + reason.
  check_fail malformed-marker    "SKILL.md:" "malformed slot marker"
  check_fail undeclared-marker   "SKILL.md:" "is not declared"
  check_fail missing-marker      "interface.md:" "has no" "marker"
  check_fail unbalanced          "no matching"
  check_fail bad-declaration     "interface.md:" "malformed slot declaration"

  echo ""
  if [ "$st_fails" -ne 0 ]; then
    echo "OUT-SLOT selftest: FAIL — $st_fails fixture case(s) misbehaved."
    exit 1
  fi
  echo "OUT-SLOT selftest: PASS — every planted pass/fail fixture behaves as specified."
  exit 0
fi

# --- Default: scan the real skill tree ----------------------------------------
hits=""
rc_any=0
for dir in "$ROOT"/plugins/*/skills/*/; do
  [ -d "$dir" ] || continue
  out="$(lint_skill_dir "$dir")"; rc=$?
  if [ "$rc" -ge 2 ]; then rc_any=2; fi
  [ -n "$out" ] && hits="$hits$out"$'\n'
done

if [ "$rc_any" -ge 2 ]; then
  echo "OUT-SLOT: ERROR — grep failed (requires PCRE grep -P)."
  exit 2
fi
if [ -n "$hits" ]; then
  echo "OUT-SLOT: FAIL — skill slot markers / interface declarations are inconsistent:"
  printf '%s' "$hits"
  exit 1
fi
echo "OUT-SLOT: PASS — every skill's slot markers agree with its interface declaration (inert where none are declared)."
exit 0
