#!/usr/bin/env bash
# analyze.sh — offline, host-side ONLY. Never touches a container, never spends a measured run.
#
# Runs the cost harness (accounting/fleet-cost.mjs) over each declared arm's collected transcripts,
# then reports every pairwise dollar comparison the manifest declares — with the manifest's explicit
# direction pinning each delta's sign convention. There is no hardcoded compare set: N arms and M
# declared comparisons are both data.
#
# Usage:
#   analyze.sh --manifest <experiment.json> --run-<label> <out-dir> [...] [--out <results-dir>]
#              [--projects-root-<label> <dir>]
#
# Each <out-dir> is a run-arm.sh --out directory: it must contain run.json (with
# measured_session.session_id) and either an already-extracted projects tree
# (--projects-root-<label> override) or projects-archive.tar.gz (extracted here into a scratch dir).
# Mechanism signals additionally read that directory's transcript.jsonl; an arm without one has
# every signal reported "not measured" for that arm, with the missing stream stated as the reason.
#
# It then evaluates the manifest's declared mechanism signals — named predicates over each arm's
# transcript records — and emits the mechanism tables the verdict writer needs. There is no
# hardcoded assertion set either: which signals exist and what they select is manifest data, and a
# signal the run data cannot answer is reported "not measured" rather than invented or skipped.
set -euo pipefail

ENGINE_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FLEET_COST="$ENGINE_DIR/../../accounting/fleet-cost.mjs"
# The CLI entry, never the module: mechanism-signals.mjs is import-pure and self-executes nothing,
# so invoking it directly would run no code and exit 0 having written none of the files this script
# then reports it wrote.
MECHANISM_SIGNALS="$ENGINE_DIR/mechanism-signals.cli.mjs"
# shellcheck source=manifest.sh
. "$ENGINE_DIR/manifest.sh"

usage() {
  cat >&2 <<'EOF'
usage: analyze.sh --manifest <experiment.json> --run-<label> <out-dir> [...]
                  [--out <results-dir>] [--projects-root-<label> <dir>]
EOF
}

die() { echo "analyze.sh: ERROR — $*" >&2; exit 2; }

# session_id_of <run-json> — pull measured_session.session_id via a tiny inline node reader
# (no jq dependency assumed present on the analysis host).
session_id_of() {
  node -e '
    const fs = require("node:fs");
    const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(doc.measured_session?.session_id ?? ""));
  ' "$1"
}

# extract_projects_root <run-dir> <scratch-dir> — untar projects-archive.tar.gz if present and no
# explicit --projects-root-<label> override was given; prints the resolved projects root.
extract_projects_root() {
  local run_dir="$1" scratch="$2"
  local archive="$run_dir/projects-archive.tar.gz"
  [ -f "$archive" ] || { echo "analyze.sh: no projects-archive.tar.gz under $run_dir (pass --projects-root-<label> explicitly)" >&2; return 2; }
  mkdir -p "$scratch"
  tar -C "$scratch" -xzf "$archive"
  find "$scratch" -mindepth 1 -maxdepth 1 -type d | head -n1
}

# index_of_label <label> — echo the arm's index, or return non-zero.
index_of_label() {
  local want="${1,,}" i
  for i in "${!ARM_LABELS[@]}"; do
    [ "${ARM_LABELS[$i],,}" = "$want" ] && { echo "$i"; return 0; }
  done
  return 1
}

