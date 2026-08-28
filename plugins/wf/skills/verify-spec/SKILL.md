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

This skill is **capability-agnostic**. Its default is a generic spec-conformance audit
plus a **lean adversarial pass** — a closed, two-class check that runs inline and reports
defects a conformant change can still carry. On top of that default it **fires the
`verify` phase**, aggregating any `finding`s contributed by whatever capabilities the
project has registered — without naming, requiring, or assuming any of them. With no
capability registered, the generic verdict and the adversarial pass stand alone.

---

## Prerequisites

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP
Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath,
coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md` (core
performs no direct config-file parse). All references to `{task-root}` below come from
`coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is
uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the
user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and
report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse
config as a fallback. Task folders live at `{task-root}/{task-id}/`.

---

## Dispatch on arguments

Parse the first token. Recognized forms:

### empty → infer from current branch

1. Resolve the task id per the shared pipeline conventions doc — obtained via the
   `wf-resolver` MCP tool `resolve_content({ workspaceRoot, ... })` (`class: shared`, `ref: pipeline-conventions.md`),
   never a raw `Read` of the plugin-cache path — §"Id inference from the current branch";
   inferred from the branch via `current-branch-query` (the `wf-resolver`
   `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution" below) and
   resolved against `{task-root}`, naming `/wf:verify-spec` in its stop messages.
2. Confirm the resolved task folder's requirements artifact (`00_reqs.md`) exists. If
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
`last-commit-timestamp-query` (the spec-staleness edge case) — is reached by calling the
bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface: "delivery" })` — the typed query that
returns the run-scoped resolution record `{ surface, owner, fragmentPath, state,
degradation, diagnostics }`. The resolver has already resolved the `## Capabilities`
registry, the owning capability's `manifest.md`, and any plugin-anchored root (post
install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first
resolution with install-manifest self-heal"); core performs **no** registry / manifest /
plugin-root read of its own. Obtain the operation body through the resolver's
`resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`, keyed on the record's `owner` and
fragment `ref`) and follow it in this skill's own context to dispatch the operation —
never a raw `Read` of the resolved path. On `state: unconfigured` or `unrecoverable` (no
readable `delivery` provider), both operations fall back silently to their
plain-directory-safe cases — no error, no capability term surfaces. If the `wf-resolver`
service is unavailable, stop and report that the resolver runtime is not loaded — do not
hand-parse the registry (WF-272 diagnostics/recovery). This audit's core evidence-gathering
(the diff, commit coordinates, and dirty-tree state — see "Implementation scope" below) has
no delivery operation of its own today, so it is gathered directly against the local working
tree regardless of resolution state — a documented contract-completeness gap, not a
workaround.

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
3. **Implementation scope** — the diff of the current branch vs `main`, plus the commit
   coordinates the audit runs against. No delivery operation covers diff/log inspection
   today (the gap noted above; the operation set is in
   `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The delivery provider
   surface"). Gather the following by outcome, never as a literal command:
   - the current branch name — via `current-branch-query` (the `wf-resolver`
     `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution" above)
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

**Tool note:** the bullets below reference `Grep`/`Glob` for brevity. Prefer an indexed
code-search MCP (`sourcebot`) for symbol/content lookups when one is available; fall back
to `Grep`/`Glob` only when none fits, or for file-pattern searches.

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
  spec asked for and what you found. When the fix is a concrete, bounded edit at the
  cited location (a literal value, a missing enum/interface member, a marker comment to
  insert or replace, a forbidden line to comment out) — not a design call — record it as
  a one-line **Remedy**. Omit `Remedy` when the fix requires judgment, spans multiple
  files, or has no single obvious edit.
- **PARTIAL** — requirement has N sub-claims and M < N are satisfied. List which
  sub-claims fail. Same `Remedy` rule as FAIL, applied per failing sub-claim where a
  bounded edit exists.
- **N/A** — requirement was explicitly scoped out by a later note or parent constraint.
  Cite the source of the exclusion.
- **UNVERIFIABLE** — requirement cannot be checked from static code alone (e.g., "works
  at runtime"). Say so; suggest a runtime check (`npm test`, Chrome MCP,
  `tsc --noEmit`).

---

## The lean adversarial pass

The audit above answers *"does the change do what the requirements say?"*. It cannot
answer *"is what the change does actually right?"* — a change can conform to its own
requirements exactly and still be wrong. This pass is core's own answer to the second
question, and it is a **lean default**: it ships with core, runs on a completely empty
registry, and names no capability.

**It adds no dispatch.** It runs inline, in this skill's own context, over the changed
lines already gathered under "Implementation scope" — no Task call, no subagent, no
further resolver call, and no evidence gathering of its own. It is strictly additive to
the phase below and alters none of it.

**It reports; it does not gate.** An adversarial finding never changes a requirement's
verdict, never changes the report's `**Verdict:**` line, and never changes the
final-output block or its status token. This introduces no stop, no prompt, and no gate
that did not exist before.

### The two defect classes — this list is closed

Check the changed lines for exactly these two, and nothing else:

1. **Out-of-range bound** — the change introduces or edits a literal bound, range,
   threshold, cap, limit, or enumerated value set, and that literal contradicts the range
   the surrounding code already defines for the same quantity.
2. **Unstated assumption behind a derivation** — the change derives a value, predicate, or
   control decision whose correctness depends on a precondition the change neither states
   nor enforces, and the surrounding code does not already guarantee.

Do not widen this list. An open-ended hunt is what makes such a pass expensive and what
makes it invent findings; the closed list is what holds it inside the budget.

### The two-sided citation rule

A finding is reportable **only** when both sides carry a concrete `file:line`:

- the **changed line** that carries the defect, and
- the **existing line** that contradicts it — the definition, declaration, guard, or
  caller establishing the real range, or requiring the unmet precondition.

If either side cannot be cited, there is no finding. **Never reportable**, however
plausible: a speculation ("consider whether…", "this might…"); a restatement of the change
itself as a risk; a finding whose evidence is an **absence** (that no test, guard, comment,
or handler was found — an absence is not a citation); a style, naming, or preference nit;
or a requirement already resolved above. Reporting nothing on a change carrying neither
class is this pass working correctly, not failing.

Hold reportable findings as **candidates** tagged with the provenance `core`; this section
compares nothing. They are reconciled against the phase below once both sets are in hand
(§"Reconcile against the lean pass"), then rendered under the report's
`## Adversarial findings` section; when none survives, omit that section entirely. Rationale
and worked examples live in the paired reference `adversarial-pass.md` — obtained, when a
reader wants it, via `resolve_content({ workspaceRoot, ... })` (`class: references-template`,
`skill: verify-spec`, `ref: adversarial-pass.md`) — and are never read on this path.

---

## Fire the `verify` phase (aggregate capability findings)

After the generic per-requirement audit, fire the **`verify`** phase and aggregate any
**`finding`** contributions the registered capabilities attach to it.

Obtain the ordered active registry as metadata from the `wf-resolver` MCP service — do
**not** read `## Capabilities` or any `manifest.md` yourself — referencing the taxonomy
by **phase name / contribution-kind name**, never by heading:

1. **Call `resolve_registry({ workspaceRoot, ... })`.** It returns the ordered active `capabilities[]` (in
   registry order), each already resolved from the registry and its `manifest.md`:
   `{ name, kind, manifestPath, fragments[] { phase, contributionKind, dispatch, scope },
   articles[], provenance, validity }`. The resolver has done the registry iteration,
   per-capability manifest read, and plugin-anchored root self-heal. If the `wf-resolver`
   service is unavailable, stop and report that the resolver runtime is not loaded — do
   not hand-parse the registry (WF-272 diagnostics/recovery).
2. **Collect** the fragment rows whose `phase` is `verify` and `contributionKind` is
   `finding`, in registry order.
3. **Dispatch each** on its `dispatch` metadata (the metadata queries return only
   paths/metadata; inline fragment bodies come from the resolver's
   `resolve_content({ workspaceRoot, ... })` content surface, read prompt-free in this
   skill's own context):
   `inline: <rel-path>` → obtain the fragment body via
   `resolve_content({ workspaceRoot, ... })` (`class: fragment`, the capability name,
   `ref: <rel-path>`) and follow it in-context, producing each finding in the generic
   finding shape below.

   For `subagent: <agent>`, apply the optional contributor gate **before any routing or
   Task call**. Resolve the source capability's profile values once per capability with
   `resolve_profile({ workspaceRoot, capability: <source-capability> })`. For that
   capability's collected subagent rows, derive each contributor id as the first
   hyphen-delimited segment of the final colon-delimited dispatch slug. If a resolved
   top-level string-array contains at least one of those derived ids, treat that array as
   the capability's contributor allowlist and skip every row whose id is absent — without
   routing or spawning it. No matching string-array means no contributor gate and leaves
   every row enabled. This is generic and data-driven: core names no profile key,
   capability, contributor, or target suffix.

   <!-- capability-route:verify-finding --> For every enabled row, validate the agent
   token as a registered Task target and derive the stable routing `role` from its final
   colon-delimited slug (core never names the capability or target). Immediately before
   each Task attempt, call `resolve_routing` with `workspaceRoot: <absolute pwd -P
   workspace root>`, that role, `unitIds:
   ["verify:<source-capability>:<role>"]` canonicalized by the shared routing rule,
   `supportsModelSelector: true`, `supportsEffortSelector: false`, and `shapeEvidence: {
   workSurface: "external-context", atomicity: "atomic", unitCount: 1,
   unitsIndependent: false, ambiguity: "material", risk: "elevated", toolWork:
   "material", validation: "judgment", contextIsolation: "required",
   independentReview: true, returnContract: "judgment", requestedParallelism: 1 }`.
   Include `actualModel` only when exposed and emit the compact operational record
   separately from report attribution. A `status: stop`, diagnostic, malformed derived
   role, or non-`isolated` shape is a hard stop before Task; otherwise invoke one Task
   with `subagent_type: <agent>`, passing the artifact under audit **and the following
   finding contract inline in the dispatch prompt** (the same bytes enter every enabled
   lens context; no per-agent resolver fetch and no payload-reduction claim):

   ```text
   Return only this block, with one item per concrete, evidenced issue and an empty
   `findings:` list when clean:

   AUDIT-<LENS> — <clean | findings>

   lens: <lens>
   findings:
   - severity: <fail | warn>
     location: <file:line, or unit identifier>
     issue: <the concrete defect, one line>
     evidence: <what proves it — a quoted line or grep result>
     recommendation: <the concrete bounded change, or "escalate">

   `fail` blocks shipment; `warn` is non-blocking. Report no speculation, style nits,
   or restated generic requirements.
   ```

   Pass `model.value` only when non-null (effort is unsupported), and forward only the
   final block. The parent validates that block against this generic finding contract
   and exclusively owns any `postAttempt`, retaining the same unit id and evidence; the
   child never self-replaces. If the Task target itself is unavailable, preserve the
   existing optional-contributor no-op.
4. **Aggregate provenance-tagged** — render every contributor's findings, each tagged
   with its **source capability** (the `name` field); registry order is cosmetic.

**No-op:** if `resolve_registry({ workspaceRoot, ... })` returns an empty `capabilities[]` or no fragment
matches `verify` under the `finding` kind, the whole phase produces **nothing** and the
generic verdict stands alone (no capability findings section, no capability/stack/domain
term surfaced, no broken subagent reference, no STOP). A malformed `dispatch` is that
contributor's own no-op — never a STOP — and is reported as incomplete coverage below. A
capability's findings feed the verdict on the same footing as generic requirements (a
finding that asserts non-conformance is a FAIL, exactly like a failed requirement).

### Reconcile against the lean pass

Both adversarial sources have now produced output. Reconcile them here, over the
contribution taxonomy alone — core names no capability, and this step is inert when
nothing was aggregated.

- **One-directional.** Only a `core` candidate may be withdrawn or annotated. An
  aggregated `finding` is never dropped, edited, re-tagged, merged, reordered, or withheld
  here, and a contributor that failed or returned nothing can never cause a withdrawal.
- **Overlap** is a `finding` whose `location` cites the same `file:line` as a candidate's
  **changed-side** citation; with none, the candidate renders unchanged. An overlapping
  `finding` that rests on the candidate's *existing-side* evidence too leaves the candidate
  adding nothing → **withdraw** it, recorded as a `Withdrawn` line naming its cover. One
  resting on *different* evidence is a single defect seen twice → **retain both**, each
  keeping its own provenance and naming the other, never silently collapsed or doubled.

---

## Output

Two outputs, always both:

1. **Full report** — written to the task folder's `04_verify.md`, which always holds the
   latest run. Before overwriting, rotate the prior `04_verify.md` into
   `04_verify.history.md` per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`,
   `class: shared`, `ref: pipeline-conventions.md`)
   §"Artifact rotation into `.history.md`". This gives a trail of every prior audit run at
   this path, so the user can compare findings across iterations and see what a fix broke
   or regressed. Each archived entry is self-identifying via its own header
   (`**Commit:** <SHA>`, `**Audited at:** <timestamp>`). When the `<path-to-00_reqs.md>`
   override form is used, write both files as siblings of that file instead.
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

The verbatim `04_verify.md` output shape — the report header, `## Requirements`,
`## Capability findings`, `## Adversarial findings`, `## Deviations`, and
`## Recommended next actions` structure —
lives at `verify-template.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })`
(`class: references-template`, `skill: verify-spec`, `ref: verify-template.md`), never a
raw `Read` of the plugin-cache path. It is read only on this write path, so it stays out of
the boot body. Follow it, then emit it with placeholders substituted. Keep quoted snippets short — one or two lines max; the reader
clicks `file:line` for the rest.

### Chat summary shape

The verbatim ordered shape — the verdict line, the report pointer, the FAIL/PARTIAL
bullets, the capability- and adversarial-findings lines, the top next actions, and the
conditional `/wf:verify-fix` suggestion with its inclusion test — lives at
`chat-summary.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })`
(`class: references-template`, `skill: verify-spec`, `ref: chat-summary.md`), never a raw
`Read` of the plugin-cache path. Like the report template beside it, it is read only on
this write path, so it stays out of the boot body. Follow it, then emit it with
placeholders substituted. Target ~15 lines total; if the summary grows past that, trim
detail, not items.

### Record the phase-completion receipt

Reached **after** the report is written, so the receipt attests work that actually
happened. Call the bundled `wf-resolver` MCP tool `record_run_evidence({ workspaceRoot,
kind: "phase-receipt", subject: "verify-spec", taskId: {task-id}, artifactPath:
"<the report path just written>" })` — normally `<task-folder>/04_verify.md`, and on the
`<path-to-00_reqs.md>` override form the sibling path it actually went to, so the resolver
digests the file that exists; skip the call when that path lies outside the workspace, the
same carve-out the index step takes. The resolver derives the run identity, the workspace,
the timestamp and the sequence itself, digests the named artifact itself, and seals the
record — this skill asserts none of them, which is what makes the receipt proof rather
than a claim, and why it never writes the destination directly. **Non-blocking, always:**
a `refused` outcome (or an unavailable resolver) is reported in one line and changes
nothing else — the verdict is unaffected and the block below is emitted unchanged.

End with the final-output block (see below).

---

## What this skill will NOT do

- Will NOT modify any source file outside `_local/` — verification is read-only, and the
  only write is the task folder's `04_verify.md`. Fixes to source are asked for separately.
- Will NOT mark something PASS without concrete evidence. "Looks correct" is not a verdict.
- Will NOT use a derived artifact (an LLM-authored plan) as the source of truth.
- Will NOT invent requirements not present in the spec. A capability's invariants surface
  as capability `finding`s at the `verify` phase, not as fabricated requirement-list rows.
- Will NOT name, require, or assume any capability — including when reconciling the two
  adversarial sources. It iterates the registry and aggregates whatever is contributed;
  with none registered, the generic verdict plus the lean adversarial pass stand alone.

---

## Edge Cases

- **Spec is stale**: run the staleness check per the shared pipeline conventions doc
  (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`)
  §"Report/spec staleness check", comparing `last-commit-timestamp-query` (the
  `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution"
  above) against the spec header's fetch/author date. If the branch has moved since, warn the
  user — the spec may have been updated since — and continue anyway, but flag it.
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
- **Change carries neither adversarial defect class**: the lean adversarial pass reports
  nothing and the `## Adversarial findings` section is omitted from the report. This is the
  expected result on a clean change — do not synthesize a "no issues found" entry, and do
  not relax the two-sided citation rule to produce one.
- **Empty registry**: the lean adversarial pass still runs — it is a core default, not a
  contribution — while the phase below produces nothing. The generic verdict plus any
  adversarial findings stand alone, with no capability term surfaced.
- **A contributor fails or returns nothing**: an unregistered `subagent:` agent, an errored
  dispatch, or an unparseable block contributes no findings — never a STOP, and the generic
  audit still stands. But it contributed nothing *and is not clean*: state it with its
  provenance and mark the adversarial coverage **incomplete**, so the surviving findings are
  never presented as a complete adversarial pass. Reporting only — no verdict change.
- **Re-run after fixes**: `04_verify.md` is overwritten and the prior report rotated into
  `04_verify.history.md`, giving a trail across iterations — useful when a fix regresses or
  the same finding keeps reappearing. That file grows unbounded; prune it manually.

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
