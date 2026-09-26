---
name: verify-fix
description: Reads the audit report produced by /wf:verify-spec ({task-root}/{task-id}/04_verify.md), auto-fixes mechanical FAIL/PARTIAL findings with a specific expected value, and presents ambiguous or structural findings as open questions for the user to resolve. Use after /wf:verify-spec when the audit came back with findings and you want to clear the mechanical ones before re-running the audit.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:verify-fix — Apply fixes from a verify-spec audit

Read the audit report at `{task-root}/{task-id}/04_verify.md`, sort FAIL/PARTIAL/UNVERIFIABLE findings into **auto-fix** (mechanical, one or two unambiguous edits) and **ask-user** (structural, ambiguous, or design-laden), apply the auto-fixes, and present the open questions so the user can resolve them. Writes a fix log to `{task-root}/{task-id}/05_verify-fix.md` (or, under the override form, beside the override report — see "The fix-log location") and tells the user to re-run `/wf:verify-spec` afterward to confirm.

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

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). All references to `{task-root}` below come from `coreConfig.taskRoot`. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback.

---

## Dispatch on arguments

First, scan the full argument list for `--attempt <k>` (see below) and strip that flag together with its value out of the list, wherever the pair appears — the dispatch below never sees them. Then parse the first token of what remains.

### empty → infer from current branch

1. Resolve the task id per the shared pipeline conventions doc — obtained via the
   `wf-resolver` MCP tool `resolve_content({ workspaceRoot, ... })` (`class: shared`, `ref: pipeline-conventions.md`),
   never a raw `Read` of the plugin-cache path — §"Id inference from the current branch";
   inferred from the branch via `current-branch-query` (the `wf-resolver`
   `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution" below) and
   resolved against `{task-root}`, naming `/wf:verify-fix` in its stop messages.
2. Confirm `{task-root}/{task-id}/04_verify.md` exists. If not, stop: "No audit report found. Run `/wf:verify-spec {task-id}` first."

### `<id>` (opaque — whatever shape the active tracker capability produces, or the local `T<NNN>` scheme)

Use verbatim as `{task-id}` — no normalization. Then load `04_verify.md` from `{task-root}/{task-id}/`.

### `<path-to-04_verify.md>`

Treat as an explicit override. Useful when the report lives outside `{task-root}/` (e.g., `/wf:verify-spec` was run with a `<path-to-00_reqs.md>` override and wrote the report as a sibling). Write the fix log as a sibling of the override path too.

### The fix-log location (one rule, every reader and writer)

`{fix-log-dir}` is `{task-root}/{task-id}/` under the empty and `<id>` forms, and the directory containing the override `04_verify.md` (the sibling of the override path) under the `<path-to-04_verify.md>` form. The fix log is always `{fix-log-dir}05_verify-fix.md` and its trail `{fix-log-dir}05_verify-fix.history.md`. Phase 1.5's scope scan, the attempt-ledger rebuild, and the Phase 7 write all use this one location, so a scope recorded under the override form is read back from where it was written.

### `--attempt <k>` (optional — composes with any form above)

May appear anywhere in the argument list alongside the empty / `<id>` / `<path-to-04_verify.md>` forms above — it selects the **attempt scope**, never the task or report identity. It is stripped out of the argument list before the first-token dispatch above runs, so its position never shifts which token that dispatch sees — `--attempt 2 WF-663` and `WF-663 --attempt 2` resolve to the same `{task-id}`. When present, `k` is the resolved scope outright. When absent, the scope is resolved in Phase 1.5 below. `--attempt` never changes which task or report this invocation targets.

A bare `--attempt` with no following value (nothing left to pair and strip) is a malformed invocation — stop: "`--attempt` requires a value, e.g. `--attempt 2`." If `--attempt <k>` appears more than once, the **last** occurrence wins as `k`; every occurrence is still stripped before dispatch.

---

## Direct provider resolution (how `current-branch-query` and `last-commit-timestamp-query` are reached)

Every delivery operation this file invokes — `current-branch-query` (the empty-dispatch id inference above and the Phase 1 branch gate) and `last-commit-timestamp-query` (Phase 2's staleness check) — is reached by calling the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface: "delivery" })` — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); core performs **no** registry / manifest / plugin-root read of its own. Obtain each op's body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in this skill's own context to dispatch the operation — never a raw `Read` of the path. On `state: unconfigured` or `unrecoverable` (no readable `delivery` provider — the `unrecoverable` case names the candidate pack(s) in the record's `diagnostics` string), both `current-branch-query` and `last-commit-timestamp-query` fall back silently to their plain-directory-safe cases — no error, no capability term surfaces. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry (WF-272 diagnostics/recovery).

---

## Safety Rules

### Allowed

- Read any file in the repo.
- **Edit source files, but only** at `file:line` locations cited in the loaded `04_verify.md`.
- Write `{fix-log-dir}05_verify-fix.md` and rotate into `{fix-log-dir}05_verify-fix.history.md` (see "The fix-log location" — `{task-root}/{task-id}/`, or the sibling of the override path).
- Read-only resolution via `current-branch-query` and `last-commit-timestamp-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query) for branch gating, id inference, and the staleness check. Working-tree/diff dirty-file inspection is a content-gathering read with no delivery operation of its own — described by outcome, never as a literal command.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 1 branch gate. The wf:branch subagent performs only non-destructive delivery actions — creating or switching to the task branch, fetching the base, and publishing the branch upstream; it never resets, force-pushes, deletes branches, or commits.

### Forbidden

- Fixing things the report didn't cite. If `04_verify.md` doesn't flag it, don't touch it, even if you notice it in the surrounding code.
- Fabricating an "Expected" value the report doesn't contain. If the report says "FAIL — implementation differs" without a specific target, that's an ask-user finding, not an auto-fix.
- Running builds, tests, installs, or `/wf:verify-spec`. The skill stops after applying edits.
- Committing, staging, pushing, or any destructive version-control operation. The user reviews the diff.
- Modifying files outside the repo, or anything under `.git/`.
- Touching `00_reqs.md`, `01_spec.md`, or `02_plan.md` — those are upstream artifacts.

---

## Phase 1: Branch Gate

Before editing any code, verify the current branch matches the audit's target. Extract the first 3+-digit run from `{task-id}` — call it `{numeric-id}`; it and `{task-id}` are the two tokens the branch-name match below accepts. `{numeric-id}` is used **only** there, never for the task folder or any operation, while `{task-id}` stays the verbatim id everywhere else.

Gate on the task branch per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`) §"Branch gate (bare-core aware)", using `{task-id}` and `{numeric-id}` (extracted above) for the branch-name match. On the bare-core skip, report it and proceed (the gate is satisfied).

