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
# engine → experiments → <pack> → plugins → repo root. Used only to route scratch under
# `_local/scratch/` (constitution article 9); resolved here so the traversal is stated once.
REPO_ROOT="$(cd "$ENGINE_DIR/../../../.." && pwd)"
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

# drive_field_of <drive-json> <field> — print one field of an arm's drive record, or NOTHING when
# the file is absent/unreadable/unparseable or the field is missing or null.
#
# A missing drive.json is deliberately NOT an error: a single-shot arm legitimately has none. Every
# caller below must therefore treat an empty result as "not measured, with a reason" rather than as
# a zero — the same honest-non-measurement rule the mechanism evaluator applies to the same file.
drive_field_of() {
  [ -f "$1" ] || return 0
  node -e '
    const fs = require("node:fs");
    let doc;
    try { doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch { process.exit(0); }
    // Parseable is not usable: null/3/"text"/[] all parse, and the property access below is where
    // an unguarded reader throws — which would exit 1, the MISMATCH code, for a malformed file.
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) process.exit(0);
    const v = doc[process.argv[2]];
    if (v === undefined || v === null) process.exit(0);
    process.stdout.write(String(v));
  ' "$1" "$2"
}

# measured_total_of <measure-json> — the arm's measured conveyor total, as the cost harness wrote it.
measured_total_of() {
  node -e '
    const fs = require("node:fs");
    const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(doc.totals.cost));
  ' "$1"
}

