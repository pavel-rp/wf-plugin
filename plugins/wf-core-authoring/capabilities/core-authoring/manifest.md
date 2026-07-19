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

This pack is a **skeleton**. It deliberately owns no core-authoring content yet: no scaffolder for a
core skill, no contract authoring, and no ownership of a repository lint. Those arrive as their own
changes, each landing a fragments row in the same change as the file that row names.

**Registration is required before any phase contribution can fire** — run `/wf-core-authoring:init`
once after `/wf:init`. That skill self-registers through the resolver's `inspect_pack` /
`register_pack` tools (idempotent), refreshing the snapshot so the capability resolves. With the
capability unregistered, nothing is reached and no authoring term surfaces in any core phase —
behavior is byte-identical to the plugin never having been installed.

## Fragments

Schema `phase | contribution-kind | dispatch | scope`.

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|

**This table is deliberately empty.** The capability ships its skills ahead of its first phase
contribution, so it declares no row yet. Registry validation tolerates a zero-row table, and the
capability still registers — which is the point of registering now: the registration path is proven
before the first fragment depends on it. A row and the fragment file it names are authored together,
in the change that introduces them.
