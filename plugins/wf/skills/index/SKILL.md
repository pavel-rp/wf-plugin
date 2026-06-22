---
name: index
description: Updates one row in the per-task `index.md` manifest with a status and summary, creating the file (with all-N/A seed rows) on first call. Designed for other wf:* skills to call after they write any artifact or produce any small per-task result (branch name, classification, etc.) so the index stays in sync with reality. Lean — single responsibility.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf:index — Update the per-task index manifest

Lean updater for `_local/{wi-prefix}-{id}/index.md`. Caller passes a slot key and a summary string; this skill (or its subagent) finds the row, writes the auto-derived status cell and the summary, and saves. Creates the file from a seed template on first call. Idempotent — calling with the same args twice produces no diff (except the timestamp footer).

**Read-write but minimal — touches only `index.md` in the resolved task folder.**

---

## Prerequisites

Read `_local/config.md` for `{task-root}` and `{wi-prefix}`. If missing, stop: "Run `/wf:init` first."

---

## Command Syntax

```
/wf:index [<ado-id>] <slot> "<summary>"
```

Two or three positional arguments. The `<ado-id>` is optional — when omitted, the skill infers it from the current branch (first 3+-digit run in `git branch --show-current`). Argument-parsers MUST handle both shapes:

- **3 args:** `<ado-id>` `<slot>` `"<summary>"` — explicit ID; preferred when called from another skill that already resolved the task.
- **2 args:** `<slot>` `"<summary>"` — ID inferred from branch; convenient for direct user invocation while on the task branch.

Disambiguation: if the first arg is a 3+-digit numeric or `<wi-prefix>-NNN` form, treat it as the ID. Otherwise treat it as the slot.

Examples:

- `/wf:index 6396 triage "full · M · score 12/25"`
- `/wf:index branch "feature/6396-add-csv-export"`  (ID inferred from current branch)
- `/wf:index 6396 spec "feat · S · 4 success criteria"`
- `/wf:index 6396 classify "feat (high)"`

### Arguments

| Argument    | Required | Description                                                                                          |
| ----------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `<ado-id>`  | NO       | ADO ID. Falls back to inferring from `git branch --show-current` (first 3+-digit run).               |
| `<slot>`    | YES      | Slot key — see Slot Catalogue. Unknown slots become custom rows appended at the end of the table.    |
| `<summary>` | YES      | One-liner ≤80 chars. If it contains `\|`, escape as `\\|` so the markdown table doesn't break.       |

---

## Safety Rules

**Allowed:**

- Read `_local/config.md` and the resolved task folder.
- Read-only git commands for ID inference (`git rev-parse`, `git branch`).
- Invoke the `wf:index` subagent via the **Task** tool. **The subagent is the only writer of `index.md`** — this skill never edits the file directly.

**Forbidden:**

