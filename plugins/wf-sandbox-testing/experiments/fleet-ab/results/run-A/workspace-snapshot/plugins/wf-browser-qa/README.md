# wf-browser-qa — the browser-QA feature pack

A standalone marketplace plugin that ships the **`browser-qa` capability**: a `feature`-kind
capability owning the wf capability-registry's **`qa-execution`** `provider` surface at
`surface: engine`. It supplies the **stack-agnostic browser-automation QA engine** — an
in-thread browser-driving execution surface that authenticates once against a running app,
reaches each scenario's browser-level preconditions (localStorage / sessionStorage / cookies,
URL, viewport), drives its steps with observation discipline, captures console/network
signals, screenshots on FAIL, and emits per-scenario verdict blocks in the shared QA report
format. It carries **zero** stack nouns — it works against any web UI (React, jQuery, plain
HTML, anything a browser can drive).

This is the "motivating reuse case": a consumer can install the browser-automation engine on
its own, without pulling any migration grammar or stack-specific scaffolding.

## What ships

| Item | What it is |
|---|---|
| `capabilities/browser-qa/manifest.md` | the `browser-qa` capability's manifest — one `provider` fragment row scoped `surface: engine`, `requires: git` |
| `skills/qa-engine/SKILL.md` (+ `references/preconditions.md`) | the `/wf-browser-qa:qa-engine` browser-automation engine and its browser-level precondition recipes |
| `agents/qa-engine.md` | the `wf-browser-qa:qa-engine` subagent companion — the provider's dispatch target (inherits the full session catalog, including browser-automation MCP tools) |
| `/wf-browser-qa:init` | one-command self-registration — records this pack's install root and registers the `browser-qa` capability, mirroring `/wf-git:init` |

## Registering wf-browser-qa downstream

**One command (recommended): `/wf-browser-qa:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-browser-qa:init` — it records this pack's install root in a gitignored
`## Plugin Roots` mapping and registers the `browser-qa` capability as a **plugin-anchored**
row (`plugin:wf-browser-qa/capabilities/browser-qa`). Core then resolves the `qa-execution`
engine provider through that mapping — no vendored `plugins/wf-browser-qa/...` needed in the
consuming repo. Re-run after a pack upgrade to refresh the install root; it is idempotent.

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo, add a
repo-relative row to the project's `_local/config.md` `## Capabilities` table by hand
(forward slashes):

```markdown
## Capabilities

| Capability | Path                                          |
|------------|-----------------------------------------------|
| browser-qa | plugins/wf-browser-qa/capabilities/browser-qa |
```

With `browser-qa` registered, core's `/wf:qa-auto` resolves the `qa-execution` provider
owning `surface: engine` and dispatches the per-scenario browser drive to
`/wf-browser-qa:qa-engine`. With no engine provider registered, `/wf:qa-auto` stops with a
clear "no qa-execution engine registered" message rather than faking a run.

## Prerequisites

The `browser-qa` capability declares `requires: git` — it assumes a `delivery` provider
(`git`) is registered so branch/commit/PR operations resolve. It is **tracker-agnostic**:
it names no work-item tracker, so a consumer on any tracker (or none) can register it.
Install and run `/wf-git:init` so `git` is registered first; otherwise `validate-registry.sh`
CHECK 7 fails, naming the capability, the missing `git` capability, and the remedy.

`surface: engine` **composes with** other `qa-execution` surfaces (e.g. a stack capability's
`surface: host`) — different surfaces, no partition collision: the engine drives the browser,
the host scaffolds the runnable surface.
