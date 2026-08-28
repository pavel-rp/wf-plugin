#!/usr/bin/env bash
# check-lifecycle-write-scope.sh — the committed-lifecycle write-scope gate (WF-444,
# charter C014 / umbrella WF-439).
#
# --- THE BOUNDARY THIS GATE ENFORCES ---
# The repository's write-scope rule is `_local/` only (CLAUDE.md §6; core constitution
# article 3), with a short, named list of source-mutating exceptions. WF-442, WF-443 and
# WF-490 then established a COMMITTED home — `.wf/` — for three lifecycle artifacts:
#
#   * `.wf/install-state.json`         the portable install-state ledger (WF-442)
#   * `.wf/slots/<skill>.<point>.md`   the committed project-override slot tier (WF-443)
#   * `.wf/run-evidence/<run>.json`    the machine-emitted run-evidence class (WF-490) —
#                                      the resolver-issued receipts a receipt-bearing phase
#                                      files on completion, and the per-gate self-approval
#                                      records that travel the same emission path
#
# `.wf/` IS NOT A GENERAL WRITABLE HOME. It is one narrow exception, and the exception
# is defined by TWO things at once, not by the path prefix:
#
#   1. LIFECYCLE OWNERSHIP — the resolver runtime manages these artifacts. An ordinary
#      skill or agent reads them through the resolver's content surface; it never claims
#      authority to write them on its own.
#   2. ARTIFACT CLASS — only the DECLARED classes above. Lifecycle ownership does
#      not widen the set: an undeclared `.wf/` path is rejected even when the resolver
#      is the one named as writing it.
#
# Both halves have to hold. That is why this is a gate and not a grep for `.wf/`.
#
# --- The two flagged shapes ---
#   W1  unowned write claim — a write verb governing a `.wf/` path on the same line of
#       authored prose, where the line does not attribute the write to the resolver's
#       lifecycle ownership. This is the "an ordinary skill claims arbitrary `.wf/`
#       access" defect.
#   W2  undeclared artifact class — any `.wf/<path>` token that is none of
#       `.wf/slots/…`, `.wf/run-evidence/…`, or `.wf/install-state.json`.
#       Verb-independent by design: an undeclared lifecycle artifact is out of scope
#       whether it is read or written, and naming the resolver does not excuse it.
#
# The bare home token `` `.wf/` `` — the directory named as a directory — is neither
# defect on its own; the guidance files have to be able to say the word.
#
# --- Why the resolver attribution is the exemption, not an allowlist of files ---
# An allowlist of "files permitted to say this" goes stale the moment a pack is added,
# and it encodes WHO rather than WHY. Keying on lifecycle ownership keeps the rule
# stack-, domain-, and pack-agnostic (CLAUDE.md §1): any prose, in any pack, may
# describe the resolver managing a declared committed artifact; no prose, in any pack,
# may claim that authority for an ordinary skill.
#
# --- Scope (path) ---
# Scanned:  <repo-root>/plugins/**/*.md — every skill body, agent file, capability
#           fragment, manifest, and README across ALL packs.
# NOT scanned:
#   * the shared structural exclusions from skill-targets.sh (`craft_is_excluded`):
#     any `*-fixtures/` segment and any adjacent `test/fixtures` pair — which is what
#     keeps THIS check's own seeded violations in `lifecycle-write-fixtures/` off the
#     live-tree scan, by the very rule under test.
#   * any `_contracts/` segment — the frozen contract layer. That layer DEFINES the
#     lifecycle boundary (`capability-registry.ops.md` states the ledger home and the
#     committed override tier); a specification of the rule is not a claim under it.
#     Same carve-out, for the same reason, as `out4-skill-read-guard.sh`.
#
# --- DEFERENCE ---
# This is a shell check over authored prose. Where the WF-352 typed resolver validators
# (`validate_skill_interface`, `validate_manifest`, `validate_registry`) own a surface,
# they are the authority and this script must not contradict one — see the header of
# `skill-targets.sh`. The obligation here is NON-DIVERGENCE, not invocation: no
# shell-callable surface for those validators exists.
#
# Requires GNU/PCRE grep (`grep -P`; present on the Linux CI runner and Git Bash).
# Exit 0 = clean; exit 1 = a defect was found; exit 2 = grep/PCRE error (never a silent
# pass). With `--selftest`: runs over lifecycle-write-fixtures/ and asserts the clean
# case stays silent and each planted violation is flagged — proving the classifier
# discriminates before it is trusted on the real tree.
#
# Registered in this folder's run.sh CHECKS list; CI discovers that runner by
# convention (`plugins/*/capabilities/*/fixtures/run.sh`), so this gate needs no
# workflow entry of its own.
#
# Model: claude-opus-5[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"

