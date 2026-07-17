---
name: qa-auto
description: Orchestrates an autonomous QA run over 06_qa.md — resolves the task and plan, enforces the branch gate, manages run lifecycle (resume / --batch / --only), and dispatches the per-scenario browser drive to the qa-execution provider registered in the capability registry, then assembles 07_qa-report.md with the Summary, traceability matrix, and a full-run console/network baseline rollup. Domain-free — it names no stack and drives no browser itself; the execution engine is supplied by a registered capability. Use when you want a hands-off run; pair with /wf:qa-run for human-in-the-loop runs.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task]
---

# /wf:qa-auto — Agentic QA run orchestrator

Orchestration shim for an autonomous run of `06_qa.md`. It owns the run **lifecycle** — resolving the task and plan, the branch gate, resume / `--batch` / `--only`, incremental report assembly, and the full-run console/network baseline rollup — and **dispatches the per-scenario drive** to the `qa-execution` engine registered in the capability registry. It does not drive a browser, touch a database, or scaffold a host itself; that execution surface is supplied by a capability. Verdicts are recorded into `07_qa-report.md` incrementally so a context-overflow or a crash doesn't lose progress.

For a human-in-the-loop run, use `/wf:qa-run` — the same plan, the same report format (`qa-gen`'s `report-format.md`, obtained via the resolver's `resolve_content` — `class: references-template`, `skill: qa-gen`, `ref: report-format.md` — never a raw `Read` of the plugin-cache path), only the `Mode` and `Tester` fields differ.

---

## How execution is supplied (the provider dispatch)

`qa-auto` is **domain-free orchestration**. The actual scenario execution — driving the app, reaching preconditions, capturing console/network, screenshots — is a `qa-execution` **provider** that a capability registers. Core resolves it through two typed `wf-resolver` MCP queries, performing **no** registry / manifest read of its own: (1) `resolve_provider("qa-execution:engine")` returns the run-scoped record `{ surface, owner, fragmentPath, state, degradation, diagnostics }` — its `state` is the **registration gate** (`ok` = an engine provider owns the surface; `unconfigured` = none owns it); (2) `resolve_registry` supplies the engine fragment's **`dispatch` metadata** — the `subagent: <agent>` Task-tool target — since the provider record's `fragmentPath` is `null` for a subagent-dispatched provider (it carries the owner capability, not the agent name). Core dispatches the per-scenario drive to that `subagent:` target via the **Task** tool, hands the engine the scenario set + report context, and merges the per-scenario verdict blocks the engine returns. Core names no capability and assumes none in particular — it resolves whatever owns the `engine` surface.

If **no** `qa-execution` engine provider is registered, core stops:

```
No qa-execution engine registered. A browser-QA (or other execution) capability must
be active in _local/config.md's ## Capabilities table to drive scenarios. See the
capability's manifest for registration, then re-run.
```

This is the provider analog of the inert-phase no-op: when the provider an orchestrator strictly needs for a phase is absent, core stops with a clear, capability-agnostic message rather than silently passing.

---

## Prerequisites

Obtain project config from the bundled `wf-resolver` MCP service via `resolve_config` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, qaBaselineIgnore, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop with: "Run `/wf:init` first." If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. From `coreConfig`: `{task-root}` (`taskRoot`); `{qa-baseline-ignore}` (`qaBaselineIgnore`, the allowlist of known-benign console messages / request patterns the Baseline health scenarios tolerate) — treat an absent value as an empty list, pass it through to the engine. The `qa-execution` engine provider is resolved separately — a `resolve_provider("qa-execution:engine")` registration gate plus the engine fragment's `dispatch` target from `resolve_registry` (see "How execution is supplied").

`06_qa.md` must exist in the task folder.

This skill depends on two runtime capabilities:

1. **A registered `qa-execution` engine provider** — its ownership gated by the `wf-resolver` `resolve_provider("qa-execution:engine")` record and its subagent dispatch target sourced from `resolve_registry` (see "How execution is supplied"). If none is registered (record `state: unconfigured`), stop with the message above.
2. **The Task tool** (a standard Claude Code tool) — used for the `wf:branch` **Task** call (branch gate), the engine **provider dispatch**, and the `wf:index` **Task** call (post-run index update). If subagent invocation is unavailable, the skill cannot dispatch the engine — stop and direct the user to a manual `/wf:qa-run`.

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

Id inference and the Phase 2 branch gate both reach `current-branch-query` by calling the bundled `wf-resolver` MCP tool `resolve_provider("delivery")` — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }` for the `delivery` surface. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); core performs **no** registry / manifest / plugin-root read of its own. Obtain the op body via `resolve_content` (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in this skill's own context to reach `current-branch-query` — never a raw `Read` of the path (the metadata queries return only paths/metadata; the body comes from `resolve_content`). On `state: unconfigured` (no `delivery` provider registered), `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery). (qa-auto has no tracker-surface call site — it never fetches.)

---

## Safety Rules

**Allowed:**

