# preview-edit — why each arm is sequenced the way it is

Rationale for `/wf-core-authoring:preview-edit`. **Never read at runtime.** The skill body carries every
behavior-bearing rule; this file carries only the reasoning behind those rules, so a maintainer changing
one of them can see what it was protecting.

---

## The asymmetry the whole surface is built on

Two shipped resolver tools observe a pending edit in two structurally different ways, and the difference
is not a detail of the current implementation — it is what each tool is *for*.

**`preview_composition` renders off the already-resolved snapshot.** It reads the resolved capability
records and the fragment rows the resolver already parsed out of them. It re-parses no manifest and
re-reads no registry itself. That is exactly why it is cheap, deterministic, and safe to call repeatedly —
and exactly why its answer is only ever as current as the snapshot underneath it.

**`validate_manifest` derives its rules live.** It re-derives the rule set from the taxonomy contract's
ops doc on every single call, and judges each active manifest against the rules it just derived. It
consults no snapshot. That is why it sees a working-tree contract edit directly, with nothing in between.

Everything the body mandates follows from those two sentences.

---

## Why the composition arm's refresh is required, not incidental

The obvious argument is that without a refresh the render answers about a snapshot predating the edit —
a confident, well-shaped, wrong answer delivered in exactly the situation the surface exists to protect
against. That failure is real whenever the snapshot is stale, and it is the reason the ordering is a hard
rule rather than an optimization.

**It is not the whole story, and the measured behaviour is worth writing down.** The resolver revalidates
its inputs' fingerprints, so a render reached without an explicit refresh will often come out current
anyway: the rebuild simply happens *inside* the render call. Measured against a pending, uncommitted
fragments-row edit, the render returned the edited composition with no refresh in front of it — and the
lifecycle state's `generatedAt` moved to the render's own timestamp, carrying a changed-source freshness
diagnostic. The render had rebuilt the snapshot.

That is why the rule survives the discovery rather than being weakened by it. Skipping the refresh does
not reliably give you a stale answer; it gives you an **unannounced, unattributed rebuild with no recorded
reason**, performed by the one call the surface elsewhere claims is non-mutating. The explicit refresh
moves that mutation into the open, where it is announced before it happens and its reason is recorded as a
diagnostic — and it leaves the subsequent render genuinely inert, which is what makes the bracket below
mean anything. A second render with nothing changed in between held `generatedAt` fixed, confirming both
halves.

The refresh is announced before it is made because it is the run's only *deliberate* state mutation, and a
surface presented as read-only that silently mutates anything has stopped being read-only in the way its
caller assumed.

---

## Why the no-mutation claim brackets one call, not the surface

It is tempting to describe the whole skill as read-only and be done. That claim would be false: step 2 of
the composition arm rebuilds the resolved snapshot on purpose.

The precise, defensible claim is narrower and more useful — **`preview_composition` itself leaves
lifecycle state untouched**. Bracketing a lifecycle read immediately before and immediately after that one
call is what demonstrates it, and reporting both reads is what lets a reader check the demonstration
rather than take it on trust. A claim scoped to the surface would be unprovable *and* wrong; a claim
scoped to the call is provable and true, and it is the claim a maintainer actually needs when deciding
whether re-rendering is safe.

The ordering rule for a both-classes run falls out of the same reasoning: the taxonomy arm mutates
nothing, so running it first keeps the bracket around the render adjacent to the render itself.

---

## Why a taxonomy edit must never be routed to the render

A taxonomy edit changes the rules a manifest is judged against. It does not change any fragment row, any
capability record, or anything else the snapshot holds. Rendering it produces output byte-identical to the
pre-edit render.

The danger is not that the render is uninformative — it is that it is *reassuring*. An unchanged render
reads as "this edit is harmless", which is the opposite of what a rule change usually means. Routing that
class to the render would manufacture a false clean out of a tool working exactly as designed, so the body
forbids it and requires the report to state that it was not run and why.

Symmetrically, judging a fragments-row edit by `validate_manifest` alone answers only whether the edited
manifest is *well-formed*, never what it would *do*. Each class goes to the tool that can see it; neither
tool is a substitute for the other, which is why a both-classes run reports two verdicts rather than
picking one.

---

## Why the taxonomy contract is located by role

The body never hardcodes a path to the taxonomy contract. It takes whatever `validate_manifest` reports in
`ruleSources` — the tool naming, itself, the documents its rules came from.

This is not only about surviving a file move. A resolved rule source can legitimately live inside an
installed plugin's root rather than in the working tree, in which case the rules being applied were derived
from a copy the maintainer did not edit. A hardcoded path would classify the edit as taxonomy-class and
report a verdict that never observed it. Reading the class definition out of `ruleSources` makes that
mismatch visible in the same breath, which is why the arm reports the sources verbatim and downgrades
itself to **inconclusive** rather than emitting a verdict it cannot stand behind.

---

## What is deliberately absent

This surface defines no phase set, no contribution-kind list, and no aggregation policy. Those belong to
the authoring taxonomy, which the body cites by invoking `/wf-author-caps:authoring-taxonomy` through the
Skill tool rather than restating any part of it. Two copies of a taxonomy drift, and the copy inside a
preview surface would drift silently and then be trusted.

If that cited authority turns out to be incomplete for a maintainer's question, the shortfall is filed
against the authoring-taxonomy work item (WF-203). It is never patched by re-authoring the missing piece
here.

No new preview machinery is introduced either: both consumed tools already ship in the bundled resolver
runtime, and this surface's entire contribution is sequencing them correctly and refusing the sequences
that mislead.
