# Fixture expectations — the sweep with no provider to reach

The third of the three fixtures `00_reqs.md` §"Verification evidence" names for WF-522, covering
both degradations the sweep can hit: **no delivery provider** (nothing can be read) and **no
tracker provider or no filing parent** (findings are real but nowhere to file them).

They share a fixture because they share a failure mode: a run that quietly does less than the
reader thinks it did.

---

## No delivery provider is a stated no-op

EXPECT: delivery-absent=stated-no-op
EXPECT: delivery-absent=zero-reads
EXPECT: delivery-absent=zero-tracker-writes
EXPECT: delivery-absent=never-silent-pass

With no capability owning the `delivery` surface there is no pull request to reach, so the sweep
attempts no read and writes nothing. It says so plainly. A capability-agnostic core degrades
inert, but *inert is not the same as quiet*: the run states that no sweep ran, and never lets a
missing provider render as a clean pull request.

## An unrecoverable owner is named as a candidate, not blamed

EXPECT: delivery-unrecoverable=hedged-candidate

When a registered capability owns the surface but cannot be resolved, the run names that owner and
its diagnostics as a **hedged candidate** — "if it is your delivery provider, fix its stale root"
— never an assertion that it is definitely at fault. The resolver reports what it observed; the
run does not manufacture a cause.

## No tracker, or no parent, still verifies

EXPECT: tracker-absent=still-verifies
EXPECT: parent-absent=never-guessed

Filing is optional; verification is not. With no tracker registered, or no filing parent
resolvable, the sweep still reads, verifies against current source, and disposes of every
candidate. A parent is never guessed and an umbrella is never minted to have somewhere to put a
finding — a finding filed under an unrelated item is worse than one reported unfiled.

## An unfiled survivor is reported in full, at every call site

EXPECT: unfiled=reported-with-reason
EXPECT: unfiled=evidence-preserved
EXPECT: unfiled-channel=present-at-every-caller

This is the assertion that bites hardest here, because this is the fixture where **every**
survivor is unfiled. A verified finding that cannot be filed is not a finding that stops
existing: the run states a **reason** for it — in the author's own words, commonly one of
`no tracker registered`, `no filing parent resolved`, `filing cap reached`, `filing failed`,
`not filed — dry run` or `already filed (earlier run)` — and reports its full evidence. What this
fixture requires is that a reason and its evidence are always present, not that the wording comes
from a fixed set: a closed set is thirty places for a repair to fall behind, and the obligation was
never about the vocabulary.

**Every caller needs the channel to say it in.** A procedure that returns unfiled survivors to a
caller whose output block has no field for them has lost them just as completely as if it had
never verified them — the evidence reaches a render site that cannot render it. A caller running
tracker-free hits this on every single survivor, so the gap is not an edge case there; it is the
steady state.

## Degradation never changes the verdict

EXPECT: gating=none

None of the above is a stop. A degraded sweep reports and continues; it never blocks the run that
contains it, and never changes an item's outcome. Every row is already terminal by the time the
sweep is reached.
