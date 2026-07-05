---
name: verify-fix
description: Reads the audit report produced by /wf:verify-spec ({task-root}/{task-id}/04_verify.md), auto-fixes mechanical FAIL/PARTIAL findings with a specific expected value, and presents ambiguous or structural findings as open questions for the user to resolve. Use after /wf:verify-spec when the audit came back with findings and you want to clear the mechanical ones before re-running the audit.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:verify-fix — Apply fixes from a verify-spec audit

Read the audit report at `{task-root}/{task-id}/04_verify.md`, sort FAIL/PARTIAL/UNVERIFIABLE findings into **auto-fix** (mechanical, one or two unambiguous edits) and **ask-user** (structural, ambiguous, or design-laden), apply the auto-fixes, and present the open questions so the user can resolve them. Writes a fix log to `{task-root}/{task-id}/05_verify-fix.md` and tells the user to re-run `/wf:verify-spec` afterward to confirm.

**This skill writes to source files** — one of three with that permission, alongside `/wf:implement` and `/wf:qa-followup`. The input `04_verify.md` is treated as the plan; no edits are made beyond what the report cites.

---

## When to use this

Fit:
- `/wf:verify-spec` just ran and came back FAIL or PARTIAL with at least one mechanical finding (wrong enum value, missing property, a missing marker the finding names, a forbidden pattern at a cited `file:line`).
- The report has findings that carry a concrete mechanical **remedy** — a bounded edit the finding itself describes (comment out a forbidden line, wrap a call with a marker, insert a literal value). The remedy detail comes from whichever capability produced the finding; this skill applies it, it doesn't know the recipe.
- You want the obvious stuff cleared before escalating the hard findings to a human.

Not fit:
- Report is PASS (nothing to fix — skill will NOOP).
- Every finding is UNVERIFIABLE or structural (skill will present them as questions and do no edits — cheaper to just read the report yourself).
- Report doesn't exist yet → run `/wf:verify-spec` first.

