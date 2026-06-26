# Migration capability manifest

**Version:** 1.0.0 (WF-10 — kept `rule-audit` prototype)
**Conforms to:** `plugins/wf/skills/_contracts/invocation-mechanism.contract.md` (manifest schema)
**Capability:** migration (`{domain}: migration`, `{domain-path}: plugins/wf-caps/capabilities/migration`)
**Model:** claude-opus-4-8

---

This is the migration capability's **hook→dispatch manifest** — the file a core skill reads
at `{domain-path}/manifest.md` to learn how this capability fills each core hook. Core
resolves `{domain-path}` from `_local/config.md`; it does not hardcode this path.

Each row maps a hook frozen by `core-extension.contract.md` to exactly one dispatch kind.
Inline paths are forward-slash, **relative to `{domain-path}`** (so `hooks/rule-audit.md`
resolves to `plugins/wf-caps/capabilities/migration/hooks/rule-audit.md`).

| Hook | Dispatch |
|------|----------|
| rule-audit | `inline: hooks/rule-audit.md` |

## Profile seed template

This capability ships a human-fillable **profile seed template** declared via the v2
manifest `profile-template:` field (`capability-registry.contract.md` §"Manifest schema v2").
The path is forward-slash, **relative to `{domain-path}`** (so it resolves to
`plugins/wf-caps/capabilities/migration/profile.template.json`):

```
profile-template: profile.template.json
```

`init` (WF-9) stamps it per the contract's capability-agnostic seeding convention to
`_local/profiles/migration.profile.json`, where a downstream project fills the four required
slots (`stack`, `type-map`, `invariants`, `rule-checks`). The template's placeholder values
point at the worked example, `fixtures/valid-profile.json` — the validator's known-passing
input. The template is distinct in purpose from that fixture: the fixture is a complete
worked instance for the validator; the template is the blank a project fills in.

## Unwired hooks

`mapping` and `parity-suite` are **intentionally absent** — they are out of scope for the
WF-10 prototype (WF-7 wires `mapping` as a `verify` finding; WF-8 wires `parity-suite`). Per the invocation
mechanism's no-op path, a hook with no manifest row no-ops cleanly: a core skill firing
`mapping` or `parity-suite` while `{domain}: migration` is active proceeds exactly as if the
hook were absent, until a later task adds its row here. Absence is not an error.

## v2 schema correspondence (N=1 example — note only)

`capability-registry.contract.md` (v2.0.0, WF-21) supersedes the v1 single-`{domain}` /
three-named-hook port with a **capability registry**, named **SDD phases**, and a generic
**contribution taxonomy**. Its v2 manifest shape is a fragments table —
`phase | contribution-kind | dispatch | scope` — and this manifest is the worked **N=1
example** that contract resolves *to*. The existing v1 row maps onto the v2 columns like
this:

| v1 manifest row | → v2 fragment row (`phase | contribution-kind | dispatch | scope`) |
|-----------------|-------------------------------------------------------------------|
| `rule-audit → inline: hooks/rule-audit.md` | `verify | finding | inline: hooks/rule-audit.md | —` |

Read off the columns: the v1 `rule-audit` seam becomes a `finding` contribution at the
`verify` phase, dispatched `inline:` to the same `hooks/rule-audit.md` doc, with no `scope`
(the `finding` kind aggregates with provenance, so it carries no ownership scope token). At
N=1 this is exactly the existing behaviour, re-expressed in the v2 shape.

The v2 **runtime** that resolves this N=1 example — iterating the registry, reading this
manifest, collecting the `verify` fragment, and rendering its provenance-tagged `finding` —
is `plugins/wf/skills/_contracts/invocation-runtime.contract.md` (v2.0.0, WF-22), which
supersedes `invocation-mechanism.contract.md` (v1.0.0, WF-10) referenced above.

**Not authored here.** The rest of this capability's v2 fragments — a `scenario` at
`qa-generation` (from the absent `parity-suite` seam), a second `finding` at `verify`
(the migration-map 1:1 audit, from the absent `mapping` seam — it checks an *implemented*
migration, so it is verify-time, **not** a `plan` artifact), and the new authoring
`guidance` / `task-list` fragments at `spec` / `implement` / `tasks` — are **deferred** to
WF-3 (profile authoring) and the per-phase wiring issues (WF-7 / WF-8; WF-6 was relocation only). This note
only records the schema correspondence so the v2 contract's manifest-schema claim has its
reference example; it adds no new fragment rows to the table above.
