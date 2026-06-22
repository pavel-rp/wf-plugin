---
name: qa-gen
description: Generates a test plan for an ADO task — classifies each spec success criterion by verification method (build/static, automated test, manual-browser, or API endpoint-exercise), then writes 06_qa.md with scoped, spec-traced scenarios. UI criteria become browser scenarios a human or agent runs in the running app; backend criteria become API scenarios that exercise the endpoint (or a temporarily-wired service) over HTTP with a real token. Use when a task is implemented (or nearly so) and you want a QA pass tied to spec criteria before opening a PR or handing the plan to a run-assistant — including backend-only tasks that have no UI.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:qa-gen — Manual browser-test plan generator

Generates a structured manual test plan for an ADO task. Reads `00_reqs.md` (source of truth), classifies each success criterion by how it can be verified, designs scenarios for the criteria that need a human in a browser, and writes `06_qa.md` in the task folder. Every spec-derived scenario traces back to a numbered spec criterion; untraceable spec scenarios don't ship. The one deliberate exception is the **Baseline health suite** — a small standing set of measurable checks (no console errors, no failed network requests, the view renders) that every plan carries regardless of scope or criteria. See Phase 3.5.

This skill produces **prose, not code**. The output is a plan a tester (human or agent) executes against the running app. Most scenarios are **browser** scenarios — clicks, typed values, observed UI changes, network calls visible in devtools. For a **backend** task (a controller endpoint, a service method, a ported repository method) it instead writes **API** scenarios that exercise the endpoint over HTTP with a real token and assert status + response shape; when the deliverable is a service with no endpoint yet, the scenario carries a `Backend host required:` precondition the runner satisfies by temporarily wiring the service to a controller (then reverting it). The full API-scenario rules live in [`references/api-scenarios.md`](references/api-scenarios.md). For automated unit tests scaffold via `/wf:test-page` (Angular DI-level, sandbox component) or `/wf:test-node` (pure helpers, Node runner) — those siblings cover what this skill deliberately doesn't.

A backend-only task is therefore **never** a stub PASS: its behavioral criteria become runnable API scenarios, and its Baseline-health suite targets the primary endpoint instead of being marked N/A.

To run the plan, use the family's run-assistant skills:

- **`/wf:qa-run`** — interactive walkthrough. The skill is the test lead, the user is the tester, one step at a time.
- **`/wf:qa-auto`** — autonomous run. Drives the browser through each scenario, captures screenshots on FAIL, and writes the same report.

Both write `07_qa-report.md` in the format documented at [`references/report-format.md`](references/report-format.md). Stable `TC-NNN` IDs and `Validates: SC-N` lines on every scenario let the runners address scenarios individually and reconcile back to the spec.

---

## Prerequisites

Read `_local/config.md` for `{task-root}` and `{wi-prefix}`. If absent, stop with: "Run `/wf:init` first." Also read `{qa-baseline-ignore}` if present (the allowlist of known-benign console messages / request patterns the Baseline health suite tolerates) — it's optional; treat an absent key as an empty list.

`00_reqs.md` is the authoritative spec. `01_spec.md` is consulted only if reqs are too thin to derive testable criteria. **Never derive cases from the implementation** — see the black-box rule under Phase 3.

---

## Command Syntax

```
/wf:qa-gen [<ado-id>] [scope]
```

Two optional positional arguments. Zero-arg invocation infers the ADO ID from the current branch and uses scope `full`.

### Arguments

| Argument    | Required | Description                                                                                       |
| ----------- | -------- | ------------------------------------------------------------------------------------------------- |
| `<ado-id>`  | NO       | ADO ID. Falls back to inferring from `git branch --show-current` (first 3+-digit run).            |
| `[scope]`   | NO       | `smoke`, `happy`, or `full` — see Scope Reference below. Default `full`.                         |

Argument-parser disambiguation: if a token is a 3+-digit numeric or `<wi-prefix>-NNN` form, treat it as the ID. Otherwise treat it as the scope. Unknown scope values stop with an error.

Examples:

