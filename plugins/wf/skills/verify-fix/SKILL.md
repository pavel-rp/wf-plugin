---
name: verify-fix
description: Reads the audit report produced by /wf:verify-spec (_local/ADO-<id>/04_verify.md), auto-fixes mechanical FAIL/PARTIAL findings with a specific expected value, and presents ambiguous or structural findings as open questions for the user to resolve. Use after /wf:verify-spec when the audit came back with findings and you want to clear the mechanical ones before re-running the audit.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:verify-fix — Apply fixes from a verify-spec audit

Read the audit report at `_local/ADO-<id>/04_verify.md`, sort FAIL/PARTIAL/UNVERIFIABLE findings into **auto-fix** (mechanical, one or two unambiguous edits) and **ask-user** (structural, ambiguous, or design-laden), apply the auto-fixes, and present the open questions so the user can resolve them. Writes a fix log to `_local/ADO-<id>/05_verify-fix.md` and tells the user to re-run `/wf:verify-spec` afterward to confirm.

**This skill writes to source files** — one of three with that permission, alongside `/wf:implement` and `/wf:qa-followup`. The input `04_verify.md` is treated as the plan; no edits are made beyond what the report cites.

---

## When to use this

Fit:
- `/wf:verify-spec` just ran and came back FAIL or PARTIAL with at least one mechanical finding (wrong enum value, missing property, missing `//MIGRATION NOTE` marker, forbidden pattern at a cited `file:line`).
- The report's migration-rule audit has hits with mechanical remedies (commenting out `CacheUtility.*`, wrapping a jQuery call with a `//MIGRATION TODO`).
- You want the obvious stuff cleared before escalating the hard findings to a human.

Not fit:
- Report is PASS (nothing to fix — skill will NOOP).
- Every finding is UNVERIFIABLE or structural (skill will present them as questions and do no edits — cheaper to just read the report yourself).
- Report doesn't exist yet → run `/wf:verify-spec` first.

This skill does **not** re-verify. After it runs, re-invoke `/wf:verify-spec` to confirm the fixes landed.

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}` and `{wi-prefix}` below come from that file.

---

## Dispatch on arguments

Parse the first token.

### empty → infer from current branch

1. Run `git branch --show-current`. Extract the first 3+-digit run → the ADO id.
2. Confirm `{task-root}/{wi-prefix}-<id>/04_verify.md` exists. If not, stop: "No audit report found. Run `/wf:verify-spec {id}` first."

### `<ado-id>` (e.g. `6756`, `ADO-6756`, `ADO_5917`)

Normalize to the folder that actually exists under `{task-root}/` — some older folders use `ADO_` (underscore) instead of `ADO-` (hyphen). Check both. Then load `04_verify.md` from that folder.

### `<path-to-04_verify.md>`

Treat as an explicit override. Useful when the report lives outside `{task-root}/` (e.g., `/wf:verify-spec` was run with a `<path-to-00_reqs.md>` override and wrote the report as a sibling). Write the fix log as a sibling of the override path too.

---

## Safety Rules

### Allowed

- Read any file in the repo.
- **Edit source files, but only** at `file:line` locations cited in the loaded `04_verify.md`.
- Write `{task-root}/{wi-prefix}-<id>/05_verify-fix.md` (or sibling of the override path).
- `git branch --show-current`, `git status --porcelain`, `git diff --stat`, `git diff` — read-only git for status and verification.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 1 branch gate. The wf:branch subagent performs non-destructive git operations only (`checkout -b` / `checkout` of an existing branch, `fetch`, `push --set-upstream`); it never resets, force-pushes, deletes branches, or commits.

### Forbidden

- Fixing things the report didn't cite. If `04_verify.md` doesn't flag it, don't touch it, even if you notice it in the surrounding code.
- Fabricating an "Expected" value the report doesn't contain. If the report says "FAIL — implementation differs" without a specific target, that's an ask-user finding, not an auto-fix.
- Running builds, tests, installs, or `/wf:verify-spec`. The skill stops after applying edits.
- Committing, staging, pushing, or any destructive git. The user reviews the diff.
- Modifying files outside the repo, or anything under `.git/`.
- Touching `00_reqs.md`, `01_spec.md`, or `02_plan.md` — those are upstream artifacts.

---

## Phase 1: Branch Gate

Before editing any code, verify the current git branch matches the audit's target.

1. Run `git rev-parse --abbrev-ref HEAD`.
2. **If the branch name contains `/<id>-`** (e.g., `feature/6756-...`) — proceed.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing `ado-id: <id>`. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.) On `BRANCH — created`/`switched`/`already-active`, continue. On `BRANCH — Error`, stop and surface the subagent's reason.

Rationale: the audit's evidence lines (`file:line`) are only meaningful on the branch that produced them. Fixing on `main` or an unrelated branch edits the wrong state.

---

## Phase 2: Load and Parse the Report

Read `04_verify.md` in full. Extract the header metadata and three lists, preserving order and each finding's identifier (the numbered requirement, or `MIG-<n>` for migration-rule audit items).

1. **Header metadata** — capture `Branch:`, `Commit:` (HEAD SHA the audit ran against), base SHA, and `Tree:` (clean or dirty). These may be absent on reports produced before the header was extended — treat as unknown and skip the staleness check below.
2. **Requirements list** — each numbered `[PASS | FAIL | PARTIAL | N/A | UNVERIFIABLE]` item. Capture verdict, requirement text, `Expected`, `Found`, `Location` / `Evidence`.
3. **Migration-rule audit** — each `[PASS | FAIL]` line. Capture the rule, file:line, and the snippet.
4. **Deviations from `01_spec.md`** — informational only; do not act on these.

If the report is malformed (no `## Requirements` heading, no verdict lines), stop and ask the user to re-run `/wf:verify-spec`.

