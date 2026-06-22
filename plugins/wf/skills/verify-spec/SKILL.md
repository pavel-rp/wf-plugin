---
name: verify-spec
description: Audits the current branch's implementation against the authoritative ADO requirements in _local/ADO-<id>/00_reqs.md, writing a PASS/FAIL/PARTIAL report with file and line evidence to _local/ADO-<id>/04_verify.md and printing a concise summary to chat. Use before opening a PR on an ADO-tracked task to confirm strict conformance.
allowed-tools: [Read, Write, Glob, Grep, Bash]
---

# /wf:verify-spec — Audit implementation against the original ADO task

Thoroughly verify that the current branch's implementation strictly follows the original ADO task requirements. Source of truth is `_local/ADO-<id>/00_reqs.md` (auto-fetched from Azure DevOps) — NOT the LLM-generated `01_spec.md` or `02_plan.md`. Use when the user asks to "verify the implementation against the spec", "check if I followed the requirements", "audit this branch against ADO-XXXX", or wants a strict conformance report before opening a PR.

The only authoritative spec in this repo is the **auto-fetched ADO requirements**
living at `_local/ADO-<id>/00_reqs.md`. The sibling `01_spec.md` / `02_plan.md`
are LLM-generated interpretations and must NOT be used as the source of truth
for verification (they may have drifted or over-specified).

Verification is **strict and evidence-based**: every requirement in `00_reqs.md`
must be resolved to PASS / FAIL / PARTIAL / N/A with a concrete `file:line`
citation or a clearly stated reason for the verdict. No vibes, no "looks good".

---

## Dispatch on arguments

Parse the first token. Recognized forms:

### empty → infer from current branch

1. Run `git branch --show-current`. Expect something like
   `feature/6756-cra-shared-state-models` or `feature/task-6756-...`.
2. Extract the first run of 3+ digits → the ADO id.
3. Confirm `_local/ADO-<id>/00_reqs.md` exists. If not, stop and ask the user
   to either pass the id explicitly or fetch the requirements first.

### `<ado-id>` (e.g. `6756`, `ADO-6756`, `ADO_5917`)

Normalize to the folder that actually exists under `_local/` — some older
folders use `ADO_` (underscore) instead of `ADO-` (hyphen). Check both.

### `<path-to-00_reqs.md>`

Treat as an explicit override. Useful when verifying against a pasted spec
that lives outside `_local/`.

If `00_reqs.md` is missing, do not fall back to `01_spec.md`. Stop and tell
the user. They either need to fetch the ticket or pass a path explicitly.

---

## Pre-flight: anchor against source for migration tasks

After resolving `<id>`, before extracting requirements:

1. **Detect whether this is a migration task.** Read `01_spec.md`'s metadata block (the `**Type:**` line only — NOT its success criteria) if present; `**Type:** migration` is the signal. If `01_spec.md` is absent, scan `00_reqs.md` for migration markers: an `MVC source:` line, `ComplianceRisk.WebUI` referenced as the source, or `Migrate ... to Angular` in the title. Reading `01_spec.md` for routing metadata does NOT count as using it as source of truth — that prohibition is about requirements, not about which workflow path to take.

2. **If the task IS a migration AND `_local/ADO-<id>/03_migration-map.md` does NOT exist**, invoke the **Task** tool with `subagent_type: wf:migration-map`, passing `ado-id: <id>`. The migration-map is the third-party anchor that grounds verification against the actual source code being ported — not just the ticket text. Without it, ticket overspecification (fields the ticket added that don't exist in the source) shows up as false-positive `FAIL`s. (Do NOT call `/wf:migration-map` directly — that loads its `SKILL.md` into this skill's context. The subagent is self-sufficient.)

3. **Confirm the anchor landed on disk — do not take the subagent's word for it.** After the subagent returns, check that `_local/ADO-<id>/03_migration-map.md` now exists. If it does **not** — whether the subagent returned `MIGRATION-MAP — error`, the `wf:migration-map` subagent is not registered in this environment, or subagent invocation is unavailable — **STOP and surface the failure**; do not emit a `VERIFY` verdict, since no grounded verification ran. Do **not** substitute a hand-rolled, in-context anchor and continue: an un-grounded migration audit is exactly the false-positive `FAIL` machine this pre-flight exists to prevent, and the next phase (and `04_verify.md` itself) expect the durable `03_migration-map.md` file, not an anchor that lived only in this turn's context. Tell the user the one-line reason and the command to retry (`/wf:migration-map <id>`, then re-run `/wf:verify-spec <id>`). Override: when the user passes the `<path-to-00_reqs.md>` form, this whole pre-flight is skipped — that path implies an out-of-tree audit where map generation may not apply.

