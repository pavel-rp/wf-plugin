# postmortem follow-up: `--report` resolution and continuation

Runtime-read reference for `SKILL.md` Phase 0.5, Phase 3.5's follow-up-specific dispatch/merge rules,
and Phase 4's pre-overwrite re-verification (Part E) — obtained via `resolve_content({ workspaceRoot,
... })` (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`, `ref:
continuation.md`) at the start of Phase 0.5, never read at boot. This is the full, behavior-bearing
procedure `SKILL.md` points to rather than restates inline, per this repo's skill-body-length budget;
it is followed exactly, not merely consulted for background. Obtained once, it stays in context
through Phase 4 — Part E is not a second fetch, but it *is* a second, independent check.

## Part A: Resolve `--report <path>` (Phase 0.5)

Runs before Phase 1, only when `--report <path>` was passed on this invocation. Absent → `SKILL.md`
skips straight to Phase 1, unchanged by anything below.

1. **Existence check.** The same single primitive `SKILL.md` Phase 1 step 3 already uses: `Bash`:
   `test -e '<path>'`, with every `'` in the value replaced by `'\''` first, wrapped in single quotes.
   Fails → stop with `POSTMORTEM — stopped`, reason `"--report <path> does not resolve to an existing
   file"`. Write nothing.
2. **Path-confinement check — required before any `Read` of the file.** A resolved `--report` value
   is caller-controlled and, unconfined, would let this run overwrite any file the process can reach
   once treated as a reuse target (Phase 4) — the confinement below, not the content check in step 3,
   is what closes that. Canonicalize both sides with the host's own filesystem, never a string
   comparison of the raw paths: `Bash`: `cd '<dirname of the resolved --report path>' && pwd -P` for
   the report's own parent directory — with every `'` in that dirname replaced by `'\''` first, wrapped
   in single quotes, the same primitive step 1 uses on the same caller-controlled value — and the
   already-resolved absolute `{task-root}` (from `resolve_config`'s `workspaceRoot` +
   `coreConfig.taskRoot`) canonicalized the same way. Require **all** of:
   - the file's own basename is exactly `report.md`;
   - **the resolved `--report` path itself is not a symlink**: `Bash`: `test -L '<path>'` (same
     escaping as step 1) must **fail** (exit non-zero). The directory-level canonicalization above
     already defeats a symlinked *directory* on the path — `cd` follows it and `pwd -P` reports the
     real location it resolves to — but never dereferences the final **file** component, since nothing
     `cd`s into a file; without this separate check, a `report.md` that is itself a symlink, sitting
     inside an otherwise-legitimate `PM<n>__slug/` folder, would pass every check above and then have
     step 3's `Read` and Phase 4's overwrite silently follow it to whatever it targets;
   - the canonicalized parent directory's own basename matches `^PM[0-9]+__.+$` (Phase 3's own minting
     shape);
   - the canonicalized **grandparent** directory is character-for-character identical to the
     canonicalized `{task-root}` (never a prefix match — `{task-root}evil/...` must not pass).

   Any check failing → stop, reason `"--report <path> is not inside a postmortem report folder"`.
   Write nothing. **Only once this passes** does step 3 below read the file — the direct-`Read`
   exemption `SKILL.md`'s Safety Rules state for the pack's own report artifact is tied to this
   confinement, never to the file's content alone.

   **Record the target's identity, then carry it forward.** Once every check above passes, capture
   the resolved path's device/inode pair — `Bash`: `stat -c '%d:%i' '<path>'` (BSD: `stat -f '%d:%i'`),
   the same escaping as step 1 — and hand it, with the canonicalized parent and grandparent, to Part E.
   **This check gates step 3's `Read` and nothing else.** It does *not* gate Phase 4's overwrite, which
   happens phases later; Part E is what gates that, and Part E re-derives everything rather than
   trusting anything recorded here beyond this one identity value, which exists only to be compared.
3. **Report validation.** **Size it before reading it.** The report is read unwindowed into this
   skill's own context, and its Continuation log grows by one entry per follow-up without bound
   (Part D), so an old report is the one file in this pack that can outgrow the reader. Measure it
   first — `Bash`: `wc -c '<path>'`, the same metadata primitive and escaping `SKILL.md` Phase 3.5
   step 2 uses on a session record — and apply the **same 200,000-character ceiling**. Over it → stop,
   reason `"--report <path> is too large to continue — <n> characters, ceiling 200000"`, and write
   nothing; a report that has outgrown the ceiling is continued by starting a fresh hunt without
   `--report`, never by a partial read. This is a hard stop rather than the windowed read a session
   record gets: a report must be parsed whole to be extended safely, and half of one is worse than
   none. Then `Read` the resolved (now confinement-checked, now sized) file directly — this is the
   pack's own report artifact, never a session or subagent record, so it is not covered by the
   session-content prohibition (the same carve-out `SKILL.md`'s Safety Rules already state for reading
   the audited pack's own text). No parseable `POSTMORTEM — written` block found anywhere in the file
   → stop, reason `"--report <path> is not a postmortem report"`. Write nothing.
4. **Parse the prior report's full accumulated state**, from its own sections exactly as
   `report-template.md` shapes them:
   - **Scope** — the resolved failure description, skill, folder/repository, read cap and its source,
     session scope, session source, and every named session record line (resolved or unresolved).
   - **Coverage** — every listed session, its verdict, its date, its model/tier (or `not dispatched` /
     `n/a`), and whether it carries the `[hunt-session]` label — plus any existing "sessions this hunt
     cannot see" entries.
   - **Evidence Record** — every Supporting and Disconfirming observation, each with its locator and
     tier.
   - **Contributing Factors** — both the confirmed half (mechanism, version, `file:line`, locator,
     tier) and the Hypotheses half (mechanism, locator or "no locator", the reason it was not
     promoted).
   - **Measured Effect** — each session's counts and their tiers.
   - **The report's own folder path** — the parent directory of the resolved `report.md`, already
     confirmed by step 2 above — for Phase 3's reuse (Part C below).

   A section stating its own "none/not yet produced" reason parses as empty, not as a parse failure.
   A **Read cap** field not matching the `<n> (default|override)` shape this task introduces (e.g. a
   pre-593 report's own `"default, not yet enforced"` text) parses as **unresolvable**: step 7 below
   falls back to the shipped default (15, source `default`) exactly as a first run would, unless
   `--cap` overrides.
5. **Redact this run's freshly passed values before the scope-conflict check.** Run each of
   `<description>` / `--skill` / `--folder` / `--repo` **passed this run** through the same pass
   `SKILL.md` Phase 3 steps 1-2 apply (`redaction.md`'s recognized shapes, then the
   collapse-newlines-and-backticks / strip-leading-`#`-run markdown-structure neutralization) —
   **before** comparing anything below. The prior report's own Scope values were written only after
   that same pass; comparing a raw, unredacted value against an already-redacted one would compare two
   different normalizations of what could be the same input and misreport a conflict (or miss one).
   This redaction pass is idempotent, so Phase 3 running it again later over the inherited value
   changes nothing.
