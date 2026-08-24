---
name: qa-auto
description: Orchestrates an autonomous QA run over 06_qa.md — resolves the task and plan, enforces the branch gate, coordinates any registered host provider around engine execution, manages run lifecycle (resume / --batch / --only), and assembles 07_qa-report.md from provider verdicts. Domain-free — it names no stack and drives no browser or host itself. Use when you want a hands-off run; pair with /wf:qa-run for human-in-the-loop runs.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task, Skill]
---

# /wf:qa-auto — Agentic QA run orchestrator

Orchestration shim for an autonomous run of `06_qa.md`. It owns the run **lifecycle** — resolving the task and plan, the branch gate, resume / `--batch` / `--only`, optional host-provider prepare/teardown, incremental report assembly, and the full-run console/network baseline rollup — and dispatches execution to the providers registered for the `qa-execution` surfaces. It does not drive a browser, touch persistence, or scaffold a host itself. Verdicts are recorded into `07_qa-report.md` incrementally so a context overflow or engine crash does not lose completed work; host teardown remains a parent-owned finally-equivalent action on every exit after prepare.

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

For a human-in-the-loop run, use `/wf:qa-run` — the same plan, the same report format (`qa-gen`'s `report-format.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` — `class: references-template`, `skill: qa-gen`, `ref: report-format.md` — never a raw `Read` of the plugin-cache path), only the `Mode` and `Tester` fields differ.

---

## How execution is supplied (the provider dispatch)

`qa-auto` is **domain-free orchestration**. Scenario execution is partitioned between two registry-owned provider surfaces. The required `engine` provider drives scenarios and returns verdict blocks. The optional `host` provider establishes and reverses temporary execution surfaces or fixtures for scenarios whose preconditions require them. Core resolves each surface with `resolve_provider({ workspaceRoot, surface: "qa-execution:<surface>" })`, then obtains the owning fragment's `subagent: <agent>` Task target from `resolve_registry({ workspaceRoot, ... })`; it never reads a registry or manifest body itself. For host-dependent work, core sends the selected scenario blocks and a deterministic run id to the resolved host subagent in a provider-neutral prepare request, forwards its safe readiness result to the engine, and sends a teardown request in a parent-owned finally-equivalent path after every engine return, error, abort, or routing stop. Provider-native agents choose their own operations; core neither names a capability nor executes host commands.

If **no** `qa-execution` engine provider is registered, core stops:

```
No qa-execution engine registered. An execution capability must
be active in _local/config.md's ## Capabilities table to drive scenarios. See the
capability's manifest for registration, then re-run.
```

This is the provider analog of the inert-phase no-op: when the provider an orchestrator strictly needs for a phase is absent, core stops with a clear, capability-agnostic message rather than silently passing.

---

## Prerequisites

Obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, qaBaselineIgnore, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop with: "Run `/wf:init` first." If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. From `coreConfig`: `{task-root}` (`taskRoot`); `{qa-baseline-ignore}` (`qaBaselineIgnore`, the allowlist of known-benign console messages / request patterns the Baseline health scenarios tolerate) — treat an absent value as an empty list, pass it through to the engine. The `qa-execution` engine provider is resolved separately — a `resolve_provider({ workspaceRoot, surface: "qa-execution:engine" })` registration gate plus the engine fragment's `dispatch` target from `resolve_registry({ workspaceRoot, ... })` (see "How execution is supplied").

`06_qa.md` must exist in the task folder.

This skill depends on two runtime capabilities:

1. **A registered `qa-execution` engine provider** — its ownership gated by the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "qa-execution:engine" })` record and its subagent dispatch target sourced from `resolve_registry({ workspaceRoot, ... })` (see "How execution is supplied"). If none is registered (record `state: unconfigured`), stop with the message above.
2. **An optional `qa-execution` host provider** — resolve it once per run through `resolve_provider({ workspaceRoot, surface: "qa-execution:host" })` before engine dispatch. It is not a global gate: host-independent scenarios continue without one. Host-dependent scenarios are withheld with one capability gap when ownership is absent, or are wrapped in the resolved provider's prepare → engine → teardown lifecycle when ownership is present.
3. **The Task tool** — used for the `wf:branch` branch gate plus host and engine provider dispatch. If Task invocation is unavailable, stop and direct the user to a manual `/wf:qa-run`.
4. **The Skill tool** — invokes the routed `/wf:index` wrapper after report assembly.

---

## Command Syntax

```
/wf:qa-auto [<id>] [--suite <suite-name>] [--reset-creds] [--batch <N>] [--resume] [--only <TC-list>]
```

### Arguments

| Argument           | Required | Description                                                                                       |
| ------------------ | -------- | ------------------------------------------------------------------------------------------------- |
| `<id>`             | NO       | Task id — whatever shape the active tracker capability produces (opaque to core), or a local `T<NNN>` id when no tracker is registered. Falls back to inferring from the current branch (first 3+-digit run). |
| `--suite <name>`   | NO       | Run only one named suite from `06_qa.md`. Passed through to the engine.                            |
| `--reset-creds`    | NO       | Forwarded to the engine — re-prompt for credentials and overwrite its creds file.                 |
| `--batch <N>`      | NO       | Stop after N scenarios for a manual context reset. Default 25. Pair with `--resume` to continue.   |
| `--resume`         | NO       | Resume from the first un-verdicted scenario in an existing `07_qa-report.md`.                     |
| `--only <TC-list>` | NO       | Re-execute exactly the listed scenarios (comma-separated `TC-NNN`) regardless of their current verdict, overwriting just their results in an existing `07_qa-report.md` and leaving every other scenario untouched. For targeted re-runs — e.g. after `/wf:qa-followup` clears a block. Requires an existing report. |

Disambiguation: if a token contains a 3+-digit run, or exactly matches an existing task folder name under `{task-root}`, treat it as the id; `--`-prefixed tokens are flags. The token after `--only` is its comma-separated scenario list, not the id.

---

## Direct provider resolution (how `current-branch-query` is reached)

Id inference and the Phase 2 branch gate both reach `current-branch-query` by calling the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface: "delivery" })` — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }` for the `delivery` surface. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); core performs **no** registry / manifest / plugin-root read of its own. Obtain the op body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in this skill's own context to reach `current-branch-query` — never a raw `Read` of the path (the metadata queries return only paths/metadata; the body comes from `resolve_content({ workspaceRoot, ... })`). On `state: unconfigured` (no `delivery` provider registered), `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery). (qa-auto has no tracker-surface call site — it never fetches.)

