---
name: qa-run
description: Walks a human tester through 06_qa.md one step at a time, recording verdicts, notes, and observations via interactive prompts. Writes 07_qa-report.md with the full results matrix and traceability back to spec criteria. Browser scenarios are driven step-by-step in a real browser; Type:API scenarios are presented as a request block + a ready-to-run HTTP request (a copy-paste curl command) for the tester to run, asserting status and response shape. Use when a tester wants to execute the QA plan themselves — the skill is the test lead, the user is the tester.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:qa-run — Interactive manual QA test runner

Reads `06_qa.md` (from `/wf:qa-gen`), presents each scenario step-by-step via the IDE's question tool, records the tester's verdict and notes per step, and writes `07_qa-report.md` with full results and traceability.

**The skill is the test lead. The user is the tester. One step at a time.**

Scenarios carry a `Type:` — `browser` (default) or `API`. Browser scenarios are walked step-by-step in the running app. **API** scenarios (backend tasks) are presented as a request block plus a ready-to-paste HTTP request; the tester runs it and reports the status code and response, which the skill checks against the scenario's assertions. When an API scenario needs an endpoint that doesn't exist yet (`Backend host required:`), the skill tells the tester to wire it first with `/wf-caps:qa-host api-probe <Service>.<method>` (and revert with `api-revert` after) — the manual analog of what `/wf:qa-auto` does automatically.

For an autonomous run (no human in the loop), use `/wf:qa-auto` instead. The two write the same report file in the same format — only the `Mode` and `Tester` fields differ.

---

## Prerequisites

Read `_local/config.md` for `{task-root}`. If absent, stop with: "Run `/wf:init` first."

`06_qa.md` must exist in the task folder. If missing, stop: "No QA plan found. Run `/wf:qa-gen` first."

The report shape is documented once in [`../qa-gen/references/report-format.md`](../qa-gen/references/report-format.md). This skill writes that exact shape — keep both in lockstep when editing.

---

## Command Syntax

```
/wf:qa-run [<id>] [--suite <suite-name>] [--resume]
```

### Arguments

| Argument          | Required | Description                                                                                       |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `<id>`            | NO       | Task id — whatever shape the active tracker capability produces (opaque to core), or a local `T<NNN>` id when no tracker is registered. Falls back to inferring from the current branch (first 3+-digit run). |
| `--suite <name>`  | NO       | Run only one named suite from `06_qa.md`. Default: all suites.                                    |
| `--resume`        | NO       | Resume an interrupted run. Reads existing `07_qa-report.md`, picks up at the first un-verdicted scenario. |

Argument-parser disambiguation: if a token contains a 3+-digit run, or exactly matches an existing task folder name under `{task-root}`, treat it as the id. Anything starting with `--` is a flag. If `--suite` value doesn't match a suite in `06_qa.md`, stop and list available suites.

---

## Direct provider resolution (how `current-branch-query` is reached)

Id inference reaches `current-branch-query` the same way, per `plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution", mirroring `plugins/wf/agents/branch.md`'s own section (qa-run has no tracker-surface call site — it never fetches):

1. Read the `## Capabilities` registry from `_local/config.md` (the contract's default-absent `registryPath` value).
2. Select the row(s) where `contribution-kind = provider` **and** `scope = delivery`, across the whole registry (a scope filter, independent of which phase value the row itself carries).
3. Read that capability's `manifest.md` at its registry path, then dispatch its fragment per the row's `dispatch` kind (today, an `inline:` fragment — read the referenced file and follow it in-context; no subagent is spawned).
4. **Zero matching rows** — no capability owns the `delivery` surface. `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces.

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`).
- Use the question tool (`AskUserQuestion`) to interact with the tester.
- Read-only resolution via `current-branch-query` (direct provider resolution to the `delivery` surface) for id inference.
- Resolve the report's `Tester` field to the environment's configured user identity (Phase 2, Phase 4) — a documented contract-completeness gap, not a literal identity lookup: the delivery provider surface has no identity/user operation, so this never routes through a contract call.
- Write `07_qa-report.md` ONLY inside the resolved task folder.
- Invoke the **Task** tool for `/wf:index` to record the report after writing.

**Forbidden:**

- Modify any source file, spec, plan, or QA-plan file. The plan (`06_qa.md`) is read-only — corrections go through `/wf:qa-gen`, not here.
- Run builds, tests, installs, or destructive git operations.
- Drive the browser. This skill only narrates and records — the human tester drives. For autonomous browser drive use `/wf:qa-auto`.
- Execute test steps on behalf of the tester. The tester is the authority on what they observed.

---

## Phase 1: Resolve and load

