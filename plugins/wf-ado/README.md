# wf-ado — the tracker-provider pack

A standalone marketplace plugin that ships the **`ado` capability**: a `both`-kind
capability owning the wf capability-registry's **`tracker`** `provider` surface
(`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker
provider surface"). It binds every abstract tracker operation —
`resolve_config`, `create_umbrella`, `create_child`, `update`, `get`,
`list_children`, `post_comment`, `set_status`, `attach_link`, `list_by_status`,
`list_milestones`, `list_cycles`, `list_blockers` — to concrete Azure DevOps mechanics, so a `wf`
core skill that needs to read, write, or enumerate work items has a provider to
dispatch to.

## What ships

| Item | What it is |
|---|---|
| `capabilities/ado/manifest.md` | the `ado` capability's manifest — one `provider` fragment row scoped `tracker`, seven `slot` fill rows, and one declared profile template |
| `capabilities/ado/profile.template.json` | project-configuration metadata declaring exactly two ordered string questions: ADO Organization, then ADO Project; `work-item-id-prefix: ADO` remains ordinary non-question data |
| `capabilities/ado/fragments/tracker.md` | the inline reference doc binding all thirteen tracker operations to Azure DevOps mechanics, with a completeness coverage table |
| seven `capabilities/ado/fragments/*-*.md` slot fills | the conveyor tracker mirror — `spec.questions`, `spec.publish`, `plan.publish`, `tasks.publish`, `implement.start`, `implement.milestone`, `implement.finish` |
| `/wf-ado:init` | one-command self-registration — records this pack's install root, registers the `ado` capability, and interviews for (or carries forward) ADO organization/project, mirroring `/wf-git:init` (WF-122) |

## Declared project questions

The profile template exposes the existing ADO Organization and ADO Project interview as ordered,
capability-owned metadata. Both are plain strings, have no suggested answer, and remain unresolved
until a project explicitly persists a value at the declared destination. The established Work Item
ID Prefix default, `ADO`, stays outside `ask` and cannot resolve either question.

This declaration does not yet run or persist the interview. `/wf-ado:init` remains the current
onboarding path and continues to manage the same `## Azure DevOps` config rows until the separate
init-alias migration. Packs that declare no questions remain silent. In particular, credentials
collected by `wf-browser-qa` remain a separate pack-specific onboarding concern, outside this
project-question inventory.

## The conveyor tracker mirror (seven slot fills)

With `ado` registered, the conveyor's four bookkeeping skills publish to Azure DevOps from
their declared composition points: open questions land as one comment on the task's umbrella;
the finished spec, plan and decomposition land as `Spec:` / `Plan:` / `Tasks:` child work
items beneath it; and the implement phase opens an `Impl:` child, appends one log entry per
checkpoint to its comment thread, then closes it and moves the umbrella to the awaiting-review
state. Every fill binds only operations the tracker contract already defines — no contract
extension.

> **⚠ Authored to parity, not live-tested.** The seven fills mirror the `wf-linear` fills
> structurally and are verified by fragment/contract review plus registry validation only —
> **no live Azure DevOps run has exercised them.** Confirm the child-creation response shape,
> the tag patch, and each state name against your project's process template before relying on
> them. Details and the residual-risk statement: `capabilities/ado/references/onboarding.md`.

## Registering wf-ado downstream

**One command (recommended): `/wf-ado:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-ado:init` — it records this pack's install root in a gitignored
`## Plugin Roots` mapping, registers the `ado` capability as a **plugin-anchored**
row (`plugin:wf-ado/capabilities/ado`), and interviews for (or carries forward
any already-set) `_local/config.md` `## Azure DevOps` values. Core then resolves
`tracker` operations through that mapping — no vendored `plugins/wf-ado/...`
needed in the consuming repo. Re-run after a pack upgrade to refresh the install
root; it is idempotent, and a re-run with all three ADO values already set
produces zero prompts.

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo,
add a repo-relative row to the project's `_local/config.md` `## Capabilities`
table by hand (forward slashes):

```markdown
## Capabilities

| Capability | Path                          |
|------------|--------------------------------|
| ado        | plugins/wf-ado/capabilities/ado |
```

With `ado` registered, any core skill resolving the `tracker` surface (direct
provider resolution — no phase-firing gate; see
`plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider
resolution") dispatches work-item operations to this capability's fragment.
With no `tracker` provider registered, core falls back silently to its own
local `T<NNN>` task-id scheme — no ADO call at all.

See `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker
provider surface" for the full operation set and degradation rules.
