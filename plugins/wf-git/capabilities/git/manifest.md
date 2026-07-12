# git capability manifest

**Version:** 1.4.1
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** git (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-git:init` skill; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

git supplies the **delivery provider** — the concrete git/GitHub binding for every abstract
delivery operation the capability-registry contract defines (branch/commit/push, PR
create/detect/comment/merge + review-thread resolution, and the read-side workspace/branch/
timestamp, branch-changes, PR-comment, CI-check, and recent-activity queries). It carries
**zero** tracker-specific vocabulary.

## Fragments

Schema (`capability-registry.ops.md` §"Manifest schema v2"): `phase | contribution-kind |
dispatch | scope`. The inline path is forward-slash, **relative to this capability's
registry path**. `scope` is required for partitioned kinds; `provider` carries a **`surface`**
enum token.

| phase     | contribution-kind | dispatch                            | scope    |
|-----------|-------------------|-------------------------------------|----------|
| implement | provider          | `inline: fragments/delivery.ops.md` | delivery |

`provider` is a **partitioned** kind — only the capability owning `surface: delivery`
applies, and git owns `delivery` only. The `phase: implement` cell is a **registration-only
anchor**: a core skill reaches this fragment at any point via **direct provider resolution**
(select `contribution-kind = provider AND scope = delivery`, registry-wide), not only at
`implement`.

Read-off detail, resolution/degradation semantics, the `skills:` block, and downstream
registration: [`references/onboarding.md`](references/onboarding.md) — read by `init` and
authors, never at phase-fire.
