#!/usr/bin/env bash
# materialize-round.sh — lay one recorded round into a seeded fixture workspace.
#
# **Model:** claude-fable-5-1
#
# The engine's seed-workspace.sh produces a clean workload checkout with `wf` + `wf-fake`
# installed and an empty-of-findings registry. This step adds what a replayed /wf:verify-spec
# round needs on top of that, and nothing else:
#
#   1. the task folder the audit reads (`_local/<task>/00_reqs.md`, `01_spec.md`, `02_plan.md`) —
#      copied from `_local/_archive/<task>/` on the machine holding the archive (`--task-src`
#      overrides the location); the archive is gitignored, so this is a stated local requirement,
#      never something the kit fabricates;
#   2. the ledger the round saw: `_local/<task>/04_verify.history.md` rebuilt newest-first from
#      the corpus item's verbatim transcripts of every EARLIER round — so round N's rotation trail
#      is exactly the trail round N held when it ran;
#   3. the fixture capability `_local/verify-replay-fixture/` (manifest + the round's recorded
#      findings rendered into `fragments/findings.md`) and its registry row in `_local/config.md`;
#   4. per-round scripted delivery reads (`generated/fake-scripts.<task>-r<NN>.json`) — branch and
#      head timestamp from the round record, the changed-file set from the host repository's
#      recorded base..commit range (plus the --edits set once applied) — over this file's
#      committed template; a range the host cannot resolve yields an empty set and a stated NOTE;
#   5. optionally (`--edits <patch>`) the uncommitted edit set a dirty-tree round audited, applied
#      with `git apply`; optionally (`--critic <file>`) a recorded critic stub, attached as a
#      second inline finding fragment of the same fixture capability.
#
# Deterministic; writes only under the given workspace and under this kit's generated/ folder.
#
# usage: materialize-round.sh --item <corpus item dir> --round <NN> --workspace <seeded ws>
#                             [--task-src <dir holding 00_reqs.md 01_spec.md 02_plan.md>]
#                             [--edits <patch file>] [--critic <recorded critic stub .md>]
set -euo pipefail
KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXP_DIR="$(cd "$KIT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$EXP_DIR/../../../.." && pwd)"

die() { echo "materialize-round.sh: ERROR — $*" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || die "jq is required"

item="" round="" ws="" task_src="" edits="" critic=""
while [ $# -gt 0 ]; do
  case "$1" in
    --item) item="${2:?}"; shift 2;;      --item=*) item="${1#*=}"; shift;;
    --round) round="${2:?}"; shift 2;;    --round=*) round="${1#*=}"; shift;;
    --workspace) ws="${2:?}"; shift 2;;   --workspace=*) ws="${1#*=}"; shift;;
    --task-src) task_src="${2:?}"; shift 2;; --task-src=*) task_src="${1#*=}"; shift;;
    --edits) edits="${2:?}"; shift 2;;    --edits=*) edits="${1#*=}"; shift;;
    --critic) critic="${2:?}"; shift 2;;  --critic=*) critic="${1#*=}"; shift;;
    *) die "unknown argument: $1";;
  esac
