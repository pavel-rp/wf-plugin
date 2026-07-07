# Audit capability manifest

**Version:** 1.0.0 (WF-155 — five adversarial verify lenses)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.contract.md`
**Capability:** audit (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** adapter (attaches phase fragments via the registry; ships no skills of its own)
**Model:** claude-opus-4-8

---

This is the audit capability's **fragments manifest** — the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row; it does not hardcode this path.

The capability contributes **five adversarial `finding` lenses** at the `verify` phase. A
core skill firing `verify` (today, `verify-spec`) collects the rows below and dispatches
each — with no lens named in core. Registered → the five lenses' findings aggregate,
provenance-tagged, on the same footing as generic requirements. Unregistered → the phase
finds no rows and produces nothing (the byte-identical no-op). Registry membership is the
whole on/off toggle; the capability adds no core machinery.

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy, in the v2
shape `phase | contribution-kind | dispatch | scope`. `subagent:` dispatch names a
registered subagent invoked via the Task tool. `scope` is empty (`—`) for aggregate kinds;
`finding` aggregates **with provenance**, so every row carries no ownership scope token.

| phase  | contribution-kind | dispatch                              | scope |
|--------|-------------------|---------------------------------------|-------|
| verify | finding           | `subagent: wf-caps:correctness-auditor` | —     |
| verify | finding           | `subagent: wf-caps:security-auditor`    | —     |
| verify | finding           | `subagent: wf-caps:convention-auditor`  | —     |
| verify | finding           | `subagent: wf-caps:consistency-auditor` | —     |
| verify | finding           | `subagent: wf-caps:operational-auditor` | —     |

Read off the rows — one adversarial lens each, all firing at `verify`, all returning the
generic `finding` shape:

- **correctness** — ignored return values, null/absent handling, silent data loss,
  state-machine gaps, error handling, unvalidated data, backward compatibility, boundaries,
  untested branches. Backed by the **owned** adversarial-correctness rubric
  `fragments/correctness.md` (the single rubric source WF-160's `sr` reuses — never
  re-authored).
- **security** — injection, auth/authz gaps, secrets exposure, resource limits, concurrency
  safety, error leakage. Backed by `fragments/security.md`.
- **convention** — naming/behavioral parity with the surrounding code, redundant work, data
  over-fetching, type precision. Backed by `fragments/convention.md`.
- **consistency** — intra-diff contradictions: derivation, persistence/response alignment,
  guard completeness, naming alignment. Backed by `fragments/consistency.md`.
- **operational** — dependency freshness, logging hygiene, accessibility, idempotency,
  migration safety, configuration drift. Backed by `fragments/operational.md`.

A core skill firing `verify` dispatches **all five** rows via the Task tool, passing the
work under review and the generic `finding` shape; only each subagent's final block returns.
Aggregation is provenance-tagged, in registry order (cosmetic for `finding`). None is
spawned by name from core — each is reached only through these registry rows. Each auditor
is read-only (no source mutation, no provider/MCP reach) and shares the finding contract in
`fragments/finding-contract.md`.

## Profile seed template

This capability ships a **profile seed template** declared via the v2 manifest
`profile-template:` field (`capability-registry.contract.md` §"Manifest schema v2"). The
path is forward-slash, **relative to this capability's registry path** (so it resolves to
`plugins/wf-caps/capabilities/audit/profile.template.json`):

```
profile-template: profile.template.json
```

The template ships **concrete defaults** — all five lenses enabled — so the full fleet runs
out of the box with no override. A project selects a subset by seeding an override at
`_local/profiles/audit.profile.json` (via `init` / `/wf-caps:init`, on divergence, per the
contract's capability-agnostic seeding convention). Each auditor reads the resolved profile
on boot and self-no-ops (empty findings) when its own lens id is absent from the `lenses`
list — so a subset runs only the selected lenses, with **no change to any core skill**.
Precedence is **downstream override > capability default**; seeding is idempotent
(skip-if-present).

## Dependencies

This capability declares **no `requires:`** — the five lenses are pure read-only reasoning
over the work under review and reach no `delivery` or `tracker` provider. It therefore
composes in **bare-core** mode too (no provider registered), unlike the pack's
provider-dependent capabilities.
