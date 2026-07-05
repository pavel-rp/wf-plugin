---
name: verify-spec
description: Audits the current branch's implementation against the task's spec, resolving every requirement to PASS/FAIL/PARTIAL/N/A/UNVERIFIABLE with file and line evidence, and aggregates any capability findings at the verify phase. Writes 04_verify.md to the task folder and prints a concise summary to chat. Use before opening a PR to confirm strict conformance.
allowed-tools: [Read, Write, Glob, Grep, Bash, Task]
---

# /wf:verify-spec — Audit implementation against the task spec

Thoroughly verify that the current branch's implementation strictly follows the task's
**authoritative requirements** (`00_reqs.md`) in its task folder — NOT the derived
`01_spec.md` / `02_plan.md`, which are interpretations that may have drifted. Use when
the user asks to "verify the implementation against the spec", "check if I followed the
requirements", "audit this branch", or wants a strict conformance report before opening
a PR.

Verification is **strict and evidence-based**: every requirement must be resolved to
PASS / FAIL / PARTIAL / N/A / UNVERIFIABLE with a concrete `file:line` citation or a
clearly stated reason for the verdict. No vibes, no "looks good".

This skill is **capability-agnostic**. Its default is a generic spec-conformance
audit. On top of that default it **fires the `verify` phase**, aggregating any
`finding`s contributed by whatever capabilities the project has registered — without
naming, requiring, or assuming any of them. With no capability registered, the
generic verdict stands alone.

---

## Prerequisites

**Before any other phase**, read `_local/config.md` to load project-specific values. If
the file doesn't exist, stop and instruct the user to run `/wf:init` first. All
references to `{task-root}` below come from that file — never hardcode it. Task folders
live at `{task-root}/{task-id}/`.

---

## Dispatch on arguments

Parse the first token. Recognized forms:

### empty → infer from current branch

1. Resolve the current branch via `current-branch-query`, reached through **direct
   provider resolution** to the `delivery` surface (see "Direct provider resolution"
   below). Extract the first 3+-digit run from the resolved branch name — the
   branch-inferred token. With zero matching delivery-provider rows, this falls back
   silently to the plain-directory case (no branch to infer from). If no numeric token
   can be extracted from the branch at all, stop: "No id provided and none could be
   inferred from the current branch. Pass the id explicitly: `/wf:verify-spec <id>`."
2. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run
   extraction to each existing folder's name and compare it to the branch-inferred
   token (mirroring `plugins/wf/skills/spec/SKILL.md`'s Validation-section resolution
   logic — this matches both a tracker-prefixed shape and the local `T<NNN>` scheme's
   own form uniformly). Exactly one match — reuse that folder's full name as
   `{task-id}` verbatim. Zero matches — stop: "No id provided and the branch-inferred
   token `<token>` doesn't match an existing task folder. Pass the id explicitly:
   `/wf:verify-spec <id>`." More than one match — stop: "No id provided and the
   branch-inferred token `<token>` matches more than one task folder. Pass the id
   explicitly: `/wf:verify-spec <id>`."
3. Confirm the resolved task folder's requirements artifact (`00_reqs.md`) exists. If
   not, stop and ask the user to either pass the id explicitly or point at a
   requirements path.

### `<id>` (opaque — whatever shape the active tracker capability produces, or the local `T<NNN>` scheme)

Use verbatim as `{task-id}` — no normalization. Resolve to the task folder
`{task-root}/{task-id}/`. If the folder or its `00_reqs.md` is missing, stop and tell
the user; do not fall back to the derived `01_spec.md` as the source of truth.

### `<path-to-00_reqs.md>`

Treat as an explicit override. Useful when verifying against a pasted requirements file
that lives outside `{task-root}/`. When this form is used, write the report as a sibling
of that file.

If the requirements artifact is missing, stop and tell the user. They either need to
author it (`/wf:spec`) or pass a path explicitly.

---

## Direct provider resolution (how `current-branch-query` and `last-commit-timestamp-query` are reached)

