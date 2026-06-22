---
name: qa-auto
description: Autonomously executes the QA plan in 06_qa.md by driving the browser in-thread — authenticates, picks an entity, reaches each scenario's preconditions (clears browser storage / seeds test data via mssql_* tools) before running steps, reverts every fixture write afterward, captures screenshots on FAIL, and writes 07_qa-report.md. Also runs Type:API scenarios for backend tasks — it captures the session token and exercises the endpoint over HTTP (in-browser fetch or curl), temporarily wiring a service to a controller via /wf:qa-host api-probe when the deliverable has no endpoint yet, then reverting it. A backend-only task is exercised, never stub-passed. Test creds are saved to _local/qa-creds.md on first run and remembered. Use when you want a hands-off run; pair with /wf:qa-run for human-in-the-loop runs.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash]
---

# /wf:qa-auto — Agentic browser-driven QA test runner

Autonomous runner for `06_qa.md`. Loads the browser-automation tools, authenticates once against the running app, then drives each scenario's steps in the main conversation thread. Verdict per scenario is recorded into `07_qa-report.md` incrementally so a context-overflow or a crash doesn't lose progress.

The skill **reaches preconditions, not just observes them**. If a scenario asserts "cleared localStorage" or "0 users for account X", the runner clears the storage / seeds the DB to that state, runs the test, then reverts every write before moving on. Recipes per precondition shape live in [`references/preconditions.md`](references/preconditions.md). Default disposition: reach the state and run; mark BLOCKED only when a precondition genuinely cannot be reached (e.g., network throttling, which the browser-automation tools don't expose).

**Two scenario kinds.** Each scenario carries a `Type:` — `browser` (the default; absent means browser) or `API`. Phase 6 dispatches on it: browser scenarios drive the browser as below; **API** scenarios exercise an endpoint over HTTP using the captured session token, asserting status + response shape. When an API scenario's preconditions say `Backend host required: <Service>.<method>`, the runner resolves it via `/wf:qa-host api-probe` — using the real endpoint if one exists, or temporarily wiring the service to a controller and reverting it in teardown. The full API path (token capture, fetch/curl transports, the wire-poll-revert fixture lifecycle, assertions, safety) lives in [`references/backend.md`](references/backend.md). This is what makes a backend-only task get genuinely exercised instead of stub-passed.

For a human-in-the-loop run, use `/wf:qa-run` — the same plan, the same report format ([`../wf:qa-gen/references/report-format.md`](../wf:qa-gen/references/report-format.md)), only the `Mode` and `Tester` fields differ.

---

## Why this skill drives in-thread (instead of via Pattern D subagents)

The architecturally clean version of this skill would loop scenarios spawning a per-TC subagent — browser snapshots stay isolated, parent context stays small. But the browser-automation tools may not be available from inside a subagent, so the per-TC isolation can't be relied on for the browser drive.

So this skill drives the browser in the main thread, with **observation discipline** as the mitigation:

- Every `read_page` result is summarized to ≤1 line of observed value before the loop continues. Don't refer back to prior page dumps.
- For compound assertions (filter applied, list re-ordered, multi-element check), use `run_playwright_code` returning a small JSON object — not `read_page` returning the full DOM.
- Screenshots only on FAIL. Saved to `artifacts/qa-run-TC-NNN-<UTC>.png`.
- After every batch (default 25 scenarios), checkpoint the report and stop. Re-invoke with `--resume` for the next batch.

If browser-driving subagents become available in a future runtime, this skill should be refactored back to Pattern D — see CLAUDE.md.

---

## Prerequisites

Read `_local/config.md` for `{task-root}` and `{wi-prefix}`. If absent, stop with: "Run `/wf:init` first." Also read `{qa-baseline-ignore}` if present (the allowlist of known-benign console messages / request patterns the Baseline health scenarios tolerate); treat an absent key as an empty list.

`06_qa.md` must exist in the task folder.

This skill depends on two runtime capabilities:

1. **Browser-automation tools** — `open_browser_page`, `click_element`, `type_in_page`, `read_page`, `screenshot_page`, `run_playwright_code`, `navigate_page`, `handle_dialog`. If unavailable, stop with: "Browser tools unavailable in this runtime. Use /wf:qa-run for a manual walkthrough."
2. **The Task tool** (a standard Claude Code tool) — used only for the `wf:branch` **Task** call (branch gate) and the `wf:index` **Task** call (post-run index update). If subagent invocation is unavailable, the skill still runs but skips those calls.

---

## Command Syntax

```
/wf:qa-auto [<ado-id>] [--suite <suite-name>] [--reset-creds] [--batch <N>] [--resume] [--only <TC-list>]
```

### Arguments

| Argument           | Required | Description                                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `<ado-id>`         | NO       | ADO ID. Falls back to inferring from `git branch --show-current` (first 3+-digit run).            |
| `--suite <name>`   | NO       | Run only one named suite from `06_qa.md`.                                                         |
| `--reset-creds`    | NO       | Re-prompt for app URL / username / password / default entity. Overwrites `_local/qa-creds.md`.    |
| `--batch <N>`      | NO       | Stop after N scenarios for a manual context reset. Default 25. Pair with `--resume` to continue.   |
| `--resume`         | NO       | Resume from the first un-verdicted scenario in an existing `07_qa-report.md`.                     |
| `--only <TC-list>` | NO       | Re-execute exactly the listed scenarios (comma-separated `TC-NNN`) regardless of their current verdict, overwriting just their results in an existing `07_qa-report.md` and leaving every other scenario untouched. For targeted re-runs — e.g. after `/wf:qa-followup` clears a block. Requires an existing report. |

Disambiguation: 3+-digit numeric or `<wi-prefix>-NNN` is the ID; `--`-prefixed tokens are flags. The token after `--only` is its comma-separated scenario list, not the ID.

---

## Safety Rules

**Allowed:**

- Read any file in the project.
- Read/write `_local/qa-creds.md` (test-only credentials — see Phase 3).
- Write `07_qa-report.md` and screenshots under `artifacts/qa-run-*` ONLY inside the resolved task folder.
- Write fixture-failure logs to `_local/{wi-prefix}-{id}/qa-fixtures/` when teardown can't complete (see [`references/preconditions.md`](references/preconditions.md)).
- Use the IDE's question tool to prompt for creds on first run.
- Use the browser-automation tools (`open_browser_page`, `click_element`, `type_in_page`, `read_page`, `screenshot_page`, `run_playwright_code`, `navigate_page`, `hover_element`, `drag_element`, `handle_dialog`).
- **Manipulate browser storage** via `run_playwright_code` to satisfy preconditions: `localStorage`, `sessionStorage`, cookies for the test app's origin only.
- **Read schema metadata** via `mssql_*` MCP tools or by reading project SQL migration files. Schema discovery is metadata, not implementation reading.
- **Write to the test database** via `mssql_*` MCP tools (preferred) or `sqlcmd` via Bash, scoped to fixture setup and teardown for the current scenario. Strict constraints in [`references/preconditions.md`](references/preconditions.md): bounded WHERE on every write, capture-before-modify, validate-after-revert, production-URL guard.
- **Read the session token** from `localStorage`/`sessionStorage` via `run_playwright_code`, and **exercise API endpoints** with in-browser `fetch` (`run_playwright_code`) or `curl` (Bash) using that token. The token stays in working memory — never on disk, never echoed in full. See [`references/backend.md`](references/backend.md).
- **Invoke `/wf:qa-host api-probe` / `api-revert`** to resolve, temp-wire, and revert a backend endpoint for `Backend host required:` preconditions (`wf:qa-host` owns the source write — this skill only calls it). Run `api-revert --all` at end of run when any host was scaffolded.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the branch gate and `subagent_type: wf:index` after the report is written.

**Forbidden:**

- Modify source, spec, plan, or QA-plan files. The plan is read-only. (The ephemeral backend wiring is a source write owned by `/wf:qa-host api-probe` — this skill *invokes* it, never edits source itself.)
- Store production credentials. The user has stated test creds are non-sensitive; the file format reflects that.
- Run builds, tests, installs, or destructive git.
- Read application source (repositories, controllers, services) to "understand" the implementation when a step or assertion fails. Black-box discipline: a failing scenario is a FAIL. Schema introspection is allowed; reading the *route* from the plan and the *token* from storage is allowed; behavioral source reads are not.
- Echo the captured API token in full, or write it to disk. Mask to `••••<last 4>`.
- Retain page snapshots in working memory across steps. After observing each step, summarize to one line and move on; never refer back to a prior `read_page` dump.
- DB writes outside the fixture lifecycle: no `TRUNCATE`, no `DROP`, no DDL, no unbounded `WHERE`, no writes the scenario's preconditions don't justify. Refuse if the creds' app URL looks production-shaped.

---

## Phase 1: Resolve task and plan

1. Resolve `<ado-id>` (passed or branch-inferred). Stop with the standard message if neither.
2. Locate `06_qa.md`. Stop if missing.
3. Parse it: scope, suites, scenarios (TC-NNN with priority, validates, preconditions, steps, teardown). Filter by `--suite` if passed.
4. **Resume / targeted re-run handling.**
   - **`--only <TC-list>`** — parse the comma-separated `TC-NNN` list; the loop set is exactly those scenarios, re-executed regardless of their current verdict. Requires an existing `07_qa-report.md` — if absent, stop: "No `07_qa-report.md` to update with `--only`. Run a full pass first." Validate every listed `TC-NNN` exists in `06_qa.md`; if any don't, stop and list the valid IDs. `--only` takes precedence over `--resume` if both are passed.
   - **`--resume`** — parse `07_qa-report.md` for verdicts already recorded. Start the loop at the first un-verdicted scenario. If `07_qa-report.md` doesn't exist, stop: "No `07_qa-report.md` to resume."
   - **Neither** — if an annotated report exists, ask: rename to `07_qa-report.<UTC-timestamp>.md` (default), overwrite, or abort?
5. **Compare plan-vs-resume.** When resuming, compare the TC-NNN headings in `06_qa.md` with what the partial report references. If the plan changed mid-run, stop: "Plan changed since the run began. Start a fresh run."

---

## Phase 2: Branch gate

If `git branch --show-current` doesn't match `*/<id>-*` and subagent invocation is available, invoke the **Task** tool with `subagent_type: wf:branch` and the resolved ID. If subagent invocation is unavailable, warn but continue — auto runs commonly happen on the task branch anyway.

---

## Phase 3: Credentials

1. Look for `_local/qa-creds.md`. If missing OR `--reset-creds` was passed, prompt the tester via the IDE question tool for:
   - **App base URL** (e.g., `https://localhost:4200`)
   - **Username** (test account)
   - **Password** (test account — non-sensitive; if the tester is uncomfortable typing creds in chat, abort and switch to `/wf:qa-run`)
   - **Default entity** name (or empty for "first available")

2. Write `_local/qa-creds.md` in this format:

   ```markdown
   # QA Test Credentials

   Non-sensitive test credentials for /wf:qa-auto. Never store production passwords here.

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

   Anything other than continue stops the skill. Never echo the full password back to chat after this confirmation.

`_local/` is gitignored, so `qa-creds.md` never reaches a commit.

---

## Phase 4: Browser-tool preflight

1. Confirm the browser-automation tools (`open_browser_page`, `click_element`, `type_in_page`, `read_page`, `screenshot_page`, `run_playwright_code`, `navigate_page`, `handle_dialog`) are available.
2. If any tool is unavailable, stop with: "Browser tools unavailable in this runtime. Use `/wf:qa-run` instead for a manual walkthrough."
3. Call `open_browser_page(<base URL from creds>)`.
4. Call `read_page` once. If the response is a network error or the document is empty, stop: "App not reachable at `<URL>`. Make sure the dev server is running, then re-run."

Summarize the page title to one line. Don't retain the full DOM.

---

## Phase 5: Authentication and entity

Idempotent — at the start of the run, drive auth + entity once. The browser tab is persistent for the rest of the conversation, so subsequent scenarios start with the app already in main-dashboard state.

1. From the preflight `read_page`, detect the current state:
   - **Login form** → drive login (step 2).
   - **Entity selector** → pick entity (step 3).
   - **Main app dashboard** → already authenticated (e.g., session from a prior run is still valid). Skip to Phase 6.

2. **Drive login.**
   - Identify username and password fields. Prefer `read_page`'s accessibility tree (look for inputs labeled `email`, `username`, `password` via `aria-label`, `placeholder`, or `name`). Fall back to `run_playwright_code` for selector inspection if the accessibility tree is sparse.
   - `type_in_page` with the credentials from the creds file.
   - `click_element` on the submit button.
   - `read_page` once after submit. If still on the login form, retry once. If a second submission still fails, stop with: "Auth failed. Check `_local/qa-creds.md` and re-run with `--reset-creds` if creds are wrong." Screenshot the failure to `artifacts/qa-run-auth-fail-<UTC>.png` first.

3. **Pick an entity** if the entity selector appears.
   - If creds' `Default entity` matches a listed entity (case-insensitive substring), click it.
   - Otherwise click the first listed entity. Record the substitution as a top-of-report Note: `entity hint "<hint>" not found, used "<actual>"`.
   - `read_page` once to confirm transition to main dashboard. Summarize and discard.

After this phase, you are at the app's main dashboard and authenticated. Subsequent scenarios start here.

4. **Capture the API token** — only if the plan contains any `Type: API` scenario (skip otherwise). Following [`references/backend.md` § Token capture](references/backend.md#token-capture), discover how the app authorizes calls: a JWT-shaped value in `localStorage`/`sessionStorage` (bearer mode) or an httpOnly auth cookie (cookie mode). Hold the bearer in working memory as `BEARER`; **never write it to disk or echo it in full**. Record the mode once (`Auth: bearer (key <masked>)` / `Auth: cookie (httpOnly)`) for the report header.

---

## Phase 6: Loop scenarios

Order: P0 → P1 → P2; within a tier, file order. Apply `--batch N` ceiling.

When `--only` is set, the loop set is exactly the listed scenarios (in report order) and each re-executes regardless of its prior verdict. Every incremental save and the Phase 7 assembly **merge** into the existing report: replace just the listed scenarios' blocks, preserve every other scenario's recorded verdict verbatim, then recompute the Summary, traceability, and Status from the full merged set.

For each scenario, drive the steps in-thread following the procedure below. After each scenario, append the verdict block to a buffer and flush to `07_qa-report.md` every 3 scenarios (incremental save).

**Before the loop — start session-wide capture.** Register the console/network listeners once (see [6a-measure](#6a-measure-measurable-assertions-console--network)) so they accumulate across *every* scenario in the session, each entry tagged with the TC that's active when it fires. Per-scenario baseline checks read the slice added since that scenario began; the full-run baseline check (Phase 7) reads the entire accumulated buffer. Keep a "current TC" marker updated as you enter each scenario so findings can be attributed. Skip the full-run baseline TC during the loop — it is evaluated post-loop in Phase 7, not driven step-by-step here.

### 6a. Per-scenario procedure

**Dispatch on `Type`.** If the scenario's `**Type:**` line is `API`, run it via the API procedure in [`references/backend.md` § Per-API-scenario procedure](references/backend.md#per-api-scenario-procedure) — preconditions (below) still apply, but step 2's browser-driving is replaced by build-request → exercise (fetch/curl) → assert status+shape, and FAIL captures a JSON response under `artifacts/qa-api-TC-NNN-<UTC>.json` instead of a screenshot. Browser scenarios (the default, no `Type:` line) follow the steps below.

For TC-NNN:

1. **Apply preconditions** following the lifecycle in [`references/preconditions.md`](references/preconditions.md):
   - Classify each precondition (auth / URL / storage / data / host / **backend host** / environment).
   - For storage and data preconditions, follow the recipe to reach the asserted state. Capture-before-modify; tag inserted rows when possible.
   - For `Host required: <component>` preconditions, follow the procedure in `wf:qa-host/SKILL.md` (read it once per run when first needed): try `route <component>` first (cheap, no writes); if "not scaffolded", do `new <component>` (writes 2 files + 3 routing edits + typechecks). Substitute the resulting route URL into any URL precondition.
   - For `Backend host required: <Service>.<method>` preconditions (API scenarios), follow [`references/backend.md` § Backend host required](references/backend.md#backend-host-required--wire-poll-revert): `/wf:qa-host api-probe` to use the real endpoint or temp-wire one, poll until the API rebuilds, and register the wiring as a fixture to revert in step 4.
   - If setup fails (e.g., schema unreachable, production-URL guard tripped, host typecheck fails, backend host not rebuilt), mark scenario `BLOCKED · setup: <one-line reason>` and skip steps. Run partial teardown for any setup that did succeed.
   - Track every fixture write (DB rows, scaffolded hosts, ephemeral backend wiring) so it can be reversed in step 4.

2. **Run each step in order** *(browser scenarios; for `Type: API` see the dispatch note above)*. For step `K` of `M`:
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

3. **Scenario teardown** if specified in `06_qa.md`. Execute. Don't gate the verdict — note teardown failures under `Notes:`.

4. **Fixture teardown.** Reverse every fixture write from step 1, in reverse order. Validate each revert by re-querying. On a teardown failure, retry once; if still failing, write the unreversed SQL to `_local/{wi-prefix}-{id}/qa-fixtures/teardown-TC-NNN-failed-<UTC>.sql` and surface a `⚠ teardown failed` note in the report. Continue with remaining teardowns. For an **ephemeral backend host** scaffolded in step 1, revert it via `/wf:qa-host api-revert <Service>.<method>` and confirm the sentinel is gone; a failed revert reads `⚠ ephemeral host revert failed` and forces `Status: INCOMPLETE` (un-shippable wiring must not survive). The scenario's verdict stands; the run's overall `Status` flips to `INCOMPLETE` if any teardown failed (test environment isn't in a known state).

5. **Mid-run session expiry.** If `read_page` after a navigation reveals the login form mid-scenario, re-run the auth steps from Phase 5 in-line, then resume the scenario. If re-auth fails, mark scenario `BLOCKED · session expired and re-auth failed` and continue the loop.

### 6a-measure. Measurable assertions (console / network)

Baseline-health steps — and any step whose Expected references the browser console or network — assert runtime signals the DOM doesn't surface. Capture them at the Playwright layer:

1. **Register capture once, session-wide** (start of Phase 6, before the loop). Prefer the page-API form via `run_playwright_code`: `page.on('console', m => { if (m.type() === 'error') errors.push({ tc: currentTc, text: m.text() }) })`, `page.on('requestfailed', r => failed.push({ tc: currentTc, why: 'failed ' + r.url() }))`, `page.on('response', r => { if (r.status() >= 400) failed.push({ tc: currentTc, why: r.status() + ' ' + r.url() }) })`. These are page-level and survive in-page navigation, so one registration covers the whole session; each entry is tagged with the active TC. If the runtime's `run_playwright_code` exposes only the in-page `evaluate` context (no `page` object), fall back: inject an init script that patches `console.error` and wraps `fetch`/`XMLHttpRequest` to push into `window.__qaErrors` / `window.__qaNet` — but this resets on navigation, so it can only feed *per-scenario* checks, not the session-wide full-run check (note that limitation in the report).
2. **Read at the assertion step.** For a **per-scenario** baseline step (B1 load-clean), read only the slice added since that scenario began (snapshot the buffer length at scenario start). For the **full-run** check (Phase 7), read the entire buffer. Return a small JSON object: `{ errors: [...], failed: [...] }` — don't dump the whole console.
3. **Filter `{qa-baseline-ignore}`.** Drop any console text or request URL/status matching a listed substring or `/regex/`. Also drop the expected auth/redirect requests the login flow itself makes (3xx, the auth POST).
4. **Verdict:** after filtering, non-empty `errors` or `failed` → `FAIL`, with the offending entries (each truncated to ~120 chars, prefixed with their `tc` for the full-run check) as the observed value; surface them in the report's Defects/Notes. Empty → `PASS`.
5. **If neither capture path works in this runtime** → mark the affected scenario `BLOCKED · setup: console/network capture unavailable`. Never report a baseline PASS you couldn't actually measure.

### 6b. Verdict block per scenario

Record one block per scenario in `07_qa-report.md` under the appropriate suite section, in the per-suite-results format from [`../wf:qa-gen/references/report-format.md`](../wf:qa-gen/references/report-format.md):

- PASS → one-line `All steps passed.` (with optional one-line note).
- FAIL → full step table, observed values, screenshot path, failure notes.
- BLOCKED → block point + reason.

Always include a `Fixtures:` line summarizing what was set up and reverted (`none`, `precondition already met`, `cleared browser storage; re-authenticated`, `3 Users.Status updated then reverted`, `⚠ teardown failed — see qa-fixtures/teardown-TC-NNN-failed-<UTC>.sql`). Format details in [`references/preconditions.md`](references/preconditions.md#recording-fixtures-in-the-report).

### 6c. Batch ceiling

After `--batch N` scenarios complete, OR if you sense context filling (e.g., the parent transcript is heavy with prior screenshots / DOM summaries), stop the loop. Write the partial report with `Status: INCOMPLETE` and remaining scenarios as `Not run`. Tell the user:

```
Reached batch ceiling at TC-NNN. <K> scenarios complete, <M> remaining.
Resume with: /wf:qa-auto <id> --resume
```

Don't accumulate more scenarios past the batch — the whole point is to keep the conversation manageable.

### 6d. Early stop on first-scenario auth failure

If the first scenario reports BLOCKED with cause `auth failed` or `app unreachable`, stop the loop — every subsequent scenario will hit the same wall. Mark remaining as `Not run` and report.

---

## Phase 7: Assemble the final report

After the loop completes (or stops at batch / abort):

**Sweep ephemeral backend wiring (before writing the report).** If any `Type: API` scenario scaffolded a backend host this run, invoke `/wf:qa-host api-revert --all` as a safety sweep and confirm zero `WF-QA-EPHEMERAL` sentinels remain. Any block that can't be reverted is recorded loudly and forces `Status: INCOMPLETE` — un-shippable wiring must never survive a run.

**`--only` mode merges, it does not rebuild.** Load the existing `07_qa-report.md`, replace only the listed scenarios' per-suite blocks with their fresh verdicts, keep every other scenario's block untouched, then recompute the Summary, traceability matrix, and `Status` from the merged whole. Update the `Run date` to now and append a Notes line: `re-ran TC-NNN, TC-NNN via --only`. Do not rotate the prior report — `--only` is an in-place update, not a new run.

**Evaluate the full-run baseline check (after the loop, before writing).** Read the entire session console/network buffer ([6a-measure](#6a-measure-measurable-assertions-console--network) step 2), filter `{qa-baseline-ignore}`, and record the verdict for the `Console & network clean across the full run` baseline TC: clean → `PASS`; otherwise `FAIL`, listing each finding prefixed with the TC that was active when it fired, and adding the distinct errors to the Defects table. Its `FAIL` flips the run `Status` to `FAIL` via the normal rule. **Only meaningful over a complete pass:** on an `--only` run, or a batch/abort that left scenarios `Not run`, mark this TC `Not run` and add a Notes line ("full-run console sweep skipped — partial session") rather than passing it on incomplete coverage. If only the in-page fallback capture was available (resets on navigation), mark it `BLOCKED · setup: session-wide capture unavailable`.

- Header per [`../wf:qa-gen/references/report-format.md`](../wf:qa-gen/references/report-format.md):
  - `Mode: agentic`
  - `Tester: wf:qa-auto`
  - `Driver model:` — current model identifier.
  - `App:` — base URL from creds file.
  - `Auth:` — `bearer` / `cookie` (only when the plan had API scenarios; omit otherwise).
  - `Status:` — deterministic from PASS/FAIL/INCOMPLETE rule.
- Summary table.
- Traceability matrix rolled up from per-scenario `Validates: SC-N` references and verdicts.
- Per-suite results — PASS scenarios get one line, FAIL/BLOCKED get the full step table.
- Notes & Observations — any anomalies (entity substitutions, retries, teardown failures).
- Defects table — one row per FAIL, severity from priority (P0→High, P1→Medium, P2→Low), description from observed value.

If subagent invocation is available, invoke `/wf:index` with slot `qa-report` and summary: `07_qa-report.md · agentic · <status> · <P>/<T> passed`.

---

## Edge Cases

- **Creds file is corrupt** (missing one of the four required fields): treat as missing — re-prompt the tester. Don't try to repair.
- **App URL changes between runs.** Tester re-runs with `--reset-creds`.
- **Login fails on first scenario.** Stop the loop; report; don't try the rest.
- **Default entity doesn't exist.** Pick the first available, note the substitution at the top of the report's Notes.
- **Mid-run session expiry.** Re-auth in Phase 6a step 4. If re-auth fails for that scenario, BLOCKED and continue.
- **Browser tools unavailable.** Phase 4 catches this; stop with the manual-walkthrough fallback message.
- **Single scenario.** Run normally — same flow with N=1.
- **`--only` with no existing report, or an unknown `TC-NNN`.** Phase 1 stops with the targeted-re-run message or lists the valid IDs — never start a partial run that would orphan the other scenarios' verdicts.
- **No runnable scenarios of any kind** — `06_qa.md` has no browser scenarios *and* no `Type: API` scenarios, only Build/static / Automated rows and a baseline marked `[N/A: no runnable surface]`. Only then skip the loop and write a stub PASS noting nothing to run. **Do not stub a backend task:** a plan with `Type: API` scenarios (or a `Backend host required:` precondition, or an API baseline) is runnable — exercise it. If you find yourself about to stub-PASS a task whose deliverable is a `.cs` endpoint/service, the plan was mis-generated — stop and tell the user to re-run `/wf:qa-gen` (which now emits API scenarios) rather than reporting a hollow pass.
- **Backend host wired but API not rebuilt.** The `__qa` route still 404s after the poll bound. BLOCKED with `setup: backend host wired but API not rebuilt — restart the API (or run dotnet watch) and re-run`. The wiring stays for the restart but is still reverted at end of run.
- **API token couldn't be captured** (no JWT in storage and no readable cookie). API scenarios that need a bearer are BLOCKED with `setup: no API token in session`; cookie-mode fetch may still work for same-origin GETs — try fetch before blocking.
- **Tester aborts mid-run.** Incremental save (Phase 6) preserves whatever completed. Resume with `--resume`.
- **Scenario references a button that doesn't exist on the page.** That's a FAIL — observed = `button "<name>" not present`. Do NOT search for a "close enough" alternative; black-box discipline.
- **`run_playwright_code` returns unexpectedly large output.** Truncate at the source — write the script to project just the assertion's relevant fields, not the whole DOM. If you find yourself returning >2KB per assertion, the script is wrong; fix it.
- **Production-URL guard fires on a fixture-bearing scenario.** All scenarios needing DB writes are BLOCKED with `setup: refused — app URL "<url>" looks like production`. The user must point creds at a non-production environment and re-run.
- **Schema introspection fails** (mssql_* tools not configured for the DB). Data preconditions are BLOCKED with `setup: schema metadata unavailable`. Storage preconditions still work — they don't need DB access.
- **Teardown fails for one scenario, run continues.** The Status flips to INCOMPLETE for the run. The failed teardown's SQL lives in `_local/.../qa-fixtures/` for manual cleanup. Subsequent scenarios still run — one polluted row shouldn't halt the whole pass.

---

## Final Output

```
QA-AUTO — Complete

Task:       {wi-prefix}-{id}
Mode:       agentic
Status:     <PASS | FAIL | INCOMPLETE>
Scenarios:  <T> total · <P> PASS · <F> FAIL · <B> BLOCKED · <S> SKIPPED · <N> not run
Pass rate:  <N>% (excluding blocked/skipped)

App:        <base URL>
Report:     {task-root}/{wi-prefix}-{id}/07_qa-report.md
Screenshots: {task-root}/{wi-prefix}-{id}/artifacts/qa-run-*.png (<count> on FAIL only)

<if any defects:>
Top defects:
  • TC-NNN step <K>: <one-line observed>
  • TC-NNN step <K>: <one-line observed>

<if INCOMPLETE due to batch:>
Reached batch ceiling.
Next: /wf:qa-auto {id} --resume

<if INCOMPLETE due to abort:>
Run interrupted.
Next: /wf:qa-auto {id} --resume

<if FAIL:>
Next: /wf:qa-followup {id}  — triage and fix the defects

<if PASS:>
All scenarios passed.
Next: ship it — /wf:commit {id} --push  then  /wf:pr {id}
```

**The final-output block must always be the very last thing output to chat.**