- Read any file in the project.
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider("delivery")` query) for id inference and branch gating.
- Write `07_qa-report.md` ONLY inside the resolved task folder (assembling the run-level header / Summary / matrix from the engine's per-scenario blocks).
- Invoke the **Task** tool: `subagent_type: wf:branch` (branch gate), the registered `qa-execution` engine provider (per-scenario drive), and `subagent_type: wf:index` (after the report is written).

**Forbidden:**

- Drive a browser, write a database, or scaffold a host directly. That is the engine provider's job — this skill orchestrates, it does not execute.
- Modify source, spec, plan, or QA-plan files. The plan is read-only.
- Run builds, tests, installs, or destructive version-control operations.
- Name a specific capability or assume how many are active. Core walks the registry and dispatches whatever owns `surface: engine`.

---

## Phase 1: Resolve task and plan

1. **Resolve `<id>`.** Resolve the task id per the shared pipeline conventions doc — obtained via the `wf-resolver` MCP tool `resolve_content` (`class: shared`, `ref: pipeline-conventions.md`), never a raw `Read` of the plugin-cache path — §"Id inference from the current branch" (explicit `<id>` used verbatim; otherwise inferred from the branch via `current-branch-query` — the `wf-resolver` `resolve_provider("delivery")` query, see "Direct provider resolution" above — and resolved against `{task-root}`), naming `/wf:qa-auto` in its stop messages.
2. Locate `06_qa.md`. Stop if missing.
3. Parse it: scope, suites, scenarios (TC-NNN with priority, validates, preconditions, steps, teardown). Filter by `--suite` if passed.
4. **Resume / targeted re-run handling.**
   - **`--only <TC-list>`** — parse the comma-separated `TC-NNN` list; the loop set is exactly those scenarios, re-executed regardless of their current verdict. Requires an existing `07_qa-report.md` — if absent, stop: "No `07_qa-report.md` to update with `--only`. Run a full pass first." Validate every listed `TC-NNN` exists in `06_qa.md`; if any don't, stop and list the valid IDs. `--only` takes precedence over `--resume` if both are passed.
   - **`--resume`** — parse `07_qa-report.md` for verdicts already recorded. Start the loop at the first un-verdicted scenario. If `07_qa-report.md` doesn't exist, stop: "No `07_qa-report.md` to resume."
   - **Neither** — if an annotated report exists, ask: rename to `07_qa-report.<UTC-timestamp>.md` (default), overwrite, or abort?
5. **Compare plan-vs-resume.** When resuming, compare the TC-NNN headings in `06_qa.md` with what the partial report references. If the plan changed mid-run, stop: "Plan changed since the run began. Start a fresh run."

---

## Phase 2: Branch gate

Extract the first 3+-digit run from `<id>` (whatever its shape) — call it `{numeric-id}`. This token is used **only** for the branch-name match below; it plays no role in the task folder, the task id, or any tracker operation, all of which use the opaque `<id>`/`{task-id}` form verbatim.

Gate on the task branch per the shared pipeline conventions doc (`resolve_content`, `class: shared`, `ref: pipeline-conventions.md`) §"Branch gate (bare-core aware)", using `{numeric-id}` for the branch-name match. If subagent invocation of `wf:branch` is unavailable, skip the gate instead of blocking: report "Branch gate skipped — Task tool unavailable to invoke wf:branch (proceeding on the current branch — auto runs commonly happen on the task branch anyway)." and continue.

---

## Phase 3: Resolve the execution provider

Resolve the engine provider through two `wf-resolver` queries — the resolver has already walked the `## Capabilities` registry and every `manifest.md`, so core reads only these records:

1. **Registration gate** — call `resolve_provider("qa-execution:engine")`. It returns `{ surface, owner, fragmentPath, state, degradation, diagnostics }` for the engine surface; branch on its `state`. (The composite `qa-execution:engine` token resolves to the identical ownership record as the bare `engine` token — both are recognized surface forms; an unrecognized surface token is a distinct invalid-argument error, never `state: "unconfigured"`, so a typo cannot masquerade as a genuinely unregistered engine.)
   - **`state: unconfigured`** (no engine provider owns the surface) → stop with the "No qa-execution engine registered" message (see "How execution is supplied"). Do not attempt to drive scenarios. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry (WF-272 diagnostics/recovery).
   - **`state: ok`** → continue.
2. **Dispatch target** — call `resolve_registry` and locate the fragment whose `phase` is `qa-execution`, `contributionKind` is `provider`, and `scope` is `engine`; read its `dispatch` metadata (a `subagent: <agent>` token). That `<agent>` is the run's engine dispatch target (the provider record's `owner` is the capability name, and its `fragmentPath` is `null` for a subagent-dispatched provider — the agent name lives only in the fragment `dispatch`). Core never reads the engine's internals; it only dispatches to that subagent and consumes its returned verdict blocks.

---

## Phase 4: Dispatch the run to the engine

The engine owns credential handling, the browser drive, precondition reaching, console/network capture, and per-scenario verdict blocks. Core hands it the work and manages the loop boundary.