Rationale: the audit's evidence lines (`file:line`) are only meaningful on the branch that produced them. Fixing on `main` or an unrelated branch edits the wrong state.

---

## Phase 1.5: Resolve Attempt Scope

Resolve the attempt scope `k` this invocation runs under — the key every attempt record below is scoped to. Never infer a resume from branch state, report content, or any signal other than the two named here:

1. **Explicit `--attempt <k>` flag** — wins outright. Use it verbatim as `k`.
2. **Otherwise, scan for the highest already-recorded scope.** Read `{fix-log-dir}05_verify-fix.md` (if present) and every entry in `{fix-log-dir}05_verify-fix.history.md` (if present) — the location "The fix-log location" defines, so the override form scans the sibling of the override path — for `**Attempt:** <k>` header lines; take the highest `k` found across both.
3. **Otherwise** (no flag, nothing recorded yet) — default `k = 1`.

Hold the resolved `k` for the ledger rebuild (below) and the Phase 7 write.

---

## Phase 2: Load and Parse the Report

Read `04_verify.md` in full. Extract the header metadata and five lists, preserving order and each finding's identifier (the numbered requirement, or the capability finding's own id — e.g. `MIG-<n>` for a migration-capability finding).

1. **Header metadata** — capture `Branch:`, `Commit:` (HEAD SHA the audit ran against), base SHA, `Tree:` (clean or dirty), and `**Audited at:**` (the timestamp the staleness check below compares against). These may be absent on reports produced before the header was extended — treat as unknown and skip the staleness check below.
2. **Requirements list** — each numbered `[PASS | FAIL | PARTIAL | N/A | UNVERIFIABLE]` item. Capture verdict, requirement text, `Expected`, `Found`, `Location` / `Evidence`, and a `Remedy` line (the concrete bounded edit) when the report carries one. Mint its fingerprint as `path/to/file:L|R<n>` — its own `Location` plus this item's own list number (stable for the life of one loop: the Safety Rules already forbid touching `00_reqs.md`/`01_spec.md`, so the spec never shifts mid-loop).
3. **Capability-finding audit** — each `[PASS | FAIL]` line a capability's `verify` `finding` fragment contributed. Capture the rule, file:line, the snippet, and a trailing `— Remedy: <text>` clause when present. (A capability that produces mechanical-remedy findings — e.g. the migration capability — carries the concrete edit in the finding's `remedy`; this skill applies it, it doesn't know the recipe.) Its fingerprint is the finding's own `file:section|defect` marker, carried verbatim — never re-minted.
4. **Deviations from `01_spec.md`** — informational only; do not act on these.
5. **Adversarial findings**, when the report carries that section — informational only; do
   not act on these. They are non-gating by contract and never change a verdict, so this
   skill has nothing mechanical to apply. Reports that carry no such section simply omit it.
