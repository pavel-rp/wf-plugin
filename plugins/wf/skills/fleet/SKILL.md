---
name: fleet
description: Dependency-ordered fan-out shipper. Takes a set of task ids or a tracker umbrella, builds their dependency graph from real blocking edges plus same-file-contention edges, then drives a fleet of isolated /wf:ship subagents to merged pull requests — dispatching each item only when its blockers have merged, supervising for stalls, and taking over mechanical tails. Requires a registered delivery provider and stops honestly when none is; runs tracker-free on an explicit id list. Use when you want many related tasks shipped end-to-end, in dependency order, unattended. Accepts an optional --model to pin one shipper model; by default it picks per item by complexity.
allowed-tools: [Read, Write, Edit, Glob, Bash, Task, Skill]
---

# /wf:fleet — dependency-ordered fan-out of /wf:ship subagents

`/wf:ship` takes **one** task to a merged pull request. `/wf:fleet` takes **many**: it reads their dependency graph, then keeps a pool of isolated shipper subagents running — each shipping one item via the same build → checks → merge pipeline `/wf:ship` drives — dispatching an item only once every item it depends on has merged, and supervising the whole fleet until the last pull request lands. It is the automation of hand-babysitting a wave of parallel pull requests.

**You are the orchestrator.** You run in the main conversation. You never write task code yourself; you dispatch, observe, unstick, and dispatch the next wave. The shippers do the work in isolated worktrees.

**Goal state (non-negotiable):** every in-scope item is a **merged pull request** (or honestly **blocked** with a stated reason). Do not stop while any item is unmerged and unblocked.

`/wf:fleet` orchestrates only through the abstract **delivery** and **tracker** provider contracts and the runtime Agent tool — it names no concrete version-control, tracker, or review tool, and it runs no raw delivery command of its own.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config through the bundled resolver's `resolve_config({ workspaceRoot, ... })` query — it returns the workspace root, the registry location, and `coreConfig` (including `taskRoot`), already resolved from `_local/config.md` (core performs no direct config-file parse). `{task-root}` below comes from `coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is uninitialized (absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the resolver runtime is unavailable, stop and report that it is not loaded (restart Claude Code) — do not hand-parse config as a fallback.

**Require a delivery provider.** Resolve the `delivery` surface once via `resolve_provider({ workspaceRoot, surface: "delivery" })` and hold the run-scoped record. `/wf:fleet` has **nothing to merge** without a delivery provider, so a missing one is a hard stop:

- The delivery surface is **unconfigured** (no capability owns it) → **`FLEET — Blocked`**: "No delivery provider is registered — nothing to open or merge." Dispatch no shipper, merge nothing. Stop.
- A registered delivery capability is **unrecoverable** → **`FLEET — Blocked`**, naming the record's diagnostics as a hedged candidate. Stop.
- Otherwise hold the record for the delivery reads below.

**A tracker is optional.** Resolve the `tracker` surface via `resolve_provider({ workspaceRoot, surface: "tracker" })`. When one is registered, umbrella expansion and blocking-edge reads are available. When none is (the surface is unconfigured), `/wf:fleet` runs **tracker-free**: it accepts only an explicit id list plus `--after` edges, does no umbrella expansion and reads no tracker edges, and surfaces no tracker-derived term. This branch is decided **only** by whether the tracker surface is owned — never by naming a provider.

**Obtain the composed constitution — carry it to every shipper.** The plugin's SessionStart hook injects the project's composed constitution into a normal session's context, but that hook does **not** fire in an Agent-tool worktree shipper session (determined empirically, WF-335): a dispatched worktree shipper is a nested subagent context, not a top-level Claude Code session, so no SessionStart event fires for it and its fresh worktree carries none of the `_local/` snapshot the hook would build. The unattended shippers are the very sessions that most need the non-negotiable rules, so `/wf:fleet` carries the constitution to them explicitly. Read the composed constitution **once** from `_local/constitution.md` — the same fingerprinted source the hook emits, so there is no second composition path — and hold it as the run-scoped **constitution payload**. If that file is absent or empty (no `/wf:constitution` has run), hold no payload and carry nothing downstream — mirroring the hook, which injects nothing when there is no constitution record.

---

## Command Syntax

```
/wf:fleet <id> [<id> …]              explicit item list
/wf:fleet <umbrella-id>              a tracker umbrella — ship all its children (tracker mode only)
/wf:fleet                            resume: re-read the scoreboard and continue
```

### Arguments

| Argument | Required | Meaning |
| --- | --- | --- |
| `<ids>` / `<umbrella-id>` | on first launch | The items to ship. An umbrella expands to its children via the tracker; expansion needs a registered tracker. |
| `--model <name>` | NO | Pin one model for **all** shipper subagents (`sonnet`, `opus`, …). **Default: omit → pick per item by complexity (see Model selection).** Use `--model sonnet` when low on tokens. Does not change the orchestrator's own model. |
| `--max-parallel <N>` | NO | Positive integer cap on concurrently-running shippers, validated before graph dispatch and bounded by the core maximum of 4. Default 4. Lower it if the machine or rate limits strain; values above 4 still resolve to 4 and zero/negative/non-integer values hard-stop. |
| `--after "<id>:<blocker>,<blocker>; …"` | NO | Extra dependency edges beyond the tracker graph — use to encode **same-file contention** (below) the tracker doesn't record. Always available, tracker or not. |

