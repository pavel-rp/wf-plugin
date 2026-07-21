---
name: charter
description: Turns a vague end-to-end feature idea into a converged feature charter plus a set of independently shippable sub-tasks — interviewed, drafted, decomposed, and reviewed to convergence, then published to the active tracker as an umbrella plus one child issue per sub-task, or seeded as local task folders when no tracker is registered. Use when a feature is too large for a single task and needs an umbrella spec decomposed before /wf:plan, /wf:spec, or /wf:run can run each piece.
allowed-tools: [Read, Write, Edit, Glob, Grep, Bash, Task, AskUserQuestion]
---

# /wf:charter — vague feature idea → converged charter + shippable sub-tasks

One level above `/wf:spec`: where `spec` turns one task into a dev-ready spec, `charter` turns one *feature* into an umbrella charter plus sub-tasks, each of which is a valid `/wf:plan` / `/wf:spec` / `/wf:run` input. It interviews the idea to convergence, drafts an umbrella charter, decomposes it into independently shippable sub-tasks, reviews the pair with fresh eyes, and — once converged — **publishes** the charter as a tracker umbrella with one child issue per sub-task (when a `tracker` provider is registered) or **seeds** each sub-task as a local task folder (when none is). Either way the downstream pipeline picks each sub-task up cold. A converged charter may also be started from an **existing tracker issue**: pass its id and `charter` adopts that issue as the umbrella, seeding the idea from its text.

The terminus is a **hand-off, not an execution**: `charter` never runs another `wf:*` skill except `/wf:index`, and it reaches the tracker only through the abstract provider contract (never a named tracker). Hand each published sub-task to the downstream chain runner (`/wf:run`) or each locally-seeded sub-task to `/wf:plan`, one at a time; or hand the whole set to `/wf:fleet`, which fans it out to parallel shippers in dependency order.

---

## Loop contract

The whole skill is this loop; keep it in mind throughout:

```
interview → writer → decomposer → reviewer ─┬─ CLEAN or accepted warnings → publish → done
                ▲            ▲              ├─ blocking findings → route back (max 3 revision rounds)
                └────────────┴──────────────┤─ user-routed questions → ask, fold in, revise
                                            └─ no progress / rounds exhausted → stop honestly
```

- Three roles run as isolated subagents dispatched via the **Task** tool — `subagent_type: wf:charter-writer`, `wf:charter-decomposer`, `wf:charter-reviewer`. The host (this skill) owns the interview, routing, user escalation, and publish — subagents cannot ask the user.
- All state lives in the charter folder's files, re-read from disk each iteration — the loop survives `/clear` and resumes from artifacts.
- **Publish happens only at convergence — never mid-loop.** The interview→writer→decomposer→reviewer loop iterates purely on the local charter files; nothing reaches the tracker until Phase 6, and only once. Every id the tracker mints is written back to the local artifacts immediately, so a publish that dies part-way resumes idempotently.
- Terminal statuses: `Converged`, `Converged with warnings`, `Needs input`, `Blocked`. Every pass ends with the `CHARTER — <status>` block (bottom of this file) as the very last output.

---

## Prerequisites

**Before any other phase**, read `_local/config.md` at the workspace root (the current working directory) and take `{task-root}` from its `## Task Folders` section — never hardcode it. If `_local/config.md` is absent, stop and direct the user to run `/wf:init` first. (Core reads `_local/config.md` for `{task-root}` — not any `wf.config.js` `docsRoot`.) The charter folder and every seeded sub-task folder live under `{task-root}`.

---

## Command Syntax

```
/wf:charter <feature idea | charter-id | tracker-issue-id>
/wf:charter
```

### Arguments

| Argument | Required | Description |
| --- | --- | --- |
| `<input>` | NO | Auto-detected (checked in this order): a charter id (`C<NNN>`) → resume that charter; else, when a `tracker` provider is active, a **bare id token** (no internal whitespace, carrying a digit run, not a `C<NNN>`) → adopt that tracker issue as the umbrella (Phase 0); anything else → the vague feature description. Empty → resume mode (see Zero-argument default). |