6. **Counterparts**, when the report carries that section — informational only; do not act on
   these. They are advisory by contract and never change a verdict.

> **Remedy carrier.** `/wf:verify-spec`'s report schema renders `Remedy` as a structured field on FAIL/PARTIAL requirement items and as a trailing clause on capability findings, whenever the underlying `finding` carries one. Capture it verbatim when present. Reports produced before this field existed simply omit it — fall back to the `Expected` state in that case (Phase 5).

If the report is malformed (no `## Requirements` heading, no verdict lines), stop and ask the user to re-run `/wf:verify-spec`.

### Staleness check

After parsing the header, run the staleness check per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`) §"Report/spec staleness check", comparing `last-commit-timestamp-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution" above) against the report's own `**Audited at:**` field. If the branch has moved since, print a prominent warning at the top of Phase 4's plan:

`⚠ Audit ran at <audited-at>; the branch's last commit is now <last-commit-at>. Cited file:line citations may be stale — consider re-running `/wf:verify-spec` first.`

Continue anyway. Phase 5 step 2 (confirm `Found` state on disk) catches per-finding drift; the user can abort after seeing the plan if they'd rather re-audit.

The dirty-tree flag in the header is informational; uncommitted changes since the audit are normal mid-fix and don't trigger a warning on their own.

---

## The attempt ledger

Before Phase 3 classification, on every invocation, rebuild — never recompute — a per-fingerprint attempt ledger from `{fix-log-dir}05_verify-fix.md` (if present) and `{fix-log-dir}05_verify-fix.history.md` (if present) — the same location Phase 1.5 scans and Phase 7 writes (see "The fix-log location") — keyed on `(fingerprint, scope)`. Field set and the rebuild algorithm live in `attempt-ledger.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: verify-fix`, `ref: attempt-ledger.md`), never a raw `Read` of the plugin-cache path — followed in-context here, the role `verify-fix-template.md` plays at Phase 7.

Simpler than verify-spec's own finding ledger: the attempt scope `k` is always an explicit input (Phase 1.5), never derived from a round boundary — no `PASS`/pre-fingerprint-boundary walk is needed. Every trail entry is read and grouped by its own recorded `**Attempt:** <k>` header.

A blocking fingerprint already carrying an outcome for the **current** scope `k` is routed to `## Awaiting user` at the top of Phase 3 below — no verify-first re-check, no edit. One with no record for scope `k` proceeds through Phase 3/5 exactly as before; whatever it produces becomes that fingerprint's record for scope `k`.

---

## Phase 3: Classify Findings

First, check every blocking item's fingerprint (Phase 2) against the attempt ledger rebuilt above for the resolved scope `k` (Phase 1.5). A match routes straight to **ROUTED** — skip the rest of this phase and Phase 5 entirely for that item. Everything else is walked and sorted into **AUTO**, **ASK**, or **SKIP** exactly as before.

### ROUTED — already attempted this scope

