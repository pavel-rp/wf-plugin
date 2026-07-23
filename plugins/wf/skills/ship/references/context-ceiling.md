# The context ceiling — rationale and design

Paired reference for the **§"Context ceiling checkpoint"** section of `SKILL.md`. Read on
demand when reasoning about the ceiling mechanism; **never read at runtime** — the ops
section in the body carries everything the running skill needs. This file holds the *why*:
the mechanism decision and its evidence, the carried-state set, the resumption path, the
never-stranded case, the trigger-signal design, and the two resume topologies.

## The problem

`ship` drives each gated phase and the PR/finalize tail **inline**, reading a terminal
block back from every sibling edge it dispatches. Its context therefore grows monotonically
across a run: inline gated phases (implement, the QA tail), inline `/wf:pr` and `/wf:tf`
output, and the per-edge handoff summaries all accumulate in the one orchestrator context.
Left unbounded, a large task can grow the shipper past a usable size (a measured run reached
422K). The goal of this mechanism is to hold a single ship run under a **stated ceiling**
while still reaching a merged PR with no lost state.

## Mechanism decision: hand-off, not compaction

Two alternatives were genuinely on the table — neither pre-selected. Both are recorded here
so the rejected one stays visible to whoever revisits this.

### Compaction (evaluated, rejected)

- **Its one real advantage:** no state-transfer boundary. The run keeps the same context
  identity, so nothing has to be re-derived across a cut.
- **Why it loses on evidence:**
  1. **It cannot enforce a *stated* ceiling from inside a running agent.** A running skill
     has no primitive to trigger its own compaction at a chosen point. The only compaction
     available is the harness's automatic compaction, which fires near the model's
     context-window limit — an order of magnitude above a lean stated ceiling like the
     default. The binding success criterion is "peak context **under the stated ceiling**";
     a mechanism that only trips near the window limit cannot satisfy it.
  2. **Its no-boundary advantage is moot here.** That advantage only matters when rich
     in-context state would be lost across a boundary. In this harness there is none: every
     phase persists its state to the task folder and is detect-first resumable, so the state
     the remaining phases need never lives only in context.

### Hand-off to a fresh shipper (chosen)

The harness architecture makes the hand-off boundary nearly free. The **only** state that
must cross is a single durable token — the task id — passed as the re-invocation argument
`/wf:ship <id>`. Everything else is durable on disk and in the delivery provider, re-derived
by the existing detect-first siblings. Hand-off also **reuses a proven path** rather than
inventing a new primitive: re-dispatching a fresh `/wf:ship <id>` that resumes detect-first
is already the recovery motion used elsewhere for a stalled or interrupted ship. A ceiling
hand-off is that same motion, initiated by `ship` at a chosen checkpoint instead of by a
supervisor after a stall.

**Decision:** hand-off (checkpoint-and-re-enter a fresh shipper). Compaction was evaluated
and rejected on the two grounds above — it cannot hold a stated ceiling, and the safety edge
it offers is moot given the harness's durable-on-disk, detect-first resumability.

## Carried state across the hand-off

The receiving fresh shipper relies on **exactly** this set, and nothing outside it:

1. **The task id** — carried as the re-invocation argument `/wf:ship <id>`. The single
   in-context token that crosses the boundary.
2. **Durable state the fresh shipper re-derives** (all of it flushed before yielding):
   - the task-folder **phase artifacts** (`01_…` … `07_…`, `index.md`), each written by its
     phase skill as that phase completes;
   - the task **branch with every commit pushed** to the remote;
   - the **open pull request**, once Phase 3 has run.

Nothing in the shipper's transcript — inter-phase handoff summaries, inline `/wf:pr` or
`/wf:tf` output, phase exploration — is relied upon; it is all reconstructable from the set
above.

**Flush invariant.** The checkpoint is taken only at an **inter-phase boundary**, and only
after the just-completed phase's output is committed **and pushed**. That is what makes the
boundary lossless — a yield never strands unpushed work, the one thing a hand-off could lose.

## The in-run trigger signal — observable, not "the model decides"

At each boundary the estimate is `max(primary, proxy)`:

- **primary** — a running approximate-token sum (ingested-text characters ÷ 4) of every
  block `ship` has read back and every artifact it has read this run, plus a fixed base for
  the skill body, resolved config, and the Phase-1 records. Directly observable: the text is
  in `ship`'s own context.
- **proxy (floor)** — inter-phase boundaries crossed × a conservative per-phase increment,
  so the estimate never under-counts a single large inline phase whose bulk the primary sum
  might under-represent.

Taking the max makes the trigger a mechanical, reproducible function of observable inputs —
never a subjective "context feels large" judgement. The estimate is compared against
`coreConfig.contextCeiling` (default `150000`) with a one-phase margin, so the checkpoint
fires *before* the next phase would push the run over rather than after.

## Resumption path (receiving shipper)

`/wf:ship <id>` in a clean context: resolve config → require delivery provider →
`/wf:branch` returns **already-active** on the pushed branch → `/wf:run` **detect-first**
advances from the artifacts on disk → Phase 3 `/wf:pr` **detects** the existing PR (opens one
iff none exists) → Phase 5 `/wf:tf` is **detect-first idempotent** (never double-merges).
Re-entry is idempotent and lossless.

## The never-stranded case: pushed branch, unopened PR

If the crossing fires in exactly the gap between a pushed branch and an opened PR, the fresh
shipper's Phase 3 finds no open PR via `pr-detect` and opens it. The task is never stranded —
this is the material failure case the mechanism is designed to survive, and the reason the
flush invariant requires a **push** (not merely a commit) before yield.

## Two resume topologies: same-worktree vs fresh-worktree

The hand-off is correct under both places the fresh `/wf:ship <id>` can land:

- **Same worktree / same checkout.** The receiving shipper sees the on-disk task-folder
  artifacts directly, plus the pushed branch and (if opened) the PR. Every element of the
  carried-state set is present locally; detect-first resume reads them in place.
- **Fresh worktree (e.g. re-dispatched into a new isolated checkout).** The gitignored
  task-folder artifacts under `_local/` do **not** transfer to a brand-new worktree. This is
  exactly why the flush invariant pushes the **branch** and (from Phase 3 on) opens the
  **PR**: those two are durable in the delivery provider, not in any one worktree. In a fresh
  worktree the receiving shipper re-derives from the remote — `/wf:branch` checks out the
  pushed branch, `/wf:run` reads whatever artifacts the checkout carries and re-runs any
  phase whose artifact is absent (detect-first, deterministic), `pr-detect` finds the open
  PR, and `/wf:tf` merges idempotently. The earlier the boundary, the more a fresh worktree
  re-runs; the flush guarantees it never re-runs from *less* than the pushed code state, so
  no committed work is ever lost or double-applied.

The same-worktree resume is strictly cheaper (nothing to re-run); the fresh-worktree resume
is the worst case and is still lossless. The mechanism is designed against the worst case, so
it is safe in both.

## Why the ceiling is a config key

The ceiling is read from `coreConfig.contextCeiling` (project config key `Context Ceiling`),
never hardcoded — Core Article 7 (project configuration lives in config). An absent, `<none>`,
or unparseable value falls back to the shipped default `150000` (Core Article 8, lean
default), so a repo initialized before the key existed degrades gracefully. A deliberately
**lowered** value is the intended way to force an early, real crossing — for exercising or
demonstrating the hand-off without waiting for a genuinely huge task.
