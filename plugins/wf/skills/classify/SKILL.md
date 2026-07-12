---
name: classify
description: Classifies a task into one of seven branch-type buckets (feat, fix, chore, refactor, migration, docs, hotfix) with a calibrated confidence (high/medium/low). Reads requirements from a file or raw text, delegates the rubric to its subagent for context-isolated reasoning, and emits a structured verdict for downstream skills (wf:spec, wf:plan, wf:lite, wf:branch). Use when another skill needs to determine task type without hardcoding a feat/fix-only assumption.
allowed-tools: [Read, Glob, Grep, Bash, Task]
---

# /wf:classify — Branch-type classifier with confidence

Classify a task into one of seven branch-type buckets and return a calibrated confidence. Reads `01_spec.md` (or `00_reqs.md` if no spec yet) from a task folder, delegates the rubric to its subagent, and emits a structured verdict that downstream skills consume to set commit type, branch prefix, and spec/plan metadata.

**Read-only. Does not write artifacts. Does not branch, plan, or implement.**

---

## When to use

Reach for `/wf:classify` from inside another skill when that skill needs the task's type and `--type` was not passed by the user. Replaces the duplicated keyword scan currently embedded in `wf:spec`, `wf:plan`, and `wf:lite`. Also usable standalone if you want to sanity-check what type the workflow will pick.

**Do NOT use `/wf:classify` when:** the user passed `--type` explicitly (already authoritative — confidence is `high` by definition), or the task folder doesn't yet have requirements (run `/wf:spec` Phase 0 first to fetch them).

---

## Command Syntax

```
/wf:classify [<id> | --file <path> | --text "<inline>"]
```

### Arguments

| Argument          | Required | Description                                                                                       |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `<id>`            | NO       | Task id — whatever shape the active tracker capability produces (opaque to core), or a local `T<NNN>` id when no tracker is registered. Resolves to `{task-root}/{task-id}/01_spec.md` if it exists, else `00_reqs.md`. Falls back to inferring from the current branch. |
| `--file <path>`   | NO       | Explicit path to a markdown/text file to classify. Bypasses task-folder resolution.               |
| `--text "<inline>"` | NO     | Inline requirement text. Use when classifying ad-hoc input without a file.                        |

Exactly one of the three input modes is used. Resolution: `--text` > `--file` > `<id>` > inferred id. If none can be resolved, stop: "No input provided. Pass a task id, `--file <path>`, or `--text "..."`."

### Folder Resolution (when using `<id>`)

Only attempted when neither `--file` nor `--text` is passed.

- Read `_local/config.md` to resolve `{task-root}`. If missing, stop: "Run `/wf:init` first."
- If `<id>` is provided, treat it as opaque — whatever shape the active tracker capability produces, or the local `T<NNN>` scheme — and use it verbatim as `{task-id}`.
- If `<id>` is omitted, infer a numeric token via `current-branch-query` (direct provider resolution to the `delivery` surface — see "Direct provider resolution" below): extract the first 3+-digit run from the resolved branch name, call it `{numeric-id}`. Resolve that token against `{task-root}`: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token, mirroring `spec/SKILL.md`'s Validation-section resolution logic. Exactly one match — reuse that folder's full name as `{task-id}` verbatim. Zero matches — stop: "The branch-inferred token `<token>` doesn't match an existing task folder. Pass a task id, `--file <path>`, or `--text "..."`." More than one match — stop: "The branch-inferred token `<token>` matches more than one task folder. Pass a task id explicitly, or use `--file <path>` / `--text "..."`."
- **Input source preference:** `01_spec.md` (richer, post-spec) > `00_reqs.md` (raw requirements). First available wins.
- If neither file exists, stop: "No `01_spec.md` or `00_reqs.md` found in `{task-root}/{task-id}/`. Run `/wf:spec {id}` first."

### Direct provider resolution (how `current-branch-query` is reached)

