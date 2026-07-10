# Self-review (sr) capability manifest

**Version:** 1.0.0 (WF-160 — the pre-commit adversarial self-review lens)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.contract.md`
**Capability:** sr (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** adapter (attaches one phase fragment via the registry; ships no skills of its own)
**Model:** claude-opus-4-8

---

This is the self-review capability's **fragments manifest** — the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which fragment
this capability attaches to which SDD phase. Core resolves `<path>` from the registry row; it
does not hardcode this path.

The capability contributes **one adversarial `finding` fragment** at the `pre-commit` phase —
the operation-time commit-path self-review seam WF-154 defined (`capability-registry.ops.md`
§"The pre-commit self-review seam"). The commit agent, immediately before it records a commit
and only when a real change is pending, fires the `pre-commit` phase: it walks the registry,
collects every `finding` fragment attached at `pre-commit`, and dispatches each — with no lens
named in core. Registered → this fragment inspects the staged change set the seam passes it and
returns findings that **gate** (block the commit) or **annotate** (let it proceed), on the same
generic `finding` footing as any other contributor. Unregistered → the `pre-commit` phase finds
no rows and produces its empty result: the commit proceeds **byte-identically to a core with no
seam** (WF-154 already guarantees this — this capability only fills the seam). Registry
membership is the whole on/off toggle; the capability adds no core machinery.

The lens is the **lightweight pre-commit counterpart** to the audit capability's thorough
`verify`-phase lenses: it applies the **same** owned adversarial-correctness discipline in a
faster form over the *uncommitted* working diff, so a systematic-miss bug is caught before it
lands rather than only at `verify`. It **reuses** the audit capability's owned
adversarial-correctness rubric (`plugins/wf-audit/capabilities/audit/fragments/correctness.md`) —
the single owned copy — and **never re-authors a second correctness rubric**; the two
capabilities are single-sourced against that one rubric so they cannot diverge.

## Article

article: precommit-self-review = required

The capability's one non-negotiable, contributed to the composed constitution
(`capability-registry.ops.md` §"The constitution composition rule"): **when this capability is
registered, no commit is recorded while a blocking (`fail`-severity) self-review finding on the
staged change is unresolved.** Enforced structurally by the seam's own gate (core does not
record the commit when any aggregated `pre-commit` finding signals a block); declared here so it
composes into the constitution and is consulted at `spec` / enforced at `verify` like every
other article. The key is unique to this capability, so it can never contradict another
capability's clause (project clauses still override, per the composition rule).

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy, in the v2
shape `phase | contribution-kind | dispatch | scope`. The inline path is forward-slash,
**relative to this capability's registry path** (so `fragments/self-review.md` resolves to
`plugins/wf-audit/capabilities/sr/fragments/self-review.md`). `scope` is empty (`—`): `finding`
is an aggregate kind (aggregated **with provenance**, order cosmetic), so it carries no
ownership scope token — the same `finding` kind and shape the `verify` phase uses, reused at
`pre-commit` with **no new kind**.

| phase      | contribution-kind | dispatch                       | scope |
|------------|-------------------|--------------------------------|-------|
| pre-commit | finding           | `inline: fragments/self-review.md` | —     |

Read off the row: **self-review** (`pre-commit | finding | inline: fragments/self-review.md`) —
the commit agent, firing the `pre-commit` phase, reads `fragments/self-review.md` and follows it
in-context (`inline` dispatch: read-and-follow, no subagent), passing the staged change set as
the artifact under review. The fragment returns findings in the generic `finding` shape; each
finding's severity is the gate/annotate signal (`fail` gates, `warn` annotates), which the
contributor owns — core only fires, aggregates, and blocks the commit if any aggregated finding
signals a block. It is reached only through this registry row; core never spawns it by name.

## Dependencies

This capability declares **no `requires:`** — the lens is pure read-only reasoning over the
staged change set the seam already passes it. It reaches **no** `delivery` or `tracker`
provider and touches neither the run's forwarded `delivery` resolution record nor any provider
surface (the `pre-commit` firing is a phase resolution, independent of delivery resolution —
`capability-registry.ops.md` §"The pre-commit self-review seam"). The capability therefore
composes in **bare-core** mode too, exactly like the audit capability whose rubric it reuses.
