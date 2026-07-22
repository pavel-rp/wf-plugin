#!/usr/bin/env node
// generate-bundle.mjs — deterministically materialize the synthetic TWO-CHILD fleet session bundle
// that the accounting reference is derived from.
//
// WHY generated, not committed: outcome 9 forbids committing raw transcripts. A session bundle IS a
// set of raw transcripts, so it is emitted fresh (byte-identical every run — no timestamps, no
// randomness) into a disposable projects root; only the DERIVED reference JSON is committed.
//
// The bundle mimics the isolated CLAUDE_CONFIG_DIR projects layout the runner produces:
//   <out>/<session>.jsonl                          the fleet orchestrator transcript
//   <out>/<session>.meta.json                      its attribution sidecar
//   <out>/<session>/subagents/agent-*.jsonl        every ship orchestrator + phase/role/lens agent
//   <out>/<session>/subagents/agent-*.meta.json    per-agent attribution (role, phase, child, lens, seq)
//
// "Exactly two" applies to the fixture's synthetic runtime CHILDREN; each child is driven by its own
// ship orchestrator through the full ceremony and exercises the required role inventory, so the run
// carries two ship orchestrators and all five audit lenses.

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const SESSION = 'fleet-two-task-synthetic';

// The per-child ceremony agent inventory (seq = the child's internal order; the ship orchestrator is
// seq 0). model varies to exercise mixed-model pricing; lens is set only on the five audit lenses.
const PER_CHILD = [
  { seq: 0, slug: 'ship', phase: 'ship orchestration', role: 'ship orchestrator', model: 'claude-opus-4-8', tool: false },
  { seq: 1, slug: 'classify', phase: 'classify', role: 'bookkeeping', model: 'claude-haiku-4-5', tool: false },
  { seq: 2, slug: 'branch', phase: 'bookkeeping', role: 'bookkeeping', model: 'claude-haiku-4-5', tool: false },
  { seq: 3, slug: 'triage', phase: 'triage', role: 'spec/plan/triage', model: 'claude-sonnet-4-6', tool: false },
  { seq: 4, slug: 'spec', phase: 'spec', role: 'spec/plan/triage', model: 'claude-sonnet-4-6', tool: true },
  { seq: 5, slug: 'plan', phase: 'plan', role: 'spec/plan/triage', model: 'claude-sonnet-4-6', tool: true },
  { seq: 6, slug: 'tasks', phase: 'plan', role: 'spec/plan/triage', model: 'claude-sonnet-4-6', tool: false },
  { seq: 7, slug: 'implement', phase: 'implement', role: 'implement', model: 'claude-sonnet-4-6', tool: true },
  { seq: 8, slug: 'commit', phase: 'bookkeeping', role: 'bookkeeping', model: 'claude-haiku-4-5', tool: false },
  { seq: 9, slug: 'index', phase: 'bookkeeping', role: 'bookkeeping', model: 'claude-haiku-4-5', tool: false },
  { seq: 10, slug: 'verify-spec', phase: 'verify', role: 'verify-spec/fix', model: 'claude-opus-4-8', tool: true },
  { seq: 11, slug: 'audit-consistency', phase: 'verify', role: 'audit lens', lens: 'consistency', model: 'claude-opus-4-8', tool: true },
  { seq: 12, slug: 'audit-convention', phase: 'verify', role: 'audit lens', lens: 'convention', model: 'claude-opus-4-8', tool: true },
  { seq: 13, slug: 'audit-correctness', phase: 'verify', role: 'audit lens', lens: 'correctness', model: 'claude-opus-4-8', tool: true },
  { seq: 14, slug: 'audit-operational', phase: 'verify', role: 'audit lens', lens: 'operational', model: 'claude-opus-4-8', tool: true },
  { seq: 15, slug: 'audit-security', phase: 'verify', role: 'audit lens', lens: 'security', model: 'claude-opus-4-8', tool: true },
  { seq: 16, slug: 'verify-fix', phase: 'verify', role: 'verify-spec/fix', model: 'claude-opus-4-8', tool: true },
  { seq: 17, slug: 'verify-recheck', phase: 'verify', role: 'verify-spec/fix', model: 'claude-opus-4-8', tool: false },
  { seq: 18, slug: 'qa', phase: 'qa', role: 'qa', model: 'claude-sonnet-4-6', tool: true },
  { seq: 19, slug: 'pr', phase: 'pr', role: 'bookkeeping', model: 'claude-haiku-4-5', tool: false },
  { seq: 20, slug: 'finalize', phase: 'finalize', role: 'bookkeeping', model: 'claude-haiku-4-5', tool: false },
];

