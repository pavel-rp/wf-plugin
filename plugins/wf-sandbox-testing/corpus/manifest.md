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
| 3 | contribution survival across base-skill rewording | assertion (`expect.json` vs scripted threads) | SMOKE | `contribution-survival` — a registered `ship.review` fill driven against differently-reworded Phase 4.5 prose | **WF-203 comment 2026-07-17** (C016 watch-list item **2**: "the fill binds to `ship`'s `interface.md` `## Slots` declaration + the `<!-- wf:slot ship.review -->` body marker, not to Phase 4.5's prose … the fill survives it"); **C014 (WF-322)** watch-list; **C016 (WF-343) OUT-6**. |
| 4 | drift on model swap | assertion (`expect.json` vs scripted responses) | SMOKE | `model-swap-drift` — the same unfilled-slot `/wf:ship` run under two model arms | **WF-203 comment 2026-07-17** (C016 watch-list item **3**: "the gate fragment bakes no model id and names only abstract delivery ops … a model swap should not drift its behaviour"); **C014 (WF-322)** watch-list; **C016 (WF-343) OUT-6**. |
| 5 | orphaned overrides at upgrade | assertion (`expect.json` vs scripted responses) | SMOKE | `orphaned-override` — a personal `_local/slots/ship.review.md` override present, winning under `replace` | **WF-203 comment 2026-07-17** (C016 watch-list item **4**: "a personal `_local/slots/ship.review.md` override (tier rank 30) supersedes the pack contribution (rank 10) wholesale under `replace` … an orphaned override silently keeps the old gate"); **C014 (WF-322)** watch-list; **C016 (WF-343) OUT-6**. |
| 6 | host availability and reversible teardown | deterministic fixture assertion | SMOKE | qa-auto contract/model signatures plus an executed registered-host 14-operation-scenario lifecycle | **WF-432** — “Make host-dependent QA executable or fail fast”, STEP-006. |
| 7 | empty-slot invariant — `spec.questions` | comparison (per declared slot) | SMOKE | `spec.questions` (`plugins/wf/skills/spec/interface.md` → `## Slots`; marker in `spec/SKILL.md` Phase 2 step 2) | **WF-406** — "SUB-1: mirror the spec phase to the tracker via two slots"; the per-declared-slot arm the enumeration in `run.sh` requires the moment a slot is declared; **C014 (WF-322)** empty-slot invariant; **C016 (WF-343) OUT-6(a)**. |
| 8 | empty-slot invariant — `spec.publish` | comparison (per declared slot) | SMOKE | `spec.publish` (`plugins/wf/skills/spec/interface.md` → `## Slots`; marker in `spec/SKILL.md` Phase 4) | **WF-406** — "SUB-1: mirror the spec phase to the tracker via two slots"; the highest-consequence of the three declared slots (its fill performs creating writes), so its unfilled case is asserted silent; **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)**. |

All eight items are **SMOKE-tier**: each judges purely structural signatures (op set, terminal
shape, file set), which is the smoke-tier preference (charter OUT-5 / risk table — SMOKE
prefers structural/deterministic assertions over semantic judgment, so a future PR gate
stays trustworthy). None requires a semantic-judgment or transcript-prose assertion (locked
decision 1). Items 3–5 are the C014 watch-list items retrofit by **WF-348**; items 1–2 are
the WF-347 corpus core; items 7–8 are the per-slot arms **WF-406** owes for the two `spec`
slots it declares.

## Subsumption record

The C014 watch-list has four items; only three become new scenarios (items 3–5). The fourth is
subsumed, not duplicated:

| Watch-list item | Provenance | Covered by | Rationale |
|-----------------|------------|------------|-----------|
| **C014-1 — unfilled-slot silence** | **WF-203 comment 2026-07-17** (C016 watch-list item **1**: "`ship.review` resolves to `unfilled` and `/wf:ship` shows no review term at all"); **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)** | **item 1 — the empty-slot flagship** (`empty-slot-ship-review`) | The flagship's per-declared-slot invariant *is* the unfilled-slot-silence check made repeatable (unfilled slot ⇒ EQUIVALENT to the pinned pre-slot baseline on every structural family). A second scenario would duplicate it, so it is marked subsumed with its provenance link, per charter scope-IN ("items the WF-347 flagship already subsumes are marked subsumed … not duplicated"). |

## Watch-list coverage ledger

Charter Assumption 8 audit: every named C014/C015 watch-list item and every WF-203 comment
existing at implementation time (2026-07-18) is accounted for here — a covering scenario, a
subsumption, or an explicit spec-time deferral with provenance. **Zero unprovenanced, zero
silently dropped.** Each row carries a resolvable `WF-<n>`/`C0<n>` link.

| Watch-list / WF-203 source | Provenance | Status |
|----------------------------|------------|--------|
| C014-1 unfilled-slot silence | WF-203 2026-07-17 item 1; C014 (WF-322); C016 OUT-6(a) | **subsumed** by item 1 (see Subsumption record) |
| C014-2 contribution survival across rewording | WF-203 2026-07-17 item 2; C014 (WF-322); C016 OUT-6 | **covered** by item 3 (`contribution-survival`) |
| C014-3 drift on model swap | WF-203 2026-07-17 item 3; C014 (WF-322); C016 OUT-6 | **covered** by item 4 (`model-swap-drift`) |
| C014-4 orphaned overrides at upgrade | WF-203 2026-07-17 item 4; C014 (WF-322); C016 OUT-6 | **covered** by item 5 (`orphaned-override`) |
| C015 constitution payload presence | C015 (WF-334); C016 (WF-343) | **deferred with rationale** — see the C015 deferral note below |
| C015 dedupe across re-fires | C015 (WF-334); C016 (WF-343) | **deferred with rationale** — see the C015 deferral note below |
| C015 fleet-shipper coverage | C015 (WF-335); C016 (WF-343) | **deferred with rationale** — see the C015 deferral note below |
| WF-203 comment 2026-07-17 (C016 watch-list) | WF-203; C016 (WF-343) | **covered** — its four items map to items 1/3/4/5 above |
| WF-203 comment 2026-07-18 (`/wf:fleet` references dead `/wf:tc`) | WF-203; C013 (WF-317) | **deferred with rationale** — see the WF-203 `/wf:tc` deferral note below |