**Validation:**

- The raw invocation input is: `$ARGUMENTS` (empty → Zero-argument default).
- Resolve `{task-root}` per Prerequisites; create the folder if it doesn't exist.
- **Tracker-surface state** is resolved once per run (direct provider resolution — Phase 6 §"Direct provider resolution"); it decides both whether a bare id token is treated as an adoption target here and which publish arm Phase 6 takes.
- **Adoption gate (explicit id never degrades):** when the input is treated as a tracker id, its fetch is the *explicit-id* path — a failed `get` **stops** and reports (see Phase 0); it never falls back to treating the id as a feature description.

**Zero-argument default:** scan the direct children of `{task-root}` for folders containing `00_intake.md` (that file marks a charter folder) whose `01_charter.md` is absent or has a `**Status:**` other than `Published`. Exactly one in progress → resume it at the state the artifacts imply (see State model). None → print usage and ask for a feature idea. Several → list them and ask which.

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`).
- Write and edit files only inside `{task-root}` (and its charter / sub-task folders).
- Dispatch the three role subagents via the **Task** tool; ask the user via `AskUserQuestion` (host only).
- Invoke `/wf:index` (the sole `wf:*` skill this one may call) to maintain per-folder indexes.
- Reach the **`tracker` provider** through direct provider resolution for the abstract contract operations `get`, `create_umbrella`, `create_child`, `update`, `list_children`, `post_comment` — and **only** for adoption (Phase 0) and publish (Phase 6, at convergence). These are the sole external calls besides `/wf:index`; no tracker is ever named.

**Forbidden:**

- Writing anywhere outside `{task-root}` (never write outside `_local/`).
- Modifying source files; running builds, tests, or installs; any destructive or writing version-control operation.
- Invoking any `wf:*` skill other than `/wf:index` — the terminus is a hand-off, not an execution.
- Rescuing a failed subagent by doing its work inline in the host context. If a role subagent errors or its artifact is missing afterwards, halt with `CHARTER — Blocked` and surface the error. "The subagent didn't write it, I did" is not a loophole.
- Any tracker write outside publish: never mid-loop, never a `set_status`/`attach_link`/delete, never replacing an adopted umbrella's existing description (the publish `update` **appends** below a separator). The only tracker writes are `create_umbrella`/`create_child`/`update`/`post_comment` in Phase 6; the Phase 0 adoption `get` is a read.
- Editing a role's artifact from the host, with one stated exception: at convergence/publish the host may update the `**Status:**` and `**Tracker:**` metadata lines in `01_charter.md` (the umbrella-id ledger) and the `## Published ids` section of `02_subtasks.md`. (`00_intake.md` and `03_review-log.md` are host-owned outright.)

---

## State model (resume from artifacts, not memory)

Derive the next step from the folder contents — never from conversation memory:

| Observed state | Next step |
| --- | --- |
| Folder + `00_intake.md` only | Phase 2 (writer) |
| `01_charter.md` present, no `02_subtasks.md` | Phase 3 (decomposer) |
| Both present, charter `**Status:** Draft` or `In review` | Phase 4 (review round) |
| Charter `**Status:** Converged`, publish incomplete | Phase 6 (publish/retry) |
| Charter `**Status:** Published` | Done — re-emit the final block |

The review/revision counters live in `03_review-log.md`'s header line (`Reviews: <N> · Revisions used: <M> of 3`), not in memory. In tracker mode the **publish ledger** — the charter's `**Tracker:**` line and `02_subtasks.md` `## Published ids` — is likewise the source of truth for what has already been published, so a `Converged, publish incomplete` resume replays Phase 6 idempotently.

---

## Phases

### Phase 0 — Resolve input, mint id, create folder

