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

**Before any other phase**, obtain project config through the bundled resolver's `resolve_config` query — it returns the workspace root, the registry location, and `coreConfig` (including `taskRoot`), already resolved from `_local/config.md` (core performs no direct config-file parse). `{task-root}` below comes from `coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is uninitialized (absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the resolver runtime is unavailable, stop and report that it is not loaded (restart Claude Code) — do not hand-parse config as a fallback.

**Require a delivery provider.** Resolve the `delivery` surface once via `resolve_provider("delivery")` and hold the run-scoped record. `/wf:fleet` has **nothing to merge** without a delivery provider, so a missing one is a hard stop:

- The delivery surface is **unconfigured** (no capability owns it) → **`FLEET — Blocked`**: "No delivery provider is registered — nothing to open or merge." Dispatch no shipper, merge nothing. Stop.
- A registered delivery capability is **unrecoverable** → **`FLEET — Blocked`**, naming the record's diagnostics as a hedged candidate. Stop.
- Otherwise hold the record for the delivery reads below.

**A tracker is optional.** Resolve the `tracker` surface via `resolve_provider("tracker")`. When one is registered, umbrella expansion and blocking-edge reads are available. When none is (the surface is unconfigured), `/wf:fleet` runs **tracker-free**: it accepts only an explicit id list plus `--after` edges, does no umbrella expansion and reads no tracker edges, and surfaces no tracker-derived term. This branch is decided **only** by whether the tracker surface is owned — never by naming a provider.

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
| `--max-parallel <N>` | NO | Cap on concurrently-running shippers. Default 4. Lower it if the machine or rate limits strain. |
| `--after "<id>:<blocker>,<blocker>; …"` | NO | Extra dependency edges beyond the tracker graph — use to encode **same-file contention** (below) the tracker doesn't record. Always available, tracker or not. |

### Zero-argument default

Invoked with no arguments, `/wf:fleet` **resumes**: it re-reads the scoreboard at `_local/fleet/scoreboard.md`, reconstructs the graph and in-flight state from it, and continues the tick loop. If no scoreboard exists, stop and ask for an explicit item set: `/wf:fleet <ids-or-umbrella>`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Obtain config via `resolve_config`; resolve the `delivery` and `tracker` surfaces via `resolve_provider`.
- Invoke the tracker provider's **read** operations — `list_children` (umbrella expansion) and `list_blockers` (each item's blocking predecessors) — and its **write** operations `post_comment` / `set_status` at closeout, each by obtaining the op body via `resolve_content` (`class: fragment`) and following it in this skill's own context. Tracker mode only.
- Invoke the delivery provider's **read** operations — `activity-read`, `pr-detect`, `checks-read` — the same way, to observe what has merged and each pull request's state.
- Read and write the scoreboard and any breadcrumb **under `_local/`** only.
- Dispatch shipper subagents via the Agent tool, and invoke `/wf:ship`, `/wf:tc`, `/wf:tf` through the Skill tool (the shippers do this in their own worktrees).

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
5. **Write the scoreboard** to `_local/fleet/scoreboard.md` (create `_local/fleet/` if absent). It is the durable state — re-read it every tick so the run survives an interruption or a `/clear`. Stamp it with a `**Model:** <the runtime model id>` line. One row per item: `id | title | status (queued|dispatched|in-flight|merged|blocked) | blockers | agentId | worktree | PR | notes`. Also record the resolved `--model`, `--max-parallel`, and the mode (tracker or tracker-free).

---

## The tick loop (OBSERVE → DISPATCH → SUPERVISE → REPORT → RE-ARM)

Every tick — whether fired by a subagent completion or a re-invocation — do all five, in order, then re-arm.

### 1. OBSERVE (read-only; never mutate a working tree you don't own)

