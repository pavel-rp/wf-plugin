#!/usr/bin/env node
// mechanism-signals.mjs — validate and evaluate a manifest's declared mechanism signals.
//
// Offline, host-side ONLY. Reads per-arm run archives; never touches a container, never spends.
//
// A mechanism signal is a NAMED PREDICATE OVER TRANSCRIPT RECORDS, declared per experiment in the
// manifest's `mechanism_signals[]` slot. The engine carries no experiment literal: which signals
// exist, what they select, and what they mean are all manifest data.
//
// THE PREDICATE VOCABULARY IS FROZEN at exactly the kinds one real consumer's evidence already
// uses — record-type + field-match counting, and dispatch-shape presence. A manifest naming any
// other kind is REJECTED BY NAME rather than guessed at. Nothing richer ships until a second real
// experiment proves it needs more.
//
// Usage:
//   mechanism-signals.mjs validate --manifest <experiment.json>
//   mechanism-signals.mjs evaluate --manifest <experiment.json> --arm <label>=<run-dir> [...]
//                                  [--out <results-dir>]
//
// `evaluate` writes <out>/mechanism-signals.json and <out>/mechanism-signals.txt.

import fs from "node:fs";
import path from "node:path";

// The frozen kind set. Adding to this list is a schema change, not a manifest edit.
export const SIGNAL_KINDS = ["record_match", "dispatch_shape"];

// The match operators a `record_match` clause may use.
const MATCH_OPS = ["equals", "prefix", "contains"];

// The transcript stream's dispatch-record convention. This is ENGINE knowledge about the record
// format — not experiment knowledge — so it lives here and never in a manifest.
const DISPATCH_RECORD = { type: "system", subtype: "task_started" };
const DISPATCH_TYPE_FIELD = "subagent_type";
const DISPATCH_ID_FIELD = "task_id";

// The per-arm record stream an experiment's signals are evaluated over.
const RECORD_STREAM = "transcript.jsonl";

class SignalError extends Error {}

const bad = (msg) => {
  throw new SignalError(msg);
};

// ---------------------------------------------------------------------------------------------
// Validation — every rejection is loud and names the offending slot.
// ---------------------------------------------------------------------------------------------

// A closed slot set, exactly like the rest of the manifest schema: a key the vocabulary does not
// name is rejected, never ignored, so a typo can never read as a working predicate.
const only = (obj, allowed, where) => {
  for (const k of Object.keys(obj)) {
    if (!allowed.includes(k)) {
      bad(`${where} carries unknown key ${JSON.stringify(k)} — the signal vocabulary is frozen (allowed: ${allowed.join(", ")})`);
    }
  }
};

const nonEmptyString = (v) => typeof v === "string" && v !== "";

// A clause `value` is one literal, or a non-empty array of literals meaning "any of" — the shape
// the one real consumer's method block already needs ("finding-contract/finding.contract or ...").
const literalList = (v, where) => {
  if (nonEmptyString(v)) return [v];
  if (Array.isArray(v)) {
    if (v.length === 0) bad(`${where}.value is an empty array — declare at least one literal`);
    for (let i = 0; i < v.length; i++) {
      if (!nonEmptyString(v[i])) bad(`${where}.value[${i}] must be a non-empty string`);
    }
    return v.slice();
  }
  return bad(`${where}.value must be a non-empty string, or a non-empty array of them`);
};

