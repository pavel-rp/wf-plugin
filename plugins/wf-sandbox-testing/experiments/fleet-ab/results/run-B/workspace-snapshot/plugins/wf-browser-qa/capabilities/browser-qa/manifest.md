# browser-qa capability manifest

**Version:** 1.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** browser-qa (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** feature (ships its own skill + agent; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

browser-qa supplies the **stack-agnostic browser-automation engine** — the in-thread
browser-driving execution surface that reaches each scenario's browser-level preconditions,
drives its steps, captures console/network signals, screenshots on FAIL, and emits per-scenario
verdict blocks in the shared QA report format. It carries **zero** stack nouns.

## Requires

requires: git

## Fragments

Schema (`capability-registry.contract.md`): `phase | contribution-kind | dispatch | scope`.
`subagent:` dispatch names a registered subagent invoked via the Task tool. `scope` is required
for partitioned kinds; `provider` carries a **`surface`** enum token.

| phase         | contribution-kind | dispatch                     | scope  |
|---------------|-------------------|------------------------------|--------|
| qa-execution  | provider          | `subagent: wf-browser-qa:qa-engine`| engine |

`provider` is a **partitioned** kind — only the capability owning `surface: engine` applies at
`qa-execution`, and browser-qa owns `engine` only (a future stack capability may own `host`
alongside it with no conflict).

Read-off detail, the `git` requirement rationale, the `skills:`/`agents:` block, and downstream
registration: [`references/onboarding.md`](references/onboarding.md) — read by `init` and
authors, never at phase-fire.
