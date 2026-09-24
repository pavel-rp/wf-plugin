# postmortem interim excerpt fetcher (provisional) — authoring reference

**Authoring-only — never fetched at runtime.** `SKILL.md` Phase 3.5 steps 5-6 already state the full
operative locator grammar, parse-and-validate gate, and dispatch procedure inline (the behavior-bearing
ops text); this document is the paired rationale — why the gate is shaped this way, and the fuller
picture of what the isolated `excerpt-fetcher` agent does with what it receives — kept out of the
runtime-read `SKILL.md` body per this repo's ops/reference split. A future edit to the gate or the
grammar changes `SKILL.md` first; update this file to match, not the other way around.

**This fetcher is explicitly provisional.** It stands in for the session-side "one access point" the
locator seam (`references/locator.md`, Phase 3.5 step 0) now owns for locating, ranking, and
attaching subagent records — this fetcher still owns only the bounded, redacted excerpt re-read a
confirmed hypothesis's locator needs. It will be replaced without changing the two-sided confirmation
logic's contract once a fuller access point lands — nothing that calls this fetcher needs to change,
only what answers the call.

## What this is for

The two-sided confirmation step (Phase 3.5 step 6) needs a **fresh, bounded, redacted excerpt** at a
hypothesis's session locator, to check that the excerpt actually shows the observation the reader
reported. A reader's own quoted excerpt (already in its return block) is not enough on its own — the
whole point of the host re-checking is that the host looks again, independently, rather than taking
the reader's word for its own quote. This document describes **two things**: the locator grammar the
skill and the fetcher agent share, and the **host-side validation gate** every locator passes through
before a fetch is ever dispatched. The bounded read itself, and the redaction pass over what it
returns, both run **inside the isolated `wf-postmortem:excerpt-fetcher` agent** (`agents/
excerpt-fetcher.md`) — never in the skill's own context, exactly like every other session read this
pack performs (`session-reader.md`). This mirrors `SKILL.md`'s own unchanged invariant: no byte of a
session record is ever read outside a dispatched agent.

## Locator grammar

Extends `session-reader.md`'s existing locator forms with an optional line-range window suffix:

| Form | Meaning |
|---|---|
| `<session path>` | The whole top-level record — no window named. |
| `<session path>#L<start>-<end>` | Lines `<start>` through `<end>` (1-based, inclusive) of the top-level record. |
| `<session path>#subagent:<file>` | The whole named subagent record. |
| `<session path>#subagent:<file>#L<start>-<end>` | Lines `<start>` through `<end>` of that subagent record. |

`<start>` and `<end>` are positive integers with `<start> <= <end>`. A locator with no `#L` suffix is
a **whole-record** locator; the confirmation step (Phase 3.5 step 6) always supplies a search anchor
alongside a whole-record locator, since fetching an entire record defeats the bound below.

## The host-side parse-and-validate gate (before any dispatch)

A hypothesis's `locator:` field is a compound string a reader produced from untrusted material — it
is **never** substituted into a path, and never handed to the fetcher agent as-is, on the strength of
the reader's say-so alone. Before dispatching `excerpt-fetcher`, the skill itself — never the agent —
parses the locator and resolves it to **the one real filesystem path** it names:

1. **Split** the locator on `#` into its path component and zero or more of a `subagent:<file>`
   segment and an `L<start>-<end>` segment (Phase 3.5 step 6).
2. **Resolve the real path, by allow-list, never by trusting the string.** No `subagent:` segment →
   the real path is the session's own already-resolved path — **from `--session` on a named run, or
   the locator's own return on a located run** (Phase 3.5 step 0, via `references/locator.md`), the
   same two sources `version-resolution.md` step 6 names; the locator's path component must be
   **character-for-character identical** to it. A
   `subagent:<file>` segment → the real path is whichever entry in this session's own discovered
   subagent-record paths (Phase 3.5 step 0, via `references/locator.md`) has `<file>` as its filename;
   no such entry fails validation. This is the same discipline
   the redaction reference's long-hex/base64 exemption already uses ("exempt only when
   character-for-character identical to a value this run already resolved") applied to a locator
   instead of a redaction exemption — and it is what lets a `subagent:<file>` locator resolve to a
   real path at all, rather than the literal (nonexistent) compound string.
3. **Window integers.** When an `L<start>-<end>` segment is present, both `<start>` and `<end>` must
   match `^[1-9][0-9]*$` (a positive integer — `0` excluded, since line numbers are 1-based) and
   satisfy `<start> <= <end>`. Anything else — a non-numeric value, a bare `0`, an inverted range —
   fails validation.

**A locator that fails any of these is malformed.** The skill dispatches nothing for it; the
hypothesis's session side is recorded as failed for that reason, exactly like `not found` from the
fetcher itself (Phase 3.5 step 6). This is a mechanical gate, not a judgment call — it runs the same
way for every locator, every hypothesis, every run — and it is also what makes the dispatch below
safe: the agent never receives a locator string, only the one path and window/anchor this gate
already resolved.

## What runs inside the isolated fetcher

