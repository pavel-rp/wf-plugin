# postmortem interim excerpt fetcher (provisional)

Runtime-read only from the compose step (Phase 3.5 step 6 of `SKILL.md`) — never read at boot.
**This fetcher is explicitly provisional.** It stands in for the session-side "one access point" a
later charter sub-task (SUB-2) owns, exactly as Phase 3.5 step 1's sibling-directory rule stands in
for that same sub-task's real record layout. It will be replaced without changing the two-sided
confirmation logic's contract once that access point lands — nothing that calls this fetcher needs
to change, only what answers the call.

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

## The host-side validation gate (before any dispatch)

A hypothesis's `locator:` field is text a reader produced from untrusted material — it is **never**
substituted into a path on the strength of the reader's say-so alone. Before dispatching
`excerpt-fetcher`, the skill validates the locator itself:

1. **Path allow-list.** The locator's path component must be **character-for-character identical**
   to the session's own already-resolved path (from `--session`), or to one of the subagent-record
   paths Phase 3.5 step 1 already discovered for that same session. Any other path — one a reader
   merely mentioned, or one shaped like a path but never independently resolved this run — fails
   validation. This is the same discipline the redaction reference's long-hex/base64 exemption
   already uses ("exempt only when character-for-character identical to a value this run already
   resolved") applied to a locator instead of a redaction exemption.
2. **Window integers.** When a `#L<start>-<end>` suffix is present, both `<start>` and `<end>` must
   match `^[0-9]+$` and satisfy `<start> <= <end>`. Anything else — a non-numeric value, a negative
   number spelled with a leading `-` that collides with the suffix's own `-` separator, an inverted
   range — fails validation.

**A locator that fails either check is malformed.** The skill dispatches nothing for it; the
hypothesis's session side is recorded as failed for that reason, exactly like `not found` from the
fetcher itself (Phase 3.5 step 6). This is a mechanical gate, not a judgment call — it runs the same
way for every locator, every hypothesis, every run.

## What runs inside the isolated fetcher

Once a locator passes the gate above, the skill routes and dispatches `wf-postmortem:excerpt-fetcher`
(`agents/excerpt-fetcher.md`) exactly as it dispatches `session-reader` — its own `resolve_routing`
call, its own Task invocation, one dispatch per hypothesis locator. Inside that agent's own isolated
context, and only there:

1. **Confirm the target exists** — `Bash`: `test -e '<path>'`, single-quoted with every `'` in the
   value replaced by `'\''` first. Does not exist → **not found**.
2. **Fetch the excerpt:**
   - **Windowed locator** — `Bash`: `sed -n '<start>,<end>p' '<path>'`, clamped to **200 lines**
     before the fetch runs — a locator naming a wider window is clamped to its own first 200 lines,
     not refused, since the excerpt ceiling below still bounds what the fetcher returns.
   - **Whole-record locator with a search anchor** — `Bash`: `grep -n -F -m1 -B20 -A20 -- '<anchor>'
     '<path>'`, the anchor single-quoted the same way. `-F` treats it as a literal string, never a
     regular expression. No match within that bounded search → **not found** — never a wider retry.
   - A denied read at either step → **read denied**.
3. **Apply the excerpt ceiling.** The fetched text is truncated to **4,000 characters**, with a
   trailing `… [truncated]` marker when truncation occurred — deliberately smaller than the
   200,000-character session-windowing budget (Phase 3.5 step 2), since this is a targeted excerpt
   around one locator, not a session-sized read.
4. **Redact before the block leaves the agent's context.** The agent obtains `redaction.md` itself
   (the same reference the skill's own write path uses) and runs the entire excerpt through every
   recognized shape, substituting `[REDACTED]` for each match — **before** it returns anything. The
   skill's own write path (Phase 4) still applies the same redaction again as the disk backstop, but
   the excerpt is never unredacted at any point the skill's own context can see it.

The agent returns one compact `EXCERPT FETCH` block (`agents/excerpt-fetcher.md`'s Output section) —
`Locator`, `Model`, `Outcome` (`fetched | not found | read denied | error: <reason>`), and the
redacted `Excerpt` text. Read this result defensively exactly as Phase 3.5 step 3 reads a reader's
result: no parseable block back is a session-side failure, never a silent pass.

## Outcomes, as the confirmation step sees them

- **Fetched** — the skill compares the returned, already-redacted excerpt text against the reader's
  reported observation.
- **Not found**, **read denied**, or **malformed** (failed the host-side gate before dispatch) — the
  session side has failed for that hypothesis; it is not promoted this run.

## What this does and does not guarantee

- **Does:** confine every fetch to a locator the skill has independently validated, run the bounded
  read and its redaction entirely inside an isolated agent, and never read more than the bounded
  window or the bounded anchor search allows.
- **Does not:** locate, rank, or scope sessions — that stays outside this fetcher's job entirely
  (a later charter sub-task's seam). This fetcher only re-reads a path a hypothesis's locator already
  names, once the host has confirmed that path is one this run already resolved.
- **Does not** replace the reader's own return block — it supplements it with a second, independent
  look the host takes itself, which is the entire reason two-sided confirmation re-checks rather than
  trusting the reader's quote alone.
