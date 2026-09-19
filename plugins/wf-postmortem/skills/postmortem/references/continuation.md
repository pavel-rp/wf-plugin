# postmortem follow-up: `--report` resolution and continuation

Runtime-read reference for `SKILL.md` Phase 0.5 and Phase 3.5's follow-up-specific dispatch/merge
rules — obtained via `resolve_content({ workspaceRoot, ... })` (`class: references-template`,
`plugin: wf-postmortem`, `skill: postmortem`, `ref: continuation.md`) at the start of Phase 0.5, never
read at boot. This is the full, behavior-bearing procedure `SKILL.md` points to rather than restates
inline, per this repo's skill-body-length budget; it is followed exactly, not merely consulted for
background.

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
   - the canonicalized parent directory's own basename matches `^PM[0-9]+__.+$` (Phase 3's own minting
     shape);
   - the canonicalized **grandparent** directory is character-for-character identical to the
     canonicalized `{task-root}` (never a prefix match — `{task-root}evil/...` must not pass).

   Any check failing → stop, reason `"--report <path> is not inside a postmortem report folder"`.
   Write nothing. **Only once this passes** does step 3 below read the file — the direct-`Read`
   exemption `SKILL.md`'s Safety Rules state for the pack's own report artifact is tied to this
   confinement, never to the file's content alone.
3. **Report validation.** `Read` the resolved (now confinement-checked) file directly — this is the
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
   pre-593 report's own `"default, not yet enforced"` text) parses as **unresolvable**: step 5 below
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
   - the follow-up flag itself, the prior report's folder path, and everything step 4 parsed — the
     accumulated state Part B and Part C below extend.

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
- every session that moved to "sessions this hunt cannot see" this run, with its reason;
- which sections changed relative to the version this run overwrote — Summary, Contributing Factors,
  Component and Version, Localisation, and Measured Effect are compared by content, Recommendation by
  its **fired rule**: if the rule number is unchanged from the version overwritten, state
  "Recommendation unchanged (rule `<n>` still fires)"; if it changed, state "Recommendation changed —
  rule `<old>` → rule `<new>`" and restate the new rule's hand-off in full (User Journey 2 step 4 /
  spec Success Criterion 6).

Every part of this write, including the Continuation entry itself, passes through the same redacting
write path (`redaction.md`) as a first run's report — nothing here is exempt.
