# postmortem follow-up: `--report` resolution and continuation

Runtime-read reference for `SKILL.md` Phase 0.5, Phase 3.5's follow-up dispatch/merge rules, and
Phase 4's pre-overwrite re-verification (Part E) — obtained via `resolve_content({ workspaceRoot,
... })` (`class: references-template`, `plugin: wf-postmortem`, `skill: postmortem`, `ref:
continuation.md`) at Phase 0.5's start, never read at boot; followed exactly, obtained once, stays in
context through Phase 4 (Part E is a second, independent check, not a second fetch). Rationale:
`continuation-rationale.md` (paired reference, never read at runtime).

## Part A: Resolve `--report <path>` (Phase 0.5)

Runs before Phase 1, only when `--report <path>` was passed; absent → skip straight to Phase 1.

1. **Existence.** `Bash`: `test -e '<path>'` (`'` → `'\''`, single-quoted — same primitive as
   `--session`, Phase 1 step 5); fails → stop `POSTMORTEM — stopped`, reason `"--report <path> does
   not resolve to an existing file"`, write nothing.
2. **Path confinement — gates step 3's `Read`, nothing else** (rationale:
   `continuation-rationale.md` §"Why confinement gates the read"). Canonicalize filesystem-side (never
   string comparison): `Bash`: `cd '<dirname of --report path>' && pwd -P` (same escaping) for the
   parent, and resolved `{task-root}` (`resolve_config`'s `workspaceRoot` + `coreConfig.taskRoot`) the
   same way. Require **all**: basename exactly `report.md`; `Bash`: `test -L '<path>'` **fails** (not
   a symlink); canonicalized parent's basename matches `^PM[0-9]+__.+$` (Phase 3's minting shape);
   canonicalized **grandparent** = canonicalized `{task-root}` character-for-character (never a prefix
   match). Any failing → stop, reason `"--report <path> is not inside a postmortem report folder"`;
   write nothing. **Record identity for Part E:** all passing → `Bash`: `stat -c '%d:%i' '<path>'`
   (BSD: `stat -f '%d:%i'`), hand it + the canonicalized parent/grandparent to Part E.
3. **Validate.** Size first (rationale: `continuation-rationale.md` §"Why size before read"): `Bash`:
   `wc -c '<path>'` (same primitive as `SKILL.md` Phase 3.5 step 2), same 200,000-char ceiling. Over →
   stop, reason `"--report <path> is too large to continue — <n> characters, ceiling 200000"`; write
   nothing (a fresh hunt without `--report` continues instead). Else `Read` the file — no parseable
   `POSTMORTEM — written` block anywhere → stop, reason `"--report <path> is not a postmortem
   report"`; write nothing.
