#!/usr/bin/env node
// extract-rounds.mjs — transcribe one archived verify history into a corpus item's round records.
//
// **Model:** claude-fable-5-1
//
// Reads a task's rotated `04_verify.history.md` (every prior `/wf:verify-spec` report, newest
// first, per the shared pipeline conventions' artifact-rotation rule) and, optionally, its
// `05_verify-fix.history.md`, and writes one record per audit round into `<item>/rounds/`:
//
//   rounds/round-NN.json  — the round, structured: header fields, every numbered requirement
//                           verdict, every capability-findings entry (ships in the pack)
//   rounds/verify-fix-after-round-NN.json
//                         — a verify-fix pass, when one sits between two audit rounds
//   sequence.json         — the chronological index of every record above
//
// and the verbatim transcripts (`rounds/round-NN.md`, `rounds/verify-fix-after-round-NN.md` —
// the report the replay feeds back) into `<archive>/<item-name>/rounds/`, OUTSIDE the pack:
// `--archive <dir>`, else $WF_CORPUS_ARCHIVE, else the repo-level `corpus-archive/`. A record's
// `transcript` field stays item-relative; consumers resolve it under the archive.
//
// Rounds are ordered chronologically by their `**Audited at:**` field (the history file itself
// is newest-first). Nothing here judges a round: it records. The mechanical replay of the
// blocking set and the stop decision lives in derive-baseline.mjs, beside this file.
//
// Deterministic, dependency-free, no network. Re-runnable: the output is a pure function of the
// two source files, so re-extracting after a source edit rewrites the records in place.
//
// usage: node extract-rounds.mjs --source <04_verify.history.md> --item <item-dir> --task <id>
//                                [--verify-fix <05_verify-fix.history.md>]
//                                [--source-rel <provenance path>] [--verify-fix-rel <path>]
//                                [--archive <transcript archive root>]
//        node extract-rounds.mjs --single <04_verify.md> --task <id> --round <n>
//                                (print ONE replayed round's structured record to stdout — the
//                                live driver's read-back of a fresh /wf:verify-spec report)

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname, basename } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

function die(msg) { process.stderr.write(`extract-rounds.mjs: ERROR — ${msg}\n`); process.exit(2); }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) die(`unexpected operand '${a}'`);
    const eq = a.indexOf("=");
    if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) die(`option ${a} needs a value`);
    out[a.slice(2)] = v; i++;
  }
  return out;
}

// Normalize the two audited-at spellings the histories carry — `2026-09-04 16:14 UTC` and
// `2026-09-04T18:32:40Z` — onto one ISO-8601 UTC instant so rounds sort chronologically.
function isoInstant(raw) {
  const m = /(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?\s*(UTC|Z)?/.exec(raw || "");
  if (!m) return null;
  return `${m[1]}T${m[2]}${m[3] || ":00"}Z`;
}

function headerField(lines, name) {
  const re = new RegExp(`^\\*\\*${name}:\\*\\*\\s*(.*)$`);
  for (const l of lines) { const m = re.exec(l); if (m) return m[1].trim(); }
  return null;
}

// Split a report body on its `## ` headings: { preamble: [...], sections: { name: [...] } }.
function sections(lines) {
  const out = { preamble: [], sections: {}, order: [] };
  let cur = null;
  for (const l of lines) {
    const m = /^## (.+?)\s*$/.exec(l);
    if (m) { cur = m[1]; out.sections[cur] = []; out.order.push(cur); continue; }
    (cur === null ? out.preamble : out.sections[cur]).push(l);
  }
  return out;
}

// A top-level requirement line: `12. [PASS] text` (the verdict token may carry a qualifier
// after a comma, e.g. `[PARTIAL, see below]`). Indented evidence bullets belong to the
// preceding requirement and are kept as its `detail`.
const REQ_RE = /^(\d+)\.\s+\[(PASS|FAIL|PARTIAL|N\/A|UNVERIFIABLE)([^\]]*)\]\s*(.*)$/;

