# linear capability — onboarding & authoring reference

Rationale, resolution semantics, native-composition detail, config seeding, downstream
registration, and version history for the linear capability. **Never read at phase-fire** — a
core skill firing a phase or resolving the tracker surface reads only `../manifest.md`'s
fragments table. This file is for `init` and for authors.

## What this manifest is

The linear capability's **fragments manifest** (`../manifest.md`) is the file a core skill
reads at `<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

linear is a **second, independent** binding of the same surface `ado` binds — the existence of
this pack is itself the proof that the tracker contract carries zero ADO-shaped assumption. It
carries **zero** delivery-specific vocabulary: branch/commit/push/PR mechanics are the
`delivery` surface's job (the `git` capability), not this one.

## Read off the column

- **tracker** (`spec | provider | inline: fragments/tracker.ops.md | tracker`) — the Linear
  **tracker execution provider**. This row's `phase: spec` is a **registration-only anchor**
  for registry validation — the SDD phase where a tracker operation is first exercised in
  practice (a task's umbrella/child issues are created at authoring time) — it does **not**
  restrict *when* a core skill may invoke a tracker operation. A core skill reaches this
  fragment at any point in its own procedure via **direct provider resolution**: it selects the
  row(s) where `contribution-kind = provider AND scope = tracker`, across the whole registry,
  regardless of that row's `phase` value, then dispatches per the row's `dispatch` kind (here,
  `inline:` — read `fragments/tracker.ops.md`, the bounded runtime-ops half, and follow it
  in-context; its rationale and coverage reference is `fragments/tracker.md`, never read at
  boot; no subagent is spawned). See `invocation-runtime.ops.md` §"Direct provider resolution"
  for the full procedure this reuses.

`provider` is a **partitioned** kind: only the capability owning `surface: tracker` applies.
Two capabilities claiming the same surface is a registry-validation error — this is exactly how
`linear` and `ado` are made mutually exclusive: the overlap is caught structurally by the
registry validator (`capability-registry.ops.md` §"The contribution taxonomy (the fragment
kinds)") the moment both are registered together — no special-casing needed on either side.
Different surfaces (`engine`, `host`, `delivery`, `tracker`, …) compose freely — linear owns
`tracker` only, so it composes alongside browser-qa, a stack capability, and git with no
conflict.

## Skills (native composition)

As a `both` capability, linear ships its own skill natively (install the plugin → the
`/wf-linear:init` command is discoverable; native plugin composition handles loading) **and**
attaches the fragment above via the registry. Documented for reference:

```
skills:
  - plugins/wf-linear/skills/init/   # /wf-linear:init — compatibility alias: seeds wf-linear into the canonical /wf:init lifecycle and relays its block
```

## Profile template and declared interview

This capability declares `profile-template: profile.template.json`. Its ordered `ask` metadata
contains the two questions the canonical init round asks, each a plain string persisted at the
same-named profile destination: `linear-team`, and the optional `linear-project` scope for status,
milestone and cycle enumerations. `linear-project` ships the suggested default `<skipped>`, so a
user who declines persists an explicit decline instead of leaving the destination empty.

The declaration is metadata for the shared project-configuration lifecycle, and since the init-alias
migration it is the **only** interview this pack has. `/wf-linear:init` is now a compatibility alias
that seeds `wf-linear` into the canonical `/wf:init` selection round and relays the result; it runs
no interview and writes nothing. The canonical question round asks the declaration and the canonical
apply persists it at its declared destination.

Two halves of the suppression rule hold together. An absent persisted **project** answer leaves the
question unresolved even though the pack ships this template and a personal profile may suggest a
value — a shipped default, a pack-tier value and a personal-tier value are pre-fills, never answers.
And a persisted project answer is **not** re-asked: the round asks exactly what is still unresolved,
across the whole desired set rather than just this pack.

## Downstream registration

This repo ships the capability + its skill; it does **not** carry a `_local/config.md` (that
lives in each consuming project). To activate linear downstream, run `/wf:init`
(recommended — see `plugins/wf-linear/README.md`; `/wf-linear:init` enters the same lifecycle
with this pack seeded), or add a repo-relative row to the consuming
project's `_local/config.md` `## Capabilities` table by hand:

