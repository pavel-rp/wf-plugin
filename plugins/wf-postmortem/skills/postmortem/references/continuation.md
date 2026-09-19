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
2. **Report validation.** `Read` the resolved file directly — this is the pack's own report artifact,
   never a session or subagent record, so it is not covered by the session-content prohibition (the
   same carve-out `SKILL.md`'s Safety Rules already state for reading the audited pack's own text).
   No parseable `POSTMORTEM — written` block found anywhere in the file → stop, reason `"--report
   <path> is not a postmortem report"`. Write nothing.
3. **Parse the prior report's full accumulated state**, from its own sections exactly as
   `report-template.md` shapes them:
   - **Scope** — the resolved failure description, skill, folder/repository, read cap and its source,
     session scope, session source, and every named session record line (resolved or unresolved).
   - **Coverage** — every listed session, its verdict, its date, its model/tier (or `not dispatched` /
     `n/a`), and whether it carries the `[hunt session]` label — plus any existing "sessions this hunt
     cannot see" entries.
   - **Evidence Record** — every Supporting and Disconfirming observation, each with its locator and
     tier.
   - **Contributing Factors** — both the confirmed half (mechanism, version, `file:line`, locator,
     tier) and the Hypotheses half (mechanism, locator or "no locator", the reason it was not
     promoted).
   - **Measured Effect** — each session's counts and their tiers.
   - **The report's own folder path** — the parent directory of the resolved `report.md` — for Phase
     3's reuse (Part C below).

   A section stating its own "none/not yet produced" reason parses as empty, not as a parse failure.
4. **Scope-conflict check.** For each of `<description>` / `--skill` / `--folder` / `--repo` **passed
   this run**, compare it against the value step 3 parsed from the prior report's Scope. Any mismatch
   → stop, reason `"--report conflicts with the prior report's own scope — <field> differs"`. Write
   nothing. A field **not** passed this run is never compared — it is silently inherited, no question
   asked, interactive or headless (this is what keeps a `--report` run from ever tripping Phase 2's
   missing-description question).
5. **On success**, hand back to `SKILL.md`:
   - the inherited description/skill/folder/repo, to be treated by Phase 1 steps 1-3 exactly as if
     each had been passed as a flag this run (Phase 2's missing-description question never fires on a
     validated `--report` run);
   - the cap in force for this run — `--cap` when also passed this run (a follow-up may still
     override), otherwise the prior report's own recorded cap value, never the shipped default
     silently re-applied over an explicit prior override;
   - the follow-up flag itself, the prior report's folder path, and everything step 3 parsed — the
     accumulated state Part B and Part C below extend.

   Any `--session` value also passed this run still resolves through Phase 1 step 5's own existence
   check, exactly as on a first run — Part B below is what changes how those resolved values are used.

## Part B: Build the retry set (Phase 3.5, in place of step 0's plain located-set-is-the-hunt-set rule)

A follow-up **re-locates from scratch**: dispatch the locator once, in locate mode, under the
inherited scope — exactly as a first run would (`SKILL.md` Phase 3.5 step 0). This is what lets a
session written since the prior run join the hunt; it is never assumed unchanged from the prior
report's own Coverage.

**Any `--session` value also passed this run** is an *additional*, explicit read — never confining,
unlike `--session` on a first run (charter Open Question, spec-resolved). Resolve each such value
(Phase 1 step 5) and match it against the fresh locate-mode return by resolved path:
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
  (access denied)` verdict in the prior report's parsed Coverage (Part A step 3) — these keep that
  status unchanged and are never retried, **unless** also named explicitly with `--session` this run
  (handled above, ahead of this remainder, not here);
- any session already merged into the retry set from the explicit-retry step above (never counted
  twice).

Everything else in the fresh locate-mode return — the prior report's own `skipped (budget)` rows still
present, plus any session not present in the prior Coverage at all (newly written since the prior run,
still matching the inherited scope) — forms this ranked remainder, appended after the explicit
retries.

**A prior `skipped (budget)` session absent from the fresh locate-mode return** (aged out of the
30-day window, or removed from the store since the prior run) moves to the report's "sessions this
hunt cannot see" coverage entry, with that reason. This is not a failure: the run proceeds over
whatever the fresh return does contain.

## Part C: Cap, dispatch, merge, and recompute

**Cap the retry set** — explicit retries first, then the ranked remainder, in that order — up to the
cap in force (Part A step 5), exactly as `SKILL.md` Phase 3.5's cap-split step (2.5) caps a first
run's located-or-named list. Anything past the cap stays, or returns to, `skipped (budget)`.

**Dispatch and merge** the capped retry set through `SKILL.md` Phase 3.5 steps 2-4 unchanged (windowing
decision, routed reader dispatch, per-session verdict merge) — these mechanics do not distinguish a
follow-up's sessions from a first run's.

**Union with the prior report's own accumulated state**: add the newly merged per-session results
(Coverage entries, Evidence Record observations, Measured Effect counts, and any newly reported
hypotheses) to the state Part A step 3 parsed from the prior report — never replacing it. A session
already accumulated keeps its own prior verdict and observations; nothing here re-reads or overwrites
an already-`read` session's own record.

**Recompute over the full accumulated set.** Run `SKILL.md` Phase 3.5 steps 5-8 (executed-version
resolution, the two-sided check, section composition, the fix-direction and routing recommendation) —
`version-resolution.md` and `recommendation.md` — exactly as a first run would, but over **every**
hypothesis and observation now accumulated, not only this run's newly read sessions. Summary, both
halves of Contributing Factors, Component and Version, Localisation, Measured Effect, Coverage, Fix
Direction, and Recommendation are therefore restated fresh from the complete accumulated set every
time a follow-up runs — a hypothesis or a confirmed factor from an earlier run is never dropped simply
because this run read nothing new about it.

## Part D: Write in place and log the Continuation entry

`SKILL.md` Phase 3 (folder minting) is skipped entirely on a validated follow-up — reuse the prior
report's own folder path (Part A step 3) rather than minting a new `PM<NNN>` id. `SKILL.md` Phase 4
overwrites the **same** `report.md` (never a new file) with every section recomputed per Part C, then
appends one dated Continuation entry (`report-template.md`'s Continuation section) stating:

- the date of this follow-up run;
- every session newly read this run (by path), including any explicit `--session` retry;
- every session that moved to "sessions this hunt cannot see" this run, with its reason;
- which sections changed relative to the version this run overwrote — Summary, Contributing Factors,
  Component and Version, Localisation, and Measured Effect are compared by content, Recommendation by
  its **fired rule**: if the rule number is unchanged from the version overwritten, state
  "Recommendation unchanged (rule `<n>` still fires)"; if it changed, state "Recommendation changed —
  rule `<old>` → rule `<new>`" and restate the new rule's hand-off in full (User Journey 2 step 4 /
  spec Success Criterion 6).

Every part of this write, including the Continuation entry itself, passes through the same redacting
write path (`redaction.md`) as a first run's report — nothing here is exempt.