6. **Scope-conflict check.** For each of the now-redacted values from step 5 **passed this run**,
   compare it against the value step 4 parsed from the prior report's Scope. Any mismatch → stop,
   reason `"--report conflicts with the prior report's own scope — <field> differs"`. Write nothing. A
   field **not** passed this run is never compared — it is silently inherited, no question asked,
   interactive or headless (this is what keeps a `--report` run from ever tripping Phase 2's
   missing-description question).
7. **On success**, hand back to `SKILL.md`:
   - the inherited description/skill/folder/repo, to be treated by Phase 1 steps 1-3 exactly as if
     each had been passed as a flag this run (Phase 2's missing-description question never fires on a
     validated `--report` run);
   - the cap in force for this run — `--cap` when also passed this run (a follow-up may still
     override), otherwise the prior report's own recorded cap value (or the shipped default when that
     value is unresolvable, step 4), never the shipped default silently re-applied over an explicit
     prior override;
   - the follow-up flag itself, the prior report's folder path, the recorded device/inode identity
     (step 2, for Part E), and everything step 4 parsed — the accumulated state Part B and Part C
     below extend.

   Any `--session` value also passed this run still resolves through Phase 1 step 5's own existence
   check, exactly as on a first run, and an unresolved one is still reported unresolved in Scope —
   **but Phase 1 step 5's "every named value unresolved → stop" condition does not apply on a
   validated `--report` run.** A follow-up's session source is the re-located inherited scope (Part B
   below), never the named list alone, so a supplementary retry that fails to resolve narrows nothing
   about what this run can still read — it is reported and the hunt proceeds exactly as it would with
   no `--session` value at all. Part B below is what changes how a *resolved* value is used.

