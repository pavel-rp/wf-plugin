---
name: spec
description: Writes a grounded task specification (01_spec.md) for a task by fetching requirements from the active tracker capability (when registered), exploring the current codebase, and resolving ambiguities interactively. Use when the user starts a new task and needs to document scope before planning.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:spec — Grounded task specification from a task id

Write a spec (`01_spec.md`) for a task. Accepts a task id, fetches the work item through the active tracker capability (when one is registered) via direct provider resolution, creates a task folder under `{task-root}/`, and writes a grounded spec. Explores the codebase, resolves ambiguities interactively, and produces a clean spec.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). All references to `{task-root}` below come from `coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. A registered tracker capability resolves its own project-scoped config (e.g. a tracker project name) from its own fragment binding; core never reads it directly.

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
- **Tracker active:** `<id>` must be supplied or inferable — a real tracker record needs a real id. If `<id>` is provided, use it verbatim (opaque to core — whatever shape the active tracker capability produces). If omitted, infer a numeric token via `current-branch-query`, reached by resolving the `delivery` surface with the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query (see "Direct provider resolution" below for the resolver-call pattern) and obtaining its body via the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`) and following it: extract the first 3+-digit run from the resolved branch name. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `<PREFIX>-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` verbatim; this recovers the opaque shape a prior invocation already established, core still never reconstructs it itself. Zero matches — the bare token isn't a deterministic `<id>` — stop: "No task id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:spec <id>`." More than one match — ambiguous — stop: "No task id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:spec <id>`." If no numeric token can be extracted from the branch at all, stop: "No task id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:spec <id>`."
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

Every tracker operation below (`get`, `update`) is reached by calling the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface: "tracker" })` — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }` for the `tracker` surface. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); core performs **no** registry / manifest / plugin-root read of its own. Obtain each op's body through the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in this skill's own context to dispatch `get`/`update` — never a raw `Read` of the path (the metadata queries return only paths/metadata; the body comes from `resolve_content({ workspaceRoot, ... })`). If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery).

Reproduce degradation from the record's `state`:

- **`ok`** — dispatch the operation against the resolved fragment.
- **`unconfigured`** (no capability owns `tracker`) — the silent local-only fallback: the `get` read proceeds silent local-only, no tracker operation attempted; every step below proceeds from local artifacts alone.
- **`unrecoverable`** (a registered capability's `tracker` manifest could not be read — recorded root dangled and the self-heal recovered nothing, named in the record's `diagnostics` string) — the `get` read stays silent local-only; the one tracker **write** (`update`, step 3 below) applies the residual diagnosis: a warn-once in the hedged candidate-naming form, reading the `diagnostics` string to name the candidate pack(s), per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal" (Residual diagnosis). A genuinely `unconfigured` registry stays silent instead.

### Fetch Procedure

1. **Fetch the work item and resolve parent context.** Invoke `get(<id>)` via direct provider resolution above. Its declared output — "the work item's current fields, state, and relations" — covers both the child fetch and the immediate parent's relation when present, even if the child description is complete. Parent items often contain scope boundaries, acceptance criteria, and cross-task constraints the child omits.
   - **Unconfigured tracker** (the scope-equality filter matches zero rows), or a **registered-but-unrecoverable** tracker whose manifest couldn't be read — silent local-only fallback, no prompt, no error: continue to step 2 with no fetched data. The `get` read never emits the residual diagnosis; only the co-located `update` write does (step 3).
   - **Configured and the fetch succeeds** — proceed with the fetched fields exactly as before.
   - **Mid-run failure** (a tracker was registered but the `get` call errors) — warn once, naming the operation and the error, then continue local-only from whatever context is available. The run is never blocked by a tracker failure.

2. **Check for empty requirements.** If the child description is empty/minimal, use parent description as the primary requirement source. If both are empty/minimal, create a minimal requirements file and warn the user.

