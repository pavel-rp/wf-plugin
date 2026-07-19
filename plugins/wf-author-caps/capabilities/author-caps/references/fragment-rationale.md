# author-caps fragments — rationale and history

**Version:** 1.0.0 (WF-355)
**Paired with:** the five fragments under `capabilities/author-caps/fragments/`
**Read by:** authors and reviewers — **never at runtime**
**Model:** claude-opus-4-8

---

## Contents

- [Why verify is two rows, not one](#why-verify-is-two-rows-not-one)
- [Why every row dispatches inline](#why-every-row-dispatches-inline)
- [Why articles are manifest keys, not rows](#why-articles-are-manifest-keys-not-rows)
- [The narrated-invocation property](#the-narrated-invocation-property)
- [The sandbox-testing soft dependency](#the-sandbox-testing-soft-dependency)
- [Which seams are live today](#which-seams-are-live-today)

---

## Why verify is two rows, not one

The pack's verify contribution splits into `structural-validation` (schema conformance) and
`reference-existence` (do the named things exist). They could have shared one fragment; they do not,
for three reasons.

They are **different rule families with different remediations**. A schema violation is fixed by
correcting the artifact's shape; a dead reference is fixed by updating a name or deleting a branch.
Collapsing them would produce findings whose recommendations pull in unrelated directions.

They have **different scoping arguments**. The structural tools scope by capability path, plugin,
or skill; the existence tool scopes by file or folder and walks skills and agents. One fragment
would have to explain both scoping models at once.

And splitting **keeps each fragment inside the runtime-read ops budget** with room for the verdict
mapping, which is the behavior-bearing part. The audit capability sets the precedent here: one row
per lens rather than one row listing five lenses.

## Why every row dispatches inline

`subagent:` dispatch buys context isolation, and costs an agent file plus a spawn. It is worth it
when a contribution does heavy, verbose reasoning whose intermediate work would pollute the caller
— the audit lenses, which read a whole change set adversarially, are the clear case.

None of these five fragments does that. The two guidance fragments are prose the phase follows. The
two verify fragments call read-only typed tools that return a small structured verdict — the
expensive work happens inside the resolver runtime, not in the model's context, so there is nothing
to isolate. The scenario fragment emits plan entries. Inline dispatch keeps the pack shipping no
agents at all, which is a smaller surface to maintain and to validate.

## Why articles are manifest keys, not rows

WF-239 removed `article` from the contribution taxonomy. The reasoning: a constitution clause does
not attach to an SDD phase, and the constitution is not a phase — so a fragments-table row, whose
first column is a phase, has no honest value to put there. A clause is therefore declared with the
repeatable `article: <key> = <value>` manifest key, alongside `requires:` and `conflicts:`, and a
row naming `article` as its contribution kind is a validator error.

This is why WF-355 ships **five fragment rows plus article keys** rather than four rows and a fifth
article row. The five rows are five phase contributions; the articles compose through the
constitution skill and reach a fresh session through the existing session-start injection path,
with no hook change.

## The narrated-invocation property

The reference-existence check flags a body naming a target that does not resolve, keying on the
**invocation form** rather than on authorial intent. Prose that narrates another body's dead
invocation is flagged identically to prose instructing the reader to run it.

WF-354 considered narrowing this to directive-only occurrences and deliberately did not: separating
narration from instruction needs an intent classifier, and the existing skill-read guard already
owns the instruction-versus-prose axis. Forking a second, differently-drawn intent boundary would
leave two classifiers disagreeing about the same text. The cost of keeping it broad is that
documentation about dead references must be written structurally — which is a real constraint, and
is why `fragments/reference-existence.md` carries an explicit authoring-consequence paragraph
telling the next author how to describe the defect without committing it.

That constraint bit during WF-355 itself: the natural way to explain the defect class is to quote
the removed command that motivated it, and doing so turns the explaining file red. The fragment
describes the shape of the defect instead, and reaches for a command that genuinely resolves
whenever it needs something concrete.

## The sandbox-testing soft dependency

Authoring artifacts are prose whose behavior is only observable by running them, so the natural
execution engine for the qa-generation scenarios is the sandbox-testing harness. The charter's
soft-dependency rule keeps that a **declaration**: the scenarios name the engine so a reader knows
the intended destination, while the capability declares no `requires:`, resolves no provider
surface, and invokes no harness.

The rule exists so the two capabilities can ship and version independently. A hard `requires:` edge
would make this pack unregisterable wherever the harness is absent, for no benefit until the
integration actually lands.

## Which seams are live today

At the time these fragments were authored, core's live aggregation seams were `verify` (the
`finding` rows, aggregated by the spec-conformance audit skill) and `qa-generation` (the `scenario`
rows, aggregated by the QA plan generator). The `spec` and `implement` **guidance** seams were not
yet consumed by core's own phase skills — the test-authoring skill was the live consumer of
`implement` guidance.

The two guidance fragments are declared and authored anyway. Composition is runtime prose injection
with no compile step, so a fragment that is authored ahead of its consumer costs nothing and
composes the moment the seam lands — no edit to this pack required. The node-ts capability already
ships an `implement | guidance` fragment on the same footing.