main() {
  local manifest="" out=""

  local -a argv=("$@")
  local i=0
  while [ "$i" -lt "${#argv[@]}" ]; do
    case "${argv[$i]}" in
      --manifest) i=$((i + 1)); manifest="${argv[$i]:-}";;
      --manifest=*) manifest="${argv[$i]#*=}";;
      -h|--help) usage; exit 0;;
    esac
    i=$((i + 1))
  done
  [ -n "$manifest" ] || { echo "analyze.sh: ERROR — --manifest <experiment.json> is required" >&2; usage; exit 2; }
  manifest_load "$manifest" || exit 2

  # Per-arm run dirs and projects-root overrides, index-aligned with ARM_LABELS.
  local -a run_dirs=() proj_roots=()
  local n
  for n in "${!ARM_LABELS[@]}"; do run_dirs[$n]=""; proj_roots[$n]=""; done

  local flag idx
  while [ $# -gt 0 ]; do
    case "$1" in
      --manifest) shift 2;;
      --manifest=*) shift;;
      --out) [ $# -ge 2 ] || die "--out requires an operand"; out="$2"; shift 2;;
      --out=*) out="${1#*=}"; shift;;
      --projects-root-*=*)
        flag="${1%%=*}"; flag="${flag#--projects-root-}"
        idx="$(index_of_label "$flag")" || die "--projects-root-$flag names an arm this manifest does not declare (declared: ${ARM_LABELS[*]})"
        proj_roots[$idx]="${1#*=}"; shift;;
      --projects-root-*)
        flag="${1#--projects-root-}"
        idx="$(index_of_label "$flag")" || die "--projects-root-$flag names an arm this manifest does not declare (declared: ${ARM_LABELS[*]})"
        [ $# -ge 2 ] || die "--projects-root-$flag requires an operand"; proj_roots[$idx]="$2"; shift 2;;
      --run-*=*)
        flag="${1%%=*}"; flag="${flag#--run-}"
        idx="$(index_of_label "$flag")" || die "--run-$flag names an arm this manifest does not declare (declared: ${ARM_LABELS[*]})"
        run_dirs[$idx]="${1#*=}"; shift;;
      --run-*)
        flag="${1#--run-}"
        idx="$(index_of_label "$flag")" || die "--run-$flag names an arm this manifest does not declare (declared: ${ARM_LABELS[*]})"
        [ $# -ge 2 ] || die "--run-$flag requires an operand"; run_dirs[$idx]="$2"; shift 2;;
      -h|--help) usage; exit 0;;
      *) echo "analyze.sh: ERROR — unknown argument '$1'" >&2; usage; exit 2;;
    esac
  done

  # The output directory belongs to the EXPERIMENT, derived from the manifest — the engine no
  # longer sits beside results/.
  [ -n "$out" ] || out="$RESULTS_DIR"
  # `--` and an explicit failure branch, for the same reason mechanism-check.sh carries them: an
  # --out beginning with a dash is otherwise read by mkdir as its own option, and a bare
  # `mkdir -p "$out"` under `set -e` exits **1** — the MISMATCH code — with mkdir's own message and
  # nothing naming this script. A path typo would read to the caller as a measured divergence.
  mkdir -p -- "$out" || die "cannot create the --out directory: $out"

  # The two node helpers this script drives, checked BEFORE any measurement runs. `node <missing>`
  # exits **1** — the MISMATCH code — carrying node's own module-resolution message, so an engine
  # that was moved, half-installed, or renamed would read to the caller as a measured divergence
  # instead of a broken tool. This is the same 1-vs-2 collision the --out branch above closes,
  # through the other door; both helpers are guarded, never just the one that was noticed.
  [ -r "$FLEET_COST" ] || die "the cost harness is missing or unreadable: $FLEET_COST"
  [ -r "$MECHANISM_SIGNALS" ] || die "the mechanism-signal CLI entry is missing or unreadable: $MECHANISM_SIGNALS"

  local l
  for n in "${!ARM_LABELS[@]}"; do
    l="${ARM_LABELS[$n]}"
    [ -n "${run_dirs[$n]}" ] || die "$(manifest_run_flag "$l") <dir> is required (one per declared arm)"
    [ -d "${run_dirs[$n]}" ] || die "$(manifest_run_flag "$l") directory does not exist: ${run_dirs[$n]}"
  done

  # --- per-arm measurement ----------------------------------------------------------------------
  for n in "${!ARM_LABELS[@]}"; do
    l="${ARM_LABELS[$n]}"
    local sid; sid="$(session_id_of "${run_dirs[$n]}/run.json")"
    [ -n "$sid" ] || die "could not resolve arm $l's measured session id from ${run_dirs[$n]}/run.json"
    if [ -z "${proj_roots[$n]}" ]; then
      local scratch; scratch="$(mktemp -d)"
      proj_roots[$n]="$(extract_projects_root "${run_dirs[$n]}" "$scratch")"
    fi
    echo "analyze.sh: measuring arm $l (session=$sid, root=${proj_roots[$n]})" >&2
    node "$FLEET_COST" measure --session "$sid" --root "${proj_roots[$n]}" --output "$out/measure-$l.json" \
      || die "the cost harness failed measuring arm $l (its own error is above)"
  done

  # --- declared pairwise dollar comparisons -----------------------------------------------------
  # Never fleet-cost's ±band `compare`: that tool is a regression gate against a FROZEN reference,
  # whereas a large directional delta here is the expected finding, not a failure. This reports the
  # number rather than pass/failing it.
  : > "$out/totals-comparison.txt"
  local k base against
  for k in "${!COMPARE_BASES[@]}"; do
    base="${COMPARE_BASES[$k]}"; against="${COMPARE_AGAINSTS[$k]}"
    node -e '
      const fs = require("node:fs");
      const baseLabel = process.argv[3], againstLabel = process.argv[4];
      const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
      const ca = a.totals.cost, cb = b.totals.cost;
      const delta = cb - ca;
      const pct = ca === 0 ? null : (delta / ca) * 100;
      console.log(`=== arm ${againstLabel} vs arm ${baseLabel} — totals (dollars, message.id + tool_use-id dedup baked in) ===`);
      console.log(`arm ${baseLabel} total: $${ca.toFixed(2)}  (${a.provenance.agents} agents, ${a.totals.messages} messages)`);
      console.log(`arm ${againstLabel} total: $${cb.toFixed(2)}  (${b.provenance.agents} agents, ${b.totals.messages} messages)`);
      console.log(`delta (${againstLabel} - ${baseLabel}): $${delta.toFixed(2)}${pct == null ? "" : ` (${pct.toFixed(1)}%)`}`);
      console.log(delta < 0 ? `=> arm ${againstLabel} is CHEAPER than arm ${baseLabel}` : delta > 0 ? `=> arm ${againstLabel} is MORE EXPENSIVE than arm ${baseLabel} (state plainly — never reframe)` : "=> no change");
    ' "$out/measure-$base.json" "$out/measure-$against.json" "$base" "$against" | tee -a "$out/totals-comparison.txt"
  done

  # --- declared mechanism signals ---------------------------------------------------------------
  # Named predicates over each arm's transcript records, declared in the manifest and evaluated
  # here. The engine names no signal, no record literal, and no assertion: an experiment that
  # declares none emits an empty table rather than a special case.
  local -a signal_args=()
  for n in "${!ARM_LABELS[@]}"; do
    signal_args+=("$(manifest_run_flag "${ARM_LABELS[$n]}")" "${run_dirs[$n]}")
  done
  # The CLI entry exits 2 on every failure it can name (see its own header); anything else reaching
  # here is node itself failing, which exits 1. Converting the whole invocation to `die` keeps exit
  # 1 meaning MISMATCH and nothing else on this path.
  node "$MECHANISM_SIGNALS" evaluate --manifest "$MANIFEST_PATH" "${signal_args[@]}" --out "$out" >/dev/null \
    || die "the mechanism-signal evaluator failed (its own error is above)"

  echo "analyze.sh: wrote per-arm measure-<label>.json, totals-comparison.txt, and mechanism-signals.json/.txt under $out" >&2

  # --- verdict gate reminder: the aggregate-vs-reference claim is valid ONLY if the control arm's
  #     shape validates against the reference. This harness does not auto-decide that — it forces
  #     the writer through the shipped scaffold so the gate can never be silently skipped. --------
  local verdict_tmpl="$RESULTS_DIR/verdict-template.md"
  {
    echo ""
    echo "=== verdict gate (resolve BEFORE any aggregate-vs-reference claim) ==="
    echo "Does the control arm's shape (agent count / role mix / phase distribution) validate against"
    echo "the reference this experiment cites? If NO, the aggregate-vs-reference claim is DROPPED and"
    echo "the conclusion rests on the controlled deltas computed above."
    if [ -f "$verdict_tmpl" ]; then
      echo "Fill the verdict via the shipped scaffold, resolving its gate first: $verdict_tmpl"
    else
      echo "WARNING: verdict scaffold missing ($verdict_tmpl) — the fallback branch is unguarded."
    fi
  } | tee -a "$out/totals-comparison.txt" >&2
}

main "$@"