This skill does **not** re-verify. After it runs, re-invoke `/wf:verify-spec` to confirm the fixes landed.

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}` below come from that file.

---

## Dispatch on arguments

Parse the first token.

### empty → infer from current branch

1. Resolve the current branch via `current-branch-query`, reached through **direct provider resolution** to the `delivery` surface (see "Direct provider resolution" below). Extract the first 3+-digit run from the resolved branch name — the branch-inferred token. If no numeric token can be extracted from the branch at all, stop: "No id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:verify-fix <id>`."
2. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the branch-inferred token (mirroring `spec/SKILL.md`'s Validation-section resolution logic). Exactly one match — reuse that folder's full name as `{task-id}` verbatim. Zero matches — stop: "No audit report found. The branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:verify-fix <id>`." More than one match — stop: "No audit report found. The branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:verify-fix <id>`."
3. Confirm `{task-root}/{task-id}/04_verify.md` exists. If not, stop: "No audit report found. Run `/wf:verify-spec {task-id}` first."

### `<id>` (opaque — whatever shape the active tracker capability produces, or the local `T<NNN>` scheme)

Use verbatim as `{task-id}` — no normalization. Then load `04_verify.md` from `{task-root}/{task-id}/`.

### `<path-to-04_verify.md>`

Treat as an explicit override. Useful when the report lives outside `{task-root}/` (e.g., `/wf:verify-spec` was run with a `<path-to-00_reqs.md>` override and wrote the report as a sibling). Write the fix log as a sibling of the override path too.

---

## Direct provider resolution (how `current-branch-query` and `last-commit-timestamp-query` are reached)

Every delivery operation this file invokes — `current-branch-query` (the empty-dispatch id inference above and the Phase 1 branch gate) and `last-commit-timestamp-query` (Phase 2's staleness check) — is reached the same way, per `plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution", mirroring `plugins/wf/agents/branch.md`'s own section:

1. Read the `## Capabilities` registry from `_local/config.md` (the contract's default-absent `registryPath` value).
2. Select the row(s) where `contribution-kind = provider` **and** `scope = delivery`, across the whole registry (a scope filter, independent of which phase value the row itself carries).
3. Read that capability's `manifest.md` at its registry path, then dispatch its fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the referenced file and follow it in-context; no subagent is spawned).
4. **Zero matching rows** — no capability owns the `delivery` surface. Both `current-branch-query` and `last-commit-timestamp-query` fall back silently to their plain-directory-safe cases — no error, no capability term surfaces.

---

## Safety Rules

### Allowed

- Read any file in the repo.
- **Edit source files, but only** at `file:line` locations cited in the loaded `04_verify.md`.
- Write `{task-root}/{task-id}/05_verify-fix.md` (or sibling of the override path).
- Read-only resolution via `current-branch-query` and `last-commit-timestamp-query` (direct provider resolution to the `delivery` surface) for branch gating, id inference, and the staleness check. Working-tree/diff dirty-file inspection is a content-gathering read with no delivery operation of its own — described by outcome, never as a literal command.
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

Before editing any code, verify the current branch matches the audit's target. Extract the first 3+-digit run from `{task-id}` — call it `{numeric-id}`; it is used **only** for the branch-name match below, never for the task folder or any operation.

1. Resolve the current branch via `current-branch-query` (direct provider resolution to the `delivery` surface — see "Direct provider resolution" above). With zero matching delivery-provider rows, this falls back silently to the plain-directory case (no branch to check against).
2. **If the branch name contains `/{numeric-id}-`** (the token defined above, e.g. `feature/6756-...`) — proceed.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing the task id `{task-id}` generically in prose. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.) On `BRANCH — created`/`switched`/`already-active`, continue. On `BRANCH — Error`, stop and surface the subagent's reason.

Rationale: the audit's evidence lines (`file:line`) are only meaningful on the branch that produced them. Fixing on `main` or an unrelated branch edits the wrong state.

---

## Phase 2: Load and Parse the Report

Read `04_verify.md` in full. Extract the header metadata and three lists, preserving order and each finding's identifier (the numbered requirement, or the capability finding's own id — e.g. `MIG-<n>` for a migration-capability finding).

1. **Header metadata** — capture `Branch:`, `Commit:` (HEAD SHA the audit ran against), base SHA, `Tree:` (clean or dirty), and `**Audited at:**` (the timestamp the staleness check below compares against). These may be absent on reports produced before the header was extended — treat as unknown and skip the staleness check below.
2. **Requirements list** — each numbered `[PASS | FAIL | PARTIAL | N/A | UNVERIFIABLE]` item. Capture verdict, requirement text, `Expected`, `Found`, `Location` / `Evidence`, and a `remedy` (the concrete bounded edit the finding names) when the report carries one.
3. **Capability-finding audit** — each `[PASS | FAIL]` line a capability's `verify` `finding` fragment contributed. Capture the rule, file:line, the snippet, and a `remedy` when present. (A capability that produces mechanical-remedy findings — e.g. the migration capability — carries the concrete edit in the finding's `remedy`; this skill applies it, it doesn't know the recipe.)
4. **Deviations from `01_spec.md`** — informational only; do not act on these.

> **Remedy carrier — deferred.** The `verify` `finding` shape a capability emits carries a `remedy` field, but `/wf:verify-spec`'s report schema does not yet render it as a structured field in `04_verify.md`. Until it does, the concrete edit reaches this skill through the finding's `Expected`/`Evidence` text; capture a structured `remedy` when the report carries one and otherwise fall back to the `Expected` state (Phase 5). Wiring the structured `remedy` through the report schema is deferred to the per-phase report-schema work — not this skill.

If the report is malformed (no `## Requirements` heading, no verdict lines), stop and ask the user to re-run `/wf:verify-spec`.

### Staleness check

After parsing the header, invoke `last-commit-timestamp-query` via **direct provider resolution** to the `delivery` surface (see "Direct provider resolution" above) and compare it against the report's own `**Audited at:**` field. Interpret both values as calendar moments and compare chronologically — never a string compare.

- **Last-commit timestamp at or before `Audited at`** — proceed normally.
- **Last-commit timestamp after `Audited at`** — the branch has moved since the audit ran. Every cited `file:line` may now be wrong. Print a prominent warning at the top of Phase 4's plan:
  `⚠ Audit ran at <audited-at>; the branch's last commit is now <last-commit-at>. Cited file:line citations may be stale — consider re-running `/wf:verify-spec` first.`
  Continue anyway. Phase 5 step 2 (confirm `Found` state on disk) catches per-finding drift; the user can abort after seeing the plan if they'd rather re-audit.
- **Audited at field absent, or either value can't be confidently parsed as a calendar moment** — older report format, or an unparseable timestamp. Skip the check silently — this is a soft/advisory check, not a hard gate.

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
- The fix is one or two mechanical edits at the cited location. The finding names the concrete edit; this skill applies whatever the finding's **remedy** describes. The remedy is always one of a small set of bounded shapes:
  - Change a literal value (`= 2` → `= 1`, `number` → `number | null`).
  - Insert a missing member at the right position in an enum or type body.
  - Insert a missing property in an interface or class body.
  - Prepend or replace a marker comment the finding specifies on a cited line (the finding gives the exact marker text; apply it verbatim, and flag any placeholder token it leaves for you to fill in the open questions).
  - Comment out (rather than translate) a forbidden line the finding says must be commented.
  - Apply any other bounded, literal edit the finding's remedy spells out at the cited location.

  This skill does **not** carry the recipes — the concrete remedy for each finding comes from the capability that produced it (e.g. the migration capability's `verify` `finding` fragment carries its own remedy detail). Core applies the remedy the finding names; it never infers a stack-specific fix the report didn't state.
- Applying the fix touches only the cited file, at or adjacent to the cited line.
- The fix does not require choosing between plausible alternatives.

### ASK — present as an open question

Everything not AUTO and not SKIP is ASK. In particular:

- `UNVERIFIABLE` — can't be auto-fixed; needs user judgment or a runtime check.
- `Expected` is vague ("correct", "matches the spec", "follows the pattern") or missing.
- Fix would require a new file, new component, new import graph, or cross-file changes.
- Multiple plausible fixes (e.g., "rename to match source" — the "correct" name might not be obvious from the report alone).
- STOP-AND-ESCALATE gate triggers flagged in the report.
- A finding whose remedy is context-dependent — the finding flags a violation but its remedy isn't a single bounded edit (the right replacement depends on surrounding code the report doesn't pin).
- Any fix that would reverse a deliberate design choice visible in the surrounding code.

When in doubt, classify as ASK. Over-fixing silently is worse than asking.

---

## Phase 4: Print the Plan

Before editing anything, print the classified plan to chat so the user sees what's coming.

```
Verify-fix plan for {task-id} — <N findings total>

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
3. Make the minimal edit the finding names. When the finding carries a `remedy`, apply that concrete bounded edit verbatim; otherwise make the minimal edit that produces the `Expected` state. No adjacent cleanup either way.
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

Write `{task-root}/{task-id}/05_verify-fix.md` (or sibling of the override path). Rotate before overwriting — same pattern as `/wf:verify-spec`:

- Read the current `05_verify-fix.md` if it exists.
- Prepend its contents to `05_verify-fix.history.md` (newest entry on top), followed by a `---` separator on its own line, followed by any prior history contents.
- Then write the new `05_verify-fix.md`.

This keeps a trail of every fix run alongside the audit trail, so the user can see which fixes were attempted across iterations — the history file grows unbounded; prune manually if noisy.

```markdown
# verify-fix: {task-id}

**Source report:** `{task-root}/{task-id}/04_verify.md`
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

1. **Fix log** at `{task-root}/{task-id}/05_verify-fix.md`.
2. **Chat summary** with the plan from Phase 4, the open questions from Phase 6, and the final-output block below.

Target ~25 lines of chat for the summary (not counting the open-question blocks — those are whatever length they need to be).

---

## Edge Cases

- **Report is PASS** — nothing to fix. Emit final output `VERIFY-FIX — NOOP`, no fix log written.
- **Report lists only UNVERIFIABLE / structural findings** — zero AUTO, one or more ASK. Phase 5 is a no-op; Phase 6 still runs; fix log records "0 fixed, N awaiting user"; final output is `PENDING`.
- **Code has moved since the audit** — a cited `file:line` no longer points at the `Found` snippet. Reclassify to ASK (with reason "report may be stale — re-run `/wf:verify-spec`"). Don't try to re-locate the target.
- **Branch has uncommitted changes before the skill runs** — record the dirty files in the fix log's header. Edits from this skill add to the dirty set; the user sees the combined state in the working-tree diff.
- **Multiple findings target the same line** — apply them in report order. If the second edit can no longer find its `Found` snippet (because the first edit moved or replaced it), reclassify the second as ASK.
- **No `04_verify.md`** — stop, say "Run `/wf:verify-spec {task-id}` first."
- **Malformed `04_verify.md`** (no `## Requirements` heading, no verdict markers) — stop, ask the user to re-run `/wf:verify-spec`.
- **Re-run after partial application** — `05_verify-fix.md` is overwritten with the latest run; the prior log rotates into `05_verify-fix.history.md` (newest entry on top, `---` separated). The audit report (`04_verify.md`) may still show the same FAILs until `/wf:verify-spec` is re-run; explain this in the chat summary so the user doesn't loop on a stale report.

---

## Final Output

End the chat reply with this fenced block:

```
VERIFY-FIX — <CLEAN | PARTIAL | PENDING | NOOP>

{task-id}: <a> auto-fixed, <b> awaiting user, <c> skipped
Log: {task-root}/{task-id}/05_verify-fix.md
Next: re-run `/wf:verify-spec <id>` to confirm
```

State meanings:
- `CLEAN` — all findings were AUTO and applied successfully.
- `PARTIAL` — at least one AUTO applied and at least one ASK pending.
- `PENDING` — no AUTO applied (all findings were ASK, or all AUTO were reclassified/failed).
- `NOOP` — report was PASS or had no actionable findings.

**The final output block must always be the very last thing output to chat.**
