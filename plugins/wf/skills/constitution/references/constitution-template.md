# `_local/constitution.md` template

The verbatim template `/wf:constitution` emits at write time (establish/update). Substitute the placeholders; keep the `## Precedence`, `## Core articles`, `## Capability articles`, and `## Project clauses` sections. Do **not** bake a flattened single-source file elsewhere — this record *is* the composition. Do **not** name any concrete stack, domain, or capability in the core articles; capability names appear only as provenance tags read from the registry.

## Contents

- [Template: `_local/constitution.md`](#template-_localconstitutionmd) — the full fenced block

## Template: `_local/constitution.md`

```markdown
# Project Constitution

**Composed:** <YYYY-MM-DD HH:mm>
**Model:** <model identifier>
**Registry:** <comma-separated capability names | none (core-only)>

The non-negotiable principles this project's workflow holds itself to. **Composed, not
baked** — core process articles + each registered capability's non-negotiables + the
project's own clauses, each tagged with its source. Intended to be consulted as guidance at
`spec` and enforced as findings at `verify` once that consumption wiring lands (owned by
other tasks). Re-run `/wf:constitution` to refresh after a registry or project-clause change.

## Precedence

1. **Project clauses override capability clauses** — a project clause wins over any
   capability article, regardless of registry order.
2. **Capability-vs-capability contradiction is a registry-validation error** — resolved by
   the registry validator, not here; only the project may resolve it (rule 1).

## Core articles (provenance: core)

<the seven domain-free process articles verbatim, then the "Core never requires a
capability" and "Temp and scratch files live under `_local/`, and nothing is left
behind" articles verbatim —
numbered 1–9>

## Capability articles (provenance: each capability)

<one subsection per registered capability that declares articles, tagged with its name from
the registry; omit this whole section when no capability contributed (core-only)>

### <capability name>

<that capability's non-negotiable articles, composed from its manifest>

## Project clauses (provenance: project)

<!-- Add this project's own non-negotiable clauses below. They override capability
     articles. This section is preserved verbatim across re-runs — /wf:constitution never
     overwrites it without asking. -->
```
