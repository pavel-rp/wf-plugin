---
name: qa-gen
description: Generates a test plan for a task — classifies each spec success criterion by verification method (build/static, automated test, manual-browser, or API endpoint-exercise), then writes 06_qa.md with scoped, spec-traced scenarios. UI criteria become browser scenarios a human or agent runs in the running app; backend criteria become API scenarios that exercise the endpoint (or a temporarily-wired service) over HTTP with a real token. On top of that generic plan it fires the qa-generation phase, aggregating any scenarios contributed by whatever capabilities the project has registered — without naming or assuming any of them. Use when a task is implemented (or nearly so) and you want a QA pass tied to spec criteria before opening a PR or handing the plan to a run-assistant — including backend-only tasks that have no UI.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:qa-gen — Manual browser-test plan generator

Generates a structured manual test plan for a task. Reads `00_reqs.md` (source of truth), classifies each success criterion by how it can be verified, designs scenarios for the criteria that need a human in a browser, and writes `06_qa.md` in the task folder. Every spec-derived scenario traces back to a numbered spec criterion; untraceable spec scenarios don't ship. The one deliberate exception is the **Baseline health suite** — a small standing set of measurable checks (no console errors, no failed network requests, the view renders) that every plan carries regardless of scope or criteria. See Phase 3.5.

This skill produces **prose, not code**. The output is a plan a tester (human or agent) executes against the running app. Most scenarios are **browser** scenarios — clicks, typed values, observed UI changes, network calls visible in devtools. For a **backend** task (a controller endpoint, a service method, a repository method) it instead writes **API** scenarios that exercise the endpoint over HTTP with a real token and assert status + response shape; when the deliverable is a service with no endpoint yet, the scenario carries a `Backend host required:` precondition the runner satisfies by temporarily wiring the service to a controller (then reverting it). The full API-scenario rules live in [`references/api-scenarios.md`](references/api-scenarios.md). For automated unit tests, the project's registered stack test-authoring capabilities (a component/DI-level sandbox-host harness, a pure-helper unit runner, etc.) cover what this skill deliberately doesn't — core names none of them.

A backend-only task is therefore **never** a stub PASS: its behavioral criteria become runnable API scenarios, and its Baseline-health suite targets the primary endpoint instead of being marked N/A.

This skill is **capability-agnostic**. Its default is the generic spec-traced plan above. On top of that default it **fires the `qa-generation` phase**, aggregating any `scenario`s contributed by whatever capabilities the project has registered — without naming, requiring, or assuming any of them. With no capability registered, the generic plan stands alone. See Phase 3.6.

To run the plan, use the family's run-assistant skills:

- **`/wf:qa-run`** — interactive walkthrough. The skill is the test lead, the user is the tester, one step at a time.
- **`/wf:qa-auto`** — autonomous run. Drives the browser through each scenario, captures screenshots on FAIL, and writes the same report.

Both write `07_qa-report.md` in the format documented at [`references/report-format.md`](references/report-format.md). Stable `TC-NNN` IDs and `Validates: SC-N` lines on every scenario let the runners address scenarios individually and reconcile back to the spec.

---

## Prerequisites

Read `_local/config.md` for `{task-root}`. If absent, stop with: "Run `/wf:init` first." Also read `{qa-baseline-ignore}` if present (the allowlist of known-benign console messages / request patterns the Baseline health suite tolerates) — it's optional; treat an absent key as an empty list. Also read `{qa-rules}` if present (the path to the project QA-rules artifact written by `/wf:qa-init`, which supplies the severity rubric the report resolves — see [`references/report-format.md`](references/report-format.md)) — it's optional; treat an absent or `<none>` key as not set, and the report falls back to its built-in severity default.

`00_reqs.md` is the authoritative spec. `01_spec.md` is consulted only if reqs are too thin to derive testable criteria. **Never derive cases from the implementation** — see the black-box rule under Phase 3.

---

## Command Syntax

```
/wf:qa-gen [<id>] [scope]
```

Two optional positional arguments. Zero-arg invocation infers the task id from the current branch and uses scope `full`.

### Arguments

| Argument    | Required | Description                                                                                       |
| ----------- | -------- | ------------------------------------------------------------------------------------------------- |
| `<id>`      | NO       | Task id — whatever shape the active tracker capability produces (opaque to core), or a local `T<NNN>` id when no tracker is registered. Falls back to inferring from the current branch (first 3+-digit run). |
| `[scope]`   | NO       | `smoke`, `happy`, or `full` — see Scope Reference below. Default `full`.                         |