ROOT="$(craft_repo_root)"          # -> repository root, never this script's folder
FIXROOT="$DIR/lifecycle-write-fixtures"

# The write verbs. Deliberately tight: only verbs that assert the authoring subject
# PRODUCES OR MUTATES the named artifact. `commit`/`commits` is absent on purpose — a
# maintainer committing a file is a delivery action, not a claim of lifecycle authority.
VERBS='\b(writes?|writing|written|creates?|creating|edits?|editing|modif(y|ies|ying)|overwrites?|overwriting|deletes?|deleting|persists?|appends?|saves?)\b'

# A `.wf/` path token. The character class stops at markdown punctuation (backtick,
# comma, paren, semicolon) so a fenced path reads cleanly; `<` and `>` are included so a
# documented placeholder like `.wf/slots/<skill>.<point>.md` is classified, not truncated.
PATHTOK='\.wf/[A-Za-z0-9._/<>-]*'

# A COMPLETE payload declaration row — the third admitted shape, and the mechanism by
# which an artifact BECOMES declared (WF-442's `## Payloads` table:
# `| Source | Destination | Production | Refresh | Removal |`). The vocabulary is closed,
# so this recognizes a row by that vocabulary rather than by its heading — which keeps the
# gate correct inside a fenced example, a manifest, and a reference doc alike.
#
# This is the DECLARED half of "undeclared lifecycle writes fail": a row that names a
# `.wf/` destination AND its complete production/refresh/removal lifecycle has declared
# that artifact, and the resolver manages it from there. A `.wf/` destination in a table
# row WITHOUT that complete closed-vocabulary lifecycle is exactly an undeclared write and
# stays flagged. It widens nothing: the lifecycle is still resolver-managed, and the row
# grants the declaring capability no write authority of its own.
PAYLOADROW='^\s*\|.*\|\s*copy\s*\|\s*(replace-if-unmodified|retain)\s*\|\s*(delete-if-unmodified|retain)\s*\|'

# lint_file <abs-path> — echo one line per defect (nothing when clean).
# Returns 2 on a grep/PCRE error so the caller can fail loudly rather than silently.
lint_file() {
  local f="$1"
  local rel="${f#"$ROOT"/}"
  local hit lno tok line out rc

  # One pass over every line that names the committed home; both defect classes are
  # decided from the same line, so a payload declaration is recognized once and exempts
  # the row from both.
  out="$(grep -Pn "$PATHTOK" "$f")"; rc=$?
  if [ "$rc" -ge 2 ]; then
    echo "$rel: ERROR — grep failed (rc=$rc); this gate requires PCRE grep (grep -P)."
    return 2
  fi
  while IFS= read -r hit; do
    [ -n "$hit" ] || continue
    lno="${hit%%:*}"; line="${hit#*:}"

    # A complete payload declaration row declares the artifact AND its resolver-managed
    # lifecycle. That is the declaration itself — neither defect applies to it.
    printf '%s' "$line" | grep -Pq "$PAYLOADROW" && continue

    # --- W2: artifact class (verb-independent) ------------------------------
    while IFS= read -r tok; do
      [ -n "$tok" ] || continue
      tok="${tok%.}"                     # a trailing sentence period is not part of the path
      case "$tok" in
        '.wf/') continue ;;                            # the home named as a directory
        '.wf/install-state.json') continue ;;          # declared class: portable install state
        '.wf/slots/'*) continue ;;                     # declared class: committed slot override
        '.wf/run-evidence/'*) continue ;;              # declared class: machine-emitted run evidence
      esac
      echo "$rel:$lno: W2 undeclared committed lifecycle artifact '$tok' — the exception admits '.wf/slots/<skill>.<point>.md', '.wf/run-evidence/<run>.json', '.wf/install-state.json', and a destination declared in a complete '## Payloads' row. '.wf/' is not a general home; declare the artifact's lifecycle before naming it."
    done <<TOKENS
