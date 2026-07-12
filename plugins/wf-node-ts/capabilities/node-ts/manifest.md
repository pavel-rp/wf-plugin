# node-ts capability manifest

**Version:** 1.2.0
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

Read-off detail, the `git` requirement rationale, the `skills:` block, and downstream
registration: [`references/onboarding.md`](references/onboarding.md) — read by `init` and
authors, never at phase-fire.
