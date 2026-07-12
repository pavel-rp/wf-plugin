# `08_qa-fix.md` template

The verbatim template `/wf:qa-followup` writes to the task folder (Phase 6), then fills the Fix log during Phase 8. Rotate any existing file into `08_qa-fix.history.md` first (prepend the old contents above a `---` separator, newest first). Substitute the placeholders; keep the `## Unblock pass`, `## Remediation plan` (`### - [ ] FIX-NNN:`), `## Escalations`, `## Fix log`, and `## Next` shape.

## Contents

- [`08_qa-fix.md` Template](#08_qa-fixmd-template) — the full fenced block

## `08_qa-fix.md` Template

```markdown
# {task-id} — QA Follow-up

**Source report:** `07_qa-report.md` (run <date>, mode <manual|agentic>)
**Branch:** <branch>
**Model:** <model identifier>
**Triage:** <u> unblock · <d> defects · <e> escalate

---

## Unblock pass

| TC | Block reason | Action | Re-run verdict |
|---|---|---|---|
| TC-003 | Host required: FooComponent | scaffolded via host provider (new) | PASS |
| TC-005 | host pins an input the scenario must vary | augmented: host provider augment --control &lt;input&gt; | PASS |
| TC-006 | an output the scenario must watch is not observed | augmented: --observe &lt;output&gt; | FAIL@step3 → defect FIX-002 |
| TC-007 | session expired | re-ran | PASS |
| TC-009 | setup: schema unavailable | escalated (env config) | — |

*(omit this section if no scenarios were unblocked)*

---

## Remediation plan

- [ ] FIX-001: <title> — TC-002 / SC-1
- [ ] FIX-002: <title> — TC-007 / SC-3

### - [ ] FIX-001: <title>

**Defect:** TC-002 step 2 — observed "<observed>", expected "<expected>". Severity: <High|Medium|Low>
**Traces:** SC-1 — <criterion, abbreviated>
**Root cause:** <hypothesis from source — `path/to/file.ts` `symbol`>
**Change:**
- <plain-language change, not code>

**Files:**
| File | Action |
|---|---|
| `path/to/file.ts` | modify |

**Depends on:** —

---

## Escalations

- E1 `TC-009` — block: schema metadata unavailable. Remedy: configure `mssql_*` for the test DB (or point creds at a DB you can reach), then re-run `/wf:qa-followup <id>`.
- E2 `TC-005` defect — root cause ambiguous: <why>. Needs a product/design decision before a fix can be planned.

*(omit if empty)*

---

## Fix log

*(filled during Phase 8)*

1. [FIXED] FIX-001 — TC-002 — `path/to/file.ts:L` — <one-line diff summary>
2. [FAILED] FIX-002 — <tool error summary>

---

## Next

Re-run `/wf:qa-auto <id> --only TC-002,TC-007` to confirm the fixes, or `/wf:qa-auto <id> --resume` for a full pass.
```
