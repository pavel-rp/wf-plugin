---
name: triage
description: Scores an ADO task against a 5-dimension rubric (scope, clarity, design, risk, dependencies) and recommends which workflow to run next — lite, full, split, blocked, or clarify. Read-only advisor that runs before any work begins; fetches requirements if absent, performs a bounded repo scan, writes triage.md, and hands off with an exact next command. Use when a new task arrives and the right flow is uncertain, or as a sanity check before committing to /wf:lite vs /wf:spec.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:triage — Flow router for ADO tasks

Classify an ADO task and recommend the downstream workflow. Fetches `00_reqs.md` if it doesn't exist, performs a bounded repo scan (no full exploration), scores 5 dimensions on a 1–5 scale, maps the scores to a verdict, and emits a structured report plus the exact command to run next.

**Advisor only. Does not branch, plan, or implement. User retains override.**

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. All references to `{task-root}`, `{ado-project}`, and `{wi-prefix}` below come from that file. Never hardcode these values.

---

## When to use

Reach for `/wf:triage` at the very start of a ticket, before deciding between `/wf:lite` and `/wf:spec`. It's the cheapest skill in the library and it exists to prevent the more expensive mistake of picking the wrong flow.

**Do NOT use `/wf:triage` when:** the task is already in flight (`02_plan.md` or `lite.md` exists), or when you've already committed to a flow and just want to execute. It's an entry-point advisor, not a mid-flight sanity check.

---

## Command Syntax

```
/wf:triage <ado-id>
```

### Arguments

| Argument     | Required | Description                                                   |
| ------------ | -------- | ------------------------------------------------------------- |
| `<ado-id>`   | NO       | ADO work item ID — numeric (e.g. `6396`) or prefixed (e.g. `ADO-6396`). Falls back to inferring from the current git branch. On a fresh `main`, an explicit ID is required. |

### Folder Resolution

- Extract the numeric ID: `6396` from `6396`, `ADO-6396`, or `ADO_6396`.
- **Task folder:** `{task-root}/{wi-prefix}-{id}/`.
- **Task ID:** `{wi-prefix}-{id}`.

### Validation

- If `<ado-id>` is provided, use it. If omitted, infer from `git branch --show-current`: first 3+-digit run. If no digit run exists, stop: "No ADO ID provided and none could be inferred from the current branch. Pass the ID explicitly: `/wf:triage <ado-id>`."
- If `00_reqs.md` already exists in the folder, skip the ADO fetch and use it.
- If `02_plan.md` or `lite.md` already exists, warn: "Task is already in flight with a `<plan|lite>` artifact. Triage is an entry-point advisor — continue with `/wf:implement {id}` or `/wf:lite {id}` instead." Proceed only if the user explicitly confirms.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Use sourcebot MCP tools (`mcp__sourcebot__search_code`, `mcp__sourcebot__read_file`, `mcp__sourcebot__list_tree`) for code search — preferred over `Grep`/`Glob`.
- Read any file in the project.
- Use MSSQL extension tools read-only for schema lookups (only if the task description mentions data, tables, or queries).
- Use ADO MCP tools read-only for work item fetch.
- Read-only git commands.
- Write `00_reqs.md` (if fetched) and `triage.md` inside the task folder only.

**Forbidden:**

- Modify any source file.
- Create a branch, a plan, or a spec. Those are other skills' jobs.
- Run builds, tests, or installs.
- Auto-invoke `/wf:lite`, `/wf:spec`, or any downstream skill. Always hand off by printing the command.
- Exceed the exploration budget defined in Phase 2.

---

## Phase 1: Requirements

Skip to Phase 2 if `00_reqs.md` already exists.

1. **Fetch the work item** via `mcp_ado_wit_get_work_item` with `id`, `project: {ado-project}`, `expand: "all"`. On failure, stop: "ADO work item #{id} not found or inaccessible."
2. **Do NOT fetch parent or comments.** Triage is deliberately shallow — the whole point is to detect when the child description is insufficient and recommend `clarify`.
3. **Create the task folder** if it doesn't exist.
4. **Write `00_reqs.md`** using the same template as `/wf:lite` Phase 1 (title, description, AC).

---

## Phase 2: Bounded Repo Scan

The goal is to calibrate the **Scope** and **Risk** dimensions, nothing more. Do not plan. Do not map out the implementation.

**Hard budget — respect it strictly:**

- At most **3** searches (sourcebot or Grep).
- At most **5** file reads.
- No database introspection unless the task description explicitly names a table, schema, or stored procedure.

**What to look for:**

1. Keyword-search for the 1–3 most distinctive nouns from the work item title (entity names, feature names, module names).
2. From the search hits, infer approximately how many files and which modules are likely affected. Count them — this feeds the Scope score.
3. Note whether any hit sits under a shared-infrastructure path (auth, persistence, migrations, security, billing). This feeds the Risk score.
4. If the search returns zero hits, that's a signal in itself — the task may describe code that doesn't exist yet (new feature) or uses domain terms not in the codebase (translation needed). Note it.