---

## Safety Rules

**Allowed:**

- Read any file in the project.
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query) for id inference and branch gating.
- Write `07_qa-report.md` ONLY inside the resolved task folder, plus one mode-`0600` lifecycle state file under `_local/scratch/wf/qa-auto/` while host teardown is pending.
- Invoke the **Task** tool for `subagent_type: wf:branch` (branch gate) and for the registered host/engine providers; invoke `/wf:index` only through the **Skill** tool so its wrapper owns routing.

**Forbidden:**

- Drive a browser, write persistence, or scaffold a host directly. Registered providers own execution; this skill only resolves, dispatches, hands off safe readiness metadata, and guarantees teardown dispatch.
- Expose a host lifecycle token in chat, the report, engine input, or provider evidence. It is passed only to the host provider and kept in the private orchestration state file.
- Modify source, spec, plan, or QA-plan files. The plan is read-only.
- Run builds, tests, installs, or destructive version-control operations.
- Name a specific capability or assume how many are active. Core walks the registry and dispatches whatever owns `surface: engine`.

---

## Phase 1: Resolve task and plan

1. **Resolve `<id>`.** Resolve the task id per the shared pipeline conventions doc — obtained via the `wf-resolver` MCP tool `resolve_content({ workspaceRoot, ... })` (`class: shared`, `ref: pipeline-conventions.md`), never a raw `Read` of the plugin-cache path — §"Id inference from the current branch" (explicit `<id>` used verbatim; otherwise inferred from the branch via `current-branch-query` — the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query, see "Direct provider resolution" above — and resolved against `{task-root}`), naming `/wf:qa-auto` in its stop messages.
2. Locate `06_qa.md`. Stop if missing.
3. Parse it: scope, suites, scenarios (TC-NNN with priority, validates, preconditions, steps, teardown). Filter by `--suite` if passed.
4. **Resume / targeted re-run handling.**
   - **`--only <TC-list>`** — parse the comma-separated `TC-NNN` list; the loop set is exactly those scenarios, re-executed regardless of their current verdict. Requires an existing `07_qa-report.md` — if absent, stop: "No `07_qa-report.md` to update with `--only`. Run a full pass first." Validate every listed `TC-NNN` exists in `06_qa.md`; if any don't, stop and list the valid IDs. `--only` takes precedence over `--resume` if both are passed.
   - **`--resume`** — parse `07_qa-report.md` for verdicts already recorded. Start the loop at the first un-verdicted scenario. If `07_qa-report.md` doesn't exist, stop: "No `07_qa-report.md` to resume."
   - **Neither** — if an annotated report exists, ask: rename to `07_qa-report.<UTC-timestamp>.md` (default), overwrite, or abort?
