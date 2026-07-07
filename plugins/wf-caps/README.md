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
| `/wf-caps:qa-engine` | browser-qa | stack-agnostic browser-automation QA engine — the `qa-execution` provider core's `/wf:qa-auto` dispatches to |
| `/wf-caps:qa-host` | angular | routed Angular test-host scaffolder (+ ephemeral backend-controller analog) — the `qa-execution` `surface: host` provider |
| `/wf-caps:test-page` | angular | browser-run black-box DI-level tests injected into the Angular sandbox page |
| `/wf-caps:test-node` | node-ts | Node unit-test harness for pure TS helpers (no Angular runtime) |

> **Status — staged build.** This pack is populated one slice per PR (migration → browser-qa →
> the Angular/Node-TS stack cluster). Later, this single pack will be **fragmented** into proper
> per-capability packs. See `CLAUDE.md` and `docs/ROADMAP.md`.

## Capabilities

| Capability | Kind | Path | Attaches | Provides |
|---|---|---|---|---|
| migration | adapter | `plugins/wf-caps/capabilities/migration` | `tasks` task-list; `verify` findings; `qa-generation` scenarios | phase fragments (the `/wf-caps:migration-map` skill ships natively) |
| audit | adapter | `plugins/wf-caps/capabilities/audit` | `verify` findings — five adversarial lenses (correctness, security, convention, consistency, operational) | phase fragments + five read-only auditor agents (`wf-caps:correctness-auditor`, `-security-`, `-convention-`, `-consistency-`, `-operational-auditor`). Dependency-free — no `requires:`, so it composes in bare-core too. A profile `lenses` knob selects the subset that runs |
| browser-qa | feature | `plugins/wf-caps/capabilities/browser-qa` | `qa-execution` provider (`surface: engine`) | the `/wf-caps:qa-engine` browser-automation engine, dispatched by core's `/wf:qa-auto` |
| angular | feature | `plugins/wf-caps/capabilities/angular` | `qa-execution` provider (`surface: host`) | the `/wf-caps:qa-host` + `/wf-caps:test-page` Angular test-host skills; ships a `profile-template:` (web-root, routing-module, test-host-root, verify-command) seeded downstream on divergence |
| node-ts | feature | `plugins/wf-caps/capabilities/node-ts` | — (skills-only; no phase fragments) | the `/wf-caps:test-node` pure-helper Node test harness |

### Prerequisites

Every capability this pack ships **except `audit`** declares `requires: git, ado` — each
assumes a `delivery` provider and a `tracker` provider are already active in the registry.
Install and run `/wf-git:init` and `/wf-ado:init` (either order, before or alongside
`/wf-caps:init`) so `git` and `ado` are registered first; otherwise `validate-registry.sh`
CHECK 7 fails, naming the wf-caps capability, the missing capability, and the remedy. The
`audit` capability declares **no `requires:`** — its five lenses are pure read-only
reasoning and reach no provider, so it also composes in bare-core mode (no provider
registered).

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

| Capability | Path                                    |
|------------|-----------------------------------------|
| browser-qa | plugins/wf-caps/capabilities/browser-qa |
```

With `browser-qa` registered, core's `/wf:qa-auto` resolves the `qa-execution` provider
owning `surface: engine` and dispatches the per-scenario browser drive to `/wf-caps:qa-engine`.
With no engine provider registered, `/wf:qa-auto` stops with a clear "no qa-execution engine
registered" message rather than faking a run. (No `_local/config.md` lives in this plugin
repo — registration is a downstream step; this repo only ships the capability + docs.)

The `angular` and `node-ts` stack capabilities register the same way (each on its own
repo-relative path row). `angular` owns the `qa-execution` `surface: host` — it **composes
with** `browser-qa`'s `surface: engine` (different surfaces, no partition collision): the
engine drives the browser, the host scaffolds the runnable surface. Registering `angular`
also seeds an `_local/profiles/angular.profile.json` override on `init` **when the project
diverges** from the capability's default `profile.template.json` (the four Angular stack paths
— web-root, routing-module, test-host-root, verify-command); `qa-host`/`test-page` read those
paths from the profile, so a different Angular project retargets them without editing the
skills. `node-ts` is skills-only — it attaches no phase fragment and ships no profile.

## How it composes

Capability behaviour (phase fragments) attaches to `wf` core's SDD phases through the
**capability registry** — core iterates the registry, reads each capability's `manifest.md`,
and injects its fragments (or dispatches its providers) at runtime. The skills here compose
**natively** (install the plugin -> the `/wf-caps:*` commands are discoverable). The two
mechanisms stay separate.
