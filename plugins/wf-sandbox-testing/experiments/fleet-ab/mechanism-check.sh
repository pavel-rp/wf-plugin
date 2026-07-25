#!/usr/bin/env bash
# mechanism-check.sh — regression check: do this experiment's DECLARED mechanism signals still
# reproduce the counts and shape labels of the committed transcript inventory?
#
# READ-ONLY over the evidence. Offline, host-side only: it reads per-arm transcript archives and
# the committed inventory, writes nothing but its own output under --out, and never touches
# results/ — which is untouchable output AND this check's oracle.
#
# Usage:
#   mechanism-check.sh --run-a <run-dir> --run-b <run-dir> \
#                      --inventory <transcript-inventory.json> --out <scratch-dir>
#
# --out must be a scratch directory (the project routes throwaway work to _local/scratch/).
#
# Exit 0 when every checked value matches, 1 on any mismatch, 2 on a usage/IO error.
#
# WHAT IS CHECKED, AND WHAT IS NOT. The inventory carries two kinds of content: values a declared
# predicate emits (counts, dispatch presence, duplicates, deltas) and editorial roll-ups its author
# wrote while reading the stream (the per-group GREEN/MIXED verdict prose, the caller-context
# boolean, the line pointers). Only the first kind is a regression oracle for this vocabulary. The
# check therefore NARROWS to that subset and prints the excluded fields with the reason, every run
# — never a silent pass, never a claim wider than the evidence.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVALUATOR="$KIT_DIR/../engine/mechanism-signals.mjs"
MANIFEST="$KIT_DIR/experiment.json"

die() { echo "mechanism-check.sh: ERROR — $*" >&2; exit 2; }