1. Detect the input form (Arguments table, in order): a charter id resumes; else, when a `tracker` provider is active, a bare id token adopts an existing issue as the umbrella (step 1a); anything else is the feature idea.
1a. **Adopt a tracker issue as the umbrella.** Fetch it with `get(<input>)` via direct provider resolution (Phase 6 §"Direct provider resolution" — the same tracker surface). This is the *explicit-id* path:
   - **Fetch fails** (the tracker was active but `get` errored or returned no such issue) → **stop** with `CHARTER — Blocked` and report the failed fetch and id; never degrade to treating the id as a feature description.
   - **Fetch succeeds** → the fetched issue is the umbrella. Its title is the charter title; its title + description (normalised to clean markdown) is the **verbatim idea** seeding the intake. Record `**Adopted umbrella:** <input>` in `00_intake.md` (host-owned) — this marker makes publish (Phase 6) `update` the existing issue instead of minting a new one. Continue to step 2 to mint the *local* charter id and folder (the umbrella keeps its own tracker id; the `C<NNN>` names only the local artifact set).
2. Charter id: mint `C<NNN>` — scan `{task-root}` (including `_archive/`) for folders whose name matches `C` + digits + `__` or `<ABBR>-C` + digits + `__` (digits only — a task folder like `T042__…` must not match), take the highest number + 1, zero-padded to 3 digits, starting at `C001`.
3. Slug: lowercase the first ~50 chars of the title, spaces and special chars to hyphens. Folder: `{task-root}/<charter-id>__<slug>/` — a direct child of `{task-root}` (downstream folder lookups are shallow; never nest task folders inside it).
4. Write `00_intake.md`: the original idea **verbatim** (for an adopted umbrella, the fetched title + description), the input source (the description, or `adopted tracker issue <id>`), date, `**Captured by:** <model-id>` (the id from your system prompt; `unknown` if unavailable), any `**Adopted umbrella:**` marker from step 1a, and an empty `## Clarifications` section.

### Phase 1 — Interview (host, interactive)

De-vague the idea before anything is drafted:

1. List the material ambiguities — decisions that would change scope, outcomes, users, constraints, or rollout. Ignore implementation detail (that belongs to downstream phases) and anything the idea already answers.
2. Rank by impact × uncertainty. Ask up to **5** questions, sequentially (a later question may dissolve after an earlier answer), each via `AskUserQuestion` with 2–4 mutually exclusive options, the recommended option first with a one-line rationale.
3. Record every answer immediately in `00_intake.md` `## Clarifications` as a dated `Q:` / `A:` pair. Stop early once nothing material remains; list any un-asked material items under `## Deferred` in the intake.
4. If the idea is so vague that even the questions are guesses, still ask the best 5 — never refuse; the writer will log assumptions for whatever remains.
5. **No interactive user (headless run):** skip the interview entirely; every material ambiguity becomes an `[unconfirmed]` assumption the writer logs. Never hang waiting for input.

### Phase 2 — Dispatch the writer

Invoke the **Task** tool, `subagent_type: wf:charter-writer`, passing (fill the placeholders; paths absolute, forward slashes):

> Charter folder: `<abs-folder>`. Mode: `<initial | revision>`. For revision mode, apply these findings and user answers: `<the routed findings + any new clarification answers, verbatim>`. Return only the final block your role contract defines.

`CHARTER-WRITER — Complete` → confirm `01_charter.md` exists, note the `Scope changed:` flag, continue. Anything else → halt with `CHARTER — Blocked` and the subagent's error.

### Phase 3 — Dispatch the decomposer

Same shape — invoke the **Task** tool, `subagent_type: wf:charter-decomposer`:

> Charter folder: `<abs-folder>`. Mode: `<initial | revision>`. For revision mode, apply these findings: `<the routed findings, verbatim>`. Return only the final block your role contract defines.