This pre-flight is a no-op for non-migration tasks (`feat` / `fix` / `chore` / `refactor` / `docs` / `hotfix`). `00_reqs.md` is sufficient on its own when there is no source code being ported.

---

## Inputs to load

Always read, in order:

1. **`_local/ADO-<id>/00_reqs.md`** — the authoritative requirements. Read
   the whole file; do not skim. Pay attention to:
   - Description / Requirements bullets
   - "Important Note" and STOP-AND-ESCALATE gates
   - Acceptance criteria if present
   - Parent Context section (may carry constraints inherited from the PBI)
2. **Parent task** if referenced (e.g., `**Parent:** #6754`). If
   `_local/ADO-<parent>/00_reqs.md` exists, read it for inherited constraints
   (type mapping tables, naming conventions, cross-task rules).
3. **Implementation scope** — the diff of the current branch vs `main`, plus the commit coordinates the audit runs against:
   ```
   git rev-parse --abbrev-ref HEAD        # branch name
   git rev-parse HEAD                     # HEAD SHA (full)
   git merge-base main HEAD               # base SHA — the "main" side of the diff
   git status --porcelain                 # dirty tree? list files if any
   git diff --stat main...HEAD
   git diff main...HEAD
   ```
   This is the set of code actually under audit. Don't verify against
   uncommitted noise from unrelated files; call those out separately.
   Record the branch, HEAD SHA, base SHA, and dirty-tree flag in the report
   header — this lets a reader tell which commit a stale report corresponds
   to, and lets `/wf:verify-fix` detect when the branch has moved since the
   audit ran (cited `file:line` citations go stale with every commit).
4. **Migration Guidelines** from user memory
   (`reference_migration_guidelines.md`) — applies to every CRA→Angular
   migration task. Key invariants to check regardless of what the ticket
   says:
   - No refactor; copy with only platform-necessary changes.
   - Ids / names / classes preserved, even if wrong capitalization.
   - Comment format: `//MIGRATION NOTE (<initials>):`,
     `//MIGRATION QUESTION (<initials>):`, `//MIGRATION TODO (<initials>):`.
   - No jQuery, no raw `window` / `document` outside of
     `document.querySelector` + `Renderer2`.
   - No cookies on Angular side.
   - `CacheUtility.*` and PDF render mode branches are commented out, not
     translated.
5. **`_local/ADO-<id>/03_migration-map.md`** if present (guaranteed for
   migration tasks per pre-flight; absent otherwise). This is the third-party
   anchor — it compared ticket against source-being-ported and flagged where
   the ticket invented fields the source doesn't have. During verification:
   - Items the map flagged as **deviations** or **open questions to Zach** →
     downgrade the corresponding ticket requirement to `UNVERIFIABLE` in the
     report (not `FAIL`), citing the map row.
   - When ticket and source disagree per the map, **the source is canon**
     (migration guideline: "1:1 port, no refactor"). If the implementation
     matches the source, mark it `PASS` even when the ticket text says
     otherwise — the ticket has overspecified.
   - The map does NOT replace `00_reqs.md` for items where ticket and source
     agree. Only override on disagreement.

---

## Extract the requirement list

From `00_reqs.md`, produce a flat numbered checklist. Each item should be one
atomic, checkable claim. Rules:

- One bullet in the source may expand into multiple atomic items (e.g.,
  "declare X enum with values A=1, B=2" → one item for existence, one per
  value).
- Include every "must", "should", and "do NOT" statement. Negatives count
  as requirements and need evidence that the forbidden thing is absent.
- Pull constraints out of tables (type mapping, value tables) as separate
  items — each row is typically its own check.
- STOP-AND-ESCALATE gates are requirements: verify they were honored
  (i.e., no unmapped type slipped through).
- "Notes to Implementer" / pattern references are context, not
  requirements — do not fabricate checks from them unless the prose says
  "must follow".

Show the user this extracted list before verifying, so they can catch
misreadings early on long tickets.

---

## Verification, one item at a time

**Tool note:** the bullets below reference `Grep` and `Glob` for brevity. When sourcebot MCP is available, prefer `mcp__sourcebot__search_code` for symbol/content lookups and `mcp__sourcebot__read_file` for file reads — it's indexed, faster, and covers cross-repo targets. Fall back to `Grep`/`Glob` only when sourcebot is unavailable or for file-pattern searches (e.g., finding all `.cshtml` files).

For each extracted requirement, gather evidence:

- **File existence / location** → `Glob` or `Read`. Cite the path.
- **Symbol existence / shape** → `Grep` for the symbol, then `Read` the
  surrounding block. Cite `file:line`.
- **Value-level claims** (enum values, default values, property types) →
  `Read` the exact lines. Quote them in the verdict.
