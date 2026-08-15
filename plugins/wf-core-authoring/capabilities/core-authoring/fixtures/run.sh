#!/usr/bin/env bash
# run.sh — the core-authoring capability's fixture suite.
#
# CI discovers this file BY CONVENTION — `.github/workflows/ci.yml` globs
# `plugins/*/capabilities/*/fixtures/run.sh`, runs each with `bash`, and fails the
# job on any non-zero exit. Nothing names this capability anywhere in the workflow,
# so ADDING A CHECK HERE REQUIRES NO WORKFLOW EDIT — and neither did adding this
# runner itself.
#
# --- HOW TO ADD A CHECK (this is the extension point) ---
# 1. Drop `check-<thing>.sh` next to this file. Give it two modes: `--selftest`
#    (drives seeded fixtures under `craft-fixtures/<thing>/`) and a default mode
#    that scans the live tree, each exiting non-zero on a violation.
# 2. Source `skill-targets.sh` for the target set rather than re-deriving it — the
#    structural fixture exclusions live there once, for every check.
# 3. Add its basename to the CHECKS list below. That is the whole registration.
#
# The list is ordered and open. WF-368 (SUB-8) and WF-369 (SUB-9) are the next
# contributors: they migrate further craft checks into this same folder and append
# their basenames here.
#
# --- WHY EVERY CHECK RUNS ITS SELFTEST FIRST ---
# A lint that scans a real tree and finds nothing is indistinguishable from a lint
# that is broken. Each check's `--selftest` drives committed seeded fixtures that
# plant each violation it claims to catch, so a green live-tree run means "the tree
# is clean" rather than "the check does nothing". The selftest runs BEFORE the live
# scan for exactly that reason: an unproven check's green is not evidence.
#
# --- DEFERENCE ---
# These are shell checks over authored files. Where a surface is also covered by
# the typed resolver validators (`validate_skill_interface`, `validate_manifest`,
# `validate_registry`), those are the authority; a check here must not contradict
# one. See the header of `skill-targets.sh`.
#
# Usage:  bash run.sh              # selftests, then the live tree (what CI runs)
#         bash run.sh --selftest   # selftests only
#
# Exit 0 = every check clean; exit 1 = at least one check failed.
#
# Model: claude-opus-5[1m]
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITE="core-authoring fixtures"

# The ordered, open check list. One basename per line; append to extend.
CHECKS="
check-skill-name.sh
check-skill-description.sh
check-skill-body-length.sh
"

fail=0

err() { printf '%s\n' "$*" >&2; }

run_one() {
  local name="$1"; shift
  local script="$DIR/$name"
  if [ ! -f "$script" ]; then
    err "FAIL: $name is listed in run.sh's CHECKS but does not exist at $script."
    fail=$((fail + 1))
    return
  fi
  if ! bash "$script" "$@"; then
    fail=$((fail + 1))
  fi
}

# --- Shape guard: the exclusions must stay SHAPE-based, never path-pinned -------
# Every check shares one target set, and the fixture exclusions in it are stated as
# shapes: any directory segment ending in `-fixtures`, and any adjacent `test/fixtures`
# pair — WHEREVER THEY SIT. That matters because the seeded fixtures will move: SUB-8
# and SUB-9 relocate checks into this folder, and a path-pinned exclusion would
# silently start scanning the planted violations (turning every check red) or, worse,
# silently stop excluding a folder that moved (turning them vacuously green).
#
# So assert the shape directly, from three unrelated parent paths plus the negative
# case. If someone "simplifies" the globs into a prefix, this fails before the checks
# even run.
# shellcheck source=./skill-targets.sh
. "$DIR/skill-targets.sh"

shape_guard() {
  local path="$1" expect="$2" label="$3"
  if craft_is_excluded "$path"; then local got=excluded; else local got=included; fi
  if [ "$got" != "$expect" ]; then
    err "FAIL: shape guard — '$path' is $got, expected $expect ($label)."
    fail=$((fail + 1))
  fi
}

echo "=== $SUITE: exclusion shape guard ==="
shape_guard "plugins/anything/deep/down/craft-fixtures/x/SKILL.md"   excluded "E1 applies at any depth, under any parent"
shape_guard "plugins/other/slot-marker-fixtures/y/SKILL.md"          excluded "E1 is about the -fixtures suffix, not a specific folder name"
shape_guard "some/unrelated/root/registry-fixtures/z/SKILL.md"       excluded "E1 holds outside plugins/ too — the rule is the shape"
shape_guard "plugins/wf/mcp/test/fixtures/a/SKILL.md"                excluded "E2 adjacent test/fixtures pair"
shape_guard "any/where/test/fixtures/b/SKILL.md"                     excluded "E2 is likewise unpinned"
shape_guard "plugins/wf/skills/spec/SKILL.md"                        included "a real skill body is never excluded"
shape_guard "plugins/wf-core-authoring/capabilities/x/fixtures/SKILL.md" included "a plain fixtures/ segment is NOT the shape — only *-fixtures/ and test/fixtures"
if [ "$fail" -eq 0 ]; then echo "shape guard: PASS — exclusions are shape-based, not path-pinned."; fi
echo

echo "=== $SUITE: selftests (each check drives its seeded fixtures) ==="
for c in $CHECKS; do
  run_one "$c" --selftest
done

if [ "${1:-}" != "--selftest" ]; then
  echo
  echo "=== $SUITE: live tree ==="
  for c in $CHECKS; do
    run_one "$c"
  done
fi

echo
if [ "$fail" -ne 0 ]; then
  err "$SUITE: FAIL — $fail check(s) failed."
  exit 1
fi
echo "$SUITE: PASS"