- `/wf:qa-gen` — infer ID from branch, scope `full` (default).
- `/wf:qa-gen 6396` — explicit ID, scope `full`.
- `/wf:qa-gen happy` — infer ID from branch, narrow to scope `happy`.
- `/wf:qa-gen 6396 smoke` — explicit ID, scope `smoke`.

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`).
- Read-only git commands: `git rev-parse`, `git branch --show-current`, `git diff --name-only main...HEAD`, `git status --porcelain`, `git log`.
- Invoke the **Task** tool for `wf:branch` (branch gate) and `/wf:index` (index update).
- Write `06_qa.md` ONLY inside the resolved task folder (`{task-root}/{wi-prefix}-{id}/`).

**Forbidden:**

- Modify any source file, spec, plan, or other artifact. This skill is read-mostly — its only write is `06_qa.md` and the index row.
- Run builds, tests, installs, or any destructive git operation.
- Read implementation method bodies to derive scenarios. Public signatures (route paths, component selectors, button labels, exported names) are allowed when needed to make steps concrete; method bodies are not.
- Invent scenarios untraceable to a numbered spec criterion. If a criterion is missing, escalate — don't backfill.
- Write outside `_local/`.

---

## Phase 1: Resolve and gate

1. **Resolve `<ado-id>`** from the passed argument, or extract the first 3+-digit run from `git branch --show-current`. If neither yields an ID, stop: "No ADO ID provided and none could be inferred from the current branch. Pass it explicitly: `/wf:qa-gen <ado-id>`."

2. **Locate the task folder.** Compute `{task-root}/{wi-prefix}-{id}/`. If it doesn't exist, stop: "Task folder not found. Run `/wf:spec {id}` first."

3. **Verify `00_reqs.md` exists** in the task folder. If missing, stop: "No `00_reqs.md` for `{wi-prefix}-{id}`. Run `/wf:spec {id}` first to fetch ADO requirements."

4. **Branch gate.** If `git branch --show-current` doesn't match `*/<id>-*`, invoke the **Task** tool with `subagent_type: wf:branch` and the resolved ID. The subagent will create or switch to the task branch. If subagent invocation is unavailable, stop with: "Not on task branch and the Task tool isn't available. Run `/wf:branch {id}` manually, then re-run `/wf:qa-gen`."

5. **Resolve scope.** Default `full`. Accept `smoke`, `happy`, `full` — anything else stops with "Unknown scope: `<value>`. Use one of: smoke, happy, full."

---

## Phase 2: Gather context

Run these reads in parallel where the tools allow:

1. **Read `00_reqs.md`.** Extract:
   - The numbered list of success criteria (label them `SC-1`, `SC-2`, … in order of appearance).
   - In-scope and out-of-scope statements.
   - User-journey or workflow descriptions, if present.
   - Any constraints (browser support, auth state, data preconditions).

2. **Read `01_spec.md` if `00_reqs.md` is thin** (no enumerated criteria, or fewer than three). When you do, treat it as supplementary — every scenario still maps to a criterion derived from `00_reqs.md` where possible, falling back to `01_spec.md` only when reqs leave a clear gap. Note in the coverage matrix which document the criterion came from.

3. **Read `02_plan.md` if it exists** for the list of files implemented and any noted manual-test hints. Don't derive scenarios from plan steps — they describe code, not behavior.

4. **Inspect what changed.** Run `git diff --name-only main...HEAD` to list files modified on this branch. For each file, do a *signature-only* read (component selectors, route paths, public method names, template button labels) so scenarios can name real UI elements. **Stop reading at the first method body.** This is the same black-box rule `/wf:test-page` enforces.

   For each new `*.component.ts` under `AuditTrakker.Web/`, also check whether the component is routed: grep `AuditTrakker.Web/src/app/code-trakker/code-trakker-routing.module.ts` for the component's kebab-name. If absent AND no `<kebab>-test/` folder exists either, the target is **host-missing** — record this so Phase 4 can emit a `Host required: <component-path>` precondition on scenarios that interact with it. `/wf:qa-auto` invokes `/wf:qa-host` to scaffold a routed test-host on demand.

   **Backend surfaces.** Apply the same signature-only read to `.cs` files in the diff — controllers, services, repositories, and the DTOs they return — following [`references/api-scenarios.md` § Backend-diff signals](references/api-scenarios.md#backend-diff-signals-phase-2). For each new/changed `*Controller.cs` action, record its verb + route + params + return type (an **endpoint** surface). For each new/changed public method on a `*Service.cs` / `*Repository.cs` with no controller action calling it, record it as a **service-only** surface so Phase 4 can emit a `Backend host required: <Service>.<method>` precondition. A diff that is entirely `.cs` data-layer files with no Angular target is a **backend-only** task — its behavioral criteria classify as **API** in Phase 3.

5. **Catalog existing automated coverage.** Look under:
   - `_local/{wi-prefix}-{id}/tests/` — `/wf:test-node` output.
   - `AuditTrakker.Web/src/app/code-trakker/code-trakker-module-test/_page-tests/` — `/wf:test-page` output (filename hints carry the suite name; the file is git-excluded but local).
   - Any pre-existing test files referenced in `02_plan.md`.

   For each automated test file, note which assertions it makes — the coverage matrix needs to know what's already verified by code so manual scenarios don't duplicate.

---

## Phase 3: Classify criteria

For every `SC-N` extracted in Phase 2, place it in exactly one of four categories. The classification table for the run goes into `06_qa.md` verbatim.

### Black-box rule

Cases come from criteria, not code. Implementation reads in Phase 2 are for **naming** real UI elements (the actual button label, the actual route, the actual error toast text), not for inferring what the system *should* do. If a criterion is ambiguous, write the test against the stricter interpretation and add a `<!-- AMBIGUOUS: <criterion> · <interpretations> -->` HTML comment next to the scenario. Don't guess from implementation.

### Categories

| Category | Verified by | Examples | Action |
|---|---|---|---|
| **Build/static** | Compilation, typecheck, lint, file existence | "module exports type X", "config includes key Y", "tsconfig includes path Z" | Listed in coverage matrix. No manual scenario. |
| **Automated test** | Existing unit/integration test asserts the criterion directly | Matches an assertion you found in Phase 2 step 5 (incl. a `wf:test-page backend-smoke` page-test) | Listed in coverage matrix with the test file path. No manual scenario. |
| **Manual-browser** | Human or agent observes runtime behavior in the running app | "clicking Save shows a green toast", "dropdown filters list to entries matching the search" | One or more browser scenarios depending on scope. |
| **API** | The behavior of an endpoint or service method, called over HTTP with a real token | "endpoint returns the provider groups for the access level", "repository filters out inactive rows", "POST creates the record and returns 201", "service returns an empty list when none match" | One or more API scenarios. Service-only methods get a `Backend host required:` precondition. See [`references/api-scenarios.md`](references/api-scenarios.md). |

### Classification signals

- **Build/static:** mentions file/export/type/schema/config; verifiable by running `tsc`, `eslint`, or `ls`/`grep`; describes code **structure** (existence, shape, signature) rather than runtime behavior.
- **Automated test:** an existing test file from Phase 2 step 5 asserts this criterion directly. Cite the test file and the specific test name.
- **Manual-browser:** describes what a user sees, clicks, or experiences; requires a running app and a browser; involves visual appearance, interaction flow, or cross-system behavior visible to a human.
- **API:** describes the runtime behavior of a backend call — an endpoint or a service/repository method that returns, filters, persists, or rejects data. Verified by *calling* it with a real token and asserting status + response shape, not by checking it compiles. This is the category that keeps a backend-only task from collapsing into all-Build/static. The existence-vs-behavior line is detailed in [`references/api-scenarios.md` § When a criterion is API vs Build/static](references/api-scenarios.md#when-a-criterion-is-api-vs-buildstatic).

When a criterion straddles categories, split it and don't double-count: "service is **provided** AND its method **behaves correctly**" → the provided/registered/exported half goes Build/static (or Automated), the behaves-correctly half goes **API** (or Manual-browser if the behavior is only observable in the UI).

### Apply the scope filter

For criteria in the **Manual-browser** and **API** categories:

- **`smoke`** — one scenario per criterion, golden path only. Minimum viable coverage.
- **`happy`** — golden paths plus key variations (different valid inputs, alternate flows from user journeys in `00_reqs.md`; for API, additional valid parameter sets).
- **`full`** — happy paths plus error cases (invalid input, network/auth failures; for API, bad-input→400, missing/forbidden→401/403, not-found→404 where the spec defines them), edge cases (empty states, boundary values), and negative tests (what should NOT happen).

Build/static and Automated criteria get exactly one row in the coverage matrix regardless of scope.

### Group into suites

Organize the manual scenarios into suites by:

- User journey, when `00_reqs.md` has explicit journeys — preferred.
- Feature area or component when journeys aren't defined.
- Within each suite, prioritize: **P0** (blocks release / data correctness / auth), **P1** (important UX / common flows), **P2** (nice to verify).

Number scenarios `TC-001`, `TC-002`, … globally across suites — not per-suite. The IDs are stable and grep-friendly; the run-assistant addresses scenarios by `TC-NNN`.

---

## Phase 3.5: Add the Baseline health suite (always)

Independent of the criteria and the scope, **every** `06_qa.md` ends with a `## Suite: Baseline health` section. These scenarios aren't derived from an `SC-N` — they assert a standing quality bar that any change must clear, and they catch the failure modes the spec-traced scenarios miss because nobody wrote a criterion for "the page shouldn't throw." They are the exception to "untraceable scenarios don't ship"; mark them `Validates: — (baseline health)`.

