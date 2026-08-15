# core-authoring capability manifest

**Version:** 0.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** core-authoring (registers into the downstream `## Capabilities` registry as `core-authoring`)
**Kind:** both (ships skills and is authored to attach phase fragments)
**Model:** claude-opus-4-8

---

`core-authoring` carries the knowledge for authoring the **wf core plugin itself** — the domain-free
skill spine, the frozen contracts the core plugin ships, and the repository authoring rules its CI
gates enforce. It is the counterpart to the authoring toolkit that teaches pack authoring: this
capability is about the core, not about a downstream stack or domain.

It declares **`kind: both`** because it ships its own skills — starting with
`/wf-core-authoring:init` — **and** is authored to attach phase fragments as its content lands.
`adapter` is not available to it: a pack always ships an init skill, so a fragments-only kind cannot
describe it.

It owns **no** provider surface, declares **no** `requires:` and **no** `conflicts:`, and ships
**no** `profile-template:` — it fills no contract slot with project values, so there is nothing for a
project to override.

The pack's content arrives one change at a time; contract authoring is the first piece to land, as
the `new-contract` scaffolder below. A core-skill scaffolder and ownership of a repository lint are
still to come, each arriving as its own change — and any change that does attach a phase fragment
lands its fragments row in the same change as the file that row names.

**Registration is required before any phase contribution can fire** — run `/wf-core-authoring:init`
once after `/wf:init`. That skill self-registers through the resolver's `inspect_pack` /
`register_pack` tools (idempotent), refreshing the snapshot so the capability resolves. With the
capability unregistered, nothing is reached and no authoring term surfaces in any core phase —
behavior is byte-identical to the plugin never having been installed.

## Skills

As a `both` capability, core-authoring ships its skills natively — install the plugin and the
`/wf-core-authoring:*` commands are discoverable, because native plugin composition loads them
regardless of registration. The `skills:` key is therefore **documentation only**; it records what
the pack ships, it does not cause it to load.

```
skills:
  - plugins/wf-core-authoring/skills/init/         # /wf-core-authoring:init — self-registering onboarding
  - plugins/wf-core-authoring/skills/new-contract/ # /wf-core-authoring:new-contract — scaffolds a core contract pair, green under the contract-shape guard
```

## Fragments

Schema `phase | contribution-kind | dispatch | scope`.

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|

**This table is deliberately empty.** The capability ships its skills ahead of its first phase
contribution, so it declares no row yet. Registry validation tolerates a zero-row table, and the
capability still registers — which is the point of registering now: the registration path is proven
before the first fragment depends on it. A row and the fragment file it names are authored together,
in the change that introduces them.

The `new-contract` scaffolder adds **no** row, and that is not an oversight: every fragments row
must name a `phase` and a `contribution-kind` drawn from the fixed sets, and a contract scaffolder
maps to no phase in the `spec → plan → tasks → implement → verify → qa` spine. It is an authoring
tool a maintainer invokes directly, not a contribution any phase fires. Declaring it under `skills:`
is the whole of its declaration — which is also why, with this capability unregistered, the pack
contributes nothing to any phase while the skill itself still loads.
