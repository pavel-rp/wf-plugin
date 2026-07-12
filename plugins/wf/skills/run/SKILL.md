---
name: run
description: Drives a task through the wf:* pipeline by detecting the current phase from the task folder's artifacts, deciding the next phase, enforcing the inter-phase gate, and by default walking the safe front of the chain hands-off via the wf:phase-runner subagent — halting before any source-writing or gated phase — with a --step mode that instead names one command at a time. Resumable from any point after a context reset. wf:run writes nothing in its own context — each phase runs isolated, in its own subagent (default) or as its own native invocation (--step), so phase exploration never bleeds into the orchestrator. Use to walk spec→plan→implement→verify→qa as one tracked flow instead of remembering which slash command comes next.
allowed-tools: [Read, Glob, Grep, Bash, Task]
---

# /wf:run — Pipeline driver for the wf:* chain

Orchestrate a task across the full `wf:*` chain without firing each slash command by hand. `wf:run` is a **state-aware dispatcher**: on every invocation it reads the task folder, works out which phase is done and which is next, and checks the gate. **By default it walks the safe front of the chain hands-off**, running each phase in an isolated `wf:phase-runner` subagent and re-deriving state between them — halting before the first phase that writes product source, needs an approval gate, or drives the browser. Pass `--step` to instead name one command at a time and stop (you run it, `/clear`, and re-invoke). It never executes a phase inside its **own** context — each phase runs in its own invocation (subagent by default, native in `--step`), which keeps phase N's exploration out of the orchestrator's context window. All run state lives in the artifacts (`00_…08`, `index.md`), so a `/clear` between phases loses nothing.

This skill writes nothing in its own context. The phases (and their subagents) own every artifact and source edit; `wf:run` only reads, decides, and dispatches.

---

## When to use

Use `/wf:run` to start or continue a task and let the driver track where you are — especially across `/clear` resets, FAIL→fix loops, and the QA tail. Use the individual skills directly when you want to run exactly one phase and nothing else.

For a single-pass small task, `/wf:lite` is still the right tool — `wf:run` will route you there when triage says `lite`.

---

## Command Syntax

```
/wf:run [<id>] [--auto | --step] [--from <phase>] [--to <phase>] [--no-triage]
```

### Arguments

| Argument        | Required | Description                                                                                          |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `<id>`          | NO       | Task id — whatever shape the active tracker capability produced when the task folder was created (opaque to core), or a local `T<NNN>` id when none was registered. Falls back to inferring from the current branch via `current-branch-query` (direct provider resolution to the `delivery` surface, first 3+-digit run). First run for a brand-new task needs an explicit id. |
| `--auto`        | NO       | **Default.** Walk the safe front of the chain hands-off (`triage→spec→plan`, and `verify-spec→qa-gen` once `implement` has landed): each phase runs in a `wf:phase-runner` subagent, then `wf:run` re-derives state and advances — **halting before** the first source-writing, approval-gated, interactive, or browser phase (`implement`, `lite`, `verify-fix`, `qa-followup`, `qa-auto`/`qa-run`). Requires the Task tool (a standard Claude Code tool); if subagent invocation is unavailable, degrades to `--step`. Accepted explicitly as an alias for the default. |
| `--step`        | NO       | Opt-in single-phase mode — dispatch one phase, then stop and print the resume line. You run the phase, `/clear`, then `/wf:run --step` again for the next single phase (or bare `/wf:run` to switch to the hands-off walk). Use when you want to review each phase's output before the next one runs. |
| `--from <phase>`| NO       | Force the starting phase (`spec`, `plan`, `implement`, `verify`, `qa`, …), overriding artifact-derived state. |
| `--to <phase>`  | NO       | Stop once the named phase completes. |
| `--no-triage`   | NO       | Skip the opening triage step and enter the full chain directly. |

`--resume` is accepted as an explicit alias for the default behavior (re-derive state and advance); it is implied whenever no `--from` is given.

Disambiguation: the leading non-`--`-prefixed token is the `<id>` argument — pass the task's full opaque id (whatever shape the active tracker capability produced, or local `T<NNN>`) verbatim; a bare numeric token only resolves on its own when the task folder itself is named with just that number. `--`-prefixed tokens are flags; `--from`/`--to` each consume their own following phase-name token, not the id.