// validateSignals(doc) — returns the normalized signal list, or throws a SignalError naming the
// offending slot. The SINGLE source of the vocabulary's rules: `manifest.sh` reaches it through
// this file's `validate` mode at load, so a manifest defect is caught before any phase runs, and
// `evaluate` reaches it directly — there is no second transcription of the rules to drift from.
export function validateSignals(doc) {
  const signals = doc?.mechanism_signals;
  if (!Array.isArray(signals)) {
    bad("`mechanism_signals` is required and must be an array");
  }

  const seen = new Set();
  const out = [];

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    const at = `mechanism_signals[${i}]`;
    if (s === null || typeof s !== "object" || Array.isArray(s)) bad(`${at} must be an object`);

    if (!nonEmptyString(s.id)) bad(`${at}.id is required and must be a non-empty string`);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(s.id)) {
      bad(`${at}.id ${JSON.stringify(s.id)} must match [A-Za-z0-9][A-Za-z0-9_.-]* (it keys a JSON object and a table row)`);
    }
    if (seen.has(s.id)) bad(`duplicate signal id ${JSON.stringify(s.id)} — ids key the emitted tables and must be unique`);
    seen.add(s.id);

    if (!nonEmptyString(s.kind)) bad(`${at} (id ${JSON.stringify(s.id)}) is missing a non-empty \`kind\``);
    if (!SIGNAL_KINDS.includes(s.kind)) {
      bad(`${at} (id ${JSON.stringify(s.id)}) declares predicate kind ${JSON.stringify(s.kind)}, which is outside the frozen vocabulary (supported: ${SIGNAL_KINDS.join(", ")})`);
    }
    // Required, not decorative: it is the row's human reading in every emitted table, and the
    // slot that carries what the predicate is evidence OF.
    if (!nonEmptyString(s.description)) {
      bad(`${at} (id ${JSON.stringify(s.id)}) is missing a non-empty \`description\` — it is the emitted row's reading`);
    }

    if (s.kind === "record_match") {
      only(s, ["id", "kind", "description", "record", "match"], at);
      const norm = { id: s.id, kind: s.kind, description: s.description, record: null, match: [] };

      if ("record" in s && s.record !== undefined) {
        const r = s.record;
        if (r === null || typeof r !== "object" || Array.isArray(r)) bad(`${at}.record must be an object`);
        only(r, ["type", "subtype"], `${at}.record`);
        if (!nonEmptyString(r.type)) bad(`${at}.record.type is required and must be a non-empty string`);
        if ("subtype" in r && r.subtype !== undefined && !nonEmptyString(r.subtype)) {
          bad(`${at}.record.subtype must be a non-empty string when present`);
        }
        norm.record = { type: r.type, subtype: r.subtype ?? null };
      }

      if ("match" in s && s.match !== undefined) {
        if (!Array.isArray(s.match)) bad(`${at}.match must be an array (it may be omitted or empty)`);
        for (let j = 0; j < s.match.length; j++) {
          const c = s.match[j];
          const cat = `${at}.match[${j}]`;
          if (c === null || typeof c !== "object" || Array.isArray(c)) bad(`${cat} must be an object`);
          only(c, ["field", "op", "value"], cat);
          if (typeof c.field !== "string") {
            bad(`${cat}.field is required and must be a string (a dot path, or "" for the whole record)`);
          }
          if (!nonEmptyString(c.op)) bad(`${cat}.op is required and must be a non-empty string`);
          if (!MATCH_OPS.includes(c.op)) {
            bad(`${cat} declares match operator ${JSON.stringify(c.op)}, which is outside the frozen vocabulary (supported: ${MATCH_OPS.join(", ")})`);
          }
          norm.match.push({ field: c.field, op: c.op, value: literalList(c.value, cat) });
        }
      }

      if (norm.record === null && norm.match.length === 0) {
        bad(`${at} (id ${JSON.stringify(s.id)}) declares neither \`record\` nor \`match\` — it would count every record, which is not a signal`);
      }
      out.push(norm);
      continue;
    }

    // dispatch_shape
    only(s, ["id", "kind", "description", "subagent_type"], at);
    if (!nonEmptyString(s.subagent_type)) {
      bad(`${at} (id ${JSON.stringify(s.id)}) is missing a non-empty \`subagent_type\` — a dispatch-shape signal names the dispatch it looks for`);
    }
    out.push({ id: s.id, kind: s.kind, description: s.description, subagent_type: s.subagent_type });
  }

  return out;
}

// ---------------------------------------------------------------------------------------------
// Record-stream reading
// ---------------------------------------------------------------------------------------------

const fieldOf = (rec, field) => {
  if (field === "") return rec;
  let cur = rec;
  for (const part of field.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[part];
  }
  return cur;
};

const asText = (v) => (typeof v === "string" ? v : JSON.stringify(v));

const clauseMatches = (rec, clause) => {
  const v = fieldOf(rec, clause.field);
  if (v === undefined || v === null) return false;
  const text = asText(v);
  if (text === undefined) return false;
  return clause.value.some((lit) => {
    if (clause.op === "equals") return text === lit;
    if (clause.op === "prefix") return text.startsWith(lit);
    return text.includes(lit);
  });
};

const readStream = (runDir) => {
  const file = path.join(runDir, RECORD_STREAM);
  if (!fs.existsSync(file)) return { file, records: null, malformed: 0 };
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    return { file, records: null, malformed: 0, reason: e.message };
  }
  const records = [];
  let malformed = 0;
  for (const line of raw.split("\n")) {
    if (line.trim() === "") continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Counted, never dropped silently: a stream that is partly unreadable is a fact the
      // emitted provenance states rather than something that quietly shrinks a count.
      malformed += 1;
    }
  }
  return { file, records, malformed };
};

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

const notMeasured = (reason) => ({ status: "not_measured", reason });

