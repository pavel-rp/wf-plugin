---
name: spec
description: Writes a grounded task specification (01_spec.md) for an ADO work item by fetching requirements from Azure DevOps, exploring the current codebase, and resolving ambiguities interactively. Use when the user starts a new ADO-tracked task and needs to document scope before planning.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:spec — Grounded task specification from an ADO work item

Write a spec (`01_spec.md`) for a task. Accepts an ADO work item ID, fetches the work item directly from Azure DevOps, creates a task folder under `{task-root}/`, and writes a grounded spec. Explores the codebase, resolves ambiguities interactively, and produces a clean spec.

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}`, `{ado-project}`, and `{wi-prefix}` below come from that file. Never hardcode these values.

---

## Command Syntax

```
/wf:spec <ado-id> [--type feat|fix|chore|refactor|migration|docs|hotfix] [--complexity S|M|L]
```

### Arguments

| Argument          | Required | Description                                                        |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `<ado-id>`        | NO       | ADO work item ID — numeric (e.g. `6396`) or prefixed (e.g. `ADO-6396`). Falls back to inferring from the current git branch. First run for a new task needs an explicit ID (branch doesn't exist yet). |
| `--type <type>`   | NO       | One of: `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`. When supplied, wins over `/wf:classify` and is treated as confidence `high`. Defaults to whatever `/wf:classify` returns. |
| `--complexity <c>`| NO       | `S`, `M`, or `L`. Resolution order: `--complexity` flag → `triage.md` Size field → `M` default. |

### Folder Convention

All task folders live under `{task-root}/` in the repo root:

```
{task-root}/{wi-prefix}-{id}/
├── 00_reqs.md           # Requirements (from ADO)
├── 01_spec.md           # Specification (this skill)
├── 02_plan.md           # Implementation plan (wf:plan)
├── research/            # Codebase exploration notes, analysis, investigations
├── assets/              # Screenshots, mockups, trace files, images
└── artifacts/           # Diffs, test cases, test results, generated outputs
```

**Core files** (`00_reqs.md`, `01_spec.md`, `02_plan.md`) live at the task folder root.
**Non-essential files** go into subfolders:
- `research/` — exploration notes, profiling results, investigation logs, architectural analysis
- `assets/` — images (screenshots, mockups, diagrams), trace files, binary files
- `artifacts/` — code diffs, test cases, test results, migration scripts, generated output

### Validation

- If `<ado-id>` is provided, use it. If omitted, infer from `git branch --show-current`: extract the first 3+-digit run. If no digit run exists (e.g., on `main`), stop: "No ADO ID provided and none could be inferred from the current branch. Pass the ID explicitly: `/wf:spec <ado-id>`."
- Extract the numeric ID: `6396` from `6396`, `ADO-6396`, or `ADO_6396`.
- **Task folder:** `{task-root}/{wi-prefix}-{id}/` (e.g. `_local/ADO-6396/`). Create if it doesn't exist.
- **Task ID:** `{wi-prefix}-{id}` (e.g. `ADO-6396`).
- If `00_reqs.md` already exists in the folder, skip the ADO fetch and use the existing file.

**Type resolution:** If `--type` is provided, use it (treat as `Confidence: high`). Otherwise, defer until Phase 0.7, which delegates to `/wf:classify`. Do NOT keyword-scan inline — the rubric lives in the classifier.

**Complexity resolution:** Apply in order, first match wins.
1. If `--complexity` is provided, use it. Source: `flag`.
2. Else, if `{task-root}/{wi-prefix}-{id}/triage.md` exists and has a `**Size:** <S|M|L>` field (not `—`), use that value. Source: `triage`.
3. Else, default to `M`. Source: `default`.

Record the resolved value and source — both appear in the Final Output block so the user can see where the sizing came from.

---

## Phase 0: Fetch from ADO and Create Requirements

Always runs first unless `00_reqs.md` already exists in the task folder.

### Fetch Procedure

1. **Fetch the work item** using `mcp_ado_wit_get_work_item`:
   - `id`: the extracted numeric ID
   - `project`: `{ado-project}` (from config)
   - `expand`: `"all"` (to get description, acceptance criteria, and relations)
   - If the call fails, stop and report: "ADO work item #<ID> not found or inaccessible."

2. **Resolve parent context (always).** Inspect relations for a parent work item and fetch the immediate parent when present, even if the child description is complete. Parent items often contain scope boundaries, acceptance criteria, and cross-task constraints that the child omits.

3. **Check for empty requirements.** If the child description is empty/minimal, use parent description as the primary requirement source. If both are empty/minimal, create a minimal requirements file and warn the user.

4. **Backfill an empty "Dev" child description (the library's single ADO write).** If ALL of the following hold:
   - the child work item's title starts with `Dev` (e.g. `Dev`, `Dev:`, `Dev — backend part`),
   - the child description is empty or minimal (blank, whitespace-only, or merely restating the title),
   - a parent work item was resolved in step 2 and has a non-empty description,

   then write a description onto the **child** work item:
   - Compose `X` — the most concise statement of what's to be done, **5 words max**, derived from the parent title/description (e.g. `CSV export for audit log`).
   - Pick the sentence by the parent's work item type: parent is a Bug → `Fix X as described in the parent bug (<link>)`; parent is a PBI / Product Backlog Item / User Story / Feature → `Implement X as described in the parent PBI (<link>)`.
   - `<link>` is an HTML anchor to the parent work item with link text `<parent-id>: <parent title>` (e.g. `<a href="...">6390: Audit log CSV export</a>`). Use the parent's `_links.html.href` from the fetch response for the href; fall back to `https://dev.azure.com/<org>/{ado-project}/_workitems/edit/<parent-id>` (derive `<org>` from the child's own URL). ADO description fields are HTML.
   - Update via the ADO MCP work-item update tool (`mcp_ado_wit_update_work_item` or the batch variant), patching **only** `System.Description` on the child. Never touch any other field, any other work item, or a non-empty description — this backfill is the only ADO write any skill in the library performs.
   - Use the same sentence as the `## Description` body of `00_reqs.md` (step 8); the Parent Context section still carries the substance.
   - If the update tool is unavailable or the write fails, continue the spec flow and record in `00_reqs.md`: "Child description backfill failed: <reason>".