# extract_projects_root <run-dir> <scratch-dir> [<session-id>] — untar projects-archive.tar.gz if
# present and no explicit --projects-root-<label> override was given; prints the resolved projects
# root.
#
# The archived tree is `projects/<per-workspace-dir>/<session>.jsonl`, but the cost harness resolves
# its inputs as `<root>/<session>.jsonl` and `<root>/<session>/subagents/`. So the root it needs is
# the PER-WORKSPACE directory, one level below `projects/` — returning `projects/` itself made every
# arm fail with "missing transcript path". When a session id is supplied, locate the directory that
# actually holds that session's orchestrator transcript; otherwise keep the previous shape.
extract_projects_root() {
  local run_dir="$1" scratch="$2" sid="${3:-}"
  local archive="$run_dir/projects-archive.tar.gz"
  [ -f "$archive" ] || { echo "analyze.sh: no projects-archive.tar.gz under $run_dir (pass --projects-root-<label> explicitly)" >&2; return 2; }
  mkdir -p "$scratch"
  tar -C "$scratch" -xzf "$archive"
  if [ -n "$sid" ]; then
    local hit
    hit="$(find "$scratch" -type f -name "${sid}.jsonl" -print -quit 2>/dev/null || true)"
    if [ -n "$hit" ]; then dirname "$hit"; return 0; fi
    echo "analyze.sh: no ${sid}.jsonl anywhere under the extracted archive from $run_dir" >&2
    return 2
  fi
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

  # --- operator-policy invariance ---------------------------------------------------------------
  # The scripted operator that resolves human-decision gates is a HELD-CONSTANT actor: if two arms
  # ran under different decision policies, every delta below is confounded by that difference and no
  # amount of care in the cost harness recovers it. So this fails loudly, before any measurement, and
  # names both the arms and their hashes.
  #
  # An arm that recorded NO hash is reported as such, never folded into "matching": treating a
  # missing value as agreement is precisely how an arm that predates the field would silently pass
  # for invariant. It is a stated gap, not a pass and not a hard failure — a run legitimately has no
  # hash when it drove no gates under a build that predates the policy file.
  local -a policy_hashes=() policy_missing=()
  local ph
  for n in "${!ARM_LABELS[@]}"; do
    ph="$(drive_field_of "${run_dirs[$n]}/drive.json" operator_policy_sha256)"
    policy_hashes[$n]="$ph"
    [ -n "$ph" ] || policy_missing+=("${ARM_LABELS[$n]}")
  done
  local distinct_policies
  distinct_policies="$(printf '%s\n' ${policy_hashes[@]+"${policy_hashes[@]}"} \
    | { grep -v '^$' || true; } | LC_ALL=C sort -u | wc -l | tr -d ' ')"
  if [ "$distinct_policies" -gt 1 ]; then
    local policy_detail=""
    for n in "${!ARM_LABELS[@]}"; do
      policy_detail="$policy_detail arm ${ARM_LABELS[$n]}=${policy_hashes[$n]:-<none recorded>}"
    done
    die "the arms did not all carry the same operator policy, so their comparison would be between different decision policies:$policy_detail"
  fi
  if [ "${#policy_missing[@]}" -gt 0 ]; then
    echo "analyze.sh: NOTE — no operator_policy_sha256 recorded for arm(s): ${policy_missing[*]} — policy invariance is NOT established for them; reported here rather than counted as matching." >&2
  fi

  # --- per-arm measurement ----------------------------------------------------------------------
  for n in "${!ARM_LABELS[@]}"; do
    l="${ARM_LABELS[$n]}"
    # The `|| die` is not decoration. Under `set -e` an uncaught throw inside the inline reader
    # (a missing run.json, malformed JSON) kills the script at the assignment with node's raw stack
    # and **exit 1** — the MISMATCH code — before the emptiness guard below is ever reached. That is
    # the same IO-failure-impersonating-a-verdict this file guards the two node HELPER invocations
    # against; the inline readers were the unnoticed half of it.
    local sid; sid="$(session_id_of "${run_dirs[$n]}/run.json")" \
      || die "could not read arm $l's run.json at ${run_dirs[$n]}/run.json (its own error is above)"
    [ -n "$sid" ] || die "could not resolve arm $l's measured session id from ${run_dirs[$n]}/run.json"
    if [ -z "${proj_roots[$n]}" ]; then
      # Constitution article 9: scratch lives under `_local/scratch/`, never a system temp dir.
      # Same fallback shape as the engine selfcheck — if the repo scratch area is unavailable
      # (running the engine outside a checkout) a system temp dir is better than not running.
      local scratch
      if mkdir -p "$REPO_ROOT/_local/scratch" 2>/dev/null; then
        scratch="$(mktemp -d "$REPO_ROOT/_local/scratch/analyze-projects.XXXXXX")"
      else
        scratch="$(mktemp -d)"
      fi
      proj_roots[$n]="$(extract_projects_root "${run_dirs[$n]}" "$scratch" "$sid")"
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
    ' "$out/measure-$base.json" "$out/measure-$against.json" "$base" "$against" | tee -a "$out/totals-comparison.txt" \
      || die "the totals comparison for arm $against vs arm $base failed (its own error is above)"
  done

  # --- conveyor cost excluding vs including the scripted operator -------------------------------
  # The figures above EXCLUDE every operator session by construction, not by filtering: each operator
  # is its own `claude -p` session and `measure --session` resolves exactly one session tree. So the
  # including-operator figure is produced by ADDING the recorded operator cost to the measured total.
  #
  # This APPENDS. The comparison block above is left exactly as it was — it is the measured number,
  # and restating it under a second heading would invite reading one of the two as a correction.
  local -a arm_excl=() arm_incl=() arm_opcost=() arm_opsess=() arm_drive=()
  local excl opc ops
  for n in "${!ARM_LABELS[@]}"; do
    l="${ARM_LABELS[$n]}"
    excl="$(measured_total_of "$out/measure-$l.json")" \
      || die "could not read arm $l's measured total from $out/measure-$l.json (its own error is above)"
    opc="$(drive_field_of "${run_dirs[$n]}/drive.json" operator_cost_usd)"
    ops="$(drive_field_of "${run_dirs[$n]}/drive.json" operator_sessions)"
    arm_excl[$n]="$excl"
    if [ -n "$opc" ] && [ -n "$ops" ]; then
      arm_drive[$n]=1; arm_opcost[$n]="$opc"; arm_opsess[$n]="$ops"
      arm_incl[$n]="$(awk -v a="$excl" -v b="$opc" 'BEGIN { printf "%.10g", a + b }')"
    else
      # Not measured, with a reason — never an assumed operator cost of zero. An arm whose drive
      # record is absent or predates these fields did not report "no operator ran"; it reported
      # nothing, and the two read identically only if this branch invents a number.
      arm_drive[$n]=0; arm_opcost[$n]=""; arm_opsess[$n]=""; arm_incl[$n]=""
    fi
  done

  {
    echo ""
    echo "=== conveyor cost excluding vs including the scripted operator ==="
    echo "Excluding is the measured figure above, unchanged. Including adds drive.json's recorded"
    echo "operator_cost_usd — the operator runs as its own session, so it is never inside the measured"
    echo "total. An arm with no drive record reports the operator side as not measured, never as \$0."
    for n in "${!ARM_LABELS[@]}"; do
      l="${ARM_LABELS[$n]}"
      if [ "${arm_drive[$n]}" = 1 ]; then
        printf 'arm %s: excluding operator $%s | including operator $%s  (%s operator session(s), $%s)\n' \
          "$l" "$(awk -v v="${arm_excl[$n]}" 'BEGIN { printf "%.2f", v }')" \
          "$(awk -v v="${arm_incl[$n]}" 'BEGIN { printf "%.2f", v }')" \
          "${arm_opsess[$n]}" "$(awk -v v="${arm_opcost[$n]}" 'BEGIN { printf "%.2f", v }')"
      else
        printf 'arm %s: excluding operator $%s | including operator NOT MEASURED — no operator cost in drive.json under %s (the record is absent, unreadable, or predates these fields), so the operator cost is unknown rather than zero\n' \
          "$l" "$(awk -v v="${arm_excl[$n]}" 'BEGIN { printf "%.2f", v }')" "${run_dirs[$n]}"
      fi
    done
    local bi ai
    for k in "${!COMPARE_BASES[@]}"; do
      base="${COMPARE_BASES[$k]}"; against="${COMPARE_AGAINSTS[$k]}"
      bi="$(index_of_label "$base")"; ai="$(index_of_label "$against")"
      if [ "${arm_drive[$bi]}" = 1 ] && [ "${arm_drive[$ai]}" = 1 ]; then
        awk -v ca="${arm_incl[$bi]}" -v cb="${arm_incl[$ai]}" -v bl="$base" -v al="$against" \
            -v sa="${arm_opsess[$bi]}" -v sb="${arm_opsess[$ai]}" 'BEGIN {
              d = cb - ca
              printf "delta including operator (%s - %s): $%.2f", al, bl, d
              if (ca != 0) printf " (%.1f%%)", (d / ca) * 100
              printf "  [%s: %s operator session(s), %s: %s]\n", bl, sa, al, sb
            }'
      else
        printf 'delta including operator (%s - %s): NOT MEASURED — %s\n' "$against" "$base" \
          "at least one endpoint arm recorded no operator cost, and a delta over an unknown addend is not a bound"
      fi
    done
  } | tee -a "$out/totals-comparison.txt"

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
