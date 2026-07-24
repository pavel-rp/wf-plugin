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
| `capabilities/ado/manifest.md` | the `ado` capability's manifest — one `provider` fragment row scoped `tracker` |
| `capabilities/ado/fragments/tracker.md` | the inline reference doc binding all thirteen tracker operations to Azure DevOps mechanics, with a completeness coverage table |
| `/wf-ado:init` | one-command self-registration — records this pack's install root, registers the `ado` capability, and interviews for (or carries forward) ADO organization/project, mirroring `/wf-git:init` (WF-122) |

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