5. **Compare plan-vs-resume.** When resuming, compare the TC-NNN headings in `06_qa.md` with what the partial report references. If the plan changed mid-run, stop: "Plan changed since the run began. Start a fresh run."

---

## Phase 2: Branch gate

Extract the first 3+-digit run from `<id>` (whatever its shape) — call it `{numeric-id}`. It and `{task-id}` are the two tokens the branch-name match below accepts, used **only** there; `{numeric-id}` plays no role in the task folder, the task id, or any tracker operation, all of which use the opaque `<id>`/`{task-id}` form verbatim.

Gate on the task branch per the shared pipeline conventions doc (`resolve_content({ workspaceRoot, ... })`, `class: shared`, `ref: pipeline-conventions.md`) §"Branch gate (bare-core aware)", using `{task-id}` and `{numeric-id}` for the branch-name match. If subagent invocation of `wf:branch` is unavailable, skip the gate instead of blocking: report "Branch gate skipped — Task tool unavailable to invoke wf:branch (proceeding on the current branch — auto runs commonly happen on the task branch anyway)." and continue.

---

## Phase 3: Resolve execution providers

Resolve provider records before dispatch; the resolver has already walked the registry and manifests, so core reads only typed metadata:

1. **Engine registration gate** — call `resolve_provider({ workspaceRoot, surface: "qa-execution:engine" })`. `state: unconfigured` stops with the message in "How execution is supplied"; `state: ok` continues. The composite and bare engine aliases must identify the same owner. Resolver unavailability is a hard stop; never hand-parse the registry.
2. **Host registration record** — call `resolve_provider({ workspaceRoot, surface: "qa-execution:host" })` exactly once and retain the whole record for Phase 4. The composite and bare host aliases must identify the same owner. `unconfigured` is not a global stop because host-independent scenarios remain executable.
3. **Dispatch targets** — call `resolve_registry({ workspaceRoot, ... })` once. Locate the `qa-execution | provider | engine` fragment owned by the engine record and validate its `subagent: <agent>` dispatch. When the retained host record is `state: ok`, also locate the `qa-execution | provider | host` fragment owned by that record and validate its `subagent: <agent>` dispatch. A missing, mismatched, or malformed target is runtime-inapplicable and stops before provider work. Core never reads either provider's implementation; it dispatches to the resolved agents and consumes their returned contracts.

---

## Phase 4: Partition and dispatch the run to the engine

