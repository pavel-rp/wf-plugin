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
# are untouched. The export writes nothing beside <dest> (WF-883) and creates no missing parent of
# it (WF-933), and a leftover an interrupted
# run left there is cleared before a pull request with no candidates (WF-884) — the procedure's
# Step 0 clear must precede its Step 1, asserted by order, not presence (WF-934). It then shows an
# unresolvable merge commit fails the recipe — the case the sweep must report as `merged ref could
# not be resolved`, never as an empty result.
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
    'mkdir "<dest>"' \
    'git archive --format=tar --output="<dest>/<merge-commit>.tar" "<merge-commit>"' \
    'tar -xf "<dest>/<merge-commit>.tar" -C "<dest>"' \
    'rm -f "<dest>/<merge-commit>.tar"' \
    '`not-merged`' '`read-failed`'; do
    printf '%s\n' "$section" | grep -qF -- "$token" \
      || bad "recipe parity: the wf-git merged-ref-read section no longer names: $token"
  done
  [ "$fail" = "$before" ] && pass "recipe parity: the commands executed here are the ones the wf-git op names"
  # WF-883: the op's write scope is <dest> alone — no staging archive beside it.
  printf '%s\n' "$section" | grep -qF -- '"<dest>.tar"' \
    && bad "containment: the wf-git merged-ref-read section still stages an archive beside <dest>" \
    || pass "containment: the wf-git merged-ref-read section stages nothing beside <dest>"
  # WF-933: <dest> is created alone — never with -p, which would create missing parents outside it.
  printf '%s\n' "$section" | grep -qF -- 'mkdir -p "<dest>"' \
    && bad "containment: the wf-git merged-ref-read section still creates <dest> with mkdir -p" \
    || pass "containment: the wf-git merged-ref-read section creates <dest> alone, never a missing parent"
fi

if [ -f "$FRAGMENT" ]; then
  before=$fail
  for token in 'merged-ref-read' '_local/scratch/wf-sweep-merged-ref' \
               'merged ref could not be resolved' 'Never fall back' 'at the merged ref' \
               "## Step 0 — Clear an earlier interrupted run's export"; do
    grep -qF -- "$token" "$FRAGMENT" \
      || bad "procedure parity: the sweep procedure no longer names: $token"
  done
  [ "$fail" = "$before" ] && pass "procedure parity: the sweep resolves the merged ref, exports to the fixed path, and states the unresolvable reason"
else
  bad "the sweep procedure is missing: ${FRAGMENT#"$ROOT"/}"
fi

# WF-934: zero-candidate cleanup depends on Step 0 running before Step 1, so heading presence is
# not enough — Step 0's heading must come first. step_order_ok succeeds only when both headings
# exist and Step 0's first line precedes Step 1's; a missing heading is a rejection, never a pass.
step_order_ok() {
  awk -v s0="## Step 0 — Clear an earlier interrupted run's export" '
    index($0, s0) == 1 && !a { a = NR }
    /^## Step 1 — / && !b { b = NR }
    END { exit !(a && b && a < b) }' "$1" 2>/dev/null
}
if [ -f "$FRAGMENT" ]; then
  step_order_ok "$FRAGMENT" \
    && pass "procedure order: the sweep's Step 0 clear precedes its Step 1 identity probe" \
    || bad "procedure order: the sweep's Step 0 heading is missing or no longer precedes Step 1"
fi
# Seeded self-test: the ordering check accepts the right order and rejects the reversed order and
# a missing Step 0, so a check that always passed could not hide behind the real fragment.
seed="$(mktemp)" || { bad "cannot create a seed file"; exit 1; }
s0_line="## Step 0 — Clear an earlier interrupted run's export (every pull request, unconditionally)"
s1_line="## Step 1 — Reach the pull request (branch first, recorded reference second)"
before=$fail
printf '%s\nbody\n%s\nbody\n' "$s0_line" "$s1_line" > "$seed"
step_order_ok "$seed" || bad "self-test: the ordering check rejected Step 0 before Step 1"
printf '%s\nbody\n%s\nbody\n' "$s1_line" "$s0_line" > "$seed"
step_order_ok "$seed" && bad "self-test: the ordering check accepted Step 1 before Step 0"
printf '%s\nbody\n' "$s1_line" > "$seed"
step_order_ok "$seed" && bad "self-test: the ordering check accepted a procedure with no Step 0"
rm -f "$seed"
[ "$fail" = "$before" ] \
  && pass "self-test: the ordering check accepts Step 0 first and rejects the reversed or missing order"

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
archive="$dest/$merge_commit.tar"
mkdir "$dest" \
  && g archive --format=tar --output="$archive" "$merge_commit" \
  && tar -xf "$archive" -C "$dest" \
  || bad "step 4: the export failed"
