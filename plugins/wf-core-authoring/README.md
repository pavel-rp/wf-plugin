# wf-core-authoring — authoring the core plugin itself

Carries the knowledge for authoring the **wf core plugin** — its domain-free skill spine, the frozen
contracts it ships, and the repository authoring rules its CI gates enforce. `wf-author-caps` teaches
how to author a *pack*; this pack is about the *core*. Neither is about a downstream stack or domain.

**Model:** claude-opus-5[1m]

## What ships today

The registration path landed first, on purpose, before the content that depends on it. Contract
authoring and the repository's craft-C4 authoring lint are the content on top of it.

| Path | What it is |
|---|---|
| `skills/init/SKILL.md` | `/wf-core-authoring:init` — one-command self-registration of the `core-authoring` capability. |
| `skills/new-contract/SKILL.md` | `/wf-core-authoring:new-contract` — scaffolds a matched core contract pair (a bounded runtime-ops half plus its paired reference half) and proves it green under the repository's contract-shape guard before handing it back. |
| `capabilities/core-authoring/manifest.md` | The schema-v2 manifest. `kind: both`, a documentation-only `skills:` block, one `slot` fragments row, no `requires:`, no `conflicts:`, no `profile-template:`. |
| `capabilities/core-authoring/fragments/new-skill-constraints.md` | The fill for `/wf-author-caps:new-skill`'s declared `new-skill.constraints` point (`append`). Carries this repository's core-only rules — core purity, the body budget, the terminal `Next:` line, attribution without promotion, and the release version pair — each cited to the section of `CLAUDE.md` that owns it, plus the two validators it adds to the scaffolder's check set. |
| `capabilities/core-authoring/fixtures/run.sh` | The capability's fixture suite. CI discovers it by the `plugins/*/capabilities/*/fixtures/run.sh` convention — adding a check needs no workflow edit. |
| `capabilities/core-authoring/fixtures/check-skill-*.sh` | The craft-C4 checks over every `SKILL.md`: `name` (≤64 chars, matches its directory), `description` (≤1024 chars, third-person "what", `Use ...` "when"), and body length (under 500 lines). Each ships a `--selftest` that drives seeded fixtures, so a green live run means the tree is clean rather than the check being inert. |
| `capabilities/core-authoring/fixtures/craft-fixtures/` | The seeded pass/fail fixtures those selftests drive. Excluded from the live target set by shape, not by path. |
| `.claude-plugin/plugin.json` | The plugin manifest. |

The lint is **pack-carried scripts, not a phase contribution** — it asserts authoring rules over this
repository's own files and reaches no core phase, so it carries no fragments row. The `slot` fill does
carry one: a slot targets a per-skill composition point rather than an SDD phase, so its phase cell is
`—` and its scope is the `<skill>.<point> <merge-policy>` compound. Every row lands in the same change
as the file it names.

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

Its Fragments table carries exactly one row — the `new-skill.constraints` `slot` fill, at merge policy
`append`. Two `append` claims on one point compose rather than conflict, so the row partitions against
nothing. It owns no provider surface either, so it cannot collide with a registered `tracker`,
`delivery`, `engine`, or `host` owner. Unregistered, the row is never reached: the point resolves
`unfilled`, the scaffolder runs its own inline default, and no term of this capability surfaces.