`DECOMPOSER — Complete` → confirm `02_subtasks.md` exists. If its `Flags:` line names a product choice, raise it via `AskUserQuestion` now (Phase 5 rule 1 shape), fold the answer into the intake, and re-dispatch the decomposer with it before any review; carry an overscoped flag forward to the final block's `Flags:` line. Then continue. Anything else → halt as above.

### Phase 4 — Dispatch the reviewer

Invoke the **Task** tool, `subagent_type: wf:charter-reviewer`:

> Charter folder: `<abs-folder>`. Round: `<N>`. Return only the final block your role contract defines.

Before the first review of a run, set the charter's `**Status:** In review` (a permitted host edit). Append the returned block verbatim to `03_review-log.md` under a `## Round <N> — <date>` heading with an `**Audited by:**` line taken from the block's `Model:` field (create the file on the first review with the header `Reviews: <N> · Revisions used: <M> of 3`). `Reviews:` increments on every review; `Revisions used:` counts only revision dispatches (Phase 5).

### Phase 5 — Route and converge (host logic, deterministic)

Apply these rules to the reviewer's findings, in order:

1. **Questions first.** Any `route: user` finding or `Questions for user` entry → ask now via `AskUserQuestion` (one at a time, options included) and append answers to `00_intake.md` `## Clarifications`. Asking is free, but integration is not optional: if an answer changes the charter or the split, dispatch the writer (revision) with the answers — and the decomposer after it if `Scope changed: yes` or the answer reshapes the split — then re-review; that integration pass counts as a revision. Evaluate rules 2–4 only when no unintegrated answers remain. **Headless run:** any `route: user` finding ends the run at `CHARTER — Needs input` instead of a prompt.
2. **Clean.** Zero findings → mark `**Status:** Converged` in the charter and go to Phase 6.
3. **Warnings only** (no CRITICAL or HIGH after user answers are folded in) → present the MEDIUM/LOW findings to the user via `AskUserQuestion`: *accept as-is* → record their fingerprints under `## Accepted warnings` in the review log, mark `Converged` (final status `Converged with warnings`), go to Phase 6; *spend a round fixing them* → treat as blocking below. LOW findings never force a round on their own. (Headless: accept warnings as-is by default and record them, so the run still converges.)
4. **Blocking findings** (CRITICAL/HIGH routed to `charter-writer` or `decomposer`):
   - **No-progress guard:** fingerprint each blocking finding as `route|check|artifact-section`. If the blocking set is identical to the previous round's, stop with `CHARTER — Needs input` and show both rounds — more loops won't fix a disagreement.
   - **Round cap:** if `Revisions used` is already 3, stop with `CHARTER — Blocked` (max rounds), listing the residual findings. Never claim convergence because retries ran out.
   - Otherwise spend a revision (increment `Revisions used`): if any blocking finding routes to `charter-writer`, dispatch the writer (Phase 2, revision) with those findings; if the writer reports `Scope changed: yes`, always re-dispatch the decomposer (Phase 3, revision) afterwards — a changed charter invalidates the decomposition. If findings route only to `decomposer`, dispatch it alone. Then re-review the **full artifact set** (Phase 4) — consistency is a cross-artifact property; never re-review only the patched part.

### Phase 6 — Publish (at convergence only)

Publish runs **once, only after the loop has converged** (Phase 5 rule 2/3 has set `**Status:** Converged`). Never publish mid-loop — the whole review loop iterates on the local files alone.

#### Direct provider resolution (how the tracker ops are reached)

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

Every operation below (`get`, `create_umbrella`, `create_child`, `update`, `list_children`, `post_comment`) is reached via the identical **direct provider resolution** procedure `invocation-runtime.ops.md` §"Direct provider resolution" defines — core names only the abstract operations, never a tracker. Resolve the `tracker` surface through the bundled `wf-resolver` MCP `resolve_provider({ workspaceRoot, surface: "tracker" })` query, which returns the run-scoped record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`; then obtain each op's body through the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`, keyed on the record's `owner` and its registry-relative fragment `ref` — the locator the record carries; its `fragmentPath` field shows that `ref`'s shape) and follow it in this skill's own context to dispatch the operation. A resolved locator is never opened directly — the body always comes from `resolve_content({ workspaceRoot, ... })`. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback.

