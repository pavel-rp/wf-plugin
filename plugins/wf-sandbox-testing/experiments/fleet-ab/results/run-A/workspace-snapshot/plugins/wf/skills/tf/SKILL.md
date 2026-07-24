---
name: tf
description: Finalizes a completed task through the active providers — merges the task's pull request through the delivery provider, posts a resolution comment and closes the work item through the tracker provider, then archives the task folder and updates the per-task index locally. Names only abstract provider operations. Degrades to local-only when a provider is unconfigured or fails mid-run — the local archive and index always complete, and the local artifacts are the source of truth. Use as the terminus step once a task's pull request is approved. Reads _local/config.md first; run /wf:init if it is absent.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf:tf — Finalize a completed task through the providers

Finalizes a task that has been implemented, verified, and whose pull request is approved. In one run it: **merges** the task's pull request through the active **delivery** provider, posts a **resolution comment** and moves the work item to its terminal status through the active **tracker** provider, **archives** the task folder locally, and **updates** the per-task index. It is the terminus of the chain — nothing runs after it.

Core reaches merge/comment/close only through the abstract **delivery** and **tracker** provider operations; it never knows or names which concrete tool implements them. With **no** delivery or tracker provider registered, tf degrades to a **local-only** finalize: the archive and index still complete, no provider operation is attempted, and no capability term surfaces. The **local artifacts are always the source of truth**; a provider step is a publish layered on top, never the primary write.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). `{task-root}` below comes from `coreConfig.taskRoot` — never hardcode it. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. A registered tracker capability resolves its own project-scoped config from its own fragment binding; core never reads it directly.

---

## Command Syntax

```
/wf:tf [<id>] [--status <name>]
```

### Arguments

| Argument         | Required | Description                                                                                                                                                              |
| ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<id>`           | NO       | Task id — the opaque shape the active tracker capability produced, or the local `T<NNN>` scheme when none is registered. Falls back to inferring from the current branch. |
| `--status <name>`| NO       | The terminal status name the work item is moved to on close. Defaults to `Done` — override when the project's tracker workflow names its terminal state differently (e.g. `Closed`, `Completed`). The active tracker capability's `set_status` resolves the name against its own workflow states. |

### Zero-argument default

Invoked with no id, tf infers the task from the current branch (the same first-3+-digit-run inference every id-inferring skill uses), so `/wf:tf` on a task branch finalizes that task. Require an explicit id only when inference fails.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read the task folder and its artifacts; obtain config via the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query.
- Read-only resolution via `workspace-root-resolve` (the `wf-resolver` `resolve_config({ workspaceRoot, ... })` `workspaceRoot` value) and `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query).
- Invoke `pr-merge` (delivery) once for the task's pull request, and `post_comment` / `set_status` (tracker) once each, all through the surface's `wf-resolver` `resolve_provider({ workspaceRoot, surface })` record (read the resolved fragment and follow it in-context).
- Write/create `09_finalize.md` **only** inside the task folder, and **move** the task folder to `{task-root}/_archive/` — both are local operations inside `{task-root}` (the whole `_local/` tree is gitignored), never a version-control operation.
- Invoke `/wf:index` through the **Skill** tool to update the per-task index (the wrapper writes `index.md` inline).

**Forbidden:**

- Modify any source file outside `{task-root}`.
- Run any destructive version-control operation. The only delivery write tf performs is `pr-merge`, through the provider contract; `pr-merge` is detect-first and never re-merges an already-merged pull request.
- Write the current model id, any AI-attribution trailer, a "generated with" footer, an emoji, or any promotional tagline into the resolution comment. Model attribution belongs **only** in the local `09_finalize.md` artifact.
- Name any concrete tracker, version-control tool, or command string anywhere in this skill's behaviour — only the abstract operation names above.

---

## Phase 1: Resolve the task id and locate the task folder