$(printf '%s' "$line" | grep -Po "$PATHTOK")
TOKENS

    # --- W1: lifecycle ownership --------------------------------------------
    printf '%s' "$line" | grep -Pqi "$VERBS" || continue      # no write verb — nothing claimed
    printf '%s' "$line" | grep -Pqi '\bresolver' && continue  # attributed to the lifecycle owner
    tok="$(printf '%s' "$line" | grep -Pom1 "$PATHTOK")"      # name the offending path in the message
    echo "$rel:$lno: W1 unowned write claim on '${tok%.}' — a committed '.wf/' artifact is written only by the resolver runtime that owns its lifecycle. An ordinary skill or agent writes inside '_local/' and reads '.wf/' through the resolver."
  done <<EOF
$out
EOF
  return 0
}

# --- --selftest: drive the seeded corpus --------------------------------------
if [ "${1:-}" = "--selftest" ]; then
  st_fails=0

  check_pass() {
    local out; out="$(lint_file "$FIXROOT/$1")"
    if [ -n "$out" ]; then
      echo "selftest FAIL: $1 — expected CLEAN, got defects:"; echo "$out"
      st_fails=$((st_fails + 1))
    else
      echo "selftest ok (pass): $1"
    fi
  }

  # check_fail <fixture> <min-findings> <required-substring>...
  check_fail() {
    local fx="$1" want="$2"; shift 2
    local out got s ok=1
    out="$(lint_file "$FIXROOT/$fx")"
    got="$(printf '%s' "$out" | grep -c . || true)"
    if [ "$got" -lt "$want" ]; then
      echo "selftest FAIL: $fx — expected at least $want finding(s), got $got:"; echo "$out"
      st_fails=$((st_fails + 1)); return
    fi
    for s in "$@"; do
      case "$out" in *"$s"*) ;; *) ok=0; echo "selftest FAIL: $fx — output missing '$s'. Got:"; echo "$out";; esac
    done
    if [ "$ok" -ne 1 ]; then st_fails=$((st_fails + 1)); return; fi
    echo "selftest ok (fail): $fx — $got finding(s)"
  }

  # The clean case: both declared classes, resolver-attributed writes, the bare home,
  # and ordinary `_local/` prose. The gate must stay silent on every line.
  check_pass clean.md

  # W1 — five planted unowned write claims, none attributed to the resolver. Every path
  # named is a DECLARED class, so W2 must not fire here: the two defects stay separable.
  check_fail arbitrary-write.md 5 "W1 unowned write claim" ".wf/install-state.json" ".wf/slots/ship.review.md"
  case "$(lint_file "$FIXROOT/arbitrary-write.md")" in
    *"W2 "*) echo "selftest FAIL: arbitrary-write.md — W2 fired on a DECLARED artifact class; the two defect classes must stay separable."; st_fails=$((st_fails + 1));;
    *) echo "selftest ok (separable): arbitrary-write.md raises W1 only";;
  esac

  # W2 — six planted undeclared classes. Three of them NAME THE RESOLVER, proving lifecycle
  # ownership does not widen the admitted artifact set; one is a table row that names
  # a destination but declares no COMPLETE lifecycle, proving the payload exemption keys on
  # the full closed vocabulary rather than on merely looking like a table; and one is a
  # NEAR MISS on a declared class (`.wf/run-evidence.json` beside the declared
  # `.wf/run-evidence/` directory), proving an arm admits its own class and not the
  # neighbourhood around it.
  check_fail undeclared-artifact.md 6 "W2 undeclared committed lifecycle artifact" ".wf/cache/resolution.json" ".wf/constitution.md" ".wf/partial.json" ".wf/run-evidence.json"
  case "$(lint_file "$FIXROOT/undeclared-artifact.md")" in
    *"W1 "*) echo "selftest FAIL: undeclared-artifact.md — W1 fired on a resolver-attributed line; lifecycle ownership must exempt W1."; st_fails=$((st_fails + 1));;
    *) echo "selftest ok (separable): undeclared-artifact.md raises W2 only";;
  esac

  echo ""
  if [ "$st_fails" -ne 0 ]; then
    echo "LIFECYCLE-WRITE selftest: FAIL — $st_fails fixture case(s) misbehaved."
    exit 1
  fi
  echo "LIFECYCLE-WRITE selftest: PASS — the clean case stays silent and every planted violation is flagged, each in its own class."
  exit 0