done
[ -n "$item" ] && [ -n "$round" ] && [ -n "$ws" ] || die "--item, --round and --workspace are required"
[ -d "$item" ] || die "item dir not found: $item"
[ -d "$ws" ] || die "workspace not found: $ws"
round="$(printf '%02d' "$((10#$round))")"
rec="$item/rounds/round-$round.json"
[ -f "$rec" ] || die "round record not found: $rec"
[ "$(jq -r '.body_truncated // false' "$rec")" != "true" ] || die "round $round is body_truncated at the source — not replayable (stated in the record); skip it"

task="$(jq -r '.task' "$rec")"
[ -n "$task_src" ] || task_src="$REPO_ROOT/_local/_archive/$task"
for f in 00_reqs.md 01_spec.md; do
  [ -f "$task_src/$f" ] || die "the replayed task's $f is not at $task_src — the archive is gitignored, so the machine running a live replay must hold it (or pass --task-src)"
done

# 1. task folder
mkdir -p "$ws/_local/$task"
for f in 00_reqs.md 01_spec.md 02_plan.md 03_tasks.md; do
  [ -f "$task_src/$f" ] && cp "$task_src/$f" "$ws/_local/$task/$f"
done
rm -f "$ws/_local/$task/04_verify.md" "$ws/_local/$task/04_verify.history.md"

# 2. the ledger this round saw: earlier rounds, newest first, in the rotation's own shape
n=$((10#$round))
if [ "$n" -gt 1 ]; then
  : > "$ws/_local/$task/04_verify.history.md"
  for ((k=n-1; k>=1; k--)); do
    prev="$item/rounds/round-$(printf '%02d' "$k").md"
    [ -f "$prev" ] || die "earlier round transcript missing: $prev"
    cat "$prev" >> "$ws/_local/$task/04_verify.history.md"
    printf '\n---\n\n' >> "$ws/_local/$task/04_verify.history.md"
  done
fi

# 3. the fixture capability + its registry row
fx="$ws/_local/verify-replay-fixture"
mkdir -p "$fx/fragments"
cp "$KIT_DIR/fixture/verify-replay-fixture/manifest.md" "$fx/manifest.md"
{
  printf '# verify-replay-fixture — recorded findings for %s round %s\n\n' "$task" "$round"
  printf '**Recorded from:** `%s` (commit `%s`, audited %s)\n\n' "$(jq -r '.source' "$rec")" "$(jq -r '.commit' "$rec")" "$(jq -r '.audited_at' "$rec")"
  printf '## Instructions to the verify phase\n\n'
  printf 'You are aggregating a **recorded** set of findings, not producing new ones. Emit **exactly** the\n'
  printf 'entries listed under `## Recorded findings` below, one finding each, in the generic finding shape\n'
  printf '(`severity`, `location`, `issue`, `evidence`, `recommendation`), with `severity` taken verbatim from\n'
  printf 'the entry — `fail` blocks, `warn` does not. Do **not** open, read, or re-audit any source file to\n'
  printf 'confirm or refute an entry; do **not** add, merge, drop, re-grade, or reword one; do **not**\n'
  printf 'dispatch any agent or tracker operation. Entries whose recorded severity is `pass`, `clean`, or\n'
  printf '`note` carry no finding and are listed only so the aggregation sees the full recorded block.\n\n'
  printf '## Recorded findings\n\n'
  jq -r '.capability_findings | to_entries[] | "- severity: \(.value.severity | ascii_downcase)\n  location: as recorded by \(.value.capability)\(if .value.lens then " (" + .value.lens + ")" else "" end), entry \(.key)\n  issue: \(.value.text | gsub("\n"; " "))\n  evidence: recorded finding \(.key) of this round\n  recommendation: as recorded\n"' "$rec"
} > "$fx/fragments/findings.md"

if [ -n "$critic" ]; then
  [ -f "$critic" ] || die "--critic file not found: $critic"
  cp "$critic" "$fx/fragments/critic.md"
  printf '| verify | finding           | `inline: fragments/critic.md`   | —     |\n' >> "$fx/manifest.md"
fi

cfg="$ws/_local/config.md"
[ -f "$cfg" ] || die "seeded workspace has no _local/config.md — run the engine's seed-workspace.sh first"
if ! grep -q '^| verify-replay-fixture |' "$cfg"; then
  # Append the row right after the Capabilities table's last row, keeping table order = injection order.
  awk -v row='| verify-replay-fixture | _local/verify-replay-fixture |' '
    /^## / { incap=0 }
    /^## Capabilities/ { incap=1 }
    incap && /^\|/ { last=NR }
    { lines[NR]=$0 }
    END { for (i=1;i<=NR;i++) { print lines[i]; if (i==last) print row } }' "$cfg" > "$cfg.tmp" && mv "$cfg.tmp" "$cfg"
fi
grep -q '^| verify-replay-fixture |' "$cfg" || die "could not register verify-replay-fixture in $cfg (no Capabilities table row to append after?)"

# 4. per-round scripted delivery reads
mkdir -p "$EXP_DIR/generated"
gen="$EXP_DIR/generated/fake-scripts.$task-r$round.json"
branch="$(jq -r '.branch // "main"' "$rec")"
ts="$(jq -r '.audited_at' "$rec")"
commit="$(jq -r '.commit' "$rec")"; base="$(jq -r '.base // empty' "$rec")"
# The seeded tree is a history-stripped snapshot, so the round's changed-file set is derived from
# the host repository, which holds the recorded base and commit; renames report their new path.
if [ -n "$base" ] && git -C "$REPO_ROOT" cat-file -e "$base^{commit}" 2>/dev/null && git -C "$REPO_ROOT" cat-file -e "$commit^{commit}" 2>/dev/null; then
  changes="$(git -C "$REPO_ROOT" diff --name-status "$base" "$commit" | jq -Rn '[inputs | split("\t") | {path: .[-1], status: .[0][0:1]}]')"
else
  changes='[]'
  echo "materialize-round.sh: NOTE — $task round $round: the host repository cannot resolve base '$base'..commit '$commit', so branch-changes-read is scripted EMPTY, which is a stated deviation from the recorded input" >&2
fi
jq --arg b "$branch" --arg ts "$ts" --arg t "$task" --argjson c "$changes" '
  .delivery["current-branch-query"] = $b
  | .delivery["last-commit-timestamp-query"] = $ts
  | .delivery["branch-changes-read"] = $c
  | .tracker.get.id = $t' "$EXP_DIR/fake-scripts.json" > "$gen"
mkdir -p "$ws/_local/fake"
cp "$gen" "$ws/_local/fake/scripts.json"

# 5. the uncommitted edit set a dirty-tree round audited
if [ -n "$edits" ]; then
  [ -f "$edits" ] || die "--edits patch not found: $edits"
  git -C "$ws" apply --whitespace=nowarn "$edits" || die "the uncommitted edit set did not apply cleanly at this round's tree"
  # The dirty-tree round's changed-file set is the committed range plus what the patch touched.
  dirty="$(git -C "$ws" diff --name-status | jq -Rn '[inputs | split("\t") | {path: .[-1], status: .[0][0:1]}]')"
  jq --argjson d "$dirty" '.delivery["branch-changes-read"] = ((.delivery["branch-changes-read"] + $d) | unique_by(.path))' "$gen" > "$gen.tmp" && mv "$gen.tmp" "$gen"
  cp "$gen" "$ws/_local/fake/scripts.json"
elif [ "$(jq -r '.tree' "$rec")" = "dirty" ]; then
  echo "materialize-round.sh: NOTE — $task round $round audited a dirty tree ($(jq -r '.tree_detail' "$rec" | cut -c1-120)) and no --edits patch was given; the replay will audit the commit alone, which is a stated deviation from the recorded input" >&2
fi

echo "materialize-round.sh: $task round $round materialized into $ws (ledger: $((n-1)) earlier round(s); findings: $(jq '.capability_findings | length' "$rec") recorded entries; scripts: ${gen#$REPO_ROOT/})"
