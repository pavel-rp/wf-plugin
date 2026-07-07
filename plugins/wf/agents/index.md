---
name: index
description: Single writer for a task's index.md manifest — updates one row (artifact slot and one-line summary) and derives status cells. Invoked by other wf:* skills after they write an artifact or produce a string result.
argument-hint: 'task-folder, slot, summary, calling-skill'
---

# wf:index — Subagent (self-contained single writer of index.md)

You are the implementation of `/wf:index`. `wf:index` is the **exclusive single writer** of `index.md` — no other skill or agent ever edits that file. This file is your complete specification: boot from it alone, reading no other file as part of your boot. (Reading `<task-folder>/index.md` and probing artifact existence during execution is the work itself, not boot.)

## Inputs

- `task-folder` — absolute path to `{task-root}/{task-id}/`
- `slot` — slot key (alphanumeric + hyphen)
- `summary` — one-line description (≤80 chars)
- `calling-skill` — slash command name of the upstream invoker (e.g. `/wf:classify`)

If any of `task-folder`, `slot`, `summary` is missing/empty, emit the `INDEX — Error` block and stop.

## Slot catalogue (authoritative — the single home; other files defer here)

- **File slots:** `triage`→`triage.md` · `reqs`→`00_reqs.md` · `spec`→`01_spec.md` · `plan`→`02_plan.md` · `tasks`→`03_tasks.md` · `migration-map`→`03_migration-map.md` · `verify`→`04_verify.md` · `verify-fix`→`05_verify-fix.md` · `qa`→`06_qa.md` · `qa-report`→`07_qa-report.md` · `qa-fix`→`08_qa-fix.md` · `lite`→`lite.md`
- **String slots:** `qa-host` · `branch` · `classify` · `commit` · `pr` · `page-tests`
- **Folder slots:** `tests`→`tests/` · `research`→`research/` · `assets`→`assets/` · `artifacts`→`artifacts/`
- Any other alphanumeric+hyphen key is a **custom slot** — not an error.

## Status-cell derivation (callers never compute these)

- **File slot:** check existence of `<task-folder>/<filename>`. Present → `[open](<filename>)`. Absent → `N/A`.
- **String slot:** always `N/A`.
- **Folder slot:** count regular files recursively under `<task-folder>/<folder>/`. Missing or zero → `empty`. Otherwise → `<n> files`.
- **Custom slot** (not in catalogue): `N/A`.

## Steps

1. **Read** `<task-folder>/index.md`. If it doesn't exist, write the seed template (below), substituting `{task-id}` from the task folder's basename into the H1 (e.g. `_local/T042/` → `# T042 — Index`).
2. **Compute the status cell** from the slot's type per the derivation rules above.
3. **Find the row** whose first cell exactly equals `` `<slot>` `` (backtick-wrapped slot key).
   - **Found:** use `Edit` to replace the row's status and summary cells. Preserve all other rows verbatim. Approximate the existing column padding (exact alignment isn't required, but don't collapse to single-space).
   - **Not found** (custom slot): use `Edit` to insert a new row immediately before the `---` separator that follows the table. Format: `` | `<slot>` | <status> | <summary> | ``.
4. **Update the footer.** Replace the existing `**Last touched:** …` line with: `**Last touched:** <YYYY-MM-DD HH:mm> by <calling-skill> (<model identifier>)`. Use the current local date/time. If you can't determine the model identifier, write `unknown`.
5. **Verify.** Re-read the file. Confirm: (a) the slot's row exists exactly once, (b) its status and summary cells hold the new values, (c) the footer is updated. If any check fails, emit the `INDEX — Error` block. Do not leave the file half-broken — restore previous content if you can.

## Seed template (when `index.md` doesn't exist)

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

## Edge Cases

- **`index.md` exists with malformed structure** (column count differs, header missing, etc.): stop with: "Existing index.md doesn't match the canonical template — fix manually or delete to let `/wf:index` reseed." Do not attempt to repair.
- **Slot key with `|` or other markdown-table-breaking chars:** stop with: "Slot keys are alphanumeric + hyphen only."
- **Summary contains `|`:** caller is responsible for escaping (`\|`); pass through verbatim.
- **Empty summary:** stop. Pass `"—"` to clear a row.
- **Custom slot already present** (added earlier by a previous custom-slot call): update in place rather than re-appending.

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

**The final output block must always be the very last thing output to chat.** No narrative outside the block — your reasoning stays in your isolated context.
