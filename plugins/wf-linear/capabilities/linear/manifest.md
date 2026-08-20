# linear capability manifest

**Version:** 1.7.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** linear (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-linear:init` skill; also attaches one phase fragment and seven `slot` fills via the registry)
**Model:** claude-sonnet-5

---

linear supplies the **tracker provider** — the concrete Linear binding for every abstract
tracker operation the capability-registry contract defines (resolve config, create/update/
fetch an issue, list a parent's children, comment, move status, attach a link, enumerate
work items by status, milestones, or cycles, and read a task's blocking predecessors). It is a **second, independent** binding of the
same surface `ado` binds. It carries **zero** delivery-specific vocabulary.

profile-template: profile.template.json

The template declares exactly one project question, `linear-team`, as a plain string unresolved
until the project persists an answer at its declared destination. `linear-project: none` remains
ordinary non-question profile data.

## Fragments

Schema (`capability-registry.ops.md` §"Manifest schema v2"): `phase | contribution-kind |
dispatch | scope`. The inline path is forward-slash, **relative to this capability's registry
path**. `scope` is required for partitioned kinds; `provider` carries a **`surface`** enum
token.

| phase | contribution-kind | dispatch                             | scope                  |
|-------|--------------------|--------------------------------------|------------------------|
| spec  | provider           | `inline: fragments/tracker.ops.md`   | tracker                |
| —     | slot               | `inline: fragments/spec-questions.md` | spec.questions replace |
| —     | slot               | `inline: fragments/spec-publish.md`   | spec.publish replace   |
| —     | slot               | `inline: fragments/plan-publish.md`   | plan.publish replace   |
| —     | slot               | `inline: fragments/tasks-publish.md`  | tasks.publish replace  |
| —     | slot               | `inline: fragments/implement-start.md` | implement.start replace |
| —     | slot               | `inline: fragments/implement-milestone.md` | implement.milestone append |
| —     | slot               | `inline: fragments/implement-finish.md` | implement.finish replace |

`provider` is a **partitioned** kind — only the capability owning `surface: tracker` applies,
and linear owns `tracker` only. The `phase: spec` cell is a **registration-only anchor**: a
core skill reaches this fragment at any point via **direct provider resolution** (select
`contribution-kind = provider AND scope = tracker`, registry-wide), not only at `spec`.

Beyond the provider binding, linear contributes **seven `slot` fills** — the conveyor's tracker
mirror (charter C021), targeting the declared composition points of `/wf:spec` (WF-406),
`/wf:plan` and `/wf:tasks` (WF-407), and `/wf:implement` (WF-408). Their phase cell is `—`: a slot
targets a per-skill composition point, not an SDD phase. `spec.questions` posts the run's open
questions as **one** comment on the task's umbrella before the interactive prompt; the artifact
fills mirror the finished `01_spec.md`, `02_plan.md` and `03_tasks.md` as `Spec:`, `Plan:` and
`Tasks:` child issues beneath that umbrella and mark each done; the three implement fills open an
`Impl:` child In Progress at phase entry, append one log entry per checkpoint to its comment thread,
and at phase end rewrite its description, mark it Done and move the umbrella to In Review. All seven
compose via the **registry**, so they fire only once this capability is registered — with it
unregistered, `/wf:spec`, `/wf:plan`, `/wf:tasks` and `/wf:implement` execute their no-op inline
defaults and no tracker term surfaces at all (CLAUDE.md §2). All seven bind **only** operations
already defined in `fragments/tracker.ops.md` (`get`, `create_umbrella`, `create_child`, `update`,
`post_comment`, `set_status`) — this contributes **no** tracker-contract extension.

**Merge policies.** Six of the seven are `replace`. `implement.milestone` is the **single `append`**
point: `/wf:implement` reaches it once per checkpoint within one run, so contributions accumulate in
registry order (personal override last) instead of superseding one another, and the running
implementation log is built from many firings rather than one.

The four artifact fills share **one** umbrella per task and never collide: each creates a
**distinct** prefixed child and records its id under a **distinct** metadata key in its **own**
local artifact (`**Tracker spec item:**` in `01_spec.md`, `**Tracker plan item:**` and
`**Tracker impl item:**` in `02_plan.md`, `**Tracker tasks item:**` in `03_tasks.md`), each guarded
by a read-back so a re-run reuses the recorded id instead of double-publishing. None of them patches
the task's own description — `spec`'s pre-existing Phase-0 `update` remains the only write to it.

**Umbrella-lifecycle reconciliation with `tf`.** Only the implement fills transition the umbrella,
and only to non-terminal states: `implement.start` moves it to In Progress, `implement.finish` to In
Review. `tf`'s pre-existing `post_comment` + terminal `set_status` at finalize are untouched — the
implement fills post **no** umbrella comment and set **no** terminal status, so the three
transitions are strictly ordered in time and disjoint in value. `tf` required no change.

**Do not register `ado` and `linear` together** — both claim the `tracker` surface, and
partitioned ownership must not overlap (registry validation fails, naming both).

Read-off detail, resolution/degradation semantics, the `skills:` block, config seeding, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — read by
`init` and authors, never at phase-fire.
