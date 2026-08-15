# Corpus item 14 — the bare-core conveyor: zero tracker calls, zero errors, seven unfilled slots

**Model:** claude-opus-5[1m]
**Provenance:** **WF-414** ("SUB-5: prove and lock the ×7 bare-core empty-slot invariant"),
charter **C021 (WF-405)** OUT-4; the empty-slot invariant of **C014 (WF-322)**; the per-slot
corpus shape of **C016 (WF-343)** OUT-6(a).

---

## What this item guards, and why the eight per-slot arms do not already guard it

Items 1 and 7–13 assert, per declared slot, that an **unfilled** slot's run set is `EQUIVALENT`
to a pinned pre-slot baseline arm. That is a *comparison against a tracker-registered control*:
every one of those arms runs in the `demo-fake` fixture, where the `fake` capability owns **both**
the delivery and tracker surfaces. Their `runs-current` op logs genuinely contain tracker records —
e.g. `items/empty-slot-spec-publish/runs-current/run-1/…/op-log.jsonl` carries
`{"seq":2,"surface":"tracker","op":"get",…}`. So those items prove:

> an unfilled slot behaves exactly as it did before the slot existed, **with a tracker registered**.

They cannot prove, and do not attempt to prove, C021 OUT-4's actual promise:

> with **no tracker pack registered**, the full conveyor completes with **zero tracker calls and
> zero errors**, and every one of the seven new slots resolves `{status: unfilled}` and runs its
> **no-op inline default**.

Two further reasons the per-slot arms cannot stand in for this one:

1. **Their tolerance is variance-based, not absolute.** Every `empty-slot-*` item sets the
   `ops_invoked` comparison ceiling to **`0.34`** — documented in each `item.md` as "one outlier
   in a 3-run set tolerated". A no-op inline default that emitted a tracker call on a *minority*
   of runs would be classified **drift**, not regression, and would pass. "Zero tracker calls" is
   not expressible as a variance threshold; it needs a zero-tolerance assertion.
