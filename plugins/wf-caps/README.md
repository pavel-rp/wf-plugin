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
| `/wf-caps:migration-map` | migration | 1:1 C#/MVC -> Angular/TS mapping table |
| `/wf-caps:qa-engine` | browser-qa | stack-agnostic browser-automation QA engine — the `qa-execution` provider core's `/wf:qa-auto` dispatches to |

**Planned** — still in `wf` core until extracted (WF-26):

| Skill | Capability | What it will be |
|---|---|---|
| `qa-host` | stack (Angular) | QA test-host scaffolding |
| `test-page` | stack (Angular) | Angular runtime test page scaffolding |
| `test-node` | stack (Node/TS) | Node unit-test host for pure helpers |

> **Status — staged build.** This pack is being populated one slice per PR (migration first,
> then the QA cluster). Until a skill's slice lands, its command still lives in `wf` core.
> Later, this single pack will be **fragmented** into proper per-capability packs (migration,
> browser-qa, the Angular stack). See `CLAUDE.md` and `docs/ROADMAP.md`.

## Capabilities

| Capability | Kind | Path | Attaches | Provides |
|---|---|---|---|---|
| migration | adapter | `plugins/wf-caps/capabilities/migration` | `tasks` task-list; `verify` findings; `qa-generation` scenarios | phase fragments (the `/wf-caps:migration-map` skill ships natively) |
| browser-qa | feature | `plugins/wf-caps/capabilities/browser-qa` | `qa-execution` provider (`surface: engine`) | the `/wf-caps:qa-engine` browser-automation engine, dispatched by core's `/wf:qa-auto` |

### Registering a capability downstream

To activate a capability in a consuming project, add a row to that project's
`_local/config.md` `## Capabilities` table — the path is repo-relative (forward slashes):

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

## How it composes

Capability behaviour (phase fragments) attaches to `wf` core's SDD phases through the
**capability registry** — core iterates the registry, reads each capability's `manifest.md`,
and injects its fragments (or dispatches its providers) at runtime. The skills here compose
**natively** (install the plugin -> the `/wf-caps:*` commands are discoverable). The two
mechanisms stay separate.
