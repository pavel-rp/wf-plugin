# postmortem reader dispatch, windowing and merge — authoring rationale (WF-610)

**Authoring-only — never read at runtime.** `SKILL.md` Phase 3.5 (steps 2, 2.5, 3, 4),
`agents/session-reader.md`, and `references/version-resolution.md`'s `excerpt-fetcher` routing call
state the operative procedures inline (the behavior-bearing text); this document is the paired
rationale for *why* each is shaped the way it is, kept out of the runtime-read files per this repo's
ops/reference split. A future edit to any of those procedures changes the runtime file first; update
this document to match, not the other way around.

This rationale covers six consolidated findings (Linear WF-610/611/612/613/614/636, filed under
charter WF-587) found in a post-merge review sweep of PR 326 and reconfirmed against current source
before this fix.

## 1. Byte-denominated windowing, host-computed offsets only (WF-610)

**The problem.** `SKILL.md`'s Safety Rules forbid reading raw session content in the host's own
context — the host may only run `wc -c` (a byte count) as metadata. But the prior windowing text
required the host to "cut on line boundaries" and pass a concrete window span to the reader — an
operation no permitted primitive can produce, since finding a line boundary requires reading bytes.
Separately, the oversize threshold was stated as "200,000 characters" while the only measurement tool
available (`wc -c`) counts bytes — a silent unit mismatch for any multi-byte (non-ASCII) content.

**The fix.** Two independent moves close both gaps at once: (a) restate the threshold in bytes, so it
matches what `wc -c` actually measures — no conversion, no mismatch, and the number itself (200,000)
is unchanged since it was always being compared against a byte count in practice; (b) narrow what the
host computes to an **approximate** byte-offset range — pure arithmetic over the total byte count
(equal-sized splits, last window absorbing the remainder), never a read. The actual line-boundary snap
moves to the dispatched `session-reader`, which already holds legitimate `Read` access to the file (its
whole reason for existing is to read it) — extending its start back to the character after the
previous newline and its end forward to the next newline is not a new right, just relocating where the
already-necessary computation legally happens. This is the general shape of the fix the PR-326 review
comment asked for: "no permitted operation produces those boundaries" is resolved by moving the
boundary-sensitive step to the one component for which reading is already permitted, not by inventing
a new host-side primitive that would still amount to a disguised content read.

## 2. UnitId slug: a fixed-length hex digest, not an undefined "slug of the path" (WF-611)

**The problem.** Both `session-reader:<slug of the resolved path>` (`SKILL.md` step 3) and
`excerpt-fetcher:<slug of the hypothesis's locator>` (`version-resolution.md`) left "slug" undefined.
A resolved session path is an arbitrary absolute filesystem path — unbounded length, any Unicode
codepoint, spaces, and symbols outside the resolver's `unitIds` grammar
(`^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$`, 128-character bound). A naive slug (lowercase-and-hyphenate,
or truncate-and-hope) risks three independent failures: an invalid character reaching the resolver
call (a hard schema rejection), the 128-character bound being exceeded once the `:window-<n>` suffix
is appended to an already-long path, and two distinct long paths colliding after truncation to the
same prefix (loss of "stable, collision-resistant" from the finding's own acceptance wording).

**The fix.** A fixed-length hex digest — the first 16 hex characters of the SHA-256 digest of the
resolved absolute path — satisfies all three at once: the output alphabet (`0-9a-f`) is a strict
subset of the grammar's allowed characters, the length is fixed regardless of input length (so the
total `session-reader:<16 hex>:window-<n>` is always well under 128 characters, budget to spare for
even a double-digit window count), and a cryptographic digest is collision-resistant for any
practically-reachable set of session paths in one run. 16 hex characters (64 bits of digest) is chosen
deliberately over a shorter prefix: it is short enough to leave generous room under the 128-character
bound even with a long `session-reader:`/`excerpt-fetcher:` prefix and a `:window-<n>` suffix, while
being long enough that a collision within one run's session set is not a realistic concern — this pack
dispatches at most one reader per session or window per run, never a namespace large enough to make a
64-bit collision a practical risk. The same rule applies to `excerpt-fetcher:<slug>` for consistency:
it is the identical construction over the hypothesis's one resolved real path (never the compound
`locator:` string, which `version-resolution.md`'s own "never the compound locator string itself" rule
already established for a different reason — this fix does not relax that rule, it reuses the same
resolved-path input the existing rule already names).

**Making the digest executable (WF-729).** Mandating SHA-256 was not enough on its own: the Safety
Rules' Allowed list named no operation that computes one, so a host following the list literally
could not derive the UnitId it was required to pass. `SKILL.md` now authorizes exactly one **UnitId
digest primitive**, defined once in the runtime-read `unitid-digest.md` (kept out of `SKILL.md`,
whose body sits at its 500-line budget) and shared verbatim by both dispatch paths. Its shape answers
four constraints:

