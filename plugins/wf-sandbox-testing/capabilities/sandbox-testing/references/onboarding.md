# sandbox-testing capability — onboarding & authoring reference

Rationale, registration semantics, harness layout, and version history for the sandbox-testing
capability. **Never read at phase-fire** — the capability attaches no phase fragment, so no core
skill ever reads this at runtime. This file is for `/wf-sandbox-testing:init` and for authors.

## What this manifest is

The capability's `../manifest.md` is the file core reads at `<path>/manifest.md` when iterating the
`## Capabilities` registry. sandbox-testing declares an **empty fragments table**: it contributes to
no SDD phase. Its registry row is a **presence-only** declaration — it lets registry validation
acknowledge the pack and lets a downstream project record that the harness is active. The
`pr-review` capability registered the same way before its first contribution fragment landed; the
registry accepts a capability with zero fragment rows.

## Why register at all

Registration is required by the C016 packaging deliverable (WF-349): a downstream wf-initialized
repo installs the pack from the marketplace and, in one `init` command, records it in the registry so
`/wf:resolve` and registry validation see it. It carries no runtime behaviour change — the harness is
invoked as scripts (`assert/tiers.sh`, `corpus/run.sh`, `runner/run-skill.sh`), never fired by a
phase — but the row makes the pack a first-class, validated member of the project's capability set
rather than untracked repo furniture.

## The harness layout (native composition)

Installing the plugin makes every harness script and the `/wf-sandbox-testing:init` skill available
by native composition. The pieces:

```
runner/    the WF-345 hermetic container runner — one real headless wf:* invocation per run,
           fingerprinting every input, asserting stream-json parseability, guarding auth/billing
assert/    the WF-346 statistical assertion layer — three structural families judged over N runs,
           variance-aware (drift vs regression), SMOKE/STATISTICAL tiers, baseline comparison
corpus/    the WF-347/WF-348 behavioral-regression corpus — items mined retrofit-first from
           observed failures, each with a resolvable provenance link
fixtures/  the seed scripts that materialize a throwaway wf workspace for a run
skills/    /wf-sandbox-testing:init — self-registering onboarding (the sibling packs' /init pattern)
```

Documented for reference:

```
skills:
  - plugins/wf-sandbox-testing/skills/init/   # /wf-sandbox-testing:init — self-registration
```

## The wf-fake pairing — per fixture, enforced at run time (no `requires:`)

Downstream fixtures that script a provider drive the **wf-fake** hermetic in-memory provider. This
manifest declares **no `requires: fake`** on purpose:

- wf-fake is **fixture-only** — it owns both the `delivery` and `tracker` surfaces, so registering it
  beside a real provider (`git`/`linear`/`ado`) correctly trips the registry's partitioned-ownership
  overlap validation. A real project registering sandbox-testing must not be forced to register fake
  into its live registry.
- The dependency is **per-fixture**: a fixture using real providers needs no wf-fake at all.
- It is **enforced at run time, loudly**: `runner/run-skill.sh` clean-installs `wf-fake` alongside
  `wf` and, if the install produced no `capabilities/fake/manifest.md`, exits non-zero naming wf-fake
  (`clean install produced no wf-fake capabilities/fake/manifest.md`) — never a silent skip, never a
  half-run recorded as a passing verdict (WF-349 success criterion 6).

So the pairing is an **install-time pairing documented for the fixture author**, not a registry
`requires:` edge: install and register wf-fake in any fixture project whose fixtures script a
provider. The pack README and `docs/retrofit-procedure.md` state this.

## Profile seed template

This capability ships **no** `profile-template:`. The harness's tunable values (the per-tier model
and run count) live in `assert/tiers.settings.json` with an override precedence the harness resolves
itself (env → `WF_ASSERT_SETTINGS_OVERRIDE` → `_local/wf-sandbox-testing/tiers.settings.json` →
committed default). Per the contract's seeding convention, a capability that declares no
`profile-template:` seeds nothing; `/wf-sandbox-testing:init`'s Final Output `Profile:` row is always
`skipped — no template`.

## Downstream registration

Run `/wf-sandbox-testing:init` inside a wf-initialized project (after `/wf:init`) — it records this
pack's install root in the gitignored `## Plugin Roots` mapping and registers the `sandbox-testing`
capability as a plugin-anchored row (`plugin:wf-sandbox-testing/capabilities/sandbox-testing`) via
core's `inspect_pack`/`register_pack` resolver tools. It never probes `${CLAUDE_PLUGIN_ROOT}` and
never hand-edits the registry. If the project is not wf-initialized, `init` stops and directs the
user to `/wf:init` — it never registers into a half-configured repo (success criterion 5).

## Version history

- **WF-349** — packaged the WF-345/346/347/348 harness as a marketplace-listed plugin: plugin
  manifest, this feature-capability manifest, the self-registering `/wf-sandbox-testing:init` skill,
  the marketplace listing, the pack README, and the findings-loop procedure doc (charter C016 /
  WF-343, OUT-7/OUT-8).