## Part B: Build the retry set (Phase 3.5 step 0, in place of step 0's plain located-set-is-the-hunt-set rule)

A follow-up **re-locates from scratch**: dispatch the locator once, in locate mode, under the
inherited scope — exactly as a first run would (`SKILL.md` Phase 3.5 step 0). This is what lets a
session written since the prior run join the hunt; it is never assumed unchanged from the prior
report's own Coverage. (The cap itself is not applied here — that is Part C's job, at `SKILL.md`'s own
fixed cap-split point, step 2.5.)

**Any `--session` value also passed this run** is an *additional*, explicit read — never confining,
unlike `--session` on a first run (charter Open Question, spec-resolved), and this includes a value
naming a session the prior report already marked `read`, `read in part`, `skipped (reader error)`, or
`skipped (access denied)`: naming it again is the maintainer's explicit request to re-read it, and Part
C's merge rule (upsert, below) is what makes that request take effect rather than being silently
discarded. Resolve each such value (Phase 1 step 5) and match it against the fresh locate-mode return
by resolved path:
- **Already present** in the fresh return → reuse that entry (its date, subagent records, hunt-session
  flag, and any seam-produced counts) and move it to the front of the retry set, ahead of the ranked
  remainder below.
- **Not present** in the fresh return (out of scope, out of window, or otherwise absent) → dispatch the
  locator **a second time**, in attach-only mode, over just the values not already present — a stated,
  bounded exception to "exactly once per run" (`SKILL.md` Safety Rules), limited to this one
  combination (a `--report` follow-up that also names a `--session` value the fresh locate-mode return
  did not surface). Merge its returned entries into the front of the retry set the same way.

**Build the ranked remainder** from the fresh locate-mode return, in its own rank order, **excluding**:
- any session already carrying a `read`, `read in part (…)`, `skipped (reader error: …)`, or `skipped
  (access denied)` verdict in the prior report's parsed Coverage (Part A step 4) — these keep that
  status unchanged and are never retried, **unless** also named explicitly with `--session` this run
  (handled above, ahead of this remainder, not here — an explicit retry always wins over a terminal
  status);
- any session already merged into the retry set from the explicit-retry step above (never counted
  twice).

Everything else in the fresh locate-mode return — the prior report's own `skipped (budget)` rows still
present, plus any session not present in the prior Coverage at all (newly written since the prior run,
still matching the inherited scope) — forms this ranked remainder, appended after the explicit
retries. **A session newly appearing here that this run's cap (Part C) does not reach** is a
newly-`skipped (budget)` session — distinct from one the prior report already listed that way — and
Part D's Continuation entry names it as such.

**A prior `skipped (budget)` session absent from the fresh locate-mode return** (aged out of the
30-day window, or removed from the store since the prior run) moves to the report's "sessions this
hunt cannot see" coverage entry, with that reason. This is not a failure: the run proceeds over
whatever the fresh return does contain.

## Part C: Cap, dispatch, merge, and recompute

**Cap the retry set** — explicit retries first, then the ranked remainder, in that order — at exactly
`SKILL.md`'s own fixed cap-split point (Phase 3.5 step 2.5), in the same position a first run's
located-or-named list is capped: after step 2's windowing measurement, before step 3's dispatch. Every
entry within the cap in force (Part A step 7) proceeds to dispatch; everything past it is assigned, or
stays, `skipped (budget)` — a newly-located session capped out for the first time this run is named as
such in Part D's Continuation entry, never silently indistinguishable from one the prior report already
listed that way.

