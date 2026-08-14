---
name: qa-followup
description: Reads a QA run report (07_qa-report.md), triages every non-passing scenario into harness blocks, product defects, and escalations, then closes the loop in one run — fixes the test harness and re-runs blocked scenarios via /wf:qa-auto, writes a checkbox remediation plan (08_qa-fix.md) for the defects, gates on a single approval, applies the source fixes, and recommends a fresh QA pass to confirm. Use after /wf:qa-run or /wf:qa-auto when the report came back with FAIL or BLOCKED scenarios and you want them unblocked and fixed under a plan-then-implement discipline.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task, Skill]
---

# /wf:qa-followup — Unblock and fix what the QA report found

Read `07_qa-report.md` (from `/wf:qa-run` or `/wf:qa-auto`), sort every non-PASS scenario into **unblock** (harness/environment blocks), **defect** (FAIL = product bug), and **escalate** (needs your input), then close the loop in a single run:

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

1. **Unblock** — change the *test harness* to clear the block via the registered `qa-execution` host provider (its ownership gated by the resolver's host record and its subagent dispatch from `resolve_registry`; see Phase 5). Core sends stable scenario markers and exact public-surface identifiers in a private provider-neutral lifecycle request; the owning provider chooses native preparation, returns safe readiness, and is torn down after `/wf:qa-auto --only` re-executes those scenarios. New failures fold into the defect set.
2. **Plan** — read source to root-cause each defect and write a checkbox remediation plan to `08_qa-fix.md`, every step traced to its `TC-NNN` and `SC-N`.
3. **Gate** — present the plan and stop for a single approval.
4. **Implement** — apply the fixes to source on approval, ticking each step.
5. **Re-verify** — recommend a fresh `/wf:qa-auto` pass to confirm.

**This skill reads source for diagnosis and writes source to apply fixes** — it is the third skill (with `/wf:implement` and `/wf:verify-fix`) with source-write permission, and the only one in the QA chain allowed to open the hood. The black-box discipline of `/wf:qa-run` and `/wf:qa-auto` ends here: a QA report gives symptoms, not `file:line`, so the fix path is necessarily **diagnose → plan → implement**, never a blind patch.

For the white-box analog driven by a `/wf:verify-spec` audit (which cites `file:line` and can patch mechanically), use `/wf:verify-fix` instead.

---

## Prerequisites

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, verifyCommand, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). `{task-root}` is `coreConfig.taskRoot`; `{verify-command}` is `coreConfig.verifyCommand`. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. Never hardcode these values.

`07_qa-report.md` must exist in the task folder. If missing, stop: "No QA report found. Run `/wf:qa-run` or `/wf:qa-auto` first."

The report shape is documented in `qa-gen`'s `report-format.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: qa-gen`, `ref: report-format.md`), never a raw `Read` of the plugin-cache path — this skill parses that exact shape.

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

Id inference, the Phase 2 branch gate, and the staleness check below all reach `current-branch-query` and `last-commit-timestamp-query` by calling the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface: "delivery" })` — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, candidates?, degradation }` for the `delivery` surface. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); core performs **no** registry / manifest / plugin-root read of its own. Obtain each op's body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in this skill's own context to reach both queries — never a raw `Read` of the path (the metadata queries return only paths/metadata; the body comes from `resolve_content({ workspaceRoot, ... })`). On `state: unconfigured`/`unrecoverable` (no readable `delivery` provider), both `current-branch-query` and `last-commit-timestamp-query` fall back silently to their plain-directory-safe cases — no error, no capability term surfaces. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery). (qa-followup has no tracker-surface call site — it never fetches.)

---

## Safety Rules

**Allowed:**