```markdown
## Capabilities

| Capability | Path                                   |
|------------|-----------------------------------------|
| linear     | plugins/wf-linear/capabilities/linear    |
```

(Or the plugin-anchored `Path` form `plugin:wf-linear/capabilities/linear`, which the
canonical apply writes for you.) With `linear` registered, any core skill resolving the
`tracker` surface dispatches work-item operations to this capability's fragment; with no
`tracker` provider registered, core falls back silently to its own local `T<NNN>` id scheme,
per `capability-registry.ops.md` §"The tracker provider surface".

**Do not register `ado` and `linear` together** — both claim the `tracker` surface, and
partitioned ownership must not overlap (registry validation fails, naming both). This warning
is mirrored in the manifest so it surfaces at a glance.

## The `spec`-phase slot fills (WF-406, charter C021)

Beyond the provider binding, this capability fills two of `/wf:spec`'s declared composition
points. Both are `replace` fills, both compose only through the registry, and both are read at
slot-fire — which is why the fragments themselves stay bounded and send their rationale here.

**Why slots and not a phase fragment.** The conveyor spine is deliberately tracker-silent for
core purity: `spec/SKILL.md` names no tracker product. The C014 slot mechanism is the only
sanctioned way to attach publish behaviour to a specific point inside a core skill's body, and
its no-op inline defaults are what let bare core stay local-only for free. A `guidance` fragment
at the `spec` phase could not express "do this here, between these two steps".

**The umbrella convention (shared by both fills, and by the `plan`/`tasks`/`implement` fills
that follow).** The *umbrella* is the tracker issue the task id already names — the item every
artifact this capability publishes hangs beneath. It is resolved, never guessed, in this order:
a `**Tracker umbrella:** <id>` metadata line already recorded in the task's artifacts; then the
task id itself when the `spec` phase's own Phase-0 `get` resolved it; and only if neither holds
is one minted with `create_umbrella`. **Only `spec.publish` may mint one** — a question comment
must never be the thing that creates a tracker record, so `spec.questions` skips instead.

**Why each fill records a guard line, and where.** `capability-registry.ops.md`
§"Single-shot-publish idempotency" requires reading a published id back before ever re-invoking
a create for the same artifact/slot. Each fill records its guard in *the local artifact that
triggers it*, which is why they differ: `spec.questions` fires in Phase 2 when only `00_reqs.md`
exists, so its `**Tracker questions comment:**` line lives there; `spec.publish` fires in Phase 4
against the finished `01_spec.md`, so `**Tracker umbrella:**` and `**Tracker spec item:**` live
there. `spec.publish` deliberately records the umbrella id *before* creating the child, so a
failure partway through leaves the umbrella reusable rather than duplicated on the next run.

**Reconciliation with `spec`'s pre-existing write.** `/wf:spec` Phase 0 step 3 already performs
one conditional `update` — the empty-`Dev` description backfill — against the task's own work
item description. `spec.publish` writes to a *different target*, a newly created child issue, and
must never patch the task's own description. That separation is what keeps the mirror from
double-publishing, and it is the constraint to re-check first if either side is ever changed.

**Why the spec child is set Done.** The child is a published document, not a unit of work.
Leaving it open would inflate the umbrella's open-child count and misrepresent progress.

**Why labelling is best-effort.** The label is applied with the existing unrestricted `update`
operation rather than a new one. Note that Linear's underlying create-or-update primitive
*replaces* the full label set, which is safe here only because the child is brand new — do not
lift that call onto an already-labelled issue without switching to a read-modify-write. A label
missing from the workspace states one line and continues; it never fails a publish.

**No tracker-contract extension.** Both fills bind only operations `fragments/tracker.ops.md`
already defines — `get`, `create_umbrella`, `create_child`, `update`, `post_comment`,
`set_status`. C021 expects zero contract extensions; a genuinely missing operation must be
flagged on the charter umbrella, never slipped in.

## The `plan` and `tasks` slot fills (WF-407, charter C021)