// Deterministic per-agent usage — a pure function of (child index, seq) so every run is byte-identical.
// INFLATE scales output_tokens for the whole run; the default 1 keeps every run byte-identical, and a
// value like 1.2 deterministically pushes output_tokens out of a 10% band (the selfcheck's fail case).
let INFLATE = 1;
function usageFor(childIndex, seq, bump = 0) {
  const base = childIndex * 100 + seq;
  return {
    input_tokens: 10 + base,
    cache_creation_input_tokens: 100 + base * 5,
    cache_read_input_tokens: 1000 + base * 50,
    output_tokens: Math.round((5 + base + bump) * INFLATE),
  };
}

function assistantLine(id, model, usage, toolId) {
  const content = toolId ? [{ type: 'tool_use', id: toolId, name: 'Read' }] : [];
  return `${JSON.stringify({ type: 'assistant', message: { id, model, usage, content } })}\n`;
}

async function emit(path, text) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

async function main() {
  const args = process.argv.slice(2);
  let out = null;
  let session = SESSION;
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] === '--out') out = args[i + 1];
    else if (args[i] === '--session') session = args[i + 1];
    else if (args[i] === '--inflate-output') INFLATE = Number(args[i + 1]);
    else throw new Error(`generate-bundle: unknown argument ${args[i]}`);
  }
  if (!Number.isFinite(INFLATE) || INFLATE <= 0) throw new Error('--inflate-output must be a positive number');
  if (!out) throw new Error('generate-bundle requires --out <dir>');
  const root = resolve(out);
  // Deterministic reset: wipe any prior bundle so a re-generate can never inherit stale state.
  await rm(root, { recursive: true, force: true });

  // Fleet orchestrator (index 0).
  const orchUsage = usageFor(0, 0);
  const orchId = 'fleet-orch-1';
  await emit(join(root, `${session}.jsonl`),
    assistantLine(orchId, 'claude-opus-4-8', usageFor(0, 0), 'fleet-tool-0')
    + assistantLine(orchId, 'claude-opus-4-8', { ...orchUsage, output_tokens: orchUsage.output_tokens + 3 }, 'fleet-tool-0'));
  await emit(join(root, `${session}.meta.json`),
    `${JSON.stringify({ description: 'fleet orchestrator: dependency-ordered fan-out', role: 'fleet orchestrator', phase: 'fleet orchestration' })}\n`);

  // Two children, each a ship orchestrator + the full ceremony role inventory.
  for (let childIndex = 1; childIndex <= 2; childIndex += 1) {
    const child = `child-${childIndex}`;
    for (const a of PER_CHILD) {
      const tag = `agent-c${childIndex}-${String(a.seq).padStart(2, '0')}-${a.slug}`;
      const msgId = `${child}-${a.slug}`;
      const toolId = a.tool ? `${child}-${a.slug}-tool` : null;
      const usage = usageFor(childIndex, a.seq);
      // Same message id emitted twice (usageMax dedup); output grows on the second to exercise the max.
      const jsonl = assistantLine(msgId, a.model, usage, toolId)
        + assistantLine(msgId, a.model, { ...usage, cache_read_input_tokens: usage.cache_read_input_tokens + 20, output_tokens: usage.output_tokens + 7 }, toolId);
      await emit(join(root, session, 'subagents', `${tag}.jsonl`), jsonl);
      const meta = { description: `${child} ${a.slug}`, role: a.role, phase: a.phase, child, seq: a.seq };
      if (a.lens) meta.lens = a.lens;
      await emit(join(root, session, 'subagents', `${tag}.meta.json`), `${JSON.stringify(meta)}\n`);
    }
  }
  process.stdout.write(`generate-bundle: wrote synthetic two-child bundle for session '${session}' into ${root}\n`);
}

main().catch((error) => { process.stderr.write(`generate-bundle: ${error.message}\n`); process.exitCode = 1; });