3. **Backfill an empty "Dev" child description (the library's single tracker write).** If ALL of the following hold:
   - the child work item's title starts with `Dev` (e.g. `Dev`, `Dev:`, `Dev — backend part`),
   - the child description is empty or minimal (blank, whitespace-only, or merely restating the title),
   - a parent work item was resolved in step 1 and has a non-empty description,

   then invoke `update(<id>, description: <composed-text>)` via direct provider resolution:
   - Compose `X` — the most concise statement of what's to be done, **5 words max**, derived from the parent title/description (e.g. `CSV export for audit log`).
   - Pick the sentence by the parent's work item type: a bug-type parent → `Fix X as described in the parent bug (<link>)`; any other type → `Implement X as described in the parent (<link>)`. Core keys only on the generic bug/non-bug distinction — it never names a tracker-specific type taxonomy; a tracker capability that wants finer per-type wording contributes it through its own fragment.
   - `<link>` is an HTML anchor to the parent work item with link text `<parent-id>: <parent title>` (e.g. `<a href="...">6390: Audit log CSV export</a>`), using whatever link the `get` output already supplies for the parent. If `get`'s output supplies no such link, omit the anchor and use the plain `<parent-id>: <parent title>` text instead. Description fields may carry the tracker's own markup — normalize to clean markdown when composing.
   - Core names the field generically as `description` — never a tracker-specific field string; the active tracker capability's own fragment binds `description` to its concrete field. Never touch any other field, any other work item, or a non-empty description — this backfill is the only tracker write any skill in the library performs.
   - Use the same sentence as the `## Description` body of `00_reqs.md` (step 6); the Parent Context section still carries the substance.
   - **Registered-but-unrecoverable tracker** (a registered capability's manifest is unrecoverable — recorded root dangled and the self-heal recovered nothing — so zero readable `tracker` providers resolve): skip the backfill and **warn once** in the hedged candidate-naming form defined in `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal" (Residual diagnosis) — name the unreadable-manifest pack(s) from the `## Capabilities` row as candidates ("if one is your `tracker` provider, fix its stale root / re-run its init"), never asserting ownership — then continue local-only. This is the only message the tracker residual emits in this run: the co-located step 1 `get` stays silent, so the **net residual is exactly one warn-once, driven by this write**. A genuinely unconfigured registry (no readable-manifest pack is unrecoverable) stays silent instead.
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

1. **Resolve delivery-surface ownership first** — call `resolve_provider({ workspaceRoot, surface: "delivery" })` on the `wf-resolver` MCP service (resolving the same `delivery` surface `wf:branch` acts on), before any branch read; the returned record carries `{ owner, fragmentPath, state, … }`. **`state: unconfigured` (bare-core mode)** — the branch gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no error and no hard stop. Report "Branch gate skipped — no delivery provider registered (bare-core mode)." and continue directly to Phase 0.7. **`state: ok`** — resolve the current branch via `current-branch-query` (obtain its body via `resolve_content({ workspaceRoot, ... })` and follow it), then apply steps 2–3.
2. **If the branch name contains `/{numeric-id}-`** (e.g. `feature/6396-...`, `fix/6396-...`, `chore/6396-...`, etc.) — already on the task branch, continue directly to Phase 0.7.
3. **Otherwise** — call `resolve_routing` immediately before dispatch with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "branch"`, `unitIds: ["spec:branch"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "elevated", toolWork: "bounded", validation: "mechanical", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit its compact metadata. If `status: stop` or `diagnostic` is non-null, stop and surface the routing diagnostic. Otherwise obey the returned `executionShape` per `invocation-runtime.ops.md` §"Resolver call root"; this evidence selects `isolated`, so invoke one **Task** with `subagent_type: wf:branch`, passing the task id `{id}` **and the forwarded `delivery` resolution record** resolved in step 1 (the optional spawn extension — `invocation-runtime.ops.md` §"Run-scoped provider forwarding"). Pass a non-null model selector and preserve inherited effort when null. (Do NOT call `/wf:branch` — that would load its SKILL.md into this skill's context. The subagent is self-sufficient.)
   - On success (`BRANCH — created`/`switched`/`already-active`), inspect `Carry:`. `none`/`applied` continues directly to Phase 0.7. A preserved-entry/manual-follow-up carry stops here and surfaces that follow-up; the branch itself remains successful.
   - On failure (`BRANCH — Error`), stop and surface the subagent's reason.

**Note:** when `{task-root}` is tracked, the branch operation automatically captures and reapplies the newly written `00_reqs.md`. Only a preserved-entry/manual-follow-up `Carry:` requires manual resolution before rerunning.

---

## Phase 0.7: Resolve Task Type

Determine the task's branch-type bucket (one of `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) before exploration so it can be persisted into the spec metadata.

1. **If `--type` was provided**, use that value. Set `Confidence: high` and `Alternative: —`. Skip the classifier call.
2. **Otherwise**, call `resolve_routing` immediately before dispatch with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "classify"`, `unitIds: ["spec:classify"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "low", toolWork: "bounded", validation: "judgment", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit its compact metadata. If `status: stop` or `diagnostic` is non-null, stop and surface the routing diagnostic. Otherwise obey the returned `executionShape` per `invocation-runtime.ops.md` §"Resolver call root"; this evidence selects `isolated`, so invoke one **Task** with `subagent_type: wf:classify`, passing `{id}` (resolved against the just-written `00_reqs.md`). Pass a non-null model selector and preserve inherited effort when null. Parse the `CLASSIFY — Complete` block for `Type`, `Confidence`, and `Alternative`. If the classifier returns `CLASSIFY — Error`, stop and surface the reason — do not guess a type inline.
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
- Invoke `get`/`update` via the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "tracker" })` query — **read-only, with exactly one write exception**: Phase 0 step 3 may invoke `update` to patch the description field on the child work item, only when that description is empty/minimal, the title starts with `Dev`, and a parent with a real description exists. **This skill's own body** never writes any other field or work item; operations a *composed slot body* performs are governed by the slot bullet below, not by this one.
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query)
- Write/create files ONLY inside the task folder (`{task-root}/{task-id}/`)
- Resolve the declared `spec.questions` (Phase 2) and `spec.publish` (Phase 4) slots via `resolve_content({ workspaceRoot, ... })` (`class: slot`, `skill: spec`) — **one call per marker** — and, only on a `composed` outcome, follow the served body as prose in this skill's own context. A followed body may perform **exactly** the operations it names — including writes to the task folder's artifacts and any contract-bound provider operation it invokes, which may be a write. That authorization is scoped to the served body: nothing at a marker is ever improvised, and an unfilled, unresolved, or refused slot authorizes no operation at all.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 0.5 branch gate. The wf:branch subagent performs only non-destructive delivery actions — creating or switching to the task branch, fetching the base, and publishing the branch upstream; it never resets, force-pushes, deletes branches, or commits. Invoke the **Task** tool with `subagent_type: wf:classify` for Phase 0.7 type resolution (read-only).

**Forbidden:**

- Modify any source file outside the task folder
- Run builds, tests, linters, or installs
- Run any destructive version-control operation directly (the delegated wf:branch subagent is constrained to non-destructive ops above)
- Create implementation plans or step-by-step checklists (that is `/wf:plan`'s job)
- Improvise a publish, a comment, or any other operation at a slot marker whose slot is `unfilled`, `unresolved`, or `refused` — the inline-default region is executed **exactly** (the no-improvisation rule), and each marker is resolved at most once per run

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

2. **Publish the open questions** — this is the declared `spec.questions` composition point, reached once the questions are identified and **before** the interactive prompt in step 3, so anyone following the task elsewhere sees what is being asked before it is answered. Resolve it lazily with **one** call: `resolve_content({ workspaceRoot, ... })` with `class: slot`, `skill: spec`, `point: questions`. Act on the typed outcome — never improvise a publish at this marker:
   - **`{status: unfilled}`** (no slot contribution registered and no personal `_local/slots/spec.questions.md` override) → execute **exactly** the inline-default region below, then continue to step 3.
   - **`{status: composed, content, policy, …}`** → a fill is registered; **follow the served `content` as prose** in this skill's own context (a `replace` fill supersedes the inline default wholesale), then continue to step 3.
   - **`{status: unresolved}`** (registry-invalid / ref-not-found) or **`{status: refused}`** → do not improvise: run the inline-default region below (continue to step 3) and state the resolver's reason. Follow the content surface's degradation discipline — never a wrong-path body, never a raw-read fall-through.

<!-- wf:slot spec.questions -->
Nothing is published anywhere. The open questions stay local to this run — they are carried straight into the interactive prompt in step 3, and no operation of any kind is emitted at this point.
<!-- wf:slot-end spec.questions -->

3. **Prompt the user** — use `AskUserQuestion` with suggested options derived from exploration. Offer concrete choices, not open-ended questions.
4. **Record resolutions** — bake answers into the spec as confident statements. No residual Q&A in the output.

If no questions exist, skip to Phase 3 — with no questions identified there is nothing to publish, so step 2 is skipped along with the prompt.

---

## Phase 3: Write the Spec

Write `01_spec.md` in the task folder using the template below.

**Overwrite if `01_spec.md` exists** (version-control history preserves prior versions).

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

The verbatim `01_spec.md` template — the metadata block, `## Objective`, `## Success Criteria`, `## Context`, `## Scope`, `## Constraints`, `## User Journeys`, and `## Boundaries` — lives at `spec-template.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: spec`, `ref: spec-template.md`), never a raw `Read` of the plugin-cache path. It is read only on this write path (Phase 3), so it stays out of the boot body. Follow it, then emit it with placeholders substituted.

Sections are optional — omit any that would be empty. Only include an "Open Questions" section if some questions are truly unresolvable (e.g., depends on an external team decision).

**After writing the spec**, invoke `/wf:index {id} spec "<type> · <complexity> · <n> success criteria"` to record it in the per-task index. Substitute the resolved values (e.g. `feat · M · 4 success criteria`).

---

## Phase 4: Publish the Spec Artifact

This is the declared `spec.publish` composition point — reached **after** `01_spec.md` is written and the index row recorded, so the artifact being published is the finished one. Resolve it lazily with **one** call: `resolve_content({ workspaceRoot, ... })` with `class: slot`, `skill: spec`, `point: publish`. Act on the typed outcome — never improvise a publish at this marker:

- **`{status: unfilled}`** (no slot contribution registered and no personal `_local/slots/spec.publish.md` override) → execute **exactly** the inline-default region below, then emit the Final Output block.
- **`{status: composed, content, policy, …}`** → a fill is registered; **follow the served `content` as prose** in this skill's own context (a `replace` fill supersedes the inline default wholesale), then emit the Final Output block.
- **`{status: unresolved}`** (registry-invalid / ref-not-found) or **`{status: refused}`** → do not improvise: run the inline-default region below and state the resolver's reason. Follow the content surface's degradation discipline — never a wrong-path body, never a raw-read fall-through. A failure here never invalidates the spec: `01_spec.md` is already written and is the source of truth.

<!-- wf:slot spec.publish -->
Nothing is published anywhere. `01_spec.md` and the per-task index row are the run's only outputs — no external record is opened, updated, or annotated, and no operation of any kind is emitted at this point. Proceed to the Final Output block.
<!-- wf:slot-end spec.publish -->

---

## Edge Cases

- **Tracker fetch outcome (configured / unconfigured / failed):** **Unconfigured** (no active tracker-surface owner) — silent local-only fallback, no prompt, no error; proceed with a blank local requirements file. **Configured and the fetch succeeds** — proceed with the fetched fields exactly as before. **Configured but the `get` call fails mid-run** — warn once, naming the operation and the error, then continue building `00_reqs.md`/`01_spec.md` from whatever local/partial context is available. The run is never blocked by a tracker failure.
- **Fetched work item has empty description:** Use parent work item when available. If the child title starts with `Dev`, also backfill via `update` per Phase 0 step 3. If parent also empty, create minimal `00_reqs.md` with title only, skip the backfill, and warn user.
- **No tracker registered:** Not fatal, not a failure — the silent local-only fallback. Continue the spec; do not record a failure note (there is nothing to have attempted).
- **Tracker registered but the backfill write fails (permissions, etc.):** Not fatal. Continue the spec; record the failure reason in `00_reqs.md`.
- **Registered-but-unrecoverable tracker (recorded root dangled, self-heal recovered nothing):** When the install-manifest self-heal recovers the root, resolution heals in-memory and the `get`/`update` just work — no re-init, no error. When it stays unrecoverable, the Phase 0 `get` read is silent local-only (no message) and the `update` backfill warns once in the hedged candidate-naming form — naming the unreadable-manifest pack(s) from the `## Capabilities` row as candidates ("if one is your `tracker` provider, fix its stale root / re-run its init"), never asserting ownership — for a net of exactly one warn-once driven by the write. Distinct from a genuinely unconfigured registry, which stays silent.
- **Complexity is L:** Add a note in the spec: "Consider breaking this into sub-specs before planning."
- **Folder already has `01_spec.md`:** Overwrite it.
- **Folder already has `02_plan.md`:** Warn: "A plan already exists. The spec will be updated but the existing plan may be outdated."
- **No project files found:** Ask the user for the project root path to explore.
- **All questions resolved:** Omit the "Open Questions" section entirely.
- **A slot is unfilled (`spec.questions` / `spec.publish`):** the default state when nothing is registered against the point. Execute the marker's inline-default region exactly — both defaults publish nothing — and continue. Not an error, not a warning: the run is byte-for-byte what it would be with no composition point at all.
- **A slot resolves `unresolved` or `refused`:** run the same inline-default region and state the resolver's reason once. Never fall back to reading a fragment path directly and never improvise the publish. For `spec.publish` this is never fatal — `01_spec.md` is already written and is the source of truth; the Final Output block is still emitted.

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
