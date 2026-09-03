# Fixture expectations — a merged pull request with no post-merge activity

The second of the three fixtures `00_reqs.md` §"Verification evidence" names for WF-522. The
pull request is reachable, the read is performed, and it genuinely returns nothing: no review
thread, no review comment. Most merged pull requests look like this, so it is the fixture that
decides whether a quiet run says so or just says nothing.

The requirement it encodes is one word: the sweep must report a **stated zero**, not silence.

---

## A performed empty read is a stated absence, not a clean claim

EXPECT: empty-read=stated-absent
EXPECT: absent-carries-reason

The run records `absent: no review present at read time` — a disposition with a reason attached,
not an omitted line and not "no findings". `absent` is the only one of the five tokens that
describes the *review* rather than a candidate, which is why it needs its reason spelled out:
four different situations reach it, and a reader who cannot tell which one occurred has learned
nothing.

## A read that did not happen is not a read that found nothing

EXPECT: read-performed-false=distinct

`<read-performed> = false` is a degraded or absent read; a performed read over an empty set is a
real observation. Collapsing them lets an unauthenticated or misconfigured host report as a quiet
pull request. A clean claim requires a performed read, and the two cases carry different stated
reasons.

## The tally renders explicit zeros on every pass

EXPECT: tally=explicit-zeros
EXPECT: tally-always-rendered

Every counter renders, `0` included, on **every** emission of the block — never an omitted line
and never a blank value. That includes `<not-judged>`: an incomplete sweep and a complete one must not
render alike. A reader scanning a run output takes a missing line for "nothing to say
here", which is exactly the silence this task exists to remove. Absence is information, so it is
stated.

## "No sweep ran" and "a sweep found nothing" are different facts

EXPECT: not-attempted-never-zero-tally
EXPECT: zero-tally-never-not-attempted

A slot that did not fire renders its stated fallback token; a sweep that ran and judged nothing
renders zeros. Neither is ever rendered as the other. A line that conflated them would recreate
the silent-finding gap the composition point exists to close — a run that never checked would be
indistinguishable from one that checked and was satisfied.

## This run is distinguishable from an unreachable one

EXPECT: unreachable-vs-empty=distinguishable

The paired assertion from `seeded-thread.md`, stated from this side. This fixture's pull request
was genuinely read and genuinely had nothing; a branch-deleted pull request was never read at
all. Both are `absent`, and they must not carry the same reason.
