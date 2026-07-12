# linear capability manifest

**Version:** 1.2.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** linear (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-linear:init` skill; also attaches one phase fragment via the registry)
**Model:** claude-sonnet-5

---

linear supplies the **tracker provider** — the concrete Linear binding for every abstract
tracker operation the capability-registry contract defines (resolve config, create/update/
fetch an issue, list a parent's children, comment, move status, attach a link, and enumerate
work items by status, milestones, or cycles). It is a **second, independent** binding of the
same surface `ado` binds. It carries **zero** delivery-specific vocabulary.

## Fragments

Schema (`capability-registry.ops.md` §"Manifest schema v2"): `phase | contribution-kind |
dispatch | scope`. The inline path is forward-slash, **relative to this capability's registry
path**. `scope` is required for partitioned kinds; `provider` carries a **`surface`** enum
token.

| phase | contribution-kind | dispatch                          | scope   |
|-------|--------------------|-----------------------------------|---------|
| spec  | provider           | `inline: fragments/tracker.ops.md` | tracker |

`provider` is a **partitioned** kind — only the capability owning `surface: tracker` applies,
and linear owns `tracker` only. The `phase: spec` cell is a **registration-only anchor**: a
core skill reaches this fragment at any point via **direct provider resolution** (select
`contribution-kind = provider AND scope = tracker`, registry-wide), not only at `spec`.

**Do not register `ado` and `linear` together** — both claim the `tracker` surface, and
partitioned ownership must not overlap (registry validation fails, naming both).

Read-off detail, resolution/degradation semantics, the `skills:` block, config seeding, and
downstream registration: [`references/onboarding.md`](references/onboarding.md) — read by
`init` and authors, never at phase-fire.
