# `pr-version-claims` fragment — core-authoring capability (`pr.body-check` slot fill)

**Version:** 1.0.0 (WF-757 — flag PR-body version claims that disagree with the diff)
**Wired by:** `plugins/wf-core-authoring/capabilities/core-authoring/manifest.md`
(`— | slot | inline: fragments/pr-version-claims.md | pr.body-check append`)
**Contributes:** a `slot` fill at the `pr.body-check` composition point, merge policy `append`, per
`plugins/wf/skills/_contracts/capability-registry.ops.md`
**Model:** claude-opus-5-5

Before following any resolver MCP call in this document, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

---

The `core-authoring` capability's fill for `pr.body-check`. The `wf:pr` agent follows it after composing
the pull-request title and body and **before** creating the pull request. The policy is **`append`**:
core's inline default contributes no check, and this fill adds one — it replaces nothing and runs
alongside any other capability's check at the same point.

Reaching this text means the capability is registered, which is true only in the repository that
authors the `wf` core plugin. It checks one rule of that repository (`CLAUDE.md` §8): the version
numbers a body announces must be ones the change actually sets in a plugin `plugin.json` or the
`.claude-plugin/marketplace.json`. It **flags**; it never edits the body, the manifests, or the bump.

## Step 1 — Write the two inputs to scratch

1. Write the composed body, exactly as composed, to
   `_local/scratch/pr-body-check-<task-id>.body.md` with the **Write** tool.
2. Write the branch's full change since its base to `_local/scratch/pr-body-check-<task-id>.diff`:

   ```bash
   git diff --output=_local/scratch/pr-body-check-<task-id>.diff <base>...<branch>
   ```

   `<base>` and `<branch>` are the values the agent already resolved in its Step 2. The three-dot form
   compares against the merge base, so only this branch's own version changes are counted.

## Step 2 — Run the checker

Resolve this pack's root with `resolve_plugin_root({ workspaceRoot, plugin: "wf-core-authoring" })`, then:

```bash
bash <pack-root>/capabilities/core-authoring/fixtures/check-pr-version-claims.sh --body _local/scratch/pr-body-check-<task-id>.body.md --diff _local/scratch/pr-body-check-<task-id>.diff
```

The script is the rule's single executable definition — what counts as a set version and what counts
as a claim is stated in its header and proven by its `--selftest`. Do not re-derive either here.

## Step 3 — Delete the scratch inputs

Delete both scratch files as the last act of this check, whatever its outcome.

## Step 4 — Report the outcome

| Checker exit | Outcome |
|--------------|---------|
| `0` | pass — continue to creation with the body unchanged |
| `1` | **flagged** — the flagged text is every `MISMATCH:` line the checker printed, verbatim |
| `2`, any other code, or the pack root does not resolve | **could not complete** — state the exit code or the resolver's reason |

Flagged and could-not-complete both stop creation: the agent returns `PR — Error` per its own
Step 3.5. Correcting the body or the bump is the author's follow-up, never this fill's.

Rationale — why the rule lives in this capability rather than core, and why the check stops creation
rather than annotating: [`../references/pr-version-claims.md`](../references/pr-version-claims.md) —
read by authors, never at slot-fire.