- **"No refactor" / "ids preserved"** → compare against the C# / MVC source
  referenced in `00_reqs.md`. `Read` both sides, diff mentally, cite the
  matching lines. If the ticket references a specific C# file, open it.
- **Absence claims** (no jQuery, no duplicate declarations, no uncommented
  `CacheUtility`) → `Grep` across the touched files and surrounding area.
  A clean `Grep` result is valid evidence; say "grep returned 0 hits in
  <scope>".
- **Comment-format claims** → `Grep` for the required marker in the new
  files. Missing markers on non-mechanical mappings = FAIL.

Do NOT trust `01_spec.md`'s Success Criteria as a shortcut. If the spec
paraphrases a requirement, re-read the raw `00_reqs.md` line and verify
against that wording. Spec drift is the single most common failure mode
this skill exists to catch.

Verdicts:

- **PASS** — evidence matches the requirement exactly. Cite it.
- **FAIL** — evidence contradicts, or the required artifact is missing.
  State what the ticket asked for and what you found.
- **PARTIAL** — requirement has N sub-claims and M < N are satisfied. List
  which sub-claims fail.
- **N/A** — requirement was explicitly scoped out by a later ticket comment
  or parent constraint. Cite the source of the exclusion.
- **UNVERIFIABLE** — requirement cannot be checked from static code alone
  (e.g., "works at runtime"). Say so; suggest a runtime check
  (`npm test`, Chrome MCP, `tsc --noEmit`).

---

## Migration-rule audit (always run)

In addition to ticket-specific items, run these checks on every changed
file in the diff and add the results as a separate section of the report:

1. `Grep` for `$`, ` jQuery`, `$(` — should be 0 hits in new `.ts`/`.html`.
2. `Grep` for `window\.` and `document\.` — flag anything that isn't
   `document.querySelector` or a documented exception.
3. `Grep` for `CacheUtility` — if present, must be inside a comment block.
4. `Grep` for `//MIGRATION` in new files — count hits; absence on a
   non-mechanical migration is a smell worth flagging.
5. Check that ids / names / CSS classes in new HTML match the referenced
   MVC partial. If the ticket names a specific `.cshtml`, open it and
   diff id-for-id.

These checks are invariants, not opinions. If a requirement in the ticket
explicitly overrides one (rare), note the override and skip the check.

---

## Output

Two outputs, always both:

1. **Full report** — written to `_local/ADO-<id>/04_verify.md`, which always holds the latest run. Before overwriting, rotate the existing file's contents into `_local/ADO-<id>/04_verify.history.md`:
   - Read the current `04_verify.md` if it exists.
   - Prepend its contents to `04_verify.history.md` (newest entry on top), followed by a `---` separator on its own line, followed by any prior history contents.
   - If `04_verify.md` doesn't exist yet (first audit), skip the rotation.
   - If `04_verify.history.md` doesn't exist yet, create it from the rotated content alone.

   This gives a trail of every prior audit run at this path, so the user can compare findings across iterations and see what a fix broke or regressed. Each archived entry is self-identifying via its own header (`**Commit:** <SHA>`, `**Audited at:** <timestamp>`). The history file grows unbounded — the user prunes it manually if it gets noisy.

   When the `<path-to-00_reqs.md>` override form is used, write both files (`04_verify.md` and `04_verify.history.md`) as siblings of that file instead.
2. **Chat summary** — concise overview printed inline so the user can triage pass/fail without opening the file.

Write the file first, then print the chat summary. If the write fails (permissions, path missing), stop and report the failure — do NOT fall back to printing the full report inline.

**After writing the report**, invoke `/wf:index <id> verify "<a> PASS · <b> FAIL · <c> PARTIAL"` to record the audit in the per-task index. Substitute each placeholder with its own count (omit zero-count categories — e.g. `12 PASS · 1 FAIL`). Skip this step when the `<path-to-00_reqs.md>` override form is used and the report lives outside `{task-root}/`.

### Full report shape (`04_verify.md`)

```
# verify-spec: ADO-<id>

**Source:** `_local/ADO-<id>/00_reqs.md`
**Branch:** `<branch name>`
**Commit:** `<HEAD SHA>`  (base `<merge-base SHA>`)
**Tree:** clean  |  dirty — <N> uncommitted files: `<path>, <path>, …`
**Scope:** `git diff main...HEAD` — <N files, +X/-Y>
**Verdict:** <PASS | FAIL | PARTIAL>  (<passed>/<total> requirements)
**Audited by:** <model identifier>
**Audited at:** <ISO 8601 timestamp>

## Requirements

1. [PASS] <requirement text>
   - Evidence: `path/to/file.ts:42` — `<quoted line or snippet>`

2. [FAIL] <requirement text>
   - Expected: <what 00_reqs.md says>
   - Found: <what the code actually has>
   - Location: `path/to/file.ts:L`

...

## Migration-rule audit

- [PASS] No jQuery (`$` grep → 0 hits in changed `.ts`/`.html`)
- [FAIL] `window.location` used at `foo.component.ts:87` — migration rule
  says replace with Angular equivalents.

## Deviations from `01_spec.md` (informational)

If you noticed the LLM spec over- or under-specified vs `00_reqs.md`, list
the drift here so the user can tighten the spec template next time.
Informational only — does NOT affect the verdict.

## Recommended next actions

- Short, ordered list. "Fix X at file:line", "Run `tsc --noEmit`",
  "Ask Zach about Y".
```

