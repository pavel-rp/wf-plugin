# ado capability manifest

**Version:** 1.4.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** ado (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-ado:init` skill; also attaches one phase fragment and seven `slot` fills via the registry)
**Model:** claude-opus-5[1m]

---

ado supplies the **tracker provider** — the concrete Azure DevOps binding for every abstract
tracker operation the capability-registry contract defines (resolve config, create/update/
fetch a work item, list a parent's children, comment, move status, attach a link, enumerate
work items by status, milestones, or cycles, and read a task's blocking predecessors). It carries **zero** delivery-specific
vocabulary.

## Fragments

Schema (`capability-registry.ops.md` §"Manifest schema v2"): `phase | contribution-kind |
dispatch | scope`. The inline path is forward-slash, **relative to this capability's registry
path**. `scope` is required for partitioned kinds; `provider` carries a **`surface`** enum
token.

| phase | contribution-kind | dispatch                          | scope   |
|-------|--------------------|-----------------------------------|---------|
| spec  | provider           | `inline: fragments/tracker.ops.md` | tracker |
| —     | slot               | `inline: fragments/spec-questions.md` | spec.questions replace |
| —     | slot               | `inline: fragments/spec-publish.md`   | spec.publish replace   |
| —     | slot               | `inline: fragments/plan-publish.md`   | plan.publish replace   |
| —     | slot               | `inline: fragments/tasks-publish.md`  | tasks.publish replace  |
| —     | slot               | `inline: fragments/implement-start.md` | implement.start replace |
| —     | slot               | `inline: fragments/implement-milestone.md` | implement.milestone append |
| —     | slot               | `inline: fragments/implement-finish.md` | implement.finish replace |

`provider` is a **partitioned** kind — only the capability owning `surface: tracker` applies,
and ado owns `tracker` only. The `phase: spec` cell is a **registration-only anchor**: a core
skill reaches this fragment at any point via **direct provider resolution** (select
`contribution-kind = provider AND scope = tracker`, registry-wide), not only at `spec`.

Beyond the provider binding, ado contributes **seven `slot` fills** — the conveyor's tracker
mirror (charter C021), targeting the declared composition points of `/wf:spec`, `/wf:plan`,
`/wf:tasks` and `/wf:implement`. Their phase cell is `—`: a slot targets a per-skill composition
point, not an SDD phase. `spec.questions` posts the run's open questions as **one** comment on the
task's umbrella before the interactive prompt; the artifact fills mirror the finished `01_spec.md`,
`02_plan.md` and `03_tasks.md` as `Spec:`, `Plan:` and `Tasks:` child work items beneath that
umbrella and mark each done; the three implement fills open an `Impl:` child in the work-started
state at phase entry, append one log entry per checkpoint to its comment thread, and at phase end
rewrite its description, mark it done and move the umbrella to the awaiting-review state. All seven
compose via the **registry**, so they fire only once this capability is registered — with it
unregistered, `/wf:spec`, `/wf:plan`, `/wf:tasks` and `/wf:implement` execute their no-op inline
defaults and no tracker term surfaces at all (CLAUDE.md §2). All seven bind **only** operations
already defined in `fragments/tracker.ops.md` (`get`, `create_umbrella`, `create_child`, `update`,
`post_comment`, `set_status`) — this contributes **no** tracker-contract extension.

**Authored to parity, not live-tested.** The seven fills are structurally mirrored from the
`linear` capability's fills and verified by fragment/contract review plus registry validation
only — **no live Azure DevOps run has exercised them.** See `references/onboarding.md` for the
residual-risk statement before relying on them in a production project.

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
and only to non-terminal states: `implement.start` moves it to the work-started state,
`implement.finish` to the awaiting-review state (skipped outright on a process template that has no
distinct review state, never forced to a terminal value). `tf`'s pre-existing `post_comment` +
terminal `set_status` at finalize are untouched — the implement fills post **no** umbrella comment
and set **no** terminal status, so the transitions are strictly ordered in time and disjoint in
value. `tf` required no change.

**Do not register `ado` and `linear` together** — both claim the `tracker` surface, and
partitioned ownership must not overlap (registry validation fails, naming both). The two also
claim the same seven `skill.point` slots with `replace`, which would be a second, independent
partition-overlap error.

Read-off detail, resolution/degradation semantics, the `skills:` block, config seeding, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — read by
`init` and authors, never at phase-fire.