const evalRecordMatch = (signal, records) => {
  const sel = signal.record;
  let candidates = records;
  if (sel) {
    candidates = records.filter((r) => r?.type === sel.type && (sel.subtype === null || r?.subtype === sel.subtype));
    if (candidates.length === 0) {
      // A dimension the stream does not carry at all. Reporting 0 here would read as evidence of
      // absence when it is only absence of evidence — so it is reported honestly as not measured.
      const label = sel.subtype === null ? sel.type : `${sel.type}/${sel.subtype}`;
      return notMeasured(`the record stream carries no ${label} record — the record dimension is absent, so a zero count would not be evidence of absence`);
    }
  }

  for (const clause of signal.match) {
    if (clause.field === "") continue; // the whole record is always present
    const carried = candidates.some((r) => fieldOf(r, clause.field) !== undefined);
    if (!carried) {
      return notMeasured(`field ${JSON.stringify(clause.field)} is absent from every candidate record — the field dimension is absent, so a zero count would not be evidence of absence`);
    }
  }

  const matched = candidates.filter((r) => signal.match.every((c) => clauseMatches(r, c)));
  return { status: "measured", count: matched.length, candidates: candidates.length };
};

const evalDispatchShape = (signal, records) => {
  const dispatches = records.filter(
    (r) => r?.type === DISPATCH_RECORD.type && r?.subtype === DISPATCH_RECORD.subtype,
  );
  if (dispatches.length === 0) {
    return notMeasured(`the record stream carries no ${DISPATCH_RECORD.type}/${DISPATCH_RECORD.subtype} record — the dispatch dimension is absent, so a zero count would not be evidence of absence`);
  }
  const mine = dispatches.filter((r) => r?.[DISPATCH_TYPE_FIELD] === signal.subagent_type);
  const ids = new Set(mine.map((r) => r?.[DISPATCH_ID_FIELD]).filter((v) => v !== undefined && v !== null));
  return {
    status: "measured",
    count: mine.length,
    presence: mine.length > 0 ? "present" : "absent",
    // A re-dispatch of the SAME task id — the "duplicate/redundant dispatch" reading.
    duplicates: ids.size === 0 ? mine.length : mine.length - ids.size,
    dispatches: dispatches.length,
  };
};

const evaluateArm = (signals, runDir) => {
  const stream = readStream(runDir);
  const arm = {
    run_dir: runDir,
    source: stream.file,
    records: stream.records === null ? null : stream.records.length,
    malformed_lines: stream.malformed,
    signals: {},
  };
  if (stream.records === null) {
    const reason = `no record stream at ${stream.file}${stream.reason ? ` (${stream.reason})` : ""}`;
    for (const s of signals) arm.signals[s.id] = notMeasured(reason);
    return arm;
  }
  for (const s of signals) {
    arm.signals[s.id] = s.kind === "record_match" ? evalRecordMatch(s, stream.records) : evalDispatchShape(s, stream.records);
  }
  return arm;
};

// ---------------------------------------------------------------------------------------------
// Emission
// ---------------------------------------------------------------------------------------------

const cell = (res) => (res.status === "measured" ? String(res.count) : "not measured");

const renderText = (doc) => {
  const labels = Object.keys(doc.arms);
  const lines = [];
  lines.push(`=== mechanism signals — ${doc.experiment} ===`);
  lines.push("");
  lines.push(`Declared predicates over per-arm transcript records. Vocabulary: ${doc.provenance.vocabulary.join(", ")}.`);
  lines.push('A signal the run data cannot answer is reported "not measured" with a stated reason — never omitted, never invented.');
  lines.push("");
  for (const l of labels) {
    const a = doc.arms[l];
    lines.push(`arm ${l}: ${a.records === null ? "NO RECORD STREAM" : `${a.records} records`}${a.malformed_lines ? `, ${a.malformed_lines} unparseable line(s)` : ""} — ${a.source}`);
  }
  lines.push("");
  lines.push(`| Signal | Kind | ${labels.map((l) => `Arm ${l}`).join(" | ")} | Reading |`);
  lines.push(`|---|---|${labels.map(() => "---:|").join("")}---|`);
  for (const s of doc.signals) {
    const cells = labels.map((l) => cell(doc.arms[l].signals[s.id]));
    lines.push(`| ${s.id} | ${s.kind} | ${cells.join(" | ")} | ${s.description} |`);
  }
  lines.push("");
  for (const s of doc.signals) {
    for (const l of labels) {
      const r = doc.arms[l].signals[s.id];
      if (r.status !== "measured") lines.push(`not measured — ${s.id} / arm ${l}: ${r.reason}`);
    }
  }
  if (doc.signals.some((s) => s.kind === "dispatch_shape")) {
    lines.push("");
    lines.push("dispatch-shape presence:");
    for (const s of doc.signals) {
      if (s.kind !== "dispatch_shape") continue;
      for (const l of labels) {
        const r = doc.arms[l].signals[s.id];
        if (r.status !== "measured") continue;
        lines.push(`  ${s.id} / arm ${l}: ${r.presence} (${r.count} dispatch record(s), ${r.duplicates} duplicate)`);
      }
    }
  }
  if (doc.deltas.length > 0) {
    lines.push("");
    lines.push("declared pairwise deltas (against minus base):");
    for (const d of doc.deltas) {
      lines.push(`  ${d.signal} (${d.against} - ${d.base}): ${d.status === "measured" ? d.delta : `not measured — ${d.reason}`}`);
    }
  }
  return `${lines.join("\n")}\n`;
};