Once a locator passes the gate above, the skill routes and dispatches `wf-postmortem:excerpt-fetcher`
(`agents/excerpt-fetcher.md`) exactly as it dispatches `session-reader` — its own `resolve_routing`
call (with `toolWork: "bounded"`, `validation: "mechanical"` and `returnContract:
"mechanically-judgeable"`, since a single bounded `test`/`sed`/`grep` call and a redaction pass is not
the open-ended judgment call a session hunt is), its own Task invocation, one
dispatch per hypothesis locator — passing the **resolved real path**, the parsed `window` (when
present), and, only when there is no window, the search anchor. Inside that agent's own isolated
context, and only there:

1. **Confirm the target exists, is readable, and is still fully non-symlinked** — `Bash`: `test -e
   '<path>'`, single-quoted with every `'` in the value replaced by `'\''` first. Does not exist →
   **not found**. Otherwise, three re-checks against the time that has passed since the caller
   validated this path at locate time: a **readability check** (`Bash`: `test -r '<path>'` must
   succeed — this is what makes a later nonzero fetch-command exit code trustworthy as a genuine,
   unexpected failure rather than an ordinary permissions gap this check should have caught first), a
   **leaf check** (`Bash`: `test -L '<path>'` must fail), and an **ancestor-containment check**
   (`Bash`: `(cd "$(dirname '<path>')" && pwd -P)`, same escaping, joined with the path's own basename
   and compared character-for-character against `<path>` as given — a mismatch means an ancestor
   directory became a symlink since locate time, which the leaf check alone cannot catch). Any failing
   → **read denied**, the same outcome as any other denied read.
2. **Fetch the excerpt, bounded by both lines and raw bytes.** Every fetch command is piped through
   `head -c 16000` before its output is used for anything else — a raw, pre-redaction byte ceiling on
   the byte stream as a whole (4x the 4,000-character post-redaction ceiling in step 4), independent of
   and applied strictly before both step 3's redaction pass and step 4's truncation. This bounds a
   single pathologically oversized line (e.g. a JSONL tool-result payload) long before it fully enters
   context — it is **not** a guarantee that an ordinary 200-line window or ~41-line `grep` context
   always fits under it (200 lines at 100-120 chars/line alone can run 20,000-24,000 bytes), and a
   legitimate window may itself be bytewise-clipped by this ceiling too; that is an accepted,
   non-harmful side effect, since steps 3-4 still apply to whatever survives either way. Piping through
   `head` collapses the upstream command's own exit status to `head`'s (always ~0 on empty input), so
   each fetch command ends by exiting with the upstream command's own captured status
   (`exit "${PIPESTATUS[0]}"`) rather than trusting the piped exit code — because each fetch runs as its
   own process, this makes that captured status the dispatch's own observed exit code. **The observed
   code is interpreted, never treated as a bare pass/fail:** `0` (completed without the ceiling
   engaging) and `141` (`SIGPIPE` — `head` had already read its 16,000 bytes and closed the pipe,
   killing the still-writing upstream command mid-output) **both mean the fetch succeeded** — `141` is
   the ceiling doing exactly its intended job on a large fetch, never a failure. Step 1's readability
   check already rules out "can't be opened," so any other nonzero code is a genuine, unexpected
   failure.
   - **`window` given** — `Bash`: `sed -n '<start>,<end>p' '<path>' | head -c 16000; exit
     "${PIPESTATUS[0]}"`, clamped to **200 lines** before the fetch runs — a window naming a wider span
     is clamped to its own first 200 lines, not refused, since both the byte ceiling above and the
     excerpt ceiling below still bound what the fetcher returns.
   - **No window, a search anchor given** — `Bash`: `grep -n -F -m1 -B20 -A20 -- '<anchor>' '<path>' |
     head -c 16000; exit "${PIPESTATUS[0]}"`, the anchor single-quoted the same way. `-F` treats it as a
     literal string, never a regular expression. `0` or `141` (a match found, context possibly cut by
     the ceiling — the match itself still stands) → fetched. An observed exit code of `1` (`grep`'s own
     "no match" code) within that bounded search → **not found** — never a wider retry. **A redacted
     anchor (one containing `[REDACTED]`) can never match raw text** — a stated, accepted limitation of
     this interim fetcher, not a silent misclassification: the resulting `not found` is the honest
     outcome, since the anchor genuinely cannot appear literally in unredacted material.
   - A denied read is any exit code that is nonzero and **neither `141` (the ceiling's own SIGPIPE)
     nor `grep`'s own `1` ("no match")** → **read denied**. `141` is never treated as a denied read.
3. **Redact first, before any truncation.** The agent obtains `redaction.md` itself (the same
   reference the skill's own write path uses) and runs the **entire fetched excerpt** through every
   recognized shape, substituting `[REDACTED]` for each match — **before** truncation (step 4), and
   before it returns anything. This order matters: a credential- or token-shaped run straddling a
   later truncation cut would have its second half removed before the shape list ever saw it, letting
   the truncated first half of a real secret survive unredacted — redacting the whole excerpt first
   closes that gap. (`Path` redaction is a separate, unconditional step — step 5 below, its sole owner
   — never repeated here.)

   **Boundary-truncation guard, scoped to when the ceiling actually engaged.** Because the byte ceiling
   in step 2 can itself cut a token/hex/base64/JWT run mid-pattern, the agent first checks the fetched
   excerpt's raw, pre-redaction byte length: only when it is **exactly 16,000 bytes** (the ceiling
   engaged) does it additionally redact any trailing run of 16+ characters from `[A-Za-z0-9+/=_.-]`
   (rules 3-4's own classes, plus `.` for rule 2's JWT segment-joining character) reaching the exact
   final character of the excerpt, even below the matching rule's own length threshold — a shorter,
   un-truncated fetch never triggers this guard, which is what stops it from over-redacting an
   ordinary excerpt's incidental trailing hash-shaped identifier or filename. This closes the boundary
   gap for rules 2-4; **rule 1 (Bearer tokens) is a stated, accepted residual risk at this boundary**,
   the same category `redaction.md` already accepts for shapes outside its own list — widening the
   guard to Bearer's unrestricted-non-whitespace alphabet would trade a narrow truncation-boundary gap
   for routine over-redaction of ordinary trailing text.
4. **Truncate the already-redacted text to the excerpt ceiling.** Cut it to **4,000 characters**, with
   a trailing `… [truncated]` marker when truncation occurred — deliberately smaller than the
   200,000-character session-windowing budget (Phase 3.5 step 2), since this is a targeted excerpt
   around one locator, not a session-sized read. Truncating after redaction can only ever cut
   `[REDACTED]` markers or ordinary text, never a live secret shape.
5. **Redact `Path` — the sole place this ever runs, on every verdict — then emit the Output block.**
   Whatever outcome the dispatch reached — `fetched` after step 4, or `not found`/`read denied` from
   steps 1-2's short-circuits, which never reach step 3 — the agent runs the `Path` value (the exact
   `path` field its prompt carried) through the same shape list, before the Output block is emitted.
   The Output block always echoes `Path` on every verdict, so this is independent of whether the
   excerpt itself was ever fetched. `Path` keeps rule 4's resolved-path exemption: the comparison is
   over the entire `Path` value against the entire `path` field, verbatim — never a substring scan —
   so an exact, whole-value match against rule 4's long-hex/base64 shape stays exempt and echoes
   unredacted, while rules 1-3 carry no such exemption and still redact a genuine match inside the
   path. Step 3's boundary-truncation guard never applies here, since step 2's byte ceiling never
   touches the `path` field itself. The skill's own write path (Phase 4) still applies the same
   redaction again as the disk backstop, but the excerpt and the path are never unredacted at any point
   the skill's own context can see them.

