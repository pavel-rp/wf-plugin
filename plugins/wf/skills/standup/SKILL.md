---
name: standup
description: Composes a prioritized daily standup briefing from the active providers — recent delivery activity (commits + pull requests) via the delivery provider's recent-activity read, plus open work items, milestones, and cycles via the tracker provider's status/milestone/cycle query operations — ranked by urgency and importance into a single "today's focus" list. Names only abstract provider operations; runs against whichever tracker pack is registered, with no product string in the briefing. Degrades to a delivery-only or fully local briefing when a provider is unconfigured or fails mid-run, and always folds in the local in-flight task folders. Use to start the day, or any time you want an at-a-glance view of what to work on next. Reads _local/config.md first; run /wf:init if it is absent.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf:standup — Prioritized daily briefing through the providers

Composes a single prioritized daily briefing from three sources, each named only through abstract operations:

- **Recent delivery activity** — the commits and pull requests touched in a recent window, via the **delivery** provider's `activity-read`.
- **Tracker work** — the open work items (by status), milestones, and cycles the active **tracker** provider owns, via `list_by_status`, `list_milestones`, and `list_cycles`.
- **Local in-flight tasks** — the task folders under `{task-root}`, read directly. These are the **source of truth** and are always available, even with no provider registered.

Core reaches every provider read only through the abstract **delivery** and **tracker** operations; it never knows or names which concrete tool implements them, so the same briefing renders identically against whichever tracker pack is registered. With **no** delivery or tracker provider registered, standup degrades to a **local-only** briefing built from the in-flight task folders alone — no provider operation is attempted and no capability term surfaces. From these sources it derives an **urgency × importance** ranking and leads the briefing with a short "today's focus" list.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, standupStatuses, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. `{task-root}` below comes from `coreConfig.taskRoot` — never hardcode it. The optional **Standup Statuses** value (`coreConfig.standupStatuses`, from the `## Standup` section) supplies the default work-item statuses to enumerate; an unset value simply means no default (see Phase 3). A registered tracker capability resolves its own project-scoped config from its own fragment binding; core never reads it directly.

---

## Command Syntax

```
/wf:standup [--since <window>] [--status <name> ...] [--no-write]
```

### Arguments

| Argument           | Required | Description                                                                                                                                                                                                                                   |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--since <window>` | NO       | The recent-activity window passed to the delivery provider's `activity-read` — a duration or relative window (e.g. `1 day`, `3 days`, `1 week`). Defaults to a recent window of **1 day**. The provider consumes it verbatim; core composes no timestamp arithmetic. |
| `--status <name>`  | NO       | A tracker workflow status name to enumerate open work items for, via `list_by_status`. Repeatable — pass it once per status. When omitted, the default statuses come from the **Standup Statuses** config key; when that too is unset, the by-status section is skipped (milestones, cycles, activity, and local tasks still render). Order is significance order — the first status listed is treated as the most active/important. |
| `--no-write`       | NO       | Emit the briefing to chat only; skip writing the `_local/standup/<date>.md` artifact. By default the briefing is also written to that local file (the source of truth for the day's snapshot). |

### Zero-argument default

Invoked with no arguments, standup produces a **useful briefing** immediately: it reads recent activity over the default **1 day** window, enumerates milestones and cycles (which need no status), enumerates work items for the **Standup Statuses** config default when set, scans the local in-flight task folders, ranks everything, and writes the day's briefing artifact. No argument is ever required — every source degrades to an empty section rather than blocking.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read the `{task-root}` task folders and their artifacts (project config comes from the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query, not a direct config-file read).
- Read-only resolution via the `wf-resolver` `resolve_config({ workspaceRoot, ... })` and `resolve_provider({ workspaceRoot, surface: "delivery" })` / `resolve_provider({ workspaceRoot, surface: "tracker" })` queries, and the **read-only** operations `activity-read` (delivery) and `list_by_status` / `list_milestones` / `list_cycles` (tracker). standup performs **no write** through any provider.
- Write/create the briefing artifact **only** at `_local/standup/<date>.md` (the whole `_local/` tree is gitignored) — never a version-control operation, never a file outside `_local/`.

**Forbidden:**

- Invoke **any** provider **write** operation — no `commit`, no `branch-create`, no `pr-*`, no `create_*` / `update` / `set_status` / `post_comment` / `attach_link`. standup is read-only on every surface.
- Modify any source file outside `_local/`, or run any version-control operation.
- Name any concrete tracker, version-control tool, host, or command string anywhere in this skill's behaviour or in the briefing it writes — only the abstract operation names and config placeholders above. The briefing must stay grep-clean of git/host/tracker strings.
- Write an AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into the briefing. Only the `**Model:**` attribution line belongs in the artifact.

---

## Phase 1: Resolve the providers once

standup is a **direct invocation** — the top of its own chain — and spawns no provider-operation subagent, so it self-resolves each surface it needs **once** and forwards nothing.

1. **Read `{task-root}`** (`coreConfig.taskRoot`) and the **Standup Statuses** default (`coreConfig.standupStatuses`) from `resolve_config({ workspaceRoot, ... })`'s `coreConfig` (an older repo initialized before the `## Standup` section simply surfaces `standupStatuses` unset — treat as no default).