- Read any file in the repo (sourcebot MCP tools preferred for code search; fall back to `Grep`/`Glob`).
- **Read application source for root-cause diagnosis.** This is the skill's defining capability — the QA runners forbid it; this skill requires it.
- **Edit source files**, but only to apply a fix described by a step in the `08_qa-fix.md` plan this run produced, and only after the approval gate (Phase 7) clears.
- Write `08_qa-fix.md` (and rotate `08_qa-fix.history.md`) ONLY inside the resolved task folder.
- Read-only resolution via `current-branch-query` and `last-commit-timestamp-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query) for id inference, branch gating, and the staleness check. Working-tree/diff dirty-file inspection is a content-gathering read with no delivery operation of its own — described by outcome, never as a literal command.
- Invoke the **Task** tool with `subagent_type: wf:branch` for the Phase 2 branch gate. Invoke `/wf:index` only through the **Skill** tool after writing the artifact so its wrapper owns routing.
- Invoke the registered `qa-execution` host provider through a provider-neutral prepare/teardown Task lifecycle, write only its mode-`0600` readiness handoff under `_local/scratch/wf/qa-auto/`, and invoke `/wf:qa-auto --only` to consume it and re-run unblocked scenarios. The provider owns native host writes; qa-auto owns finally-equivalent teardown.

**Forbidden:**

- Editing source before the approval gate, or beyond what a `08_qa-fix.md` step describes. If a defect has no plan step (escalated), don't touch the code.
- Inventing a fix for a defect whose root cause you can't locate in source. That's an escalation, not a guess.
- Exposing a host lifecycle token in chat, artifacts, or provider evidence; it stays only in the private handoff and host Task request.
- Modifying `06_qa.md`, `01_spec.md`, `00_reqs.md`, or `07_qa-report.md` by hand. The report is updated only by re-running `/wf:qa-auto`; the upstream artifacts are read-only here.
- Running builds, tests, installs, or `{verify-command}` yourself — except the typecheck a plan step explicitly schedules (mirrors `/wf:implement`).
- Committing, staging, pushing, or any destructive version-control operation. The user reviews the diff and commits.
- "Fixing" a BLOCKED scenario by relaxing or rewriting the QA plan to dodge the block. The plan is the contract; unblock the harness, don't weaken the test.

---

## Phase 1: Resolve and load

1. **Resolve `<id>`.** Resolve the task id per the shared pipeline conventions doc — obtained via the `wf-resolver` MCP tool `resolve_content({ workspaceRoot, ... })` (`class: shared`, `ref: pipeline-conventions.md`), never a raw `Read` of the plugin-cache path — §"Id inference from the current branch" (explicit `<id>` used verbatim; otherwise inferred from the branch via `current-branch-query` — the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution" above — and resolved against `{task-root}`), naming `/wf:qa-followup` in its stop messages.
2. **Locate the task folder.** Compute `{task-root}/{task-id}/`. Stop if `07_qa-report.md` is missing (message above).
3. **Parse `07_qa-report.md`** per `qa-gen`'s `report-format.md` (obtained via `resolve_content({ workspaceRoot, ... })`, `class: references-template`, `skill: qa-gen`, `ref: report-format.md` — see Prerequisites above): the header (`Run date`, `Mode`, `Status`, `App`), the traceability matrix (`SC-N → scenarios → result`), each per-suite scenario block, the optional `## Capability gaps` section, and the Defects table. A capability-gaps section carrying either exact marker `**Host availability:** unavailable` or `**Host preparation:** failed` is one run-level capability condition even when it names multiple `TC-NNN` IDs. If the report has no `## Summary`, no per-suite results, and neither marker, stop: "Report is malformed — re-run `/wf:qa-auto`."
4. **Filter by `--suite`** if passed.
5. **Short-circuit on PASS.** If the report `Status` is `PASS`, there are zero FAIL and zero BLOCKED scenarios, **and no `## Capability gaps` section**, emit `QA-FOLLOWUP — NOOP` and stop — nothing to follow up.

### Staleness note

`07_qa-report.md` carries no commit anchor, so this skill does a soft check per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`) §"Report/spec staleness check": compare `last-commit-timestamp-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution" above) against the report's own `Run date`. If the branch has moved since, print a one-line warning that some defects may already be addressed and continue — Phase 6 confirms each defect against current source before planning a fix, so a stale symptom is caught at diagnosis time.

