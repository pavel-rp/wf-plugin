#!/usr/bin/env bash
# wf-linear deterministic self-checks.
#
# Auto-discovered by CI via the convention `plugins/*/capabilities/*/fixtures/run.sh`
# (.github/workflows/ci.yml, "Each capability's fixture suite" step). Capability-agnostic:
# CI never names wf-linear — it runs whatever fixtures run.sh a capability ships.
#
# Checks (all deterministic, no network, no model, no live tracker):
#   1. ROWS RESOLVE — every `inline:` dispatch in the manifest's fragments table names a file
#      that exists, and the two completion-publisher rows (research.publish, qa-gen.publish) are
#      present with merge policy `replace`.                                         [structural]
#   2. FILL CLAUSES — each completion-publisher fill states the clauses its contract depends on:
#      record read first, refresh via `update`, never create while a record exists, record
#      written immediately after the create, the outcome vocabulary, and its class-specific
#      rules (research: standalone, both artifacts, Not practical, no task/charter; qa-gen:
#      plan only, no run report, child of the task, no umbrella).                  [structural]
#   3. DECISION SEQUENCE — a stub tracker is driven through the fills' documented sequence for
#      both artifact classes: first publish, regeneration, failure after the identity is
#      recorded then retry, failed refresh then retry. Asserts one create per class, the same
#      id throughout, update counts, honest outcome lines, and that the local artifact's
#      sha256 never changes (so a receipt bound to it stays fresh).          [mocked behavioral]
#
# Usage:  run.sh    run every check (default; used by CI)
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP_DIR="$(dirname "$SCRIPT_DIR")"                  # capabilities/linear
MANIFEST="$CAP_DIR/manifest.md"
RESEARCH="$CAP_DIR/fragments/research-publish.md"
QAGEN="$CAP_DIR/fragments/qa-gen-publish.md"

fail=0
err() { printf 'FAIL: %s\n' "$1" >&2; fail=1; }
ok()  { printf 'ok:   %s\n' "$1"; }

# 1. ROWS RESOLVE ---------------------------------------------------------------------------
check_rows() {
  local before=$fail path n=0
  [ -f "$MANIFEST" ] || { err "rows: $MANIFEST missing"; return; }
  while read -r path; do
    n=$((n + 1))
    [ -f "$CAP_DIR/$path" ] || err "rows: manifest row names '$path', which does not exist"
  done < <(grep -oE '`inline: [^`]+`' "$MANIFEST" | sed -e 's/^`inline: //' -e 's/`$//')
  # An empty parse would pass vacuously; the manifest carries ten inline rows today.
  [ "$n" -ge 10 ] || err "rows: parsed only $n inline row(s) — a mis-parsed table, never a vacuous pass"
  grep -qE '^\| — +\| slot +\| `inline: fragments/research-publish\.md` +\| research\.publish replace +\|' "$MANIFEST" \
    || err "rows: no 'research.publish replace' slot row naming fragments/research-publish.md"
  grep -qE '^\| — +\| slot +\| `inline: fragments/qa-gen-publish\.md` +\| qa-gen\.publish replace +\|' "$MANIFEST" \
    || err "rows: no 'qa-gen.publish replace' slot row naming fragments/qa-gen-publish.md"
  [ "$fail" = "$before" ] && ok "rows: all $n inline rows resolve; both completion-publisher rows present"
}