function parseRequirements(lines) {
  const reqs = [];
  for (const l of lines || []) {
    const m = REQ_RE.exec(l);
    if (m) {
      reqs.push({ n: Number(m[1]), verdict: m[2], qualifier: m[3].replace(/^,\s*/, "").trim() || null, text: m[4].trim(), detail: [] });
    } else if (reqs.length && l.trim() !== "") {
      reqs[reqs.length - 1].detail.push(l);
    }
  }
  return reqs;
}

// A capability-findings entry. The histories use three spellings across tasks:
//   - **audit** (correctness-auditor) — [FAIL] …        (lens in parens)
//   - **audit** (correctness, warn) — [WARN] …          (lens + severity hint in parens)
//   - **audit** — [FAIL] …                              (no lens)
//   **author-caps** — [PASS] …                          (unbulleted)
//   - **author-caps** (reference-existence) — clean — … (the fragment's clean token)
// A leading `**audit** (5 lenses dispatched: …)` paragraph is the aggregation header, not a
// finding — its paren text starts with a digit, and it is dropped on that ground alone.
const FINDING_RE = /^(?:-\s+)?\*\*([a-z][a-z0-9-]*)\*\*\s*(?:\(([^)]*)\))?\s*(?:—\s*(.*))?$/;

function parseFindings(lines) {
  const out = [];
  for (const l of lines || []) {
    const m = FINDING_RE.exec(l);
    if (!m) continue;
    const paren = (m[2] || "").trim();
    if (/^\d/.test(paren)) continue;
    const rest = (m[3] || "").trim();
    const lens = paren ? paren.split(",")[0].trim() : null;
    const sev = /^\[([A-Za-z/]+)([^\]]*)\]/.exec(rest);
    let severity, qualifier = null;
    if (sev) { severity = sev[1].toUpperCase(); qualifier = sev[2].replace(/^,\s*/, "").trim() || null; }
    else if (/^clean\b/i.test(rest)) severity = "CLEAN";
    else severity = "NOTE";
    out.push({
      capability: m[1], lens, severity, qualifier,
      blocking: severity === "FAIL",
      text: rest.replace(/^\[[^\]]*\]\s*/, "").slice(0, 240),
    });
  }
  return out;
}

function tally(items, key) {
  const t = {};
  for (const it of items) t[it[key]] = (t[it[key]] || 0) + 1;
  return t;
}