rm -f "$archive"
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
[ ! -e "$archive" ] \
  && pass "the intermediate archive is removed" \
  || bad "the intermediate archive was left behind"
# Permitted write destinations (WF-883): the scratch directory holds the export and nothing else.
outside="$(ls -A "$tmp/scratch")"
[ "$outside" = "wf-sweep-merged-ref" ] \
  && pass "the export wrote only inside <dest> — nothing beside it in the scratch directory" \
  || bad "the export wrote outside <dest>: $(printf '%s' "$outside" | tr '\n' ' ')"

rm -rf "$dest"
[ ! -e "$dest" ] && pass "the fixed export path is removable regardless of outcome" \
  || bad "the export could not be removed"

# --- 3b. An interrupted export, then a pull request with no candidates (WF-884) ------------
# Simulate an interruption mid-export: the tree and its staging archive are left at <dest>.
# The next sweep's pull request has zero candidates, so it never reaches the merged-ref read;
# the procedure's Step 0 clear still runs first, over the fixed literal path.
mkdir -p "$dest/src" && printf 'stale\n' > "$dest/src/widget.txt" && : > "$dest/$merge_commit.tar"
candidates=0
[ -d "$tmp/scratch" ] && [ ! -L "$tmp/scratch" ] && rm -rf "$tmp/scratch/wf-sweep-merged-ref"
[ "$candidates" -eq 0 ] && [ ! -e "$dest" ] && [ -z "$(ls -A "$tmp/scratch")" ] \
  && pass "an interrupted run's leftover is cleared before a zero-candidate pull request, archive included" \
  || bad "a leftover export survived a zero-candidate pull request"

# --- 3c. A <dest> under a missing parent fails without creating anything (WF-933) ----------
# The recipe's single-directory mkdir refuses a missing parent, so nothing outside <dest> is made
# and there is nothing for the op to remove.
orphan_parent="$tmp/absent-parent"
orphan_dest="$orphan_parent/wf-sweep-merged-ref"
if mkdir "$orphan_dest" 2>/dev/null; then
  bad "mkdir created <dest> under a missing parent — the op would write outside <dest>"
else
  [ ! -e "$orphan_parent" ] && [ ! -e "$orphan_dest" ] \
    && pass "a <dest> under a missing parent fails read-failed and creates no directory outside <dest>" \
    || bad "a failed mkdir left a directory behind"
fi

# --- 4. An unresolvable merged ref fails the recipe, typed --------------------------------

bogus="0000000000000000000000000000000000000bad"
if g cat-file -e "$bogus^{commit}" 2>/dev/null; then
  bad "an unknown commit reads as present"
elif g fetch --quiet origin "$bogus" 2>/dev/null; then
  bad "fetching an unknown commit succeeded"
else
  pass "an unresolvable merge commit is neither present nor fetchable — the op returns read-failed"
fi
mkdir "$dest"
if g archive --format=tar --output="$dest/$bogus.tar" "$bogus" 2>/dev/null; then
  bad "exporting an unresolvable commit succeeded"
else
  rm -f "$dest/$bogus.tar"
  rm -rf "$dest"
  [ ! -e "$dest" ] && [ -z "$(ls -A "$tmp/scratch")" ] \
    && pass "a failed export leaves no tree behind, so nothing is opened and the checkout is never used instead" \
    || bad "a failed export left a tree behind"
fi

if [ "$fail" -ne 0 ]; then
  printf '\nmerged-ref-contrast: FAIL\n'
  exit 1
fi
printf '\nmerged-ref-contrast: PASS — a stale checkout and the merged ref disagree, and the sweep reads the merged ref.\n'
