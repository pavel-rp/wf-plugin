#!/usr/bin/env bash
#
# merged-ref-contrast.sh — behavioural evidence for WF-838: the post-merge sweep verifies
# at the merged ref, never at a stale local checkout.
#
# The sweep guard (closeout-sweep-guard.sh) is a static check over prose. This test runs
# something: it builds a throwaway repository whose checkout is STALE (it predates the merge),
# executes the wf-git `merged-ref-read` export recipe at the merge commit, and contrasts the
# two trees. A defect the pull request fixed is still visible in the stale checkout and gone at
# the merged ref; a file the pull request added opens only at the merged ref; a symlink survives
# the export so the sweep's symlink bound still sees it; and the caller's checkout, index and HEAD
# are untouched. It then shows an unresolvable merge commit fails the recipe — the case the sweep
# must report as `merged ref could not be resolved`, never as an empty result.
#
# Recipe parity is asserted first: the commands executed below are the ones the wf-git op
# section names, and the sweep procedure names the op, the fixed export path and the explicit
# unresolvable reason. A recipe that drifted from the op would otherwise test something no
# provider runs.
#
# Hermetic: a temp repository, no remote, no network, no host tool. Removed on exit.
#
# Model: claude-opus-5-5
#
# Usage:
#   bash plugins/wf-review/capabilities/pr-review/fixtures/merged-ref-contrast.sh

set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../../.." && pwd)"
OPS="$ROOT/plugins/wf-git/capabilities/git/fragments/delivery.ops.md"
FRAGMENT="$ROOT/plugins/wf-review/capabilities/pr-review/fragments/closeout-review.md"

fail=0
pass() { printf 'PASS: %s\n' "$1"; }
bad()  { printf 'FAIL: %s\n' "$1"; fail=1; }

# --- 0. Recipe parity -----------------------------------------------------------------------

section="$(awk '$0 ~ "^## merged-ref-read( |$)" {f=1; next} f && /^## / {exit} f {print}' "$OPS" 2>/dev/null)"
if [ -z "$section" ]; then
  bad "the wf-git ops fragment has no merged-ref-read section — nothing to test against"
else
  before=$fail
  for token in \
    'git cat-file -e "<merge-commit>^{commit}"' \
    'git rev-parse --verify "<merge-commit>^{tree}"' \
    'git archive --format=tar --output="<dest>.tar" "<merge-commit>"' \
    'tar -xf "<dest>.tar" -C "<dest>"' \
    'rm -f "<dest>.tar"' \
    '`not-merged`' '`read-failed`'; do
    printf '%s\n' "$section" | grep -qF -- "$token" \
      || bad "recipe parity: the wf-git merged-ref-read section no longer names: $token"
  done
  [ "$fail" = "$before" ] && pass "recipe parity: the commands executed here are the ones the wf-git op names"
fi

if [ -f "$FRAGMENT" ]; then
  before=$fail
  for token in 'merged-ref-read' '_local/scratch/wf-sweep-merged-ref' \
               'merged ref could not be resolved' 'Never fall back' 'at the merged ref'; do
    grep -qF -- "$token" "$FRAGMENT" \
      || bad "procedure parity: the sweep procedure no longer names: $token"
  done
  [ "$fail" = "$before" ] && pass "procedure parity: the sweep resolves the merged ref, exports to the fixed path, and states the unresolvable reason"
else
  bad "the sweep procedure is missing: ${FRAGMENT#"$ROOT"/}"
fi

# --- 1. A repository whose checkout is stale ------------------------------------------------

tmp="$(mktemp -d)" || { bad "cannot create a temp dir"; exit 1; }
trap 'rm -rf "$tmp"' EXIT
repo="$tmp/repo"
g() { git -C "$repo" -c user.name=fixture -c user.email=fixture@example.invalid -c commit.gpgsign=false "$@"; }

mkdir -p "$repo/src"
git init -q "$repo" || { bad "git init failed"; exit 1; }
printf 'total = a - b\n' > "$repo/src/widget.txt"
g add -A && g commit -q -m "base: the defect a reviewer flagged" || { bad "base commit failed"; exit 1; }
stale="$(g rev-parse HEAD)"

