#!/usr/bin/env bash
# check-authoring-rules.sh — deterministic rules for the authoring-rule classes that
# escaped the verify loop (WF-756; PM004 H4): line budgets, TOC past 100 lines,
# `agents/` auto-discovery, core genericity, and markdown rendering.
#
# --- The two modes (there is no third, and no bare whole-tree scan) ---
#   1. explicit file set   check-authoring-rules.sh [--root <dir>] <file> [<file> ...]
#   2. fixture self-test   check-authoring-rules.sh --selftest
# Invoked with neither, it prints usage and exits 2. Like the glossary pair, the
# severity model is ON-TOUCH: the live tree already carries pre-existing violations
# of these rules, so the gate may fire only on files a change touched. `run.sh`
# therefore registers this check under SELFTEST_ONLY_CHECKS, and the verify-phase
# fragment `../fragments/authoring-rules.verify.md` supplies the touched set.
#
# Each <file> is a path RELATIVE TO --root (default: the current directory). Every
# rule classifies a file by that relative path, so the same check runs unchanged
# against the repository and against a seeded fixture tree.
#
# --- The rules (rule id — severity — definition) ---
#   AR-AGENT  FAIL  a file directly under `plugins/<pack>/agents/` whose YAML
#                   frontmatter is missing, or lacks a `name:` or `description:` key.
#                   Every such file is auto-discovered as a subagent, so a
#                   non-agent document there becomes a phantom agent.
#   AR-TOC    FAIL  a runtime-read doc over 100 lines with no `## Contents` heading.
#   AR-BUDGET WARN  a runtime-read doc over 150 lines. A warning, not a failure:
#                   the budget counts behavior-bearing lines, and no mechanical test
#                   separates those from a template or a quoted example.
#   AR-CORE   FAIL  a core markdown file (`plugins/wf/skills/**`, `plugins/wf/agents/**`)
#                   naming a noun listed in `core-genericity-denylist.txt`.
#   AR-FENCE  FAIL  a code fence opened and never closed.
#   AR-TABLE  FAIL  a table row with MORE cells than its header — the unescaped-pipe
#                   defect, whose overflow cells the renderer drops. A row with fewer
#                   cells renders as empty cells and is not flagged.
# A "runtime-read doc" is `plugins/<pack>/agents/*.md` or
# `plugins/<pack>/skills/<skill>/references/*.md`, except a `*-rationale.md` file.
# Paths under a `*-fixtures/` or `test/fixtures/` segment are never checked.
#
# Output: one line per violation, `<FAIL|WARN> <rule-id> <file>:<line> — <issue>`.
# Exit 0 = no FAIL (warnings allowed); 1 = at least one FAIL; 2 = usage error.
#
# Model: claude-opus-5-5
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"

CHECK="check-authoring-rules"
DENYLIST="$DIR/core-genericity-denylist.txt"
TOC_LINES=100
BUDGET_LINES=150

usage() {
  echo "usage: $CHECK [--root <dir>] <file> [<file> ...]   |   $CHECK --selftest" >&2
  exit 2
}

is_agent()   { [[ "$1" =~ (^|/)plugins/[^/]+/agents/[^/]+\.md$ ]]; }
is_runtime() {
  case "$1" in *-rationale.md) return 1 ;; esac
  is_agent "$1" || [[ "$1" =~ (^|/)plugins/[^/]+/skills/[^/]+/references/[^/]+\.md$ ]]
}
is_core()    { [[ "$1" =~ (^|/)plugins/wf/(skills|agents)/.+\.md$ ]]; }