function parseVerifyRound(text) {
  const lines = text.split("\n");
  const s = sections(lines);
  const commitRaw = headerField(lines, "Commit") || "";
  const commit = (/`([0-9a-f]{7,40})`/.exec(commitRaw) || [])[1] || null;
  const base = (/\(base\s+`([0-9a-f]{7,40})`/.exec(commitRaw) || [])[1] || null;
  const treeRaw = headerField(lines, "Tree") || "";
  const verdictRaw = headerField(lines, "Verdict") || "";
  const vm = /^(PASS|FAIL|PARTIAL)\b\s*(.*)$/.exec(verdictRaw);
  const auditedAtRaw = headerField(lines, "Audited at");
  const reqs = parseRequirements(s.sections["Requirements"]);
  const findings = parseFindings(s.sections["Capability findings"]);
  // A round whose body was cut at the source (the histories record one such rotation tooling
  // error) keeps its header and is flagged, never padded: the lint accepts an empty requirement
  // list only under this flag, and the replay skips the round with the flag as its stated reason.
  const bodyTruncated = !("Requirements" in s.sections);
  return {
    kind: "verify-spec",
    body_truncated: bodyTruncated,
    branch: (headerField(lines, "Branch") || "").replace(/`/g, "") || null,
    commit, base,
    tree: /^clean\b/i.test(treeRaw) ? "clean" : (treeRaw ? "dirty" : null),
    tree_detail: treeRaw || null,
    verdict: vm ? vm[1] : null,
    verdict_note: vm ? (vm[2].trim() || null) : (verdictRaw || null),
    audited_by: headerField(lines, "Audited by"),
    audited_at: isoInstant(auditedAtRaw),
    audited_at_raw: auditedAtRaw,
    sections: s.order,
    requirements: reqs.map(({ detail, ...r }) => r),
    requirement_tally: tally(reqs, "verdict"),
    capability_findings: findings,
    finding_tally: tally(findings, "severity"),
    blocking_set: {
      requirements: reqs.filter(r => r.verdict === "FAIL" || r.verdict === "PARTIAL").map(r => r.n),
      findings: findings.map((f, i) => (f.blocking ? i : -1)).filter(i => i >= 0),
    },
  };
}

function parseVerifyFix(text) {
  const lines = text.split("\n");
  const s = sections(lines);
  const count = (name) => {
    const k = Object.keys(s.sections).find(h => h.startsWith(name));
    const m = k && /\((\d+)\)/.exec(k);
    return m ? Number(m[1]) : 0;
  };
  const commitRaw = headerField(lines, "Commit at audit") || "";
  const srcRaw = headerField(lines, "Source report") || "";
  const audited = /audited\s+([0-9T:\- Z]+)/.exec(srcRaw);
  const runAt = headerField(lines, "Run at");
  return {
    kind: "verify-fix",
    branch: (headerField(lines, "Branch") || "").replace(/`/g, "") || null,
    commit_at_audit: (/`([0-9a-f]{7,40})`/.exec(commitRaw) || [])[1] || null,
    source_report_audited_at: audited ? isoInstant(audited[1]) : null,
    run_at: runAt,
    model: headerField(lines, "Model"),
    auto_fixed: count("Auto-fixed"),
    awaiting_user: count("Awaiting user"),
    skipped: count("Skipped"),
    fixed_entries: (s.sections[Object.keys(s.sections).find(h => h.startsWith("Auto-fixed")) || ""] || [])
      .filter(l => /^- \*\*\[FIXED/.test(l)).length,
  };
}

// The history file is a concatenation of whole reports, each opening on its own `# verify-spec:`
// H1. Split on that boundary; every chunk is one round.
function splitReports(text, h1) {
  const re = new RegExp(`^# ${h1}:`, "m");
  const idx = [];
  const lines = text.split("\n");
  lines.forEach((l, i) => { if (re.test(l)) idx.push(i); });
  if (!idx.length) die(`no '# ${h1}:' report heading found in the source`);
  return idx.map((start, k) => lines.slice(start, k + 1 < idx.length ? idx[k + 1] : lines.length).join("\n").replace(/\n+$/, "") + "\n");
}

export { parseVerifyRound, parseVerifyFix, splitReports, isoInstant };

function main() {
const args = parseArgs(process.argv.slice(2));
if (args.single) {
  for (const k of ["task", "round"]) if (!args[k]) die(`--${k} is required with --single`);
  const f = resolve(args.single);
  if (!existsSync(f)) die(`--single not found: ${f}`);
  const rec = { task: args.task, round: Number(args.round), ...parseVerifyRound(readFileSync(f, "utf8")), source: args.single, transcript: null };
  process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
  return;
}
for (const k of ["source", "item", "task"]) if (!args[k]) die(`--${k} is required`);
const source = resolve(args.source);
if (!existsSync(source)) die(`--source not found: ${source}`);
const itemDir = resolve(args.item);
const roundsDir = join(itemDir, "rounds");
const archiveRoot = resolve(args.archive || process.env.WF_CORPUS_ARCHIVE || join(dirname(fileURLToPath(import.meta.url)), "../../../../..", "corpus-archive"));
const transcriptsDir = join(archiveRoot, basename(itemDir), "rounds");
rmSync(roundsDir, { recursive: true, force: true });
mkdirSync(roundsDir, { recursive: true });
rmSync(transcriptsDir, { recursive: true, force: true });
mkdirSync(transcriptsDir, { recursive: true });

const rounds = splitReports(readFileSync(source, "utf8"), "verify-spec")
  .map(md => ({ md, rec: parseVerifyRound(md) }));
for (const r of rounds) if (!r.rec.audited_at) die(`a round carries no parseable **Audited at:** — cannot order it`);
rounds.sort((a, b) => a.rec.audited_at.localeCompare(b.rec.audited_at));

const records = [];
rounds.forEach((r, i) => {
  const n = String(i + 1).padStart(2, "0");
  const rec = { task: args.task, round: i + 1, ...r.rec, source: args["source-rel"] || args.source, transcript: `rounds/round-${n}.md` };
  writeFileSync(join(transcriptsDir, `round-${n}.md`), r.md);
  writeFileSync(join(roundsDir, `round-${n}.json`), JSON.stringify(rec, null, 2) + "\n");
  records.push({ seq: 0, kind: "verify-spec", round: i + 1, at: rec.audited_at, commit: rec.commit, verdict: rec.verdict, record: `rounds/round-${n}.json`, transcript: rec.transcript });
});

if (args["verify-fix"]) {
  const vf = resolve(args["verify-fix"]);
  if (!existsSync(vf)) die(`--verify-fix not found: ${vf}`);
  const passes = splitReports(readFileSync(vf, "utf8"), "verify-fix").map(md => ({ md, rec: parseVerifyFix(md) }));
  passes.forEach((p) => {
    // Place the pass after the audit round it fixed: the round whose audited-at equals the pass's
    // stated source-report audit instant, else the last round at or before that instant.
    const at = p.rec.source_report_audited_at;
    let after = rounds.findIndex(r => r.rec.audited_at === at);
    if (after < 0) { after = -1; rounds.forEach((r, i) => { if (at && r.rec.audited_at <= at) after = i; }); }
    if (after < 0) die(`verify-fix pass could not be placed: no audit round at or before ${at}`);
    const n = String(after + 1).padStart(2, "0");
    const rec = { task: args.task, after_round: after + 1, ...p.rec, source: args["verify-fix-rel"] || args["verify-fix"], transcript: `rounds/verify-fix-after-round-${n}.md` };
    writeFileSync(join(transcriptsDir, `verify-fix-after-round-${n}.md`), p.md);
    writeFileSync(join(roundsDir, `verify-fix-after-round-${n}.json`), JSON.stringify(rec, null, 2) + "\n");
    records.push({ seq: 0, kind: "verify-fix", after_round: after + 1, at: at, commit: p.rec.commit_at_audit, auto_fixed: p.rec.auto_fixed, record: `rounds/verify-fix-after-round-${n}.json`, transcript: rec.transcript });
  });
}

// Chronological sequence: a verify-fix pass sorts immediately after the round it fixed.
records.sort((a, b) => {
  const ra = a.kind === "verify-spec" ? a.round : a.after_round + 0.5;
  const rb = b.kind === "verify-spec" ? b.round : b.after_round + 0.5;
  return ra - rb;
});
records.forEach((r, i) => { r.seq = i + 1; });

const sequence = {
  task: args.task,
  source: args["source-rel"] || args.source,
  verify_fix_source: args["verify-fix"] ? (args["verify-fix-rel"] || args["verify-fix"]) : null,
  extracted_by: "experiments/verify-replay-baseline/kit/extract-rounds.mjs",
  rounds: rounds.length,
  records,
};
writeFileSync(join(itemDir, "sequence.json"), JSON.stringify(sequence, null, 2) + "\n");
process.stdout.write(`extract-rounds.mjs: ${args.task} — ${rounds.length} verify round(s)` + (args["verify-fix"] ? `, ${records.length - rounds.length} verify-fix pass(es)` : "") + ` → ${itemDir}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