Every delivery operation this file invokes — `current-branch-query` (the empty-dispatch
id inference above, and the Implementation-scope branch name below) and
`last-commit-timestamp-query` (the spec-staleness edge case) — is reached the same way,
per `plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider
resolution", mirroring `plugins/wf/agents/branch.md`'s own section:

1. Read the `## Capabilities` registry from `_local/config.md` (the contract's
   default-absent `registryPath` value).
2. Select the row(s) where `contribution-kind = provider` **and** `scope = delivery`,
   across the whole registry (a scope filter, independent of which phase value the row
   itself carries).
3. Read that capability's `manifest.md` at its registry path, then dispatch its
   fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the
   referenced file and follow it in-context; no subagent is spawned).
4. **Zero matching rows** — no capability owns the `delivery` surface. Both operations
   fall back silently to their plain-directory-safe cases — no error, no capability
   term surfaces. This audit's core evidence-gathering (the diff, commit coordinates,
   and dirty-tree state — see "Implementation scope" below) has no delivery operation
   of its own today; it is gathered directly against the local working tree regardless
   of registry state — a documented contract-completeness gap, not a workaround.

---

## Inputs to load

Always read, in order:

1. **The requirements artifact** (`00_reqs.md` in the task folder) — the authoritative
   requirements. Read the whole file; do not skim. Pay attention to:
   - Description / Requirements bullets
   - Constraints and STOP-AND-ESCALATE gates
   - Acceptance criteria / "Done When" if present
   - Any Parent Context section (may carry inherited constraints)
2. **Parent task** if referenced. If a parent `00_reqs.md` exists under `{task-root}/`,
   read it for inherited constraints (mapping tables, naming conventions, cross-task
   rules).
3. **Implementation scope** — the diff of the current branch vs `main`, plus
   the commit coordinates the audit runs against. No delivery operation covers
   diff/log inspection today (a documented contract-completeness gap, not a
   workaround — see `plugins/wf/skills/_contracts/capability-registry.contract.md`
   §"The delivery provider surface" for the operation set); gather the following by
   outcome, described generically and never as a literal command:
   - the current branch name — via `current-branch-query` (direct provider resolution
     to the `delivery` surface, see "Direct provider resolution" above)
   - the current HEAD commit coordinate (full SHA)
   - the base commit coordinate where the branch diverged from `main`
   - whether the working tree is clean or dirty, and which files are dirty if so
   - the changed-file summary (file list + insertion/deletion counts) against `main`
   - the full diff content against `main`

   This is the set of code actually under audit. Don't verify against uncommitted noise
   from unrelated files; call those out separately. Record the branch, HEAD SHA, base
   SHA, and dirty-tree flag in the report header — this lets a reader tell which commit
   a stale report corresponds to, and lets a re-run detect when the branch has moved
   since the audit ran (cited `file:line` citations go stale with every commit).

---

## Extract the requirement list

From `00_reqs.md`, produce a flat numbered checklist. Each item should be one atomic,
checkable claim. Rules:

