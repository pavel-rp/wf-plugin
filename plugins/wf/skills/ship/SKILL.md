---
name: ship
description: Drives a single task end-to-end to a merged pull request with no human pause. Resolves the task, requires a registered delivery provider, drives the wf:* build chain past its gates, opens the pull request, waits for the delivery checks to settle (never merging a red one), then finalizes the merge. Stops honestly with a stated reason when no delivery provider is registered or the checks do not pass — never a partial merge. Use to ship one ready task from nothing to a merged PR unattended. Reads _local/config.md first; run /wf:init if it is absent.
allowed-tools: [Read, Bash, Skill]
---

# /wf:ship — one task, driven unattended to a merged PR

Takes a single task all the way to a **merged pull request** without a human pause between phases. In one run it: resolves the task id, **requires** a registered **delivery** provider (there is nothing to merge without one), drives the `wf:*` build chain **past the gates** where `/wf:run` halts, opens the pull request, **waits for the delivery checks to settle** — never merging a red one — and then finalizes the merge through `/wf:tf`.

`ship` is a **pure orchestrator**: it writes no artifact and mutates no source of its own. Every source edit and every artifact belongs to the phase skills it drives; the merge, archive, and work-item close belong to `/wf:tf`. `ship` only resolves, decides, and dispatches — reaching merge/check state solely through the abstract **delivery** provider operations, never knowing or naming which concrete tool implements them.

The **review-address loop is out of scope** for this skill's own behaviour — `ship` drives build → checks → merge and exposes a declared `ship.review` slot at the point where a review step attaches (Phase 4.5). When that slot is unfilled — the default with no review capability registered — the inline default drives no reviewer; `ship` never improvises one.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). `{task-root}` below comes from `coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback.

---

## Command Syntax

```
/wf:ship [<id>] [--status <name>]
```

### Arguments

| Argument          | Required | Description                                                                                                                                    |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `<id>`            | NO       | Task id — the opaque shape the active tracker capability produced, or the local `T<NNN>` scheme when none is registered. Falls back to inferring from the current branch. |
| `--status <name>` | NO       | Forwarded verbatim to `/wf:tf` as the terminal work-item status on close (defaults to the finalize step's own default). |

### Zero-argument default

Invoked with no id, `ship` infers the task from the current branch — resolve the current branch via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query), extract the first 3+-digit run as a token, and resolve that token against `{task-root}` by applying the same first-3+-digit-run extraction to each existing task folder's name (matching both a tracker-prefixed shape and the local `T<NNN>` scheme). **Exactly one match** — reuse that folder's full name as `{task-id}`. **More than one / zero matches / no extractable token** — stop and ask for an explicit id: `/wf:ship <id>`. Require an explicit id only when inference fails.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read the task folder and its artifacts; obtain config via the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query.
- Read-only resolution via `workspace-root-resolve` (the `wf-resolver` `resolve_config({ workspaceRoot, ... })` `workspaceRoot` value) and `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query).
- Resolve the `delivery` surface once via the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query, and invoke its **read** operations — `pr-detect` and `checks-read` — by obtaining each op's body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`) and following it in this skill's own context.
- Resolve the `ship.review` slot (Phase 4.5) via `resolve_content({ workspaceRoot, ... })` (`class: slot`, `skill: ship`, `point: review`), and — only on a `composed` outcome — follow the served body as prose in this skill's own context.
- Invoke the sibling `wf:*` commands this skill drives through the **Skill** tool: `/wf:branch`, `/wf:run` (and each gated `/wf:*` command `/wf:run` names in its handoff), `/wf:pr`, and `/wf:tf`.

**Forbidden:**

