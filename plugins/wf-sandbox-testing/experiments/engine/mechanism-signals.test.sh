#!/usr/bin/env bash
# mechanism-signals.test.sh — regression suite for the mechanism-signal validator/evaluator.
#
# Offline, spend-free, hermetic: every fixture is synthesized under a temp dir and removed on exit.
# Reads nothing from any experiment kit and writes nothing outside its own temp dir.
#
# Each case here exists because the defect it covers was REAL — found by audit on the change that
# introduced this file. The suite's job is to make sure none of them can return silently: a defect
# in the tool whose whole purpose is honest measurement is invisible by construction, because its
# failure mode is a confident green number rather than a crash.
#
# Usage: mechanism-signals.test.sh        (exit 0 all pass, 1 any failure)
set -uo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGNALS="$ENGINE_DIR/mechanism-signals.mjs"
CHECK="$ENGINE_DIR/../fleet-ab/mechanism-check.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

ok() { pass=$((pass + 1)); echo "  ok   — $1"; }
no() { fail=$((fail + 1)); echo "  FAIL — $1"; }

# assert_status <expected-exit> <label> -- <command...>
assert_status() {
  local want="$1" label="$2"; shift 3
  local rc=0
  "$@" >"$TMP/.out" 2>"$TMP/.err" || rc=$?
  if [ "$rc" -eq "$want" ]; then ok "$label"; else
    no "$label (exit $rc, wanted $want)"
    sed 's/^/         /' "$TMP/.err" | head -3
  fi
}

# assert_json <jq-ish node expression over the parsed doc> <expected> <label> <file>
assert_json() {
  local expr="$1" want="$2" label="$3" file="$4"
  local got
  got="$(node -e '
    const doc = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
    const f = new Function("doc", `return (${process.argv[2]});`);
    const v = f(doc);
    process.stdout.write(String(v));
  ' "$file" "$expr" 2>"$TMP/.err")" || { no "$label (expression threw)"; sed 's/^/         /' "$TMP/.err" | head -3; return; }
  if [ "$got" = "$want" ]; then ok "$label"; else no "$label (got '$got', wanted '$want')"; fi
}

manifest() { # manifest <path> <signals-json> [compares-json]
  local compares="${3:-}"
  [ -n "$compares" ] || compares='[{ "base": "A", "against": "B" }]'
  cat >"$1" <<EOF
{
  "name": "testkit",
  "arms": [{ "label": "A", "wf_ref": "x" }, { "label": "B", "wf_ref": "y" }],
  "compares": $compares,
  "mechanism_signals": $2
}
EOF
  # A fixture that is not valid JSON would make every case below "pass" for the wrong reason — the
  # exact false-green class this suite exists to catch. Fail loudly instead.
  node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))' "$1" \
    || { echo "  FIXTURE ERROR — $1 is not valid JSON" >&2; exit 3; }
}

echo "=== mechanism-signals regression suite ==="

# ---------------------------------------------------------------------------------------------
# 1. The entrypoint gate must survive a path that percent-encodes.
#
# The original guard compared process.argv[1] against `new URL(import.meta.url).pathname`, which is
# percent-encoded. Under a path containing a space the two never matched, main() never ran, and node
# exited 0 having done NOTHING — so manifest.sh reported "every signal validates" while validating
# none, and analyze.sh reported files it never wrote. A silent no-op, exit 0, no output.
# ---------------------------------------------------------------------------------------------
echo "-- entrypoint gate under an encoding-sensitive path"
SPACED="$TMP/dir with a space"
mkdir -p "$SPACED"
cp "$SIGNALS" "$SPACED/mechanism-signals.mjs"
manifest "$SPACED/good.json" '[{ "id": "s1", "kind": "dispatch_shape", "description": "d", "subagent_type": "x:y" }]'
manifest "$SPACED/bad.json" '[{ "id": "s1", "kind": "regex_scan", "description": "d" }]'

