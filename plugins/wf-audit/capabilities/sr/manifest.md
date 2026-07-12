# Self-review (sr) capability manifest

**Version:** 1.0.0
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.contract.md`
**Capability:** sr (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** adapter (attaches one phase fragment via the registry; ships no skills of its own)
**Model:** claude-opus-4-8

---

The sr capability contributes **one adversarial `finding` fragment** at the `pre-commit` phase —
the operation-time commit-path self-review seam WF-154 defined. The commit agent, immediately
before it records a commit and only when a real change is pending, fires `pre-commit`, collects
every `finding` fragment attached there, and dispatches each. Registered → this fragment inspects
the staged change set and returns findings that gate or annotate the commit; unregistered → the
phase produces the byte-identical no-op. It **reuses** the audit capability's owned
adversarial-correctness rubric (`plugins/wf-audit/capabilities/audit/fragments/correctness.md`) —
never re-authoring a second rubric.

## Article

article: precommit-self-review = required

The capability's one non-negotiable, contributed to the composed constitution: **when this
capability is registered, no commit is recorded while a blocking (`fail`-severity) self-review
finding on the staged change is unresolved.** Enforced structurally by the seam's own gate; the
key is unique to this capability, so it can never contradict another capability's clause (project
clauses still override).

## Fragments

Schema `phase | contribution-kind | dispatch | scope`. The inline path is forward-slash,
**relative to this capability's registry path**. `scope` is empty (`—`): `finding` is an aggregate
kind (aggregated **with provenance**, order cosmetic), so it carries no ownership scope token.

| phase      | contribution-kind | dispatch                       | scope |
|------------|-------------------|--------------------------------|-------|
| pre-commit | finding           | `inline: fragments/self-review.md` | —     |

The commit agent, firing `pre-commit`, reads `fragments/self-review.md` and follows it in-context
(`inline` dispatch: read-and-follow, no subagent), passing the staged change set as the artifact
under review. It is reached only through this registry row; core never spawns it by name.

Read-off detail, the rubric-reuse rationale, and the dependency notes:
[`references/onboarding.md`](references/onboarding.md) — read by `init` and authors, never at
phase-fire.