fi

# --- Default: scan the real tree ----------------------------------------------
echo "LIFECYCLE-WRITE: repository root resolved to $ROOT"

if [ ! -d "$ROOT/plugins" ]; then
  echo "LIFECYCLE-WRITE: FAIL — no plugins/ directory under $ROOT."
  echo "                 A gate that inspects nothing cannot pass. This is a MIS-ANCHORED MOVE, not a clean"
  echo "                 tree — verify craft_repo_root() in skill-targets.sh still resolves to the repository root."
  exit 1
fi

hits=""
rc_any=0
scanned=0
while IFS= read -r target; do
  case "/$target/" in */_contracts/*) continue ;; esac   # the frozen contract layer defines the boundary
  craft_is_excluded "$target" && continue                # the shared structural exclusions
  scanned=$((scanned + 1))
  out="$(lint_file "$target")"; rc=$?
  if [ "$rc" -ge 2 ]; then rc_any=2; fi
  [ -n "$out" ] && hits="$hits$out"$'\n'
done < <(find "$ROOT/plugins" -type f -name '*.md' | LC_ALL=C sort)

# A scan whose target set resolved empty has proven nothing — fail LOUDLY rather than
# passing vacuously. This is the guard that catches a mis-anchored move.
if [ "$scanned" -eq 0 ]; then
  echo "LIFECYCLE-WRITE: FAIL — the scan resolved 0 markdown files under $ROOT/plugins/."
  echo "                 A gate that inspects nothing cannot pass. This is a MIS-ANCHORED MOVE, not a clean"
  echo "                 tree — verify craft_repo_root() in skill-targets.sh still resolves to the repository root."
  exit 1
fi
echo "LIFECYCLE-WRITE: resolved target set — $scanned markdown files under plugins/."

if [ "$rc_any" -ge 2 ]; then
  echo "LIFECYCLE-WRITE: ERROR — grep failed (requires PCRE grep -P)."
  exit 2
fi
if [ -n "$hits" ]; then
  echo "LIFECYCLE-WRITE: FAIL — authored prose claims a committed lifecycle write outside the one narrow exception:"
  printf '%s' "$hits"
  echo "                 The exception is resolver-managed DECLARED committed artifacts only — see CLAUDE.md §6 and core constitution article 3."
  exit 1
fi
echo "LIFECYCLE-WRITE: PASS — every committed lifecycle reference names a declared artifact class, and none claims a write outside the resolver's lifecycle ownership."
exit 0
