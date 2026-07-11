# linear capability manifest

**Version:** 1.2.0 (WF-136 — second, independent tracker-provider capability, binding
the contract's `tracker` surface to concrete Linear mechanics via `mcp__claude_ai_Linear__*`;
WF-213 — split the tracker fragment into a bounded runtime-ops half
(`fragments/tracker.ops.md`) + a reference half (`fragments/tracker.md`), repoint the
dispatch, and refresh the contract pointers to the reshaped ops docs; WF-158 — bind the
tracker surface's three new read-only query operations (`list_by_status`,
`list_milestones`, `list_cycles`) in the fragment)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** linear (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-linear:init` skill; also attaches one phase fragment via the registry)
**Model:** claude-sonnet-5

---

This is the linear capability's **fragments manifest** — the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

linear supplies the **tracker provider** — the concrete Linear binding for every
abstract tracker operation the capability-registry contract defines (resolve config,
create/update/fetch an issue, list a parent's children, comment, move status, attach
a link, and enumerate work items by status, milestones, or cycles). It is a **second, independent** binding of the same surface `ado` binds — the
existence of this pack is itself the proof that the tracker contract carries zero
ADO-shaped assumption. It carries **zero** delivery-specific vocabulary: branch/commit/
push/PR mechanics are the `delivery` surface's job (the `git` capability), not this one.

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy. The
schema is the v2 shape fixed by `capability-registry.ops.md` §"Manifest schema v2":
`phase | contribution-kind | dispatch | scope`. The inline path is forward-slash,
**relative to this capability's registry path** (so `fragments/tracker.ops.md` resolves to
`plugins/wf-linear/capabilities/linear/fragments/tracker.ops.md`). `scope` is required for
partitioned kinds; `provider` carries a **`surface`** enum token.

| phase | contribution-kind | dispatch                         | scope   |
|-------|--------------------|-----------------------------------|---------|
| spec  | provider           | `inline: fragments/tracker.ops.md` | tracker |

Read off the column:

- **tracker** (`spec | provider | inline: fragments/tracker.ops.md | tracker`) — the Linear
  **tracker execution provider**. This row's `phase: spec` is a
  **registration-only anchor** for registry validation — the SDD phase where a tracker
  operation is first exercised in practice (a task's umbrella/child issues are created
  at authoring time) — it does **not** restrict *when* a core skill may invoke a
  tracker operation. A core skill reaches this fragment at any point in its own
  procedure via **direct provider resolution**: it selects the row(s) where
  `contribution-kind = provider AND scope = tracker`, across the whole registry,
  regardless of that row's `phase` value, then dispatches per the row's `dispatch`
  kind (here, `inline:` — read `fragments/tracker.ops.md`, the bounded runtime-ops half,
  and follow it in-context; its rationale and coverage reference is `fragments/tracker.md`,
  never read at boot; no subagent is spawned). See `invocation-runtime.ops.md` §"Direct
  provider resolution" for the full procedure this reuses.

`provider` is a **partitioned** kind: only the capability owning `surface: tracker`
applies. Two capabilities claiming the same surface is a registry-validation error —
this is exactly how `linear` and `ado` are made mutually exclusive: **neither
manifest names the other**; the overlap is caught structurally by the registry
validator (`capability-registry.ops.md` §"The contribution taxonomy (the fragment
kinds)") the moment both are registered together — no special-casing needed on
either side. Different surfaces (`engine`, `host`, `delivery`, `tracker`, …) compose
freely — linear owns `tracker` only, so it composes alongside browser-qa, a stack
capability, and git with no conflict.

## Skills

As a `both` capability, linear ships its own skill natively (install the plugin → the
`/wf-linear:init` command is discoverable; native plugin composition handles loading)
**and** attaches the fragment above via the registry. Documented for reference:

```
skills:
  - plugins/wf-linear/skills/init/   # /wf-linear:init — self-registering onboarding + Linear interview (mirrors WF-123's /wf-ado:init, WF-122's /wf-git:init)
```

## Profile seed template

This capability ships **no** `profile-template:` — the project-tunable Linear values
(`Linear Team`, `Linear Project`) live in a `## Linear` section of `_local/config.md`,
written by `/wf-linear:init` Phase 4. That section is **this pack's own** template
(carried inline in `plugins/wf-linear/skills/init/SKILL.md`), not a section core's own
`/wf:init` ships — core's config template carries no tracker-product-specific section
of any kind (see `plugins/wf/skills/init/SKILL.md` Phase 2's "Default content"); each
tracker pack is responsible for writing and owning its own section, exactly as
`/wf-ado:init` owns `## Azure DevOps`. Per the contract's seeding convention, a
capability that declares no `profile-template:` seeds nothing (the no-op path).

## Downstream registration

This repo ships the capability + its skill; it does **not** carry a
`_local/config.md` (that lives in each consuming project). To activate linear
downstream, run `/wf-linear:init` (recommended — see `plugins/wf-linear/README.md`), or
add a repo-relative row to the consuming project's `_local/config.md` `## Capabilities`
table by hand:

```markdown
## Capabilities

| Capability | Path                                   |
|------------|-----------------------------------------|
| linear     | plugins/wf-linear/capabilities/linear    |
```

(Or the plugin-anchored `Path` form `plugin:wf-linear/capabilities/linear`, which
`/wf-linear:init` writes for you.) With `linear` registered, any core skill resolving
the `tracker` surface dispatches work-item operations to this capability's fragment;
with no `tracker` provider registered, core falls back silently to its own local
`T<NNN>` id scheme, per `capability-registry.ops.md` §"The tracker provider
surface".

**Do not register `ado` and `linear` together** — both claim the `tracker` surface,
and partitioned ownership must not overlap (registry validation fails, naming both).