- Touch any file outside the resolved task folder.
- Modify any artifact other than `index.md` (this skill only catalogues; it doesn't write spec/plan/etc.).
- Run builds, tests, installs, or any destructive git operation.
- Implement the row-edit logic inline. If subagent invocation is unavailable, stop and report — see Phase 2.

---

## Phase 1: Resolve

1. Resolve `<ado-id>`: passed value, or `git branch --show-current` first 3+-digit run. If neither, stop: "No ADO ID provided and none could be inferred from the current branch."
2. Compute task folder: `{task-root}/{wi-prefix}-{id}/`. If it doesn't exist, stop: "Task folder not found. Run `/wf:spec {id}` first to bootstrap it."
3. Validate slot key — alphanumeric, hyphens allowed, no whitespace or special chars. If malformed, stop and report.

---

## Phase 2: Delegate to the subagent

**Caller stops here.** Invoke the **Task** tool with `subagent_type: wf:index`, passing:

- `task-folder` — the absolute path resolved in Phase 1
- `slot` — the validated slot key
- `summary` — the caller-supplied summary string
- `calling-skill` — the slash command name of the upstream skill that invoked `/wf:index` (or `/wf:index` if invoked directly)

Use the subagent's `INDEX — Updated` block as this skill's output verbatim. Do **not** read or execute the Procedure section below — that's the subagent's job.

---

## Slot Catalogue

Documentation for callers. Pass one of these slot keys (or any other alphanumeric key for a custom slot — the subagent appends it to the table on first sight).

| Slot key        | Type   | File / Folder           |
| --------------- | ------ | ----------------------- |
| `triage`        | file   | `triage.md`             |
| `reqs`          | file   | `00_reqs.md`            |
| `spec`          | file   | `01_spec.md`            |
| `plan`          | file   | `02_plan.md`            |
| `migration-map` | file   | `03_migration-map.md`   |
| `verify`        | file   | `04_verify.md`          |
| `verify-fix`    | file   | `05_verify-fix.md`      |
| `qa`            | file   | `06_qa.md`              |
| `qa-report`     | file   | `07_qa-report.md`       |
| `qa-host`       | string | —                       |
| `qa-fix`        | file   | `08_qa-fix.md`          |
| `lite`          | file   | `lite.md`               |
| `branch`        | string | —                       |
| `classify`      | string | —                       |
| `commit`        | string | —                       |
| `pr`            | string | —                       |
| `tests`         | folder | `tests/`                |
| `page-tests`    | string | —                       |
| `research`      | folder | `research/`             |
| `assets`        | folder | `assets/`               |
| `artifacts`     | folder | `artifacts/`            |

Status cells are auto-derived by the subagent — callers don't compute them. File slots resolve to `[open](filename)` or `N/A`. String slots are always `N/A`. Folder slots show `<n> files` or `empty`.

---

## Procedure (subagent execution — caller, skip this section)

This section is the subagent's body. The subagent (`agents/index.md`) is a thin redirect that reads this section and executes it. The host LLM running `/wf:index` directly should NOT read this section — it stops at Phase 2.

### Inputs

The subagent is invoked with:

- `task-folder` — absolute path to `{task-root}/{wi-prefix}-{id}/`
- `slot` — slot key (alphanumeric + hyphen)
- `summary` — one-line description (≤80 chars)
- `calling-skill` — slash command name of the upstream invoker (e.g. `/wf:classify`)

If any of `task-folder`, `slot`, `summary` is missing/empty, return the error variant of the Final Output block and stop.

### Steps

1. **Read** `<task-folder>/index.md`. If it doesn't exist, write the seed template (below), substituting `{wi-prefix}-{id}` from the task folder's basename into the H1 (e.g. `_local/ADO-6396/` → `# ADO-6396 — Index`).

2. **Compute the status cell** from the slot's type (look up in the Slot Catalogue):
   - **file slot:** check existence of `<task-folder>/<filename>`. Present → `[open](<filename>)`. Absent → `N/A`.
   - **string slot:** always `N/A`.
   - **folder slot:** count regular files recursively under `<task-folder>/<folder>/`. Missing or zero → `empty`. Otherwise → `<n> files`.
   - **custom slot** (not in catalogue): `N/A`.

3. **Find the row** whose first cell exactly equals `` `<slot>` `` (backtick-wrapped slot key).
   - **Found:** use `Edit` to replace the row's status and summary cells. Preserve all other rows verbatim. Approximate the existing column padding (exact alignment isn't required, but don't collapse to single-space).
   - **Not found** (custom slot): use `Edit` to insert a new row immediately before the `---` separator that follows the table. Format: `` | `<slot>` | <status> | <summary> | ``.

4. **Update the footer.** Replace the existing `**Last touched:** …` line with: `**Last touched:** <YYYY-MM-DD HH:mm> by <calling-skill> (<model identifier>)`. Use the current local date/time. If you can't determine the model identifier, write `unknown`.

5. **Verify.** Re-read the file. Confirm: (a) the slot's row exists exactly once, (b) its status and summary cells hold the new values, (c) the footer is updated. If any check fails, return the error variant of the Final Output block. Do not leave the file half-broken — restore previous content if you can.

### Seed template (when `index.md` doesn't exist)

```markdown
# {wi-prefix}-{id} — Index

Catalog of artifacts and small results for this task. Every `wf:*` skill updates its row after writing. Underlying files are the source of detailed truth; this index is a manifest for orientation.

| Slot            | Status | Summary |
| --------------- | ------ | ------- |
| `triage`        | N/A    | —       |
| `reqs`          | N/A    | —       |
| `spec`          | N/A    | —       |
| `plan`          | N/A    | —       |
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

- **`index.md` exists with malformed structure** (column count differs, header missing, etc.): stop with: "Existing index.md doesn't match the canonical template — fix manually or delete to let `/wf:index` reseed." Do not attempt to repair.
- **Slot key with `|` or other markdown-table-breaking chars:** stop with: "Slot keys are alphanumeric + hyphen only."
- **Summary contains `|`:** caller is responsible for escaping (`\|`); pass through verbatim.
- **Empty summary:** stop. Pass `"—"` to clear a row.
- **Custom slot already present** (added earlier by previous custom-slot call): update in place rather than re-appending.

---

## Final Output

Success:

```
INDEX — Updated

Task: {wi-prefix}-{id}
Slot: <slot>
Status: <new status>
Summary: <new summary>
File: {task-root}/{wi-prefix}-{id}/index.md
```

Failure (subagent procedure unable to complete safely):

```
INDEX — Error

Reason: <one sentence — what went wrong>
File: {task-root}/{wi-prefix}-{id}/index.md (unchanged)
```

**The final output block must always be the very last thing output to chat.**
