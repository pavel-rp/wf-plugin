---
name: pr
description: Opens a pull request for the current task branch — first commits and pushes any pending work (via the wf:commit subagent, push on), then composes a PR body from the task's wf artifacts (reqs, spec, plan resolution, verify, QA), links the work item through the active tracker capability, when one is registered, and creates the PR through the active delivery provider. Use when a task is implemented and ready for review. Pass --no-commit to open a PR against exactly what's already pushed, --draft for a draft PR.
allowed-tools: [Read, Task, Bash]
---

# /wf:pr — Push, then open a PR from the task's wf artifacts

Opens a PR for the current task through the project's active delivery provider. This skill is a **light orchestrator**, not a pure thin wrapper: it makes two host-level **Task** calls — first `wf:commit` (to commit + push), then `wf:pr` (to compose the body and create the PR). The orchestration lives in the host (not inside a subagent) on purpose: it keeps every nested **Task** call at the single level of depth this library has proven (host → agent → agent), while the heavy context (the full diff, all artifacts) still stays entirely inside the two subagents. The host only ever sees two short result blocks.

**How a PR is opened:** core opens and detects pull requests through the project's active **delivery provider** — it does not know or name which concrete tool implements that. The work item is linked through the active tracker capability's `attach_link` operation, when one is registered — a side-effecting embed of the tracker's own work-item link form (core doesn't know or name that concrete form, and the operation returns nothing observable), which the tracker attaches when the PR merges; with no tracker registered, the body carries no work-item link at all. Prerequisite: a delivery provider must be registered, and its underlying tool authenticated, before this operation can succeed.

---

## Prerequisites

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

Confirm the project is initialized by querying the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })`. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop: "Run `/wf:init` first." If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. This host reads no core config value here beyond the initialized check — the two subagents re-resolve the id and `{task-root}` themselves.

---

## Command Syntax

```
/wf:pr [<id>] [--draft] [--base <branch>] [--no-commit]
```

| Argument          | Required | Description                                                                                                       |
| ----------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `<id>`            | NO       | Task id — opaque (the active tracker's shape, or the local `T<NNN>` scheme when none is registered). Falls back to inferring from the current branch. |
| `--draft`         | NO       | Open the PR as a draft.                                                                                           |
| `--base <branch>` | NO       | Base branch for the PR. Defaults to the repository's default base, resolved through the delivery provider.        |
| `--no-commit`     | NO       | Skip the commit+push step and open a PR against exactly what's already pushed. (The branch must already exist on the remote.) |

---

## Safety Rules

**Allowed:**

- Read the task folder; obtain config via the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query.
- Read-only resolution for ID/branch inference (`workspace-root-resolve` via `resolve_config({ workspaceRoot, ... })` `workspaceRoot`, `current-branch-query` via `resolve_provider({ workspaceRoot, surface: "delivery" })`).
- Resolve providers once for the run (Phase 1.5): call `resolve_provider({ workspaceRoot, surface: "delivery" })` and `resolve_provider({ workspaceRoot, surface: "tracker" })` on the `wf-resolver` service — metadata records only; the diff and PR body stay inside the subagents.
- Invoke the **Task** tool with `subagent_type` `wf:commit` and `wf:pr`.

**Forbidden:**

- Modify any source file — this skill only orchestrates; the subagents invoke the delivery provider.
- Run any destructive delivery operation.
- Author commits or PR bodies inline — that is the subagents' job, and keeps the diff and artifacts out of this context.

---

## Phase 1 — Resolve the task ID

Resolve `{task-id}` (the opaque task id — whatever shape the active tracker produced, or the local `T<NNN>` scheme): use the passed value verbatim. If none was passed, leave it unset and let the subagents infer it from the current branch — each resolves the branch-inferred token against `{task-root}` itself, so this skill never reconstructs an id from a prefix.

## Phase 1.5 — Resolve providers once (the run's single resolution point)

This host is the **single resolution point** for the `/wf:pr` run: it resolves each required provider surface **once** and forwards the result to the subagents it spawns, so `wf:commit`, both of `wf:pr`'s surfaces, and any nested `wf:branch` consume it without re-resolving (`invocation-runtime.ops.md` §"Run-scoped provider forwarding").

Call the bundled `wf-resolver` MCP tool `resolve_provider` **once per required surface** — `resolve_provider({ workspaceRoot, surface: "delivery" })` and `resolve_provider({ workspaceRoot, surface: "tracker" })`. Each returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`; the resolver has already read the `## Capabilities` registry, each owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"), so the host performs **no** registry / manifest / plugin-root read of its own. Hold each surface's record — its `owner` + resolved `fragmentPath`, or its `state: unconfigured`/`unrecoverable` outcome (with `diagnostics` for the hedged diagnosis) — to forward below. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry as a fallback (WF-272 diagnostics/recovery).

Only these two typed queries happen in the host; the diff and PR-body artifacts stay inside the subagents, so isolation is preserved. The records are run-scoped runtime values — no concrete provider is named in this skill.

## Phase 2 — Commit and push (unless --no-commit)