### Zero-argument default

Invoked with no arguments, `/wf:fleet` **resumes**: it re-reads the scoreboard at `_local/fleet/scoreboard.md`, reconstructs the graph, every durable routing-ledger record, and every `dispatched`, `in-flight`, and `awaiting-confirmation` activation from it, and continues the tick loop. Resume the exact persisted boundary with the retained operation: a persisted decision with no spawn continues that decision's spawn; a persisted terminal outcome and complete evaluation with no `postAttempt` response submits `postAttempt` against the retained prior; a persisted retry disposition with no replacement spawn launches only its recorded `retry.unitIds`. Never issue a fresh initial `resolve_routing` call for those attempts, never reset the retry cap, and preserve the recorded attempt, basis, selector provenance, and escalation origin across `/clear`. Reconcile each persisted activation intent deterministically before computing readiness. A `dispatched` row always carries the durable activation-intent token written before spawn: if authoritative runtime state correlates that token to an active agent, persist its `agentId`, worktree, and branch and mark it `in-flight`; if it proves the activation terminated or never existed, return it to `queued`; if no `agentId` was persisted and live-or-terminal state cannot be established, mark it `awaiting-confirmation`, keep it occupying capacity, and continue token-correlated supervision. Never infer absence from a missing `agentId`, requeue an uncorrelated intent, or duplicate-launch it. If the runtime cannot correlate the token, require explicit manual safety confirmation before terminally blocking or requeueing the item. `awaiting-confirmation` cannot substitute for a missing routing-ledger record; a missing or malformed retained record hard-stops recovery rather than silently rerouting. If no scoreboard exists, stop and ask for an explicit item set: `/wf:fleet <ids-or-umbrella>`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Obtain config via `resolve_config({ workspaceRoot, ... })`; resolve the `delivery` and `tracker` surfaces via `resolve_provider({ workspaceRoot, ... })`.
- Invoke the tracker provider's **read** operations — `list_children` (umbrella expansion) and `list_blockers` (each item's blocking predecessors) — and its **write** operations `post_comment` / `set_status` at closeout, each by obtaining the op body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`) and following it in this skill's own context. Tracker mode only.
- Invoke the delivery provider's **read** operations — `activity-read`, `pr-detect`, `checks-read` — the same way, to observe what has merged and each pull request's state.
- Read and write the scoreboard and any breadcrumb **under `_local/`** only, and read the composed constitution from `_local/constitution.md` to carry it into each shipper's dispatch prompt.
- Dispatch shipper subagents via the Agent tool, and invoke `/wf:ship`, `/wf:run` (and each gated `/wf:<phase>` command it names), `/wf:pr`, `/wf:tf` through the Skill tool (the shippers do this in their own worktrees).

**Forbidden:**

- Write or edit any file **outside `_local/`** — the orchestrator authors no source and no artifact; every source write belongs to the shipper subagents.
- Run any raw version-control or delivery command, or name any concrete tracker, delivery, or review tool — reach delivery/tracker state **only** through the abstract provider operations above.
- Force-remove, delete, or otherwise destructively touch any branch or worktree — closeout **lists** leftovers from the scoreboard's recorded state; it never removes them and never issues a raw branch or worktree query.
- Mutate a worktree an agent owns, or merge a pull request an agent is actively rebasing.
- Write the runtime model id aside, write any AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into the scoreboard, a comment, or any output.

---

## Step 0 — Build the graph and the scoreboard (once, at first launch)

1. **Resolve the item set.** Explicit ids → that set. An umbrella id (tracker mode) → its children via the tracker `list_children` operation. Record each item's id and title.
2. **Read the dependency graph.** In tracker mode, read each item's blocking predecessors via the tracker `list_blockers` operation. An edge `A blocked-by B` means **do not dispatch A until B is merged**. Merge in any `--after` edges. Tracker-free, the graph is exactly the `--after` edges. Items with no unmet blockers are the initial **ready set**.
3. **Validate acyclic, then order by dependency.** Topologically order the items; if the graph has a cycle or an edge to an unknown id, **stop and report it** before dispatching anything — never guess an order.
4. **⚠ Encode same-file contention as edges.** The tracker records *logical* dependencies, not *file* ones. Two items with no logical dependency that edit the **same file** (a shared contract, a shared agent, a shared config) will collide at merge. Before running, add a blocking edge between them via `--after` so they serialize. Version-manifest files (a shared version file / plugin manifest) are the exception — those collide on **every** parallel merge and are handled by rebase-and-re-bump (merge etiquette), not by serialization. Only serialize on **content** overlap. If you cannot tell, serialize — a wasted wait is cheaper than a lost agent to a conflict.
5. **Write the scoreboard** to `_local/fleet/scoreboard.md` (create `_local/fleet/` if absent). It is the durable state — re-read it every tick so the run survives an interruption or a `/clear`. Stamp it with a `**Model:** <the runtime model id>` line and a stable scoreboard run id. One row per item: `id | title | status (queued|dispatched|in-flight|awaiting-confirmation|merged|blocked) | blockers | activationIntent | routingAttempt | agentId | worktree | branch | PR | notes`. Before every spawn, derive a canonical activation-intent token from the scoreboard run id, item id, and routing attempt; atomically persist that token with status `dispatched`, then include the same token in the spawn prompt. Only after the spawn returns persist its `agentId`, worktree, and branch and transition to `in-flight`. The pre-spawn write is mandatory: a crash between spawn and response persistence leaves a correlatable, capacity-consuming intent rather than permission to launch a duplicate. `awaiting-confirmation` is nonterminal: it means the activation is preserved while a token-correlated silence probe awaits explicit child/runtime state, occupies an in-flight pool slot, never satisfies a dependency blocker or closeout, and must re-arm supervision. The `notes` cell carries any working-state checkpoint the runtime or child explicitly reports; the orchestrator never manufactures one by probing the worktree. Also record the resolved `--model`, `--max-parallel`, and the mode (tracker or tracker-free).
6. **Write the durable routing ledger** in the same scoreboard, keyed by `routingAttempt`; every activation row references exactly one ledger record. A record persists the full compact routing prior/decision: role, ordered `unitIds`, the bijective canonical token→opaque-item-id map, normalized shape evidence, `executionShape`, `effectiveParallelism`, model and effort selector values with each selector's source, fallback, and masked state, basis, attempt, escalation origin, optional `actualModel` when present, disposition, `retry.unitIds`, retained unit ids, terminal outcome, and the complete ordered evaluation. Use an explicit `—` for fields not yet produced; never discard or reconstruct an earlier value. This ledger, not `awaiting-confirmation`, is the durable routing/recovery state.

---

## The tick loop (OBSERVE → DISPATCH → SUPERVISE → REPORT → RE-ARM)

Every tick — whether fired by a subagent completion or a re-invocation — do all five, in order, then re-arm.

### 1. OBSERVE (read-only; never mutate a working tree you don't own)

- Read the scoreboard — the authoritative record of where each agent is and what has merged.
- Read what has merged and what is open since last tick via the delivery `activity-read` operation, and each in-flight item's pull-request and check state via `pr-detect` / `checks-read`.
- For each `dispatched`, `in-flight`, or `awaiting-confirmation` activation, observe its progress through the **runtime Agent tool's own signals**, correlating by `activationIntent` first and `agentId` when persisted: a running background shipper surfaces its activity, and a completed one re-invokes you with its final block. When a runtime signal or child report explicitly identifies uncommitted in-progress edits, record that working-state checkpoint in the row's `notes`; it is active progress, never a stall (the **dirty-status-is-not-a-stall** rule). Do not raw-query or infer a child's dirty state from silence. A new commit or pull-request update since last tick is likewise active progress.
- Trust the runtime's own record of **where each agent is actually working** — an agent's assigned worktree can be lost mid-run and it may re-register elsewhere; the runtime's live agent state, not the originally-assigned path, is authoritative.
- Update the scoreboard with every delta (new merges → `merged`; new commits/pull requests → notes; each row's `worktree`/`branch`/`PR` fields to their latest observed values, so closeout can list leftovers from the scoreboard alone).
- **Proof-of-ceremony check.** When a shipper reports its item merged, verify its report carries the ceremony's Final-output block — a `SHIP —` block from `/wf:ship`, or a `TF —` block on the documented fallback path. A merge reported **without** that block is a **ceremony violation (missing proof)** — the shipper either hand-rolled the build/merge with raw `git`/`gh`, or ran the ceremony but omitted the block from its report; either way the ceremony is unproven. Do not assert the cause — record the missing proof as the violation in that row's `notes` and surface it in the tick REPORT line; never log it as a clean run. The merge itself cannot be undone, so this check is preventive (the dispatch prompt makes the ceremony mandatory) and detective (this surfacing) — its value is catching the unproven merge and flagging the item so its possibly-skipped gates (verify, QA) can be run as a follow-up.

### 2. DISPATCH (fill the ready set, respecting deps, contention, and the parallel cap)

- Compute the **full ready frontier** in deterministic dependency/input order: queued items whose blockers are all `merged` and that do not share a serialization edge with a `dispatched`, `in-flight`, or `awaiting-confirmation` item. Resolve each item's model first (the pinned `--model`, otherwise §"Model selection"), then partition the frontier into stable, model-homogeneous groups without reordering items. The full group is only a candidate set; queued excess is never part of a retained routing decision.
- For each model-homogeneous group while pool slots remain, compute available pool slots after counting every `dispatched`, `in-flight`, and `awaiting-confirmation` activation (all occupy capacity) and take the first `min(group size, available slots, configured pool bound, core execution cap of four)` items as the candidate launch wave. Reuse the Prerequisites `workspaceRoot` and call `resolve_routing` with `workspaceRoot` explicitly for exactly that candidate wave, passing ordered canonical identity tokens derived from the item ids as `unitIds` and retaining a bijective token→item-id map; canonicalize by the invocation-runtime rule, disambiguating any collision with a stable SHA-256 prefix. Before every initial or replacement spawn, validate that each selected canonical token maps to exactly one in-scope item and that no two selected tokens map to the same item; a missing, ambiguous, stale, or duplicate mapping hard-stops that dispatch and blocks the affected item with the mapping diagnostic — never guess or pass the token as a task id. **Mapping invariant:** if token `unit-a1` maps to opaque item id `TASK@42`, spawn `/wf:ship TASK@42`, never `/wf:ship unit-a1`; if that mapping is absent or duplicates another selected token's item, spawn nothing. Pass the wave's shared model as `invocationModel`. If the returned `effectiveParallelism` is smaller than the candidate wave, dispatch nothing under that decision: narrow to the exact first `effectiveParallelism` items and call `resolve_routing` once more, reusing the same `workspaceRoot`, with singleton or multi-item evidence and ordered `unitIds` for that exact launch wave. Retain only the final decision whose `unitCount` and `unitIds` equal the canonical tokens mapped to the items actually launched. **Boundary 1 — before spawn:** atomically persist that final full decision/prior and token map in the routing ledger before writing any activation intent or calling the Agent tool. Dispatch every item in that exact wave under that persisted decision and leave all excess ready items outside the decision as `queued` for a later fresh initial routing call. `--max-parallel` is the outer pool cap and no decision's `effectiveParallelism` may be exceeded.
- For each selected item, derive its canonical activation-intent token, atomically persist the row as `dispatched` with that token **before** calling the Agent tool, and include the token in the shipper prompt. Count `dispatched` intents as occupied pool slots immediately. After a successful spawn response, persist `agentId`, worktree, and branch and mark it `in-flight`. If the process stops after spawn but before that second persistence, resume reconciliation must keep the intent nonterminal and capacity-consuming, correlate the token against authoritative runtime state, and never spawn the item again until absence or termination is conclusively proved. Aggregate completions back in the original dependency/input order, not completion order.
- When an item merges, its dependents may become ready — dispatch them next tick (or immediately, same tick, through a fresh routing decision for the new frontier).

### 3. SUPERVISE (unstick anything that isn't moving)

Apply the **supervision playbook** (below) to every `in-flight` or `awaiting-confirmation` agent: recycle a genuine stall, resume an interrupted one, take over a mechanical tail, never touch one that's making progress.

### 4. REPORT

One line: `<merged>/<total> done — merged this tick: … — in-flight: … — awaiting-confirmation: … — dispatched: … — waiting: …`. Note any takeover or recycle.

### 5. RE-ARM

If any item is `queued`, `dispatched`, `in-flight`, or `awaiting-confirmation`, keep the loop alive and re-arm supervision; `awaiting-confirmation` always counts as a live activation and can never satisfy closeout. Each finished background shipper re-invokes you the moment it completes — that is the primary wake. When nothing is in flight but work remains (e.g. you just recycled something and want a tight recheck), re-invoke on the supervision cadence via the runtime's self-pacing mechanism; if no such mechanism is available, rely on completing-shipper re-invocation plus a manual re-run. **Never** stop while any item is unmerged and unblocked. When **every** item is `merged` or terminally `blocked`: run the **Closeout** (below), emit the `FLEET —` block, and do **not** re-arm.

---

## Closeout — resolve the parents, not just the children

The shippers close their own items (via `/wf:tf`), but **parent/umbrella tasks are the orchestrator's to resolve**. When every item is `merged` or conclusively, terminally `blocked` — and no row is `queued`, `dispatched`, `in-flight`, or `awaiting-confirmation`:

**Tracker mode only** (an umbrella, or explicit ids with a registered tracker):

1. **Identify the parents in scope:** the umbrella id if launched with one, plus every distinct tracker parent of explicitly-listed items.
2. **Write a resolution comment on each parent** via the tracker `post_comment` operation — **always**, even for a partial outcome. One line per child: `<id> — merged <PR url>` or `<id> — blocked: <reason>`; then a short overall summary. Stamp the comment with a `**Model:** <the runtime model id>` line; no AI attribution.
3. **Move the parent to its terminal status** via the tracker `set_status` operation **only when it is truly done** — all of its children (per the tracker, not just the fleet's scope) are merged/closed. If any child is blocked or out of scope, leave the parent open — the resolution comment states exactly what remains and why.

**On the tracker-free path, skip closeout's parent resolution entirely** — there is no parent to resolve and no tracker call to make; preserving the no-tracker-call / no-capability-term guarantee on that path.

**On both paths** — from the scoreboard's own recorded state, **never a raw branch or worktree query**:

4. **List undeleted remote branches** (each row's recorded branch that survived its merge) for the user's manual cleanup sweep.
5. **List un-swept worktrees** (each row's recorded worktree). Do **not** remove them — destructive version control is forbidden; surface the paths for the user to inspect and clean up. A worktree whose row still shows uncommitted work is flagged with its owning item so the user can inspect before deciding.

---

## The shipper dispatch template (every lesson is in here)

For each exact launch wave selected in DISPATCH, reuse the absolute `workspaceRoot` captured once in Prerequisites and pass it explicitly to `resolve_routing` immediately before shipper work with `role: "shipper"`, the launch wave's ordered canonical item-identity tokens as `unitIds` (using the retained token→item-id map), and shape evidence selected solely from that launch wave's cardinality. The retained decision's `unitIds` are exactly the units dispatched under it; ready excess remains queued outside the decision:

- **One-item wave:** `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment", contextIsolation: "required", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`. This valid singleton evidence selects one `isolated` shipper.
- **Multi-item wave:** `shapeEvidence: { workSurface: "external-context", atomicity: "composite", unitCount: <wave-size>, unitsIndependent: true, ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment", contextIsolation: "required", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: <configured-pool-bound> }`. This selects `bounded-parallel` subject to `effectiveParallelism`.