A blocking fingerprint (a requirement `FAIL`/`PARTIAL`, or a capability finding's own fingerprint) that the attempt ledger already carries an outcome for, in the current scope `k`. Route it straight to `## Awaiting user` carrying its prior outcome and scope — no verify-first re-check (Phase 5 step 2), no edit. This is not a fresh AUTO/ASK/SKIP decision; the fingerprint's outcome for this scope was already decided in an earlier invocation.

### SKIP

- Verdict `PASS` or `N/A` — not a finding.
- Informational deviations from `01_spec.md`.
- Every entry under `## Adversarial findings` — advisory and non-gating by contract; this
  skill reports them as skipped rather than dropping them silently.
- Every entry under `## Counterparts` — advisory by contract; a listed copy may be left
  unchanged on purpose. This skill reports each one as skipped and never edits a listed
  location on its strength.

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

Routed (already attempted) (<r>):
  <id>  <one-line summary>  <file:line>  — prior: <outcome> (scope <k>)
  ...

Auto-fix (<a>):
  <id>  <one-line summary>  <file:line>
  ...

Ask user (<b>):
  <id>  <one-line summary>  <file:line>
  ...

Skipped (<c>): <verdict counts>
```

Here, `<b>` counts only the freshly-classified ASK bucket, disjoint from the separately-printed `<r>` ROUTED bucket — the two downstream consumers below (Phase 7's index summary, the Final Output block) instead report `<b>`/`<m>` as **one combined total**, ASK plus ROUTED together, since both land in the same `## Awaiting user` section of the fix log. This plan's own `<b>` is a narrower, ask-only count printed here only.

Do not wait for approval — proceed to Phase 5 immediately. The plan exists so the user can interrupt if a classification looks wrong.

---

## Phase 5: Apply Auto-fixes

For each AUTO finding, in report order:

1. Read the cited file around the target line.
2. Confirm the `Found` state matches what's on disk. If it doesn't (the code has changed since the audit, or the citation is off by more than one or two lines), reclassify the finding as ASK and record the reason. Do not guess a new location. This check's outcome is keyed to the finding's fingerprint and becomes that fingerprint's attempt record for scope `k` (Phase 7) — not only a one-run log line; a later invocation in the same scope reads it back via the attempt ledger instead of repeating this check.
3. Make the minimal edit the finding names. When the finding carries a `remedy`, apply that concrete bounded edit verbatim; otherwise make the minimal edit that produces the `Expected` state. No adjacent cleanup either way.
4. Re-read the file to confirm the edit applied as intended.
5. Record the result in the fix log: `[FIXED]` with a one-line diff summary, or `[SKIPPED]` with the reason if Phase 5 step 2 reclassified it.

**If an edit fails or produces an unexpected result** (e.g., the `old_string` appears more than once, the file is write-protected): stop that finding, record it as `[FAILED]` with the error, and continue with the next finding. Do not retry with a guess.

Do not batch edits from different findings into one tool call — per-finding edits make the fix log precise and let a single failure not cascade.

---

## Phase 6: Present Open Questions

For each ASK finding, emit a numbered question block. ROUTED entries print differently — see
below — since no edit is proposed and no reply is solicited.

Format (ASK):

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

Format (ROUTED):

```
Q<n>. <requirement text>  (<id>, <verdict> — routed)

  Prior attempt (scope <k>):
    Outcome:  <FIXED | FAILED | SKIPPED>
    Location: <file:line>
    Detail:   <the prior Reason:/Error: text, when the outcome carried one — omit for FIXED>

  Already attempted in this scope — no edit proposed, no reply needed. Open a new attempt
  scope (`--attempt <k+1>`) to retry.
```

After printing all questions, **stop**. Do not proceed to further edits in the same turn — the user replies, then re-invokes the skill or responds inline so a follow-up turn can apply their answers.

---

## Phase 7: Write the Fix Log

Write `{fix-log-dir}05_verify-fix.md` (see "The fix-log location" — `{task-root}/{task-id}/`, or the sibling of the override path). Rotate the prior `{fix-log-dir}05_verify-fix.md` into `{fix-log-dir}05_verify-fix.history.md` before overwriting, per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`) §"Artifact rotation into `.history.md`". This keeps a trail of every fix run alongside the audit trail, so the user can see which fixes were attempted across iterations.

The verbatim `05_verify-fix.md` fix-log template — the metadata block, `## Auto-fixed`, `## Awaiting user`, and `## Next` — lives at `verify-fix-template.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: verify-fix`, `ref: verify-fix-template.md`), never a raw `Read` of the plugin-cache path. It is read only on this write path (Phase 7), so it stays out of the boot body. Follow it, then emit it with placeholders substituted.

Populate the `**Attempt:** <k>` header with the scope resolved in Phase 1.5, and each entry's `- Fingerprint:` line with the fingerprint minted in Phase 2 — these become the attempt ledger's own source data for the next invocation's rebuild.

If the write fails (permissions, path missing), stop and report. Do not fall back to printing the log inline instead of to disk — the durable artifact matters for later re-runs.

**After writing the fix log**, invoke the routed `/wf:index <id> verify-fix "<a> auto-fixed · <b> open questions"` wrapper to record it in the per-task index. The wrapper owns the fixed `index` routing decision; do not inline or bypass it. Substitute the AUTO count produced in Phase 5, and `<b>` with the **combined** ASK-plus-ROUTED count (Phase 6's `## Awaiting user` entries) — not Phase 4's ask-only plan bucket of the same symbol. Skip this step when the `<path-to-04_verify.md>` override form is used and the log lives outside `{task-root}/`.

---

## Output

Two outputs, always both:

1. **Fix log** at `{fix-log-dir}05_verify-fix.md` (see "The fix-log location").
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
Log: {fix-log-dir}05_verify-fix.md
Next: re-run `/wf:verify-spec {task-id}` to confirm
```

`<b>` here is the **combined** ASK-plus-ROUTED count — every entry the fix log's `## Awaiting user` section carries, both freshly-classified ASK findings and fingerprints ROUTED from a prior scope's attempt record — not Phase 4's ask-only plan bucket printed under the same symbol; that plan bucket is a narrower, in-chat-only figure.

State meanings:
- `CLEAN` — all findings were AUTO and applied successfully.
- `PARTIAL` — at least one AUTO applied and at least one ASK pending.
- `PENDING` — no AUTO applied (all findings were ASK, or all AUTO were reclassified/failed).
- `NOOP` — report was PASS or had no actionable findings.

**The final output block must always be the very last thing output to chat.**
