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

> **Status — staged build.** This pack was populated one slice per PR and is now being
> **fragmented** into proper per-capability packs, leaving `migration` as the sole capability
> remaining here: `browser-qa` was extracted into the standalone
> [`wf-browser-qa`](../wf-browser-qa/) plugin (WF-255), `node-ts` into
> [`wf-node-ts`](../wf-node-ts/) (WF-256), `audit`+`sr` into [`wf-audit`](../wf-audit/)
> (WF-257), and the `angular` stack capability into [`wf-angular`](../wf-angular/) (WF-258).
> See `CLAUDE.md` and `docs/ROADMAP.md`.

## Capabilities

| Capability | Kind | Path | Attaches | Provides |
|---|---|---|---|---|
| migration | adapter | `plugins/wf-caps/capabilities/migration` | `tasks` task-list; `verify` findings; `qa-generation` scenarios | phase fragments (the `/wf-caps:migration-map` skill ships natively) |

### Prerequisites

The `migration` capability this pack ships declares `requires: git, ado` — it assumes a
`delivery` provider and a `tracker` provider are already active in the registry. Install and
run `/wf-git:init` and `/wf-ado:init` (either order, before or alongside `/wf-caps:init`) so
`git` and `ado` are registered first; otherwise `validate-registry.sh` CHECK 7 fails, naming
the wf-caps capability, the missing capability, and the remedy.

### Registering a capability downstream

**One command (recommended): `/wf-caps:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-caps:init` — it registers every capability the pack ships as
**plugin-anchored** rows (`plugin:wf-caps/capabilities/<name>`), records the pack's install
root in a gitignored `## Plugin Roots` mapping, and seeds each capability's profile. Core
resolves those rows through the mapping, so this works on a **plugin-only install** where the
consuming repo does **not** vendor `plugins/wf-caps/...`. Re-run after a pack upgrade to
refresh the install root; it is idempotent. See
`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots` mapping".

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo, you can
instead add a repo-relative row to the project's `_local/config.md` `## Capabilities` table
by hand (forward slashes):

```markdown
## Capabilities

| Capability | Path                                   |
|------------|----------------------------------------|
| migration  | plugins/wf-caps/capabilities/migration |
```

The Angular stack capability (`qa-host` + `test-page`, `qa-execution` `surface: host`) is no
longer part of this pack — it ships in the standalone [`wf-angular`](../wf-angular/) plugin
(WF-258), genericized so every scaffolded token is profile-slot-driven. The stack-agnostic
browser-automation **engine** (`surface: engine`) ships in [`wf-browser-qa`](../wf-browser-qa/)
(WF-255), and the Node/TS pure-helper test harness in [`wf-node-ts`](../wf-node-ts/) (WF-256).

## How it composes

Capability behaviour (phase fragments) attaches to `wf` core's SDD phases through the
**capability registry** — core iterates the registry, reads each capability's `manifest.md`,
and injects its fragments (or dispatches its providers) at runtime. The skills here compose
**natively** (install the plugin -> the `/wf-caps:*` commands are discoverable). The two
mechanisms stay separate.
