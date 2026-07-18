# wf-sandbox-testing corpus — authoring reference

Reference documentation for the behavioral-regression corpus that the assertion layer
(`../assert/`) judges. Authoring/reference only — **not read by any skill at runtime**. The
authoritative index is [`manifest.md`](manifest.md); the CI entrypoint is `run.sh`.

## Table of contents

- [What the corpus is](#what-the-corpus-is)
- [The two WF-347 items](#the-two-wf-347-items)
- [How an item is shaped](#how-an-item-is-shaped)
- [The declared-slot enumeration (why per-slot, not global)](#the-declared-slot-enumeration)
- [Provenance discipline](#provenance-discipline)
- [Canned vs real runs (honest disclosure)](#canned-vs-real-runs)
- [Running it](#running-it)
- [Files](#files)

## What the corpus is

The corpus is the set of behavioral regression items the sandbox-testing harness runs against
real skill invocations (charter C016 / WF-343, OUT-6). Each item is **mined from an
already-observed failure mode** — a `WF-203` watch-list comment or a named charter watch-list
line — never speculated (locked decision 6). It grows **retrofit-first**: an observation
becomes an assertion before or with its fix, never upfront speculative coverage.

WF-347 creates the manifest and ships its **two structurally-heaviest** items. Later sub-tasks
extend it: WF-348 retrofits the remaining C014/C015 watch-list items and existing WF-203
findings; WF-349 documents the findings-loop procedure and packages the pack; WF-350 adds the
PR gate. None of those are in WF-347's scope.

## The two WF-347 items

1. **The empty-slot invariant — `ship.review`** (flagship, comparison item). For each declared
   slot, an unfilled slot must behave equivalently to the **pre-slot baseline** on the
   structural families — the C014 kill-criterion, made a repeatable per-slot check. See
   [`items/empty-slot-ship-review/item.md`](items/empty-slot-ship-review/item.md).
2. **The review-gate five requirements** (assertion item). The WF-313 review-gate hardening,
   exercised hermetically against wf-fake's scripted threads. See
   [`items/review-gate/item.md`](items/review-gate/item.md).

Both are **SMOKE-tier** — they judge purely structural signatures (the smoke-tier preference).

## How an item is shaped

An item is one of two shapes, each consuming an existing `../assert/` primitive:

- **comparison item** (`assert/compare.sh`) — a per-slot pinned-build **baseline arm** compared
  against a **current** run set; EQUIVALENT / DIVERGENT per structural family under a variance
  ceiling. The empty-slot flagship is this shape.
- **assertion item** (`assert/tiers.sh` + `expect.json`) — a run set judged against declared
  per-family expectations, variance-aware. The review-gate is this shape.

Both consume the WF-345 runner's output tree (`transcript.jsonl` + `run.json` +
`workspace-snapshot/.../op-log.jsonl`) and judge only **structural** signatures — the
terminal-block shape, the workspace file set, and the invoked contract-op set. **No item
exact-matches transcript prose** (locked decision 1).

## The declared-slot enumeration

The flagship is asserted **per declared slot, not once globally** (WF-347 success criterion /
charter OUT-6). `run.sh` enumerates the declared-slot set **mechanically** from source — the
`<!-- wf:slot <skill>.<point> -->` markers in `plugins/*/skills/*/SKILL.md`, the same declared
surface the resolver reads (WF-329). At WF-347 implementation time the tree declares exactly
one slot, `ship.review`. A newly declared slot with no matching empty-slot corpus item fails
the suite loudly — the set is bounded by what source declares, never open-ended, and never
silently unchecked.

## Provenance discipline

`manifest.md`'s Items table carries a per-item provenance cell; `run.sh`'s provenance audit
fails the suite if any item lacks a resolvable link (a `WF-<n>` comment/issue or a `C0<n>`
charter watch-list line). This is the charter's zero-unprovenanced-items rule (OUT-6 / OUT-8).

## Canned vs real runs

Real containerized runs need Docker **and** a host-minted `CLAUDE_CODE_OAUTH_TOKEN` (charter
OUT-3), both absent in the authoring/CI environment — the same constraint WF-345 and WF-346
hit. The committed run sets are therefore **canned artifacts shaped exactly like the WF-345
runner's output tree** (the WF-346 precedent). What ran canned and why is recorded in each
`item.md`, the verify artifact, and the PR body. The `fake-scripts.json` under the review-gate
item is the **real** wf-fake scripts file the scenario drives; `runner/run-skill.sh`
regenerates the run bytes from a live container when one is available — the assertion
machinery does not change, only the provenance of the run bytes.

## Running it

```
plugins/wf-sandbox-testing/corpus/run.sh          # the full corpus self-check (CI entrypoint)

# individual items, via the assert-layer primitives:
assert/compare.sh --current items/empty-slot-ship-review/runs-current \
                  --baseline items/empty-slot-ship-review/baseline/runs --max-variance 0.34
assert/tiers.sh smoke --scenario items/review-gate
```

## Files

| Path | Role |
|------|------|
| `manifest.md` | the authoritative item index with per-item provenance |
| `run.sh` | the corpus self-check: provenance, slot enumeration, flagship, arm record, review-gate |
| `items/empty-slot-ship-review/` | item 1 — the empty-slot flagship (per declared slot) |
| `items/review-gate/` | item 2 — the WF-313 five-requirements scenario |
