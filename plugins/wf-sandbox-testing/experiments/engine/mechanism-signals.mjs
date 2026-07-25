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
//   mechanism-signals.mjs evaluate --manifest <experiment.json> --run-<label> <run-dir> [...]
//                                  [--out <results-dir>]
//
// `--run-<label> <dir>` is the engine's own per-arm flag convention (manifest.sh's
// `manifest_run_flag`, analyze.sh's `--run-a`/`--run-b`); labels resolve case-insensitively against
// the manifest's declared arms, exactly as analyze.sh's `index_of_label` does. `--arm <label>=<dir>`
// is accepted as an equivalent alias for callers that prefer one token per arm.
//
// `evaluate` writes <out>/mechanism-signals.json and <out>/mechanism-signals.txt.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  // BOTH parseable shapes are accepted, matching the run-output contract the engine's own drift
  // guard enforces (run-arm.sh's assert_stream_json) and the pack's established reader normalizes:
  // a whole-file JSON array, or JSON-lines. Reading only one of them would silently report the
  // other as "the record dimension is absent" — blaming the data for a limitation of the reader.
  try {
    const whole = JSON.parse(raw);
    if (Array.isArray(whole)) return { file, records: whole, malformed: 0, shape: "json-array" };
  } catch {
    // Not a single JSON value — the JSON-lines path below is the expected shape.
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
  return { file, records, malformed, shape: "json-lines" };
};

// ---------------------------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------------------------

const notMeasured = (reason) => ({ status: "not_measured", reason });

