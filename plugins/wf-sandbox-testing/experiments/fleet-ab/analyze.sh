#!/usr/bin/env bash
# analyze.sh — offline, host-side ONLY. Never touches a container, never spends a measured run.
#
# Runs the WF-373 harness (fleet-cost.mjs) over each arm's collected transcripts, reports arm B
# vs arm A in dollars (dedup baked in — charter hard constraint 1), and evaluates the
# pre-registered §7.2 per-mechanism assertion table. Design doc §7.1/§7.2 is the authoritative
# spec for what this computes; this script implements it, never restates the rationale.
#
# Usage:
#   analyze.sh --run-a <run-arm-A-out-dir> --run-b <run-arm-B-out-dir> [--out <results-dir>]
#
# Each <run-arm-*-out-dir> is a run-arm.sh --out directory: it must contain run.json (with
# measured_session.session_id) and either an already-extracted CLAUDE_CONFIG_DIR/projects tree
# (--projects-root override) or projects-archive.tar.gz (extracted here into a scratch dir).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLEET_COST="$SCRIPT_DIR/../../accounting/fleet-cost.mjs"

usage() {
  cat >&2 <<'EOF'
usage: analyze.sh --run-a <out-dir> --run-b <out-dir> [--out <results-dir>]
                   [--projects-root-a <dir>] [--projects-root-b <dir>]
EOF
}

# session_id_of <run-json> — pull measured_session.session_id via a tiny inline node reader
# (no jq dependency assumed present on the analysis host).
session_id_of() {
  node -e '
    const fs = require("node:fs");
    const doc = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    process.stdout.write(String(doc.measured_session?.session_id ?? ""));
  ' "$1"
}

# extract_projects_root <run-dir> <scratch-dir> — untar projects-archive.tar.gz if present and
# no explicit --projects-root override was given; prints the resolved projects root.
extract_projects_root() {
  local run_dir="$1" scratch="$2"
  local archive="$run_dir/projects-archive.tar.gz"
  [ -f "$archive" ] || { echo "analyze.sh: no projects-archive.tar.gz under $run_dir (pass --projects-root-* explicitly)" >&2; return 2; }
  mkdir -p "$scratch"
  tar -C "$scratch" -xzf "$archive"
  find "$scratch" -mindepth 1 -maxdepth 1 -type d | head -n1
}

