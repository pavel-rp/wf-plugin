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

KIT_DIR="$(cd "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The CLI entry, never the module: mechanism-signals.mjs is import-pure and self-executes nothing,
# so invoking it directly would exit 0 having written no mechanism-signals.json — and this script
# would then read the previous run's file, or fail on an absent one, either way reporting on
# evidence it did not produce.
EVALUATOR="$KIT_DIR/../engine/mechanism-signals.cli.mjs"
MANIFEST="$KIT_DIR/experiment.json"

die() { echo "mechanism-check.sh: ERROR — $*" >&2; exit 2; }

# Every missing-operand path routes through here. No flag reads its operand through bash's
# error-if-unset parameter expansion any more — the acceptance grep for this task asserts that not
# one such read survives in this file, in code or in prose, which is why it is not spelled literally.
#
# That expansion exits **1**, with bash's own bare "parameter null or not set" on stderr and no
# mention of this script. 1 is this script's documented MISMATCH code, so dropping a flag's operand
# told the caller that the evidence diverged from the committed inventory — a usage mistake
# impersonating a verdict, in the one tool whose entire job is to report honestly. Exit 2 (usage/IO),
# named as an error, keeps the exit vocabulary meaning what it says: 0 pass, 1 mismatch, 2 usage/IO.
die_usage() { echo "mechanism-check.sh: ERROR — $*" >&2; usage; exit 2; }

# need_operand <flag> <remaining-arg-count> — asserts the flag was given something to consume.
need_operand() { [ "$2" -ge 2 ] || die_usage "$1 requires an operand"; }

