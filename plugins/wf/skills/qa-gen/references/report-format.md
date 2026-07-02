# wf:qa-* — Shared report format (`07_qa-report.md`)

The canonical shape of the QA-run report. Both `/wf:qa-run` (manual) and `/wf:qa-auto` (agentic) write this file. Same template, same headings, same coverage matrix — only the `Tester` field and the per-TC observed values differ between modes.

This file is the single source of truth for the format. Update here, then both run and auto pick it up.

---

## Filename and location

`{task-root}/{wi-prefix}-{id}/07_qa-report.md` — same numbered-pipeline convention as the other per-task artifacts. Number `07` follows `06_qa.md`.

Overwritten by default. If a prior report exists with annotated results, the writer renames it to `07_qa-report.<UTC-timestamp>.md` first.

---

## Template

```markdown
# {wi-prefix}-{id} — QA Run Report

**Run date:** <YYYY-MM-DD HH:mm>
**Mode:** <manual | agentic>
**Tester:** <git config user.name, or "wf:qa-auto" for agentic runs>
**Driver model:** <model identifier — for agentic runs, the model the per-TC subagent ran under>
**Plan:** `06_qa.md` (scope: <smoke | happy | full>)
**App:** <base URL from creds file, agentic only>
**Auth:** <bearer | cookie — only when the plan had Type:API scenarios; omit otherwise>
**Status:** <PASS | FAIL | INCOMPLETE>

---

## Summary

| Metric | Count |
|---|---|
| Total scenarios | <N> |
| Passed | <N> |
| Failed | <N> |
| Blocked | <N> |
| Skipped | <N> |
| Not run | <N> (only when INCOMPLETE) |
| Pass rate | <N>% (excluding blocked/skipped) |

Run status rules:

- **PASS** — every executed scenario passed; zero failed; zero blocked.
- **FAIL** — at least one scenario failed.
- **INCOMPLETE** — run was aborted, scenarios remain `Not run` (e.g., crash mid-loop in agentic mode), OR any scenario's fixture teardown failed (test environment is not in a known state — agentic mode only).

---

## Traceability Matrix

Mirrors the coverage matrix in `06_qa.md`, with verdicts filled in.

| Criterion (SC-N) | Wording (abbreviated) | Scenarios | Result |
|---|---|---|---|
| SC-1 | <abbreviated> | TC-001 PASS, TC-002 PASS | COVERED — PASS |
| SC-2 | <abbreviated> | TC-003 FAIL@step2 | COVERED — FAIL |
| SC-3 | <abbreviated> | — | GAP — no scenarios (verified by build/automation only) |

---

## Results by Suite

### Suite: <suite name>

#### TC-001: <title> — PASS

All steps passed. <optional: one-line note if the tester or agent recorded one>

**Fixtures:** none *(agentic mode only — manual mode omits this line)*

#### TC-00N: <title> — PASS *(Visual: yes)*

A scenario the plan marked `**Visual:** yes` attaches a **`**Visual:**` evidence sub-block even on PASS** — the one deliberate exception to the one-line-PASS rule (see Writing rules). PASS still gets its one line; the sub-block adds the visual evidence beneath it:

`All steps passed.` <optional one-line note>

**Visual:** PASS
**Screenshot:** `artifacts/qa-run-TC-00N-<timestamp>.png` *(captured on the pass path for visual scenarios — the documented exception to "screenshots only on FAIL")*
**Geometry findings:** *(on a clean pass with no advisory findings, write `**Geometry findings:** none` and omit the table; render the table below only when at least one advisory finding was recorded)*

| Probe | Element(s) | Finding | Bucket |
|---|---|---|---|
| stuck-together (~0px gap) | `.toolbar button` × 2 | 0px gap where spacing expected | advisory |

Only the **advisory** buckets can appear on a PASS — a **hard-fail** probe (overlap, collapsed 0-size, off-screen positioning) fails the scenario, so it never shows up in a PASS geometry table. Advisory buckets are `clipping / overflow`, `stuck-together (~0px gap)`, and `low contrast`; list only the ones actually found.

**Vision review:** <rubric score / verdict — e.g. `PASS — alignment, spacing, no overlap/clipping, consistent sizing, controls read as controls`>

Field names are stable and machine-readable: `**Visual:**`, `**Screenshot:**`, `**Geometry findings:**`, `**Vision review:**`. This sub-block is **agentic-only** — the execution engine (`/wf:qa-auto` → `wf-caps:qa-engine`) captures the screenshot, runs the geometry probes, and scores the vision rubric, then writes the sub-block. A manual `/wf:qa-run` walkthrough has no way to produce the geometry probes or the rubric score, so in **manual mode** a `**Visual:** yes` scenario records `**Visual:** not evaluated — agentic only` in place of the sub-block. Reviewers grep the field names either way. A visual scenario that **FAILs** keeps the ordinary FAIL shape below (step/assertion table + `**Screenshot:**`) — no change to FAIL. **Scope:** *absolute* visual-defect evidence only (overlap, clipping/truncation, crowding, orphaned/mis-rendered, collapsed/oversized) — never visual-regression / golden-image pixel-diff output.

#### TC-002: <title> — FAIL@step2

| # | Action | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | <action> | <expected> | <observed> | PASS |
| 2 | <action> | <expected> | <observed — what actually happened> | FAIL |
| 3 | <action> | <expected> | — | not run (skipped after fail) |

**Failure notes:** <description from tester or agent>
**Screenshot:** `artifacts/qa-run-TC-002-<timestamp>.png` *(agentic mode only)*
**Fixtures:** 3 Users.Status updated then reverted *(agentic mode only)*

#### TC-003: <title> — BLOCKED

**Blocked at:** preconditions / step <N>
**Reason:** <description — e.g., "session expired before step 1", "browser tools unavailable", "required entity not found", "setup: schema metadata unavailable", "setup: backend host wired but API not rebuilt">
**Fixtures:** none *(agentic mode only)*

#### TC-004: <title> — PASS *(Type: API)*

API scenarios use the same verdict shape, with the **Assertions** table in place of the browser step table. PASS is one line:

`All assertions passed.` <optional one-line note, e.g. observed `200, array[3]`>

**Fixtures:** routed to existing endpoint `/api/provider-groups` *(or `scaffolded ephemeral backend host __qa/provider-groups then reverted`)*

#### TC-005: <title> — FAIL *(Type: API)*

| # | Assertion | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | HTTP status | 200 | 500 | FAIL |
| 2 | Response is an array | true | — | not run |

**Request:** `GET /api/provider-groups?accessLevelId=123`
**Failure notes:** <description — e.g., "500 Internal Server Error; body: unhandled null-reference in the handler">
**Response:** `artifacts/qa-api-TC-005-<timestamp>.json` *(agentic mode only — the API analog of a screenshot)*
**Fixtures:** scaffolded ephemeral backend host `__qa/provider-groups` then reverted *(agentic mode only)*

---

## Notes & Observations

Free-form notes recorded during the run (manual mode) or surfaced by the agent (agentic mode):

- TC-001 step 3: <observation>
- TC-005 step 2: <observation>

---

## Defects Found

| # | Scenario | Step | Severity | Description |
|---|---|---|---|---|
| 1 | TC-002 | step 2 | High | Save toast shows "Forbidden" instead of "Saved" — likely auth scope regression |

Severity rubric (default — projects can override in `_local/config.md` `qa-rules` if added later):

- **High** — data correctness, auth, security, or release-blocker (P0 scenario failed).
- **Medium** — UX or important flow regression (P1 scenario failed).
- **Low** — visual or polish issue (P2 scenario failed).

Omit the section entirely when the run is PASS — no defects, no header.
```

