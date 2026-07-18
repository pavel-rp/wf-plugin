#!/usr/bin/env bash
# glossary-lint.sh — CI lint for the canonical authoring vocabulary
# (WF-341, charter C022 / WF-339 OUT-2 + OUT-3).
#
# GLOSSARY.md alone is a dead rule: nothing deterministic fails when it is
# violated. This lint is the live consumer that makes it a rule. It parses
# `GLOSSARY.md` DIRECTLY from the checkout — no resolver hop, no second copy —
# and checks an EXPLICIT file set against every entry it finds. Not one rule is
# transcribed here: change a `pattern:`/`avoid:`/`applies-to:` in GLOSSARY.md and
# this script's behaviour changes with no edit.
#
# --- The two modes (there is no third, and no bare whole-tree scan) ---
#   1. explicit file set   `glossary-lint.sh <file> [<file> ...]`
#   2. fixture self-test   `glossary-lint.sh --selftest`
# Invoked with neither, it prints usage and exits 2. It deliberately does NOT
# inherit the resident guards' bare whole-tree scan: the charter's severity model
# is ON-TOUCH (fail on files a PR touched or added, never on untouched
# pre-existing prose), and a bare whole-tree default would contradict it. The
# touched-set computation that drives mode 1 is the NEXT sub-task's job (WF-342);
# this script only exposes the interface it consumes.
#
# --- What it checks ---
# One check kind is implemented today, `avoid-term`: the entry's `pattern:` (a
# POSIX ERE) is fed to `grep -En` over each in-scope file; a matching line is a
# violation unless the entry's `except:` ERE also matches that line. A violation
# names the FILE (+line), the OFFENDING TERM (the matched text), and the
# CANONICAL ALTERNATIVE (the entry's term + definition).
#
# GLOSSARY.md's `check:` field also admits `leading-word`, which WF-340 landed
# deliberately EMPTY (its evidence proved no leading-word position
# violation-testable; see GLOSSARY.md "Leading-word conformance"). No entry
# carries it, so nothing dispatches there. Should one ever be admitted, this
# script fails LOUDLY (exit 2, "unimplemented check kind") rather than silently
# skipping the entry.
#
# --- Adding a check kind (the extensibility contract) ---
# The skeleton is parse -> scope -> dispatch -> report. A new check kind (e.g.
# craft-C4's later frontmatter / body-length checks) is added by writing one
# `check_<kind>()` function with the same signature as `check_avoid_term` and
# adding one `case` arm in `run_entry`. The glossary parser, the scope matcher,
# the exclusion rule, the reporter, and the self-test harness are untouched.
#
# --- False positives: how a MENTIONED term is kept from firing ---
# This is the instruction-vs-prose lesson `out4-skill-read-guard.sh` had to learn.
# Three mechanisms, all owned by GLOSSARY.md, none hardcoded here:
#   * `pattern:` matches the USED form (a compound noun, a field assignment), not
#     the bare word — so prose that merely names the term does not match.
#   * `except:` subtracts the known-legitimate matches by ERE, per line.
#   * `applies-to:` narrows each entry to the document classes where the term is
#     load-bearing. The tokens and their path shapes are GLOSSARY.md's
#     "Scope tokens" table, mirrored in `matches_scope` below:
#       skill-body   plugins/*/skills/**/SKILL.md
#       reference    plugins/*/skills/**/references/*.md
#       contract     plugins/wf/skills/_contracts/*.md
#       capability   plugins/*/capabilities/**/*.md
#       agent        plugins/*/agents/*.md
#       frontmatter  the YAML frontmatter of any of the above — since frontmatter
#                    exists only inside those classes, this token matches any file
#                    already matching one of them.
#     A file matching NONE of an entry's tokens is skipped for that entry. A file
#     matching no class at all is skipped entirely (and reported as such).
#
# --- Exclusions (structural, not a suppression list) ---
#   * GLOSSARY.md itself — it necessarily quotes every forbidden form it bans, so
#     linting it would fire on every entry. Excluded by name, always.
#   * Any `*-fixtures/` folder under `plugins/wf/skills/_contracts/` — a
#     SELF-MAINTAINING glob rule, not a hardcoded folder list: it already covers
#     `skill-read-fixtures/`, `slot-marker-fixtures/`, `registry-fixtures/` and
#     this lint's own `glossary-fixtures/`, and covers any future guard's fixture
#     folder with nothing to keep current. Those files carry deliberately
#     violating-shaped prose.
# `--allow-fixtures` lifts BOTH exclusions. It exists only so `--selftest` can
# lint its own fixtures; nothing else passes it, and the self-test asserts that
# WITHOUT it the seeded violation is skipped.
# This script is a `.sh`, not part of the `*.md` authored-prose surface, so it
# needs no self-exclusion of its own header.
#
# --- Exit codes ---
#   0  clean (or the file set reduced to nothing after exclusions)
#   1  at least one violation
#   2  usage error, malformed glossary, unimplemented check kind, or grep failure
#      (never a silent pass)
#
# Wired into CI by registry-fixtures/run.sh (the established guard chain that
# .github/workflows/ci.yml invokes) — this lint is NOT auto-discovered. Only the
# `--selftest` is wired: it runs against its fixtures plus a smoke-parse of the
# REAL GLOSSARY.md, and scans zero real-tree files, so `main` stays green while
# the catch stays proven on every PR.
#
# Model: claude-opus-4-8
set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SELF_DIR/../../../.." && pwd)"            # -> repo root
DEFAULT_GLOSSARY="$SELF_DIR/GLOSSARY.md"
FIXDIR="$SELF_DIR/glossary-fixtures"

