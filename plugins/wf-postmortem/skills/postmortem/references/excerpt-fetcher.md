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
the reader's word for its own quote. This fetcher is the host's own bounded read primitive for that
second look, confined to exactly the byte span a locator names.

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

## The bounded read primitive

Every fetch is one of exactly two shapes, both single-quoted with every `'` in a caller-controlled
value replaced by `'\''` first — the same discipline `SKILL.md` Phase 1 already applies to
`--session`, `--folder`, and `--repo`. Neither shape is ever concatenated into a composed command
line, and neither ever passes a caller-controlled value to `Glob` as a pattern.

1. **Confirm the target exists** — `Bash`: `test -e '<path>'` (the top-level record, or the named
   subagent file). A locator whose path does not exist is **not found**; the confirmation step treats
   that side as failed and takes no further action for it.
2. **Fetch the excerpt:**
   - **Windowed locator** (`#L<start>-<end>` present) — `Bash`: `sed -n '<start>,<end>p' '<path>'`.
     The window is capped at **200 lines** before the fetch runs (`<end> - <start> + 1 <= 200`); a
     locator naming a wider window is clamped to the first 200 lines of its own span, not refused,
     since the excerpt ceiling below still bounds what actually reaches this skill's context.
   - **Whole-record locator with a search anchor** — the confirmation step supplies the anchor (the
     claimed mechanism text, or the reader's own quoted fragment). `Bash`:
     `grep -n -F -m1 -B20 -A20 -- '<anchor>' '<path>'`, single-quoted with the same escaping
     discipline. `-F` treats the anchor as a literal string, never a regular expression — a
     caller-controlled anchor is never interpreted as pattern syntax. `-m1` stops at the first match,
     and the fixed 20-line pad on each side keeps the search itself bounded rather than scanning the
     whole record for context. No match within that bounded search is an **excerpt not found**
     outcome — never a wider retry, and never a fall-through to reading more of the record.
3. **Apply the excerpt ceiling.** The fetched text — from either shape above — is truncated to
   **4,000 characters** before anything else touches it, with a trailing `… [truncated]` marker when
   truncation occurred. This is the fixed ceiling the confirmation step's excerpt is bounded by; it
   is deliberately smaller than the 200,000-character session-windowing budget (Phase 3.5 step 2),
   since this is a targeted excerpt around one locator, not a session-sized read.

**Subagent form.** `<session path>#subagent:<file>` and its windowed variant resolve against the
named subagent file directly — the same `<path>` substitution as the top-level form, just pointed at
the subagent record instead. No new directory listing is needed: the subagent file's own path is
already the locator's own literal value, never derived by pattern-matching a caller-supplied string.

## Redaction (mandatory, before this excerpt reaches the skill's own context)

**No fetched excerpt is used anywhere — not in the compose step's comparison, not in the report —
before it has passed through the redacting write path.** Obtain `redaction.md` the same way Phase 3
already does (`resolve_content({ workspaceRoot, ... })`, `class: references-template`, `plugin:
wf-postmortem`, `skill: postmortem`, `ref: redaction.md` — the same reference Phase 3 step 1 already
holds; do not re-fetch it if that reference is already in hand this run) and run the fetched text
through every recognized shape in order, substituting `[REDACTED]` for each match, exactly as Phase 4
already does for report content. This is not optional and not deferred to the write path alone: an
excerpt that never reaches disk (because the session side failed and the hypothesis stays a
hypothesis) still passed through this skill's own context on the way, so the same guarantee applies
there too.

## Outcomes

Every fetch resolves to exactly one of:

- **Fetched** — the target existed, the excerpt was produced (windowed or anchored), and it has been
  redacted. The confirmation step compares this text against the reader's reported observation.
- **Not found** — the target path does not exist, or (whole-record locator) the supplied anchor
  matched nothing within the bounded search. The confirmation step treats this as a failed
  session-side check for that hypothesis.
- **Read denied** — the host denies the read (the session store sits outside the workspace, exactly
  as Phase 3.5's own reader dispatches can meet a denied read). Treated the same as **not found** for
  the confirmation step's purposes — an isolated fetch primitive cannot answer a permission prompt any
  more than an isolated reader can, so a denial is a stated failure, never a hang and never a silent
  pass.

## What this does and does not guarantee

- **Does:** confine every fetch to the exact locator named, apply the same shape-based redaction
  every other write in this skill applies, and never read more than the bounded window or the bounded
  anchor search allows.
- **Does not:** locate, rank, or scope sessions — that stays outside this fetcher's job entirely
  (a later charter sub-task's seam). This fetcher only re-reads a path a hypothesis's locator already
  names.
- **Does not** replace the reader's own return block — it supplements it with a second, independent
  look the host takes itself, which is the entire reason two-sided confirmation re-checks rather than
  trusting the reader's quote alone.
