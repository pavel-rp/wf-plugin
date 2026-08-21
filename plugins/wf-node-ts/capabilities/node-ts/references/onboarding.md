# node-ts capability — onboarding & authoring reference

Rationale, dependency detail, native-composition detail, downstream registration, and profile
notes for the node-ts capability. **Never read at phase-fire** — a core skill firing `implement`
reads only `../manifest.md`'s fragments table. This file is for `init` and for authors.

## What this manifest is

The node-ts capability's manifest (`../manifest.md`) is the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry). Core resolves `<path>`
from the registry row in `_local/config.md`; it does not hardcode this path.

node-ts belongs in a stack capability — not domain-free core — because it names the Node test
runner and the `_local/_testkit` harness.

That placement is now structural rather than merely documented. Since WF-456 this capability
**ships the runner itself** as a declared payload (`payloads/testkit-run.mjs` →
`_local/_testkit/run.mjs`, `copy` / `replace-if-unmodified` / `retain`), and core's `/wf:init`
scaffolds nothing of the kind. A project running bare core, or one that never selects this
capability, receives no runner and no `_testkit` directory — the capability contributes nothing
until it is registered, which is the `capabilities-ship-inert` article stated in bytes rather
than in prose.

## Requires

`requires: git`. This capability assumes only a `delivery` provider (`git`) is registered in the
capability registry — the `git` delivery guard fires so branch/commit/PR operations resolve. It
is **tracker-agnostic**: it names no work-item tracker, so a consumer on any tracker (or none)
can register it. (Historically this manifest also required `ado`; WF-256 dropped that token when
the capability was extracted into the standalone `wf-node-ts` plugin.)

## Read off the column

- **test-authoring** (`implement | guidance | inline: fragments/test-authoring.md`) — the
  Node/TS **pure-helper unit-test-authoring** guidance. A core skill firing the `implement`
  phase with node-ts active reads `fragments/test-authoring.md` and follows it in-context,
  contributing its test-authoring idioms to the phase's authoring guidance. `guidance`
  aggregates **additively in registry order** (general → specific), so the row carries no
  provenance tag and no ownership scope. The fragment is **self-scoped to test authoring**: when
  the `implement` work authors no pure-helper unit test (a production-only change, or a target
  needing the Angular runtime), it contributes the empty guidance (the no-op), so it never
  misdirects the phase's production-idiom authoring.

This row is the capability-paired `implement`-guidance path that the **planned** `tt` skill
(WF-178) is intended to aggregate: with node-ts registered, an `implement`-guidance consumer
follows these idioms; unregistered, this fragment no-ops and such a consumer falls back to its
own discover-and-match default. If a further phase contribution is later warranted (e.g. a
`tasks` decomposition or a `qa-execution` provider for pure-helper runs), it is added as a new
row in the manifest's fragments table.

## Skills (native composition)

As a `feature` capability, node-ts ships its skill natively (install the plugin → the
`/wf-node-ts:test-node` command is discoverable; native plugin composition handles loading).
Documented for reference:

```
skills:
  - plugins/wf-node-ts/skills/test-node/  # /wf-node-ts:test-node — Node test harness for pure TS helpers
```

## Profile seed template

node-ts ships **no** `profile-template:` — it carries no concrete project paths to fill (the
`_local/_testkit` harness location is fixed and gitignored). Per the contract's seeding
convention, a capability that declares no `profile-template:` seeds nothing (the no-op path).

## Downstream registration

This repo ships the capability + its skill; it does **not** carry a `_local/config.md` (that
lives in each consuming project). **One command (recommended): `/wf-node-ts:init`** — after
`/wf:init` has bootstrapped the repo, it records the pack's install root in the gitignored
`## Plugin Roots` mapping and writes the plugin-anchored `## Capabilities` row, so core resolves
the capability on a **plugin-only install** (no vendored `plugins/wf-node-ts/...` in the
consuming repo):

```markdown
## Capabilities

| Capability | Path                                     |
|------------|-------------------------------------------|
| node-ts    | plugin:wf-node-ts/capabilities/node-ts   |
```

**Manual (escape hatch)** — when the pack **is** vendored in the consuming repo, add a
repo-relative row by hand instead: `| node-ts | plugins/wf-node-ts/capabilities/node-ts |`. See
the registry contract's "two `Path` shapes".

## Version history

- **WF-256** — extracted into the standalone `wf-node-ts` plugin; tracker-agnostic,
  `requires: git` only (dropped the historical `ado` requirement).
- **WF-230** — lean the manifest: onboarding/authoring narrative relocated here; `manifest.md`
  now carries only the phase-fire/validator declarations (`requires: git` + the fragments table).