### C015 constitution-checks deferral (explicit spec-time decision — WF-348)

The three C015 checks — constitution **payload presence**, **dedupe across re-fires**, and
**fleet-shipper coverage** — are properties of the **SessionStart hook + resolver
composition**, not of a skill invocation against wf-fake. `plugins/wf/mcp/src/resolver/constitution.ts`
`composeSessionStartStdout` emits the payload on `startup`/`clear`/`compact` and suppresses it
on `resume` (that suppression *is* the dedupe-across-re-fires guarantee), and **WF-335** carries
the composed constitution into fleet worktree shippers. These are already regression-covered by
the resolver's own hermetic unit suite `plugins/wf/mcp/test/constitution.test.ts` (payload
presence + the four re-fire sources) and the WF-335 fleet-carry. Locked decision 2 requires
every corpus *scenario* to run hermetically **against wf-fake**; the constitution seam is not a
wf-fake delivery/tracker op, so a wf-fake scenario could only be a speculative proxy — which
locked decision 6 forbids (assertions born from observations, never speculation) and the WF-4
lean-ness bar forbids duplicating existing unit coverage. They are therefore **recorded here as
explicit spec-time deferrals with their provenance and their existing coverage pointer**, never
silently dropped (WF-348 success criterion 4).

### WF-203 `/wf:tc` deferral (explicit spec-time decision — WF-348)

The WF-203 comment 2026-07-18 (`/wf:fleet` references the non-existent `/wf:tc`) is a **static
reference-integrity defect** in `fleet/SKILL.md` prose, already **spun out as its own child
issue** (per the comment's closing line). It is not a hermetic behavioral seam a wf-fake
skill-invocation exercises — the dead reference fires only on `fleet`'s fallback/takeover path
against a live host — and it belongs to its dedicated fix, not this corpus. **Deferred here with
provenance**, not silently dropped.

### The declared-slot set (item 1) is enumerated mechanically, not open-ended

Item 1 is asserted **per declared slot**, not once globally. The declared-slot set is read
mechanically from the resolver's per-slot surface — a skill declares its slots in its
`interface.md` `## Slots` table and marks them with a `<!-- wf:slot <skill>.<point> -->`
body-marker pair (WF-329). At WF-347 implementation time the entire marketplace tree declared
exactly one slot (`ship.review`); **WF-406** declares two more, so the set is now:

```
ship.review      (plugins/wf/skills/ship/interface.md → ## Slots; marker in ship/SKILL.md Phase 4.5)
spec.questions   (plugins/wf/skills/spec/interface.md → ## Slots; marker in spec/SKILL.md Phase 2 step 2)
spec.publish     (plugins/wf/skills/spec/interface.md → ## Slots; marker in spec/SKILL.md Phase 4)
```

`run.sh`'s enumeration step re-derives this set from the source at run time and asserts one
baseline-comparison item per declared slot, so a newly-declared slot with no empty-slot arm
fails the suite loudly rather than going silently unchecked — which is exactly how items 7–8
came to be owed. Each item's `item.md` carries the per-family variance thresholds and its own
baseline-arm provenance; `items/empty-slot-ship-review/item.md` holds the original named
spec-time threshold decision the later arms inherit unchanged.

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
| `items/contribution-survival/` | item 3 (C014-2): `item.md` + `expect.json` + `fake-scripts.json`; `runs-current/` (original + reworded Phase 4.5 prose) green; `seeded-breakage/` (marker dropped) red |
| `items/model-swap-drift/` | item 4 (C014-3): `item.md` + `expect.json` + `fake-scripts.json`; `runs-current/` (two model arms) green; `seeded-breakage/` (drift skips merge) red |
| `items/orphaned-override/` | item 5 (C014-4): `item.md` + `expect.json` + `fake-scripts.json`; `runs-current/` (override present, wins under `replace`) green; `seeded-breakage/` (override removed) red |
| `items/empty-slot-spec-questions/` | item 7 (WF-406): `item.md` + `baseline/` (pinned pre-slot arm) + `runs-current/` (unfilled) + `seeded-breakage/` (a fill that posts the questions comment) |
| `items/empty-slot-spec-publish/` | item 8 (WF-406): `item.md` + `baseline/` (pinned pre-slot arm) + `runs-current/` (unfilled) + `seeded-breakage/` (a fill that publishes the spec as a child record) |
| `fixtures/host-lifecycle/` | item 6 (WF-432): deterministic no-egress host availability signatures and a 14-scenario `expose`/`augment`/`seed`/`fixture` lifecycle; byte-tree restoration is checked after success and failure |
| `assert/tree-equal.sh` | fail-closed byte-tree comparison used by the host lifecycle fixture |
| `run.sh` | the corpus self-check: slot enumeration, flagship green/seeded-red, review-gate, the assertion-item loop (items 3–5), the provenance audit, and the coverage-ledger audit (CI entrypoint) |
| `README.md` | authoring reference (never read at runtime) |
