# wf-linear — the tracker-provider pack

A standalone marketplace plugin that ships the **`linear` capability**: a `both`-kind
capability owning the wf capability-registry's **`tracker`** `provider` surface
(`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker
provider surface"). It binds every abstract tracker operation —
`resolve_config`, `create_umbrella`, `create_child`, `update`, `get`,
`list_children`, `post_comment`, `set_status`, `attach_link`, `list_by_status`,
`list_milestones`, `list_cycles`, `list_blockers` — to concrete Linear mechanics via the
`mcp__claude_ai_Linear__*` MCP tools, so a `wf` core skill that needs to read,
write, or enumerate issues has a provider to dispatch to.

wf-linear is the **second, independent** binding of the tracker contract — proof
that the contract carries no ADO-shaped assumption. It composes exactly like
`wf-ado` (same surface, same operation set, same partitioned-ownership rule):
registering `ado` and `linear` together is a **registry-validation error**, since
two capabilities may never claim the same `tracker` surface. Register **exactly
one** tracker provider — `wf-ado` **or** `wf-linear`, never both.

## Requires

The **`mcp__claude_ai_Linear__*` MCP tools connected in the downstream session** —
`get_issue`, `list_issues`, `save_issue`, `save_comment`, `create_attachment`,
`list_issue_statuses`, `list_milestones`, `list_cycles`, `list_teams`,
`list_projects`, at minimum (see
`capabilities/linear/fragments/tracker.md`'s per-operation bindings). Without
them connected, an in-flight run's tracker calls fail at the MCP layer; the
fragment's warn-once-continue rule (below) still applies, so a run degrades to
local-only rather than blocking.

## What ships

| Item | What it is |
|---|---|
| `capabilities/linear/manifest.md` | the `linear` capability's manifest — one `provider` fragment row scoped `tracker` |
| `capabilities/linear/fragments/tracker.md` | the inline reference doc binding all thirteen tracker operations to Linear MCP mechanics, with a completeness coverage table |
| `/wf-linear:init` | one-command self-registration — records this pack's install root, registers the `linear` capability, and interviews for (or carries forward) the Linear team/project, mirroring `/wf-ado:init` (WF-123), `/wf-git:init` (WF-122) |

## Registering wf-linear downstream

**One command (recommended): `/wf-linear:init`.** After `/wf:init` has bootstrapped
the repo, run `/wf-linear:init` — it records this pack's install root in a
gitignored `## Plugin Roots` mapping, registers the `linear` capability as a
**plugin-anchored** row (`plugin:wf-linear/capabilities/linear`), and interviews
for (or carries forward any already-set) `_local/config.md` `## Linear` values.
Core then resolves `tracker` operations through that mapping — no vendored
`plugins/wf-linear/...` needed in the consuming repo. Re-run after a pack upgrade
to refresh the install root; it is idempotent, and a re-run with both Linear
values already set produces zero prompts.

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo,
add a repo-relative row to the project's `_local/config.md` `## Capabilities`
table by hand (forward slashes):

```markdown
## Capabilities

| Capability | Path                                   |
|------------|-----------------------------------------|
| linear     | plugins/wf-linear/capabilities/linear    |
```

With `linear` registered, any core skill resolving the `tracker` surface (direct
provider resolution — no phase-firing gate; see
`plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider
resolution") dispatches work-item operations to this capability's fragment.
With no `tracker` provider registered, core falls back silently to its own
local `T<NNN>` task-id scheme — no Linear call at all.

**Exactly one tracker provider.** Registering `ado` and `linear` together in the
same `## Capabilities` table fails registry validation — both capabilities claim
the `tracker` `provider` surface, and partitioned ownership must not overlap.
`plugins/wf/skills/_contracts/registry-fixtures/fail-tracker-overlap-ado-linear.md`
is the fixture proving this concretely (named `ado` vs `linear`, not the generic
`tracker-owner`/`tracker-owner-2` stand-ins the base fixture suite already used).
Pick one provider.

See `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The tracker
provider surface" for the full operation set and degradation rules.