The engine owns scenario driving, credential handling, observation capture, and per-scenario verdict blocks. A registered host provider owns only temporary preparation and reversal. Core coordinates both without interpreting provider internals.

1. **Compute the selected scenario set** for this run — the full plan, the `--suite` subset, the `--resume` tail, or the `--only` list — in execution order (P0 → P1 → P2, file order within a tier), capped by `--batch N` (default 25).
2. **Classify host demand against the retained host record.** Before partitioning, securely inspect any existing private lifecycle state for this task. The sole non-resume consumable form is `state: "ready"` with `handoff: "qa-followup"`, a matching opaque `taskId`, and `affectedScenarioIds` exactly equal to the current `--only` selection; require retained host state `ok`, atomically mark it consumed, and retain its private token plus safe readiness metadata for Steps 4–5. Reject every mismatch or second consumer before engine work. A selected scenario is host-dependent when its Preconditions contain `Backend host required:` or `Host required:`, when it carries exact `Host operations:` or `Host operation target:` metadata, or when its ID belongs to that consumed handoff. Core recognizes these markers but does not interpret their values. Partition into `{host-unavailable}`, `{host-ready}`, and `{host-independent}`:
   - A scenario carrying `**Host availability:** unavailable` stays in `{host-unavailable}`. If the retained host state is now `ok`, report `ok — plan stale` and require regeneration rather than silently running a plan authored against different ownership.
   - An unmarked host-dependent scenario enters `{host-ready}` only when the retained host state is `ok`; otherwise it enters `{host-unavailable}`. This catches a provider removed after plan generation.
   - Every other unmarked scenario enters `{host-independent}`.
   Build exactly one aggregate capability-gap result for `{host-unavailable}`, listing affected IDs once. It is not an engine verdict and forces `Status: INCOMPLETE`. If both runnable partitions are empty, write the aggregate with zero provider/engine dispatches and skip to Phase 5.
