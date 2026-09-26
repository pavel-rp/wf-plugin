# postmortem version-resolution — authoring rationale

**Authoring-only — never read at runtime.** `version-resolution.md` states the operative procedure
inline (the behavior-bearing steps for resolving an executed version and two-sided-confirming a
hypothesis); this document is the paired rationale for *why* specific rules are shaped the way they
are, kept out of the runtime-read file per this repo's ops/reference split (`≤150 behavior-bearing
lines` in the runtime half; rationale here). A future edit to the operative procedure changes
`version-resolution.md` first; update this file to match, not the other way around.

## The `$CLAUDE_PLUGIN_ROOT` shape

Branch (a) derives the absolute plugin-cache root by applying `dirname` three times to
`$CLAUDE_PLUGIN_ROOT`, on the premise that it is shaped `<cache-root>/<marketplace>/<plugin>/
<version>`. This is the same shape every skill dispatch's own tool-preamble line carries, per this
pack's own `Skill-load version:` convention (`session-reader.md`, `locator.md`) — the two are
cross-confirmed, not independently asserted. The pack-onboarding contract doc confirms
`$CLAUDE_PLUGIN_ROOT` is populated when a skill runs under the plugin runtime and stops explicitly
when it is not — it does **not** itself state the 4-segment shape; that shape is this pack's own
observed convention. Branch (a)'s guard (fall through to branch (b) when the variable is unset or
empty) exists precisely because this shape is an observed convention, not a contract
`pack-onboarding.ops.md` itself guarantees.

**Two roots, two suffixes.** `$CLAUDE_PLUGIN_ROOT` names the **executing** pack — the postmortem
pack itself — while the reader-reported string names the **audited** pack, which is usually a
different plugin and often a different version. They share only the cache root. An earlier version
of step 1 validated the derived `<cache-root>` by reconstructing it with the **audited** segments
and comparing the result to `$CLAUDE_PLUGIN_ROOT`; that comparison can only succeed when the audited
pack is the executing pack at the executing version, so every other audit fell through to branch (b)
even with its exact cache installed. Step 1 therefore validates the executing root against **its
own** last three segments — the only suffix that root can honestly be checked against — and step 2
joins the audited suffix separately. The two suffixes are validated independently: the executing one
in step 1 (segment rule, exact reconstruction), the audited one in step 5's string validation and
again, after canonicalization, in step 3's three identity checks.

**Why the `plugins/cache` anchor.** The audited string is only accepted when anchored on a literal
`plugins/cache/` (step 5 validation). Requiring the derived `<cache-root>` to end in the same anchor
makes the two sides agree on what "the cache root" is, and rejects an executing root that happens to
have four or more segments but does not sit in a plugin cache at all (a development checkout, say) —
where joining an audited suffix onto `dirname` ×3 would read an arbitrary sibling tree.

## Which containment primitive, and why it differs from the sibling agents' variant

Step 2's `(cd '<dir>' && pwd -P)` is the literal directory-canonicalization primitive
`task-root-containment.md` establishes, applied directly to a directory path. This is **distinct**
from `excerpt-fetcher.md`'s and `session-reader.md`'s own containment check — `(cd
"$(dirname '<path>')" && pwd -P)` joined with the path's own basename — which re-validates a single
**file** path by canonicalizing its parent and rejoining the leaf, because that check exists to catch
a leaf-level symlink swap on an already-named file. Branch (a) has no such leaf to preserve — it is
canonicalizing a **directory** (the cache root, then the joined candidate) from scratch — so the
simpler, direct `(cd '<dir>' && pwd -P)` form is the correct primitive here, not a divergent
reinvention of the sibling agents' pattern. Both primitives ultimately rest on the same subshelled
`cd`/`pwd -P` discipline (never a bare `cd`, so neither ever moves the caller's own persistent working
directory) — they differ only in whether there is a leaf component to preserve across the
canonicalization.

## What each re-validation check defeats

Three independent checks run against the canonicalized candidate before any comparison proceeds,
each closing a distinct symlink-based escape or swap that the others do not:

- **Containment** defeats a symlinked `<marketplace>`, `<plugin>`, or `<version>` segment that
  resolves the candidate entirely **outside** the cache root — the coarsest, first-line defense.
- **Version identity** defeats a `<version>` segment that is itself a symlink to a **different**
  version's directory while remaining inside the cache root — containment alone would not catch this,
  since the candidate is still validly contained.
- **Segment identity** defeats a symlinked `<marketplace>` or `<plugin>` segment that still resolves
  inside the cache root and still carries a matching `<version>` basename — passing containment and
  version identity alike — while silently pointing at a **different pack's** directory entirely.
  Containment and version identity together are not sufficient without this third check, because
  neither inspects the `<plugin>`/`<marketplace>` position of the canonicalized path at all.

Any one check failing means the branch does not resolve at all — never a partial trust that proceeds
on two-out-of-three passing.

## Step 5 validation

**Why "no usable identity" is a stop, not a guess.** The validated `Skill-load version:` string is
the *only* thing step 5 has to go on: there is no predetermined value to match it against, so the
string itself, once proven safe to use as a path, *is* the identity for this hypothesis's session.
Falling back to any other source once that string is missing or malformed would mean inventing an
identity this run has no basis for, which is worse than an honest `unverified`. This is a stated
limitation of the interim mechanism — most sessions may legitimately report none — not a silent gap:
resolving a mechanism's owning file with no reader-reported hint at all is out of this task's scope.

## Branch (c) approximation

Branch (c) is a stated approximation twice over: a session record's last-write time is treated as
"when the run executed" (a record's last write typically lands at or near the end of a run, but this
is a proxy, not a captured fact), and the date-to-version match itself picks the nearest preceding
version bump rather than a value the session ever asserted. Both approximations compound, which is
why the label states "version approximate" explicitly rather than presenting the resolved version as
exact — a reader of the report should discount this factor's precision accordingly.

## Search anchor order

The mechanism's own text is deliberately the *fallback* search anchor, never the first choice,
because a mechanism is the reader's own inferred, paraphrased sentence about what the material
suggests (`session-reader.md`'s own procedure) — not a claim that those exact words appear verbatim
anywhere in the material. Searching for it literally as the primary anchor would systematically miss
a correct hypothesis whose mechanism was accurately paraphrased rather than quoted. A linked
observation's own text is a closer, more literal anchor, because an observation describes something
specific the reader actually saw, not a higher-level inference — so it is preferred whenever one
shares the hypothesis's exact locator. More than one observation can share the same locator, since
`session-reader.md`'s locator grammar is coarse (a bare session path or a `#subagent:<file>` form,
with no line-range), so the priority order (Supporting over Disconfirming, then merged-set order) is
a fixed, mechanical tie-break rather than a judgment call.

