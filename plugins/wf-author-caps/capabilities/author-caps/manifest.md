# author-caps capability manifest

**Version:** 0.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** author-caps (the authoring toolkit; **registration is required** for its future phase contributions)
**Kind:** both (ships skills now; attaches phase fragments in a later change)
**Model:** claude-opus-4-8

---

`author-caps` teaches how to author for this marketplace. It ships three **user-invoked and
model-invoked** skills — `/wf-author-caps:init`, `/wf-author-caps:authoring-guide`, and
`/wf-author-caps:authoring-taxonomy` — that reach users purely by **native plugin composition**.
Installing the plugin is sufficient for all three: the two reference skills are written to load by
**description auto-selection**, so an authoring question pulls the relevant one into the session
with no slash command and no registry row.

Registration is a separate concern from those skills. This capability declares
**`kind: both`** because it ships skills today and attaches **phase fragments** in a later
change — guidance at `spec`, guidance at `implement`, a `finding` at `verify`, a `scenario` at
`qa-generation`, plus constitution articles. `both` is the only one of the three manifest kinds
covering that combination.

It owns **no** provider surface, declares **no** `requires:` and **no** `conflicts:`, and ships
**no** `profile-template:` — it fills no contract slot with project values, so there is nothing for
a project to override.

**Registration is required for the phase contributions** — run `/wf-author-caps:init` once after
`/wf:init`. That skill self-registers through the resolver's `inspect_pack` / `register_pack` tools
(idempotent), refreshing the snapshot so the capability resolves. With the capability unregistered,
no fragment fires and no authoring term surfaces in any core phase — behavior is byte-identical to
the plugin never having been installed.

## Fragments

**Intentionally empty.** No fragment row is declared yet: the five contributions above arrive in a
later change, and registry validation tolerates a zero-row table. The heading and header row ship
now so the rows drop in without a structural edit.

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
