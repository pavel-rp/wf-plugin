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
   or more base64 characters (`[A-Za-z0-9+/=]`), that is not itself part of a normal path, hash
   label, or version string already present in the surrounding scope-resolution context.

## The marker

Every recognized match is replaced with the literal marker `[REDACTED]` — never a partial mask,
never a hash of the original value, and never the original length preserved (a length-preserving
mask itself leaks information about the secret's shape). The marker carries no reference back to
the original value; this skill locates and reads no session record, so a matched string always
originates from the prompt itself.

## What this does and does not guarantee

- **Does:** guarantee that a string matching one of the shapes above never reaches disk through
  this skill's own writes — the report file and any scratch file under the fixed `_local/scratch/`.
- **Does not:** guarantee that every secret is caught. A credential or token of an unrecognized
  shape is an accepted residual risk (charter risk table, spec Scope) — this skill ships no
  general-purpose secret scanner, only the shape list above.
- **Does not** apply to any file this skill does not itself write. It has no effect on source files,
  the task tracker, or any other pack.

## Applying it

Before any `Write` to the report file or a scratch file, run the text through every shape in order
and substitute `[REDACTED]` for each match, then write the substituted text. Apply this to every
value pulled from the prompt — the failure description, and any resolved skill/folder/repository
name — before it is echoed into the Scope section.