1. **Resolve `{task-id}`** (the opaque id): use the `<id>` argument verbatim when passed. When omitted, infer it: resolve the current branch via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query — see Phase 2; on `state: unconfigured`/`unrecoverable` this resolves nothing and inference falls to the folder scan below), extract the first 3+-digit run as a token, and resolve that token against `{task-root}` by applying the same first-3+-digit-run extraction to each existing task folder's name (this matches both a tracker-prefixed shape and the local `T<NNN>` scheme). **Exactly one match** — reuse that folder's full name as `{task-id}` (never reconstruct it from a prefix). **More than one match** → stop: "Ambiguous id: the branch-inferred token matches more than one task folder; pass the id explicitly." **Zero matches / no extractable token** → stop: "No task id provided and none could be inferred from the current branch. Pass the id explicitly: /wf:tf <id>."

2. **Resolve the workspace root** from the `wf-resolver` `resolve_config({ workspaceRoot, ... })` `workspaceRoot` value (its already-normalized `workspace-root-resolve` result). With no delivery provider registered this is the plain-directory resolution (not an error); with a provider registered but no working tree to resolve, stop: "Not inside a resolvable workspace."

3. **Locate the task folder.**
   - **Active:** `<workspace-root>/{task-root}/{task-id}/` (or `{task-root}` as-is when absolute). If present, this is the folder to finalize — continue to Phase 2.
   - **Already archived:** if the active folder is absent but `<workspace-root>/{task-root}/_archive/{task-id}/` exists, this task was already finalized. Report `TF — already-finalized` (idempotent no-op) and stop — never re-run the provider steps against a finalized task.
   - **Neither:** stop: "Task folder not found. Run /wf:spec first."

---

## Phase 2: Resolve the providers once

