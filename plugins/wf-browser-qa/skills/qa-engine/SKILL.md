---
name: qa-engine
description: Stack-agnostic browser-automation QA engine. Drives a web app in-thread — preflights browser tools, authenticates once, reaches each scenario's browser-level preconditions (clears/seeds localStorage, sessionStorage, cookies; sets URL/viewport), runs the steps with observation discipline, captures console/network signals, screenshots on FAIL, and emits per-scenario verdict blocks in the shared QA report format. The execution provider behind the browser-qa capability's qa-execution provider fragment. Use when a QA orchestrator dispatches the per-scenario browser drive, or to drive scenarios directly against a running app of any stack.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf-browser-qa:qa-engine — Stack-agnostic browser-automation QA engine

The browser-driving **execution surface** for QA. It loads the browser-automation tools, authenticates once against the running app, then drives each scenario's steps, recording a verdict per scenario in the shared report format. It is **stack-agnostic** — it names no framework, database tool, or host-scaffolding wiring; it works against any web UI (React, jQuery, plain HTML, anything a browser can drive).

This skill is the dispatch target of the **browser-qa** capability's `qa-execution | provider | surface: engine` fragment. A core orchestrator (today `wf:qa-auto`) owns the run lifecycle — task/plan resolution, resume/batch, report rollup — and dispatches the per-scenario drive here via the **Task** tool (`subagent_type: wf-browser-qa:qa-engine`). The engine drives the browser in an isolated context so the orchestrator's context stays small. It can also be invoked directly (`/wf-browser-qa:qa-engine`) to drive scenarios against a running app.

The engine **reaches preconditions, not just observes them**. If a scenario asserts "cleared localStorage" or "fresh session", the engine clears the browser storage to that state and runs the test. Selective writes (a seeded key, a single removed key) are reverted before moving on; a full storage clear becomes the new baseline rather than being reverted. Recipes per precondition shape live at `references/preconditions.md`, obtained via the resolver's `resolve_content` (`class: references-template`, `plugin: wf-browser-qa`, `skill: qa-engine`, `ref: preconditions.md`), never a raw `Read` of the plugin-cache path. Default disposition: reach the state and run; mark BLOCKED only when a precondition genuinely cannot be reached (e.g., network throttling, which the browser-automation tools don't expose). The engine reaches **browser-level** state only — storage, URL, viewport. Anything that needs a database or backend-host write is out of this engine's scope (a separate stack capability owns those).

---

## Why this engine drives in-thread (instead of via per-scenario subagents)

The architecturally clean version would loop scenarios spawning a per-scenario sub-subagent — browser snapshots stay isolated, parent context stays small. But the browser-automation tools may not be available from inside a nested subagent, so the per-scenario isolation can't be relied on for the browser drive.

So this engine drives the browser in its own thread (already isolated from the orchestrator), with **observation discipline** as the mitigation:

