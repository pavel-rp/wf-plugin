# Corpus item 4 — drift on model swap (C014-3)

**Model:** claude-opus-4-8
**Kind:** assertion (`expect.json` vs wf-fake scripted responses) · **Tier:** SMOKE
**Scenario:** `/wf:ship FAKE-1` (unfilled slot) run under **different model ids**, hermetic against `fake-scripts.json`

## Provenance

**WF-203 comment 2026-07-17** ("C016 watch-list — observations from shipping the ship.review
gate", item **3. Drift on model swap**): "The gate fragment bakes no model id and names only
abstract delivery ops (`review-threads-read` / `pr-comments-read` / `review-thread-reply`), so
a model swap should not drift its behaviour." **C014 (WF-322) watch-list** — drift on model
swap. **C016 (WF-343) charter OUT-6.**

## The invariant (the C014 property, made a repeatable check)

> Because the gate bakes **no** model id and names only abstract delivery ops, the structural
> signature of a `/wf:ship` run — its terminal block and its invoked contract-op set — is
> **stable across a model swap**. Swapping the run model must not change which ops fire or how
> the run terminates.

`runs-current` records **two** runs of the same unfilled-slot scenario under **different model
ids** (run-1 `run.json` records model arm A, run-2 model arm B — see each `fingerprints`
block). Both settle on the identical op set (`current-branch-query`, `pr-detect`,
`checks-read`, `pr-merge`) and the identical terminal `SHIP — Merged`. The family variance is
`none` — no model-driven drift.

## The assertion (`expect.json`)

Structural over the op log + terminal block — never a transcript exact-match:

- `terminal_block`: name `SHIP`, `status_ere` `^Merged$` — identical terminal regardless of model.
- `ops_invoked.required_ops`: `delivery:checks-read`, `delivery:pr-merge` — the merge path
  fires the same ops under either model.
- `files_touched`: the op log is present; nothing under `src/` is written.

## Seeded breakage

`seeded-breakage/runs` records a run whose behaviour **drifted under a model swap** — the run
under the swapped model skipped the merge (a model-specific hallucinated block), ending
`SHIP — Blocked` with **no** `pr-merge` op. Judged against the same `expect.json` it turns
**red**, naming `terminal_block` (status `Blocked`, not `Merged`) and `ops_invoked` (missing
`pr-merge`) — a model swap changed the structural signature, exactly the drift this item guards.

## Canned-vs-real disclosure

Real containerized runs need Docker + `CLAUDE_CODE_OAUTH_TOKEN`, unavailable here. These run
sets are **canned artifacts shaped exactly like the WF-345 runner's output tree**; the two
model arms are recorded in the per-run `run.json` `fingerprints`, and `runner/run-skill.sh`
regenerates the run bytes under each real model when a container is available (the tier model
is the WF-346 settings-key model). The assertion machinery is identical either way.

## Invocation

```
assert/tiers.sh smoke --scenario corpus/items/model-swap-drift
# → Verdict: PASS   (terminal_block Merged and the same op set under both model arms)
```