### Staleness check

After parsing the header, run `git rev-parse HEAD` and compare to the report's `Commit:` SHA.

- **SHAs match** — proceed normally.
- **SHAs differ** — the branch has moved since the audit ran. Every cited `file:line` may now be wrong. Print a prominent warning at the top of Phase 4's plan:
  `⚠ Audit ran on <report-sha-short>; HEAD is now <current-sha-short> (<N> commits ahead). Cited file:line citations may be stale — consider re-running `/wf:verify-spec` first.`
  Continue anyway. Phase 5 step 2 (confirm `Found` state on disk) catches per-finding drift; the user can abort after seeing the plan if they'd rather re-audit.
- **Commit field absent** — older report format. Skip the check silently.

The dirty-tree flag in the header is informational; uncommitted changes since the audit are normal mid-fix and don't trigger a warning on their own.

---

## Phase 3: Classify Findings

Walk the extracted lists and sort each finding into **AUTO**, **ASK**, or **SKIP**.

### SKIP

- Verdict `PASS` or `N/A` — not a finding.
- Informational deviations from `01_spec.md`.

### AUTO — apply the fix directly

A finding is AUTO only when **all** of these hold:

- Verdict is `FAIL` or `PARTIAL`.
- The report names a specific `file:line`.
- The `Expected` value is concrete and literal — a specific value, symbol, enum member, or comment marker. Not "matches the spec" or "follows the pattern".
- The fix is one or two mechanical edits at the cited location:
  - Change a literal value (`= 2` → `= 1`, `number` → `number | null`).
  - Insert a missing enum member at the right position in an enum body.
  - Insert a missing property in an interface or class body.
  - Prepend or replace a `//MIGRATION NOTE (XX):` / `//MIGRATION TODO (XX):` / `//MIGRATION QUESTION (XX):` marker on a cited line. Use `XX` unchanged if the file already has a consistent initials tag; otherwise use `XX` as a placeholder and flag it in the open questions.
  - Comment out a forbidden line that the migration rules say must be commented, not translated (e.g., `CacheUtility.*` calls, PDF render-mode branches).
