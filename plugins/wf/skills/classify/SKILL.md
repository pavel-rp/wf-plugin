---
name: classify
description: Classifies a task into one of seven branch-type buckets (feat, fix, chore, refactor, migration, docs, hotfix) with a calibrated confidence (high/medium/low). Reads requirements from a file or raw text, delegates the rubric to its subagent for context-isolated reasoning, and emits a structured verdict for downstream skills (wf:spec, wf:plan, wf:lite, wf:branch). Use when another skill needs to determine task type without hardcoding a feat/fix-only assumption.
allowed-tools: [Read, Glob, Grep, Bash, Task]
---

# /wf:classify — Branch-type classifier with confidence

Classify a task into one of seven branch-type buckets and return a calibrated confidence. Reads `01_spec.md` (or `00_reqs.md` if no spec yet) from a task folder, delegates the rubric to its subagent, and emits a structured verdict that downstream skills consume to set commit type, branch prefix, and spec/plan metadata.

**Read-only. Does not write artifacts. Does not branch, plan, or implement.**

---

## When to use

Reach for `/wf:classify` from inside another skill when that skill needs the task's type and `--type` was not passed by the user. Replaces the duplicated keyword scan currently embedded in `wf:spec`, `wf:plan`, and `wf:lite`. Also usable standalone if you want to sanity-check what type the workflow will pick.

**Do NOT use `/wf:classify` when:** the user passed `--type` explicitly (already authoritative — confidence is `high` by definition), or the task folder doesn't yet have requirements (run `/wf:spec` Phase 0 first to fetch them).

---

## Command Syntax

```
/wf:classify [<id> | --file <path> | --text "<inline>"]
```

### Arguments

| Argument          | Required | Description                                                                                       |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------- |
| `<id>`            | NO       | Task id — whatever shape the active tracker capability produces (opaque to core), or a local `T<NNN>` id when no tracker is registered. Resolves to `{task-root}/{task-id}/01_spec.md` if it exists, else `00_reqs.md`. Falls back to inferring from the current branch. |
| `--file <path>`   | NO       | Explicit path to a markdown/text file to classify. Bypasses task-folder resolution.               |
| `--text "<inline>"` | NO     | Inline requirement text. Use when classifying ad-hoc input without a file.                        |

Exactly one of the three input modes is used. Resolution: `--text` > `--file` > `<id>` > inferred id. If none can be resolved, stop: "No input provided. Pass a task id, `--file <path>`, or `--text "..."`."

### Folder Resolution (when using `<id>`)

Only attempted when neither `--file` nor `--text` is passed.

Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

- Obtain `{task-root}` from the `wf-resolver` `resolve_config({ workspaceRoot, ... })` query (`coreConfig.taskRoot`; core performs no direct config-file parse). If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop: "Run `/wf:init` first." If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback.
- If `<id>` is provided, treat it as opaque — whatever shape the active tracker capability produces, or the local `T<NNN>` scheme — and use it verbatim as `{task-id}`.
- If `<id>` is omitted, infer a numeric token via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query — see "Direct provider resolution" below): extract the first 3+-digit run from the resolved branch name, call it `{numeric-id}`. Resolve that token against `{task-root}`: apply the same first-3+-digit-run extraction to each existing folder's name and compare it to the token, mirroring `spec/SKILL.md`'s Validation-section resolution logic. Exactly one match — reuse that folder's full name as `{task-id}` verbatim. Zero matches — stop: "The branch-inferred token `<token>` doesn't match an existing task folder. Pass a task id, `--file <path>`, or `--text "..."`." More than one match — stop: "The branch-inferred token `<token>` matches more than one task folder. Pass a task id explicitly, or use `--file <path>` / `--text "..."`."
- **Input source preference:** `01_spec.md` (richer, post-spec) > `00_reqs.md` (raw requirements). First available wins.
- If neither file exists, stop: "No `01_spec.md` or `00_reqs.md` found in `{task-root}/{task-id}/`. Run `/wf:spec {id}` first."

### Direct provider resolution (how `current-branch-query` is reached)

Branch inference above reaches `current-branch-query` by resolving the `delivery` surface with the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query — the typed query that returns the run-scoped resolution record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any plugin-anchored root (post install-manifest self-heal, `capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal"); this skill performs no registry / manifest / plugin-root read of its own. Obtain the op body via `resolve_content({ workspaceRoot, ... })` (`class: fragment`, keyed on the record's `owner` and fragment `ref`) and follow it in-context to dispatch `current-branch-query` — never a raw `Read` of the path. On `state: unconfigured` or `unrecoverable` (no readable `delivery` provider), `current-branch-query` falls back silently to the plain-directory / already-known-branch case — no error, no capability term surfaces. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded — do not hand-parse the registry (WF-272 diagnostics/recovery). (classify has no tracker-surface call site — it never fetches.)

---

## Safety Rules

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`).
- Read-only resolution via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query) for id inference.
- Invoke the **Task** tool to delegate to the `wf:classify` subagent. **The subagent is the only place the rubric runs** — this skill never classifies inline.

**Forbidden:**

- Write any file. Classification is read-only — consumers persist the result, not this skill.
- Modify source files.
- Run builds, tests, or installs.
- Fetch from a tracker directly. Use already-resolved `00_reqs.md`/`01_spec.md` only — fetching is `/wf:spec` Phase 0's job.
- Implement the rubric inline. If subagent invocation is unavailable, stop and report — see Phase 2.

---

## Phase 1: Resolve Input