**Ledger precedence — a started publish never switches arms.** Read the ledger first: if the charter's `**Tracker:**` line already holds a real umbrella id, or the intake carries an `**Adopted umbrella:**` marker, this charter is **committed to tracker mode** — take the **TRACKER** arm regardless of the current `state`. If that surface now resolves `unconfigured`/`unrecoverable`, do **not** fall back to LOCAL-ONLY (minting local task folders would duplicate the already-published umbrella/children and orphan the ledger): stop with `CHARTER — Blocked` (`Next: /wf:charter <charter-id>`), naming the unpublished sub-tasks and directing the user to restore the tracker provider and retry. LOCAL-ONLY applies **only** when the ledger shows no tracker publish has started (no umbrella id, no adoption marker).

With no started publish, branch on the record's `state`:

- **`ok`** (a capability owns `tracker`) → the **TRACKER** arm.
- **`unconfigured`** (no capability owns `tracker`) or **`unrecoverable`** (a registered capability's `tracker` manifest could not be read) → the **LOCAL-ONLY** arm (silent local fallback; for `unrecoverable`, warn once in the hedged candidate-naming form the record's `diagnostics` supplies, per `capability-registry.ops.md`, then continue local-only).

Once publish has started the arm is fixed by the ledger — not the live registry — so a re-run (State model: `Converged`, publish incomplete) resumes the **same** arm idempotently.

#### TRACKER (provider present)

The **ledger** — two local fields that make publish idempotent and resumable — is the charter's `**Tracker:** <umbrella-id | —>` line and `02_subtasks.md` `## Published ids` (one `SUB-n → <created-id>` row per published sub-task). Write every id back **the moment the tracker returns it**, before the next call, so a publish that dies part-way keeps every recorded id.

1. **Umbrella.** Read the charter's `**Tracker:**` line and the intake's `**Adopted umbrella:**` marker:
   - **Adopted** (`**Adopted umbrella:** <id>` present) and `**Tracker:** —` → the umbrella already exists (the adopted issue): `update(<id>, description: <the issue's existing description> + a separator line + the full charter body)` — **append below the separator, never replace** the existing text. On success set the charter's `**Tracker:** <id>`.
   - **Minted** (no adoption marker) and `**Tracker:** —` → `create_umbrella(<charter title>, <charter body>)`; set the charter's `**Tracker:**` to the returned id immediately.
   - `**Tracker:**` already holds a real id → the umbrella is already published/appended (a re-run): skip the umbrella write (the `create_umbrella`/`update` idempotency guard the tracker fragment defines) and reuse that id.
2. **Existing children (re-run only).** If any `## Published ids` rows exist or the umbrella pre-existed, call `list_children(<umbrella-id>)` **once** and cache it — the match-by-title source so a retry updates rather than duplicates.
3. **Children, in dependency order.** For each sub-task, in the decomposer's dependency order:
   1. **Already published?** If `## Published ids` holds a real id for this `SUB-n`, skip creation and reuse it.
   2. **Compose the description** from the SUB brief exactly as the LOCAL-ONLY arm composes `01_spec.md` (Objective ← problem slice + desired outcome; Success Criteria ← acceptance scenarios; Scope ← in/out; Constraints; User Journeys ← actor + scenarios), plus `Type: feat|fix` and `Complexity: <S|M|L>` **as prose lines** — never a priority field, no S/M/L→priority map. Rewrite the SUB's `Depends on:` line from its `SUB-n` refs to the **real created ids** read from `## Published ids` (always present — predecessors publish first in dependency order).
   3. **Match-or-create.** If step 2's `list_children` holds a child whose title equals this sub-task's title → `update(<that-child-id>, description: <composed description>)` and adopt its id; otherwise `create_child(<umbrella-id>, <sub title>, <composed description>)` — **parent, title, description only**.
   4. **Record immediately.** Write the returned/matched id into `## Published ids` as `SUB-n → <id>` before moving to the next sub-task.
