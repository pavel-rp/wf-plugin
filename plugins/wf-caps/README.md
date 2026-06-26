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

**Planned** — still in `wf` core until extracted (WF-25 / WF-26):

| Skill | Capability | What it will be |
|---|---|---|
| `qa-auto` | browser-qa | autonomous browser-driving QA engine |
| `qa-host` | stack (Angular) | QA test-host scaffolding |
| `test-page` | stack (Angular) | Angular runtime test page scaffolding |
| `test-node` | stack (Node/TS) | Node unit-test host for pure helpers |

> **Status — staged build.** This pack is being populated one slice per PR (migration first,
> then the QA cluster). Until a skill's slice lands, its command still lives in `wf` core.
> Later, this single pack will be **fragmented** into proper per-capability packs (migration,
> browser-qa, the Angular stack). See `CLAUDE.md` and `docs/ROADMAP.md`.

## How it composes

Capability behaviour (phase fragments) attaches to `wf` core's SDD phases through the
**capability registry** — core iterates the registry, reads each capability's `manifest.md`,
and injects its fragments at runtime. The skills here compose **natively** (install the
plugin -> the `/wf-caps:*` commands are discoverable). The two mechanisms stay separate.