3. <!-- capability-route:qa-auto-host --> **Prepare registered host work once.** The routed edge invokes `subagent_type: <host dispatch target>` only after `resolve_routing` with `unitIds: ["qa-auto:host-prepare"]`, `supportsModelSelector: true`, `supportsEffortSelector: false`, and `shapeEvidence` for external-context atomic work (`unitsIndependent: false`, `independentReview: false`), bounded ambiguity, elevated risk, material tool work, and a `mechanically-judgeable` return; include `actualModel` when exposed, stop on `status: stop` or diagnostic, pass `model.value` only when non-null, and the parent validates the result and owns any `postAttempt`. When `{host-ready}` is non-empty and Step 2 did not consume a handoff, use the resolved `workspaceRoot` and generate a fresh run id `qa-auto-{numeric-id}-<128-bit CSPRNG hex>` plus an independent lifecycle token encoded as exactly 64 lowercase hexadecimal characters from 32 bytes produced by the host runtime's cryptographic random source; fail closed if secure randomness is unavailable. Before Task dispatch, set `umask 077`, verify `_local/scratch/wf/qa-auto/` is a real current-user-owned directory (never a symlink), and atomically persist `{runId, lifecycleToken, taskId, state: "preparing"}` in mode `0600` at `_local/scratch/wf/qa-auto/<sha256-of-opaque-task-id>.json` (the task id is content, never a path segment). For a fresh prepare, a non-resume invocation that finds any existing state file stops rather than reusing or replacing it; an explicit `--resume` may reuse it only to finish that recorded lifecycle before new preparation. When Step 2 consumed a valid qa-followup handoff, do not generate or persist another lifecycle: skip duplicate prepare, use its safe readiness metadata in Step 4, retain its private token for Step 5, and proceed directly to Step 4; the remainder of this step applies only to a fresh prepare. Never print or copy the token to the report. The provider-neutral Task prompt contains `Intent: prepare`, run id, lifecycle token, task/report paths, and the complete `{host-ready}` scenario blocks; it requires provider-native operations, a ready/error block, safe readiness outputs, and a teardown token. Immediately before dispatch, call `resolve_routing` using the host target's final colon-delimited slug as `role`, `unitIds: ["qa-auto:host-prepare"]`, `supportsModelSelector: true`, `supportsEffortSelector: false`, and `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "elevated", toolWork: "material", validation: "mechanical", contextIsolation: "required", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`; include `actualModel` only when exposed. A `status: stop`, diagnostic, malformed role, or non-`isolated` shape stops before host work. Otherwise invoke exactly one Task with `subagent_type: <host dispatch target>`, passing `model.value` only when non-null and no effort selector. The parent validates the result and exclusively owns any `postAttempt`, retaining the same unit id/evidence; the provider never self-replaces. It retains the private lifecycle token independently of every provider result, so an error after partial setup is always teardown-authenticated. A routing stop before Task invocation deletes the unused private state and withholds `{host-ready}`. A non-ready result goes directly to Step 5 before any engine dispatch; continue with `{host-independent}` only after teardown passes.
4. <!-- capability-route:qa-engine --> **Dispatch runnable work to the engine.** `{runnable}` is `{host-independent}` plus `{host-ready}` only after a ready result. Validate the engine dispatch target and derive `role` from its final colon-delimited slug. Immediately before the Task call, invoke `resolve_routing` with `workspaceRoot`, `role`, `unitIds: ["qa-auto:engine"]`, `supportsModelSelector: true`, `supportsEffortSelector: false`, and `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "elevated", toolWork: "material", validation: "judgment", contextIsolation: "required", independentReview: false, returnContract: "judgment", requestedParallelism: 1 }`; include `actualModel` only when exposed. A `status: stop`, diagnostic, malformed role, or non-`isolated` shape stops engine work. Otherwise invoke exactly one Task with `subagent_type: <engine dispatch target>`, passing `model.value` only when non-null and no effort selector, plus `{runnable}`, task/report context, baseline ignore values, forwarded flags, and only the host provider's validated safe readiness outputs (or `none`). The parent retains every teardown token; never forward lifecycle ownership, captured command output, payload values, or ledger contents to the engine. The parent validates returned model metadata/verdict blocks and exclusively owns any `postAttempt`, retaining the same unit id/evidence; the engine never self-replaces. If `{runnable}` is empty after host preparation, make zero engine dispatches.
5. **Always tear down prepared/attempted host work.** In a parent-owned finally-equivalent path after every engine return, routing stop, provider error, batch stop, abort, or report-merge error, dispatch the same host target with `Intent: teardown`, the private run id and lifecycle token, prior readiness token when present, and no scenario payload. Route it with the same evidence under `unitIds: ["qa-auto:host-teardown"]`. Validate a torn-down result. Attempt teardown exactly once per prepare Task attempt; never let a missing/error prepare result or engine error bypass it. On PASS, atomically delete the private orchestration state. On teardown failure, retain that state at mode `0600` for explicit `--resume` recovery, make the run `INCOMPLETE`, record one redacted run-level teardown anomaly, and do not start another batch or emit PASS.
6. **Merge** runnable verdict blocks and aggregate gap/anomaly sections into `07_qa-report.md`. For `--only`, replace only selected runnable blocks, preserve all others, and union affected IDs into any existing aggregate gap rather than dropping it.
7. **Handle engine batch/early-stop signals.** Mark remaining runnable scenarios `Not run` and assemble `Status: INCOMPLETE`.

Core forwards scenario blocks and consumes provider contracts; it never performs host or engine work itself. The full-run baseline check below is the one cross-scenario rollup core owns.

---

## Phase 5: Assemble the final report

After the run completes (or stops at batch / abort):

