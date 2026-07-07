# wf — a domain-free Spec-Driven Development harness

A Claude Code plugin that runs a gated **Spec-Driven Development** chain — spec → plan → tasks → implement → verify → qa — over each task. Each `wf:*` unit is a skill, invocable as a `/wf:…` slash command or auto-loaded by Claude when relevant.

**Core is tracker- and delivery-agnostic** — it names no tracker (Azure DevOps, Linear, …) and issues no VCS command of its own. Work-item and branch/commit/PR mechanics enter through **capability packs** that register against the spine: `wf-git` supplies the delivery (git) provider, `wf-ado` / `wf-linear` the tracker providers. Stack/domain knowledge (migration, browser-QA, Angular test-host, node-ts) ships in `wf-caps`. With **no provider registered, the whole spine still runs fully local** — see [Bare-core](#bare-core-no-provider-registered).

## Install

From the marketplace that ships this plugin:

```
/plugin marketplace add pavel-rp/wf-plugin
/plugin install wf
```

Skills and agents are auto-discovered on install — no per-machine configuration.

Some skills delegate work to **subagents** (the `*.md` files in this plugin's `agents/` folder) for context-isolated reasoning — e.g. `wf:classify` runs its rubric in a subagent so the classification reasoning doesn't pollute the caller's transcript, and `wf:run --auto` drives each chain phase through the `wf:phase-runner` subagent so the per-phase tracker fetch and codebase exploration never reach the orchestrator. Claude Code discovers these agents automatically, and they invoke each other via the **Task** tool (nested delegation works without any setup).

## Before the first task in a new repo

```
/wf:init
```

Creates `_local/` for per-task artifacts, writes default config, gitignores itself, and scaffolds the Node test runner. Idempotent — safe to re-run.

## Pick the flow (optional)

```
/wf:triage <id>    # score the task and recommend lite | full | split | blocked | clarify
```

Cheap read-only advisor. Fetches `00_reqs.md` if absent, does a bounded repo scan, scores 5 dimensions (scope, clarity, design, risk, dependencies), and prints the exact next command to run. Safe to skip if you already know which flow fits.

## Drive the whole chain (optional)

```
/wf:run <id>          # default: walk the safe front of the chain hands-off, halting at the first gate
/wf:run <id> --step   # one phase at a time: name the next command and stop
```

A state-aware dispatcher over the chain below. It reads the task folder's artifacts, works out which phase is done and which is next, and enforces the gate (stops before any source-writing, approval-gated, or browser phase) — routing to `/wf:lite` when triage says the task is small, and looping verify⇄fix and qa⇄followup (capped at 2 cycles each). **By default it runs the safe front of the chain itself** — `triage→spec→plan`, then `verify-spec→qa-gen` once `implement` has landed — driving each phase through the `wf:phase-runner` subagent (isolated context) and re-deriving state between them, halting before the first phase that writes product source or needs a human (`implement`, `verify-fix`, `qa-followup`, `qa-auto`). Pass `--step` to instead name one command at a time and stop. Resumable either way: after a phase finishes, `/clear` and run `/wf:run <id>` again — it re-derives where you are from the artifacts, so nothing is lost.

## Standard workflow for a new ticket

```
/wf:spec <id>      # fetch the work item's requirements via the active tracker + write grounded spec
/wf:plan <id>      # build checkbox-driven implementation plan
/wf:tasks <id>     # decompose the plan into small, independently testable units
/wf:implement <id> # execute the plan step by step — does not commit
/wf:commit <id>    # commit current changes, terse auto-message (--push to push)
/wf:pr <id>        # commit+push, then open a PR (via the active delivery provider) from the wf artifacts

/wf:branch <id>    # create task branch (auto-invoked by the others)
```

`/wf:tasks` is the **decomposition gate** between `plan` and `implement` — the canonical Spec-Driven Development `tasks` phase. It reads the approved plan and writes `03_tasks.md`: an ordered list of small, independently testable units, each one a TDD-sized increment with its own way to prove it done. Because decomposition is gated separately from strategy, a task list can be regenerated without re-planning. It's optional on the standard chain (`/wf:implement` reads the plan directly) but recommended for larger items where the breakdown wants its own review. On top of the generic decomposition it **fires the `tasks` phase**, appending any task-list contributions the project's registered capabilities attach (additive, in registry order) — with none registered, the generic decomposition stands alone.

`/wf:commit` authors the message in an isolated subagent (the diff never hits the main context): the first commit on the branch is `<id>: <task name>`, every later commit `<id>: <concise summary>` plus a bulleted what-changed body. `/wf:pr` first runs `/wf:commit --push` (a no-op when the tree is clean), then composes a PR body from the task's artifacts (reqs, spec, plan resolution, verify, QA), links the work item through the active tracker's attach-link operation (when one is registered), and opens the PR through the active delivery provider.

Once you're on the task branch, `<id>` is optional — every `wf:*` skill infers it from the current branch name.

## Fast path for small tickets

```
/wf:lite <id>      # one-pass spec+plan+implement for S-complexity items
```

Collapses spec→plan→implement into a single skill run with one approval gate. Writes `00_reqs.md` (trail) and a combined `lite.md` (mini-spec + plan + resolution). Use when the task is a 1–3 file change with no architectural or schema work. For anything ambiguous or cross-cutting, stay on the full chain above.

## Auxiliary skills

| Skill | What it does |
|---|---|
| `/wf:constitution` | Establishes and re-runnably updates the project's composed constitution (core process articles + each capability's non-negotiables + project clauses, provenance-tagged, project clauses winning). Writes `_local/constitution.md` and maintains the `## Capabilities` registry; auto-invoked by `/wf:init`. |
| `/wf:verify-spec` | Strict, evidence-based audit of the current branch against the task spec, aggregating any capability `finding`s at the `verify` phase. Use before opening a PR. |
| `/wf:verify-fix` | Reads `04_verify.md`, auto-fixes mechanical FAIL/PARTIAL findings with a specific expected value, and presents ambiguous findings as open questions. Run after `/wf:verify-spec` to clear the obvious stuff. |
| `/wf:classify` | Classifies a task into one of seven branch-type buckets (`feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) with calibrated confidence. Other skills call it when `--type` isn't passed. |
| `/wf:index` | Updates one row in the per-task `index.md` manifest. Other skills call it after writing any artifact so the index stays in sync. Lean. |
| `/wf:seed` | Parses an architecture/design doc's action-items checklist into an append-only `_local/` backlog (default `{task-root}/BACKLOG.md`, configurable via the **Backlog Path** config key) — one `T<NNN>` stub per item, each carrying a local id and a resolvable `<doc> § <section>` ref — so a later `/wf:spec T<NNN>` starts with grounded context. Append-only and re-runnable: a second run adds only newly-appeared items. Bare-core: no tracker/VCS coupling, local ids only. |
| `/wf:qa-init` | Build or refresh the project QA-rules artifact (`_local/wf-qa.md`) for the QA family — `/wf:qa-gen` reads the `{qa-rules}` pointer at plan-generation time, and the report severity rubric (defined in qa-gen's report format, applied by `/wf:qa-run`/`/wf:qa-auto` when `07_qa-report.md` is written) resolves from the artifact. A bounded read-only scan detects the project's own stack/risk/environment signals and reflects them into a domain-free questionnaire (risk areas, environment, severity, acceptance), then writes the rules (including the severity rubric) and sets `{qa-rules}` to the artifact path. Re-runnable: update mode merges newly-derived rules while preserving manual edits. |
| `/wf:qa-gen` | Generate a QA plan for the task (`06_qa.md`). UI criteria become **browser** scenarios; backend criteria become **API** scenarios that exercise the endpoint over HTTP with a real token. On top of the generic plan it **fires the `qa-generation` phase**, aggregating any scenarios contributed by the project's registered capabilities (provenance-tagged) — with none registered, the generic plan stands alone. Every plan ends with a standing **Baseline health** suite — including a **visual-baseline** scenario carrying the `**Visual:** yes` marker (absolute visual-defect detection: overlap/clipping/crowding/mis-rendered controls; not pixel-diffing) for a browser target. A backend-only task is never a stub PASS. |
| `/wf:qa-run` | Interactive walkthrough of `06_qa.md` — prompts the tester step by step for browser scenarios, presents `Type: API` scenarios as a request + ready curl command, then writes `07_qa-report.md`. Use when a human is the tester. |
| `/wf:qa-auto` | Autonomous QA run **orchestrator**. Resolves the task/plan, enforces the branch gate, manages run lifecycle (resume / `--batch` / `--only`), and **dispatches the per-scenario drive to the `qa-execution` engine** registered in the capability registry — it names no stack and drives no browser itself. Assembles `07_qa-report.md` with the Summary, traceability matrix, and full-run console/network rollup; a `**Visual:** yes` scenario carries a `**Visual:**` evidence sub-block (screenshot + geometry findings + rubric verdict) even on PASS. Requires a registered execution capability (e.g. `wf-caps` browser-qa); stops cleanly if none is active. Use `--batch <N>` + `--resume` to chunk long runs across context windows. |
| `/wf:qa-followup` | Follows up a QA report: triages every non-PASS scenario, unblocks harness blocks, root-causes FAIL defects, writes a checkbox remediation plan (`08_qa-fix.md`), gates on a single approval, applies fixes, and recommends a fresh QA pass. The QA chain's plan-then-implement defect-fixer. |

All default to zero-argument invocation — they infer context from the current branch.

## Bare-core (no provider registered)

Install `wf` alone — no `wf-git`, no tracker pack, an empty `## Capabilities` registry — and the spine still runs, fully local:

- **Task ids** use the local `T<NNN>` scheme (minted by `/wf:spec`); task folders are `{task-root}/T<NNN>/`. Core never reconstructs an id from a prefix — the id is opaque.
- **No git invocation of any kind (plumbing included).** Every skill's branch gate resolves delivery-surface ownership first and, finding none, **skips with a stated reason** (`Branch gate skipped — no delivery provider registered (bare-core mode)`) instead of erroring. Id inference and the **workspace root** resolve via the plain-directory fallback (the current working directory), never `rev-parse` or any other command.
- **No tracker call and no capability term** in any artifact or output — `/wf:spec` writes a local `00_reqs.md` and continues; a mid-run tracker/MCP failure warns once and falls back to local-only.
- `/wf:branch`, `/wf:commit`, `/wf:pr` are the **delivery** steps, not part of the bare-core spine — they require a registered delivery provider and return a clear `— Error` naming the remedy (install and run `/wf-git:init`) when none is active.

Register `wf-git` (via its `/wf-git:init`) — and a tracker pack (`/wf-ado:init` or `/wf-linear:init`) — to light up branch/commit/PR and work-item integration; core degrades back to local-only the moment they're absent. Exactly one tracker provider may be active at a time (`wf-ado` XOR `wf-linear`; enforced by registry validation).

> **Moved:** `migration-map` (→ `/wf-caps:migration-map`), `qa-host` (→ `/wf-caps:qa-host`), `test-page` (→ `/wf-caps:test-page`), and `test-node` (→ `/wf-caps:test-node`) now ship in the **wf-caps** plugin — `qa-host`/`test-page` as the `angular` stack capability (the `qa-execution` `surface: host` provider, composing with browser-qa's `surface: engine`), `test-node` as the `node-ts` capability. See [`plugins/wf-caps/README.md`](../wf-caps/README.md). Install `wf-caps` to use them.

## Per-task artifacts

Each task gets a folder under `_local/` in the downstream repo. The whole `_local/` tree is excluded from version control, so nothing these skills write ever leaks into a commit.

```
_local/
├── config.md             # /wf:init project config — {task-root}, {verify-command}, the ## Capabilities registry, etc. (registry location is configurable via wf.config.js registryPath; defaults here). Each tracker/delivery pack adds its own section (e.g. ## Azure DevOps, ## Linear) via its own init.
├── profiles/             # /wf:init capability profile overrides — <capability>.profile.json, seeded on divergence from the capability's shipped default
├── qa-creds.md           # /wf-caps:qa-engine test credentials (per-project, shared across tasks)
└── <task-id>/            # one folder per task (tracker id when a tracker is registered, else local T<NNN>)
    ├── index.md              # per-task manifest — every wf:* skill updates a row here
    ├── 00_reqs.md            # requirements — fetched via the active tracker capability, or a local stub in bare-core
    ├── 01_spec.md            # LLM-authored spec (interpretation, may drift)
    ├── 02_plan.md            # checkbox-driven implementation plan
    ├── 03_tasks.md           # /wf:tasks decomposition — small, independently testable units
    ├── 03_migration-map.md   # optional — mapping table output
    ├── 04_verify.md          # /wf:verify-spec audit report — latest run
    ├── 05_verify-fix.md      # /wf:verify-fix log of auto-fixed findings + open questions
    ├── 06_qa.md              # /wf:qa-gen QA plan, scenarios traced to spec criteria
    ├── 07_qa-report.md       # /wf:qa-run or /wf:qa-auto results
    ├── 08_qa-fix.md          # /wf:qa-followup remediation plan + fix log
    ├── triage.md             # /wf:triage advisor output
    ├── lite.md               # /wf:lite fast-path output
    ├── tests/                # /wf-caps:test-node Node test files (.test.ts)
    ├── research/             # exploration notes
    ├── assets/               # mockups, screenshots, traces
    └── artifacts/            # diffs, screenshots, API responses from /wf:qa-auto captures
```

`00_reqs.md` is the **only authoritative spec**. `01_spec.md` and `02_plan.md` are derived artifacts; `/wf:verify-spec` deliberately audits the branch against the task spec — not a derived plan — to catch drift, and aggregates any capability `finding`s at the `verify` phase.

## Direction

`wf` is being reshaped into a **domain-free SDD engine**: a fixed phase spine (`spec → plan → tasks → implement → verify → qa`), a **capability registry** at a configurable location (`wf.config.js` `registryPath`, default `_local/config.md`), and a composed **constitution** — with all stack/domain/project knowledge moving out of core into composable **capabilities** (migration as an `adapter`, browser-automation QA and the Angular stack as their own capabilities). On `/wf:init`, each registered capability that ships a profile template gets a downstream **override** seeded into `_local/profiles/` **only when the project diverges** from the capability's shipped default template — the baseline shape, which may carry placeholder slots (hybrid precedence: downstream override > capability default). Composition is runtime inline-prose injection — no codegen.

The tracker/delivery split has **shipped**: core carries zero git/tracker knowledge (branch/commit/PR speak only the abstract delivery contract; work items only the abstract tracker contract), the `wf-git`/`wf-ado`/`wf-linear` packs supply the concrete bindings, and bare-core runs fully local. The `tasks` and `constitution` phases and the capability registry are in place. Remaining stack/domain generalisation is tracked in Linear (team `WF`) against [`docs/ROADMAP.md`](../../docs/ROADMAP.md).

## Authoring

See the repo-root **[CLAUDE.md](../../CLAUDE.md)** for conventions when adding or editing skills and agents, and [`docs/ROADMAP.md`](../../docs/ROADMAP.md) for the target architecture.
