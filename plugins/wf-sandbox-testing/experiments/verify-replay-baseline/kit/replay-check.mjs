#!/usr/bin/env node
// replay-check.mjs — judge a replayed arm round by round, and compare two arms pairwise.
//
// **Model:** claude-fable-5-1
//
// Reads a BASE result set and an AGAINST result set of the same shape and, for every audit
// round in BASE, reports whether AGAINST reproduced its verdict, its blocking set, and its stop
// decision. A round AGAINST did not replay (no record, or not replayable) is reported
// NOT-MEASURED — its own row, never a match and never a divergence (the engine's
// honest-non-measurement rule). Exit 1 on any DIVERGE; 0 otherwise.
//
// A result set is either results/baseline.json (the committed expectation), or a directory a
// live replay wrote (`replay-round.sh --out <dir> --arm <label>` → `<dir>/<label>/<task>/round-NN.json`),
// which this script assembles into the same per-item shape and derives the stop decision for
// under the same rule as derive-baseline.mjs.
//
// usage: node replay-check.mjs --against <baseline.json | dir> [--base <baseline.json | dir>]
//                              [--base-label A] [--against-label B] [--report <path>]
//   --base defaults to results/baseline.json.
//   With no live arm directory available (the canned case) `--against results/baseline.json`
//   is the self-compare: every replayable round MATCHes, by construction.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stopDecision } from "./rule.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = resolve(HERE, "..");

function die(msg) { process.stderr.write(`replay-check.mjs: ERROR — ${msg}\n`); process.exit(2); }
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) die(`unexpected operand '${a}'`);
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) die(`option ${a} needs a value`);
    out[a.slice(2)] = v; i++;
  }
  return out;
}

// A live arm directory → the baseline's per-item shape. Rounds a live arm never produced are
// simply absent (→ NOT-MEASURED); the cycle count is taken from the base sequence, since the
// live arm replays rounds one at a time and does not itself run the loop.
function loadSet(p, base) {
  p = resolve(p);
  if (!existsSync(p)) die(`result set not found: ${p}`);
  if (statSync(p).isFile()) return JSON.parse(readFileSync(p, "utf8"));
  const items = [];
  for (const task of readdirSync(p).filter(n => /^[A-Z]+-\d+$|^T\d+$/.test(n)).sort()) {
    const rounds = [];
    for (const f of readdirSync(join(p, task)).filter(n => /^round-\d+\.json$/.test(n)).sort()) {
      const r = JSON.parse(readFileSync(join(p, task, f), "utf8"));
      const baseRound = base?.items?.find(i => i.task === task)?.rounds?.find(x => x.round === r.round);
      const cycles = baseRound ? baseRound.cycles_before : 0;
      rounds.push({
        round: r.round, commit: r.commit, tree: r.tree, replayable: r.body_truncated !== true, verdict: r.verdict,
        blocking_set: { requirements: r.blocking_set.requirements, findings: r.blocking_set.findings.map(i => ({ index: i, capability: r.capability_findings[i].capability, lens: r.capability_findings[i].lens, severity: r.capability_findings[i].severity })), size: r.blocking_set.requirements.length + r.blocking_set.findings.length },
        cycles_before: cycles, stop_decision: stopDecision(r.verdict, cycles),
      });
    }
    items.push({ task, rounds });
  }
  return { name: p, items };
}

const sameSet = (a, b) => a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);

function judge(b, a) {
  if (!a) return { result: "NOT-MEASURED", why: "no replayed record for this round" };
  if (!b.replayable) return { result: "NOT-MEASURED", why: b.not_replayable_reason || "base round not replayable" };
  if (!a.replayable) return { result: "NOT-MEASURED", why: "replayed round not replayable" };
  const diffs = [];
  if (b.verdict !== a.verdict) diffs.push(`verdict ${b.verdict}→${a.verdict}`);
  // Blocking requirements compare as an id set; blocking findings compare as a COUNT of
  // FAIL-severity entries — a live replay re-tags them with the fixture's capability name and
  // may renumber them, so identity is not a stable dimension, but how many block is.
  if (!sameSet(b.blocking_set.requirements, a.blocking_set.requirements)) diffs.push(`blocking requirements [${b.blocking_set.requirements}]→[${a.blocking_set.requirements}]`);
  if (b.blocking_set.findings.length !== a.blocking_set.findings.length) diffs.push(`blocking findings ${b.blocking_set.findings.length}→${a.blocking_set.findings.length}`);
  if (b.stop_decision !== a.stop_decision) diffs.push(`stop '${b.stop_decision}'→'${a.stop_decision}'`);
  return diffs.length ? { result: "DIVERGE", why: diffs.join("; ") } : { result: "MATCH", why: "" };
}

const args = parseArgs(process.argv.slice(2));
if (!args.against) die("--against <baseline.json | live arm dir> is required");
const base = loadSet(args.base || join(KIT_ROOT, "results/baseline.json"));
const against = loadSet(args.against, base);
const bl = args["base-label"] || "base", al = args["against-label"] || "against";

const rows = [];
let match = 0, diverge = 0, notMeasured = 0;
for (const bi of base.items) {
  const ai = against.items.find(i => i.task === bi.task);
  for (const br of bi.rounds) {
    const ar = ai?.rounds?.find(r => r.round === br.round);
    const j = judge(br, ar);
    if (j.result === "MATCH") match++; else if (j.result === "DIVERGE") diverge++; else notMeasured++;
    rows.push(`| ${bi.task} | ${br.round} | ${br.verdict} → ${ar?.verdict ?? "—"} | ${br.blocking_set ? br.blocking_set.size : "—"} → ${ar?.blocking_set ? ar.blocking_set.size : "—"} | ${br.stop_decision} → ${ar?.stop_decision ?? "—"} | **${j.result}**${j.why ? " — " + j.why : ""} |`);
  }
}
const report = [
  `# verify-replay — pairwise round check (${bl} → ${al})`, "",
  `**Base:** \`${args.base || "results/baseline.json"}\` · **Against:** \`${args.against}\``, "",
  `| Task | Round | Verdict (${bl} → ${al}) | Blocking-set size | Stop decision | Result |`, "|---|---|---|---|---|---|",
  ...rows, "",
  `**${match} MATCH · ${diverge} DIVERGE · ${notMeasured} NOT-MEASURED** — a NOT-MEASURED row is neither a match nor a divergence; a zero-divergence result over a set with NOT-MEASURED rows is not a clean bill for those rounds.`, "",
].join("\n");
process.stdout.write(report);
if (args.report) writeFileSync(resolve(args.report), report);
process.exit(diverge ? 1 : 0);
