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

```
interview → writer → decomposer → reviewer ─┬─ CLEAN or accepted warnings → publish → done
                ▲            ▲              ├─ blocking findings → route back (revision cap, extendable once per cap hit)
                └────────────┴──────────────┤─ user-routed questions → ask, fold in, revise
                                            └─ no progress → stop honestly; rounds exhausted → the cap gate, interactive only (extend / accept / stop) — headless → Blocked
```

- Three roles run as isolated subagents dispatched via the **Task** tool — `subagent_type: wf:charter-writer`, `wf:charter-decomposer`, `wf:charter-reviewer`. The host (this skill) owns the interview, routing, user escalation, and publish — subagents cannot ask the user.
- All state lives in the charter folder's files, re-read from disk each iteration — the loop survives `/clear` and resumes from artifacts.
- **Publish happens only at convergence — never mid-loop.** The interview→writer→decomposer→reviewer loop iterates purely on the local charter files; nothing reaches the tracker until Phase 6, and only once. Every id the tracker mints is written back to the local artifacts immediately, so a publish that dies part-way resumes idempotently.
- Terminal statuses: `Converged`, `Converged with warnings`, `Needs input`, `Blocked`. Every pass ends with the `CHARTER — <status>` block (bottom of this file) as the very last output.

---

## Prerequisites

Before the first bundled resolver MCP call, run `pwd -P` once and retain the absolute result as `workspaceRoot`; pass that same value explicitly in every resolver call.

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
| Both present, `**Status:** In review`, and `03_review-log.md`'s last `## Cap-gate decisions` row is `status: pending`, or `choice: stop` (any status) | Phase 5 rule 4's recorded-choice branch directly (resumes or re-emits that row's outcome, acting on the blocking findings already recorded under that cap-hit round's own `## Round <N>` heading) — never a fresh Phase 4 to re-derive those findings; only the extend branch's own re-review of the *next* round, under that rule's resume contract |
| Both present, `**Status:** In review`, `03_review-log.md`'s header `Revisions used` equals its `<cap>`, the last `## Round <N>` section still carries blocking findings (rule 4's definition, or a host disposition naming the set), and no `## Cap-gate decisions` row exists for that `<M> of <cap>` pair | Phase 5 rule 4's fresh cap-hit branch directly (interactive: the gate; headless: `CHARTER — Blocked`) — no new review; the cap-hit round's findings are already on record |
| Both present, charter `**Status:** Draft` or `In review`, and no row above matches | Phase 4 (review round) |
| Charter `**Status:** Converged`, publish incomplete | Phase 6 (publish/retry) |
| Charter `**Status:** Published` | Done — re-emit the final block |

The review/revision counters live in `03_review-log.md`'s header line (`Reviews: <N> · Revisions used: <M> of <cap>`), not in memory. In tracker mode the **publish ledger** — the charter's `**Tracker:**` line and `02_subtasks.md` `## Published ids` — is likewise the source of truth for what has already been published, so a `Converged, publish incomplete` resume replays Phase 6 idempotently. A recorded `## Cap-gate decisions` choice is durable the same way — the State model row above routes a resume straight to its follow-through rather than re-asking.

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

Immediately before each writer execution, call `resolve_routing` with `workspaceRoot: <captured workspaceRoot>`, `role:
"charter-writer"`, `unitIds: ["charter:writer"]`, `shapeEvidence: { workSurface: "external-context", atomicity:
"atomic", unitCount: 1, unitsIndependent: false, ambiguity: "material", risk:
"elevated", toolWork: "bounded", validation: "judgment", contextIsolation: "required",
independentReview: false, returnContract: "judgment", requestedParallelism: 1 }`, and
`supportsModelSelector: true` and `supportsEffortSelector: false`. Emit the compact operational record separately from
artifact `**Model:**` attribution. Hard-stop before work on `status: stop` or non-null
`diagnostic`; otherwise obey `executionShape` exactly (this evidence selects `isolated`),
invoke one Task, pass the model selector only when non-null, and preserve inherited effort. The host validates the
returned block and artifact; only a contract-defined insufficient result may be submitted
as `postAttempt` for one parent-owned retry, with sufficient work retained.