- Read the scoreboard — the authoritative record of where each agent is and what has merged.
- Read what has merged and what is open since last tick via the delivery `activity-read` operation, and each in-flight item's pull-request and check state via `pr-detect` / `checks-read`.
- For each in-flight agent, observe its progress through the **runtime Agent tool's own signals**: a running background shipper surfaces its activity, and a completed one re-invokes you with its final block. An agent doing a large edit-batch before committing is mid-flight — **uncommitted in-progress edits (a dirty working state) are active progress, never a stall** (the **dirty-status-is-not-a-stall** rule). A new commit or pull-request update since last tick is likewise active progress.
- Trust the runtime's own record of **where each agent is actually working** — an agent's assigned worktree can be lost mid-run and it may re-register elsewhere; the runtime's live agent state, not the originally-assigned path, is authoritative.
- Update the scoreboard with every delta (new merges → `merged`; new commits/pull requests → notes; each row's `worktree`/`branch`/`PR` fields to their latest observed values, so closeout can list leftovers from the scoreboard alone).

### 2. DISPATCH (fill the ready set, respecting deps, contention, and the parallel cap)

- Compute the **ready set**: queued items whose blockers are all `merged`, that don't share a serialization edge with an in-flight item, subject to `--max-parallel`.
- Dispatch each ready item as a shipper subagent (template below). Mark it `dispatched` with its `agentId` and worktree.
- When an item merges, its dependents may become ready — dispatch them next tick (or immediately, same tick).

### 3. SUPERVISE (unstick anything that isn't moving)

Apply the **supervision playbook** (below) to every in-flight agent: recycle a genuine stall, resume an interrupted one, take over a mechanical tail, never touch one that's making progress.

### 4. REPORT

One line: `<merged>/<total> done — merged this tick: … — in-flight: … — dispatched: … — waiting: …`. Note any takeover or recycle.

### 5. RE-ARM

If any item is unmerged and unblocked, keep the loop alive. Each finished background shipper re-invokes you the moment it completes — that is the primary wake. When nothing is in flight but work remains (e.g. you just recycled something and want a tight recheck), re-invoke on the supervision cadence via the runtime's self-pacing mechanism; if no such mechanism is available, rely on completing-shipper re-invocation plus a manual re-run. **Never** stop while any item is unmerged and unblocked. When **every** item is `merged` or terminally `blocked`: run the **Closeout** (below), emit the `FLEET —` block, and do **not** re-arm.

---

## Closeout — resolve the parents, not just the children

The shippers close their own items (via `/wf:tf`), but **parent/umbrella tasks are the orchestrator's to resolve**. When every item is `merged` or terminally `blocked`:

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

Spawn each shipper with the **Agent tool**: `subagent_type: general-purpose`, `isolation: worktree`, `run_in_background: true`, and `model:` per Model selection. Fill the prompt from this template — the CAPITALISED rules are the hard-won ones; keep them verbatim:

> Ship tracker item **`<ID>`** ("`<title>`") end-to-end to a **merged pull request**. You are in an isolated worktree of the repository.
>
> **HARD RULES — agents on this pipeline have died breaking every one of these:**
> - **NEVER** use sleep / timer / monitor / settling-window waits, and **NEVER** pause to "consult the advisor" or write a planning essay before acting. Act synchronously: check an external condition once immediately, at most once more, then proceed with the fallback. (The #1 cause of a shipper producing nothing is an advisor/planning loop before the first file is written.)
> - **NEVER** end a turn waiting on a background child — a spawned agent's / background command's completion goes to the ORCHESTRATOR, not to you, so it will never re-invoke you. Run every check in the foreground.
> - **COMMIT EARLY, PUSH OFTEN.** Cut your branch from the latest delivery base — NOT via a harness "branch" skill, whose base switch checks out the trunk and breaks in a worktree. Push a work-in-progress commit the moment your first file changes, and after every step. **Uncommitted/unpushed work is invisible to the orchestrator and gets you recycled** — WIP commits are fine, a squash-merge erases them.
> - **If your isolated worktree is unavailable or lost, STOP and report it — do NOT fall back to the shared checkout.** Working in the shared checkout corrupts the orchestrator's view and other agents.
> - One un-chained shell command per call (no `&&`, `;`, `|`); **Write/Edit tools for ALL file content** (no heredocs, no inline interpreters, no echo-redirects); no destructive version-control operations.
> - **A DENIED CALL MEANS THE CALL WAS SHAPED WRONG — rewrite it, never retry verbatim, never wait for approval.** Nobody is watching to approve anything. Rewrite ladder, in order: (1) split any chain into single calls; (2) move file content into the Write/Edit tools and reference the file; (3) replace pipes/filters with the tool's built-ins; (4) swap the gated command for an ungated equivalent (dedicated Read/Glob/Grep tools over shell). If two rewrites still get denied, that step is **blocked** — record it and move on; never sit at a prompt.
> - **Capped review:** after requesting/re-requesting a code review, poll at most twice (~2 min apart); if nothing lands, note it on the pull request and proceed to merge — never wait indefinitely.
>
> **EXECUTE:** invoke `/wf:ship <ID>` through the Skill tool and drive it to a merged pull request. If `/wf:ship` is unavailable or its checks loop cannot run, fall back to the project pipeline: `/wf:tc <ID> --no-isolated`, then `/wf:tf <ID>`. `--no-isolated` matters when the project's isolated-phases setting is on — otherwise the phase subagents run isolated and **strip this prompt's binding context**.
>
> **MERGE ETIQUETTE:** before your version bump AND again at merge time, sync onto the latest delivery base (siblings merge concurrently). On a version-manifest conflict (a plugin manifest / shared version file), take the base's **current** value and re-apply your bump on top (never keep your stale number). Never commit to the trunk. Zero AI attribution in any commit, pull request, or comment.
>
> `<ITEM-SPECIFIC BINDING CONTEXT>` — the spec-of-record (fetch the item's tracker brief), plus any coordination notes: which files already changed under recent merges that you must preserve-and-compose-on-top-of rather than revert; pinned budgets; naming to mirror from a just-merged sibling.
>
> **REPORT (final message):** status (merged/blocked), pull-request URL, one-line change summary, and — if your worktree ever moved — its exact absolute path.

---

## Supervision playbook (the heart of it)

For each in-flight agent, classify and act:

**A. Making progress → leave it alone.** A new commit, a dirty working state, or an updated pull request since last tick. Never recycle an agent whose worktree changed — that is work in flight (**dirty-status-is-not-a-stall**).

**B. Interrupted (API error / session limit / model limit / stream stall) → resume from transcript.** The completion notification shows the agent stopped with a partial result. Its work is durable if committed (**commit-early-push-often** is what makes it so). `SendMessage` the same `agentId`: "you were interrupted, nothing is lost — continue from your last step; commit and push what exists now." A limit that has since reset just needs the resume.

**C. Genuine stall → recycle, then replace.** *Only* when the agent's committed state AND its working state are byte-identical across TWO consecutive ticks with **no** branch/pull-request — i.e. truly zero artifacts (the advisor-loop pattern). `TaskStop` the agent, then `SendMessage` the same id: "Recycled for zero artifacts. Skip ALL remaining setup. FIRST action: start the pipeline NOW (`/wf:ship <ID>`). Commit early, push often. No advisor/planning prose." If a resumed instance also produces nothing across two more ticks, `TaskStop` for good and dispatch a **fresh** agent with the full template. **Before recycling, always confirm the agent's ACTUAL worktree from the runtime's live agent state** — an agent that migrated off its assigned path looks stalled but isn't.

**D. Mechanical-tail stall → take over by re-arming, not by hand.** Work is committed and clean but the agent idles before the pull request / merge. The orchestrator issues **no** raw delivery command of its own, so take over by re-arming the shipper: `SendMessage` it to run its finalize step now; or, if it is truly dead, `TaskStop` it and dispatch a **fresh** `/wf:ship <ID>` shipper on the same id — its committed work is durable on the branch and `/wf:ship` resumes detect-first (it never double-merges). Take over only when the item is genuinely done bar the delivery tail.

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
- Record each item's chosen model in its scoreboard row (notes column) so re-dispatches and recycles reuse or deliberately upgrade it — a recycled item that stalled on `sonnet` should usually be re-dispatched on `opus`.

## Edge Cases

- **No delivery provider registered:** hard stop at Prerequisites (`FLEET — Blocked`) naming the missing surface — no shipper dispatched, nothing merged.
- **Registered-but-unrecoverable delivery provider:** Prerequisites stops with the hedged candidate-naming diagnosis from the record's diagnostics, never asserting a pack owns the surface.
- **Umbrella given but no tracker registered:** an umbrella cannot expand tracker-free → stop and ask for an explicit id list plus `--after` edges.
- **A blocker ends `blocked`, not `merged`:** its dependents can never become ready — mark them `blocked (upstream)` and surface it; don't spin.
- **Cyclic or missing dependency:** if the graph has a cycle or an edge to an unknown id, stop and report it before dispatching anything — never guess an order.
- **Same-file collision slips through (not serialized):** the losing agent hits a content conflict at merge. Let it rebase-and-resolve; if it can't autonomously, take over the rebase or serialize the remainder.
- **All shippers idle but nothing ready:** every unmerged item is blocked by an unmerged item that itself is blocked → deadlock or an unfinished blocker; report the frontier and stop re-arming if truly deadlocked.
- **`/wf:ship` absent in a shipper:** it falls back to `/wf:tc`/`/wf:tf`; if neither exists, it reports and stops — `/wf:fleet` orchestrates shippers, it does not reimplement them.
- **Undeleted remote branches / un-swept worktrees:** merged branches and clean worktrees often survive (destructive git is barred) — closeout lists them from the scoreboard for one manual sweep by the user, never a raw query.
- **Mid-run interruption:** re-invoking `/wf:fleet` with no arguments resumes from `_local/fleet/scoreboard.md`.

---

## Final Output

End every pass with this block as the very last thing output:

```
FLEET — <Running | Waiting | Complete | Blocked>

Scope:            <n> items — <merged>/<n> merged
Merged this pass: <ids or —>
In flight:        <id (agentId) …, or —>
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

`Complete` — every item is a merged pull request. `Blocked` — a required condition failed (no delivery provider, a cyclic graph, an umbrella with no tracker, or a deadlocked frontier); the `Next:` line names the command that clears it (`/wf:ship <id>` to retry one item, `/wf:charter` to re-decompose, or `/wf:init` for missing config). `Running`/`Waiting` — the loop re-arms.

**The final-output block must always be the very last thing output to chat.**
