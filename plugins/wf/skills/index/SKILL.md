---
name: index
description: Updates one row in the per-task `index.md` manifest with a status and summary, creating the file (with all-N/A seed rows) on first call. Designed for other wf:* skills to call after they write any artifact or produce any small per-task result (branch name, classification, etc.) so the index stays in sync with reality. Use immediately after writing a per-task artifact or resolving a small per-task value, to record it in that task's index. Lean — single responsibility.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf:index — Update the per-task index manifest

Lean updater for `{task-root}/{task-id}/index.md`. Caller passes a slot key and a summary string; this skill finds the row, writes the auto-derived status cell and the summary, and saves — **inline, in the caller's own context**. Creates the file from a seed template on first call. Idempotent — calling with the same args twice produces no diff (except the timestamp footer).

**Read-write but minimal — touches only `index.md` in the resolved task folder.**

---

## Single-writer invariant

`index.md` is written **only** by this one `/wf:index` procedure, executed **inline in whichever caller invoked it** (the id-inferring skill, a subagent, or a direct user invocation) — there is no separate writer subagent. Every write is a **read-modify-write** that edits **exactly the one target row** (or appends **one** custom row) and preserves every other row verbatim. The `wf` pipeline phases run **sequentially and gated**, so two index writes never overlap within a run; and because the procedure **re-reads the file immediately before editing**, a later write always observes every earlier write. **No caller ever hand-edits `index.md`** — all updates flow through this procedure.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

