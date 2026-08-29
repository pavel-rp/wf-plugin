# `_local/constitution.md` template

The verbatim template `/wf:constitution` emits at write time (establish/update). Substitute the placeholders; keep the `## Precedence`, `## Core articles`, `## Capability articles`, and `## Project clauses` sections. Do **not** bake a flattened single-source file elsewhere — this record *is* the composition. Do **not** name any concrete stack, domain, or capability in the core articles; capability names appear only as provenance tags read from the registry.

**Every article carries its id.** All three sections render the same
`- **<provenance>.<n> — <title-or-key>:** <rule>` shape — `core.1`…`core.9`, `<capability>.1`…,
`proj.1`… — one rule per article, one unwrapped line each. The form, the word budget, and the
free-text normalization rules are [`clause-style.md`](clause-style.md); the obligation map any
core-article rewrite is gated by is [`obligation-inventory.md`](obligation-inventory.md).

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

<the nine domain-free process articles verbatim, as `- **core.1 — <title>.** <rule>` through
`- **core.9 — <title>.** <rule>`, one unwrapped line each>

## Capability articles (provenance: each capability)

<one subsection per registered capability that declares articles, tagged with its name from
the registry, each article rendered `- **<capability>.<n> — <key>:** <value>` and numbered
from 1 within that capability. This heading is ALWAYS written, core-only records included —
it is the structural landmark a later re-composition locates the record by, so an absent
section makes the record unrecognizable rather than merely empty. When no capability
contributed, write the heading with this single line as its body and no subsections:
`No registered capability declares a constitution article.`>

### <capability name>

<that capability's non-negotiable articles, composed from its manifest>

## Project clauses (provenance: project)

<!-- This project's own non-negotiable clauses. They override capability articles, and a
     clause here that names a core or capability id overrides that article too.

     Recorded by `/wf:constitution <clause text>` — free text is normalized, echoed with its
     minted id, and written only once approved. `proj.N` ids are monotonic and never reused.
     This section is preserved verbatim across re-runs; /wf:constitution never overwrites it
     without asking, and hand-editing it bypasses provenance, id continuity, and clause
     style. -->
```
