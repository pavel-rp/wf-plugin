---
name: standup
description: Composes a prioritized daily standup briefing from the active providers — recent delivery activity (commits + pull requests) via the delivery provider's recent-activity read, plus open work items, milestones, and cycles via the tracker provider's status/milestone/cycle query operations — ranked by urgency and importance into a single "today's focus" list. Names only abstract provider operations; runs against whichever tracker pack is registered, with no product string in the briefing. Degrades to a delivery-only or fully local briefing when a provider is unconfigured or fails mid-run, and always folds in the local in-flight task folders. Use to start the day, or any time you want an at-a-glance view of what to work on next. Reads _local/config.md first; run /wf:init if it is absent.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf:standup — Prioritized daily briefing through the providers

Composes one prioritized daily briefing from three sources, each named only through abstract operations: **recent delivery activity** (commits + pull requests in a recent window, via the **delivery** provider's `activity-read`), **tracker work** (open work items by status, milestones, and cycles, via `list_by_status`, `list_milestones`, `list_cycles`), and **local in-flight tasks** (the `{task-root}` task folders, read directly — the source of truth, always available with no provider registered). With no delivery or tracker provider registered, standup degrades to a local-only briefing from the local tasks alone; from all sources it derives an **urgency × importance** ranking (Phase 5) into a "today's focus" list. Design rationale for the provider abstraction lives in the paired `rationale.md` reference, never read at runtime.

**Contents:** Prerequisites · Command Syntax · Safety Rules · Phase 1 (resolve providers) · Phase 2 (delivery activity) · Phase 3 (tracker work) · Phase 4 (local tasks) · Phase 5 (prioritize + compose) · Templates · Edge Cases · Final Output.

## Prerequisites

Before the first bundled resolver MCP call, run `pwd -P` and use the returned absolute workspace directory as `workspaceRoot` on every call — never inherit a parent Agent's root; omitting `workspaceRoot` is a hard schema error. Before any other phase, obtain project config from `resolve_config({ workspaceRoot, ... })`, returning `{ workspaceRoot, registryPath, coreConfig{ taskRoot, standupStatuses, … }, idShape }`. If the resolver reports the project uninitialized, stop and direct the user to `/wf:init`. If `wf-resolver` is unavailable, stop and report it is not loaded — never hand-parse config as a fallback. `{task-root}` = `coreConfig.taskRoot`; the optional **Standup Statuses** default = `coreConfig.standupStatuses` (unset means no default — Phase 3). A registered tracker capability resolves its own project-scoped config from its own fragment binding.

## Command Syntax

```
/wf:standup [--since <window>] [--status <name> ...] [--no-write]
```

| Argument           | Required | Description                                                                                                                                                                                                                                   |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--since <window>` | NO       | The recent-activity window passed to the delivery provider's `activity-read` — a duration or relative window (e.g. `1 day`, `3 days`, `1 week`). Defaults to a recent window of **1 day**. The provider consumes it verbatim; core composes no timestamp arithmetic. |
| `--status <name>`  | NO       | A tracker workflow status name to enumerate open work items for, via `list_by_status`. Repeatable — pass it once per status. When omitted, the default statuses come from the **Standup Statuses** config key; when that too is unset, the by-status section is skipped (milestones, cycles, activity, and local tasks still render). Order is significance order — the first status listed is treated as the most active/important. |
| `--no-write`       | NO       | Emit the briefing to chat only; skip writing the `_local/standup/<date>.md` artifact. By default the briefing is also written to that local file (the source of truth for the day's snapshot). |

Zero-argument default: no argument is ever required — standup reads the default 1-day activity window, enumerates milestones/cycles, enumerates work items for the configured Standup Statuses default when set, scans local task folders, ranks everything, and writes the day's briefing artifact.

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

## Phase 1: Resolve the providers once

standup self-resolves each surface it needs once and forwards nothing. Read `{task-root}` and the **Standup Statuses** default from `resolve_config({ workspaceRoot, ... })`'s `coreConfig`. Then call `resolve_provider({ workspaceRoot, surface: "delivery" })` and `resolve_provider({ workspaceRoot, surface: "tracker" })`, each returning `{ surface, owner, fragmentPath, state, degradation, diagnostics }`; if `wf-resolver` is unavailable, stop and report it is not loaded — never hand-parse the registry. Hold each record to dispatch its read operations below via `resolve_content({ workspaceRoot, ... })` (`class: fragment`), followed in-context — never a raw `Read` of the path. Either surface may resolve to no readable provider; the briefing still composes from whatever remains (the local task scan always runs).

## Phase 2: Read recent delivery activity

Zero readable delivery provider (`state: unconfigured`/`unrecoverable`) — a read falls back silently to empty: record the recent-activity view as empty with the neutral note `no delivery provider registered`, and continue; no warning, no error, no stop. Otherwise invoke `activity-read` through the resolved delivery fragment, passing `<since>` = the `--since` value or the default `1 day`. Returns recent commits (short reference, timestamp, subject) and pull requests (title, state, updated-at, URL), or empty — a delivery read never hard-fails; any underlying failure degrades to an empty stream. Hold the results for ranking.

## Phase 3: Read the tracker work (status / milestones / cycles)

Each tracker read consumes an already-resolved status name or scope and performs no write. Zero readable tracker provider (`state: unconfigured`/`unrecoverable`) — silent local-only: attempt no tracker operation, surface no message and no capability term; record the three tracker views (work items, milestones, cycles) as empty and continue to Phase 4. Otherwise resolve the statuses to enumerate — `--status` values when passed, else the **Standup Statuses** config default (comma-separated, significance order), else **none** (skip the by-status enumeration entirely; never invent a status name) — and treat the first resolved status as most active/important. For each resolved status in order, invoke `list_by_status(<status>, <scope>)` for matching items (id + title + status), or an empty list, retaining significance order. Invoke `list_milestones(<scope>)` for active milestones (id + name + target date where present), or an empty list. Invoke `list_cycles(<scope>)` for cycles (id + name + start/end where present), or an empty list; the **current** cycle is the one whose start/end window contains today, when dated. On a mid-run tracker failure (a resolved tracker's `list_*` call errors), warn once naming the operation and error, then continue local-only for the rest of the run (no further tracker operation; no re-warn) — record whatever views were gathered before the failure; a tracker failure never blocks the briefing.

## Phase 4: Read the local in-flight tasks (source of truth)

Independently of any provider, scan `{task-root}` for in-flight task folders — always available, even with no provider registered. Glob the immediate child directories of `{task-root}` whose names look like a task id (a tracker-shaped id or the local `T<NNN>` scheme — any folder carrying a 3+-digit run), skipping `_archive/`, `profiles/`, `standup/`, and any non-task folder. For each, determine its **latest phase** from the highest-numbered artifact present (e.g. `06_qa.md` outranks `02_plan.md`) and read `index.md`'s one-line summaries when present; record the task id, title (from `00_reqs.md` / `01_spec.md`, else the folder name), and latest phase. No task folders → an empty local section; the briefing still renders from the provider sources.

## Phase 5: Prioritize and compose the briefing

Derive an **urgency × importance** ranking across the gathered items, then lead the briefing with a "today's focus" list. The scoring is deterministic — do not defer it to intuition.

**Signals** — score each candidate item (a work item, an open pull request, or an in-flight local task) on two axes. Importance (impact / commitment already made): `+2` if a work item is in the **first** resolved status (most active), `+1` if in a later resolved status; `+2` for an **open** pull request (near-done value that unblocks the pipeline), `+1` for one merged/closed inside the window (informational); `+1` if the item belongs to the **current cycle** or any milestone; `+1` for an in-flight local task at or past the `implement` phase (real work already invested). Urgency (time pressure): `+2` if the item's cycle end or milestone target date is **past or ≤ 2 days** away, `+1` if **≤ 7 days** away; `+2` for an **open** pull request (it gates a merge and reviewers are waiting); `+1` if a commit or pull request in the recent-activity window **references the item's id** (work in motion, likely worth finishing).

**Buckets (Eisenhower)** — classify each item by `urgent = urgency ≥ 2` and `important = importance ≥ 2`: **Do now** (urgent and important — open pull requests; active-status work in a cycle ending soon); **Plan** (important, not urgent — active work with no imminent deadline; upcoming milestones); **Quick** (urgent, not important — deadline-pressured but low-status items); **Later** (neither).

**Compose** — Today's focus is the **Do now** bucket then the **Plan** bucket, each sorted by `urgency + importance` descending, ties broken by most-recent activity; cap the focus list at the top ~7 items and note the remaining counts. Sections render only when they have content (an empty section shows a neutral one-line note, never a warning): Recent activity, Work items by status, Milestones, Cycles (current cycle called out), In-flight tasks (local). Every item line stays factual and abstract — id, title, status/state, and the date or activity signal that drove its rank; no concrete tool, host, or tracker name appears.

Unless `--no-write` was passed, write the composed briefing to `_local/standup/<date>.md` (create `_local/standup/` on demand), `<date>` being today's date (`YYYY-MM-DD`); overwrite an existing same-day file. The artifact carries the `**Model:**` attribution line (Templates below).

## Templates

`_local/standup/<date>.md` (the briefing — the day's snapshot):

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

When a tracker or delivery provider is unconfigured, its sections carry the neutral "none" note above — never an error or a capability term.

## Edge Cases

- **Missing config:** `_local/config.md` absent → stop: "Run /wf:init first."
- **No delivery provider registered:** the recent-activity read falls back silently to empty; the briefing still renders from tracker + local sources. No warning.
- **No tracker registered (genuinely unconfigured):** silent local-only — no tracker operation, no message, no capability term; the briefing renders from delivery activity + the local in-flight task scan.
- **No provider at all (bare-core):** the briefing is composed entirely from the local in-flight task folders under `{task-root}` — still useful, still prioritized, no capability term anywhere.
- **Registered-but-unrecoverable delivery or tracker:** a read stays silent local-only; the section shows the neutral "none" note.
- **Mid-run tracker failure** (a configured tracker's `list_*` errors): warn once naming the operation and error, then continue local-only; the briefing completes from whatever was gathered.
- **No statuses to enumerate** (no `--status` and no **Standup Statuses** default): the by-status section is skipped with a neutral note; other sections still render — never invent a status name.
- **No in-flight tasks / fresh repo:** the local section reads "none in flight"; the briefing still renders any provider sections.
- **Everything empty** (bare-core, no in-flight tasks): a minimal, still-valid, non-error briefing.
- **`--no-write`:** the briefing is emitted to chat only; no `_local/standup/` file is written.

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
