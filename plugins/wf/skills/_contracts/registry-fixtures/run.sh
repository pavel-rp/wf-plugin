#!/usr/bin/env bash
#
# run.sh — fixture test runner for validate-registry.sh.
#
# Runs the registry validator against every fixture in this directory and
# asserts each one's exit code and that its output names the specific offending
# capability / name / path / scope / clause / fragment. The fixtures ARE the
# test suite for the validator (this repo has no unit/integration harness), and
# this script makes that suite reproducible: it exits 0 only when every case
# behaves as specified, non-zero otherwise.
#
# Each fixture registry uses FULL repo-relative paths into this fixtures tree, so
# the validator resolves them against the real repo root exactly as it would in
# production — fixture resolution is byte-identical to a real run.
#
# Model: claude-opus-4-8
#
# Usage:
#   bash plugins/wf/skills/_contracts/registry-fixtures/run.sh

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$DIR/../validate-registry.sh"

pass=0
fail=0

# assert <name> <fixture> <registry-path-override|-> <expected-exit> [required-substring ...]
#
# Runs the validator on <fixture>. When <registry-path-override> is not `-`, it
# is passed as the validator's 2nd arg (the registryPath shape-check seam);
# `-` means "read registryPath from wf.config.js as in a real run." Then checks
# the exit code matches and that every required substring appears in the output.
# Output is captured (not a TTY), so the validator emits no color codes — plain-
# text matching is exact.
assert() {
  local name="$1" fixture="$2" override="$3" want_exit="$4"; shift 4
  local out got_exit ok=1 sub

  if [ "$override" = "-" ]; then
    out="$(bash "$VALIDATOR" "$DIR/$fixture" 2>&1)"
  else
    out="$(bash "$VALIDATOR" "$DIR/$fixture" "$override" 2>&1)"
  fi
  got_exit=$?

  if [ "$got_exit" -ne "$want_exit" ]; then
    ok=0
    printf 'FAIL: %s — expected exit %s, got %s\n' "$name" "$want_exit" "$got_exit"
  fi
  for sub in "$@"; do
    case "$out" in
      *"$sub"*) ;;
      *) ok=0; printf 'FAIL: %s — output missing expected text: %s\n' "$name" "$sub" ;;
    esac
  done

  if [ "$ok" -eq 1 ]; then
    printf 'PASS: %s\n' "$name"
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
  fi
}

# --- Passing cases -----------------------------------------------------------
assert "single-row registry passes"   pass-single.md - 0 "Validation passed"
assert "multi-row non-overlap passes" pass-multi.md  - 0 "Validation passed"
# WF-26: angular (provider surface: host) + node-ts (skills-only) compose with
# browser-qa (provider surface: engine) — different surfaces, no partition collision.
assert "stack caps compose passes"    pass-stack.md  - 0 "Validation passed" "angular" "node-ts"
# WF-99: a plugin-anchored Path (`plugin:testpkg/caps/solo`) resolves via the
# co-located `## Plugin Roots` mapping to the real caps/solo manifest.
assert "plugin-anchored resolves passes" pass-plugin-anchored.md - 0 "Validation passed" "testpkg"
# WF-120: a single capability owning the delivery provider surface (a `provider`
# fragment at `implement`, scope `delivery`) validates clean — CHECK 5 is already
# phase-agnostic, so this exercises the existing overlap check with no code change.
assert "delivery surface single owner passes" pass-delivery.md - 0 "Validation passed"
# WF-121: a single capability owning the tracker provider surface (a `provider`
# fragment at `spec`, scope `tracker`) validates clean — same phase-agnostic CHECK 5
# path as delivery, exercised with a second surface token and a second phase.
assert "tracker surface single owner passes" pass-tracker.md - 0 "Validation passed"
# WF-126: a wf-caps-shaped capability requiring both `git` and `ado`, with both
# satisfied, validates clean.
assert "two-dependency requires satisfied passes" pass-requires-git-ado.md - 0 "Validation passed"

