#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

// USD per million tokens. cacheCreation = 1.25x input (5-minute TTL), cacheRead = 0.1x input.
// Sonnet 5 is carried at its standard $3/$15 list rate, not the promotional $2/$10 running
// through 2026-08-31 — a rate that expires mid-measurement would silently reprice a later
// re-run against an earlier one.
const DEFAULT_PRICES = {
  'claude-opus-5': { input: 5, cacheCreation: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-5': { input: 3, cacheCreation: 3.75, cacheRead: 0.3, output: 15 },
  'claude-opus-4-8': { input: 5, cacheCreation: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-4-6': { input: 3, cacheCreation: 3.75, cacheRead: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 },
  // Transcripts stamp Haiku's dated full id rather than the alias; same model, same rate.
  'claude-haiku-4-5-20251001': { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 },
};
const FIELDS = ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens'];

function fail(message) {
  process.stderr.write(`fleet-cost: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    if (!key?.startsWith('--') || rest[index + 1] === undefined) throw new Error(`invalid argument ${key ?? ''}`);
    options[key.slice(2)] = rest[index + 1];
  }
  return { command, options };
}

function usageMax(target, usage) {
  for (const field of FIELDS) target[field] = Math.max(target[field] ?? 0, Number(usage?.[field] ?? 0));
}

function roleFrom(text, orchestrator) {
  if (orchestrator) return { phase: 'ship orchestration', role: 'ship orchestrator' };
  const value = text.toLowerCase();
  const rules = [
    ['verify', 'audit lens', /auditor|audit lens|correctness|security|consistency|convention|operational/],
    ['verify', 'verify-spec/fix', /verify-spec|verify-fix|verification/],
    ['implement', 'implement', /implement/],
    ['qa', 'qa', /qa-|quality assurance|test plan/],
    ['plan', 'spec/plan/triage', /\bplan\b|planning/],
    ['spec', 'spec/plan/triage', /\bspec\b|specification/],
    ['triage', 'spec/plan/triage', /triage/],
    ['pr', 'bookkeeping', /pull request|\bpr\b/],
    ['finalize', 'bookkeeping', /finalize|\btf\b/],
    ['classify', 'bookkeeping', /classify/],
    ['bookkeeping', 'bookkeeping', /index|branch|commit/],
  ];
  for (const [phase, role, pattern] of rules) if (pattern.test(value)) return { phase, role };
  return { phase: 'unclassified', role: 'unclassified' };
}

function costFor(tokens, prices) {
  return (tokens.input_tokens * prices.input
    + tokens.cache_creation_input_tokens * prices.cacheCreation
    + tokens.cache_read_input_tokens * prices.cacheRead
    + tokens.output_tokens * prices.output) / 1_000_000;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function discover(root, session) {
  const orchestrator = join(root, `${session}.jsonl`);
  try { await stat(orchestrator); } catch { throw new Error(`missing transcript path: ${orchestrator}`); }
  const subagents = join(root, session, 'subagents');
  let names;
  try { names = await readdir(subagents); } catch { throw new Error(`missing transcript path: ${subagents}`); }
  const agents = names.filter((name) => /^agent-.*\.jsonl$/.test(name)).sort().map((name) => join(subagents, name));
  if (agents.length === 0) throw new Error(`missing transcript path: ${join(subagents, 'agent-*.jsonl')}`);
  return [orchestrator, ...agents];
}

async function accountFile(path, orchestrator, pricesByModel) {
  const bytes = await readFile(path);
  const messages = new Map();
  const tools = new Set();
  let rawUsageRecords = 0;
  let naiveCost = 0;
  let model = 'claude-opus-4-8';
  for (const line of bytes.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { continue; }
    if (record.type !== 'assistant' || !record.message?.usage) continue;
    rawUsageRecords += 1;
    model = record.message.model ?? record.model ?? model;
    const prices = pricesByModel[model];
    if (!prices) throw new Error(`no pricing configured for model ${model} in ${path}`);
    const raw = {};
    usageMax(raw, record.message.usage);
    naiveCost += costFor(raw, prices);
    const id = String(record.message.id ?? '');
    if (!id) throw new Error(`assistant usage record has no message.id in ${path}`);
    const aggregate = messages.get(id) ?? {};
    usageMax(aggregate, record.message.usage);
    messages.set(id, aggregate);
    for (const block of record.message.content ?? []) if (block?.type === 'tool_use' && block.id) tools.add(block.id);
  }
  let meta = {};
  try { meta = await readJson(path.replace(/\.jsonl$/, '.meta.json')); } catch { /* optional */ }
  const description = String(meta.description ?? meta.prompt ?? meta.role ?? basename(path));
  // Meta-driven attribution (WF-401): an explicit role+phase in the sidecar meta wins over the
  // heuristic — for the orchestrator too — so a fixture can pin deterministic attribution. With no
  // explicit meta the WF-373 heuristic is byte-for-byte unchanged.
  const attribution = (meta.role && meta.phase)
    ? { phase: String(meta.phase), role: String(meta.role) }
    : roleFrom(description, orchestrator);
  const tokens = Object.fromEntries(FIELDS.map((field) => [field, 0]));
  let firstContext = null;
  let lastContext = null;
  for (const usage of messages.values()) {
    for (const field of FIELDS) tokens[field] += usage[field] ?? 0;
    const context = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    firstContext ??= context;
    lastContext = context;
  }
  const cost = costFor(tokens, pricesByModel[model]);
  return {
    agent: orchestrator ? 'orchestrator' : basename(path, '.jsonl'), model, ...attribution,
    // WF-401 per-child normalization inputs (null when the meta omits them → WF-373 rows unchanged).
    child: meta.child != null ? String(meta.child) : null,
    lens: meta.lens != null ? String(meta.lens) : null,
    seq: Number.isFinite(meta.seq) ? Number(meta.seq) : null,
    messages: messages.size, rawUsageRecords, toolUses: tools.size, tokens,
    firstContext: firstContext ?? 0, lastContext: lastContext ?? 0,
    contextGrowth: (lastContext ?? 0) - (firstContext ?? 0),
    cost, naiveCost, inflation: cost === 0 ? 0 : naiveCost / cost,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    _messageIds: [...messages.keys()], _toolIds: [...tools],
  };
}

function summarize(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const item = map.get(row[key]) ?? { [key]: row[key], agents: 0, messages: 0, cost: 0 };
    item.agents += 1;
    item.messages += row.messages;
    item.cost += row.cost;
    map.set(row[key], item);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || String(a[key]).localeCompare(String(b[key])));
}

// byLens (WF-401): a SUB-projection over only the lens-bearing rows (the five audit lenses), keyed by
// lens name — not a partition of the whole run, so it reconciles to the lens subtotal, not the total.
function summarizeLens(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row.lens) continue;
    const item = map.get(row.lens) ?? { lens: row.lens, agents: 0, messages: 0, cost: 0 };
    item.agents += 1;
    item.messages += row.messages;
    item.cost += row.cost;
    map.set(row.lens, item);
  }
  return [...map.values()].sort((a, b) => b.cost - a.cost || a.lens.localeCompare(b.lens));
}

// reconciliation (WF-401): prove the globally-deduplicated message/tool counts are consistent across
// projections. The agent/phase/role projections PARTITION the run, so each must sum to the global
// unique total; byLens is a subset, so it must sum to the lens-bearing subtotal. A cross-file id
// collision (the same message/tool counted in two transcripts) breaks the partition identity and
// throws — that is the global-dedup guarantee, not a cosmetic assertion.
function reconcile(rows) {
  const globalMessages = new Set();
  const globalTools = new Set();
  for (const row of rows) {
    for (const id of row._messageIds) globalMessages.add(id);
    for (const id of row._toolIds) globalTools.add(id);
  }
  const sumMessages = rows.reduce((s, r) => s + r.messages, 0);
  const sumTools = rows.reduce((s, r) => s + r.toolUses, 0);
  const lensMessages = rows.reduce((s, r) => s + (r.lens ? r.messages : 0), 0);
  const uniqueMessages = globalMessages.size;
  const uniqueTools = globalTools.size;
  const balanced = sumMessages === uniqueMessages && sumTools === uniqueTools;
  if (!balanced) {
    throw new Error(
      `reconciliation imbalance: per-agent message/tool sums (${sumMessages}/${sumTools}) do not equal `
      + `globally-deduplicated uniques (${uniqueMessages}/${uniqueTools}) — a message/tool id is counted in more than one transcript.`,
    );
  }
  return {
    uniqueMessages, uniqueTools,
    byAgentMessages: sumMessages, byPhaseMessages: sumMessages, byRoleMessages: sumMessages,
    byLensMessages: lensMessages, lensSubsetOfTotal: lensMessages <= uniqueMessages,
    balanced,
  };
}

function round(value) { return Number(value.toFixed(6)); }
function rounded(value) {
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]));
  return typeof value === 'number' ? round(value) : value;
}

function sumTokens(rows) {
  const tokens = Object.fromEntries(FIELDS.map((field) => [field, 0]));
  for (const row of rows) for (const field of FIELDS) tokens[field] += row.tokens[field] ?? 0;
  return tokens;
}

async function measure(options) {
  if (!options.session) throw new Error('measure requires --session <id>');
  const root = resolve(options.root ?? process.env.CLAUDE_PROJECTS_ROOT ?? '.');
  const files = await discover(root, options.session);
  const prices = options.prices ? await readJson(resolve(options.prices)) : DEFAULT_PRICES;
  const rows = [];
  for (let index = 0; index < files.length; index += 1) rows.push(await accountFile(files[index], index === 0, prices));
  const reconciliation = reconcile(rows); // throws on a global-dedup imbalance
  const fingerprint = createHash('sha256');
  for (const row of rows) fingerprint.update(`${row.agent}\0${row.sha256}\n`);
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const byLens = summarizeLens(rows);
  const cleanRows = rows.map(({ _messageIds, _toolIds, ...row }) => row);
  const output = rounded({
    schemaVersion: 1,
    provenance: { sessionId: options.session, capturedAt: options['capture-date'] ?? null, files: files.length, agents: rows.length - 1, inputFingerprint: `sha256:${fingerprint.digest('hex')}` },
    totals: {
      cost: total,
      messages: rows.reduce((sum, row) => sum + row.messages, 0),
      rawUsageRecords: rows.reduce((sum, row) => sum + row.rawUsageRecords, 0),
      naiveCost: rows.reduce((sum, row) => sum + row.naiveCost, 0),
      tokens: sumTokens(rows),
    },
    reconciliation,
    byPhase: summarize(rows, 'phase'), byRole: summarize(rows, 'role'), byLens,
    byAgent: cleanRows.sort((a, b) => b.cost - a.cost || a.agent.localeCompare(b.agent)),
  });
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (options.output) {
    const target = resolve(options.output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { flag: 'wx' });
  } else process.stdout.write(text);
}

// --- WF-401 evidence: canonical repository-relative structural evidence + normalized per-child events.

async function treeHash(dir, excludeRe) {
  const entries = [];
  async function walk(current) {
    let names;
    try { names = await readdir(current, { withFileTypes: true }); } catch { return; }
    for (const dirent of names.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(current, dirent.name);
      const rel = relative(dir, full).split(sep).join('/');
      if (excludeRe && excludeRe.test(rel)) continue;
      if (dirent.isDirectory()) await walk(full);
      else if (dirent.isFile()) entries.push([rel, createHash('sha256').update(await readFile(full)).digest('hex')]);
    }
  }
  await walk(dir);
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const h = createHash('sha256');
  for (const [rel, sha] of entries) h.update(`${sha}  ${rel}\n`);
  return `sha256:${h.digest('hex')}`;
}

async function evidence(options) {
  if (!options.session) throw new Error('evidence requires --session <id>');
  const root = resolve(options.root ?? process.env.CLAUDE_PROJECTS_ROOT ?? '.');
  const repoRoot = resolve(options['repo-root'] ?? '.');
  const files = await discover(root, options.session);
  const prices = options.prices ? await readJson(resolve(options.prices)) : DEFAULT_PRICES;
  const rows = [];
  for (let index = 0; index < files.length; index += 1) rows.push(await accountFile(files[index], index === 0, prices));
  const relPath = (p) => relative(repoRoot, p).split(sep).join('/');
  const children = [...new Set(rows.map((r) => r.child).filter(Boolean))].sort();
  const roles = [...new Set(rows.map((r) => r.role))].sort();
  const phases = [...new Set(rows.map((r) => r.phase))].sort();
  const lenses = [...new Set(rows.map((r) => r.lens).filter(Boolean))].sort();
  // Normalize cross-child scheduler interleaving by stable child slot, preserving each child's
  // internal order (seq). Rows without a child (the fleet orchestrator) sort first under slot "".
  const events = rows
    .map((r) => ({ child: r.child ?? '', seq: r.seq ?? 0, phase: r.phase, role: r.role, lens: r.lens, agent: r.agent }))
    .sort((a, b) => a.child.localeCompare(b.child) || a.seq - b.seq || a.agent.localeCompare(b.agent));
  const output = {
    schemaVersion: 1,
    session: options.session,
    childCount: children.length,
    children, roles, phases, lenses,
    structure: files.map(relPath).sort(),
    events,
    treeHash: options.tree ? await treeHash(resolve(options.tree), /(^|\/)reference(\/|$)|op-log\.jsonl$|(^|\/)\.git(\/|$)/) : null,
  };
  // Assertion mode — fail closed when a declared structural invariant is violated.
  const problems = [];
  if (options['expect-children'] != null && children.length !== Number(options['expect-children'])) {
    problems.push(`expected ${options['expect-children']} children, found ${children.length} (${children.join(', ') || 'none'})`);
  }
  if (options['expect-roles']) {
    const want = options['expect-roles'].split(',').map((s) => s.trim()).filter(Boolean);
    const missing = want.filter((r) => !roles.includes(r));
    if (missing.length) problems.push(`missing required roles: ${missing.join(', ')}`);
  }
  if (options['expect-lenses'] != null && lenses.length !== Number(options['expect-lenses'])) {
    problems.push(`expected ${options['expect-lenses']} audit lenses, found ${lenses.length} (${lenses.join(', ') || 'none'})`);
  }
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (options.output) {
    const target = resolve(options.output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { flag: 'wx' });
  } else if (!options.quiet) process.stdout.write(text);
  if (problems.length) {
    process.stdout.write(`evidence assertions failed (${problems.length}):\n${problems.map((p) => `  - ${p}`).join('\n')}\n`);
    process.exitCode = 1;
  }
}

// --- compare: the WF-373 symmetric-tolerance path (unchanged) OR the WF-401 directional band mode.

function compareValues(actual, expected, path, tolerance, differences) {
  if (typeof expected === 'number') {
    const delta = Math.abs((actual ?? NaN) - expected);
    const allowed = Math.abs(expected) * tolerance;
    if (!Number.isFinite(actual) || delta > allowed) differences.push(`${path}: expected ${expected}, actual ${actual}, delta ${delta}`);
    return;
  }
  if (Array.isArray(expected)) {
    const key = ['agent', 'phase', 'role', 'lens'].find((candidate) => expected.every((item) => item && typeof item === 'object' && candidate in item));
    if (key) {
      const actualByKey = new Map((actual ?? []).map((item) => [item?.[key], item]));
      for (const item of expected) compareValues(actualByKey.get(item[key]), item, `${path}[${key}=${item[key]}]`, tolerance, differences);
    } else {
      for (let index = 0; index < expected.length; index += 1) compareValues(actual?.[index], expected[index], `${path}[${index}]`, tolerance, differences);
    }
    return;
  }
  if (expected && typeof expected === 'object') for (const [key, value] of Object.entries(expected)) compareValues(actual?.[key], value, path ? `${path}.${key}` : key, tolerance, differences);
}

function shapeKeys(doc, arrayKey, itemKey) {
  return [...new Set((doc[arrayKey] ?? []).map((item) => item?.[itemKey]))].sort();
}

function structureShapeDivergence(actual, reference) {
  const problems = [];
  for (const [arrayKey, itemKey] of [['byAgent', 'agent'], ['byPhase', 'phase'], ['byRole', 'role'], ['byLens', 'lens']]) {
    const a = shapeKeys(actual, arrayKey, itemKey).join('|');
    const r = shapeKeys(reference, arrayKey, itemKey).join('|');
    if (a !== r) problems.push(`${arrayKey} shape divergence: actual [${a}] vs reference [${r}]`);
  }
  const aa = actual.provenance?.agents;
  const ra = reference.provenance?.agents;
  if (aa !== ra) problems.push(`agent count divergence: actual ${aa} vs reference ${ra}`);
  return problems;
}

async function compareBand(actual, reference, band) {
  const problems = structureShapeDivergence(actual, reference);
  const breaches = [];
  const at = actual.totals?.tokens ?? {};
  const rt = reference.totals?.tokens ?? {};
  for (const field of FIELDS) {
    const a = Number(at[field] ?? NaN);
    const r = Number(rt[field] ?? NaN);
    if (!Number.isFinite(a) || !Number.isFinite(r)) { breaches.push(`${field}: non-numeric total (actual ${at[field]}, reference ${rt[field]})`); continue; }
    if (r === 0) { if (a !== 0) breaches.push(`${field}: reference 0 but actual ${a}`); continue; }
    const delta = (a - r) / r;
    if (Math.abs(delta) > band) {
      const direction = a > r ? 'over' : 'under';
      breaches.push(`${field}: ${(delta * 100).toFixed(2)}% ${direction} band (actual ${a}, reference ${r}, band ±${(band * 100).toFixed(0)}%)`);
    }
  }
  const all = [...problems, ...breaches];
  if (all.length) {
    process.stdout.write(`out-of-band (${all.length})\n${all.join('\n')}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`band-equal (±${(band * 100).toFixed(0)}% per token field, structure/shape exact)\n`);
  }
}

async function compare(options) {
  if (!options.actual || !options.reference) throw new Error('compare requires --actual and --reference');
  const actual = await readJson(resolve(options.actual));
  const expected = await readJson(resolve(options.reference));
  if (options.band != null) {
    const band = Number(options.band);
    if (!Number.isFinite(band) || band < 0 || band > 1) throw new Error('--band must be between 0 and 1 (e.g. 0.10 for a 10% band)');
    await compareBand(actual, expected, band);
    return;
  }
  const tolerance = Number(options.tolerance ?? 0.01);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 0.01) throw new Error('tolerance must be between 0 and 0.01');
  const differences = [];
  compareValues(actual, expected, '', tolerance, differences);
  if (differences.length) {
    process.stdout.write(`different (${differences.length})\n${differences.join('\n')}\n`);
    process.exitCode = 1;
  } else process.stdout.write(`tolerance-equal (${(tolerance * 100).toFixed(2)}%)\n`);
}

try {
  const { command, options } = parseArgs(process.argv.slice(2));
  if (command === 'measure') await measure(options);
  else if (command === 'evidence') await evidence(options);
  else if (command === 'compare') await compare(options);
  else throw new Error('usage: fleet-cost.mjs measure --session <id> [--root <path>] [--output <path>] | evidence --session <id> [--root <path>] [--repo-root <path>] [--tree <dir>] [--expect-children <n>] [--expect-roles a,b,c] [--expect-lenses <n>] [--output <path>] | compare --actual <json> --reference <json> [--tolerance 0.01 | --band 0.10]');
} catch (error) { fail(error.message); }