2. **Resolve the providers.** Call the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, ... })` once per required surface — `resolve_provider({ workspaceRoot, surface: "delivery" })` and `resolve_provider({ workspaceRoot, surface: "tracker" })` — each returning the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already resolved the `## Capabilities` registry, each owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); this skill performs no registry / manifest / plugin-root read of its own. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery). Hold each surface's record — its `owner` + fragment `ref` when `state: ok`, or its `unconfigured`/`unrecoverable` outcome — to dispatch the read operations (obtaining each op's body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`) and following it in-context, never a raw `Read` of the path) in the phases below.

Both surfaces may resolve to no readable provider; standup still produces a briefing from whatever remains (the local task scan always runs). The records are runtime values — no concrete provider is named anywhere in this skill.

---

## Phase 2: Read recent delivery activity

1. **Zero readable delivery provider** (the record's `state` is `unconfigured` or `unrecoverable`) — per the delivery contract a **read falls back silently** to an empty result. Record the recent-activity view as **empty** with the neutral note `no delivery provider registered`, and continue. No warning, no error, no stop.

2. **Read activity.** Otherwise invoke `activity-read` through the resolved delivery fragment (read it and follow it in-context), passing `<since>` = the `--since` value or the default `1 day`. The operation returns recent **commits** (each with its short reference, timestamp, and subject) and recent **pull requests** (each with its title, state, updated-at, and URL), or an empty result — a delivery read never hard-fails (any underlying failure degrades to an empty stream per the contract). Hold the returned commits and pull requests for ranking.

---

## Phase 3: Read the tracker work (status / milestones / cycles)

Each tracker read consumes an already-resolved status name or scope and performs no write.

1. **Zero readable tracker provider** (the record's `state` is `unconfigured` or `unrecoverable`):
   - **Genuinely unconfigured** (`state: unconfigured` — no capability owns `tracker`) — **silent** local-only: attempt no tracker operation and surface **no message and no capability term**. Record the three tracker views (work items, milestones, cycles) as empty and continue to Phase 4.
   - **Registered-but-unrecoverable** (`state: unrecoverable` — a registered capability's manifest is unrecoverable, recorded root dangled and self-heal recovered nothing) — a tracker **read** stays **silent** local-only exactly as above (the hedged candidate-naming diagnosis is a write-side behaviour; standup writes nothing to the tracker). Record the tracker views empty and continue.

2. **Resolve the statuses to enumerate.** Use the `--status` values when passed; else the **Standup Statuses** config default (a comma-separated list in significance order); else **none** — in which case skip the by-status enumeration entirely (do not invent a status name — that would hardcode a project constant). Treat the resolved list as significance-ordered: the first status is the most active/important.

3. **Enumerate work items by status.** For each resolved status in order, invoke `list_by_status(<status>, <scope>)` through the resolved tracker fragment. Each call returns the matching work items (id + title + status), or an empty list when none match. Retain the significance order the statuses were listed in.

4. **Enumerate milestones.** Invoke `list_milestones(<scope>)` through the resolved tracker fragment — the active milestones (id + name + target date where present), or an empty list.

5. **Enumerate cycles.** Invoke `list_cycles(<scope>)` through the resolved tracker fragment — the cycles (id + name + start/end where present), or an empty list. Identify the **current** cycle as the one whose start/end window contains today, when the dates are present.

6. **Mid-run tracker failure** (a tracker was resolved but a `list_*` call errors): apply the contract's mid-run-failure rule — **warn once** for the run, naming the failing operation and the provider's error, then **continue local-only** for the rest of the run (attempt no further tracker operation; a later tracker read does **not** re-warn). Record whatever views were gathered before the failure; the briefing still completes from the delivery and local sources. A tracker failure never blocks the briefing.

---

## Phase 4: Read the local in-flight tasks (source of truth)

Independently of any provider, scan `{task-root}` for in-flight task folders — the local artifacts that are always the source of truth, and the whole briefing in bare-core.

1. **Discover task folders.** Glob the immediate child directories of `{task-root}` whose names look like a task id (a tracker-shaped id or the local `T<NNN>` scheme — any folder carrying a 3+-digit run). Skip `_archive/`, `profiles/`, `standup/`, and any non-task folder.

2. **Read each folder's state.** For each task folder, determine its **latest phase** from the highest-numbered artifact present (e.g. `06_qa.md` outranks `02_plan.md`) and read its `index.md` one-line summaries when present. Record the task id, its title (from `00_reqs.md` / `01_spec.md` when present, else the folder name), and its latest phase.

3. **No task folders** (a fresh repo, or none in flight) → an empty local section; the briefing still renders from the provider sources.

---

## Phase 5: Prioritize and compose the briefing

Derive an **urgency × importance** ranking across the gathered items, then lead the briefing with a "today's focus" list. The scoring is deterministic — do not defer it to intuition.

### Signals

Score each candidate item (a work item, an open pull request, or an in-flight local task) on two axes:

**Importance** (impact / commitment already made):

- `+2` if a work item is in the **first** resolved status (most active), `+1` if in a later resolved status.
- `+2` for an **open** pull request (near-done value that unblocks the pipeline); `+1` for a pull request merged/closed inside the window (informational).
- `+1` if the item belongs to the **current cycle** or any milestone.
- `+1` for an in-flight local task at or past the `implement` phase (real work already invested).

**Urgency** (time pressure):

- `+2` if the item's cycle end or milestone target date is **past or ≤ 2 days** away.
- `+1` if that date is **≤ 7 days** away.
- `+2` for an **open** pull request (it gates a merge and reviewers are waiting).
- `+1` if a commit or pull request in the recent-activity window **references the item's id** (work in motion — likely mid-stream and worth finishing).

### Buckets (Eisenhower)

Classify each item by `urgent = urgency ≥ 2` and `important = importance ≥ 2`:

1. **Do now** (urgent **and** important) — open pull requests; active-status work in a cycle ending soon.
2. **Plan** (important, not urgent) — active work with no imminent deadline; upcoming milestones.
3. **Quick** (urgent, not important) — deadline-pressured but low-status items.
4. **Later** (neither) — everything else.

### Compose

1. **Today's focus** — the **Do now** bucket, then the **Plan** bucket, each sorted by `urgency + importance` descending, ties broken by most-recent activity. Cap the focus list at the top ~7 items; note the remaining counts.
2. **Sections**, each rendered only when it has content (an empty section shows a neutral one-line note, never a warning): Recent activity (commits + pull requests), Work items by status, Milestones, Cycles (current cycle called out), In-flight tasks (local).
3. Every item line stays factual and abstract — id, title, status/state, and the date or activity signal that drove its rank. No concrete tool, host, or tracker name appears.

### Write the artifact

Unless `--no-write` was passed, write the composed briefing to `_local/standup/<date>.md` (create `_local/standup/` on demand), where `<date>` is today's date (`YYYY-MM-DD`). Overwrite an existing same-day file — a briefing is a fresh snapshot of the current state, so a re-run refreshes it. The artifact carries the `**Model:**` attribution line (Templates below). This local file is the day's source-of-truth snapshot.

---

## Templates

### `_local/standup/<date>.md` (the briefing — the day's snapshot)

```markdown
# Standup — <YYYY-MM-DD>

**Model:** <model identifier>
**Window:** <since window> · **Providers:** delivery <resolved | none> · tracker <resolved | none>

## Today's focus

1. <id / ref> — <title> — <bucket> (<the driving signal, e.g. "open pull request", "cycle ends in 1 day", "in progress + active">)
2. …
<or "Nothing pressing — see the sections below." when the focus list is empty>

## Recent activity
<commits and pull requests in the window, or "none (no delivery provider registered)" / "none in the last <window>">

## Work items by status
<each resolved status heading with its items, or "no statuses configured — pass --status or set Standup Statuses" / "none">

## Milestones
<milestones with target dates, or "none">

## Cycles
<cycles, current cycle marked, or "none">

## In-flight tasks (local)
<each task folder: id — title — latest phase, or "none in flight">
```

When a tracker or delivery provider is unconfigured, its sections simply carry the neutral "none" note above — never an error or a capability term.

---

## Edge Cases

- **Missing config:** `_local/config.md` absent → stop: "Run /wf:init first."
- **No delivery provider registered:** the recent-activity read falls back silently to empty (a neutral "none" note); the briefing still renders from tracker + local sources. No warning.
- **No tracker registered (genuinely unconfigured):** silent local-only — no tracker operation, no message, no capability term; the briefing renders from delivery activity + the local in-flight task scan (the bare-core briefing).
- **No provider at all (bare-core):** the briefing is composed entirely from the local in-flight task folders under `{task-root}` — still useful, still prioritized, no capability term anywhere.
- **Registered-but-unrecoverable delivery or tracker:** a **read** stays silent local-only (no hedged diagnosis — that is a write-side behaviour); the section shows the neutral "none" note.
- **Mid-run tracker failure** (a configured tracker's `list_*` errors): warn once naming the operation and error, then continue local-only; the briefing completes from whatever was gathered plus delivery + local.
- **No statuses to enumerate** (no `--status` and no **Standup Statuses** default): the by-status work-item section is skipped with a neutral note; milestones, cycles, activity, and local tasks still render — never invent a status name.
- **No in-flight tasks / fresh repo:** the local section reads "none in flight"; the briefing still renders any provider sections.
- **Everything empty** (bare-core, no in-flight tasks): a minimal briefing that states there is nothing in flight and nothing recent — still a valid, non-error result.
- **`--no-write`:** the briefing is emitted to chat only; no `_local/standup/` file is written.

---

## Final Output

```
STANDUP — <briefed | briefed local-only>

Date: <YYYY-MM-DD> · Window: <since>
Providers: delivery <resolved | none> · tracker <resolved | none | failed mid-run (reason)>
Focus: <n> item(s) — top: <id — title> (<bucket>)   (or "nothing pressing")
Sources: activity <n commits / n PRs | none> · work items <n | none> · milestones <n | none> · cycles <n | none> · local tasks <n | none>
Briefing: _local/standup/<date>.md   (or "not written (--no-write)")
Next: /wf:spec <id> — start the top-focus item, or /wf:run <id> to drive its chain
```

`briefed` — at least one provider resolved and contributed. `briefed local-only` — no provider resolved (or all degraded); the briefing was composed from the local in-flight task folders alone.

**The final output block must always be the very last thing output to chat.**
