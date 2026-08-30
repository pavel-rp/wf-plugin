# Reconciling an existing project's desired set

Read on the reconcile path only — `/wf:init` reaches this file through
`resolve_content({ workspaceRoot, class: "references-template", skill: "init",
ref: "reconcile-mode.md" })`, never a raw `Read` of a plugin-cache path, and
never at boot. Rationale lives in the paired `reconcile-rationale.md`, which is
never read at runtime.

This procedure **replaces Phases 4–8** when the workspace already carries
lifecycle state. Phases 1–3 (admit, discover, scaffold) and Phases 9–10 (settle,
constitution) run unchanged either way. Nothing here is a new mechanism: every
identity below already exists and is consumed **unchanged**.

## Contents

- [The four invariants](#the-four-invariants)
- [Step R1 — Diagnose, once](#step-r1--diagnose-once)
- [Step R2 — Decide whether the workspace is settled](#step-r2--decide-whether-the-workspace-is-settled)
- [Step R3 — Offer the desired set, once](#step-r3--offer-the-desired-set-once)
- [Step R4 — Choose the one plan of record](#step-r4--choose-the-one-plan-of-record)
- [Step R5 — Confirm once, apply once](#step-r5--confirm-once-apply-once)
- [Step R6 — The settled exit, with no mutation stage](#step-r6--the-settled-exit-with-no-mutation-stage)
- [The authoritative persisted-answer surface](#the-authoritative-persisted-answer-surface-wf-476)
- [Edge cases specific to reconcile](#edge-cases-specific-to-reconcile)

---

## The four invariants

These four govern the whole fork; violating any is a defect, not a judgement.

1. **Removal has exactly one source: an explicit deselection** — never a set
   difference, never an omission. `deregister` carries exactly the packs the user
   **explicitly marked for removal** in the single round below; a pack that was
   never selected cannot be deselected. An orphaned registration, a disabled one,
   and one whose durable record is missing each **retain**; the third bootstraps
   *without* deletion.
2. **A settled workspace never enters the mutation stage** — not "enters it and
   does nothing": no plan call, no confirmation, no mutation call at all. And
   settled is not one applicability read — a withheld advance, or an artifact
   retained under any class but the benign one, is **retained divergence**, a
   zero-write state that must never be reported as no drift.
3. **Preselection comes from the durable committed record only.** Where there is
   none, ask; machine-local state may not reconstruct a desired set.
4. **Visible, selectable, deselectable and retained are four properties**, kept
   separate and never collapsed into one value.

---

## Step R1 — Diagnose, once

One `repair_packs({ workspaceRoot })` call, on **every** reconcile run. It
recovers first and reports that on its own `plan.recovery` channel; from the
recovered baseline onward it is byte-inert. Hold three things:

- `plan` — the frozen `plan_install` envelope, with its `identity.planId`.
- `diagnosis[]` — one row per known pack: `pluginId`, `comparison`, `drift`,
  `remedy`, `selected`.
- `withheldAdvances[]` — destinations whose advance was withheld, each with
  reason `owner-set-moved` or `declared-tuple-changed`.

Relay all three. Recompute none of them. If `plan.recovery.proceeded` is `false`,
halt exactly as Phase 2 does — `INIT — stopped`.

## Step R2 — Decide whether the workspace is settled

**Settled** requires all four conjuncts. Anything less is not settled:

1. `plan.applicability` is `no-change`; **and**
2. `withheldAdvances[]` is empty; **and**
3. every `diagnosis[].drift` is `settled`; **and**
4. every `plan.artifacts.retained[]` decision carries `reason:
   "not-deselected"` — the preservation class `retained`. Any other class
   (`shared`, `edited`, `ambiguous`, `unverifiable`) is **retained divergence**.

Conjuncts 2 and 4 are not decoration. `applicability` is derived from
`deletable`/`bootstrap`/`advance` only, so a workspace whose sole issue is a
withheld advance or a hand-edited artifact still reports `no-change`. Calling
that "no drift" is the exact collapse the mutator's own upgrade verdict refuses:
a zero-write run over a divergent state is `retained-divergence`, never
`no-drift`. Report **retained divergence** — still with no mutation stage,
because nothing is authorized, but never under the words "no drift".

**Where `applicability` is decided (WF-476).** The **planner** decides, per
destination. The payload arm applies four rules in order; the first match wins:

1. The destination already holds exactly the declared bytes → **no action**.
2. The destination is recorded in the ledger → **no payload action**; the
   artifact arm owns every transition, deciding advance, `divergent` retention and
   `refresh-semantics-retain` from the ledger's evidence. The one exception is a
   genuinely **absent** destination, which is still restored. Bytes that could not
   be read at all (`too-large`, `unsafe`, `unsupported`, `unreadable`) withhold
   the write.
3. `refresh: retain` and the destination exists → **no action**.
4. Otherwise → the ordinary create/overwrite.

The mutator's zero-target refusal is a **defensive invariant**, not a decision
point: a well-formed plan cannot reach it. Why → `reconcile-rationale.md`.

## Step R3 — Offer the desired set, once

Present **every** discovered pack and **every** registration. For each, carry the
three properties separately — never one collapsed value:

| property | meaning | keyed on |
|---|---|---|
| **visible** | listed in the offer | always; every pack, every registration |
| **selectable** | may enter `desired` | relayed `presence` + `enablement` |
| **deselectable** | may enter `deregister` | currently registered, and not disabled |
| **retained** | its registration survives this run | membership in `deregister`, and nothing else |

**Preselection is keyed on the durable (committed) record**, read off
`diagnosis[].drift`:

| `drift` | durable record | preselected |
|---|---|---|
| `settled`, `source-drift`, `root-map`, `local-drift` | recorded | **yes** |
| `missing-binding` | recorded; only this machine's binding is absent | **yes**, and its `binding-seed` remedy is shown |
| `missing-legacy-evidence` | **none** — a pre-ledger registration | **no** — ask |
| `indeterminate` | not established | **no** — the conservative arm authorizes nothing |

`missing-binding` and `missing-legacy-evidence` are the discriminator that
matters: discovery's `evidence.comparison` collapses both into
`evidence-missing`, so only the diagnosis channel separates "a fresh checkout of
a project that has the durable record" from "a registration that never had one".
Never fill an absent durable record in from `_local/`, a plugin-roots map, or an
observed binding — **ask**.

The three cases, each with its own triple:

- **disabled registration** — visible ✓ · selectable ✗ · deselectable ✗ ·
  retained ✓. Preserved and unavailable. Never flip `enablement`; re-enabling is
  the user's action, outside this run.
- **orphaned registration** — visible ✓ · selectable ✗ (nothing installed to set
  up) · deselectable ✓ · retained ✓ by default. Deselection stays possible
  precisely because it is the only removal surface.
- **legacy, evidence-missing** — visible ✓ · selectable ✓ · deselectable ✓ ·
  retained ✓ by default, and **not preselected**.

Take additions and removals in **one** round. Hold `desired` (kept + added,
minus anything marked for removal) and `deregister` (exactly the explicit marks).
Then ask any unresolved questions exactly as Phase 5 does, in the same round.

## Step R4 — Choose the one plan of record

Exactly one plan is confirmed and exactly one is applied.

- **Empty delta** — zero additions and zero explicit removals ⇒ the plan of
  record is Step R1's `repair_packs` `plan`, **verbatim**, with its
  `identity.planId`. This is the exact repair plan and the sole mutator; do not
  re-plan.
- **Non-empty delta** ⇒ call `plan_install({ workspaceRoot, desired, deregister,
  answers })` once. The repair plan cannot express a delta — its `deregister` is
  structurally the literal `[]` and it never adopts an unregistered pack — and
  its planner is the same one, over the same facts, so drift is repaired inside
  this single plan rather than by a second transaction.

On **both** routes relay Step R1's `withheldAdvances[]` in the confirmation. The
delta route's planner does not apply the withholding narrowing, but the mutator's
upgrade gate refuses those advances either way and reports them in
`upgrade.remaining[]` — so showing them keeps the preview honest.

Branch on `applicability` exactly as Phase 6 does.

## Step R5 — Confirm once, apply once

Show the chosen plan, its `identity.planId`, `identity.factCount` and
`identity.coveredFactClasses`, and enumerate additions, deregistrations, safe
deletions, ownership updates, bootstraps, repairs, the retained bucket by
preservation class, and the withheld advances. **One** confirmation covers all of
it; there is no second prompt and no staged partial application.

Declined ⇒ `INIT — declined`, no `apply_install` call, no lifecycle byte.

Confirmed ⇒ one `apply_install({ workspaceRoot, desired, deregister, answers,
expectedPlanId })` with that exact id. On the empty-delta repair route pass the
same derived selection the repair plan was computed from — every registered pack
as `desired`, and `deregister: []`. Relay the envelope as Phase 8 does, and
additionally relay `upgrade`: `outcome`, `noDrift`, and every `remaining[]` entry
with its class. A non-empty `remaining[]` denies a fully-upgraded claim; never
translate it into success.

## Step R6 — The settled exit, with no mutation stage

When Step R2 found the workspace **settled** and Step R3 produced an empty delta,
skip Steps R4 and R5 **entirely**: no `plan_install`, no confirmation, and no
`apply_install`. The observable claim is that the mutation call was never made,
not that it wrote nothing. Report `Apply: not run — no drift` and end
`already-initialized`.

When Step R2 found **retained divergence** and the delta is empty, take the same
exit — nothing is authorized, so nothing may be applied — but report
`Reconcile: retained divergence` and enumerate what diverged. Do not report no
drift.

---

## The authoritative persisted-answer surface (WF-476)

A question the lifecycle *asks* is persisted to
`_local/profiles/<capability>.profile.json` and read back only through
`resolve_profile`, which returns that document as written and merges in no
template or override tier. `_local/config.md` is not an answer store.

Precedence on an existing project is **read-through, not migration**: profile
first, the capability's config section second, profile winning, nothing written
back. A value the lifecycle does **not** ask never enters the profile, so it reads
from its config section down to its own default — and a defaulted value never
decides a configured/unconfigured gate. Why → `reconcile-rationale.md`.

## Edge cases specific to reconcile

- **Untrustworthy inventory.** The repair plan raises
  `plan/inventory-untrustworthy` and is `not-applicable`. Absence is unknown, so
  no pack is orphaned and nothing is removed. Relay and stop at `INIT — partial`.
- **A pack marked for removal whose artifacts are shared, edited, ambiguous or
  unverifiable.** The plan retains them under their own class. Removal of the
  registration still applies; the files are preserved and reported. Never widen
  the deletion proof to reach them.
- **A pack with missing durable evidence marked for removal.** The plan cannot
  carry both a bootstrap and a deletion for one destination — that whole-plan
  gate refuses the plan. Relay the refusal; do not split it into two runs.
- **A destination this plan does not list.** It is `unlisted`, not deletable:
  one confirmation authorizes only the exact listed actions.
- **An unselected co-declarer of a payload destination.** A known pre-existing
  refusal in the planner's owner-set precondition. It fails closed before any
  write. Relay the refusal verbatim; do not widen a safety precondition to route
  around it.
