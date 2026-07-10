# wf-angular — the Angular stack pack

A standalone marketplace plugin that ships the **`angular` capability**: a `feature`-kind
capability owning the wf capability-registry's **`qa-execution`** `provider` surface at
`surface: host`. It supplies the **Angular stack test-host surface** — a routed test-host
page scaffolder (`qa-host`) that gives an un-routed component a runnable URL (plus an
ephemeral backend-controller analog), and a DI-level black-box page-test harness
(`test-page`) that injects spec-derived tests into the stack's sandbox module-test page.

**Every project-specific token in the scaffolded output is profile-slot-driven** — the
web/test-host/routing paths, the routing-module class, the route prefix, the sandbox host
folder/component, and the route guards all come from the `angular` capability profile. So
scaffolding a test-host for a differently-named app emits **no borrowed identifiers**; the
capability is generic Angular stack support, not a single app's welded-in scaffolding.

## What ships

| Item | What it is |
|---|---|
| `capabilities/angular/manifest.md` (+ `profile.template.json`) | the `angular` capability's manifest — one `provider` fragment row scoped `surface: host`, `requires: git`; the profile template names every scaffolded token as a neutral placeholder slot |
| `skills/qa-host/SKILL.md` (+ `references/backend-host.md`) | the `/wf-angular:qa-host` routed test-host scaffolder and its ephemeral backend-controller analog |
| `skills/test-page/SKILL.md` (+ `references/{backend-smoke,bootstrap,component-injection,harness}.md`) | the `/wf-angular:test-page` browser-run black-box DI-level test harness |
| `agents/qa-host.md` | the `wf-angular:qa-host` subagent companion — the host provider's dispatch target (inherits the full session catalog, including `Write`/`Edit`/`Bash`) |
| `/wf-angular:init` | one-command self-registration — records this pack's install root, registers the `angular` capability, and seeds the profile override on divergence, mirroring `/wf-browser-qa:init` |

## Registering wf-angular downstream

**One command (recommended): `/wf-angular:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-angular:init` — it records this pack's install root in a gitignored
`## Plugin Roots` mapping, registers the `angular` capability as a **plugin-anchored** row
(`plugin:wf-angular/capabilities/angular`), and seeds `_local/profiles/angular.profile.json`
on divergence from the shipped default template. Core then resolves the `qa-execution` host
provider through that mapping — no vendored `plugins/wf-angular/...` needed in the consuming
repo. Re-run after a pack upgrade to refresh the install root; it is idempotent.

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo, add a
repo-relative row to the project's `_local/config.md` `## Capabilities` table by hand
(forward slashes):

```markdown
## Capabilities

| Capability | Path                                 |
|------------|--------------------------------------|
| angular    | plugins/wf-angular/capabilities/angular |
```

With `angular` registered, core's `/wf:qa-auto` resolves the `qa-execution` provider owning
`surface: host` and dispatches test-host scaffolding to `/wf-angular:qa-host`. Fill the
profile slots in `_local/profiles/angular.profile.json` before the first scaffold.

## Prerequisites

The `angular` capability declares `requires: git` — it assumes a `delivery` provider (`git`)
is registered so branch/commit/index operations resolve. It is **tracker-agnostic**: it
names no work-item tracker, so a consumer on any tracker (or none) can register it. Install
and run `/wf-git:init` so `git` is registered first; otherwise `validate-registry.sh` CHECK 7
fails, naming the capability, the missing `git` capability, and the remedy.

`surface: host` **composes with** other `qa-execution` surfaces (e.g. browser-qa's
`surface: engine`) — different surfaces, no partition collision: the host scaffolds the
runnable surface, the engine drives the browser.
