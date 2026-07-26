#!/usr/bin/env bash
# selfcheck.sh — regression suite for the mechanism-signal validator/evaluator.
#
# Offline and spend-free: every synthesized fixture lives under a temp dir and is removed on exit.
# It WRITES nothing outside that temp dir. It does not read nothing, though — the containment cases
# need a real protected directory to aim at, so the suite reads the fleet-ab kit: its
# mechanism-check.sh (the script under test), its experiment.json, and a fingerprint of its
# results/ taken before and after. Those reads are read-only and the fingerprint is asserted
# unchanged; stating "touches no experiment kit" would be the same over-claim this suite exists to
# catch.
#
# Each case here exists because the defect it covers was REAL — found by audit on the change that
# introduced this file. The suite's job is to make sure none of them can return silently: a defect
# in the tool whose whole purpose is honest measurement is invisible by construction, because its
# failure mode is a confident green number rather than a crash.
#
# Named `selfcheck.sh` to match the pack's own suite convention (`accounting/selfcheck.sh`,
# `runner/selfcheck.sh`, `experiments/parity/selfcheck.sh`) rather than inventing a lone
# `*.test.sh`, and it ends on the same named verdict token those suites emit, so a red CI step
# leaves a greppable line rather than only a counter.
#
# Usage: selfcheck.sh        (exit 0 all pass, 1 any failure)
set -uo pipefail

ENGINE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SIGNALS="$ENGINE_DIR/mechanism-signals.mjs"
# The CLI entry is what every caller invokes. It is a separate file from the module on purpose:
# the module is import-pure and self-executes NOTHING, so there is no path comparison anywhere that
# could be wrong under a symlink, a space, or a percent-encoding — the defect class that made the
# validator a silent no-op reporting exit 0. Tests invoke this, never the module.
SIGNALS_CLI="$ENGINE_DIR/mechanism-signals.cli.mjs"
MANIFEST_SH="$ENGINE_DIR/manifest.sh"
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
# 1. A COPIED kit runs from a path that percent-encodes.
#
# The original guard compared process.argv[1] against `new URL(import.meta.url).pathname`, which is
# percent-encoded. Under a path containing a space the two never matched, main() never ran, and node
# exited 0 having done NOTHING — so manifest.sh reported "every signal validates" while validating
# none, and analyze.sh reported files it never wrote. A silent no-op, exit 0, no output.
#
# There is no such guard any more (see §8), so this case now covers the other half of the shape
# space: a real COPY of both files — module plus entry — rather than a symlink to the original.
# ---------------------------------------------------------------------------------------------
echo "-- a copied kit under an encoding-sensitive path"
SPACED="$TMP/dir with a space"
mkdir -p "$SPACED"
cp "$SIGNALS" "$SPACED/mechanism-signals.mjs"
cp "$SIGNALS_CLI" "$SPACED/mechanism-signals.cli.mjs"
manifest "$SPACED/good.json" '[{ "id": "s1", "kind": "dispatch_shape", "description": "d", "subagent_type": "x:y" }]'
manifest "$SPACED/bad.json" '[{ "id": "s1", "kind": "regex_scan", "description": "d" }]'

# The streams are split deliberately. Merging them (`2>&1`) and then testing only `[ -s ]` reports
# ok for a CLI that emitted nothing but an error — a permanently-satisfiable assertion inside the
# suite whose entire purpose is catching assertions that cannot fail. Stdout must be non-empty AND
# the status must be 0; either alone is satisfiable by a broken entry.
node "$SPACED/mechanism-signals.cli.mjs" validate --manifest "$SPACED/good.json" \
  >"$TMP/spaced.out" 2>"$TMP/spaced.err"
spaced_rc=$?
if [ -s "$TMP/spaced.out" ]; then ok "validate produces stdout from a spaced path (main() ran)"; else
  no "validate produced NO stdout from a spaced path — the entry is a silent no-op (stderr: $(head -c 200 "$TMP/spaced.err"))"
fi
if [ "$spaced_rc" -eq 0 ]; then ok "validate from a spaced path exits 0 on a good manifest"; else
  no "validate from a spaced path exited $spaced_rc on a good manifest (stderr: $(head -c 200 "$TMP/spaced.err"))"
fi
assert_status 2 "an unsupported kind is still rejected from a spaced path" -- \
  node "$SPACED/mechanism-signals.cli.mjs" validate --manifest "$SPACED/bad.json"