- *The path is data, never code.* A resolved session path can contain spaces, quotes, `$(...)`,
  backticks, `;` — anything a filesystem admits. Every shell-quoting scheme for interpolating it into
  a command line (`printf '%s' '<path>' | sha256sum`) breaks on some input (a single quote ends a
  single-quoted string), and a broken quote is an injection, not merely a wrong digest. The primitive
  therefore never puts the path on a command line at all: the `Write` tool (no shell) puts the exact
  string in a file, and the only shell commands run name a file whose name is a fixed prefix plus
  `mktemp`'s validated alphanumeric suffix — no shell-significant character. Hashing a file hashes its
  bytes, whatever those bytes are.
- *Exclusive and unplanted (PR 381 review).* A single fixed file name was shared by every postmortem
  invocation in a workspace: two concurrent runs could hash each other's preimage, and a pre-existing
  symlink at that name would redirect the `Write`. `mktemp -d` gives each digest a fresh, owner-only
  directory that the call itself created and that no other invocation can reuse, after a preflight
  that the scratch root is a real directory and not a symlink; the leaf is re-checked with `test -L`
  before hashing.
- *One encoding rule, so identical paths give identical digests.* UTF-8, the exact characters, no
  trailing newline. A trailing newline would silently fork the digest between callers that add one
  and callers that do not; stating "no trailing newline" once, in the one definition both paths name,
  is what makes the reader and excerpt digests of the same path equal.
- *No session content, no residue.* The preimage is the path string the run already holds, never a
  byte of the record it names, so the "no raw session content in the host" rule is untouched. It is
  the one scratch write exempt from the redacting write path — stated in `redaction.md` itself, not
  only at the call site, so a literal reader of that contract does not redact a hex-shaped path
  segment and silently change the digest. It is deleted by its own consumer in the same step
  (constitution core.9 (a)), and deletion is *confirmed*: if the preimage or its directory survives,
  the digest is discarded, no further digest is derived that run, and the residual directory is named
  in the unit's recorded reason — a path left on disk is never traded for a dispatch. The format
  check (`^[0-9a-f]{64}$`) turns a failed or foreign `sha256sum` output into a clean non-dispatch
  rather than an invalid UnitId reaching `resolve_routing`.

## 3. Reaching the resolver's cheap tier without a core-side special case (WF-612)

**The problem.** The pack's own plugin manifest states the design intent plainly: each session is
"read by its own isolated reader agent on a cheaper model tier." But `resolve_routing`'s shipped
complexity-derived model selection — the mechanism that would otherwise pick a cheap tier
automatically — is documented as applying only to `phase-runner`, `finalize`, and `shipper`, not
`session-reader`. The pack's routing call passed no other selector, so with no per-project `##
Routing` row for `session-reader` (the shipped `_local/config.md` template's Routing table starts
empty), resolution fell through to plain inheritance from the host — silently defeating the pack's own
stated design, with no error and no visible symptom short of an unexpectedly expensive run.

**The fix, and why it does not touch core.** Two mechanisms were considered and rejected before
settling on this one. Rejected: teach `resolve_routing` a `session-reader`-named complexity-derived
default, matching the `phase-runner`/`finalize`/`shipper` precedent — rejected because it would put a
`wf-postmortem`-specific role name inside `plugins/wf/mcp/`, violating this repo's core rule that core
names zero stack/domain/project nouns (`CLAUDE.md` §1), and because it is exactly "blindly adding a
pack-specific special case" the finding's own acceptance wording rules out. Rejected: have
`/wf-postmortem:init` seed a `## Routing` row for `session-reader` into `_local/config.md` — rejected
because `init`'s own Safety Rules explicitly forbid it from writing `_local/config.md` at all (it is a
compatibility alias onto `/wf:init`'s canonical lifecycle and "performs no write at all"), and because
a seeded row would be a *default* masquerading as a *project choice*, contradicting the Routing table's
own documented contract that it "starts empty" by design. Accepted: pass `invocationModel: "haiku"`
directly on the `resolve_routing` call — an ordinary, already-generic parameter every caller may pass,
sitting in the resolver's own documented precedence chain (host enforcement → invocation override →
project table → shipped role default → complexity-derived selection → inheritance) one tier above the
project table and two above the shipped-default list this role isn't on. This is not a pin: the
resolver, not the pack, still makes the final call — host enforcement still outranks it (a host-pinned
model wins and the record reports the request as `masked`), and if the selector is malformed,
unavailable, or unsupported on a given edge, `resolve_routing`'s own documented fallback (inheritance,
recorded honestly rather than claimed) still applies. What it does **not** leave room for is a project
`## Routing` row overriding it: the invocation override sits *above* the project table, so the
resolver takes the invocation value first (`plugins/wf/mcp/src/resolver/routing.ts` — `requested =
invocation ?? configured ?? shipped ?? …`, `requestedSource: "invocation"`). Worked example (WF-730):
with no host pin, `invocationModel: "haiku"` plus a project row `session-reader | sonnet` resolves to
`haiku`, `source: invocation`; the project row applies only to a call that passes no invocation
override. A project that wants a different reader tier therefore needs this pack's call to change,
not a Routing row — this document records that consequence rather than choosing a new policy. "The tier comes from `resolve_routing`" — the
pack's own Forbidden-list invariant — remains true; only what the pack *asks for* changed, using a
lever the resolver already exposes to every caller.

