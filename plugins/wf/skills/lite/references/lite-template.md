# `lite.md` template

The verbatim template `/wf:lite` emits at write time (Phase 4). Substitute the placeholders; keep the metadata block, `## Objective`, `## Approach`, `## Files`, `## Plan` (2–4 checkbox steps), and `## Done When` shape. The `## Resolution` block is appended separately in Phase 6.

## Contents

- [lite.md Template](#litemd-template) — the full fenced block

## lite.md Template

```markdown
# {task-id} — <title>

**Type:** <feat | fix | chore | refactor | migration | docs | hotfix>
**Alternative:** <type | —>   <!-- always include; use the alternative type only when /wf:classify returned medium confidence, otherwise write — -->
**Flow:** lite
**Created:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>

---

## Objective

<1–2 sentences distilled from 00_reqs.md — what to build/fix and why.>

---

## Approach

<2–4 sentences: what will change and why, grounded in the files found during Phase 3.>

---

## Files

- `path/to/file.ts` — <why>
- `path/to/other.ts` — <why>

---

## Plan

- [ ] STEP-001: <short title — the actual change>
- [ ] STEP-002: <if a second distinct change is needed>
- [ ] STEP-NNN: Verify — `{verify-command}` (from `_local/config.md`)
- [ ] STEP-NNN+1: Hand off — stage files and produce commit-ready diff

---

## Done When

- <1–2 machine-verifiable criteria, at least one runnable as a command>
```
