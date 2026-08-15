# linear capability manifest

**Version:** 1.5.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** linear (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-linear:init` skill; also attaches one phase fragment and four `slot` fills via the registry)
**Model:** claude-sonnet-5

---

linear supplies the **tracker provider** — the concrete Linear binding for every abstract
tracker operation the capability-registry contract defines (resolve config, create/update/
fetch an issue, list a parent's children, comment, move status, attach a link, enumerate
work items by status, milestones, or cycles, and read a task's blocking predecessors). It is a **second, independent** binding of the
same surface `ado` binds. It carries **zero** delivery-specific vocabulary.

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

`provider` is a **partitioned** kind — only the capability owning `surface: tracker` applies,
and linear owns `tracker` only. The `phase: spec` cell is a **registration-only anchor**: a
core skill reaches this fragment at any point via **direct provider resolution** (select
`contribution-kind = provider AND scope = tracker`, registry-wide), not only at `spec`.

Beyond the provider binding, linear contributes **four `slot` fills** — the conveyor's tracker
mirror (charter C021), targeting the declared composition points of `/wf:spec` (WF-406),
`/wf:plan` and `/wf:tasks` (WF-407), `replace` policy each. Their phase cell is `—`: a slot
targets a per-skill composition point, not an SDD phase. `spec.questions` posts the run's open
questions as **one** comment on the task's umbrella before the interactive prompt; the three
artifact fills mirror the finished `01_spec.md`, `02_plan.md` and `03_tasks.md` as `Spec:`,
`Plan:` and `Tasks:` child issues beneath that umbrella and mark each done. All four compose via
the **registry**, so they fire only once this capability is registered — with it unregistered,
`/wf:spec`, `/wf:plan` and `/wf:tasks` execute their no-op inline defaults and no tracker term
surfaces at all (CLAUDE.md §2). All four bind **only** operations already defined in
`fragments/tracker.ops.md` (`get`, `create_umbrella`, `create_child`, `update`, `post_comment`,
`set_status`) — this contributes **no** tracker-contract extension.

The three artifact fills share **one** umbrella per task and never collide: each creates a
**distinct** prefixed child and records its id under a **distinct** metadata key in its **own**
local artifact (`**Tracker spec item:**` in `01_spec.md`, `**Tracker plan item:**` in
`02_plan.md`, `**Tracker tasks item:**` in `03_tasks.md`), each guarded by a read-back so a
re-run reuses the recorded id instead of double-publishing. None of them patches the task's own
description — `spec`'s pre-existing Phase-0 `update` remains the only write to it.

**Do not register `ado` and `linear` together** — both claim the `tracker` surface, and
partitioned ownership must not overlap (registry validation fails, naming both).

Read-off detail, resolution/degradation semantics, the `skills:` block, config seeding, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — read by
`init` and authors, never at phase-fire.