Keep quoted snippets short — one or two lines max. The reader should be
able to click `file:line` to see the rest.

### Chat summary shape

Print, in this order:

- **Verdict line:** `**Verdict:** <PASS | FAIL | PARTIAL>` — `<n>/<total>` requirements.
- **Report pointer:** one line — `Report: _local/ADO-<id>/04_verify.md`.
- **FAILs and PARTIALs:** one bullet each — short requirement name, one-line reason, `file:line` citation. Skip the section entirely if none.
- **Migration-rule audit:** one line — either `clean` or `<N> issues: <comma-separated shortlist>`.
- **Top next actions:** 1–3 bullets — the most important items from the report's "Recommended next actions".
- **`/wf:verify-fix` suggestion (conditional):** one line — `Suggested: /wf:verify-fix <id> — <N> mechanical fixes look auto-applicable.` Include **only** when at least one FAIL or PARTIAL finding has a concrete literal `Expected` value at a cited `file:line` (i.e., the sort of thing `/wf:verify-fix` would classify as AUTO: a specific value, enum member, missing property, missing `//MIGRATION` marker, or forbidden pattern with a mechanical remedy). Omit the line on PASS reports, when every finding is UNVERIFIABLE or structural, or when the `Expected` fields are all vague ("matches the spec", "follows the pattern"). When in doubt, omit — a false positive here wastes a `/wf:verify-fix` run.

Target ~15 lines total. If the summary grows past that, trim detail, not items — the user can open the file for the rest.

End with the final-output block (see below).

---

## What this skill will NOT do

- Will NOT modify any source file outside `_local/`. Verification is read-only
  against the codebase. The only write is `_local/ADO-<id>/04_verify.md`
  (the audit report). If the user wants fixes to source, they ask separately
  after reading the report.
- Will NOT mark something PASS without concrete evidence. "Looks correct"
  is not a verdict.
- Will NOT use `01_spec.md` as the source of truth. It is an artifact, not
  a contract.
- Will NOT invent requirements not present in `00_reqs.md`. If the
  migration guidelines imply something the ticket is silent on, that goes
  in the Migration-rule audit section, not in the numbered requirements
  list.

---

## Edge Cases

- **`00_reqs.md` is stale**: the header says `Auto-fetched from Azure
  DevOps work item #X on <date>`. If that date is older than the most
  recent commit on the branch, warn the user — the ticket may have been
  updated since. Continue anyway, but flag it.
- **Requirements reference C# files that no longer exist**: the `.cs`
  file may have moved or been renamed. `Glob` for the basename before
  giving up. If truly missing, mark the dependent requirements
  UNVERIFIABLE and say why.
- **Branch has commits from multiple tickets**: `git log main..HEAD
  --oneline` will show this. Only verify the files touched for this
  ticket; list the unrelated commits separately.
- **Uncommitted changes**: `git status` shows dirty tree. Verify against
  `HEAD`, not the working tree — and note the dirty files so the user
  knows they weren't included.
- **Re-run after fixes**: `04_verify.md` is overwritten with the latest
  run. The prior report is rotated into `04_verify.history.md` first
  (newest entry on top, separated by `---`), so the user has a trail of
  findings across iterations — useful when a fix introduces a regression
  or the same finding keeps reappearing. The history file grows unbounded;
  prune or delete manually if it gets noisy.

---

## Final Output

End the chat reply with this fenced block, after the chat summary:

```
VERIFY — <PASS | FAIL | PARTIAL>

ADO-<id>: <passed>/<total> requirements, migration-rule audit <clean | N issues>
Report: _local/ADO-<id>/04_verify.md
Next: <branched on the verdict — see below>
```

The `Next:` line is **always present**, branched on the verdict:

- **PASS** → `/wf:qa-gen <id>` (proceed to QA).
- **FAIL/PARTIAL with at least one mechanically fixable finding** → `/wf:verify-fix <id>` (the same finding that gates the chat summary's `/wf:verify-fix` suggestion).
- **FAIL/PARTIAL with only manual/structural findings** → `fix the findings in 04_verify.md, then re-run /wf:verify-spec <id>`.

**The final output block must always be the very last thing output to chat.**