**`--only` mode merges, it does not rebuild.** Load the existing `07_qa-report.md`, replace only the listed scenarios' per-suite blocks with their fresh verdicts, keep every other scenario's block untouched, then recompute the Summary, traceability matrix, and `Status` from the merged whole. Update the `Run date` to now and append a Notes line: `re-ran TC-NNN, TC-NNN via --only`. Do not rotate the prior report — `--only` is an in-place update, not a new run.

**Roll up the full-run baseline check.** The engine captures console/network signals session-wide and returns a full-run verdict for the `Console & network clean across the full run` baseline TC, with each finding attributed to the TC that was active when it fired. Record it: clean → `PASS`; otherwise `FAIL`, listing each finding and adding the distinct errors to the Defects table. Its `FAIL` flips the run `Status` to `FAIL` via the normal rule. **Only meaningful over a complete pass:** on an `--only` run, or a batch/abort that left scenarios `Not run`, mark this TC `Not run` and add a Notes line ("full-run console sweep skipped — partial session"). If the engine reports session-wide capture was unavailable, mark it `BLOCKED · setup: session-wide capture unavailable`.

- Header per `qa-gen`'s `report-format.md` (same `resolve_content({ workspaceRoot, ... })` reference as above):
  - `Mode: agentic`
  - `Tester: wf:qa-auto`
  - `Driver model:` — actual current model identifier from the engine's returned `Driver model:` metadata; never substitute the selected or parent model when they differ. If zero engine dispatches occurred, write `Driver model: n/a — no engine dispatch`.
  - `App:` — base URL the engine authenticated against (reported back). If zero engine dispatches occurred, write `App: n/a — no engine dispatch`.
  - `Status:` — deterministic from the PASS/FAIL/INCOMPLETE rule; any aggregate capability gap is `INCOMPLETE`.
- Summary table.
- When `{host-unavailable}` is non-empty, add one `## Capability gaps` section before Results by Suite:

  ```markdown
  ## Capability gaps

  **Host availability:** unavailable
  **Affected scenarios:** TC-NNN, TC-NNN
  **Host resolution:** <unconfigured | unrecoverable | ok — plan stale> <owner when present>
  **Reason:** <no host provider is available for required temporary host work | the plan was generated before a host provider was registered; regenerate the plan before running these scenarios>. No engine dispatch was attempted for these scenarios.
  ```

  This aggregate represents the entire unavailable partition once; it is neither a per-scenario `BLOCKED` result nor a Defects-table row. On an all-unavailable selection, it is the only scenario-result content and `Status: INCOMPLETE`.
- When host ownership is `ok` but prepare/routing returns non-ready, add one separate stable entry in the same section:

  ```markdown
  **Host preparation:** failed
  **Affected scenarios:** TC-NNN, TC-NNN
  **Host resolution:** ok — <owner>
  **Teardown:** <PASS | FAIL — recovery required>
  **Reason:** The registered host provider did not reach ready state. No engine dispatch was attempted for these scenarios.
  ```

  This is one run-level preparation condition regardless of affected count. It forces `INCOMPLETE`; never serialize one `BLOCKED` verdict per scenario or expose the lifecycle token/provider output.
