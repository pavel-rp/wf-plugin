# postmortem executed-version resolution and two-sided confirmation

Runtime-read reference for `SKILL.md` Phase 3.5 steps 5-6 — obtained via `resolve_content({
workspaceRoot, ... })` (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`,
`ref: version-resolution.md`) at the start of step 5, never read at boot. This is the full, behavior-
bearing procedure `SKILL.md` points to rather than restates inline, per this repo's skill-body-length
budget; it is followed exactly, not merely consulted for background.

## Step 5: resolve the executed version

For each hypothesis carrying a locator, resolve the executed version of the pack under audit (the
skill/contract/manifest text the mechanism claims something about).

**Identity comes from one source only: a reader-reported, validated `Skill-load version:` string.**
Every reader dispatch (Phase 3.5 step 3) reports this field — the version-pinned base directory for
the skill a session invoked (the shape `.../plugins/cache/<marketplace>/<plugin>/<version>/skills/
<skill>` — the same form this skill's own tool preamble carries on every dispatch) when the reader
saw one in its assigned material, or `none observed` otherwise (`session-reader.md`'s Output
section). This is the **only** source of the marketplace/plugin/skill identity every branch below
needs — the host never reads session text directly to look for it (Safety Rules Forbidden), and
`--skill` (Phase 1 step 2) is never used as an identity source here: it scopes which *sessions* are
hunted, and states no marketplace/plugin pairing on its own.

**Validate the string before trusting any part of it — traversal-safe shape, not identity matching**
(there is no predetermined value to match against; the string itself, once proven safe to use as a
path, *is* the identity for this hypothesis's session): the value must match exactly
`plugins/cache/<seg>/<seg>/<seg>/skills/<seg>` (a fixed 4-segment shape after the literal
`plugins/cache/` anchor — marketplace, plugin, version, skill, in that order, with nothing extra),
where **each `<seg>` matches `^[A-Za-z0-9._-]+$` and is not exactly `.` or `..`** (the regex alone
does not exclude those two literal values — reject them explicitly as a separate check). A string
that does not parse this way — including `none observed` — means **this hypothesis's session
reported no usable identity at all**, and version resolution for it stops here: the source side is
**failed** (never a partial trust, never a guess at identity from any other source), which leaves the
hypothesis unpromoted at `unverified`, exactly like any other source-side failure. This is a **stated
limitation** of the interim mechanism (a real one — most sessions may report none), not a silent gap:
resolving a mechanism's owning file with no reader-reported hint at all is out of this task's scope.

Once validated, hold `<marketplace>`, `<plugin>`, `<version>`, `<skill>` for this hypothesis and
follow this order, labelling which branch resolved it — never skip a branch to reach a more
convenient one:

**a. Versioned plugin-cache install path.** The validated `<version>` folder exists and is readable
on this host → derive the absolute path to compare against, then re-validate it, before any
comparison proceeds. Rationale for this branch's design (the `$CLAUDE_PLUGIN_ROOT` shape, the
containment primitive's provenance, and what each of the three re-validation checks defeats):
obtained via `resolve_content({ workspaceRoot, ... })` (`class: references-template`, `plugin:
wf-postmortem`, `skill: postmortem`, `ref: version-resolution-rationale.md`) — authoring-only,
never read at runtime.

1. **Derive the absolute plugin-cache root.** Guard: if `$CLAUDE_PLUGIN_ROOT` is unset or empty,
   this branch does not resolve — fall through to branch (b). Otherwise apply `dirname` three times
   to `$CLAUDE_PLUGIN_ROOT` (shaped `<cache-root>/<marketplace>/<plugin>/<version>`) to yield
   `<cache-root>`.
2. **Canonicalize and join.** `Bash`: `(cd '<cache-root>' && pwd -P)` — single-quoted, every `'`
   replaced by `'\''` first, always in a subshell. Either `cd` failing (directory absent or
   unreadable) → fall through to branch (b) — expected and routine, since `<version>` is a
   reader-reported historical string. Join the validated `<marketplace>/<plugin>/<version>` segments
   onto the canonicalized root to form the candidate, then canonicalize the candidate the same way:
   `Bash`: `(cd '<candidate>' && pwd -P)` — this `cd` failing falls through to branch (b) identically.
3. **Re-validate the canonicalized candidate**, all three checks required before the comparison
   proceeds:
   - **Containment** — the candidate's own ancestor three levels up (`dirname` ×3) must be
     character-for-character identical to the canonicalized cache root from step 2 — never a prefix
     match.
   - **Version identity** — the canonicalized candidate's own basename must be character-for-character
     identical to the reported `<version>`.
   - **Segment identity** — the canonicalized candidate's own `<plugin>` and `<marketplace>` path
     segments (the basename's parent, and that parent's own parent) must each be character-for-character
     identical to the originally reported `<plugin>` and `<marketplace>` strings.
4. **Any check failing — step 2's canonicalization, or any of step 3's three re-validations** → this
   branch does not resolve; continue to branch (b) exactly like the existing absent/denied case below
   — never a silent fall-through under an unrelated version.

All three checks passing → compare the skill/contract/manifest text at that canonicalized candidate
path directly (`Read`/`Grep`, Safety Rules Allowed) — no separate read primitive is needed, unlike
(b)/(c). Label: `<version>` (install path).

**b. No readable cache folder for that version.** The `<version>` folder is absent or the read is
denied (the cache sits outside the workspace, exactly like the session store) → resolve the commit
that set that exact `<version>` string in `<plugin>`'s own `.claude-plugin/plugin.json` history as an
explicit walk, not a single command: (i) `Bash`: `git log -- '<plugin.json path>'` to list every
commit touching that file, oldest-to-newest reasoning not required — just the full candidate set;
(ii) for each candidate commit's sha, in the order `git log` returned them, `Bash`: `git show
'<sha>:<plugin.json path>'` and check whether its own `version` field equals `<version>` exactly;
(iii) the **first** candidate whose `version` field matches is the commit this branch resolves to —
stop walking there. Then compare the skill text at that same commit's tree (`Bash`: `git show
'<sha>:<path-to-the-skill-or-contract-file>'`), every substituted value (the version string, each
candidate sha, the file path) single-quoted with every `'` replaced by `'\''` first. **No candidate
commit's `version` field ever equals `<version>`** (the history is readable, but that exact string
never appears) → this branch also does not resolve; continue to (c). Label when it does resolve:
`<version>` (manifest history), no approximate marker — the version itself is exact, only the cache
lookup failed.

**c. The cache lookup and the exact-version history match both failed.** Resolve this hypothesis's
session's own date, taken as its record's filesystem last-modified time — `Bash`: `stat -c %Y
'<path>'` (GNU/Linux), and only if that command itself errors, `stat -f %m '<path>'` (BSD/macOS) as
the one stated fallback; if **both** error, this branch does not resolve either and the run falls
through to (d) — against that same `<plugin>`'s `.claude-plugin/plugin.json` commit history (the
version whose bump commit's date is on or most recently before the session's date) and compare the
skill text at that commit's tree the same way. This is a stated approximation of "when the run
executed" (a record's last write typically lands at or near the end of the run), on top of which the
date-to-version match is itself approximate. Label: **"`<version>` — version approximate
(date-resolved)"** — the resolved version string is still named, with the approximation stated
alongside it, never exact.

**d. Neither resolves.** No readable commit history for `<plugin>` at all (no repository checkout, or
the plugin has no version-bump history), and no `stat` primitive available on this host → fall back
to the present-day text of the skill/contract/manifest file at `<skill>`. Label: **`present-day-only`**.
Note whether that file's `git log` history is readable — and if it is, whether the present-day text
differs from what a nearby historical version would show — or state plainly that the history is
unavailable when it is not. **A `present-day-only` factor is never eligible for promotion** to a
confirmed factor in step 6, regardless of what the comparison finds.

Phrase every comparison in this step as "compare the skill text at `<version>`" or "compare the text
at commit `<sha>`'s tree" — **never** a read/glob verb immediately followed on the same line by a
path ending in `SKILL.md` (or any other audited file) — so
`plugins/wf/skills/_contracts/out4-skill-read-guard.sh` continues to classify every one of these as an
evidence read of data, never a load-step instruction. These reads target the **audited pack's** text
at a resolved past or present point, never this skill's own body, and they never invoke a sibling
skill by any means other than the Skill tool.

A hypothesis carrying **no** locator at all, or a `locator:` field whose value is the literal string
`none` (`session-reader.md`'s sentinel for "no specific location prompted this mechanism"), skips
this step entirely — there is nothing to check either side against — and stays a hypothesis, exactly
as before this task. This is a distinct outcome from a **malformed** locator (step 6) — "no locator"
is never treated as "an invalid one."

## Step 6: check each hypothesis two-sided and tier it

For each hypothesis a reader returned that carries a `locator:` field other than `none`:

- **Source side.** Using step 5's resolved version and label, locate the claimed mechanism's exact
  `file:line` in the compared text. Not present at that version (even if present in today's text,
  under branch (d)) → the source side has **failed**; the hypothesis is not promoted.
- **Parse and validate the locator, entirely on the host, before dispatching anything.** Split the
  `locator:` value on `#` into its path component and zero or more of `subagent:<file>` /
  `L<start>-<end>` segments (`excerpt-fetcher.md`'s grammar). Resolve **the one real filesystem path**
  this locator names — never the compound string itself:
  - No `subagent:` segment → the path is this session's own already-resolved path — **from `--session`
    on a named run, or the locator's own return on a located run** (Phase 3.5 step 0, via
    `references/locator.md`), the same two sources `excerpt-fetcher.md`'s gate names. Reject as
    **malformed** if the locator's path component is not character-for-character identical to it.
  - A `subagent:<file>` segment → the path is whichever entry in this session's own discovered
    subagent-record paths (Phase 3.5 step 0, via `references/locator.md`) has `<file>` as its own
    filename. No such entry → **malformed**.
  - A `L<start>-<end>` segment, if present → both must match `^[1-9][0-9]*$` (a positive integer — `0`
    is excluded, since line numbers are 1-based) with `<start> <= <end>`; otherwise **malformed**.

  **A malformed locator is a session-side failure exactly like "not found" below — it is never
  dispatched.** This parsing is mechanical and runs identically for every locator; it never widens
  what this run reads, since every resolved path was already independently discovered by this run —
  a session's own path from `--session` on a named run or from the locator's own return on a located
  run, and every subagent-record path from that same Phase 3.5 step 0 dispatch — never taken from the
  locator string itself.
- **Session side.** Route and dispatch the `excerpt-fetcher` agent the same way Phase 3.5 step 3
  routes `session-reader` — `resolve_routing` with `role: "excerpt-fetcher"`, a stable `unitIds` entry
  (`excerpt-fetcher:<slug of the hypothesis's locator>`), `shapeEvidence` identical to step 3's
  **except** `ambiguity: "none"`, `toolWork: "bounded"`, `validation: "mechanical"`, and
  `returnContract: "mechanically-judgeable"` (a single bounded `test`/`sed`/`grep` call and a
  redaction pass, not the open-ended hunt `session-reader` performs), `supportsModelSelector: true`,
  `supportsEffortSelector: false`, and the same `hostModel` fact — then invoke one **Task** with
  `subagent_type: wf-postmortem:excerpt-fetcher`, passing **the one resolved real path** above (never
  the compound locator string), the parsed window (when present), and, for a locator with no window,
  **the search anchor chosen as follows** — **never the mechanism's own text as the first choice**,
  since a mechanism is the reader's own inferred, paraphrased sentence about what the material
  suggests (`session-reader.md`'s own procedure), not a claim that those words appear verbatim
  anywhere in the material, so searching for it literally would systematically miss a correct
  hypothesis:
  1. **The linked observation's own text**, when one exists — from Phase 3.5 step 4's merged
     observation set (Supporting or Disconfirming), find every observation whose own `locator:` is
     character-for-character identical to this hypothesis's `locator:`. Observations are descriptions
     of something specific the reader actually saw, not a higher-level inference like a mechanism is,
     so this is the closer, more literal anchor the excerpt search should prefer. **More than one
     observation can share the same locator** (`session-reader.md`'s locator grammar is coarse — a
     bare session path or a `#subagent:<file>` form, with no line-range, so every observation drawn
     from the same record or the same subagent file carries an identical value). When several match,
     prefer the **Supporting** list over Disconfirming, and within a list take the **first** one in
     the merged set's own order (step 4's window-then-list order) — a fixed, mechanical tie-break, not
     a judgment call.
  2. **The mechanism's own text**, only when no observation shares this hypothesis's exact locator.
     This is a stated, accepted fallback, not a full fix: since a mechanism is still an inferred
     paraphrase even here, a correct hypothesis may legitimately fail to literal-match and fall back
     to `unverified` — an honest miss, never presented as a disconfirmation.

  The agent fetches, redacts, and returns the bounded excerpt in its own isolated context — no byte of
  it reaches this skill's own context unredacted (Safety Rules Forbidden). **`not found`**, **`read
  denied`**, or a fetched excerpt that does not show the reported observation → the session side has
  **failed**; the hypothesis is not promoted. Read the result defensively exactly as step 3 does for a
  reader: no parseable `EXCERPT FETCH` block back is a session-side failure, reason `"fetcher returned
  no parseable block"`, never a silent pass.
- **A search anchor that is itself redacted (contains `[REDACTED]`), or one that is a genuine
  paraphrase absent verbatim from the raw material (the mechanism-text fallback above), can never
  match raw session text.** This is a stated, accepted limitation of the interim fetcher, not a silent
  misclassification: the resulting `not found` is the honest outcome, never presented as anything
  stronger. **The locate seam (`references/locator.md`) does not close either case.** That seam owns
  where session records live, what shape they have, and which structural fields may be counted — not
  excerpt retrieval; the fetcher still finds its text by anchor search, so both cases stay open until
  this anchor-search fetcher is replaced by a real locator-based lookup that does not depend on
  anchor text at all.
- **Tiering, both sides passing.** Neither tier depends on a locator ever carrying a line-range window
  — a mechanism's `locator:` from `session-reader.md` never does (only a bare session path or a
  `#subagent:<file>` form); both tiers below are reachable against real reader output as it actually
  exists. The tier split is decided **entirely by the source side** — the session side's shape (an
  observation-text anchor when one is linked, the mechanism-text fallback otherwise, per the priority
  order just above) does not itself distinguish the two tiers:
  - **`mechanically-observed`** — the source text at the resolved `file:line` contains the claimed
    mechanism's own wording as an exact substring (not a paraphrase, and not a nearby-but-different
    line). This is a byte-for-byte deterministic match — no judgment call on the source side, and the
    session side already passed (whichever anchor confirmed it).
  - **`independently-verified`** — both sides verify (the mechanism text is present at the resolved
    version, and the fetched excerpt shows the reported observation), but the source side needed a
    judgment call rather than an exact substring match — the text states the mechanism in different
    words at a `file:line` that is still recognizably the same mechanism.
