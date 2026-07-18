#!/usr/bin/env bash
# glossary-on-touch.sh — the ON-TOUCH PR gate for the glossary lint
# (WF-342, charter C022 / WF-339 OUT-4 + OUT-3).
#
# WF-341 shipped `glossary-lint.sh` with two modes and deliberately NO whole-tree
# default: it takes an EXPLICIT file set. That interface is the attachment point
# this script bolts onto. Here lives the other half of the severity model — WHICH
# files the gate is allowed to fail on:
#
#   hard-fail on files the PR TOUCHED, always on files the PR ADDED,
#   never on untouched pre-existing violators.
#
# So this script computes the touched set, filters it to the authored-prose lint
# surface, and hands that explicit set to the lint. It changes no check semantics
# and parses no glossary — it only decides scope.
#
# --- Modes ---
#   glossary-on-touch.sh --base <ref>   gate the diff <ref>...HEAD
#   glossary-on-touch.sh                no base ref -> documented safe degradation
#   glossary-on-touch.sh --selftest     fixture-backed self-test of the scoping
#
# --- The lint surface (charter decision 4) ---
#   plugins/*/skills/**/*.md        skill bodies + their references/ prose
#                                   (subsumes the core _contracts/ docs)
#   plugins/*/capabilities/**/*.md  fragments and manifests
#   plugins/*/agents/*.md           agent files
# minus, at the FILTER level (not merely via the lint's own exclusions):
#   * any `*-fixtures/` folder under plugins/wf/skills/_contracts/ — the
#     self-maintaining rule (OUT-2). It already covers skill-read-fixtures/,
#     slot-marker-fixtures/, registry-fixtures/ and glossary-fixtures/, and covers
#     any future guard's fixture folder with no list to keep current. A PR editing
#     a deliberately violating-shaped fixture must never trip the gate.
#   * GLOSSARY.md itself, which necessarily quotes every form it bans.
#
# --- Empty sets: the two distinct kinds, and why only one is fatal ---
# A PR whose touched set carries NO surface file (e.g. only plugins/wf/mcp/ source)
# is normal: the gate SKIPS INVOCATION and passes. It never issues a bare
# zero-argument call, which WF-341 defines as a usage error and which would
# false-fail CI.
#
# A PR whose touched set is empty BEFORE filtering is NOT normal — a pull request
# changes something by construction. An empty raw set means the base ref was
# missing or the diff was mis-computed, and a gate that passed there would pass
# VACUOUSLY: green while scanning nothing. That is the charter's named High risk
# (actions/checkout@v4's default shallow clone may not contain the PR base
# commit), so it is a HARD FAILURE here (exit 2), not a pass. Base-ref
# availability is thereby part of the gate's verified behaviour on every run, not
# an assumption about the workflow. The workflow's own half is `fetch-depth: 0` on
# the checkout (.github/workflows/ci.yml); this script additionally attempts one
# targeted fetch before giving up, so a future depth regression fails loudly
# instead of silently.
#
# --- Non-PR runs ---
# With no --base (a push to main, a local run), there is no touched set to compute
# and the gate degrades to an explicit no-op: it says so and exits 0. The
# permanent proof of the catch does not depend on it — glossary-lint.sh --selftest
# runs unconditionally in the guard chain.
#
# --- Exit codes ---
#   0  clean: violations none, or the filtered set was empty, or no base ref
#   1  at least one vocabulary violation in a touched/added surface file
#   2  base ref unresolvable, touched set mis-computed, or usage error
#
# Wired into CI as a sibling step in .github/workflows/ci.yml — NOT into
# registry-fixtures/run.sh — because the touched set needs workflow-level git
# context (the PR base sha) that the guard chain has no access to. This resolves
# charter assumption 8 to its named acceptable alternative. The SCOPING SELF-TEST
# below is wired into run.sh, so the scoping logic is fixture-proven on every run
# exactly like every other resident guard.
#
# Model: claude-opus-4-8
set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SELF_DIR/../../../.." && pwd)"            # -> repo root
LINT="$SELF_DIR/glossary-lint.sh"
FIXROOT="$SELF_DIR/glossary-fixtures"
TMPREPO="$FIXROOT/.scoping-tmp"

usage() {
  cat <<'USAGE'
glossary-on-touch.sh — gate a PR's touched/added files against _contracts/GLOSSARY.md.

  glossary-on-touch.sh --base <ref>   lint the files <ref>...HEAD touched or added
  glossary-on-touch.sh                no base ref: documented no-op, exit 0
  glossary-on-touch.sh --selftest     fixture-backed self-test of the scoping logic

Options:
  --repo <dir>        operate on this repository instead of the checkout (self-test)
  --dry-run           print the filtered set and the decision; never invoke the lint
  --glossary <path>   forwarded to glossary-lint.sh
  --allow-fixtures    forwarded to glossary-lint.sh (self-test only)

Severity model: hard-fail on touched files, always on added files, never on
untouched pre-existing violators.
USAGE
}

