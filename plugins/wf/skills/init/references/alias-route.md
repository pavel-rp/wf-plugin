# Entering the lifecycle through a compatibility alias

Read on the `--seed` path only — `/wf:init` reaches this file through
`resolve_content({ workspaceRoot, class: "references-template", skill: "init",
ref: "alias-route.md" })`, never a raw `Read` of a plugin-cache path, and never
at boot. Rationale, and the guidance for converting a pack's own setup command,
live in the paired `alias-rationale.md`, which is never read at runtime.

This procedure adds **no phase, no status and no second journey.** It states
exactly where one extra input — a seed — attaches to the journey that already
exists, and it names no pack: the seed is an opaque `<plugin-id>` token supplied
by whoever invoked the command.

## Contents

- [The governing constraint](#the-governing-constraint)
- [Step A1 — Accept the seed, interpret nothing](#step-a1--accept-the-seed-interpret-nothing)
- [Step A2 — Hold the seed until recovery has been relayed](#step-a2--hold-the-seed-until-recovery-has-been-relayed)
- [Step A3 — Attach the seed to the one selection round](#step-a3--attach-the-seed-to-the-one-selection-round)
- [Step A4 — Availability is not a seed's to change](#step-a4--availability-is-not-a-seeds-to-change)
- [Step A5 — Everything downstream is unchanged](#step-a5--everything-downstream-is-unchanged)
- [Step A6 — Report the seed's disposition](#step-a6--report-the-seeds-disposition)
- [Edge cases specific to a seeded entry](#edge-cases-specific-to-a-seeded-entry)

---

## The governing constraint

> **An alias may seed selection. It may never infer state, and it never owns
> lifecycle logic.**

An alias contributes exactly one thing — "add this pack to the desired set" —
and then gets out of the way. Every behavioural question is answered by this
journey, which the alias merely enters. A conditional inside an alias that reads
existing state is the defect this route exists to prevent.

---

## Step A1 — Accept the seed, interpret nothing

`--seed <plugin-id>` carries exactly one token. Validate its **shape** only —
a non-empty plugin id — and carry it verbatim into Step A3.

Do **not** look the token up, test whether such a pack is installed, enabled,
registered, or drifted, or branch on any of it here. Discovery (Phase 2) is the
only thing that reports what that id names, and it runs for every pack the same
way whether or not one of them was seeded.

More than one `--seed`, or a seed with no value, is a malformed invocation:
stop at `INIT — stopped` naming the argument, before any write.

## Step A2 — Hold the seed until recovery has been relayed

A seed is **inert** until Phase 2's `recovery` channel has been read and
relayed. Recovery runs before the seeded route proper and is reported on its own
channel; it is never folded into the delta the user later confirms.

- `recovery.proceeded: false` ⇒ halt at `INIT — stopped` exactly as an unseeded
  run does. The seed never reaches the desired set and never appears in a delta.
- `recovery.wroteBytes: true` ⇒ say so plainly on the recovery line, separately
  from the delta, and continue: everything below is asserted from the recovered
  baseline.

## Step A3 — Attach the seed to the one selection round

The seed enters the selection round as a **preselected tick** — the same kind of
input a user's own tick is, and the same kind the durable record supplies. It is
**unioned onto** whatever that round already preselects; it never replaces it.

| journey form | round | already preselects | with a seed |
|---|---|---|---|
| fresh | Phase 4 | nothing | that round's selection **plus** the seeded id |
| reconcile | `reconcile-mode.md` Step R3 | the durable committed record | Step R3's preselection **plus** the seeded id |

Three properties of that union are load-bearing:

1. **Additive, never substitutive.** A project with many registrations that
   enters through one pack's alias ends with those registrations **and** that
   pack. A seed is not a statement about the packs it does not name.
2. **`deregister` is untouched.** A seed marks nothing for removal, so removal
   keeps its single source — an explicit deselection taken in the round. An
   omission from a seed is not a deselection, and `deregister` stays the literal
   empty list unless the user marked something in the round itself.
3. **A seed is not a durable record.** Where the durable record is absent, the
   round still **asks** rather than inferring; a seed resolves that question only
   for the one id it names, and only as the explicit selection it is.

The round is still presented. A seed pre-ticks one box; it does not skip the
box, remove any other pack from the offer, or reduce what is shown.

## Step A4 — Availability is not a seed's to change

Availability stays keyed on the relayed `enablement` and `presence` — never on a
seed, and never on `selectable`.

A seed naming a **disabled** pack is the single most tempting place to
auto-enable one, because the user is plainly asking for that pack. It is
forbidden. The pack stays **visible**, stays **retained**, and stays
**unavailable**; its `enablement` is never flipped, and re-enabling remains the
user's action, outside this run. Record the seed as *not applied* (Step A6) and
continue the run normally — an unavailable seed is not an error and not a stop.

The same holds for any other relayed reason a pack cannot enter `desired`. A
seed never overrides the round's own availability rule.

## Step A5 — Everything downstream is unchanged

From the end of Step A3 the run is byte-for-byte the ordinary journey:

- **Questions** — Phase 5 asks exactly `answers.unresolved[]`, for **every**
  pack in the desired set, not only the seeded one, and asks each once. Only a
  persisted project answer suppresses a question; a suggested, pack-tier or
  personal-tier value is a pre-fill and never an answer.
- **Delta** — the Phase-6 envelope (or Step R4's plan of record) is the **only**
  delta. An alias renders none of its own, in no style of its own.
- **Confirmation** — Phase 7, **once**, over one `planId`. There is no second
  prompt.
- **Apply** — Phase 8's single `apply_install` carrying that confirmed id, the
  sole lifecycle mutation and the sole public mutator.
- **Settled and drifted** — unchanged. A seeded run over a settled workspace
  whose pack is already selected produces an empty delta and takes Step R6's
  settled exit: no plan call, no confirmation, no mutation call at all,
  `already-initialized` / `Apply: not run — no drift`, under Step R2's four
  conjuncts in full. A withheld advance or a non-benign retained artifact is
  **retained divergence**, reported as such and never as no drift. Drift routes
  through the canonical repair plan.
- **Root handling, rollback, diagnostics** — unchanged, because there is one
  implementation of each and the alias contains none of them.
- **Locks** — unchanged. A seed introduces no additional lock acquisition, and
  no lock is held across a host phase.

## Step A6 — Report the seed's disposition

One **additive body line** below the grepped status line, in the Final Output's
`Seed:` field:

- `none` — no seed was passed (the ordinary run).
- `<plugin-id> — applied` — the seed was unioned into the desired set.
- `<plugin-id> — already selected` — the round already had it; the union was a
  no-op, which is what makes a repeat alias run settled rather than a delta.
- `<plugin-id> — not applied (<relayed reason>)` — the round's availability rule
  kept it out; quote the relayed reason, do not paraphrase a cause.

The status line itself is unchanged: a seed adds no status token, and an alias
emits this block and no second terminal block of its own.

---

## Edge cases specific to a seeded entry

- **The seeded pack is already selected and the workspace is settled.** The
  ordinary settled exit — no plan, no confirmation, no mutation. This is the
  expected outcome of re-running a pack's own setup command, not a degenerate
  one.
- **The seeded pack is disabled.** Visible, retained, unavailable, not enabled,
  seed *not applied*; the rest of the run proceeds.
- **The seeded id names nothing discovery reported.** Nothing is invented. The
  seed is *not applied* with discovery's own relayed reason, and — when the
  inventory is not trustworthy — absence stays **unknown**, so the id is never
  called missing or orphaned.
- **A seed arrives on an unrecovered baseline.** Step A2 halts first; the seed
  is never mentioned in a delta that was never computed.
- **A seed arrives alongside `--force`.** Independent arguments: `--force`
  governs the scaffold rewrite, the seed governs the desired set. Neither
  implies the other, and neither pre-answers a question or skips the
  confirmation.