usage() {
  cat <<'USAGE'
glossary-lint.sh — lint authored prose against _contracts/GLOSSARY.md.

Two modes, and only two:

  glossary-lint.sh <file> [<file> ...]   check exactly the named files
  glossary-lint.sh --selftest            run the fixture-backed self-test

Options:
  --glossary <path>   parse this glossary instead of _contracts/GLOSSARY.md
  --allow-fixtures    lift the GLOSSARY.md / *-fixtures/ exclusions (self-test only)

There is no whole-tree scan: the severity model is on-touch, so the caller
supplies the touched/added file set. Invoked with no file arguments and no
--selftest, this script scans nothing and exits 2.
USAGE
}

# ---------------------------------------------------------------------------
# Parse — the ONLY place a glossary rule is read. Emits one TAB-separated record
# per entry on stdout:
#   ENTRY <tab> term <tab> definition <tab> avoid <tab> pattern <tab> except <tab> applies-to <tab> check
# A malformed entry (any mandatory field missing) emits a MALFORMED record
# instead of being skipped — GLOSSARY.md's parse contract requires the lint to
# fail on it.
# ---------------------------------------------------------------------------
parse_glossary() {
  awk '
    function flush(  missing) {
      if (term == "") return
      missing = ""
      if (definition == "") missing = missing " definition"
      if (avoid == "")      missing = missing " avoid"
      if (pattern == "")    missing = missing " pattern"
      if (except == "")     missing = missing " except"
      if (applies == "")    missing = missing " applies-to"
      if (check == "")      missing = missing " check"
      if (evidence == "")   missing = missing " evidence"
      if (missing != "")
        printf("MALFORMED\t%s\t%s\n", term, substr(missing, 2))
      else
        printf("ENTRY\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", \
               term, definition, avoid, pattern, except, applies, check)
      term = ""; definition = ""; avoid = ""; pattern = ""
      except = ""; applies = ""; check = ""; evidence = ""
    }
    /^### term: /   { flush(); term = substr($0, 11); next }
    /^## /          { flush(); next }
    /^definition: / { definition = substr($0, 13); next }
    /^avoid: /      { avoid      = substr($0, 8);  next }
    /^pattern: /    { pattern    = substr($0, 10); next }
    /^except: /     { except     = substr($0, 9);  next }
    /^applies-to: / { applies    = substr($0, 13); next }
    /^check: /      { check      = substr($0, 8);  next }
    /^evidence: /   { evidence   = substr($0, 11); next }
    END { flush() }
  ' "$1"
}

# ---------------------------------------------------------------------------
# Scope — map a repo-relative path to GLOSSARY.md's document classes.
# ---------------------------------------------------------------------------
in_any_class() {
  matches_scope "$1" skill-body || matches_scope "$1" reference \
    || matches_scope "$1" contract || matches_scope "$1" capability \
    || matches_scope "$1" agent
}