2. **They never exercise the unconfigured-surface degradation path at all.** Bare core is a
   distinct code path — `state: unconfigured` on both provider surfaces — with its own documented
   behavior in every conveyor skill body ("Branch gate skipped — no delivery provider registered
   (bare-core mode)"; the tracker `get`'s "silent local-only fallback").

This item adds the missing arm and the missing assertion.

---

## What "bare core" means here, exactly

The `barecore-conveyor` fixture is a workspace whose `## Capabilities` registry has **zero rows**.
Consequently:

| Surface | Resolved state | Consequence |
|---------|----------------|-------------|
| `delivery` | `unconfigured` | the branch gate degrades to a stated no-op in every conveyor skill |
| `tracker`  | `unconfigured` | the `get` read is the silent local-only fallback; **no tracker binding exists at all** |
| every declared slot | `{status: unfilled}` | no capability contributes a slot and no personal `_local/slots/<skill>.<point>.md` override is present, so each marker's **inline-default region** executes verbatim |

This is the configuration Core Article 8 names directly — *"Core never requires a capability. Every
core extension point ships a lean default and runs inert when no capability is registered."*

**Why "zero errors" is itself a tracker-call detector.** In bare core there is no tracker binding
to dispatch to. An inline default that attempted a tracker call could not silently succeed — it
would fail to resolve a provider and surface an error. So the two assertions below are
complementary, not redundant: the op-log assertion catches a *recorded* call, and the
exit-code/verdict assertion catches an *attempted* one.

---

## Slot coverage, and why `ship.review` is exempt

`arm.json` declares `slots_covered` and `slots_exempt`. `check_barecore` asserts that their union
equals the mechanically enumerated declared-slot set, so **a newly declared slot that appears in
neither list fails the suite loudly** — the same arm-less-slot property `check_slot_enum` enforces
for the comparison items.

- **`slots_covered` (7)** — `spec.questions`, `spec.publish`, `plan.publish`, `tasks.publish`,
  `implement.start`, `implement.milestone`, `implement.finish`. These are exactly the seven slots
  C021 declares, and all seven fire inside the `spec → plan → tasks → implement` conveyor this
  item runs.
- **`slots_exempt` (1)** — `ship.review`, with a recorded reason: it is declared in `/wf:ship`
  Phase 4.5, which is **unreachable in bare core**. `/wf:ship` Phase 1 *requires* a delivery
  provider and hard-stops with `SHIP — Blocked` ("No delivery provider is registered — nothing to
  open or merge") long before Phase 4.5 resolves the slot. Exempting it is therefore a statement
  about `/wf:ship`'s documented contract, not a gap: `ship.review`'s unfilled behavior remains
  covered by item 1, its own per-slot comparison arm.

---

## Assertions (`check_barecore` in `run.sh`)

Zero-tolerance and variance-free — this check passes **no** `--max-variance` and calls
`assert/compare.sh` not at all:

1. **Slot-set completeness** — `slots_covered ∪ slots_exempt` equals the enumerated declared-slot
   set; every exemption carries a non-empty reason.
2. **Per-slot unfilled resolution** — every run records, for each covered slot, a
   `slot_resolutions` entry with `status: "unfilled"` and `executed: "inline-default"`.
3. **Zero tracker calls, absolutely** — across every run in the set, the op log contains **no**
   record whose `surface` is `tracker`. One is a failure; there is no tolerated outlier.
4. **Zero errors** — every run records `exit_code: 0` and `verdict: "ok"`.
5. **Seeded breakage turns red** — the `seeded-breakage/` set, in which one slot's inline default
   attempts a tracker call, must fail assertions 3 **and** 4, naming the offending slot and op.

---

## The run sets

- **`runs-current/` (N=3)** — three runs of the full bare-core conveyor (`/wf:spec`, `/wf:plan`,
  `/wf:tasks`, `/wf:implement` against `BARE-1`). Each snapshot carries the four produced
  artifacts plus the index, and a **present-but-empty** `_local/fake/op-log.jsonl`. The empty log
  is deliberate: it makes "zero provider ops" an inspectable positive fact and keeps the snapshot
  path-set byte-identical to the seeded set, so the only structural difference between the two
  sets is the seeded log's content. (`extract_ops` treats an absent log and an empty log
  identically — the file is shipped for reviewability, not to change the observed op set.)
- **`seeded-breakage/runs/` (N=1)** — byte-identical except that `implement.start`'s inline
  default attempts a tracker `create_child`; the log records the attempted op and the run records
  `exit_code: 1` / `verdict: "error"`. This is the negative control that proves the detector
  works: without it, "zero tracker records" could be satisfied by a detector that can never
  observe one.

`ops_invoked` is order-insensitive by construction (`assert/lib.sh`'s `extract_ops` pipes through
`sort -u`), so no ordering claim is made or implied by any assertion here; the seeded log's `seq`
values carry sequence for human review only.

---

## Canned-vs-real disclosure (honest by construction)

**Path: `canned`.** These run sets were **not** produced by a live containerized run. Two
independent reasons, both recorded in `arm.json`'s `provenance.reason`:

1. **Docker and `CLAUDE_CODE_OAUTH_TOKEN` are both absent** in the authoring/CI environment — the
   same constraint WF-345/WF-346/WF-347 and every prior empty-slot arm hit.
2. **The installed plugin cache is `wf` 0.87.0 while the slots live in 0.93.0.** Skills execute
   from the installed marketplace cache, not the working tree. A live conveyor invoked here would
   have exercised a **pre-slot** build in which the seven `<!-- wf:slot … -->` markers do not
   exist at all — so it could not have observed a single slot resolving `{status: unfilled}`, and
   a green result would have proven nothing about the invariant while *looking* authoritative.
   A canned arm, honestly labelled, is strictly more informative than that.

The run bytes are shaped exactly like the WF-345 runner's output tree (`run.json` +
`transcript.jsonl` + `workspace-snapshot/…`). When Docker, a token, and a current-build install are
available, `runner/run-skill.sh` regenerates both sets and the assertions re-run **unchanged** —
only the provenance of the run bytes changes, never the assertion machinery.
