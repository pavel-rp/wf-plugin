# Why fresh init is one journey — rationale

**Never read at runtime.** No phase of `/wf:init` instructs a read of this file.
It is the paired rationale for the ten-phase journey the skill body executes, so
the body can carry behaviour only and stay inside its budget. If you are looking
for *what* init does, read the body; this file explains *why it is shaped that
way*, and exists so a future editor does not "simplify" a constraint that is
load-bearing.

## One round, one confirmation, one apply

The alternative — ask per pack, confirm per pack, apply per pack — was the
pre-journey status quo: N separate per-pack init commands, each with its own
prompt and its own write. It fails three ways. A user answering the fourth pack's
question cannot revise the first pack's answer without starting over. A partial
run leaves a workspace half-configured with no single thing to roll back. And the
cost of a mistake scales with N, because each apply is its own commit point.

Batching collapses all three. Every unresolved question across every selected
pack is asked in one round, the whole desired end state is planned as one closed
envelope, that envelope is confirmed once, and it is applied in one journaled
transaction that either lands or does not. The confirmation is over a plan
identity, not over prose, which is what makes "the thing I approved is the thing
that ran" checkable rather than a promise.

## A suggestion is not a resolution

The planner distinguishes a question that is **answered** from a question that
merely has a **value available**. Only a valid persisted value at the question's
declared destination resolves it; a shipped default, a pack-tier value, and a
personal-tier value are all carried as *suggestions* and leave the question
unresolved.

This looks pedantic until you consider what the opposite does. If a default
suppressed the question, a fresh workspace would silently inherit whatever the
pack author guessed, or worse, whatever the user happened to have configured on
some other project — and the user would never see the choice they had implicitly
made. The point of a first-run journey is that the user is *shown* every decision
once. Suggestions make that cheap (the answer is pre-filled, one keystroke to
accept) without making it invisible.

The host's job here is narrow and absolute: ask exactly what the envelope reports
unresolved, pre-fill from the suggestions it carries, and treat none of them as
an answer. A host that "helpfully" skips a question because a suggestion exists
has broken the contract.

## The scaffold is outside the transaction

`_local/`, the config file, the readme, and the gitignore entry are a
prerequisite, not a pack change. They are idempotent, they are the same on every
workspace, and they are what makes the workspace legible to every later skill
including the ones that would diagnose a failed apply.

Putting them inside the pack transaction would mean a declined plan leaves no
usable workspace, and a rolled-back apply un-scaffolds a repo the user may have
already started using. Keeping them outside means the two failure modes stay
separate and both stay honest: **declining leaves valid bare-core scaffolding and
zero lifecycle mutation.** That sentence is the whole reason for the split.

It also means the scaffold can run before the user has decided anything, which is
what lets the journey show a real workspace while the selection question is still
open.

## `selectable` is not the selection filter

The discovery envelope's per-pack `selectable` flag reports whether a pack is
**already operational** in this workspace. On a fresh workspace — the exact case
this journey exists for — nothing is operational yet, so the flag is false for
every pack, including every pack the user is about to choose.

Filtering the offer on it would therefore present an empty list on precisely the
run that most needs a full one. The offer is keyed on the relayed enablement and
presence facts instead: a pack that is present and not disabled can be chosen. A
disabled pack is still shown, with its own state, and is unavailable to choose;
selecting one is a planning error the planner raises, not something the host
silently corrects. **Nothing in the lifecycle path flips enablement** — a pack
the user disabled stays disabled, and the way to change that is to change it, not
to run setup again.

This is the sharpest instance of the general rule below, and it is the one most
likely to be "fixed" wrongly by someone reading the field name instead of its
derivation.

## Relay, never infer

Every lifecycle fact the journey shows the user — presence, state, enablement,
availability, recovery outcome, inventory confidence, which questions are open,
what the plan will do, what the apply did — is read out of a typed envelope and
relayed verbatim. The host computes none of it.

The reason is not purity. A host that infers builds a second, undocumented model
of lifecycle state, and the two drift: the resolver gains a state, the host keeps
classifying it under the old one, and the user is told something that was true
last release. Relaying means there is exactly one model, it is versioned with the
resolver, and a host bug is visibly a display bug rather than an invisible
disagreement.

The practical test: if the body would need an `if` over a lifecycle fact the
envelope does not directly state, the envelope is missing a field — extend it,
do not derive it.

## Locks are not nested across host phases

Each lifecycle call takes and releases the machine-local exclusive lock within
itself. The host never holds one across a phase boundary, and never wraps several
calls in an outer lock.

Host phases contain user interaction of unbounded duration. A lock held across a
confirmation prompt is a lock held until someone comes back from lunch, blocking
every other workspace operation on the machine and — if the session dies — left
behind for a recovery pass to clean up. Short, self-contained critical sections
make each call independently crash-recoverable, which is the property the journal
depends on.

The cost is that state can change between two host phases. That is handled by the
plan identity: the apply names the plan it expects, and a workspace that moved
underneath fails the check instead of applying a stale intent.

## Zero selection proves absence

Choosing nothing is a first-class outcome, not a degenerate one. It is also the
strongest available test of the inert-by-default promise: after a run that
selected zero packs, the workspace carries the bare-core scaffold and **nothing
else** — no registry rows, no pack payload, no seeded profile, no runner of any
kind, no term from any pack anywhere in the output.

That is worth stating in the body because it is the shape of the bug it prevents.
A setup journey that writes "harmless" boilerplate on the zero-selection path
makes every later absence claim unfalsifiable: you can no longer tell what a pack
contributed from what setup left behind. Keeping zero selection byte-honest keeps
the whole capability model checkable.