- One bullet in the source may expand into multiple atomic items (e.g., "declare X enum
  with values A=1, B=2" → one item for existence, one per value).
- Include every "must", "should", and "do NOT" statement. Negatives count as
  requirements and need evidence that the forbidden thing is absent.
- Pull constraints out of tables (mapping tables, value tables) as separate items —
  each row is typically its own check.
- STOP-AND-ESCALATE gates are requirements: verify they were honored.
- "Notes to Implementer" / pattern references are context, not requirements — do not
  fabricate checks from them unless the prose says "must follow".

Show the user this extracted list before verifying, so they can catch misreadings early
on long specs.

---

## Verification, one item at a time

**Tool note:** the bullets below reference `Grep` and `Glob` for brevity. When an
indexed code-search MCP (`sourcebot`) is available, prefer it for symbol/content
lookups and indexed file reads — it's faster and covers cross-repo targets. Fall back
to `Grep`/`Glob` only when no indexed tool fits or for file-pattern searches.

For each extracted requirement, gather evidence:

- **File existence / location** → `Glob` or `Read`. Cite the path.
- **Symbol existence / shape** → `Grep` for the symbol, then `Read` the surrounding
  block. Cite `file:line`.
- **Value-level claims** (enum values, default values, property types) → `Read` the
  exact lines. Quote them in the verdict.
- **Absence claims** (no forbidden pattern, no duplicate declarations) → `Grep` across
  the touched files and surrounding area. A clean `Grep` result is valid evidence; say
  "grep returned 0 hits in <scope>".
- **Equivalence / "no drift" claims** → `Read` both sides, diff mentally, cite the
  matching lines.

Verdicts:

- **PASS** — evidence matches the requirement exactly. Cite it.
- **FAIL** — evidence contradicts, or the required artifact is missing. State what the
  spec asked for and what you found.
- **PARTIAL** — requirement has N sub-claims and M < N are satisfied. List which
  sub-claims fail.
- **N/A** — requirement was explicitly scoped out by a later note or parent constraint.
  Cite the source of the exclusion.
- **UNVERIFIABLE** — requirement cannot be checked from static code alone (e.g., "works
  at runtime"). Say so; suggest a runtime check (`npm test`, Chrome MCP,
  `tsc --noEmit`).

---

## Fire the `verify` phase (aggregate capability findings)

After the generic per-requirement audit, fire the **`verify`** phase and aggregate any
**`finding`** contributions the registered capabilities attach to it. Execute the
capability invocation runtime
(`plugins/wf/skills/_contracts/invocation-runtime.contract.md`, which executes the port
`plugins/wf/skills/_contracts/capability-registry.contract.md`), referencing it by
**phase name / contribution-kind name** — never by heading:

1. **Read `_local/config.md`** and locate its `## Capabilities` registry. Iterate the
   rows **in registry order** (general → specific).
2. **Per row, read the manifest** at `<path>/manifest.md` (the path is fixed by the
   contract; do not glob or guess). Parse its fragments table by the fixed columns
   (`phase | contribution-kind | dispatch | scope`).
3. **Collect** only the fragment rows whose `phase` is `verify` and whose
   `contribution-kind` is `finding`. All other rows are ignored for this firing.
4. **Dispatch each collected fragment** on its `dispatch` kind:
   - `inline: <rel-path>` → read `<path>/<rel-path>` (forward-slash, **relative to the
     capability's registry path**) and **follow it in-context**, producing findings in
     the generic finding shape.
   - `subagent: <agent>` → invoke the **Task** tool with `subagent_type: <agent>`,
     passing the work under review **and the generic finding shape** (the "Capability
     findings" report shape below — the `finding` kind fixed by
     `plugins/wf/skills/_contracts/capability-registry.contract.md`); only its final
     block returns. Aggregate the findings it returns in that shape. Core never parses
     a capability-specific output format to extract findings — a capability that has not
     yet emitted the generic finding shape simply yields nothing to aggregate.
5. **Aggregate provenance-tagged.** `finding` aggregates **with provenance**: render
   every contributor's findings, each tagged with its **source capability** (the
   registry row's name). Because attribution is explicit, registry order is **cosmetic**
   for findings.

**No-op (the only permitted branch is "zero `verify` fragments" vs "one or more"):** if
the registry is empty or absent, a manifest is missing, no fragment row matches the
`verify` phase under the `finding` kind, or a `dispatch` is malformed (neither `inline:`
nor `subagent:`), that contributor — or the whole phase — produces **nothing**. The
generic verdict then stands alone: no capability findings section, no
capability/stack/domain term surfaced, no broken subagent reference, no STOP. **Never**
name a concrete capability, count the registry, or carry a per-capability code path. A
capability's findings feed the verdict on the same footing as generic requirements
(a finding that asserts non-conformance is a FAIL, exactly like a failed requirement).

---

## Output

Two outputs, always both:

1. **Full report** — written to the task folder's `04_verify.md`, which always holds the
   latest run. Before overwriting, rotate the existing file's contents into the task
   folder's `04_verify.history.md`:
   - Read the current `04_verify.md` if it exists.
   - Prepend its contents to `04_verify.history.md` (newest entry on top), followed by a
     `---` separator on its own line, followed by any prior history contents.
   - If `04_verify.md` doesn't exist yet (first audit), skip the rotation.
   - If `04_verify.history.md` doesn't exist yet, create it from the rotated content
     alone.

   This gives a trail of every prior audit run at this path, so the user can compare
   findings across iterations and see what a fix broke or regressed. Each archived entry
   is self-identifying via its own header (`**Commit:** <SHA>`, `**Audited at:** <timestamp>`).
   The history file grows unbounded — the user prunes it manually if it gets noisy.

   When the `<path-to-00_reqs.md>` override form is used, write both files (`04_verify.md`
   and `04_verify.history.md`) as siblings of that file instead.
2. **Chat summary** — concise overview printed inline so the user can triage pass/fail
   without opening the file.

Write the file first, then print the chat summary. If the write fails (permissions,
path missing), stop and report the failure — do NOT fall back to printing the full
report inline.

**After writing the report**, invoke `/wf:index {task-id} verify "<a> PASS · <b> FAIL · <c> PARTIAL"`
to record the audit in the per-task index. Substitute each placeholder with its own
count (omit zero-count categories — e.g. `12 PASS · 1 FAIL`). Skip this step when the
`<path-to-00_reqs.md>` override form is used and the report lives outside the task folder.

### Full report shape (`04_verify.md`)

```
# verify-spec: {task-id}

**Source:** `<path to 00_reqs.md>`
**Branch:** `<branch name>`
**Commit:** `<HEAD SHA>`  (base `<merge-base SHA>`)
**Tree:** clean  |  dirty — <N> uncommitted files: `<path>, <path>, …`
**Scope:** <N files, +X/-Y> vs `main`
**Verdict:** <PASS | FAIL | PARTIAL>  (<passed>/<total> requirements)
**Audited by:** <model identifier>
**Audited at:** <ISO 8601 timestamp>

## Requirements

1. [PASS] <requirement text>
   - Evidence: `path/to/file:42` — `<quoted line or snippet>`

2. [FAIL] <requirement text>
   - Expected: <what the spec says>
   - Found: <what the code actually has>
   - Location: `path/to/file:L`

...

## Capability findings

Only present when one or more capabilities contributed `finding`s at the `verify` phase
(omit the whole section on the no-op path). Group findings by their source capability
(provenance tag); registry order is cosmetic.

- **<source capability>** — [FAIL] <finding> at `path/to/file:L` — <evidence>
- **<source capability>** — [PASS] <rule asserted, no divergence found>

## Deviations from derived artifacts (informational)

If you noticed a derived artifact (e.g. an LLM-authored plan) over- or under-specified
vs the spec, list the drift here so the user can tighten the template next time.
Informational only — does NOT affect the verdict.

## Recommended next actions

- Short, ordered list. "Fix X at file:line", "Run `tsc --noEmit`", "Resolve open
  question Y".
```

Keep quoted snippets short — one or two lines max. The reader should be able to click
`file:line` to see the rest.

### Chat summary shape

Print, in this order:

- **Verdict line:** `**Verdict:** <PASS | FAIL | PARTIAL>` — `<n>/<total>` requirements.
- **Report pointer:** one line — `Report: <task-folder>/04_verify.md`.
- **FAILs and PARTIALs:** one bullet each — short requirement name, one-line reason,
  `file:line` citation. Skip the section entirely if none.
- **Capability findings:** one line — either `none` (no capability contributed at
  `verify`) or `<N> findings across <M> capabilities: <comma-separated shortlist, each
  tagged with its source>`.
- **Top next actions:** 1–3 bullets — the most important items from the report's
  "Recommended next actions".
- **`/wf:verify-fix` suggestion (conditional):** one line —
  `Suggested: /wf:verify-fix {task-id} — <N> mechanical fixes look auto-applicable.` Include
  **only** when at least one FAIL or PARTIAL finding has a concrete literal `Expected`
  value at a cited `file:line` (a specific value, enum member, missing property, or
  forbidden pattern with a mechanical remedy). Omit on PASS reports, when every finding
  is UNVERIFIABLE or structural, or when the `Expected` fields are all vague. When in
  doubt, omit.

Target ~15 lines total. If the summary grows past that, trim detail, not items — the
user can open the file for the rest.

End with the final-output block (see below).

---

## What this skill will NOT do

- Will NOT modify any source file outside `_local/`. Verification is read-only against
  the codebase. The only write is the task folder's `04_verify.md` (the audit report).
  If the user wants fixes to source, they ask separately after reading the report.
- Will NOT mark something PASS without concrete evidence. "Looks correct" is not a
  verdict.
- Will NOT use a derived artifact (an LLM-authored plan) as the source of truth. It is
  an artifact, not a contract.
- Will NOT invent requirements not present in the spec. A capability's invariants surface
  as capability `finding`s at the `verify` phase, not as fabricated requirement-list rows.
- Will NOT name, require, or assume any capability. It iterates the registry and
  aggregates whatever is contributed; with none registered, it produces the generic
  verdict alone.

---

## Edge Cases

- **Spec is stale**: compare the spec header's fetch/author date against the timestamp
  returned by `last-commit-timestamp-query` (direct provider
  resolution to the `delivery` surface, see "Direct provider resolution" above; with
  zero matching delivery-provider rows this falls back silently to a
  plain-directory-safe timestamp read). If that timestamp is after the
  spec's fetch/author date, warn the user — the spec may have been updated since.
  Continue anyway, but flag it.
- **Requirements reference files that no longer exist**: the file may have moved or been
  renamed. `Glob` for the basename before giving up. If truly missing, mark the
  dependent requirements UNVERIFIABLE and say why.
- **Branch has commits from multiple tasks**: inspecting the commit history between the
  base and HEAD (the same content-gathering approach as the Implementation scope above)
  will show this. Only verify the files touched for this task; list the unrelated
  commits separately.
- **Uncommitted changes**: the working-tree inspection above shows a dirty tree. Verify
  against `HEAD`, not the working tree — and note the dirty files so the user knows they
  weren't included.
- **Capability dispatch unavailable**: if a `subagent:` fragment names an agent that is
  not registered in this environment, treat that fragment as a no-op (it contributes no
  findings) and continue — never STOP the verdict on a missing capability. The generic
  audit still stands.
- **Re-run after fixes**: `04_verify.md` is overwritten with the latest run. The prior
  report is rotated into `04_verify.history.md` first (newest entry on top, separated by
  `---`), so the user has a trail of findings across iterations — useful when a fix
  introduces a regression or the same finding keeps reappearing. The history file grows
  unbounded; prune or delete manually if it gets noisy.

---

## Final Output

End the chat reply with this fenced block, after the chat summary:

```
VERIFY — <PASS | FAIL | PARTIAL>

{task-id}: <passed>/<total> requirements, capability findings <none | N across M capabilities>
Report: <task-folder>/04_verify.md
Next: <branched on the verdict — see below>
```

The `Next:` line is **always present**, branched on the verdict:

- **PASS** → `/wf:qa-gen {task-id}` (proceed to QA).
- **FAIL/PARTIAL with at least one mechanically fixable finding** → `/wf:verify-fix {task-id}`
  (the same finding that gates the chat summary's `/wf:verify-fix` suggestion).
- **FAIL/PARTIAL with only manual/structural findings** → fix the findings in
  04_verify.md, then re-run `/wf:verify-spec {task-id}`.

**The final output block must always be the very last thing output to chat.**