# ---------------------------------------------------------------------------
# Surface filter — the ONLY place the on-touch scope is defined.
# on_surface <repo-relative-path> — 0 when the path is lintable.
# ---------------------------------------------------------------------------
on_surface() {
  local p="$1"

  # Exclusion first: a fixture folder under _contracts/ is off the surface no
  # matter which surface glob it also matches. Self-maintaining — the glob names
  # no individual folder.
  case "$p" in
    plugins/wf/skills/_contracts/*-fixtures/*) return 1 ;;
  esac
  case "${p##*/}" in
    GLOSSARY.md) return 1 ;;
  esac

  printf '%s' "$p" | grep -Eq '^plugins/[^/]+/skills/.*\.md$'        && return 0
  printf '%s' "$p" | grep -Eq '^plugins/[^/]+/capabilities/.*\.md$'  && return 0
  printf '%s' "$p" | grep -Eq '^plugins/[^/]+/agents/[^/]+\.md$'     && return 0
  return 1
}

# ---------------------------------------------------------------------------
# Base-ref resolution — the charter's High risk, handled as behaviour.
# Echoes the resolved diff base on stdout; returns 2 when it cannot be had.
# ---------------------------------------------------------------------------
resolve_base() {
  local repo="$1" base="$2" sha mb

  sha="$(git -C "$repo" rev-parse --verify --quiet "${base}^{commit}")"
  if [ -z "$sha" ]; then
    # One targeted fetch, then give up loudly. Never fall through to "no base",
    # which would silently degrade a PR run into a vacuous pass.
    git -C "$repo" fetch --no-tags --quiet origin "$base" >/dev/null 2>&1
    sha="$(git -C "$repo" rev-parse --verify --quiet "${base}^{commit}")"
    [ -z "$sha" ] && sha="$(git -C "$repo" rev-parse --verify --quiet FETCH_HEAD)"
  fi
  if [ -z "$sha" ]; then
    echo "GLOSSARY-ON-TOUCH: ERROR — base ref '$base' does not resolve in this checkout," >&2
    echo "  and fetching it failed. The touched set cannot be computed, so the gate refuses" >&2
    echo "  to pass vacuously. Give the checkout the base commit (fetch-depth: 0)." >&2
    return 2
  fi

  # Prefer the merge base so a base branch that moved ahead does not drag
  # untouched files into the set (they would hard-fail files this PR never saw).
  mb="$(git -C "$repo" merge-base "$sha" HEAD 2>/dev/null)"
  if [ -n "$mb" ]; then
    printf '%s' "$mb"
  else
    echo "GLOSSARY-ON-TOUCH: note — no merge base between '$base' and HEAD (shallow history);" >&2
    echo "  diffing against the base commit directly." >&2
    printf '%s' "$sha"
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Gate
# ---------------------------------------------------------------------------
run_gate() {
  local repo="$1" base="$2"
  local diffbase raw live f kept=() rc

  diffbase="$(resolve_base "$repo" "$base")" || return 2
  echo "GLOSSARY-ON-TOUCH: base '$base' -> diff base $diffbase"

  # Two sets, for two different questions.
  #  * raw  — every path the PR changed, deletions included. Only its EMPTINESS
  #           is consulted: an empty raw set means the diff is mis-computed.
  #  * live — the paths that still exist (Added/Copied/Modified/Renamed). Only
  #           these can be linted; a deleted file has no prose left to check.
  raw="$(git -C "$repo" diff --name-only "$diffbase" HEAD)"
  live="$(git -C "$repo" diff --name-only --diff-filter=ACMR "$diffbase" HEAD)"

  if [ -z "$raw" ]; then
    echo "GLOSSARY-ON-TOUCH: ERROR — the touched set is EMPTY against base $diffbase."
    echo "  A pull request changes something by construction, so an empty set means the"
    echo "  base ref is wrong or the history is too shallow to diff. Failing rather than"
    echo "  passing vacuously (the gate must never report green while scanning nothing)."
    return 2
  fi

  while IFS= read -r f; do
    [ -n "$f" ] || continue
    on_surface "$f" || continue
    [ -f "$repo/$f" ] || continue
    kept+=("$repo/$f")
  done <<EOF
$live
EOF

  local ntouched nkept
  ntouched="$(printf '%s\n' "$raw" | grep -c .)"
  nkept="${#kept[@]}"
  echo "GLOSSARY-ON-TOUCH: $ntouched file(s) touched, $nkept on the lint surface."

  if [ "$nkept" -eq 0 ]; then
    echo "GLOSSARY-ON-TOUCH: PASS — no touched or added file is on the authored-prose"
    echo "  lint surface; the lint is not invoked (a bare call would be a usage error)."
    return 0
  fi

  printf 'GLOSSARY-ON-TOUCH: linting %s file(s):\n' "$nkept"
  for f in "${kept[@]}"; do
    printf '  %s\n' "${f#"$repo"/}"
  done

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "GLOSSARY-ON-TOUCH: dry run — lint not invoked."
    return 0
  fi

  local args=()
  [ -n "$GLOSSARY" ] && args+=(--glossary "$GLOSSARY")
  [ "$ALLOW_FIXTURES" -eq 1 ] && args+=(--allow-fixtures)
  bash "$LINT" "${args[@]}" "${kept[@]}"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "GLOSSARY-ON-TOUCH: FAIL — a file this PR touched or added violates the canonical"
    echo "  vocabulary. Fix the prose, or amend plugins/wf/skills/_contracts/GLOSSARY.md if"
    echo "  the rule is wrong. Untouched files elsewhere in the tree are never gated."
  fi
  return $rc
}

# ---------------------------------------------------------------------------
# Self-test — the scoping logic is BEHAVIOUR, so it gets fixtures like every
# other resident guard.
#
# It builds a throwaway git repository whose paths mirror the real surface globs,
# commits a base state carrying a pre-existing violator, then replays one PR
# shape per assertion. The lint runs for real against the fixture glossary
# (never the live GLOSSARY.md — a later edit to a live entry must not be able to
# silently delete the term these assertions depend on).
#
# The throwaway repo lives UNDER glossary-fixtures/ on purpose: glossary-lint.sh
# derives document classes from repo-relative paths, so a scratch repo outside
# the tree would have every file classified "not an authored-prose surface" and
# every assertion would pass while proving nothing. Sitting under a `*-fixtures/`
# folder it is off every resident guard's surface, and `--allow-fixtures` lets
# the lint see through that one exclusion for the assertions that need a real
# catch. The gate's OWN `*-fixtures/` filtering is asserted separately, on the
# scratch repo's own repo-relative paths (assertion 6).
# ---------------------------------------------------------------------------
GIT_Q() { git -C "$TMPREPO" "$@" >/dev/null 2>&1; }

tmp_commit() {
  GIT_Q add -A
  GIT_Q -c user.name=fixture -c user.email=fixture@example.invalid \
        commit --no-gpg-sign -m "$1"
}

write_file() {
  mkdir -p "$TMPREPO/$(dirname "$1")"
  printf '%s\n' "$2" > "$TMPREPO/$1"
}

build_tmp_repo() {
  rm -rf "$TMPREPO"
  mkdir -p "$TMPREPO"
  GIT_Q init -q
  GIT_Q symbolic-ref HEAD refs/heads/main

  # Base state. `pre-existing/SKILL.md` carries a violation NOBODY touches — the
  # untouched-violator case the whole severity model exists to tolerate.
  write_file plugins/wf/skills/pre-existing/SKILL.md \
    '# fixture — a pre-existing wodget nobody in these PRs touches'
  write_file plugins/wf/skills/other/SKILL.md \
    '# fixture — a clean skill body'
  write_file plugins/wf/skills/_contracts/skill-read-fixtures/violation.md \
    '# fixture-of-a-fixture — deliberately violating wodget prose'
  write_file plugins/wf/mcp/src/thing.ts \
    'export const wodget = 1; // not authored prose, off the surface'
  write_file README.md \
    'repo root file, off the surface'
  write_file plugins/wf/skills/doomed/SKILL.md \
    '# fixture — deleted by one of the PR shapes'
  tmp_commit "base"
  GIT_Q tag base
}

# reset_to_base — start each PR shape from the same base commit.
reset_to_base() { GIT_Q checkout -q -B pr base; }

selftest() {
  local fails=0 out rc
  local fg="$FIXROOT/glossary.fixture.md"

  say_ok()   { echo "selftest ok: $1"; }
  say_fail() { echo "selftest FAIL: $1"; fails=$((fails + 1)); }

  # gate <extra-args...> — run this script against the scratch repo.
  gate() {
    bash "${BASH_SOURCE[0]}" --repo "$TMPREPO" --glossary "$fg" --allow-fixtures "$@" 2>&1
  }

  build_tmp_repo
  trap 'rm -rf "$TMPREPO"' RETURN

  # 1. No base ref (push to main, local run): documented no-op, never a failure.
  out="$(bash "${BASH_SOURCE[0]}" --repo "$TMPREPO" 2>&1)"; rc=$?
  if [ "$rc" -ne 0 ] || [ -n "${out##*no base ref*}" ]; then
    say_fail "no-base-ref run did not degrade safely (exit $rc):"; echo "$out"
  else
    say_ok "a run with no base ref degrades to a documented no-op and passes"
  fi

  # 2. A base ref that does not resolve fails LOUDLY — never a silent pass.
  out="$(gate --base deadbeefdeadbeefdeadbeefdeadbeefdeadbeef)"; rc=$?
  if [ "$rc" -ne 2 ] || [ -n "${out##*does not resolve*}" ]; then
    say_fail "unresolvable base ref did not fail loudly (expected exit 2, got $rc):"; echo "$out"
  else
    say_ok "an unresolvable base ref exits 2 naming the problem (no vacuous pass)"
  fi

  # 3. THE VACUOUS-PASS GUARD: an empty touched set is a mis-computed diff, not a
  #    clean PR. This is the charter's High risk asserted as behaviour.
  reset_to_base
  out="$(gate --base base)"; rc=$?
  if [ "$rc" -ne 2 ] || [ -n "${out##*EMPTY*}" ]; then
    say_fail "an empty touched set did not fail (expected exit 2, got $rc):"; echo "$out"
  else
    say_ok "an empty touched set fails as a mis-computed diff, never passing vacuously"
  fi

  # 4. A PR touching only CLEAN surface files passes — while the untouched
  #    pre-existing violator sits in the same tree, ungated.
  reset_to_base
  write_file plugins/wf/skills/other/SKILL.md '# fixture — a clean skill body, edited'
  tmp_commit "touch a clean file"
  out="$(gate --base base)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    say_fail "clean-touch PR failed (expected exit 0, got $rc):"; echo "$out"
  elif [ -z "${out##*pre-existing*}" ]; then
    say_fail "clean-touch PR dragged the untouched pre-existing violator into the set:"; echo "$out"
  else
    say_ok "a PR touching no violator passes while a pre-existing violator exists untouched"
  fi

  # 5. A PR TOUCHING a file that carries a violation hard-fails, naming file+term.
  reset_to_base
  write_file plugins/wf/skills/other/SKILL.md '# fixture — this edit introduces a wodget'
  tmp_commit "touch a file into violation"
  out="$(gate --base base)"; rc=$?
  if [ "$rc" -ne 1 ]; then
    say_fail "touched violating file did not fail (expected exit 1, got $rc):"; echo "$out"
  else
    local s ok=1
    for s in 'other/SKILL.md' 'wodget' 'widget'; do
      case "$out" in *"$s"*) ;; *) ok=0; say_fail "touched-file report missing '$s'. Got:"; echo "$out";; esac
    done
    [ "$ok" -eq 1 ] && say_ok "a touched file's violation hard-fails, naming the file, the term, and the alternative"
  fi

  # 6. A PR ADDING a new violating file hard-fails (added is always in scope).
  #    The new file is a SKILL.md rather than an agent file for a mechanical
  #    reason: the scratch repo is nested inside the real tree, and of the lint's
  #    document-class patterns only `skill-body` carries the wildcard slack to
  #    match through that nesting — an agent path would be classified out and the
  #    assertion would pass vacuously. What is under test here is the gate's
  #    added-file scoping, which is class-independent; the surface filter's own
  #    treatment of agent and capability paths is asserted by `on_surface` through
  #    assertions 7 and 8.
  reset_to_base
  write_file plugins/wf/skills/brandnew/SKILL.md '# fixture — a brand-new file carrying a wodget'
  tmp_commit "add a new violating file"
  out="$(gate --base base)"; rc=$?
  if [ "$rc" -ne 1 ] || [ -n "${out##*brandnew/SKILL.md*}" ]; then
    say_fail "newly added violating file did not fail (expected exit 1, got $rc):"; echo "$out"
  else
    say_ok "a newly added violating file hard-fails (added files are always in scope)"
  fi

  # 7. A PR touching only a `*-fixtures/` file passes — excluded AT THE FILTER,
  #    so the lint is never even invoked on it.
  reset_to_base
  write_file plugins/wf/skills/_contracts/skill-read-fixtures/violation.md \
    '# fixture-of-a-fixture — still deliberately violating wodget prose, now edited'
  tmp_commit "touch a fixture file"
  out="$(gate --base base)"; rc=$?
  if [ "$rc" -ne 0 ] || [ -n "${out##*not invoked*}" ]; then
    say_fail "a *-fixtures/ touch was not excluded at the filter (exit $rc):"; echo "$out"
  else
    say_ok "a *-fixtures/ touch is excluded at the touched-set filter, not merely by the lint"
  fi

  # 8. A PR whose touched files are all off the surface skips INVOCATION and
  #    passes — never a bare zero-argument call (WF-341's usage error).
  reset_to_base
  write_file plugins/wf/mcp/src/thing.ts 'export const wodget = 2; // still off the surface'
  write_file README.md 'repo root file, edited, still off the surface'
  tmp_commit "touch only off-surface files"
  out="$(gate --base base)"; rc=$?
  if [ "$rc" -ne 0 ] || [ -n "${out##*not invoked*}" ]; then
    say_fail "empty filtered set did not skip invocation and pass (exit $rc):"; echo "$out"
  elif [ -z "${out##*GLOSSARY-LINT*}" ]; then
    say_fail "empty filtered set still invoked the lint:"; echo "$out"
  else
    say_ok "an empty filtered set skips the lint invocation and passes (no bare usage-error call)"
  fi

  # 9. A deletion-only PR passes: a deleted file has no prose left to lint, and
  #    the raw set is non-empty so the vacuous-pass guard stays quiet.
  reset_to_base
  rm -f "$TMPREPO/plugins/wf/skills/doomed/SKILL.md"
  tmp_commit "delete a surface file"
  out="$(gate --base base)"; rc=$?
  if [ "$rc" -ne 0 ]; then
    say_fail "deletion-only PR failed (expected exit 0, got $rc):"; echo "$out"
  else
    say_ok "a deletion-only PR passes (nothing to lint, and the emptiness guard stays quiet)"
  fi

  # 10. The gate resolves a base given as a REF NAME, not only as a sha — the
  #     shape a workflow passes.
  reset_to_base
  write_file plugins/wf/skills/other/SKILL.md '# fixture — a clean skill body, edited again'
  tmp_commit "touch a clean file, base named by ref"
  out="$(gate --base refs/tags/base)"; rc=$?
  if [ "$rc" -ne 0 ] || [ -n "${out##*diff base*}" ]; then
    say_fail "a named base ref did not resolve (exit $rc):"; echo "$out"
  else
    say_ok "a base given as a ref name resolves to a diff base like a raw sha does"
  fi

  echo ""
  if [ "$fails" -ne 0 ]; then
    echo "GLOSSARY-ON-TOUCH selftest: FAIL — $fails assertion(s) misbehaved."
    return 1
  fi
  echo "GLOSSARY-ON-TOUCH selftest: PASS — touched fails, added fails, untouched passes, fixtures excluded, empty set skips, mis-computed diff fails loudly."
  return 0
}

