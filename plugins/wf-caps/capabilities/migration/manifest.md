# Migration capability manifest

**Version:** 2.2.0 (WF-23 — `task-list` wired as a `tasks` decomposition fragment)
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

| phase          | contribution-kind | dispatch                          | scope |
|----------------|-------------------|-----------------------------------|-------|
| tasks          | task-list         | `inline: hooks/task-list.md`      | —     |
| verify         | finding           | `inline: hooks/rule-audit.md`     | —     |
| verify         | finding           | `subagent: wf-caps:migration-map` | —     |
| qa-generation  | scenario          | `inline: hooks/parity-suite.md`   | —     |

Read off the columns:

- **task-list** (`tasks | task-list | inline: hooks/task-list.md`) — the migration
  **decomposition** layer: core reads `hooks/task-list.md` and follows it in-context when
  firing the `tasks` phase, emitting migration-shaped tasks (one increment per ported
  construct, scaffold-then-component, each independently testable) in the generic
  `task-list` shape. `task-list` aggregates **additively in registry order**, so the row
  carries no provenance tag and no ownership scope; when the work under review contains no
  migration, the fragment returns an empty task list (the no-op).
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
  the phase. The migration-map writes a durable mapping table (`03_migration-map.md`).
  Authoring migration-map's native `finding`-shape output is **deferred** to the
  per-phase wiring work. Core dispatches this row and supplies the generic finding shape, but
  it never parses migration-map's status block or its written artifact to synthesize
  findings (that would be a capability-specific parse, forbidden to domain-free core).
  So until migration-map emits the generic finding shape, this row yields **nothing to
  aggregate**; this row wires the dispatch now, and its flagged rows become aggregated
  `finding`s once migration-map emits the finding shape.
- **parity-suite** (`qa-generation | scenario | inline: hooks/parity-suite.md`) — the
  migration **parity** QA layer: core reads `hooks/parity-suite.md` and follows it
  in-context when firing the `qa-generation` phase, emitting functional- and
  visual-parity scenarios that exercise each migrated unit against its legacy counterpart
  (1:1 names, integer round-trip, verbatim DOM ids/classes, preserved signatures) in the
  generic `scenario` shape. `scenario` aggregates **with provenance**, so the row carries
  no ownership scope; when the work under review contains no migration, the fragment
  returns an empty scenario list (the no-op).

The two `verify` `finding` rows fire at `verify`; the `parity-suite` `scenario` row fires
at `qa-generation`. A core skill firing `verify` dispatches **both** finding rows; a core
skill firing `qa-generation` dispatches the parity-suite row. Aggregation is
provenance-tagged, in registry order (cosmetic for `finding` / `scenario`). Today only
**rule-audit** yields a rendered finding; migration-map is wired but yields nothing to
aggregate until it emits the generic finding shape (deferred to the per-phase wiring work);
**parity-suite** yields parity scenarios whenever the work under review is a migration.
None is spawned by name from core — each is reached only through these registry rows.

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

## Fragment wiring status

`parity-suite` is **now wired** (WF-8) — the `qa-generation | scenario | inline:
hooks/parity-suite.md` row above. A core skill firing `qa-generation` while migration is
active reads `hooks/parity-suite.md` and aggregates the parity scenarios it returns
(provenance-tagged); when the work under review is not a migration, that fragment returns
the empty scenario list (the no-op path), so the firing skill proceeds with its generic
plan alone.

`task-list` is **now wired** (WF-23) — the `tasks | task-list | inline: hooks/task-list.md`
row above. A core skill firing the `tasks` phase while migration is active reads
`hooks/task-list.md` and appends the migration-shaped tasks it returns (additive, in
registry order); when the work under review is not a migration, that fragment returns the
empty task list (the no-op path), so the firing skill proceeds with its generic
decomposition alone.

The authoring `guidance` (at `spec` / `implement`) fragments this capability will gain
remain **deferred** to the per-phase wiring issues; this manifest adds the `tasks`
`task-list` row, the two `verify` `finding` rows, and the one `qa-generation` `scenario`
row above. `mapping` is **wired** (the migration-map row), absorbing WF-6: it is a
verify-time `finding`, not a `plan` artifact.