usage() {
  cat >&2 <<'EOF'
usage: mechanism-check.sh --run-<label> <run-dir> [...] --inventory <transcript-inventory.json>
                          --out <scratch-dir> [--manifest <experiment.json>]

  --run-<label> <run-dir>   per-arm run directory (the engine's own flag convention)
  --arm <label>=<run-dir>   equivalent alias
EOF
}

main() {
  local inventory="" out=""
  local -a arm_args=()
  while [ $# -gt 0 ]; do
    case "$1" in
      # `--run-<label> <dir>` is the pack's per-arm flag convention (manifest.sh's
      # `manifest_run_flag`, consumed by analyze.sh and emitted by run-experiment.sh); it is passed
      # straight through to the evaluator, which parses it natively. `--arm <label>=<dir>` is the
      # equivalent alias.
      --run-*=*) arm_args+=("$1"); shift;;
      --run-*) arm_args+=("$1" "${2:?}"); shift 2;;
      --arm) arm_args+=(--arm "${2:?}"); shift 2;;
      --arm=*) arm_args+=(--arm "${1#*=}"); shift;;
      --inventory) inventory="${2:?}"; shift 2;;
      --inventory=*) inventory="${1#*=}"; shift;;
      --out) out="${2:?}"; shift 2;;
      --out=*) out="${1#*=}"; shift;;
      --manifest) MANIFEST="${2:?}"; shift 2;;
      --manifest=*) MANIFEST="${1#*=}"; shift;;
      -h|--help) usage; exit 0;;
      *) echo "mechanism-check.sh: unknown argument '$1'" >&2; usage; exit 2;;
    esac
  done

  [ "${#arm_args[@]}" -gt 0 ] || die "at least one --run-<label> <run-dir> (or --arm <label>=<run-dir>) is required"
  [ -n "$inventory" ] || die "--inventory <transcript-inventory.json> is required"
  [ -f "$inventory" ] || die "inventory not found: $inventory"
  [ -n "$out" ] || die "--out <scratch-dir> is required (route it under _local/scratch/)"
  [ -f "$EVALUATOR" ] || die "the engine's signal evaluator is missing: $EVALUATOR"
  # --manifest is guarded here alongside the others: without it, a bad path fails inside the `cd`
  # below under `set -e`, exiting 1 — the MISMATCH code — so a typo would read to the caller as
  # "the evidence diverged from the committed inventory".
  [ -f "$MANIFEST" ] || die "manifest not found: $MANIFEST"

  # A typo'd or unmaterialized run dir must be a USAGE error, not a regression verdict — the same
  # guard analyze.sh applies to its own --run-<label> dirs. Without it, a missing directory reads as
  # "every signal not measured" and the check reports FAIL, blaming the evidence for a typo.
  # (The evaluator enforces the same rule; this is the earlier, better-worded failure.)
  local i tok label dir
  for ((i = 0; i < ${#arm_args[@]}; i++)); do
    tok="${arm_args[$i]}"
    case "$tok" in
      # `--arm <label>=<dir>` and `--run-<label> <dir>` each carry their value in the NEXT element;
      # the loop consumes it here so a bare run directory is never re-read as a malformed pair.
      --arm)
        i=$((i + 1))
        tok="${arm_args[$i]:-}"
        label="${tok%%=*}"; dir="${tok#*=}"
        [ -n "$label" ] && [ "$label" != "$tok" ] || die "--arm expects <label>=<run-dir>, got '$tok'"
        ;;
      --run-*=*) label="${tok%%=*}"; label="${label#--run-}"; dir="${tok#*=}";;
      --run-*)
        label="${tok#--run-}"
        i=$((i + 1))
        dir="${arm_args[$i]:-}"
        [ -n "$dir" ] || die "--run-$label expects a run directory"
        ;;
      *) die "unexpected arm token '$tok'";;
    esac
    [ -d "$dir" ] || die "arm $label run directory does not exist: $dir"
  done

  # results/ is simultaneously this check's oracle and untouchable output, and the evaluator writes
  # the same two filenames analyze.sh puts there — so an --out pointing inside it would overwrite
  # committed evidence. Refuse rather than trust the caller.
  #
  # The refusal is anchored on THIS kit's results/ (KIT_DIR is fixed at the script's own location),
  # not on `dirname "$MANIFEST"` — otherwise passing a manifest copy elsewhere would re-anchor the
  # guard away from the directory it exists to protect. Both sides are resolved with `pwd -P`, so a
  # symlink pointing into results/ cannot walk past a purely logical comparison. And the resolution
  # happens WITHOUT creating anything: `mkdir -p` runs only after the refusal, so a rejected --out
  # never leaves a directory behind inside the tree the check must not write to.
  local kit_results resolved_out out_parent
  kit_results="$(cd "$KIT_DIR" && pwd -P)/results"
  out_parent="$(cd "$(dirname "$out")" 2>/dev/null && pwd -P)" || die "--out's parent directory does not exist: $(dirname "$out")"
  resolved_out="$out_parent/$(basename "$out")"
  case "$resolved_out/" in
    "$kit_results"/*) die "--out is inside the experiment's results/ ($resolved_out) — that directory is this check's oracle and must not be written; route --out under _local/scratch/";;
  esac
  mkdir -p "$resolved_out"

  node "$EVALUATOR" evaluate --manifest "$MANIFEST" "${arm_args[@]}" --out "$resolved_out" >/dev/null

  node -e '
    const fs = require("node:fs");
    // An unreadable or malformed input is an IO/usage error (exit 2), never the mismatch code —
    // and it must not be reported as a divergence, which would blame the evidence for a bad path.
    const readJson = (p, what) => {
      try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      } catch (e) {
        process.stderr.write(`mechanism-check.sh: ERROR — ${what} is not readable/parseable JSON (${p}): ${e.message}\n`);
        process.exit(2);
      }
    };
    const observed = readJson(process.argv[1], "the evaluated signal output");
    const inv = readJson(process.argv[2], "the committed inventory");

    // The oracle binding: which declared signal answers which committed inventory field. This is
    // experiment data (it names C024 signals), which is why it lives beside the experiment and
    // never inside the engine.
    const COUNTS = [
      ["wf374_audit_lens_boots",          "wf374", "all_audit_lens_started"],
      ["wf374_gated_off_lens_boots",      "wf374", "gated_off_lens_boots"],
      ["wf374_finding_contract_refetches","wf374", "finding_contract_refetches"],
      ["wf375_pr_dispatch",               "wf375", "pr_task_dispatches"],
      ["wf375_tf_dispatch",               "wf375", "tf_task_dispatches"],
      ["wf375_taskoutput_timeouts",       "wf375", "taskoutput_timeouts"],
      ["wf375_taskoutput_successes",      "wf375", "taskoutput_successes"],
    ];
    const DELTAS = [
      ["wf374_audit_lens_boots",          "wf374_all_audit_lens_started"],
      ["wf374_gated_off_lens_boots",      "wf374_gated_off_lens_boots"],
      ["wf374_finding_contract_refetches","wf374_finding_contract_refetches"],
      ["wf375_pr_dispatch",               "wf375_pr_task_dispatches"],
      ["wf375_tf_dispatch",               "wf375_tf_task_dispatches"],
      ["wf375_taskoutput_timeouts",       "wf375_taskoutput_timeouts"],
    ];
    // Inventory fields deliberately OUTSIDE the oracle, printed every run with the reason.
    const NARROWED = [
      ["arms.<arm>.wf374.verdict / arms.<arm>.wf375.verdict",
       "editorial roll-up prose the inventory author wrote; no frozen predicate emits a verdict label"],
      ["arms.<arm>.wf375.caller_context_bounded",
       "editorial roll-up boolean inferred from the retrieval records; the vocabulary emits the counts, not the inference"],
      ["arms.<arm>.wf375.tf_shape",
       "prose naming the finalize path; its mechanical content (no separate finalize dispatch record) IS checked, as dispatch presence"],
      ["arms.<arm>.*.pointers",
       "line pointers into the stream; the vocabulary counts records, it does not emit line numbers"],
    ];

    const rows = [];
    let failed = 0;
    const check = (label, got, want) => {
      const ok = got === want;
      if (!ok) failed += 1;
      rows.push(`${ok ? "MATCH" : "MISMATCH"}  ${label}: observed=${JSON.stringify(got)} committed=${JSON.stringify(want)}`);
    };

    // An inventory that parses but carries no arms would drive every loop below zero times and land
    // on "PASS — (0 checks)": a green verdict from an oracle that was never consulted. That is the
    // silent pass this whole check exists to prevent, so it is an input error (exit 2), not a pass.
    const armLabels = Object.keys(inv.arms ?? {});
    if (armLabels.length === 0) {
      process.stderr.write(`mechanism-check.sh: ERROR — the committed inventory carries no \`arms\` object (${process.argv[2]}) — there is nothing to check against, which is an input error, not a pass\n`);
      process.exit(2);
    }
    for (const arm of armLabels) {
      const obsArm = observed.arms?.[arm];
      if (!obsArm) { rows.push(`SKIP   arm ${arm}: not evaluated in this run`); continue; }
      for (const [sig, group, field] of COUNTS) {
        const res = obsArm.signals?.[sig];
        const want = inv.arms[arm]?.[group]?.[field];
        if (res === undefined) { rows.push(`SKIP   arm ${arm} ${sig}: signal not declared by this manifest`); continue; }
        if (want === undefined) { rows.push(`SKIP   arm ${arm} ${sig}: no committed counterpart`); continue; }
        if (res.status !== "measured") {
          failed += 1;
          rows.push(`MISMATCH  arm ${arm} ${sig}: not measured (${res.reason}) but the inventory commits ${JSON.stringify(want)}`);
          continue;
        }
        check(`arm ${arm} ${sig}`, res.count, want);
      }
      // Dispatch-shape labels: the committed "no duplicate PR/TF dispatch" reading.
      const dupWant = inv.arms[arm]?.wf375?.duplicate_pr_or_tf_dispatches;
      const pr = obsArm.signals?.wf375_pr_dispatch, tf = obsArm.signals?.wf375_tf_dispatch;
      // Both derived checks below account for EVERY state, including the not-measured one. An
      // unmeasured input must produce a visible SKIP row, never silence: the NARROWED block prints
      // unconditionally and asserts that the mechanical content of tf_shape "IS checked, as dispatch
      // presence", so a silently absent row would make that standing claim false.
      if (dupWant === undefined) {
        rows.push(`SKIP   arm ${arm} duplicate PR/TF dispatches: no committed counterpart`);
      } else if (pr?.status !== "measured" || tf?.status !== "measured") {
        const un = pr?.status !== "measured" ? `wf375_pr_dispatch (${pr?.reason ?? "not evaluated"})` : `wf375_tf_dispatch (${tf?.reason ?? "not evaluated"})`;
        rows.push(`SKIP   arm ${arm} duplicate PR/TF dispatches: ${un} is not measured`);
      } else if (pr.duplicates === null || tf.duplicates === null) {
        // `duplicates` is null when the id dimension is absent; summing that into a number would
        // manufacture a 0 and check it against the oracle as if it had been measured.
        rows.push(`SKIP   arm ${arm} duplicate PR/TF dispatches: duplicates not measured (${(pr.duplicates === null ? pr : tf).duplicates_reason})`);
      } else if (pr.duplicates_reason || tf.duplicates_reason) {
        // A PARTIALLY derived duplicate count is a number over part of the evidence; comparing it to
        // the oracle as if fully derived would report a MATCH the evidence does not support.
        rows.push(`SKIP   arm ${arm} duplicate PR/TF dispatches: partially derived (${pr.duplicates_reason ?? tf.duplicates_reason})`);
      } else {
        check(`arm ${arm} duplicate PR/TF dispatches`, pr.duplicates + tf.duplicates, dupWant);
      }
      // The committed tf_shape prose says the finalize path is inline — mechanically, no separate
      // finalize dispatch record exists.
      if (inv.arms[arm]?.wf375?.tf_shape === undefined) {
        rows.push(`SKIP   arm ${arm} finalize dispatch presence: no committed counterpart`);
      } else if (tf?.status !== "measured") {
        rows.push(`SKIP   arm ${arm} finalize dispatch presence: wf375_tf_dispatch is not measured (${tf?.reason ?? "not evaluated"})`);
      } else {
        check(`arm ${arm} finalize dispatch presence`, tf.presence, "absent");
      }
    }

    const dmap = new Map();
    for (const d of observed.deltas ?? []) dmap.set(`${d.signal}|${d.base}|${d.against}`, d);
    for (const [sig, field] of DELTAS) {
      const want = inv.deltas_B_minus_A?.[field];
      const d = dmap.get(`${sig}|A|B`);
      if (want === undefined) { rows.push(`SKIP   delta ${sig}: no committed counterpart`); continue; }
      if (!d) { rows.push(`SKIP   delta ${sig}: not computed in this run`); continue; }
      if (d.status !== "measured") {
        failed += 1;
        rows.push(`MISMATCH  delta ${sig}: not measured (${d.reason}) but the inventory commits ${JSON.stringify(want)}`);
        continue;
      }
      check(`delta ${sig} (B - A)`, d.delta, want);
    }

    // A DECLARED signal with no entry in the oracle binding above would otherwise vanish from this
    // report entirely — no MATCH, no SKIP, no narrowing row — which is exactly the silent-pass this
    // check exists to prevent. Every declared signal is accounted for, one way or another.
    const bound = new Set([...COUNTS.map(([s]) => s), ...DELTAS.map(([s]) => s)]);
    for (const s of observed.signals ?? []) {
      if (bound.has(s.id)) continue;
      rows.push(`SKIP   ${s.id}: declared, but the committed inventory carries no counterpart field — outside this check'"'"'s oracle`);
    }

    const lines = [];
    lines.push("=== mechanism regression check — declared signals vs the committed transcript inventory ===");
    lines.push("");
    lines.push(`oracle:   ${process.argv[2]}`);
    lines.push(`observed: ${process.argv[1]}`);
    lines.push("");
    lines.push(...rows);
    lines.push("");
    lines.push("NARROWED — committed inventory content this vocabulary does not claim to reproduce:");
    for (const [what, why] of NARROWED) lines.push(`  - ${what}\n      ${why}`);
    lines.push("");
    // A signal the run data cannot answer is stated here too, so a not-measured row can never be
    // mistaken for a checked one.
    const notMeasured = [];
    for (const arm of Object.keys(observed.arms ?? {})) {
      for (const [id, r] of Object.entries(observed.arms[arm].signals ?? {})) {
        if (r.status !== "measured") notMeasured.push(`  - ${id} / arm ${arm}: ${r.reason}`);
      }
    }
    lines.push(notMeasured.length ? "NOT MEASURED in this run (reported, never invented):" : "NOT MEASURED in this run: none.");
    lines.push(...notMeasured);
    lines.push("");
    // A run that compared nothing is not a pass. Reaching here with zero MATCH rows means every
    // binding fell through to SKIP, so the oracle asserted nothing about this evidence — an input
    // error, reported as such rather than dressed up as agreement.
    const matched = rows.filter((r) => r.startsWith("MATCH")).length;
    if (failed === 0 && matched === 0) {
      const text = `${lines.join("\n")}\nRESULT: ERROR — zero values were compared; every binding fell through to SKIP, so this run asserts nothing.\n`;
      fs.writeFileSync(process.argv[3], text);
      process.stdout.write(text);
      process.exit(2);
    }
    lines.push(failed === 0
      ? `RESULT: PASS — every checked value reproduces the committed inventory (${matched} checks).`
      : `RESULT: FAIL — ${failed} value(s) diverge from the committed inventory.`);
    // Written by the reporter itself rather than piped through `tee`: a mid-run failure would leave
    // tee having already truncated the report to zero bytes, destroying the previous record of a
    // run, for a reason that has nothing to do with the comparison.
    const text = `${lines.join("\n")}\n`;
    fs.writeFileSync(process.argv[3], text);
    process.stdout.write(text);
    process.exit(failed === 0 ? 0 : 1);
  ' "$resolved_out/mechanism-signals.json" "$inventory" "$resolved_out/mechanism-check.txt"
}

main "$@"
