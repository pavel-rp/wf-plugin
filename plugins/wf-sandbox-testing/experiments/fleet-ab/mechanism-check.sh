#!/usr/bin/env bash
# mechanism-check.sh — regression check: do this experiment's DECLARED mechanism signals still
# reproduce the counts and shape labels of the committed transcript inventory?
#
# READ-ONLY over the evidence. Offline, host-side only: it reads per-arm transcript archives and
# the committed inventory, writes nothing but its own output under --out, and never touches
# results/ — which is untouchable output AND this check's oracle.
#
# Usage:
#   mechanism-check.sh --arm A=<run-dir> --arm B=<run-dir> \
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
usage: mechanism-check.sh --arm <label>=<run-dir> [...] --inventory <transcript-inventory.json>
                          --out <scratch-dir> [--manifest <experiment.json>]
EOF
}

main() {
  local inventory="" out=""
  local -a arm_args=()
  while [ $# -gt 0 ]; do
    case "$1" in
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

  [ "${#arm_args[@]}" -gt 0 ] || die "at least one --arm <label>=<run-dir> is required"
  [ -n "$inventory" ] || die "--inventory <transcript-inventory.json> is required"
  [ -f "$inventory" ] || die "inventory not found: $inventory"
  [ -n "$out" ] || die "--out <scratch-dir> is required (route it under _local/scratch/)"
  [ -f "$EVALUATOR" ] || die "the engine's signal evaluator is missing: $EVALUATOR"

  mkdir -p "$out"
  node "$EVALUATOR" evaluate --manifest "$MANIFEST" "${arm_args[@]}" --out "$out" >/dev/null

  node -e '
    const fs = require("node:fs");
    const observed = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const inv = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

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

    const armLabels = Object.keys(inv.arms ?? {});
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
      if (dupWant !== undefined && pr?.status === "measured" && tf?.status === "measured") {
        check(`arm ${arm} duplicate PR/TF dispatches`, pr.duplicates + tf.duplicates, dupWant);
      }
      // The committed tf_shape prose says the finalize path is inline — mechanically, no separate
      // finalize dispatch record exists.
      if (inv.arms[arm]?.wf375?.tf_shape !== undefined && tf?.status === "measured") {
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
    lines.push(failed === 0
      ? `RESULT: PASS — every checked value reproduces the committed inventory (${rows.filter((r) => r.startsWith("MATCH")).length} checks).`
      : `RESULT: FAIL — ${failed} value(s) diverge from the committed inventory.`);
    console.log(lines.join("\n"));
    process.exit(failed === 0 ? 0 : 1);
  ' "$out/mechanism-signals.json" "$inventory" | tee "$out/mechanism-check.txt"
}

main "$@"