# 2. FILL CLAUSES ---------------------------------------------------------------------------
need() {  # $1 = file, $2 = label, $3 = fixed string
  grep -qF -- "$3" "$1" || err "clauses: $2 does not state: $3"
}
check_clauses() {
  local before=$fail f label
  for f in "$RESEARCH" "$QAGEN"; do
    [ -f "$f" ] || { err "clauses: $f missing"; continue; }
    label=$(basename "$f")
    need "$f" "$label" '## Step 1 — Read the publication record first'
    need "$f" "$label" 'Before any tracker operation, read `<publication-record>`'
    need "$f" "$label" '**Never invoke a create operation on this path**'
    need "$f" "$label" '**Immediately** after it returns — before any other operation, and before the outcome line —'
    need "$f" "$label" 'keep the record exactly as it is'
    need "$f" "$label" '`Publish: published <id>`'
    need "$f" "$label" '`Publish: refreshed <id>`'
    need "$f" "$label" '`Publish: failed — '
    need "$f" "$label" '**Publication:** <returned id>'
    need "$f" "$label" 'name no concrete tracker tool here'
    grep -qF 'mcp__' "$f" && err "clauses: $label names a concrete tracker tool"
    grep -qiE 'co-authored-by|generated with claude' "$f" && err "clauses: $label carries AI attribution"
  done
  # research: standalone, both artifacts, every verdict, nothing adopted
  need "$RESEARCH" research-publish.md 'Invoke `create_umbrella(<title>, <description>)` **once** — a top-level item with no parent'
  need "$RESEARCH" research-publish.md '`## Findings` followed by the full body of `<findings>`, then `## Verdict`'
  need "$RESEARCH" research-publish.md 'a `Not practical — <reason>` verdict is published'
  need "$RESEARCH" research-publish.md 'It never creates a task, a child issue, an implementation item, or a'
  grep -qF '`create_child`' "$RESEARCH" && err "clauses: research-publish.md names create_child — research must stay standalone"
  # qa-gen: plan only, child of the task, never an umbrella, never the run report
  need "$QAGEN" qa-gen-publish.md 'It never reads or publishes `07_qa-report.md`'
  need "$QAGEN" qa-gen-publish.md '**title** — `QA plan: <task title>`.'
  need "$QAGEN" qa-gen-publish.md 'Create nothing — no umbrella, no'
  need "$QAGEN" qa-gen-publish.md 'It never modifies `06_qa.md`'
  grep -qF '`create_umbrella`' "$QAGEN" && err "clauses: qa-gen-publish.md names create_umbrella — the plan belongs in its existing task context"
  [ "$fail" = "$before" ] && ok "clauses: both fills state record-first, refresh-never-create, immediate recording and their class rules"
}

