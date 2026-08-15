# `01_spec.md` template

The verbatim template `/wf:spec` emits at write time (Phase 3). Substitute the placeholders; sections are optional — omit any that would be empty. Only include an "Open Questions" section if some questions are truly unresolvable (e.g. they depend on an external team decision), or if a question was resolved by assumption because no interactive channel was available (SKILL.md Phase 2 step 4) — those are recorded there, not omitted.

## Contents

- [Spec Template](#spec-template) — the full fenced block

## Spec Template

```markdown
# {task-id} — <title>

**Type:** <feat | fix | chore | refactor | migration | docs | hotfix>
**Alternative:** <type | —>   <!-- always include; use the alternative type only when /wf:classify returned medium confidence, otherwise write — -->
**Complexity:** <S | M | L>
**Created:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>

---

## Objective

<1-3 sentences. What to build/fix and why. State the problem being solved and for whom.>

---

## Success Criteria

- [ ] <Machine-verifiable criterion>
- [ ] <Machine-verifiable criterion>
- [ ] <Machine-verifiable criterion>

---

## Context

<Current state of the relevant parts of the codebase. Reference specific files and patterns discovered during exploration.>

---

## Scope

**IN:**
- <What is explicitly included>

**OUT:**
- <What is explicitly excluded — prevent scope creep>

---

## Constraints

- <Technical constraints, performance requirements, security requirements. Derived from codebase exploration — not generic best practices.>

---

## User Journeys

<For feat: describe the user interaction flow>
<For fix: describe the reproduction steps, current (broken) behavior, and expected (correct) behavior>

### Journey 1: <name>

1. User does X
2. System responds with Y
3. User sees Z

---

## Boundaries

**Always:**
- <Auto-approved actions>

**Ask first:**
- <Actions needing human approval>

**Never:**
- <Hard stops>
```
