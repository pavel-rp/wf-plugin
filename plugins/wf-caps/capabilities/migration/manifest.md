# Migration capability manifest

**Version:** 2.0.0 (WF-7 — v2 fragments table; `mapping` wired as a second `verify` finding)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.contract.md` (v2.0.0, WF-22)
**Capability:** migration (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** adapter (attaches phase fragments via the registry; ships no skills of its own through this manifest)
**Model:** claude-opus-4-8

---

This is the migration capability's **fragments manifest** — the file a core skill reads
at `<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy. The
schema is the v2 shape fixed by `capability-registry.contract.md`:
`phase | contribution-kind | dispatch | scope`. Inline paths are forward-slash,
**relative to this capability's registry path** (so `hooks/rule-audit.md` resolves to
`plugins/wf-caps/capabilities/migration/hooks/rule-audit.md`). `subagent:` dispatch
names a registered subagent invoked via the Task tool. `scope` is empty (`—`) for
aggregate kinds; `finding` aggregates **with provenance**, so it carries no ownership
scope token.

| phase  | contribution-kind | dispatch                          | scope |
|--------|-------------------|-----------------------------------|-------|
| verify | finding           | `inline: hooks/rule-audit.md`     | —     |
| verify | finding           | `subagent: wf-caps:migration-map` | —     |

Read off the columns:

- **rule-audit** (`verify | finding | inline: hooks/rule-audit.md`) — the mechanical
  invariant audit: core reads `hooks/rule-audit.md` and follows it in-context, asserting
  the migration `rule-checks` against the diff and returning findings in the generic
  finding shape.
- **migration-map** (`verify | finding | subagent: wf-caps:migration-map`) — the 1:1
  audit of an *implemented* migration against the legacy source. It is wired at
  **`verify`-time**, not at `plan`: it reads the migrated diff, compares it
  source-vs-target with grep-verified counts, and self-stops if no target exists.
  `subagent:` dispatch because migration-map ships an `agents/migration-map.md` companion
  for the heavy isolated audit; only its final status block returns to the core firing
  the phase. The migration-map writes a durable mapping table (`03_migration-map.md`);
  the core consumes its flagged rows (deviations, count mismatches) as verify-time
  `finding` evidence. (Authoring migration-map's full native `finding`-shape output is
  deferred — WF-3 / per-phase work; this row wires the dispatch and its mapping is the
  evidence today.)

Both fragments fire at `verify` under the `finding` kind, so a core skill firing the
`verify` phase aggregates **both**, provenance-tagged, in registry order (cosmetic for
`finding`). Neither is spawned by name from core — both are reached only through these
registry rows.

## Profile seed template

This capability ships a human-fillable **profile seed template** declared via the v2
manifest `profile-template:` field (`capability-registry.contract.md` §"Manifest schema v2").
The path is forward-slash, **relative to this capability's registry path** (so it resolves
to `plugins/wf-caps/capabilities/migration/profile.template.json`):

```
profile-template: profile.template.json
```

`init` (WF-9) stamps it per the contract's capability-agnostic seeding convention to
`_local/profiles/migration.profile.json`, where a downstream project fills the four required
slots (`stack`, `type-map`, `invariants`, `rule-checks`). The template's placeholder values
point at the worked example, `fixtures/valid-profile.json` — the validator's known-passing
input. The template is distinct in purpose from that fixture: the fixture is a complete
worked instance for the validator; the template is the blank a project fills in.

## Unwired fragments

`parity-suite` is **intentionally absent** — a `scenario` at `qa-generation`, deferred to
WF-8. Per the invocation runtime's no-op path, a phase with no matching fragment row no-ops
cleanly: a core skill firing `qa-generation` while migration is active proceeds exactly as
if nothing were attached, until WF-8 adds its row here. Absence is not an error.

The authoring `guidance` (at `spec` / `implement`) and `task-list` (at `tasks`) fragments
this capability will gain are likewise **deferred** to the per-phase wiring issues; this
manifest adds only the two `verify` `finding` rows above. `mapping` is **now wired** (the
migration-map row), absorbing WF-6: it is a verify-time `finding`, not a `plan` artifact.