Stop scanning the moment you have enough to score. Burning the full budget is not a goal.

---

## Phase 3: Score the Rubric

Score each of the 5 dimensions on a 1–5 scale using the anchors below. Pick the anchor that best matches the evidence — do not hedge with averages. If evidence is thin, pick the lower-confidence score and note it in the Reasoning section.

### Scope — how much of the codebase changes

| Score | Anchor |
| --- | --- |
| 1 | Single file, single function or region within it |
| 2 | 1–2 files, one module, tightly scoped |
| 3 | 3–5 files, coordinated within one module or feature slice |
| 4 | Multiple modules or slices; coordinated cross-cutting change |
| 5 | Many slices, cross-repo, or sweeping refactor |

### Clarity — how ambiguous is the ask

| Score | Anchor |
| --- | --- |
| 1 | Precisely specified; AC is machine-verifiable from the description alone |
| 2 | Intent obvious; implementation choices are minor |
| 3 | Intent clear but reasonable alternative interpretations exist |
| 4 | Requires inference from parent context or domain knowledge; multiple plausible readings |
| 5 | Description is vague, placeholder, empty, or purely investigative ("find out why X happens") |

### Design — architectural decisions required

| Score | Anchor |
| --- | --- |
| 1 | Pure implementation; the pattern already exists in the codebase |
| 2 | Minor code-shape choices (helper placement, overload, naming) |
| 3 | One non-trivial pattern decision (new service vs. extend existing, sync vs. async) |
| 4 | Multiple interacting architectural choices |
| 5 | New abstraction, new pattern, or existing architecture must change to accommodate |

### Risk — blast radius of a mistake

| Score | Anchor |
| --- | --- |
| 1 | Dev-only, sandboxed, gitignored, or behind a disabled flag |
| 2 | Feature-local; existing tests cover the change surface |
| 3 | User-facing feature with some shared utilities touched |
| 4 | Shared infrastructure — DB schema, auth, core pipelines, public API contract |
| 5 | Critical path — billing, compliance controls, security boundaries, irreversible migrations |

### Dependencies — external blockers

| Score | Anchor |
| --- | --- |
| 1 | Standalone; no other work depends on or gates this |
| 2 | Reads from another team's surface but does not block on their changes |
| 3 | Requires coordinating with another in-flight ADO task |
| 4 | Blocked on another team's decision, an external vendor, or a legal/compliance sign-off |
| 5 | Blocked on unfinished upstream work that must land first |

---

## Phase 4: Compute Verdict and Size

Apply the verdict rules **in order, first match wins**. Do not combine them or average them.

1. **`blocked`** — if Dependencies ≥ 4. The task cannot start yet regardless of how clean the rest of the scoring is.
2. **`clarify`** — if Clarity ≥ 4. Ambiguity dominates everything else; commit to `/wf:spec` to force questions before any implementation.
3. **`split`** — if Scope = 5 OR Design = 5. The task is too big for any single flow; break it into sub-tasks first.
4. **`lite`** — if **all** of: Total ≤ 8, Clarity ≤ 2, Scope ≤ 2, Risk ≤ 2. The fast path is only safe when every dimension agrees it's a small, clear, low-risk change.
5. **`full`** — otherwise. The default for mid-sized tasks.

**Size mapping.** Derive the S/M/L label that downstream skills (`/wf:spec`, `/wf:plan`) read from `triage.md` when `--complexity` is not passed explicitly:

- Verdict `clarify` or `blocked` → size `—` (task is not starting; downstream skills should fall through to their own default).
- Verdict `split` → size `L` (ensures the L-warning fires in the downstream skill if the user proceeds anyway).
- Otherwise, map from total score: **≤ 8 → S**, **9–15 → M**, **≥ 16 → L**.

Size is orthogonal to verdict for `lite`/`full`: a `full`-verdict task can legitimately be S-sized, which drives the spec length budget even though the full flow still runs.

**Confidence flag.** If the scoring was thin (budget exhausted without enough evidence) or borderline (total within ±1 of a size boundary or verdict threshold), append `confidence: low` to the output and suggest the user re-read the triage before acting.

---

## Phase 5: Write triage.md and Report

Write `triage.md` in the task folder using the template. Overwrite prior versions — re-running `/wf:triage` should produce fresh scoring.

**After writing `triage.md`**, invoke `/wf:index {id} triage "<verdict> · <size> · score <total>/25"` to record it in the per-task index. Substitute the resolved verdict, size label, and total score (e.g. `full · M · score 12/25`).

### triage.md Template

