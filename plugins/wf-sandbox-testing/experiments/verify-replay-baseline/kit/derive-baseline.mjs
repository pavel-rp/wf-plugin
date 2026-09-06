#!/usr/bin/env node
// derive-baseline.mjs — the mechanical per-round replay of the blocking set and the stop rule.
//
// **Model:** claude-fable-5-1
//
// For every round-replay corpus item (corpus/items/verify-replay-*/), walks sequence.json in
// chronological order and derives, per audit round:
//
//   verdict        — the RECORDED verdict token (the model-judged value; never re-derived here)
//   blocking_set   — every FAIL/PARTIAL requirement id + every FAIL-severity capability finding,
//                    i.e. what today's verify-spec treats as shipment-blocking ("`fail` blocks
//                    shipment; `warn` is non-blocking"; "a finding that asserts non-conformance is
//                    a FAIL, exactly like a failed requirement")
//   stop_decision  — what today's /wf:run Phase 3 would name next: PASS → qa-gen; FAIL/PARTIAL →
//                    verify-fix while fewer than 2 verify⇄fix cycles have been spent, else halt
//   cycles_before  — verify⇄fix cycles already spent when the round ran (each earlier non-PASS
//                    audit round heads one cycle); ledger_rounds_before — the rotation-trail
//                    length 04_verify.history.md held when the round ran
//
// and writes results/baseline.json — the expectation every later arm's replay is judged against.
// `--check` re-derives and diffs against the committed file instead (exit 1 on drift), which is
// what selflint.sh and corpus/run.sh call: the baseline can never silently disagree with the
// corpus records it claims to summarize.
//
// Deterministic, dependency-free, no network, no timestamp in the output.
//
// usage: node derive-baseline.mjs [--items <corpus/items>] [--out <results/baseline.json>] [--check]

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, "..");
const PACK_ROOT = resolve(KIT_ROOT, "../..");

const RULE = {
  source: "plugins/wf/skills/run/SKILL.md §Phase 3 (verify-spec PASS → qa-gen; FAIL/PARTIAL → verify-fix; cap at 2 verify⇄fix cycles, then halt and escalate)",
  verify_fix_cycle_cap: 2,
  blocking: "plugins/wf/skills/verify-spec/SKILL.md §Fire the verify phase — `fail` blocks shipment; `warn` is non-blocking; a non-conformance finding is a FAIL like a failed requirement",
};

function die(msg) { process.stderr.write(`derive-baseline.mjs: ERROR — ${msg}\n`); process.exit(2); }

function parseArgs(argv) {
  const out = { check: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") { out.check = true; continue; }
    if (!a.startsWith("--")) die(`unexpected operand '${a}'`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) die(`option ${a} needs a value`);
    out[a.slice(2)] = v; i++;
  }
  return out;
}

function stopDecision(verdict, cyclesBefore) {
  if (verdict === "PASS") return "qa-gen";
  if (cyclesBefore < RULE.verify_fix_cycle_cap) return "verify-fix";
  return `halt — verify⇄fix cap (${RULE.verify_fix_cycle_cap}) exceeded`;
}

