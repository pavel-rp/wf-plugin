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
path) are plain `## Fake` config-section keys with **working defaults** — not a profile slot, and
not questions. Per the contract's seeding convention, a capability that declares no
`profile-template:` seeds nothing.

A pack whose fixture-tunable value had **no** working default would take the other route: declare
it as an `ask[]` entry on a `profile.template.json`, so the canonical `/wf:init` question round
asks it once and the canonical apply persists it. fake needs neither, because both defaults work.

## Config the fixture sets

Since WF-462 the init skill writes **nothing** — it is a compatibility alias over the canonical
lifecycle. The `## Fake` section is fixture-owned, and both keys have working defaults the
fragments fall back to when the section is absent:

```markdown
## Fake

| Key | Value |
|-----|-------|
| **Fake Scripts** | `_local/fake/scripts.json` |
| **Fake Op Log**  | `_local/fake/op-log.jsonl` |
```

Both default to fixture-local paths; a fixture author writes the section only to relocate the
files. The scripts/op-log format is `scripts-format.md`.

## Downstream registration

Run `/wf-fake:init` inside a **fixture** project — it is a compatibility alias that invokes
`/wf:init` with `wf-fake` seeded into the selection round. The canonical lifecycle then does
everything: it scaffolds the bare core if needed, discovers packs, asks any unresolved questions
once, shows one delta, takes one confirmation, and registers the `fake` capability as a
plugin-anchored row (`plugin:wf-fake/capabilities/fake`) — recording this pack's install root in
the gitignored `## Plugin Roots` mapping — through its single `apply_install`. The alias itself
decides nothing and writes nothing.

Entering through the alias is **additive**: a fixture that already has other packs set up keeps
every one of them and gains `wf-fake`. Re-running over a settled fixture reports no drift and makes
no mutation call at all. Never register fake in a non-fixture project.

## Version history

- **WF-344** — initial hermetic in-memory dual-surface (delivery + tracker) provider capability
  (OUT-1 of charter C016).
- **WF-462** — `/wf-fake:init` became the reference compatibility alias over the canonical
  `/wf:init` lifecycle: seed only, no registration call of its own, no config write, canonical
  `INIT — <status>` terminal block.