# canonicalize_path <path> <what> — resolve the WHOLE path physically into $RESOLVED_PATH, symlinks
# and all, creating nothing. `<what>` names the path in any refusal, so the same routine serves both
# sides of the containment guard without either one borrowing the other's error text.
#
# BOTH sides go through here. Resolving only the caller's --out and comparing it against a raw
# protected path is a guard that compares two different kinds of string: if results/ (or any
# component above it) is itself a link, the resolved --out lands on the physical target, the raw
# prefix never matches, and the refusal silently stops refusing. The asymmetry, not the spelling of
# any one input, was the defect — so there is now one resolver and no unresolved side.
#
# It sets a global rather than echoing, deliberately: `die` inside a command substitution would exit
# only the subshell, leaving the caller running on an empty path — a refusal that does not refuse.
RESOLVED_PATH=""
canonicalize_path() {
  local p="$1" what="$2" hops=0 target dir
  # Strip trailing slashes on EVERY iteration — the strip is part of the resolution loop's
  # invariant, not a preprocessing step. `[ -L "linky/" ]` is false (POSIX resolves a trailing
  # slash through the link), so a slash-terminated leaf walks past the loop, keeps its unresolved
  # link path, misses the containment case, and reaches `mkdir -p`, which follows the link into
  # results/. Stripping once was not enough: a link whose own target TEXT ends in `/` re-introduces
  # the slash from inside the loop body — the third distinct input class through this same door.
  # Root `/` is preserved: it is the one path whose trailing slash is the path.
  while :; do
    while [ "$p" != "/" ] && [ "${p%/}" != "$p" ]; do p="${p%/}"; done
    # Follow a symlinked LEAF to what it actually names. This is the component the old construction
    # left raw. `readlink` (one hop, POSIX) is looped rather than `readlink -f` (GNU-only), and the
    # loop is bounded so a symlink cycle is an error instead of a hang.
    [ -L "$p" ] || break
    hops=$((hops + 1))
    [ "$hops" -le 32 ] || die "$what resolves through more than 32 symlinks (a cycle?): $1"
    target="$(readlink -- "$p")"
    case "$target" in
      /*) p="$target";;
      *)  p="$(dirname -- "$p")/$target";;
    esac
  done
  # Post-condition, asserted rather than assumed. Resolution is complete only when the leaf is
  # neither a symlink nor slash-terminated; three rounds of this guard were each closed by
  # enumerating one more input spelling, and each time a fourth spelling walked through. This
  # refuses on the property itself, so an unresolved path fails closed here instead of reaching
  # the containment case carrying a raw link.
  if [ -L "$p" ] || { [ "$p" != "/" ] && [ "${p%/}" != "$p" ]; }; then
    die "$what could not be fully resolved (still a symlink or slash-terminated): $1"
  fi
  # Every `dirname`/`basename` here passes `--`. Without it a path whose first character is `-` is
  # eaten as an option: the utility prints its own `invalid option` on stderr — with no
  # `mechanism-check.sh: ERROR —` prefix to identify the source — and the failure surfaces as exit
  # 1, this script's MISMATCH code. A malformed operand would then read to the caller as "the
  # evidence diverged from the committed inventory", which is the exact impersonation the exit
  # vocabulary exists to prevent.
  # `cd --` matters as much as `dirname --`. With the dirname guarded but the cd not, an operand
  # like `-L/escaped` yields the parent `-L`, which `cd` reads as its OWN option — and `cd` with no
  # operand goes to $HOME. Resolution then "succeeded" against a directory the caller never named,
  # and the whole check ran to `RESULT: PASS` at exit 0 on the wrong tree. Guarding one utility in
  # a pipeline of three only moves the door.
  dir="$(cd -- "$(dirname -- "$p")" 2>/dev/null && pwd -P)" \
    || die "$what's parent directory does not exist: $(dirname -- "$p")"
  # `pwd -P` resolved every component of the parent, and the loop above resolved the leaf, so the
  # leaf is being appended to an already-physical path and is itself no longer a symlink.
  RESOLVED_PATH="$dir/$(basename -- "$p")"
}

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
      --run-*) need_operand "$1" $#; arm_args+=("$1" "$2"); shift 2;;
      --arm) need_operand "$1" $#; arm_args+=(--arm "$2"); shift 2;;
      --arm=*) arm_args+=(--arm "${1#*=}"); shift;;
      --inventory) need_operand "$1" $#; inventory="$2"; shift 2;;
      --inventory=*) inventory="${1#*=}"; shift;;
      --out) need_operand "$1" $#; out="$2"; shift 2;;
      --out=*) out="${1#*=}"; shift;;
      --manifest) need_operand "$1" $#; MANIFEST="$2"; shift 2;;
      --manifest=*) MANIFEST="${1#*=}"; shift;;
      -h|--help) usage; exit 0;;
      *) die_usage "unknown argument '$1'";;
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
  # guard away from the directory it exists to protect.
  #
  # BOTH SIDES ARE CANONICALIZED IN FULL, through the one resolver — including a leaf written with a
  # trailing slash, which defeated the first version of this guard by making the `-L` test false.
  # Two earlier forms each left one side raw. The first resolved only `dirname "$out"` and
  # re-appended the raw `basename`, so an --out that was ITSELF a symlink into results/ compared as
  # its own literal name and was handed to `mkdir -p`, which followed it. The second fixed that but
  # built the PROTECTED side raw — `$(cd "$KIT_DIR" && pwd -P)/results` resolves the parent and
  # appends the `results` leaf unresolved — so if results/ is a link, the resolved --out lands on
  # its physical target, the prefix comparison fails, and the guard waves the write through. Both
  # were the same defect: comparing a resolved path against an unresolved one.
  #
  # The resolution still happens WITHOUT creating anything: `mkdir -p` runs only after the refusal,
  # so a rejected --out never leaves a directory behind inside the tree the check must not write to.
  local kit_results resolved_out
  canonicalize_path "$KIT_DIR/results" "the experiment's results/"
  kit_results="$RESOLVED_PATH"
  canonicalize_path "$out" "--out"
  resolved_out="$RESOLVED_PATH"
  refuse_if_inside_results() {
    [ "$1" != "$kit_results" ] || die "--out is the experiment's results/ ($1) — that directory is this check's oracle and must not be written; route --out under _local/scratch/"
    case "$1/" in
      "$kit_results"/*) die "--out is inside the experiment's results/ ($1) — that directory is this check's oracle and must not be written; route --out under _local/scratch/";;
    esac
  }
  refuse_if_inside_results "$resolved_out"
  # Both of these leak their own exit status otherwise, and 1 is this script's MISMATCH code — an
  # unwritable --out or a crashed evaluator would read to the caller as "the evidence diverged".
  mkdir -p "$resolved_out" || die "cannot create the --out directory: $resolved_out"
  # Re-assert AFTER creation, against the now-existing directory resolved afresh. The check above
  # decided on a path; this one decides on the directory that actually exists at that path, so a
  # component swapped between the two — or any residue of a resolution this script got wrong — is
  # caught before a single byte is written, rather than being assumed away.
  canonicalize_path "$resolved_out" "--out"
  refuse_if_inside_results "$RESOLVED_PATH"
  resolved_out="$RESOLVED_PATH"

  node "$EVALUATOR" evaluate --manifest "$MANIFEST" "${arm_args[@]}" --out "$resolved_out" >/dev/null \
    || die "the signal evaluator failed over the supplied run archives (see its stderr above) — this is a tool/input failure, not a divergence from the committed inventory"

  node -e '
    const fs = require("node:fs");
    // An unreadable or malformed input is an IO/usage error (exit 2), never the mismatch code —
    // and it must not be reported as a divergence, which would blame the evidence for a bad path.
    // Parseable is not the same as usable. `null`, `3`, and `"text"` are all valid JSON documents
    // that parse without throwing, and every one of them then blew up on the first property access
    // downstream — an uncaught TypeError, so a raw Node stack and exit 1, the MISMATCH code. A
    // malformed inventory announced itself as a divergence in the evidence. The shape is asserted
    // here, at the one place both inputs are read, rather than at each use.
    const readJson = (p, what) => {
      let doc;
      try {
        doc = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch (e) {
        process.stderr.write(`mechanism-check.sh: ERROR — ${what} is not readable/parseable JSON (${p}): ${e.message}\n`);
        process.exit(2);
      }
      if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
        process.stderr.write(`mechanism-check.sh: ERROR — ${what} parsed, but is not a JSON object (${p}) — got ${doc === null ? "null" : Array.isArray(doc) ? "an array" : typeof doc}\n`);
        process.exit(2);
      }
      return doc;
    };
    // EVERY report write goes through here — both the normal verdict and the zero-comparisons
    // error path. Exclusive create, never a follow, for the same reason the evaluator uses
    // writeNoFollow: the --out DIRECTORY is canonicalized and containment-checked, but that says
    // nothing about a file path inside it, and a report path planted as a symlink into results/
    // would send this write straight through the guard and into the committed oracle. rmSync
    // unlinks the link itself rather than its target and is a no-op when nothing is there, so
    // re-running into the same --out still works; "wx" then refuses if anything reappears.
    //
    // The write is guarded so its failure exits 2, not 1. An uncaught throw here would land on the
    // default node handler — a raw stack and exit 1, the MISMATCH code of this script — so an
    // unwritable report path would announce itself as a divergence in the evidence.
    const writeReport = (text) => {
      const p = process.argv[3];
      try {
        fs.rmSync(p, { force: true });
        const fd = fs.openSync(p, "wx");
        try {
          fs.writeFileSync(fd, text);
        } finally {
          fs.closeSync(fd);
        }
      } catch (e) {
        process.stderr.write(`mechanism-check.sh: ERROR — cannot write the report to ${p}: ${e && e.message ? e.message : e}\n`);
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
       "prose naming the finalize path; its mechanical content (no separate finalize dispatch record) is checked as dispatch presence WHEN the evidence can carry that assertion — read the finalize dispatch presence row, which states MATCH or SKIP for every arm"],
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
        // A not-measured signal gets its OWN row kind. It is not a MATCH — nothing was compared —
        // and it is not a MISMATCH either: the evidence did not diverge from the oracle, it was
        // never able to answer. Rendering it as either one is a claim the run cannot support.
        //
        // It does not count toward `failed`. A committed inventory value cannot be corrected after
        // the fact, so a signal that CANNOT be evaluated over the archives says nothing about
        // whether that value was right — failing the run on it would report a divergence the run
        // never observed. The narrowing is REPORTED with its reason and the run still passes on
        // what it did measure — the same narrow-and-report discipline the NARROWED block above
        // already applies to editorial inventory content.
        //
        // No claim is made here about WHY any particular committed value is what it is. An earlier
        // draft of this comment asserted that two committed wf374_* counts were themselves
        // artifacts of the presence defect; the real run disproves it (both measure over a basis of
        // 29/38 and 38/40 — genuine zeros), and mechanism-check/recorded-run.md records that.
        if (res.status !== "measured") {
          rows.push(`NOT-MEASURED  arm ${arm} ${sig}: ${res.reason} — the inventory commits ${JSON.stringify(want)}, which this run cannot confirm or refute`);
          continue;
        }
        // A NEGATIVE observation over incomplete evidence is not a finding. `basis > 0` makes a
        // POSITIVE count sound — a count is a valid lower bound however many records were mute — but
        // an observed 0 says "this did not happen" only when every record that was dropped could
        // have been the thing being claimed absent. `basis_reason` (the evaluator narrowed the
        // basis) and `stream_malformed_lines` (part of the stream never parsed) are the two ways
        // that stops holding, and both are stamped on the result precisely so this consumer can see
        // them. Reading neither is what let a stream with 50 of 51 lines unparseable still report
        // MATCH and PASS. Only the zero is skipped: a positive count is still checked either way.
        const partial = res.basis_reason ?? (res.stream_malformed_lines
          ? `${res.stream_malformed_lines} unparseable line(s) in the record stream — the count was taken over an incomplete stream`
          : null);
        if (res.count === 0 && partial) {
          rows.push(`SKIP   arm ${arm} ${sig}: observed 0 over incomplete evidence (${partial}) — absence of evidence, not evidence of absence`);
          continue;
        }
        check(`arm ${arm} ${sig}`, res.count, want);
      }
      // Dispatch-shape labels: the committed "no duplicate PR/TF dispatch" reading.
      const dupWant = inv.arms[arm]?.wf375?.duplicate_pr_or_tf_dispatches;
      const pr = obsArm.signals?.wf375_pr_dispatch, tf = obsArm.signals?.wf375_tf_dispatch;
      // Both derived checks below account for EVERY state, including the not-measured one. An
      // unmeasured input must produce a visible SKIP row, never silence: the NARROWED block prints
      // unconditionally and points at the finalize dispatch presence row for the mechanical content
      // of tf_shape, so a silently absent row would make that standing claim false.
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
      } else if (tf.presence === "absent" && (tf.basis_reason || tf.stream_malformed_lines)) {
        // `presence: "absent"` IS the negative assertion, so it takes the same partial-evidence rule
        // the counts above take — and it takes it harder, because there is no positive reading of
        // "absent" to fall back on. A "present" verdict needs no guard: one matching record proves it.
        rows.push(`SKIP   arm ${arm} finalize dispatch presence: observed "absent" over incomplete evidence (${tf.basis_reason ?? `${tf.stream_malformed_lines} unparseable line(s) in the record stream`}) — absence of evidence, not evidence of absence`);
      } else {
        check(`arm ${arm} finalize dispatch presence`, tf.presence, "absent");
      }
    }

    // The loop above is driven by the INVENTORY'"'"'s arm keys, so an arm that WAS evaluated but has no
    // committed counterpart produces no MATCH, no SKIP and no narrowing row — it vanishes, and the
    // run still prints PASS. That is the same silent disappearance the declared-signal sweep below
    // closes, and it needs the same mirror: every EVALUATED arm is accounted for too, not just every
    // committed one. Demonstrated with an inventory trimmed to arm A: `PASS … (1 checks)` with all
    // nine of arm B'"'"'s results in no row at all.
    for (const arm of Object.keys(observed.arms ?? {})) {
      if (armLabels.includes(arm)) continue;
      rows.push(`SKIP   arm ${arm}: evaluated, but the committed inventory carries no counterpart arm`);
    }

    const dmap = new Map();
    for (const d of observed.deltas ?? []) dmap.set(`${d.signal}|${d.base}|${d.against}`, d);
    for (const [sig, field] of DELTAS) {
      const want = inv.deltas_B_minus_A?.[field];
      const d = dmap.get(`${sig}|A|B`);
      if (want === undefined) { rows.push(`SKIP   delta ${sig}: no committed counterpart`); continue; }
      if (!d) { rows.push(`SKIP   delta ${sig}: not computed in this run`); continue; }
      // Same rule as the per-arm counts above: a delta whose endpoints could not be measured is
      // reported as not measured, never as divergence. A delta over an unmeasurable endpoint is not
      // a number that disagrees with the oracle — it is no number at all.
      if (d.status !== "measured") {
        rows.push(`NOT-MEASURED  delta ${sig}: ${d.reason} — the inventory commits ${JSON.stringify(want)}, which this run cannot confirm or refute`);
        continue;
      }
      // The same partial-evidence rule as the counts, applied to EVERY delta rather than only a zero
      // one. The counts guard the negative reading because a count over a narrowed basis is still a
      // lower bound; a DIFFERENCE of two lower bounds is bounded in neither direction, so no reading
      // of it survives. Without this, two unsound zeros still combined into a confident
      // `observed=0 committed=0` — the same false green, one derivation further out.
      if (d.basis_reason) {
        rows.push(`SKIP   delta ${sig}: computed over incomplete evidence (${d.basis_reason})`);
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
    // The evaluator stamps every arm with the count of lines it could not parse, and stamps the same
    // degradation onto each result taken from that arm, with the stated intent that "a consumer
    // reading one result must be able to see that its number was computed over an incomplete
    // stream". This is the consumer, and until now it read neither field — a stream with 50 of 51
    // lines unparseable still printed MATCH and PASS with the degradation mentioned nowhere. The
    // SKIP rule above stops an incomplete stream ASSERTING a zero; this block is what stops it being
    // invisible on the checks that legitimately still ran.
    const degraded = [];
    for (const arm of Object.keys(observed.arms ?? {})) {
      const n = observed.arms[arm].malformed_lines;
      if (n) degraded.push(`  - arm ${arm}: ${n} unparseable line(s) — every count taken from this arm is a lower bound, not a total`);
    }
    lines.push(degraded.length ? "DEGRADED INPUT (counts below were taken over an incomplete stream):" : "DEGRADED INPUT: none — every record stream parsed in full.");
    lines.push(...degraded);
    lines.push("");
    // A run that compared nothing is not a pass. Reaching here with zero MATCH rows means every
    // binding fell through to SKIP, so the oracle asserted nothing about this evidence — an input
    // error, reported as such rather than dressed up as agreement.
    const matched = rows.filter((r) => r.startsWith("MATCH")).length;
    const nothingCompared = failed === 0 && matched === 0;
    lines.push(nothingCompared
      ? "RESULT: ERROR — zero values were compared; every binding fell through to SKIP, so this run asserts nothing."
      : failed === 0
        ? `RESULT: PASS — every checked value reproduces the committed inventory (${matched} checks).`
        : `RESULT: FAIL — ${failed} value(s) diverge from the committed inventory.`);
    // Written by the reporter itself rather than piped through `tee`: a mid-run failure would leave
    // tee having already truncated the report to zero bytes, destroying the previous record of a
    // run, for a reason that has nothing to do with the comparison.
    const text = `${lines.join("\n")}\n`;
    writeReport(text);
    process.stdout.write(text);
    // `process.exitCode`, never `process.exit()`. Node stdout is ASYNC on a pipe: `process.exit()`
    // tears the process down with the queue unflushed, cutting output at the pipe buffer (65536
    // bytes) — and the `RESULT:` line, the one line a caller greps, is at the END of the report, so
    // it is the first thing lost while the exit code still reads as a clean verdict. Setting the
    // code and letting the process end on its own drains the queue first. The on-disk report was
    // never affected (writeReport is synchronous and runs first); only the piped copy was.
    //
    // The ERROR path is folded into the same single write for the same reason — it was a second
    // write-then-exit with the identical hazard, and splitting the two paths is what left it there.
    process.exitCode = nothingCompared ? 2 : failed === 0 ? 0 : 1;
  ' "$resolved_out/mechanism-signals.json" "$inventory" "$resolved_out/mechanism-check.txt"
}

main "$@"