# --- Failing cases (one per check) -------------------------------------------
assert "duplicate name named"         fail-dup-name.md      - 1 "duplicate capability name" "solo"
assert "unsafe name named"            fail-unsafe-name.md   - 1 "not filesystem-safe" "Solo_Cap"
assert "bad registryPath (absolute)"  pass-single.md "/etc/registry.md"  1 "registryPath" "/etc/registry.md"
assert "bad registryPath (drive)"     pass-single.md "C:/x/registry.md"  1 "registryPath" "drive-prefixed"
assert "bad registryPath (dotdot)"    pass-single.md "../escape.md"      1 "registryPath" "'..'"
assert "bad registryPath (backslash)" pass-single.md "a\\b/registry.md"  1 "registryPath" "backslash"
assert "missing path named"           fail-missing-path.md  - 1 "ghost" "does not exist"
assert "missing manifest named"       fail-no-manifest.md   - 1 "no-manifest" "manifest.md"
assert "provider overlap named"       fail-provider-overlap.md - 1 "engine-owner" "engine-owner-2" "provider surface" "must not overlap"
assert "artifact overlap named"       fail-artifact-overlap.md - 1 "artifact-owner" "artifact-owner-2" "csharp→ts"
# WF-120: two capabilities both claiming the delivery provider surface, both named.
assert "delivery overlap named"       fail-delivery-overlap.md - 1 "delivery-owner" "delivery-owner-2" "delivery" "must not overlap"
# WF-121: two capabilities both claiming the tracker provider surface, both named.
assert "tracker overlap named"        fail-tracker-overlap.md  - 1 "tracker-owner" "tracker-owner-2" "tracker" "must not overlap"
# WF-136: the tracker contract's two independent provider bindings (ado, linear)
# cannot both own the tracker surface — named by their real capability names, not
# the generic tracker-owner/-2 stand-ins above.
assert "ado vs linear tracker overlap named" fail-tracker-overlap-ado-linear.md - 1 "ado" "linear" "tracker" "must not overlap"
assert "bad phase named"              fail-bad-phase.md     - 1 "bad-phase" "unknown phase" "deploy"
assert "bad kind named"               fail-bad-kind.md      - 1 "bad-kind" "unknown contribution-kind" "assertion"
# Glob metacharacters must NOT bypass the phase/kind allowlist. The interpolated
# value is quoted inside the case pattern (`*" $f_phase "*`), so `*` matches
# literally and is rejected — these guard that quoting against an un-quoting
# refactor that would reintroduce a glob-bypass.
assert "glob phase rejected"          fail-glob-phase.md    - 1 "glob-phase" "unknown phase" "*"
assert "glob kind rejected"           fail-glob-kind.md     - 1 "glob-kind" "unknown contribution-kind" "*"
assert "unsatisfied requires named"   fail-requires.md      - 1 "needs-dep" "absent-dep"
# WF-126: two-dependency requires (`git, ado`), `ado` absent — names the requirer, the
# missing capability, and CHECK 7's new remedy clause.
assert "two-dependency requires unsatisfied named" fail-requires-git-ado.md - 1 "needs-git-ado" "requires \`ado\`" "Install and register/initialize"
assert "co-active conflicts named"    fail-conflicts.md     - 1 "conflicter" "solo" "declares a conflict"
assert "article contradiction named"  fail-article.md       - 1 "article-yes" "article-no" "commit-signing"
# WF-99: plugin-anchored resolution failures — unmapped plugin, and mapped-but-dangling.
assert "unmapped plugin root named"   fail-plugin-root-missing.md  - 1 "testpkg" "Plugin Roots"
assert "dangling plugin manifest named" fail-plugin-root-dangling.md - 1 "ghost" "does not resolve to a directory"
# WF-99: mapped plugin, resolved dir exists but no manifest.md.
assert "plugin manifest missing named" fail-plugin-manifest-missing.md - 1 "nomani" "manifest.md"
# WF-99: CHECK 4a plugin-root shape — empty / backslash / '..' segment.
assert "plugin root empty named"      fail-plugin-root-empty.md     - 1 "wf-caps" "needs a Root"
assert "plugin root backslash named"  fail-plugin-root-backslash.md - 1 "wf-caps" "backslash"
assert "plugin root dotdot named"     fail-plugin-root-dotdot.md    - 1 "wf-caps" "'..' segment"
assert "plugin root duplicate named"  fail-plugin-root-dup.md       - 1 "wf-caps" "duplicate plugin root name"

echo ""
printf 'Results: %s passed, %s failed.\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
