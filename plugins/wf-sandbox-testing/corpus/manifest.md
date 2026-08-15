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
| 9 | empty-slot invariant — `plan.publish` | comparison (per declared slot) | SMOKE | `plan.publish` (`plugins/wf/skills/plan/interface.md` → `## Slots`; marker in `plan/SKILL.md` Phase 3) | **WF-407** — "SUB-2: mirror the plan and tasks phases via two publish slots"; the per-declared-slot arm `run.sh`'s enumeration requires the moment a slot is declared; its fill performs creating writes, so the unfilled case is asserted silent; **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)**. |
| 10 | empty-slot invariant — `tasks.publish` | comparison (per declared slot) | SMOKE | `tasks.publish` (`plugins/wf/skills/tasks/interface.md` → `## Slots`; marker in `tasks/SKILL.md` Phase 5) | **WF-407** — "SUB-2: mirror the plan and tasks phases via two publish slots"; the decomposition it publishes is a list, so the unfilled case is asserted to emit **zero** records rather than "one fewer than the fill would"; **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)**. |
| 11 | empty-slot invariant — `implement.start` | comparison (per declared slot) | SMOKE | `implement.start` (`plugins/wf/skills/implement/interface.md` → `## Slots`; marker in `implement/SKILL.md` Phase 1.5) | **WF-408** — "SUB-3: mirror the implement phase via three lifecycle slots"; the first lifecycle point to fire and the one whose fill *creates* an external record, so the unfilled case asserts the record never comes into being; **C021 (WF-405)**; **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)**. |
| 12 | empty-slot invariant — `implement.milestone` (the first `append` point) | comparison (per declared slot) | SMOKE | `implement.milestone` (`plugins/wf/skills/implement/interface.md` → `## Slots`; marker in `implement/SKILL.md` Phase 2.5) | **WF-408** — "SUB-3: mirror the implement phase via three lifecycle slots"; the **only `append`-policy composition point** in the charter, so its seeded arm asserts registry-ordered concatenation of two contributions rather than the single-author `replace` shape; **C021 (WF-405)**; **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)**. |
| 13 | empty-slot invariant — `implement.finish` | comparison (per declared slot) | SMOKE | `implement.finish` (`plugins/wf/skills/implement/interface.md` → `## Slots`; marker in `implement/SKILL.md` Phase 5.5) | **WF-408** — "SUB-3: mirror the implement phase via three lifecycle slots"; it fires mid-conveyor, so its fill moves an external record to a **non-terminal** state and the unfilled case is the clean control for that; **C021 (WF-405)**; **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)**. |

| 14 | bare-core conveyor — zero tracker calls, zero errors, seven unfilled slots | absolute assertion (zero-tolerance, no variance ceiling) | SMOKE | `barecore-conveyor` — the full `spec → plan → tasks → implement` conveyor in a registry with **zero capability rows** (both provider surfaces `unconfigured`) | **WF-414** — "SUB-5: prove and lock the ×7 bare-core empty-slot invariant"; **C021 (WF-405) OUT-4** ("works identically, locally, zero tracker traffic"); the empty-slot invariant of **C014 (WF-322)**; **C016 (WF-343) OUT-6(a)**. |

All fourteen items are **SMOKE-tier**: each judges purely structural signatures (op set, terminal
shape, file set), which is the smoke-tier preference (charter OUT-5 / risk table — SMOKE
prefers structural/deterministic assertions over semantic judgment, so a future PR gate
stays trustworthy). None requires a semantic-judgment or transcript-prose assertion (locked
decision 1). Items 3–5 are the C014 watch-list items retrofit by **WF-348**; items 1–2 are
the WF-347 corpus core; items 7–8 are the per-slot arms **WF-406** owes for the two `spec`
slots it declares; items 9–10 are the per-slot arms **WF-407** owes for the `plan` and
`tasks` publish slots it declares; items 11–13 are the per-slot arms **WF-408** owes for the
three `implement` lifecycle slots it declares. Item 14 is the bare-core arm **WF-414** adds — the
one configuration items 1 and 7–13 structurally cannot cover, because every one of their arms runs
in the `demo-fake` fixture where `fake` owns **both** provider surfaces and their `runs-current` op
logs genuinely contain tracker records.

