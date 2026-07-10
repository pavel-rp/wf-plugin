# browser-qa capability manifest

**Version:** 1.1.0 (WF-255 — extracted into the standalone `wf-browser-qa` plugin; tracker-agnostic, `requires: git` only)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Capability:** browser-qa (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** feature (ships its own skill + agent; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

This is the browser-qa capability's **fragments manifest** — the file a core skill reads
at `<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

browser-qa supplies the **stack-agnostic browser-automation engine** — the in-thread
browser-driving execution surface that reaches each scenario's browser-level
preconditions, drives its steps, captures console/network signals, screenshots on FAIL,
and emits per-scenario verdict blocks in the shared QA report format. It is reusable
across projects regardless of stack (React, jQuery, any web UI). It carries **zero** stack
nouns — no framework names, no database tooling, no host-scaffolding wiring; those are
separate stack capabilities. The engine reaches only browser-level storage/state
preconditions (`localStorage` / `sessionStorage` / cookies, URL, viewport).

## Requires

requires: git

This capability assumes only a `delivery` provider (`git`) is registered in the capability
registry — the `git` delivery guard fires so branch/commit/PR operations resolve. It is
**tracker-agnostic**: it names no work-item tracker, so a consumer on any tracker (or none)
can register it. (Historically this manifest also required `ado`; WF-255 dropped that token
when the capability was extracted into the standalone `wf-browser-qa` plugin.)

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy. The
schema is the v2 shape fixed by `capability-registry.contract.md`:
`phase | contribution-kind | dispatch | scope`. `subagent:` dispatch names a registered
subagent invoked via the Task tool. `scope` is required for partitioned kinds; `provider`
carries a **`surface`** enum token.

| phase         | contribution-kind | dispatch                     | scope  |
|---------------|-------------------|------------------------------|--------|
| qa-execution  | provider          | `subagent: wf-browser-qa:qa-engine`| engine |

Read off the columns:

- **qa-engine** (`qa-execution | provider | subagent: wf-browser-qa:qa-engine | engine`) — the
  browser-automation **execution provider**. A core skill orchestrating `qa-execution`
  (today: `wf:qa-auto`) walks the registry, finds the `provider` row that owns
  `surface: engine`, and dispatches the per-scenario browser drive to it via the Task tool
  (`subagent_type: wf-browser-qa:qa-engine`). The engine reasons in an isolated context and
  returns per-scenario verdict block(s) in the shared report format; the orchestrator owns
  run lifecycle (resume / batch / report rollup) and never drives the browser itself.

`provider` is a **partitioned** kind: only the capability owning `surface: engine` applies
at `qa-execution`. Two capabilities claiming the same surface is a registry-validation
error; different surfaces (`engine`, `host`, …) compose. browser-qa owns `engine` only —
it makes no claim on `host` (the stack test-host surface), so a future stack capability may
own `host` alongside this one with no conflict.

## Skills

As a `feature` capability, browser-qa ships its skill + agent natively (install the plugin →
the `/wf-browser-qa:*` command and the subagent are discoverable; native plugin composition handles
loading). Documented for reference:

```
skills:
  - plugins/wf-browser-qa/skills/qa-engine/   # /wf-browser-qa:qa-engine — the browser-automation engine
agents:
  - plugins/wf-browser-qa/agents/qa-engine.md # wf-browser-qa:qa-engine — the engine's subagent companion (the provider dispatch target)
```

The fragment row's `subagent: wf-browser-qa:qa-engine` resolves to that companion; the agent
declares **no** `tools:` field, so it inherits the full session catalog — including the
browser-automation MCP tools the engine drives (per `CLAUDE.md` §8).

## Downstream registration

This repo ships the capability + its docs; it does **not** carry a `_local/config.md` (that
lives in each consuming project). **One command (recommended): `/wf-browser-qa:init`** — after
`/wf:init` has bootstrapped the repo, it records the pack's install root in the gitignored
`## Plugin Roots` mapping and writes the plugin-anchored `## Capabilities` row, so core
resolves the capability on a **plugin-only install** (no vendored `plugins/wf-browser-qa/...`
in the consuming repo):

```markdown
## Capabilities

| Capability | Path                                    |
|------------|-----------------------------------------|
| browser-qa | plugin:wf-browser-qa/capabilities/browser-qa |
```

**Manual (escape hatch)** — when the pack **is** vendored in the consuming repo, add a
repo-relative row by hand instead: `| browser-qa | plugins/wf-browser-qa/capabilities/browser-qa |`.
See the registry contract's "two `Path` shapes".

## Profile seed template

browser-qa ships no `profile-template:` today — the engine reads its test credentials from
the downstream `_local/qa-creds.md` (stack-agnostic test-cred plumbing the engine prompts
for and remembers), not from a stamped profile. Per the contract's seeding convention, a
capability that declares no `profile-template:` seeds nothing (the no-op path).