Branch inference above reaches `current-branch-query` by the canonical resolve-once procedure — `invocation-runtime.ops.md` §"Direct provider resolution" (one `## Capabilities` read from `_local/config.md`, the default-absent `registryPath` value, plus one manifest+fragment read for the `delivery` surface; a plugin-anchored `Path` resolves through the self-heal home, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"). With zero readable `delivery` rows, `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces. (classify has no tracker-surface call site — it never fetches.)

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`).
- Read-only resolution via `current-branch-query` (direct provider resolution to the `delivery` surface) for id inference.
- Invoke the **Task** tool to delegate to the `wf:classify` subagent. **The subagent is the only place the rubric runs** — this skill never classifies inline.

**Forbidden:**

- Write any file. Classification is read-only — consumers persist the result, not this skill.
- Modify source files.
- Run builds, tests, or installs.
- Fetch from a tracker directly. Use already-resolved `00_reqs.md`/`01_spec.md` only — fetching is `/wf:spec` Phase 0's job.
- Implement the rubric inline. If subagent invocation is unavailable, stop and report — see Phase 2.

---

## Phase 1: Resolve Input

1. If `--text "<inline>"` is provided, use the inline string as the classifiable content. Skip to Phase 2.
2. Else, if `--file <path>` is provided, validate the file exists. If missing, stop: "Input file not found at `<path>`."
3. Else, resolve the task id (passed or inferred from branch) → task folder → first-available of `01_spec.md`, `00_reqs.md`. The subagent will read it itself; just hold the path.
4. The classifiable content is the **title + description + acceptance criteria** sections only. Strip metadata blocks (frontmatter, `**Type:**`, `**Created:**`, etc.) so prior classification labels don't bias the rubric. (This stripping is the subagent's job when it reads the file — caller just hands over the path or text.)

---

## Phase 2: Delegate to the subagent

**Caller stops here.** Invoke the **Task** tool with `subagent_type: wf:classify`, passing the resolved input:

- For file mode: pass the file path. The subagent will read it.
- For text mode: pass the raw text inline.

Use the subagent's `CLASSIFY — Complete` block as this skill's output verbatim. Do **not** read or execute the Procedure section below — that's the subagent's job.

---

## Type vocabulary (for callers)

The verdict's `Type` field is exactly one of: `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`. Definitions live in the Procedure section below; callers don't need them — they just persist the value into spec/plan metadata and use it to derive the branch prefix.

---

## Procedure (subagent execution — caller, skip this section)

This section is the subagent's body. The subagent (`agents/classify.md`) is a thin redirect that reads this section and executes it. The host LLM running `/wf:classify` directly should NOT read this section — it stops at Phase 2.

### Inputs

The subagent is invoked with one of:

- A path to a markdown/text file — read it before classifying.
- Raw requirement text inline — classify directly.

If a path is passed but the file is missing, emit the `CLASSIFY — Error` variant of the Final Output block (see below) with `Reason: input file not found at <path>`. Do **not** emit a `CLASSIFY — Complete` block with a placeholder type — the `Type` field is contractually one of the seven buckets and downstream consumers parse it strictly.

Strip any metadata block from the input (YAML frontmatter, `**Type:**`, `**Complexity:**`, `**Created:**`, etc.) so a prior classification label doesn't bias the rubric. Classify against title + description + acceptance criteria only.

### Type buckets

Pick exactly one:

| Type | Meaning |
| --- | --- |
| `feat` | New functionality the system didn't have. Default when nothing else fits. |
| `fix` | Corrects broken behavior in shipped code. |
| `chore` | Maintenance: tooling, dependency bumps, config, non-code housekeeping. |
| `refactor` | Internal code restructure with no behavior change. |
| `migration` | Schema/data/platform migration: DB schema changes, data backfills, framework version bumps that require migration steps. |
| `docs` | Documentation only — README, comments, design docs. No runtime code change. |
| `hotfix` | Urgent production fix — explicitly tagged as production-critical or "urgent prod". Otherwise treat as `fix`. |

### Decision rules — apply in order, first match wins

1. **Explicit type in title.** If the title or description explicitly names a type tag (`[Refactor] …`, `Migration:`, `Hotfix:`, `Chore:`, `Docs:`), use it.
2. **Urgent production fix** → `hotfix`. Signals: "urgent prod", "production outage", "emergency fix", "P0", "live site broken".
3. **Schema/data/version migration** → `migration`. Signals: "migration", "migrate", "schema change", "alter table", "backfill", "upgrade framework to N", "upgrade ORM", "rename column".
4. **Fix broken behavior** → `fix`. Signals: "fix", "bug", "broken", "error", "crash", "fails to", "wrong output", "regression".
5. **Internal restructure, no behavior change** → `refactor`. Signals: "refactor", "restructure", "extract", "rename method", "consolidate", "no behavior change", "cleanup".
6. **Docs only** → `docs`. Signals: "documentation", "README", "comments", "design doc", "ADR", "wiki update".
7. **Maintenance/tooling/dependency** → `chore`. Signals: "chore", "tooling", "dependency", "bump", "upgrade packages", "CI config", ".gitignore".
8. **Otherwise** → `feat`.

**Ordering matters.** Rule 3 (migration) beats rule 4 (fix) — "migrate the broken table schema" is fundamentally a migration. Rule 2 (hotfix) beats rule 4 (fix) — urgency upgrades the bucket.

### Confidence anchors

Don't self-report a vibe. Use these criteria:

- **high** — exactly one bucket clearly fits; no plausible second.
- **medium** — primary bucket fits but a second is defensible (e.g., "refactor that also fixes a small bug", "migration triggered by a production hotfix"). Pick the dominant bucket; record the alternative.
- **low** — no clear keyword anchor in any bucket; OR contradictory signals (e.g., "hotfix the docs migration"); OR input is < 1 sentence of meaningful description.

When confidence is `medium` or `low`, the host may surface the alternative to the user. When `high`, the host proceeds silently.

### Output

Return ONLY the Final Output block (see below). No prose before or after — the rubric reasoning stays in your isolated context.

---

## Consumer contract

Skills that call `wf:classify` (`wf:spec`, `wf:plan`, `wf:lite`, indirectly `wf:branch`) should:

1. Invoke the **Task** tool with `subagent_type: wf:classify`, passing the resolved input (task id once requirements are fetched, or a file path).
2. Parse `Type` and `Confidence` from the structured block.
3. Branch on confidence:
   - **high** → use silently.
   - **medium** → use the primary type, but include `Alternative: <type>` in the spec/plan metadata so the user can see the second-best fit.
   - **low** → raise an `AskUserQuestion` with the primary and alternative as options before writing any artifact.
4. Persist the chosen type in spec/plan metadata so re-runs (e.g., `/wf:plan` after `/wf:spec`) reuse the result instead of re-classifying.

User-supplied `--type` always wins over `/wf:classify` and is treated as `Confidence: high`.

---

## Edge Cases

- **Empty/placeholder description:** subagent returns `Type: feat, Confidence: low, Reason: no substantive description; defaulted to feat.`
- **Multiple type tags in title** (`[Fix][Refactor]`): subagent picks the first; sets `Confidence: medium`; places the other in `Alternative`.
- **Title contradicts description** (title says "fix typo", description describes a new endpoint): subagent trusts the description; flags the contradiction in `Reason`.
- **Non-English description:** subagent classifies on whatever signals are translatable (entity names, type tags). If untranslatable, `Confidence: low`.
- **No input at all** (no ID, no file, no text, no branch ID): caller stops in Phase 1 with the syntax help.

---

## Final Output

Success:

```
CLASSIFY — Complete

Type: <feat | fix | chore | refactor | migration | docs | hotfix>
Confidence: <high | medium | low>
Alternative: <type | —>
Reason: <one sentence — what evidence in the input drove the decision>
```

Error (input unreadable, no substantive content, or other unrecoverable condition):

```
CLASSIFY — Error

Reason: <one sentence — what went wrong>
```

**The final output block must always be the very last thing emitted to chat.** Downstream skills grep for `CLASSIFY — Complete` to locate the verdict and `CLASSIFY — Error` to detect failure; consumers must check for both forms.