Argument-parser disambiguation: if a token contains a 3+-digit run, or exactly matches an existing task folder name under `{task-root}`, treat it as the id. Otherwise treat it as the scope. Unknown scope values stop with an error.

Examples:

- `/wf:qa-gen` — infer id from branch, scope `full` (default).
- `/wf:qa-gen 6396` — explicit id, scope `full`.
- `/wf:qa-gen happy` — infer id from branch, narrow to scope `happy`.
- `/wf:qa-gen 6396 smoke` — explicit id, scope `smoke`.

---

## Direct provider resolution (how `current-branch-query` is reached)

Id inference and the Phase 1 branch gate both reach `current-branch-query` by the canonical resolve-once procedure — `invocation-runtime.ops.md` §"Direct provider resolution" (one `## Capabilities` read from `_local/config.md`, the default-absent `registryPath` value, plus one manifest+fragment read for the `delivery` surface; a plugin-anchored `Path` resolves through the self-heal home, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"). With zero readable `delivery` rows, `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces. (qa-gen has no tracker-surface call site — it never fetches.)

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`).
- Read-only resolution via `current-branch-query` (direct provider resolution to the `delivery` surface) for id inference and branch gating. Diff-based changed-file inspection is a content-gathering read with no delivery operation of its own — described by outcome, never as a literal command.
- Invoke the **Task** tool for `wf:branch` (branch gate) and `/wf:index` (index update).
- Write `06_qa.md` ONLY inside the resolved task folder (`{task-root}/{task-id}/`).

**Forbidden:**

- Modify any source file, spec, plan, or other artifact. This skill is read-mostly — its only write is `06_qa.md` and the index row.
- Run builds, tests, installs, or any destructive version-control operation.
- Read implementation method bodies to derive scenarios. Public signatures (route paths, component selectors, button labels, exported names) are allowed when needed to make steps concrete; method bodies are not.
- Invent scenarios untraceable to a numbered spec criterion. If a criterion is missing, escalate — don't backfill.
- Write outside `_local/`.

---

## Phase 1: Resolve and gate

1. **Resolve `<id>`.** Resolve the task id per [`../_shared/pipeline-conventions.md`](../_shared/pipeline-conventions.md) §"Id inference from the current branch" (explicit `<id>` used verbatim; otherwise inferred from the branch via `current-branch-query` — direct provider resolution to the `delivery` surface, see "Direct provider resolution" above — and resolved against `{task-root}`), naming `/wf:qa-gen` in its stop messages. Once `{task-id}` is resolved, extract the first 3+-digit run from it — call it `{numeric-id}`; it is used **only** for the branch-gate match in step 4, never for the task folder or any operation.

2. **Locate the task folder.** Compute `{task-root}/{task-id}/`. If it doesn't exist, stop: "Task folder not found. Run `/wf:spec {task-id}` first."

3. **Verify `00_reqs.md` exists** in the task folder. If missing, stop: "No `00_reqs.md` for `{task-id}`. Run `/wf:spec {task-id}` first to fetch requirements."

4. **Branch gate.** Resolve delivery-surface ownership first — the scope-equality filter (`contribution-kind = provider` **and** `scope = delivery`) of direct provider resolution. **Zero matching rows (bare-core mode)** — the gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no error and no stop. Report "Branch gate skipped — no delivery provider registered (bare-core mode)." and continue to step 5. **One matching row** — resolve the current branch via `current-branch-query`; if it doesn't match `/{numeric-id}-` (the token defined in step 1), invoke the **Task** tool with `subagent_type: wf:branch`, passing the resolved id **and the forwarded `delivery` resolution record** resolved above (the optional spawn extension — `invocation-runtime.ops.md` §"Run-scoped provider forwarding"), so `wf:branch` consumes it instead of re-resolving. The subagent will create or switch to the task branch. If subagent invocation is unavailable, skip the gate instead of blocking: report "Branch gate skipped — Task tool unavailable to invoke wf:branch (proceeding on the current branch)." and continue to step 5.

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

4. **Inspect what changed.** Inspect the set of files changed on this branch relative to the base branch — a read-only content-gathering read with no delivery operation of its own, described here by outcome, never as a literal command. For each file, do a *signature-only* read (component selectors, route paths, public method names, template button labels) so scenarios can name real UI elements. **Stop reading at the first method body.** This is the same black-box rule the stack's page-test authoring enforces.

   For each new UI component in the diff, also check whether it is reachable by a route in the running app (grep the project's routing configuration for the component's selector / kebab-name). If it is not routed and no test-host for it exists either, the target is **host-missing** — record this so Phase 3 can emit a `Host required: <component-path>` precondition on scenarios that interact with it. `/wf:qa-auto` resolves the registered `qa-execution` host provider to scaffold a routed test-host on demand.

   **Backend surfaces.** Apply the same signature-only read to backend source files in the diff — controllers, services, repositories, and the DTOs they return — following [`references/api-scenarios.md` § Backend-diff signals](references/api-scenarios.md#backend-diff-signals-phase-2). For each new/changed controller action, record its verb + route + params + return type (an **endpoint** surface). For each new/changed public method on a service/repository with no controller action calling it, record it as a **service-only** surface so Phase 3 can emit a `Backend host required: <Service>.<method>` precondition. A diff that is entirely backend data-layer files with no UI target is a **backend-only** task — its behavioral criteria classify as **API** in Phase 3.

5. **Catalog existing automated coverage.** Look under:
   - `_local/{task-id}/tests/` — a registered unit-test harness's output (e.g. a pure-helper Node runner).
   - The project's page-test location — a registered page-test harness's output (filename hints carry the suite name; the file may be excluded from version control but local).
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
| **Automated test** | Existing unit/integration test asserts the criterion directly | Matches an assertion you found in Phase 2 step 5 (incl. a page-test harness's backend-smoke test) | Listed in coverage matrix with the test file path. No manual scenario. |
| **Manual-browser** | Human or agent observes runtime behavior in the running app | "clicking Save shows a green toast", "dropdown filters list to entries matching the search" | One or more browser scenarios depending on scope. |
| **API** | The behavior of an endpoint or service method, called over HTTP with a real token | "endpoint returns the widgets for the access level", "repository filters out inactive rows", "POST creates the record and returns 201", "service returns an empty list when none match" | One or more API scenarios. Service-only methods get a `Backend host required:` precondition. See [`references/api-scenarios.md`](references/api-scenarios.md). |

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

**Backend-only tasks: emit the API baseline instead.** When the task affects no reachable UI route but *does* add or change a callable endpoint/service (the backend-only case from Phase 2), do **not** mark the baseline `[N/A: no runnable UI]`. Emit the single **API baseline** scenario from [`references/api-scenarios.md` § API baseline health](references/api-scenarios.md#api-baseline-health) — the primary endpoint responds without a 5xx and accepts the token — and skip the three browser baseline scenarios below. Only fall back to a lone `[N/A: no runnable surface]` scenario when the task has neither a route nor any callable endpoint/service (pure type/config/helper work).

**Scenarios to emit (browser target):**

1. **`<target>` loads clean** — *always, every scope.* Priority **P1**. Navigate to the target route with the console and network panels cleared, then assert three things as separate steps: the primary content renders (no white screen / error page), the console logged no error-level entries during load, and no request failed or returned 4xx/5xx during load. Each assertion excludes anything matching `{qa-baseline-ignore}` and the expected auth/redirect calls.
2. **Console & network clean across the full run** — *always, every scope.* Priority **P1**. Evaluated **after all other scenarios complete**: inspect every error-level console entry and every failed/4xx-5xx request that occurred *at any point during the session* — across all scenarios, not just one route — excluding `{qa-baseline-ignore}` and the expected auth/redirect calls. This is the catch-all for errors no individual step asserted against, and for leaks that surface only after the app has been driven for a while. The runners evaluate it last, from signals accumulated across the whole session, and attribute each finding to the scenario that was active when it fired.
3. **`<target>` renders without visual defects** — *always, every scope, browser target only.* Priority **P1**. Carries the `**Visual:** yes` marker (see "The `**Visual:** yes` marker" below). Worded e.g. "`<target route>` renders without visual defects — no overlapping, clipped/truncated, or crowded/'stuck-together' controls; every control renders correctly (nothing orphaned, collapsed, or oversized)." A single browser scenario with a minimal one-row steps table (see the `TC-NNN: renders without visual defects` template below): navigate to `<target route>`, then assert the rendered layout is free of the absolute visual defects listed. It carries `Validates: — (baseline health)` like the other two. The runner that owns the visual treatment (the execution engine) acts on the marker; `qa-gen` only writes it and does not know how the engine acts on it. **Skip this scenario entirely under the API-baseline / no-runnable-surface branches** — it is browser-only. **Scope boundary:** this asserts *absolute* visual-defect detection only (overlap, clipping/truncation, crowding, orphaned/mis-rendered controls, collapsed/oversized containers) — **not** visual-regression / golden-image pixel-diffing, which is out of scope.

Number them in sequence after the spec scenarios (Baseline health is the last suite). Don't invent extra baseline scenarios beyond these three — keep the standing bar small and stable. If the task has no reachable route but has a callable endpoint/service, emit the **API baseline** scenario described above instead of these three (the visual-baseline is browser-only and is skipped). Only when the task has *no runnable surface of any kind* (pure library/helper work — no route, no endpoint, no service) emit the suite with a single scenario marked `[N/A: no runnable surface on this task]` and explain in one line, rather than omitting it.

**The `**Visual:** yes` marker (generation contract).** A scenario may carry a `**Visual:** yes` marker line (alongside `**Priority:**`, and — for API scenarios — `**Type:** API`). The marker is a **generation-contract term**: a scenario carrying it receives the **visual treatment** at execution (a screenshot + geometry probes + a holistic vision review on the pass path, and a `**Visual:**` evidence sub-block in the report even on PASS — see [`references/report-format.md`](references/report-format.md)); a scenario **without** it stays **DOM-only**, exactly as scenarios behave today (no screenshot on a passing path, one-line PASS). `qa-gen` **writes** the marker on the standing visual-baseline scenario above (and may add it to any spec-traced browser scenario whose criterion is inherently about rendered appearance); it does **not** know how the engine acts on it — the marker is the contract boundary. Keep the term written exactly as `**Visual:** yes` so the execution engine and the report format key off it consistently. **Scope boundary:** the marker requests *absolute* visual-defect detection only — never visual-regression / golden-image pixel-diffing.

---

## Phase 3.6: Fire the `qa-generation` phase (aggregate capability scenarios)

After generating the generic spec-traced suites and the Baseline-health suite, fire the
**`qa-generation`** phase and aggregate any **`scenario`** contributions the registered
capabilities attach to it. This phase runs *after* Baseline health, but the suites it
produces are **placed before** Baseline health — which always stays the last suite.

Follow the generalised phase-firing procedure verbatim — `invocation-runtime.ops.md`
§"The moving parts" (registry iteration → per-capability manifest read → per-phase
fragment collection → per-fragment dispatch → aggregation), referencing it by
**phase name / contribution-kind name**, never by heading — with these `qa-generation`
parameters:

- **Firing phase:** `qa-generation`. **Contribution kind collected:** `scenario`.
- **Generic shape produced:** each contributed scenario in the same `TC-NNN` /
  `Validates:` contract as Phase 3, numbered in the **global** sequence.
- **Aggregation:** `scenario` aggregates **provenance-tagged** — render every
  contributor's scenarios in their own suite, each tagged with its **source capability**
  (the registry row's name); registry order is cosmetic. Place the aggregated capability
  suites **after** the spec suites and **before** Baseline health.

**No-op** is the ops doc's generalised `<none>` path (§"No-op path"): if the registry is
empty or absent, a manifest is missing, no fragment matches `qa-generation` under the
`scenario` kind, a dispatched fragment returns an empty list, or a `dispatch` is
malformed, that contributor — or the whole phase — produces **nothing** and the generic
plan stands alone (no capability-scenarios section, no capability/stack/domain term
surfaced, no broken subagent reference, no STOP). An aggregated scenario rolls up into the
plan and the coverage matrix on the same footing as a spec-traced scenario, carrying its
provenance tag.

Write to `{task-root}/{task-id}/06_qa.md`. Overwrite if it exists — the task folder is excluded from version control, so there's no history to fall back on. Warn the user if the file already exists and contains scenarios with run results recorded.

Emit the `06_qa.md` output template at [`references/qa-template.md`](references/qa-template.md) verbatim. Substitute placeholders. Don't invent extra sections.

---

## Template: `06_qa.md`

The verbatim output template — the coverage-matrix, browser-scenario, API-scenario, capability-scenario, and Baseline-health shapes the run-assistants parse — lives at [`references/qa-template.md`](references/qa-template.md). It is read only on this write path, so it stays out of the boot body. Read it, then emit it with placeholders substituted.

---

## Writing rules

These rules apply when authoring scenarios — they're the difference between a plan a tester can run cold and a plan that punts back to the spec.

- **Steps are concrete instructions.** Not "verify the feature works" but `Click **Save** with the form filled out as in step 2.` A tester unfamiliar with the project should be able to follow them without reading `00_reqs.md`.
- **Expected results are observable.** Not "the system processes correctly" but "A green toast appears with text `Widget created` and the URL changes to `/widgets/123`." Cite specific selectors, labels, URLs, and toast text from the implementation reads in Phase 2.
- **Preconditions are actionable.** Not "the system is in the right state" but "Logged in as `admin@example.com`. Navigate to `/widgets/42`."
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

1. **Invoke `/wf:index` for the `qa` slot.** Pass a one-line summary: `06_qa.md · <scope> · <N> scenarios · <M>/<K> criteria mapped`. Substitute the scope, the count of `TC-NNN` scenarios, the count of criteria with coverage (manual or automated), and the total criteria count. When one or more capabilities contributed scenarios, append ` · <P> capability` with the aggregated capability-scenario count.

2. **Emit the final-output block** (next section) with the path, scope, scenario count, coverage stats, and any gaps.

---

## Edge Cases

- **Spec has no enumerated criteria.** Stop: "`00_reqs.md` has no testable success criteria. Update the spec with numbered criteria before generating QA scenarios." Don't invent criteria from the implementation.
- **Implementation isn't done yet.** Allowed. Mark scenarios that depend on unimplemented behavior with `[PENDING IMPLEMENTATION]` in the title and a `<!-- BLOCKED BY: <missing-behavior> -->` comment. The black-box rule means this still works — scenarios were derived from the spec, not the missing code.
- **All criteria are Build/static or Automated.** First make sure they really are — a criterion describing what an endpoint or service method *returns/filters/persists* is **API**, not Build/static, and the most common cause of a wrongly-empty plan is mis-binning backend behavior as "it compiles." Once that's checked: write `06_qa.md` with a populated coverage matrix and no spec-derived suites, plus a one-paragraph note: "All criteria are verified by build or existing automation. No spec-traced runnable scenarios required at scope `<scope>`." The **Baseline health suite is still emitted** (browser baseline if there's a route, API baseline if there's an endpoint/service) — so the plan is never empty of runnable scenarios. Valid output, not a stop condition.
- **Backend-only task (all behavior in backend source, no UI).** Not a stop condition and not a stub. Behavioral criteria classify as **API**; service-only ones get `Backend host required:`; the Baseline-health suite uses the API baseline. The plan is fully runnable by `/wf:qa-auto`.
- **A registered capability contributes scenarios.** Detected by firing the `qa-generation` phase in Phase 3.6. In addition to the normal spec-traced suites, the aggregated capability scenarios are rendered in their own provenance-tagged suite(s) after the spec suites and before Baseline health. Not a stop condition — capability scenarios are additive. With no capability registered (or none contributing at `qa-generation`), the generic plan stands alone and no capability term surfaces.
- **`06_qa.md` already exists with annotated run results** (PASS/FAIL markers from a prior run). Stop and ask: "Existing `06_qa.md` has run annotations. Overwrite (loses results), append a new section, or rename the existing file as `06_qa.<timestamp>.md` first?" Default to renaming the prior file.
- **Multiple scenarios collapse onto the same criterion at scope `smoke`.** Smoke is one-per-criterion. If you find yourself writing two smoke scenarios for the same `SC-N`, pick the one with the highest priority and drop the other. The coverage matrix shows one `TC-NNN` per criterion at `smoke`.
- **Cross-feature dependencies.** If TC-005 requires TC-003 to have run successfully (e.g., "open the widget created in TC-003"), state that as a precondition: `Depends on: TC-003 PASS`. Don't duplicate steps.
- **No diff against `main`.** The branch hasn't diverged yet. Allowed — generate scenarios from the spec alone. The implementation reads in Phase 2 step 4 simply yield no files; scenarios won't have implementation-grounded selectors and may use placeholder language. Note this at the top of `06_qa.md`: `**Implementation:** not yet on branch — selectors and route paths are best-effort from spec`.

---

## Final Output

```
QA-GEN — Complete

Task:      {task-id}
Scope:     <smoke | happy | full>
Capability scenarios: <none | <N> across <M> capabilities>
Scenarios: <N> in <S> suites (incl. <b> Baseline health<, <c> capability scenarios if any>) — <br> browser · <api> API · <cap> capability
Coverage:  <M>/<K> criteria mapped (<M-browser> browser · <M-api> API · <M-auto> automated · <M-static> build/static)

File:      {task-root}/{task-id}/06_qa.md

Gaps:      <list of uncovered SC-N, or "none">

Next:      /wf:qa-auto {task-id}    — autonomous run, subagent drives the browser (default)
           /wf:qa-run {task-id}     — or drive it yourself, one step at a time

```

**The final output block must always be the very last thing output to chat.**
