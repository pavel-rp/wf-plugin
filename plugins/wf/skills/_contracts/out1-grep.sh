#!/usr/bin/env bash
# OUT-1 acceptance check (WF-137, charter C001 / WF-119).
#
# Core (`plugins/wf/`) must carry ZERO concrete tracker/VCS knowledge. This is the
# committed, reviewable grep expression that proves it: it scans the SDD-spine
# skill and agent BODIES for git/gh command + plumbing strings (command strings
# AND plumbing invocations like `git rev-parse` — no plumbing exemption,
# Assumption #6) and for ADO / Azure-DevOps / `AB#` terms. Zero hits = pass.
#
# --- Scope (path) ---
# Scanned:  plugins/wf/skills/<name>/**.md (SKILL.md + references) and
#           plugins/wf/agents/*.md — the domain-free SDD spine's prose.
# NOT scanned (path-scoped out, not a content exclusion):
#   plugins/wf/skills/_contracts/ — the frozen contract layer, its
#   registry-fixtures, the registry validator, and this script. The contracts
#   name the abstract operations and describe the no-git rule itself; the
#   fixtures use `ado`/`git`/`linear` as example capability NAMES (test
#   infrastructure), never core-embedded behavior.
#
# --- The single content exclusion ---
# The abstract contract vocabulary: the delivery/tracker operation names
# (branch-create, commit, push-upstream, pr-create, current-branch-query,
# workspace-root-resolve, last-commit-timestamp-query) and the surface/phase
# nouns (delivery, tracker, branch, commit, deliver, workspace root) used as
# abstract nouns. These are the intended vocabulary — the command-form patterns
# below are written to match a git/gh *command*, so they never match the bare
# nouns; the exclusion is named here for the reviewer, not carved out ad hoc.
# (Benign non-command substrings the command patterns also do not match, by the
# same design: the `wf-git` pack name, init's `.gitignore` / `.git/info/exclude`
# file management, and factual asides like "git history preserves prior versions".)
#
# Exit 0 = clean; exit 1 = residue found.
set -u

root="$(cd "$(dirname "$0")/../.." && pwd)"   # -> plugins/wf
files=$(find "$root/skills" "$root/agents" -name '*.md' -not -path '*/_contracts/*')

git_cmd='\bgit (rev-parse|branch|checkout|status|remote|fetch|push|commit|diff|log|show|config|add|clone|merge|rebase|reset|stash|init|pull|worktree|cherry-pick|tag|switch|restore)\b'
gh_cmd='\bgh (pr|repo|api|auth|issue|browse|run)\b'
ado='(Azure DevOps|AB#|\bADO\b|\bado-id\b)'

hits=$(grep -rEn "$git_cmd|$gh_cmd|$ado" $files || true)

if [ -n "$hits" ]; then
  echo "OUT-1: FAIL — residual git/gh command or ADO strings in the wf spine bodies:"
  echo "$hits"
  exit 1
fi

echo "OUT-1: PASS — zero git/gh command/plumbing strings and zero ADO terms in the wf spine bodies."
