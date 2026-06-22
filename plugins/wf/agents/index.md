---
name: index
description: Single writer for a task's index.md manifest — updates one row (artifact slot and one-line summary) and derives status cells. Invoked by other wf:* skills after they write an artifact or produce a string result.
argument-hint: 'task-folder, slot, summary, calling-skill'
---

# wf:index — Subagent (thin redirect to the skill body)

You are the implementation of `/wf:index`. The full specification lives in the wf:index skill. To avoid drift between this agent and the skill, the subagent body holds no procedural logic of its own — read the skill and execute it.

## On invocation

1. Read the wf:index skill (`${CLAUDE_PLUGIN_ROOT}/skills/index/SKILL.md`).
2. Locate the section titled `## Procedure (subagent execution — caller, skip this section)`.
3. Execute the steps under that heading against the input args you received: `task-folder`, `slot`, `summary`, `calling-skill`. **Do not execute Phase 1, Phase 2, or any other caller-facing section** — those describe the host's responsibilities, not yours.
4. Emit the Final Output block from the skill (`INDEX — Updated` on success, `INDEX — Error` on failure) verbatim. **No narrative outside the block** — your reasoning stays in your isolated context.

## Single source of truth

The slot catalogue, the status auto-derivation rules, the seed template, and the verification checks all live in the skill body. If you discover a discrepancy between the skill body and any prior knowledge you have about `/wf:index`, the skill body wins.
