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
| `--since <window>` | NO       | The recent-activity window passed to the delivery provider's `activity-read` — a duration or relative window (e.g. `1 day`, `3 days`, `1 week`). Passing it **disables widening**: exactly one read is issued at that value, used verbatim. When omitted, a widening ladder (`1 day` → `3 days` → `1 week` → `1 month`) tries each step in order and stops at the first non-empty result or the four-step cap (Phase 2). The provider consumes each value verbatim; core composes no timestamp arithmetic. |
| `--status <name>`  | NO       | A tracker workflow status name to enumerate open work items for, via `list_by_status`. Repeatable — pass it once per status. When omitted, the default statuses come from the **Standup Statuses** config key; when that too is unset, the by-status section is skipped (milestones, cycles, activity, and local tasks still render). Order is significance order — the first status listed is treated as the most active/important. |
| `--no-write`       | NO       | Emit the briefing to chat only; skip writing the `_local/standup/<date>.md` artifact. By default the briefing is also written to that local file (the source of truth for the day's snapshot). |

Zero-argument default: no argument is ever required — standup reads the default 1-day activity window, enumerates milestones/cycles, enumerates work items for the configured Standup Statuses default when set, scans local task folders, ranks everything, and writes the day's briefing artifact.

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**
- Read the `{task-root}` task folders and their artifacts (project config comes from the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query, not a direct config-file read).
- Read-only resolution via the `wf-resolver` `resolve_config({ workspaceRoot, ... })`, `resolve_provider({ workspaceRoot, surface: "delivery" })` / `resolve_provider({ workspaceRoot, surface: "tracker" })`, and `resolve_profile({ workspaceRoot, capability: <a resolved record's own owner> })` queries; the **read-only** delivery operation `activity-read`; and the tracker surface's **read-only query and item-read operation class** — any operation the tracker contract defines as a non-mutating enumeration or record read, `list_statuses` / `list_by_status` / `list_milestones` / `list_cycles` among them as **examples, not an exhaustive set**. standup performs **no write** through any provider.
- Write/create the briefing artifact **only** at `_local/standup/<date>.md` (the whole `_local/` tree is gitignored) — never a version-control operation, never a file outside `_local/`.

**Forbidden:**
- Invoke **any** provider **write** operation — no `commit`, no `branch-create`, no `pr-*`, no `create_*` / `update` / `set_status` / `post_comment` / `attach_link`. standup is read-only on every surface.
- Modify any source file outside `_local/`, or run any version-control operation.
- Name any concrete tracker, version-control tool, host, or command string anywhere in this skill's behaviour or in the briefing it writes — only the abstract operation names and config placeholders above. The briefing must stay grep-clean of git/host/tracker strings.
- Write an AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into the briefing. Only the `**Model:**` attribution line belongs in the artifact.

## Phase 1: Resolve the providers once

standup self-resolves each surface it needs once and forwards nothing. Read `{task-root}` and the **Standup Statuses** default from `resolve_config({ workspaceRoot, ... })`'s `coreConfig`. Then call `resolve_provider({ workspaceRoot, surface: "delivery" })` and `resolve_provider({ workspaceRoot, surface: "tracker" })`, each returning `{ surface, owner, fragmentPath, state, degradation, diagnostics }`; if `wf-resolver` is unavailable, stop and report it is not loaded — never hand-parse the registry. Hold each record to dispatch its read operations below via `resolve_content({ workspaceRoot, ... })` (`class: fragment`), followed in-context — never a raw `Read` of the path. Either surface may resolve to no readable provider; the briefing still composes from whatever remains (the local task scan always runs).

When the tracker record resolves to `state: ok`, additionally call `resolve_profile({ workspaceRoot, capability: <the record's own owner> })` — the capability name is the record's own `owner` field, never one this skill hardcodes — and hold the returned persisted-values map opaquely as `<profile-values>` for Phase 3's scope classification. standup never inspects, names, or interprets any individual key in that map (Assumption: project scope is the tracker capability's own resolved fact; core reads no tracker config directly) — only how many of its entries carry a real, non-placeholder answer.

## Phase 2: Read recent delivery activity

Zero readable delivery provider (`state: unconfigured`/`unrecoverable`) — a read falls back silently to empty: record the recent-activity view as empty with the neutral note `no delivery provider registered`, `window-used` = the configured default (`1 day`), and continue; no warning, no error, no stop, no read attempted. Otherwise, `<since>` was explicitly passed via `--since` — issue exactly one `activity-read` call with that value verbatim; no widening. Set `window-used` = that value regardless of the result.

Otherwise (no readable-provider check passed, no explicit `--since`) — widen: try `activity-read` through the resolved delivery fragment with `<since>` set in turn to each ladder step — `1 day`, then `3 days`, then `1 week`, then `1 month` — stopping at the **first** step whose result is non-empty, and stopping **unconditionally** after the fourth (last) step regardless of outcome (worst case: four reads). Each call returns recent commits (short reference, timestamp, subject) and pull requests (title, state, updated-at, URL), or empty — a delivery read never hard-fails; any underlying failure degrades to an empty stream, so a failed step and a genuinely empty step are the same observation and both advance the ladder identically. There is no failure stop: the only two bounds are the provider-record check above (before any read) and the four-step cap. Set `window-used` = the exact window string of whichever step ended the loop — the step that returned non-empty, or the fourth/last step if all four were empty — so a genuinely quiet capped repository and a widened-and-found repository are distinguished purely by that string (e.g. `1 month` vs `3 days`). Hold the results and `window-used` for ranking and rendering (the render slot declared in Templates below).

## Phase 3: Read the tracker work (status / milestones / cycles)

Each tracker read consumes an already-resolved status name or scope and performs no write. Zero readable tracker provider (`state: unconfigured`/`unrecoverable`) — silent local-only: attempt no tracker operation, surface no message and no capability term; record the three tracker views (work items, milestones, cycles) as empty, leave `by-status-state` at its absent form, leave `scope-line` and `cycles-label` at their absent forms, and continue to Phase 4.

**Scope (for the header's `scope-line`).** Whenever the tracker record is readable, classify the enumeration scope from Phase 1's `<profile-values>` — a **structural count, never a key name**: count its entries whose value is present and is not a placeholder (`<none>`, `<skipped>`, or any other `<...>`-bracketed literal). Fewer than two such entries (the configured minimum a readable tracker already requires) → **team-wide**; two or more → **project-scoped** — a second real answer beyond that minimum is exactly what "a secondary scoping value" means, regardless of which key carries it. Render `**Scope:** project-scoped` or `**Scope:** team-wide` accordingly; a `<profile-values>` read that failed degrades to **team-wide** rather than a guess, since overstating "project-scoped" is the one error this outcome exists to prevent.

**Cycles (for the `## Cycles` heading's `cycles-label`).** Whenever the tracker record is readable, label the heading **team-scoped** — a cycle is a team-level time box by construction, distinct from a project-level milestone, true of every tracker capability the `tracker` surface currently binds. This is a stated property of the abstract `list_cycles` operation itself, never a per-project resolved value, so it needs no read beyond the Phase-1 record and applies regardless of the scope classification above (a resolved project scope does not make cycles project-scoped — SUB-7's whole point). Leave `cycles-label` at its absent form only when the tracker record itself is not readable.

**3a — Discover the statuses (unconditional).** Whenever the Phase-1 tracker record is readable, invoke `list_statuses(<scope>)` **exactly once**, before the display list is resolved and **regardless of which branch below supplies it**. Discovery is never conditional on the resolution branch, because the return carries two separable things — a list of status names *and* an **open/terminal map** — and only the map can supply the positive terminal observation a later phase needs. A project whose display list comes from configuration persists a status list, not a terminal marking, so conditioning discovery on the branch would leave exactly those projects with nothing ever positively observed terminal. Hold the returned `<statuses>` — each a name plus its `open`/`terminal` `<lifecycle>` value — as the run's **status map**, and hold the typed `<operation-supported>` flag. Core never decides what a status name means: every lifecycle judgement reads the returned value, never a name.

**3b — Resolve the display list** — the statuses the section *shows*, in significance order (the first is most active/important). First branch yielding a non-empty list wins: (1) the `--status` values as passed; (2) the **Standup Statuses** config default (comma-separated) — a value that is absent, the never-asked marker, or the explicitly-declined marker counts as **no configured value** and falls through; (3) the status names from 3a's map whose `<lifecycle>` is `open`; (4) none — the existing skip-with-a-neutral-note path, which now fires only when all three sources are genuinely empty, leaving `by-status-state` at its absent form. Never invent a status name.

**3c — Enumerate, bounded.** The enumeration set is the **union** of the display list and every status 3a's map reports — **terminal ones included** — on every branch; when discovery degraded there is no map and the union collapses to the display list alone. Terminal statuses are enumerated because a later phase must *positively observe* an item in one: an item's mere absence is not evidence, being equally consistent with an item outside the resolved scope, a deleted item, or a status the run never enumerated. For each status in the union, invoke `list_by_status(<status>, <scope>)` once for its matching items (id + title + status + `updated-at`), or an empty list. **The bound, stated:** at most **one** discovery call per run, plus at most **one** enumeration per status in the union, capped at **12** enumerations per run — a total that is a function of the tracker's status count and **never scales with the number of local task folders**. A status the cap prevents reaching simply yields no observation, which can never become a false classification.

**3d — Carry the classification.** Each enumerated item carries the `<lifecycle>` of the status it was enumerated under, as a fact **derived from that positive observation**, available to Phase 5's ranking and composition and to any later phase. A display-list status the map does not report is still enumerated for display but carries **no** classification; when discovery degraded, **no** item carries one. Enumerating terminal statuses changes nothing the briefing displays: the by-status section renders **only the display list's statuses**, in its significance order, exactly as before — the union's additional statuses are enumerated for the carried fact alone and are never rendered as a section of finished items.

**3e — Resolve `by-status-state` from the type, never from emptiness.** Read 3a's flag together with the Phase-1 record's `state`: flag **true** with at least one enumerated item → *real items*; flag **true** with every enumeration empty → *nothing open*; flag **false** (the contract's typed degraded-empty for a configured, recoverable pack whose fragment omits the operation), or a discovery call that errored → *could not enumerate*. An unconfigured/unrecoverable record never reaches this computation — its silent local-only path above leaves the slot at its absent form.

**Milestones and cycles.** Invoke `list_milestones(<scope>)` for active milestones (id + name + target date where present), or an empty list. Invoke `list_cycles(<scope>)` for cycles (id + name + start/end where present), or an empty list; the **current** cycle is the one whose start/end window contains today, when dated.

On a mid-run tracker failure (a resolved tracker's `list_*` call errors), warn once naming the operation and error, then continue local-only for the rest of the run (no further tracker operation; no re-warn) — record whatever views were gathered before the failure; a tracker failure never blocks the briefing.

## Phase 4: Read the local in-flight tasks (source of truth)

Independently of any provider, scan `{task-root}` for in-flight task folders — always available, even with no provider registered. Glob the immediate child directories of `{task-root}` whose names look like a task id (a tracker-shaped id or the local `T<NNN>` scheme — any folder carrying a 3+-digit run), skipping `_archive/`, `profiles/`, `standup/`, and any non-task folder. For each, determine its **latest phase** from the highest-numbered artifact present (e.g. `06_qa.md` outranks `02_plan.md`) and read `index.md`'s one-line summaries when present; record the task id, title (from `00_reqs.md` / `01_spec.md`, else the folder name), and latest phase. No task folders → an empty local section; the briefing still renders from the provider sources.

## Phase 5: Prioritize and compose the briefing

Derive an **urgency × importance** ranking across the gathered items, then lead the briefing with a "today's focus" list. The scoring is deterministic — do not defer it to intuition.

**Signals** — score each candidate item (a work item, an open pull request, or an in-flight local task) on two axes. Importance (impact / commitment already made): `+2` if a work item is in the **first** resolved status (most active), `+1` if in a later resolved status; `+2` for an **open** pull request (near-done value that unblocks the pipeline), `+1` for one merged/closed inside the window (informational); `+1` if the item belongs to the **current cycle** or any milestone; `+1` for an in-flight local task at or past the `implement` phase (real work already invested). Urgency (time pressure): `+2` if the item's cycle end or milestone target date is **past or ≤ 2 days** away, `+1` if **≤ 7 days** away; `+2` for an **open** pull request (it gates a merge and reviewers are waiting); `+1` if a commit or pull request in the recent-activity window **references the item's id** (work in motion, likely worth finishing).

**Buckets (Eisenhower)** — classify each item by `urgent = urgency ≥ 2` and `important = importance ≥ 2`: **Do now** (urgent and important — open pull requests; active-status work in a cycle ending soon); **Plan** (important, not urgent — active work with no imminent deadline; upcoming milestones); **Quick** (urgent, not important — deadline-pressured but low-status items); **Later** (neither).

**Compose** — Today's focus is the **Do now** bucket then the **Plan** bucket, each sorted by `urgency + importance` descending, ties broken by most-recent activity; cap the focus list at the top ~7 items and note the remaining counts. Sections render only when they have content (an empty section shows a neutral one-line note, never a warning): Recent activity, Work items by status, Milestones, Cycles (current cycle called out), In-flight tasks (local). Every item line stays factual and abstract — id, title, status/state, and the date or activity signal that drove its rank; no concrete tool, host, or tracker name appears. Section order, and where each note renders, are fixed by the placeholder-hygiene and note-ordering rules in Templates — content sections first, configuration and degradation notes demoted last.

Unless `--no-write` was passed, write the composed briefing to `_local/standup/<date>.md` (create `_local/standup/` on demand), `<date>` being today's date (`YYYY-MM-DD`); overwrite an existing same-day file. The artifact carries the `**Model:**` attribution line (Templates below).

## Templates

**Placeholder hygiene — an emitted-line rule.** Every `<…>` below is a **fill instruction, never output**. Before emitting any line — briefing or `Final Output` — resolve each `<…>` to a real value or to that slot's absent form; **a line still carrying a literal `<…>` is never emitted**, the absent form is emitted in its place. This binds a `<…>` nested inside a quoted note as much as a bare one, and `**Model:**` renders `unknown` rather than a guess.

**Note ordering — content first.** A **neutral note** (non-actionable, stating only that a section has nothing) stays **inline** in its own section. A **configuration note** (anything asking the reader to set a value) or a **degradation note** (an unconfigured/unrecoverable provider, or a mid-run failure warning) is **demoted** to one trailing `## Notes` section rendered after every content section: no such note may be the briefing's first content line, and `## Notes` never precedes a content section. Demoted is not dropped — a mid-run failure still names the failing operation and the provider's error, and a configuration note still distinguishes a value never asked for from one the user explicitly declined. Omit `## Notes` entirely when there is nothing to demote.

### Render slots

Declared once, here. A later change computes a slot's **value** and never restructures this region. **An absent form is always today's rendering**, so a slot whose producer has not shipped leaves the briefing exactly as informative as it was before the slot existed.

| Slot | Site | Filled form | Absent form |
|---|---|---|---|
| `window-used` | header `**Window:**`; `Final Output` `Window:` | the window actually read | the configured default window, verbatim |
| `focus-entry` | each `## Today's focus` item | `<n>. <id> — <headline>` plus an indented essence body | today's single line, `— <bucket> (<driving signal>)` tail **included** |
| `scope-line` | header, below `**Window:**` | `**Scope:** <the scope actually used>` | omitted entirely |
| `cycles-label` | the `## Cycles` heading | `## Cycles — <the label>` | `## Cycles`, unlabelled |
| `by-status-state` | `## Work items by status` | one of three states — real items · nothing open · could not enumerate | today's neutral note |
| `residue` | a `## Residue` section | the reconciliation's residue findings | omitted entirely |
| `unreported-completions` | an `## Unreported completions` section | the reconciliation's completion findings | omitted entirely |

Two slots carry a rule the table cannot hold. **`focus-entry` declares two shapes that coexist in one list** — a tail is dropped per entry, and only where the same change supplies that entry's essence body; an entry that never gets one (a bare-core entry, a local-scheme id, a description-less work item) keeps its tail permanently, which in a bare-core run is the whole list. **`by-status-state` is read from a type, never from emptiness** — the tracker's operation-supported flag separates "could not enumerate" from a genuine "nothing open", and the provider record's `state` separates an unconfigured tracker from both.

`_local/standup/<date>.md` (the briefing — the day's snapshot), shown with every slot at its absent form:

```markdown
# Standup — <YYYY-MM-DD>

**Model:** <the runtime model id, else "unknown">
**Window:** <the window actually read> · **Providers:** delivery <resolved | none> · tracker <resolved | none>

## Today's focus

1. <id / ref> — <title> — <bucket> (<the driving signal, e.g. "open pull request", "cycle ends in 1 day", "in progress + active">)
<or, when the focus list is empty, the one line "Nothing pressing — see the sections below.">

## Recent activity
<commits and pull requests in the window, or "none in the last <the window actually read>">

## Work items by status
<each resolved status heading with its items, or "none">

## Milestones
<milestones with target dates, or "none">

## Cycles
<cycles, current cycle marked, or "none">

## In-flight tasks (local)
<each task folder: id — title — latest phase, or "none in flight">

## Notes
<one line per configuration or degradation note — or omit this whole section>
```

An unconfigured provider leaves its section carrying the neutral "none" note above and its diagnosis in `## Notes` — never an error, never a capability term, and never the briefing's leading text.

## Edge Cases

- **Missing config:** `_local/config.md` absent → stop: "Run /wf:init first."
- **No delivery provider registered:** the recent-activity read falls back silently to empty; the briefing still renders from tracker + local sources. No warning.
- **No tracker registered (genuinely unconfigured):** silent local-only — no tracker operation, no message, no capability term; the briefing renders from delivery activity + the local in-flight task scan.
- **No provider at all (bare-core):** the briefing is composed entirely from the local in-flight task folders under `{task-root}` — still useful, still prioritized, no capability term anywhere.
- **Registered-but-unrecoverable delivery or tracker:** a read stays silent local-only; the section shows the neutral "none" note; `scope-line` and `cycles-label` stay at their absent forms (no readable tracker to describe).
- **`resolve_profile` fails or returns nothing** for an otherwise-readable tracker: `scope-line` renders `team-wide` rather than guessing `project-scoped`; `cycles-label` is unaffected (it needs only the Phase-1 record, not the profile read).
- **Mid-run tracker failure** (a configured tracker's `list_*` errors): warn once naming the operation and error, then continue local-only; the briefing completes from whatever was gathered.
- **No statuses to enumerate** (no `--status`, no configured **Standup Statuses** value, *and* discovery reported no status names): the by-status section is skipped with a neutral note; other sections still render — never invent a status name.
- **Tracker pack without the discovery operation** (configured and recoverable, its fragment omits it): the read lands on the contract's typed degraded-empty carrying `<operation-supported>` at **false** — silent, no error, no warning. The by-status section renders *could not enumerate*, never a section that reads as "no work", and no item carries an open/terminal classification.
- **Discovery fails mid-run:** the warn-once rule above applies; the display list still renders from `--status` or configuration, `by-status-state` is *could not enumerate*, and no item carries an open/terminal classification — degraded, never wrong.
- **No in-flight tasks / fresh repo:** the local section reads "none in flight"; the briefing still renders any provider sections.
- **Everything empty** (bare-core, no in-flight tasks): a minimal, still-valid, non-error briefing.
- **`--no-write`:** the briefing is emitted to chat only; no `_local/standup/` file is written.

## Final Output

```
STANDUP — <briefed | briefed local-only>

Date: <YYYY-MM-DD> · Window: <the window actually read>
Providers: delivery <resolved | none> · tracker <resolved | none | failed mid-run (reason)>
Focus: <n> item(s) — top: <id — title> (<bucket>)   (or "nothing pressing")
Sources: activity <n commits / n PRs | none> · work items <n | none> · milestones <n | none> · cycles <n | none> · local tasks <n | none>
Briefing: _local/standup/<date>.md   (or "not written (--no-write)")
Next: /wf:spec <the top-focus item's id> — start it, or /wf:run <the same id> to drive its chain
```

`briefed` — at least one provider resolved and contributed. `briefed local-only` — no provider resolved (or all degraded); the briefing was composed from the local in-flight task folders alone.

**The `Next:` line has exactly two forms.** Emit the substituted form above **only** when the top-focus item resolves to a task id — a work item or a local task folder. When the focus list is empty, **or** the top entry is not a task id (an open pull request is not one), emit `Next: none — nothing in flight to start` instead. A literal `<id>` is never emitted under any degradation.

**The `Focus:` summary line keeps the work item's formal title and its bucket.** It is a machine-read contract surface other skills grep, so the tail-removal that applies to a focus **entry** in the briefing artifact does not apply to this line — a settled decision recorded here so no later session re-derives or re-opens it.

The field set, field names, field order and line shapes above are fixed. A later change supplies a field's **value** — `Window:` may carry a window wider than the configured default — and adds, removes, renames or moves nothing.

**The final output block must always be the very last thing output to chat.**
