# fake capability — onboarding & authoring reference

Rationale, resolution semantics, registration, and version history for the fake capability. **Never
read at phase-fire** — a core skill resolving the `delivery` or `tracker` surface reads only
`../fragments/delivery.ops.md` / `../fragments/tracker.ops.md`. This file is for `/wf-fake:init` and
for authors.

## What this manifest is

The fake capability's **fragments manifest** (`../manifest.md`) is the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which fragments this
capability attaches to which SDD phases. fake attaches **two** `provider` rows — one scoped
`delivery` (anchor phase `implement`), one scoped `tracker` (anchor phase `spec`) — so one
capability owns **both** provider surfaces. Different surfaces compose within a single capability;
the anchor phases are registration-only (direct provider resolution reaches either fragment at any
point).

## Fixture-only registration — the overlap check is a feature

fake is registered **only inside fixture registries**, where it is the **sole owner of both
surfaces**. Registering it in a real project alongside `git` (delivery) or `linear`/`ado` (tracker)
correctly trips the registry's partitioned-ownership overlap validation — two capabilities claiming
one surface — which fails naming both offenders. That is the contract working as designed (success
criterion 4), not a bug to route around. A fixture is just a project whose `_local/config.md`
`## Capabilities` table lists `fake` and nothing else on these two surfaces.

## Skills (native composition)

As a `both` capability, fake ships its own skill natively (install the plugin → the `/wf-fake:init`
command is discoverable) **and** attaches the two fragments above via the registry. Documented for
reference:

```
skills:
  - plugins/wf-fake/skills/init/   # /wf-fake:init — self-registering onboarding (the sibling packs' /init pattern)
```

## Profile seed template

This capability ships **no** `profile-template:`. The fixture-tunable values (scripts path, op-log
path) are plain `## Fake` config-section keys `/wf-fake:init` writes, with working defaults — not a
profile slot. Per the contract's seeding convention, a capability that declares no
`profile-template:` seeds nothing.

## Config the init skill writes

`/wf-fake:init` writes a `## Fake` section to `_local/config.md`:

```markdown
## Fake

| Key | Value |
|-----|-------|
| **Fake Scripts** | `_local/fake/scripts.json` |
| **Fake Op Log**  | `_local/fake/op-log.jsonl` |
```

Both default to fixture-local paths; a fixture author edits them only to relocate the files. The
scripts/op-log format is `scripts-format.md`.

## Downstream registration

Run `/wf-fake:init` inside a **fixture** project (after `/wf:init`) — it records this pack's install
root in the gitignored `## Plugin Roots` mapping and registers the `fake` capability as a
plugin-anchored row (`plugin:wf-fake/capabilities/fake`) via core's `inspect_pack`/`register_pack`
resolver tools, then writes the `## Fake` config section. Never register fake in a non-fixture
project.

## Version history

- **WF-344** — initial hermetic in-memory dual-surface (delivery + tracker) provider capability
  (OUT-1 of charter C016).