**One exemption, and only one: a session that already carries a Coverage entry is never *demoted* by
the cap.** The retry set can exceed the cap on its own — a maintainer may name any number of
`--session` retries, and Part B orders them ahead of the ranked remainder — so an explicit retry of an
already-`read` (or otherwise already-terminal) session can be pushed past the cap boundary by the
retry set's own size. **When that happens it keeps its existing Coverage entry exactly as the prior
report recorded it — verdict, date, model, tier, observations, counts and all — and is not reassigned
`skipped (budget)`.** Reassigning it would discard evidence this hunt has already paid for and
already written down, and would do it behind a "Newly capped this run" line indistinguishable from an
ordinary first-time cap. Only a session with **no** entry in the prior report's Coverage — one located
for the first time this run — may receive a fresh `skipped (budget)` assignment past the cap. Part D's
Continuation entry records an exempted retry on its own line: `Requested but not reached this run:
<path> — cap in force (<n>) reached before this retry; prior entry retained`, so the maintainer learns
their retry did not run rather than silently reading a stale row as fresh.

**Dispatch and merge** the capped retry set through `SKILL.md` Phase 3.5 steps 2-4 unchanged (windowing
decision, routed reader dispatch, per-session verdict merge) — these mechanics do not distinguish a
follow-up's sessions from a first run's.

**Combine with the prior report's own accumulated state as an upsert keyed by resolved session path —
never a plain union, and never a duplicate row for one session.** For every session **dispatched this
run** (an explicit retry or a member of the capped ranked remainder), its freshly merged result —
Coverage verdict, Evidence Record observations, Measured Effect counts, and any hypotheses it
contributed — **replaces** any entry the prior report already held for that same resolved path in
full: the old Coverage row, old observations, and old counts for that session are dropped, and the
fresh ones stand in their place. This is what makes an explicit retry of an already-`read` session (or
a first read of a session the cap newly reaches) actually take effect, and what keeps a second,
identical `--report --session <path>` follow-up from re-accumulating that session's observations,
counts, and Coverage row without bound — the second run's fresh result still simply replaces the
first's, never adds to it. A session **not** dispatched this run — already terminal and not named this
run, or still `skipped (budget)`/newly `skipped (budget)` after Part C's cap — keeps exactly its
existing entry (or gains its first `skipped (budget)` entry, per Part B), untouched by this step.

**The upsert is guarded on verdict quality: a replacement never loses evidence.** A dispatch can fail
for reasons that say nothing about the session — the verdict table (`SKILL.md` Phase 3.5 step 4) lets
any dispatched session come back `skipped (reader error: …)` or `skipped (access denied)`, a retry
included. Replacing a prior `read`/`read in part` entry with one of those would erase real
observations, real counts, and any Contributing Factor their hypotheses had earned, on nothing better
than a transient failure. So rank this run's verdict against the one it would overwrite, on the fixed
order `read` > `read in part` > `skipped (reader error)` / `skipped (access denied)` (the two failure
verdicts rank equal), and apply:

- **This run's verdict is `read` or `read in part`** → replace in full, exactly as above. New evidence
  always supersedes old evidence, including a `read in part` superseding an earlier `read`: both are
  real reads of a record that may itself have changed, and the fresher one is the truthful one.
- **This run's verdict is `skipped (reader error)` or `skipped (access denied)`, over a prior
  `read`/`read in part`** → **keep the prior entry** — its verdict, observations, counts and
  hypotheses all stand, untouched. Do not merge the two and do not blend the counts. Record the failed
  attempt instead, on its own Part D Continuation line: `Retry failed, prior evidence retained: <path>
  — <this run's failure verdict and reason>`. Coverage keeps showing the prior verdict, because that
  is still the best thing this hunt knows about the session.
- **Both are failure verdicts** → replace, so the reason shown is this run's own and does not go
  stale. Nothing is lost: neither entry carries observations.