- Applying the fix touches only the cited file, at or adjacent to the cited line.
- The fix does not require choosing between plausible alternatives.

### ASK — present as an open question

Everything not AUTO and not SKIP is ASK. In particular:

- `UNVERIFIABLE` — can't be auto-fixed; needs user judgment or a runtime check.
- `Expected` is vague ("correct", "matches the spec", "follows the pattern") or missing.
- Fix would require a new file, new component, new import graph, or cross-file changes.
- Multiple plausible fixes (e.g., "rename to match source" — the "correct" name might not be obvious from the report alone).
- STOP-AND-ESCALATE gate triggers flagged in the report.
- Migration-rule audit hits where the mechanical remedy is unclear (e.g., `window.location` used where the target-framework equivalent depends on context).
- Any fix that would reverse a deliberate design choice visible in the surrounding code.

When in doubt, classify as ASK. Over-fixing silently is worse than asking.

---

## Phase 4: Print the Plan

Before editing anything, print the classified plan to chat so the user sees what's coming.

```
Verify-fix plan for ADO-<id> — <N findings total>

Auto-fix (<a>):
  <id>  <one-line summary>  <file:line>
  ...

Ask user (<b>):
  <id>  <one-line summary>  <file:line>
  ...

Skipped (<c>): <verdict counts>
```

Do not wait for approval — proceed to Phase 5 immediately. The plan exists so the user can interrupt if a classification looks wrong.

---

## Phase 5: Apply Auto-fixes

For each AUTO finding, in report order:

1. Read the cited file around the target line.
2. Confirm the `Found` state matches what's on disk. If it doesn't (the code has changed since the audit, or the citation is off by more than one or two lines), reclassify the finding as ASK and record the reason. Do not guess a new location.
3. Make the minimal edit that produces the `Expected` state. No adjacent cleanup.
4. Re-read the file to confirm the edit applied as intended.
5. Record the result in the fix log: `[FIXED]` with a one-line diff summary, or `[SKIPPED]` with the reason if Phase 5 step 2 reclassified it.

**If an edit fails or produces an unexpected result** (e.g., the `old_string` appears more than once, the file is write-protected): stop that finding, record it as `[FAILED]` with the error, and continue with the next finding. Do not retry with a guess.

Do not batch edits from different findings into one tool call — per-finding edits make the fix log precise and let a single failure not cascade.

---

## Phase 6: Present Open Questions

For each ASK finding, emit a numbered question block. Format:

```
Q<n>. <requirement text>  (<id>, <verdict>)

  Report says:
    Expected: <verbatim from report, or "(vague)">
    Found:    <verbatim from report>
    Location: <file:line>

  Recommended fix: <one-sentence proposal, or "no obvious fix — needs design input">

  Reply with:
    - "apply" to have me make the recommended edit
    - a specific instruction if you want a different fix
    - "skip" to leave the finding for manual resolution
```

If the skill has nothing to recommend (truly UNVERIFIABLE or needs a design call), say so explicitly rather than inventing a suggestion.

After printing all questions, **stop**. Do not proceed to further edits in the same turn — the user replies, then re-invokes the skill or responds inline so a follow-up turn can apply their answers.

---

## Phase 7: Write the Fix Log

Write `{task-root}/{wi-prefix}-<id>/05_verify-fix.md` (or sibling of the override path). Rotate before overwriting — same pattern as `/wf:verify-spec`:

- Read the current `05_verify-fix.md` if it exists.
- Prepend its contents to `05_verify-fix.history.md` (newest entry on top), followed by a `---` separator on its own line, followed by any prior history contents.
- Then write the new `05_verify-fix.md`.

This keeps a trail of every fix run alongside the audit trail, so the user can see which fixes were attempted across iterations — the history file grows unbounded; prune manually if noisy.