4. **Comment.** Once every child is published, and only if `## Published ids` carries no `Comment: posted` marker, `post_comment(<umbrella-id>, <body>)` — the body stating: rounds used, the full sub-task list with their created ids in dependency order, and the accepted-warning fingerprints (or "none"). Record `Comment: posted` under `## Published ids` so a re-run never double-posts.
5. **Finish.** All children published and the comment posted → set the charter's `**Status:** Published`. Hand-off is `Next: /wf:run <first-sub-id>` — the first sub-task's created id in dependency order; the chain runner picks up each published issue and creates its own task folder.
   - **Partial publish** (any tracker call errored mid-way): every id already in the ledger stays; **warn** naming the failed operation; leave `**Status:** Converged` (not `Published`); end `CHARTER — Blocked` with `Next: /wf:charter <charter-id>` and, on the `Sub-tasks:` line, the published ids plus the still-`SUB-n` unpublished ones. A retry re-resolves, re-reads `list_children`, and resumes from the ledger without duplicating.

#### LOCAL-ONLY

1. For each sub-task in dependency order: mint a `T<NNN>` id (honor a `NEXT_TASK_ID: <id>` present in conversation context first; otherwise scan `{task-root}` for `T*__*/`, `*-T*__*/`, and bare `T<NNN>/` including `_archive/`, highest + 1 — the algorithm `/wf:spec` and `/wf:plan` use, so ids never collide with theirs). Create `{task-root}/<T-id>__<sub-slug>/`, and seed `01_spec.md` in it from the SUB brief (this is the file the downstream planner reads): brief fields map to the pipeline spec shape (Objective ← problem slice + desired outcome; Success Criteria ← acceptance scenarios; Scope ← in/out; Constraints; User Journeys ← actor + scenarios), with metadata lines `**Type:** feat|fix`, `**Complexity:** <S|M|L>`, `**Tracker:** —` (unpublished), and `**Seeded by:** /wf:charter <charter-id> (<model-id>)`.
2. Record the `SUB-n → <T-id>__<sub-slug>` mapping in `02_subtasks.md` `## Published ids` (the opaque id is the full folder basename). Set the charter's `**Status:** Published`.
3. Hand-off is `Next: /wf:plan <first-sub-task-id>` — the planner resumes a pre-seeded local spec (`01_spec.md`), reusing the folder basename as the opaque id verbatim.

### Phase 7 — Finalize

1. **Charter INDEX.** Append the charter's row to `{task-root}/INDEX.md` (create the file with the header `| Status | ID | Type | Title | Complexity | Resolution | Folder |` if missing; skip if a row for this id exists): `| [x] | <charter-id> | <feat|fix> | <title> | <M if ≤3 sub-tasks, else L> | Charter — published (<n> sub-tasks)<, umbrella <umbrella-id> in tracker mode> | <folder>/ |`. The row is **checked**: a charter's own work ends at publish, and an unchecked row with no plan folder would jam a downstream unchecked-row scan. Type: `fix` if the title/idea carries fix/bug/broken/error keywords, else `feat`.
   - **LOCAL-ONLY mode** — **also append one unchecked row per seeded sub-task** (per accepted charter warning F4.1): `| [ ] | <T-id> | <type> | <sub title> | <complexity> | — | <sub-folder>/ |`.
   - **TRACKER mode** — write **only** the charter row and **skip** the per-sub-task rows: there are no local sub-task folders yet (the downstream chain runner creates each with the correct folder when it runs the published issue). Appending rows with no folder would jam the unchecked-row scan.
