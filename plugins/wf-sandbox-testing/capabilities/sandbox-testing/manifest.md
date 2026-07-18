# sandbox-testing capability manifest

**Version:** 0.1.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2"
**Capability:** sandbox-testing (a native feature capability; **registration is required** — see references)
**Kind:** feature (ships the skill-eval harness scripts and `/wf-sandbox-testing:init`; attaches **no** SDD phase fragment)
**Model:** claude-opus-4-8

---

sandbox-testing ships the **skill-eval harness** — the hermetic container runner
(`runner/`), the statistical assertion layer (`assert/`), the behavioral-regression corpus
(`corpus/`), and the fixtures (`fixtures/`) — plus one **user-invoked** onboarding skill,
`/wf-sandbox-testing:init`. Everything reaches its user by **native plugin composition**: the
harness is repo scripts in the `validate-registry.sh` / `registry-fixtures/run.sh` family, run
directly, and the runner drives real headless `wf:*` invocations.

It owns **no** provider surface and contributes **no** phase fragment — it does not touch the
`spec → plan → tasks → implement → verify → qa` spine. Registering it is a **presence-only**
declaration: it adds one `## Capabilities` row so registry validation acknowledges the pack and a
downstream project can record that the harness is active, exactly as `pr-review` registered ahead
of its first contribution fragment. With the row present or absent, no capability-aware phase
changes — the harness is invoked as scripts, never fired by a phase.

## Fragments

**None.** sandbox-testing declares an empty fragments table — it is a feature pack whose value is
its own scripts and skill, not a contribution to any SDD phase. Registry validation accepts a
capability with zero fragment rows (the `pr-review`-before-its-slot precedent).

| phase | contribution-kind | dispatch | scope |
|-------|-------------------|----------|-------|
| —     | —                 | —        | —     |

## The wf-fake pairing (why no `requires:`)

Downstream fixtures that **script a provider** — the delivery/tracker responses a `wf:*` run
drives against — do so through the **wf-fake** pack (the hermetic in-memory provider). The corpus
items shipped in this repository (`corpus/items/review-gate`, `contribution-survival`,
`model-swap-drift`, `orphaned-override`) all drive wf-fake's scripted threads.

This manifest declares **no `requires: fake`**, a deliberate spec-time decision, because wf-fake is
**fixture-only**: it owns both the `delivery` and `tracker` surfaces and co-registering it beside a
real provider (`git`/`linear`/`ado`) correctly trips the registry's partitioned-ownership overlap
validation. A real downstream project registering sandbox-testing must **not** be forced to register
fake into its live registry. The dependency is therefore **per-fixture and enforced at run time**,
not at the registry level: the runner (`runner/run-skill.sh`) clean-installs `wf-fake` alongside
`wf` and **fails loudly, naming wf-fake**, if the install produced no `capabilities/fake/manifest.md`
— never a silent scenario skip or a half-run reported as a verdict. The install pairing is
documented in the pack README and the findings-loop procedure. See
[`references/onboarding.md`](references/onboarding.md) for the full rationale, the harness layout,
and downstream registration — read by `init` and authors, never at phase-fire.
