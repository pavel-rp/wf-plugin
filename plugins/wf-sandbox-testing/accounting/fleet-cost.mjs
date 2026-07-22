#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

const DEFAULT_PRICES = {
  'claude-opus-4-8': { input: 5, cacheCreation: 6.25, cacheRead: 0.5, output: 25 },
  'claude-sonnet-4-6': { input: 3, cacheCreation: 3.75, cacheRead: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cacheCreation: 1.25, cacheRead: 0.1, output: 5 },
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
  const attribution = roleFrom(description, orchestrator);
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
    messages: messages.size, rawUsageRecords, toolUses: tools.size, tokens,
    firstContext: firstContext ?? 0, lastContext: lastContext ?? 0,
    contextGrowth: (lastContext ?? 0) - (firstContext ?? 0),
    cost, naiveCost, inflation: cost === 0 ? 0 : naiveCost / cost,
    sha256: createHash('sha256').update(bytes).digest('hex'),
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

function round(value) { return Number(value.toFixed(6)); }
function rounded(value) {
  if (Array.isArray(value)) return value.map(rounded);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]));
  return typeof value === 'number' ? round(value) : value;
}

async function measure(options) {
  if (!options.session) throw new Error('measure requires --session <id>');
  const root = resolve(options.root ?? process.env.CLAUDE_PROJECTS_ROOT ?? '.');
  const files = await discover(root, options.session);
  const prices = options.prices ? await readJson(resolve(options.prices)) : DEFAULT_PRICES;
  const rows = [];
  for (let index = 0; index < files.length; index += 1) rows.push(await accountFile(files[index], index === 0, prices));
  const fingerprint = createHash('sha256');
  for (const row of rows) fingerprint.update(`${row.agent}\0${row.sha256}\n`);
  const total = rows.reduce((sum, row) => sum + row.cost, 0);
  const output = rounded({
    schemaVersion: 1,
    provenance: { sessionId: options.session, capturedAt: options['capture-date'] ?? null, files: files.length, agents: rows.length - 1, inputFingerprint: `sha256:${fingerprint.digest('hex')}` },
    totals: { cost: total, messages: rows.reduce((sum, row) => sum + row.messages, 0), rawUsageRecords: rows.reduce((sum, row) => sum + row.rawUsageRecords, 0), naiveCost: rows.reduce((sum, row) => sum + row.naiveCost, 0) },
    byPhase: summarize(rows, 'phase'), byRole: summarize(rows, 'role'),
    byAgent: rows.sort((a, b) => b.cost - a.cost || a.agent.localeCompare(b.agent)),
  });
  const text = `${JSON.stringify(output, null, 2)}\n`;
  if (options.output) {
    const target = resolve(options.output);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { flag: 'wx' });
  } else process.stdout.write(text);
}

function compareValues(actual, expected, path, tolerance, differences) {
  if (typeof expected === 'number') {
    const delta = Math.abs((actual ?? NaN) - expected);
    const allowed = Math.abs(expected) * tolerance;
    if (!Number.isFinite(actual) || delta > allowed) differences.push(`${path}: expected ${expected}, actual ${actual}, delta ${delta}`);
    return;
  }
  if (Array.isArray(expected)) {
    const key = ['agent', 'phase', 'role'].find((candidate) => expected.every((item) => item && typeof item === 'object' && candidate in item));
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

async function compare(options) {
  if (!options.actual || !options.reference) throw new Error('compare requires --actual and --reference');
  const actual = await readJson(resolve(options.actual));
  const expected = await readJson(resolve(options.reference));
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
  else if (command === 'compare') await compare(options);
  else throw new Error('usage: fleet-cost.mjs measure --session <id> [--root <path>] [--output <path>] | compare --actual <json> --reference <json> [--tolerance 0.01]');
} catch (error) { fail(error.message); }