```markdown
# verify-fix: ADO-<id>

**Source report:** `_local/ADO-<id>/04_verify.md`
**Branch:** <current branch>
**Implemented by:** <model identifier>

## Auto-fixed (<n>)

1. [FIXED] <requirement id> — <requirement text>
   - Location: `path/to/file.ts:L`
   - Before: `<quoted line>`
   - After:  `<quoted line>`

2. [SKIPPED] <requirement id> — <requirement text>
   - Reason: code state on disk no longer matches the report's "Found" — reclassified to ASK.

3. [FAILED] <requirement id> — <requirement text>
   - Error: <tool error summary>

## Awaiting user (<m>)

- Q1 `<id>` — <one-line summary>. <file:line>
- Q2 `<id>` — <one-line summary>. <file:line>
- ...

(Questions are printed in full in chat; this list is for traceability.)

## Next

Re-run `/wf:verify-spec <id>` to confirm fixes and regenerate `04_verify.md`.
```

If the write fails (permissions, path missing), stop and report. Do not fall back to printing the log inline instead of to disk — the durable artifact matters for later re-runs.

**After writing the fix log**, invoke `/wf:index <id> verify-fix "<a> auto-fixed · <b> open questions"` to record it in the per-task index. Substitute the AUTO and ASK counts produced in Phases 5 and 6. Skip this step when the `<path-to-04_verify.md>` override form is used and the log lives outside `{task-root}/`.

---

## Output

Two outputs, always both:

1. **Fix log** at `_local/ADO-<id>/05_verify-fix.md`.
2. **Chat summary** with the plan from Phase 4, the open questions from Phase 6, and the final-output block below.

Target ~25 lines of chat for the summary (not counting the open-question blocks — those are whatever length they need to be).

---

## Edge Cases

- **Report is PASS** — nothing to fix. Emit final output `VERIFY-FIX — NOOP`, no fix log written.
- **Report lists only UNVERIFIABLE / structural findings** — zero AUTO, one or more ASK. Phase 5 is a no-op; Phase 6 still runs; fix log records "0 fixed, N awaiting user"; final output is `PENDING`.
- **Code has moved since the audit** — a cited `file:line` no longer points at the `Found` snippet. Reclassify to ASK (with reason "report may be stale — re-run `/wf:verify-spec`"). Don't try to re-locate the target.
- **Branch has uncommitted changes before the skill runs** — record the dirty files in the fix log's header. Edits from this skill add to the dirty set; the user sees the combined state in `git diff`.
- **Multiple findings target the same line** — apply them in report order. If the second edit can no longer find its `Found` snippet (because the first edit moved or replaced it), reclassify the second as ASK.
- **No `04_verify.md`** — stop, say "Run `/wf:verify-spec {id}` first."
- **Malformed `04_verify.md`** (no `## Requirements` heading, no verdict markers) — stop, ask the user to re-run `/wf:verify-spec`.
- **Re-run after partial application** — `05_verify-fix.md` is overwritten with the latest run; the prior log rotates into `05_verify-fix.history.md` (newest entry on top, `---` separated). The audit report (`04_verify.md`) may still show the same FAILs until `/wf:verify-spec` is re-run; explain this in the chat summary so the user doesn't loop on a stale report.

---

## Final Output

End the chat reply with this fenced block:

```
VERIFY-FIX — <CLEAN | PARTIAL | PENDING | NOOP>

ADO-<id>: <a> auto-fixed, <b> awaiting user, <c> skipped
Log: _local/ADO-<id>/05_verify-fix.md
Next: re-run `/wf:verify-spec <id>` to confirm
```

State meanings:
- `CLEAN` — all findings were AUTO and applied successfully.
- `PARTIAL` — at least one AUTO applied and at least one ASK pending.
- `PENDING` — no AUTO applied (all findings were ASK, or all AUTO were reclassified/failed).
- `NOOP` — report was PASS or had no actionable findings.

**The final output block must always be the very last thing output to chat.**
