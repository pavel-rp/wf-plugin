#!/usr/bin/env bash
# OUT-4 regression guard (WF-291, charter C010 / WF-289).
#
# WF-290 rewrote every subagent to LOAD a sibling skill by INVOKING it through
# the Skill tool, instead of filesystem-Reading its `SKILL.md` body at a
# version-pinned path (which tripped the workspace-boundary permission prompt on
# every out-of-tree marketplace install). This guard LOCKS THAT IN: it fails any
# future PR that reintroduces a `skills/.*SKILL.md` read/glob INSTRUCTION into an
# agent file or a skill body — the exact defect WF-290 removed.
#
# --- Instruction vs prose (the whole point) ---
# A raw `skills/.*SKILL.md` grep is NOT the guard: ~two dozen legitimate PROSE
# references cite a skill path without instructing a read (e.g.
# `plugins/wf/agents/pr.md`'s "mirroring `.../skills/spec/SKILL.md`'s own
# resolution", the wf-ado tracker fragment's "the same call shape
# `.../skills/spec/SKILL.md` Phase 0 step 1 uses", the pack READMEs' skill
# tables, and the post-WF-290 agent prose "the harness loads the skill's
# `SKILL.md` by invocation (not a filesystem read)"). Those must all PASS. This
# guard is an instruction classifier: it flags only a read/glob VERB governing a
# `SKILL.md` PATH, or the version-pinned `${CLAUDE_PLUGIN_ROOT}/skills/…/SKILL.md`
# load token itself.
#
# --- The two flagged shapes ---
#   P1  A read/glob/grep/search/cat/open/view verb (case-insensitive,
#       word-bounded) followed on the SAME line by a filesystem PATH ending in
#       `SKILL.md` — i.e. a `<non-space>/SKILL.md` token (the slash before
#       SKILL.md is what a bare prose "SKILL.md" mention lacks). Matches
#       "Read the … (`${CLAUDE_PLUGIN_ROOT}/skills/<x>/SKILL.md`)",
#       "Glob …/skills/spec/SKILL.md", a `Search(**/skills/…/SKILL.md)` fallback.
#   P2  The version-pinned runtime load token `${CLAUDE_PLUGIN_ROOT}/skills/…/SKILL.md`
#       standing alone — a filesystem load step even without an explicit verb.
#
# --- Why the classifier does not false-positive on live prose ---
# The verb set deliberately EXCLUDES "load(s)"/"loading" and relies on word
# boundaries, so:
#   * `agents/classify/references/rubric.md`'s "a spawn no longer eagerly LOADS
#     the full caller-facing `skills/classify/SKILL.md`" — verb "loads" is not in
#     the set → passes.
#   * the post-WF-290 agent lines "the harness loads the skill's `SKILL.md` by
#     invocation (not a filesystem read) … never fall back to Reading the skill
#     body" — the `SKILL.md` here is BARE (no `/` before it, so no `\S/SKILL.md`
#     path token), "loads" is not in the set, and "Reading" is not `\bread\b` →
#     pass.
#   * every prose path citation (`pr.md`, tracker/linear fragments, READMEs, the
#     `plan/SKILL.md` resolver-call mentions in implement/run/tasks) carries a
#     `\S/SKILL.md` path but NO read/glob verb on the line → pass.
#
# --- Scope (path) ---
# Scanned:  plugins/*/agents/*.md and plugins/*/skills/**/*.md (and every other
#           *.md under plugins/) — agent files and skill bodies across ALL packs.
# NOT scanned: plugins/*/**/_contracts/ (the frozen contract layer, THIS script,
#           and the skill-read-fixtures/ that hold the deliberate violations the
#           --selftest exercises). Excluding _contracts keeps the deliberately
#           violating fixture out of the real-tree scan so it never turns CI red.
#
# Requires GNU/PCRE grep (`grep -P`; present on the Linux CI runner and Git Bash).
# Exit 0 = clean; exit 1 = a read-instruction was found; exit 2 = grep/PCRE error
# (never a silent pass). With `--selftest`: scans the fixtures instead and asserts
# the classifier flags the violations and passes the clean prose — proving the
# guard actually runs and discriminates before it is trusted on the real tree.
#
# Wired into CI by registry-fixtures/run.sh (the established guard chain that
# .github/workflows/ci.yml invokes) — this guard is NOT auto-discovered.
#
# Model: claude-opus-4-8
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"   # -> repo root
FIXDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/skill-read-fixtures"

# P1: read/glob/grep/search/cat/open/view verb, then a `<non-space>/SKILL.md` path.
p1='(?i)\b(read|glob|grep|search|cat|open|view)\b.*\S/SKILL\.md'
# P2: the version-pinned runtime load token itself.
p2='\$\{CLAUDE_PLUGIN_ROOT\}/skills/\S*SKILL\.md'
PAT="$p1|$p2"

if [ "${1:-}" = "--selftest" ]; then
  # Prove the classifier discriminates: violation.md must be flagged, clean.md
  # must not — scanning the fixtures directly (it lives under _contracts, so the
  # real-tree run below never sees it).
  fails=0
  vio="$(grep -Pno "$PAT" "$FIXDIR/violation.md")"; vrc=$?
  cln="$(grep -Pno "$PAT" "$FIXDIR/clean.md")";     crc=$?
  if [ "$vrc" -ge 2 ] || [ "$crc" -ge 2 ]; then
    echo "OUT-4 selftest: ERROR — grep failed (requires PCRE grep -P)."
    exit 2
  fi
  # Every non-comment, non-blank line of violation.md is a planted violation.
  want="$(grep -cvE '^\s*(#|$)' "$FIXDIR/violation.md")"
  got="$(printf '%s' "$vio" | grep -c . || true)"
  if [ "$vrc" -ne 0 ] || [ "$got" -lt "$want" ]; then
    echo "OUT-4 selftest: FAIL — classifier missed a planted violation ($got/$want flagged):"
    echo "$vio"
    fails=$((fails + 1))
  fi
  if [ "$crc" -eq 0 ] && [ -n "$cln" ]; then
    echo "OUT-4 selftest: FAIL — classifier flagged legitimate prose in clean.md:"
    echo "$cln"
    fails=$((fails + 1))
  fi
  if [ "$fails" -ne 0 ]; then exit 1; fi
  echo "OUT-4 selftest: PASS — classifier flags all $want planted violations and no clean-prose references."
  exit 0
fi

# Default: scan the real tree. grep exits 1 on "no matches" (a clean pass) and
# >=2 only on an actual error (e.g. PCRE unavailable), so branch on RC>=2.
hits="$(grep -rPno --include='*.md' --exclude-dir='_contracts' "$PAT" "$ROOT/plugins")"
RC=$?
if [ "$RC" -ge 2 ]; then
  echo "OUT-4: ERROR — grep failed (rc=$RC). This check requires PCRE grep (grep -P), which may be unavailable on this platform."
  exit 2
fi
if [ -n "$hits" ]; then
  echo "OUT-4: FAIL — an agent/skill body reintroduced a SKILL.md read/glob instruction (invoke the skill via the Skill tool instead — see CLAUDE.md §8):"
  echo "$hits"
  exit 1
fi
echo "OUT-4: PASS — zero SKILL.md read/glob instructions in agent files and skill bodies."
