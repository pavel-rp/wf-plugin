# wf — a domain-free Spec-Driven Development harness

A Claude Code plugin that runs a gated **Spec-Driven Development** chain — spec → plan → tasks → implement → verify → qa — over each task. Each `wf:*` unit is a skill, invocable as a `/wf:…` slash command or auto-loaded by Claude when relevant.

**Core is tracker- and delivery-agnostic** — it names no tracker (Azure DevOps, Linear, …) and issues no VCS command of its own. Work-item and branch/commit/PR mechanics enter through **capability packs** that register against the spine: `wf-git` supplies the delivery (git) provider, `wf-ado` / `wf-linear` the tracker providers. Stack/domain knowledge ships in its own pack: browser-QA in `wf-browser-qa`, the Angular test-host in `wf-angular`, node-ts in `wf-node-ts` (migration ships in `wf-caps`, hosted in a separate private marketplace). With **no provider registered, the whole spine still runs fully local** — see [Bare-core](#bare-core-no-provider-registered).

## Install

From the marketplace that ships this plugin:

```
/plugin marketplace add pavel-rp/wf-plugin
/plugin install wf
```

Skills and agents are auto-discovered on install — no per-machine configuration.

Some skills delegate work to **subagents** (the `*.md` files in this plugin's `agents/` folder) for context-isolated reasoning — e.g. `wf:classify` runs its rubric in a subagent so the classification reasoning doesn't pollute the caller's transcript, and `wf:run --auto` drives each chain phase through the `wf:phase-runner` subagent so the per-phase tracker fetch and codebase exploration never reach the orchestrator. `wf:context-distiller` reads bulk delivery output — a failing CI log or a batch of PR review-comment bodies — in its own isolated context and returns only a compact structured verdict, so a caller reasoning over that bulk (a PR-review loop, a retrospective report) never ingests it. Claude Code discovers these agents automatically, and they invoke each other via the **Task** tool (nested delegation works without any setup).

## Before the first task in a new repo

```
/wf:init
```

Creates `_local/` for per-task artifacts, writes default config, gitignores itself, and scaffolds the Node test runner. Idempotent — safe to re-run.

### Configure child routing (optional)

`/wf:init` writes an empty `## Routing` override table in `_local/config.md`:

```markdown
## Routing

| Role | Model | Effort |
|------|-------|--------|
```

Core already routes the bounded `classify` and `branch` roles to the stable `haiku` alias by default, with effort inherited. Add a row only to override a role for this project, for example `| classify | sonnet | high |`. Role names are lowercase slugs and are not limited to the shipped-default roles. `Model` accepts a runtime-supported stable alias or full identifier; `Effort` accepts `low`, `medium`, `high`, or `max`. Leave either cell empty or set it to `—` to inherit that selector independently.

Every routed unit calls the body-free `resolve_routing` MCP query immediately before execution. The caller supplies typed `shapeEvidence` about work surface, atomicity, independence, ambiguity, risk, tool work, validation, isolation value, review need, return contract, and requested parallelism — never a caller-selected execution shape. The resolver returns `inline`, `isolated`, or `bounded-parallel`; callers must obey it exactly and stop before work on any diagnostic. Bounded-parallel work completes every independent unit while limiting concurrency to the minimum of unit count, the positive caller bound, and the core maximum of four. It also resolves host enforcement → invocation override → project row → shipped role default → inheritance, validates model and effort independently, and returns compact provenance plus masking/fallback diagnostics. A host-enforced value wins and records the lower choice it masked; an optional malformed, unavailable, or selector-unsupported choice falls back explicitly to inheritance, while a required-but-unhonorable choice stops before dispatch.

After a routed attempt, the parent may submit typed `postAttempt` evidence to the same query. Sufficient work returns terminal `retain`; insufficient work may return one parent-owned `retry` at the next stable `haiku → sonnet → opus` tier, naming only failed bounded-parallel units while retaining successful ones. Retries preserve prior routing and validation context, recompute execution shape through the same evidence selector, and stop on invalid provenance, masking, unavailability, non-advancing tiers, or exhaustion. Two total attempts are allowed by default; the sole shipped exception permits `security-auditor` a third attempt only when its signal set is exclusively high-severity review uncertainty, and no policy exceeds three. Children never spawn replacements and successful work is never rerun for reassurance. Routing metadata is operational only — artifact `**Model:**` attribution still records the model that actually authored the artifact.

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

## Ship a task end-to-end, unattended (optional)

```
/wf:ship <id>      # one task → merged PR, no pause: drive the build chain, open the PR, wait for green checks, merge
```

The full-auto single-task runner. It **requires** a registered delivery provider (there is nothing to merge without one) and drives one task all the way to a merged pull request without a human pause: it clears every gate `/wf:run` halts at (following `/wf:run`'s own handoff, so it drives whatever phases the pipeline defines), opens the PR through `/wf:pr`, **waits for the delivery checks to settle — never merging a red one** — and finalizes the merge through `/wf:tf`. A pure orchestrator: it writes nothing itself; the phases and `/wf:tf` own every write. Stops honestly with a `SHIP — Blocked` block (naming the missing provider, a failed build phase, red or unsettled checks, or a blocked finalize) rather than forcing a partial merge. The review-address loop is **out of scope** — `ship` carries a single marked stub at the point where a future skill-level *slots* mechanism will attach a review step, and drives no reviewer.

## Ship a whole wave in dependency order (optional)

```
/wf:fleet <ids-or-umbrella>   # fan a set of related tasks out to isolated /wf:ship shippers, in blocker-respecting order
```

One level above `/wf:ship`. It takes **many** related tasks — an explicit id list or a tracker umbrella — builds their dependency graph from real blocking edges (via the tracker's `list_blockers` operation) plus `--after` same-file-contention edges, validates it acyclic, and then runs a tick loop that keeps a pool of isolated `/wf:ship` shipper subagents running: it dispatches each item only once every item it depends on has merged, supervises the fleet for stalls (recycling a genuine zero-artifact stall, resuming an interrupted agent, taking over a mechanical tail, never disturbing one making progress), and — in tracker mode — resolves the umbrella parent(s) with a per-child summary at the end. State lives in a durable `_local/fleet/scoreboard.md`, so a bare `/wf:fleet` re-invocation resumes an interrupted run. Like `/wf:ship` it **requires** a registered delivery provider and stops honestly with a `FLEET — Blocked` block when none is; it runs **tracker-free** on an explicit id list plus `--after` edges (no umbrella expansion, no tracker edges). A pure orchestrator: it writes no source itself and reaches delivery/tracker state only through the abstract provider contracts and the runtime Agent tool. `--model` pins one shipper tier; by default it picks per item by complexity.

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
| `/wf:charter` | One level above `/wf:spec`: turns a vague end-to-end feature idea into a converged umbrella **charter** plus a set of independently shippable **sub-tasks**. Interviews the idea (≤5 ranked questions), then drives a writer→decomposer→reviewer convergence loop (isolated `wf:charter-writer`/`-decomposer`/`-reviewer` subagents) with deterministic routing, a ≤3-round cap, a no-progress guard, and four terminal statuses (`Converged`, `Converged with warnings`, `Needs input`, `Blocked`). On convergence it **publishes** through the abstract `tracker` provider (direct provider resolution, no tracker named): `create_umbrella` for a minted charter or `update` to append onto an adopted issue (pass an existing issue id and it adopts that as the umbrella), then `create_child` per sub-task in dependency order (`Depends on:` rewritten to the real created ids) with a `post_comment` summary — recording every minted id into a local ledger (`**Tracker:**` line + `## Published ids`) so a partial publish resumes idempotently via `list_children`. With **no tracker registered** it falls back to seeding each sub-task as a local `T<NNN>__<slug>/` folder with an `01_spec.md`. Either way it maintains a top-level `{task-root}/INDEX.md`; the terminus is a hand-off — `Next: /wf:run <first-sub-id>` in tracker mode, `Next: /wf:plan <first-sub-task-id>` locally — never an execution. |
| `/wf:constitution` | Establishes and re-runnably updates the project's composed constitution (core process articles + each capability's non-negotiables + project clauses, provenance-tagged, project clauses winning). Writes `_local/constitution.md` and maintains the `## Capabilities` registry; auto-invoked by `/wf:init`. |
| `/wf:verify-spec` | Strict, evidence-based audit of the current branch against the task spec, aggregating any capability `finding`s at the `verify` phase. Use before opening a PR. |
| `/wf:verify-fix` | Reads `04_verify.md`, auto-fixes mechanical FAIL/PARTIAL findings with a specific expected value, and presents ambiguous findings as open questions. Run after `/wf:verify-spec` to clear the obvious stuff. |
| `/wf:tt` | Authors convention-matching tests for the current branch's changed files. Resolves the change set through the delivery provider's `branch-changes-read`, decides which changes warrant coverage, discovers the project's own test framework/conventions and mirrors them (a framework-agnostic **discover-and-match** default), and on top of that **fires the `implement` phase**, aggregating any test-authoring `guidance` the registered capabilities attach — so authored tests follow the stack's idioms when a testing capability is registered, and the discover-and-match default stands alone when none is. Then runs the tests and reports. Creates or modifies **only** test files. Detects a missing delivery provider via surface-resolution (not the read op's return) and degrades to an explicit `--files` list or a plan/tasks-derived change set — never a raw version-control fallback. |
| `/wf:tf` | Finalizes a completed task — the chain terminus. Merges the task's pull request through the active delivery provider (`pr-merge`), posts a resolution comment and moves the work item to its terminal status through the active tracker provider (`post_comment` + `set_status`, `--status` overrides the default `Done`), then archives the task folder to `{task-root}/_archive/` and updates the per-task index locally. Names only abstract provider operations. Degrades to local-only when a provider is unconfigured or fails mid-run — the local archive and index always complete, and the local `09_finalize.md` record is the source of truth. |
| `/wf:standup` | Composes a prioritized daily briefing: recent delivery activity (commits + pull requests) via the delivery provider's `activity-read`, plus open work items, milestones, and cycles via the tracker provider's `list_by_status` / `list_milestones` / `list_cycles`, and the local in-flight task folders — ranked by an urgency × importance (Eisenhower) score into a "today's focus" list. Names only abstract provider operations, so it renders identically against whichever tracker pack is registered. Writes `_local/standup/<date>.md` (the day's snapshot). Degrades to a delivery-only or fully local briefing when a provider is unconfigured or fails mid-run; the local task scan is always the source of truth. `--since <window>` sets the activity window (default 1 day), `--status <name>` (repeatable, default from the **Standup Statuses** config key) picks which statuses to enumerate. |
| `/wf:classify` | Classifies a task into one of seven branch-type buckets (`feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) with calibrated confidence. Other skills call it when `--type` isn't passed. |
| `/wf:index` | Updates one row in the per-task `index.md` manifest. Other skills call it after writing any artifact so the index stays in sync. Lean. |
| `/wf:resolve` | Inspects and manages the wf resolution snapshot through the bundled typed resolver **MCP service**. The current surface includes the `wf_resolver_status` liveness probe; metadata queries (`resolve_config`, `resolve_registry`, `resolve_provider`, `resolve_profile`, `resolve_settings`, `resolve_routing`, `resolve_plugin_root`, `resolve_gate`, `resolve_inspect`), lifecycle mutations (`resolve_refresh`, `resolve_invalidate`), pack operations (`inspect_pack`, `register_pack`), `preview_composition`, validators (`validate_manifest`, `validate_registry`, `validate_skill_interface`, `validate_references`), and the distinct body-serving `resolve_content`. `resolve_routing` makes fingerprint-fresh, body-free initial and post-attempt decisions: its typed record includes selector provenance, masking, fallback, execution shape, parent-owned retain/retry/exhausted disposition, bounded attempt provenance, and `actualModel` only when observable. Metadata queries stay body-free; `resolve_content` alone serves approved bundled bodies across six classes: `fragment`, `contract`, `shared`, `references-template`, `profile-template`, and `slot` (composed by `skill` + `point`). Every resolver MCP call must explicitly pass schema-required `workspaceRoot`, derived before calls by running `pwd -P` and using the returned absolute current Agent/session workspace directory; there is no default or fallback, omission is a hard schema error, and in a linked-worktree Agent that cwd is the Agent's own worktree, never an inherited parent root. `/wf:resolve` dispatches `inspect`, `refresh`, and `invalidate`; `resolve_gate` preserves the local-read/tracker-write/delivery-write degradation policy without folder or environment probing. The validators derive their rules from live contract artifacts and return typed `pass`/`fail`/`error` verdicts; CI shell guards remain authoritative. |
| `/wf:seed` | Parses an architecture/design doc's action-items checklist into an append-only `_local/` backlog (default `{task-root}/BACKLOG.md`, configurable via the **Backlog Path** config key) — one `T<NNN>` stub per item, each carrying a local id and a resolvable `<doc> § <section>` ref — so a later `/wf:spec T<NNN>` starts with grounded context. Append-only and re-runnable: a second run adds only newly-appeared items. Bare-core: no tracker/VCS coupling, local ids only. |
| `/wf:qa-init` | Build or refresh the project QA-rules artifact (`_local/wf-qa.md`) for the QA family — `/wf:qa-gen` reads the `{qa-rules}` pointer at plan-generation time, and the report severity rubric (defined in qa-gen's report format, applied by `/wf:qa-run`/`/wf:qa-auto` when `07_qa-report.md` is written) resolves from the artifact. A bounded read-only scan detects the project's own stack/risk/environment signals and reflects them into a domain-free questionnaire (risk areas, environment, severity, acceptance), then writes the rules (including the severity rubric) and sets `{qa-rules}` to the artifact path. Re-runnable: update mode merges newly-derived rules while preserving manual edits. |
| `/wf:qa-gen` | Generate a QA plan for the task (`06_qa.md`). UI criteria become **browser** scenarios; backend criteria become **API** scenarios that exercise the endpoint over HTTP with a real token. On top of the generic plan it **fires the `qa-generation` phase**, aggregating any scenarios contributed by the project's registered capabilities (provenance-tagged) — with none registered, the generic plan stands alone. Every plan ends with a standing **Baseline health** suite — including a **visual-baseline** scenario carrying the `**Visual:** yes` marker (absolute visual-defect detection: overlap/clipping/crowding/mis-rendered controls; not pixel-diffing) for a browser target. A backend-only task is never a stub PASS. |
| `/wf:qa-run` | Interactive walkthrough of `06_qa.md` — prompts the tester step by step for browser scenarios, presents `Type: API` scenarios as a request + ready curl command, then writes `07_qa-report.md`. Use when a human is the tester. |
| `/wf:qa-auto` | Autonomous QA run **orchestrator**. Resolves the task/plan, enforces the branch gate, manages run lifecycle (resume / `--batch` / `--only`), and **dispatches the per-scenario drive to the `qa-execution` engine** registered in the capability registry — it names no stack and drives no browser itself. Assembles `07_qa-report.md` with the Summary, traceability matrix, and full-run console/network rollup; a `**Visual:** yes` scenario carries a `**Visual:**` evidence sub-block (screenshot + geometry findings + rubric verdict) even on PASS. Requires a registered execution capability (e.g. `wf-browser-qa` browser-qa); stops cleanly if none is active. Use `--batch <N>` + `--resume` to chunk long runs across context windows. |
| `/wf:qa-followup` | Follows up a QA report: triages every non-PASS scenario, unblocks harness blocks, root-causes FAIL defects, writes a checkbox remediation plan (`08_qa-fix.md`), gates on a single approval, applies fixes, and recommends a fresh QA pass. The QA chain's plan-then-implement defect-fixer. |

All default to zero-argument invocation — they infer context from the current branch.

## Bare-core (no provider registered)

Install `wf` alone — no `wf-git`, no tracker pack, an empty `## Capabilities` registry — and the spine still runs, fully local:

- **Task ids** use the local `T<NNN>` scheme (minted by `/wf:spec`); task folders are `{task-root}/T<NNN>/`. Core never reconstructs an id from a prefix — the id is opaque.
- **No git invocation of any kind (plumbing included).** Every skill's branch gate resolves delivery-surface ownership first and, finding none, **skips with a stated reason** (`Branch gate skipped — no delivery provider registered (bare-core mode)`) instead of erroring. Id inference and the **workspace root** resolve via the plain-directory fallback (the current working directory), never `rev-parse` or any other command.
- **No tracker call and no capability term** in any artifact or output — `/wf:spec` writes a local `00_reqs.md` and continues; a mid-run tracker/MCP failure warns once and falls back to local-only.
- `/wf:branch`, `/wf:commit`, `/wf:pr` are the **delivery** steps, not part of the bare-core spine — they require a registered delivery provider and return a clear `— Error` naming the remedy (install and run `/wf-git:init`) when none is active.

Register `wf-git` (via its `/wf-git:init`) — and a tracker pack (`/wf-ado:init` or `/wf-linear:init`) — to light up branch/commit/PR and work-item integration; core degrades back to local-only the moment they're absent. Exactly one tracker provider may be active at a time (`wf-ado` XOR `wf-linear`; enforced by registry validation).

> **Moved:** `migration-map` (→ `/wf-caps:migration-map`) ships in the **wf-caps** plugin, hosted in a separate private marketplace (moved out of this repo per WF-261). `qa-host` and `test-page` (→ `/wf-angular:qa-host`, `/wf-angular:test-page`) now ship in the **wf-angular** plugin as the `angular` stack capability (the `qa-execution` `surface: host` provider, composing with browser-qa's `surface: engine`); `test-node` (→ `/wf-node-ts:test-node`) ships in the **wf-node-ts** plugin as the `node-ts` capability. See [`plugins/wf-angular/README.md`](../wf-angular/README.md) and [`plugins/wf-node-ts/README.md`](../wf-node-ts/README.md). Install the relevant pack to use each.

## Per-task artifacts

Each task gets a folder under `_local/` in the downstream repo. The whole `_local/` tree is excluded from version control, so nothing these skills write ever leaks into a commit.

```
_local/
├── config.md             # /wf:init project config — {task-root}, {verify-command}, ## Routing overrides, the ## Capabilities registry, etc. (registry location is configurable via wf.config.js registryPath; defaults here). Each tracker/delivery pack adds its own section (e.g. ## Azure DevOps, ## Linear) via its own init.
├── profiles/             # /wf:init capability profile overrides — <capability>.profile.json, seeded on divergence from the capability's shipped default
├── qa-creds.md           # /wf-browser-qa:qa-engine test credentials (per-project, shared across tasks)
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
    ├── tests/                # /wf-node-ts:test-node Node test files (.test.ts)
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
