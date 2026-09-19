# postmortem redacting write path

Runtime-read only from the write path (Phase 3 of `SKILL.md`) — never read at boot. Every report
write and every scratch write this skill performs routes through this one path before anything
reaches disk. The guarantee is **shape-based**: a string matching a recognized credential- or
token-shape is replaced with a redaction marker before the write; a secret of an unrecognized shape
is an **accepted residual risk**, not a defect (spec Scope, charter risk table).

## Recognized shapes

Applied in this order over the text about to be written, each match replaced independently:

1. **Bearer tokens** — `Bearer <token>` (case-insensitive `Bearer`, one or more non-whitespace
   characters following).
2. **Three-segment JWTs** — three base64url segments joined by two `.` characters, each segment at
   least 8 characters.
3. **Common cloud access-key prefixes** — a token beginning `AKIA`, `ASIA`, `AIza`, `ghp_`, `gho_`,
   `ghs_`, `github_pat_`, `sk-`, or `xox[baprs]-`, followed by 16 or more alphanumeric/`-`/`_`
   characters.
4. **Long high-entropy hex or base64 runs** — a contiguous run of 32 or more hex characters, or 40
   or more base64 characters (`[A-Za-z0-9+/=]`). This rule carries exactly one exemption, and it is
   mechanical, not a judgment call: the run is exempt only when it is **character-for-character
   identical** to a value this run already resolved from the filesystem — a resolved `--folder` or
   `--repo` path segment; a session's own resolved path, **from `--session` on a named run or from the
   locator's own return on a located run**; or a subagent-record path the locate seam (Phase 3.5 step
   0, via `references/locator.md`) discovered for a session. Both session-path sources are named
   deliberately, and neither is an
   afterthought: a session record's own filename (top-level or subagent) is frequently a long hex or
   base64-shaped identifier, and without the exemption the shape rule would redact a resolved record
   path out of the report's own Scope and Coverage lines — destroying the locator the report exists
   to carry. The exemption stays keyed on an exact match against a path this run actually resolved,
   so an unresolved name never earns it. Anything else matching the shape is redacted, even when it
   looks like a commit hash or a version string — over-redacting a hash costs a reader nothing, while
   judging a secret exempt because it resembles one is the failure this rule exists to prevent.

## The marker

Every recognized match is replaced with the literal marker `[REDACTED]` — never a partial mask,
never a hash of the original value, and never the original length preserved (a length-preserving
mask itself leaks information about the secret's shape). The marker carries no reference back to
the original value. A matched string reaching this write path originates either from the CLI prompt
(this skill's own context never reads a session record directly) or from a dispatched
`session-reader`/`excerpt-fetcher` return block, both already passed through their own
credential-shape redaction before this write path's second pass ever sees them (`SKILL.md` Phase 4).

## What this does and does not guarantee

- **Does:** guarantee that a string matching one of the shapes above never reaches disk through
  this skill's own writes — the report file and any scratch file under the fixed, literal
  `_local/scratch/`.
- **Does not:** guarantee that every secret is caught. A credential or token of an unrecognized
  shape is an accepted residual risk (charter risk table, spec Scope) — this skill ships no
  general-purpose secret scanner, only the shape list above.
- **Does not** apply to any file this skill does not itself write. It has no effect on source files,
  the task tracker, or any other pack.

## Applying it

Before any `Write` to the report file or a scratch file, run the text through every shape in order
and substitute `[REDACTED]` for each match, then write the substituted text. Apply this to every
value pulled from the prompt — the failure description, any resolved skill/folder/repository name,
every named session record path (resolved or unresolved), and a `--cap` override value — before it
is echoed into the Scope section, and before any of it is used in a folder or file name. Apply it
also to every field composed from a `session-reader`/`excerpt-fetcher` return block (observations,
hypothesis/mechanism text, attachment notes) before Phase 4 writes them into the report.

**Fallback-evidence-sourced text is covered the same way, before it ever reaches Evidence Record,
Hypotheses, or Coverage** (`coverage-cross-check.md`): a matched task folder's own artifact excerpts,
any text read from `_local/fleet/scoreboard.md`, text read from a project-configured eval-log source,
and the matched delivery entry's own commit/PR text — plus the "Runs with no session record" Coverage
line's **full text**, both its leading `<task folder path | delivery entry id>` identifier and its
key-attempted string, since both are mechanically extracted from the same untrusted candidate sources
(a task-folder directory name, or an id/subject drawn from delivery-entry text) and land in the
written report exactly like any other fallback-sourced value. Each passes through this same shape
list, substituted the same way, before it is labelled `fallback evidence` (Evidence Record/Hypotheses)
or written as a Coverage line — this write path draws no distinction between a reader's return block
and a fallback or cross-check source once the text is in hand.

Redaction defends against credential shapes only. Neutralizing markdown structure in the same text
(newlines and backticks collapsed to spaces, the entire leading run of `#` characters stripped —
`^#+`, not a single one — so the text can forge neither a heading nor a fenced block) is a separate,
mandatory step that runs after this one: `SKILL.md` Phase 3 step 2 owns it for every value pulled from
the prompt, and Phase 4 step 2 owns it for every field composed from a `session-reader`/
`excerpt-fetcher` return block **or from the coverage cross-check** — fallback-evidence entries and the
full "Runs with no session record" Coverage line text (leading identifier and key-attempted string
both) — the same full scope this section's own fallback-evidence paragraph now names for the
credential-shape pass above; the two passes cover identical ground, deliberately, so they cannot drift
apart again.