1. **Compute the scenario set** for this run — the full plan, the `--suite` subset, the `--resume` tail (first un-verdicted onward), or the `--only` list — in execution order (P0 → P1 → P2, file order within a tier), capped by the `--batch N` ceiling (default 25).
2. **Dispatch** to the resolved engine provider via the **Task** tool (`subagent_type: <engine dispatch target>`), passing: the scenario set, the resolved task id + task-folder path, the `07_qa-report.md` location, `{qa-baseline-ignore}` (or empty), and the forwarded `--reset-creds` flag. The engine drives each scenario in its isolated context and returns per-scenario verdict blocks in the shared report format.
3. **Merge** the returned verdict blocks into `07_qa-report.md` incrementally (the engine may also append directly; core is the owner of the run-level rollup either way). For `--only`, **merge** into the existing report: replace just the listed scenarios' blocks, preserve every other scenario's recorded verdict verbatim.
4. **Batch / early-stop signals from the engine.** If the engine reports a batch ceiling reached or a first-scenario auth/unreachable failure, stop the loop, mark remaining scenarios `Not run`, and proceed to assembly with `Status: INCOMPLETE`.

Core does not interpret scenario internals; it forwards the set and consumes verdicts. The full-run baseline check (below) is the one cross-scenario rollup core owns.

---

## Phase 5: Assemble the final report

After the run completes (or stops at batch / abort):

**`--only` mode merges, it does not rebuild.** Load the existing `07_qa-report.md`, replace only the listed scenarios' per-suite blocks with their fresh verdicts, keep every other scenario's block untouched, then recompute the Summary, traceability matrix, and `Status` from the merged whole. Update the `Run date` to now and append a Notes line: `re-ran TC-NNN, TC-NNN via --only`. Do not rotate the prior report — `--only` is an in-place update, not a new run.

**Roll up the full-run baseline check.** The engine captures console/network signals session-wide and returns a full-run verdict for the `Console & network clean across the full run` baseline TC, with each finding attributed to the TC that was active when it fired. Record it: clean → `PASS`; otherwise `FAIL`, listing each finding and adding the distinct errors to the Defects table. Its `FAIL` flips the run `Status` to `FAIL` via the normal rule. **Only meaningful over a complete pass:** on an `--only` run, or a batch/abort that left scenarios `Not run`, mark this TC `Not run` and add a Notes line ("full-run console sweep skipped — partial session"). If the engine reports session-wide capture was unavailable, mark it `BLOCKED · setup: session-wide capture unavailable`.

- Header per `qa-gen`'s `report-format.md` (same `resolve_content` reference as above):
  - `Mode: agentic`
  - `Tester: wf:qa-auto`
  - `Driver model:` — current model identifier (the model the engine ran under, as reported back).
  - `App:` — base URL the engine authenticated against (reported back).
  - `Status:` — deterministic from the PASS/FAIL/INCOMPLETE rule.
- Summary table.
- Traceability matrix rolled up from per-scenario `Validates: SC-N` references and verdicts.
- Per-suite results — PASS scenarios get one line, FAIL/BLOCKED get the full step table (from the engine's verdict blocks).
- Notes & Observations — any anomalies the engine surfaced (entity substitutions, retries, teardown failures).
- Defects table — one row per FAIL, severity resolved per the rubric in `qa-gen`'s `report-format.md` (same `resolve_content` reference as above; §Defects Found — `{qa-rules}` if set, else the P0→High / P1→Medium / P2→Low default), description from observed value.

If subagent invocation is available, invoke `/wf:index` with slot `qa-report` and summary: `07_qa-report.md · agentic · <status> · <P>/<T> passed`.

---

## Edge Cases

- **No engine provider registered.** Phase 3 stops with the capability-agnostic "No qa-execution engine registered" message. Core never fakes a run without an engine.
- **Subagent invocation unavailable.** Core cannot dispatch the engine — stop and direct the user to `/wf:qa-run` for a manual walkthrough.
- **App URL / credentials issues.** Owned by the engine (it prompts, saves, and guards creds). Core forwards `--reset-creds`; a creds/auth failure comes back as a BLOCKED first scenario, which triggers the early-stop in Phase 4.
- **Login fails on first scenario.** The engine reports it; core stops the loop and marks the rest `Not run`.
- **Single scenario.** Run normally — same flow with N=1.
- **`--only` with no existing report, or an unknown `TC-NNN`.** Phase 1 stops with the targeted-re-run message or lists the valid IDs — never start a partial run that would orphan the other scenarios' verdicts.
- **Scenario needs an execution surface the active engine doesn't provide** (e.g. a non-browser precondition with only a browser engine registered). The engine returns BLOCKED for that scenario with its scope reason; core records it and continues. A different/additional capability owning that surface is the fix, registered in `## Capabilities`.
- **No runnable scenarios of any kind** — `06_qa.md` has only Build/static / Automated rows and a baseline marked `[N/A: no runnable surface]`. Core skips dispatch and writes a stub PASS noting nothing to run.
- **Engine reaches a batch ceiling.** Core writes the partial report `Status: INCOMPLETE`, remaining scenarios `Not run`, and tells the user to resume.
- **Tester aborts mid-run.** Incremental save (Phase 4) preserves whatever completed. Resume with `--resume`.

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
