# host capability manifest

**Version:** 0.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** host (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships `/wf-host:init` and `/wf-host:qa-host`; attaches one provider dispatch)
**Model:** unknown

---

host supplies one generic, temporary **QA host execution surface**. It has no project, stack, route,
persistence, or command identifier: every executable binding and lifecycle declaration comes from the
resolved `host` profile. It prepares only the fixture operations a caller requests, durably records each intended
reversible operation before setup begins, and tears down every pending entry in reverse order.

## Fragments

Schema (`capability-registry.contract.md`): `phase | contribution-kind | dispatch | scope`.
`subagent:` dispatch names the discoverable subagent invoked through the Task tool. `scope` is
required for partitioned kinds; `provider` carries a `surface` enum token.

| phase        | contribution-kind | dispatch                 | scope |
|--------------|-------------------|--------------------------|-------|
| qa-execution | provider          | `subagent: wf-host:qa-host` | host  |

`provider` is partitioned: host owns **only** `surface: host`. It composes with an engine provider
and cannot be registered alongside another owner of `host`.

## Profile seed template

profile-template: profile.template.json