The point is that the Continuation log must always distinguish **"new evidence overturned the old"**
from **"a retry failed and the old evidence survived"**. "Sections changed" alone cannot carry that
distinction, which is exactly why the failure case gets its own named line rather than an entry in
that field.

**Recompute over the full accumulated set.** Run `SKILL.md` Phase 3.5 steps 5-8 (executed-version
resolution, the two-sided check, section composition, the fix-direction and routing recommendation) —
`version-resolution.md` and `recommendation.md` — exactly as a first run would, but over **every**
hypothesis and observation now accumulated (post-upsert), not only this run's newly read sessions.
Summary, both halves of Contributing Factors, Component and Version, Localisation, Measured Effect,
Coverage, Fix Direction, and Recommendation are therefore restated fresh from the complete accumulated
set every time a follow-up runs — a hypothesis or a confirmed factor from an earlier run is never
dropped simply because this run read nothing new about it, and a session this run re-read replaces its
own prior contribution rather than duplicating it.

## Part D: Write in place and log the Continuation entry

`SKILL.md` Phase 3 (folder minting) is skipped entirely on a validated follow-up — reuse the prior
report's own folder path (Part A step 4) rather than minting a new `PM<NNN>` id. `SKILL.md` Phase 4
overwrites the **same** `report.md` (never a new file) with every section recomputed per Part C, then
appends one dated Continuation entry (`report-template.md`'s Continuation section, placed after
Recommendation and before the fenced final-output block) stating:

- the date of this follow-up run;
- every session newly read this run (by path), including any explicit `--session` retry — a session
  named again by explicit retry is listed here even if it was already `read` before this run (Part C's
  upsert is what its fresh entry replaced);
- every session newly assigned `skipped (budget)` this run for the first time (Part B/C) — distinct
  from a session that was already `skipped (budget)` in the version overwritten, which is not relisted;