---

## Prerequisites

**Before anything else**, read `_local/config.md` for `{task-root}`. If it doesn't exist, stop: "Run `/wf:init` first." Never hardcode this value.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the repo (`Read`, `Glob`, `Grep`); prefer `sourcebot` MCP tools for code search when available.
- Read-only resolution via `workspace-root-resolve`, `current-branch-query`, and `last-commit-timestamp-query` (direct provider resolution to the `delivery` surface).
- Read `index.md` and the `00_…08` artifacts to derive state.
- In the default walk (`--auto`), never in `--step`: invoke the **Task** tool with `subagent_type: wf:phase-runner` to run an auto-front phase (`triage`/`spec`/`plan`/`verify-spec`/`qa-gen`) in an isolated context. The subagent — not `wf:run` — does the reads and writes; `wf:run` still writes nothing in its own context.

**Forbidden:**

- Write or edit **any** file in your own context — artifacts, source, or config. `wf:run` is a pure dispatcher; if a phase needs to write, the phase (in `--step`) or its `wf:phase-runner` subagent (in `--auto`) writes — never `wf:run` directly.
- Run builds, tests, installs, or any delivery-surface operation that mutates state.
- Execute a phase's logic **inline in your own context** (e.g. do `wf:spec`'s own fetch/exploration yourself). Inlining defeats the per-phase context isolation that is the whole point. In `--step` you name the command and stop; in `--auto` you dispatch the phase to the `wf:phase-runner` subagent — never run it inline either way.
- **"Rescue" a failed phase subagent by doing its work yourself.** If the `wf:phase-runner` **Task** call returns an error (e.g. it reports a missing tool), do **not** fetch the tracker item / explore the codebase / build the artifact in your own context and feed it into a retry. That re-imports the exact heavy context the isolation exists to keep out, and "wf:run didn't write the file, the subagent did" is not a loophole — it is still inlining. The subagent inherits every tool you have (it declares no `tools:` allowlist), so a genuine tool gap is a bug to fix in the agent, not to route around. Halt and surface (Phase 4); a human or a fixed subagent retries.

---

## The pipeline (phase graph)

```
wf:triage ──┬─ blocked | clarify ─────────────► STOP (surface why; hand back)
            ├─ lite ──► dispatch /wf:lite ─────► STOP at its approval gate
            └─ full | split ─► spec ─► plan ─► implement ─► verify-spec
                                                                │
                              ┌── Verdict: PASS ───────────────►├──► qa-gen ─► qa-auto
                              │                                 │                  │
                       verify-fix ◄── Verdict: FAIL/PARTIAL ────┘        ┌─ PASS ──┴─ FAIL/INCOMPLETE ─┐
                              │  (re-run verify-spec; max 2 cycles)      ▼                              ▼
                              └──────────────────────────────────►  STOP: ready              qa-followup (gate→fix)
                                                                    for review                     │ re-runs qa-auto --only
                                                                                                   └── (max 2 cycles) ──┘
```

The QA tail self-orchestrates (`wf:qa-followup` already resolves the registered `qa-execution` host provider + `wf:qa-auto --only`); `wf:run` sequences into it and stops on the terminal QA verdict.

**Auto-front vs. gated phases.** `--auto` only ever runs the **auto-front** — `triage`, `spec`, `plan`, `verify-spec`, `qa-gen` — phases that are non-interactive and write only `_local/` artifacts (never product source). Every other phase is **gated**: `implement`, `lite`, `verify-fix`, and `qa-followup` write product source or need an approval, and `qa-auto`/`qa-run` drive the browser (kept an explicit step). `--auto` halts *before* the first gated phase it reaches and hands the exact command to the user. On a fresh task that boundary is right after `plan` (next is `implement`); once `implement` has landed and the user re-runs `--auto`, the loop resumes through `verify-spec`→`qa-gen` and halts before `qa-auto`.

---

## Phase 1: Resolve the task

