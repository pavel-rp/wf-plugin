# wf-git — the delivery-provider pack

A standalone marketplace plugin that ships the **`git` capability**: a `both`-kind
capability owning the wf capability-registry's **`delivery`** `provider` surface
(`plugins/wf/skills/_contracts/capability-registry.ops.md` §"The delivery
provider surface"). It binds every abstract delivery operation — `branch-create`,
`branch-switch`, `commit`, `push-upstream`, `pr-create`, `pr-detect`,
`pr-comment-post`, `review-thread-resolve`, `pr-merge`, `workspace-root-resolve`,
`current-branch-query`, `last-commit-timestamp-query`, `pr-comments-read`,
`checks-read`, `activity-read` — to concrete git/gh procedures, so a `wf` core skill
that needs to branch, commit, push, open a PR, read or post review comments, read
checks, resolve a thread, merge a PR, or read recent activity has a provider to
dispatch to.

## What ships

| Item | What it is |
|---|---|
| `capabilities/git/manifest.md` | the `git` capability's manifest — one `provider` fragment row scoped `delivery`, plus the "never commit to `main`" constitution `article` |
| `capabilities/git/fragments/delivery.ops.md` | the **runtime-ops** half — every input, guard, error path, and outcome mapping for all fifteen delivery operations, read at each delivery-surface boot (bounded, ≤250 lines) |
| `capabilities/git/fragments/delivery.md` | the **reference** half — scope framing, per-operation rationale, and the edge-case regression matrix; never read at boot |
| `/wf-git:init` | one-command self-registration — records this pack's install root and registers the `git` capability, mirroring `/wf-caps:init` (WF-99) |

## Registering wf-git downstream

**One command (recommended): `/wf-git:init`.** After `/wf:init` has bootstrapped the
repo, run `/wf-git:init` — it records this pack's install root in a gitignored
`## Plugin Roots` mapping and registers the `git` capability as a **plugin-anchored**
row (`plugin:wf-git/capabilities/git`). Core then resolves `delivery` operations
through that mapping — no vendored `plugins/wf-git/...` needed in the consuming repo.
Re-run after a pack upgrade to refresh the install root; it is idempotent.

**Manual (escape hatch):** when the pack **is** vendored in the consuming repo, add a
repo-relative row to the project's `_local/config.md` `## Capabilities` table by hand
(forward slashes):

```markdown
## Capabilities

| Capability | Path                          |
|------------|--------------------------------|
| git        | plugins/wf-git/capabilities/git |
```

With `git` registered, any core skill resolving the `delivery` surface (direct
provider resolution — no phase-firing gate; see
`plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider
resolution") dispatches branch/commit/push/PR operations to this capability's
fragment. With no `delivery` provider registered, reads fall back silently to a
plain-directory resolution and writes state plainly that no delivery provider is
registered.

See `plugins/wf/skills/_contracts/capability-registry.ops.md` §"The delivery
provider surface" for the full operation set and degradation rules.