1. **Resolve `<id>`.** If passed explicitly, use it verbatim as `{task-id}` — opaque, whatever shape the active tracker capability produces, or the local `T<NNN>` scheme. If omitted, resolve the current branch via `current-branch-query` (direct provider resolution to the `delivery` surface — see "Direct provider resolution" above) and extract the first 3+-digit run — the branch-inferred token. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the branch-inferred token (mirroring `spec/SKILL.md`'s Validation-section resolution logic). Exactly one match — reuse that folder's full name as `{task-id}` verbatim. Zero matches — stop: "No task id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass it explicitly: `/wf:qa-run <id>`." More than one match — stop: "No task id provided and the branch-inferred token `<token>` matches more than one task folder. Pass it explicitly: `/wf:qa-run <id>`." If no numeric token can be extracted from the branch at all, stop: "No task id provided and none could be inferred from the current branch. Pass it explicitly: `/wf:qa-run <id>`."
2. **Locate the task folder.** Compute `{task-root}/{task-id}/`. Stop if `06_qa.md` is missing: "No QA plan found. Run `/wf:qa-gen` first."
3. **Parse `06_qa.md`.** Extract: scope, suites, scenarios (TC-NNN with title, priority, validates, preconditions, steps table, teardown). Preserve TC-NNN ordering as it appears in the file.
4. **Filter by `--suite`** if passed.
5. **Load existing report** if `--resume`. Parse the per-TC headings for verdicts. The first scenario without a verdict is the starting point. If the report doesn't exist and `--resume` was passed, stop: "No `07_qa-report.md` to resume. Run without `--resume`."
6. **Detect prior annotated results** if NOT resuming. If `07_qa-report.md` exists with verdicts recorded, ask the tester: rename the existing file to `07_qa-report.<UTC-timestamp>.md` (default), overwrite, or abort?

---

## Phase 2: Pre-flight overview

Show the tester what they're about to do, then confirm:

```
QA RUN — manual — {task-id}

Scenarios: <N> (<P0> P0, <P1> P1, <P2> P2)
Suites:    <comma-separated suite names>
Resuming:  <starting from TC-NNN | "no — full run">
Estimated time: ~<minutes> min (≈1 min per 3 steps)

Tester: <the environment's configured user identity, or "tester" if unavailable>

Reply ready to begin. While running:
  • "skip"  — skip the current scenario
  • "abort" — stop and save progress (resume later with --resume)
  • "back"  — re-do the current step (e.g., misclicked)
```

Use the IDE question tool. If the tester replies anything other than "ready" / equivalent, stop and report.

If the plan has a `Baseline health` suite (it always will, from `/wf:qa-gen`), tell the tester to **open DevTools (Console + Network) before starting and leave it open for the whole run** — the baseline checks read the console and network, and the full-run check at the end reviews the entire session's history.

---

## Phase 3: Walk through scenarios

Process scenarios in **priority order**: P0 → P1 → P2. Within a tier, follow the order they appear in `06_qa.md`. (The plan is already grouped by suite; priority sort is the second key.)

**Exception — the full-run baseline check goes last.** Hold the `Console & network clean across the full run` baseline TC (marked `Validates: — (baseline health, full-run)`) until every other scenario is done, regardless of its priority. It inspects the whole session, so it can't be judged mid-run. When you present it, ask the tester to review the Console and Network history accumulated since login for any error entries or failed/4xx-5xx requests (excluding `{qa-baseline-ignore}`), and record the verdict like any scenario.

For each scenario:

### 3a. Present the scenario header

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TC-NNN: <title>
Suite: <suite> | Priority: <P0|P1|P2>
Validates: SC-<N> — <criterion abbreviated>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Preconditions:
  • <precondition 1>
  • <precondition 2>
```

Ask the tester to confirm preconditions are set. Options via the question tool: **Ready** / **Skip this scenario (precondition can't be met)** / **Abort run**.

### 3b. Walk steps one at a time

**API scenarios (`Type: API`) are presented as one request, not a step sequence.** If the scenario has a `**Type:** API` line, skip the per-step walk and instead present the request plus a ready-to-run HTTP request (given below as a copy-paste `curl` command; any REST client works), then collect the result:

```
TC-NNN (API) — <title>

Request:
  <METHOD> <resolved route>
  <body, if any>

Run this (token from devtools → Application → Local/Session Storage, or your REST client):
  curl -s -o - -w "\n%{http_code}" -X <METHOD> \
    -H "Authorization: Bearer <YOUR_TOKEN>" -H "Content-Type: application/json" \
    "<app-base><route>"  <--data '<body>' for non-GET>

Assertions:
  1. <assertion> → <expected>
  2. <assertion> → <expected>
```

If a precondition is `Backend host required: <Service>.<method>`, tell the tester to run `/wf-caps:qa-host api-probe <Service>.<method>` first (it prints the route to call; ephemeral routes need the backend host rebuilt before they respond, as the provider notes), and to run `/wf-caps:qa-host api-revert <Service>.<method>` when done. Ask the tester to paste the status code and response, then judge each assertion **Pass**/**Fail** from what they report (same verdict rules as below). Record the observed status/response on FAIL.

For **browser** scenarios, walk one step at a time. For each step, present:

```
Step <N>/<total> — TC-NNN

Action:   <action text>
Expected: <expected result>
```

Ask the tester to choose: **Pass** / **Fail** / **Blocked** / **Note (still passes)** / **Back (re-do step)**.

- **Pass** — record `step N PASS`, advance.
- **Fail** — prompt: "What did you observe instead?" Record the free-text response as the observed value. Mark scenario verdict `FAIL@stepN`. Continue with remaining steps anyway (they may surface more issues), but don't gate the verdict on later passes — fail is sticky.
- **Blocked** — prompt: "What's blocking?" Record the reason. Mark scenario `BLOCKED at step N`. Skip remaining steps in this scenario.
- **Note** — prompt: "What's the note?" Attach the observation to this step but mark step PASS. Continue.
- **Back** — re-present the step. Don't record a verdict for the previous attempt.

### 3c. Scenario verdict

After all steps are processed (or early termination):

- All steps PASS → `PASS`
- Any step FAIL → `FAIL@stepN`
- Blocked → `BLOCKED at step N`
- Skipped → `SKIPPED`

Announce: `TC-NNN: <verdict>`. Move to the next scenario.

### 3d. Incremental save

After every 3 completed scenarios (or on `abort`), write the current state to `07_qa-report.md` in the format from [`../qa-gen/references/report-format.md`](../qa-gen/references/report-format.md). Scenarios not yet executed appear with verdict `Not run`. This is the safety net for crashed sessions.

---

## Phase 4: Write the final report

After the loop completes (or aborts), write the full `07_qa-report.md`:

- Header: run date, `Mode: manual`, `Tester:` the environment's configured user identity (or `"tester"` if unavailable — see [`../qa-gen/references/report-format.md`](../qa-gen/references/report-format.md); a documented contract-completeness gap, since the delivery provider surface has no identity/user operation), `Driver model:` is the current model identifier, `Plan: 06_qa.md (scope: <scope>)`, `App:` empty for manual mode, status from the deterministic rule.
- Summary table.
- Traceability matrix (rolled up from each scenario's `Validates: SC-N` and verdict).
- Per-suite results — PASS scenarios get one line, FAIL/BLOCKED get the full step table.
- Notes & Observations — any `Note` annotations recorded.
- Defects table — one row per FAIL, severity from priority (P0→High, P1→Medium, P2→Low), description from the observed-value text the tester gave.

After writing, invoke `/wf:index` with slot `qa-report` and summary: `07_qa-report.md · manual · <status> · <P>/<T> passed`.

---

## Phase 5: Final-output block

Emit the block in the next section. **It must be the very last thing output to chat.**

If the run was aborted, the block lists `Status: INCOMPLETE` and notes how to resume.

---

## Edge Cases

- **Tester is non-technical and asks for clarification mid-step.** Explain the step using implementation knowledge from the spec or plan — do NOT modify `06_qa.md`. If the step is genuinely ambiguous, record it as a `Note` and recommend re-generating with `/wf:qa-gen` for a sharper rewrite.
- **Tester wants to add a step on the fly.** Refuse politely: scenarios are immutable here; record the request as a Note attached to the scenario, and surface it in the report's Notes section. They can re-run `/wf:qa-gen` to refresh the plan.
- **Session interrupted without `abort`** (e.g., the session crashes). The incremental save (Phase 3d) preserves whatever was complete at the last 3-scenario checkpoint. Resume with `/wf:qa-run --resume`.
- **`--resume` but the underlying `06_qa.md` has changed since the run started.** Stop with: "Plan changed since the run began. Resuming would mix verdicts against different scenarios. Start a fresh run." Compare by file mtime or by hashing TC-NNN headings.
- **No P0 scenarios in `06_qa.md`.** Warn at preflight: "No P0 (release-blocking) scenarios. Consider re-generating with `/wf:qa-gen <id> full`." Continue if tester says ready.
- **Single scenario.** Run normally — no special handling. Pre-flight overview still applies; "scenarios: 1" is fine.
- **No runnable scenarios of any kind** (no browser *and* no `Type: API` scenarios — only Build/static / Automated rows). Tell the tester there's nothing to run, write a stub report status PASS, exit. **A plan with API scenarios is runnable** — present them as HTTP requests per 3b; don't stub a backend task. If the plan looks empty but the task's deliverable is a backend endpoint or service method, the plan was mis-generated — point the tester to re-run `/wf:qa-gen`.

---

## Final Output

```
QA-RUN — Complete

Task:       {task-id}
Mode:       manual
Status:     <PASS | FAIL | INCOMPLETE>
Pass rate:  <N>% (<passed>/<total executed>)
Failures:   <N>
Blocked:    <N>
Skipped:    <N>

Report:     {task-root}/{task-id}/07_qa-report.md

<if any defects:>
Top defects:
  • TC-NNN step <K>: <one-line description>
  • TC-NNN step <K>: <one-line description>

<if INCOMPLETE:>
Next: /wf:qa-run {task-id} --resume

<if FAIL:>
Next: /wf:qa-followup {task-id}  — triage and fix the defects

<if PASS:>
All executed scenarios passed.
Next: ship it — /wf:commit {task-id} --push  then  /wf:pr {task-id}
```

**The final-output block must always be the very last thing output to chat.**
