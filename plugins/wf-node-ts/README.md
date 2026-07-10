# wf-node-ts — the Node/TypeScript stack pack

A standalone marketplace plugin that ships the **`node-ts` capability**: a `feature`-kind
capability owning the wf capability-registry's **`implement`** `guidance` fragment for
**pure-helper Node/TypeScript unit-test authoring**. It supplies a dependency-free unit-test
harness (`test-node`) for pure TS helpers — parsers, formatters, coercion helpers — that need
no Angular runtime (no DI, zone.js, `HttpClient`, templates). It is a distinct stack from the
Angular surface: the Node runtime, not the browser/DI runtime.

## What ships

| Item | What it is |
|---|---|
| `capabilities/node-ts/manifest.md` | the `node-ts` capability's manifest — one `implement \| guidance` fragment row, `requires: git` |
| `capabilities/node-ts/fragments/test-authoring.md` | the test-authoring idioms guidance fragment |
| `skills/test-node/SKILL.md` | the `/wf-node-ts:test-node` Node unit-test harness for pure TS helpers, via the `_local/_testkit/run.mjs` runner |
| `/wf-node-ts:init` | one-command self-registration — records this pack's install root and registers the `node-ts` capability, mirroring `/wf-git:init` |

## Registering wf-node-ts downstream

**One command (recommended): `/wf-node-ts:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-node-ts:init` — it records this pack's install root in a gitignored
`## Plugin Roots` mapping and registers the `node-ts` capability as a **plugin-anchored**
row (`plugin:wf-node-ts/capabilities/node-ts`). Core then resolves the `implement`-guidance
fragment through that mapping — no vendored `plugins/wf-node-ts/...` needed in the
consuming repo. Re-run after a pack upgrade to refresh the install root; it is idempotent.

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo, add a
repo-relative row to the project's `_local/config.md` `## Capabilities` table by hand
(forward slashes):

```markdown
## Capabilities

| Capability | Path                                     |
|------------|-------------------------------------------|
| node-ts    | plugins/wf-node-ts/capabilities/node-ts  |
```

With `node-ts` registered, a core skill firing the `implement` phase aggregates its
test-authoring idioms in registry order when the change under review authors a pure-helper
unit test; unregistered, the fragment no-ops and such a consumer falls back to its own
discover-and-match default.

## Prerequisites

The `node-ts` capability declares `requires: git` — it assumes a `delivery` provider
(`git`) is registered so branch/commit/PR operations resolve. It is **tracker-agnostic**:
it names no work-item tracker, so a consumer on any tracker (or none) can register it.
Install and run `/wf-git:init` so `git` is registered first; otherwise `validate-registry.sh`
CHECK 7 fails, naming the capability, the missing `git` capability, and the remedy.
