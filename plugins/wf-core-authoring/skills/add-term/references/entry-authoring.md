# Why `add-term` is shaped the way it is

Rationale for `/wf-core-authoring:add-term`. **Never read at runtime** — the skill body carries
every behaviour-bearing clause; this file exists so that body does not have to carry the
reasoning too.

**Model:** claude-opus-5[1m]

## Contents

- [Why the field set is read, never transcribed](#why-the-field-set-is-read-never-transcribed)
- [Why the lint is located by role](#why-the-lint-is-located-by-role)
- [Why the refusal is the feature](#why-the-refusal-is-the-feature)
- [Why the surface is a skill and not guidance prose](#why-the-surface-is-a-skill-and-not-guidance-prose)
- [Why writing outside `_local/` is sanctioned here](#why-writing-outside-_local-is-sanctioned-here)
- [The seeded-violation proof recipe](#the-seeded-violation-proof-recipe)

## Why the field set is read, never transcribed

The glossary owns its own parse contract, and the lint parses that file directly — no rule is
transcribed anywhere else. A field list restated in the skill body would be a second home for
the contract, and second homes drift silently: the contract could gain or rename a field and
the skill would keep collecting the old set, emitting entries the lint then rejects as
malformed. Reading the contract on every run makes desynchronization structurally impossible
rather than merely unlikely.

This is the same discipline the lint itself follows, and it is why the skill can be correct
about a contract it has never seen.

## Why the lint is located by role

The lint's home is moving. It sits in the core plugin's contracts folder today and migrates
into its owning pack as part of the lint-ownership consolidation; both changes can be in
flight at once. A path written into this skill would pass review, merge, and then break
silently the moment the other change lands — the worst failure mode available, because a lint
that cannot be found is easy to mistake for a lint that found nothing.

Locating it by role instead — the script that *emits* the glossary lint's own pass report on a
non-comment line — is stable across the move. The non-comment condition is what separates the
lint from its callers: a CI entry point names the lint in a comment describing what it invokes,
but only the lint prints the report.

The same reasoning is why the glossary itself is resolved by role rather than by path, even
though it is not scheduled to move: the cost of the role-based lookup is one glob, and it
removes a whole class of silent breakage.

## Why the refusal is the feature

Every other part of this skill could be replaced by a careful author. The refusal cannot.

A documentation-only term is not a partial success that a later pass will finish — it is a
rule that looks enforced and is not, which is strictly worse than no entry at all, because it
invites authors to rely on it. Writing the definition and leaving the enforceable fields for
later produces exactly that artifact. So the skill writes nothing at all until the entry is
whole, and says which fields are missing rather than guessing at them.

The admission gate is the second half of the same idea. A term whose violation no pattern can
fire on is a preference; admitting it would grow the glossary without growing what it can
catch. A short, hard glossary beats a broad, soft one.

## Why the surface is a skill and not guidance prose

The sanctioned alternative shape was a guidance fragment that walks the maintainer through the
same-change rule. It was not taken because the obligation here is *interactive*: something has
to collect the fields, notice that one is absent, and decline. Guidance prose can supply the
required-field set and withhold a done-verdict, but it cannot refuse to stop half-done — the
maintainer is the one holding the pen, and the fragment only advises.

A skill also gets to prove its own work, which is what turns "the entry has a pattern field"
into "the pattern was observed firing".

## Why writing outside `_local/` is sanctioned here

The repository's authoring guide forbids a skill from writing outside `_local/` and then
enumerates its exceptions by name. That list is extensible and already carries a scoped
admission — the ship skill, narrowed to one loop. This skill was admitted the same way, scoped
to the single glossary file, in the same change that introduced it.

That ordering matters: a glossary-maintenance skill that shipped before its exception would be
in violation of the very rule it exists to serve, on its first run.

## The seeded-violation proof recipe

The proof has to use a *real* in-scope path, because scoping is half of what the entry
declares. A violation seeded somewhere the entry's `applies-to:` does not cover would be
skipped, and the skipped result reads as a pass — a false green that would certify an entry
that never fires.

So the temporary file is placed at a path matching one of the scopes the entry names, carries
a line the pattern matches, and is linted on its own. The expected outcome is a **failure**;
success is the bug. Then the self-test runs, which catches the other failure mode — an entry
that is malformed rather than merely inert, and which the parse contract requires the lint to
fail loudly on rather than skip.

Both files are removed before the skill hands back. A seeded violation left in the tree would
fail the next author's on-touch gate for reasons they did not cause.
