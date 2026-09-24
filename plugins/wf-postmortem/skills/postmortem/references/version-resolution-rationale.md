# postmortem version-resolution branch (a) — authoring rationale

**Authoring-only — never read at runtime.** `version-resolution.md` step 5 branch (a) states the
operative absolute-path derivation, canonicalization, and re-validation steps inline (the
behavior-bearing procedure); this document is the paired rationale for *why* that branch is shaped
the way it is, kept out of the runtime-read file per this repo's ops/reference split (`≤150
behavior-bearing lines` in the runtime half; rationale here). A future edit to branch (a)'s procedure
changes `version-resolution.md` first; update this file to match, not the other way around.

## The `$CLAUDE_PLUGIN_ROOT` shape

Branch (a) derives the absolute plugin-cache root by applying `dirname` three times to
`$CLAUDE_PLUGIN_ROOT`, on the premise that it is shaped `<cache-root>/<marketplace>/<plugin>/
<version>`. This is the same shape every skill dispatch's own tool-preamble line carries, per this
pack's own `Skill-load version:` convention (`session-reader.md`, `locator.md`) — the two are
cross-confirmed, not independently asserted. `plugins/wf/skills/_contracts/pack-onboarding.ops.md`
confirms `$CLAUDE_PLUGIN_ROOT` is populated when a skill runs under the plugin runtime and stops
explicitly when it is not — it does **not** itself state the 4-segment shape; that shape is this
pack's own observed convention. Branch (a)'s guard (fall through to branch (b) when the variable is
unset or empty) exists precisely because this shape is an observed convention, not a contract
`pack-onboarding.ops.md` itself guarantees.

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
