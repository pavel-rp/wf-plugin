# `02_plan.md` template

The verbatim template `/wf:plan` emits at write time (Phase 2, Step 2b). Substitute the placeholders; keep the metadata block, the `## Progress` checklist, and the `## Execution Plan` step shape (`### - [ ] STEP-NNN:`) exactly — `/wf:implement` ticks those checkboxes by that shape.

## Contents

- [Plan Template](#plan-template) — the full fenced block

## Plan Template

```markdown
# {task-id} — <title>

**Type:** <feat | fix | chore | refactor | migration | docs | hotfix>
**Alternative:** <type | —>   <!-- always include; use the alternative type only when /wf:classify returned medium confidence (or it was carried over from 01_spec.md), otherwise write — -->
**Complexity:** <S | M | L>
**Depends on:** <task-id(s) or —>
**Created:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>
**Spec:** <01_spec.md, or —>

---

## Description

<for feat: description of the feature to implement>
<for fix: description of the problem to solve>

---

## Approach

<high-level approach derived from codebase exploration — what will change and why>

---

## Relevant Files

**Must change:**
- `path/to/file.ts` — <why>

**May change:**
- `path/to/file.ts` — <why>

**Read-only context:**
- `path/to/file.ts` — <why>

---

## Progress

- [ ] STEP-001: Read affected files and confirm approach
- [ ] STEP-002: <title>
- [ ] ...
- [ ] STEP-NNN: Run build/typecheck — confirm no regressions
- [ ] STEP-NNN+1: Ready for review — suggested commit message `<type>(<task-id>): <lowercase title>`

---

## Execution Plan

### - [ ] STEP-001: Read affected files and confirm approach

**Goal:** Verify the planned approach is sound. Check that no recent changes conflict with the plan and that the identified files are still the right targets.

**Files to read:**
<list from exploration phase>

**Depends on:** —

---

### - [ ] STEP-002: <title>

**Goal:** <1-2 sentences: what this step achieves>

**Changes:**

- <plain-language description of the change, not code>
- <another change if applicable>

**Files:**
| File | Action |
|------|--------|
| `path/to/file.ts` | modify |
| `path/to/new-file.ts` | create |

**Depends on:** STEP-001

---

<... repeat for each middle step ...>

---

### - [ ] STEP-NNN: Run build/typecheck — confirm no regressions

**Goal:** Verify the changes compile and do not break existing functionality.

**Command:** `{verify-command}` — substituted from `_local/config.md`. Never hardcode a command here.

**Depends on:** STEP-<previous>

---

### - [ ] STEP-NNN+1: Ready for review

**Goal:** Hand off the implemented change for review. `/wf:implement` does not commit, push, or open a PR — it ticks this step and records a suggested commit message for whichever step commits next (`/wf:commit`, or a manual commit).

**Suggested commit message:** `<type>(<task-id>): <lowercase title>`

**Depends on:** STEP-NNN

---

## Done When

<1-3 machine-verifiable criteria. At least one must be checkable by running a command (build output, CLI output, API response).
Not acceptable: "the feature works", "it handles errors correctly"
Acceptable: "POST /api/auth/login returns 200 with a valid JWT when given correct credentials",
"`{verify-command}` exits 0".>
```
