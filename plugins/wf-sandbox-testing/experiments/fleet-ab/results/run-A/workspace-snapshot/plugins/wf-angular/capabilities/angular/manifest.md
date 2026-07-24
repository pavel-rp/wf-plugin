# angular capability manifest

**Version:** 1.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** angular (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** feature (ships its own skills; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

angular supplies the **Angular stack test-host surface** — the routed test-host page scaffolder
(`qa-host`) that gives an un-routed component a runnable URL (and an ephemeral backend-controller
analog), and the DI-level black-box page-test harness (`test-page`). Both are **stack-specific**
(they name the Angular runtime, routing module, and web/test-host paths). **Every
project-specific token in the scaffolded output** is **profile-slot-driven** — the concrete slot
values live in the capability's profile, not in the skill bodies.

## Requires

requires: git

## Fragments

Schema (`capability-registry.contract.md`): `phase | contribution-kind | dispatch | scope`.
`subagent:` dispatch names a registered subagent invoked via the Task tool. `scope` is required
for partitioned kinds; `provider` carries a **`surface`** enum token.

| phase         | contribution-kind | dispatch                        | scope |
|---------------|-------------------|---------------------------------|-------|
| qa-execution  | provider          | `subagent: wf-angular:qa-host`  | host  |

`provider` is a **partitioned** kind — only the capability owning `surface: host` applies at
`qa-execution`, and angular owns `host` only (it composes alongside browser-qa's `surface:
engine` with no collision). The authoring `guidance` fragments this capability will gain at
`spec`/`implement` and any constitution `article` clauses are **deferred** to per-phase wiring
work — until they land, angular attaches the single host-provider fragment above and nothing
else.

## Profile seed template

profile-template: profile.template.json

Read-off detail, the `git` requirement rationale, the `skills:`/`agents:` block, the full
profile-slot inventory, and downstream registration:
[`references/onboarding.md`](references/onboarding.md) — read by `init` and authors, never at
phase-fire.