## 4. One subagent attachment, one window (WF-613)

**The problem.** Step 0 (locate/attach) resolves a session's subagent-record attachments once, at
locate time — correctly, since they belong to the session, not to any one window of it. But step 3's
dispatch passed those same attached paths to **every** window's `session-reader` Task unconditionally,
and step 4's merge concatenated every window's observation set without deduplication. A session split
into N windows for size reasons alone (not because the subagent record itself was large) would have
its shared subagent record read and reported N times — multiplying that attachment's
observations, hypotheses, and reader-counted metrics by the window count, a number that has nothing to
do with how many distinct pieces of evidence actually exist.

**The fix.** Two designs were available, per the finding's own "assign once or define
deduplication" framing. Deduplication-at-merge (tag each observation with its originating
attachment and drop repeats during step 4's concatenation) was rejected as the primary fix: it is
strictly more mechanism for the same outcome, requires per-observation attachment provenance the
reader's output block does not currently carry, and — because a reader's observations are
free-text summaries, not byte-identical excerpts — two windows' independently-worded descriptions of
the same underlying subagent-record fact are not reliably identifiable as duplicates by string
comparison. Assign-once was chosen instead: since the attachment is a property of the *session*, not
of any window, giving it to exactly one window's dispatch (the first, by file order — an arbitrary but
deterministic and stable choice) means it is read, and can be reported, exactly once per session
regardless of how many windows that session's size required. Every other window's dispatch passes no
subagent-record paths and an attachment note of `none`, which `session-reader.md`'s own Input contract
already treats as a valid, expected value — no change to the reader's own procedure was needed for this
half of the fix.

## 5. One canonical `access denied` literal, reader and host aligned (WF-614)

**The problem.** Three vocabularies existed for the same underlying event (a denied read) with no
single canonical form linking them: `excerpt-fetcher.md` already emitted `read denied` as a first-class
member of its `Verdict:` enum, sibling to `fetched | not found | error: <reason>`; `session-reader.md`
instead embedded the words "read denied" as free text *inside* its generic `error: <reason>` field
(`error: read denied — symlink detected at read time — <path>`); and `SKILL.md`'s host-side merge table
classified a session as `skipped (access denied)` by testing whether "the reason is a denied read" — a
prose judgment call over that free text, not a structural test. Three different shapes for one concept
is exactly the fragility the finding names: a future wording tweak to the free-text reason could
silently break the host's classification, since nothing enforced that the two stayed in lockstep.

**The fix, and what it deliberately leaves alone.** `session-reader.md`'s `Verdict:` field gains a
fourth enum member, `access denied`, parallel in shape to `excerpt-fetcher.md`'s existing `read
denied` (the sibling agent's pattern this fix mirrors, chosen specifically because it was already
proven not to collide with anything) — used exactly where the leaf/ancestor symlink re-check fails,
replacing the free-text embedding. `SKILL.md`'s merge table now tests each window's `Verdict:` for that
exact literal instead of judging free text. The widely-referenced, host-facing Coverage status string
`skipped (access denied)` — used across `locator.md`, `continuation.md`, `coverage-cross-check.md`, and
`report-template.md` — is deliberately **not** renamed: the finding asks for one canonical literal
*shared by reader emission and host classification*, which is a claim about the boundary between those
two components, not about the host's own already-consistent internal vocabulary. Renaming the
Coverage-facing string would touch four files outside this task's scope for no benefit the finding
asks for.

## 6. A locator-denied session is never re-measured or re-dispatched (WF-636)

**The problem.** Step 4's merge table already asserted, as a matter of narrative fact, that "a session
step 0 marked `skipped (access denied)` is never dispatched." But nothing upstream of step 4 actually
enforced it: step 2's `wc -c` measurement and step 2.5's cap-split operated over "the list step 0
returned" with no stated carve-out, and step 3's dispatch loop excluded only "a capped-out entry" by
name. A session the locator already found unreadable would still have `wc -c` invoked against it
(an operation that would fail unpredictably rather than being skipped intentionally) and would still
be a candidate for step 2.5's cap accounting and step 3's dispatch selection — the assertion at step 4
had no upstream guarantee behind it, just a narrator's promise.

**The fix.** Each of the three upstream steps now states its own exclusion explicitly rather than
relying on a downstream assertion to retroactively make it true: step 2 skips the `wc -c` call outright
for an already-denied session; step 2.5 excludes it from the cap split (so it neither consumes a cap
slot nor risks a mis-classification as `skipped (budget)`); step 3's dispatch-eligibility list now
names both exclusions side by side ("never a capped-out or already-denied entry"). The session's status
passes through unchanged and reaches step 4's merge exactly as before — this fix changes only *how
early* the exclusion is enforced, not the outcome step 4 already documented.
