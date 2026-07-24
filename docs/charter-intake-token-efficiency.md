# Charter intake — wf: fleet-run token efficiency

**Intake, 2026-07-20.** One charter, six sub-tasks. Evidence base — read both before
charging at any sub-task:

- [fleet-run-token-accounting.md](./fleet-run-token-accounting.md) — measurement method
  and the corrected baseline. **Its §2 is a prerequisite, not background.**
- [wf-token-leak-inventory.md](./wf-token-leak-inventory.md) — the eight defects (D0–D7),
  ranked by recoverable dollars, plus two refuted theories.

Session logs the whole thing derives from (machine-local, prunable — archive if this
charter outlives them):
`~/.claude/projects/B--Projects-claude-smart-roadmap/76327173-6061-4d25-bdd9-8b785c49c7e7.jsonl`
and its `76327173-6061-4d25-bdd9-8b785c49c7e7/subagents/agent-*.jsonl` (51 files).

## Problem

One `/wf:fleet` run shipping **two** sub-tasks to merged PRs cost **$114.55**
API-equivalent across 51 subagents, every one on `claude-opus-4-8`. The distribution is
the problem, not the total:

- **verify $37.16 (34%)** and **ship orchestration $33.67 (31%)** are 65% of spend.
- Everything that produces a deliverable — spec, plan, implement, pr — is **$27.45 (25%)**.
- Verifying cost **2.3x more than implementing**.
- One agent (Ship SM-2) is 18% of the run on its own, its context growing 43K -> 422K.

Roughly **$30 of the $114.55** looks recoverable without touching implement or verify
quality. This charter is about collecting it and being able to prove it.

## Hard constraints (lessons already paid for)

1. **Measure with `message.id` dedup.** The transcript writes one JSONL record per
   *content block*; every record repeats the same `usage` object and `output_tokens` only
   reaches its true value on the last record. Naive summation over-reports cache by ~2x,
   and because the inflation factor varies 1.7x–3.8x per agent it **distorts rankings, not
   just totals**. Any figure produced without the dedup is inadmissible. Method + reference
   implementation: accounting doc §2.
2. **Cross-agent read duplication is NOT recoverable by deduplication.** Five isolated
   lens agents each need the content in their own context; inlining the *same bytes* into
   five prompts saves nothing. Only two levers exist: collapse the agents (costs
   perspective diversity and parallelism), or shrink the payload (pass hunks, not whole
   files — **untested**, measure first). Do not accept a plan premised on "dedup the reads."
3. **Rank by dollars, never by token count, turn count, or agent count.** The 15
   bookkeeping agents are 20% of the agent count and 3% of the cost; the two orchestrators
   are 4% of the count and 31% of the cost. Agent-count intuition points the wrong way.
4. **`**Model:** <id>` in an agent file is Core-Article-4 attribution, not a selector.**
   Model tier is set by frontmatter `model:` or the Task call. Two separate readings of
   this codebase have mistaken the attribution line for a hardcoded pin.
5. **The plan->implement clear is correct — do not "fix" it.** `02_plan.md` is 31K chars
   (larger than the spec); implement's re-reads are mostly *forced* by the Edit tool
   requiring a prior Read (82% on SM-3); and `plan/SKILL.md:151` deliberately excludes
   exact code. Refuted in inventory §4. Out of scope below.
6. **Estimates are from n=2 tasks, one run.** Ratios are suggestive. SUB-1 exists so the
   rest can be judged against a re-measurement rather than these numbers.

## Sub-tasks

- **SUB-1 — measurement harness.** Make the accounting doc's method executable and
  repeatable: a script that takes a session id and emits the per-phase / per-role /
  per-agent cost tables, with the `message.id` and `tool_use`-block dedup baked in. Ships
  with the current run's output as the committed regression baseline. Everything else is
  judged against this. **Do first** — without it, the other five are unfalsifiable.
- **SUB-2 — ship context budget (D0, ~$10).** Give `/wf:ship` a context ceiling: compact or
  hand off to a fresh shipper at ~150K rather than growing to 422K. Decide what carries
  across a hand-off. Note `ship/SKILL.md:50` drives `/wf:pr` and `/wf:tf` via the Skill
  tool (inline, in-context) — whether those should become subagents is part of this
  sub-task.
- **SUB-3 — per-agent model tier (D2, ~$11).** Let a caller express "ship on opus, run
  lenses and bookkeeping on sonnet." Today `fleet/SKILL.md:206` sets the model only on the
  shipper and nothing under `plugins/*/agents/` declares `model:`, so tier selection is one
  level deep. Mechanical agents (index, classify, branch) are the safe first movers;
  lenses next; verify is judgment-heavy and explicitly **not** in scope here.
- **SUB-4 — verify fan-out shape (D1 + D3 + D4, ~$11 + latent).** The expensive phase.
  Three coupled changes: evaluate the lens gate **caller-side before dispatch** (today a
  gated-off lens still pays a full boot to no-op); inline the static `finding-contract.md`
  instead of 15 agents each fetching it; and decide the fan-out shape — five agents or one
  agent with five rubric sections. The last is a **quality tradeoff, not a free win**, and
  needs an explicit decision with the tradeoff written down. Also settle whether auditors
  should receive a diff at all: only 4 `git diff` calls existed across all 51 agents.
- **SUB-5 — mechanical-agent inlining (D6, ~$3).** Single-row `wf:index` edits move into
  the caller's context instead of spawning an agent that boots 55–80K to write one table
  row. Small dollars, large agent-count reduction, low risk.
- **SUB-6 — shell-constraint guidance (D5, ~$2).** 10.4% of Bash calls were blocked by the
  host's guardrail hook and burned a retry round trip each. Add the constraints to the
  shipper prompt template, and emit `npm --prefix <dir> run <script>` instead of
  `(cd <dir> && npm run <script>)` in `init/SKILL.md:108-123`. Host-dependent — the
  guardrail is a user hook, so the fix is guidance and portable idiom, not a hard
  assumption.

## Out of scope

Implement-phase and verify-phase *quality* changes — this charter only reshapes how they
are dispatched and priced. The plan->implement context clear (refuted, constraint 5).
Sonnet for verify-spec/verify-fix (the ~$7 is real but the risk is unquantified; revisit
after SUB-1 makes regressions visible). Anything premised on deduplicating cross-agent
reads (constraint 2).

## Done-criterion (umbrella)

A **re-measured** fleet run over a comparable two-task umbrella, produced by SUB-1's
harness, showing a materially lower total against the committed baseline — with the verify
phase's findings and the shipped PRs judged no worse by review. A cheaper run that catches
fewer real defects is a regression, not a win; SUB-4 is where that risk concentrates, so
its tradeoff decision must be recorded before it ships.