- Every `read_page` result is summarized to one line of observed value before the loop continues. Don't refer back to prior page dumps.
- For compound assertions (filter applied, list re-ordered, multi-element check), use `run_playwright_code` returning a small JSON object — not `read_page` returning the full DOM.
- Screenshots only on FAIL. Saved to `artifacts/qa-run-TC-NNN-<UTC>.png`. **One documented exception:** a scenario the plan marked `**Visual:** yes` takes a screenshot **on the pass path** for its Layer B vision review — see [Phase 5v](#5v-visual-verification-sub-phase-visual-yes-scenarios-only). The agent views that screenshot to score the rubric, then discards it from working memory (keeps only the one-line rubric verdict + the saved path); it does not become a page dump the loop refers back to. This exception is narrow — it applies **only** to `**Visual:** yes` scenarios; every unmarked scenario keeps "screenshots only on FAIL" exactly.
- After every batch (default 25 scenarios), checkpoint the report and stop. Re-invoke for the next batch.

---

## Input / output contract

**Input** (from the orchestrator's Task prompt, or from direct invocation):

- **Scenario set** — one scenario, a batch, or "the whole plan". Empty input = drive every scenario in the resolved task folder's QA plan (`06_qa.md`).
- **Task / report context** — the task id (or the branch to infer it from) and the task-folder path, so the engine locates `06_qa.md` and the `07_qa-report.md` it appends to.
- **Credentials** — read from `_local/qa-creds.md`; on first run the engine prompts and saves them.

**Output** — per-scenario **verdict blocks** in the shared report format (`references/output-format.md`, obtained via the resolver's `resolve_content` — `class: references-template`, `plugin: wf-browser-qa`, `skill: qa-engine`, `ref: output-format.md` — never a raw `Read` of the plugin-cache path), appended into `07_qa-report.md` incrementally, plus the `QA-ENGINE — <status>` final block. The engine does **not** own the run-level report header / Summary / traceability rollup — that is the orchestrator's job; the engine supplies the per-scenario results the orchestrator merges. (On direct invocation with empty input, the engine writes a complete report itself.)

---

## Command Syntax

```
/wf-browser-qa:qa-engine [<task-id>] [--suite <suite-name>] [--reset-creds] [--batch <N>] [--resume] [--only <TC-list>]
```

### Arguments

| Argument           | Required | Description                                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `<task-id>`        | NO       | Task id. Falls back to inferring from the current branch (first 3+-digit run), resolved via the delivery contract's `current-branch-query` — see "Direct provider resolution" below. |
| `--suite <name>`   | NO       | Run only one named suite from `06_qa.md`.                                                         |
| `--reset-creds`    | NO       | Re-prompt for app URL / username / password / default entity. Overwrites `_local/qa-creds.md`.    |
| `--batch <N>`      | NO       | Stop after N scenarios for a context reset. Default 25. Pair with `--resume` to continue.          |
| `--resume`         | NO       | Resume from the first un-verdicted scenario in an existing `07_qa-report.md`.                     |
| `--only <TC-list>` | NO       | Re-execute exactly the listed scenarios (comma-separated `TC-NNN`) regardless of current verdict, overwriting just their results in an existing `07_qa-report.md` and leaving every other scenario untouched. Requires an existing report. |

Disambiguation: a 3+-digit numeric or prefixed token is the id; `--`-prefixed tokens are flags. The token after `--only` is its comma-separated scenario list, not the id.

---

## Direct provider resolution (how `current-branch-query` is reached)

Branch-based id inference (Phase 1) reaches `current-branch-query` through the delivery contract — never a direct `git` call, so the engine still degrades cleanly in git-free bare-core mode. Resolve the surface by calling the bundled `wf-resolver` MCP tool `resolve_provider("delivery")` — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); the engine performs no registry / manifest / plugin-root read of its own. Follow the returned `fragmentPath` in its own context to dispatch `current-branch-query`. On `state: unconfigured` or `unrecoverable` (no readable `delivery` provider), `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces, and id inference simply yields no branch token (Phase 1 then asks for an explicit `<task-id>`). If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery). The engine has no tracker-surface call site — it never fetches.

---

## Safety Rules

**Allowed:**

- Read any file in the project.
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider("delivery")` query — see above) for branch-based id inference. Never call `git` directly for it, and never hand-parse the `## Capabilities` registry or a manifest — every such fact comes from the typed tool call.
- Read/write `_local/qa-creds.md` (test-only credentials — see Phase 2).
- Write `07_qa-report.md` and screenshots under `artifacts/qa-run-*` ONLY inside the resolved task folder.
- Use the IDE's question tool to prompt for creds on first run.
- Use the browser-automation tools (`open_browser_page`, `click_element`, `type_in_page`, `read_page`, `screenshot_page`, `run_playwright_code`, `navigate_page`, `hover_element`, `drag_element`, `handle_dialog`).
- **Manipulate browser storage** via `run_playwright_code` to satisfy preconditions: `localStorage`, `sessionStorage`, cookies for the test app's origin only.
- Invoke the **Task** tool with `subagent_type: wf:index` after a report is written (direct-invocation mode).

**Forbidden:**

- Modify source, spec, plan, or QA-plan files. The plan is read-only.
- Write any database or backend state — this engine reaches **browser-level** preconditions only. A scenario that needs a database/backend-host write is out of scope; mark it `BLOCKED · setup: requires non-browser state (out of engine scope)`.
- Store production credentials. The user has stated test creds are non-sensitive; the file format reflects that.
- Run builds, tests, installs, or destructive git.
- Read application source to "understand" the implementation when a step or assertion fails. Black-box discipline: a failing scenario is a FAIL.
- Retain page snapshots in working memory across steps. After observing each step, summarize to one line and move on; never refer back to a prior `read_page` dump. (The one narrow exception is the pass-path screenshot a `**Visual:** yes` scenario takes for its Layer B rubric review — the agent views it to score the rubric, records the one-line verdict + saved path, and discards the image; see Phase 5v.)

---

## Phase 1: Resolve task and plan

1. Resolve `<task-id>`. If passed explicitly, use it verbatim. If omitted, resolve the current branch via `current-branch-query` (the `wf-resolver` `resolve_provider("delivery")` query — see "Direct provider resolution" above) and extract the first 3+-digit run. With no delivery provider the query falls back silently (plain-directory case) and yields no branch token. If no id can be resolved, stop with the standard message asking for an explicit `<task-id>`.
2. Locate `06_qa.md` in the task folder. Stop if missing.
3. Parse it: scope, suites, scenarios (TC-NNN with priority, validates, preconditions, steps, teardown). Filter by `--suite` if passed. When the caller handed an explicit scenario set, that set is the loop set.
4. **Resume / targeted re-run handling.**
   - **`--only <TC-list>`** — parse the comma-separated `TC-NNN` list; the loop set is exactly those scenarios, re-executed regardless of current verdict. Requires an existing `07_qa-report.md` — if absent, stop: "No `07_qa-report.md` to update with `--only`. Run a full pass first." Validate every listed `TC-NNN` exists in `06_qa.md`; if any don't, stop and list the valid ids. `--only` takes precedence over `--resume`.
   - **`--resume`** — parse `07_qa-report.md` for verdicts already recorded. Start at the first un-verdicted scenario. If `07_qa-report.md` doesn't exist, stop: "No `07_qa-report.md` to resume."
   - **Neither** — if an annotated report exists (direct-invocation mode), ask: rename to `07_qa-report.<UTC-timestamp>.md` (default), overwrite, or abort?
5. **Compare plan-vs-resume.** When resuming, compare the TC-NNN headings in `06_qa.md` with what the partial report references. If the plan changed mid-run, stop: "Plan changed since the run began. Start a fresh run."

---

## Phase 2: Credentials

1. Look for `_local/qa-creds.md`. If missing OR `--reset-creds` was passed, prompt the tester via the IDE question tool for:
   - **App base URL** (e.g., `https://localhost:8080`)
   - **Username** (test account)
   - **Password** (test account — non-sensitive; if the tester is uncomfortable typing creds in chat, abort and switch to a manual walkthrough)
   - **Default entity** name (or empty for "first available" — for apps that prompt to pick a workspace/org/account after login; leave empty for apps with no such selector)

2. Write `_local/qa-creds.md` in this format:

   ```markdown
   # QA Test Credentials

   Non-sensitive test credentials for the browser-qa engine. Never store production passwords here.

   - **App base URL:** <url>
   - **Username:** <user>
   - **Password:** <pass>
   - **Default entity:** <name or empty>
   ```

3. Confirm to the tester (mask the password as `••••••<last 2 chars>`):

   ```
   Saved test creds:
     App base URL:    <url>
     Username:        <user>
     Password:        ••••••<last 2>
     Default entity:  <name or "first available">

   File: _local/qa-creds.md (gitignored under _local/)

   Reply continue to start the run, or abort to stop now.
   ```

   Anything other than continue stops the engine. Never echo the full password back to chat after this confirmation.

`_local/` is gitignored, so `qa-creds.md` never reaches a commit.

---

## Phase 3: Browser-tool preflight

1. Confirm the browser-automation tools (`open_browser_page`, `click_element`, `type_in_page`, `read_page`, `screenshot_page`, `run_playwright_code`, `navigate_page`, `hover_element`, `drag_element`, `handle_dialog`) are available.
2. If any tool is unavailable, stop with: "Browser tools unavailable in this runtime. Use a manual walkthrough instead."
3. Call `open_browser_page(<base URL from creds>)`.
4. Call `read_page` once. If the response is a network error or the document is empty, stop: "App not reachable at `<URL>`. Make sure the dev server is running, then re-run."

Summarize the page title to one line. Don't retain the full DOM.

---

## Phase 4: Authentication and entity

Idempotent — at the start of the run, drive auth + entity once. The browser tab is persistent for the rest of the conversation, so subsequent scenarios start with the app already in its main authenticated state.

1. From the preflight `read_page`, detect the current state:
   - **Login form** → drive login (step 2).
   - **Entity selector** (a post-login picker for a workspace/org/account, when the app has one) → pick entity (step 3).
   - **Main app view** → already authenticated (e.g., a session from a prior run is still valid). Skip to Phase 5.

2. **Drive login.**
   - Identify username and password fields. Prefer `read_page`'s accessibility tree (look for inputs labeled `email`, `username`, `password` via `aria-label`, `placeholder`, or `name`). Fall back to `run_playwright_code` for selector inspection if the accessibility tree is sparse.
   - `type_in_page` with the credentials from the creds file.
   - `click_element` on the submit button.
   - `read_page` once after submit. If still on the login form, retry once. If a second submission still fails, stop with: "Auth failed. Check `_local/qa-creds.md` and re-run with `--reset-creds` if creds are wrong." Screenshot the failure to `artifacts/qa-run-auth-fail-<UTC>.png` first.

3. **Pick an entity** if an entity selector appears.
   - If creds' `Default entity` matches a listed entity (case-insensitive substring), click it.
   - Otherwise click the first listed entity. Record the substitution as a top-of-report Note: `entity hint "<hint>" not found, used "<actual>"`.
   - `read_page` once to confirm transition to the main app view. Summarize and discard.

After this phase, you are at the app's main authenticated view. Subsequent scenarios start here.

---

## Phase 5: Loop scenarios

Order: P0 → P1 → P2; within a tier, file order. Apply `--batch N` ceiling.

When `--only` is set, the loop set is exactly the listed scenarios (in report order) and each re-executes regardless of its prior verdict. Every incremental save and the Phase 6 assembly **merge** into the existing report: replace just the listed scenarios' blocks, preserve every other scenario's recorded verdict verbatim, then recompute the Summary, traceability, and Status from the full merged set.

For each scenario, drive the steps following the procedure below. After each scenario, append the verdict block to a buffer and flush to `07_qa-report.md` every 3 scenarios (incremental save).

**Before the loop — start session-wide capture.** Register the console/network listeners once (see [5a-measure](#5a-measure-measurable-assertions-console--network)) so they accumulate across *every* scenario in the session, each entry tagged with the TC that's active when it fires. Per-scenario baseline checks read the slice added since that scenario began; the full-run baseline check (Phase 6) reads the entire accumulated buffer. Keep a "current TC" marker updated as you enter each scenario so findings can be attributed. Skip the full-run baseline TC during the loop — it is evaluated post-loop in Phase 6, not driven step-by-step here.

### 5a. Per-scenario procedure

For TC-NNN:

1. **Apply preconditions** following the lifecycle in `references/preconditions.md` (same `resolve_content` reference as above):
   - Classify each precondition (auth / URL / storage / environment).
   - For storage preconditions, follow the recipe to reach the asserted state. Capture-before-modify so the change can be reverted.
   - A precondition that needs database/backend state this engine can't reach → mark scenario `BLOCKED · setup: requires non-browser state (out of engine scope)` and skip steps.
   - If setup fails (e.g., production-URL guard tripped), mark scenario `BLOCKED · setup: <one-line reason>` and skip steps. Run partial teardown for any setup that did succeed.
   - Track every fixture write (browser storage changes) so it can be reversed in step 4.

2. **Run each step in order.** For step `K` of `M`:
   - Read step's `Action` text. Translate to a tool call:
     - "Click the **Save** button" → identify via accessibility tree, then `click_element`.
     - "Type `<value>` into the **Field Name** field" → `type_in_page`.
     - "Navigate to `/route`" → `navigate_page`.
     - "Hover over the icon" → `hover_element`.
     - "Verify the dropdown is filtered to entries matching `foo`" or other compound checks → `run_playwright_code` returning a small JSON like `{ "count": 3, "first": "foo bar", "all_match": true }`.
   - Capture the observed result. Prefer `run_playwright_code` for assertions; use `read_page` only when you need the visible text and accessibility tree, and immediately summarize.
   - Compare observed vs. `Expected`:
     - **Matches** → `step K PASS` with a one-line observed summary.
     - **Doesn't match** → record `step K FAIL` with the divergence. `screenshot_page` to `artifacts/qa-run-TC-NNN-<UTC>.png`. **Stop running further steps** in this scenario.

   - **After the steps run, before teardown:** if the scenario's `06_qa.md` block carries a `**Visual:** yes` marker line, run the **visual-verification sub-phase** ([5v](#5v-visual-verification-sub-phase-visual-yes-scenarios-only)) now. A scenario **without** the marker skips 5v entirely — it follows the existing DOM-only flow (no screenshot, no geometry probe). The sub-phase can turn a step-PASS scenario into a FAIL (a hard-fail geometry probe or a rubric failure); fold its verdict into the scenario verdict before recording.

3. **Scenario teardown** if specified in `06_qa.md`. Execute. Don't gate the verdict — note teardown failures under `Notes:`.

4. **Fixture teardown.** Reverse every browser-storage fixture write from step 1, in reverse order. Validate each revert by re-reading the storage. On a teardown failure, retry once; if still failing, surface a `⚠ teardown failed` note in the report. Continue with remaining teardowns. The scenario's verdict stands; the run's overall `Status` flips to `INCOMPLETE` if any teardown failed (the browser state isn't in a known baseline).

5. **Mid-run session expiry.** If `read_page` after a navigation reveals the login form mid-scenario, re-run the auth steps from Phase 4 in-line, then resume the scenario. If re-auth fails, mark scenario `BLOCKED · session expired and re-auth failed` and continue the loop.

### 5a-measure. Measurable assertions (console / network)

Baseline-health steps — and any step whose Expected references the browser console or network — assert runtime signals the DOM doesn't surface. Capture them at the Playwright layer:

1. **Register capture once, session-wide** (start of Phase 5, before the loop). Prefer the page-API form via `run_playwright_code`: `page.on('console', m => { if (m.type() === 'error') errors.push({ tc: currentTc, text: m.text() }) })`, `page.on('requestfailed', r => failed.push({ tc: currentTc, why: 'failed ' + r.url() }))`, `page.on('response', r => { if (r.status() >= 400) failed.push({ tc: currentTc, why: r.status() + ' ' + r.url() }) })`. These are page-level and survive in-page navigation, so one registration covers the whole session; each entry is tagged with the active TC. If the runtime's `run_playwright_code` exposes only the in-page `evaluate` context (no `page` object), fall back: inject an init script that patches `console.error` and wraps `fetch`/`XMLHttpRequest` to push into `window.__qaErrors` / `window.__qaNet` — but this resets on navigation, so it can only feed *per-scenario* checks, not the session-wide full-run check (note that limitation in the report).
2. **Read at the assertion step.** For a **per-scenario** baseline step, read only the slice added since that scenario began (snapshot the buffer length at scenario start). For the **full-run** check (Phase 6), read the entire buffer. Return a small JSON object: `{ errors: [...], failed: [...] }` — don't dump the whole console.
3. **Filter the baseline-ignore allowlist.** Drop any console text or request URL/status matching a listed substring or `/regex/` from `{qa-baseline-ignore}` (when the orchestrator passes one; treat absent as empty). Also drop the expected auth/redirect requests the login flow itself makes (3xx, the auth POST).
4. **Verdict:** after filtering, non-empty `errors` or `failed` → `FAIL`, with the offending entries (each truncated to ~120 chars, prefixed with their `tc` for the full-run check) as the observed value; surface them in the report's Defects/Notes. Empty → `PASS`.
5. **If neither capture path works in this runtime** → mark the affected scenario `BLOCKED · setup: console/network capture unavailable`. Never report a baseline PASS you couldn't actually measure.

### 5v. Visual-verification sub-phase (`**Visual:** yes` scenarios only)

Runs **only** for a scenario whose `06_qa.md` block carries a `**Visual:** yes` marker line, after its steps have run and before teardown. A scenario without the marker never enters this sub-phase — the marker gate is real. This sub-phase is the capability-only half of the visual-verification feature; core (`qa-gen`) writes the marker but does not know how the engine acts on it.

**Scope boundary:** this detects **absolute** visual defects only — overlap, clipping/truncation, crowding/"stuck-together" controls, orphaned or mis-rendered controls, collapsed/oversized containers. It is **not** visual-regression / golden-image pixel-diffing (no baseline image, no per-pixel comparison) — that is explicitly out of scope. Use only generic browser APIs (`getBoundingClientRect`, computed styles, `screenshot_page`, `run_playwright_code`); name no framework, component library, or app route.

The two-layer procedure — **Layer A** deterministic geometry probes (the probe table + hard-fail/advisory verdict authority), **Layer B** the pass-path screenshot + fixed vision rubric, and the exact verdict-wiring (a hard-fail probe or rubric failure FAILs the scenario; otherwise the `**Visual:**` PASS sub-block) — lives at `references/visual-verification.md`, obtained via the resolver's `resolve_content` (`class: references-template`, `plugin: wf-browser-qa`, `skill: qa-engine`, `ref: visual-verification.md`), never a raw `Read` of the plugin-cache path. It is read **on-demand**, only when the engine reaches a `**Visual:** yes` scenario, so it stays out of the boot body for every non-visual run. Follow it now, then fold its verdict into the scenario verdict before recording.

### 5b. Verdict block per scenario

Record one block per scenario in `07_qa-report.md` under the appropriate suite section, in the per-suite-results format from `references/output-format.md` (same `resolve_content` reference as above):

- PASS → one-line `All steps passed.` (with optional one-line note). **For a `**Visual:** yes` scenario, also attach the `**Visual:**` PASS-path sub-block** (screenshot path + geometry-findings table/`none` + vision-review verdict) beneath the one-line PASS — the documented exception to one-line-PASS defined in the report format.
- FAIL → full step table, observed values, screenshot path, failure notes. A visual FAIL names the offending Layer A hard-fail probe or Layer B rubric criterion.
- BLOCKED → block point + reason.

Always include a `Fixtures:` line summarizing what was set up and reverted (`none`, `precondition already met`, `cleared browser storage; re-authenticated`). Format details in `references/preconditions.md` § Recording fixtures in the report (same `resolve_content` reference as above).

### 5c. Batch ceiling

After `--batch N` scenarios complete, OR if you sense context filling (e.g., the transcript is heavy with prior screenshots / DOM summaries), stop the loop. Write the partial report with `Status: INCOMPLETE` and remaining scenarios as `Not run`. Tell the caller:

```
Reached batch ceiling at TC-NNN. <K> scenarios complete, <M> remaining.
Resume with: --resume
```

Don't accumulate more scenarios past the batch — the whole point is to keep the conversation manageable.

### 5d. Early stop on first-scenario auth failure

If the first scenario reports BLOCKED with cause `auth failed` or `app unreachable`, stop the loop — every subsequent scenario will hit the same wall. Mark remaining as `Not run` and report.

---

## Phase 6: Assemble the per-scenario results

After the loop completes (or stops at batch / abort):

**`--only` mode merges, it does not rebuild.** Load the existing `07_qa-report.md`, replace only the listed scenarios' per-suite blocks with their fresh verdicts, keep every other scenario's block untouched, then recompute the Summary, traceability matrix, and `Status` from the merged whole. Update the `Run date` to now and append a Notes line: `re-ran TC-NNN, TC-NNN via --only`. Do not rotate the prior report — `--only` is an in-place update, not a new run.

**Evaluate the full-run baseline check (after the loop, before writing).** Read the entire session console/network buffer ([5a-measure](#5a-measure-measurable-assertions-console--network) step 2), filter the baseline-ignore allowlist, and record the verdict for the `Console & network clean across the full run` baseline TC: clean → `PASS`; otherwise `FAIL`, listing each finding prefixed with the TC that was active when it fired, and adding the distinct errors to the Defects table. Its `FAIL` flips the run `Status` to `FAIL` via the normal rule. **Only meaningful over a complete pass:** on an `--only` run, or a batch/abort that left scenarios `Not run`, mark this TC `Not run` and add a Notes line ("full-run console sweep skipped — partial session") rather than passing it on incomplete coverage. If only the in-page fallback capture was available (resets on navigation), mark it `BLOCKED · setup: session-wide capture unavailable`.

**Report header / rollup ownership.** When dispatched by an orchestrator, return the per-scenario verdict blocks plus the full-run baseline verdict for the orchestrator to merge into the run-level header (`Mode`, `Tester`, `Driver model`, `App`, `Status`), Summary table, and traceability matrix. When invoked **directly** with empty input, write the complete report yourself per `references/output-format.md` (same `resolve_content` reference as above):

- `Mode: agentic`, `Tester: wf-browser-qa:qa-engine`, `Driver model:` current model id, `App:` base URL from creds, `Status:` deterministic from the PASS/FAIL/INCOMPLETE rule.
- Summary table; traceability matrix rolled up from per-scenario `Validates: SC-N` references and verdicts; per-suite results (PASS = one line, FAIL/BLOCKED = full step table); Notes & Observations; Defects table (one row per FAIL, severity from priority P0→High / P1→Medium / P2→Low).
- On direct invocation, if the Task tool is available, invoke `/wf:index` with slot `qa-report` and summary: `07_qa-report.md · agentic · <status> · <P>/<T> passed`.

---

## Edge Cases

- **Creds file is corrupt** (missing one of the four required fields): treat as missing — re-prompt the tester. Don't try to repair.
- **App URL changes between runs.** Re-run with `--reset-creds`.
- **Login fails on first scenario.** Stop the loop; report; don't try the rest.
- **Default entity doesn't exist (or the app has no entity selector).** Pick the first available if a selector appears; note the substitution at the top of the report's Notes. No selector = skip the step entirely.
- **Mid-run session expiry.** Re-auth in Phase 5a step 5. If re-auth fails for that scenario, BLOCKED and continue.
- **Browser tools unavailable.** Phase 3 catches this; stop with the manual-walkthrough fallback message.
- **Single scenario.** Run normally — same flow with N=1.
- **`--only` with no existing report, or an unknown `TC-NNN`.** Phase 1 stops with the targeted-re-run message or lists the valid ids — never start a partial run that would orphan the other scenarios' verdicts.
- **Scenario needs non-browser state** (a precondition requiring a database or backend-host write). Out of this engine's scope — `BLOCKED · setup: requires non-browser state (out of engine scope)`. A separate stack capability owns those surfaces.
- **No runnable browser scenarios** — `06_qa.md` has only Build/static / Automated rows and a baseline marked `[N/A: no runnable surface]`. Skip the loop and write a stub PASS noting nothing to run.
- **Tester aborts mid-run.** Incremental save (Phase 5) preserves whatever completed. Resume with `--resume`.
- **Scenario references a button that doesn't exist on the page.** That's a FAIL — observed = `button "<name>" not present`. Do NOT search for a "close enough" alternative; black-box discipline.
- **`run_playwright_code` returns unexpectedly large output.** Truncate at the source — write the script to project just the assertion's relevant fields, not the whole DOM. If you find yourself returning >2KB per assertion, the script is wrong; fix it.
- **Production-URL guard fires on a fixture-bearing scenario.** A scenario needing a storage write against a production-shaped URL is BLOCKED with `setup: refused — app URL "<url>" looks like production`. The user must point creds at a non-production environment and re-run.
- **Teardown fails for one scenario, run continues.** The Status flips to INCOMPLETE for the run. Subsequent scenarios still run — one polluted storage key shouldn't halt the whole pass.
- **Scenario carries `**Visual:** yes`.** After its steps run, the visual-verification sub-phase (5v) runs: Layer A geometry probes (hard-fail set fails deterministically; advisory set is notes-only) and, if not already hard-failed, a Layer B pass-path screenshot + fixed-rubric vision review. A PASS attaches the `**Visual:**` evidence sub-block; a hard-fail probe or rubric failure FAILs the scenario. A scenario **without** the marker never enters 5v. Absolute-defect detection only — not pixel-diffing.
- **Visual verification unavailable in the runtime** (no `screenshot_page`, or `run_playwright_code` can't run the geometry probe). Mark the visual scenario `BLOCKED · setup: visual verification unavailable (no screenshot / playwright)` — never report a visual PASS you couldn't measure.

---

## Final Output

```
QA-ENGINE — Complete

Task:       <task-id>
Mode:       agentic
Status:     <PASS | FAIL | INCOMPLETE>
Scenarios:  <T> total · <P> PASS · <F> FAIL · <B> BLOCKED · <S> SKIPPED · <N> not run
Pass rate:  <N>% (excluding blocked/skipped)

App:        <base URL>
Report:     {task-root}/<task-id>/07_qa-report.md
Screenshots: {task-root}/<task-id>/artifacts/qa-run-*.png (<count> on FAIL only)

<if any defects:>
Top defects:
  • TC-NNN step <K>: <one-line observed>

<if INCOMPLETE due to batch:>
Reached batch ceiling.
Next: /wf-browser-qa:qa-engine <task-id> --resume

<if INCOMPLETE due to abort:>
Run interrupted.
Next: /wf-browser-qa:qa-engine <task-id> --resume

<if FAIL:>
Next: triage and fix the defects, then re-run the failing scenarios with --only

<if PASS:>
All scenarios passed.
Next: hand the report back to the QA orchestrator
```

**The final-output block must always be the very last thing output to chat.**
