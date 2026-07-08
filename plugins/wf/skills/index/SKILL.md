---
name: index
description: Updates one row in the per-task `index.md` manifest with a status and summary, creating the file (with all-N/A seed rows) on first call. Designed for other wf:* skills to call after they write any artifact or produce any small per-task result (branch name, classification, etc.) so the index stays in sync with reality. Lean — single responsibility.
allowed-tools: [Read, Write, Edit, Glob, Bash, Task]
---

# /wf:index — Update the per-task index manifest

Lean updater for `{task-root}/{task-id}/index.md`. Caller passes a slot key and a summary string; this skill (or its subagent) finds the row, writes the auto-derived status cell and the summary, and saves. Creates the file from a seed template on first call. Idempotent — calling with the same args twice produces no diff (except the timestamp footer).

**Read-write but minimal — touches only `index.md` in the resolved task folder.**

---

## Prerequisites

Read `_local/config.md` for `{task-root}`. If missing, stop: "Run `/wf:init` first."

---

## Command Syntax

```
/wf:index [<id>] <slot> "<summary>"
```

Two or three positional arguments. The `<id>` is optional — when omitted, the skill infers it from the current branch, resolved via `current-branch-query` through **direct provider resolution** to the `delivery` surface (see "Direct provider resolution" below). Argument-parsers MUST handle both shapes:

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

The only delivery operation this file invokes — `current-branch-query` (the branch-inferred id case in Phase 1 below) — is reached by the canonical resolve-once procedure — `invocation-runtime.ops.md` §"Direct provider resolution" (one `## Capabilities` read from `_local/config.md`, the default-absent `registryPath` value, plus one manifest+fragment read for the `delivery` surface; a plugin-anchored `Path` resolves through the self-heal home, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"). With zero readable `delivery` rows, `current-branch-query` falls back silently to the plain-directory case (no branch to infer from) — no error, no capability term surfaces.

---

## Safety Rules

**Allowed:**

- Read `_local/config.md` and the resolved task folder.
- Read-only resolution via `current-branch-query` (direct provider resolution to the `delivery` surface).
- Invoke the `wf:index` subagent via the **Task** tool. **The subagent is the only writer of `index.md`** — this skill never edits the file directly.

**Forbidden:**

- Touch any file outside the resolved task folder.
- Modify any artifact other than `index.md` (this skill only catalogues; it doesn't write spec/plan/etc.).
- Run builds, tests, installs, or any destructive version-control operation.
- Implement the row-edit logic inline. If subagent invocation is unavailable, stop and report — see Phase 2.

---

## Phase 1: Resolve

1. Resolve `<id>`: if provided, use it verbatim — whatever shape the active tracker capability produced (opaque to core), or the local `T<NNN>` scheme when none is registered. If omitted, infer a numeric token via `current-branch-query`, reached through **direct provider resolution** to the `delivery` surface (see "Direct provider resolution" above): extract the first 3+-digit run from the resolved branch name, then **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token (this matches both a tracker-prefixed shape like `PROJ-6396` and the local `T<NNN>` scheme's own `T6396` uniformly). Exactly one match — reuse that folder's full name as `<id>` (this recovers the opaque shape a prior invocation already established; core still never reconstructs it itself). With zero matching delivery-provider rows, this falls back silently to the plain-directory case (no branch to infer from). Zero matches — stop: "No id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass the id explicitly: `/wf:index <id> <slot> \"<summary>\"`." More than one match — ambiguous — stop: "No id provided and the branch-inferred token `<token>` matches more than one task folder. Pass the id explicitly: `/wf:index <id> <slot> \"<summary>\"`." If no numeric token can be extracted from the branch at all, stop: "No id provided and none could be inferred from the current branch. Pass the id explicitly: `/wf:index <id> <slot> \"<summary>\"`."
2. Compute task folder: `{task-root}/{task-id}/` — `{task-id}` is the `<id>` resolved in Step 1. If it doesn't exist, stop: "Task folder not found. Run `/wf:spec {task-id}` first to bootstrap it."
3. Validate slot key — alphanumeric, hyphens allowed, no whitespace or special chars. If malformed, stop and report.

---

## Phase 2: Delegate to the subagent

**Caller stops here.** Invoke the **Task** tool with `subagent_type: wf:index`, passing:

- `task-folder` — the absolute path resolved in Phase 1
- `slot` — the validated slot key
- `summary` — the caller-supplied summary string
- `calling-skill` — the slash command name of the upstream skill that invoked `/wf:index` (or `/wf:index` if invoked directly)

Use the subagent's `INDEX — Updated` block as this skill's output verbatim. Do **not** read or execute the subagent's procedure in `plugins/wf/agents/index.md` — that's the subagent's job.

---

## Slot Catalogue

The authoritative slot catalogue — keys, types, filenames, and the status-cell derivation rules — lives in `plugins/wf/agents/index.md` (its single post-split home; no second table is kept here to drift). Callers pass one of its slot keys, or any other alphanumeric+hyphen key for a custom slot — the subagent appends unknown keys to the table as custom rows on first sight. Status cells are auto-derived by the subagent — callers don't compute them.

---

## Procedure

The subagent's complete procedure — inputs contract, status derivation, row find/edit/insert, footer update, post-write verification, and the seed template — lives in `plugins/wf/agents/index.md`. The subagent boots on that file alone and never reads this one; no procedure text is kept here, where a second authoritative copy would drift.

---

## Edge Cases

- **`_local/config.md` missing:** stop — "Run `/wf:init` first."
- **No id provided and branch inference fails** (no numeric token extractable, zero matching task folders, or more than one match): stop — pass the id explicitly: `/wf:index <id> <slot> "<summary>"`.
- **Task folder not found:** stop — "Run `/wf:spec {task-id}` first to bootstrap it."
- **Malformed slot key** (whitespace or special chars beyond alphanumeric + hyphen): stop and report before delegating.
- Write-path edge cases (malformed existing `index.md`, summary escaping, empty summary, repeat custom-slot calls) are the subagent's — see `plugins/wf/agents/index.md`.

---

## Final Output

This skill's output is the subagent's final block, forwarded verbatim — `INDEX — Updated` on success, `INDEX — Error` on failure. The authoritative block shapes are defined in `plugins/wf/agents/index.md`; no second copy is kept here.

**The final output block must always be the very last thing output to chat.**
