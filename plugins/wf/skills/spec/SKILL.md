---
name: spec
description: Writes a grounded task specification (01_spec.md) for a task by fetching requirements from the active tracker capability (when registered), exploring the current codebase, and resolving ambiguities interactively. Use when the user starts a new task and needs to document scope before planning.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:spec — Grounded task specification from a task id

Write a spec (`01_spec.md`) for a task. Accepts a task id, fetches the work item through the active tracker capability (when one is registered) via direct provider resolution, creates a task folder under `{task-root}/`, and writes a grounded spec. Explores the codebase, resolves ambiguities interactively, and produces a clean spec.

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}` below come from that file — never hardcode it. A registered tracker capability resolves its own project-scoped config (e.g. a tracker project name) from its own fragment binding; core never reads it directly.

---

## Command Syntax

```
/wf:spec <id> [--type feat|fix|chore|refactor|migration|docs|hotfix] [--complexity S|M|L]
```

### Arguments

| Argument          | Required | Description                                                        |
| ----------------- | -------- | ------------------------------------------------------------------ |
| `<id>`            | NO       | Task id — whatever shape the active tracker capability produces (opaque to core; e.g. a numeric or prefixed identifier), or a local `T<NNN>` id when no tracker is registered. Falls back to inferring from the current branch. First run for a new task needs an explicit id (branch doesn't exist yet). |
| `--type <type>`   | NO       | One of: `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`. When supplied, wins over `/wf:classify` and is treated as confidence `high`. Defaults to whatever `/wf:classify` returns. |
| `--complexity <c>`| NO       | `S`, `M`, or `L`. Resolution order: `--complexity` flag → `triage.md` Size field → `M` default. |

### Folder Convention

All task folders live under `{task-root}/` in the repo root:

```
{task-root}/{task-id}/
├── 00_reqs.md           # Requirements (fetched from the active tracker, when registered)
├── 01_spec.md           # Specification (this skill)
├── 02_plan.md           # Implementation plan (wf:plan)
├── research/            # Codebase exploration notes, analysis, investigations
├── assets/              # Screenshots, mockups, trace files, images
└── artifacts/           # Diffs, test cases, test results, generated outputs
```

`{task-id}` is opaque: the active tracker capability's own shape when registered (e.g. a tracker-native identifier format), or the local `T<NNN>` scheme otherwise.

**Core files** (`00_reqs.md`, `01_spec.md`, `02_plan.md`) live at the task folder root.
**Non-essential files** go into subfolders:
- `research/` — exploration notes, profiling results, investigation logs, architectural analysis
- `assets/` — images (screenshots, mockups, diagrams), trace files, binary files
- `artifacts/` — code diffs, test cases, test results, migration scripts, generated output

### Validation

- **Resolve the tracker-surface state first** (direct provider resolution's scope-equality filter — "Direct provider resolution" below — applied at validation time, before any fetch): whether an active capability owns the `tracker` surface.
- **Tracker active:** `<id>` must be supplied or inferable — a real tracker record needs a real id. If `<id>` is provided, use it verbatim (opaque to core — whatever shape the active tracker capability produces). If omitted, infer a numeric token via `current-branch-query`, reached through **direct provider resolution** to the `delivery` surface (see "Direct provider resolution" below): extract the first 3+-digit run from the resolved branch name. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `<PREFIX>-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` verbatim; this recovers the opaque shape a prior invocation already established, core still never reconstructs it itself. Zero matches — the bare token isn't a deterministic `<id>` — stop: "No task id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:spec <id>`." More than one match — ambiguous — stop: "No task id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:spec <id>`." If no numeric token can be extracted from the branch at all, stop: "No task id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:spec <id>`."
- **No tracker active (the contract's id-shape rule, local scheme):** if `<id>` is explicitly provided, use it verbatim as `{task-id}`. Otherwise mint a fresh id: scan `{task-root}` for existing `T<NNN>`-prefixed folders, take the highest, +1, zero-pad to 3 digits. **No stop condition** — an empty registry always yields a deterministic local id with no tracker call at all; there is nothing to infer and nothing to fail.
- **Task folder:** `{task-root}/{task-id}/`. Create if it doesn't exist.
- If `00_reqs.md` already exists in the folder, skip the tracker fetch and use the existing file.
- **Branch-name matching token.** Extract the first 3+-digit run from `<id>` (whatever its shape) — call it `{numeric-id}`. This token is used **only** by the Phase 0.5 branch-gate quick-check (matching against an already-existing branch name); it plays no role in the task folder, the task id, or any tracker operation, all of which use the opaque `<id>`/`{task-id}` form verbatim.

**Type resolution:** If `--type` is provided, use it (treat as `Confidence: high`). Otherwise, defer until Phase 0.7, which delegates to `/wf:classify`. Do NOT keyword-scan inline — the rubric lives in the classifier.

**Complexity resolution:** Apply in order, first match wins.
1. If `--complexity` is provided, use it. Source: `flag`.
2. Else, if `{task-root}/{task-id}/triage.md` exists and has a `**Size:** <S|M|L>` field (not `—`), use that value. Source: `triage`.
3. Else, default to `M`. Source: `default`.

Record the resolved value and source — both appear in the Final Output block so the user can see where the sizing came from.

---

## Phase 0: Create Requirements

Always runs first unless `00_reqs.md` already exists in the task folder.

### Direct provider resolution (how `get`/`update` are reached)

Every tracker operation below (`get`, `update`) is reached the same way, per `plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution" — mirroring `plugins/wf/agents/branch.md`'s "Direct provider resolution" section, applied to the `tracker` surface instead of `delivery`:

1. Read the `## Capabilities` registry from `_local/config.md` (the contract's default-absent `registryPath` value).
2. Select the row(s) where `contribution-kind = provider` **and** `scope = tracker`, across the whole registry (a scope filter, independent of which phase value the row itself carries).
3. Read that capability's `manifest.md` at its registry path, then dispatch its fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the referenced file and follow it in-context; no subagent is spawned).
4. **Zero matching rows** — no capability owns the `tracker` surface. This is the silent local-only fallback (see the degradation rules in step 1 below) — no tracker operation is attempted; every step below proceeds from local artifacts alone.

### Fetch Procedure

1. **Fetch the work item and resolve parent context.** Invoke `get(<id>)` via direct provider resolution above. Its declared output — "the work item's current fields, state, and relations" — covers both the child fetch and the immediate parent's relation when present, even if the child description is complete. Parent items often contain scope boundaries, acceptance criteria, and cross-task constraints the child omits.
   - **Unconfigured tracker** (the scope-equality filter matches zero rows) — silent local-only fallback, no prompt, no error: continue to step 2 with no fetched data.
   - **Configured and the fetch succeeds** — proceed with the fetched fields exactly as before.
   - **Mid-run failure** (a tracker was registered but the `get` call errors) — warn once, naming the operation and the error, then continue local-only from whatever context is available. The run is never blocked by a tracker failure.

2. **Check for empty requirements.** If the child description is empty/minimal, use parent description as the primary requirement source. If both are empty/minimal, create a minimal requirements file and warn the user.

3. **Backfill an empty "Dev" child description (the library's single tracker write).** If ALL of the following hold:
   - the child work item's title starts with `Dev` (e.g. `Dev`, `Dev:`, `Dev — backend part`),
   - the child description is empty or minimal (blank, whitespace-only, or merely restating the title),
   - a parent work item was resolved in step 1 and has a non-empty description,

   then invoke `update(<id>, description: <composed-text>)` via direct provider resolution:
   - Compose `X` — the most concise statement of what's to be done, **5 words max**, derived from the parent title/description (e.g. `CSV export for audit log`).
   - Pick the sentence by the parent's work item type: parent is a Bug → `Fix X as described in the parent bug (<link>)`; parent is a PBI / Product Backlog Item / User Story / Feature → `Implement X as described in the parent PBI (<link>)`.
   - `<link>` is an HTML anchor to the parent work item with link text `<parent-id>: <parent title>` (e.g. `<a href="...">6390: Audit log CSV export</a>`), using whatever link the `get` output already supplies for the parent. If `get`'s output supplies no such link, omit the anchor and use the plain `<parent-id>: <parent title>` text instead. Description fields may carry the tracker's own markup — normalize to clean markdown when composing.
   - Core names the field generically as `description` — never a tracker-specific field string; the active tracker capability's own fragment binds `description` to its concrete field. Never touch any other field, any other work item, or a non-empty description — this backfill is the only tracker write any skill in the library performs.
   - Use the same sentence as the `## Description` body of `00_reqs.md` (step 6); the Parent Context section still carries the substance.
   - If `update` is unavailable (no tracker registered) or the write fails, continue the spec flow. When a tracker is registered but the write fails, record in `00_reqs.md`: "Child description backfill failed: <reason>."

4. **Discussion comments and image attachments are a documented contract-completeness gap, not fetched.** The tracker provider surface has no `list_comments`/`get_attachments`-equivalent operation today — this is a known gap, tracked for a future tracker-contract extension, not a local workaround. Skip both; do not attempt an inline tracker-specific call to bridge the gap.

5. **Create the task folder** `{task-root}/{task-id}/` if it doesn't exist.

6. **Write `00_reqs.md`** in the task folder:

```markdown
# {task-id}: {Work Item Title}

> Fetched from the active tracker (task #{id}) on {YYYY-MM-DD}, when a tracker capability is registered; otherwise a blank local requirements file.
> Type: {work item type} | State: {state} | Assigned: {assigned to}
> Fetched by: <model identifier>
> Discussion comments and image attachments are a documented contract-completeness gap — no `list_comments`/`get_attachments`-equivalent tracker operation exists today, so neither is fetched. Pending a future tracker-contract extension.

## Description

{Work item description field — preserve original formatting, strip markup to clean markdown}

## Acceptance Criteria

{Acceptance criteria field if present, otherwise omit this section}

## Visual Context

{Summarize what task-related screenshots/diagrams show, when manually added under `assets/`. Include image file path(s) and concise observations. If no images exist, omit this section.}

## Parent Context

{If a parent exists, include parent ID/title and the relevant constraints, acceptance criteria, and scope notes that affect this task. If no parent exists, omit.}
```

7. **Update the index.** Invoke `/wf:index {id} reqs "<work item title>"` to record the requirements artifact. Pass the title verbatim from the fetched work item (truncate to 80 chars if longer; escape any `|` as `\|` so the index table doesn't break).

8. **Report** to the user, per the outcome of step 1:
   - **Fetch succeeded:** "Fetched task {id} (+ parent context when present) -> `{task-root}/{task-id}/00_reqs.md`. Review before proceeding." If step 3 backfilled the child description, add: "Backfilled empty description from parent #<parent-id>."
   - **No tracker registered:** "No tracker registered — created a local requirements file at `{task-root}/{task-id}/00_reqs.md`. Review before proceeding."
   - **Mid-run tracker failure:** "Tracker fetch failed for task {id} (see the warning above) — continued local-only -> `{task-root}/{task-id}/00_reqs.md`. Review before proceeding."

9. **Continue** with the Branch Gate using the newly created `00_reqs.md`.

---
## Phase 0.5: Branch Gate

Before exploring the codebase or writing the spec, verify the current branch is correct for this task. Runs after Phase 0 so that `00_reqs.md` exists for `wf:branch` to derive a branch name.

1. **Resolve delivery-surface ownership first** — the scope-equality filter (`contribution-kind = provider` **and** `scope = delivery`) of **direct provider resolution** (`plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution", the same mechanism `plugins/wf/agents/branch.md` uses), applied before any branch read. **Zero matching rows (bare-core mode)** — the branch gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no error and no hard stop. Report "Branch gate skipped — no delivery provider registered (bare-core mode)." and continue directly to Phase 0.7. **One matching row** — resolve the current branch via `current-branch-query`, then apply steps 2–3.
2. **If the branch name contains `/{numeric-id}-`** (e.g. `feature/6396-...`, `fix/6396-...`, `chore/6396-...`, etc.) — already on the task branch, continue directly to Phase 0.7.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing the task id `{id}` as its argument. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
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
- Invoke `get`/`update` via **direct provider resolution** to the `tracker` surface — **read-only, with exactly one write exception**: Phase 0 step 3 may invoke `update` to patch the description field on the child work item, only when that description is empty/minimal, the title starts with `Dev`, and a parent with a real description exists. No other field or work item may ever be written.
- Read-only resolution via `current-branch-query` (direct provider resolution to the `delivery` surface)
- Write/create files ONLY inside the task folder (`{task-root}/{task-id}/`)
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 0.5 branch gate. The wf:branch subagent performs only non-destructive delivery actions — creating or switching to the task branch, fetching the base, and publishing the branch upstream; it never resets, force-pushes, deletes branches, or commits. Invoke the **Task** tool with `subagent_type: wf:classify` for Phase 0.7 type resolution (read-only).

**Forbidden:**

- Modify any source file outside the task folder
- Run builds, tests, linters, or installs
- Run any destructive version-control operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above)
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

Sections are optional — omit any that would be empty. Only include an "Open Questions" section if some questions are truly unresolvable (e.g., depends on an external team decision).

**After writing the spec**, invoke `/wf:index {id} spec "<type> · <complexity> · <n> success criteria"` to record it in the per-task index. Substitute the resolved values (e.g. `feat · M · 4 success criteria`).
---

## Edge Cases

- **Tracker fetch outcome (configured / unconfigured / failed):** **Unconfigured** (no active tracker-surface owner) — silent local-only fallback, no prompt, no error; proceed with a blank local requirements file. **Configured and the fetch succeeds** — proceed with the fetched fields exactly as before. **Configured but the `get` call fails mid-run** — warn once, naming the operation and the error, then continue building `00_reqs.md`/`01_spec.md` from whatever local/partial context is available. The run is never blocked by a tracker failure.
- **Fetched work item has empty description:** Use parent work item when available. If the child title starts with `Dev`, also backfill via `update` per Phase 0 step 3. If parent also empty, create minimal `00_reqs.md` with title only, skip the backfill, and warn user.
- **No tracker registered:** Not fatal, not a failure — the silent local-only fallback. Continue the spec; do not record a failure note (there is nothing to have attempted).
- **Tracker registered but the backfill write fails (permissions, etc.):** Not fatal. Continue the spec; record the failure reason in `00_reqs.md`.
- **Complexity is L:** Add a note in the spec: "Consider breaking this into sub-specs before planning."
- **Folder already has `01_spec.md`:** Overwrite it.
- **Folder already has `02_plan.md`:** Warn: "A plan already exists. The spec will be updated but the existing plan may be outdated."
- **No project files found:** Ask the user for the project root path to explore.
- **All questions resolved:** Omit the "Open Questions" section entirely.

---

## Final Output

```
SPEC — Complete

Task: {task-id} — <title>
Type: <feat | fix | chore | refactor | migration | docs | hotfix>  (source: <flag | classify-high | classify-medium | classify-low-user-confirmed>)
Complexity: <S | M | L>  (source: <flag | triage | default>)
Folder: {task-root}/{task-id}/
Spec: {task-root}/{task-id}/01_spec.md
Next: /wf:plan {id}
```

**The final output block must always be the very last thing output to chat.**