1. If `--text "<inline>"` is provided, use the inline string as the classifiable content. Skip to Phase 2.
2. Else, if `--file <path>` is provided, validate the file exists. If missing, stop: "Input file not found at `<path>`."
3. Else, resolve the task id (passed or inferred from branch) → task folder → first-available of `01_spec.md`, `00_reqs.md`. The subagent will read it itself; just hold the path.
4. The classifiable content is the **title + description + acceptance criteria** sections only. Strip metadata blocks (frontmatter, `**Type:**`, `**Created:**`, etc.) so prior classification labels don't bias the rubric. (This stripping is the subagent's job when it reads the file — caller just hands over the path or text.)

---

## Phase 2: Delegate to the subagent

**Caller stops here.** Call `resolve_routing` immediately before delegation with `workspaceRoot: <the absolute workspaceRoot captured in Prerequisites>`, `role: "classify"`, `unitIds: ["classify:single"]`, `shapeEvidence: { workSurface: <"caller-context" for --text | "external-context" for a file/task input>, atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "bounded", risk: "low", toolWork: <"none" for already-held text | "bounded" when the callee reads input>, validation: "judgment", contextIsolation: "useful", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit its compact metadata. If `status: stop` or `diagnostic` is non-null, emit `CLASSIFY — Error` with the routing diagnostic and do not dispatch. Otherwise obey `executionShape` exactly per `invocation-runtime.ops.md` §"Resolver call root"; this one-unit judgment-validation evidence selects `isolated`, so invoke one **Task**. Pass its model selector only when non-null and preserve inherited effort when null. Invoke the **Task** tool with `subagent_type: wf:classify`, passing the resolved input:

- For file mode: pass the file path. The subagent will read it.
- For text mode: pass the raw text inline.

Use the subagent's `CLASSIFY — Complete` block as this skill's output verbatim. Do **not** read or execute the Procedure section below — that's the subagent's job.

---

## Type vocabulary (for callers)

The verdict's `Type` field is exactly one of: `feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`. Definitions live in the Procedure section below; callers don't need them — they just persist the value into spec/plan metadata and use it to derive the branch prefix.

---

## Procedure (subagent execution — caller, skip this section)

The subagent's rubric — the type buckets, decision rules, confidence anchors, edge cases, and output shape — lives at `rubric.md`, obtained via the resolver's `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `skill: classify`, `ref: rubric.md`), never a raw `Read` of the plugin-cache path. It is the single source of truth for the classification logic, read **only by the `wf:classify` subagent** on invocation (`agents/classify.md` boots from that reference alone). The host LLM running `/wf:classify` directly does NOT read it — it stops at Phase 2 and delegates. Moving the rubric out of this caller-facing body is what keeps a subagent spawn small (it no longer eagerly loads this whole file).

---

## Consumer contract

Skills that call `wf:classify` (`wf:spec`, `wf:plan`, `wf:lite`, indirectly `wf:branch`) should:

1. Immediately before dispatch, call `resolve_routing` with `workspaceRoot: <the absolute workspaceRoot captured before the first bundled resolver call>`, role `classify` with the typed `shapeEvidence` from Phase 2 (caller/external context as the input warrants; one atomic unit; bounded ambiguity; judgment validation; mechanically judgeable return; useful isolation; parallelism 1). If `status: stop` or `diagnostic` is non-null, stop with `CLASSIFY — Error`. Otherwise obey the returned `executionShape` per `invocation-runtime.ops.md` §"Resolver call root", pass a non-null model selector, and preserve inherited effort when null. This evidence selects `isolated`, so invoke one **Task** with `subagent_type: wf:classify`, passing the resolved input (task id once requirements are fetched, or a file path).
2. Parse `Type` and `Confidence` from the structured block.
3. Branch on confidence:
   - **high** → use silently.
   - **medium** → use the primary type, but include `Alternative: <type>` in the spec/plan metadata so the user can see the second-best fit.
   - **low** → raise an `AskUserQuestion` with the primary and alternative as options before writing any artifact.
4. Persist the chosen type in spec/plan metadata so re-runs (e.g., `/wf:plan` after `/wf:spec`) reuse the result instead of re-classifying.

User-supplied `--type` always wins over `/wf:classify` and is treated as `Confidence: high`.

---

## Edge Cases

- **Empty/placeholder description:** subagent returns `Type: feat, Confidence: low, Reason: no substantive description; defaulted to feat.`
- **Multiple type tags in title** (`[Fix][Refactor]`): subagent picks the first; sets `Confidence: medium`; places the other in `Alternative`.
- **Title contradicts description** (title says "fix typo", description describes a new endpoint): subagent trusts the description; flags the contradiction in `Reason`.
- **Non-English description:** subagent classifies on whatever signals are translatable (entity names, type tags). If untranslatable, `Confidence: low`.
- **No input at all** (no ID, no file, no text, no branch ID): caller stops in Phase 1 with the syntax help.

---

## Final Output

Success:

```
CLASSIFY — Complete

Type: <feat | fix | chore | refactor | migration | docs | hotfix>
Confidence: <high | medium | low>
Alternative: <type | —>
Reason: <one sentence — what evidence in the input drove the decision>
```

Error (input unreadable, no substantive content, or other unrecoverable condition):

```
CLASSIFY — Error

Reason: <one sentence — what went wrong>
```

**The final output block must always be the very last thing emitted to chat.** Downstream skills grep for `CLASSIFY — Complete` to locate the verdict and `CLASSIFY — Error` to detect failure; consumers must check for both forms.
