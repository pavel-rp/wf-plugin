# git capability manifest

**Version:** 1.0.0 (WF-122 — initial delivery-provider capability, binding SUB-1/WF-120's `delivery` contract to concrete git/GitHub-CLI mechanics)
**Conforms to:** `plugins/wf/skills/_contracts/capability-registry.contract.md` (manifest schema v2)
**Executed by:** `plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution" (v2.3.0)
**Capability:** git (registered in the downstream `_local/config.md` `## Capabilities` table)
**Kind:** both (ships its own `/wf-git:init` skill; also attaches one phase fragment via the registry)
**Model:** claude-sonnet-5

---

This is the git capability's **fragments manifest** — the file a core skill reads at
`<path>/manifest.md` (when iterating the `## Capabilities` registry) to learn which
fragments this capability attaches to which SDD phases. Core resolves `<path>` from the
registry row in `_local/config.md`; it does not hardcode this path.

git supplies the **delivery provider** — the concrete git/GitHub binding for every
abstract delivery operation the capability-registry contract defines (branch, commit,
push, pull-request write/read, plus the two workspace-inference reads). It is the
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
schema is the v2 shape fixed by `capability-registry.contract.md`:
`phase | contribution-kind | dispatch | scope`. The inline path is forward-slash,
**relative to this capability's registry path** (so `fragments/delivery.md` resolves to
`plugins/wf-git/capabilities/git/fragments/delivery.md`). `scope` is required for
partitioned kinds; `provider` carries a **`surface`** enum token.

| phase     | contribution-kind | dispatch                       | scope    |
|-----------|--------------------|--------------------------------|----------|
| implement | provider           | `inline: fragments/delivery.md` | delivery |

Read off the column:

- **delivery** (`implement | provider | inline: fragments/delivery.md | delivery`) —
  the git/GitHub **delivery execution provider**. This row's `phase: implement` is a
  **registration-only anchor** for registry validation — the SDD phase where a
  delivery operation is actually exercised in practice (the tail of an
  implementation) — it does **not** restrict *when* a core skill may invoke a
  delivery operation. A core skill reaches this fragment at any point in its own
  procedure via **direct provider resolution**: it selects the row(s) where
  `contribution-kind = provider AND scope = delivery`, across the whole registry,
  regardless of that row's `phase` value, then dispatches per the row's `dispatch`
  kind (here, `inline:` — read `fragments/delivery.md` and follow it in-context; no
  subagent is spawned). See `invocation-runtime.contract.md` §"Direct provider
  resolution" for the full procedure this reuses.

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
registered, per `capability-registry.contract.md` §"The delivery provider surface".
