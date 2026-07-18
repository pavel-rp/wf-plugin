---
name: authoring-taxonomy
description: Explains the wf contribution taxonomy and capability manifest schema — which SDD phase accepts which contribution kind, how core aggregates or partitions multiple contributors, what every manifest field and fragments-table cell means, and how a registry row resolves. Use whenever the user asks what a contribution kind means, which phase to attach a fragment to, how to structure or fill in a capability manifest, what kind or dispatch or scope value to write, why registry validation is failing, or how constitution articles compose.
allowed-tools: [Read, Glob, Grep]
---

# /wf-author-caps:authoring-taxonomy — the contribution taxonomy and manifest schema

The schema half of the authoring toolkit: the exact phases, kinds, fields, and tokens. For design
guidance — what to build and where it belongs — use `/wf-author-caps:authoring-guide`.

**Model:** claude-opus-4-8

## Contents

- [The phase spine](#the-phase-spine)
- [Contribution kinds](#contribution-kinds)
- [Aggregation policy](#aggregation-policy-by-kind)
- [Manifest schema v2](#manifest-schema-v2)
- [The registry row](#the-registry-row)
- [The constitution](#the-constitution)
- [Registry validation](#registry-validation)
- [Edge Cases](#edge-cases)

---

## The phase spine

Phases are the injection points. A capability touches only the phases it has something to say about;
a phase with no attached fragment runs exactly as if inert.

| Phase | Its role | What a capability contributes | Kind |
|---|---|---|---|
| `spec` | conventions, constraints, acceptance criteria, invariants | authoring guidance | `guidance` |
| `plan` | correspondence that cannot live as spec prose | a forward correspondence artifact | `artifact` |
| `tasks` | decomposition into small, independently testable units | extra task increments | `task-list` |
| `implement` | stack idioms and scaffolds; applying the plan's mapping | authoring guidance | `guidance` |
| `verify` | conformance to the spec and its derived invariants | audit findings | `finding` |
| `qa-generation` | scenarios derived from acceptance criteria | test scenarios | `scenario` |
| `qa-execution` | the execution engine and environment | the driver itself | `provider` |

Two additions sit outside the phase spine. A **`slot`** targets a named composition point inside one
specific skill rather than an SDD phase, so its phase cell is a dash and its scope names the point
and its merge policy. An **`article`** is a constitution clause, declared as a manifest key rather
than a fragments-table row.

`artifact` at `plan` is **reserved and has no active instance.** It is kept for a *forward*
correspondence fragment authored from spec and source before code exists — not for a
post-implementation audit, which is a `verify` `finding`. Do not wire an audit there.

## Contribution kinds

- **`guidance`** — prose the phase follows while authoring. Additive.
- **`task-list`** — extra task increments appended to the generic decomposition. Additive.
- **`finding`** — an assertion about implemented code, carrying provenance.
- **`scenario`** — a test scenario derived from acceptance criteria, carrying provenance.
- **`artifact`** — a correspondence document owned by exactly one capability.
- **`provider`** — an execution or integration surface owned by exactly one capability.
- **`slot`** — a fill for a named composition point declared inside one skill.

## Aggregation policy by kind

How core combines several contributors depends only on the kind:

- **Aggregate** (`guidance`, `task-list`, `finding`, `scenario`) — every contributor applies, in
  **registry order**, general to specific. The most specific is injected last, so on additive
  guidance it wins. `finding` and `scenario` carry provenance, so order is merely cosmetic for them.
- **Partition** (`artifact`, `provider`) — only the **owning** capability applies. Overlapping
  ownership is a validation error naming both offenders. `provider` partitions by a `surface` token;
  `artifact` partitions by a `source→target` token pair.
- **Slot** — governed by the point's declared merge policy: `replace` admits a single winner that
  supersedes the skill's inline default wholesale; `append` concatenates contributions in registry
  order. A personal local override outranks a registered contribution.

## Manifest schema v2

A capability manifest lives at `{path}/manifest.md` and carries:

- **`kind:`** — one of exactly three values. `adapter` ships phase fragments only, no skills.
  `feature` ships its own skills, commands, or agents, and may also attach fragments. `both` ships
  skills **and** fragments; a plugin that does both has no other correct choice.
- **A fragments table** — one row per fragment, under the heading `## Fragments` spelled exactly.
  Columns are `phase | contribution-kind | dispatch | scope`.
  - `dispatch` is `inline: <rel-path>` (read the body and follow it in context) or
    `subagent: <agent>` (delegate heavy work; the value is plugin-qualified).
  - `scope` is required only for the partitioned kinds — a `surface` token for `provider`, a
    `source→target` pair for `artifact`, and the point plus merge policy for a `slot`.
  - A header-only table is legal: **zero rows validate**, which is how a capability registers ahead
    of its first contribution.
- **`article:`** — an optional constitution clause, written `article: <key> = <value>`. It is a
  manifest key, not a table row.
- **`requires:` / `conflicts:`** — optional capability names, resolved at validation.
- **`profile-template:`** — optional, and only when the capability fills contract slots with project
  values. It names an authoritative default template; a downstream override is seeded only on
  divergence, with the override winning per key.
- **`skills:`** — documentation for a `feature` or `both` kind, recording where its skills live.
  Native composition, not this field, is what loads them.

## The registry row

The registry is a `## Capabilities` table of `| Capability | Path |` rows in the downstream config.
Table order is injection order, general to specific. An empty table means a fully generic core.

A `Path` takes one of two runtime-resolved shapes: a **repo-relative folder** for a vendored
capability, or a **plugin-anchored token**, `plugin:<plugin-name>/<rel-path>`, for one shipping
inside an installed plugin. The plugin-anchored form resolves through a co-located `## Plugin Roots`
mapping — per-machine, gitignored, and written by the plugin's own `init` skill, never by hand. The
name is decoupled from the path, so a capability can move between plugins without breaking the
binding.

## The constitution

Constitution articles are **composed, not authored**. Core contributes domain-free process articles;
each capability contributes its own non-negotiables through `article:` keys. They are consulted as
guidance at `spec` and enforced as findings at `verify`. **Project clauses override capability
clauses**; a contradiction between two *capabilities'* articles is a validation error.

## Registry validation

Validation fails fast when any of these does not hold:

- capability names are unique, and every declared path exists and carries a manifest;
- no two active capabilities claim overlapping ownership scopes for a partitioned kind;
- no two capabilities declare contradictory article clauses;
- every `requires:` is satisfied and no `conflicts:` pair is both active;
- every fragment row names a phase **and** a contribution kind that core actually defines.

## Edge Cases

- **Validation reports zero rows from a table you filled in:** the `## Fragments` heading has a
  casing or spacing slip. The exact heading is required.
- **Two capabilities claim one surface:** partitioned kinds admit a single owner. Change one scope
  token or deactivate one capability.
- **A `slot` row rejected for its phase cell:** a slot targets a skill point, not an SDD phase — its
  phase cell must be a dash.
- **Unsure which kind fits:** ask whether the contribution *audits implemented code* (`finding`) or
  *guides authoring before it exists* (`guidance`). That single question resolves most cases.
- **A capability with no non-negotiables:** declare no `article:` key at all. An empty clause set is
  the normal case, not an omission.

---

```
AUTHORING-TAXONOMY — Delivered

Covered: the phase spine · seven contribution kinds · aggregate versus partition policy · manifest schema v2 · the registry row and path shapes · constitution composition · registry validation

Next: /wf-author-caps:authoring-guide for plugin anatomy, interface-first skill design, and the registration flow
```
