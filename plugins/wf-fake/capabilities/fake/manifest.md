# fake capability manifest

**Version:** 0.1.1
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** fake (registered in a **fixture** project's `_local/config.md` `## Capabilities` table only)
**Kind:** both (ships its own `/wf-fake:init` skill; also attaches two phase fragments via the registry)
**Model:** claude-opus-4-8

---

fake supplies a **hermetic, in-memory binding of BOTH provider surfaces** the capability-registry
contract defines — `delivery` (branch/commit/push, PR create/detect/comment/merge + review-thread
ops, and the read-side workspace/branch/timestamp/changes/comment/checks/activity/
newest-published-version queries) **and**
`tracker` (config/create/update/get/list/comment/status/link + status/milestone/cycle/blocker
queries). Every operation returns a **scripted** response read from a fixture-local scripts file and
appends its invocation to a machine-readable **op log**. It reaches **no** network, git, gh, or
tracker MCP — it is the C016 skill-eval test seam. It is registered **only inside fixture
registries**, where it is the **sole owner of both surfaces**; co-registering it alongside a real
delivery/tracker pack correctly trips the registry overlap check (both offenders named) — the
contract working as designed, not a bug.

## Fragments

Schema (`capability-registry.ops.md` §"Manifest schema v2"): `phase | contribution-kind |
dispatch | scope`. The inline path is forward-slash, **relative to this capability's registry
path**. `scope` is required for partitioned kinds; `provider` carries a **`surface`** enum token.

| phase     | contribution-kind | dispatch                            | scope    |
|-----------|-------------------|-------------------------------------|----------|
| implement | provider          | `inline: fragments/delivery.ops.md` | delivery |
| spec      | provider          | `inline: fragments/tracker.ops.md`  | tracker  |

`provider` is a **partitioned** kind — only the capability owning a given `surface` applies. fake
owns **both** `delivery` and `tracker`; different surfaces compose within one capability. Each
`phase` cell is a **registration-only anchor** (`delivery` → `implement`, `tracker` → `spec`,
matching the wf-git / wf-linear anchors): a core skill reaches either fragment at any point via
**direct provider resolution** (select `contribution-kind = provider AND scope = <surface>`,
registry-wide), not only at that phase.

**Do not register `fake` alongside `git`, `ado`, `linear`, or any other delivery/tracker
provider** — `fake` claims both the `delivery` and `tracker` surfaces, and partitioned ownership
must not overlap (registry validation fails, naming both offenders). fake belongs in a fixture
registry only.

Read-off detail, the scripted-response protocol rationale, resolution/degradation semantics, the
`skills:` block, config seeding, and downstream registration:
[`references/onboarding.md`](references/onboarding.md) — read by `init` and authors, never at
phase-fire.