- Write or edit **any** file — artifact, source, or config. `ship` is a dispatcher; every write belongs to the phase skills it drives or to `/wf:tf`.
- Finalize a merge while any delivery check is failing or has not settled — **never merge a red PR**. Merge is performed only by `/wf:tf`, and only after Phase 4 confirms the checks are green.
- Run any destructive version-control operation, or invoke `pr-merge` directly — the single merge write is `/wf:tf`'s, through the delivery provider (detect-first, never a double-merge).
- Drive any reviewer or review-address loop, or call any review skill, on `ship`'s own initiative — the review step attaches only through the declared `ship.review` slot (Phase 4.5); when the slot is unfilled, no reviewer is driven and the marker's inline default is executed exactly, with no improvisation.
- Name any concrete tracker, delivery, or stack tool or command string anywhere in this skill's behaviour — only the abstract operation names and the `/wf:*` commands above.
- Write the current model id, any AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into any comment, commit, or output.

---

## Fixed sibling-Skill routing

Every executable sibling-Skill edge below is routed independently and immediately before that Skill-tool call. Call `resolve_routing` with `workspaceRoot: <absolute pwd -P workspace root>`, the edge's stated stable `role`, exactly one canonical stable `unitIds` entry for that edge (`ship:branch`, `ship:run-initial`, `ship:phase`, `ship:run-resume`, `ship:pr`, or `ship:finalize`), `shapeEvidence: { workSurface: "caller-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "none", validation: "mechanical", contextIsolation: "none", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: false`, and `supportsEffortSelector: false`. Include `actualModel` only when the host exposes it. Emit the compact operational record, separate from artifact attribution. Hard-stop before the Skill call on `status: stop` or non-null `diagnostic`; otherwise obey `executionShape` exactly (this evidence selects `inline`) and pass no model or effort selector. The `ship` parent evaluates the returned terminal block; only it may submit `postAttempt` for a contract-defined insufficiency and retry that edge. A child never invokes its own replacement.

---

## Phase 1: Resolve the task and require a delivery provider

1. **Resolve `{task-id}`** — use the `<id>` argument verbatim when passed; otherwise infer it per the zero-argument default above. Stop with a `SHIP — Blocked` block (ending in `Next: /wf:ship <id>`) if inference cannot yield exactly one task folder.

2. **Require a delivery provider.** Call the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query once; hold its run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`. Unlike `/wf:tf` — which degrades to a local-only finalize — `ship` has **nothing to merge** without a delivery provider, so a missing one is a hard stop, not a degrade:
   - `state: unconfigured` (no capability owns `delivery`) → **`SHIP — Blocked`**: "No delivery provider is registered — nothing to open or merge. Register a capability that owns the `delivery` surface." **No partial merge, no phase driven.** Stop.
   - `state: unrecoverable` (a registered capability's manifest is unrecoverable) → **`SHIP — Blocked`**, naming the record's `diagnostics` pack as a hedged candidate ("if this is your `delivery` provider, fix its stale root / re-run its init"). Stop.
   - Otherwise hold the record for the delivery reads in Phases 3–4.

---

## Phase 2: Drive the build chain past the gates

`ship` is the auto-driver that clears every gate `/wf:run` halts at. It hardcodes **no** phase list — it follows `/wf:run`'s own handoff, so it drives exactly the phases the pipeline defines (each named command is an existing `/wf:*` skill).

1. **Ensure the task branch.** Route this edge with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "branch"` and `unitIds: ["ship:branch"]` under §"Fixed sibling-Skill routing", then invoke `/wf:branch <id>` through the Skill tool so all subsequent source lands on the task branch (idempotent — `BRANCH — already-active` when already on it). On `BRANCH — Error`, surface the reason and stop. On `BRANCH — created`/`switched`/`already-active`, inspect `Carry:`: `none` or `applied` continues; a preserved-entry/manual-follow-up carry means the branch switch succeeded but the intended working set is not safely reapplied, so emit `SHIP — Blocked`, name that manual follow-up, preserve all work, and stop before any run/phase/PR/finalize edge. Ordinary dirty work is carried progress, not by itself a branch error.

