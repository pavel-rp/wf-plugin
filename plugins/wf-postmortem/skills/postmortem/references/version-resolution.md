# postmortem executed-version resolution and two-sided confirmation

Runtime-read reference for `SKILL.md` Phase 3.5 steps 5-6 — obtained via `resolve_content({
workspaceRoot, ... })` (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`,
`ref: version-resolution.md`) at the start of step 5, never read at boot. This is the full,
behavior-bearing procedure `SKILL.md` points to rather than restates inline; it is followed exactly,
not merely consulted for background. Rationale for specific design choices below:
`version-resolution-rationale.md` (paired reference, never read at runtime).

## Step 5: resolve the executed version

For each hypothesis carrying a locator, resolve the executed version of the pack under audit.

**Identity comes from one source only: a reader-reported, validated `Skill-load version:` string.**
Every reader dispatch (Phase 3.5 step 3) reports this field — the version-pinned base directory for
the skill a session invoked (shape `.../plugins/cache/<marketplace>/<plugin>/<version>/skills/
<skill>`) when the reader saw one, or `none observed` otherwise (`session-reader.md`'s Output
section). This is the **only** identity source every branch below needs — the host never reads
session text directly to look for it (Safety Rules Forbidden); `--skill` (Phase 1 step 2) scopes
which *sessions* are hunted and is never used as an identity source here.

**Validate the string before trusting any part of it — traversal-safe shape, not identity matching:**
must match exactly `plugins/cache/<seg>/<seg>/<seg>/skills/<seg>` (fixed 4-segment shape after the
literal `plugins/cache/` anchor — marketplace, plugin, version, skill, in order, nothing extra),
where each `<seg>` matches `^[A-Za-z0-9._-]+$` and is not exactly `.` or `..` (reject those two
explicitly — the regex alone doesn't exclude them). Anything that doesn't parse this way — including
`none observed` — means this hypothesis reported no usable identity: the source side is **failed**
(never a partial trust, never a guess from another source), leaving it `unverified` like any other
source-side failure (rationale: `version-resolution-rationale.md` §"Step 5 validation").

Once validated, hold `<marketplace>`, `<plugin>`, `<version>`, `<skill>` and follow this order,
labelling which branch resolved it — never skip a branch to reach a more convenient one:

**a. Versioned plugin-cache install path.** The validated `<version>` folder exists and is readable
→ derive the absolute path, then re-validate it, before any comparison (rationale:
`version-resolution-rationale.md` §"The `$CLAUDE_PLUGIN_ROOT` shape", §"Which containment
primitive...", §"What each re-validation check defeats"):

1. **Derive the root.** If `$CLAUDE_PLUGIN_ROOT` is unset/empty → fall through to (b). Otherwise
   apply `dirname` ×3 (assumed shaped `<cache-root>/<marketplace>/<plugin>/<version>`) to yield
   candidate `<cache-root>`, **reconstruct** the full path from it plus the three validated segments,
   and compare character-for-character against `$CLAUDE_PLUGIN_ROOT`'s own uncanonicalized value.
   Any mismatch → fall through to (b), never proceeding on an unverified `<cache-root>`.
2. **Canonicalize and join.** `Bash`: `(cd '<cache-root>' && pwd -P)` (single-quoted, every `'` →
   `'\''`, always in a subshell). `cd` failing → fall through to (b). Join the validated segments onto
   the canonicalized root; canonicalize the joined candidate the same way — this `cd` failing also
   falls through to (b).
3. **Re-validate**, all three required: **containment** — the candidate's ancestor three levels up
   (`dirname` ×3) is character-for-character identical to the canonicalized cache root; **version
   identity** — the candidate's basename is character-for-character identical to `<version>`;
   **segment identity** — the candidate's `<plugin>`/`<marketplace>` segments are
   character-for-character identical to the originally reported strings.
4. **Any check failing** (steps 1-3) → fall through to (b), never a silent pass under an unrelated
   version.

All of 1-3 passing → compare the skill/contract/manifest text at the canonicalized candidate path
directly (`Read`/`Grep`). Label: `<version>` (install path).