2. **Per-folder index.** Call `/wf:index <charter-folder-abs> charter "<title>"` for the charter. In **LOCAL-ONLY** mode also call `/wf:index <sub-folder-abs> spec "<sub title>"` for each seeded sub-task (their seeded `01_spec.md`); in **TRACKER** mode there are no seeded sub-task folders, so the charter is the only index call.
3. Emit the final block.

## Edge Cases

- **`_local/config.md` missing or has no `{task-root}`:** stop; direct the user to `/wf:init`.
- **Idea still vague after 5 questions:** proceed; the writer logs assumptions, the reviewer's assumption-hygiene check routes material ones back to the user. Never refuse the input.
- **Role subagent errors, returns an unexpected shape, or its artifact is absent afterwards:** halt with `CHARTER — Blocked` and the evidence. Do not redo its work inline.
- **Reviewer round produces the same blocking set twice:** `CHARTER — Needs input` (no-progress guard) — the disagreement needs a human.
- **Rounds exhausted with blocking findings:** `CHARTER — Blocked`, residual findings listed, artifacts preserved. Not a success.
- **Charter folder already exists for this id:** resume per the State model; never start over silently.
- **Adoption fetch of an explicit tracker id fails:** stop with `CHARTER — Blocked` naming the failed `get` and the id — never degrade an explicit id to a feature description.
- **Publish dies part-way (a tracker call errors mid-run):** every id already written to the ledger (`**Tracker:**` line + `## Published ids`) stays; leave `**Status:** Converged`; end `CHARTER — Blocked` (`Next: /wf:charter <charter-id>`). A retry re-resolves the tracker, re-reads `list_children`, and resumes from the ledger without duplicating.
- **Publish re-run after full success:** the State model routes a `Published` charter to "re-emit the final block"; if invoked again it is a no-op — the umbrella id in `**Tracker:**`, the `## Published ids` rows, and the `Comment: posted` marker guard every write.
- **Tracker `unconfigured`/`unrecoverable` at publish:** if **no** tracker publish has started (no umbrella id, no adoption marker), take the LOCAL-ONLY arm — for `unrecoverable`, warn once in the hedged candidate-naming form the resolver's `diagnostics` supplies, never asserting which pack owns `tracker`. If a tracker publish **is** in progress (ledger precedence), instead stop with `CHARTER — Blocked` and direct the user to restore the provider and retry — never duplicate already-published work by falling to local seeding.
- **More than ~10 sub-tasks in the final decomposition:** the decomposer flags it; surface the flag in the final block — the feature may really be several charters.
- **User declines to answer an escalated question:** record it under `## Deferred` in `00_intake.md` (host-owned); if it was blocking, end `CHARTER — Needs input`.
- **No interactive user (headless run):** skip interview questions and mid-loop prompts entirely; every material ambiguity becomes an `[unconfirmed]` assumption in the intake, and any `route: user` finding ends the run at `CHARTER — Needs input` instead of a prompt — never hang.

## Final Output

End every pass with this block as the very last output — nothing after it:

```
CHARTER — <Converged | Converged with warnings | Needs input | Blocked>

Charter: <charter-id> — <title>
Folder: <abs path to charter folder>
Rounds: <N> review round(s)
Sub-tasks: <n> — <ids in dependency order (created child ids in tracker mode, T-ids in local mode); a still-unpublished one shows its SUB-n>
Tracker: <umbrella-id (minted|adopted) in tracker mode | local-only>
Warnings: <accepted warning count, or —>
Flags: <decomposer flags, e.g. "likely overscoped: N sub-tasks", or —>

Next: <exactly one of>
  /wf:run <first-sub-id>             (tracker mode, converged — hand the first published sub-task to the chain runner)
  /wf:plan <first-sub-task-id>       (local-only mode, converged — hand the first sub-task to the planner)
  /wf:charter <charter-id>           (needs input answered, resume, or retry a partial publish)
  none — blocked: <one-line reason>
```