```markdown
# {wi-prefix}-{id} — Triage

**Created:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>
**Verdict:** <lite | full | split | blocked | clarify>
**Size:** <S | M | L | —>
**Confidence:** <high | low>

---

## Scores

| Dimension     | Score | Anchor match                                    |
| ------------- | ----- | ----------------------------------------------- |
| Scope         | N     | <one-line reason from the rubric anchor>        |
| Clarity       | N     | <one-line reason>                               |
| Design        | N     | <one-line reason>                               |
| Risk          | N     | <one-line reason>                               |
| Dependencies  | N     | <one-line reason>                               |
| **Total**     | NN/25 |                                                 |

---

## Verdict reasoning

<1–2 sentences: which rule fired and why. Reference the specific dimension scores that triggered it.>

---

## Recommended next step

```
<exact command, e.g. `/wf:lite {id}` or `/wf:spec {id}`>
```

<1 sentence: what this command will do and why it fits.>

---

## Notes

<Optional. Include only if:>
<- Any dimension is borderline (score adjacent to a verdict boundary)>
<- Evidence was thin (did not find expected modules in the repo scan)>
<- Task has unusual signals worth flagging (e.g. mentions migrations, touches compliance code)>
<- Verdict is `clarify` or `split` — list the specific ambiguities or sub-task candidates>
```

### Final Output

```
TRIAGE — <verdict>

Task: {wi-prefix}-{id} — <title>
Scores: Scope=N Clarity=N Design=N Risk=N Deps=N (total NN/25)
Size: <S | M | L | —>
Confidence: <high | low>
Artifact: {task-root}/{wi-prefix}-{id}/triage.md

Next:
  <exact command>

<one-sentence rationale>
```

**The final output block must always be the very last thing output to chat.**

---

## Examples

Short, concrete calibrations. Use these to sanity-check scoring before committing.

**"Fix typo in the 'Forgot password?' link label"**
Scope 1, Clarity 1, Design 1, Risk 1, Deps 1 → total 5 → `lite`
Rule: all dimensions low, total ≤ 8.

**"Add pagination to the audit-log view"**
Scope 2, Clarity 2, Design 2, Risk 2, Deps 1 → total 9 → `full`
Rule: total > 8; one dimension above the lite threshold (Design 2 is on the edge; total tips it to full).

**"Refactor the entire Review module from the legacy stack to the target framework"**
Scope 5 → `split`
Rule: Scope = 5 triggers split before anything else is considered.

**"Remove the legacy Tax field from the audit submission — but Legal must sign off on what data is retained in archives"**
Deps 4 → `blocked`
Rule: Dependencies ≥ 4 dominates; do not start work.

**"Investigate why some users see a blank page on login"**
Clarity 5 → `clarify`
Rule: no implementation target yet — this is reconnaissance. Run `/wf:spec` to scope the investigation before coding.

**"Cache the review-form options by customer ID"**
Scope 3, Clarity 2, Design 3, Risk 3, Deps 1 → total 12 → `full`
Rule: mid-sized; design decision non-trivial (cache key strategy, invalidation).

---

## Edge Cases

- **ADO work item not found:** Stop: "ADO work item #{id} not found or inaccessible."
- **Empty/minimal description AND no parent worth noting:** Score Clarity 5 → verdict `clarify`. Do not fall back to fetching parent here — that's `/wf:spec`'s job.
- **Repo scan returns no hits for title keywords:** Not an error. Note in triage.md ("no existing code matches the task's key terms") and factor into Design and Clarity scoring.
- **Already-in-flight task** (`02_plan.md` or `lite.md` present): Warn once, ask explicit confirmation before proceeding. If the user confirms, re-triage; the prior artifacts are untouched.
- **Repeated triage on the same task**: Overwrite `triage.md`. The verdict may legitimately change as the task description is refined in ADO.
- **Budget exhausted mid-scan:** Stop scanning, score with what you have, set `confidence: low`.
- **User disagrees with the verdict:** Expected and fine. The skill is advisory — the user can invoke any flow they want. Do not argue; the user has context the scan missed.

---

## Calibration Notes

- **Err low on Scope when evidence is thin.** A surprise on Scope is recoverable (escalate mid-flight from lite → full); over-scoring Scope wastes tokens on the full flow unnecessarily.
- **Err high on Clarity and Risk when evidence is thin.** A surprise here is expensive (a lite implementation of a genuinely ambiguous or high-risk task). The full flow's spec phase catches what triage missed.
- **Don't let the presence of acceptance criteria inflate Clarity past 2.** AC confirms testability but doesn't resolve implementation ambiguity. A ticket can have clear AC and still be a 3 on Clarity.
- **Database mentions alone do not trigger Risk 4.** Only schema-level changes (new tables, altered columns, migrations) warrant Risk 4. Read-only queries against existing tables are Risk 2–3.
