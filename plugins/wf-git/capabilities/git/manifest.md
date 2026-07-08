# git capability manifest

**Version:** 1.4.0 (WF-122 — initial delivery-provider capability, binding SUB-1/WF-120's `delivery` contract to concrete git/GitHub-CLI mechanics; WF-179 — bind the last-commit-timestamp-query read operation, mirroring workspace-root-resolve/current-branch-query; WF-211 — split the delivery fragment into a bounded runtime-ops half (`fragments/delivery.ops.md`) + a reference half (`fragments/delivery.md`), repoint the dispatch, and refresh the contract pointers to the reshaped ops docs; WF-157 — bind six PR-interaction/merge/activity operations in the delivery fragment: `pr-comments-read`, `pr-comment-post`, `checks-read`, `review-thread-resolve`, `pr-merge`, `activity-read`; WF-176 — bind the branch-changes enumeration read operation: `branch-changes-read`)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Manifest schema v2" (v1.1.0)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" (v1.1.0)
**Capability:** git (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-git:init` skill; also attaches one phase fragment via the registry)
**Model:** claude-opus-4-8

---

This is the git capability's **fragments manifest** — the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

git supplies the **delivery provider** — the concrete git/GitHub binding for every
abstract delivery operation the capability-registry contract defines (branch, commit,
push, pull-request create/detect/comment/merge and review-thread resolution, plus the
read-side workspace/branch/timestamp, branch-changes enumeration, PR-comment, CI-check,
and recent-activity queries). It is the
destination capability full-stack users register once core's own inline
`branch`/`commit`/`pr` copy is later scrubbed (SUB-4, a separate task — not this one).
It carries **zero** tracker-specific vocabulary: every operation consumes an
already-resolved id/branch-name/title/body; deriving those from a tracker work item is
explicitly out of scope (SUB-5/SUB-14).

## Article

article: never-commit-to-main = required

**Never commit to `main`.** All work lands on a feature branch and merges via review.

Worded identically to core constitution article 3
(`plugins/wf/skills/constitution/SKILL.md`). This is the **wf-git destination copy** —
core's own article 3 stays in place until a later task (SUB-4) removes it once wf-git
is the registered delivery provider. No contradiction risk today: the registry
validator's contradiction check (CHECK 9, `validate-registry.sh`) only compares two
*capability*-declared `article:` lines against each other, and core's hardcoded
articles are not parsed through this mechanism — so this capability's article and
core's identical prose coexist without tripping the check.

## Fragments

Each row attaches one fragment to one phase, typed by the contribution taxonomy. The
schema is the v2 shape fixed by `capability-registry.ops.md` §"Manifest schema v2":
`phase | contribution-kind | dispatch | scope`. The inline path is forward-slash,
**relative to this capability's registry path** (so `fragments/delivery.ops.md` resolves
to `plugins/wf-git/capabilities/git/fragments/delivery.ops.md`). `scope` is required for
partitioned kinds; `provider` carries a **`surface`** enum token.

| phase     | contribution-kind | dispatch                            | scope    |
|-----------|-------------------|-------------------------------------|----------|
| implement | provider          | `inline: fragments/delivery.ops.md` | delivery |

Read off the column:

- **delivery** (`implement | provider | inline: fragments/delivery.ops.md | delivery`) —
  the git/GitHub **delivery execution provider**. This row's `phase: implement` is a
  **registration-only anchor** for registry validation — the SDD phase where a
  delivery operation is actually exercised in practice (the tail of an
  implementation) — it does **not** restrict *when* a core skill may invoke a
  delivery operation. A core skill reaches this fragment at any point in its own
  procedure via **direct provider resolution**: it selects the row(s) where
  `contribution-kind = provider AND scope = delivery`, across the whole registry,
  regardless of that row's `phase` value, then dispatches per the row's `dispatch`
  kind (here, `inline:` — read `fragments/delivery.ops.md`, the bounded runtime-ops
  half, and follow it in-context; its rationale and edge-case reference is
  `fragments/delivery.md`, never read at boot; no subagent is spawned). See
  `invocation-runtime.ops.md` §"Direct provider resolution" for the full procedure this
  reuses.

`provider` is a **partitioned** kind: only the capability owning `surface: delivery`
applies. Two capabilities claiming the same surface is a registry-validation error;
different surfaces (`engine`, `host`, `delivery`, `tracker`, …) compose. git owns
`delivery` only — it makes no claim on `engine`/`host` (the QA-execution surfaces) or
`tracker` (the issue-tracker surface), so it composes alongside browser-qa, a stack
capability, and a future tracker capability with no conflict.

## Skills

As a `both` capability, git ships its own skill natively (install the plugin → the
`/wf-git:init` command is discoverable; native plugin composition handles loading)
**and** attaches the fragment above via the registry. Documented for reference:

```
skills:
  - plugins/wf-git/skills/init/   # /wf-git:init — self-registering onboarding (mirrors WF-99's /wf-caps:init)
```

## Profile seed template

This capability ships **no** `profile-template:` — no project-tunable delivery value
exists yet. Per the contract's seeding convention, a capability that declares no
`profile-template:` seeds nothing (the no-op path).

## Downstream registration

This repo ships the capability + its skill; it does **not** carry a
`_local/config.md` (that lives in each consuming project). To activate git
downstream, run `/wf-git:init` (recommended — see `plugins/wf-git/README.md`), or add a
repo-relative row to the consuming project's `_local/config.md` `## Capabilities` table
by hand:

```markdown
## Capabilities

| Capability | Path                          |
|------------|--------------------------------|
| git        | plugins/wf-git/capabilities/git |
```

(Or the plugin-anchored `Path` form `plugin:wf-git/capabilities/git`, which
`/wf-git:init` writes for you.) With `git` registered, any core skill resolving the
`delivery` surface dispatches branch/commit/push/PR operations to this capability's
fragment; with no `delivery` provider registered, reads fall back silently to a
plain-directory resolution and writes state plainly that no delivery provider is
registered, per `capability-registry.ops.md` §"The delivery provider surface".
