#!/usr/bin/env bash
# task-artifact-persistence-guard.sh — a run's task artifacts and index rows must
# outlive the disposable worktrees that produced them.
#
# A dispatched shipper builds its item's task folder inside its own worktree and
# the task root is untracked, so that folder is the only copy in existence: a
# worktree prune erases the run's whole process record. The orchestrator is the
# only actor that can close that gap, because a shipper is forbidden from falling
# back to the shared checkout and the resolver must not become a writer of
# agent-authored task artifacts.
#
# This is a BEHAVIOURAL assertion over the persistence step's decision graph, not
# a re-read of its wording: the evaluator derives the contract's capabilities and
# then simulates a four-item run — one readable worktree, one lost worktree, one
# failed write, and one that never had a worktree at all — asserting each item's
# recorded outcome, that a failure stays confined to its own item, and that the
# run reports an incomplete process record rather than letting an absent
# artifact set read as an item that never had one.
#
# It also asserts the two structural properties those outcomes depend on:
#
#   * the destination lies in the orchestrator's own workspace, so it survives a
#     prune — and the path the step actually WRITES is checked against the
#     declared one, so neither half can drift to a committed-lifecycle path
#     (which would require the resolver to be the writer) while the other stays
#     honest;
#   * `index.md` is never in the persistence write set and every row is reached
#     ONLY by invoking the index writer, ONCE PER ARTIFACT — that writer edits
#     exactly one row per call, so a single call for an N-artifact folder would
#     leave a record strictly worse than the one the worktree held;
#   * the shipper's own prohibition is asserted as a whole sentence INSIDE the
#     dispatch template, not anywhere in the document.
#
# --selftest runs the same evaluator over eighteen seeded synthetic contracts,
# including the exact pre-fix shape (no persistence step at all) and the mirror
# pair (a deleted failure clause AND a deleted success clause), and requires the
# evaluator to reject every defective one and accept the sound one. A lint that
# scans a clean tree and finds nothing is indistinguishable from a lint that
# does nothing; the selftest is what makes a green live-tree run mean something.
# Rejections are checked for the evaluator's own violation exit (1), never a
# harness error (2), so a broken fixture cannot masquerade as a caught defect.
#
# Usage:  bash task-artifact-persistence-guard.sh              # live-tree scan
#         bash task-artifact-persistence-guard.sh --selftest   # seeded fixtures
#
# Exit 0 = the contract is sound; exit 1 = at least one violation; exit 2 = the
# guard could not run.
#
# Model: claude-opus-5[1m]
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../../../.." && pwd)"
FLEET="$ROOT/plugins/wf/skills/fleet/SKILL.md"
EVAL="$DIR/task-artifact-persistence-eval.py"

err() { printf 'task-artifact-persistence-guard: %s\n' "$*" >&2; }

command -v python3 >/dev/null 2>&1 || {
  err "python3 is required"
  exit 2
}

[ -f "$EVAL" ] || { err "evaluator is absent: $EVAL"; exit 2; }

evaluate() { python3 "$EVAL" "$1"; }

if [ "${1:-}" = "--selftest" ]; then
  tmp="$(mktemp -d)" || { err "cannot create a temp dir"; exit 2; }
  trap 'rm -rf "$tmp"' EXIT

  if ! python3 "$EVAL" --emit-fixtures "$tmp"; then
    err "could not synthesize self-test fixtures"
    exit 2
  fi

  selftest_fail=0
  for name in no-persistence index-copied silent-failure silent-success \
              failure-contaminates committed-path step-writes-committed-path \
              shipper-writes unreported row-written-directly single-index-call \
              no-artifacts-as-failure unstaged-write delivery-outcome-only \
              no-denominator unmarked-attempt unbounded-write-scope; do
    evaluate "$tmp/$name.md" >/dev/null 2>&1
    rc=$?
    if [ "$rc" -ne 1 ]; then
      err "SELFTEST FAIL — seeded '$name' contract returned exit $rc; expected 1 (a violation, not a harness error or a pass)"
      selftest_fail=$((selftest_fail + 1))
    fi
  done

  if ! evaluate "$tmp/sound.md" >/dev/null 2>&1; then
    err "SELFTEST FAIL — the evaluator REJECTED the seeded sound contract"
    evaluate "$tmp/sound.md" >&2
    selftest_fail=$((selftest_fail + 1))
  fi

  if [ "$selftest_fail" -ne 0 ]; then
    err "self-test FAILED ($selftest_fail case(s))"
    exit 1
  fi
  echo "task-artifact-persistence-guard: self-test passed — seventeen seeded defects rejected (no persistence step, a copied index row, a silent failure, a silent success, a failure that stops the other items, a committed-lifecycle declaration, a committed-lifecycle write path behind an honest declaration, a relaxed shipper prohibition, an unreported outcome, a directly-written row, one index call for a whole folder, a never-had-a-worktree item counted as a failure, an unstaged write, capture on the delivery outcome alone, a tally with no terminal denominator, an unmarked in-flight attempt, and a destination untied from the write-scope boundary) and the sound contract accepted."
  exit 0
fi

# --- live-tree scan ---------------------------------------------------------

if [ ! -f "$FLEET" ]; then
  err "dispatch-brief file is absent: $FLEET"
  exit 2
fi

evaluate "$FLEET"
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "task-artifact-persistence-guard: PASS — the run's task artifacts and index rows outlive the worktrees that produced them."
  exit 0
fi
if [ "$rc" -eq 2 ]; then
  err "could not run the evaluator against $FLEET"
  exit 2
fi
err "FAIL — the task-artifact persistence contract does not hold."
exit 1
