---
name: standup
description: Composes a prioritized daily standup briefing from the active providers — recent delivery activity (commits + pull requests) via the delivery provider's recent-activity read, plus open work items, milestones, and cycles via the tracker provider's status/milestone/cycle query operations — ranked by urgency and importance into a single "today's focus" list. Names only abstract provider operations; runs against whichever tracker pack is registered, with no product string in the briefing. Degrades to a delivery-only or fully local briefing when a provider is unconfigured or fails mid-run, and always folds in the local in-flight task folders. Use to start the day, or any time you want an at-a-glance view of what to work on next. Reads _local/config.md first; run /wf:init if it is absent.
allowed-tools: [Read, Write, Edit, Glob, Bash, Task]
---

# /wf:standup — Prioritized daily briefing through the providers

Composes one prioritized daily briefing from three sources, each named only through abstract operations: **recent delivery activity** (commits + pull requests in a recent window, via the **delivery** provider's `activity-read`), **tracker work** (open work items by status, milestones, and cycles, via `list_by_status`, `list_milestones`, `list_cycles`), and **local in-flight tasks** (the `{task-root}` task folders, read directly — the source of truth, always available with no provider registered). With no delivery or tracker provider registered, standup degrades to a local-only briefing from the local tasks alone; from all sources it derives an **urgency × importance** ranking (Phase 5) into a "today's focus" list. Design rationale for the provider abstraction lives in the paired `rationale.md` reference, never read at runtime.

**Contents:** Prerequisites · Command Syntax · Safety Rules · Phase 1 (resolve providers) · Phase 2 (delivery activity) · Phase 3 (tracker work) · Phase 4 (local tasks) · Phase 4b (opt-in residue sweep) · Phase 5 (prioritize + compose) · Templates · Edge Cases · Final Output.

## Prerequisites

Before the first bundled resolver MCP call, run `pwd -P` and use the returned absolute workspace directory as `workspaceRoot` on every call — never inherit a parent Agent's root; omitting `workspaceRoot` is a hard schema error. Before any other phase, obtain project config from `resolve_config({ workspaceRoot, ... })`, returning `{ workspaceRoot, registryPath, coreConfig{ taskRoot, standupStatuses, … }, idShape }`. If the resolver reports the project uninitialized, stop and direct the user to `/wf:init`. If `wf-resolver` is unavailable, stop and report it is not loaded — never hand-parse config as a fallback. `{task-root}` = `coreConfig.taskRoot`; the optional **Standup Statuses** default = `coreConfig.standupStatuses` (unset means no default — Phase 3). A registered tracker capability resolves its own project-scoped config from its own fragment binding.

## Command Syntax

```
/wf:standup [--since <window>] [--status <name> ...] [--no-write] [--sweep-residue]
```

| Argument           | Required | Description                                                                                                                                                                                                                                   |
| ------------------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--since <window>` | NO       | The recent-activity window passed to the delivery provider's `activity-read` — a duration or relative window (e.g. `1 day`, `3 days`, `1 week`). Passing it **disables widening**: exactly one read is issued at that value, used verbatim. When omitted, a widening ladder (`1 day` → `3 days` → `1 week` → `1 month`) tries each step in order and stops at the first non-empty result or the four-step cap (Phase 2). The provider consumes each value verbatim; core composes no timestamp arithmetic. |
| `--status <name>`  | NO       | A tracker workflow status name to enumerate open work items for, via `list_by_status`. Repeatable — pass it once per status. When omitted, the default statuses come from the **Standup Statuses** config key; when that too is unset, the by-status section is skipped (milestones, cycles, activity, and local tasks still render). Order is significance order — the first status listed is treated as the most active/important. |
| `--no-write`       | NO       | Emit the briefing to chat only; skip writing the `_local/standup/<date>.md` artifact. By default the briefing is also written to that local file (the source of truth for the day's snapshot). Also suppresses the `--sweep-residue` move (Phase 4b), which then reports what it *would* have archived. |
| `--sweep-residue`  | NO       | **Archive the residue this run classified.** An action, not a mode: it moves each folder Phase 4a classified **residue** — and only those — from `{task-root}/{task-id}/` to `{task-root}/_archive/{task-id}/`, the destination the finalize terminus owns (Phase 4b). Skip-if-present: an existing archive entry is never overwritten. Performs **no** provider operation and deletes nothing. Omitting it is the default and moves nothing on disk. |

Zero-argument default: no argument is ever required — standup reads the default 1-day activity window, enumerates milestones/cycles, enumerates work items for the configured Standup Statuses default when set, scans local task folders, ranks everything, and writes the day's briefing artifact. **The sweep is never part of that default** — nothing on disk moves unless `--sweep-residue` is passed explicitly.

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**
- Read the `{task-root}` task folders and their artifacts (project config comes from the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query, not a direct config-file read).
- Read-only resolution via the `wf-resolver` `resolve_config({ workspaceRoot, ... })`, `resolve_provider({ workspaceRoot, surface: "delivery" })` / `resolve_provider({ workspaceRoot, surface: "tracker" })`, and `resolve_profile({ workspaceRoot, capability: <a resolved record's own owner> })` queries; the **read-only** delivery operation `activity-read`; and the tracker surface's **read-only query and item-read operation class** — any operation the tracker contract defines as a non-mutating enumeration or record read, `list_statuses` / `list_by_status` / `list_milestones` / `list_cycles` among them as **examples, not an exhaustive set**. standup performs **no write** through any provider.
- Write/create the briefing artifact at `_local/standup/<date>.md` and the essence cache at `_local/standup/essence-cache.json` — the whole `_local/` tree is gitignored, these are the only two permitted local writes — never a version-control operation, never a file outside `_local/`.

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

**4a — Reconcile each folder against what was positively observed.** After the scan and **before** Phase 5 ranks anything, classify every scanned folder into exactly one of three outcomes, reading only the per-item `<lifecycle>` Phase 3d carried. **A classification requires a positive observation made during this run; absence from an enumeration is never evidence of anything.** An out-of-scope item, a deleted item and a terminal item are all equally absent, so absence cannot distinguish them — and a later opt-in sweep performs an **irreversible filesystem move** on the residue outcome, so a residue asserted from emptiness destroys live work. The id-shape test that selected the folder is **necessary but not sufficient**: it picks candidates, it never classifies one.

- **residue** — *local behind tracker.* The folder's id matches an item enumerated this run under a status whose carried `<lifecycle>` is `terminal`. Record the folder and **the terminal status name it was observed in** as the finding's evidence.
- **unreported completion** — *tracker behind local.* The folder's id matches an item enumerated this run under a status whose carried `<lifecycle>` is `open`, **and** the folder's own artifacts show the work finished — its latest phase is a terminal artifact of the chain (a QA report, or a verify artifact carrying a passing verdict with nothing later). Record the folder and the open status it was observed in.
- **neither** — everything else, and the default: no matching enumerated item (outside the resolved scope, deleted, or under a status the enumeration cap never reached), no map at all because discovery degraded, a local-scheme `T<NNN>` folder (exempt — it has no tracker counterpart and can never be classified), or a matched item whose two sides agree. A `neither` folder carries **no** lag label, renders in the in-flight section exactly as today, and produces no reconciliation line.

Reconciliation adds **no** provider call and **no** per-folder read — it consumes the one enumeration Phase 3c already performed, so its cost never scales with the folder count — and it stays **read-only on every surface**: it reports a direction of lag and never acts on one. **It is a lag model, not a precedence model:** when the two sides differ one of them is behind, so the run owes a direction and a report; no rule about which side wins is written, because one would mask the tracker-behind-local direction entirely. Hold the two finding sets for the `residue` and `unreported-completions` slots; a direction with no finding leaves its slot at its absent form.

## Phase 5: Prioritize and compose the briefing

Derive an **urgency × importance** ranking across the gathered items, then lead the briefing with a "today's focus" list. The scoring is deterministic — do not defer it to intuition.

**Exclusions — applied before scoring, and owned only here.** This skill is the **sole owner** of every focus-list exclusion rule; no other phase writes one. Exactly two apply: (1) every folder Phase 4a classified **residue**; (2) every tracker-sourced item enumerated under a status whose carried `<lifecycle>` is `terminal`, whether or not a local folder exists for it. Exclusion bars an item from the **focus list only** — residue is still reported, in its own section below. Nothing else is excluded: a folder classified **neither**, and a folder whose two sides agree, are scored exactly as they are today. An **unreported completion** is deliberately *not* excluded — its item is still open, and recording that completion is real remaining work. When the run holds no map (discovery degraded, or no readable tracker) nothing is excluded and the list is composed exactly as before.

**Signals** — score each candidate item (a work item, an open pull request, or an in-flight local task) on two axes. Importance (impact / commitment already made): `+2` if a work item is in the **first** resolved status (most active), `+1` if in a later resolved status; `+2` for an **open** pull request (near-done value that unblocks the pipeline), `+1` for one merged/closed inside the window (informational); `+1` if the item belongs to the **current cycle** or any milestone; `+1` for an in-flight local task at or past the `implement` phase (real work already invested). Urgency (time pressure): `+2` if the item's cycle end or milestone target date is **past or ≤ 2 days** away, `+1` if **≤ 7 days** away; `+2` for an **open** pull request (it gates a merge and reviewers are waiting); `+1` if a commit or pull request in the recent-activity window **references the item's id** (work in motion, likely worth finishing).

**Buckets (Eisenhower)** — classify each item by `urgent = urgency ≥ 2` and `important = importance ≥ 2`: **Do now** (urgent and important — open pull requests; active-status work in a cycle ending soon); **Plan** (important, not urgent — active work with no imminent deadline; upcoming milestones); **Quick** (urgent, not important — deadline-pressured but low-status items); **Later** (neither).

**Compose** — Today's focus is the **Do now** bucket then the **Plan** bucket, each sorted by `urgency + importance` descending, ties broken by most-recent activity; cap the focus list at the top ~7 items and note the remaining counts. Sections render only when they have content (an empty section shows a neutral one-line note, never a warning): Recent activity, Work items by status, Milestones, Cycles (current cycle called out), In-flight tasks (local), Residue, Unreported completions. The two reconciliation sections render only when Phase 4a produced a finding of that direction, each lagging folder appearing **once**, in its direction-appropriate section, labelled as such — a residue line naming the terminal status the item was observed in, an unreported-completion line naming the open status. A residue folder is reported there instead of being repeated as an in-flight line, since it is not in flight; when reconciliation produced nothing, or did not run at all, both sections are omitted entirely and the in-flight section is exactly as before. Every item line stays factual and abstract — id, title, status/state, and the date or activity signal that drove its rank; no concrete tool, host, or tracker name appears. Section order, and where each note renders, are fixed by the placeholder-hygiene and note-ordering rules in Templates — content sections first, configuration and degradation notes demoted last.

**Essence — one isolated read per focus entry that can have one.** Once the focus list is capped, give each entry that can carry one a meaning-bearing headline and a short essence body, filling the `focus-entry` slot's filled form. **The candidate set is the capped focus list and nothing below it** (a briefing listing thirty items delivers meaning for seven — an accepted consequence, not a gap), and within it only **tracker-sourced** entries: an item positively enumerated this run, or a local folder whose id matched one. Everything else is dispatched **zero** times and keeps today's line — a bare-core run's entries, a local-scheme `T<NNN>` folder, a folder that matched no enumerated item, and an open pull request (which is not a work item). This adds no exclusion rule and alters none; membership of the focus list is already settled above.

**Cache — check before dispatching, on every candidate.** A candidate's key is its own id paired with the `updated-at` value Phase 3c's enumeration carried for the matching item; a candidate with no such value available (a local folder that matched no enumerated item, or a tracker predating that field) has **no key** and is a **permanent cache miss** — dispatched every run, never written under a guessed key. Read `_local/standup/essence-cache.json`. A missing or unreadable file degrades to "every candidate misses" — every candidate falls through to dispatch exactly as if this cache did not exist; never an error. **Hit** — a stored entry exists for this id and its stored `updatedAt` equals the candidate's current key value: reuse the stored `headline`/`essence` as the distiller's returned block, with **zero** dispatch and **zero** `get` call for that candidate. **Miss** — no stored entry, or a stored `updatedAt` that differs from the current key (the item changed upstream): fall through to the dispatch below unchanged, then write the returned block back to the cache keyed to the candidate's id and current `updated-at`, replacing any prior entry for that id. The **empty** block (`Headline: none`) is written back and reused on a later hit exactly like a filled one — a description-less item costs a dispatch once, never again while its `updated-at` is unchanged. A candidate excluded from the candidate set above (bare-core, local-scheme, unmatched, a pull request) never reaches this cache step at all: no lookup, no dispatch, no write-back, and no entry in the file.

For each candidate that missed the cache, immediately before execution, call `resolve_routing` with `workspaceRoot: <the absolute pwd -P workspace root>`, `role: "item-essence-distiller"`, `unitIds: ["standup:essence"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "low", toolWork: "material", validation: "mechanical", contextIsolation: "required", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`; emit the compact operational record, halt before dispatching on `status: stop` or a non-null `diagnostic`, and otherwise obey the returned `executionShape` — this evidence selects `isolated`, so invoke one **Task** with `subagent_type: wf:item-essence-distiller`, passing the model selector only when non-null and preserving inherited effort. Route afresh per candidate: one decision binds one dispatch. The prompt carries three lines and no more — `ITEM: <the id>`, `TITLE: <the entry's existing title source>`, and `RANKING: <the bucket and the driving signals scored for that item above>`. **This context issues zero per-item `get` calls of its own:** the description is read only inside the subagent, and only the returned `ITEM ESSENCE` block (an `Item:`, a `Headline:` and an `Essence:` line, at most twenty words of body) is ever read back, so no bulk description text enters this context or the briefing. Each block is self-contained and keyed by its own `Item:`, so a later change may hold one per item without altering anything here.

**Render each focus entry in one of exactly two shapes.** An entry whose block came back **filled** is *essence-bearing*: render `<n>. <id> — <the returned headline>` with the returned essence body on the next line, indented, and **without** the `— <bucket> (<driving signal>)` tail — the body now carries that ranking reason in plain language instead. Every other entry — one never dispatched, and one whose block came back with `Headline: none` for either reason — renders as today's single line, `<n>. <id> — <its existing title source> — <bucket> (<driving signal>)`, **tail intact**, with no body and no invented headline. The two shapes **coexist in one focus list**; that is the intended rendering, not an inconsistency to normalize away, and no entry is ever left without either a body or a tail. **A tail leaves an entry only in the same step that gives that entry a body** — never as a blanket rule over the list or the template — because an entry with no body has nothing restating its ranking reason, and in a bare-core run that is the entire focus list. The bucket and driving signal are still computed for every entry either way; a body-less entry simply is not rewritten. The `Final Output` `Focus:` summary line is **not** a focus entry — it keeps the work item's formal title and bucket, as `## Final Output` below already records.

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
- **Focus entry with no description, or an item read that degraded:** the distiller returns its empty block, so that entry falls back to today's single line with its `— <bucket> (<driving signal>)` tail intact — no body, no invented headline, no error, and the briefing is never blocked.
- **Bare-core run, or a local-scheme `T<NNN>` focus entry:** no such entry is tracker-sourced, so **zero** distiller dispatches are made for it; it renders as today's single line with its tail. In a bare-core run that is the whole focus list, which stays content-equivalent to the pre-essence one — the mode in which no entry has a body loses no ranking explanation at all.
- **Distiller dispatch unavailable:** treat every candidate as having returned the empty block — the whole focus list falls back to the tail-retained single line, silently, and the briefing still composes.
- **Missing or unreadable essence cache file:** degrades to "every candidate misses" — every candidate is dispatched exactly as if no cache existed; never an error, never a stale essence.
- **Candidate with no `updated-at` available:** a permanent cache miss — dispatched every run, correct but never written under a guessed key.
- **Reconciliation with no readable tracker:** Phase 4a is skipped silently — no classification is made, both reconciliation sections render their absent form (omitted entirely), and the local in-flight section renders exactly as today. No warning, no capability term, no hint that anything was checked.
- **Reconciliation when discovery degraded:** the run holds no open/terminal map, so **every** folder is classified `neither`, every one keeps today's in-flight treatment, and no residue or unreported-completion line is emitted. Say so in one demoted note — the briefing states the folders were not checked rather than implying they were.
- **Reconciliation after a mid-run tracker failure:** the warn-once rule already applies; reconciliation then runs over whatever was positively observed *before* the failure and classifies everything else `neither` — never inferring a classification from the truncated enumeration — and the briefing completes.

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
