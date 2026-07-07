# node-ts capability manifest

**Version:** 1.1.0 (WF-177 — `implement`-phase test-authoring guidance fragment added)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** node-ts (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** feature (ships its own skill; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

This is the node-ts capability's manifest — the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry). Core resolves
`<path>` from the registry row in `_local/config.md`; it does not hardcode this path.

node-ts supplies the **Node/TypeScript pure-helper test harness** (`test-node`) — a
dependency-free unit-test runner for pure TS helpers (parsers, formatters, coercion
helpers) that need no Angular runtime (no DI, zone.js, `HttpClient`, templates). It is a
distinct stack from the Angular surface (`angular` capability): the Node runtime, not the
browser/DI runtime. It belongs in a stack capability — not domain-free core — because it
names the Node test runner and the `_local/_testkit` harness.

## Requires

requires: git, ado

This capability assumes a `delivery` provider (`git`) and a `tracker` provider (`ado`)
are both registered in the capability registry — the wf-caps pack is built assuming
git-based delivery and tracker-backed work-item tracking are available downstream.

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy. The schema
is the v2 shape fixed by `capability-registry.contract.md`:
`phase | contribution-kind | dispatch | scope`. Inline paths are forward-slash, **relative to
this capability's registry path** (so `fragments/test-authoring.md` resolves to
`plugins/wf-caps/capabilities/node-ts/fragments/test-authoring.md`). `scope` is empty (`—`)
for aggregate kinds; `guidance` aggregates additively, so it carries no ownership scope token.

| phase     | contribution-kind | dispatch                              | scope |
|-----------|-------------------|---------------------------------------|-------|
| implement | guidance          | `inline: fragments/test-authoring.md` | —     |

Read off the columns:

- **test-authoring** (`implement | guidance | inline: fragments/test-authoring.md`) — the
  Node/TS **pure-helper unit-test-authoring** guidance. A core skill firing the `implement`
  phase with node-ts active reads `fragments/test-authoring.md` and follows it in-context,
  contributing its test-authoring idioms to the phase's authoring guidance. `guidance`
  aggregates **additively in registry order** (general → specific), so the row carries no
  provenance tag and no ownership scope. The fragment is **self-scoped to test authoring**:
  when the `implement` work authors no pure-helper unit test (a production-only change, or a
  target needing the Angular runtime), it contributes the empty guidance (the no-op), so it
  never misdirects the phase's production-idiom authoring.

This row is the capability-paired `implement`-guidance path that the **planned** `tt` skill
(WF-178) is intended to aggregate: with node-ts registered, an `implement`-guidance consumer
follows these idioms; unregistered, this fragment no-ops and such a consumer falls back to
its own discover-and-match default. If a further phase contribution is later warranted (e.g.
a `tasks` decomposition or a `qa-execution` provider for pure-helper runs), it is added as a
new row here.

## Skills

As a `feature` capability, node-ts ships its skill natively (install the plugin → the
`/wf-caps:test-node` command is discoverable; native plugin composition handles loading).
Documented for reference:

```
skills:
  - plugins/wf-caps/skills/test-node/  # /wf-caps:test-node — Node test harness for pure TS helpers
```

## Profile seed template

node-ts ships **no** `profile-template:` — it carries no concrete project paths to fill
(the `_local/_testkit` harness location is fixed and gitignored). Per the contract's seeding
convention, a capability that declares no `profile-template:` seeds nothing (the no-op path).

## Downstream registration

This repo ships the capability + its skill; it does **not** carry a `_local/config.md` (that
lives in each consuming project). To activate node-ts downstream, add a row to the consuming
project's `_local/config.md` `## Capabilities` table:

```markdown
## Capabilities

| Capability | Path                                 |
|------------|--------------------------------------|
| node-ts    | plugins/wf-caps/capabilities/node-ts |
```

(Or the plugin-anchored `Path` form `plugin:wf-caps/capabilities/node-ts` once cross-plugin
path resolution lands — see the registry contract's "two `Path` shapes".)
