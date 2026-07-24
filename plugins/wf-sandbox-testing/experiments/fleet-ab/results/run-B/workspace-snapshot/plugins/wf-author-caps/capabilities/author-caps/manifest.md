# author-caps capability manifest

**Version:** 0.2.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** author-caps (the authoring toolkit; **registration is required** for its phase contributions)
**Kind:** both (ships skills and attaches phase fragments)
**Model:** claude-opus-4-8

---

`author-caps` teaches how to author for this marketplace. It ships three **user-invoked and
model-invoked** skills — `/wf-author-caps:init`, `/wf-author-caps:authoring-guide`, and
`/wf-author-caps:authoring-taxonomy` — that reach users purely by **native plugin composition**.
Installing the plugin is sufficient for all three: the two reference skills are written to load by
**description auto-selection**, so an authoring question pulls the relevant one into the session
with no slash command and no registry row.

Registration is a separate concern from those skills. This capability declares
**`kind: both`** because it ships skills **and** attaches **phase fragments** — guidance at
`spec`, guidance at `implement`, two `finding`s at `verify`, a `scenario` at `qa-generation`,
plus constitution articles. `both` is the only one of the three manifest kinds covering that
combination.

It owns **no** provider surface, declares **no** `requires:` and **no** `conflicts:`, and ships
**no** `profile-template:` — it fills no contract slot with project values, so there is nothing for
a project to override.

**Registration is required for the phase contributions** — run `/wf-author-caps:init` once after
`/wf:init`. That skill self-registers through the resolver's `inspect_pack` / `register_pack` tools
(idempotent), refreshing the snapshot so the capability resolves. With the capability unregistered,
no fragment fires and no authoring term surfaces in any core phase — behavior is byte-identical to
the plugin never having been installed.

## Fragments

Schema `phase | contribution-kind | dispatch | scope`. Every row dispatches `inline:` — each
fragment is a bounded prose ops doc, and the two `verify` rows call read-only typed tools whose
work happens inside the resolver runtime, so there is no verbose reasoning to isolate in a
subagent. `scope` is `—` on every row: `guidance`, `finding`, and `scenario` all **aggregate**, so
none carries an ownership token and nothing here can collide with another capability.

| phase          | contribution-kind | dispatch                                    | scope |
|----------------|-------------------|---------------------------------------------|-------|
| spec           | guidance          | `inline: fragments/interface-first.md`       | —     |
| implement      | guidance          | `inline: fragments/authoring-conventions.md` | —     |
| verify         | finding           | `inline: fragments/structural-validation.md` | —     |
| verify         | finding           | `inline: fragments/reference-existence.md`   | —     |
| qa-generation  | scenario          | `inline: fragments/authoring-scenarios.md`   | —     |

The two `verify` rows split by rule family: `structural-validation` checks that an authored
artifact conforms to its schema, `reference-existence` checks that the commands, agents, and paths
it names actually resolve. Each emits provenance-tagged findings under `capability: author-caps`
and maps all three `ValidationVerdict` statuses — `pass`, `fail`, and `error` — with `error`
treated as a finding-worthy outcome, never a silent skip.

Every fragment carries an explicit **no-op** clause. With the capability unregistered no row is
reached at all, so an unregistered project's behavior is unchanged and no authoring term surfaces
in any phase.

## Constitution articles

Declared as repeatable `article:` manifest **keys**, not fragments-table rows — `article` is not a
contribution kind (a constitution clause attaches to the constitution, which is not an SDD phase),
and a row naming it is a validator error. The constitution skill composes these with provenance,
and they reach a fresh session through the existing session-start injection path; this pack adds
no hook.

article: interface-before-body = A skill's externally-bindable surface — invocation shape, terminal block, declared slots, declared settings keys — is settled in the spec before its body is written.
article: declared-paths-resolve = Every path, command, and agent an authored artifact names must exist; a fragments-table row is authored in the same change as the file it names.
article: sibling-skills-are-invoked = An agent or skill body reaches a sibling skill by invoking it through the Skill tool, never by filesystem-reading its body.
article: runtime-docs-are-bounded = A doc read at boot or mid-run carries only behavior-bearing content, one level deep, with rationale in a paired reference file that is never read at runtime.
article: capabilities-ship-inert = A capability contributes nothing until it is registered; an unregistered project's behavior is unchanged and no capability term surfaces.

## References

Rationale, history, and the design record for the rows above:
[`references/fragment-rationale.md`](references/fragment-rationale.md) — read by authors and
reviewers, never at runtime.
