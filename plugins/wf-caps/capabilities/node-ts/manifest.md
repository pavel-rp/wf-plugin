# node-ts capability manifest

**Version:** 1.0.1 (WF-126 — `requires: git, ado` declared)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** node-ts (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** feature (ships its own skill; attaches no phase fragments)
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

node-ts attaches **no** phase fragments today — it contributes its skill natively and
nothing to the SDD spine. There is no fragments table. (Per the contract, a capability that
attaches no fragment no-ops at every phase; this manifest declares that explicitly.) If a
future phase contribution is warranted (e.g. a `tasks` decomposition or `qa-execution`
provider for pure-helper runs), it is added here then.

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