const evalRecordMatch = (signal, records) => {
  const sel = signal.record;
  const candidates = sel
    ? records.filter((r) => r?.type === sel.type && (sel.subtype === null || r?.subtype === sel.subtype))
    : records;

  // A dimension the stream does not carry at all. Reporting 0 here would read as evidence of
  // absence when it is only absence of evidence — so it is reported honestly as not measured.
  // This guard is deliberately OUTSIDE the selector branch: a signal declaring no `record` selector
  // has the whole stream as its candidate set, so an EMPTY stream is exactly the same absence, and
  // nesting the guard under `if (sel)` would let a selector-less signal report a real zero over a
  // stream that carries nothing at all.
  if (candidates.length === 0) {
    const label = sel ? (sel.subtype === null ? sel.type : `${sel.type}/${sel.subtype}`) : "";
    return notMeasured(
      sel
        ? `the record stream carries no ${label} record — the record dimension is absent, so a zero count would not be evidence of absence`
        : "the record stream carries no records at all — the record dimension is absent, so a zero count would not be evidence of absence",
    );
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
  // The TYPE dimension, guarded exactly as record_match guards a clause field. A dispatch record
  // that carries no `subagent_type` cannot answer "was <this> dispatched?" — so if NOT ONE dispatch
  // in the stream carries the field, a count of 0 and a presence of "absent" would be absence of
  // evidence dressed as evidence of absence. The regression check turns this very value into a
  // positive assertion (`presence === "absent"`), so an unguarded zero here becomes a green verdict
  // over a stream that was never asked the question.
  const typed = dispatches.filter((r) => nonEmptyString(r?.[DISPATCH_TYPE_FIELD]));
  if (typed.length === 0) {
    return notMeasured(`field ${JSON.stringify(DISPATCH_TYPE_FIELD)} is absent from every ${DISPATCH_RECORD.type}/${DISPATCH_RECORD.subtype} record — the dispatch-type dimension is absent, so a zero count would not be evidence of absence`);
  }

  const mine = dispatches.filter((r) => r?.[DISPATCH_TYPE_FIELD] === signal.subagent_type);
  const withId = mine.filter((r) => {
    const v = r?.[DISPATCH_ID_FIELD];
    return v !== undefined && v !== null;
  });
  const ids = new Set(withId.map((r) => r[DISPATCH_ID_FIELD]));

  // A re-dispatch of the SAME task id — the "duplicate/redundant dispatch" reading. It is derived
  // ONLY from records that actually carry the id field: counting an id-less dispatch as a duplicate
  // would invent a number, the same defect the record_match field guard exists to prevent. When
  // dispatches exist but none carries the id, the id dimension is absent and `duplicates` is
  // reported as not measured rather than as a count — count and presence remain measurable.
  const duplicates = mine.length > 0 && withId.length === 0 ? null : withId.length - ids.size;
  const out = {
    status: "measured",
    count: mine.length,
    presence: mine.length > 0 ? "present" : "absent",
    duplicates,
    dispatches: dispatches.length,
  };
  if (duplicates === null) {
    out.duplicates_reason = `field ${JSON.stringify(DISPATCH_ID_FIELD)} is absent from every matching dispatch record — the id dimension is absent, so a zero duplicate count would not be evidence of absence`;
  } else if (mine.length > withId.length) {
    out.duplicates_reason = `derived from the ${withId.length} of ${mine.length} matching dispatch record(s) that carry ${JSON.stringify(DISPATCH_ID_FIELD)}`;
  }
  return out;
};

const evaluateArm = (signals, runDir, rel = (p) => p) => {
  const stream = readStream(runDir);
  const arm = {
    run_dir: rel(runDir),
    source: rel(stream.file),
    records: stream.records === null ? null : stream.records.length,
    malformed_lines: stream.malformed,
    signals: {},
  };
  if (stream.records === null) {
    const reason = `no record stream at ${rel(stream.file)}${stream.reason ? ` (${stream.reason})` : ""}`;
    for (const s of signals) arm.signals[s.id] = notMeasured(reason);
    return arm;
  }
  for (const s of signals) {
    const res = s.kind === "record_match" ? evalRecordMatch(s, stream.records) : evalDispatchShape(s, stream.records);
    // A partly unreadable stream degrades EVERY count taken from it, so the degradation travels on
    // each result rather than only on the arm header — a consumer reading one result must be able
    // to see that its number was computed over an incomplete stream.
    if (stream.malformed > 0) res.stream_malformed_lines = stream.malformed;
    arm.signals[s.id] = res;
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
    lines.push(`arm ${l}: ${a.records === null ? "NO RECORD STREAM" : `${a.records} records`}${a.malformed_lines ? `, ${a.malformed_lines} unparseable line(s) — EVERY count below for this arm is degraded by them` : ""} — ${a.source}`);
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
        const dup = r.duplicates === null ? "duplicates not measured" : `${r.duplicates} duplicate`;
        lines.push(`  ${s.id} / arm ${l}: ${r.presence} (${r.count} dispatch record(s), ${dup})`);
        // The caveat is rendered whenever it exists, not only on the null case: a PARTIALLY derived
        // duplicate count is a real number computed over part of the evidence, and a reader who
        // cannot see that qualification will read it as fully derived.
        if (r.duplicates_reason) lines.push(`    duplicates — ${r.duplicates_reason}`);
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
    // A comparison the manifest DECLARES but this evaluation cannot compute — because one of its
    // endpoint arms was not supplied — is reported not measured, never dropped. Filtering it out
    // would make a declared comparison vanish from the artifact with nothing saying why, which is
    // the omission path the honest-non-measurement rule forbids just as firmly as a fabricated zero.
    const missing = [c.base, c.against].filter((l) => !doc.arms[l]);
    if (missing.length > 0) {
      for (const s of signals) {
        out.push({
          signal: s.id,
          base: c.base,
          against: c.against,
          status: "not_measured",
          reason: `arm ${missing.join(" and arm ")} ${missing.length > 1 ? "were" : "was"} not supplied to this evaluation — the comparison is declared but has no data`,
        });
      }
      continue;
    }
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

const USAGE =
  "usage: mechanism-signals.mjs validate|evaluate --manifest <experiment.json> [--run-<label> <run-dir> ...] [--arm <label>=<run-dir> ...] [--out <dir>]\n";

const parseArgs = (argv) => {
  const out = { manifest: "", out: "", arms: [], help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--manifest") out.manifest = argv[++i] ?? "";
    else if (a.startsWith("--manifest=")) out.manifest = a.slice("--manifest=".length);
    else if (a === "--out") out.out = argv[++i] ?? "";
    else if (a.startsWith("--out=")) out.out = a.slice("--out=".length);
    else if (a === "--arm" || a.startsWith("--arm=")) {
      const v = a === "--arm" ? (argv[++i] ?? "") : a.slice("--arm=".length);
      const eq = v.indexOf("=");
      if (eq <= 0) bad(`--arm expects <label>=<run-dir>, got ${JSON.stringify(v)}`);
      out.arms.push({ label: v.slice(0, eq), dir: v.slice(eq + 1) });
    } else if (/^--run-[^=]+(=|$)/.test(a)) {
      // The engine's own per-arm flag convention (manifest.sh's `manifest_run_flag`). The label is
      // whatever follows `--run-`; it is resolved against the manifest's declared arms below.
      const eq = a.indexOf("=");
      const label = eq === -1 ? a.slice("--run-".length) : a.slice("--run-".length, eq);
      const dir = eq === -1 ? (argv[++i] ?? "") : a.slice(eq + 1);
      if (dir === "") bad(`--run-${label} expects a run directory`);
      out.arms.push({ label, dir });
    } else bad(`unknown argument ${JSON.stringify(a)}`);
  }
  return out;
};

const main = (argv) => {
  const mode = argv[0];
  if (mode === "-h" || mode === "--help") {
    // Usage goes to stderr, as every sibling entry point in this pack does (`usage() { cat >&2 … }`)
    // — and here it is also load-bearing: `evaluate` writes its report to stdout, so usage on stdout
    // would contaminate a captured stream.
    process.stderr.write(USAGE);
    return 0;
  }
  if (mode !== "validate" && mode !== "evaluate") {
    process.stderr.write(USAGE);
    return 2;
  }
  const args = parseArgs(argv.slice(1));
  if (args.help) {
    // Usage goes to stderr, as every sibling entry point in this pack does (`usage() { cat >&2 … }`)
    // — and here it is also load-bearing: `evaluate` writes its report to stdout, so usage on stdout
    // would contaminate a captured stream.
    process.stderr.write(USAGE);
    return 0;
  }
  if (!args.manifest) bad("--manifest <experiment.json> is required");

  const doc = loadManifest(args.manifest);
  const signals = validateSignals(doc);

  if (mode === "validate") {
    // The success line goes to STDOUT, which manifest.sh's only call site redirects to /dev/null
    // (`node "$signal_validator" validate --manifest "$path" >/dev/null`). That redirect is what
    // keeps it off every captured stream — and it matters, because manifest.sh loads a manifest for
    // EVERY phase including --dry-run, and the dry-run parity oracle compares STDOUT (stderr is its
    // ignored class, per experiments/parity/normalization.md). Moving this line to stderr, or
    // dropping the redirect at the call site, would each break that oracle. Only a rejection speaks
    // unredirected, on stderr, where it is meant to be seen.
    process.stdout.write(`mechanism-signals.mjs: ${signals.length} declared signal(s) validate against the frozen vocabulary (${SIGNAL_KINDS.join(", ")})\n`);
    return 0;
  }

  // Arm labels resolve case-insensitively against the manifest's declared arms — the rule
  // manifest.sh pins (uniqueness is checked case-insensitively because every consumer lowercases
  // the label to compose its flags) and analyze.sh's `index_of_label` implements.
  const declared = Array.isArray(doc.arms) ? doc.arms.map((a) => a.label) : [];
  if (args.arms.length === 0) {
    bad("evaluate needs at least one arm: --run-<label> <run-dir> (or --arm <label>=<run-dir>)");
  }
  const bound = new Map();
  for (const a of args.arms) {
    const hit = declared.find((d) => d.toLowerCase() === a.label.toLowerCase());
    if (hit === undefined) {
      bad(`arm ${JSON.stringify(a.label)} is not declared by this manifest (declared: ${declared.join(", ")})`);
    }
    // Two flags resolving to the SAME declared arm is a caller mistake, not a last-one-wins
    // preference: the first arm's whole evaluation would be discarded silently. manifest.sh rejects
    // the case-insensitively colliding label for the manifest's own arm list for the same reason.
    if (bound.has(hit)) {
      bad(`arm ${JSON.stringify(hit)} is bound twice (${bound.get(hit)} and ${a.dir}) — each declared arm takes exactly one run directory`);
    }
    // A run directory that does not exist is a usage error, exactly as analyze.sh treats the same
    // flag. Letting it through would report "every signal not measured" — an evidentiary claim about
    // the run — when the truth is a typo'd path. "Not measured" is reserved for a real run dir whose
    // stream cannot answer the question.
    if (!fs.existsSync(a.dir) || !fs.statSync(a.dir).isDirectory()) {
      bad(`--run-${hit.toLowerCase()} directory does not exist: ${a.dir}`);
    }
    bound.set(hit, a.dir);
    a.label = hit; // normalize to the manifest's own casing so emitted keys match the declaration
  }

  // Emitted paths are relative to the manifest's own folder, never absolute, and always
  // forward-slashed (the pack's other evidence writer normalizes the same way): for a run directory
  // INSIDE the kit, the same evidence analysed from a different checkout produces byte-identical
  // output. The guarantee is deliberately scoped to in-kit run dirs — a run dir outside the kit
  // still resolves to a `..` chain whose length encodes the kit's own depth, so it is marked as
  // out-of-kit rather than pretending to a stability it cannot have.
  const kitDir = path.dirname(path.resolve(args.manifest));
  const rel = (p) => {
    const r = path.relative(kitDir, path.resolve(p)).split(path.sep).join("/");
    return r.startsWith("../") ? `<outside-kit>/${path.basename(path.resolve(p))}` : r;
  };

  const result = {
    schemaVersion: 1,
    experiment: doc.name,
    provenance: {
      manifest: path.basename(path.resolve(args.manifest)),
      generated_by: "experiments/engine/mechanism-signals.mjs",
      vocabulary: SIGNAL_KINDS.slice(),
      record_stream: RECORD_STREAM,
    },
    signals,
    arms: {},
    deltas: [],
  };
  for (const a of args.arms) result.arms[a.label] = evaluateArm(signals, a.dir, rel);
  const compares = Array.isArray(doc.compares) ? doc.compares : [];
  result.compares = compares.map((c) => ({ base: c.base, against: c.against }));
  result.deltas = buildDeltas(result, signals, compares);

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
//
// The comparison MUST go through `fileURLToPath`, never `new URL(import.meta.url).pathname`: a URL
// pathname is PERCENT-ENCODED, so under any install path containing a space (or `#`, `?`, non-ASCII)
// the two sides would never be equal, `main()` would never run, and node would exit 0 having done
// nothing. Every caller treats exit 0 as success — manifest.sh would report that every declared
// signal validates while validating none, and analyze.sh would report it wrote two files that are
// not on disk. A silent no-op inside the tool whose whole purpose is honest measurement is the worst
// failure this file can have, so the decoding is not optional.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
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