5. **Fetch discussion comments** using `mcp_ado_wit_list_work_item_comments`:
   - `project`: `{ado-project}` (from config)
   - `workItemId`: same ID
   - If a parent exists, also fetch parent comments and include only substantive notes.

6. **Fetch visual attachments (required when present).**
   - Inspect child (and parent, when present) work item relations for `AttachedFile` links.
   - Keep image attachments only (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.svg`).
   - Download each image using `mcp_ado_wit_get_work_item_attachment` into `{task-root}/{wi-prefix}-{id}/assets/ado/`.
   - Open each downloaded image with the image-view tool and extract only task-relevant facts (UI labels, error text, expected layout cues, highlighted fields).
   - Write a short per-image note into `00_reqs.md` (and `research/exploration.md` for L complexity when needed). Do not infer hidden behavior from visuals.
   - If an image cannot be downloaded or viewed, continue and record the failure reason in `00_reqs.md`.

7. **Create the task folder** `{task-root}/{wi-prefix}-{id}/` if it doesn't exist.

8. **Write `00_reqs.md`** in the task folder:

```markdown
# {wi-prefix}-{id}: {Work Item Title}

> Auto-fetched from Azure DevOps work item #{id} on {YYYY-MM-DD}
> Type: {work item type} | State: {state} | Assigned: {assigned to}
> Fetched by: <model identifier>

## Description

{Work item description field — preserve original formatting, strip HTML tags to clean markdown}

## Acceptance Criteria

{Acceptance criteria field if present, otherwise omit this section}

## Discussion Notes

{Relevant comments from the discussion thread, newest first. Omit automated/system comments (state changes, link additions). If no substantive comments, omit this section.}

## Visual Context

{Summarize what task-related screenshots/diagrams show. Include image file path(s) under `assets/ado/` and concise observations. If no images exist, omit this section.}

## Parent Context

{If a parent exists, include parent ID/title and the relevant constraints, acceptance criteria, and scope notes that affect this task. If no parent exists, omit.}
```

9. **Update the index.** Invoke `/wf:index {id} reqs "<work item title>"` to record the requirements artifact. Pass the title verbatim from the ADO work item (truncate to 80 chars if longer; escape any `|` as `\|` so the index table doesn't break).

10. **Report** to the user: "Fetched ADO #{id} (+ parent context when present) -> `{task-root}/{wi-prefix}-{id}/00_reqs.md` (images saved under `assets/ado/` when available). Review before proceeding." If step 4 backfilled the child description, add: "Backfilled empty ADO description from parent #<parent-id>."

11. **Continue** with the Branch Gate using the newly created `00_reqs.md`.

---
## Phase 0.5: Branch Gate

Before exploring the codebase or writing the spec, verify the current git branch is correct for this task. Runs after Phase 0 so that `00_reqs.md` exists for `wf:branch` to derive a branch name.

1. Run `git rev-parse --abbrev-ref HEAD` to get the current branch name.
2. **If the branch name contains `/{id}-`** (e.g. `feature/6396-...`, `fix/6396-...`, `chore/6396-...`, etc.) — already on the task branch, continue directly to Phase 0.7.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing `ado-id: {id}`. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
   - On success (`BRANCH — created`/`switched`/`already-active`), continue directly to Phase 0.7.
   - On failure (`BRANCH — Error`), stop and surface the subagent's reason.

**Note:** if `{task-root}` is tracked (not gitignored), the untracked `00_reqs.md` may trip the wf:branch dirty-worktree check. Commit or stash before rerunning.

---

## Phase 0.7: Resolve Task Type

Determine the task's branch-type bucket (one of `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) before exploration so it can be persisted into the spec metadata.