node "$SPACED/mechanism-signals.mjs" validate --manifest "$SPACED/good.json" >"$TMP/spaced.out" 2>&1
if [ -s "$TMP/spaced.out" ]; then ok "validate produces output from a spaced path (main() ran)"; else
  no "validate produced NO output from a spaced path — the entrypoint gate is a silent no-op"
fi
assert_status 2 "an unsupported kind is still rejected from a spaced path" -- \
  node "$SPACED/mechanism-signals.mjs" validate --manifest "$SPACED/bad.json"

# ---------------------------------------------------------------------------------------------
# 2. Honest non-measurement — every absent dimension.
# ---------------------------------------------------------------------------------------------
echo "-- honest non-measurement"
KIT="$TMP/kit"
mkdir -p "$KIT/run-A" "$KIT/run-B" "$KIT/run-typeless" "$KIT/run-idless" "$KIT/run-empty" "$KIT/run-array"

# A stream whose dispatch records carry NO subagent_type: the dispatch-type dimension is absent, so
# a count of 0 / presence "absent" would be absence of evidence dressed as evidence of absence —
# and mechanism-check.sh asserts on exactly that `presence` value.
printf '%s\n' \
  '{"type":"system","subtype":"task_started","task_id":"t1"}' \
  '{"type":"system","subtype":"task_started","task_id":"t2"}' \
  > "$KIT/run-typeless/transcript.jsonl"

# Dispatches that carry the type but no id: count and presence stay measurable, duplicates does not.
printf '%s\n' \
  '{"type":"system","subtype":"task_started","subagent_type":"x:y"}' \
  '{"type":"system","subtype":"task_started","subagent_type":"x:y"}' \
  > "$KIT/run-idless/transcript.jsonl"

# A well-formed pair of arms.
printf '%s\n' \
  '{"type":"system","subtype":"task_started","subagent_type":"x:y","task_id":"t1"}' \
  '{"type":"assistant","text":"hello"}' \
  > "$KIT/run-A/transcript.jsonl"
printf '%s\n' \
  '{"type":"system","subtype":"task_started","subagent_type":"x:y","task_id":"t1"}' \
  '{"type":"system","subtype":"task_started","subagent_type":"x:y","task_id":"t1"}' \
  '{"type":"system","subtype":"task_started","subagent_type":"x:y","task_id":"t2"}' \
  > "$KIT/run-B/transcript.jsonl"

# An EMPTY stream: a signal with no `record` selector has the whole stream as its candidate set, so
# this is exactly the same absence as a missing record type.
: > "$KIT/run-empty/transcript.jsonl"

# The whole-file JSON-array shape the run-output contract also admits.
printf '%s\n' '[{"type":"assistant","text":"alpha"},{"type":"assistant","text":"beta"}]' \
  > "$KIT/run-array/transcript.jsonl"

DISPATCH='{ "id": "disp", "kind": "dispatch_shape", "description": "d", "subagent_type": "x:y" }'
RAW='{ "id": "raw", "kind": "record_match", "description": "r", "match": [{ "field": "", "op": "contains", "value": "alpha" }] }'

manifest "$KIT/m.json" "[$DISPATCH, $RAW]"

node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-typeless" --run-b "$KIT/run-B" \
  --out "$TMP/o-typeless" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.disp.status' 'not_measured' \
  'dispatch_shape with no subagent_type on any dispatch is not measured' "$TMP/o-typeless/mechanism-signals.json"
assert_json 'doc.arms.B.signals.disp.status' 'measured' \
  'dispatch_shape is still measured on a well-formed arm' "$TMP/o-typeless/mechanism-signals.json"

node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-idless" --run-b "$KIT/run-B" \
  --out "$TMP/o-idless" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.disp.duplicates === null' 'true' \
  'duplicates is not measured when no matching dispatch carries the id' "$TMP/o-idless/mechanism-signals.json"
assert_json 'doc.arms.A.signals.disp.count' '2' \
  'count stays measured when only the id dimension is absent' "$TMP/o-idless/mechanism-signals.json"
assert_json 'doc.arms.B.signals.disp.duplicates' '1' \
  'duplicates counts a re-dispatch of the same id' "$TMP/o-idless/mechanism-signals.json"

