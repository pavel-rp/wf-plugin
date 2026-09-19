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
   the real path is the session's own already-resolved path (from `--session`, or the locator's own
   return); the locator's path component must be **character-for-character identical** to it. A
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

1. **Confirm the target exists** — `Bash`: `test -e '<path>'`, single-quoted with every `'` in the
   value replaced by `'\''` first. Does not exist → **not found**.
2. **Fetch the excerpt:**
   - **`window` given** — `Bash`: `sed -n '<start>,<end>p' '<path>'`, clamped to **200 lines** before
     the fetch runs — a window naming a wider span is clamped to its own first 200 lines, not refused,
     since the excerpt ceiling below still bounds what the fetcher returns.
   - **No window, a search anchor given** — `Bash`: `grep -n -F -m1 -B20 -A20 -- '<anchor>' '<path>'`,
     the anchor single-quoted the same way. `-F` treats it as a literal string, never a regular
     expression. No match within that bounded search → **not found** — never a wider retry. **A
     redacted anchor (one containing `[REDACTED]`) can never match raw text** — a stated, accepted
     limitation of this interim fetcher, not a silent misclassification: the resulting `not found` is
     the honest outcome, since the anchor genuinely cannot appear literally in unredacted material.
   - A denied read at either step → **read denied**.
3. **Redact first, before any truncation.** The agent obtains `redaction.md` itself (the same
   reference the skill's own write path uses) and runs the **entire fetched excerpt** through every
   recognized shape, substituting `[REDACTED]` for each match — **before** truncation (step 4), and
   before it returns anything. This order matters: a credential- or token-shaped run straddling a
   later truncation cut would have its second half removed before the shape list ever saw it, letting
   the truncated first half of a real secret survive unredacted — redacting the whole excerpt first
   closes that gap. The skill's own write path (Phase 4) still applies the same redaction again as the
   disk backstop, but the excerpt is never unredacted at any point the skill's own context can see it.
4. **Truncate the already-redacted text to the excerpt ceiling.** Cut it to **4,000 characters**, with
   a trailing `… [truncated]` marker when truncation occurred — deliberately smaller than the
   200,000-character session-windowing budget (Phase 3.5 step 2), since this is a targeted excerpt
   around one locator, not a session-sized read. Truncating after redaction can only ever cut
   `[REDACTED]` markers or ordinary text, never a live secret shape.

The agent returns one compact `EXCERPT FETCH` block (`agents/excerpt-fetcher.md`'s Output section) —
`Path`, `Model`, `Verdict` (`fetched | not found | read denied | error: <reason>`), and the redacted
`Excerpt` text. Read this result defensively exactly as Phase 3.5 step 3 reads a reader's result: no
parseable block back is a session-side failure, never a silent pass.

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
- **Does not:** locate, rank, or scope sessions — that stays outside this fetcher's job entirely
  (a later charter sub-task's seam). This fetcher only re-reads a path a hypothesis's locator already
  names, once the host has resolved and confirmed that path is one this run already discovered.
- **Does not** replace the reader's own return block — it supplements it with a second, independent
  look the host takes itself, which is the entire reason two-sided confirmation re-checks rather than
  trusting the reader's quote alone.
- **Does not** guarantee a match when the search anchor is itself redacted text — an accepted,
  stated limitation of this interim fetcher (above), resolved only once SUB-2's own access point
  replaces anchor-text search with a real locator lookup.
