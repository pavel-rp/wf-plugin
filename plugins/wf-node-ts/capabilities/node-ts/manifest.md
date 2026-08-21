# node-ts capability manifest

**Version:** 1.3.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** node-ts (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** feature (ships its own skill; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

node-ts supplies the **Node/TypeScript pure-helper test harness** (`test-node`) — a
dependency-free unit-test runner for pure TS helpers (parsers, formatters, coercion helpers)
that need no Angular runtime (no DI, zone.js, `HttpClient`, templates). It is a distinct stack
from the Angular surface (`angular` capability): the Node runtime, not the browser/DI runtime.

## Requires

requires: git

## Fragments

Schema (`capability-registry.contract.md`): `phase | contribution-kind | dispatch | scope`.
Inline paths are forward-slash, **relative to this capability's registry path**. `scope` is
empty (`—`) for aggregate kinds; `guidance` aggregates additively, so it carries no ownership
scope token.

| phase     | contribution-kind | dispatch                              | scope |
|-----------|-------------------|---------------------------------------|-------|
| implement | guidance          | `inline: fragments/test-authoring.md` | —     |

`guidance` is an **aggregate** kind — it aggregates additively in registry order (general →
specific), carrying no provenance tag and no ownership scope. The fragment is **self-scoped to
test authoring**: when the `implement` work authors no pure-helper unit test, it contributes
the empty guidance (the no-op).

## Payloads

Schema (`capability-registry.contract.md`): `source | destination | production | refresh | removal`.
`source` is relative to this capability's registry path; `destination` is workspace-relative.
The vocabulary is closed — `copy`, `replace-if-unmodified | retain`, `delete-if-unmodified | retain`.

| source                    | destination              | production | refresh               | removal |
|---------------------------|--------------------------|------------|-----------------------|---------|
| `payloads/testkit-run.mjs` | `_local/_testkit/run.mjs` | copy       | replace-if-unmodified | retain  |

The runner this row installs is the one `test-node` invokes, and it is installed **only when
this capability is selected** — a project that runs bare core, or that never registers node-ts,
receives no runner and no `_testkit` directory at all. The row and the file it names are
authored together; neither is meaningful alone.

`removal` is `retain` deliberately: this row grants no deletion authority. Removing the runner
when the pack is deselected is a removal decision, and removals are out of scope here.

Read-off detail, the `git` requirement rationale, the `skills:` block, and downstream
registration: [`references/onboarding.md`](references/onboarding.md) — read by `init` and
authors, never at phase-fire.