printf 'total = a + b\n' > "$repo/src/widget.txt"
printf 'added by the pull request\n' > "$repo/src/added.txt"
ln -s widget.txt "$repo/src/link.txt"
g add -A && g commit -q -m "merge: the pull request fixes the defect" || { bad "merge commit failed"; exit 1; }
merge_commit="$(g rev-parse HEAD)"

# The caller's checkout predates the merge — the orchestrator's ordinary state.
g checkout -q --detach "$stale" || { bad "could not check out the stale commit"; exit 1; }
head_before="$(g rev-parse HEAD)"
status_before="$(g status --porcelain)"

# --- 2. Run the merged-ref-read recipe (op steps 2-4) at the merge commit -------------------

dest="$tmp/scratch/wf-sweep-merged-ref"
mkdir -p "$tmp/scratch"
if ! g cat-file -e "$merge_commit^{commit}"; then
  bad "step 2: the merge commit is not readable locally"
fi
tree="$(g rev-parse --verify "$merge_commit^{tree}" 2>/dev/null)" \
  || bad "step 3: the merge commit's tree does not resolve"
[ -e "$dest" ] && bad "step 4: the destination exists before the export (the op refuses that as read-failed)"
g archive --format=tar --output="$dest.tar" "$merge_commit" \
  && mkdir -p "$dest" \
  && tar -xf "$dest.tar" -C "$dest" \
  || bad "step 4: the export failed"
rm -f "$dest.tar"
[ -n "${tree:-}" ] && pass "the merged ref resolves: commit ${merge_commit:0:12}, tree ${tree:0:12}"

# --- 3. The contrast ------------------------------------------------------------------------

grep -qF 'total = a - b' "$repo/src/widget.txt" \
  && pass "the stale checkout still shows the defect the pull request fixed" \
  || bad "the stale checkout does not show the defect — the contrast is not established"
grep -qF 'total = a + b' "$dest/src/widget.txt" \
  && ! grep -qF 'total = a - b' "$dest/src/widget.txt" \
  && pass "the merged ref shows the fix: verifying there disposes the finding moot, not issue filed" \
  || bad "the merged ref does not show the fix"
[ ! -e "$repo/src/added.txt" ] && [ -f "$dest/src/added.txt" ] \
  && pass "a file the pull request added opens at the merged ref and not in the stale checkout" \
  || bad "the added file does not contrast between the checkout and the merged ref"
[ -L "$dest/src/link.txt" ] \
  && pass "a symlink survives the export, so the sweep's symlink bound still sees it" \
  || bad "the export resolved or dropped a symlink — the symlink bound would be blind to it"
[ "$(g rev-parse HEAD)" = "$head_before" ] && [ "$(g status --porcelain)" = "$status_before" ] \
  && pass "the caller's HEAD, index and working tree are untouched by the export" \
  || bad "the export changed the caller's checkout"
[ ! -e "$dest.tar" ] \
  && pass "the intermediate archive is removed" \
  || bad "the intermediate archive was left behind"

rm -rf "$dest"
[ ! -e "$dest" ] && pass "the fixed export path is removable regardless of outcome" \
  || bad "the export could not be removed"

# --- 4. An unresolvable merged ref fails the recipe, typed --------------------------------

bogus="0000000000000000000000000000000000000bad"
if g cat-file -e "$bogus^{commit}" 2>/dev/null; then
  bad "an unknown commit reads as present"
elif g fetch --quiet origin "$bogus" 2>/dev/null; then
  bad "fetching an unknown commit succeeded"
else
  pass "an unresolvable merge commit is neither present nor fetchable — the op returns read-failed"
fi
if g archive --format=tar --output="$dest.tar" "$bogus" 2>/dev/null; then
  bad "exporting an unresolvable commit succeeded"
else
  rm -f "$dest.tar"
  [ ! -e "$dest" ] \
    && pass "a failed export leaves no tree behind, so nothing is opened and the checkout is never used instead" \
    || bad "a failed export left a tree behind"
fi

if [ "$fail" -ne 0 ]; then
  printf '\nmerged-ref-contrast: FAIL\n'
  exit 1
fi
printf '\nmerged-ref-contrast: PASS — a stale checkout and the merged ref disagree, and the sweep reads the merged ref.\n'