### Why item 14 is not a duplicate of items 1 and 7–13

Items 1 and 7–13 compare an unfilled slot against a **pinned pre-slot baseline with a tracker
registered**, under an `ops_invoked` variance ceiling of **`0.34`** ("one outlier in a 3-run set
tolerated"). Two consequences make them unable to carry C021 OUT-4:

1. **They assert equivalence, not absence.** A no-op inline default emitting a tracker call on a
   *minority* of runs is classified **drift**, not regression, and passes. "Zero tracker calls" is
   not expressible as a variance threshold.
2. **They never exercise the unconfigured-surface path.** Bare core is a distinct code path —
   `state: unconfigured` on both surfaces — with its own documented degradation in every conveyor
   skill body.

Item 14 is therefore **additive and absolute**: it calls `assert/compare.sh` not at all, and one
tracker-surface record anywhere in its run set is a hard failure. Its seeded-breakage set is the
negative control proving the detector can observe a tracker call rather than passing vacuously.

## Per-arm canned-vs-real disclosure ledger

Charter OUT-3 requires each arm to state which path produced it, so a reviewer knows exactly what
each arm proves. `run.sh`'s `check_disclosure` audits this mechanically: every `arm.json` carries
`provenance: { path, reason }` with `path` ∈ {`canned`, `real`}, and every item carries the paired
prose section. **All nine arms are `canned`** — zero real containerized arms exist in this
environment, and none is claimed.

| Arm | Item | Path | Why not a live run |
|-----|------|------|--------------------|
| `empty-slot-ship-review/baseline` | 1 | **canned** | Docker + `CLAUDE_CODE_OAUTH_TOKEN` both absent (the WF-345/346/347 constraint) |
| `empty-slot-spec-questions/baseline` | 7 | **canned** | as above |
| `empty-slot-spec-publish/baseline` | 8 | **canned** | as above |
| `empty-slot-plan-publish/baseline` | 9 | **canned** | as above |
| `empty-slot-tasks-publish/baseline` | 10 | **canned** | as above |
| `empty-slot-implement-start/baseline` | 11 | **canned** | as above |
| `empty-slot-implement-milestone/baseline` | 12 | **canned** | as above |
| `empty-slot-implement-finish/baseline` | 13 | **canned** | as above |
| `barecore-conveyor` | 14 | **canned** | Docker + token absent, **and** the installed plugin cache is `wf` 0.87.0 while the seven slots live in 0.93.0 — skills execute from the installed cache, so a live conveyor would have exercised a **pre-slot** build in which the `<!-- wf:slot … -->` markers do not exist, observing no slot resolution at all while appearing authoritative |

When Docker, a token, and a current-build install are available, `runner/run-skill.sh` regenerates
any of these sets and the assertions re-run **unchanged** — only the provenance of the run bytes
changes, never the assertion machinery.

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
exactly one slot (`ship.review`); **WF-406** declares two more, **WF-407** two more again, and
**WF-408** three more, so the set is now:

```
ship.review          (plugins/wf/skills/ship/interface.md      → ## Slots; marker in ship/SKILL.md      Phase 4.5)
spec.questions       (plugins/wf/skills/spec/interface.md      → ## Slots; marker in spec/SKILL.md      Phase 2 step 2)
spec.publish         (plugins/wf/skills/spec/interface.md      → ## Slots; marker in spec/SKILL.md      Phase 4)
plan.publish         (plugins/wf/skills/plan/interface.md      → ## Slots; marker in plan/SKILL.md      Phase 3)
tasks.publish        (plugins/wf/skills/tasks/interface.md     → ## Slots; marker in tasks/SKILL.md     Phase 5)
implement.start      (plugins/wf/skills/implement/interface.md → ## Slots; marker in implement/SKILL.md Phase 1.5)
implement.milestone  (plugins/wf/skills/implement/interface.md → ## Slots; marker in implement/SKILL.md Phase 2.5)
implement.finish     (plugins/wf/skills/implement/interface.md → ## Slots; marker in implement/SKILL.md Phase 5.5)
```

`implement.milestone` is the first declared point whose merge policy is **`append`** rather than
`replace`; its arm (item 12) is therefore the only one asserting registry-ordered concatenation of
multiple contributions. The enumeration itself is policy-blind — it asserts one arm per declared
slot regardless of merge policy — so the distinction lives in the item, not in `run.sh`.

The same enumeration also drives item 14's bare-core coverage: `barecore-conveyor/arm.json`
declares `slots_covered` (the seven conveyor slots) and `slots_exempt`, and `check_barecore`
asserts their union equals the enumerated declared-slot set — so a newly declared slot appearing
in neither list fails there too. Exactly one slot is exempt: **`ship.review`**, because it is
declared in `/wf:ship` Phase 4.5 and `/wf:ship` Phase 1 **requires** a delivery provider,
hard-stopping with `SHIP — Blocked` before Phase 4.5 ever resolves the slot. It is therefore
unreachable in bare core by `/wf:ship`'s own documented contract, not by omission — and its
unfilled behavior stays covered by item 1. Every exemption must carry a non-empty reason, so an
exemption cannot become a hiding place.

**The arm-less failure is itself tested.** `check_armless_meta` (WF-414) runs the same enumeration
and arm lookup against a synthetic declared slot in a temp tree and asserts it is reported
arm-less — a guard nobody has watched go red is indistinguishable from a guard that cannot.

`run.sh`'s enumeration step re-derives this set from the source at run time and asserts one
baseline-comparison item per declared slot, so a newly-declared slot with no empty-slot arm
fails the suite loudly rather than going silently unchecked — which is exactly how items 7–8,
then items 9–10, then items 11–13 came to be owed. Each item's `item.md` carries the per-family variance thresholds and its own
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
| `items/empty-slot-plan-publish/` | item 9 (WF-407): `item.md` + `baseline/` (pinned pre-slot arm) + `runs-current/` (unfilled) + `seeded-breakage/` (a fill that publishes the plan as a child record) |
| `items/empty-slot-tasks-publish/` | item 10 (WF-407): `item.md` + `baseline/` (pinned pre-slot arm) + `runs-current/` (unfilled) + `seeded-breakage/` (a fill that publishes the decomposition as one child record) |
| `items/empty-slot-implement-start/` | item 11 (WF-408): `item.md` + `baseline/` (pinned pre-slot arm) + `runs-current/` (unfilled) + `seeded-breakage/` (a fill that opens an execution child record and moves it and its umbrella into progress) |
| `items/empty-slot-implement-milestone/` | item 12 (WF-408): `item.md` + `baseline/` (pinned pre-slot arm) + `runs-current/` (unfilled) + `seeded-breakage/` (**two** contributions to the same `append` point, both running in registry order at every checkpoint) |
| `items/empty-slot-implement-finish/` | item 13 (WF-408): `item.md` + `baseline/` (pinned pre-slot arm) + `runs-current/` (unfilled) + `seeded-breakage/` (a fill that consolidates the execution record and moves it to a non-terminal review state) |
| `fixtures/host-lifecycle/` | item 6 (WF-432): deterministic no-egress host availability signatures and a 14-scenario `expose`/`augment`/`seed`/`fixture` lifecycle; byte-tree restoration is checked after success and failure |
| `items/barecore-conveyor/item.md` | item 14 (WF-414) spec: what bare core means here, why the eight per-slot arms cannot cover it, the slot-coverage/exemption record, and the canned-vs-real disclosure |
| `items/barecore-conveyor/arm.json` | the bare-core arm: registry state, `slots_covered` / `slots_exempt` (each exemption reasoned), run fingerprints, and machine-readable `provenance` |
| `items/barecore-conveyor/runs-current/` | the 3-run bare-core conveyor set — present-but-empty op logs (zero provider ops of any surface), all seven covered slots `unfilled` on their no-op inline defaults |
| `items/barecore-conveyor/seeded-breakage/runs/` | the negative control: `implement.start`'s inline default attempts a tracker `create_child`, tripping both the zero-call and the zero-error assertions |
| `assert/tree-equal.sh` | fail-closed byte-tree comparison used by the host lifecycle fixture |
| `run.sh` | the corpus self-check: slot enumeration, flagship green/seeded-red, review-gate, the assertion-item loop (items 3–5), the provenance audit, and the coverage-ledger audit (CI entrypoint) |
| `README.md` | authoring reference (never read at runtime) |
