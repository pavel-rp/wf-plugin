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
# WF-369 moved the ops-doc drift guards (check-ops-docs.sh) and the skill
# slot-marker lint (skill-slot-marker-lint.sh) out of core and into the
# wf-core-authoring pack's own fixture suite, and shed the three blocks that
# invoked them from here. Core validates its own structure with ZERO PACKS
# PRESENT, so this chain reaches no pack script — it sheds rather than reaches.
#
# Since WF-200 every plugin-anchored case injects the fixture install manifest
# (installed_plugins.fixture.json) as the validator's 3rd arg, so the
# recorded-root-first self-heal fallback is exercised hermetically — the suite
# never reads the real ~/.claude/plugins/installed_plugins.json.
#
# Model: claude-fable-5
#
# Usage:
#   bash plugins/wf/skills/_contracts/registry-fixtures/run.sh

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATOR="$DIR/../validate-registry.sh"

pass=0
fail=0

# assertm <name> <fixture> <registry-path-override|-> <install-manifest|-> <expected-exit> [required-substring ...]
#
# Runs the validator on <fixture>. When <registry-path-override> is not `-`, it
# is passed as the validator's 2nd arg (the registryPath shape-check seam);
# `-` means "read registryPath from wf.config.js as in a real run." When
# <install-manifest> is not `-`, `$DIR/<install-manifest>` is passed as the
# validator's 3rd arg — the injectable install-manifest path its self-heal
# fallback reads (WF-200) — so every plugin-anchored fixture resolves against a
# fixture manifest and no assert ever reads (or depends on) the real machine
# manifest; `-` omits the arg. Then checks the exit code matches and that every
# required substring appears in the output. Output is captured (not a TTY), so
# the validator emits no color codes — plain-text matching is exact.
assertm() {
  local name="$1" fixture="$2" override="$3" manifest="$4" want_exit="$5"; shift 5
  local out got_exit ok=1 sub

  [ "$override" = "-" ] && override=""
  local args=("$DIR/$fixture")
  if [ "$manifest" != "-" ]; then
    # Positional 3rd arg needs a 2nd; an empty registry-path override means
    # "read registryPath from wf.config.js" (the validator treats it as unset).
    args+=("$override" "$DIR/$manifest")
  elif [ -n "$override" ]; then
    args+=("$override")
  fi
  out="$(bash "$VALIDATOR" "${args[@]}" 2>&1)"
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

# assert <name> <fixture> <registry-path-override|-> <expected-exit> [required-substring ...]
#
# Back-compat form of assertm with no install-manifest injection (for fixtures
# with no plugin-anchored rows, where the self-heal fallback can never fire).
assert() {
  local name="$1" fixture="$2" override="$3" want_exit="$4"; shift 4
  assertm "$name" "$fixture" "$override" - "$want_exit" "$@"
}

# --- Passing cases -----------------------------------------------------------
assert "single-row registry passes"   pass-single.md - 0 "Validation passed"
# WF-485 (C029 OUT-4): the purpose-built empty registry the core lean adversarial
# default is measured on. This repo's own registry carries eight capabilities and so
# cannot show what core does with none registered.
assert "empty registry passes"        pass-empty.md  - 0 "Validation passed" "fully generic core"
assert "discoverable subagent passes" pass-subagent-discoverable.md - 0 "Validation passed"
assert "final capabilities segment resolves owning subagent" pass-subagent-final-capabilities-segment.md - 0 "Validation passed"
assert "multi-row non-overlap passes" pass-multi.md  - 0 "Validation passed"
# WF-26: angular (provider surface: host) + node-ts (implement-guidance fragment, WF-177)
# compose with browser-qa (provider surface: engine) — different surfaces, no partition collision.
assert "stack caps compose passes"    pass-stack.md  - 0 "Validation passed" "angular" "node-ts"
# WF-99: a plugin-anchored Path (`plugin:testpkg/caps/solo`) resolves via the
# co-located `## Plugin Roots` mapping to the real caps/solo manifest.
assert "plugin-anchored resolves passes" pass-plugin-anchored.md - 0 "Validation passed" "testpkg"
# WF-120: a single capability owning the delivery provider surface (a `provider`
# fragment at `implement`, scope `delivery`) validates clean — CHECK 5 is already
# phase-agnostic, so this exercises the existing overlap check with no code change.
assert "delivery surface single owner passes" pass-delivery.md - 0 "Validation passed"
# WF-157: the extended delivery provider composes with a tracker provider and a
# qa-execution engine provider in one registry — three distinct surfaces, clean.
assert "delivery composes with tracker + engine passes" pass-delivery-multi-surface.md - 0 "Validation passed" "delivery-owner" "tracker-owner" "engine-owner"
# WF-121: a single capability owning the tracker provider surface (a `provider`
# fragment at `spec`, scope `tracker`) validates clean — same phase-agnostic CHECK 5
# path as delivery, exercised with a second surface token and a second phase.
assert "tracker surface single owner passes" pass-tracker.md - 0 "Validation passed"
# WF-126: a capability requiring both `git` and `ado`, with both
# satisfied, validates clean.
assert "two-dependency requires satisfied passes" pass-requires-git-ado.md - 0 "Validation passed"
# WF-158: a concrete tracker provider (`ado`, whose surface now carries the query
# operations) composes with a `delivery` provider — the surface pairing a cross-tracker
# briefing needs; two distinct surfaces, clean.
assert "tracker composes with delivery passes" pass-tracker-delivery.md - 0 "Validation passed" "ado" "delivery-owner"
# WF-176: the branch-changes-read read op extends the delivery surface without adding a
# surface/phase/kind — a single owner still carries the whole (now-extended) surface, clean.
assert "delivery branch-changes single owner passes" pass-delivery-branch-changes.md - 0 "Validation passed"
# WF-154: a capability attaches a `finding` at the new `pre-commit` self-review seam (the
# commit-path injection point) — the new phase is recognized and the reused kind validates clean.
assert "pre-commit finding seam passes" pass-precommit-review.md - 0 "Validation passed" "precommit-review"
# WF-160: the REAL shipped sr capability (plugins/wf-audit/capabilities/sr) validates clean — its
# one `pre-commit | finding | inline:` row and its `article: precommit-self-review` clause pass.
assert "real sr capability passes" pass-sr.md - 0 "Validation passed" "sr"
# WF-323: a well-formed seventh-kind (`slot`) contribution — scope `ship.review replace`,
# phase cell `—`, coexisting with a `verify | finding` row in the same manifest — validates clean.
assert "slot seventh-kind passes"     pass-slot.md - 0 "Validation passed" "slot-owner"
# WF-323: two `append`-policy slot contributions to the SAME skill.point compose (aggregate) —
# append never conflicts, unlike replace; both owners validate clean.
assert "slot append composes passes"  pass-slot-append.md - 0 "Validation passed" "slot-append" "slot-append-2"

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
# WF-432: host is likewise a partitioned qa-execution provider surface; two host owners are rejected.
assert "host provider overlap named"  fail-host-overlap.md - 1 "host-owner" "host-owner-2" "host" "must not overlap"
assert "artifact overlap named"       fail-artifact-overlap.md - 1 "artifact-owner" "artifact-owner-2" "csharp→ts"
# WF-120: two capabilities both claiming the delivery provider surface, both named.
assert "delivery overlap named"       fail-delivery-overlap.md - 1 "delivery-owner" "delivery-owner-2" "delivery" "must not overlap"
# WF-157: two delivery owners at DIFFERENT phases (implement vs spec) still overlap —
# surface uniqueness is phase-agnostic; both named.
assert "delivery overlap across phases named" fail-delivery-overlap-phases.md - 1 "delivery-owner" "delivery-owner-spec" "delivery" "must not overlap"
# WF-176: the branch-changes read op cannot be split to a SECOND delivery owner — the
# surface is partitioned by its scope token alone, so a second `delivery` claimant
# collides with the existing owner; both named.
assert "delivery branch-changes split named" fail-delivery-branch-changes-split.md - 1 "delivery-owner" "delivery-owner-2" "delivery" "must not overlap"
# WF-121: two capabilities both claiming the tracker provider surface, both named.
assert "tracker overlap named"        fail-tracker-overlap.md  - 1 "tracker-owner" "tracker-owner-2" "tracker" "must not overlap"
# WF-136: the tracker contract's two independent provider bindings (ado, linear)
# cannot both own the tracker surface — named by their real capability names, not
# the generic tracker-owner/-2 stand-ins above.
assert "ado vs linear tracker overlap named" fail-tracker-overlap-ado-linear.md - 1 "ado" "linear" "tracker" "must not overlap"
# WF-158: two tracker claimants (`ado` + `tracker-owner`) amid a `delivery` provider —
# the tracker partition collision is named (both offenders), undistracted by the extra
# delivery surface.
assert "tracker overlap amid delivery named" fail-tracker-delivery-overlap.md - 1 "ado" "tracker-owner" "tracker" "must not overlap"
assert "bad phase named"              fail-bad-phase.md     - 1 "bad-phase" "unknown phase" "deploy"
assert "bad kind named"               fail-bad-kind.md      - 1 "bad-kind" "unknown contribution-kind" "assertion"
# WF-239: `article` is NOT a contribution kind (a constitution clause is the `article:`
# manifest KEY, not a fragments-table row) — a fragment naming it is rejected.
assert "article as fragment kind rejected" fail-article-kind.md - 1 "article-kind" "unknown contribution-kind" "article"
# WF-239: dispatch-column validation — a bare path with no `inline:`/`subagent:` prefix
# is rejected (previously f_dispatch was extracted but never checked).
assert "malformed dispatch rejected"  fail-bad-dispatch.md  - 1 "bad-dispatch" "malformed dispatch"
# WF-432: syntactically valid `subagent:` dispatches must resolve to an agent file in
# the owning/workspace plugin tree; a missing target is a named CHECK-6b failure.
assert "missing subagent target rejected" fail-subagent-missing.md - 1 "subagent-missing" "undiscoverable subagent target" "absent-agent"
# WF-239: heading-typo guard — a miscased `## Fragments` heading (which would parse zero
# rows and pass silently) is rejected, naming the offender.
assert "heading typo rejected"        fail-heading-typo.md  - 1 "heading-typo" "looks like a typo" "## Fragments"
# WF-154: the `pre-commit` seam reuses `finding` — a fragment inventing a bespoke `self-review`
# kind at it is rejected naming the offender (the phase is valid; the invented kind is not).
assert "pre-commit bespoke kind rejected" fail-precommit-badkind.md - 1 "precommit-badkind" "unknown contribution-kind" "self-review"
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
# WF-323: two capabilities each `replace`-claiming the same slot skill.point conflict —
# single-owner overlap, both offenders named plus the contested skill.point.
assert "slot replace overlap named"   fail-slot-overlap.md - 1 "slot-owner" "slot-owner-2" "slot skill.point (replace)" "ship.review" "must not overlap"
# WF-323: a slot row whose skill.point has no `<skill>.<point>` dot is a malformed scope.
assert "slot malformed scope named"   fail-slot-badscope.md - 1 "slot-badscope" "malformed scope"
# WF-323: a slot row that names a skill.point but declares no merge policy is rejected.
assert "slot undeclared policy named" fail-slot-nopolicy.md - 1 "slot-nopolicy" "declares no merge policy"
# WF-323: a slot row must carry `—` in the phase column (a slot targets a skill point, not an
# SDD phase) — a row naming a real phase (`spec`) is rejected, naming the offender.
assert "slot misfiled phase named"    fail-slot-badphase.md - 1 "slot-badphase" "not an SDD phase"
# WF-99: plugin-anchored resolution failures — unmapped plugin, and mapped-but-dangling.
# Since WF-200 these inject the fixture manifest (hermetic): its `testpkg` decoy
# record points at a dead installPath, so the self-heal fallback recovers nothing
# and each case still errors, naming the offender.
assertm "unmapped plugin root named"   fail-plugin-root-missing.md  - installed_plugins.fixture.json 1 "testpkg" "Plugin Roots"
assertm "dangling plugin manifest named" fail-plugin-root-dangling.md - installed_plugins.fixture.json 1 "ghost" "does not resolve to a directory"
# WF-99: mapped plugin, resolved dir exists but no manifest.md.
assertm "plugin manifest missing named" fail-plugin-manifest-missing.md - installed_plugins.fixture.json 1 "nomani" "manifest.md"

# --- WF-200: recorded-root-first self-heal via the injectable install manifest ---
# All plugin-anchored self-heal cases run against the fixture manifest
# (installed_plugins.fixture.json) — never the real ~/.claude manifest — and its
# installPaths are repo-relative, so the outcomes are machine-independent.
# Pass: `healpkg` has NO `## Plugin Roots` entry; the manifest's stale record
# (dead installPath) is skipped (prefer-existing-installPath) and the live
# record's backslashed repo-relative installPath normalizes and resolves.
assertm "self-heal recovers unmapped plugin" pass-self-heal.md - installed_plugins.fixture.json 0 "Validation passed" "install-manifest fallback" "healpkg"
# Pass: `healpkg` is mapped but its recorded root dangles — healed the same way.
assertm "self-heal recovers dangling root" pass-self-heal-dangling.md - installed_plugins.fixture.json 0 "Validation passed" "install-manifest fallback"
# Fail: `lostpkg`'s recorded root dangles AND its manifest record's installPath
# is dead — unrecoverable; the row is named with the re-run-init remedy.
assertm "unrecoverable row named after self-heal" fail-self-heal.md - installed_plugins.fixture.json 1 "lost" "unrecoverable" "re-run the pack's init"
# OUT-3 recorded-root-first proof: `testpkg`'s recorded root is LIVE while the
# injected manifest carries only a DECOY testpkg record pointing at a dead path —
# the run passes via the recorded root, so the fallback was never consulted (a
# fallback-first implementation would recover nothing and fail).
assertm "recorded root first — fallback never consulted" pass-plugin-anchored.md - installed_plugins.fixture.json 0 "Validation passed" "via plugin root"
# WF-99: CHECK 4a plugin-root shape — empty / backslash / '..' segment.
assert "plugin root empty named"      fail-plugin-root-empty.md     - 1 "testpkg" "needs a Root"
assert "plugin root backslash named"  fail-plugin-root-backslash.md - 1 "testpkg" "backslash"
assert "plugin root dotdot named"     fail-plugin-root-dotdot.md    - 1 "testpkg" "'..' segment"
assert "plugin root duplicate named"  fail-plugin-root-dup.md       - 1 "testpkg" "duplicate plugin root name"

# --- WF-291: OUT-4 SKILL.md read-instruction regression guard ------------------
# Agents/skill bodies must INVOKE a sibling skill via the Skill tool, never
# filesystem-read its SKILL.md (CLAUDE.md §8). This guard's --selftest proves the
# instruction-vs-prose classifier flags a deliberate violation and passes the
# known prose references; the default scan proves the real tree carries zero read
# instructions. Both are asserted here so the CI entry point covers them (the
# guard is NOT auto-discovered — it must be wired in explicitly).
echo ""
echo "=== SKILL.md read-instruction guard — classifier self-test (out4-skill-read-guard.sh --selftest) ==="
if bash "$DIR/../out4-skill-read-guard.sh" --selftest; then
  printf 'PASS: %s\n' "skill-read guard self-test (violation flagged, prose passes)"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "skill-read guard self-test"
  fail=$((fail + 1))
fi

echo ""
echo "=== SKILL.md read-instruction guard — real-tree scan (out4-skill-read-guard.sh) ==="
if bash "$DIR/../out4-skill-read-guard.sh"; then
  printf 'PASS: %s\n' "skill-read guard real-tree scan"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "skill-read guard real-tree scan"
  fail=$((fail + 1))
fi

# --- WF-370 (C023 OUT-8): the glossary lints are NOT gated here any more -------
# This chain used to carry two glossary blocks: `glossary-lint.sh --selftest`
# (WF-341) and `glossary-on-touch.sh --selftest` (WF-342). They were the last two
# of the five authoring-convention lint invocations C023 sheds from core; WF-369
# shed the other three. Both scripts and their `glossary-fixtures/` corpus now live
# at plugins/wf-core-authoring/capabilities/core-authoring/fixtures/, gated by that
# pack's own `fixtures/run.sh` — which CI discovers by convention, so nothing was
# added to the workflow for them.
#
# This chain is now purely CORE-STRUCTURAL, which is the point: core must validate
# its own structure with ZERO PACKS PRESENT. Reaching across into a pack from here
# would break that, so the blocks were SHED rather than re-pointed.
#
# `GLOSSARY.md` itself did not move — it stays at ../GLOSSARY.md, because
# `wf-author-caps` is end-user-installable and consumes it there. What moved is the
# LINTS, not the vocabulary.

# --- WF-304 / WF-305 / WF-306 / WF-307 / WF-308: OUT-2 content-read acceptance --
# (the COMPOSITE gate — all five content classes)
# C011 OUT-2: no skill/agent raw-reads a bundled content-class doc — every body
# comes from the resolver `resolve_content` surface, with no carve-out. The
# terminal slice SUB-7 (WF-308) consolidated this script into the composite gate:
# the fragment (SUB-3, WF-304), shared (SUB-4, WF-305), contract-ops (SUB-5,
# WF-306), references (SUB-6, WF-307), and profile (SUB-7, WF-308) clauses now each
# scan the whole marketplace — every plugin's `skills/` + `agents/` under
# `plugins/**` (core wf PLUS every pack), not just the core spine. It proves zero
# raw reads survive in any of the five classes. Wired here so the CI entry point
# covers the full composite gate.
echo ""
echo "=== Content-read OUT-2 acceptance — composite gate, all five classes over plugins/** (content-read-out2-grep.sh) ==="
if bash "$DIR/../content-read-out2-grep.sh"; then
  printf 'PASS: %s\n' "OUT-2 composite content-read grep (fragment + shared + contract-ops + references + profile)"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "OUT-2 composite content-read grep (fragment + shared + contract-ops + references + profile)"
  fail=$((fail + 1))
fi

# --- WF-399: fixed core-dispatch routing adoption -----------------------------
echo ""
echo "=== Core dispatch routing guard — seeded self-test ==="
if bash "$DIR/../core-dispatch-routing-guard.sh" --selftest; then
  printf 'PASS: %s\n' "core dispatch routing guard self-test"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "core dispatch routing guard self-test"
  fail=$((fail + 1))
fi

echo ""
echo "=== Core dispatch routing guard — real-tree scan ==="
if bash "$DIR/../core-dispatch-routing-guard.sh"; then
  printf 'PASS: %s\n' "core dispatch routing guard real-tree scan"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "core dispatch routing guard real-tree scan"
  fail=$((fail + 1))
fi

# --- WF-400: capability-dispatch routing adoption ------------------------------
echo ""
echo "=== Capability dispatch routing guard — seeded self-test ==="
if bash "$DIR/../capability-dispatch-routing-guard.sh" --selftest; then
  printf 'PASS: %s\n' "capability dispatch routing guard self-test"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "capability dispatch routing guard self-test"
  fail=$((fail + 1))
fi

echo ""
echo "=== Capability dispatch routing guard — real-tree scan ==="
if bash "$DIR/../capability-dispatch-routing-guard.sh"; then
  printf 'PASS: %s\n' "capability dispatch routing guard real-tree scan"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "capability dispatch routing guard real-tree scan"
  fail=$((fail + 1))
fi

# --- WF-374: gated lens dispatch and contract inlining --------------------------
echo ""
echo "=== Verify dispatch cost guard — caller gate and contract inlining ==="
if bash "$DIR/../verify-dispatch-cost-guard.sh"; then
  printf 'PASS: %s\n' "verify dispatch skips gated lenses and agents do not refetch the contract"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "verify dispatch cost guard"
  fail=$((fail + 1))
fi

# --- WF-485 (C029 OUT-4): core lean adversarial default -------------------------
# Core `verify` must report adversarial defects with NO capability registered
# (Core Article 8: a lean default that runs inert and names no capability). The
# empty-registry fixture is purpose-built — this repo's own registry carries eight
# capabilities and cannot measure what core alone does. The guard asserts the pass
# exists, stays closed at two classes, cites two-sidedly, reports without gating,
# and adds no dispatch (so verify-dispatch-cost-guard.sh's invariants are untouched).
echo ""
echo "=== Core lean adversarial default guard — pass, fixtures, cost shape ==="
if bash "$DIR/../adversarial-default-guard.sh"; then
  printf 'PASS: %s\n' "core verify carries a non-gating, dispatch-free adversarial default with its three fixtures"
  pass=$((pass + 1))
else
  printf 'FAIL: %s\n' "core lean adversarial default guard"
  fail=$((fail + 1))
fi

echo ""
printf 'Results: %s passed, %s failed.\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