WF-407 extends the mirror down the conveyor: `fragments/plan-publish.md` fills `/wf:plan`'s
declared `plan.publish` point and `fragments/tasks-publish.md` fills `/wf:tasks`'s
`tasks.publish` point, `replace` each. Both reuse every convention above unchanged — the same
umbrella resolution order, the same read-back guard discipline, the same best-effort label, the
same `set_status("Done")` reasoning, and the same zero-contract-extension rule.

**Why the decomposition is a child issue, not a comment.** The intake left the shape to spec;
WF-407 settled it as a child issue. `03_tasks.md` is a durable conveyor artifact of the same
class as the spec and the plan, so it is published the same way — as a titled, re-readable
record carrying the `Tasks:` prefix that makes its artifact class legible beside `Spec:` and
`Plan:`. A comment is a chronological remark that later comments push out of view, and because
`tasks` gates decomposition separately from strategy, regenerating a task list is expected — a
comment fill would append a second full copy every time, whereas a child issue is guarded by its
recorded id. The extra child costs nothing: like the other artifact children it is set Done, so
it never inflates the umbrella's open-child count. The decomposition is published as **one**
record; a fill must never mint one tracker child per `T-NNN` unit.

**Where each guard line lives.** Same rule as above — in the local artifact that triggers the
fill. `plan.publish` records `**Tracker umbrella:**` and `**Tracker plan item:**` in
`02_plan.md`; `tasks.publish` records `**Tracker umbrella:**` and `**Tracker tasks item:**` in
`03_tasks.md`. Each also reads the umbrella back from the *earlier* artifacts when its own file
carries none, which is what keeps all of a task's artifacts under one umbrella instead of
minting a second. The distinct per-artifact keys are what make three fills coexist without ever
touching the same field of the same item.

## The three `implement` lifecycle fills (WF-408, charter C021)

WF-408 completes the mirror across the conveyor's longest and previously most tracker-silent
phase. Three fills target `/wf:implement`'s declared points: `fragments/implement-start.md`
(`implement.start`, `replace`), `fragments/implement-milestone.md` (`implement.milestone`,
**`append`**) and `fragments/implement-finish.md` (`implement.finish`, `replace`). They reuse every
convention above unchanged — the same umbrella resolution order, read-back guard discipline,
best-effort label, and zero-contract-extension rule.

**Why the `Impl:` child is created at phase *entry*, not phase end.** The other artifact fills
publish a finished document, so they fire after their artifact is written. This one is inverted on
purpose: the whole point of the implement mirror is that a team can see work is *in flight*, so the
record is opened In Progress before STEP-001 runs and only filled in at the end. `implement.finish`
rewrites its placeholder description into the full Summary / Audit / Tests / Log document and marks
it Done, which is why `implement.finish` must never create the record itself — a record that was
never In Progress would misrepresent the very lifecycle the mirror exists to show.

**Why the running log is a comment thread, not one edited comment.** The success criterion asks for
entries "appended to the running implementation log, prior entries retained, not replaced." The
tracker contract has **no comment-edit operation**, and WF-408 deliberately did not invent one. The
`Impl:` child's comment thread *is* the running log: each checkpoint appends one comment via
`post_comment` and earlier entries are never touched. `implement.finish` then consolidates every
entry into the record's description `## Log` section via `update`, giving the same log a single
readable-back surface without deleting or rewriting any comment. Both readings of "the running log"
are satisfied with zero contract extension.

**Why `implement.milestone` is the set's only `append` point.** It is the only point reached more
than once per run — once per checkpoint across the five `implement` defines, and checkpoint 2 fires
once per plan step. Under `replace` only the last contributor would survive; under `append` the
resolver concatenates every contribution in registry order (personal override last) and serves one
body, so this fill coexists with any other capability's fill at the same checkpoint. Note what the
policy does **not** mean: it governs how *contributions* compose, not how *firings* accumulate —
each firing still appends exactly its own one entry, guarded by the per-checkpoint key list in
`**Impl log:**` so a resumed run never double-posts a checkpoint an earlier session already logged.

**Where each guard line lives.** All three record into `02_plan.md`, the artifact `implement`
executes: `**Tracker umbrella:**` and `**Tracker impl item:**` (from `implement.start`),
`**Impl log:**` (the comma-separated checkpoint keys already posted), and `**Impl finished:** done`
(from `implement.finish`). `**Tracker impl item:**` is distinct from `plan.publish`'s
`**Tracker plan item:**`, so the two fills coexist in the same file without ever touching the same
field.