tf is a **direct invocation** — the top of its own chain — so it self-resolves each surface it needs **once** and forwards nothing (its sole child step, the `/wf:index` update, now runs inline in tf's own context and invokes no provider operation, so no resolution record flows to it — `invocation-runtime.ops.md` §"Run-scoped provider forwarding").

Call the bundled `wf-resolver` MCP tool `resolve_provider({ workspaceRoot, surface })` once per required surface — `resolve_provider({ workspaceRoot, surface: "delivery" })` and `resolve_provider({ workspaceRoot, surface: "tracker" })`. Each returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`; the resolver has already read the `## Capabilities` registry, each owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"), so core performs **no** registry / manifest / plugin-root read of its own. Hold each surface's record — its `owner` + fragment `ref`, or its `state: unconfigured`/`unrecoverable` outcome (with `diagnostics` for the hedged diagnosis) — to dispatch operations against in the phases below by obtaining each op's body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and following it in this skill's own context — never a raw `Read` of the path (the metadata queries return only paths/metadata; the body comes from `resolve_content({ workspaceRoot, ... })`). No operation runs yet. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery).

Both surfaces may resolve to no readable provider (`state: unconfigured`/`unrecoverable`); tf still finalizes locally. The records are runtime values — no concrete provider is named in this skill.

---

## Phase 3: Merge the pull request (delivery)

The local `09_finalize.md` artifact is the source of truth and carries the single-shot-publish idempotency line for the merge.

1. **Ensure the finalize artifact exists.** If `{task-root}/{task-id}/09_finalize.md` is absent, write it from the template below (with the model-attribution line). This is the local artifact that triggers the merge.

2. **Zero readable delivery provider** (the `delivery` record's `state` is `unconfigured` or `unrecoverable`) — **do not attempt a merge**. Unlike the pure delivery skills (`commit`/`pr`), tf does **not** hard-stop here: it **warns once**, naming the remedy so the statement still names it plainly (`state: unconfigured`: "No delivery provider is registered — merge skipped; register a capability that owns the `delivery` surface to enable it." / `state: unrecoverable`: name the record's `diagnostics` pack as a hedged candidate — "if this is your `delivery` provider, fix its stale root / re-run its init"), records `**Merged PR:** skipped (no delivery provider)` in `09_finalize.md`, and **falls through** to Phase 4 so the local archive and index still complete. Skip the rest of this phase.

3. **Idempotency read-back.** Read the `**Merged PR:**` line of `09_finalize.md`. If it already holds a URL (not the placeholder), the merge already ran — reuse that URL as the merged reference, skip the `pr-merge` call, and continue to Phase 4.

4. **Resolve and validate the branch.** Resolve the current branch via `current-branch-query`; its detached-HEAD signal → warn once ("Detached HEAD — cannot merge the task's pull request; checkout the task branch first."), record `**Merged PR:** failed (detached HEAD)`, and fall through to Phase 4. If the branch does not carry the task's first-3+-digit-run token (`/{numeric-id}-`), warn once ("Not on the task branch for {task-id} — checkout the task branch before finalizing."), record `**Merged PR:** failed (not on task branch)`, and fall through to Phase 4.

5. **Merge.** Invoke `pr-merge` for the task's branch through the resolved delivery fragment (read it and follow it in-context; the fragment supplies the merge strategy — tf names none). Map its result:
   - `merged` → capture `<url>`; record `**Merged PR:** <url>` in `09_finalize.md`.
   - `already-merged` → the pull request was already merged (the provider's detect-first no-op); capture `<url>`; record `**Merged PR:** already merged (<url>)`.
   - **Merge blocked / provider error** (failing checks, unresolved conversations, not-mergeable, or the underlying tool not authenticated) — a **mid-run failure**: warn once, naming the operation and the provider's own reason, record `**Merged PR:** failed (<reason>)`, and fall through to Phase 4. The local finalize still completes; the merge can be retried by re-running tf (the idempotency read-back and the provider's detect-first guard make a retry safe).

---

## Phase 4: Post the resolution comment and close the work item (tracker)

Compose the resolution comment from local artifacts, then publish it and close the work item through the tracker provider. Each tracker write carries its own idempotency line in `09_finalize.md`.

1. **Compose the resolution comment** (local-only, from the task's own artifacts — no diff read, no model id, no AI attribution, no emoji): a single factual line stating the task's pull request is merged, embedding the merged reference from Phase 3, plus a one-line summary of what shipped drawn from `02_plan.md`'s Resolution Summary or `01_spec.md`'s Objective when present, else the task title from `00_reqs.md`. Use the template below. If Phase 3 recorded no merged reference (skipped/failed), state the finalize plainly without asserting a merge that did not happen.

2. **Zero readable tracker provider** (the `tracker` record's `state` is `unconfigured` or `unrecoverable`):
   - **`state: unconfigured`** (no capability owns `tracker`) — **silent** local-only: post no comment, change no status, attempt no operation, and surface **no message and no capability term**. Record `**Resolution comment:** skipped (no tracker)` and `**Closed:** skipped (no tracker)` in `09_finalize.md`. Continue to Phase 5.
   - **`state: unrecoverable`** (a registered capability's manifest is unrecoverable — recorded root dangled, self-heal recovered nothing) — the tracker **writes** emit a single **warn-once** in the hedged candidate-naming form (name the record's `diagnostics` pack as a candidate — "if this is your `tracker` provider, fix its stale root / re-run its init" — never asserting ownership), then continue local-only with the same `skipped` records. Continue to Phase 5.

3. **Post the resolution comment.** Read the `**Resolution comment:**` line of `09_finalize.md`; if it already reads `posted`, skip (already published). Otherwise invoke `post_comment({task-id}, <comment-body>)` through the resolved tracker fragment. On success, record `**Resolution comment:** posted`.

4. **Close the work item.** Read the `**Closed:**` line; if it already names a status, skip. Otherwise invoke `set_status({task-id}, <status>)` — `<status>` is the `--status` value, default `Done` — through the resolved tracker fragment. On success, record `**Closed:** <status>`.

5. **Mid-run tracker failure** (a tracker was resolved but a `post_comment` / `set_status` call errors): **warn once** for the run, naming the failing operation and the error, record `**Resolution comment:** failed (<reason>)` / `**Closed:** failed (<reason>)` on the offending line, and continue local-only — a later tracker operation in the same run does **not** re-warn. A tracker failure never blocks the archive or index; the local finalize always completes.

---

## Phase 5: Archive the task folder locally

Move the task folder out of the active task root into the archive, so a finalized task no longer appears among in-flight tasks. This is a plain local move inside `{task-root}` (gitignored), never a version-control operation.

1. Ensure `{task-root}/_archive/` exists (create it if missing).
2. Move `{task-root}/{task-id}/` → `{task-root}/_archive/{task-id}/`, carrying every artifact (including `09_finalize.md` and `index.md`) with it. Record the archived absolute path for Phase 6.
3. **Already archived** (the target already exists — a partial prior run): leave the existing archive untouched and record the archive as already present; do not overwrite.

---

## Phase 6: Update the index

After archiving, catalogue the outcome by invoking `/wf:index {task-id} finalize "<summary>"` through the **Skill** tool. The wrapper owns the fixed `index` routing decision and performs the read-modify-write of `index.md` inline in tf's own context; never dispatch `wf:index` directly. Pass:

- `{task-id}` — the archived task's id (its folder basename); the wrapper resolves the `index.md` that travelled into `{task-root}/_archive/{task-id}/`.
- the literal slot `finalize`.
- a ≤80-char summary reflecting the outcome, e.g. `merged <ref>; closed as <status>` (or `local-only finalize` in bare-core).

If the wrapper returns `INDEX — Error`, do not fail the finalize — record the index outcome as failed and still emit the success block.

---

## Templates

### `09_finalize.md` (local finalize record — the source of truth)

```markdown
# {task-id} — Finalize record

**Model:** <model identifier>
**Finalized:** <YYYY-MM-DD HH:mm>

**Merged PR:** <placeholder until pr-merge runs>
**Resolution comment:** <placeholder until post_comment runs>
**Closed:** <placeholder until set_status runs>
```

The three `**Merged PR:** / **Resolution comment:** / **Closed:**` lines are the single-shot-publish idempotency handles: each provider operation records its outcome on its line, and tf reads the line back before re-invoking so a re-run never double-publishes.

### Resolution comment (published to the tracker — never carries a model id or AI attribution)

```markdown
Resolved via {merged reference}.

{one-line summary of what shipped}
```

When Phase 3 recorded no merge, drop the "Resolved via …" reference and state the finalize plainly (e.g. "Finalized locally; pull request not merged through a provider.").

---

## Edge Cases

- **Missing config:** the resolver reports the project is uninitialized (absent `_local/config.md`) → stop: "Run /wf:init first."
- **Already finalized:** the task folder is already under `{task-root}/_archive/` → `TF — already-finalized`; no provider step is re-run.
- **No delivery provider registered:** merge is skipped with a one-time remedy-naming warning (non-blocking, unlike `commit`/`pr`); the local archive and index still complete — the bare-core finalize path.
- **No tracker registered (genuinely unconfigured):** silent local-only — no comment, no status change, no message, no capability term; archive and index complete.
- **Registered-but-unrecoverable delivery or tracker:** the write surfaces the hedged candidate-naming diagnosis from the record's `diagnostics` field (delivery once at Phase 3, tracker once at Phase 4), never asserting a pack owns the surface; the local finalize completes.
- **Merge blocked** (failing checks, unresolved conversations, not-mergeable) or **tool not authenticated:** mid-run failure — warn once with the provider's reason, record it on the `**Merged PR:**` line, complete the local finalize; re-running tf retries the merge safely (detect-first + idempotency read-back).
- **Not on the task branch / detached HEAD:** merge is skipped with a one-time warning; the local finalize completes. Checkout the task branch and re-run to merge.
- **Mid-run tracker failure:** warn once, record the reason, continue local-only; the archive and index are never blocked.
- **Partial prior run** (merge succeeded but archive/index did not): the `**Merged PR:**` read-back skips the re-merge; the archive move is skip-if-present; the index is re-updated — the run completes idempotently.
- **Index update fails:** non-fatal — the finalize still succeeds; the index outcome is reported as failed.

---

## Final Output

```
TF — <finalized | already-finalized | partial>

Task: {task-id} — <title>
Merged PR: <url | already merged (url) | skipped (no delivery provider) | failed (reason)>
Resolution comment: <posted | skipped (no tracker) | failed (reason)>
Status: <closed as <status> | skipped (no tracker) | failed (reason)>
Archive: {task-root}/_archive/{task-id}/
Index: <updated | update failed (reason)>
Next: none — terminus
```

`finalized` — every applicable step completed; an unconfigured provider counts as a clean skip, not a failure (the bare-core finalize is a `finalized`). `partial` — the local archive and index completed but a **configured** provider step failed mid-run (merge blocked, tracker error); the finalize can be re-run to retry that step. `already-finalized` — the task was detected already archived.

**The final output block must always be the very last thing output to chat.**
