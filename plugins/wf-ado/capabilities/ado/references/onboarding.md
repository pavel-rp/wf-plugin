# ado capability — onboarding & authoring reference

Rationale, resolution semantics, native-composition detail, config seeding, downstream
registration, and version history for the ado capability. **Never read at phase-fire** — a
core skill firing a phase or resolving the tracker surface reads only `../manifest.md`'s
fragments table. This file is for `init` and for authors.

## What this manifest is

The ado capability's **fragments manifest** (`../manifest.md`) is the file a core skill reads
at `<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

ado is the destination capability full-stack users register once core's own inline
ADO-specific copy (the ADO work-item MCP calls in `spec`/`lite`/`triage`, `pr`'s `AB#<id>`
embed) is later scrubbed (SUB-6/SUB-12–20, separate tasks). It carries **zero**
delivery-specific vocabulary: branch/commit/push/PR mechanics are the `delivery` surface's job
(the `git` capability), not this one.

## Read off the column

- **tracker** (`spec | provider | inline: fragments/tracker.ops.md | tracker`) — the Azure
  DevOps **tracker execution provider**. This row's `phase: spec` is a **registration-only
  anchor** for registry validation — the SDD phase where a tracker operation is first
  exercised in practice (a task's umbrella/child work items are created at authoring time) —
  it does **not** restrict *when* a core skill may invoke a tracker operation. A core skill
  reaches this fragment at any point in its own procedure via **direct provider resolution**:
  it selects the row(s) where `contribution-kind = provider AND scope = tracker`, across the
  whole registry, regardless of that row's `phase` value, then dispatches per the row's
  `dispatch` kind (here, `inline:` — read `fragments/tracker.ops.md`, the bounded runtime-ops
  half, and follow it in-context; its rationale and coverage reference is `fragments/tracker.md`,
  never read at boot; no subagent is spawned). See `invocation-runtime.ops.md` §"Direct
  provider resolution" for the full procedure this reuses.

`provider` is a **partitioned** kind: only the capability owning `surface: tracker` applies.
Two capabilities claiming the same surface is a registry-validation error; different surfaces
(`engine`, `host`, `delivery`, `tracker`, …) compose. ado owns `tracker` only — it makes no
claim on `engine`/`host` (the QA-execution surfaces) or `delivery` (the version-control
surface), so it composes alongside browser-qa, a stack capability, and git with no conflict.

## Skills (native composition)

As a `both` capability, ado ships its own skill natively (install the plugin → the
`/wf-ado:init` command is discoverable; native plugin composition handles loading) **and**
attaches the fragment above via the registry. Documented for reference:

```
skills:
  - plugins/wf-ado/skills/init/   # /wf-ado:init — self-registering onboarding + ADO interview (follows the shared spine in plugins/wf/skills/_contracts/pack-onboarding.ops.md)
```

## Profile seed template

This capability ships **no** `profile-template:` — the project-tunable ADO values (`ADO
Project`, `ADO Organization`, `Work Item ID Prefix`) already live in the existing
`_local/config.md` `## Azure DevOps` section (written by `/wf:init`, carried forward or
interviewed for by `/wf-ado:init` Phase 4); there is no new profile file to seed. Per the
contract's seeding convention, a capability that declares no `profile-template:` seeds nothing
(the no-op path).

## Downstream registration

This repo ships the capability + its skill; it does **not** carry a `_local/config.md` (that
lives in each consuming project). To activate ado downstream, run `/wf-ado:init` (recommended
— see `plugins/wf-ado/README.md`), or add a repo-relative row to the consuming project's
`_local/config.md` `## Capabilities` table by hand:

```markdown
## Capabilities

| Capability | Path                          |
|------------|--------------------------------|
| ado        | plugins/wf-ado/capabilities/ado |
```

(Or the plugin-anchored `Path` form `plugin:wf-ado/capabilities/ado`, which `/wf-ado:init`
writes for you.) With `ado` registered, any core skill resolving the `tracker` surface
dispatches work-item operations to this capability's fragment; with no `tracker` provider
registered, core falls back silently to its own local `T<NNN>` id scheme, per
`capability-registry.ops.md` §"The tracker provider surface".

**Do not register `ado` and `linear` together** — both claim the `tracker` surface, and
partitioned ownership must not overlap (registry validation fails, naming both). This warning
is mirrored in the manifest so it surfaces at a glance.

## The seven conveyor slot fills (WF-413, charter C021)

> ## ⚠ Authored to parity — NOT live-tested
>
> The seven slot fills described below were authored by **structural mirroring** of the
> `linear` capability's fills and verified by **fragment/contract review plus registry
> validation only**. **No live Azure DevOps run has ever exercised them.** Every operation they
> name is grounded in `../fragments/tracker.ops.md` with a confirmed ADO MCP tool name, but
> "the tool name is confirmed" is not "the call has been made and its response shape observed".
>
> Treat the fills as **reviewed prose, not proven behaviour**. Before relying on them in a
> production project, run one task end-to-end against a scratch ADO project and confirm: the
> child-creation response shape, the tag-field patch, and each `set_status` value against your
> project's actual process template. The C021 net scope decision made Linear the sole live
> end-to-end target for this release; ADO parity was explicitly accepted as review-verified.
>
> **Residual grounding gap, unchanged by this work:** three ADO query operations —
> `list_by_status`, `list_milestones`, `list_cycles` — still carry `VERIFY` tool-name markers in
> `../fragments/tracker.ops.md`. **No slot fill uses any of them**, so they do not gate the
> mirror, but they remain unconfirmed and are out of scope here.

Beyond the provider binding, this capability fills all seven of the conveyor's declared
bookkeeping composition points: `/wf:spec`'s `spec.questions` and `spec.publish`, `/wf:plan`'s
`plan.publish`, `/wf:tasks`'s `tasks.publish`, and `/wf:implement`'s `implement.start`,
`implement.milestone` and `implement.finish`. Six are `replace` fills; `implement.milestone` is the
set's only `append` point. All compose only through the registry, and all are read at slot-fire —
which is why the fragments themselves stay bounded and send their rationale here.

**Why slots and not a phase fragment.** The conveyor spine is deliberately tracker-silent for core
purity: no core skill body names a tracker product. The slot mechanism is the only sanctioned way to
attach publish behaviour to a specific point inside a core skill's body, and its no-op inline
defaults are what let bare core stay local-only for free. A `guidance` fragment at a phase could not
express "do this here, between these two steps".

**The umbrella convention (shared by all seven).** The *umbrella* is the work item the task id
already names — the item every artifact this capability publishes hangs beneath. It is resolved,
never guessed, in this order: a `**Tracker umbrella:** <id>` metadata line already recorded in the
task's artifacts; then the task id itself when the phase's own `get` resolved it; and only if
neither holds is one minted with `create_umbrella`. **`spec.questions` may never mint one** — a
question comment must not be the thing that creates a work item, so it skips instead.

**Why each fill records a guard line, and where.** `capability-registry.ops.md`
§"Single-shot-publish idempotency" requires reading a published id back before ever re-invoking a
create for the same artifact/slot. Each fill records its guard in *the local artifact that triggers
it*: `**Tracker questions comment:**` in `00_reqs.md`; `**Tracker umbrella:**` +
`**Tracker spec item:**` in `01_spec.md`; `**Tracker plan item:**`, `**Tracker impl item:**`,
`**Impl log:**` and `**Impl finished:**` in `02_plan.md`; `**Tracker tasks item:**` in
`03_tasks.md`. The distinct per-artifact keys are what let several fills coexist in one file without
ever touching the same field. Each fill records the umbrella id *before* creating its child, so a
failure partway through leaves the umbrella reusable rather than duplicated on the next run.

**Reconciliation with `spec`'s pre-existing write.** `/wf:spec` Phase 0 step 3 already performs one
conditional `update` — the empty-`Dev` description backfill — against the task's own work item
description. The artifact fills write to a *different target*, a newly created child work item, and
must never patch the task's own description. That separation is what keeps the mirror from
double-publishing, and it is the constraint to re-check first if either side is ever changed.

**Why the running log is a comment thread, not one edited comment.** The tracker contract has **no
comment-edit operation**, and WF-413 deliberately did not invent one — the `Impl:` record's comment
thread *is* the running log. Each checkpoint appends one comment via `post_comment` and earlier
entries are never touched; `implement.finish` then consolidates every entry into the record's
description `## Log` section via `update`, giving the same log a single readable-back surface with
zero contract extension.

### The two ADO-idiomatic adaptations

Both sit **inside** an operation the contract already defines. Neither adds an operation, and
neither adds a config key — so parity with the `linear` fills stays structural.

1. **Tags where `linear` patches labels.** The best-effort artifact-marking step invokes
   `update(<id>, tags: ["wf-artifact"])`. This provider's `update` binding is explicitly an
   *unrestricted field patch*, so the tag field needs no operation of its own; it is simply this
   tracker's equivalent of the label field. Best-effort in both packs: a rejected patch states one
   line and continues.

2. **Process-template-aware state names.** Azure DevOps workflow states are **process-template
   dependent** (Agile `Active`/`Resolved`/`Closed`, Scrum `Committed`/`Done`, Basic `Doing`/`Done`),
   whereas Linear's `In Progress`/`In Review`/`Done` are workspace-standard. Each `set_status` call
   therefore names its **semantic role** plus the concrete per-template values, keeping one call per
   transition and identical best-effort failure semantics. One genuine asymmetry falls out of this:
   Scrum and Basic have **no distinct awaiting-review state**, so `implement.finish` **skips** its
   umbrella transition on those templates rather than forcing a terminal value — forcing one would
   collide with `tf`'s terminal close and break the no-double-drive contract.

**The `tf` reconciliation, in one place.** `tf` finalizes with `post_comment({task-id}, …)` and a
terminal `set_status({task-id}, …)` on the umbrella. The implement fills are disjoint from both on
three axes: they target the `Impl:` **child** (except for at most two umbrella status calls), they
set only **non-terminal** umbrella states, and they post **no** umbrella comment at all. They also
never touch `09_finalize.md`'s `**Resolution comment:**` / `**Closed:**` guard lines, so `tf`
re-derives its behaviour unchanged. The umbrella transitions are strictly ordered in time and
disjoint in value — which is why WF-413 required **no change to `tf`**.

**No tracker-contract extension.** All seven fills bind only operations `../fragments/tracker.ops.md`
already defines — `get`, `create_umbrella`, `create_child`, `update`, `post_comment`, `set_status`.
The WF-413 review found **no genuinely missing operation**: every op the Linear mirror uses has a
grounded ADO counterpart. C021 expects zero contract extensions; a genuinely missing operation must
be flagged on the charter umbrella, never slipped in.

## Version history

- **WF-123** — initial tracker-provider capability, binding SUB-2/WF-121's `tracker` contract
  to concrete Azure DevOps mechanics.
- **WF-213** — split the tracker fragment into a bounded runtime-ops half
  (`fragments/tracker.ops.md`) + a reference half (`fragments/tracker.md`), repoint the
  dispatch, and refresh the contract pointers to the reshaped ops docs.
- **WF-158** — bind the tracker surface's three new read-only query operations
  (`list_by_status`, `list_milestones`, `list_cycles`) in the fragment.
- **WF-229** — add the symmetric `linear`-overlap warning this manifest lacked, mirroring the
  one the linear manifest already carries.
- **WF-230** — lean the manifest: onboarding/authoring narrative relocated here; `manifest.md`
  now carries only the phase-fire/validator declarations (the WF-229 linear-overlap warning is
  retained inline in the manifest).
- **WF-413** (charter C021) — seven `slot` fills added, completing the conveyor tracker mirror
  for this pack: `fragments/spec-questions.md` (`spec.questions`, `replace`),
  `fragments/spec-publish.md` (`spec.publish`, `replace`), `fragments/plan-publish.md`
  (`plan.publish`, `replace`), `fragments/tasks-publish.md` (`tasks.publish`, `replace`),
  `fragments/implement-start.md` (`implement.start`, `replace`),
  `fragments/implement-milestone.md` (`implement.milestone`, **`append`** — the set's only one)
  and `fragments/implement-finish.md` (`implement.finish`, `replace`). Authored by structural
  mirroring of the `linear` fills and **verified by fragment/contract review plus registry
  validation only — never run live against Azure DevOps** (see the boxed statement above). No
  tracker-contract extension; no genuinely missing operation was found. The two ADO-idiomatic
  adaptations (tags for labels, process-template-aware state names) and the `tf` reconciliation
  are documented above.
