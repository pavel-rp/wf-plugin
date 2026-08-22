# Why reconcile mode has the shape it has

**Never read at runtime.** This is the paired rationale for `reconcile-mode.md`,
which carries the behaviour. Nothing here is an instruction; if a rule seems to
be stated only here, it belongs in the ops doc instead.

---

## Why reconcile is not a flag, and why there is no `--remove`

A `--remove` flag would create a second removal surface, and two surfaces means
two places to get the deletion proof right. Worse, a flag invites the shape the
whole item exists to prevent: `init --remove <pack>` reads like an imperative,
and an imperative does not carry the evidence a deletion needs. Deselection in
the same round as selection keeps removal on the one path where the user is
already looking at what is installed, what is registered, and what each pack
owns — which is the only context in which "remove this" is an informed answer.

Making reconcile a *detected* form of the same journey rather than a mode flag
also means a user who simply re-runs `/wf:init` gets the safe thing. Nobody has
to know the mode exists to benefit from it.

## Why removal is an explicit mark and not a set difference

The tempting implementation is: preselect from evidence, let the user edit the
selection, then `deregister = preselected \ confirmed`. It is one line, and it is
wrong in a way that only shows up on someone else's machine.

A set difference makes the removal set a function of the *preselection*, and the
preselection is a function of evidence that may be missing for reasons that have
nothing to do with intent — a pre-ledger registration, an inventory that could
not be read, a comparison a future build does not recognise. Each of those makes
a pack fall out of the preselection, and under a set difference each would then
silently become a deletion. An explicit mark breaks that coupling completely:
the removal set is a function of nothing but what the user pointed at.

This is the same discipline WF-457 applied to questions — a default is not an
answer — applied to selection: **an absence is not a decision.**

## Why "no mutation stage" is stronger than "wrote no bytes"

A mutation stage that runs and decides to do nothing is one refactor away from a
mutation stage that runs and decides to do something. It also takes the exclusive
lock, creates the conditions for a journal, and produces an envelope whose
`applied[]` happens to be empty — a shape a later reader can easily mistake for
"the apply succeeded and there was nothing to do", which is true, versus "the
apply was never needed", which is a different and stronger claim.

Not making the call is observable from outside the process: a wire test can count
invocations. "Wrote no bytes" is only observable by trusting the implementation
not to have written any. The first is a property; the second is a hope.

## Why "settled" needs four conjuncts and not one

`plan.applicability` is computed from `hasPreviewedArtifactEffect`, which looks at
`deletable`, `bootstrap` and `advance` — and at nothing else. A retained decision
is not an effect, and it is right that it is not: retention is what the plan does
when it declines to act.

The consequence is that a workspace whose *only* problem is a hand-edited managed
artifact, or an advance withheld because its owner set moved, reports
`applicability: "no-change"`. One read of that field would call such a workspace
clean. WF-459 already refused exactly this collapse on the apply side, where
`resolveUpgradeOutcome` makes `retained-divergence` and `no-drift` two distinct
zero-write outcomes and `fully-upgraded` unreachable while anything remains.
Reconcile is the plan-side mirror of that refusal: the same two states, the same
insistence that they never become one word.

The fourth conjunct leans on WF-458's `preservationClassFor`, which is an
exhaustive switch with a conservative default. `not-deselected` — the benign
class — is the ordinary state of every retained artifact on a clean run, so it
alone may pass. `shared`, `edited`, `ambiguous` and `unverifiable` each mean
something was observed and could not be resolved, which is the definition of
divergence.

## Why the durable record, and not machine-local state, drives preselection

`_local/` is gitignored and the plugin-roots map is per-machine. Both are exactly
the kind of state that is *usually* right and occasionally catastrophically
wrong — a stale worktree, a restored backup, a colleague's laptop. Reconstructing
a desired set from them would mean the answer to "what does this project want
installed?" changes depending on where you ask.

The committed evidence ledger is the only record that travels with the project,
so it is the only one that can answer that question. Where it is silent, the
honest move is to ask. A fresh checkout that lacks it is not a project with an
empty desired set and it is not a project whose desired set can be guessed — it
is a project nobody has told yet.

`missing-binding` versus `missing-legacy-evidence` is the whole reason the
diagnosis channel is called on every run rather than only when something looks
wrong. Discovery's `evidence.comparison` reports `evidence-missing` for both, and
they mean opposite things: the first is "this project's record exists and this
machine hasn't bound it", which preselects; the second is "no record was ever
written", which asks.