**The `tf` reconciliation, in one place.** `tf` finalizes with `post_comment({task-id}, …)` and a
terminal `set_status({task-id}, …)` on the umbrella. The implement fills are disjoint from both on
three axes: they target the `Impl:` **child** (except for exactly two umbrella status calls), they
set only **non-terminal** umbrella states (In Progress, then In Review), and they post **no**
umbrella comment at all. They also never touch `09_finalize.md`'s `**Resolution comment:**` /
`**Closed:**` guard lines, so `tf` re-derives its behaviour unchanged. The three umbrella
transitions are strictly ordered in time and disjoint in value — which is why WF-408 required **no
change to `tf`**. A future fill that wants to comment on the umbrella at phase end must reconcile
with `tf` first; that is the charter's named failure case.

## Version history

- **WF-136** — second, independent tracker-provider capability, binding the contract's
  `tracker` surface to concrete Linear mechanics via `mcp__claude_ai_Linear__*`.
- **WF-213** — split the tracker fragment into a bounded runtime-ops half
  (`fragments/tracker.ops.md`) + a reference half (`fragments/tracker.md`), repoint the
  dispatch, and refresh the contract pointers to the reshaped ops docs.
- **WF-158** — bind the tracker surface's three new read-only query operations
  (`list_by_status`, `list_milestones`, `list_cycles`) in the fragment.
- **WF-230** — lean the manifest: onboarding/authoring narrative relocated here; `manifest.md`
  now carries only the phase-fire/validator declarations (the ado/linear-overlap warning is
  retained inline in the manifest).
- **WF-406** (charter C021) — two `slot` fills added, targeting `/wf:spec`'s declared
  `spec.questions` and `spec.publish` composition points (`replace` each):
  `fragments/spec-questions.md` posts the run's open questions as one comment on the umbrella
  before the interactive prompt; `fragments/spec-publish.md` mirrors the finished `01_spec.md`
  as a `Spec:` child issue beneath that umbrella and marks it done. No tracker-contract
  extension; the umbrella convention and guard-line placement are documented above.
- **WF-407** (charter C021) — two further `slot` fills added, targeting `/wf:plan`'s declared
  `plan.publish` and `/wf:tasks`'s `tasks.publish` composition points (`replace` each):
  `fragments/plan-publish.md` mirrors the finished `02_plan.md` as a `Plan:` child issue beneath
  the umbrella and marks it done; `fragments/tasks-publish.md` does the same for `03_tasks.md` as
  a `Tasks:` child. No tracker-contract extension; the comment-vs-child decision and the
  per-artifact guard keys are documented above.
- **WF-408** (charter C021) — three further `slot` fills added, completing the conveyor mirror by
  targeting `/wf:implement`'s declared `implement.start` (`replace`), `implement.milestone`
  (**`append`** — the set's only one) and `implement.finish` (`replace`) composition points:
  `fragments/implement-start.md` opens an `Impl:` child In Progress and moves the umbrella In
  Progress; `fragments/implement-milestone.md` appends one log entry per checkpoint to that child's
  comment thread; `fragments/implement-finish.md` rewrites the child's description into
  Summary/Audit/Tests/Log, marks it Done, and moves the umbrella to In Review. No tracker-contract
  extension — in particular no comment-edit operation was added, which is why the running log is a
  comment thread. The `tf` reconciliation is documented above; `tf` itself required no change.
- **WF-441** — declare the existing Linear Team interview as one profile-template question while
  retaining `linear-project: none` as ordinary data and leaving `/wf-linear:init` execution
  unchanged.
- **WF-526** — promote `linear-project` from ordinary data to a second declared question, so the
  enumeration scope is reachable through the install lifecycle rather than only a hand edit. It
  carries the suggested default `<skipped>`, which makes an explicit decline distinguishable from a
  value nobody was ever asked for; the plain `linear-project: none` entry is removed, because an
  ordinary template value at a declared destination would compete with the entry's own suggestion.
