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