The agent returns one compact `EXCERPT FETCH` block (`agents/excerpt-fetcher.md`'s Output section) —
the redacted `Path` (step 5, every verdict — with one stated exception below), `Model`, `Verdict`
(`fetched | not found | read denied | error: <reason>`), and the redacted `Excerpt` text. Read this
result defensively exactly as Phase 3.5 step 3 reads a reader's result: no parseable block back is a
session-side failure, never a silent pass.

**One stated exception to `Path` redaction.** The agent's own Prerequisites step obtains the shape
list before doing anything else; if that resolution fails, the agent stops and returns the `error`
outcome with no shape list ever in hand — so that one branch echoes `Path` **unredacted**, since there
is nothing to run it through. This is an accepted, narrow gap on the Prerequisites-failure path only,
never on `fetched`/`not found`/`read denied`, all of which reach step 5 with the shape list already
held.

## Outcomes, as the confirmation step sees them

- **Fetched** — the skill compares the returned, already-redacted excerpt text against the reader's
  reported observation.
- **Not found**, **read denied**, or **malformed** (failed the host-side parse-and-validate gate
  before dispatch) — the session side has failed for that hypothesis; it is not promoted this run.

## What this does and does not guarantee

- **Does:** parse and resolve every locator to a path the skill has independently discovered this
  run, run the bounded read and its redaction entirely inside an isolated agent — the agent itself
  never parses a locator or sees the compound string — and never read more than the bounded window or
  the bounded anchor search allows.
- **Does not:** locate, rank, or scope sessions — that stays outside this fetcher's job entirely and
  belongs to the locate seam (`references/locator.md`). This fetcher only re-reads a path a
  hypothesis's locator already names, once the host has resolved and confirmed that path is one this
  run already discovered — from `--session` on a named run, from the locator's own return on a located
  run, or from that same dispatch's discovered subagent-record paths.
- **Does not** replace the reader's own return block — it supplements it with a second, independent
  look the host takes itself, which is the entire reason two-sided confirmation re-checks rather than
  trusting the reader's quote alone.
- **Does not** guarantee a match when the search anchor is itself redacted text — an accepted,
  stated limitation of this interim fetcher (above). **The locate seam (`references/locator.md`) does
  not lift it:** that seam owns where records live, their shape, and their countable structural
  fields, not excerpt retrieval, so the limitation stands until anchor-text search is itself replaced
  by a real locator lookup.
