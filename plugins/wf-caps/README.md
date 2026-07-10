# wf-caps — default-capabilities pack

The non-core, stack/domain-specific half of the `wf` workflow, shipped as a separate
plugin so the **core** `wf` plugin can stay domain-free (per [`CLAUDE.md`](../../CLAUDE.md) §2).

`wf` core ships the SDD spine + the composition wiring; `wf-caps` ships the capabilities
that attach to it. Both are hosted by the same private marketplace
([`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json)) — this repo is
the multi-plugin training ground for the v2 capability/pack model.

## What lives here

Skills extracted from `wf` core because they carry concrete stack/domain knowledge:

**Ships today:**

| Skill | Capability | What it is |
|---|---|---|
| `/wf-caps:init` | (pack) | one-command onboarding — registers the pack's capabilities into the downstream `## Capabilities` registry and records the pack's install root in `## Plugin Roots`, so core resolves them on a plugin-only install (no hand-edited `_local/config.md`) |
| `/wf-caps:migration-map` | migration | 1:1 C#/MVC -> Angular/TS mapping table |
| `/wf-caps:qa-host` | angular | routed Angular test-host scaffolder (+ ephemeral backend-controller analog) — the `qa-execution` `surface: host` provider |
| `/wf-caps:test-page` | angular | browser-run black-box DI-level tests injected into the Angular sandbox page |

> **Status — staged build.** This pack was populated one slice per PR (migration → browser-qa →
> the Angular/Node-TS stack cluster) and is now being **fragmented** into proper per-capability
> packs: `browser-qa` was extracted into the standalone [`wf-browser-qa`](../wf-browser-qa/)
> plugin (WF-255), `node-ts` into the standalone [`wf-node-ts`](../wf-node-ts/) plugin
> (WF-256), and `audit`+`sr` into the standalone [`wf-audit`](../wf-audit/) plugin (WF-257).
> See `CLAUDE.md` and `docs/ROADMAP.md`.

## Capabilities

| Capability | Kind | Path | Attaches | Provides |
|---|---|---|---|---|
| migration | adapter | `plugins/wf-caps/capabilities/migration` | `tasks` task-list; `verify` findings; `qa-generation` scenarios | phase fragments (the `/wf-caps:migration-map` skill ships natively) |
| angular | feature | `plugins/wf-caps/capabilities/angular` | `qa-execution` provider (`surface: host`) | the `/wf-caps:qa-host` + `/wf-caps:test-page` Angular test-host skills; ships a `profile-template:` (web-root, routing-module, test-host-root, verify-command) seeded downstream on divergence |

### Prerequisites

Every capability this pack ships declares `requires: git, ado` — each assumes a `delivery`
provider and a `tracker` provider are already active in the registry. Install and run
`/wf-git:init` and `/wf-ado:init` (either order, before or alongside `/wf-caps:init`) so
`git` and `ado` are registered first; otherwise `validate-registry.sh` CHECK 7 fails, naming
the wf-caps capability, the missing capability, and the remedy. (The dependency-free `audit`
and `sr` capabilities — pure read-only reasoning that reaches no provider and composes in
bare-core mode — now ship in the standalone [`wf-audit`](../wf-audit/) plugin.)

### Registering a capability downstream

**One command (recommended): `/wf-caps:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-caps:init` — it registers every capability the pack ships (or a subset you
name) as **plugin-anchored** rows (`plugin:wf-caps/capabilities/<name>`), records the
pack's install root in a gitignored `## Plugin Roots` mapping, and seeds each capability's
profile. Core resolves those rows through the mapping, so this works on a **plugin-only
install** where the consuming repo does **not** vendor `plugins/wf-caps/...`. Re-run after a
pack upgrade to refresh the install root; it is idempotent. See
`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots` mapping".

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo, you can
instead add a repo-relative row to the project's `_local/config.md` `## Capabilities` table
by hand (forward slashes):

```markdown
## Capabilities

| Capability | Path                                 |
|------------|--------------------------------------|
| angular    | plugins/wf-caps/capabilities/angular |
```

With `angular` registered, core resolves its `qa-execution` `surface: host` provider when a
runnable Angular test host is scaffolded. (No `_local/config.md` lives in this plugin repo —
registration is a downstream step; this repo only ships the capability + docs.) The
stack-agnostic browser-automation **engine** (`surface: engine`) is no longer part of this
pack — it ships in the standalone [`wf-browser-qa`](../wf-browser-qa/) plugin (WF-255); core's
`/wf:qa-auto` dispatches the per-scenario browser drive to that engine.

`angular` owns the `qa-execution` `surface: host` — it **composes with** the `browser-qa`
engine's `surface: engine` (now shipped by the standalone [`wf-browser-qa`](../wf-browser-qa/)
plugin — different surfaces, no partition collision): the engine drives the browser, the host
scaffolds the runnable surface. Registering `angular` also seeds an
`_local/profiles/angular.profile.json` override on `init` **when the project diverges** from
the capability's default `profile.template.json` (the four Angular stack paths — web-root,
routing-module, test-host-root, verify-command); `qa-host`/`test-page` read those paths from
the profile, so a different Angular project retargets them without editing the skills. The
Node/TS pure-helper test harness (`node-ts`: one `implement | guidance` fragment, test-authoring
idioms) is no longer part of this pack — it ships in the standalone
[`wf-node-ts`](../wf-node-ts/) plugin (WF-256).

## How it composes

Capability behaviour (phase fragments) attaches to `wf` core's SDD phases through the
**capability registry** — core iterates the registry, reads each capability's `manifest.md`,
and injects its fragments (or dispatches its providers) at runtime. The skills here compose
**natively** (install the plugin -> the `/wf-caps:*` commands are discoverable). The two
mechanisms stay separate.