node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-empty" --run-b "$KIT/run-B" \
  --out "$TMP/o-empty" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.raw.status' 'not_measured' \
  'a selector-less record_match over an empty stream is not measured' "$TMP/o-empty/mechanism-signals.json"

node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-array" --run-b "$KIT/run-B" \
  --out "$TMP/o-array" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.records' '2' \
  'a whole-file JSON-array transcript is read, not reported as an absent dimension' "$TMP/o-array/mechanism-signals.json"
assert_json 'doc.arms.A.signals.raw.count' '1' \
  'a match over the JSON-array shape counts correctly' "$TMP/o-array/mechanism-signals.json"

# ---------------------------------------------------------------------------------------------
# 3. A declared comparison is never dropped — only reported.
# ---------------------------------------------------------------------------------------------
echo "-- declared comparisons are reported, never omitted"
node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-A" --out "$TMP/o-onearm" >/dev/null 2>"$TMP/.err"
assert_json 'doc.deltas.length > 0' 'true' \
  'a compare whose endpoint arm was not supplied still emits delta rows' "$TMP/o-onearm/mechanism-signals.json"
assert_json 'doc.deltas.every((d) => d.status === "not_measured")' 'true' \
  'those rows are not_measured, never a fabricated number' "$TMP/o-onearm/mechanism-signals.json"
assert_json 'doc.deltas[0].reason.includes("not supplied")' 'true' \
  'and they state why' "$TMP/o-onearm/mechanism-signals.json"

# ---------------------------------------------------------------------------------------------
# 4. Usage errors are usage errors — not evidentiary claims about the run.
# ---------------------------------------------------------------------------------------------
echo "-- usage errors stay usage errors"
assert_status 2 "a nonexistent run dir is rejected, not reported as 'not measured'" -- \
  node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$TMP/no-such-dir" --run-b "$KIT/run-B" --out "$TMP/o-x"
assert_status 2 "binding the same arm twice is rejected" -- \
  node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-A" --run-A "$KIT/run-B" --out "$TMP/o-x"
assert_status 2 "evaluate with zero arms is rejected" -- \
  node "$SIGNALS" evaluate --manifest "$KIT/m.json" --out "$TMP/o-x"
assert_status 2 "an undeclared arm label is rejected" -- \
  node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-z "$KIT/run-A" --out "$TMP/o-x"

node "$SIGNALS" --help >"$TMP/help.out" 2>"$TMP/help.err"
if [ ! -s "$TMP/help.out" ] && [ -s "$TMP/help.err" ]; then
  ok "usage goes to stderr, keeping stdout clean for the report"
else
  no "usage leaked to stdout (stdout $(wc -c <"$TMP/help.out") bytes, stderr $(wc -c <"$TMP/help.err") bytes)"
fi

# ---------------------------------------------------------------------------------------------
# 5. Every validator rejection the schema documents.
# ---------------------------------------------------------------------------------------------
echo "-- the frozen vocabulary rejects loudly"
reject() { # reject <label> <signals-json>
  manifest "$TMP/reject.json" "$2"
  assert_status 2 "$1" -- node "$SIGNALS" validate --manifest "$TMP/reject.json"
}
reject "an unsupported predicate kind"        '[{ "id": "a", "kind": "regex_scan", "description": "d" }]'
reject "an unsupported match operator"        '[{ "id": "a", "kind": "record_match", "description": "d", "match": [{ "field": "f", "op": "regex", "value": "v" }] }]'
reject "a record_match with neither slot"     '[{ "id": "a", "kind": "record_match", "description": "d" }]'
reject "a record without a type"              '[{ "id": "a", "kind": "record_match", "description": "d", "record": { "subtype": "s" } }]'
reject "a match clause missing field"         '[{ "id": "a", "kind": "record_match", "description": "d", "match": [{ "op": "equals", "value": "v" }] }]'
reject "a match clause missing op"            '[{ "id": "a", "kind": "record_match", "description": "d", "match": [{ "field": "f", "value": "v" }] }]'
reject "a dispatch_shape missing subagent_type" '[{ "id": "a", "kind": "dispatch_shape", "description": "d" }]'
reject "an empty match value array"           '[{ "id": "a", "kind": "record_match", "description": "d", "match": [{ "field": "f", "op": "equals", "value": [] }] }]'
reject "an unknown key in a signal"           '[{ "id": "a", "kind": "dispatch_shape", "description": "d", "subagent_type": "x", "threshold": 3 }]'
reject "a duplicate signal id"                '[{ "id": "a", "kind": "dispatch_shape", "description": "d", "subagent_type": "x" }, { "id": "a", "kind": "dispatch_shape", "description": "e", "subagent_type": "y" }]'