## Anchor-search limitation

A search anchor that is itself redacted (contains `[REDACTED]`), or one that is a genuine paraphrase
absent verbatim from the raw material (the mechanism-text fallback), can never match raw session
text — this is a stated, accepted limitation of the interim fetcher, not a silent misclassification.
The locate seam (`references/locator.md`) does not close either case: that seam owns where session
records live, what shape they have, and which structural fields may be counted — not excerpt
retrieval. The fetcher still finds its text by anchor search, so both cases stay open until this
anchor-search fetcher is replaced by a real locator-based lookup that does not depend on anchor text
at all.

## Uncapped fan-out

Step 6's dispatch fan-out (one `excerpt-fetcher` call per hypothesis carrying a locator) is
deliberately uncapped, distinct from the `--cap` read-cap `SKILL.md` Phase 3.5 step 2.5 enforces on
session-reader dispatch only. Since a session record is untrusted content, this is a real, accepted
scope boundary — a separate, still-open one from the read cap that bounds session-reader dispatch,
not something that cap's landing closes. There is no bound today on how many hypotheses a reader may
report or how many sessions windowed reading produces, so this fan-out can in principle be large; that
tradeoff was accepted rather than adding a second cap that would silently drop confirmation attempts
for hypotheses a reader legitimately surfaced.
