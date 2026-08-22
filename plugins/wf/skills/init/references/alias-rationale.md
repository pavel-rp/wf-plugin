# Why a compatibility alias seeds and nothing more

Paired rationale for `alias-route.md`. **Never read at runtime** — no phase, no
skill and no agent fetches this file; it exists for the person converting a
pack's own setup command, and for the reviewer asking why the route is shaped
the way it is.

---

## The problem the route removes

Before this route, a pack's own setup command was a **second implementation of
setup**. It resolved the pack, decided by itself whether the pack was already
installed, wrote a registry row through a registration call of its own, and
reported in a block of its own shape. Every one of those is a lifecycle
decision, and each was made twice — once by the canonical journey and once,
differently, by each wrapper.

Two implementations of a safety-critical decision do not stay equal. The
canonical journey grew an explicit selection round, a single delta, a single
confirmation, a single mutator, a recovery channel, an admission verdict, a
guarded rollback, and a removal discipline in which an omission never implies a
removal. A wrapper that predates any of those simply does not have it — and the
user cannot tell from the command name which implementation they got.

The route's answer is not to synchronise the two. It is to **delete one of
them**. An alias keeps its command name and contributes a single value; the
journey supplies every behaviour. Root handling, rollback and diagnostics then
*match* by identity rather than by imitation, which is the only way a match
stays true after the next change to either side.

## Why a seed is a preselection, not a desired set

The tempting shape is for an alias to call the planner with `desired: [its own
pack]`. It is wrong in a way that is silent and destructive.

The desired set is the **whole** authorized selection, not a request. A user
with six packs registered who runs one pack's setup command and gets `desired:
[that one pack]` has, on a substitutive reading, just asked for the other five
to go away. The removal discipline is what saves them — an omission is never a
deselection and `deregister` stays empty — but relying on a downstream safety
net to undo a wrong input is not a design. The input should be right.

So the seed is modelled as the thing it actually is: **one more tick in the
selection round**, the same kind of input the user's own tick is and the same
kind the durable committed record supplies. Union is the only correct operator
over ticks. It is additive by construction, it composes with the durable record
instead of competing with it, and it makes the repeat-run case fall out for
free: ticking an already-ticked box is a no-op, so re-running an alias over a
settled workspace produces an empty delta and takes the settled exit without any
special case written for it.

## Why a seed is not an answer, and never suppresses a question

A seed says which pack, and nothing about that pack's values. The suppression
rule is unchanged and deliberately strict: **only a persisted project answer
resolves a question.** A shipped default, a pack-tier value and a personal-tier
value are all pre-fills that make accepting cheap; none of them makes a question
disappear, and neither does the fact that the user typed a pack's own command.

The failure this prevents is a wrapper deciding that its own pack's questions
are the only relevant ones and asking just those. The journey asks
`answers.unresolved[]` for the **whole** desired set, so a run entered through
one pack still surfaces another pack's unanswered question — which is exactly
what the user needs and exactly what a per-pack wrapper cannot do.

## Why a disabled pack's own alias does not enable it

This is the sharpest temptation on the route: the user has just typed that
pack's command, so surely they want it enabled. Two reasons it stays forbidden.

First, enablement is not this journey's to change — it is a host-level fact the
journey **relays**, and flipping a relayed fact is the inference the whole
design forbids. Second, visible, available, retained and deselectable are four
separate properties precisely so that "the user mentioned it" cannot collapse
into "so make it usable". A disabled pack stays visible and retained so nothing
is lost, and stays unavailable so nothing is silently turned on.

An unavailable seed is therefore reported and shrugged off, not escalated: the
run continues, because the rest of the desired set is still legitimate.

## Why recovery reports on its own channel

Recovery is a repair of an interrupted earlier transaction. It is not part of
what the user is being asked to authorize now, and folding it into the delta
would ask them to confirm work that has already happened. Keeping it on its own
channel is also what makes two runs with different recovery reports produce the
same plan identity — the delta is a function of the desired end state, not of
how the workspace got back to a readable baseline.

## Why the alias emits the canonical terminal block

A shared route with one terminal contract is the point. If each alias kept its
own block, anything binding to alias output would have to carry one shape per
pack, and the shapes would drift apart exactly as the implementations did. An
alias *is* the canonical lifecycle, so it reports the canonical contract, and
its pack-specific detail rides additive body lines that do not disturb the
grepped first line.

This does change a grepped block shape for each converted pack, which is a
breaking change and is disclosed as one. **Command preservation is a separate
promise and is kept in full:** the command keeps its name and its argument
shape, and it still ends with the pack set up.

---

## Converting a pack's setup command

Inventory what the current command does, then sort each action into exactly one
of these buckets. Nothing should be left over.

| the command currently… | do this |
|---|---|
| resolves its own install root, or inspects its own pack | **delete** — discovery reports every pack, including this one |
| writes a registry row, a roots-map row, or flips enablement | **delete** — the canonical apply is the sole mutator |
| decides whether it is "already registered" | **delete** — that is drift diagnosis, and it is canonical |
| runs its own interview | **declare** each value as an `ask[]` entry on the pack's `profile.template.json`, so the canonical question round asks it and the canonical apply persists it |
| writes a value that already has a documented working default | **drop the write** and document the default; a default that works is not a question |
| prints its own terminal block | **relay** the canonical block instead, with pack detail on additive body lines |
| takes arguments | keep them **only** if they are not lifecycle inputs; a lifecycle argument becomes a seed or a declared question |

What is left is the whole alias: invoke the canonical command with `--seed
<this pack's stable plugin id>` through the Skill tool, and relay what comes
back. A converted alias body should contain **no conditional that reads existing
state** — if one appears, it belongs in the journey, not the alias.

Two checks before calling a conversion done:

1. **Additivity.** Set up a project with several packs, then run the converted
   command. Every prior registration must survive and the pack must be added.
2. **Repeatability.** Run it twice. The second run must reach the settled exit
   with no mutation call, not merely a mutation that wrote nothing.

## On timing

Converted commands keep working. **No removal date is announced**, and the route
does not depend on one: an alias that seeds and relays is a legitimate permanent
entry point, not a deprecation shim. Conversion is worth doing because it
deletes a second implementation, not because a clock is running.