Unless `--no-commit` was passed, call `resolve_routing` immediately before commit work with
`workspaceRoot: <absolute pwd -P workspace root>`, `role: "commit"`, `unitIds: ["pr:commit"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic",
unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "elevated", toolWork:
"material", validation: "mechanical", contextIsolation: "required", independentReview:
false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`,
`supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit the compact
operational record separately from commit or artifact attribution. Hard-stop on `status:
stop` or non-null `diagnostic`; otherwise obey `executionShape` exactly, pass the model
selector only when non-null, and preserve inherited effort.

Then invoke the **Task** tool with `subagent_type: wf:commit`, passing `id: {task-id}` (or omit `id` when unset, so `wf:commit` infers from the task branch name), `push: true`, `staged: false`, **and the forwarded `delivery` resolution record from Phase 1.5** (the optional spawn extension — `invocation-runtime.ops.md` §"Run-scoped provider forwarding"), so `wf:commit` and the `wf:branch` it may nest consume it instead of re-resolving.

Gate on its `COMMIT —` block:

- `COMMIT — Error` → stop and surface the reason. Do not proceed to PR creation.
- `Push:` value starting with `failed` → stop: "Push failed — cannot open a PR against an unpushed branch. <push reason>"
- `COMMIT — committed` or `COMMIT — nothing-to-commit` with a non-failed push → proceed to Phase 3.

Surface a single one-line summary of the commit result (e.g. "Committed 4 files, pushed." or "Nothing new to commit; branch up to date."). Do **not** reprint the full `COMMIT` block — the `PR` block is this skill's final output.

If `--no-commit` was passed, skip straight to Phase 3.

## Phase 3 — Compose the body and create the PR

Call `resolve_routing` independently immediately before PR-agent work with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "pr"`, `unitIds: ["pr:author"]`,
`shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1,
unitsIndependent: false, ambiguity: "bounded", risk: "elevated", toolWork: "material",
validation: "mechanical", contextIsolation: "required", independentReview: false,
returnContract: "mechanically-judgeable", requestedParallelism: 1 }`,
`supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit its own compact operational record; provider records remain forwarded
unchanged and are never absorbed into routing metadata. On `status: stop` or non-null
`diagnostic`, stop before PR creation. Otherwise obey `executionShape` exactly, invoke one isolated Task, pass the model selector only
when non-null, and preserve inherited effort. Retain a sufficient result; any
bounded retry is parent-owned and accepts only contract-defined insufficiency.

Invoke the **Task** tool with `subagent_type: wf:pr`, passing:

- `id` — `{task-id}` (omit when unset — the subagent infers it from the current branch)
- `draft` — `true` if `--draft` was passed, else `false`
- `base` — the `--base` value, or omit to let the subagent resolve the repository's default base via the delivery provider
- the forwarded `delivery` and `tracker` resolution records from Phase 1.5, so `wf:pr` consumes both surfaces without a resolution walk of its own (`invocation-runtime.ops.md` §"Run-scoped provider forwarding")

Emit the subagent's `PR —` block verbatim as this skill's final output.

---

## Edge Cases

- **Not on a task branch + `--no-commit`:** the subagent stops (`PR — Error`) — it won't create a branch in no-commit mode. Drop `--no-commit` (so `wf:commit` runs its branch gate) or run `/wf:branch` first.
- **No resolvable workspace root** — `PR — Error`; with a delivery provider active, `workspace-root-resolve` found no working tree to resolve.
- **Push failed in Phase 2:** stop before PR creation — the branch isn't on the remote.
- **PR already open for this branch:** the subagent returns `PR — exists` with the existing URL rather than creating a duplicate.
- **Delivery provider not authenticated:** the subagent returns `PR — Error` with the provider's own authentication-remedy hint.
- **No readable delivery provider (two-mode diagnosis):** the subagent returns `PR — Error`; no delivery operation of any kind is attempted. It splits the reason on the `resolve_provider({ workspaceRoot, surface: "delivery" })` record's `state`: **(a) `state: unconfigured`** (no capability owns `delivery`) — states plainly that no delivery provider is registered and names the remedy (register a capability that owns the `delivery` surface, e.g. install and run `/wf-git:init`); **(b) `state: unrecoverable`** (a registered capability's manifest can't be read — its recorded root dangled and the install-manifest self-heal recovered nothing) — names the record's `diagnostics` pack as a hedged candidate ("if this is your `delivery` provider, fix its stale root / re-run its init"), never asserting one owns the surface and never telling you to register a provider you already have.
- **No tracker registered:** the composed body omits the Work-item link section and the "Resolves…" sentence entirely; no tracker operation is attempted and no capability term appears anywhere in the output.
- **Registered-but-unrecoverable tracker** (the `tracker` record's `state` is `unrecoverable`): a registered capability's manifest can't be read after the install-manifest self-heal — the subagent's tracker `get` (a read) stays silent while the `attach_link` (a write) warns once in the hedged candidate-naming form (naming the record's `diagnostics` pack, never asserting ownership) on the `Body sources:` line, for a net of one warn driven by the write; the body composes local-only with no work-item link and PR creation still proceeds. This tracker residual is independent of the delivery-write `PR — Error` above — both can surface when both surfaces are unrecoverable.
- **Mid-run tracker failure:** a `get`/`attach_link` call that errors after a tracker was registered — the subagent warns once (naming the operation and the error) as a parenthetical on the `Body sources:` line, composes a local-only body with no work-item link, and PR creation still proceeds.

---

## Final Output (emitted by the wf:pr subagent)

```
PR — <created | exists>

Task: {task-id} — <title>
PR: <url>
Base: <base> ← <branch>
Body sources: <comma-separated artifacts that fed the body, e.g. reqs, spec, plan, verify, qa>
Next: none — terminus; share <url> for review
```

Error:

```
PR — Error

Reason: <one sentence — what went wrong>
```

**The block must always be the very last thing output to chat.**
