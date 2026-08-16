#!/usr/bin/env bash
# skill-targets.sh — the ONE target-set definition the craft-C4 checks share.
#
# Sourced (never executed) by check-skill-name.sh, check-skill-description.sh and
# check-skill-body-length.sh so all three agree, by construction, on two things:
# what a "real skill body" is, and which files are structurally off the surface.
#
# --- The target set ---
# Every `SKILL.md` beneath `<root>/plugins/`, minus the structural exclusions
# below. `SKILL.md` only: an `agents/*.md` subagent carries frontmatter too, but
# the craft-C4 rules this pack gates are stated for skill bodies, so widening the
# set to agents is a deliberate future change, not an accident of globbing.
#
# --- The structural exclusions (BY SHAPE, NEVER BY A PINNED PATH) ---
#   E1. any path with a directory segment whose name ends in `-fixtures`
#   E2. any path with an adjacent `test/fixtures` segment pair
#
# Today E1 catches this folder's own glossary-fixtures/, slot-marker-fixtures/ and
# ops-docs-fixtures/, plus the core plugins/wf/skills/_contracts/*-fixtures/ that
# have not moved; E2 catches plugins/wf/mcp/test/fixtures/** (the four
# `wf-fixture` reference-resolution skills). Every one of those deliberately
# carries malformed, clause-free, or violating-shaped content, so scanning them
# would turn a fixture into a false failure.
#
# Since WF-370, `craft_is_excluded` is shared beyond the craft-C4 checks: both
# glossary lints call it as THEIR structural exclusion too, replacing a path-pinned
# arm that went stale the moment the corpora moved here. That widens the blast
# radius of a "simplification" — re-pinning either glob now silently puts seeded
# violating fixtures onto a live PR gate.
#
# THE SHAPE IS THE POINT. Pinning either rule to `plugins/wf/skills/_contracts/`
# would go stale the moment those folders are relocated under this pack's own
# `fixtures/` directory — the shape-based rule keeps them excluded wherever they
# land, which is what lets this check-set and those relocations merge in either
# order. Do not "simplify" these two globs into a path prefix.
#
# E1 also covers this pack's own seeded-violation fixtures, which live in
# `craft-fixtures/` precisely so they are excluded by the very rule under test.
# Note that a plain `fixtures/` segment (no hyphen) is NOT excluded — only a
# `<something>-fixtures/` segment is — so this file's own directory stays a
# normal path.
#
# --- Deference ---
# These checks assert repository authoring craft (CLAUDE.md §5). They do not
# re-derive any rule owned by the WF-352 typed validators
# (`validate_skill_interface`, `validate_manifest`, `validate_registry`), which
# remain the authority wherever the surfaces touch. A bash script cannot invoke
# an MCP tool, so the obligation here is NON-DIVERGENCE, not invocation: if a
# rule below ever contradicts one of those validators, the validator wins and
# this script is the thing that changes.
#
# Model: claude-opus-5[1m]

# craft_repo_root — absolute repo root, derived from this file's own location.
craft_repo_root() {
  ( cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd )
}

# craft_is_excluded <path> — 0 when the path is structurally off the target set.
craft_is_excluded() {
  case "/$1/" in
    */test/fixtures/*) return 0 ;;   # E2
    *-fixtures/*)      return 0 ;;   # E1
  esac
  return 1
}

# craft_skill_targets <root> — print one target SKILL.md path per line.
craft_skill_targets() {
  local root="${1:-$(craft_repo_root)}" path
  [ -d "$root/plugins" ] || return 0
  while IFS= read -r path; do
    craft_is_excluded "$path" || printf '%s\n' "$path"
  done < <(find "$root/plugins" -type f -name SKILL.md | LC_ALL=C sort)
}

# craft_frontmatter_value <file> <key> — print the value of a frontmatter key,
# reading ONLY the YAML block between the first `---` pair. Scoping matters: a
# whole-file grep for a description clause matches prose in every body, so a
# body-wide read would make the description checks vacuously green.
craft_frontmatter_value() {
  awk -v key="$2" '
    NR == 1 && $0 ~ /^---[[:space:]]*$/ { infm = 1; next }
    infm && $0 ~ /^---[[:space:]]*$/    { exit }
    infm && index($0, key ":") == 1 {
      v = substr($0, length(key) + 2)
      sub(/^[[:space:]]+/, "", v)
      sub(/[[:space:]]+$/, "", v)
      print v
      exit
    }
  ' "$1"
}

# craft_require_nonempty <count> <check-name> — a check whose target set came out
# empty has proven nothing, so it fails LOUDLY rather than passing vacuously.
craft_require_nonempty() {
  if [ "$1" -eq 0 ]; then
    printf 'FAIL: %s scanned 0 skill bodies — the target set resolved empty.\n' "$2" >&2
    printf '      A check that inspects nothing cannot pass. Verify the repo root and the exclusion globs in skill-targets.sh.\n' >&2
    return 1
  fi
  return 0
}
