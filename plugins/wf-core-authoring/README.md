# wf-core-authoring — authoring the core plugin itself

Carries the knowledge for authoring the **wf core plugin** — its domain-free skill spine, the frozen
contracts it ships, and the repository authoring rules its CI gates enforce. `wf-author-caps` teaches
how to author a *pack*; this pack is about the *core*. Neither is about a downstream stack or domain.

**Model:** claude-opus-5[1m]

## What ships today

The registration path landed first, on purpose, before the content that depends on it. Contract
authoring is the first piece of content on top of it.

| Path | What it is |
|---|---|
| `skills/init/SKILL.md` | `/wf-core-authoring:init` — one-command self-registration of the `core-authoring` capability. |
| `skills/new-contract/SKILL.md` | `/wf-core-authoring:new-contract` — scaffolds a matched core contract pair (a bounded runtime-ops half plus its paired reference half) and proves it green under the repository's contract-shape guard before handing it back. |
| `capabilities/core-authoring/manifest.md` | The schema-v2 manifest. `kind: both`, a documentation-only `skills:` block, zero-row Fragments table, no `requires:`, no `conflicts:`, no `profile-template:`. |
| `.claude-plugin/plugin.json` | The plugin manifest. |

No scaffolder for a core skill and no ownership of a repository lint yet. Each arrives as its own
change; a change that attaches a phase fragment lands its fragments row alongside the file that row
names.

## Install and register

Install the plugin from the marketplace, then — once, after `/wf:init`:

```
/wf-core-authoring:init
```

The skill self-registers through the resolver's typed `inspect_pack` / `register_pack` tools. It is
**idempotent**: re-run it any time — a second run rewrites the same single registry row and
self-checks the wiring. It never hand-edits the registry and never probes an install root.

Two loud failure paths, both of which write nothing:

- **The project is not wf-initialized** (no resolved config / no registry file) — the skill stops and
  directs you to `/wf:init` first. It registers *into* the registry `/wf:init` creates; it does not
  create one.
- **The plugin is not installed or is disabled** — `inspect_pack` reports it, and `register_pack` is
  never called.

## Registration is the scoping mechanism

`core-authoring` is for **this repository — the wf marketplace repo — and never an end-user
project.** Nothing in core enforces that boundary, and nothing needs to: an unregistered capability
contributes nothing. Registering the capability in a product repository would attach wf-authoring
guidance to that project's phases, where it is noise. Install the plugin wherever you like; register
it only where you author `wf` itself.

Registration is also only needed for the capability's **phase contributions**. The skills above reach
you by native plugin composition the moment the plugin is installed — no registry row is involved. A
project that never registers behaves exactly as it did before the plugin existed, and no authoring
term surfaces in any core phase.

## Registration does not travel

The registry lives in `_local/config.md`, which is **gitignored**. It is per-checkout machine state,
not a tracked file — so it does not travel with a clone, a fresh worktree, or a CI job. The
`## Plugin Roots` map written alongside the capability row is per-machine for the same reason: it
records absolute install paths.

Practical consequence: **a new worktree of this repo starts unregistered.** Run `/wf:init` and then
`/wf-core-authoring:init` in each one before expecting the capability to resolve. A resolver query
that reports the capability missing in a fresh checkout is correct behavior, not a broken install.

## The capability

`core-authoring` is declared **`kind: both`** — it ships its own skills *and* is authored to attach
phase fragments as its content lands. `adapter` is not available to it: a pack always ships an init
skill, so a fragments-only kind cannot describe it.

Its Fragments table is deliberately zero-row. Registry validation tolerates that, and the capability
still registers with `validity: ok` — which is the point of registering now. It owns no provider
surface, so it partitions against nothing and cannot collide with a registered `tracker`, `delivery`,
`engine`, or `host` owner.