2. **Loop the pipeline driver.** Route the initial edge with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "phase-runner"` and `unitIds: ["ship:run-initial"]`, then invoke `/wf:run <id>` through the Skill tool and read its `RUN —` block:
   - **Gated** (`RUN — gated`, whose `Run next:` field names a phase command) → route the exact dynamic phase edge with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "phase-runner"` and `unitIds: ["ship:phase"]`, invoke that exact `/wf:<phase> <id>` command through the Skill tool, then route the resume edge independently with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "phase-runner"` and `unitIds: ["ship:run-resume"]` and **re-invoke `/wf:run <id>`**. This is the unattended equivalent of a human clearing the gate.
   - **Complete** (`RUN — complete` / ready for review) → the SDD build chain is done; continue to Phase 3.
   - **Blocked / error** (`RUN — blocked` / `RUN — error`, or a driven phase returns its own `… — Error`, or a driven phase halts awaiting human input) → `SHIP — Blocked`, surface the phase's reason, stop. Do not attempt to complete a failed phase yourself.

3. **Progress + iteration guard.** Cap the loop (e.g. one iteration per pipeline phase plus a small margin). If `/wf:run` names the **same** command twice with no artifact progress between them, the pipeline is stuck → `SHIP — Blocked` (no forward progress), stop rather than loop forever.

---

## Phase 3: Open the pull request

1. **Open it.** Route this edge with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "pr"` and `unitIds: ["ship:pr"]` under §"Fixed sibling-Skill routing", then invoke `/wf:pr <id>` through the Skill tool — it commits and pushes any pending work and opens the pull request through the delivery provider. Read its `PR —` block; on its error state → `SHIP — Blocked`, surface the reason, stop.

2. **Confirm it exists.** Invoke the delivery `pr-detect` operation (obtain its body via `resolve_content({ workspaceRoot, ... })` from the Phase-1 record and follow it) for the task branch. If no open pull request is found → `SHIP — Blocked` ("`/wf:pr` opened no pull request for the task branch"), stop — never fabricate one. Otherwise capture the pull request reference for the phases below.

---

## Phase 4: Wait for the delivery checks to settle

Never merge a red or unsettled pull request. Invoke the delivery `checks-read` operation for the pull request (obtain its body via `resolve_content({ workspaceRoot, ... })` from the Phase-1 record and follow it) and evaluate the returned check states:

- **No checks configured** (an empty check set) → vacuously settled and green; proceed.
- **All checks passing** → settled and green; proceed.
- **Any check failing** → **`SHIP — Blocked`**, naming the failing check(s). No merge — a red pull request is never merged. Stop.
- **Any check still pending / in progress** → re-read `checks-read`, **capped** at a small number of attempts. If every check has resolved to passing within the cap, proceed. If any resolves to failing → the failing-check stop above. If checks are still pending after the cap → **`SHIP — Blocked`** ("delivery checks did not settle within the cap"). No merge. Stop.

The cap keeps the wait bounded so an unattended run can never hang indefinitely; a genuinely slow pipeline is reported honestly and re-run, never merged early.

## Phase 4.5: Review attachment point (the `ship.review` slot)

This is the declared `ship.review` composition point — between green checks and the merge — where a review-address step attaches (declared in `skills/ship/interface.md`, merge policy `replace`). Resolve it lazily with **one** call: `resolve_content({ workspaceRoot, ... })` with `class: slot`, `skill: ship`, `point: review`. Act on the typed outcome — never improvise a review step at this marker:

- **`{status: unfilled}`** (no slot contribution registered and no personal `_local/slots/ship.review.md` override — the state whenever no review capability is registered) → execute **exactly** the inline-default region below, then proceed to Phase 5. No reviewer is driven and no review finding is addressed — the checks-green state from Phase 4 carries into the merge unchanged.
- **`{status: composed, content, policy, …}`** → a fill is registered; **follow the served `content` as prose** in this skill's own context (a `replace` fill supersedes the inline default wholesale), then proceed to Phase 5.
- **`{status: unresolved}`** (registry-invalid / ref-not-found) or **`{status: refused}`** → do not improvise: run the inline-default region below (proceed to Phase 5) and state the resolver's reason. Follow the content surface's degradation discipline — never a wrong-path body, never a raw-read fall-through.