# ---------------------------------------------------------------------------------------------
# 1b. NOTHING invokes the import-pure module as an entry point.
#
# Deleting the shebang stopped `./mechanism-signals.mjs` from running; it did not stop a caller
# handing the module file to the node binary as its script operand, which exits 0 having done
# nothing — the silent no-op the entry-point split exists to make impossible, and the exact failure
# that had manifest.sh reporting
# "every signal validates" while validating none. A file cannot defend against this itself, so the
# invariant is asserted over its callers instead. Prose mentions and the CLI's `import` are fine;
# only an INVOCATION is a defect — which is why the forbidden shape is described here rather than
# written out, the same reason the operand guard's own comment does not spell its pattern.
# ---------------------------------------------------------------------------------------------
echo "-- no caller invokes the import-pure module as an entry point"
module_callers="$(grep -rnE '(^|[^-[:alnum:]_./])node([[:space:]]+-[^[:space:]]+)*[[:space:]]+"?[^"[:space:]]*mechanism-signals\.mjs' \
  "$ENGINE_DIR" "$ENGINE_DIR/../fleet-ab" 2>/dev/null || true)"
if [ -z "$module_callers" ]; then
  ok "no engine or kit line invokes mechanism-signals.mjs with node — every caller uses the CLI entry"
else
  no "a caller invokes the import-pure module directly, which exits 0 having done nothing:"
  printf '%s\n' "$module_callers" | sed 's/^/         /' | head -5
fi

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

node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-typeless" --run-b "$KIT/run-B" \
  --out "$TMP/o-typeless" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.disp.status' 'not_measured' \
  'dispatch_shape with no subagent_type on any dispatch is not measured' "$TMP/o-typeless/mechanism-signals.json"
assert_json 'doc.arms.B.signals.disp.status' 'measured' \
  'dispatch_shape is still measured on a well-formed arm' "$TMP/o-typeless/mechanism-signals.json"

node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-idless" --run-b "$KIT/run-B" \
  --out "$TMP/o-idless" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.disp.duplicates === null' 'true' \
  'duplicates is not measured when no matching dispatch carries the id' "$TMP/o-idless/mechanism-signals.json"
assert_json 'doc.arms.A.signals.disp.count' '2' \
  'count stays measured when only the id dimension is absent' "$TMP/o-idless/mechanism-signals.json"
assert_json 'doc.arms.B.signals.disp.duplicates' '1' \
  'duplicates counts a re-dispatch of the same id' "$TMP/o-idless/mechanism-signals.json"

node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-empty" --run-b "$KIT/run-B" \
  --out "$TMP/o-empty" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.raw.status' 'not_measured' \
  'a selector-less record_match over an empty stream is not measured' "$TMP/o-empty/mechanism-signals.json"

node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-array" --run-b "$KIT/run-B" \
  --out "$TMP/o-array" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.records' '2' \
  'a whole-file JSON-array transcript is read, not reported as an absent dimension' "$TMP/o-array/mechanism-signals.json"
assert_json 'doc.arms.A.signals.raw.count' '1' \
  'a match over the JSON-array shape counts correctly' "$TMP/o-array/mechanism-signals.json"

# ---------------------------------------------------------------------------------------------
# 3. A declared comparison is never dropped — only reported.
# ---------------------------------------------------------------------------------------------
echo "-- declared comparisons are reported, never omitted"
node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-A" --out "$TMP/o-onearm" >/dev/null 2>"$TMP/.err"
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
  node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$TMP/no-such-dir" --run-b "$KIT/run-B" --out "$TMP/o-x"
assert_status 2 "binding the same arm twice is rejected" -- \
  node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$KIT/run-A" --run-A "$KIT/run-B" --out "$TMP/o-x"
assert_status 2 "evaluate with zero arms is rejected" -- \
  node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --out "$TMP/o-x"
assert_status 2 "an undeclared arm label is rejected" -- \
  node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-z "$KIT/run-A" --out "$TMP/o-x"

node "$SIGNALS_CLI" --help >"$TMP/help.out" 2>"$TMP/help.err"
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
  assert_status 2 "$1" -- node "$SIGNALS_CLI" validate --manifest "$TMP/reject.json"
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
node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$KIT/inside/run-A" --run-b "$KIT/run-B" \
  --out "$TMP/o-paths" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.run_dir' 'inside/run-A' \
  'an in-kit run dir emits a kit-relative forward-slashed path' "$TMP/o-paths/mechanism-signals.json"
# W-3. The previous form of this case asserted `run_dir.includes("\\") === false` on an ordinary
# POSIX fixture. That assertion is PERMANENTLY GREEN and therefore worthless: the emitter normalizes
# with `.split(path.sep).join("/")`, `path.sep` is `/` on POSIX, so the split/join is a no-op and no
# backslash could appear in that fixture whether the normalization existed or not. A test that
# cannot go red does not test anything — the same false-green class this suite exists to catch.
#
# Replaced with a fixture that carries a LITERAL backslash in the directory name. On POSIX a
# backslash is an ordinary filename character, so it survives into run_dir and the assertion has a
# real failure mode: it goes red the moment the emitter stops normalizing or starts escaping.
BSDIR="$KIT/inside/back\\slash-run"
mkdir -p "$BSDIR"
cp "$KIT/run-A/transcript.jsonl" "$BSDIR/"
node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$BSDIR" --run-b "$KIT/run-B" \
  --out "$TMP/o-backslash" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.run_dir' 'inside/back\slash-run' \
  'a literal backslash in a path component survives verbatim into the emitted evidence' \
  "$TMP/o-backslash/mechanism-signals.json"
assert_json 'doc.arms.A.run_dir.split("/").length' '2' \
  'and the path is still split on forward slashes only — the separator is never conflated' \
  "$TMP/o-backslash/mechanism-signals.json"

mkdir -p "$TMP/outside/run-A"
cp "$KIT/run-A/transcript.jsonl" "$TMP/outside/run-A/"
node "$SIGNALS_CLI" evaluate --manifest "$KIT/m.json" --run-a "$TMP/outside/run-A" --run-b "$KIT/run-B" \
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
else
  # W-6. Without this branch a missing check script skipped the entire section and the suite still
  # reported all-pass — a green run that asserted nothing about mechanism-check.sh. An absent script
  # under test is a failure of the suite, never a silent skip.
  no "mechanism-check.sh not found at $CHECK — the whole check section was skipped, which is a suite failure, not a pass"
fi

# =============================================================================================
# WF-423 — the four sites where a check's success path was reachable without doing the work.
#
# Every case below was written and confirmed RED against e7bb4b8 before its fix moved. That
# ordering is the point: a regression written after its fix cannot distinguish the fix from its
# absence, which is how three prior rounds each shipped a half-fix under a green suite.
# =============================================================================================

assert_grep() { # assert_grep <file> <extended-regex> <label>
  if grep -Eq "$2" "$1"; then ok "$3"; else
    no "$3 (no line matching /$2/)"
    sed 's/^/         /' "$1" | head -5
  fi
}
assert_no_grep() { # assert_no_grep <file> <extended-regex> <label>
  if grep -Eq "$2" "$1"; then
    no "$3 (found a line matching /$2/)"
    grep -E "$2" "$1" | sed 's/^/         /' | head -3
  else ok "$3"; fi
}

# ---------------------------------------------------------------------------------------------
# 8. Defect 1 — the CLI entry runs from ANY path shape, because it compares no paths at all.
#
# Node realpaths `import.meta.url`, but `process.argv[1]` stays logical and `path.resolve` follows
# no symlink. Any self-execution guard comparing the two is therefore unequal under a symlinked
# checkout: main() never runs, node exits 0, and manifest.sh reads that 0 as "every declared signal
# validated" having validated none. The fix is not a smarter comparison — it is having none.
# ---------------------------------------------------------------------------------------------
echo "-- defect 1: the CLI entry runs from any path shape"
manifest "$TMP/shape-good.json" '[{ "id": "s1", "kind": "dispatch_shape", "description": "d", "subagent_type": "x:y" }]'
manifest "$TMP/shape-bad.json"  '[{ "id": "s1", "kind": "regex_scan", "description": "d" }]'

cli_shape() { # cli_shape <label> <engine-dir>
  local label="$1" cli="$2/mechanism-signals.cli.mjs"
  node "$cli" validate --manifest "$TMP/shape-good.json" >"$TMP/shape.out" 2>"$TMP/shape.err"
  if [ -s "$TMP/shape.out" ]; then ok "validate produces output via $label (main() ran)"; else
    no "validate produced NO output via $label — the entry is a silent no-op reporting success"
    sed 's/^/         /' "$TMP/shape.err" | head -3
  fi
  assert_status 2 "an unsupported kind is still rejected via $label" -- \
    node "$cli" validate --manifest "$TMP/shape-bad.json"
}

ln -sfn "$ENGINE_DIR" "$TMP/linked-engine"
mkdir -p "$TMP/shape dir" "$TMP/shape#ünï"
ln -sfn "$ENGINE_DIR" "$TMP/shape dir/engine"
ln -sfn "$ENGINE_DIR" "$TMP/shape#ünï/engine"

cli_shape "a symlinked engine dir"                     "$TMP/linked-engine"
cli_shape "a symlinked dir under a spaced path"        "$TMP/shape dir/engine"
cli_shape "a symlinked dir under a #/non-ASCII path"   "$TMP/shape#ünï/engine"

# ---------------------------------------------------------------------------------------------
# 8b. Defect 1 (loader side) — manifest load asserts a POSITIVE sentinel, never exit 0.
#
# A validator that exits 0 having printed nothing is exactly what the broken entry gate produced.
# A loader that reads exit 0 as proof cannot tell that apart from a real validation, so it must
# require the validator to SAY it validated something.
# ---------------------------------------------------------------------------------------------
echo "-- defect 1b: manifest load requires a positive validator sentinel"
FAKE_ENGINE="$TMP/fake-engine"
mkdir -p "$FAKE_ENGINE"
cp "$MANIFEST_SH" "$FAKE_ENGINE/manifest.sh"
cp "$SIGNALS" "$FAKE_ENGINE/mechanism-signals.mjs"
REAL_MANIFEST="$ENGINE_DIR/../fleet-ab/experiment.json"

load_with_stub() { # load_with_stub <stub-body>; echoes "<rc>|<stdout>"
  printf '%s\n' "$1" > "$FAKE_ENGINE/mechanism-signals.cli.mjs"
  local out rc=0
  out="$(bash -c 'source "$1" >/dev/null 2>&1; manifest_load "$2" 2>/dev/null' _ \
        "$FAKE_ENGINE/manifest.sh" "$REAL_MANIFEST")" || rc=$?
  printf '%s|%s' "$rc" "$out"
}

silent="$(load_with_stub 'process.exit(0);')"
if [ "${silent%%|*}" != "0" ]; then
  ok "a validator that exits 0 in silence fails the manifest load"
else
  no "a silent exit-0 validator was accepted as proof of validation — the load asserts nothing"
fi

sentinel="$(load_with_stub 'process.stdout.write("VALIDATED 7 signals\n");')"
if [ "${sentinel%%|*}" = "0" ]; then
  ok "a validator emitting the sentinel loads the manifest (positive control)"
else
  no "the sentinel-emitting control failed to load (rc ${sentinel%%|*}) — the negative case above proves nothing"
fi

# The sentinel must stay assertable at the loader WITHOUT reaching the caller's stdout: manifest.sh
# loads for every phase including --dry-run, and the parity oracle compares stdout byte-for-byte
# (experiments/parity/normalization.md). Capturing into a variable is what makes both true at once.
if printf '%s' "${sentinel#*|}" | grep -q 'VALIDATED'; then
  no "the validator sentinel leaked to the loader's stdout — the dry-run parity oracle would diverge"
else
  ok "the sentinel is asserted at the loader without reaching stdout"
fi

# A sentinel claiming ZERO signals is ACCEPTED, and that is deliberate. What the loader asserts is
# the sentinel's PRESENCE — proof the validator ran and reached its own success line, which is the
# whole defect (a validator that exited 0 without executing). Its VALUE is a property of the
# manifest, not of the validator: schema.md declares `mechanism_signals` "may be empty … fully
# inert" and analyze.sh emits an empty table for an experiment that declares none. Refusing 0 would
# hard-fail every manifest shipped without the slot — swapping a false green for a false red.
zerosig="$(load_with_stub 'process.stdout.write("VALIDATED 0 signals\n");')"
if [ "${zerosig%%|*}" = "0" ]; then
  ok "a sentinel claiming 0 signals loads — an empty signal set is legal and inert, per schema.md"
else
  no "'VALIDATED 0 signals' was refused, breaking schema.md's promise that an empty set is inert"
fi

# ---------------------------------------------------------------------------------------------
# 9. Defect 2 — an explicitly-null field is absence, not a measured zero.
#
# `record_match` guarded field presence with `!== undefined` while `clauseMatches` rejected `null`.
# A field explicitly null on every candidate record therefore passed the presence guard, matched
# nothing, and emitted {status:"measured", count:0} — which mechanism-check.sh renders as a MATCH
# against a committed 0. A confident green number produced by measuring nothing.
# ---------------------------------------------------------------------------------------------
echo "-- defect 2: an explicitly-null field is not a measured zero"
mkdir -p "$KIT/run-null"
printf '%s\n' \
  '{"type":"assistant","payload":null}' \
  '{"type":"assistant","payload":null}' \
  '{"type":"system","subtype":"task_started","subagent_type":"wf:pr","task_id":"p1"}' \
  > "$KIT/run-null/transcript.jsonl"

NULLSIG='{ "id": "wf374_audit_lens_boots", "kind": "record_match", "description": "n", "record": { "type": "assistant" }, "match": [{ "field": "payload", "op": "equals", "value": "boot" }] }'
PRSIG='{ "id": "wf375_pr_dispatch", "kind": "dispatch_shape", "description": "p", "subagent_type": "wf:pr" }'
manifest "$KIT/m-null.json" "[$NULLSIG, $PRSIG]"

node "$SIGNALS_CLI" evaluate --manifest "$KIT/m-null.json" --run-a "$KIT/run-null" \
  --out "$TMP/o-null" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.wf374_audit_lens_boots.status' 'not_measured' \
  'a field explicitly null on every candidate record is not measured, never a measured 0' \
  "$TMP/o-null/mechanism-signals.json"
assert_json 'doc.arms.A.signals.wf374_audit_lens_boots.basis' '0' \
  'and its basis — records carrying the field at all — is 0' \
  "$TMP/o-null/mechanism-signals.json"
assert_json 'doc.arms.A.signals.wf375_pr_dispatch.status' 'measured' \
  'while a genuinely present dimension on the same stream stays measured' \
  "$TMP/o-null/mechanism-signals.json"

# The EMPTY-STRING rung of the same predicate chain. `isPresent` admits `""`; `isUsable` does not.
# Without a case that distinguishes them, the middle rung is dead weight a refactor could delete
# with the suite still green — the mutation-survives shape that let every earlier round of this
# defect pass. A field present but blank is no more a measurable dimension than a missing one.
echo "-- defect 2 (empty-string rung): a blank field is not a measured zero either"
mkdir -p "$KIT/run-blankfield"
printf '%s\n' \
  '{"type":"assistant","payload":""}' \
  '{"type":"assistant","payload":""}' \
  '{"type":"system","subtype":"task_started","subagent_type":"wf:pr","task_id":"p1"}' \
  > "$KIT/run-blankfield/transcript.jsonl"
manifest "$KIT/m-blankfield.json" "[$NULLSIG, $PRSIG]"
node "$SIGNALS_CLI" evaluate --manifest "$KIT/m-blankfield.json" --run-a "$KIT/run-blankfield" \
  --out "$TMP/o-blankfield" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.wf374_audit_lens_boots.status' 'not_measured' \
  'a field that is the empty string on every candidate record is not measured, never a measured 0' \
  "$TMP/o-blankfield/mechanism-signals.json"
assert_json 'doc.arms.A.signals.wf374_audit_lens_boots.basis' '0' \
  'and its basis excludes the blank records, so nothing was measured over' \
  "$TMP/o-blankfield/mechanism-signals.json"

# The duplicates half of the same rung — the live false green the audit named: three dispatches
# whose id is `""` were treated as three occurrences of one id and manufactured `duplicates: 2`.
echo "-- defect 2 (empty-string rung): blank dispatch ids do not manufacture duplicates"
mkdir -p "$KIT/run-emptydup"
printf '%s\n' \
  '{"type":"system","subtype":"task_started","subagent_type":"wf:pr","task_id":""}' \
  '{"type":"system","subtype":"task_started","subagent_type":"wf:pr","task_id":""}' \
  '{"type":"system","subtype":"task_started","subagent_type":"wf:pr","task_id":""}' \
  > "$KIT/run-emptydup/transcript.jsonl"
manifest "$KIT/m-emptydup.json" "[$PRSIG]"
node "$SIGNALS_CLI" evaluate --manifest "$KIT/m-emptydup.json" --run-a "$KIT/run-emptydup" \
  --out "$TMP/o-emptydup" >/dev/null 2>"$TMP/.err"
assert_json 'doc.arms.A.signals.wf375_pr_dispatch.duplicates' 'null' \
  'three dispatches carrying a blank id manufacture no duplicate count' \
  "$TMP/o-emptydup/mechanism-signals.json"
assert_json 'typeof doc.arms.A.signals.wf375_pr_dispatch.basis' 'number' \
  'every evaluation result carries a basis, measured or not' \
  "$TMP/o-null/mechanism-signals.json"

# ---------------------------------------------------------------------------------------------
# 10-12. mechanism-check.sh — rendering, containment, and operand handling.
# ---------------------------------------------------------------------------------------------
if [ -f "$CHECK" ]; then
  KIT_REAL="$(cd "$(dirname "$CHECK")" && pwd -P)"
  RESULTS_REAL="$KIT_REAL/results"

  # ------------------------------------------------------------------------------------------
  # 10. Defect 2 (rendering side) — a not-measured row can never be a MATCH.
  # ------------------------------------------------------------------------------------------
  echo "-- defect 2 (rendering): a not-measured signal renders NOT-MEASURED, never MATCH"
  printf '%s\n' '{ "arms": { "A": { "wf374": { "all_audit_lens_started": 0 }, "wf375": { "pr_task_dispatches": 1 } } } }' \
    > "$TMP/inv-null.json"
  mc_rc=0
  bash "$CHECK" --manifest "$KIT/m-null.json" --run-a "$KIT/run-null" \
    --inventory "$TMP/inv-null.json" --out "$TMP/mc-null" >"$TMP/mc-null.out" 2>&1 || mc_rc=$?
  assert_no_grep "$TMP/mc-null.out" '^MATCH +arm A wf374_audit_lens_boots' \
    'a not-measured signal does not produce a MATCH against a committed 0'
  assert_grep "$TMP/mc-null.out" '^NOT-MEASURED +arm A wf374_audit_lens_boots' \
    'it produces its own NOT-MEASURED row instead'
  assert_grep "$TMP/mc-null.out" '^MATCH +arm A wf375_pr_dispatch' \
    'while the measured signal on the same run still checks normally'
  if [ "$mc_rc" -eq 0 ]; then
    ok "narrow-and-report: a not-measured row is reported, not counted as divergence (exit 0)"
  else
    no "a not-measured row was counted as a mismatch (exit $mc_rc) — narrowing is reported, not failed"
  fi

  # ------------------------------------------------------------------------------------------
  # 11. Defect 3 — the containment guard canonicalizes the WHOLE --out path.
  #
  # It resolved only `dirname "$out"` and re-appended the raw `basename`, so a symlinked LEAF
  # walked straight past the case and into `mkdir -p` — creating a directory inside results/, the
  # immutable oracle this check reads. Each case asserts the containment refusal by NAME, so a
  # refusal that fires for an unrelated reason (a parent that happens not to exist) cannot pass
  # for the guard working.
  # ------------------------------------------------------------------------------------------
  echo "-- defect 3: whole-path canonicalization before any mkdir"
  # A CONTENT fingerprint, not a name listing. `find | sort` alone records only which paths exist,
  # so it is blind to the one thing the assertion below claims to prove: an existing file being
  # overwritten in place. That is exactly what a followed symlink does — it creates no new name, it
  # rewrites a committed one — so the "byte-identical" label was an over-claim the check could not
  # have detected. Each entry now carries its kind plus, for a regular file, a checksum of its
  # bytes, and for a link, its target text (so a retargeted link is caught too). `cksum` is POSIX
  # and reads from stdin, which keeps the filename out of the digest and the digest stable.
  results_fingerprint() { # content fingerprint of results/, or the marker for absent
    if [ ! -e "$RESULTS_REAL" ]; then echo "<absent>"; return 0; fi
    local p
    find "$RESULTS_REAL" | LC_ALL=C sort | while IFS= read -r p; do
      if [ -L "$p" ]; then printf '%s\tL\t%s\n' "$p" "$(readlink -- "$p")"
      elif [ -d "$p" ]; then printf '%s\tD\n' "$p"
      elif [ -f "$p" ]; then printf '%s\tF\t%s\n' "$p" "$(cksum < "$p")"
      else printf '%s\t?\n' "$p"
      fi
    done
  }
  RESULTS_BEFORE="$(results_fingerprint)"

  out_refused() { # out_refused <label> <out-path>
    local label="$1" outp="$2" rc=0
    bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv.json" --out "$outp" \
      >"$TMP/out-guard.out" 2>&1 || rc=$?
    if [ "$rc" -eq 2 ]; then ok "$label is refused with the usage code"; else
      no "$label was not refused with exit 2 (exit $rc)"
    fi
    # Matched on the containment wording specifically, NOT on the substring "results/": the
    # "parent directory does not exist" refusal also carries that substring, so the loose form
    # passed whenever results/ happened to be absent — a refusal for an unrelated reason reading
    # as the guard working. The guard must fire because the path resolves INSIDE the oracle.
    assert_grep "$TMP/out-guard.out" "is inside the experiment's results/" \
      "$label is refused by name, as containment inside the oracle"
  }

  ln -sfn "$RESULTS_REAL" "$TMP/results-parent-link"
  ln -sfn "$RESULTS_REAL/probe-leaf" "$TMP/results-leaf-link"

  out_refused "a direct --out inside results/"          "$RESULTS_REAL/probe-direct"
  out_refused "an --out under a symlinked parent"       "$TMP/results-parent-link/probe-parent"
  out_refused "an --out that IS a symlink into results/" "$TMP/results-leaf-link"
  # The trailing slash is the input class the first version of the guard missed: `[ -L "link/" ]`
  # is false, so the leaf-resolution loop never ran and mkdir -p followed the link into results/.
  out_refused "a symlinked --out written with a trailing slash" "$TMP/results-leaf-link/"
  out_refused "a symlinked --out written with several trailing slashes" "$TMP/results-leaf-link///"
  out_refused "a direct --out inside results/ with a trailing slash" "$RESULTS_REAL/probe-direct/"
  out_refused "a symlinked-parent --out with a trailing slash"  "$TMP/results-parent-link/probe-parent/"
  # A slash inside a link's own TARGET TEXT is a distinct class from all four cases above, and the
  # one they were all blind to: every case above puts the slash on the command-line operand, which
  # a one-shot strip satisfies. Here the operand is clean and the resolution loop re-introduces the
  # slash itself, by appending the raw `readlink` output. Reproduced writing three files into the
  # protected results/ and overwriting two COMMITTED EVIDENCE sentinels while printing RESULT: PASS
  # at exit 0. The two-hop case pins that the strip runs on every iteration, not just the first.
  ln -sfn "results-leaf-link/" "$TMP/results-slashtarget-1"
  ln -sfn "results-slashtarget-1/" "$TMP/results-slashtarget-2"
  out_refused "an --out whose link target text ends in a slash" "$TMP/results-slashtarget-1"
  out_refused "an --out resolving through two link targets that each end in a slash" "$TMP/results-slashtarget-2"

  # ------------------------------------------------------------------------------------------
  # 11b. The PROTECTED side of the comparison is canonicalized too.
  #
  # Every case above varies the caller's --out. They were all blind to the other operand: the
  # guard built its protected path as `<physical parent>/results`, appending the `results` leaf
  # RAW. If results/ is itself a link, the resolved --out lands on the physical target while the
  # protected prefix is still the link path — two different strings for the same directory, so the
  # prefix never matches and the guard waves the write into the oracle. Same defect as the leaf
  # case, on the side no test was looking at.
  #
  # Exercised against a REPLICA kit, never the real one: results/ here is a symlink, which the
  # committed kit's cannot be. The replica is a copy of the script plus its manifest, with the
  # engine linked in so the script's own `$KIT_DIR/../engine` resolution still finds the CLI.
  # ------------------------------------------------------------------------------------------
  echo "-- defect 3 (other side): the protected results/ path is canonicalized too"
  mkdir -p "$TMP/replica/fleet-ab" "$TMP/replica/real-results"
  cp "$CHECK" "$TMP/replica/fleet-ab/mechanism-check.sh"
  cp "$KIT_REAL/experiment.json" "$TMP/replica/fleet-ab/experiment.json"
  ln -sfn "$ENGINE_DIR" "$TMP/replica/engine"
  ln -sfn "$TMP/replica/real-results" "$TMP/replica/fleet-ab/results"
  printf 'committed evidence\n' > "$TMP/replica/real-results/sentinel.txt"
  rep_rc=0
  bash "$TMP/replica/fleet-ab/mechanism-check.sh" --run-a "$KIT/run-A" \
    --inventory "$TMP/inv.json" --out "$TMP/replica/real-results/probe" \
    >"$TMP/replica-guard.out" 2>&1 || rep_rc=$?
  if [ "$rep_rc" -eq 2 ]; then
    ok "an --out on the physical target of a SYMLINKED results/ is refused with the usage code"
  else
    no "a symlinked results/ defeated the containment guard (exit $rep_rc) — the protected side was not resolved"
  fi
  assert_grep "$TMP/replica-guard.out" "is inside the experiment's results/" \
    "and it is refused by name, as containment inside the oracle"
  if [ -e "$TMP/replica/real-results/probe" ]; then
    no "the refused --out still created a directory inside the symlinked results/"
  else
    ok "nothing was created inside the symlinked results/ before the guard fired"
  fi

  # ------------------------------------------------------------------------------------------
  # 11c. A planted symlink at an OUTPUT FILE path is not followed.
  #
  # Canonicalizing --out constrains the DIRECTORY and says nothing about the file paths inside it.
  # A `mechanism-signals.json` planted there as a link into the oracle sends the write straight
  # through every containment check above — it creates no new name, it rewrites a committed one,
  # which is also why the name-listing fingerprint could not see it.
  # ------------------------------------------------------------------------------------------
  echo "-- defect 3 (leaf files): a planted output symlink is never followed"
  mkdir -p "$TMP/nofollow-out"
  printf 'do not overwrite me\n' > "$TMP/nofollow-victim.json"
  ln -sfn "$TMP/nofollow-victim.json" "$TMP/nofollow-out/mechanism-signals.json"
  bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv.json" --out "$TMP/nofollow-out" \
    >"$TMP/nofollow.out" 2>&1 || true
  if [ "$(cat "$TMP/nofollow-victim.json")" = "do not overwrite me" ]; then
    ok "a symlinked mechanism-signals.json inside --out is replaced, not followed to its target"
  else
    no "the evaluator followed a planted symlink and overwrote the file outside --out"
  fi
  printf 'do not overwrite me either\n' > "$TMP/nofollow-victim.txt"
  ln -sfn "$TMP/nofollow-victim.txt" "$TMP/nofollow-out/mechanism-check.txt"
  bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv.json" --out "$TMP/nofollow-out" \
    >"$TMP/nofollow2.out" 2>&1 || true
  if [ "$(cat "$TMP/nofollow-victim.txt")" = "do not overwrite me either" ]; then
    ok "and a symlinked mechanism-check.txt is replaced, not followed either"
  else
    no "the reporter followed a planted symlink and overwrote the file outside --out"
  fi

  # ------------------------------------------------------------------------------------------
  # 11d. A MALFORMED operand is a usage error, named as one.
  #
  # `dirname`/`basename` without `--` eat a leading-dash operand as an option: the utility prints
  # its own `invalid option` with nothing naming this script, and the failure surfaces as exit 1 —
  # the MISMATCH code. A typo would read to the caller as "the evidence diverged".
  # ------------------------------------------------------------------------------------------
  echo "-- defect 4 (malformed, not just missing): a leading-dash operand is a usage error"
  mal_rc=0
  bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv.json" --out "-nope/probe" \
    >"$TMP/mal.out" 2>&1 || mal_rc=$?
  if [ "$mal_rc" -eq 2 ]; then
    ok "an --out beginning with a dash exits 2, not the mismatch code"
  else
    no "a malformed --out exited $mal_rc — a usage mistake impersonating a verdict"
  fi
  assert_grep "$TMP/mal.out" '^mechanism-check\.sh: ERROR — ' \
    "and it names itself, rather than leaking a raw 'invalid option' from a utility"
  assert_no_grep "$TMP/mal.out" 'invalid option' \
    "so no utility's own option error reaches the caller unattributed"
  # `-L` is the case the dash guard above misses if only `dirname` is hardened: `-nope` is not a
  # valid `cd` option so cd errors out and the refusal happens by accident, but `-L` IS one — and
  # `cd` with an option and no operand goes to $HOME. Resolution then succeeded against a directory
  # the caller never named and the check ran to RESULT: PASS at exit 0 on the wrong tree. Every
  # utility in the chain needs `--`, not just the first one.
  esc_rc=0
  bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv.json" --out "-L/escaped" \
    >"$TMP/esc.out" 2>&1 || esc_rc=$?
  if [ "$esc_rc" -eq 2 ]; then
    ok "an --out whose parent is an option-shaped token exits 2, never resolving to \$HOME"
  else
    no "an option-shaped --out parent exited $esc_rc — resolution escaped to a directory the caller never named"
  fi
  assert_no_grep "$TMP/esc.out" '^RESULT: PASS' \
    "and it never reports a verdict over a tree the caller did not name"
  if [ -e "$HOME/escaped" ]; then
    no "the escaped --out created \$HOME/escaped"
    rm -rf "$HOME/escaped"
  else
    ok "and it created nothing in \$HOME"
  fi

  # Parseable is not usable. `null` is valid JSON, so JSON.parse returns without throwing and the
  # first property access downstream threw an uncaught TypeError — a raw Node stack at exit 1, the
  # MISMATCH code, for a malformed input file.
  echo "-- defect 4 (shape, not just syntax): a parseable non-object input is a usage error"
  for shape in 'null' '3' '"text"' '[]'; do
    printf '%s\n' "$shape" > "$TMP/inv-shape.json"
    shape_rc=0
    bash "$CHECK" --run-a "$KIT/run-A" --inventory "$TMP/inv-shape.json" --out "$TMP/mc-shape" \
      >"$TMP/shape.out" 2>&1 || shape_rc=$?
    if [ "$shape_rc" -eq 2 ]; then
      ok "an inventory of $shape exits 2, not the mismatch code"
    else
      no "an inventory of $shape exited $shape_rc — a malformed input impersonating a divergence"
    fi
    assert_grep "$TMP/shape.out" '^mechanism-check\.sh: ERROR — ' \
      "and it names itself rather than leaking a raw stack for $shape"
  done

  if [ "$(results_fingerprint)" = "$RESULTS_BEFORE" ]; then
    ok "results/ is byte-identical after every refusal — nothing was created before the guard fired"
  else
    no "results/ changed during the containment cases — a refused --out still wrote into the oracle"
    rm -rf "$RESULTS_REAL/probe-direct" "$RESULTS_REAL/probe-parent" "$RESULTS_REAL/probe-leaf" 2>/dev/null || true
    # Deliberately no `rmdir "$RESULTS_REAL"`: this directory is the committed oracle, not suite
    # scratch. The rmdir could only ever succeed by removing tracked evidence, which is the exact
    # damage the block above exists to detect — a cleanup path that destroys what it is guarding.
  fi

  # ------------------------------------------------------------------------------------------
  # 12. Defect 4 — a dropped operand is a usage error, never the mismatch verdict.
  #
  # `"${2:?}"` exits 1 with no error prefix. 1 is the documented MISMATCH code, so a caller reading
  # the exit status was told "the evidence diverged" when in fact an argument was missing.
  # ------------------------------------------------------------------------------------------
  echo "-- defect 4: a dropped flag operand exits 2, never the mismatch code"
  for flag in --run-a --arm --inventory --out --manifest; do
    rc=0
    bash "$CHECK" "$flag" >"$TMP/operand.out" 2>"$TMP/operand.err" || rc=$?
    if [ "$rc" -eq 2 ]; then ok "$flag with no operand exits 2"; else
      no "$flag with no operand exited $rc — 1 is the MISMATCH code and would read as a verdict"
    fi
    assert_grep "$TMP/operand.err" '^mechanism-check\.sh: ERROR — ' \
      "$flag with no operand names itself an error"
  done

  # ------------------------------------------------------------------------------------------
  # 13. W-9 — SKIP-row behaviour and the duplicates caveats are asserted, not assumed.
  # ------------------------------------------------------------------------------------------
  echo "-- W-9: SKIP rows and the duplicates caveats"
  assert_grep "$TMP/mc-null.out" '^SKIP +arm A wf375_tf_dispatch: signal not declared by this manifest' \
    'a COUNTS binding the manifest does not declare produces a visible SKIP row'
  assert_grep "$TMP/mc-null.out" '^SKIP +arm A duplicate PR/TF dispatches: no committed counterpart' \
    'an uncommitted duplicates counterpart produces a visible SKIP row'

  # duplicates === null — the id dimension is absent, so summing it would manufacture a 0.
  mkdir -p "$KIT/run-nodup"
  printf '%s\n' \
    '{"type":"system","subtype":"task_started","subagent_type":"wf:pr"}' \
    '{"type":"system","subtype":"task_started","subagent_type":"wf:tf"}' \
    > "$KIT/run-nodup/transcript.jsonl"
  TFSIG='{ "id": "wf375_tf_dispatch", "kind": "dispatch_shape", "description": "t", "subagent_type": "wf:tf" }'
  manifest "$KIT/m-dup.json" "[$PRSIG, $TFSIG]"
  printf '%s\n' '{ "arms": { "A": { "wf375": { "pr_task_dispatches": 1, "tf_task_dispatches": 1, "duplicate_pr_or_tf_dispatches": 0 } } } }' \
    > "$TMP/inv-nodup.json"
  bash "$CHECK" --manifest "$KIT/m-dup.json" --run-a "$KIT/run-nodup" \
    --inventory "$TMP/inv-nodup.json" --out "$TMP/mc-nodup" >"$TMP/mc-nodup.out" 2>&1 || true
  assert_grep "$TMP/mc-nodup.out" '^SKIP +arm A duplicate PR/TF dispatches: duplicates not measured' \
    'an absent id dimension makes duplicates a SKIP, never a manufactured 0'
  assert_no_grep "$TMP/mc-nodup.out" '^MATCH +arm A duplicate PR/TF dispatches' \
    'and it is never checked against the committed duplicate count'

  # Partially derived — some matching dispatches carry the id, some do not.
  mkdir -p "$KIT/run-partdup"
  printf '%s\n' \
    '{"type":"system","subtype":"task_started","subagent_type":"wf:pr","task_id":"p1"}' \
    '{"type":"system","subtype":"task_started","subagent_type":"wf:pr","task_id":"p1"}' \
    '{"type":"system","subtype":"task_started","subagent_type":"wf:pr"}' \
    '{"type":"system","subtype":"task_started","subagent_type":"wf:tf","task_id":"t1"}' \
    > "$KIT/run-partdup/transcript.jsonl"
  printf '%s\n' '{ "arms": { "A": { "wf375": { "pr_task_dispatches": 3, "tf_task_dispatches": 1, "duplicate_pr_or_tf_dispatches": 1 } } } }' \
    > "$TMP/inv-partdup.json"
  bash "$CHECK" --manifest "$KIT/m-dup.json" --run-a "$KIT/run-partdup" \
    --inventory "$TMP/inv-partdup.json" --out "$TMP/mc-partdup" >"$TMP/mc-partdup.out" 2>&1 || true
  assert_grep "$TMP/mc-partdup.out" '^SKIP +arm A duplicate PR/TF dispatches: partially derived' \
    'a duplicate count derived from only part of the evidence is a SKIP, not a MATCH'
  assert_no_grep "$TMP/mc-partdup.out" '^MATCH +arm A duplicate PR/TF dispatches' \
    'and a partially-derived count is never compared to the oracle as if complete'
else
  no "mechanism-check.sh not found at $CHECK — the WF-423 check sections were skipped, which is a suite failure, not a pass"
fi

# ---------------------------------------------------------------------------------------------
# 14. analyze.sh's share of the exit vocabulary.
#
# analyze.sh is the OTHER script on the measurement path, and until now no case here invoked it at
# all — so the same 1-vs-2 collision could sit in it indefinitely with the suite green, which is
# exactly how this defect class kept coming back. These cases cover only the usage-error contract
# (the part the hardening touched); the measurement body needs a full arm fixture and is out of
# this suite's scope, which is stated rather than left to look like coverage.
# ---------------------------------------------------------------------------------------------
ANALYZE="$ENGINE_DIR/analyze.sh"
# The kit manifest, not a synthesized one: analyze.sh runs the FULL manifest_load (constants,
# blinding, the lot), so the trimmed fixture the signal cases use fails validation first and every
# assertion below would then be measuring manifest.sh's refusal instead of analyze.sh's. Each case
# passes an explicit --out or fails before the default is reached, so the kit's own results/ is
# never the target.
ANALYZE_MANIFEST="$ENGINE_DIR/../fleet-ab/experiment.json"
if [ -f "$ANALYZE" ] && [ -f "$ANALYZE_MANIFEST" ]; then
  echo "-- analyze.sh: usage errors exit 2 and name themselves"

  an_rc=0
  bash "$ANALYZE" --manifest "$ANALYZE_MANIFEST" --bogus >"$TMP/an-bogus.out" 2>&1 || an_rc=$?
  if [ "$an_rc" -eq 2 ]; then ok "analyze.sh rejects an unknown argument with the usage code"; else
    no "analyze.sh exited $an_rc on an unknown argument, not 2"
  fi
  assert_grep "$TMP/an-bogus.out" '^analyze\.sh: ERROR — ' \
    "and it names itself, with the same ERROR prefix every other refusal carries"

  an_rc=0
  bash "$ANALYZE" --manifest "$ANALYZE_MANIFEST" --out >"$TMP/an-noop.out" 2>&1 || an_rc=$?
  if [ "$an_rc" -eq 2 ]; then ok "analyze.sh rejects a dropped --out operand with the usage code"; else
    no "analyze.sh exited $an_rc on a dropped --out operand, not 2"
  fi

  # An --out that mkdir cannot create must not exit 1: 1 is the MISMATCH code on this path too.
  an_rc=0
  bash "$ANALYZE" --manifest "$ANALYZE_MANIFEST" --out "-L/escaped" \
    >"$TMP/an-mal.out" 2>&1 || an_rc=$?
  if [ "$an_rc" -eq 2 ]; then
    ok "analyze.sh refuses an option-shaped --out with the usage code, never the mismatch code"
  else
    no "analyze.sh exited $an_rc on an option-shaped --out — a usage mistake impersonating a verdict"
  fi
  # `-L/escaped` is a legitimate relative path once `--` stops mkdir reading it as an option, so
  # analyze.sh creating it is correct, not a leak — the assertion is only that the dash never turns
  # into an option. It is created relative to the caller's cwd, so it is cleaned up here rather
  # than left in whatever directory the suite was launched from.
  rm -rf -- "-L"
  # An --out that genuinely CANNOT be created is the case the exit code has to get right: a bare
  # `mkdir -p "$out"` under `set -e` exits 1 — the MISMATCH code — carrying mkdir's own message.
  : > "$TMP/an-blocker"
  an_rc=0
  bash "$ANALYZE" --manifest "$ANALYZE_MANIFEST" --out "$TMP/an-blocker/sub" \
    >"$TMP/an-unwritable.out" 2>&1 || an_rc=$?
  if [ "$an_rc" -eq 2 ]; then
    ok "analyze.sh exits 2 when --out cannot be created, never the mismatch code"
  else
    no "analyze.sh exited $an_rc on an uncreatable --out — an IO failure impersonating a divergence"
  fi
  assert_grep "$TMP/an-unwritable.out" '^analyze\.sh: ERROR — cannot create the --out directory' \
    "and it names itself rather than leaking mkdir's own message"
else
  no "analyze.sh or the kit manifest was not found — its exit-vocabulary cases were skipped, which is a suite failure, not a pass"
fi

echo ""
echo "=== $pass passed, $fail failed ==="
if [ "$fail" -ne 0 ]; then
  echo "wf-sandbox-testing mechanism-signal selfcheck: FAIL" >&2
  exit 1
fi
echo "wf-sandbox-testing mechanism-signal selfcheck: PASS"
