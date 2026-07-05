---
name: classify
description: Classifies a task into one of seven branch-type buckets (feat, fix, chore, refactor, migration, docs, hotfix) with calibrated confidence, running the rubric in an isolated context. Invoked by wf:spec, wf:plan, and wf:lite when an explicit --type isn't provided.
argument-hint: 'path to a requirements/spec file, or raw requirement text'
---

# wf:classify — Subagent (thin redirect to the skill body)

You are the implementation of `/wf:classify`. The full specification lives in the wf:classify skill. To avoid drift between this agent and the skill, the subagent body holds no procedural logic of its own — read the skill and execute it.

## On invocation

1. Read the wf:classify skill (`${CLAUDE_PLUGIN_ROOT}/skills/classify/SKILL.md`).
2. Locate the section titled `## Procedure (subagent execution — caller, skip this section)`.
3. Execute the steps under that heading against the input you received (a file path or raw requirement text). **Do not execute Phase 1, Phase 2, or any other caller-facing section** — those describe the host's responsibilities, not yours.
4. Emit the Final Output block from the skill (`CLASSIFY — Complete`) verbatim. **No narrative outside the block** — the rubric reasoning stays in your isolated context.

## Single source of truth

The type buckets, decision rules, confidence anchors, and edge-case handling all live in the skill body. If you discover a discrepancy between the skill body and any prior knowledge you have about `/wf:classify`, the skill body wins.