# ---------------------------------------------------------------------------------------------
# 6. Emitted paths are stable and forward-slashed.
# ---------------------------------------------------------------------------------------------
echo "-- emitted paths"
mkdir -p "$KIT/inside/run-A"
cp "$KIT/run-A/transcript.jsonl" "$KIT/inside/run-A/"
node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$KIT/inside/run-A" --run-b "$KIT/run-B" \
  --out "$TMP/o-paths" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.run_dir' 'inside/run-A' \
  'an in-kit run dir emits a kit-relative forward-slashed path' "$TMP/o-paths/mechanism-signals.json"
assert_json 'doc.arms.A.run_dir.includes("\\\\")' 'false' \
  'no backslash reaches the emitted evidence' "$TMP/o-paths/mechanism-signals.json"

mkdir -p "$TMP/outside/run-A"
cp "$KIT/run-A/transcript.jsonl" "$TMP/outside/run-A/"
node "$SIGNALS" evaluate --manifest "$KIT/m.json" --run-a "$TMP/outside/run-A" --run-b "$KIT/run-B" \
  --out "$TMP/o-outside" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.run_dir.startsWith("<outside-kit>/")' 'true' \
  'an out-of-kit run dir is marked, not emitted as a checkout-depth .. chain' "$TMP/o-outside/mechanism-signals.json"

# ---------------------------------------------------------------------------------------------
# 7. mechanism-check.sh — a check that compares nothing is not a pass.
# ---------------------------------------------------------------------------------------------
if [ -f "$CHECK" ]; then
  echo "-- mechanism-check.sh input handling"
  KIT_REAL="$(cd "$(dirname "$CHECK")" && pwd -P)"

  printf '%s\n' '{ "arms": {} }' > "$TMP/empty-inventory.json"
  assert_status 2 "an inventory with no arms is an input error, never 'PASS (0 checks)'" -- \
    bash "$CHECK" --run-a "$KIT/run-A" --run-b "$KIT/run-B" \
      --inventory "$TMP/empty-inventory.json" --out "$TMP/mc-empty"

  printf '%s\n' '{ "arms": { "A": {} } }' > "$TMP/inv.json"
  assert_status 2 "a nonexistent arm run dir is a usage error" -- \
    bash "$CHECK" --run-a "$TMP/no-such" --inventory "$TMP/inv.json" --out "$TMP/mc-x"
  assert_status 2 "a nonexistent --manifest is a usage error, not the mismatch code" -- \
    bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv.json" --out "$TMP/mc-x" \
      --manifest "$TMP/no-such-dir/experiment.json"
  assert_status 2 "an unparseable --inventory is a usage error, not the mismatch code" -- \
    bash "$CHECK" --run-a "$KIT/run-A" --inventory "$SIGNALS" --out "$TMP/mc-x"

  # The refusal must fire BEFORE anything is created: results/ is the oracle AND untouchable output.
  SNEAK="$KIT_REAL/results/regression-probe-$$"
  assert_status 2 "an --out inside results/ is refused" -- \
    bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv.json" --out "$SNEAK"
  if [ -e "$SNEAK" ]; then
    no "the refused --out was created inside results/ before the refusal fired"
    rmdir "$SNEAK" 2>/dev/null || true
  else
    ok "the refused --out left nothing behind inside results/"
  fi
fi

echo ""
echo "=== $pass passed, $fail failed ==="
[ "$fail" -eq 0 ]
