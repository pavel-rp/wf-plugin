# audit capability — onboarding & authoring reference

Per-lens rubric detail, the profile-subset mechanism, the optional composite retrospective
report, the dependency rationale, and version history for the audit capability. **Never read at
phase-fire** — a core skill firing `verify` reads only `../manifest.md`'s fragments table. This
file is for `init` and for authors.

## What this manifest is

The audit capability's **fragments manifest** (`../manifest.md`) is the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which fragments this
capability attaches to which SDD phases. Core resolves `<path>` from the registry row; it does not
hardcode this path.

The capability contributes **five adversarial `finding` lenses** at the `verify` phase. A core
skill firing `verify` (today, `verify-spec`) collects the rows and dispatches each — with no lens
named in core. Registered → the five lenses' findings aggregate, provenance-tagged, on the same
footing as generic requirements. Unregistered → the phase finds no rows and produces nothing (the
byte-identical no-op). Registry membership is the whole on/off toggle; the capability adds no core
machinery. Beyond the five phase lenses, the capability ships **one optional, on-request output**
— a composite retrospective / umbrella-verification report (below). It is **not** a phase
fragment: it composes *over* the lens findings the `verify` phase already produced, so it runs
only when a caller requests it, gated by the **same registry membership** as the lenses.

## The five lenses

Read off the rows — one adversarial lens each, all firing at `verify`, all returning the generic
`finding` shape:

- **correctness** — ignored return values, null/absent handling, silent data loss, state-machine
  gaps, error handling, unvalidated data, backward compatibility, boundaries, untested branches.
  Backed by the **owned** adversarial-correctness rubric `fragments/correctness.md` (the single
  rubric source WF-160's `sr` reuses — never re-authored).
- **security** — injection, auth/authz gaps, secrets exposure, resource limits, concurrency
  safety, error leakage. Backed by `fragments/security.md`.
- **convention** — naming/behavioral parity with the surrounding code, redundant work, data
  over-fetching, type precision. Backed by `fragments/convention.md`.
- **consistency** — intra-diff contradictions: derivation, persistence/response alignment, guard
  completeness, naming alignment. Backed by `fragments/consistency.md`.
- **operational** — dependency freshness, logging hygiene, accessibility, idempotency, migration
  safety, configuration drift. Backed by `fragments/operational.md`.

Aggregation is provenance-tagged, in registry order (cosmetic for `finding`). Each auditor is
read-only (no source mutation, no provider/MCP reach) and shares the finding contract in
`fragments/finding-contract.md`.

## Profile seed template

This capability ships a **profile seed template** declared via the v2 manifest `profile-template:`
field (`capability-registry.contract.md` §"Manifest schema v2"). The path is forward-slash,
**relative to this capability's registry path** (so it resolves to
`plugins/wf-audit/capabilities/audit/profile.template.json`): `profile-template:
profile.template.json`.

The template ships **concrete defaults** — all five lenses enabled — so the full fleet runs out of
the box with no override. A project selects a subset by seeding an override at
`_local/profiles/audit.profile.json` (via `init` / `/wf-audit:init`, on divergence, per the
contract's capability-agnostic seeding convention). Each auditor reads the resolved profile on
boot and self-no-ops (empty findings) when its own lens id is absent from the `lenses` list — so a
subset runs only the selected lenses, with **no change to any core skill**. Precedence is
**downstream override > capability default**; seeding is idempotent (skip-if-present).

## Composite retrospective report

The capability's **optional, on-request** additional output — a process-retrospective and
composite (umbrella) verification over a **completed** task. Deliberately **not** a fragments-table
row: a phase fragment auto-fires on every phase firing, whereas this report is requested, once,
over a task whose `verify` phase has already run. It rides no core phase and adds no always-on
core surface — it is dispatched via the **Task** tool on request.

- **Dispatch:** `subagent: wf-audit:audit-retrospective` (`plugins/wf-audit/agents/audit-retrospective.md`).
- **Procedure (boot doc):** `fragments/retrospective.md` — the agent reads and follows it, holding
  no logic of its own (the same agent+rubric split the five lenses use).
- **Gate (the same toggle as the lenses):** the agent's first step reads the `## Capabilities`
  registry and no-ops (`RETROSPECTIVE — not-registered`, nothing written) unless the audit
  capability is registered — the identical on/off datum registry membership gives the lenses.
- **Composition:** the `verify` report's spec-conformance verdict + the aggregated lens findings
  (read from `04_verify.md`; never re-derived) + a process retrospective, **folding in** PR-review
  and CI evidence via the `delivery` provider's `pr-comments-read` / `checks-read` / `activity-read`
  reads (direct provider resolution) — the **bulk** (review-comment bodies, failing logs) distilled
  through `wf:context-distiller` so it never enters the report's own context.
- **Degradation:** with no `delivery` provider registered, those three reads resolve to an empty
  result (per the delivery-surface unconfigured-reads rule) — the report degrades to a
  spec-conformance + lens-findings retrospective with **no** PR/CI section and no provider term.
  Absent `04_verify.md` → the report stops and directs the requester to `/wf:verify-spec` rather
  than emit a hollow composite.
- **Artifact:** `{task-root}/{task-id}/09_retrospective.md`, carrying model attribution and no
  AI-attribution/promotional content; catalogued via `wf:index` under the `retrospective` slot.

## Dependencies

This capability declares **no `requires:`** — the five lenses are pure read-only reasoning over the
work under review and reach no `delivery` or `tracker` provider. The composite retrospective report
*optionally* reaches the `delivery` provider's **read-side** operations, but **degrades to an empty
result** when none is registered (it never blocks), so it adds no dependency either. The capability
therefore composes in **bare-core** mode too (no provider registered).

## Version history

- **WF-155** — five adversarial verify lenses.
- **WF-159** — optional composite retrospective report.
- **WF-230** — lean the manifest: onboarding/authoring narrative (per-lens rubrics, the
  profile-subset mechanism, the composite retrospective report, the dependency rationale)
  relocated here; `manifest.md` now carries only the phase-fire/validator declarations (the
  five-row fragments table + the `profile-template:` declaration).