main() {
  local run_a="" run_b="" out="" proj_a="" proj_b=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --run-a) run_a="${2:?}"; shift 2;;
      --run-a=*) run_a="${1#*=}"; shift;;
      --run-b) run_b="${2:?}"; shift 2;;
      --run-b=*) run_b="${1#*=}"; shift;;
      --out) out="${2:?}"; shift 2;;
      --out=*) out="${1#*=}"; shift;;
      --projects-root-a) proj_a="${2:?}"; shift 2;;
      --projects-root-a=*) proj_a="${1#*=}"; shift;;
      --projects-root-b) proj_b="${2:?}"; shift 2;;
      --projects-root-b=*) proj_b="${1#*=}"; shift;;
      -h|--help) usage; exit 0;;
      *) echo "analyze.sh: unknown argument '$1'" >&2; usage; exit 2;;
    esac
  done
  [ -n "$run_a" ] && [ -d "$run_a" ] || { echo "analyze.sh: --run-a <dir> is required and must exist" >&2; exit 2; }
  [ -n "$run_b" ] && [ -d "$run_b" ] || { echo "analyze.sh: --run-b <dir> is required and must exist" >&2; exit 2; }
  [ -n "$out" ] || out="$SCRIPT_DIR/results"
  mkdir -p "$out"

  local sid_a sid_b
  sid_a="$(session_id_of "$run_a/run.json")"
  sid_b="$(session_id_of "$run_b/run.json")"
  [ -n "$sid_a" ] || { echo "analyze.sh: could not resolve arm A's measured session id from $run_a/run.json" >&2; exit 2; }
  [ -n "$sid_b" ] || { echo "analyze.sh: could not resolve arm B's measured session id from $run_b/run.json" >&2; exit 2; }

  if [ -z "$proj_a" ]; then
    local scratch_a; scratch_a="$(mktemp -d)"
    proj_a="$(extract_projects_root "$run_a" "$scratch_a")"
  fi
  if [ -z "$proj_b" ]; then
    local scratch_b; scratch_b="$(mktemp -d)"
    proj_b="$(extract_projects_root "$run_b" "$scratch_b")"
  fi

  echo "analyze.sh: measuring arm A (session=$sid_a, root=$proj_a)" >&2
  node "$FLEET_COST" measure --session "$sid_a" --root "$proj_a" --output "$out/measure-A.json"
  echo "analyze.sh: measuring arm B (session=$sid_b, root=$proj_b)" >&2
  node "$FLEET_COST" measure --session "$sid_b" --root "$proj_b" --output "$out/measure-B.json"

  # --- dollars-first A/B totals + delta (never fleet-cost's ±band `compare` — that tool is a
  #     regression gate against a FROZEN reference; a large directional delta here is the
  #     expected finding, not a failure, so this reports the number rather than pass/failing it).
  node -e '
    const fs = require("node:fs");
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const ca = a.totals.cost, cb = b.totals.cost;
    const delta = cb - ca;
    const pct = ca === 0 ? null : (delta / ca) * 100;
    console.log("=== arm B vs arm A — totals (dollars, message.id + tool_use-id dedup baked in) ===");
    console.log(`arm A total: $${ca.toFixed(2)}  (${a.provenance.agents} agents, ${a.totals.messages} messages)`);
    console.log(`arm B total: $${cb.toFixed(2)}  (${b.provenance.agents} agents, ${b.totals.messages} messages)`);
    console.log(`delta (B - A): $${delta.toFixed(2)}${pct == null ? "" : ` (${pct.toFixed(1)}%)`}`);
    console.log(delta < 0 ? "=> arm B is CHEAPER than arm A" : delta > 0 ? "=> arm B is MORE EXPENSIVE than arm A (state plainly — never reframe)" : "=> no change");
  ' "$out/measure-A.json" "$out/measure-B.json" | tee "$out/totals-comparison.txt"

  # --- §7.2 per-mechanism assertion table — computed where the cost/evidence data can answer it,
  #     flagged "manual check needed" where it cannot (never invented, never silently skipped).
  node -e '
    const fs = require("node:fs");
    const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    const byAgent = (doc) => doc.byAgent ?? [];
    const rows = (doc, pred) => byAgent(doc).filter(pred);

    const results = [];

    // WF-376/routing: mechanical bookkeeping roles on a cheaper model tier in B; arm A all-opus.
    const bookkeepingB = rows(b, (r) => r.role === "bookkeeping");
    const bookkeepingA = rows(a, (r) => r.role === "bookkeeping");
    const bAllOpusA = bookkeepingA.length > 0 && bookkeepingA.every((r) => r.model === "claude-opus-4-8");
    const anyCheapB = bookkeepingB.some((r) => r.model !== "claude-opus-4-8");
    results.push({
      mechanism: "WF-376/routing",
      assertion: "bookkeeping roles cheaper-tier in B; arm A all-opus",
      status: bookkeepingA.length === 0 || bookkeepingB.length === 0 ? "NOT-MEASURED (no bookkeeping rows in one arm)"
        : (bAllOpusA && anyCheapB) ? "GREEN" : "RED — recorded as indicative only per WF-376 exception",
    });

    // WF-378: max ship-orchestrator context growth stays under the stated ceiling; arm A shows
    // unbounded growth (baseline citation: 422K). The ceiling itself is a project constant this
    // script does not hardcode — read plugins/wf/skills/ship/SKILL.md if a numeric gate is needed;
    // here we only report the observed max so a human applies the stated ceiling.
    const maxCtx = (doc) => Math.max(0, ...rows(doc, (r) => r.role === "ship orchestrator").map((r) => r.lastContext ?? 0));
    results.push({
      mechanism: "WF-378",
      assertion: "max ship-orchestrator context bounded in B vs arm A",
      status: `observed max context — A: ${maxCtx(a)}, B: ${maxCtx(b)} (compare against the ceiling stated in ship/SKILL.md by hand)`,
    });

    // WF-379: zero wf:index subagents in B; arm A baseline cites ~10.
    const indexCount = (doc) => rows(doc, (r) => /index/i.test(r.agent)).length;
    const ia = indexCount(a), ib = indexCount(b);
    results.push({
      mechanism: "WF-379",
      assertion: "zero wf:index subagents in B",
      status: ib === 0 ? `GREEN (arm A: ${ia}, arm B: 0)` : `RED — arm B still shows ${ib} index agent(s) (arm A: ${ia})`,
    });

    // WF-374 (finding-contract refetch dedup) and WF-375 (pr/tf dispatch shape) are NOT
    // computable from cost totals alone — they need a tool-call inventory / dispatch-shape read
    // over the raw transcripts, which is a manual or dedicated-script pass, not this harness.
    results.push({ mechanism: "WF-374", assertion: "zero gated-off lens boots / zero finding-contract refetches", status: "NOT-MEASURED-HERE — requires a tool-call inventory pass over the raw transcripts (see design doc §7.2)" });
    results.push({ mechanism: "WF-375", assertion: "pr/tf dispatch shape + bounded caller-side context", status: "NOT-MEASURED-HERE — requires a transcript dispatch-shape read (see design doc §7.2)" });
    results.push({ mechanism: "WF-377", assertion: "not measurable here — no hooks in either arm", status: "NOT-MEASURABLE-HERE (design doc §3/§7.2) — judged on its own shipped evidence" });

    console.log("\n=== §7.2 per-mechanism assertion table ===");
    for (const r of results) console.log(`- ${r.mechanism}: ${r.assertion}\n    ${r.status}`);

    fs.writeFileSync(process.argv[3], `${JSON.stringify({ schemaVersion: 1, mechanisms: results }, null, 2)}\n`);
  ' "$out/measure-A.json" "$out/measure-B.json" "$out/mechanism-table.json" | tee "$out/mechanism-table.txt"

  echo "analyze.sh: wrote $out/measure-A.json, measure-B.json, totals-comparison.txt, mechanism-table.json/.txt" >&2

  # --- verdict gate reminder (design §9): the aggregate-vs-$114.55 claim is valid ONLY if arm A's
  #     shape validates against the baseline. This harness does not auto-decide that (prose-vs-TS
  #     workload makes NO the likely branch) — it forces the writer through the incomparability
  #     branch of the shipped scaffold so it can never be silently skipped. ------------------------
  local verdict_tmpl="$SCRIPT_DIR/results/verdict-template.md"
  {
    echo ""
    echo "=== verdict gate (design §9 — resolve BEFORE any aggregate-vs-baseline claim) ==="
    echo "Arm A total: $(node -e 'console.log(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).provenance.agents)' "$out/measure-A.json" 2>/dev/null || echo '?') agents."
    echo "Does arm A's shape (agent count / role mix / phase distribution) validate against the"
    echo "\$114.55 baseline? If NO (the likely branch for a prose-vs-TS workload), the"
    echo "aggregate-vs-baseline claim is DROPPED and the umbrella closes on the stronger substitute"
    echo "(controlled A/B delta + §7.2 mechanisms + §7.3 blind quality + per-sub-task deltas)."
    if [ -f "$verdict_tmpl" ]; then
      echo "Fill the verdict via the shipped scaffold, resolving its §0 gate first: $verdict_tmpl"
    else
      echo "WARNING: verdict scaffold missing ($verdict_tmpl) — the §9 fallback branch is unguarded."
    fi
  } | tee -a "$out/totals-comparison.txt" >&2
}

main "$@"