---

## Writing rules

- **PASS scenarios get one line.** No step-by-step table for passing scenarios — keeps the report scannable. **Exception — visual scenarios:** a scenario carrying `**Visual:** yes` in the plan attaches a `**Visual:**` evidence sub-block (screenshot path + geometry-findings table or "none" + vision-review verdict) beneath its one-line PASS — see the `TC-00N — PASS (Visual: yes)` shape above. This is the only permitted addition to a PASS line, and it applies **only** to visual scenarios; every other PASS stays a single line. The sub-block is **agentic-only** — in a manual `/wf:qa-run` walkthrough a `**Visual:** yes` scenario records `**Visual:** not evaluated — agentic only` instead (see the `TC-00N — PASS (Visual: yes)` shape above). Scope: absolute visual-defect evidence only, not visual-regression / pixel-diffing.
- **FAIL / BLOCKED scenarios get the full step table or block.** Show exactly where it broke and what the observed result was.
- **Traceability matrix is mandatory.** Every spec criterion (`SC-N`) appears, even when uncovered (mark `GAP`).
- **Baseline health scenarios are exempt from the matrix.** Scenarios marked `Validates: —` (the standing Baseline health suite `/wf:qa-gen` adds to every plan — browser `Validates: — (baseline health)` or backend `Validates: — (baseline health, API)`) don't map to an `SC-N` — list them only under Results by Suite, never as a matrix row. Their FAILs still flow into the Defects table normally (severity from priority: P1→Medium, P2→Low). The full-run check (`Validates: — (baseline health, full-run)`) is evaluated *after the whole loop* from session-wide console/network capture, with each finding attributed to the TC that was active when it fired; it is `Not run` on a partial or `--only` pass, since a session-wide sweep is only meaningful over a complete run.
- **Defects section omitted on PASS runs.** Don't write "Defects: none" — just don't render the section.
- **Status rule is mechanical.** Don't editorialize — the rules above determine PASS/FAIL/INCOMPLETE deterministically.
- **Manual and agentic reports are interchangeable.** A reviewer should not be able to tell which mode produced the report from the format alone — only the `Mode` field reveals it. This keeps the run-assistant pivot transparent.

---

## Stable IDs for the run-assistant contract

`TC-NNN` IDs from `06_qa.md` flow through the report verbatim. The agentic subagent emits its verdict block referencing the ID it received; the manual loop records verdicts under the same heading. A reviewer can grep `TC-005` across `06_qa.md` and `07_qa-report.md` and see the plan and result side by side.

`Validates: SC-N` lines mirror through too. The traceability matrix is a one-line-per-criterion roll-up of those `Validates` references.
