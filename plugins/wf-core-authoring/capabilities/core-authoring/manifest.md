# core-authoring capability manifest

**Version:** 0.3.0
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

Its **first content** is the distilled authoring-vocabulary article below — the leading-word landing and
the admitted term rules of `plugins/wf/skills/_contracts/GLOSSARY.md`, condensed to ten clauses so a
session in this repository starts with them already in context rather than meeting them at review. Contract
authoring has since landed alongside it, as the `new-contract` scaffolder declared under `## Skills` below,
and the glossary now has a maintenance surface too — the `add-term` skill, which lands a term together with
the parse-contract entry that makes it enforceable, so the vocabulary cannot grow documentation-only.
The remaining core-authoring content — a scaffolder for a core skill, and ownership of a repository lint —
arrives as its own change, each landing a fragments row in the same change as the file that row names.

## Constitution articles

Declared with the repeatable `article:` manifest key, one line per clause — the representation
`capability-registry.ops.md` §"Manifest schema v2" defines and the resolver's manifest parser already
consumes. An article is a manifest **key**, not a fragments row: `article` is not a contribution kind, and
the constitution is not a phase. `/wf:constitution` composes these clauses into the project's constitution
record under this capability's name, and the session-start path injects that record; with the capability
unregistered, nothing here is reached and no clause text appears anywhere.

This capability **consumes** the glossary; it does not own it. `GLOSSARY.md` stays where it is, its entries
and its parse contract are untouched by this declaration, and these clauses are a distillation of that file
rather than a second home for the rules.

article: vocabulary-is-glossary-defined = The canonical authoring vocabulary of this repository is defined in plugins/wf/skills/_contracts/GLOSSARY.md, and authored prose in a skill body, a reference, a contract, a capability file, or an agent file uses the canonical form of every term recorded there.
article: vocabulary-terms-are-violation-testable = A term is admitted to that vocabulary only when a deterministic check can fail on its violation; a preference no check can fail on is guidance rather than a rule, and stays out.
article: vocabulary-entries-are-extracted-not-invented = Every admitted term carries evidence of consistent live use in this repository or of a real observed confusion; an entry without that evidence is rejected at review.
article: vocabulary-rules-are-scope-bound = Each rule fires only on the scopes it declares and is written to match the used form rather than the bare word, so a forbidden form quoted or discussed rather than used is not a violation.
article: leading-word-set-is-evidence-defined = The leading-word check set is deliberately empty: neither heading position nor imperative step openers proved violation-testable against the live tree, so no leading-word rule is enforced until one does, and then only as an ordinary entry carrying its own pattern.
article: capability-is-spelled-in-full = The noun capability is written in full in authored prose; its clipped three-letter form is never used as the head of a compound naming a manifest, a registry, a fragment, a kind, a slot, a row, a pack, a path, or a name.
article: subagent-is-one-closed-word = The noun subagent is written as a single closed word; the hyphenated and the two-word spellings are not used in authored prose.
article: dispatch-target-is-plugin-qualified = A dispatch target names its owning plugin together with the agent, so the value is plugin-qualified; a bare agent name resolves only by accident of install order, and the runtime built-ins are the only exception.
article: command-namespace-is-not-re-prefixed = The slash-command namespace comes from the plugin name, so a skill's frontmatter name stays bare; re-prefixing it doubles the namespace into a command nobody can invoke.
article: authored-prose-carries-no-attribution = No authored artifact, commit message, or published comment carries an attribution trailer, a generated-with footer, an emoji, or a promotional tagline.

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
  - plugins/wf-core-authoring/skills/add-term/     # /wf-core-authoring:add-term — lands one glossary term together with the lint entry that enforces it
```

## Fragments

Schema `phase | contribution-kind | dispatch | scope`.

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|

**This table is deliberately empty.** The capability's first contribution is a constitution article, and an
article attaches to the constitution rather than to an SDD phase — it is the `article:` manifest key above,
never a fragments row — so no phase fragment is declared yet. Registry validation tolerates a zero-row
table, and the capability still registers. A row and the fragment file it names are authored together, in
the change that introduces them.

The `new-contract` scaffolder adds **no** row either, and that is not an oversight: every fragments row
must name a `phase` and a `contribution-kind` drawn from the fixed sets, and a contract scaffolder
maps to no phase in the `spec → plan → tasks → implement → verify → qa` spine. It is an authoring
tool a maintainer invokes directly, not a contribution any phase fires. Declaring it under `skills:`
is the whole of its declaration — which is also why, with this capability unregistered, the pack
contributes nothing to any phase while the skill itself still loads.

The `add-term` surface adds no row for the same reason: admitting a term to the authoring vocabulary is a
maintainer action against a repository file, not a contribution any SDD phase fires. It is declared under
`skills:` and nowhere else, so with this capability unregistered the skill still loads — native plugin
composition loads a pack's skills regardless of registration — while contributing nothing to any core
phase and filling no slot. No glossary-authoring guidance reaches a phase either way.