1. **If `--type` was provided**, use that value. Set `Confidence: high` and `Alternative: —`. Skip the classifier call.
2. **Otherwise**, invoke `/wf:classify {id}` against the just-written `00_reqs.md`. Parse the `CLASSIFY — Complete` block for `Type`, `Confidence`, and `Alternative`. If the classifier returns `CLASSIFY — Error`, stop and surface the reason — do not guess a type inline.
3. **Branch on confidence:**
   - `high` — use the type silently. `Alternative` is `—`.
   - `medium` — use the primary type. Record the `Alternative` so it can appear in the spec metadata.
   - `low` — raise an `AskUserQuestion` offering the primary and alternative types as options ("Pick the task type — classifier was uncertain"). Use the user's pick as the resolved type; the unpicked option becomes the Alternative.
4. Hold the resolved `(type, alternative)` pair in memory for Phase 3, where it is written into the spec metadata.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Use sourcebot MCP tools (`mcp__sourcebot__search_code`, `mcp__sourcebot__read_file`, `mcp__sourcebot__list_tree`) for code search — preferred over raw `Grep`/`Glob` because it's indexed and cross-repo
- Read any file in the project (`Read`, `Glob`, `Grep`) — fall back when sourcebot is unavailable or for file-pattern search
- Use MSSQL extension tools (`mssql_run_query`, `mssql_list_tables`, `mssql_list_views`, `mssql_list_schemas`) for database schema and data exploration
- Use ADO MCP tools for fetching work item details — **read-only, with exactly one write exception**: Phase 0 step 4 may patch `System.Description` on the child work item, only when that description is empty/minimal, the title starts with `Dev`, and a parent with a real description exists. No other ADO field or work item may ever be written.
- Read-only git commands (`git rev-parse`, `git branch`, `git log`)
- Write/create files ONLY inside the task folder (`{task-root}/{wi-prefix}-{id}/`)
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 0.5 branch gate. The wf:branch subagent performs non-destructive git operations only (`checkout -b` / `checkout` of an existing branch, `fetch`, `push --set-upstream`); it never resets, force-pushes, deletes branches, or commits. Invoke the **Task** tool with `subagent_type: wf:classify` for Phase 0.7 type resolution (read-only).

**Forbidden:**