matches_scope() {
  local p="$1"
  case "$2" in
    skill-body)  printf '%s' "$p" | grep -Eq '^plugins/[^/]+/skills/.*SKILL\.md$' ;;
    reference)   printf '%s' "$p" | grep -Eq '^plugins/[^/]+/skills/.*/references/[^/]+\.md$' ;;
    contract)    printf '%s' "$p" | grep -Eq '^plugins/wf/skills/_contracts/[^/]+\.md$' ;;
    capability)  printf '%s' "$p" | grep -Eq '^plugins/[^/]+/capabilities/.*\.md$' ;;
    agent)       printf '%s' "$p" | grep -Eq '^plugins/[^/]+/agents/[^/]+\.md$' ;;
    frontmatter) in_any_class "$p" ;;
    *)           return 1 ;;
  esac
}

# applies_here <rel-path> <applies-to value> — 0 when any listed token matches.
applies_here() {
  local p="$1" list="$2" tok
  list="${list//,/ }"
  for tok in $list; do
    matches_scope "$p" "$tok" && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Exclusions — structural, self-maintaining.
# ---------------------------------------------------------------------------
is_excluded() {
  [ "$ALLOW_FIXTURES" -eq 1 ] && return 1
  case "$1" in
    plugins/wf/skills/_contracts/*-fixtures/*) return 0 ;;
  esac
  case "${1##*/}" in
    GLOSSARY.md) return 0 ;;
  esac
  return 1
}

# ---------------------------------------------------------------------------
# Checks — one function per `check:` kind. Add a kind by adding a function here
# plus one arm in run_entry; nothing else moves.
#
# Signature: <rel> <abs> <term> <definition> <avoid> <pattern> <except>
# Echoes one line per violation; returns 2 on a grep failure.
# ---------------------------------------------------------------------------
check_avoid_term() {
  local rel="$1" abs="$2" term="$3" definition="$4" avoid="$5" pattern="$6" except="$7"
  local raw rc hit lno content offending alt

  raw="$(grep -En "$pattern" "$abs")"; rc=$?
  [ "$rc" -ge 2 ] && return 2
  [ "$rc" -ne 0 ] && return 0

  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    lno="${hit%%:*}"; content="${hit#*:}"
    # `except:` is evaluated against the raw line content (never the "N:" prefix),
    # so an anchored exemption ERE still anchors correctly.
    if [ "$except" != "none" ]; then
      printf '%s\n' "$content" | grep -Eq "$except" && continue
    fi
    offending="$(printf '%s\n' "$content" | grep -Eo "$pattern" | head -1)"
    [ -n "$offending" ] || offending="$content"
    if [ "$avoid" = "none" ]; then
      alt="use the canonical form — $definition"
    else
      alt="use \`$term\` instead (avoid: $avoid)"
    fi
    printf '%s:%s: forbidden term \`%s\` — %s\n' "$rel" "$lno" "$offending" "$alt"
  done <<EOF
$raw
EOF
  return 0
}