Invoke the **Task** tool, `subagent_type: wf:charter-writer`, passing (fill the placeholders; paths absolute, forward slashes):

> Charter folder: `<abs-folder>`. Mode: `<initial | revision>`. For revision mode, apply these findings and user answers: `<the routed findings + any new clarification answers, verbatim>`. Return only the final block your role contract defines. When a `granted, consumed: no` entry is on record for this dispatch (`## Growth authorizations` in `03_review-log.md`), state it: `Authorized: add exactly one new OUT for <gap>.`

`CHARTER-WRITER — Complete` → confirm `01_charter.md` exists, note the `Scope changed:` flag, continue. Anything else → halt with `CHARTER — Blocked` and the subagent's error.

### Phase 3 — Dispatch the decomposer

Immediately before each decomposer execution, call `resolve_routing` with `workspaceRoot: <captured workspaceRoot>`, `role:
"charter-decomposer"`, `unitIds: ["charter:decomposer"]`, `shapeEvidence: { workSurface: "external-context", atomicity:
"atomic", unitCount: 1, unitsIndependent: false, ambiguity: "material", risk:
"elevated", toolWork: "bounded", validation: "judgment", contextIsolation: "required",
independentReview: false, returnContract: "judgment", requestedParallelism: 1 }`,
`supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit the compact
operational record, hard-stop on `status: stop` or non-null `diagnostic`, obey
`executionShape` exactly, pass the model selector only when non-null, and preserve inherited
effort. The host retains valid decomposition work and owns any bounded `postAttempt` retry.

Same shape — invoke the **Task** tool, `subagent_type: wf:charter-decomposer`:

> Charter folder: `<abs-folder>`. Mode: `<initial | revision>`. For revision mode, apply these findings: `<the routed findings, verbatim>`. Return only the final block your role contract defines. When a `granted, consumed: no` entry is on record for this dispatch, state it: `Authorized: add exactly one new SUB for <gap>.`

`DECOMPOSER — Complete` → confirm `02_subtasks.md` exists. If its `Flags:` line names a product choice, raise it via `AskUserQuestion` now (Phase 5 rule 1 shape), fold the answer into the intake, and re-dispatch the decomposer with it before any review; carry an overscoped flag forward to the final block's `Flags:` line. Then continue. Anything else → halt as above. In revision mode, a `[growth]`-tagged `Flags:` choice defers instead to the Phase 5 growth gate, recorded now under `03_review-log.md`'s `## Growth authorizations` as `- Round <N> | gap: <flag text> | status: pending` so a resumed run recovers it — every other choice (initial mode always, or revision mode untagged) keeps this immediate ask.

### Phase 4 — Dispatch the reviewer

**Determine this round's mandate** before dispatch: `full-audit` for round 1, or when `03_review-log.md` records no prior mandate/snapshot for this charter (the in-flight-folder fallback below); `verification` otherwise — for `verification`, also resolve the prior-round snapshot pair's paths: `{charter-folder}/snapshots/01_charter.round-<N-1>.md`, `02_subtasks.round-<N-1>.md`. Immediately before each reviewer execution, call `resolve_routing` with `workspaceRoot: <captured workspaceRoot>`, `role:
"charter-reviewer"`, `unitIds: ["charter:reviewer"]`, `shapeEvidence: { workSurface: "external-context", atomicity:
"atomic", unitCount: 1, unitsIndependent: false, ambiguity: "material", risk:
"elevated", toolWork: "bounded", validation: "judgment", contextIsolation: "required",
independentReview: true, returnContract: "judgment", requestedParallelism: 1 }`,
`supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit the compact
operational record separately from the review log's `**Audited by:**` attribution. Hard-stop
on `status: stop` or non-null `diagnostic`; otherwise obey `executionShape` exactly, invoke
one isolated Task, pass the model selector only when non-null, and preserve inherited effort. Phase 5 remains the sole retry owner: retain clean/sufficient
results and submit only contract-defined insufficiency through `postAttempt` within the
existing revision cap.

Invoke the **Task** tool, `subagent_type: wf:charter-reviewer`:

> Charter folder: `<abs-folder>`. Round: `<N>`. Mandate: `<full-audit|verification>`. For `verification`, also: snapshot pair `<the two resolved paths>`. Return only the final block your role contract defines.

Before the first review of a run, set the charter's `**Status:** In review` (a permitted host edit). Append the returned block verbatim to `03_review-log.md` under a `## Round <N> — <date>` heading with an `**Audited by:**` line taken from the block's `Model:` field and a `**Mandate:** <full-audit|verification>` line (create the file on the first review with the header `Reviews: <N> · Revisions used: <M> of <cap>`). `Reviews:` increments on every review; `Revisions used:` counts only revision dispatches (Phase 5). Also record a `**Active:** OUT <n> · SUB <m>` line (active = non-retired ids in the artifacts as dispatched to this round's reviewer) — a durable per-round audit trail; the growth check itself (Phase 5) always diffs the on-disk snapshot files, never this count line.

