# postmortem continuation — authoring rationale

**Authoring-only — never read at runtime.** `continuation.md` states the operative `--report`
resolution and follow-up procedure inline (the behavior-bearing steps for Parts A–E); this document
is the paired rationale for *why* specific rules are shaped the way they are, kept out of the
runtime-read file per this repo's ops/reference split (`≤150 behavior-bearing lines` in the runtime
half; rationale here). A future edit to the operative procedure changes `continuation.md` first;
update this file to match, not the other way around.

## Why confinement gates the read

A resolved `--report` value is caller-controlled and, unconfined, would let this run overwrite any
file the process can reach once treated as a reuse target (Phase 4) — the confinement check, not the
content check that follows it (step 3), is what closes that. The directory-level canonicalization
already defeats a symlinked *directory* on the path (`cd` follows it and `pwd -P` reports the real
location), but it never dereferences the final **file** component, since nothing `cd`s into a file.
Without the separate `test -L` check, a `report.md` that is itself a symlink, sitting inside an
otherwise-legitimate `PM<n>__slug/` folder, would pass every structural check and then have step 3's
`Read` and Phase 4's overwrite silently follow it to whatever it targets. The identity recorded at
the end of step 2 gates step 3's `Read` and nothing else — it does *not* gate Phase 4's overwrite,
which happens phases later; Part E is what gates that, and Part E re-derives everything rather than
trusting anything recorded here beyond this one identity value, which exists only to be compared.

## Why size before read

The report is read unwindowed into this skill's own context, and its Continuation log grows by one
entry per follow-up without bound (Part D), so an old report is the one file in this pack that can
outgrow the reader. Measuring it first with the same metadata primitive `SKILL.md` Phase 3.5 step 2
uses on a session record, and applying the same ceiling, catches that before any bytes are read. This
is a hard stop rather than the windowed read a session record gets, because a report must be parsed
whole to be extended safely — half of one is worse than none.

## Why redact before comparing

The prior report's own Scope values were written only after the same redaction/markdown-neutralization
pass Phase 3 applies to a fresh run's inputs. Comparing a raw, unredacted value passed this run
against an already-redacted prior value would compare two different normalizations of what could be
the same input, and would misreport a conflict (or miss one). This redaction pass is idempotent, so
Phase 3 running it again later over the inherited value changes nothing.

## Why the cap exemption exists

Reassigning an already-Coverage'd session to `skipped (budget)` merely because the retry set's own
size (driven by an unrelated `--session` retry) pushed it past the cap boundary would discard evidence
this hunt has already paid for and already written down — and would do so behind a "Newly capped this
run" line indistinguishable from an ordinary first-time cap. The exemption is what keeps that
distinction visible: only a session with **no** entry in the prior report's Coverage may receive a
fresh `skipped (budget)` assignment past the cap. The Continuation entry format for an exempted retry
names both the cap and the fact that the prior entry survived, so the maintainer learns their retry
did not run rather than silently reading a stale row as fresh.

## Why replace-in-full rather than accumulate

Replacing the old Coverage row, observations, and counts wholesale — rather than merging or appending
— is what makes an explicit retry of an already-`read` session (or a first read of a session the cap
newly reaches) actually take effect, and what keeps a second, identical `--report --session <path>`
follow-up from re-accumulating that session's observations, counts, and Coverage row without bound.
The second run's fresh result still simply replaces the first's, never adds to it.

## Why the verdict-quality guard exists

A dispatch can fail for reasons that say nothing about the session itself — the verdict table
(`SKILL.md` Phase 3.5 step 4) lets any dispatched session come back `skipped (reader error: …)` or
`skipped (access denied)`, a retry included. Replacing a prior `read`/`read in part` entry with one
of those would erase real observations, real counts, and any Contributing Factor their hypotheses had
earned, on nothing better than a transient failure. Ranking this run's verdict against the one it
would overwrite is what prevents that: the point is that the Continuation log must always distinguish
"new evidence overturned the old" from "a retry failed and the old evidence survived" — "Sections
changed" alone cannot carry that distinction, which is exactly why the failure case gets its own
named line rather than an entry in that field.

## Why the log is unbounded

The Continuation log grows by exactly one entry per follow-up run and is never pruned, consolidated,
or capped, unlike every other report section (each fully recomputed, and so naturally bounded, on
every run). That asymmetry is deliberate: the log is the report's own audit trail, and an entry
records what a given run read, newly capped, lost to "cannot see," and changed — facts a later
recompute over the accumulated set cannot reconstruct, because the intermediate states are gone. A
maintainer who does not want a report's log to keep growing starts a fresh hunt without `--report`
rather than editing or trimming the log; no rollup rule ships in this release.

**What that remedy costs, stated plainly.** Starting a fresh hunt without `--report` starts a *new*
report: none of the accumulated Evidence Record, Contributing Factors, Coverage, or Continuation log
carries over, and this release ships no salvage, export, or rollup path to move any of it across. A
hunt that crosses the read-side ceiling therefore loses its accumulated continuity permanently,
through this pack's own tooling. That is the accepted product decision for this release — the
ceiling is a tail-scenario guard (a realistic Continuation entry runs a few hundred to ~2k
characters, so reaching it from the log alone implies on the order of a hundred follow-ups against
one report), and a bounded stop with total-continuity loss was judged better than an unbounded read
that degrades a follow-up's own context. It is recorded here as a known cost, not as a solved
problem.

## Why Part E re-verifies from scratch

Part A step 2's confinement check runs back in Phase 0.5. By the time Phase 4 reaches its write, the
whole of Phase 1 through Phase 3.5 has run in between — input resolution, redaction, the locator
dispatch, one `session-reader` dispatch per session or window, the two-sided check's excerpt fetches
— many tool calls and non-trivial real time. A check that old does not describe the file Phase 4 is
about to overwrite, so Phase 0.5's result is never carried over as if it still held: in that interval
the `report.md` could have been replaced by a symlink, or its parent folder swapped, and an overwrite
trusting the stale check would follow the new target wherever it points.

**The residual race, stated plainly.** This is a check-then-write shape, not an atomic one, and it is
worth being exact about what it does and does not buy. The tooling available to this skill exposes no
way to write through the very file descriptor the check validated — no `O_NOFOLLOW` open handed to
the writer, no `openat`-relative write, no atomic compare-and-replace — so a window remains between
Part E step 2's `stat` and the `Write` itself, in which a local actor holding write access to the
report's own parent directory could still swap the target. Part E's two steps narrow that window from
the full Phase 1–3.5 span to two consecutive tool calls, which is as narrow as these primitives
allow; they do not close it.

The guarantee this pack therefore offers is *"the write target was confined, non-symlinked, and the
same file this run read, as of immediately before the write"* — never *"the write cannot be
redirected."* Anyone who needs the stronger guarantee gets it from the filesystem, by not granting
write access to `{task-root}` and its report folders to anything but the maintainer running the hunt.
Should a future release gain a write primitive that accepts an already-validated descriptor, or an
atomic replace-if-unchanged, this section is what should be rewritten to use it, and this paragraph is
what should be deleted.