For both shapes pass `supportsModelSelector: true` and `supportsEffortSelector: false`. A wave is model-homogeneous: on the **initial** call, pass its shared per-item choice as `invocationModel` — the explicit `--model` value when pinned, otherwise the per-item `sonnet`/`opus` choice from §"Model selection". A recovery never reuses that initial value as a fresh selection: continuation retains the original routing record without another call, while an authorized retry uses only the exact model/effort returned by `postAttempt`. Emit the compact operational record separately from every task artifact's
`**Model:**` attribution. On `status: stop` or non-null `diagnostic`, dispatch none of the
wave and surface the reason. Otherwise obey `executionShape` exactly: a one-item wave runs
one isolated shipper; a multi-item independent wave runs bounded-parallel and never exceeds
`effectiveParallelism`. Pass the model selector only when non-null and preserve inherited
effort. For a bounded-parallel prior, submit the **complete retained launch-wave evaluation** to parent-owned `postAttempt`, including successful siblings as `sufficient` and failed siblings with their insufficiency signals; limit only the fresh replacement Agent dispatch to the items obtained by validating and mapping the resolver-returned canonical `retry.unitIds` through the retained token→item-id map. Never omit successes from evaluation or reassurance-rerun them, and restore dependency/input order before scoreboard aggregation.

