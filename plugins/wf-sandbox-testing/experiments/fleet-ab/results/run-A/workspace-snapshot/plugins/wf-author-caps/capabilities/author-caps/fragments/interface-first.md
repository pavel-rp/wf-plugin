# `interface-first` fragment — author-caps capability (spec-phase guidance)

**Version:** 1.0.0 (WF-355 — the author-caps `spec`-phase interface-first design guidance)
**Wired by:** `plugins/wf-author-caps/capabilities/author-caps/manifest.md`
(`spec | guidance | inline: fragments/interface-first.md`)
**Model:** claude-opus-4-8

---

Guidance a core skill follows when it fires the `spec` phase with `author-caps` active and the work
being specified **authors a skill, capability, agent, or pack for this marketplace**. `guidance`
aggregates additively in registry order — these prompts join the phase's generic authoring
guidance, they never replace it.

## Applies when

The spec under construction describes a new or changed **authoring artifact**: a `SKILL.md`, an
`agents/<name>.md`, a capability `manifest.md`, a phase fragment, or a whole pack. If the spec
describes product work with no such artifact in scope, this fragment does not apply — say nothing
and let the phase's generic guidance stand alone.

## The rule: settle the interface before the body

An authoring spec that describes only *what the artifact does* leaves its externally-bindable
surface to be improvised at implement time. That surface is what other packs bind to, so it is
exactly the part a spec must pin. Prompt for each of the following, and record the answer in the
spec as a confident statement — not an open question.

- **Invocation shape.** The exact command form, every argument with its required/optional status,
  and the **zero-argument default**. A zero-argument invocation must do something useful; "requires
  an argument" is a design decision that needs a stated reason.
- **Terminal block.** The exact `NAME — status` shape emitted as the very last output, and the full
  status enum. Downstream consumers grep this shape, so changing it later is a breaking change —
  settle it now.
- **Declared slots.** Every composition point the artifact exposes, each as a `<skill>.<point>`
  token with a declared merge policy (`replace` for single-owner, `append` for list-like). A slot
  that ships without a declared inline default has no defined behavior when unfilled.
- **Declared settings keys.** Every key the artifact reads, with its default. An override carrying
  a key the artifact does not declare is rejected loudly, so the declared set is the contract.
- **Safety rules.** The explicit Allowed and Forbidden lists, in prose. State which paths the
  artifact may write; anything outside `_local/` needs an explicit, justified exception.

## Contribution shape

For a **capability** spec, additionally settle the manifest surface before any fragment prose:
the `kind` (`adapter` | `feature` | `both`), one row per contribution
(`phase | contribution-kind | dispatch | scope`), and — for a partitioned kind — the ownership
token that must not collide with another active capability. Decide `inline:` versus `subagent:`
dispatch per row at spec time; it is a design choice, not an implementation detail.

Constitution clauses are declared with the repeatable `article: <key> = <value>` manifest **key**.
`article` is not a contribution kind — a fragments-table row naming it is a validation error.

## Acceptance criteria that bind

Write success criteria against the declared interface, so verification has something mechanical to
check: the terminal block's exact shape, the zero-argument default's observable outcome, each
declared slot's unfilled behavior, and — for a capability — that every declared fragment path
exists and every row names a phase and kind core actually defines.

**Always include the inert criterion.** A capability contributes nothing until it is registered.
Every capability spec carries a criterion stating that an unregistered project's behavior is
unchanged and no capability term surfaces in any phase.

## No-op

When the `spec` work under construction authors no marketplace artifact, this fragment contributes
**nothing**; the phase proceeds on its generic guidance alone. With the capability unregistered the
fragment is never reached at all.
