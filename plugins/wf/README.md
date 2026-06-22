# wf — wf:* Skills for ADO Task Workflow

A Claude Code plugin for working on ADO-tracked tasks, primarily the **Compliance Risk** repo (C# / ASP.NET MVC → Angular / TypeScript migration). Each `wf:*` unit is a skill, invocable as a `/wf:…` slash command or auto-loaded by Claude when relevant.

## Install

From the marketplace that ships this plugin:

```
/plugin marketplace add pavel-rp/vmg-workflow-claude
/plugin install wf
```

Skills and agents are auto-discovered on install — no per-machine configuration.

Some skills delegate work to **subagents** (the `*.md` files in this plugin's `agents/` folder) for context-isolated reasoning — e.g. `wf:classify` runs its rubric in a subagent so the classification reasoning doesn't pollute the caller's transcript, and `wf:run --auto` drives each chain phase through the `wf:phase-runner` subagent so the per-phase ADO fetch and codebase exploration never reach the orchestrator. Claude Code discovers these agents automatically, and they invoke each other via the **Task** tool (nested delegation works without any setup).

## Before the first task in a new repo

```
/wf:init
```

Creates `_local/` for per-task artifacts, writes default config, gitignores itself, and scaffolds the Node test runner. Idempotent — safe to re-run.

## Pick the flow (optional)

```
/wf:triage <ado-id>    # score the task and recommend lite | full | split | blocked | clarify
```

Cheap read-only advisor. Fetches `00_reqs.md` if absent, does a bounded repo scan, scores 5 dimensions (scope, clarity, design, risk, dependencies), and prints the exact next command to run. Safe to skip if you already know which flow fits.

## Drive the whole chain (optional)

```
/wf:run <ado-id>          # default: walk the safe front of the chain hands-off, halting at the first gate
/wf:run <ado-id> --step   # one phase at a time: name the next command and stop
```

A state-aware dispatcher over the chain below. It reads the task folder's artifacts, works out which phase is done and which is next, and enforces the gate (stops before any source-writing, approval-gated, or browser phase) — routing to `/wf:lite` when triage says the task is small, and looping verify⇄fix and qa⇄followup (capped at 2 cycles each). **By default it runs the safe front of the chain itself** — `triage→spec→plan`, then `verify-spec→qa-gen` once `implement` has landed — driving each phase through the `wf:phase-runner` subagent (isolated context) and re-deriving state between them, halting before the first phase that writes product source or needs a human (`implement`, `verify-fix`, `qa-followup`, `qa-auto`). Pass `--step` to instead name one command at a time and stop. Resumable either way: after a phase finishes, `/clear` and run `/wf:run <id>` again — it re-derives where you are from the artifacts, so nothing is lost.

## Standard workflow for a new ticket

```
/wf:spec <ado-id>      # fetch ADO requirements + write grounded spec
/wf:plan <ado-id>      # build checkbox-driven implementation plan
/wf:implement <ado-id> # execute the plan step by step — does not commit
/wf:commit <ado-id>    # commit current changes, terse auto-message (--push to push)
/wf:pr <ado-id>        # commit+push, then open a GitHub PR from the wf artifacts

/wf:branch <ado-id>    # create task branch (auto-invoked by the others)
```

`/wf:commit` authors the message in an isolated subagent (the diff never hits the main context): the first commit on the branch is `<id>: <task name>`, every later commit `<id>: <concise summary>` plus a bulleted what-changed body. `/wf:pr` first runs `/wf:commit --push` (a no-op when the tree is clean), then composes a PR body from the task's artifacts (reqs, spec, plan resolution, verify, QA), links the work item via `AB#<id>`, and opens the PR with `gh`.

Once you're on the task branch, `<ado-id>` is optional — every `wf:*` skill infers it from the current branch name.

## Fast path for small tickets

```
/wf:lite <ado-id>      # one-pass spec+plan+implement for S-complexity items
```

Collapses spec→plan→implement into a single skill run with one approval gate. Writes `00_reqs.md` (trail) and a combined `lite.md` (mini-spec + plan + resolution). Use when the task is a 1–3 file change with no architectural or schema work. For anything ambiguous or cross-cutting, stay on the full chain above.

## Auxiliary skills

| Skill | What it does |
|---|---|
| `/wf:verify-spec` | Strict, evidence-based audit of the current branch vs. `00_reqs.md`. Use before opening a PR. |
| `/wf:verify-fix` | Reads `04_verify.md`, auto-fixes mechanical FAIL/PARTIAL findings with a specific expected value, and presents ambiguous findings as open questions. Run after `/wf:verify-spec` to clear the obvious stuff. |
| `/wf:migration-map` | 1:1 mapping table between a C# source and its TS target (POCO, enum, viewmodel, partial, service, slice). `file:line` evidence, grep-verified counts. |
| `/wf:classify` | Classifies an ADO task into one of seven branch-type buckets (`feat`, `fix`, `chore`, `refactor`, `migration`, `docs`, `hotfix`) with calibrated confidence. Other skills call it when `--type` isn't passed. |
| `/wf:index` | Updates one row in the per-task `index.md` manifest. Other skills call it after writing any artifact so the index stays in sync. Lean. |
| `/wf:test-node` | Scaffold and run Node unit tests for pure TypeScript helpers. No Angular runtime. |
| `/wf:test-page` | Scaffold black-box Angular runtime tests; inject into the `CodeTrakkerModuleTestComponent` sandbox page. |
| `/wf:qa-gen` | Generate a QA plan for the task (`06_qa.md`). UI criteria become **browser** scenarios; backend criteria become **API** scenarios that exercise the endpoint over HTTP with a real token. Every plan ends with a standing **Baseline health** suite. A backend-only task is never a stub PASS. |
| `/wf:qa-run` | Interactive walkthrough of `06_qa.md` — prompts the tester step by step for browser scenarios, presents `Type: API` scenarios as a request + ready curl command, then writes `07_qa-report.md`. Use when a human is the tester. |
| `/wf:qa-auto` | Autonomous QA run. Drives a browser in-thread — logs in, picks an entity, **reaches preconditions** (clears storage, seeds test data via `mssql_*`, scaffolds test-hosts via `/wf:qa-host`), runs the steps, reverts fixtures, screenshots on FAIL. For `Type: API` scenarios it captures the session token and exercises the endpoint. Writes `07_qa-report.md`. Use `--batch <N>` + `--resume` to chunk long runs across context windows. |
| `/wf:qa-host` | Scaffolds a routed Angular test-host for a component that doesn't yet have one. The `augment` mode retrofits input controls / output observation onto an *existing* host; `api-probe` / `api-revert` are the backend analog. Auto-invoked by `/wf:qa-auto` and `/wf:qa-followup` to unblock scenarios. |
| `/wf:qa-followup` | Follows up a QA report: triages every non-PASS scenario, unblocks harness blocks, root-causes FAIL defects, writes a checkbox remediation plan (`08_qa-fix.md`), gates on a single approval, applies fixes, and recommends a fresh QA pass. The QA chain's plan-then-implement defect-fixer. |

All default to zero-argument invocation — they infer context from the current branch.

## Per-task artifacts

Each ADO ticket gets a folder under `_local/` in the downstream repo. The whole `_local/` tree is gitignored, so nothing these skills write ever leaks into a commit.

```
_local/
├── config.md             # /wf:init project config — {wi-prefix}, {task-root}, {ado-project}, {verify-command}, etc.
├── qa-creds.md           # /wf:qa-auto test credentials (per-project, shared across tasks)
└── ADO-<id>/             # one folder per task
    ├── index.md              # per-task manifest — every wf:* skill updates a row here
    ├── 00_reqs.md            # auto-fetched from ADO — source of truth
    ├── 01_spec.md            # LLM-authored spec (interpretation, may drift)
    ├── 02_plan.md            # checkbox-driven implementation plan
    ├── 03_migration-map.md   # optional — mapping table output
    ├── 04_verify.md          # /wf:verify-spec audit report — latest run
    ├── 05_verify-fix.md      # /wf:verify-fix log of auto-fixed findings + open questions
    ├── 06_qa.md              # /wf:qa-gen QA plan, scenarios traced to spec criteria
    ├── 07_qa-report.md       # /wf:qa-run or /wf:qa-auto results
    ├── 08_qa-fix.md          # /wf:qa-followup remediation plan + fix log
    ├── triage.md             # /wf:triage advisor output
    ├── lite.md               # /wf:lite fast-path output
    ├── tests/                # /wf:test-node Node test files (.test.ts)
    ├── research/             # exploration notes
    ├── assets/               # mockups, screenshots, traces
    └── artifacts/            # diffs, screenshots, API responses from /wf:qa-auto captures
```

`00_reqs.md` is the **only authoritative spec**. `01_spec.md` and `02_plan.md` are derived artifacts; `/wf:verify-spec` deliberately audits against `00_reqs.md`, not the LLM spec, to catch drift.

## Authoring

See the repo-root **[CLAUDE.md](../../CLAUDE.md)** for conventions when adding or editing skills and agents.