<!-- wf:slot ship.review -->
No review step runs here. `ship` drives build → checks → merge only: at this point it addresses no review findings and drives no reviewer. Proceed to Phase 5 with the Phase-4 checks-green state unchanged.
<!-- wf:slot-end ship.review -->

---

## Phase 5: Merge and finalize

Route this edge with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "finalize"` and `unitIds: ["ship:finalize"]` under §"Fixed sibling-Skill routing", then invoke `/wf:tf <id>` (forwarding `--status <name>` when passed) through the Skill tool. The finalizer merges the pull request through the delivery provider's `pr-merge` operation (detect-first — never a double-merge), posts the resolution comment and closes the work item through the tracker provider when one is registered, then archives the task folder and updates the index locally. Read its `TF —` block:

- `TF — finalized` (merged, or already merged) → **`SHIP — Merged`**, naming the merged pull request.
- `TF — partial` (a configured provider step failed mid-run — merge blocked by checks/conflicts, or a tracker error) → **`SHIP — Blocked`**, surface `/wf:tf`'s stated reason; the merge can be retried by re-running once the blocker clears.
- `TF — already-finalized` → the task was already merged and archived → **`SHIP — Merged`** (idempotent no-op).

---

## Edge Cases

- **Missing config:** the resolver reports the project is uninitialized (absent `_local/config.md`) → `SHIP — Blocked`, `Next: /wf:init`.
- **No delivery provider registered:** hard stop at Phase 1 (`SHIP — Blocked`) naming the missing provider — no partial merge, unlike `/wf:tf`'s local-only degrade. There is nothing to merge without a delivery provider.
- **Registered-but-unrecoverable delivery provider:** Phase 1 stops with the hedged candidate-naming diagnosis from the record's `diagnostics` field, never asserting a pack owns the surface.
- **A build phase fails or halts for input:** Phase 2 stops with `SHIP — Blocked` surfacing that phase's own reason — `ship` never rescues a failed phase by doing its work itself.
- **Pipeline stuck (no progress):** the Phase-2 progress guard stops with `SHIP — Blocked` rather than re-dispatching the same phase forever.
- **`/wf:pr` opens no pull request:** Phase 3 stops (`SHIP — Blocked`); a `<PR>` is never fabricated.
- **Red checks:** Phase 4 stops (`SHIP — Blocked`) naming the failing checks — a red pull request is never merged.
- **Checks never settle (cap hit):** Phase 4 stops (`SHIP — Blocked`) after the capped re-reads; re-run once the pipeline finishes rather than merging early.
- **Merge blocked at finalize:** `/wf:tf` returns `partial` (failing required checks, unresolved conversations, conflicts) → `SHIP — Blocked` with its reason; re-running `ship` after the blocker clears retries the merge safely (`/wf:tf` is detect-first and idempotent).
- **Already shipped:** `/wf:tf` returns `already-finalized` → `SHIP — Merged` (idempotent).

---

## Final Output

```
SHIP — <Merged | Blocked>

Task:     {task-id}
Built:    <ready for review | stopped at <phase>>
PR:       <url | none>
Checks:   <green | red (<failing>) | unsettled | n/a>
Merge:    <merged (<url>) | not merged — <reason>>
Next:     <none — terminus | the command that clears the block>
```

`Merged` — the pull request is merged and the task finalized. `Blocked` — a required condition was not met (no delivery provider, a failed/halted build phase, no pull request, red or unsettled checks, or a blocked finalize); the `Next:` line names the existing `/wf:*` command that clears it (e.g. `/wf:run <id>` to resume the build, `/wf:init` for missing config, or `/wf:ship <id>` to retry once the blocker clears).

**The final-output block must always be the very last thing output to chat.**