# lint_one <root> <rel> — print one line per violation; silent when clean.
lint_one() {
  local root="$1" rel="$2" f="$1/$2" lines pat
  case "$rel" in *.md) ;; *) return 0 ;; esac
  craft_is_excluded "$rel" && return 0
  # A file a change deleted is in its touched set but has nothing left to check.
  [ -f "$f" ] || return 0
  lines="$(wc -l < "$f")"; lines="${lines// /}"

  if is_agent "$rel"; then
    awk 'NR==1 && $0!="---" { bad=1; exit }
         NR>1 && $0=="---" { closed=1; exit }
         NR>1 && /^name:[[:space:]]*[^[:space:]]/ { n=1 }
         NR>1 && /^description:[[:space:]]*[^[:space:]]/ { d=1 }
         END { exit (bad || !closed || !n || !d) ? 1 : 0 }' "$f" \
      || echo "FAIL AR-AGENT $rel:1 — file under agents/ is auto-discovered as a subagent but has no agent frontmatter (name: and description:); move a non-agent document out of agents/."
  fi

  if is_runtime "$rel"; then
    if [ "$lines" -gt "$TOC_LINES" ] && ! grep -qE '^##[[:space:]]+(Contents|Table of contents)[[:space:]]*$' "$f"; then
      echo "FAIL AR-TOC $rel:1 — runtime-read doc is $lines lines with no '## Contents' section (rule: TOC past $TOC_LINES lines)."
    fi
    if [ "$lines" -gt "$BUDGET_LINES" ]; then
      echo "WARN AR-BUDGET $rel:$((BUDGET_LINES + 1)) — runtime-read doc is $lines lines, over the $BUDGET_LINES-line runtime budget; split rationale into a paired reference never read at runtime."
    fi
  fi

  if is_core "$rel" && [ -f "$DENYLIST" ]; then
    while IFS= read -r pat; do
      case "$pat" in ''|'#'*) continue ;; esac
      grep -nE "(^|[^[:alnum:]_])($pat)([^[:alnum:]_]|\$)" "$f" | while IFS=: read -r ln _; do
        echo "FAIL AR-CORE $rel:$ln — core names the stack/product noun '$pat' (rule: core names zero stack, domain, or project nouns)."
      done
    done < "$DENYLIST"
  fi

  awk -v rel="$rel" '
    function cells(s,   t, n, i) {
      t = s; gsub(/\\\|/, "", t)
      sub(/^[[:space:]]*\|/, "", t); sub(/\|[[:space:]]*$/, "", t)
      n = 1
      for (i = 1; i <= length(t); i++) if (substr(t, i, 1) == "|") n++
      return n
    }
    function isdelim(s) {
      return (s ~ /^[[:space:]]*\|?[[:space:]]*:?-+:?[[:space:]]*(\|[[:space:]]*:?-+:?[[:space:]]*)*\|?[[:space:]]*$/ && s ~ /-/)
    }
    {
      line = $0
      if (infence) {
        if (match(line, /^[[:space:]]*(`+|~+)[[:space:]]*$/)) {
          m = line; gsub(/[[:space:]]/, "", m)
          if (substr(m, 1, 1) == fchar && length(m) >= flen) infence = 0
        }
        next
      }
      if (match(line, /^[[:space:]]*(```+|~~~+)/)) {
        m = line; sub(/^[[:space:]]*/, "", m)
        fchar = substr(m, 1, 1); flen = 0
        while (substr(m, flen + 1, 1) == fchar) flen++
        infence = 1; fline = NR; intable = 0
        next
      }
      if (intable) {
        if (line ~ /\|/ && line !~ /^[[:space:]]*$/) {
          if (cells(line) > hcells)
            printf "FAIL AR-TABLE %s:%d — table row has %d cells, header has %d; escape a literal pipe as \\| so the renderer does not drop the overflow.\n", rel, NR, cells(line), hcells
          next
        }
        intable = 0
      }
      if (prev ~ /\|/ && isdelim(line)) { intable = 1; hcells = cells(prev) }
      prev = line
    }
    END {
      if (infence)
        printf "FAIL AR-FENCE %s:%d — code fence opened here is never closed; everything after it renders as code.\n", rel, fline
    }' "$f"
}

# --- --selftest: prove every rule discriminates before it is trusted -----------
if [ "${1:-}" = "--selftest" ]; then
  FIX="$DIR/authoring-rules-fixtures"
  st=0
  if [ ! -d "$FIX" ]; then echo "$CHECK selftest: FAIL — fixture corpus missing at $FIX."; exit 1; fi
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  # Seeds stay short in the repository; a `<!-- pad-to: N -->` marker line asks the
  # selftest to pad that copy with filler lines to exactly N lines, so a long-file
  # boundary is asserted without committing hundreds of filler lines.
  cp -R "$FIX/." "$TMP/"
  while IFS= read -r padf; do
    target="$(sed -n 's/^<!-- pad-to: \([0-9][0-9]*\) -->$/\1/p' "$padf" | head -n 1)"
    [ -n "$target" ] || continue
    have="$(wc -l < "$padf")"; have="${have// /}"
    while [ "$have" -lt "$target" ]; do echo "Filler line."; have=$((have + 1)); done >> "$padf"
  done < <(grep -rlE '^<!-- pad-to: [0-9]+ -->$' "$TMP")

  # expect <case> <space-separated rule ids, or "none">
  expect() {
    local case="$1" want="$2" root="$TMP/$1" out got rel
    out="$(cd "$root" && find . -type f -name '*.md' | sed 's|^\./||' | sort | while IFS= read -r rel; do lint_one "$root" "$rel"; done)"
    got="$(printf '%s\n' "$out" | awk 'NF { print $2 }' | sort -u | tr '\n' ' ' | sed 's/ $//')"
    [ -n "$got" ] || got="none"
    if [ "$got" = "$want" ]; then
      echo "selftest ok: $case -> $got"
    else
      echo "selftest FAIL: $case — expected [$want], got [$got]:"; printf '%s\n' "$out"; st=1
    fi
  }

  expect clean                "none"
  expect agent-no-frontmatter "AR-AGENT"
  expect toc-missing          "AR-TOC"
  expect over-budget          "AR-BUDGET"
  expect core-noun            "AR-CORE"
  expect unbalanced-fence     "AR-FENCE"
  expect table-pipe           "AR-TABLE"

  if [ "$st" -ne 0 ]; then echo "$CHECK selftest: FAIL"; exit 1; fi
  echo "$CHECK selftest: PASS — each seeded PM004 example fires exactly its own rule and the clean tree stays silent."
  exit 0
fi

# --- Mode 1: explicit file set -------------------------------------------------
ROOT="."
if [ "${1:-}" = "--root" ]; then
  [ -n "${2:-}" ] || usage
  ROOT="$2"; shift 2
fi
[ "$#" -gt 0 ] || usage

out=""
for rel in "$@"; do
  out="$out$(lint_one "$ROOT" "$rel")"$'\n'
done
out="$(printf '%s' "$out" | sed '/^$/d')"
if [ -n "$out" ]; then printf '%s\n' "$out"; fi
if printf '%s\n' "$out" | grep -q '^FAIL '; then
  echo "$CHECK: FAIL — $(printf '%s\n' "$out" | grep -c '^FAIL ') violation(s) in $# file(s)."
  exit 1
fi
echo "$CHECK: PASS — $# file(s) checked, no FAIL."
exit 0