1. **Resolve `{task-id}`.** If `<id>` is provided, use it verbatim. If omitted, infer a numeric token via `current-branch-query`, reached through **direct provider resolution** to the `delivery` surface (`plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution" — the same mechanism `plugins/wf/skills/plan/SKILL.md`'s Validation section uses): extract the first 3+-digit run from the resolved branch name. With zero matching delivery-provider rows, this falls back silently to the plain-directory case (no branch to infer from). If no numeric token can be extracted from the branch at all, stop: "No id provided and none could be inferred from the current branch. Pass it: `/wf:run <id>`." Otherwise **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing task folder's name and compare it to the token. Exactly one match — reuse that folder's full name as `{task-id}`. Zero matches — stop: "No id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass it: `/wf:run <id>`." More than one match — ambiguous — stop: "No id provided and the branch-inferred token `<token>` matches more than one task folder. Pass it: `/wf:run <id>`."
2. **Compute the task folder** `{task-root}/{task-id}/`, resolved as absolute via `workspace-root-resolve` (direct provider resolution to the `delivery` surface) when `{task-root}` is relative — mirroring only the workspace-root-resolve/absolute-join mechanism of `plugins/wf/agents/branch.md` Step 1 steps 4–5. With zero matching delivery-provider rows, `workspace-root-resolve` falls back silently to a plain-directory resolution.

---

## Phase 2: Detect current state (from the filesystem, not memory)

Read `index.md` if present; otherwise scan the task folder. Determine the furthest-completed phase using artifact presence **and** the status embedded in each artifact. Detection signals — note that not every phase emits a chat token, so these are read from the artifacts themselves:

| Phase | "Done" signal |
|---|---|
| triage | `triage.md` exists; read its `**Verdict:** <lite \| full \| split \| blocked \| clarify>` field (the `TRIAGE —` token is chat-only, not written to the artifact) |
| spec | `01_spec.md` exists |
| plan | `02_plan.md` exists |
| implement | `02_plan.md` checkboxes all ticked **and** a `## Resolution Summary` section is present — these are the durable signal (wf:implement persists no status line to the plan; the `IMPLEMENT —` token and its `Status: READY FOR REVIEW` completion report are chat-only and don't survive a `/clear`) |
| verify-spec | `04_verify.md` exists; read its `**Verdict:** PASS \| FAIL \| PARTIAL` line (detect from the artifact, not the `VERIFY —` chat token wf:verify-spec prints — chat tokens don't survive a `/clear`) |
| verify-fix | `05_verify-fix.md` exists; read its `## Auto-fixed (<n>)` / `## Awaiting user (<m>)` headers and the `[FIXED]`/`[FAILED]`/`[SKIPPED]` entries (the `VERIFY-FIX —` token is chat-only) |
| qa-gen | `06_qa.md` exists |
| qa-auto/run | `07_qa-report.md` exists; read its `Status: PASS \| FAIL \| INCOMPLETE` header |
| qa-followup | `08_qa-fix.md` exists (absent → `NOOP`). Derive state from durable fields (the `QA-FOLLOWUP —` token is chat-only): **ESCALATED** = no checkbox steps under `## Remediation plan` and `## Escalations` non-empty; **ABORTED** = steps present but all unchecked and `## Fix log` empty (gate declined, no source applied); **DONE** = all steps ticked and `## Escalations` empty/omitted; **PARTIAL** = otherwise (some steps ticked, a `[FAILED]`/`[SKIPPED]` in `## Fix log`, or escalations remaining alongside fixes) |

**Staleness guard** (borrowed from `wf:qa-followup`'s own "soft check" framing): invoke `last-commit-timestamp-query` via **direct provider resolution** to the `delivery` surface (`plugins/wf/skills/_contracts/invocation-runtime.contract.md` §"Direct provider resolution"). With zero matching delivery-provider rows, this falls back silently to the contract's plain-directory-safe filesystem read (no VCS invocation of any kind). Compare it against the furthest-complete artifact's own recorded write-time — read the `**Created:**` (triage/spec/plan), `**Generated:**` (qa-gen), `**Run date:**` (`07_qa-report.md`), or `**Audited at:**` (`04_verify.md`) field, whichever the furthest-complete phase's artifact carries. Phases whose artifact carries none of the four named fields (e.g. `verify-fix`, `qa-followup`, or a task with no artifact detected yet) simply have nothing to compare against — the guard falls through to the "can't be confidently parsed" case below and skips silently. Interpret both values as calendar moments and compare chronologically — do not string-compare, and do not special-case any particular timestamp shape (the contract leaves the no-provider fallback's format unspecified). This is a soft/advisory check: if either value can't be confidently parsed as a calendar moment, skip the warning silently rather than risk a false signal. Otherwise, if source commits landed after the artifact was written, warn that downstream artifacts may be stale and offer `--from <phase>` to redo from there.

---

## Phase 3: Compute the next phase + gate

1. Apply the phase-graph edges, branching on the statuses read in Phase 2:
   - `triage` verdict `blocked`/`clarify` → **halt**, surface the reason. `lite` → next is `/wf:lite`. `full`/`split` → enter the chain at the first missing artifact.
   - `verify-spec` `PASS` → skip `verify-fix`, next is `qa-gen`. `FAIL`/`PARTIAL` → next is `verify-fix`; after it, next is `verify-spec` again. Cap at **2** verify⇄fix cycles, then halt and escalate.
   - `qa-auto` `PASS` → done (ready for review). `FAIL`/`INCOMPLETE` → next is `qa-followup`; after it (which itself re-runs `qa-auto --only`), re-read `07_qa-report.md`. Cap at **2** qa⇄followup cycles, then halt and escalate.
   - `--from`/`--to` bound the range; `--no-triage` skips the triage edge.
2. **Gate policy:**
   - `--step` (opt-in): dispatch exactly one phase, then stop with the resume line.
   - implicit gate (both modes): **always stop *before* a source-writing, approval-gated, interactive, or browser phase** — `implement`, `lite`, `verify-fix`, `qa-followup` (source/approval), plus `qa-auto`/`qa-run` (browser-driven, kept an explicit step) — and print the command for explicit human launch. The default walk never auto-advances into one; `--step` stops after every phase anyway.
   - any `Error` / `BRANCH — Error` / `ESCALATED` / `blocked` / `clarify` token → **halt** regardless of flag.

---

## Phase 4: Dispatch (mode-dependent)

Both modes use the same next-phase + gate computed in Phase 3. They differ only in what happens once the next phase is known.

### Default — walk the front (`--auto`)

Run the auto-front hands-off, one phase per loop iteration, each in an isolated subagent. Loop:

1. **Gate check (halt-before).** Take the Phase-3 next phase. If it is a gated phase — `implement`, `lite`, `verify-fix`, `qa-followup`, `qa-auto`, `qa-run` — or any halt token has fired (`blocked` / `clarify` / `Error` / `ESCALATED`), **STOP the loop**. Emit the run block with the exact command for the human to launch. This is the human gate; never auto-advance into it.
2. **Dispatch the auto-front phase.** Otherwise the next phase is one of `triage` / `spec` / `plan` / `verify-spec` / `qa-gen`. Invoke the **Task** tool with `subagent_type: wf:phase-runner`, passing `phase` (the next-phase token) and `id`. The subagent runs the phase in its own context and returns **only** that phase's Final Output block.
3. **Read the returned block.**
   - `PHASE-RUNNER — refused` / `PHASE-RUNNER — error`, or the wrapped skill's `… — Error` → **halt the loop** with `RUN — error` (or `RUN — blocked` for a `blocked`/`clarify` outcome); surface the subagent's reason and name the command for a manual retry. Do **not** try to complete the failed phase yourself (Safety Rules) — halt, even if you believe you could fetch the data the subagent couldn't.
   - Otherwise accumulate the block (small — just the status lines; this is all that enters the orchestrator's context) and continue.
4. **Re-derive and loop.** Re-run **Phase 2** (detect state from the filesystem) and **Phase 3** (compute next + gate). **Progress guard:** if the phase you just ran did *not* complete — its own artifact is still missing or incomplete on re-derivation, so Phase 3 would name the same phase again — halt with `RUN — error`; the phase made no progress, and re-dispatching it would loop forever. (A phase that completed but routes to a gated next phase — e.g. `verify-spec` → FAIL → `verify-fix` — is progress, not a stall; that halts at step 1, not here.) Otherwise go back to step 1.
5. **Terminal exits:** the loop ends on a halt-before gate (step 1), a phase failure (step 3), the progress guard (step 4), a `--to` bound being reached, or nothing left to run (→ `RUN — complete`, ready for review).

The orchestrator's context grows by only one small status block per phase; every heavy read (tracker fetch, codebase exploration, artifact authoring) stays inside the per-phase subagent. **If subagent invocation is unavailable**, the default walk can't dispatch the subagent — announce this and fall back to `--step` behavior (dispatch one phase by name and stop).

### `--step` (opt-in)

Print the resolved next command and the run status block (Final Output). Do **not** execute the phase — naming the command and stopping is the whole job. The human runs the phase, then `/clear`s and re-invokes `/wf:run <id>` (`--resume`, or `--step` again for another single phase; bare `/wf:run <id>` resumes the hands-off walk), which re-derives state from the artifacts and advances. Use `--step` when you want to review each phase's output before the next one runs.

Do **not**, in either mode, execute a phase inline in your own context (Safety Rules). The default walk dispatches to the `wf:phase-runner` subagent; `--step` names the command.

---

## Edge Cases

- **No artifacts yet (fresh task):** next phase is `triage` (or `spec` with `--no-triage`). Requires an explicit ID.
- **Out-of-order / hand-made artifacts:** trust the filesystem — detect the furthest-complete phase regardless of how it got there.
- **`02_plan.md` partially checked:** implement is *in progress*, not done — next command is `/wf:implement <id>` (it resumes from the first unchecked step on its own).
- **`04_verify.md` is `PASS` but source changed since:** staleness guard warns; offer `--from verify`.
- **verify⇄fix or qa⇄followup exceeds 2 cycles:** halt with `RUN — blocked`, summarize the stuck findings, hand to the user.
- **`TRIAGE — lite`:** dispatch `/wf:lite <id>` and stop; the lite flow has its own single gate and terminal state. In the default walk, `lite` is a gated phase — the loop halts before it and names `/wf:lite <id>`.
- **Walk (default), phase subagent returns an error/refusal:** halt immediately (`RUN — error`, or `RUN — blocked` for a `blocked`/`clarify` outcome), surface the subagent's reason, and name the command for a manual retry. Do not keep looping.
- **Walk (default), no forward progress:** if a dispatched phase returns but its artifact is still missing/incomplete on re-derivation, halt with `RUN — error` (progress guard) rather than re-dispatching the same phase forever.
- **Subagent invocation unavailable:** the default walk can't dispatch the `wf:phase-runner` subagent, so it announces the limitation and degrades to `--step` behavior (one phase named per invocation). `--step` itself never needs subagents — it only names commands.

---

## Final Output

```
RUN — <advanced | gated | complete | blocked | error>

Task:       {task-id}
Detected:   <furthest-complete phase> → <status read from its artifact>
Ran:        <auto-front phases executed this invocation, in order — default walk only; omit in --step>
Next:       <command to run, or "none — ready for review">
Gate:       <stopped before <gated phase> | auto-complete | halted (<reason>) | step>
Loops:      verify <n>/2 · qa <n>/2   (omit if zero)

<if not complete:>
Run next:   <e.g. /wf:implement {task-id}>
Then:       /clear, then /wf:run {task-id}   (re-derives state and continues the walk; add --step for one phase at a time)

<if blocked/error:>
Halted:     <one-line reason>
```

The `Ran:` line is present in the default walk and lists the phases the loop executed this invocation (e.g. `triage → spec → plan`); omit it entirely in `--step`. `Gate:` in the default walk is `stopped before <phase>` when the loop halted at a gated phase, `auto-complete` when the chain reached its terminal review-ready state, or `halted (<reason>)` on a phase failure or the progress guard; in `--step` it is `step`.

**The final-output block must always be the very last thing output to chat.**