# 3. DECISION SEQUENCE (mocked) -------------------------------------------------------------
# A stub tracker plus a transcription of the fills' documented step order. The transcription is
# what this check pins: if the fill text changes order, check 2 fails; if the order below were
# wrong, the assertions here fail. Each call is logged to $LOG so counts are observable.
check_sequence() {
  local before=$fail tmp
  tmp="$(mktemp -d)"
  (
    set -e
    LOG="$tmp/calls.log"; : >"$LOG"
    NEXT=100
    FAIL_ON=""          # space-separated ops that fail once each: create update label status
    CREATED=""          # id returned by the last successful create
    OUT=""              # the outcome line of the last publish

    # Globals, never command substitution: a subshell would lose NEXT/FAIL_ON between calls.
    tracker() {  # $1 = op, rest = args
      local op=$1; shift
      echo "$op $*" >>"$LOG"
      case " $FAIL_ON " in *" $op "*) FAIL_ON=$(printf '%s' " $FAIL_ON " | sed "s/ $op / /"); return 1 ;; esac
      if [ "$op" = create ]; then NEXT=$((NEXT + 1)); CREATED="WF-$NEXT"; fi
      return 0
    }

    publish() {  # $1 = record path, $2 = artifact path; sets OUT
      local record=$1 artifact=$2 id=""
      [ -f "$record" ] && id=$(sed -n 's/^\*\*Publication:\*\* //p' "$record")
      if [ -n "$id" ]; then                                       # refresh path — never create
        if tracker update "$id" "$(sha256sum "$artifact" | cut -d' ' -f1)"; then
          tracker label "$id" || true; tracker status "$id" || true
          OUT="Publish: refreshed $id"
        else
          OUT="Publish: failed — update $id"
        fi
        return 0
      fi
      if ! tracker create "$(sha256sum "$artifact" | cut -d' ' -f1)"; then
        OUT="Publish: failed — create"; return 0
      fi
      id=$CREATED
      mkdir -p "$(dirname "$record")"
      printf '**Publication:** %s\n' "$id" >"$record"           # immediately, before anything else
      tracker label "$id" || true; tracker status "$id" || true
      OUT="Publish: published $id"
    }

    run_class() {  # $1 = class name, $2 = artifact basename
      local cls=$1 art=$2 dir="$tmp/$1" out first id digest
      mkdir -p "$dir"; : >"$LOG"
      printf 'v1\n' >"$dir/$art"
      record="$dir/publication/$cls.publish.md"

      digest=$(sha256sum "$dir/$art" | cut -d' ' -f1)
      publish "$record" "$dir/$art"; first=${OUT##* }                       # first publication
      [ "$OUT" = "Publish: published $first" ] || { echo "$cls first: $OUT" >&2; exit 21; }
      [ "$(sha256sum "$dir/$art" | cut -d' ' -f1)" = "$digest" ] || exit 22

      printf 'v2\n' >"$dir/$art"; digest=$(sha256sum "$dir/$art" | cut -d' ' -f1)
      publish "$record" "$dir/$art"                                          # regeneration
      [ "$OUT" = "Publish: refreshed $first" ] || { echo "$cls regen: $OUT" >&2; exit 23; }

      FAIL_ON="label status"                                                 # failure after recording
      publish "$record" "$dir/$art"
      [ "$OUT" = "Publish: refreshed $first" ] || { echo "$cls tail-fail: $OUT" >&2; exit 25; }
      grep -qF "**Publication:** $first" "$record" || exit 26                # identity survived
      publish "$record" "$dir/$art"                                          # ...retry
      [ "$OUT" = "Publish: refreshed $first" ] || { echo "$cls tail-retry: $OUT" >&2; exit 27; }

      FAIL_ON="update"                                                       # failed refresh
      publish "$record" "$dir/$art"
      [ "$OUT" = "Publish: failed — update $first" ] || { echo "$cls refresh-fail: $OUT" >&2; exit 28; }
      grep -qF "**Publication:** $first" "$record" || exit 29                # record kept
      publish "$record" "$dir/$art"                                          # ...retry
      [ "$OUT" = "Publish: refreshed $first" ] || { echo "$cls refresh-retry: $OUT" >&2; exit 30; }
      [ "$(sha256sum "$dir/$art" | cut -d' ' -f1)" = "$digest" ] || exit 31

      # Exactly one create across the whole matrix; every later pass went to the same id.
      [ "$(grep -c '^create ' "$LOG")" -eq 1 ] || { echo "$cls creates: $(grep -c '^create ' "$LOG")" >&2; exit 32; }
      [ "$(grep -c "^update $first " "$LOG")" -eq 5 ] || { echo "$cls updates: $(grep -c '^update ' "$LOG")" >&2; exit 33; }
      [ "$(grep -c '^update ' "$LOG" | tr -d ' ')" = "$(grep -c "^update $first " "$LOG")" ] || exit 34

      # Failure after the create, before the label/status tail: the identity is already on disk.
      rm -rf "$dir/publication"; : >"$LOG"; FAIL_ON="label status"
      publish "$record" "$dir/$art"; id=${OUT##* }
      [ "$OUT" = "Publish: published $id" ] || { echo "$cls create-tail-fail: $OUT" >&2; exit 35; }
      grep -qF "**Publication:** $id" "$record" || exit 36
      publish "$record" "$dir/$art"                                          # ...retry refreshes it
      [ "$OUT" = "Publish: refreshed $id" ] || { echo "$cls create-tail-retry: $OUT" >&2; exit 37; }
      # The record precedes the tail in time: the create is the first logged call, label next.
      [ "$(sed -n '1s/ .*//p' "$LOG")" = create ] && [ "$(sed -n '2s/ .*//p' "$LOG")" = label ] || exit 38
      [ "$(grep -c '^create ' "$LOG")" -eq 1 ] || exit 39

      # A failed create writes no record, so the retry creates (the only legitimate second create).
      rm -rf "$dir/publication"; : >"$LOG"; FAIL_ON="create"
      publish "$record" "$dir/$art"
      [ "$OUT" = "Publish: failed — create" ] || exit 40
      [ ! -e "$record" ] || exit 41
      publish "$record" "$dir/$art"; id=${OUT##* }
      [ "$OUT" = "Publish: published $id" ] || exit 42
    }

    run_class research 02_verdict.md
    run_class qa-gen 06_qa.md
  ) || err "sequence: mocked decision-sequence check failed (exit $?)"
  rm -rf "$tmp"
  [ "$fail" = "$before" ] && ok "sequence (mocked): first publish, regeneration, tail failure + retry, failed refresh + retry — no create while recorded, same id, artifact digest unchanged"
}

echo "== wf-linear capability self-checks =="
check_rows
check_clauses
check_sequence

if [ "$fail" -ne 0 ]; then
  echo "wf-linear self-checks: FAIL" >&2
  exit 1
fi
echo "wf-linear self-checks: PASS"