export function deriveItem(itemDir) {
  const seqPath = join(itemDir, "sequence.json");
  if (!existsSync(seqPath)) die(`${itemDir}: sequence.json missing`);
  const seq = JSON.parse(readFileSync(seqPath, "utf8"));
  const rounds = [];
  const fixes = [];
  let cycles = 0;
  let ledger = 0;
  for (const rec of seq.records) {
    if (rec.kind === "verify-fix") {
      const r = JSON.parse(readFileSync(join(itemDir, rec.record), "utf8"));
      fixes.push({ seq: rec.seq, after_round: rec.after_round, commit_at_audit: r.commit_at_audit, auto_fixed: r.auto_fixed, awaiting_user: r.awaiting_user, skipped: r.skipped });
      continue;
    }
    const r = JSON.parse(readFileSync(join(itemDir, rec.record), "utf8"));
    const replayable = r.body_truncated !== true;
    rounds.push({
      round: r.round,
      seq: rec.seq,
      commit: r.commit,
      base: r.base,
      tree: r.tree,
      replayable,
      not_replayable_reason: replayable ? null : "body_truncated at the source — header only, no requirement or findings block to feed back",
      verdict: r.verdict,
      requirement_tally: r.requirement_tally,
      finding_tally: r.finding_tally,
      blocking_set: replayable
        ? {
            requirements: r.blocking_set.requirements,
            findings: r.blocking_set.findings.map(i => ({ index: i, capability: r.capability_findings[i].capability, lens: r.capability_findings[i].lens, severity: r.capability_findings[i].severity })),
            size: r.blocking_set.requirements.length + r.blocking_set.findings.length,
          }
        : null,
      cycles_before: cycles,
      ledger_rounds_before: ledger,
      stop_decision: stopDecision(r.verdict, cycles),
    });
    if (r.verdict !== "PASS") cycles += 1;
    ledger += 1;
  }
  return { task: seq.task, item: itemDir.split("/").pop(), source: seq.source, verify_fix_source: seq.verify_fix_source, audit_rounds: rounds.length, replayable_rounds: rounds.filter(r => r.replayable).length, rounds, verify_fix_passes: fixes };
}

export function derive(itemsDir) {
  const names = readdirSync(itemsDir).filter(n => n.startsWith("verify-replay-")).sort();
  if (!names.length) die(`no verify-replay-* item under ${itemsDir}`);
  return {
    name: "verify-replay-baseline",
    derived_by: "plugins/wf-sandbox-testing/experiments/verify-replay-baseline/kit/derive-baseline.mjs",
    provenance: {
      path: "canned",
      reason: "Docker and CLAUDE_CODE_OAUTH_TOKEN were unavailable where this baseline was recorded, so no live replay ran: every per-round expectation below is derived mechanically from the corpus item's recorded round (verdict as recorded; blocking set and stop decision under today's documented rules). kit/replay-round.sh regenerates a live arm when a container is available; replay-check.mjs judges either the same way.",
    },
    rules: RULE,
    items: names.map(n => deriveItem(join(itemsDir, n))),
  };
}

const args = parseArgs(process.argv.slice(2));
const itemsDir = resolve(args.items || join(PACK_ROOT, "corpus/items"));
const outPath = resolve(args.out || join(KIT_ROOT, "results/baseline.json"));
const fresh = JSON.stringify(derive(itemsDir), null, 2) + "\n";

if (args.check) {
  if (!existsSync(outPath)) die(`--check: ${outPath} does not exist — run without --check to record it`);
  const committed = readFileSync(outPath, "utf8");
  if (committed === fresh) {
    const b = JSON.parse(fresh);
    process.stdout.write(`derive-baseline.mjs: baseline consistent — ${b.items.length} item(s), ${b.items.reduce((n, i) => n + i.audit_rounds, 0)} audit round(s), ${b.items.reduce((n, i) => n + i.replayable_rounds, 0)} replayable\n`);
    process.exit(0);
  }
  const a = committed.split("\n"), c = fresh.split("\n");
  let k = 0; while (k < a.length && k < c.length && a[k] === c[k]) k++;
  process.stderr.write(`derive-baseline.mjs: FAIL — results/baseline.json disagrees with the corpus records it summarizes (first difference at line ${k + 1}):\n  committed: ${a[k] ?? "<eof>"}\n  derived:   ${c[k] ?? "<eof>"}\nRe-run without --check to re-record it, and say why in the commit.\n`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, fresh);
const b = JSON.parse(fresh);
process.stdout.write(`derive-baseline.mjs: wrote ${outPath} — ${b.items.length} item(s), ${b.items.reduce((n, i) => n + i.audit_rounds, 0)} audit round(s)\n`);