const buildDeltas = (doc, signals, compares) => {
  const out = [];
  for (const c of compares) {
    for (const s of signals) {
      const base = doc.arms[c.base]?.signals?.[s.id];
      const against = doc.arms[c.against]?.signals?.[s.id];
      if (!base || !against) continue;
      if (base.status !== "measured" || against.status !== "measured") {
        out.push({
          signal: s.id,
          base: c.base,
          against: c.against,
          status: "not_measured",
          reason: base.status !== "measured" ? `arm ${c.base}: ${base.reason}` : `arm ${c.against}: ${against.reason}`,
        });
        continue;
      }
      out.push({ signal: s.id, base: c.base, against: c.against, status: "measured", delta: against.count - base.count });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

const loadManifest = (p) => {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    bad(`manifest is not readable/parseable JSON (${p}): ${e.message}`);
  }
  return doc;
};

const parseArgs = (argv) => {
  const out = { manifest: "", out: "", arms: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") out.manifest = argv[++i] ?? "";
    else if (a.startsWith("--manifest=")) out.manifest = a.slice("--manifest=".length);
    else if (a === "--out") out.out = argv[++i] ?? "";
    else if (a.startsWith("--out=")) out.out = a.slice("--out=".length);
    else if (a === "--arm" || a.startsWith("--arm=")) {
      const v = a === "--arm" ? (argv[++i] ?? "") : a.slice("--arm=".length);
      const eq = v.indexOf("=");
      if (eq <= 0) bad(`--arm expects <label>=<run-dir>, got ${JSON.stringify(v)}`);
      out.arms.push({ label: v.slice(0, eq), dir: v.slice(eq + 1) });
    } else bad(`unknown argument ${JSON.stringify(a)}`);
  }
  return out;
};

const main = (argv) => {
  const mode = argv[0];
  if (mode !== "validate" && mode !== "evaluate") {
    process.stderr.write("usage: mechanism-signals.mjs validate|evaluate --manifest <experiment.json> [--arm <label>=<run-dir> ...] [--out <dir>]\n");
    return 2;
  }
  const args = parseArgs(argv.slice(1));
  if (!args.manifest) bad("--manifest <experiment.json> is required");

  const doc = loadManifest(args.manifest);
  const signals = validateSignals(doc);

  if (mode === "validate") {
    process.stderr.write(`mechanism-signals.mjs: ${signals.length} declared signal(s) validate against the frozen vocabulary (${SIGNAL_KINDS.join(", ")})\n`);
    return 0;
  }

  const declared = Array.isArray(doc.arms) ? doc.arms.map((a) => a.label) : [];
  for (const a of args.arms) {
    if (!declared.includes(a.label)) bad(`--arm ${a.label}=... names an arm this manifest does not declare (declared: ${declared.join(", ")})`);
  }

  const result = {
    schemaVersion: 1,
    experiment: doc.name,
    provenance: {
      manifest: path.resolve(args.manifest),
      generated_by: "experiments/engine/mechanism-signals.mjs",
      vocabulary: SIGNAL_KINDS.slice(),
      record_stream: RECORD_STREAM,
    },
    signals,
    arms: {},
    deltas: [],
  };
  for (const a of args.arms) result.arms[a.label] = evaluateArm(signals, a.dir);
  const compares = Array.isArray(doc.compares) ? doc.compares : [];
  result.deltas = buildDeltas(result, signals, compares.filter((c) => result.arms[c.base] && result.arms[c.against]));

  const text = renderText(result);
  if (args.out) {
    fs.mkdirSync(args.out, { recursive: true });
    fs.writeFileSync(path.join(args.out, "mechanism-signals.json"), `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(path.join(args.out, "mechanism-signals.txt"), text);
  }
  process.stdout.write(text);
  return 0;
};

// Run only as a CLI — importing the module (for `validateSignals`) must never execute anything.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    if (e instanceof SignalError) {
      process.stderr.write(`mechanism-signals.mjs: ERROR — ${e.message}\n`);
      process.exit(2);
    }
    throw e;
  }
}