**Pick the target.** Choose the route the task most directly affects (from the Phase 2 diff / journeys). For a cross-cutting task with no single route, use the most-affected view, or the app root. Substitute it as `<target route>` below.

**Backend-only tasks: emit the API baseline instead.** When the task affects no reachable UI route but *does* add or change a callable endpoint/service (the backend-only case from Phase 2), do **not** mark the baseline `[N/A: no runnable UI]`. Emit the single **API baseline** scenario from [`references/api-scenarios.md` § API baseline health](references/api-scenarios.md#api-baseline-health) — the primary endpoint responds without a 5xx and accepts the token — and skip the two browser baseline scenarios below. Only fall back to a lone `[N/A: no runnable surface]` scenario when the task has neither a route nor any callable endpoint/service (pure type/config/helper work).

**Scenarios to emit (browser target):**

1. **`<target>` loads clean** — *always, every scope.* Priority **P1**. Navigate to the target route with the console and network panels cleared, then assert three things as separate steps: the primary content renders (no white screen / error page), the console logged no error-level entries during load, and no request failed or returned 4xx/5xx during load. Each assertion excludes anything matching `{qa-baseline-ignore}` and the expected auth/redirect calls.
2. **Console & network clean across the full run** — *always, every scope.* Priority **P1**. Evaluated **after all other scenarios complete**: inspect every error-level console entry and every failed/4xx-5xx request that occurred *at any point during the session* — across all scenarios, not just one route — excluding `{qa-baseline-ignore}` and the expected auth/redirect calls. This is the catch-all for errors no individual step asserted against, and for leaks that surface only after the app has been driven for a while. The runners evaluate it last, from signals accumulated across the whole session, and attribute each finding to the scenario that was active when it fired.

Number them in sequence after the spec scenarios (Baseline health is the last suite). Don't invent extra baseline scenarios beyond these two — keep the standing bar small and stable. If the task has no reachable route but has a callable endpoint/service, emit the **API baseline** scenario described above instead of these two. Only when the task has *no runnable surface of any kind* (pure library/helper work — no route, no endpoint, no service) emit the suite with a single scenario marked `[N/A: no runnable surface on this task]` and explain in one line, rather than omitting it.

Write to `{task-root}/{wi-prefix}-{id}/06_qa.md`. Overwrite if it exists — git history (well, the in-folder backup if any) preserves prior versions; the task folder is gitignored, so there's no git history to fall back on. Warn the user if the file already exists and contains scenarios with run results recorded.

Use the template in the next section verbatim. Substitute placeholders. Don't invent extra sections.

---

## Template: `06_qa.md`

```markdown
# {wi-prefix}-{id} — Manual QA Plan

**Generated:** <YYYY-MM-DD HH:mm>
**Generated by:** <model identifier>
**Scope:** <smoke | happy | full>
**Branch:** <git branch --show-current>
**Spec:** `00_reqs.md` (+ `01_spec.md` where noted)

This plan is executed manually in a browser against the running app. Each scenario validates one spec criterion. Mark results in-place as the run-assistant directs, or — if running solo — annotate `[PASS]`, `[FAIL: <reason>]`, or `[SKIP: <reason>]` next to each `TC-NNN` heading.

---

## Coverage Matrix

### Runnable scenarios (browser + API)

| Criterion (SC-N) | Wording (abbreviated) | Scenarios | Type | Priority |
|---|---|---|---|---|
| SC-1 | <abbreviated criterion> | TC-001, TC-002 | browser | P0 |
| SC-3 | <abbreviated criterion> | TC-003 | browser | P1 |
| SC-6 | <abbreviated criterion> | TC-004 | API | P0 |

### Verified by build / automation

| Criterion (SC-N) | Wording (abbreviated) | Verification |
|---|---|---|
| SC-2 | <abbreviated criterion> | TypeScript compilation (`tsc --noEmit`) |
| SC-4 | <abbreviated criterion> | `_page-tests/cra-shared-state.page-test.ts` → `setSkipEmptyCategories(true) is visible via getSkipEmptyCategories()` |
| SC-5 | <abbreviated criterion> | File existence: `AuditTrakker.Web/src/app/state/cra-shared-state.service.ts` |

### Baseline health (always present)

| Scenario | Checks |
|---|---|
| TC-NNN | `<target route>` loads clean — primary content renders + no console errors + no failed/4xx-5xx requests on load |
| TC-NNN | Console & network clean across the full run — evaluated after all scenarios, session-wide |

Not spec-traced — these assert a standing quality bar, not an `SC-N`. Known-benign noise is filtered via `{qa-baseline-ignore}`.

### Gaps

<List any criterion with no coverage — neither manual nor automated. Should be empty. If non-empty, flag prominently and explain why the gap exists.>

---

## Suite: <suite name>

### TC-001: <scenario title — echo the spec wording where possible>

**Validates:** SC-<N> — <criterion text, abbreviated>
**Priority:** P0 | P1 | P2

**Preconditions:**

- <Browser / app state — e.g., "Logged in as `admin@example.com`. Entity `Acme Corp` selected. On `/code-trakker/dashboard`.">
- <Data state — e.g., "At least one open audit exists in the current entity.">
- <Environment — e.g., "API server running. Network throttling off.">
- <Host requirement, only when target was flagged host-missing in Phase 2 step 4 — e.g., "Host required: `AuditTrakker.Web/src/app/.../level-and-period-picker/level-and-period-picker.component.ts`. `/wf:qa-auto` will scaffold or look up the route via `/wf:qa-host`.">

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Click the **Add Period** button in the toolbar. | A modal titled "New Period" opens. The first input (`Start Date`) is focused. |
| 2 | Type `2026-01-15` into the **Start Date** field. | The field shows `1/15/2026`. The **Save** button becomes enabled. |
| 3 | Click **Save**. | Modal closes. A green toast appears with text `Period created`. The new period appears at the top of the list, highlighted for ~2 seconds. |

**Teardown:**

- <Cleanup actions, if any. Often empty for read-only or sandboxed flows.>

---

### TC-002: <scenario title>

...

---

> **API scenarios** use the same outer block (`Validates` / `Priority` / `Preconditions` / `Teardown`) but carry a `**Type:** API` line and replace the **Steps** table with a **Request** block + an **Assertions** table. Service-only criteria add a `Backend host required: <Service>.<method>` precondition. Copy the exact shape from [`references/api-scenarios.md` § API scenario template](references/api-scenarios.md#api-scenario-template) — don't improvise it, the runners parse it. Browser scenarios need no `**Type:**` line (absence means browser).

---

## Suite: Baseline health

Standing measurable checks — not derived from a spec criterion. Always present. Known-benign console messages / request patterns are filtered via `{qa-baseline-ignore}` from `_local/config.md`.

### TC-NNN: `<target route>` loads with a clean console and network

**Validates:** — (baseline health)
**Priority:** P1

**Preconditions:**

- Logged in; entity selected.
- DevTools open with the Console and Network panels cleared. (`/wf:qa-auto` instruments this automatically.)
- Known-benign noise to ignore: `{qa-baseline-ignore}` (empty = ignore nothing).

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Navigate to `<target route>`. | The page renders its primary content (heading / main container visible) — no white screen, no error page. |
| 2 | Inspect the Console panel for the load. | No error-level entries (warnings allowed), excluding the known-benign list. |
| 3 | Inspect the Network panel for the load. | No request failed or returned 4xx/5xx, excluding the known-benign list and the expected auth/redirect calls. |

**Teardown:** none.

---

### TC-NNN: Console & network clean across the full run

**Validates:** — (baseline health, full-run)
**Priority:** P1

> **Full-run check** — evaluate this scenario **after all other scenarios complete**, from console/network signals accumulated across the whole session (the runner keeps the panels/listeners active from login onward). Don't run it mid-sequence.

**Preconditions:**

- All other scenarios in this plan have been executed in the same browser session.
- DevTools left open since login; Console and Network history retained for the whole run.
- Known-benign noise to ignore: `{qa-baseline-ignore}`.

**Steps:**

| # | Action | Expected Result |
|---|---|---|
| 1 | Review the Console for the entire session. | No error-level entries were logged during any scenario (warnings allowed), excluding the known-benign list. Each violation is attributed to the scenario that was active when it fired. |
| 2 | Review the Network history for the entire session. | No request failed or returned 4xx/5xx during any scenario, excluding the known-benign list and the expected auth/redirect calls. |

**Teardown:** none.
```

---

## Writing rules

These rules apply when authoring scenarios — they're the difference between a plan a tester can run cold and a plan that punts back to the spec.

- **Steps are concrete instructions.** Not "verify the feature works" but `Click **Save** with the form filled out as in step 2.` A tester unfamiliar with the project should be able to follow them without reading `00_reqs.md`.
- **Expected results are observable.** Not "the system processes correctly" but "A green toast appears with text `Period created` and the URL changes to `/audits/123`." Cite specific selectors, labels, URLs, and toast text from the implementation reads in Phase 2.
- **Preconditions are actionable.** Not "the system is in the right state" but "Logged in as `admin@example.com`. Navigate to `/audits/2026-Q1`."
- **One assertion per step when possible.** If a step expects "modal closes AND toast appears AND list reorders", split it — a partial pass on a multi-assertion step is hard to record.
- **Reference real values.** Use actual route paths, button labels, field names, API endpoints from the implementation. Don't write `<some-button>` placeholders.
- **Mark environment requirements.** If a test needs a specific browser, viewport, network condition, auth state, or data fixture, say so in preconditions. Do not bury these in step text.
- **Echo spec wording in titles.** If `SC-3` says "the dropdown filters to entries matching the search", a scenario title like `dropdown filters to entries matching the search` is grep-friendly and pinpoints which criterion regressed when it fails.
- **Reference a single source of truth in `Validates`.** Cite `SC-N` from `00_reqs.md` directly. If the criterion came from `01_spec.md` (because reqs were thin), prefix as `Validates: spec.SC-N` so the source is explicit.

---

## Scope reference

| Scope | Per manual criterion | Steps per scenario | Notes |
|---|---|---|---|
| `smoke` | 1 (golden path) | 1–3 | Minimum viable coverage. Use before quick PR sanity checks. |
| `happy` | 1 + key variations | 3–6 | Covers user-journey alternates and valid-input variations. |
| `full` | happy + error + edge + negative | unbounded | Default — the broadest pass. Also apt for high-stakes features, regressions in pre-release branches, or before production cutover. |

Default `full`. The same skill at the same scope on the same spec should produce a stable scenario count — variation in scenario wording is fine, but the count and the criterion mapping shouldn't drift.

---

## Phase 5: Index update + report

1. **Invoke `/wf:index` for the `qa` slot.** Pass a one-line summary: `06_qa.md · <scope> · <N> scenarios · <M>/<K> criteria mapped`. Substitute the scope, the count of `TC-NNN` scenarios, the count of criteria with coverage (manual or automated), and the total criteria count.

2. **Emit the final-output block** (next section) with the path, scope, scenario count, coverage stats, and any gaps.

---

## Edge Cases

- **Spec has no enumerated criteria.** Stop: "`00_reqs.md` has no testable success criteria. Update the spec with numbered criteria before generating QA scenarios." Don't invent criteria from the implementation.
- **Implementation isn't done yet.** Allowed. Mark scenarios that depend on unimplemented behavior with `[PENDING IMPLEMENTATION]` in the title and a `<!-- BLOCKED BY: <missing-behavior> -->` comment. The black-box rule means this still works — scenarios were derived from the spec, not the missing code.
- **All criteria are Build/static or Automated.** First make sure they really are — a criterion describing what an endpoint or service method *returns/filters/persists* is **API**, not Build/static, and the most common cause of a wrongly-empty plan is mis-binning backend behavior as "it compiles." Once that's checked: write `06_qa.md` with a populated coverage matrix and no spec-derived suites, plus a one-paragraph note: "All criteria are verified by build or existing automation. No spec-traced runnable scenarios required at scope `<scope>`." The **Baseline health suite is still emitted** (browser baseline if there's a route, API baseline if there's an endpoint/service) — so the plan is never empty of runnable scenarios. Valid output, not a stop condition.
- **Backend-only task (all behavior is `.cs`, no UI).** Not a stop condition and not a stub. Behavioral criteria classify as **API**; service-only ones get `Backend host required:`; the Baseline-health suite uses the API baseline. The plan is fully runnable by `/wf:qa-auto`.
- **`06_qa.md` already exists with annotated run results** (PASS/FAIL markers from a prior run). Stop and ask: "Existing `06_qa.md` has run annotations. Overwrite (loses results), append a new section, or rename the existing file as `06_qa.<timestamp>.md` first?" Default to renaming the prior file.
- **Multiple scenarios collapse onto the same criterion at scope `smoke`.** Smoke is one-per-criterion. If you find yourself writing two smoke scenarios for the same `SC-N`, pick the one with the highest priority and drop the other. The coverage matrix shows one `TC-NNN` per criterion at `smoke`.
- **Cross-feature dependencies.** If TC-005 requires TC-003 to have run successfully (e.g., "open the period created in TC-003"), state that as a precondition: `Depends on: TC-003 PASS`. Don't duplicate steps.
- **No diff against `main`.** The branch hasn't diverged yet. Allowed — generate scenarios from the spec alone. The implementation reads in Phase 2 step 4 simply yield no files; scenarios won't have implementation-grounded selectors and may use placeholder language. Note this at the top of `06_qa.md`: `**Implementation:** not yet on branch — selectors and route paths are best-effort from spec`.

---

## Final Output

```
QA-GEN — Complete

Task:      {wi-prefix}-{id}
Scope:     <smoke | happy | full>
Scenarios: <N> in <S> suites (incl. <b> Baseline health) — <br> browser · <api> API
Coverage:  <M>/<K> criteria mapped (<M-browser> browser · <M-api> API · <M-auto> automated · <M-static> build/static)

File:      {task-root}/{wi-prefix}-{id}/06_qa.md

Gaps:      <list of uncovered SC-N, or "none">

Next:      /wf:qa-auto {id}    — autonomous run, subagent drives the browser (default)
           /wf:qa-run {id}     — or drive it yourself, one step at a time
```

**The final output block must always be the very last thing output to chat.**