4. **Parse the prior report's accumulated state**, per `report-template.md`'s sections: Scope
   (description, skill, folder/repository, read cap+source, session scope/source, every named session
   line resolved-or-not); Coverage (every session, verdict, date, model/tier or
   `not dispatched`/`n/a`, `[hunt-session]` flag, "cannot see" entries); Evidence Record (every
   observation, locator, tier); Contributing Factors (confirmed: mechanism/version/`file:line`/
   locator/tier; Hypotheses: `H<n>` id, mechanism, locator or "no locator", not-promoted reason,
   fallback-evidence label + draw-key material — dedup: `coverage-cross-check.md`); Measured Effect
   (counts+tiers); the folder path (for Part C). A "none/not yet produced" section parses empty, not a
   failure. A Read-cap field not matching `<n> (default|override)` (pre-593's `"default, not yet
   enforced"`) parses **unresolvable** → step 7 falls back to the shipped default (15, `default`)
   unless `--cap` overrides.
5. **Redact this run's freshly passed values** (`<description>`/`--skill`/`--folder`/`--repo`) through
   `SKILL.md` Phase 3 steps 1-2's pass (`redaction.md` + markdown neutralization) **before** comparing
   below — the prior Scope values were written post-pass too (rationale: `continuation-rationale.md`
   §"Why redact before comparing").
6. **Scope-conflict check.** Compare each now-redacted value **passed this run** against step 4's
   parsed prior value. Mismatch → stop, reason `"--report conflicts with the prior report's own scope
   — <field> differs"`; write nothing. A field not passed is never compared — silently inherited
   (keeps a `--report` run from tripping Phase 2's missing-description question).
7. **On success**, hand `SKILL.md`: inherited description/skill/folder/repo (as if passed as flags —
   Phase 2's question never fires); the cap in force (`--cap` this run, else the prior recorded cap,
   else the shipped default per step 4 — never re-defaulting silently over an explicit override); the
   follow-up flag, prior folder path, device/inode identity (step 2), everything step 4 parsed. Any
   `--session` this run resolves via Phase 1 step 5 as on a first run; unresolved is reported in
   Scope, but step 5's "all-unresolved → stop" does **not** apply — Part B uses a *resolved* value
   differently.

## Part B: Build the retry set (Phase 3.5 step 0 override)

Re-locate from scratch: dispatch the locator once, locate mode, under the inherited scope, as a first
run would (lets a newly-written session join). Cap applied later (Part C, step 2.5). **Any
`--session` this run** is additional/explicit, never confining — including one already
`read`/`read in part`/`skipped (reader error)`/`skipped (access denied)` (re-naming it requests a
re-read; Part C's upsert makes it take effect). Resolve each (Phase 1 step 5), match against the
fresh locate-mode return by path: **present** → reuse the entry (date, subagent records, hunt-session
flag, seam counts), move to the retry set's front ahead of the ranked remainder; **absent** →
dispatch the locator **a second time**, attach-only mode, over just the missing values (a stated,
bounded exception to "exactly once per run" — `SKILL.md` Safety Rules), merged the same way.
**Ranked remainder** = fresh locate-mode return, its own order, **excluding**: sessions already
`read`/`read in part (…)`/`skipped (reader error: …)`/`skipped (access denied)`/`skipped
(unrecognized shape: …)` in the prior Coverage
(step A4) unless also named via `--session` this run (explicit retry beats a terminal status); and
sessions already merged above. Everything else — prior `skipped (budget)` rows, plus sessions absent
from prior Coverage — forms the remainder, appended after explicit retries. A newly-appearing session
this run's cap (Part C) doesn't reach is a *newly*-`skipped (budget)` session (Part D names it as
such, distinct from an already-listed one). A prior `skipped (budget)` session **absent** from the
fresh return (aged out, or removed) moves to "sessions this hunt cannot see" with that reason — not a
failure. `coverage-cross-check.md`'s Part A reruns fresh every follow-up over this re-located
scope/re-enumerated history, never carried forward — except its fallback-evidence entries,
deduplicated by draw key against the prior report (kept, not re-drawn, when already present).

## Part C: Cap, dispatch, merge, and recompute

**Cap** the retry set (explicit retries, then ranked remainder) at `SKILL.md`'s fixed cap-split point
(step 2.5), same position as a first run's list. Within cap → dispatch; past it → assigned/stays
`skipped (budget)` (named as newly-capped, distinct from already-`skipped (budget)`). **Exemption: an
already-Coverage'd session is never *demoted* by the cap** — the retry set can exceed
the cap on its own (any number of `--session` retries, ordered first); pushing an already-terminal
session past the boundary **keeps its existing Coverage entry** verbatim (verdict, date, model, tier,
observations, counts), never reassigned `skipped (budget)` (rationale: `continuation-rationale.md`
§"Why the cap exemption exists"); only a **no-prior-entry** session gets a fresh past-cap `skipped
(budget)`. Part D line: `Requested but not reached this run: <path> — cap in force (<n>) reached
before this retry; prior entry retained`. **Dispatch/merge** the capped set through `SKILL.md` Phase
3.5 steps 2-4 unchanged — no distinction from a first run's sessions.
**Upsert, keyed by resolved session path — never a plain union, never a duplicate row.** Every session
**dispatched this run**: its fresh result (Coverage verdict, Evidence observations, Measured Effect
counts, hypotheses) **replaces** any prior same-path entry in full (rationale:
`continuation-rationale.md` §"Why replace-in-full"). Not dispatched → keeps its existing entry (or
gains its first `skipped (budget)`, Part B), untouched. **Verdict-quality guard: a replacement never
loses evidence** (rationale: `continuation-rationale.md` §"Why the verdict-quality guard exists") —
rank this run's verdict vs. the one it would overwrite: `read` > `read in part` > `skipped (reader
error)`/`skipped (access denied)`/`skipped (unrecognized shape)` (the failures rank equal). `read`/`read in part` → replace in
full (a `read in part` supersedes an earlier `read` too); failure over a prior `read`/`read in part`
→ **keep the prior entry**, log `Retry failed, prior evidence retained: <path> — <failure verdict and
reason>`; both failures → replace (fresher reason, nothing lost either way).
**Recompute over the full accumulated set.** Run `SKILL.md` Phase 3.5 steps 5-8 (version resolution,
two-sided check, section composition, fix-direction/recommendation — `version-resolution.md` and
`recommendation.md`) as a first run would, but over
**every** accumulated hypothesis/observation post-upsert — every section restated fresh each time; a
factor is never dropped for lack of new evidence, and a re-read session replaces its own prior
contribution rather than duplicating it. **`H<n>` ids are never recomputed** — a carried-over entry
(step 4) keeps its id; only a genuinely new entry mints the next unused `H<n>`
(`report-template.md`'s minting rule).
## Part D: Write in place and log the Continuation entry

Phase 3 (folder minting) is skipped — reuse the prior folder path (step A4). Phase 4 overwrites the
**same** `report.md`, every section recomputed per Part C, then appends one dated Continuation entry
(`report-template.md`'s Continuation section, after Recommendation, before the final-output block)
stating: the run date; sessions newly read (by path, incl. an explicit retry even if already `read` —
Part C's upsert replaced it); sessions newly `skipped (budget)` **this run only**; retries the cap
didn't reach (Part C's exemption-line format); retries that failed over a prior read (Part C's
verdict-guard line, never folded into "Sections changed"); sessions newly moved to "cannot see," with
reason; fallback evidence drawn/retired (`coverage-cross-check.md`: each new draw by finding or
"none"; a finding's first sessions-only confirmation after carrying fallback evidence gets a dated
note beside those still-labelled entries, no further draws for it after); fallback evidence
suppressed (`coverage-cross-check.md`'s dedup guard: `Fallback evidence suppressed (duplicate key):
<key>` per hit, or "none"); which sections changed vs. the overwritten version (content-compared for
Summary/Contributing Factors/Component and Version/Localisation/Measured Effect; Recommendation by
fired rule — unchanged → "Recommendation unchanged (rule `<n>` still fires)"; changed →
"Recommendation changed — rule `<old>` → rule `<new>`" plus the new hand-off in full). Every part of
this write, Continuation entry included, passes through the same redacting write path (`redaction.md`)
as a first run. **Part E runs after this is composed, immediately before the write lands.** The
Continuation log itself is unbounded (rationale: `continuation-rationale.md` §"Why the log is
unbounded") — step A3's read-side ceiling keeps that growth bounded on read.

## Part E: Re-verify the write target immediately before the overwrite (Phase 4 step 2.5)

Step A2's check ran back in Phase 0.5; Phase 1 through 3.5 has run since, so it no longer describes
the file Phase 4 is about to overwrite (rationale: `continuation-rationale.md` §"Why Part E
re-verifies from scratch"). **As the last action before the `Write`, and only then**, over the same
resolved path: (1) **re-run step A2 from scratch** — basename, `test -L` non-symlink, freshly
re-canonicalized parent matching `^PM[0-9]+__.+$`, freshly re-canonicalized grandparent vs. freshly
re-canonicalized `{task-root}` (reuse no prior canonicalized string or conclusion); (2) **compare
identity** — `Bash`: `stat -c '%d:%i' '<path>'` (BSD: `stat -f '%d:%i'`) vs. step A2's recorded pair,
character-for-character (differing → the file at that path is not the one this run validated/read).
Either failing → **stop** `POSTMORTEM — stopped`, reason `"--report <path> changed between
validation and write — nothing written"`; write nothing at all (no report, no partial, no scratch
copy, no Continuation entry). **Never re-validate-and-proceed** — the composed report is discarded,
the prior report on disk is left exactly as it was. **Guarantee:** a check immediately before the
write, **not atomic**. It narrows the race to two consecutive tool calls and does not close it. This
is the same guarantee the fresh-mint path states (`task-root-containment.md` §"Fresh-mint target
identity"; rationale: `continuation-rationale.md` §"Why Part E re-verifies from scratch").