# ---------------------------------------------------------------------------
# Argument handling
# ---------------------------------------------------------------------------
BASE=""
REPO="$ROOT"
MODE=""
DRY_RUN=0
GLOSSARY=""
ALLOW_FIXTURES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --selftest)       MODE="selftest"; shift ;;
    --dry-run)        DRY_RUN=1; shift ;;
    --allow-fixtures) ALLOW_FIXTURES=1; shift ;;
    --base)
      if [ $# -lt 2 ]; then echo "GLOSSARY-ON-TOUCH: ERROR — --base needs a ref."; usage; exit 2; fi
      BASE="$2"; shift 2 ;;
    --repo)
      if [ $# -lt 2 ]; then echo "GLOSSARY-ON-TOUCH: ERROR — --repo needs a path."; usage; exit 2; fi
      REPO="$2"; shift 2 ;;
    --glossary)
      if [ $# -lt 2 ]; then echo "GLOSSARY-ON-TOUCH: ERROR — --glossary needs a path."; usage; exit 2; fi
      GLOSSARY="$2"; shift 2 ;;
    -h|--help)        usage; exit 2 ;;
    *)                echo "GLOSSARY-ON-TOUCH: ERROR — unexpected argument '$1'."; usage; exit 2 ;;
  esac
done

if [ "$MODE" = "selftest" ]; then
  selftest
  exit $?
fi

if [ -z "$BASE" ]; then
  echo "GLOSSARY-ON-TOUCH: no base ref supplied — nothing to scope against, so the"
  echo "  on-touch gate is a no-op here (a push to main or a local run, not a PR)."
  echo "  The catch itself stays proven: glossary-lint.sh --selftest runs unconditionally"
  echo "  in the guard chain."
  exit 0
fi

run_gate "$REPO" "$BASE"
exit $?