Obtain `{task-root}` from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` (`coreConfig.taskRoot`; it also returns `workspaceRoot`, `registryPath`, `idShape`), already resolved from `_local/config.md` — core performs no direct config-file parse. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop: "Run `/wf:init` first." If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback.

---

## Command Syntax

```
/wf:index [<id>] <slot> "<summary>"
```

Two or three positional arguments. The `<id>` is optional — when omitted, the skill infers it from the current branch, resolved via `current-branch-query` through the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query (see "Direct provider resolution" below). Argument-parsers MUST handle both shapes:

- **3 args:** `<id>` `<slot>` `"<summary>"` — explicit id; preferred when called from another skill that already resolved the task.
- **2 args:** `<slot>` `"<summary>"` — id inferred from branch; convenient for direct user invocation while on the task branch.

Disambiguation by argument count (the summary is always the final quoted token): three positional tokens — the first is the id (3-arg form). Two positional tokens — the id is omitted; the first token is the slot, and the id is inferred per Phase 1 below (2-arg form).

Examples:

- `/wf:index 6396 triage "full · M · score 12/25"`
- `/wf:index branch "feature/6396-add-csv-export"`  (id inferred from current branch)
- `/wf:index 6396 spec "feat · S · 4 success criteria"`
- `/wf:index 6396 classify "feat (high)"`

### Arguments

| Argument    | Required | Description                                                                                          |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `<id>`      | NO       | Task id — whatever shape the active tracker capability produced (opaque to core), or the local `T<NNN>` scheme when none is registered. Falls back to inferring from the current branch. |
| `<slot>`    | YES      | Slot key — see Slot Catalogue. Unknown slots become custom rows appended at the end of the table.    |
| `<summary>` | YES      | One-liner ≤80 chars. If it contains `\|`, escape as `\\|` so the markdown table doesn't break.       |

---

## Direct provider resolution (how `current-branch-query` is reached)

The only delivery operation this file invokes — `current-branch-query` (the branch-inferred id case in Phase 1 below) — is reached by resolving the `delivery` surface with the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); this skill performs no registry / manifest / plugin-root read of its own. Obtain the op body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in-context to dispatch `current-branch-query` — never a raw `Read` of the path. On `state: unconfigured` or `unrecoverable` (no readable `delivery` provider), `current-branch-query` falls back silently to the plain-directory case (no branch to infer from) — no error, no capability term surfaces. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry (WF-272 diagnostics/recovery).

---

## Safety Rules

**Allowed:**

- Read the resolved task folder. (`{task-root}` itself comes from the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query — see Prerequisites — never from a direct `_local/config.md` parse.)
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query).
- Perform the read-modify-write of `index.md` **directly** (`Read`, then `Write`/`Edit`) in the caller's own context — this skill is the sole inline writer of that one file.

**Forbidden:**

- Touch any file outside the resolved task folder.
- Modify any artifact other than `index.md` (this skill only catalogues; it doesn't write spec/plan/etc.).
- Run builds, tests, installs, or any destructive version-control operation.

---

## Phase 1: Resolve

1. Resolve `<id>`: if provided, use it verbatim — whatever shape the active tracker capability produced (opaque to core), or the local `T<NNN>` scheme when none is registered. If omitted, infer a numeric token via `current-branch-query`, reached by the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query (see "Direct provider resolution" above): extract the first 3+-digit run from the resolved branch name, then **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `PROJ-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` (this recovers the opaque shape a prior invocation already established; core still never reconstructs it itself). On `state: unconfigured`/`unrecoverable` (no readable delivery provider), this falls back silently to the plain-directory case (no branch to infer from). Zero matches — stop: "No id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:index <id> <slot> \"<summary>\"`." More than one match — ambiguous — stop: "No id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:index <id> <slot> \"<summary>\"`." If no numeric token can be extracted from the branch at all, stop: "No id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:index <id> <slot> \"<summary>\"`."
2. Compute the task folder: `{task-root}/{task-id}/` — `{task-id}` is the `<id>` resolved in Step 1. If that active folder is absent, check `{task-root}/_archive/{task-id}/` (a finalized task's `index.md` travels with its archived folder) and use it when present. If neither exists, stop: "Task folder not found. Run `/wf:spec {task-id}` first to bootstrap it."
3. Validate slot key — alphanumeric, hyphens allowed, no whitespace or special chars. If malformed, stop and report.

---

## Phase 2: Route, then write inline

**Immediately before the write**, call `resolve_routing` with
`workspaceRoot: <absolute pwd -P workspace root>`, `role: "index"`, `unitIds:
["index:single"]`, `shapeEvidence: { workSurface: "caller-context", atomicity:
"atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low",
toolWork: "none", validation: "mechanical", contextIsolation: "none",
independentReview: false, returnContract: "mechanically-judgeable",
requestedParallelism: 1 }`, `supportsModelSelector: false`, and
`supportsEffortSelector: false`. Emit the compact operational record (role; shape +
reason; model/effort inheritance fallback + source; basis; attempt; escalation origin;
masking; actual model when available; diagnostic; retained units; retry disposition),
separately from artifact attribution. If `status: stop` or `diagnostic` is non-null,
emit `INDEX — Error` and do not write. Otherwise obey `executionShape` exactly; this
evidence selects `inline`, so perform the write procedure below **in this same
context** — dispatch no Task. Both selectors are unsupported and remain null; never
invent or pass selector values.

The write below runs in this same caller context and is the sole path that mutates `index.md`.

### Slot Catalogue

Callers pass one of the keys below, or any other alphanumeric+hyphen key for a **custom slot** (appended to the table as a custom row on first sight — not an error). Status cells are auto-derived here — callers don't compute them.

- **File slots:** `triage`→`triage.md` · `reqs`→`00_reqs.md` · `spec`→`01_spec.md` · `plan`→`02_plan.md` · `tasks`→`03_tasks.md` · `migration-map`→`03_migration-map.md` · `verify`→`04_verify.md` · `verify-fix`→`05_verify-fix.md` · `qa`→`06_qa.md` · `qa-report`→`07_qa-report.md` · `qa-fix`→`08_qa-fix.md` · `lite`→`lite.md`
- **String slots:** `qa-host` · `branch` · `classify` · `commit` · `pr` · `page-tests`
- **Folder slots:** `tests`→`tests/` · `research`→`research/` · `assets`→`assets/` · `artifacts`→`artifacts/`

### Status-cell derivation (callers never compute these)

- **File slot:** check existence of `<task-folder>/<filename>`. Present → `[open](<filename>)`. Absent → `N/A`.
- **String slot:** always `N/A`.
- **Folder slot:** count regular files recursively under `<task-folder>/<folder>/`. Missing or zero → `empty`. Otherwise → `<n> files`.
- **Custom slot** (not in catalogue): `N/A`.

### Write procedure

1. **Read** `<task-folder>/index.md`. If it doesn't exist, write the seed template (below), substituting `{task-id}` from the task folder's basename into the H1 (e.g. `_local/T042/` → `# T042 — Index`).
2. **Compute the status cell** from the slot's type per the derivation rules above.
3. **Find the row** whose first cell exactly equals `` `<slot>` `` (backtick-wrapped slot key).
   - **Found:** use `Edit` to replace the row's status and summary cells. Preserve all other rows verbatim. Approximate the existing column padding (exact alignment isn't required, but don't collapse to single-space).
   - **Not found** (custom slot): use `Edit` to insert a new row immediately before the `---` separator that follows the table. Format: `` | `<slot>` | <status> | <summary> | ``.
4. **Update the footer.** Replace the existing `**Last touched:** …` line with: `**Last touched:** <YYYY-MM-DD HH:mm> by <calling-skill> (<model identifier>)`. `<calling-skill>` is the upstream slash command's name (or `/wf:index` when invoked directly). Use the current local date/time. If you can't determine the model identifier, write `unknown`.
5. **Verify.** Re-read the file. Confirm: (a) the slot's row exists exactly once, (b) its status and summary cells hold the new values, (c) the footer is updated. If any check fails, emit the `INDEX — Error` block. Do not leave the file half-broken — restore previous content if you can.

### Seed template (when `index.md` doesn't exist)

```markdown
# {task-id} — Index

Catalog of artifacts and small results for this task. Every `wf:*` skill updates its row after writing. Underlying files are the source of detailed truth; this index is a manifest for orientation.

| Slot            | Status | Summary |
| --------------- | ------ | ------- |
| `triage`        | N/A    | —       |
| `reqs`          | N/A    | —       |
| `spec`          | N/A    | —       |
| `plan`          | N/A    | —       |
| `tasks`         | N/A    | —       |
| `migration-map` | N/A    | —       |
| `verify`        | N/A    | —       |
| `verify-fix`    | N/A    | —       |
| `qa`            | N/A    | —       |
| `qa-report`     | N/A    | —       |
| `qa-host`       | N/A    | —       |
| `qa-fix`        | N/A    | —       |
| `lite`          | N/A    | —       |
| `branch`        | N/A    | —       |
| `classify`      | N/A    | —       |
| `commit`        | N/A    | —       |
| `pr`            | N/A    | —       |
| `tests`         | empty  | —       |
| `page-tests`    | N/A    | —       |
| `research`      | empty  | —       |
| `assets`        | empty  | —       |
| `artifacts`     | empty  | —       |

---

**Last touched:** —
```

---

## Edge Cases

- **`_local/config.md` missing:** stop — "Run `/wf:init` first."
- **No id provided and branch inference fails** (no numeric token extractable, zero matching task folders, or more than one match): stop — pass the id explicitly: `/wf:index <id> <slot> "<summary>"`.
- **Task folder not found** (absent from both the active task root and the archive): stop — "Run `/wf:spec {task-id}` first to bootstrap it."
- **Malformed slot key** (whitespace or special chars beyond alphanumeric + hyphen): stop and report before writing.
- **`index.md` exists with malformed structure** (column count differs, header missing, etc.): stop with: "Existing index.md doesn't match the canonical template — fix manually or delete to let `/wf:index` reseed." Do not attempt to repair.
- **Slot key with `|` or other markdown-table-breaking chars:** stop with: "Slot keys are alphanumeric + hyphen only."
- **Summary contains `|`:** caller is responsible for escaping (`\|`); pass through verbatim.
- **Empty summary:** stop. Pass `"—"` to clear a row.
- **Custom slot already present** (added earlier by a previous custom-slot call): update in place rather than re-appending.

---

## Final Output

Success:

```
INDEX — Updated

Task: {task-id}
Slot: <slot>
Status: <new status>
Summary: <new summary>
File: {task-root}/{task-id}/index.md
```

Failure (procedure unable to complete safely):

```
INDEX — Error

Reason: <one sentence — what went wrong>
File: {task-root}/{task-id}/index.md (unchanged)
```

**The final output block must always be the very last thing output to chat.**