- every explicit `--session` retry the cap did not reach, one line each, as
  `Requested but not reached this run: <path> — cap in force (<n>) reached before this retry; prior
  entry retained` (Part C's cap exemption) — never folded into "Newly capped this run";
- every retry that was dispatched and came back a failure verdict over a prior `read`/`read in part`,
  one line each, as `Retry failed, prior evidence retained: <path> — <failure verdict and reason>`
  (Part C's verdict-quality guard) — never folded into "Sections changed";
- every session that moved to "sessions this hunt cannot see" this run, with its reason;
- which sections changed relative to the version this run overwrote — Summary, Contributing Factors,
  Component and Version, Localisation, and Measured Effect are compared by content, Recommendation by
  its **fired rule**: if the rule number is unchanged from the version overwritten, state
  "Recommendation unchanged (rule `<n>` still fires)"; if it changed, state "Recommendation changed —
  rule `<old>` → rule `<new>`" and restate the new rule's hand-off in full (User Journey 2 step 4 /
  spec Success Criterion 6).

Every part of this write, including the Continuation entry itself, passes through the same redacting
write path (`redaction.md`) as a first run's report — nothing here is exempt. **Part E below runs
after all of this is composed and immediately before the write actually lands.**

**The Continuation log is unbounded — a stated, accepted scope boundary of this release.** It grows
by exactly one entry per follow-up run and is never pruned, consolidated, or capped, unlike every
other report section, each of which is fully recomputed (and so naturally bounded) on every run. That
asymmetry is deliberate: the log is the report's own audit trail, and an entry records what a given
run read, newly capped, lost to "cannot see", and changed — facts a later recompute over the
accumulated set cannot reconstruct, because the intermediate states are gone. A maintainer who does
not want a report's log to keep growing starts a fresh hunt without `--report` rather than editing or
trimming the log; no rollup rule ships in this release.

**Unbounded on disk is not unbounded on the read path.** The log grows without limit, but the file
that holds it is the one a follow-up reads back into this skill's own context, so that read is
explicitly bounded instead: Part A step 3 sizes the report with `wc -c` and stops at the same
200,000-character ceiling a session record gets, before any `Read`. Growth is therefore accepted, and
the failure mode it would otherwise cause — an oversize report quietly consuming a follow-up's
context — becomes a stated stop with a stated remedy rather than a silent context exhaustion.

**What that remedy costs, stated plainly.** Starting a fresh hunt without `--report` starts a *new*
report: none of the accumulated Evidence Record, Contributing Factors, Coverage or Continuation log
carries over, and this release ships no salvage, export, or rollup path to move any of it across. A
hunt that crosses the ceiling therefore loses its accumulated continuity permanently, through this
pack's own tooling. That is the **accepted product decision** for this release — the ceiling is a
tail-scenario guard (a realistic Continuation entry runs a few hundred to ~2k characters, so reaching
it from the log alone implies on the order of a hundred follow-ups against one report), and a bounded
stop with total-continuity loss was judged better than an unbounded read that degrades a follow-up's
own context. It is recorded here as a known cost, not as a solved problem.

## Part E: Re-verify the write target immediately before the overwrite (Phase 4 step 2.5)

Part A step 2's confinement check ran back in Phase 0.5. By the time `SKILL.md` Phase 4 reaches its
write, the whole of Phase 1 through Phase 3.5 has run in between — input resolution, redaction, the
locator dispatch, one `session-reader` dispatch per session or window, the two-sided check's excerpt
fetches — many tool calls and non-trivial real time. **A check that old does not describe the file
Phase 4 is about to overwrite**, so Phase 0.5's result is never carried over as if it still held: in
that interval the `report.md` could have been replaced by a symlink, or its parent folder swapped,
and an overwrite trusting the stale check would follow the new target wherever it points.

**As the last action before the `Write`, and only then**, over the same resolved `--report` path:

1. **Re-run the whole of Part A step 2 from scratch** — the `report.md` basename, the `test -L`
   non-symlink check on the path itself, the freshly re-canonicalized parent matching `^PM[0-9]+__.+$`,
   and the freshly re-canonicalized grandparent compared character-for-character against the freshly
   re-canonicalized `{task-root}`. Re-derive every one of these from the filesystem now; reuse no
   canonicalized string, and no pass/fail conclusion, computed in Phase 0.5.
2. **Compare the recorded identity.** `Bash`: `stat -c '%d:%i' '<path>'` (BSD: `stat -f '%d:%i'`),
   same escaping, compared character-for-character against the pair Part A step 2 recorded. A
   differing device/inode pair means the file now at that path is not the file this run validated and
   read — a distinct failure from step 1's, and one step 1 alone cannot catch, since a swapped-in
   regular file at the same confined path satisfies every structural check.

Either failing → **stop** with `POSTMORTEM — stopped`, reason `"--report <path> changed between
validation and write — nothing written"`. Write nothing at all: no report, no partial report, no
scratch copy, no Continuation entry. **Never re-validate-and-proceed** — a target that moved under a
running hunt is reported to the maintainer, never silently adopted as the new write destination, even
when it would pass a fresh check on its own terms. The composed report is discarded with the run; the
prior report on disk is left exactly as it was.

### The residual race, stated plainly

This is a check-then-write shape, not an atomic one, and it is worth being exact about what it does
and does not buy. The tooling available to this skill exposes no way to write through the very file
descriptor the check validated — no `O_NOFOLLOW` open handed to the writer, no `openat`-relative
write, no atomic compare-and-replace — so a window remains between step 2's `stat` and the `Write`
itself, in which a local actor holding write access to the report's own parent directory could still
swap the target. Steps 1-2 narrow that window from the full Phase 1-3.5 span to two consecutive tool
calls, which is as narrow as these primitives allow; **they do not close it.**

The guarantee this pack therefore offers is *"the write target was confined, non-symlinked, and the
same file this run read, as of immediately before the write"* — never *"the write cannot be
redirected."* Anyone who needs the stronger guarantee gets it from the filesystem, by not granting
write access to `{task-root}` and its report folders to anything but the maintainer running the hunt.
Should a future release gain a write primitive that accepts an already-validated descriptor, or an
atomic replace-if-unchanged, this Part is what should be rewritten to use it, and this paragraph is
what should be deleted.
