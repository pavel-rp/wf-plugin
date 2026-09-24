---
name: run
description: Drives a task through the wf:* pipeline by detecting the current phase from the task folder's artifacts, deciding the next phase, enforcing the inter-phase gate, and by default walking the safe front of the chain hands-off via the wf:phase-runner subagent — halting before any source-writing or gated phase — with a --step mode that instead names one command at a time. Resumable from any point after a context reset. wf:run writes nothing in its own context — each phase runs isolated, in its own subagent (default) or as its own native invocation (--step), so phase exploration never bleeds into the orchestrator. Use to walk spec→plan→implement→verify→qa as one tracked flow instead of remembering which slash command comes next.
allowed-tools: [Read, Glob, Grep, Bash, Task, AskUserQuestion]
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
/wf:run [<id>] [--auto | --step] [--from <phase>] [--to <phase>] [--no-triage] [--headless] [--gate <extend|accept|stop>]
```

### Arguments

| Argument        | Required | Description                                                                                          |
| --------------- | -------- | ---------------------------------------------------------------------------------------------------- |
Before the first bundled resolver MCP call in this skill/agent, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` in every call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent Agent's root. Pass `workspaceRoot` explicitly on every resolver call; omission is a hard schema error, and the resolver has no default or fallback root.

| `<id>`          | NO       | Task id — whatever shape the active tracker capability produced when the task folder was created (opaque to core), or a local `T<NNN>` id when none was registered. Falls back to inferring from the current branch via `current-branch-query` (the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query, first 3+-digit run). First run for a brand-new task needs an explicit id. |
| `--auto`        | NO       | **Default.** Walk the safe front of the chain hands-off (`triage→spec→plan`, and `verify-spec→qa-gen` once `implement` has landed): each phase runs in a `wf:phase-runner` subagent, then `wf:run` re-derives state and advances — **halting before** the first source-writing, approval-gated, interactive, or browser phase (`implement`, `lite`, `verify-fix`, `qa-followup`, `qa-auto`/`qa-run`). Requires the Task tool (a standard Claude Code tool); if subagent invocation is unavailable, degrades to `--step`. Accepted explicitly as an alias for the default. |
| `--step`        | NO       | Opt-in single-phase mode — dispatch one phase, then stop and print the resume line. You run the phase, `/clear`, then `/wf:run --step` again for the next single phase (or bare `/wf:run` to switch to the hands-off walk). Use when you want to review each phase's output before the next one runs. |
| `--from <phase>`| NO       | Force the starting phase (`spec`, `plan`, `implement`, `verify`, `qa`, …), overriding artifact-derived state. |
| `--to <phase>`  | NO       | Stop once the named phase completes. |
| `--no-triage`   | NO       | Skip the opening triage step and enter the full chain directly. |
| `--headless`    | NO       | Explicit signal that no operator is present to answer the verify⇄fix stop gate (§"The verify⇄fix stop gate"). Never inferred from context — a headless driver (`ship`, `fleet`'s fallback chain) always passes it. At a gate with no `--gate` answered, emits `RUN — blocked` without prompting. |
| `--gate <extend\|accept\|stop>` | NO | Answers the verify⇄fix stop gate this invocation reaches, if any, once. Composes with `--headless` (unattended answer) or stands alone (a pre-committed interactive answer). Spent after answering one stop; a later stop in the same invocation gets no second free answer from it. |

`--resume` is accepted as an explicit alias for the default behavior (re-derive state and advance); it is implied whenever no `--from` is given.

Disambiguation: the leading non-`--`-prefixed token is the `<id>` argument — pass the task's full opaque id (whatever shape the active tracker capability produced, or local `T<NNN>`) verbatim; a bare numeric token only resolves on its own when the task folder itself is named with just that number. `--`-prefixed tokens are flags; `--from`/`--to` each consume their own following phase-name token, not the id.

---

## Prerequisites

**Before anything else**, obtain `{task-root}` from the bundled `wf-resolver` MCP service via `resolve_config({ workspaceRoot, ... })` (`coreConfig.taskRoot`; it also returns `workspaceRoot`, `registryPath`, `idShape`), already resolved from `_local/config.md` — core performs no direct config-file parse. If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop: "Run `/wf:init` first." If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. Never hardcode this value.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the repo (`Read`, `Glob`, `Grep`); prefer `sourcebot` MCP tools for code search when available.
- Read-only resolution via `workspace-root-resolve`, `current-branch-query`, and `last-commit-timestamp-query` (the `wf-resolver` `resolve_config({ workspaceRoot, ... })` / `resolve_provider({ workspaceRoot, surface: "delivery" })` queries).
- Read `index.md` and the `00_…08` artifacts to derive state.
- In the default walk (`--auto`), never in `--step`: invoke the **Task** tool with `subagent_type: wf:phase-runner` to run an auto-front phase (`triage`/`spec`/`plan`/`verify-spec`/`qa-gen`) in an isolated context. The subagent — not `wf:run` — does the reads and writes; `wf:run` still writes nothing in its own context.
- Prompt the operator via `AskUserQuestion` at the verify⇄fix stop gate (§"The verify⇄fix stop gate"), interactive mode only.

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

1. **Resolve `{task-id}`.** If `<id>` is provided, use it verbatim. If omitted, infer a numeric token via `current-branch-query`, reached by resolving the `delivery` surface with the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query (the same resolver call `plugins/wf/skills/plan/SKILL.md`'s Validation section uses) and obtaining its body via the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`) and following it: extract the first 3+-digit run from the resolved branch name. On `state: unconfigured`/`unrecoverable` (no readable delivery provider), this falls back silently to the plain-directory case (no branch to infer from). If no numeric token can be extracted from the branch at all, stop: "No id provided and none could be inferred from the current branch. Pass it: `/wf:run <id>`." Otherwise **resolve that token against `{task-root}`** — apply the same first-3+-digit-run extraction to each existing task folder's name and compare it to the token. Exactly one match — reuse that folder's full name as `{task-id}`. Zero matches — stop: "No id provided and the branch-inferred token `<token>` doesn't match an existing task folder. Pass it: `/wf:run <id>`." More than one match — ambiguous — stop: "No id provided and the branch-inferred token `<token>` matches more than one task folder. Pass it: `/wf:run <id>`."
2. **Compute the task folder** `{task-root}/{task-id}/`, resolved as absolute against the `workspaceRoot` returned by `resolve_config({ workspaceRoot, ... })` when `{task-root}` is relative (the resolver's already-normalized `workspace-root-resolve` value). When no delivery provider is registered, `workspaceRoot` is the plain-directory resolution — no VCS invocation.

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

**Staleness guard** (borrowed from `wf:qa-followup`'s own "soft check" framing): invoke `last-commit-timestamp-query` by resolving the `delivery` surface with the `wf-resolver` `resolve_provider({ workspaceRoot, surface: "delivery" })` query and obtaining its body via the resolver's `resolve_content({ workspaceRoot, ... })` content surface (`class: fragment`) and following it. On `state: unconfigured`/`unrecoverable` (no readable delivery provider), this falls back silently to the plain-directory-safe filesystem read (no VCS invocation of any kind). Compare it against the furthest-complete artifact's own recorded write-time — read the `**Created:**` (triage/spec/plan), `**Generated:**` (qa-gen), `**Run date:**` (`07_qa-report.md`), or `**Audited at:**` (`04_verify.md`) field, whichever the furthest-complete phase's artifact carries. Phases whose artifact carries none of the four named fields (e.g. `verify-fix`, `qa-followup`, or a task with no artifact detected yet) simply have nothing to compare against — the guard falls through to the "can't be confidently parsed" case below and skips silently. Interpret both values as calendar moments and compare chronologically — do not string-compare, and do not special-case any particular timestamp shape (the contract leaves the no-provider fallback's format unspecified). This is a soft/advisory check: if either value can't be confidently parsed as a calendar moment, skip the warning silently rather than risk a false signal. Otherwise, if source commits landed after the artifact was written, warn that downstream artifacts may be stale and offer `--from <phase>` to redo from there.

---

## Phase 3: Compute the next phase + gate

1. Apply the phase-graph edges, branching on the statuses read in Phase 2:
   - `triage` verdict `blocked`/`clarify` → **halt**, surface the reason. `lite` → next is `/wf:lite`. `full`/`split` → enter the chain at the first missing artifact.
   - `verify-spec` `PASS` → skip `verify-fix`, next is `qa-gen`. `FAIL`/`PARTIAL` at round 1 (no prior round to compare) → next is `verify-fix`, unconditionally. `FAIL`/`PARTIAL` at round ≥2 → apply §"The verify⇄fix stop gate": a blocking-fingerprint set that shrank since the prior round continues to `verify-fix` (cap permitting); a stable-or-grown set, or the cap itself, stops the loop through the gate. Cap stays **2** verify⇄fix cycles per run attempt; an `extend` gate choice adds exactly one more cycle, uncapped for interactive extends. When the next phase resolves to `verify-fix` because a stop-gate `extend` choice was just recorded or already matched (§"The verify⇄fix stop gate" — "Act on the choice"), carry that section's resolved command forward as this phase's dispatch command — `--attempt <K>` when that section found a prior attempt header (whether read from the companion pin or recomputed fresh), the bare `/wf:verify-fix {task-id}` when it found none; the round-1 unconditional case carries only the bare `verify-fix` token too, with no `--attempt` flag, but reaches it directly rather than through the stop gate's resolution. **Exception:** when that section's companion-pin lookup finds the pinned attempt `K` **already reached** (its `**Attempt:** <K>` header is already present), the next phase is `verify-spec` instead — the one cycle this `extend` choice authorized already ran, so this round dispatches no `verify-fix` and asks no new gate.
   - `qa-auto` `PASS` → done (ready for review). `FAIL`/`INCOMPLETE` → next is `qa-followup`; after it (which itself re-runs `qa-auto --only`), re-read `07_qa-report.md`. Cap at **2** qa⇄followup cycles, then halt and escalate.
   - `--from`/`--to` bound the range; `--no-triage` skips the triage edge.
2. **Gate policy:**
   - `--step` (opt-in): dispatch exactly one phase, then stop with the resume line.
   - implicit gate (both modes): **always stop *before* a source-writing, approval-gated, interactive, or browser phase** — `implement`, `lite`, `verify-fix`, `qa-followup` (source/approval), plus `qa-auto`/`qa-run` (browser-driven, kept an explicit step) — and print the command for explicit human launch. The default walk never auto-advances into one; `--step` stops after every phase anyway.
   - any `Error` / `BRANCH — Error` / `ESCALATED` / `blocked` / `clarify` token → **halt** regardless of flag.

---

## The verify⇄fix stop gate

Reached only at round ≥2 of a `FAIL`/`PARTIAL` `verify-spec` (Phase 3). Compares **blocking fingerprint sets** — the fingerprints listed under the current `04_verify.md`'s `## Capability findings` heading (round `N`) against the same heading in the most recent `04_verify.history.md` entry (round `N-1`) — **and**, since a loop can be entirely requirement-driven with no capability finding ever fingerprinted, the requirement pass count each report's own header already carries (`**Verdict:** … (<passed>/<total> requirements)`).

**Progress test.** **Progress** — at least one round-`N-1` fingerprint absent from round `N`'s set, **or** round `N`'s `<passed>` count exceeds round `N-1`'s — continue to `verify-fix` (cap permitting). **No progress** — round `N`'s fingerprint set equal to or a superset of round `N-1`'s (nothing cleared, whether or not something new appeared) **and** `<passed>` did not increase — stop **early**, before spending the cap's remaining cycle. Reaching the existing 2-cycle cap with either signal still improving also stops, through this same gate — improvement is progress, not an exemption from the cap.

**One gate, asked once per stop.** Compute the loop identity `L` and round `N` per `finding-ledger.md` §"Loop identity" (`resolve_content({ workspaceRoot, ... })`, `class: references-template`, `skill: verify-spec`, `ref: finding-ledger.md`) — read `N` off `04_verify.md`'s `**Round:**` line, never recomputed here. Before asking anything, call `read_run_evidence({ workspaceRoot, taskId })` and look for a `matched` entry `kind: gate-approval`, `subject: verify-loop:l<L>:r<N>:<choice>` — if found, this exact stop was already answered (a resumed run after `/clear`, or a same-invocation re-check); skip straight to "Act on the choice" below with that recorded `<choice>`, asking nothing.

No matching record:

- **`--headless`** — if `--gate <choice>` was passed at this invocation's entry **and** it has not already answered an earlier stop this invocation, request `verify-loop:l<L>:r<N>:<choice>` via `record_run_evidence({ workspaceRoot, kind: "gate-approval", subject: "verify-loop:l<L>:r<N>:<choice>", taskId })` — no `artifactPath`; no artifact is approved, this is `invocation-only` by design. **Check the response before acting on `<choice>` — never act unconditionally on the request alone:** `recorded` → act on `<choice>` below. `refused` (e.g. a full or unreadable ledger) → do **not** act on `<choice>`; a choice whose downstream behavior relies on a recorded approval (`accept`'s re-invoked `verify-spec` reads this same record back; `extend` resumes a cycle on its strength) must never proceed as though the write had landed. Instead emit `RUN — blocked` naming the record call's `diagnostic` as the reason; record no choice; the ledger is intact. Otherwise (no `--gate`, or it already answered an earlier stop this run) → emit `RUN — blocked` without prompting; record no choice; the ledger is intact.
- **Interactive** (no `--headless`) — ask the operator once via `AskUserQuestion`: `extend` (one more verify⇄fix cycle) / `accept` (demote the open blocking lens residue, if a requirement `FAIL`/`PARTIAL` is also open the loop still stops on that) / `stop` (halt now). Record the answer the same way, then act on it. An interactive `extend` may be answered again at each later stop within the same loop — no counter bounds it beyond the operator's own repeated choice.

**Act on the choice:**

- **`extend`** → before doing anything else, look for a matched **companion-pin** record: call `read_run_evidence({ workspaceRoot, taskId })` and scan its `matched` entries for `kind: gate-approval` whose `subject` carries the fixed prefix `verify-loop:l<L>:r<N>:extend:attempt` — the trailing integer after that prefix, once found, **is** `K` (there is no need to know `K` in advance to look for it; the prefix alone identifies the companion-pin family for this `l<L>:r<N>` pair, exactly as `verify-loop:l<L>:r<N>:<choice>` above is scanned for its own `<choice>` placeholder). This subject is a sibling of the primary `verify-loop:l<L>:r<N>:extend` subject above, distinguishable from it — and from the unrelated `verify-loop:l<L>:r<N>:accept` subject — by the literal `:attempt` segment. This lookup runs on **every** entry into this bullet, whether reached by a fresh write (no matching primary record above) or by the "One gate, asked once per stop" skip-straight-there path (a primary record already matched).

  **Fail closed on a degraded read, before branching into Found/Not found below** — mirroring `ship/SKILL.md`'s own admission-check step 3 for the identical three outcomes on this same evidence class: `status: unsupported` or `status: malformed` (a whole-ledger parse failure) on the `read_run_evidence` call above, or a clean `status: ok`/`status: absent` read that either reports `unreadableRecords > 0` or finds the exact-subject pin `verify-loop:l<L>:r<N>:extend:attempt<K>` present only in `unmatched` (a proven-invalid/tampered record per its `reason` taxonomy) — any of these is indistinguishable from "no pin was ever written" under a naive read, and falling through to **Not found** on one would recompute `K` fresh off `05_verify-fix.md`'s own already-completed header and dispatch the exact unauthorized second cycle this mechanism exists to close. On any of these four conditions: emit `RUN — blocked` naming the read's own `status` or the ledger's unreadable/tampered-record reason; dispatch nothing this round; the primary `extend` record and the ledger are left intact for a later, cleaner read. Only a **clean** read — `status: ok`/`status: absent`, zero `unreadableRecords`, and the exact-subject pin either absent entirely or found in `matched` — proceeds to the Found/Not found branches below:
  - **Found**, and neither `{task-root}/{task-id}/05_verify-fix.md` nor `.history.md` yet carries an `**Attempt:** <K>` header at the pinned `K` — the authorized cycle has not run yet. Resolve the `verify-fix` dispatch command from the pinned `K` directly (bare `/wf:verify-fix {task-id}` if `K == 1`, else `--attempt <K>`) — never a freshly recomputed target — and carry it forward as this round's dispatch command exactly as below.
  - **Found**, and that `**Attempt:** <K>` header **is** already present — the one cycle this `extend` choice authorized already ran. Do not replay this bullet's write path, do not resolve a new `verify-fix` dispatch for this round; instead resolve the **next phase directly to `verify-spec`**, with no new gate prompt and no new `--gate` consultation (Phase 3 below carries this outcome).
  - **Not found** (first time this stop's `extend` choice is being acted on, or a legacy primary record predating this pin) — resolve the attempt scope `k` the same way `/wf:verify-fix`'s own Phase 1.5 default resolution does (WF-663): the highest `**Attempt:** <k>` header already recorded across `{task-root}/{task-id}/05_verify-fix.md` and `05_verify-fix.history.md`, or nothing if neither carries one. Round `N` (`finding-ledger.md` §"Round-number derivation") counts `verify-spec` re-invocations alone and is never gated on `verify-fix` having actually run, so a manually-driven re-run of `/wf:verify-spec` can in principle reach round ≥2 with no `05_verify-fix.md` on disk yet — **a header was found** → `K = k+1`, the resolved command carries `--attempt <K>`; **none found** → `K` is implicitly `1`, the resolved command is the bare `/wf:verify-fix {task-id}`, with no `--attempt` flag, letting `/wf:verify-fix`'s own Phase 1.5 default (`k = 1`, nothing recorded yet) resolve it exactly as the round-1 unconditional case does. **Before dispatching**, write the companion pin via `record_run_evidence({ workspaceRoot, kind: "gate-approval", subject: "verify-loop:l<L>:r<N>:extend:attempt<K>", taskId })` — no `artifactPath`, `invocation-only` by design, matching the primary record's own shape — and check the response the same way the primary record's own write already does (§"No matching record" above): `recorded` → dispatch at the freshly-resolved `K` as above. **`refused`** → do **not** dispatch — a choice whose idempotency across a resume relies on this pin must never proceed as though the write had landed, for exactly the reason the primary record's own `refused` case already states one paragraph above: without a durable pin, a later headless resume into this same stop cannot tell "the one authorized cycle already ran" apart from "nothing has run yet," recomputes `k` off attempt `K`'s own now-completed header, and dispatches an unauthorized second cycle at `K+1` — the precise replay this mechanism exists to close. Emit `RUN — blocked` naming the pin write's `diagnostic` as the reason; dispatch nothing this round; both the primary `extend` record and the ledger are left intact, so a later resume (once the ledger recovers) re-enters this same "Not found" branch and can still record the pin cleanly.

  When the pin is found-not-reached, or freshly written and `recorded`, carry the resolved command forward as the `verify-fix` dispatch command for Phase 3/4 below (both `--auto` and `--step`) — the outcome is `--attempt <K>` only when a prior header was found (whether read from the pin or recomputed fresh), the bare command otherwise — for exactly one more cycle, then `verify-spec` again as usual. When the pin was found already-reached, skip straight to the `verify-spec`-next outcome described above instead. When the fresh pin write comes back `refused`, there is no command to carry forward this round — the `RUN — blocked` halt above is the outcome.
- **`accept`** → dispatch no `verify-fix`; instead re-invoke `/wf:verify-spec {task-id}` once more (an extra invocation, not a verify⇄fix cycle) so its accept hook (`verify-spec/SKILL.md` §"The blocking set", reading this same `l<L>:r<N>:accept` record) demotes the open blocking lens residue into `## Accepted warnings` and recomputes `**Verdict:**`. Re-derive Phase 2/3 from the result as usual — PASS (no open requirement issue) advances to `qa-gen`; a requirement `FAIL`/`PARTIAL` still open stops `RUN — blocked` naming it, without asking the gate again (the `l<L>:r<N>` record already answered this stop).
- **`stop`** → `RUN — blocked` now, ledger intact.

---

## Phase 4: Dispatch (mode-dependent)

Both modes use the same next-phase + gate computed in Phase 3. They differ only in what happens once the next phase is known.

### Default — walk the front (`--auto`)

Run the auto-front hands-off, one phase per loop iteration, each in an isolated subagent. Loop:

1. **Gate check (halt-before).** Take the Phase-3 next phase. If it is a gated phase — `implement`, `lite`, `verify-fix`, `qa-followup`, `qa-auto`, `qa-run` — or any halt token has fired (`blocked` / `clarify` / `Error` / `ESCALATED`), **STOP the loop**. Emit the run block with the exact command for the human to launch — when the gated phase is `verify-fix` and Phase 3 carried a stop-gate-resolved command (the `extend` case), that exact command (`--attempt <K>` when the stop gate found a prior attempt header, the bare `/wf:verify-fix {task-id}` when it found none) is what's emitted as `Run next:`; the round-1 unconditional case, reached directly rather than through the stop gate, always emits the same bare form. Either way this is a halt, never a dispatch — `run` still never executes `verify-fix` itself; this is the human gate, never auto-advanced into. **A companion pin already reached never surfaces here as a `verify-fix` gate at all** — Phase 3 has already redirected that outcome to `verify-spec`, an auto-front phase, so step 2 below dispatches it hands-off instead of halting.
2. **Dispatch the auto-front phase.** Otherwise the next phase is one of `triage` / `spec` / `plan` / `verify-spec` / `qa-gen`. Immediately before execution, call `resolve_routing` with `workspaceRoot: <absolute pwd -P workspace root>`, `role: "phase-runner"`, `unitIds: ["run:phase"]`, `shapeEvidence: { workSurface: "external-context", atomicity: "atomic", unitCount: 1, unitsIndependent: false, ambiguity: "material", risk: "elevated", toolWork: "material", validation: "judgment", contextIsolation: "required", independentReview: false, returnContract: "mechanically-judgeable", requestedParallelism: 1 }`, `supportsModelSelector: true`, and `supportsEffortSelector: false`. Emit the compact operational record separately from phase-artifact attribution. On `status: stop` or non-null `diagnostic`, halt without rescuing the phase inline. Otherwise obey `executionShape` exactly; this evidence selects `isolated`, so invoke one Task, passing the model selector only when non-null and preserving inherited effort. Invoke the **Task** tool with `subagent_type: wf:phase-runner`, passing `phase` (the next-phase token) and `id`. The subagent runs the phase in its own context and returns **only** that phase's Final Output block. The parent validates that block; retain success, and submit only contract-defined insufficiency through `postAttempt` for a bounded parent-owned retry.
3. **Read the returned block.**
   - `PHASE-RUNNER — refused` / `PHASE-RUNNER — error`, or the wrapped skill's `… — Error` → **halt the loop** with `RUN — error` (or `RUN — blocked` for a `blocked`/`clarify` outcome); surface the subagent's reason and name the command for a manual retry. Do **not** try to complete the failed phase yourself (Safety Rules) — halt, even if you believe you could fetch the data the subagent couldn't.
   - Otherwise accumulate the block (small — just the status lines; this is all that enters the orchestrator's context) and continue.
4. **Re-derive and loop.** Re-run **Phase 2** (detect state from the filesystem) and **Phase 3** (compute next + gate). **Progress guard:** if the phase you just ran did *not* complete — its own artifact is still missing or incomplete on re-derivation, so Phase 3 would name the same phase again — halt with `RUN — error`; the phase made no progress, and re-dispatching it would loop forever. (A phase that completed but routes to a gated next phase — e.g. `verify-spec` → FAIL → `verify-fix` — is progress, not a stall; that halts at step 1, not here.) Otherwise go back to step 1.
5. **Terminal exits:** the loop ends on a halt-before gate (step 1), a phase failure (step 3), the progress guard (step 4), a `--to` bound being reached, or nothing left to run (→ `RUN — complete`, ready for review).

The orchestrator's context grows by only one small status block per phase; every heavy read (tracker fetch, codebase exploration, artifact authoring) stays inside the per-phase subagent. **If subagent invocation is unavailable**, the default walk can't dispatch the subagent — announce this and fall back to `--step` behavior (dispatch one phase by name and stop).

### `--step` (opt-in)

Print the resolved next command and the run status block (Final Output) — the same Phase-3-resolved command the `--auto` gate check above emits, so a `verify-fix` reached via a stop-gate `extend` choice prints the same `--attempt <K>`-or-bare form here too, not only in `--auto`; and when the companion pin was already reached, this prints `/wf:verify-spec {task-id}` instead of a `verify-fix` command, exactly as `--auto` would dispatch it. Do **not** execute the phase — naming the command and stopping is the whole job. The human runs the phase, then `/clear`s and re-invokes `/wf:run <id>` (`--resume`, or `--step` again for another single phase; bare `/wf:run <id>` resumes the hands-off walk), which re-derives state from the artifacts and advances. Use `--step` when you want to review each phase's output before the next one runs.

Do **not**, in either mode, execute a phase inline in your own context (Safety Rules). The default walk dispatches to the `wf:phase-runner` subagent; `--step` names the command.

---

## Edge Cases

- **No artifacts yet (fresh task):** next phase is `triage` (or `spec` with `--no-triage`). Requires an explicit ID.
- **Out-of-order / hand-made artifacts:** trust the filesystem — detect the furthest-complete phase regardless of how it got there.
- **`02_plan.md` partially checked:** implement is *in progress*, not done — next command is `/wf:implement <id>` (it resumes from the first unchecked step on its own).
- **`04_verify.md` is `PASS` but source changed since:** staleness guard warns; offer `--from verify`.
- **verify⇄fix or qa⇄followup exceeds 2 cycles:** halt with `RUN — blocked`, summarize the stuck findings, hand to the user.
- **verify⇄fix stops early (no progress before the cap):** the blocking fingerprint set was stable or grew between two rounds — §"The verify⇄fix stop gate" fires before the cap is spent, not only at it.
- **`--headless` at a verify⇄fix stop with no `--gate`:** `RUN — blocked`, no prompt, no recorded choice, ledger intact — a headless driver never hangs waiting for an answer it cannot give.
- **`--headless` gate-choice record comes back `refused`:** `RUN — blocked` naming the refusal's `diagnostic`, no choice recorded, ledger intact — `<choice>` is never acted on off an unrecorded approval; a full or unreadable ledger degrades to a halt, not a silent proceed.
- **A recorded gate choice from an earlier loop on the same task:** never matches a later loop's stop — the loop identity `L` differs, so a record like `verify-loop:l0:r3:accept` from a finished, `PASS`-ended loop does not answer a new loop's own round-3 stop; the gate is asked (or `--gate` consulted) fresh. The `extend` companion pin (`verify-loop:l<L>:r<N>:extend:attempt<K>`) is scoped by the same `l<L>:r<N>` pair, so it inherits this identically — a pin from a finished loop's round never silences a later loop's own round of the same number, and a reached-pin outcome only ever redirects the loop that minted it.
- **`TRIAGE — lite`:** dispatch `/wf:lite <id>` and stop; the lite flow has its own single gate and terminal state. In the default walk, `lite` is a gated phase — the loop halts before it and names `/wf:lite <id>`.
- **Walk (default), phase subagent returns an error/refusal:** halt immediately (`RUN — error`, or `RUN — blocked` for a `blocked`/`clarify` outcome), surface the subagent's reason, and name the command for a manual retry. Do not keep looping.
- **Walk (default), no forward progress:** if a dispatched phase returns but its artifact is still missing/incomplete on re-derivation, halt with `RUN — error` (progress guard) rather than re-dispatching the same phase forever.
- **Subagent invocation unavailable:** the default walk can't dispatch the `wf:phase-runner` subagent, so it announces the limitation and degrades to `--step` behavior (one phase named per invocation). `--step` itself never needs subagents — it only names commands.
- **An auto-front phase needed answers mid-run (walk, under isolation):** not a halt, and not an error. A phase running inside the `wf:phase-runner` subagent has no interactive channel — the interactive prompt tool is absent from that context's tool catalog — so per that agent's contract it does not block: it resolves the item on the best codebase-grounded reading, records it in its artifact's Open Questions section (or that skill's equivalent), and returns its ordinary terminal block (e.g. `SPEC — Complete`). The walk therefore **advances** — this state raises none of the halt tokens (`blocked` / `clarify` / `Error` / `ESCALATED`), and state detection (Phase 2) deliberately does not read those sections. **This is accepted behavior, not a gap to route around:** in a hands-off walk there is by construction no human on the other end to relay a question to, and halting on every ambiguity would defeat the walk's purpose. The recorded Open Questions section is the relay medium, and the implicit gate before the first source-writing phase is where a human reads it — early enough to act on it. Do not add a halt, a new token, or a relay mechanism here.

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

The `Ran:` line is present in the default walk and lists the phases the loop executed this invocation (e.g. `triage → spec → plan`); omit it entirely in `--step`. `Gate:` in the default walk is `stopped before <phase>` when the loop halted at a gated phase, `auto-complete` when the chain reached its terminal review-ready state, or `halted (<reason>)` on a phase failure, the progress guard, or a verify⇄fix stop gate (`<reason>` then names the stop — e.g. `verify-loop stable at round 3, no --gate (headless)` or `verify-loop cap reached, gate: stop`); in `--step` it is `step`.

`Next:`/`Run next:` name the exact command to run — for a `verify-fix` reached because a stop-gate `extend` choice was recorded, that command carries `--attempt <K>` when §"The verify⇄fix stop gate" — "Act on the choice" found a prior attempt header, or is the bare `/wf:verify-fix {task-id}` when it found none, in both `--auto` and `--step`; every other gated-phase command (including the round-1 unconditional `verify-fix`, which never goes through that resolution) is always the bare form. A caller driving `run` unattended (e.g. `ship`'s `--gate extend`) invokes this field's command verbatim, flags included — never reconstructed as a bare `/wf:<phase> <id>`. **In `--step` only**, when the matched `extend` choice's companion pin has already been reached, `Next:`/`Run next:` names `/wf:verify-spec {task-id}` instead — the authorized cycle already ran, so there is no gate replay and no `verify-fix` dispatch for this round. `--auto` never emits this as a `Next:`/`Run next:` line for this outcome: per Phase 4's gate check, a reached pin resolves to `verify-spec` — an auto-front phase — which the default walk dispatches hands-off within the same loop iteration rather than halting on, so no Final Output naming it that way is ever printed there. Either way, a headless resume that re-enters this same stop advances past it instead of resolving a second, unauthorized cycle.

**The final-output block must always be the very last thing output to chat.**