- Traceability matrix rolled up from per-scenario `Validates: SC-N` references and runnable verdicts; criteria represented only by an aggregate are `GAP — host unavailable` or `GAP — host preparation failed`.
- Per-suite results — PASS scenarios get one line, FAIL/BLOCKED get the full step table (from the engine's verdict blocks). Do not render host-unavailable scenarios here as `BLOCKED` results.
- Notes & Observations — any anomalies the engine surfaced (entity substitutions, retries, teardown failures), plus the capability-gap summary when present.
- Defects table — one row per FAIL, severity resolved per the rubric in `qa-gen`'s `report-format.md` (same `resolve_content({ workspaceRoot, ... })` reference as above; §Defects Found — `{qa-rules}` if set, else the P0→High / P1→Medium / P2→Low default), description from observed value.

If subagent invocation is available, invoke the routed `/wf:index` wrapper with slot `qa-report` and summary: `07_qa-report.md · agentic · <status> · <P>/<T> passed`. The wrapper owns the fixed `index` routing decision; do not inline or bypass it.

---

## Edge Cases

- **No engine provider registered.** Phase 3 stops with the capability-agnostic "No qa-execution engine registered" message. Core never fakes a run without an engine.
- **Subagent invocation unavailable.** Core cannot dispatch the engine — stop and direct the user to `/wf:qa-run` for a manual walkthrough.
- **App URL / credentials issues.** Owned by the engine (it prompts, saves, and guards creds). Core forwards `--reset-creds`; a creds/auth failure comes back as a BLOCKED first scenario, which triggers the early-stop in Phase 4.
- **Login fails on first scenario.** The engine reports it; core stops the loop and marks the rest `Not run`.
- **Single scenario.** Run normally — same flow with N=1.
- **`--only` with no existing report, or an unknown `TC-NNN`.** Phase 1 stops with the targeted-re-run message or lists the valid IDs — never start a partial run that would orphan the other scenarios' verdicts.
- **Scenario needs an execution surface the active engine doesn't provide** (e.g. a non-browser precondition with only a browser engine registered). The engine returns BLOCKED for that scenario with its scope reason; core records it and continues. A different/additional capability owning that surface is the fix, registered in `## Capabilities`.
- **Host ownership changed after generation.** Phase 4 compares both the exact plan marker and current host record. Marked + now-owned is stale and requires regeneration; unmarked + now-unowned is withheld immediately. Either produces one aggregate gap and never repeated `BLOCKED` verdicts.
- **Host preparation fails.** Dispatch no host-dependent scenario to the engine. Attempt teardown, report the affected IDs once as a host-preparation gap, and continue only with host-independent work.
- **Host teardown fails or is unsettled.** Record one run-level teardown anomaly, force `Status: INCOMPLETE`, retain only redacted recovery evidence, and do not start another batch or emit PASS.
- **Concurrent or stale host lifecycle state.** A fresh invocation never overwrites an existing private state file, and the provider's global token-digest lock refuses a different owner. Use explicit `--resume` to finish the recorded lifecycle; teardown must settle before any new host prepare.
- **No runnable scenarios of any kind** — `06_qa.md` has only Build/static / Automated rows and a baseline marked `[N/A: no runnable surface]`. Core skips dispatch and writes a stub PASS noting nothing to run.
- **Engine reaches a batch ceiling.** Core writes the partial report `Status: INCOMPLETE`, remaining scenarios `Not run`, and tells the user to resume.
- **Tester aborts mid-run.** Dispatch pending host teardown before returning; incremental report saves preserve completed verdicts. Resume with `--resume` only after teardown is settled.

---

## Final Output

```
QA-AUTO — Complete

Task:       {task-id}
Mode:       agentic
Status:     <PASS | FAIL | INCOMPLETE>
Scenarios:  <T> total · <P> PASS · <F> FAIL · <B> BLOCKED · <S> SKIPPED · <N> not run
Pass rate:  <N>% (excluding blocked/skipped)

App:        <base URL>
Report:     {task-root}/{task-id}/07_qa-report.md
Screenshots: {task-root}/{task-id}/artifacts/qa-run-*.png (<count> on FAIL only)

<if any defects:>
Top defects:
  • TC-NNN step <K>: <one-line observed>
  • TC-NNN step <K>: <one-line observed>

<if INCOMPLETE due to batch:>
Reached batch ceiling.
Next: /wf:qa-auto {task-id} --resume

<if INCOMPLETE due to abort:>
Run interrupted.
Next: /wf:qa-auto {task-id} --resume

<if FAIL:>
Next: /wf:qa-followup {task-id}  — triage and fix the defects

<if PASS:>
All scenarios passed.
Next: ship it — /wf:commit {task-id} --push  then  /wf:pr {task-id}
```

**The final-output block must always be the very last thing output to chat.**
