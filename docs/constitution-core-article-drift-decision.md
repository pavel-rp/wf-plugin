# Core-article drift detection — recorded decision

**Decided:** 2026-08-28 · **Item:** WF-492 (charter C029 / WF-480, OUT-6) · **Model:** claude-opus-5[1m]

**Verdict: OUT of WF-492.** Drift *detection* is a distinct mechanism with its own
acceptance. It is raised as **WF-501**, a follow-on sub-task sequenced after WF-492 in the
resolver-runtime lane, rather than absorbed into it.

This file exists because the decision was required to be **made and recorded, not assumed**.

---

## The two things that are not the same

**Re-composition (shipped by WF-492).** An amended core article reaches an
already-composed record when `/wf:constitution` re-runs over it, or when an install
transaction re-composes it. The record's core section is replaced from this release's
article body; the project's own clauses are sliced verbatim to end of file and survive
byte-identical; a record whose structure the composer does not recognize is refused rather
than reset.

**Detection (not shipped).** Noticing that a composed record is stale *without* re-running
anything — so a project learns its constitution has fallen behind the release it is
running, rather than finding out only when someone happens to re-compose.

WF-492 closes the first. It does not close the second, and it does not pretend to: after
this change a stale record is still stale until something re-composes it, and still nothing
reports that.

## Why detection is out

1. **It is a different mechanism with a different acceptance.** Re-composition is proved by
   composing over a committed fixture and asserting the result. Detection needs a stored or
   derived identity for the article text a record was composed against, a comparison point,
   and a decision about where the mismatch surfaces — a diagnostic surface, a validator
   verdict, or a phase finding. None of those is exercised by WF-492's acceptance, so
   building it here would ship a mechanism with no check of its own.

2. **It would make an M-sized slice indeterminate.** The sub-task's file set is the Article
   2 text, the re-composition path, and the committed fixture. Detection touches the
   resolver's snapshot or validator surface and a consumer that reports the verdict —
   neither is in that set.

3. **The gap it leaves is bounded and stated.** The cost of deferring is that a project must
   re-run to pick up an amended article. That is the pre-existing behaviour for every other
   composed value, it is now at least *possible* to pick up (it was not before), and the
   `## Edge Cases` entry added to the constitution skill states plainly that nothing detects
   the state on its own.

## What is in place instead, so the deferral is not silent

- A **committed** stale fixture (`plugins/wf/mcp/test/fixtures/constitution/`), so the
  re-composition path has a repeatable CI signal that survives the run that consumes it. A
  gitignored `_local/constitution.md` is evidence of drift and never an acceptance artifact.
- A **skill-prose / shipped-body agreement test**. The article's authoring source is
  `plugins/wf/skills/constitution/SKILL.md`; `constitution-core.ts` mirrors it so a
  re-composition can carry it. Two copies with no guard would be this same drift defect one
  level up, so the agreement is asserted mechanically. This is scoped to the *in-repo* pair —
  it is not detection over a downstream composed record.

## Scope note

The follow-on is **WF-501**, a new appended id sequenced after WF-492 in the resolver-runtime
lane. It does not reopen WF-492, and WF-492 did not grow to absorb it.
