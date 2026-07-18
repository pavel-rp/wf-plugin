# wf-sandbox-testing corpus — manifest

**Model:** claude-opus-4-8

The corpus is the set of behavioral regression items the sandbox-testing harness runs
against skill invocations. Each item is **mined from an already-observed failure mode** — a
`WF-203` watch-list comment or a named charter watch-list line (locked decision 6:
assertions are born from observations, never speculation). This file is the authoritative
index; the provenance audit in `run.sh` fails the suite if any shipped item lacks a
resolvable provenance link.

This manifest is **created by WF-347** with the two structurally-heaviest items of the C016
first corpus (charter OUT-6). The retrofit sub-task (WF-348) extends it with the remaining
C014/C015 watch-list items and the existing WF-203 findings; the packaging sub-task (WF-349)
adds the findings-loop procedure; the PR gate is WF-350. Nothing here depends on those.

## How an item is judged (no exact-match, ever)

Every item judges the WF-345 runner's **structural** outputs — the terminal-block shape, the
resulting-workspace file set, and the invoked contract-op set — over N runs under the WF-346
variance protocol. **No item exact-matches transcript prose.** An item is one of two shapes:

- **comparison item** — a per-slot baseline arm compared against a current run set with
  `assert/compare.sh` (EQUIVALENT / DIVERGENT per family under a variance ceiling).
- **assertion item** — a run set judged against an `expect.json` with `assert/tiers.sh`
  (per-family PASS/FAIL with variance-aware drift-vs-regression).

## Items

| # | Item | Kind | Tier | Declared slot / scenario | Provenance (resolvable) |
|---|------|------|------|--------------------------|-------------------------|
| 1 | empty-slot invariant — `ship.review` | comparison (per declared slot) | SMOKE | `ship.review` (the sole declared slot; enumerated mechanically — see below) | **WF-203 comment 2026-07-17** ("C016 watch-list — observations from shipping the ship.review gate", item **1. Unfilled-slot silence": "`ship.review` resolves to `unfilled` and `/wf:ship` shows no review term at all"); **C014 (WF-322) charter risk table** — the empty-slot invariant a named C016 deliverable ("C016 makes it a per-slot CI assertion"); **C016 (WF-343) charter OUT-6(a)**. |
| 2 | review-gate five requirements | assertion (`expect.json` vs scripted threads) | SMOKE | `review-gate` scenario against wf-fake's scripted delivery responses | **WF-313** ("Harden the review gate: a shipper must not merge while claiming no review landed" — the /fleet NEU-889 audit: 23 of 25 findings unanswered, several never seen); **C016 (WF-343) charter OUT-6(d)** names the five requirements. |

Both items are **SMOKE-tier**: both judge purely structural signatures (op set, terminal
shape, file set), which is the smoke-tier preference (charter OUT-5 / risk table — SMOKE
prefers structural/deterministic assertions over semantic judgment, so a future PR gate
stays trustworthy). Neither requires a semantic-judgment or transcript-prose assertion.

### The declared-slot set (item 1) is enumerated mechanically, not open-ended

Item 1 is asserted **per declared slot**, not once globally. The declared-slot set is read
mechanically from the resolver's per-slot surface — a skill declares its slots in its
`interface.md` `## Slots` table and marks them with a `<!-- wf:slot <skill>.<point> -->`
body-marker pair (WF-329). At WF-347 implementation time the entire marketplace tree
declares exactly **one** slot:

```
ship.review   (plugins/wf/skills/ship/interface.md → ## Slots; marker in ship/SKILL.md Phase 4.5)
```

`run.sh`'s enumeration step re-derives this set from the source at run time and asserts one
baseline-comparison item per declared slot, so a newly-declared slot with no empty-slot arm
fails the suite loudly rather than going silently unchecked. See
`items/empty-slot-ship-review/item.md` for the per-family variance thresholds (the named
spec-time decision) and the baseline-arm provenance.

## Files

| Path | Role |
|------|------|
| `items/empty-slot-ship-review/item.md` | item 1 spec: the invariant, per-family thresholds, baseline-arm record |
| `items/empty-slot-ship-review/baseline/` | the recorded pinned pre-slot baseline arm (`arm.json` + N fingerprinted runs) |
| `items/empty-slot-ship-review/runs-current/` | the current-build unfilled-slot run set |
| `items/empty-slot-ship-review/seeded-breakage/` | a seeded slot-fill run set that must diverge (proves the item turns red) |
| `items/review-gate/item.md` | item 2 spec: the five WF-313 requirements → op-log evidence map |
| `items/review-gate/expect.json` | the five-requirements assertion (structural, over the op log) |
| `items/review-gate/fake-scripts.json` | the wf-fake scripted review threads this scenario drives |
| `items/review-gate/runs-current/` | the green run set exercising all five requirements |
| `items/review-gate/seeded-breakage/` | a seeded "merged while claiming no review" run that must turn red |
| `run.sh` | the corpus self-check: slot enumeration, green, seeded-red, and the provenance audit (CI entrypoint) |
| `README.md` | authoring reference (never read at runtime) |