### Phase 5 — Route and converge (host logic, deterministic)

Apply these rules to the reviewer's findings, in order:

1. **Questions first.** Any `route: user` finding or `Questions for user` entry → ask now via `AskUserQuestion` (one at a time, options included) and append answers to `00_intake.md` `## Clarifications`, **except** a `[growth]`-tagged item (a finding, a question, or a `status: pending` deferred Phase-3 flag), asked instead with exactly two options: *accept gap as warning* → record its fingerprint under `## Accepted warnings` (the same suppression the reviewer's Boundaries already honor — no revision spent) and set any matching `pending` entry to `status: declined`; *authorize one growth revision* → in `03_review-log.md`'s `## Growth authorizations`, set (or mint) the entry `status: granted, consumed: no`; increment `Revisions used` and snapshot the round just reviewed (the write below, honoring its once-per-round rule) before dispatch; state the authorization explicitly in the next writer/decomposer prompt, dispatch, then diff active ids against that snapshot, disregarding any id already marked `consumed: yes` earlier in this round: the one new id addressing this dispatch's own entry's `<gap>` → mark that entry `consumed: yes` (one entry authorizes exactly one id, scoped to this dispatch only); no new id → leave `consumed: no`; any other new id → unauthorized growth — raise a user-routed check to retroactively authorize (record a fresh `consumed: yes` entry) or retire the extra id(s) back (headless: `CHARTER — Needs input`, never silently legitimized). Then re-review the **full artifact set** (Phase 4) before evaluating rules 2–4; re-read this section before ever re-asking, so a resumed run honors what is on record. For every other (non-`[growth]`) answer that changes the charter or the split: snapshot the round just reviewed (the write below), dispatch the writer (revision) with the answers — and the decomposer after it if `Scope changed: yes` or the answer reshapes the split — then diff active ids against that snapshot, disregarding any id already marked `consumed: yes` earlier in this round: a new id here is always auto-recorded as a fresh `consumed: yes` growth authorization (the answer itself justifies it, no separate prompt) before re-review; that integration pass counts as a revision either way. Evaluate rules 2–4 only when no unintegrated answers remain. **Headless run:** any `route: user` finding, or an unresolved `pending`/unauthorized growth item, ends the run at `CHARTER — Needs input` instead of a prompt.
2. **Clean.** Zero findings → mark `**Status:** Converged` in the charter and go to Phase 6.
3. **Warnings only** (round 1: no CRITICAL or HIGH after user answers are folded in; round ≥2: every residual finding tagged `blocking: no`) → present the non-blocking findings to the user via `AskUserQuestion`: *accept as-is* → record their fingerprints under `## Accepted warnings` in the review log, mark `Converged` (final status `Converged with warnings`), go to Phase 6; *spend a round fixing them* → treat as blocking below. LOW findings never force a round on their own. **Headless:** MEDIUM/LOW auto-accept as-is by default and are recorded, so the run converges; a residual non-blocking HIGH instead ends `CHARTER — Needs input` — it is never silently accepted.
4. **Blocking findings** (round 1: CRITICAL/HIGH routed to `charter-writer` or `decomposer`; round ≥2: `blocking: yes` — CRITICAL anywhere, HIGH on a section the reviewer's snapshot diff marked changed, or the OUT-4 size-budget-overrun checklist row (SUB-3), which blocks in every round irrespective of the changed-text rule):
   - **No-progress guard:** fingerprint each blocking finding as `route|check|artifact-section`. If the blocking set is identical to the previous round's, stop with `CHARTER — Needs input` and show both rounds — more loops won't fix a disagreement.
   - **Round cap:** Check `03_review-log.md`'s `## Cap-gate decisions` first — each row has the fully-labeled form `- Round <N> | revision: <M> of <cap> | choice: extend|accept|stop | status: pending|applied` (mirroring `## Growth authorizations`'s labeled-field shape), `<M> of <cap>` frozen at the values read when the row was created. Only the **last** row is authoritative (the same row the State model routes on): if it is `status: pending`, or `choice: stop` regardless of status, resolve it now — go straight to its branch below; an older row never shadows a later one. Otherwise, if `Revisions used` has reached the header's `<cap>` (starts at 3; only ever raised by an extend) with blocking findings left, this is a fresh cap hit: **headless** stops `CHARTER — Blocked` (max rounds), residual findings listed, no gate, exactly as before; **interactive** asks once via `AskUserQuestion` (*extend by one revision* / *accept the residual as warnings* / *stop*) and appends the choice as a new `status: pending` row (create the section on first use) *before* acting, then takes its branch. Every branch acts on the blocking findings already recorded under this cap-hit round's own `## Round <N>` heading — never a fresh review to re-derive them. The gate is asked at most once per cap value — a later hit at a newly raised `<cap>` is a new pair, asked fresh. Never claim convergence because retries ran out, whichever choice was made.
     - **Resume contract (every branch):** a resume that lands on a `pending` row re-enters its branch from the top and runs it again; the row is marked `applied` only when the branch's last step has completed. Only the steps that move a counter or a set are guarded against running twice, each by a live check against state that already exists: extend's cap raise (skip when the header's live `<cap>` already exceeds the row's frozen `<cap>`), the revision increment (skip when live `Revisions used` already exceeds the row's frozen `<M>`), the round-`<N>` snapshot (its own once-per-round rule), accept's fingerprint write (`## Accepted warnings` is a set — a fingerprint already present is not written again), and the re-review — whose guard, a `## Round <N+1>` heading already on disk, also closes every step before it: once that heading exists the round's artifacts have been reviewed as they stand, so a resume skips the dispatch, the id-diff, and the re-review alike and goes straight to marking `applied`. Until that heading exists, the writer/decomposer dispatch and the id-diff simply run again on a resume: a repeated dispatch costs one dispatch and changes no outcome, because the row's frozen `<M>` still pins the run to the single revision the user authorized, the id-diff is a pure comparison against the round-`<N>` snapshot that disregards entries already marked `consumed: yes`, and the re-review that follows judges whatever the repeat left on disk.
     - **extend** — raise `<cap>` by 1 in place (the grepped `M of cap` header shape unchanged — C020's `11 of 11 (8 user-authorized extensions)` is the prior art), then fall through to "Otherwise spend a revision" below under the resume contract's guards — or, when a `## Round <N+1>` heading is already on disk, skip that bullet entirely; mark the row `applied` once that heading is present, then evaluate rules 2–4 against the round it recorded — the extension buys an ordinary round, not an exemption from these rules.
     - **accept** — fingerprint every residual blocking finding under `## Accepted warnings` (rule 3's mechanism, reused unchanged), set `**Status:** Converged`, mark the row `applied`, end `CHARTER — Converged with warnings`, and go to Phase 6. A resume landing after the status write but before the `applied` mark is routed to Phase 6 by the State model; the `pending` row is inert there, since this rule is consulted only while the charter is still `In review`.
     - **stop** — end `CHARTER — Blocked` (max rounds), residual findings listed, and mark the row `applied`. It writes no other artifact state, so it is re-emitted identically on every resume.
   - Otherwise spend a revision (increment `Revisions used` — skip the increment when a `pending` cap-gate row exists and live `Revisions used` already exceeds its frozen `<M>`): first write the round-just-reviewed snapshot — the current on-disk `01_charter.md`/`02_subtasks.md` to `{charter-folder}/snapshots/01_charter.round-<N>.md` / `02_subtasks.round-<N>.md` (`N` = the round just reviewed) — this is what round `N+1`'s reviewer diffs against, and **every** reference to this write, here and in rule 1, performs it **at most once per round**: skip it when round `N`'s snapshot files already exist, so no later dispatch in the same round overwrites the true pre-round baseline. Then, if any blocking finding routes to `charter-writer`, dispatch the writer (Phase 2, revision) with those findings; if the writer reports `Scope changed: yes`, always re-dispatch the decomposer (Phase 3, revision) afterwards — a changed charter invalidates the decomposition. If findings route only to `decomposer`, dispatch it alone. Diff active `OUT`/`SUB` ids against the snapshot just written, disregarding any id already marked `consumed: yes` earlier in this round: no new id → proceed; exactly one new id whose outcome/sub-task text plausibly addresses the stated `<gap>` of a `granted, consumed: no` `## Growth authorizations` entry recorded for this round → mark that entry `consumed: yes` (one entry authorizes exactly one id) and proceed; any other new id → unauthorized growth — raise a user-routed check to retroactively authorize (record a fresh `consumed: yes` entry) or retire the extra id(s) back (headless: `CHARTER — Needs input`, never silently legitimized). Then re-review the **full artifact set** (Phase 4; skip when a `## Round <N+1>` heading already exists) — consistency is a cross-artifact property; never re-review only the patched part.

### Phase 6 — Publish (at convergence only)

Publish runs **once, only after the loop has converged** (Phase 5 rule 2/3 has set `**Status:** Converged`). Never publish mid-loop — the whole review loop iterates on the local files alone.

**Direct provider resolution** (how the tracker ops are reached): every operation below (`get`, `create_umbrella`, `create_child`, `update`, `list_children`, `post_comment`) reaches the `tracker` surface via the direct provider resolution procedure `invocation-runtime.ops.md` §"Direct provider resolution" defines, reusing the `workspaceRoot` captured in Prerequisites: call the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface: "tracker" })` once for the run, obtain each operation's body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, keyed on the record's `owner` and fragment `ref`), and follow it in-context — never a raw `Read`/`Glob` of the fragment path. Core names only the abstract operations, never a tracker. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded.

**Ledger precedence — a started publish never switches arms.** Read the ledger first: if the charter's `**Tracker:**` line already holds a real umbrella id, or the intake carries an `**Adopted umbrella:**` marker, this charter is **committed to tracker mode** — take the **TRACKER** arm regardless of the current `state`. If that surface now resolves `unconfigured`/`unrecoverable`, do **not** fall back to LOCAL-ONLY (minting local task folders would duplicate the already-published umbrella/children and orphan the ledger): stop with `CHARTER — Blocked` (`Next: /wf:charter <charter-id>`), naming the unpublished sub-tasks and directing the user to restore the tracker provider and retry. LOCAL-ONLY applies **only** when the ledger shows no tracker publish has started (no umbrella id, no adoption marker).

With no started publish, branch on the record's `state`: **`ok`** (a capability owns `tracker`) → the **TRACKER** arm; **`unconfigured`** (no capability owns `tracker`) or **`unrecoverable`** (a registered capability's `tracker` manifest could not be read) → the **LOCAL-ONLY** arm (silent local fallback; for `unrecoverable`, warn once in the hedged candidate-naming form the record's `diagnostics` supplies, per `capability-registry.ops.md`, then continue local-only).

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
- **In-flight folder with no recorded mandate/snapshot** (an existing `03_review-log.md` from before this mechanism, resumed at round ≥2): Phase 4 falls back to the `full-audit` mandate for that round — equivalent to treating the whole artifact set as changed text, since `full-audit` reports and blocks on raw severity with no diff step. From that round on the host snapshots and records the mandate normally, so the fallback fires at most once per folder.
- **Revision cap hit with blocking findings left:** interactive — one `AskUserQuestion` gate (extend by one revision / accept the residual as warnings / stop), the choice appended to `03_review-log.md`'s `## Cap-gate decisions` before acting, at most once per cap value; a resumed run with a `pending` choice, or any recorded stop, resumes it directly (State model) — never a fresh Phase 4 review of the cap-hit round (extend's own re-review of the next round still runs), never a re-ask; a step that resume runs again repeats a dispatch, never an outcome. Headless — unchanged: `CHARTER — Blocked` (max rounds), residual findings listed, artifacts preserved. Never a success from exhausted retries.
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
