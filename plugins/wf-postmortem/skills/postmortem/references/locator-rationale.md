# postmortem session-locate seam — authoring rationale

**Authoring-only — never read at runtime.** `locator.md` states the operative record-layout,
shape-check, scope-mapping, ranking, hunt-session-detection, counting, and output-contract facts
inline; this document is the paired rationale for *why* specific rules are shaped the way they are,
kept out of the runtime-read file per this repo's ops/reference split (`≤150 behavior-bearing lines`
in the runtime half; rationale here). A future edit to the operative procedure changes `locator.md`
first; update this file to match, not the other way around.

## Why this is "one replaceable seam"

`locator.md` is deliberately the **one** file in the pack naming the host's session-record store
location, filename convention, subagent-folder layout, and JSONL field names — every other pack file
(`SKILL.md`, `agents/locator.md` itself, every other reference) names none of them, and where one
needs this seam's behaviour it points here rather than restating it. The facts in the ops file are
**host-observed** — this project's own installed host, inspected directly while writing the file —
not a promise that every host or future release matches it. The shape check (§2) exists precisely
because that promise cannot be made: a host that lays records out differently must be recognized as
different, loudly, not silently mistaken for a match. Consolidating every host-specific fact into one
file is what makes a future host-release change to any of them a one-file change rather than a hunt
across the pack.

## Why the `gitBranch` forward scan, and why empty counts as absent

`gitBranch` is read by the same forward scan §3 applies to `timestamp`, never from a fixed line,
because the opening header lines (§2) carry `sessionId` and neither `timestamp` nor `gitBranch` —
demanding it on the first line would report `none observed` for every conforming record and silently
degrade every match to date-only. It is read here and also returned to the caller (§8,
`agents/locator.md`'s `Branch:` line) because it is the one scope/identity fact the caller sees
directly, letting a hunt's coverage cross-check match a session to a task folder or delivery entry by
branch name with no new read of session content. An **empty or whitespace-only** value counts as the
same real absence as no field at all, rather than being returned verbatim, because a host may stamp
the field empty for a detached HEAD or a non-repository working directory — an empty string would
match no id and no branch while also failing to be the sentinel, leaving that session permanently
unmatchable and its real task folder wrongly reported as having left no session.

## Why containment, version identity, and segment identity are three separate checks

(This section documents the shape check's containment discipline, mirrored from
`version-resolution-rationale.md`'s equivalent three-check discussion for a different seam, since
both apply the same subshelled `cd`/`pwd -P` canonicalization discipline never to move the caller's
own persistent working directory.) Containment alone defeats a symlinked segment resolving entirely
outside the store root — the coarsest, first-line defense. It would not catch a segment that is
itself a symlink to a *different* record while remaining inside the store root, which is what the
shape check's record-identity tests close. Any one check failing means the candidate is Unrecognized
outright — never a partial trust proceeding on some checks passing and not others.

## Why `--skill` requires an exact final-segment match

Before this task, the skill-scope match tested whether the named `--skill` value appeared anywhere as
a substring of a skill-load path. That is unsound: a skill-load line naming a *longer* skill sharing
the named value as a prefix (e.g. a line naming `postmortem-extended` against `--skill postmortem`)
would wrongly match. Reusing `version-resolution.md`'s own anchored-segment shape and character class
as the "exact" precedent — matching only the final `<seg>` after `.../skills/`, character-for-character
— closes that regression while keeping the match mechanical and judgment-free.

## Why the 30-day window is a hard filter, not a ranking penalty

A candidate outside the window receives no coverage entry of any kind, not even a "skipped" one,
because the window is stated by the caller as a fact about what was searched regardless of whether any
candidate was actually excluded by it — the caller states the window itself in coverage every run.
Making the window a ranking penalty instead (rank it low, but still list it) would let an out-of-window
session leak into coverage in some edge case, undermining the stated boundary. The cutoff itself is
supplied by the caller once per run precisely so every use of it within that run — this seam's filter,
and any other consumer — agrees on the same instant, rather than each recomputing "now" independently
and risking a boundary session flipping sides mid-run.

## Why the running-session fallback is a heuristic, not an identity

When the runtime exposes no current-session disclosure, the locator falls back to treating the
most-recently-modified in-scope top-level record as the running session. This is an accepted, stated
heuristic: a session actively being written grows and its modification time keeps advancing throughout
the run, so among already-existing records it is reliably the newest at any snapshot in time. It is
not a guaranteed identity — a session that legitimately went quiet for a while could in principle be
overtaken by another session's own write — and the ops file names it as a heuristic rather than
presenting it as certain, so a reader of the return block knows to weight the `Hunt session: yes` label
accordingly on the fallback path.

## Why hunt sessions are re-ranked, never dropped or specially statused

A hunt session (the running session, or one in which `postmortem` itself already ran) keeps an
**ordinary** coverage status — never `skipped (self)` — because excluding it from coverage would hide
real information the report is allowed to carry (a postmortem run genuinely can, and sometimes should,
read its own earlier session or the very session it is running in). Moving it to the end of the ranked
list, rather than giving it a different status, is what keeps the read cap from spending its budget on
a hunt session before more informative external sessions, without pretending the hunt session isn't
real coverage.

## Why counting reads exactly these fields and no others

The three deterministic counts (iterations, edits, files touched) are scoped to fields this seam can
extract with **no model judgment** — a mechanical count of role-transition boundaries, a closed
tool-name allowlist, and a target-file argument field read only on an already-identified file-mutating
entry. "Findings per pass" has no equivalent structural signal, because a finding is a judgment about
significance, not a line shape — inventing a heuristic for it would trade a `reader-counted` figure
that is honest about being a judgment call for a `mechanically-observed` one that silently isn't. The
scan bound is a single sequential pass because that is the same walk the shape check already performs
— adding a second traversal to count would double the read cost for no correctness gain.

## Why the `--session` regression path preserves three distinct outcomes

The three-way split in §7 (attach-only when values resolve, an immediate stop when none do, locate
mode when none were passed) exists because collapsing "none resolve" into a fallback to locate mode
would silently widen an explicitly named hunt into a scope the maintainer never asked for — a named
hunt is supposed to stay fully explicit. The existing stop reason (`"no named session record resolved
— <n> named, 0 resolved"`) is `SKILL.md`'s own pre-existing behavior, unchanged by this seam's
introduction; the seam simply is never dispatched on that path, rather than being dispatched and then
discarding its own result.