# run_entry <rel> <abs> <record fields...> — dispatch one entry against one file.
run_entry() {
  local rel="$1" abs="$2" term="$3" definition="$4" avoid="$5" pattern="$6" except="$7" applies="$8" check="$9"
  applies_here "$rel" "$applies" || return 0
  case "$check" in
    avoid-term)
      check_avoid_term "$rel" "$abs" "$term" "$definition" "$avoid" "$pattern" "$except"
      ;;
    *)
      echo "GLOSSARY-LINT: ERROR — entry '$term' names check kind '$check', which this lint does not implement (implemented: avoid-term)." >&2
      return 3
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Driver
# ---------------------------------------------------------------------------
lint_files() {
  local glossary="$1"; shift
  local records rec kind term definition avoid pattern except applies check
  local f abs rel out violations=0 scanned=0 rc

  if [ ! -f "$glossary" ]; then
    echo "GLOSSARY-LINT: ERROR — glossary not found: $glossary"
    return 2
  fi

  records="$(parse_glossary "$glossary")"
  if printf '%s\n' "$records" | grep -q '^MALFORMED'; then
    echo "GLOSSARY-LINT: ERROR — malformed entries in $glossary (every field is mandatory):"
    printf '%s\n' "$records" | grep '^MALFORMED' | while IFS=$'\t' read -r _ term missing; do
      echo "  entry '$term' is missing: $missing"
    done
    return 2
  fi
  if [ -z "$(printf '%s\n' "$records" | grep '^ENTRY' || true)" ]; then
    echo "GLOSSARY-LINT: ERROR — $glossary yielded zero entries (expected at least one '### term: ')."
    return 2
  fi

  for f in "$@"; do
    if [ ! -f "$f" ]; then
      echo "GLOSSARY-LINT: ERROR — no such file: $f"
      return 2
    fi
    abs="$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"
    rel="${abs#"$ROOT"/}"
    if is_excluded "$rel"; then
      echo "GLOSSARY-LINT: skipped (off the lint surface): $rel"
      continue
    fi
    if ! in_any_class "$rel"; then
      echo "GLOSSARY-LINT: skipped (not an authored-prose surface file): $rel"
      continue
    fi
    scanned=$((scanned + 1))
    while IFS=$'\t' read -r kind term definition avoid pattern except applies check; do
      [ "$kind" = "ENTRY" ] || continue
      out="$(run_entry "$rel" "$abs" "$term" "$definition" "$avoid" "$pattern" "$except" "$applies" "$check")"
      rc=$?
      if [ "$rc" -eq 2 ]; then
        echo "GLOSSARY-LINT: ERROR — grep failed on $rel for entry '$term' (pattern: $pattern)."
        return 2
      fi
      if [ "$rc" -eq 3 ]; then
        return 2
      fi
      if [ -n "$out" ]; then
        printf '%s\n' "$out"
        violations=$((violations + $(printf '%s\n' "$out" | grep -c .)))
      fi
    done <<EOF
$records
EOF
  done

  if [ "$violations" -gt 0 ]; then
    echo "GLOSSARY-LINT: FAIL — $violations vocabulary violation(s) across $scanned file(s). Fix the prose or amend $glossary."
    return 1
  fi
  echo "GLOSSARY-LINT: PASS — $scanned file(s) conform to $(basename "$glossary")."
  return 0
}

