# `authoring-scenarios` fragment — author-caps capability (qa-generation scenario)

**Version:** 1.0.0 (WF-355 — the author-caps `qa-generation`-phase authoring scenarios)
**Wired by:** `plugins/wf-author-caps/capabilities/author-caps/manifest.md`
(`qa-generation | scenario | inline: fragments/authoring-scenarios.md`)
**Contributes:** a `scenario` at the `qa-generation` phase, per
`plugins/wf/skills/_contracts/capability-registry.ops.md`
**Model:** claude-opus-4-8

---

Scenarios a core skill adds to the QA plan when it fires `qa-generation` with `author-caps` active
and the task under test **authored a skill, capability, agent, or pack for this marketplace**.
`scenario` aggregates with provenance — these join the plan's generic spec-traced scenarios, they
never replace them.

## Applies when

The task's change set includes a `SKILL.md`, an `agents/<name>.md`, a capability `manifest.md`, a
phase fragment, or a plugin manifest. Otherwise emit nothing (see No-op).

## Execution engine — declared, not wired

Authoring artifacts are prose, so their behavior is only observable by **running the artifact and
observing what it does** — which is what the `wf-sandbox-testing` harness exists to do. These
scenarios name `wf-sandbox-testing` as their **eventual** execution engine so a reader knows where
they are headed.

**That is a declaration only.** This fragment wires nothing: the capability declares no `requires:`,
resolves no provider surface, and invokes no harness. Until the integration lands, every scenario
below is executed the same way any other plan scenario is — by a human or agent following its
steps. **Do not** resolve, dispatch to, or import the harness from this fragment; a scenario that
tries to is out of scope and must not ship.

## Scenarios to contribute

Emit each as a plan scenario in the plan's own scenario shape, with a stable id and a `Validates:`
line tracing to the spec criterion it covers. Contribute only those whose target the change set
actually contains.

- **Interface matches body.** For each authored or changed skill: its declared invocation shape,
  terminal block, declared slots, and declared settings keys agree with what the body actually
  does. Steps: read the declaration, invoke the skill at its zero-argument default, assert the
  terminal block's exact `NAME — status` shape is the last thing emitted.
- **Declared paths resolve.** For each authored or changed capability manifest: every fragments-row
  `dispatch` path exists on disk, and every row names a phase and contribution kind core defines.
  Assert per row, not in aggregate — a per-row verdict names the offender.
- **Registration composes.** After registering the capability, its rows resolve and each declared
  contribution is reachable at its phase. Steps: register, refresh the resolved view, inspect the
  registry, assert each expected row appears valid with its capability as provenance.
- **Named targets exist.** No authored body names a sibling command, agent, or path that does not
  resolve — with attention to fallback and recovery branches, where a dead name ships unnoticed
  because the happy path never reaches it.
- **The inert case.** With the capability **unregistered**, the same phases run and no authoring
  fragment fires, no authoring term surfaces, and the output is unchanged. This is the scenario
  that protects every project that never installed the pack — always contribute it when any other
  scenario above is contributed.

## Verdicts

Each scenario reports in the QA plan's shared verdict shape, tagged `capability: author-caps` as
its provenance. A scenario whose target is absent from the change set is not emitted at all —
never emitted and marked not-applicable.

## No-op

When the task authored no marketplace artifact, this fragment contributes **no** scenarios; the
generic plan stands alone. With the capability unregistered the fragment is never reached at all.