---

## Phase 2: Branch gate

Fixes belong on the branch the report was produced against. Extract the first 3+-digit run from `<id>` (whatever its shape) — call it `{numeric-id}`. This token is used **only** for the branch-name match below; it plays no role in the task folder, the task id, or any tracker operation, all of which use the opaque `<id>`/`{task-id}` form verbatim.

Gate on the task branch per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`) §"Branch gate (bare-core aware)", using `{numeric-id}` for the branch-name match. On the bare-core skip, report it and continue to Phase 3.

---

## Phase 3: Triage

Walk every non-PASS scenario and each aggregate capability condition into exactly one bucket. A `## Capability gaps` entry containing either exact marker `**Host availability:** unavailable` or `**Host preparation:** failed` is one category and one escalation regardless of the number of affected `TC-NNN` IDs; do not expand it into synthetic per-scenario blocks.

### UNBLOCK — a harness obstacle the skill can clear by changing the test harness

The scenario is `BLOCKED` (or FAILs only because the *test host* can't drive/observe what the step needs) and the obstacle is in the harness, not the product:

- **Host capability gap** — a host exists but the scenario pins a control, lacks a control for required state, or omits an observation that maps to the target's public surface. For each exact public identifier add one stable `Host operation target: augment | <control|observation> | <public-identifier>` line to Phase 5's private provider-neutral request; the owning provider maps it to native behavior. Escalate only when the provider says the public surface cannot satisfy the request.
- **`Host required: <target>` not prepared / host validation failed** → send that stable scenario marker through the same provider-neutral lifecycle request; core does not choose a scaffold or route command.
- **`Backend host required:` not exposed, or provider reports an external rebuild requirement** (a `Type: API` scenario) → send the stable marker through provider preparation. If readiness still depends on a rebuild/configuration action, surface the provider's redacted remedy and escalate rather than inventing a command. This is a harness block, not a product defect, because endpoint behavior was never reached.
- **`session expired` / transient re-auth failure / `setup: no API token in session`** → no fix needed; a fresh re-run (with a live session) clears it.

### DEFECT — a product bug

The scenario is `FAIL` (observed ≠ expected at a step, or — for a `Type: API` scenario — the endpoint returned the wrong status/shape against an existing or correctly-wired endpoint). The fix is a source change, planned in Phase 6, root-caused in **the surface the scenario exercised** — a UI target for a browser FAIL, or the backend endpoint/service the scenario called for an API FAIL. A `Type: API` scenario that failed *only* because the endpoint wasn't wired or the backend host hadn't rebuilt is UNBLOCK, not DEFECT — the behavior was never reached. Newly-FAILed scenarios surfaced by the Phase 5 re-run join this bucket.

### ESCALATE — needs the user, no autonomous action

- **Host provider unavailable** — one aggregate `## Capability gaps` entry with the exact `**Host availability:** unavailable` marker means the selected host-dependent scenarios were never dispatched. Create **one** escalation, listing the aggregate's affected `TC-NNN` IDs once: register a `qa-execution:host` provider, regenerate the QA plan with `/wf:qa-gen <id>` so those scenarios no longer carry the unavailable marker, then run a fresh full pass with `/wf:qa-auto <id>` because regeneration may renumber scenario IDs. Do not invoke Phase 5, attempt host operations, or create one escalation per scenario while the provider is absent.
- **Host preparation failed** — one aggregate entry with `**Host preparation:** failed` means an owned provider did not reach ready. Create one escalation for all affected IDs. If its `Teardown` is FAIL, recovery via `/wf:qa-auto --resume` is the only next action; otherwise direct the user to correct the provider profile/environment and rerun the affected selection. Never expose or reconstruct its private lifecycle token.
- **Environment/config blocks the skill cannot fix:** `setup: schema metadata unavailable` (the persistence metadata provider is not configured), `setup: refused — app URL looks like production`, `auth failed` with wrong credentials, `Browser tools unavailable`. Each carries a precise remedy in Phase 8's escalation list.
- **Host gaps that augmenting can't reach:** the required state can't be produced through the target's public surface (the target would need an internal change to be testable), or the host still fails to typecheck after an augment attempt. A host gap that *does* map to the target's public surface is UNBLOCK, never ESCALATE — do not escalate a pinned-input / missing-control gap that augmenting can reach; augment it.
- **Defects with no locatable or no bounded fix:** root cause can't be found in source, the fix is cross-cutting/architectural, it would reverse a deliberate design choice, or it needs a product decision. When in doubt about a *defect*, ESCALATE — a wrong autonomous fix is worse than an open question. (When in doubt about a *harness gap*, try augmenting first — the cost of a no-op augment is low and reversible.)

---

## Phase 4: Print the triage

Before acting, print the buckets so the user sees the shape:

```
QA follow-up for {task-id} — <N> non-PASS scenarios · <G> capability gaps

Unblock (<u>):
  TC-NNN  <block reason>  → <planned action>
Defects (<d>):
  TC-NNN step <K>  <one-line observed>  (<severity>)
Escalate (<e>):
  <if host unavailable:> Host availability unavailable — TC-NNN, TC-NNN → register a host provider, regenerate the QA plan, then run a fresh full pass
  <if host prepare failed:> Host preparation failed — TC-NNN, TC-NNN → recover teardown or correct provider configuration, then re-run
  <otherwise:> TC-NNN  <reason>
```

---

## Phase 5: Unblock pass

Skip this phase if the UNBLOCK bucket is empty.

1. **Apply harness fixes** by dispatching to the registered `qa-execution` host provider, resolved through two `wf-resolver` queries (the resolver has already walked the `## Capabilities` registry and every `manifest.md`; core never names or reads the provider's own skill file):
   - **Registration gate** — `resolve_provider({ workspaceRoot, surface: "qa-execution:host" })` returns `{ surface, owner, fragmentPath, state, … }` for the `host` surface. On `state: unconfigured`/`unrecoverable` (no host provider registered), the graceful no-host path applies — leave the scenario blocked with its scope reason and escalate, exactly as when augmenting can't reach the target's public surface. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (WF-272 diagnostics/recovery).
   - **Dispatch target** — on `state: ok`, call `resolve_registry({ workspaceRoot, ... })` and locate the fragment whose `phase` is `qa-execution`, `contributionKind` is `provider`, and `scope` is `host`; its `dispatch` (`subagent: <agent>`) names the Task-tool dispatch target for the host operations below (the provider record's `owner` is the capability name and its `fragmentPath` is `null` for a subagent-dispatched provider — the agent name lives only in the fragment `dispatch`). Validate the token as a registered Task target and derive its stable routing `role` from the final colon-delimited slug; core never hardcodes the provider or target.
   - <!-- capability-route:qa-host --> **Route every host operation** — immediately before each initial or repeated Task attempt, call `resolve_routing` with `workspaceRoot: <absolute pwd -P workspace root>`, the derived role, a canonical `unitIds: ["qa-followup:host:<operation>:<target>"]`, `supportsModelSelector: true`, `supportsEffortSelector: false`, and `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "elevated", toolWork: "material", validation: "mechanical", contextIsolation: "required", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`. Include `actualModel` only when exposed and emit the compact operational record separately from artifact attribution. A `status: stop`, diagnostic, malformed derived role, or non-`isolated` shape stops before host work as runtime-inapplicable. Otherwise invoke exactly one Task, passing `model.value` only when non-null and no effort selector. The `qa-followup` parent validates the `QA-HOST` block and exclusively owns any `postAttempt`, retaining the same unit id and evidence; the host never self-replaces.
   - **Provider-neutral lifecycle request** — never invoke provider-specific `augment`, `route`, `new`, or probe command names from core. Generate a cryptographically random run id plus a lifecycle token encoded as exactly 64 lowercase hexadecimal characters from 32 CSPRNG bytes, and a private mode-`0600` qa-auto handoff state under `_local/scratch/wf/qa-auto/` using the same symlink/ownership rules as `/wf:qa-auto`. Through the routed host Task, send `Intent: prepare`, the affected complete scenario blocks, and exact operation metadata: host-control/observation gaps add one `Host operation target: augment | <control|observation> | <public-identifier>` marker per requirement; `Host required:` and `Backend host required:` remain their stable markers. The provider agent maps those markers to its native operations and returns safe readiness plus teardown ownership. On non-ready, route teardown immediately and move the scenario to ESCALATE.
   - **Private qa-auto handoff** — after ready, atomically persist the exact private state fields `{ runId, lifecycleToken, taskId, state: "ready", handoff: "qa-followup", affectedScenarioIds, safeReadiness }`; `taskId` is the opaque caller id stored as content and `runId` is the same authenticated host lifecycle prepared above. Do not modify `06_qa.md`, print the token, or leave provider state outside this lifecycle. The subsequent targeted qa-auto rerun consumes exactly this handoff, skips duplicate host prepare, forwards safe readiness to the engine, and owns finally-equivalent teardown/deletion. A mismatched task/scenario set or second consumer is rejected before engine work.
   - **Provider-specific follow-up** — if the provider reports that the requested public-surface augmentation/exposure is unsupported, or readiness requires an external rebuild/configuration action, move the affected scenario to ESCALATE with that redacted remedy. Core never invents the stack-specific command.
   - **Transient-session** blocks need no host request — the re-run clears them.
2. **Collect the now-runnable TC list.**
3. **Re-run — unless `--no-rerun`.** Confirm the browser-automation tools (`open_browser_page`, …) are available.
   - **Browser tools available** → immediately before each initial or repeated Skill-tool attempt, call `resolve_routing` with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "qa-auto"`, `unitIds: ["qa-followup:qa-auto"]`, `shapeEvidence: { workSurface: "caller-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "none", validation: "mechanical", contextIsolation: "none", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: false`, and `supportsEffortSelector: false`. Include `actualModel` only when the host exposes it and emit the compact operational record. Hard-stop the rerun on `status: stop` or non-null `diagnostic`; otherwise obey the selected `inline` shape, pass no selectors, and invoke `/wf:qa-auto <id> --only <TC-list>`. The `qa-followup` parent evaluates the returned QA verdict and owns any contract-defined `postAttempt`; the child never invokes its own replacement. The selected QA Skill drives the scenarios in-thread and overwrites their verdicts in `07_qa-report.md`.
   - **Browser tools unavailable, or `--no-rerun`** → degrade: skip the auto re-run, leave the scenarios BLOCKED, and record the exact `/wf:qa-auto <id> --only <TC-list>` command in `08_qa-fix.md`'s Next section for the user to run. (Same fallback `/wf:qa-auto` itself uses when browser tools are missing.)
4. **Re-read `07_qa-report.md`** for the updated verdicts. New `FAIL` → move to the DEFECT bucket. Still `BLOCKED` → move to ESCALATE with the new reason.

Record each unblock attempt and its re-run verdict in the `08_qa-fix.md` Unblock-pass table (Phase 6 writes the file).

---

## Phase 6: Diagnose and write the plan

**First, separate harness gaps from product defects.** If a failing observation is a missing or pinned *test-host* affordance — a control or readout the host should provide, not target behavior — reclassify it to UNBLOCK, encode each exact public identifier in a `Host operation target: augment | <control|observation> | <public-identifier>` marker in Phase 5's private provider-neutral request, re-run, and do **not** plan a product fix. Only the residue — divergences in the target's own behavior — proceeds below.

For each remaining DEFECT, in report order:

1. **Read the scenario** in `06_qa.md` (steps + expected) and trace its `Validates: SC-N` to `01_spec.md`/`00_reqs.md` for intent.
2. **Locate the root cause in source.** Search for the failing behavior (sourcebot preferred). Confirm the divergence is still present in current source — if the code already produces the expected behavior (the report was stale), record the defect as `[STALE]` in the log and reclassify to ESCALATE with reason "behavior matches expected on current source — re-run QA to confirm".
3. **Decide plannable vs escalate.** Plannable when the root cause is identifiable AND the fix is bounded (a few files, no design call). Otherwise ESCALATE.
4. **Write a checkbox step** per plannable defect into `08_qa-fix.md` using the template below, each traced to `TC-NNN` + `SC-N` + observed symptom + root-cause hypothesis.

Write `08_qa-fix.md` now (rotate any existing file into `08_qa-fix.history.md` first, per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`) §"Artifact rotation into `.history.md`"). The file holds the unblock-pass table, the remediation plan, the escalations, and an empty fix log that Phase 8 fills.

After writing, invoke the routed `/wf:index <id> qa-fix "<u> unblocked · <d> planned · <e> escalated"` wrapper. The wrapper owns fixed `index` routing; do not inline it.

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
2. **Update the index** if any counts changed since Phase 6 (e.g., a defect reclassified to STALE): re-invoke the routed `/wf:index <id> qa-fix "<summary>"` wrapper; never bypass its routing decision.
3. **Emit the final-output block** — the very last thing in chat.

---

## `08_qa-fix.md` Template

The verbatim `08_qa-fix.md` template — the metadata block, `## Unblock pass` table,
`## Remediation plan` (`### - [ ] FIX-NNN:` step shape), `## Escalations`, `## Fix log`,
and `## Next` — lives at `qa-fix-template.md`, obtained via the resolver's
`resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: qa-followup`, `ref:
qa-fix-template.md`), never a raw `Read` of the plugin-cache path.
It is read only on this write path (Phase 6), so it stays out of the boot body. Follow it,
then emit it with placeholders substituted; rotate any existing file into
`08_qa-fix.history.md` first.

---

## Edge Cases

- **Report is PASS / no non-PASS scenarios** — Phase 1 short-circuits to `QA-FOLLOWUP — NOOP`; no file written.
- **Only one host-unavailable capability gap** — parse the aggregate `## Capability gaps` entry carrying `**Host availability:** unavailable` as one ESCALATE item, list its affected IDs once, and write one remediation: register a `qa-execution:host` provider, regenerate with `/wf:qa-gen <id>`, then run a fresh full `/wf:qa-auto <id>` pass because regeneration may renumber scenarios. Do not dispatch host work or multiply it into per-scenario escalations.
- **Only one host-preparation capability gap** — parse `**Host preparation:** failed` as one ESCALATE item. Teardown FAIL routes only to private-state recovery with `/wf:qa-auto --resume`; teardown PASS routes to provider profile/environment correction and a targeted rerun.
- **Only BLOCKED scenarios, all environment-level (nothing the skill can clear)** — Phase 5 is a no-op, Phase 6 plans nothing; everything lands in Escalations. Final output `ESCALATED`.
- **Host exists but is inadequate for the scenario** (pinned input, missing control, unwired output) — this is UNBLOCK when the required state maps to the target's public surface. Encode each exact identifier with the stable `Host operation target:` marker in the provider-neutral private request and let the provider choose native behavior; escalate when it reports the surface cannot be reached.
- **The provider reports an existing host but the scenario still blocks** — send each missing public-surface requirement once with the same stable marker through the private handoff; never hardcode a scaffold/route/augment command in core. A structural wiring failure or unreachable requirement escalates.
- **Re-run flips a BLOCKED scenario straight to PASS** — no defect, no plan step; record it in the unblock table as resolved. It counts toward `DONE`.
- **Re-run still BLOCKED after the harness fix** — move to ESCALATE with the new reason; the harness fix didn't take, and guessing further isn't safe.
- **API scenario blocked after provider preparation** — if the provider reports an external rebuild/configuration requirement, re-run once only when it is already satisfied; otherwise ESCALATE with the provider's redacted remedy. Do not name a provider-native probe command or reclassify unexercised behavior as a defect.
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