**b. No readable cache folder for that version.** Absent or denied → resolve the commit that set
`<version>` in `<plugin>`'s `.claude-plugin/plugin.json` history: (i) `Bash`: `git log -- '<plugin.json
path>'` for every commit touching that file; (ii) for each sha in that order, `Bash`: `git show
'<sha>:<plugin.json path>'`, check its `version` field equals `<version>` exactly; (iii) the
**first** matching sha is the commit this branch resolves to. Compare the skill text at that commit's
tree (`Bash`: `git show '<sha>:<path>'`; every substituted value single-quoted, `'` → `'\''`). No
candidate ever matches → does not resolve; continue to (c). Label when it resolves: `<version>`
(manifest history) — exact, only the cache lookup failed.

**c. Both (a) and (b) failed.** Resolve the session's own filesystem last-modified time — `Bash`:
`stat -c %Y '<path>'` (GNU/Linux), or `stat -f %m '<path>'` (BSD/macOS) if that errors; both erroring
→ fall through to (d) — against the same plugin.json history (the version whose bump commit's date is
on or most recently before the session's date), comparing the same way. Label: **"`<version>` —
version approximate (date-resolved)"** (rationale: `version-resolution-rationale.md` §"Branch (c)
approximation").

**d. Neither resolves.** No readable commit history and no `stat` primitive → fall back to the
present-day text at `<skill>`. Label: **`present-day-only`**. Note whether `git log` history is
readable, and if so whether present-day text differs from a nearby historical version, or state
plainly that history is unavailable. **Never eligible for promotion** to a confirmed factor in step 6.

Phrase every comparison as "compare the skill text at `<version>`" or "at commit `<sha>`'s tree" —
**never** a read/glob verb immediately followed by a path ending in `SKILL.md` on the same line, so
`out4-skill-read-guard.sh` classifies every one as an evidence read of data, never a load-step
instruction. These target the **audited pack's** text at a resolved point, never this skill's own
body, and never invoke a sibling skill by any means other than the Skill tool.

A hypothesis with **no** locator, or `locator: none` (`session-reader.md`'s sentinel), skips this
step — nothing to check either side against — and stays a hypothesis. Distinct from a **malformed**
locator (step 6): "no locator" is never "an invalid one."

## Step 6: check each hypothesis two-sided and tier it

For each hypothesis carrying a `locator:` field other than `none`:

- **Source side.** Using step 5's resolved version/label, locate the claimed mechanism's exact
  `file:line` in the compared text. Not present at that version (even if present today, under (d)) →
  **failed**; not promoted.
- **Parse and validate the locator on the host before dispatching anything.** Split on `#` into a
  path plus zero or more `subagent:<file>` / `L<start>-<end>` segments (`excerpt-fetcher.md`'s
  grammar). Resolve **the one real filesystem path** — never the compound string: no `subagent:`
  segment → this session's own already-resolved path (from `--session`, or the locator's return on a
  located run, via `references/locator.md`) — **malformed** if not character-for-character identical;
  a `subagent:<file>` segment → whichever discovered subagent-record path has `<file>` as its
  filename — **malformed** if none; an `L<start>-<end>` segment → both must match `^[1-9][0-9]*$`
  with `<start> <= <end>` — else **malformed**. A malformed locator is a session-side failure, never
  dispatched — every resolved path was already independently discovered by this run, never taken from
  the locator string itself.
- **Session side.** Route and dispatch `excerpt-fetcher` the way Phase 3.5 step 3 routes
  `session-reader` — `resolve_routing` with `role: "excerpt-fetcher"`, `unitIds`
  (`excerpt-fetcher:<16-hex-digest>`, step 3's slugging rule applied to the one resolved real path),
  `shapeEvidence` identical to step 3's **except** `ambiguity: "none"`, `toolWork: "bounded"`,
  `validation: "mechanical"`, `returnContract: "mechanically-judgeable"`, `supportsModelSelector:
  true`, `supportsEffortSelector: false`, `invocationModel: "haiku"`, same `hostModel` fact — then
  invoke one **Task** (`subagent_type: wf-postmortem:excerpt-fetcher`) passing the resolved path, the
  parsed window (if any), and — for a locator with no window — the search anchor, in order (never the
  mechanism's own text first — rationale: `version-resolution-rationale.md` §"Search anchor order"):
  (1) the linked observation's own text when one shares this hypothesis's exact locator (prefer
  Supporting over Disconfirming; first in the merged set's order on a tie); (2) the mechanism's own
  text, only when no observation matches.

  The agent fetches, redacts, and returns the bounded excerpt in its own context — no unredacted byte
  reaches this skill. `not found`, `read denied`, or an excerpt not showing the reported observation →
  session side **failed**; not promoted. No parseable `EXCERPT FETCH` block back is also a failure
  (`"fetcher returned no parseable block"`), never a silent pass.
- **A redacted or genuinely-paraphrased search anchor can never match raw session text** — an
  accepted limitation (rationale: `version-resolution-rationale.md` §"Anchor-search limitation"); the
  resulting `not found` is honest, never presented as stronger.
- **Tiering, both sides passing** — decided entirely by the source side: **`mechanically-observed`**
  — the source text at `file:line` contains the mechanism's own wording as an exact substring
  (deterministic, no judgment call). **`independently-verified`** — both sides verify, but the source
  side needed a judgment call rather than an exact match.
- **Either side failing, or a `present-day-only` label** → stays `unverified`, never a demotion.
  Record *why* (no locator; malformed; source failed; session failed; `present-day-only`) for Phase 4.
- **A confirmed factor never rests on a run's own statement of success or progress** — a
  `run-reported` observation may point at where to look; never itself the match on either side.
- **Measured-effect counts are untouched here.** A count is `mechanically-observed` only when the
  locate seam produced it deterministically (`references/locator.md` §6); every count that seam
  didn't produce — findings per pass always — stays `reader-counted`, `unverified`.
- **This step's dispatch fan-out is deliberately uncapped** — one `excerpt-fetcher` dispatch per
  hypothesis with a locator, no bound on hypothesis or session count (rationale:
  `version-resolution-rationale.md` §"Uncapped fan-out"), distinct from the `--cap` read-cap `SKILL.md`
  Phase 3.5 step 2.5 enforces on session-reader dispatch only.