## Why visible, available and retained stay three properties

Collapsing them produces an enum whose members each secretly encode a policy —
and the policies disagree. A disabled registration is visible and unavailable and
retained. An orphaned one is visible, unavailable *for selection*, available
*for deselection*, and retained. A legacy one is visible, available both ways,
retained, and not preselected. There is no single axis on which those three sit,
and any enum that tries becomes a place where a later change to one case
silently moves another.

Availability being direction-specific matters most for the orphaned case. It
would be tidy to call an orphaned registration simply unavailable — but then
there would be no way to remove it, and removal must stay *possible* precisely
because it must stay *explicit*. A registration you cannot deselect is a
registration that will eventually be cleaned up by something less careful.

## Why one plan of record, chosen rather than merged

The alternative is to apply the repair plan and then the desired-set plan, which
is two transactions, two confirmations, and a window in which the workspace is
half-reconciled. "Separate confirmation" is out of scope for exactly that reason.

Choosing works because the two planners are the same planner. `planRepair`
derives its selection — every registered pack, `deregister` structurally the
literal `[]` — and then calls the same join the installer calls. So on an empty
delta the repair plan already *is* the desired-set plan, plus two narrowings that
are strictly more conservative. Handing its `planId` straight to the mutator is
therefore not a shortcut; it is the exact plan, which is what the constraint
asks for.

On a non-empty delta the repair plan cannot express the delta, so the desired-set
plan is the plan of record — and because it is the same planner over the same
facts, the drift repairs land inside that one transaction rather than needing a
second one. What is lost is only the *preview* narrowing, which is why the
withheld advances are relayed on both routes: the mutator's upgrade gate refuses
those advances either way, so a preview that omitted them would be the one part
of the confirmation that told the user something untrue.

## Why the planner, not the mutator, decides payload eligibility

`applicability` is stated over `plan.applicability`, so whatever answers "would
this run change anything?" has to be the planner — and the release's byte-inert
guarantee requires a no-drift run to compose *zero mutating actions* rather than
compose them and no-op. Both the action list and the preservation decision
therefore fall out of one comparison, in one place, which is precisely why they
can no longer contradict each other.

The rule that a ledger-recorded destination is deferred *wholesale* to the
artifact arm looks broader than it needs to be, and is deliberate. The artifact
arm already owns that destination's ledger evidence and already decides all three
of its outcomes from it: the hash-gated advance, the `divergent` retention that
`replace-if-unmodified` promises a hand-edit, and `refresh-semantics-retain`.
Splitting the decision so the payload arm keeps "the easy case" is what produced
the original defect: two arms composing two actions for one destination, which
apply refuses outright, and a response that could report a destination preserved
while having overwritten it. One rule closes the overwrite, the fail-open on
unreadable bytes, and the duplicate-destination collision together.

Unobservable bytes withhold rather than proceed because `too-large`, `unsafe` and
`unsupported` mean the current content was never read — an overwrite would
destroy content no one has seen, and "the comparison could not be made" is not
evidence that there was nothing to compare. `missing` is the one safe exception:
there is nothing to destroy, so a deleted managed artifact is still restored.

The mutator keeps its own copy of the unmodified-destination proof anyway, and
that copy is deliberately *narrower* than the planner's. It is not a second
opinion that could disagree with the approved plan; it is a backstop over the
window the plan cannot see — the interval between approval and the lock.

## Why one authoritative persisted-answer surface

A question the lifecycle asks is answered once. If the answer can be read back
from two places, one of them is stale the moment the other is written, and the
observable symptom is the lifecycle re-asking a question the project already
answered. Naming the profile authoritative removes the ambiguity rather than
arbitrating it.

Read-through rather than migration, because migration is a write, and a write
would have to happen on a *read* path — every consumer of the value would need to
be a writer, and a project that never re-runs init would be left half-migrated.
Reading the config section as a fallback costs one read and leaves existing
projects working untouched.

The rule is about *writes*, not about reads: a value the lifecycle never asks is
never persisted to the profile, so reading it from the profile alone silently
resolves it to its default and drops whatever the project configured. That is the
failure this distinction exists to prevent — "where does the lifecycle persist
this?" decides which tier is authoritative, never which tiers are read. A value
with a working default must not decide a configured/unconfigured gate either: it
always resolves, so gating on it reports an otherwise fully-configured project as
unconfigured and degrades it silently.