- Modify any source file outside the task folder
- Run builds, tests, linters, or installs
- Run any destructive git operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above)
- Create implementation plans or step-by-step checklists (that is `/wf:plan`'s job)

---

## Phase 1: Explore the Codebase

Before writing the spec, explore the project to understand the current state. This grounds the spec in reality rather than assumptions.

1. **Read `00_reqs.md`** from the task folder to understand the requirements. Identify relevant areas of the codebase. Review the `Visual Context` notes and any images in `assets/` (mockups, diagrams, screenshots) before searching code.

2. **Search the codebase** — try sourcebot MCP first (`mcp__sourcebot__search_code`); fall back to Glob/Grep if sourcebot is unavailable or for file-pattern searches. Find:
   - Files that implement related functionality
   - Existing patterns, conventions, and architectural decisions
   - Tech stack details (frameworks, languages, key dependencies)

3. **Explore database schema** using MSSQL extension tools (`mssql_list_tables`, `mssql_list_views`, `mssql_run_query`) if the task involves data models, persistence, or queries.
4. **Read key files** to understand the current implementation state.
5. **Note constraints** — discover any technical constraints, existing APIs, data models, or conventions that the spec must account for.
6. **Identify boundaries** — find what changes would be safe (low-risk, well-tested areas) vs. risky (shared modules, public APIs, database schemas).
7. **Save exploration notes** to `research/exploration.md` if the exploration is extensive (L complexity). For S/M, inline findings into the spec's Context section.

The goal is context, not a plan. Collect facts that inform WHAT to build, not HOW.

---

## Phase 2: Resolve Open Questions

After exploration, identify any ambiguities or decisions that affect the spec. Resolve them NOW so the spec ships clean.

1. **Identify questions** — ambiguities in the description, technical decisions with multiple valid approaches, unclear scope boundaries, constraints that need confirmation.
2. **Prompt the user** — use `AskUserQuestion` with suggested options derived from exploration. Offer concrete choices, not open-ended questions.
3. **Record resolutions** — bake answers into the spec as confident statements. No residual Q&A in the output.

If no questions exist, skip to Phase 3.

---

## Phase 3: Write the Spec

Write `01_spec.md` in the task folder using the template below.

**Overwrite if `01_spec.md` exists** (git history preserves prior versions).

**Writing principles:**

- **Machine-verifiable success criteria.** Not "the feature works" but "POST /api/auth/login returns 200 with JWT when given correct credentials."
- **Explicit scope boundaries.** State what is IN and what is OUT.
- **Constraint-based framing.** State constraints alongside the objective, not separately.
- **Reference code, don't describe it.** Point to existing files as examples of patterns to follow.
- **Spec sizing by complexity:**
  - `S` — 100-200 words
  - `M` — 300-500 words
  - `L` — 500-1000 words
- **Focus on What & Why.** Leave the How to `/wf:plan`.
- **Clean of Q&A.** Resolved questions become confident statements.

---

## Spec Template

```markdown
# {wi-prefix}-{id} — <title>

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

Sections are optional — omit any that would be empty. Only include an "Open Questions" section if some questions are truly unresolvable (e.g., depends on an external team decision).

**After writing the spec**, invoke `/wf:index {id} spec "<type> · <complexity> · <n> success criteria"` to record it in the per-task index. Substitute the resolved values (e.g. `feat · M · 4 success criteria`).
---

## Edge Cases

- **ADO work item not found:** Stop: "ADO work item #{id} not found or inaccessible."
- **ADO work item has empty description:** Use parent work item when available. If the child title starts with `Dev`, also backfill the ADO description per Phase 0 step 4. If parent also empty, create minimal `00_reqs.md` with title only, skip the backfill, and warn user.
- **Backfill write fails (permissions, tool missing):** Not fatal. Continue the spec; record the failure reason in `00_reqs.md`.
- **Image attachments exist but cannot be read:** Continue spec generation; add a warning note in `00_reqs.md` listing failed attachment IDs/filenames.
- **MCP tools unavailable:** Stop: "ADO MCP tools are not available. Enable them to use /wf:spec."
- **Complexity is L:** Add a note in the spec: "Consider breaking this into sub-specs before planning."
- **Folder already has `01_spec.md`:** Overwrite it.
- **Folder already has `02_plan.md`:** Warn: "A plan already exists. The spec will be updated but the existing plan may be outdated."
- **No project files found:** Ask the user for the project root path to explore.
- **All questions resolved:** Omit the "Open Questions" section entirely.

---

## Final Output

```
SPEC — Complete

Task: {wi-prefix}-{id} — <title>
Type: <feat | fix | chore | refactor | migration | docs | hotfix>  (source: <flag | classify-high | classify-medium | classify-low-user-confirmed>)
Complexity: <S | M | L>  (source: <flag | triage | default>)
Folder: {task-root}/{wi-prefix}-{id}/
Spec: {task-root}/{wi-prefix}-{id}/01_spec.md
Next: /wf:plan {id}
```

**The final output block must always be the very last thing output to chat.**