- **Either side failing, or a `present-day-only` version label** → the hypothesis stays exactly where
  it already was — an unpromoted hypothesis at the **`unverified`** tier. This is not a demotion;
  nothing about a hypothesis's tier is worse for having been checked and not confirmed. Record *why*
  it stayed unpromoted (no locator; malformed locator; source side failed; session side failed;
  `present-day-only`) so the report can distinguish these (Phase 4).
- **A confirmed factor never rests on a run's own statement of success or progress.** A `run-reported`
  observation may point at where to look; it is never itself the mechanism match on either side.
- **Measured-effect counts are untouched by this step.** No count changes tier here, however many
  hypotheses this step confirms: a count is `mechanically-observed` only when the locate seam itself
  produced it deterministically at Phase 3.5 step 0 (`references/locator.md` §6), and every count that
  seam did not produce — findings per pass always — stays `reader-counted` at the `unverified` tier.
  This step confirms mechanisms, never counts.
- **This step's own dispatch fan-out remains deliberately uncapped**, distinct from the `--cap`
  read-cap `SKILL.md` Phase 3.5 step 2.5 now enforces on **session-reader** dispatch only: one
  `excerpt-fetcher` dispatch per hypothesis carrying a locator, with no bound on how many hypotheses a
  reader may report or how many sessions windowed reading produces. Since a session record is
  untrusted content, this is a real, accepted scope boundary — a separate, still-open one from the
  read cap that now bounds session-reader dispatch, not something that cap's landing closes.