Spawn each shipper with the **Agent tool**: `subagent_type: general-purpose`, `isolation: worktree`, `run_in_background: true`, and `model:` only when routing returned a non-null model (otherwise inherit; effort always inherits because this dispatch exposes no effort selector). Fill the prompt from this template — the CAPITALISED rules are the hard-won ones; keep them verbatim. Fill `<COMPOSED CONSTITUTION>` with the run-scoped constitution payload obtained at Prerequisites (and drop that block entirely when there is no constitution record):

> Activation intent: **`<ACTIVATION-INTENT>`**. Preserve this exact token in every progress and final report so resume reconciliation can correlate this activation without launching a duplicate.
>
> Ship tracker item **`<ID>`** ("`<title>`") end-to-end to a **merged pull request**. You are in an isolated worktree of the repository.
>
> **HARD RULES — agents on this pipeline have died breaking every one of these:**
> - **NEVER** use sleep / timer / monitor / settling-window waits, and **NEVER** pause to "consult the advisor" or write a planning essay before acting. Act synchronously: check an external condition once immediately, at most once more, then proceed with the fallback. (The #1 cause of a shipper producing nothing is an advisor/planning loop before the first file is written.)
> - **NEVER** end a turn waiting on a background child — a spawned agent's / background command's completion goes to the ORCHESTRATOR, not to you, so it will never re-invoke you. Run every check in the foreground.
> - **COMMIT EARLY, PUSH OFTEN.** Cut your branch from the latest delivery base — the mandated ceremony's own branch gate does this for you and is idempotent when you are already on the task branch, so on the fallback path cut it yourself before step 1. Push a work-in-progress commit the moment your first file changes, and after every step. Uncommitted progress remains active work: report it with the activation-intent token and a concrete working-state checkpoint so the orchestrator records it in `notes` rather than inferring from silence. WIP commits are fine; a squash-merge erases them.
> - **If your isolated worktree is unavailable or lost, STOP and report it — do NOT fall back to the shared checkout.** Working in the shared checkout corrupts the orchestrator's view and other agents.
> - Some hosts enforce a shell-shape guardrail and some do not. **Do not probe for, depend on, or claim that guardrail exists.** Shape every call portably from the start: one un-chained shell command per call (no `&&`, `;`, `|`); use **Write/Edit** for ALL file content (no heredocs, inline interpreters, or echo-redirects); prefer dedicated Read/Glob/Grep tools over shell; and never use destructive version-control operations.
> - **A DENIED CALL MEANS THE CALL WAS SHAPED WRONG — rewrite it, never retry verbatim, never wait for approval.** Nobody is watching to approve anything. Rewrite ladder, in order: (1) reduce the call to one shell operation with no chain, pipe, redirect, or inline program; (2) move file content into the Write/Edit tools and reference the file; (3) replace shell inspection/filtering with the dedicated tool's built-ins; (4) replace the operation with an ungated dedicated-tool equivalent. If two distinct rewrites still get denied, that step is **blocked** — record the rejected shape and continue with independent work; never sit at a prompt.
> - **Capped review:** after requesting/re-requesting a code review, poll at most twice (~2 min apart); if nothing lands, note it on the pull request and proceed to merge — never wait indefinitely.
>
> - **ROUTE EVERY SIBLING SKILL EDGE.** Before the first sibling routing call, run `pwd -P` once and retain its absolute result as `<workspace-root>`. Immediately before each Skill-tool execution below, call `resolve_routing` with `workspaceRoot: <workspace-root>`, the stated role, one canonical singleton `unitIds` entry stable across retry (`ship:ceremony`, `ship:run-initial`, `ship:run-resume`, `ship:phase`, `ship:pr`, or `ship:finalize` for the matching edge), `shapeEvidence: { workSurface: "caller-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "none", risk: "low", toolWork: "none", validation: "mechanical", contextIsolation: "none", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: false`, and `supportsEffortSelector: false`. Include `actualModel` only when the host exposes it. Emit the compact operational record. On `status: stop` or non-null `diagnostic`, stop before work; otherwise obey the selected `inline` shape and pass no selectors. YOU own sufficiency evaluation and any `postAttempt`; a child never self-replaces.
>
> **EXECUTE — THE CEREMONY IS MANDATORY, NOT ONE OPTION AMONG SEVERAL.** Route the initial edge with `workspaceRoot: <workspace-root>`, `role: "shipper"` and `unitIds: ["ship:ceremony"]`, then drive the merge **through `/wf:ship <ID>`**, invoked with the Skill tool. This is the required path: the point of the pipeline is to run the gated wf build chain `/wf:run`'s phase graph defines and `/wf:ship` drives past its gates (`triage → spec → plan → implement → verify-spec → qa-gen → qa-auto`), not merely to produce a merge. **Hand-driving the build and merge yourself with raw `git`/`gh` is NOT an acceptable substitute for the skill** — a green pull request reached by hand skips every gate the ceremony exists to enforce and does not count as done.
>
> Only if that Skill is genuinely unavailable or its checks loop cannot run, use the project-pipeline fallback. Route and execute each edge independently in this exact order:
>
> 1. Route with `workspaceRoot: <workspace-root>`, `role: "phase-runner"` and `unitIds: ["ship:run-initial"]`, then invoke the initial `/wf:run <ID>` through the Skill tool.
> 2. On every resume, route independently with `workspaceRoot: <workspace-root>`, `role: "phase-runner"` and `unitIds: ["ship:run-resume"]` before `/wf:run <ID>`, then invoke it again through the Skill tool.
> 3. On each `RUN — gated` handoff, route with `workspaceRoot: <workspace-root>`, `role: "phase-runner"` and `unitIds: ["ship:phase"]`, then invoke the exact `/wf:<phase> <ID>` through the Skill tool.
> 4. Route with `workspaceRoot: <workspace-root>`, `role: "pr"` and `unitIds: ["ship:pr"]`, then invoke `/wf:pr <ID>` through the Skill tool.
> 5. Route with `workspaceRoot: <workspace-root>`, `role: "finalize"` and `unitIds: ["ship:finalize"]`, then invoke `/wf:tf <ID>` through the Skill tool.
>
> Each fallback edge gets its own decision and compact record immediately before execution.
>
> **MERGE ETIQUETTE:** before your version bump AND again at merge time, sync onto the latest delivery base (siblings merge concurrently). On a version-manifest conflict (a plugin manifest / shared version file), take the base's **current** value and re-apply your bump on top (never keep your stale number). Never commit to the trunk. Zero AI attribution in any commit, pull request, or comment.
>
> **NON-NEGOTIABLE PROJECT CONSTITUTION — honor every article below as a hard constraint on all work you do.** The SessionStart hook that injects these into a normal session does **not** fire in a dispatched worktree shipper, so they are carried here explicitly:
>
> `<COMPOSED CONSTITUTION>` — paste the run-scoped constitution payload obtained at Prerequisites verbatim. **Omit this whole block** when the project has no constitution record — carry nothing, exactly as the hook injects nothing then.
>
> `<ITEM-SPECIFIC BINDING CONTEXT>` — the spec-of-record (fetch the item's tracker brief), plus any coordination notes: which files already changed under recent merges that you must preserve-and-compose-on-top-of rather than revert; pinned budgets; naming to mirror from a just-merged sibling.
>
> **REPORT (final message):** status (merged/blocked), pull-request URL, one-line change summary, **the ceremony's Final-output block pasted verbatim as proof you ran it — the `/wf:ship` `SHIP — <status>` block, or the `TF — <status>` block when you took the documented fallback path** — and — if your worktree ever moved — its exact absolute path. A report that claims a merge without that block is a ceremony failure, not a success.

---

## Supervision playbook (the heart of it)

For each in-flight agent, classify and act:

**A. Making progress → leave it alone.** A new commit, a dirty working state, or an updated pull request since last tick. Never recycle an agent whose worktree changed — that is work in flight (**dirty-status-is-not-a-stall**).

**B. Interrupted (API error / session limit / model limit / stream stall) → resume from transcript.** The completion notification shows the agent stopped with a partial result. Its work is durable if committed (**commit-early-push-often** is what makes it so). `SendMessage` the same `agentId`: "you were interrupted, nothing is lost — continue from your last step; commit and push what exists now." A limit that has since reset just needs the resume.

**C. Suspected stall → probe once, then evaluate and replace only after terminal proof and resolver authorization.** When the runtime shows no child activity across TWO consecutive ticks and the delivery reads show **no** branch/pull-request artifact, silence still proves neither a clean tree nor a dead activation. Preserve the activation and `SendMessage` the same agent id once under the retained routing decision: "No artifacts are visible yet. Skip remaining setup and start `/wf:ship <ID>` now; report either active work or a terminal blocker." Do not `TaskStop` on elapsed silence or on the absence of an explicit dirty working-state checkpoint. Continue bounded supervision; while the probe lacks an explicit terminal/idle child response or a conclusive documented runtime terminal state, keep the activation, set its nonterminal scoreboard state to `awaiting-confirmation`, and re-arm supervision — never mark it `blocked` or enter closeout while the child may still run. Only after conclusive terminal evidence may the item become `blocked`, with the exact terminal reason recorded, or proceed through parent-owned recovery.

If that probed child explicitly returns a terminal zero-artifact/insufficient result, or the runtime provides a conclusive documented terminal state, record that unit's terminal evaluation. For an `isolated` prior this completes the retained attempt. For a `bounded-parallel` prior, keep the retained wave live and do not submit `postAttempt` until **every launched sibling** has its own conclusive terminal/success outcome; still-running siblings remain `in-flight`, unknown siblings remain `awaiting-confirmation`, both keep their pool capacity, and neither may be stopped or inferred. Only terminal/idle failed activations may be `TaskStop`ped. **Boundary 2 — before `postAttempt`:** atomically persist every terminal outcome and the complete ordered evaluation in the routing ledger before calling `resolve_routing` with `workspaceRoot` and `postAttempt`; after interruption, submit that retained operation without reinitializing the route or changing its attempt/provenance. Then the parent evaluates recovery according to execution shape:

- **`isolated` singleton:** submit top-level `sufficient: false` and `signals: ["repeated-failure"]`; omit `postAttempt.units` because unit evaluations are valid only for a bounded-parallel prior.
- **`bounded-parallel` wave:** evaluate the **complete retained launch wave** before replacement. `postAttempt.units` covers exactly the unit ids actually executed under that retained decision, each once; ready items left queued outside that decision are not included; successful launched siblings are `sufficient` with no insufficiency signals, and only failed launched items carry `repeated-failure`. Top-level `sufficient` is false and top-level `signals` may remain empty because the insufficient unit entries carry the evidence.

Submit that shape-valid `postAttempt` with the retained decision, including its exact ordered `unitIds`. On `status: stop`, non-null `diagnostic`, or `retain`, dispatch nothing and surface/block exactly as returned. Every authorized replacement must dispatch a **fresh** agent. **Boundary 3 — before replacement spawn:** atomically persist the complete returned decision, including disposition, retry unit ids, retained unit ids, next attempt, selector provenance, basis, and escalation origin, before writing replacement activation intents or spawning anything. On interruption, resume only that persisted replacement operation; never rerun `postAttempt`, reset the retry cap, or create a fresh initial route. On `disposition: retry`, map the canonical resolver-returned `retry.unitIds` through the retained token→item-id map and dispatch replacements solely for those mapped items, in retained decision order: one id for an isolated singleton, or the insufficient subset for a bounded-parallel wave. An empty list dispatches nothing. Obey the resolver-authorized retry shape (including composite-to-atomic when one bounded unit remains), and pass only the exact resolver-returned next-tier model/effort — never the original `invocationModel`, never an arbitrary caller shape/model change, and never the resumed same agent as the routed retry. Retain successful units and restore dependency/input order after a selective bounded retry. **Before recycling, always confirm the agent's ACTUAL worktree from the runtime's live agent state** — an agent that migrated off its assigned path looks stalled but isn't.

**D. Mechanical-tail stall → continue once, then use the same parent-owned retry gate.** Work is committed and clean but the agent idles before the pull request / merge. First `SendMessage` the same id to run its finalize step now; this is continuation under the retained routing record, so it makes no new routing call and changes no selector. If the child is truly dead or returns terminal insufficiency, `TaskStop` it and submit the same execution-shape-specific `postAttempt` described in C: top-level `repeated-failure` with no units for an isolated singleton; or complete executed-wave unit evaluations for bounded-parallel, with queued excess excluded. Obey stop/diagnostic/retain without dispatch. When and only when the returned disposition is `retry`, validate and map each canonical `retry.unitIds` token through the retained token→item-id map, then spawn fresh `/wf:ship <mapped-item-id>` agents solely for those mapped item ids (the retained singleton item or bounded insufficient subset); a missing, ambiguous, stale, or duplicate mapping dispatches nothing and blocks with the mapping diagnostic. always with the exact resolver-returned next-tier model/effort. Committed work is durable on the branch and `/wf:ship` resumes detect-first; successful siblings are never rerun. Take over only when the item is genuinely done bar the delivery tail.

**Two discipline rules that cost real rework:**

- **Never merge a pull request an agent is actively rebasing.** If the checks look clean but the agent is mid-sync, let it finish — merging out from under it lands a stale version and forces a corrective pull request. Only take over a merge when the agent has stopped.
- **Never touch a worktree an agent owns** (the **never-touch-a-worktree-an-agent-owns** rule). If the runtime shows a shipper on the shared checkout (a worktree-loss fallback), observation there is READ-ONLY until it merges and restores.

---

## The main-checkout hazard (know it cold)

A shipper's isolated worktree can vanish mid-run; a poorly-guarded fallback lands it on the **shared checkout**, on its feature branch. Symptom: the runtime shows the shared checkout on a feature branch carrying the agent's uncommitted work. When this happens: (1) do **not** run any write operation against the shared checkout; (2) observe it read-only; (3) let the agent finish and restore the trunk, or take over the tail by re-arming per playbook **D**; (4) confirm the shared checkout is back on the trunk afterward. The dispatch template's "STOP and report if your worktree is unavailable" rule is what prevents this — keep it in every prompt.

---

## Denied-call recovery — applies to YOU, the orchestrator

The run is unattended: a permission prompt that nobody answers is a dead fleet. The shippers get this rule in their dispatch prompt; **hold yourself to the same one.**

- **Shape calls to never prompt in the first place.** Stay inside the auto-approved grammar: one un-chained shell command per call, dedicated tools over shell (`Read`/`Glob`/`Grep`/`Write`/`Edit`), long bodies via a Written file.
- **If a call is denied anyway: it was shaped wrong.** Split the chain, move content to Write/Edit + file reference, use built-in filters, swap for an ungated equivalent. Never retry verbatim, never wait.
- **If two rewrites still get denied**, the action is genuinely gated: route around it (collect the leftover for the user instead), or mark the affected item `blocked` with the exact call in the notes — and keep the rest of the fleet ticking. One gated action must never freeze the loop.

---

## Model selection

The shipper model is set per dispatch via the Agent tool's `model` field. The **orchestrator** (you) always stays on the caller's model.

- **`--model <name>` given → pinned.** Every shipper uses that model; no per-item judgment. Practical use: `--model sonnet` to ship on a cheaper tier when low on tokens — the supervision logic is unchanged, though a cheaper tier may stall more often and lean harder on recycle/takeover.
- **`--model` omitted → judge each item at dispatch time, by your own read of its complexity:**
  - **`sonnet`** for simple items: small complexity, mechanical or well-templated changes (a config flag, a rename sweep, adding a test to an existing pattern), a narrow spec with no cross-cutting design decisions.
  - **`opus`** for complex items: medium/large complexity, cross-cutting or multi-file design work, tricky merge terrain (shared contracts, files siblings also touch), anything whose spec leaves real design judgment to the shipper.
  - When unsure, choose `opus` — a stalled or wrong-headed cheap shipper costs recycles and takeovers that dwarf the tier difference.
- Record each item's resolved model in its scoreboard row (notes column). A same-transcript continuation retains the original routing record without changing selectors. A fresh replacement uses only the exact model/effort returned by the parent-owned `postAttempt` decision for that unit; never choose an upgrade independently.

## Edge Cases

- **No delivery provider registered:** hard stop at Prerequisites (`FLEET — Blocked`) naming the missing surface — no shipper dispatched, nothing merged.
- **Registered-but-unrecoverable delivery provider:** Prerequisites stops with the hedged candidate-naming diagnosis from the record's diagnostics, never asserting a pack owns the surface.
- **Umbrella given but no tracker registered:** an umbrella cannot expand tracker-free → stop and ask for an explicit id list plus `--after` edges.
- **A blocker ends `blocked`, not `merged`:** its dependents can never become ready — mark them `blocked (upstream)` and surface it; don't spin.
- **Cyclic or missing dependency:** if the graph has a cycle or an edge to an unknown id, stop and report it before dispatching anything — never guess an order.
- **Same-file collision slips through (not serialized):** the losing agent hits a content conflict at merge. Let it rebase-and-resolve; if it can't autonomously, take over the rebase or serialize the remainder.
- **All shippers idle but nothing ready:** every unmerged item is blocked by an unmerged item that itself is blocked → deadlock or an unfinished blocker; report the frontier and stop re-arming if truly deadlocked.
- **`/wf:ship` absent in a shipper:** it falls back to the gated-loop pipeline (`/wf:run` loop → `/wf:pr` → `/wf:tf`); if neither exists, it reports and stops — `/wf:fleet` orchestrates shippers, it does not reimplement them.
- **Shipper merged without the ceremony block:** the shipper's report carries no `SHIP —`/`TF —` block — either it hand-rolled the build/merge with raw `git`/`gh`, or it ran `/wf:ship` (or the `/wf:run`-loop→`/wf:pr`→`/wf:tf` fallback) but omitted the proof block from its report. Either way the ceremony is unproven: the OBSERVE proof-of-ceremony check records a ceremony violation (missing proof, cause unasserted) in that row's `notes` and surfaces it in REPORT. The merge stands (it cannot be undone), but it is never reported as a clean ceremony run, and the item's possibly-skipped gates (verify, QA) are flagged for a follow-up pass.
- **Undeleted remote branches / un-swept worktrees:** merged branches and clean worktrees often survive (destructive version control is barred) — closeout lists them from the scoreboard for one manual sweep by the user, never a raw query.
- **Mid-run interruption:** re-invoking `/wf:fleet` with no arguments resumes from `_local/fleet/scoreboard.md`.

---

## Final Output

End every pass with this block as the very last thing output:

```
FLEET — <Running | Waiting | Complete | Blocked>

Scope:            <n> items — <merged>/<n> merged
Merged this pass: <ids or —>
In flight:        <id (dispatched; activationIntent) | id (in-flight; agentId) | id (awaiting-confirmation; activationIntent and agentId when known) …, or —>
Waiting on deps:  <id ← blocker …, or —>
Blocked:          <id — reason, or —>
Parents:          <parent-id closed + resolution posted | left open (<why>) + resolution posted | n/a (tracker-free), or —>
Branches to list: <merged remote branches from the scoreboard, or —>
Worktrees:        <un-swept paths from the scoreboard | kept (uncommitted work): <paths>, or —>
Next:             <exactly one of>
  re-armed — <k> item(s) still moving
  none — complete, all <n> items merged
  none — blocked: <one-line reason>
```

`In flight:` is the lossless active-activation projection, despite its retained label: include every `dispatched`, `in-flight`, and `awaiting-confirmation` scoreboard row with its state tag. A row without a persisted `agentId` is still listed by `activationIntent`; never omit it or collapse it into `Waiting on deps:`.

`Complete` — every item is a merged pull request. `Blocked` — a required condition failed (no delivery provider, a cyclic graph, an umbrella with no tracker, or a deadlocked frontier); the `Next:` line names the command that clears it (`/wf:ship <id>` to retry one item, `/wf:charter` to re-decompose, or `/wf:init` for missing config). `Running`/`Waiting` — the loop re-arms.

**The final-output block must always be the very last thing output to chat.**
