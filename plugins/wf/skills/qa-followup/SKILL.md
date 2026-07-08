---
name: qa-followup
description: Reads a QA run report (07_qa-report.md), triages every non-passing scenario into harness blocks, product defects, and escalations, then closes the loop in one run — fixes the test harness and re-runs blocked scenarios via /wf:qa-auto, writes a checkbox remediation plan (08_qa-fix.md) for the defects, gates on a single approval, applies the source fixes, and recommends a fresh QA pass to confirm. Use after /wf:qa-run or /wf:qa-auto when the report came back with FAIL or BLOCKED scenarios and you want them unblocked and fixed under a plan-then-implement discipline.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:qa-followup — Unblock and fix what the QA report found

Read `07_qa-report.md` (from `/wf:qa-run` or `/wf:qa-auto`), sort every non-PASS scenario into **unblock** (harness/environment blocks), **defect** (FAIL = product bug), and **escalate** (needs your input), then close the loop in a single run:

1. **Unblock** — change the *test harness* to clear the block: `/wf-caps:qa-host augment` an existing host to expose a control or observation a scenario needs (the common case — a host that pins an input value or hardcodes a value the scenario must vary is an augment, not an escalation), `/wf-caps:qa-host new` to scaffold a missing one, `/wf-caps:qa-host api-probe` to (re-)wire or resolve a backend endpoint for a `Type: API` scenario blocked on `Backend host required:` (or one BLOCKED because the API hadn't rebuilt), or just re-run after a transient session drop. Then re-execute those scenarios via `/wf:qa-auto --only`. New failures fold into the defect set.
2. **Plan** — read source to root-cause each defect and write a checkbox remediation plan to `08_qa-fix.md`, every step traced to its `TC-NNN` and `SC-N`.
3. **Gate** — present the plan and stop for a single approval.
4. **Implement** — apply the fixes to source on approval, ticking each step.
5. **Re-verify** — recommend a fresh `/wf:qa-auto` pass to confirm.

**This skill reads source for diagnosis and writes source to apply fixes** — it is the third skill (with `/wf:implement` and `/wf:verify-fix`) with source-write permission, and the only one in the QA chain allowed to open the hood. The black-box discipline of `/wf:qa-run` and `/wf:qa-auto` ends here: a QA report gives symptoms, not `file:line`, so the fix path is necessarily **diagnose → plan → implement**, never a blind patch.

For the white-box analog driven by a `/wf:verify-spec` audit (which cites `file:line` and can patch mechanically), use `/wf:verify-fix` instead.

---

## Prerequisites

**Before any other phase**, read `_local/config.md` for `{task-root}` and `{verify-command}`. If the file doesn't exist, stop and instruct the user to run `/wf:init` first. Never hardcode these values.

`07_qa-report.md` must exist in the task folder. If missing, stop: "No QA report found. Run `/wf:qa-run` or `/wf:qa-auto` first."

The report shape is documented in [`../qa-gen/references/report-format.md`](../qa-gen/references/report-format.md) — this skill parses that exact shape.

---

## Command Syntax

```
/wf:qa-followup [<id>] [--suite <name>] [--no-rerun] [--mode <nonstop|step>] [--plan-only]
```

### Arguments

| Argument            | Required | Description                                                                                                  |
| ------------------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `<id>`              | NO       | Task id — whatever shape the active tracker capability produces (opaque to core), or a local `T<NNN>` id when no tracker is registered. Falls back to inferring from the current branch (first 3+-digit run). |
| `--suite <name>`    | NO       | Limit follow-up to scenarios from one named suite in the report. Default: all suites.                        |
| `--no-rerun`        | NO       | Stage the harness fixes but do NOT auto re-run unblocked scenarios — print the `/wf:qa-auto --only` command for the user to run instead. Use when you want to inspect the harness changes first. |
| `--mode <mode>`     | NO       | Implementation mode after the gate: `nonstop` (default) applies all fixes; `step` pauses after each defect fix for review. Mirrors `/wf:implement`. |
| `--plan-only`       | NO       | Write `08_qa-fix.md` and stop at the gate without implementing — even if approved. Escape hatch for inspecting the plan or handing implementation off manually. |

Disambiguation: if a token contains a 3+-digit run, or exactly matches an existing task folder name under `{task-root}`, treat it as the id; anything starting with `--` is a flag. If `--suite` doesn't match a suite in the report, stop and list available suites.

---

## Direct provider resolution (how `current-branch-query` and `last-commit-timestamp-query` are reached)

Id inference, the Phase 2 branch gate, and the staleness check below all reach `current-branch-query` and `last-commit-timestamp-query` by the canonical resolve-once procedure — `invocation-runtime.ops.md` §"Direct provider resolution" (one `## Capabilities` read from `_local/config.md`, the default-absent `registryPath` value, plus one manifest+fragment read for the `delivery` surface; a plugin-anchored `Path` resolves through the self-heal home, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"). With zero readable `delivery` rows, both `current-branch-query` and `last-commit-timestamp-query` fall back silently to their plain-directory-safe cases — no error, no capability term surfaces. (qa-followup has no tracker-surface call site — it never fetches.)

---

## Safety Rules

**Allowed:**

- Read any file in the repo (sourcebot MCP tools preferred for code search; fall back to `Grep`/`Glob`).
- **Read application source for root-cause diagnosis.** This is the skill's defining capability — the QA runners forbid it; this skill requires it.
- **Edit source files**, but only to apply a fix described by a step in the `08_qa-fix.md` plan this run produced, and only after the approval gate (Phase 7) clears.
- Write `08_qa-fix.md` (and rotate `08_qa-fix.history.md`) ONLY inside the resolved task folder.
- Read-only resolution via `current-branch-query` and `last-commit-timestamp-query` (direct provider resolution to the `delivery` surface) for id inference, branch gating, and the staleness check. Working-tree/diff dirty-file inspection is a content-gathering read with no delivery operation of its own — described by outcome, never as a literal command.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 2 branch gate, and `subagent_type: wf:index` after writing the artifact. Both perform non-destructive operations only.
- Invoke `/wf-caps:qa-host` (`route` / `new` / `augment` for frontend test hosts; `api-probe` / `api-revert` for backend endpoints) to scaffold or resolve a test surface, and `/wf:qa-auto --only` to re-run unblocked scenarios. These own their own write permissions (including the ephemeral backend-host wiring, which `wf-caps:qa-host` reverts).

**Forbidden:**

- Editing source before the approval gate, or beyond what a `08_qa-fix.md` step describes. If a defect has no plan step (escalated), don't touch the code.
- Inventing a fix for a defect whose root cause you can't locate in source. That's an escalation, not a guess.
- Modifying `06_qa.md`, `01_spec.md`, `00_reqs.md`, or `07_qa-report.md` by hand. The report is updated only by re-running `/wf:qa-auto`; the upstream artifacts are read-only here.
- Running builds, tests, installs, or `{verify-command}` yourself — except the typecheck a plan step explicitly schedules (mirrors `/wf:implement`).
- Committing, staging, pushing, or any destructive version-control operation. The user reviews the diff and commits.
- "Fixing" a BLOCKED scenario by relaxing or rewriting the QA plan to dodge the block. The plan is the contract; unblock the harness, don't weaken the test.

---

## Phase 1: Resolve and load

1. **Resolve `<id>`.** If passed explicitly, use it verbatim as `{task-id}` — opaque, whatever shape the active tracker capability produces, or the local `T<NNN>` scheme. If omitted, resolve the current branch via `current-branch-query` (direct provider resolution to the `delivery` surface — see "Direct provider resolution" above) and extract the first 3+-digit run — the branch-inferred token. **Resolve that token against `{task-root}`**: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the branch-inferred token (mirroring `spec/SKILL.md`'s Validation-section resolution logic). Exactly one match — reuse that folder's full name as `{task-id}` verbatim. Zero matches — stop: "No task id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass it explicitly: `/wf:qa-followup <id>`." More than one match — stop: "No task id provided and the branch-inferred token `<token>` matches more than one task folder. Pass it explicitly: `/wf:qa-followup <id>`." If no numeric token can be extracted from the branch at all, stop: "No task id provided and none could be inferred from the current branch. Pass it explicitly: `/wf:qa-followup <id>`."
2. **Locate the task folder.** Compute `{task-root}/{task-id}/`. Stop if `07_qa-report.md` is missing (message above).
3. **Parse `07_qa-report.md`** per [`../qa-gen/references/report-format.md`](../qa-gen/references/report-format.md): the header (`Run date`, `Mode`, `Status`, `App`), the traceability matrix (`SC-N → scenarios → result`), each per-suite scenario block, and the Defects table. If the report has no `## Summary` and no per-suite results, stop: "Report is malformed — re-run `/wf:qa-auto`."
4. **Filter by `--suite`** if passed.
5. **Short-circuit on PASS.** If the report `Status` is `PASS` and there are zero FAIL and zero BLOCKED scenarios, emit `QA-FOLLOWUP — NOOP` and stop — nothing to follow up.

### Staleness note

`07_qa-report.md` carries no commit anchor, so this skill does a soft check: invoke `last-commit-timestamp-query` via **direct provider resolution** to the `delivery` surface (see "Direct provider resolution" above) and compare it against the report's own `Run date`. Interpret both values as calendar moments and compare chronologically — never a string compare. If the last-commit timestamp is after the report's `Run date`, print a one-line warning that some defects may already be addressed and continue — Phase 6 confirms each defect against current source before planning a fix, so a stale symptom is caught at diagnosis time. With zero matching delivery-provider rows, this falls back silently to a plain-directory-safe timestamp read (the contract's fallback) — no VCS invocation of any kind.

---

## Phase 2: Branch gate

Fixes belong on the branch the report was produced against. Extract the first 3+-digit run from `<id>` (whatever its shape) — call it `{numeric-id}`. This token is used **only** for the branch-name match below; it plays no role in the task folder, the task id, or any tracker operation, all of which use the opaque `<id>`/`{task-id}` form verbatim.

1. **Resolve delivery-surface ownership first** (the scope-equality filter from "Direct provider resolution" above, applied before any branch read). **Zero matching rows (bare-core mode)** — the branch gate is skipped entirely: no branch is resolved, `wf:branch` is not invoked, no error and no stop. Report "Branch gate skipped — no delivery provider registered (bare-core mode)." and continue to Phase 3. **One matching row** — resolve the current branch via `current-branch-query` (direct provider resolution to the `delivery` surface — see "Direct provider resolution" above), then apply steps 2–3.
2. **If the branch name contains `/{numeric-id}-`** — proceed.
3. **Otherwise** — invoke the **Task** tool with `subagent_type: wf:branch`, passing the task id `{task-id}` generically in prose. (Do NOT call `/wf:branch` — that loads its SKILL.md into this skill's context. The subagent is self-sufficient.) On `BRANCH — created`/`switched`/`already-active`, continue. On `BRANCH — Error`, stop and surface the reason.

---

## Phase 3: Triage

Walk every non-PASS scenario and sort it into exactly one bucket.

### UNBLOCK — a harness obstacle the skill can clear by changing the test harness

The scenario is `BLOCKED` (or FAILs only because the *test host* can't drive/observe what the step needs) and the obstacle is in the harness, not the product:

- **Host capability gap** — a host exists but the scenario can't run because it **pins a control** the scenario must drive, **lacks a control** to reach a required state, or **doesn't surface an observation** the scenario must watch (e.g. "host hardcodes a control the scenario must toggle", "no control to set a value the scenario must vary", "an output the scenario must observe is never surfaced"). → **augment the host** (Phase 5). **This is the common case, and augmenting the harness is this skill's primary job — escalate a host gap only when augmenting is genuinely impossible (see ESCALATE).** A gap is mechanically fixable whenever the needed control/observation maps to a public input/output on the target — the provider (`/wf-caps:qa-host augment`) owns the stack-specific mapping from a needed control/observation to the target's public surface. Each block reason names the *control or observation* the scenario needs by its public identifier, not a literal runtime value.
- **`Host required: <component>` not scaffolded / host typecheck failed** → scaffold the test-host (Phase 5).
- **`Backend host required:` not wired, or `setup: backend host wired but API not rebuilt`** (a `Type: API` scenario) → re-`/wf-caps:qa-host api-probe` the service, and if the block was "API not rebuilt", note that the backend host must be rebuilt before the re-run reaches it (the provider states the stack-specific rebuild step). This is a harness block, not a product defect — the endpoint behavior was never reached.
- **`session expired` / transient re-auth failure / `setup: no API token in session`** → no fix needed; a fresh re-run (with a live session) clears it.

### DEFECT — a product bug

The scenario is `FAIL` (observed ≠ expected at a step, or — for a `Type: API` scenario — the endpoint returned the wrong status/shape against an existing or correctly-wired endpoint). The fix is a source change, planned in Phase 6, root-caused in **the surface the scenario exercised** — a UI target for a browser FAIL, or the backend endpoint/service the scenario called for an API FAIL. A `Type: API` scenario that failed *only* because the endpoint wasn't wired or the backend host hadn't rebuilt is UNBLOCK, not DEFECT — the behavior was never reached. Newly-FAILed scenarios surfaced by the Phase 5 re-run join this bucket.

### ESCALATE — needs the user, no autonomous action

- **Environment/config blocks the skill cannot fix:** `setup: schema metadata unavailable` (mssql not configured), `setup: refused — app URL looks like production`, `auth failed` with wrong credentials, `Browser tools unavailable`. Each carries a precise remedy in Phase 8's escalation list.
- **Host gaps that augmenting can't reach:** the required state can't be produced through the target's public surface (the target would need an internal change to be testable), or the host still fails to typecheck after an augment attempt. A host gap that *does* map to the target's public surface is UNBLOCK, never ESCALATE — do not escalate a pinned-input / missing-control gap that augmenting can reach; augment it.
- **Defects with no locatable or no bounded fix:** root cause can't be found in source, the fix is cross-cutting/architectural, it would reverse a deliberate design choice, or it needs a product decision. When in doubt about a *defect*, ESCALATE — a wrong autonomous fix is worse than an open question. (When in doubt about a *harness gap*, try augmenting first — the cost of a no-op augment is low and reversible.)

---

## Phase 4: Print the triage

Before acting, print the buckets so the user sees the shape:

```
QA follow-up for {task-id} — <N> non-PASS scenarios

Unblock (<u>):
  TC-NNN  <block reason>  → <planned action>
Defects (<d>):
  TC-NNN step <K>  <one-line observed>  (<severity>)
Escalate (<e>):
  TC-NNN  <reason>
```

---

## Phase 5: Unblock pass

Skip this phase if the UNBLOCK bucket is empty.

1. **Apply harness fixes.** (Read `plugins/wf-caps/skills/qa-host/SKILL.md` once when first needed.)
   - **Host capability gap** → invoke `/wf-caps:qa-host augment <component>` with the gaps mapped to flags: `--control <control>` for each control the scenario must drive, `--observe <observation>` for each observation it must watch, `--show <control>` for each control it must read. Each flag names the *identifier* of the needed control/observation drawn from the block reason — never a literal runtime value: a control the scenario must toggle → `--control <that control>`; a missing control to set a state → `--control <that control>`; an observation never surfaced → `--observe <that observation>`. The provider (`/wf-caps:qa-host augment`) validates each identifier against the target's public surface and wires it; if it reports a control/observation it can't find, or the host fails to typecheck afterward, move that scenario to ESCALATE.
   - **`Host required` not scaffolded** → `/wf-caps:qa-host route <component>` first (cheap, no writes); if it reports "not scaffolded", `/wf-caps:qa-host new <component>`.
   - **`Backend host required:` (API scenario)** → `/wf-caps:qa-host api-probe <Service>.<method>`. It resolves the real endpoint or re-wires the ephemeral one; the re-run (`/wf:qa-auto --only`) reverts it again in teardown. If the block was `API not rebuilt`, surface to the user that the backend host must be rebuilt before the re-run will reach the endpoint (the provider names the stack-specific rebuild step) — that part the skill can't do for them.
   - **Transient-session** blocks need no fix — the re-run clears them.
2. **Collect the now-runnable TC list.**
3. **Re-run — unless `--no-rerun`.** Confirm the browser-automation tools (`open_browser_page`, …) are available. 
   - **Browser tools available** → invoke `/wf:qa-auto <id> --only <TC-list>` to re-execute just those scenarios. `/wf:qa-auto` drives them in-thread and overwrites their verdicts in `07_qa-report.md`.
   - **Browser tools unavailable, or `--no-rerun`** → degrade: skip the auto re-run, leave the scenarios BLOCKED, and record the exact `/wf:qa-auto <id> --only <TC-list>` command in `08_qa-fix.md`'s Next section for the user to run. (Same fallback `/wf:qa-auto` itself uses when browser tools are missing.)
4. **Re-read `07_qa-report.md`** for the updated verdicts. New `FAIL` → move to the DEFECT bucket. Still `BLOCKED` → move to ESCALATE with the new reason.

Record each unblock attempt and its re-run verdict in the `08_qa-fix.md` Unblock-pass table (Phase 6 writes the file).

---

## Phase 6: Diagnose and write the plan

**First, separate harness gaps from product defects.** If a defect's failing observation is a missing or pinned *test-host* affordance — a control or readout the host scaffold should provide, not a behavior of the target under test (e.g. observed "no toggle for an input the scenario must vary", "cannot set a value the scenario must drive", "an output's fire count never shown") — it is a harness gap, not a product bug. Reclassify it to UNBLOCK, `/wf-caps:qa-host augment` the host (Phase 5), re-run, and do **not** plan a product fix. Only the residue — divergences in the target's *own* behavior — proceeds through the steps below.

For each remaining DEFECT, in report order:

1. **Read the scenario** in `06_qa.md` (steps + expected) and trace its `Validates: SC-N` to `01_spec.md`/`00_reqs.md` for intent.
2. **Locate the root cause in source.** Search for the failing behavior (sourcebot preferred). Confirm the divergence is still present in current source — if the code already produces the expected behavior (the report was stale), record the defect as `[STALE]` in the log and reclassify to ESCALATE with reason "behavior matches expected on current source — re-run QA to confirm".
3. **Decide plannable vs escalate.** Plannable when the root cause is identifiable AND the fix is bounded (a few files, no design call). Otherwise ESCALATE.
4. **Write a checkbox step** per plannable defect into `08_qa-fix.md` using the template below, each traced to `TC-NNN` + `SC-N` + observed symptom + root-cause hypothesis.

Write `08_qa-fix.md` now (rotate any existing file into `08_qa-fix.history.md` first — same pattern as `/wf:verify-fix`: prepend the old contents above a `---` separator, newest first). The file holds the unblock-pass table, the remediation plan, the escalations, and an empty fix log that Phase 8 fills.

After writing, invoke `/wf:index <id> qa-fix "<u> unblocked · <d> planned · <e> escalated"`.

---

## Phase 7: Approval gate

Present the `08_qa-fix.md` plan and the triage summary, then ask via the IDE question tool: **Implement the fixes** / **Adjust the plan first** / **Stop here**.

- **Stop here**, or `--plan-only` was passed → emit `QA-FOLLOWUP — ABORTED` (plan written, not implemented) and stop.
- **Adjust** → take the user's edits to the plan, rewrite the affected steps, and re-present. Do not implement until they approve.
- **Implement** → proceed to Phase 8.

This is the plan-then-implement boundary: no source edit happens before this gate clears.

---

## Phase 8: Implement

For each plannable defect's step, in plan order (honor `--mode step` by pausing after each):

1. Read the target file(s) around the change site.
2. Apply the minimal edit the step describes — no adjacent cleanup, no fixing things the plan didn't cite.
3. Tick the step's checkbox in `08_qa-fix.md`.
4. Record the result in the fix log: `[FIXED]` with a one-line diff summary, `[FAILED]` with the error (stop that step, continue with the next — don't retry with a guess), or `[SKIPPED]` with the reason.

If a plan step schedules the `{verify-command}` typecheck, run it and record the result. Do not commit — `/wf:implement` and `/wf:verify-fix` both hand off to the user, and so does this skill.

---

## Phase 9: Re-verify, index, output

1. **Recommend a fresh QA pass.** The Phase 5 re-run is now stale for any scenario whose source you just changed. Recommend `/wf:qa-auto <id> --only <fixed-TC-list>` (or `--resume` for a full pass) to confirm the fixes land. This is the loop-closing analog of `/wf:verify-fix` → re-run `/wf:verify-spec`.
2. **Update the index** if any counts changed since Phase 6 (e.g., a defect reclassified to STALE): re-invoke `/wf:index <id> qa-fix "<summary>"`.
3. **Emit the final-output block** — the very last thing in chat.

---

## `08_qa-fix.md` Template

```markdown
# {task-id} — QA Follow-up

**Source report:** `07_qa-report.md` (run <date>, mode <manual|agentic>)
**Branch:** <branch>
**Model:** <model identifier>
**Triage:** <u> unblock · <d> defects · <e> escalate

---

## Unblock pass

| TC | Block reason | Action | Re-run verdict |
|---|---|---|---|
| TC-003 | Host required: FooComponent | scaffolded via /wf-caps:qa-host new | PASS |
| TC-005 | host pins an input the scenario must vary | augmented: /wf-caps:qa-host augment --control &lt;input&gt; | PASS |
| TC-006 | an output the scenario must watch is not observed | augmented: --observe &lt;output&gt; | FAIL@step3 → defect FIX-002 |
| TC-007 | session expired | re-ran | PASS |
| TC-009 | setup: schema unavailable | escalated (env config) | — |

*(omit this section if no scenarios were unblocked)*

---

## Remediation plan

- [ ] FIX-001: <title> — TC-002 / SC-1
- [ ] FIX-002: <title> — TC-007 / SC-3

### - [ ] FIX-001: <title>

**Defect:** TC-002 step 2 — observed "<observed>", expected "<expected>". Severity: <High|Medium|Low>
**Traces:** SC-1 — <criterion, abbreviated>
**Root cause:** <hypothesis from source — `path/to/file.ts` `symbol`>
**Change:**
- <plain-language change, not code>

**Files:**
| File | Action |
|---|---|
| `path/to/file.ts` | modify |

**Depends on:** —

---

## Escalations

- E1 `TC-009` — block: schema metadata unavailable. Remedy: configure `mssql_*` for the test DB (or point creds at a DB you can reach), then re-run `/wf:qa-followup <id>`.
- E2 `TC-005` defect — root cause ambiguous: <why>. Needs a product/design decision before a fix can be planned.

*(omit if empty)*

---

## Fix log

*(filled during Phase 8)*

1. [FIXED] FIX-001 — TC-002 — `path/to/file.ts:L` — <one-line diff summary>
2. [FAILED] FIX-002 — <tool error summary>

---

## Next

Re-run `/wf:qa-auto <id> --only TC-002,TC-007` to confirm the fixes, or `/wf:qa-auto <id> --resume` for a full pass.
```

---

## Edge Cases

- **Report is PASS / no non-PASS scenarios** — Phase 1 short-circuits to `QA-FOLLOWUP — NOOP`; no file written.
- **Only BLOCKED scenarios, all environment-level (nothing the skill can clear)** — Phase 5 is a no-op, Phase 6 plans nothing; everything lands in Escalations. Final output `ESCALATED`.
- **Host exists but is inadequate for the scenario** (pinned input, missing control, unwired output) — this is UNBLOCK, not ESCALATE: `/wf-caps:qa-host augment` the host with the right `--control`/`--observe`/`--show` flags and re-run. Escalate only if the needed state can't be reached through the target's public surface.
- **`/wf-caps:qa-host` reports the target already has a host but the scenario still blocks on it** — the block isn't "no host", so don't re-scaffold (`new` won't touch an existing host anyway). If it's a capability gap (pinned input / missing control / unwired output), `augment` the host and re-run. Only if the block is structural (routing/wiring broken, or the needed state isn't reachable through the public surface) reclassify to ESCALATE.
- **Re-run flips a BLOCKED scenario straight to PASS** — no defect, no plan step; record it in the unblock table as resolved. It counts toward `DONE`.
- **Re-run still BLOCKED after the harness fix** — move to ESCALATE with the new reason; the harness fix didn't take, and guessing further isn't safe.
- **`Type: API` scenario BLOCKED on `backend host wired but API not rebuilt`** — UNBLOCK the wiring via `api-probe`, but the re-run can't reach the endpoint until the backend host recompiles, which this skill can't trigger. Re-run once; if still BLOCKED for the same reason, ESCALATE with the remedy the provider names: rebuild the backend host so the ephemeral route goes live, then `/wf:qa-auto <id> --only <TC>`. Don't reclassify it as a defect — the behavior was never exercised.
- **API defect vs. wiring block** — only treat a `Type: API` FAIL as a DEFECT when the endpoint was actually reached (real or correctly-wired endpoint) and returned the wrong status/shape. A 404/connection failure on a `__qa` route is a wiring/rebuild block (UNBLOCK), not a product bug.
- **Defect's behavior already matches expected on current source** (stale report) — record `[STALE]`, reclassify to ESCALATE, recommend re-running QA. Don't fabricate a fix for a symptom that's gone.
- **Browser tools unavailable** — Phase 5 degrades to staging the harness fix and emitting the `--only` command; the unblocked scenarios stay BLOCKED until the user re-runs. Defect planning + implementation still proceed for FAIL scenarios.
- **User declines at the gate / `--plan-only`** — `08_qa-fix.md` is written, no source touched. Final output `ABORTED`. Re-invoke later to implement.
- **A plan step's target moved since diagnosis** — if the cited code is no longer where Phase 6 found it, record `[SKIPPED]` with the reason and reclassify the defect to ESCALATE; don't relocate by guess.
- **No `07_qa-report.md`** — stop, say "Run `/wf:qa-run` or `/wf:qa-auto` first."

---

## Final Output

```
QA-FOLLOWUP — <DONE | PARTIAL | ESCALATED | ABORTED | NOOP>

Task:       {task-id}
Unblocked:  <u> attempted · <r> resolved to PASS · <b> still blocked → escalated
Defects:    <d> planned · <f> fixed · <x> failed/skipped
Escalated:  <e>

Plan/log:   {task-root}/{task-id}/08_qa-fix.md

<if any escalations:>
Open items:
  • <E1 one-liner>
  • <E2 one-liner>

<if DONE or PARTIAL:>
Confirm with: /wf:qa-auto {task-id} --only <fixed-TC-list>

<if ABORTED:>
Plan written, nothing implemented. Re-run /wf:qa-followup {task-id} to apply.
```

State meanings:
- `DONE` — every defect fixed and every block resolved to PASS; nothing escalated.
- `PARTIAL` — at least one fix or unblock landed, with escalations or failed steps remaining.
- `ESCALATED` — no autonomous action was possible; everything needs the user.
- `ABORTED` — plan written, gate declined (or `--plan-only`); no source changed.
- `NOOP` — report was PASS; nothing to follow up.

**The final-output block must always be the very last thing output to chat.**