# ---------------------------------------------------------------------------
# Self-test — fixture-backed proof that the lint catches and discriminates.
#
# The catch/pass assertions run against the FIXTURE glossary co-located with the
# fixtures, never the live GLOSSARY.md: a later edit to a live entry must not be
# able to silently delete the term this self-test depends on. The live glossary
# is additionally SMOKE-PARSED (parses clean, yields at least one entry), so
# OUT-1's "the lint runs against the real file in CI" holds on every run.
# ---------------------------------------------------------------------------
selftest() {
  local fails=0 out rc
  local fg="$FIXDIR/glossary.fixture.md"

  say_ok()   { echo "selftest ok: $1"; }
  say_fail() { echo "selftest FAIL: $1"; fails=$((fails + 1)); }

  # 1. The REAL glossary parses clean and yields entries (OUT-1 smoke assertion).
  local recs bad n
  recs="$(parse_glossary "$DEFAULT_GLOSSARY")"
  bad="$(printf '%s\n' "$recs" | grep -c '^MALFORMED' || true)"
  n="$(printf '%s\n' "$recs" | grep -c '^ENTRY' || true)"
  if [ "$bad" -ne 0 ]; then
    say_fail "real GLOSSARY.md has $bad malformed entr(y/ies)"
  elif [ "$n" -lt 1 ]; then
    say_fail "real GLOSSARY.md yielded zero entries"
  else
    say_ok "real GLOSSARY.md parses clean and yields $n entr(y/ies)"
  fi

  # 2. THE DONE-CRITERION: the seeded violation is caught, naming term + file.
  out="$(bash "${BASH_SOURCE[0]}" --glossary "$fg" --allow-fixtures "$FIXDIR/violation/SKILL.md" 2>&1)"; rc=$?
  if [ "$rc" -ne 1 ]; then
    say_fail "seeded violation not caught (expected exit 1, got $rc):"; echo "$out"
  else
    local s ok=1
    for s in 'glossary-fixtures/violation/SKILL.md' 'wodget' 'widget' 'FAIL'; do
      case "$out" in *"$s"*) ;; *) ok=0; say_fail "violation report missing '$s'. Got:"; echo "$out";; esac
    done
    [ "$ok" -eq 1 ] && say_ok "seeded violation caught, naming the file, the offending term, and the canonical alternative"
  fi

  # 3. The clean sibling passes — including a term exempted by `except:` and a
  #    term whose `applies-to` excludes this file's document class.
  out="$(bash "${BASH_SOURCE[0]}" --glossary "$fg" --allow-fixtures "$FIXDIR/clean/SKILL.md" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    say_fail "clean sibling fixture failed (expected exit 0, got $rc):"; echo "$out"
  else
    say_ok "clean sibling fixture passes (except:-exempt line and out-of-scope term both silent)"
  fi

  # 4. The *-fixtures/ exclusion holds: the SAME violating file is skipped, not
  #    scanned, when --allow-fixtures is absent.
  out="$(bash "${BASH_SOURCE[0]}" --glossary "$fg" "$FIXDIR/violation/SKILL.md" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] || [ -z "${out##*wodget*}" ]; then
    say_fail "*-fixtures/ exclusion did not hold (exit $rc):"; echo "$out"
  else
    say_ok "*-fixtures/ folders are off the lint surface (violation fixture skipped, not scanned)"
  fi

  # 5. GLOSSARY.md self-exclusion: the live glossary quotes every banned form and
  #    must never fire on itself.
  out="$(bash "${BASH_SOURCE[0]}" "$DEFAULT_GLOSSARY" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    say_fail "GLOSSARY.md self-exclusion did not hold (exit $rc):"; echo "$out"
  else
    say_ok "GLOSSARY.md excludes itself"
  fi

  # 6. A malformed entry fails loudly rather than being skipped.
  out="$(bash "${BASH_SOURCE[0]}" --glossary "$FIXDIR/glossary-malformed.fixture.md" --allow-fixtures "$FIXDIR/clean/SKILL.md" 2>&1)"; rc=$?
  if [ "$rc" -ne 2 ] || [ -n "${out##*missing*}" ]; then
    say_fail "malformed glossary entry did not fail loudly (expected exit 2, got $rc):"; echo "$out"
  else
    say_ok "a malformed glossary entry fails the lint (exit 2), naming the entry and the missing field"
  fi

  # 7. Zero-argument behaviour: usage + non-zero, and nothing scanned.
  out="$(bash "${BASH_SOURCE[0]}" 2>&1)"; rc=$?
  if [ "$rc" -eq 0 ] || [ -n "${out##*--selftest*}" ]; then
    say_fail "zero-argument invocation did not print usage and exit non-zero (exit $rc):"; echo "$out"
  else
    say_ok "zero-argument invocation prints usage naming both modes and exits $rc (never a whole-tree scan)"
  fi

  echo ""
  if [ "$fails" -ne 0 ]; then
    echo "GLOSSARY-LINT selftest: FAIL — $fails assertion(s) misbehaved."
    return 1
  fi
  echo "GLOSSARY-LINT selftest: PASS — seeded violation caught, clean sibling passes, exclusions hold, real GLOSSARY.md parses."
  return 0
}

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------
ALLOW_FIXTURES=0
GLOSSARY="$DEFAULT_GLOSSARY"
MODE=""
FILES=()

while [ $# -gt 0 ]; do
  case "$1" in
    --selftest)      MODE="selftest"; shift ;;
    --allow-fixtures) ALLOW_FIXTURES=1; shift ;;
    --glossary)
      if [ $# -lt 2 ]; then echo "GLOSSARY-LINT: ERROR — --glossary needs a path."; usage; exit 2; fi
      GLOSSARY="$2"; shift 2 ;;
    -h|--help)       usage; exit 2 ;;
    --*)             echo "GLOSSARY-LINT: ERROR — unknown option '$1'."; usage; exit 2 ;;
    *)               FILES+=("$1"); shift ;;
  esac
done

if [ "$MODE" = "selftest" ]; then
  selftest
  exit $?
fi

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "GLOSSARY-LINT: ERROR — no files to check and no --selftest."
  usage
  exit 2
fi

lint_files "$GLOSSARY" "${FILES[@]}"
exit $?
