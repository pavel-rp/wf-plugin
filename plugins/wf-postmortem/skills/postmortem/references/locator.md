# postmortem session-locate seam

Runtime-read only, by the isolated `wf-postmortem:locator` agent (`agents/locator.md`) — obtained via
`resolve_content({ workspaceRoot, class: "references-template", plugin: "wf-postmortem", skill:
"postmortem", ref: "locator.md" })` at the start of that agent's own dispatch, never read at boot and
never read by `SKILL.md`'s own context. **This is the one file in the pack that names the host's
session-record store location, filename convention, subagent-folder layout, and JSONL field names.**
Every other pack file — `SKILL.md`, `agents/locator.md` itself, every other reference — names none of
them; where one of them needs this seam's behaviour it points here rather than restating it. This is
what makes the seam "one replaceable seam": a future host release that changes any of the facts below
changes only this file.

The facts below are **host-observed** (this project's own installed host, inspected directly while
writing this file) — a description of the shape this release's locator recognizes, not a promise that
every host or future release matches it. The shape check below exists precisely because that promise
cannot be made: a host that lays records out differently must be recognized as different, loudly, not
silently mistaken for a match.

---

## 1. Record layout

**Store root.** Each project's sessions live under one directory, keyed by a slug derived from the
project's absolute workspace path: take the resolved absolute path, replace every `/` with `-`
(including the leading one, which yields a leading `-`), and use that string as the final path segment
under the host's own per-user session root. Applying this same derivation to a named `--folder`/`--repo`
scope's resolved absolute path yields that project's own store root — the mapping is one formula, not a
lookup table, so it generalizes to any project the maintainer names, not only this one.

**Top-level session record.** A file directly inside the store root (non-recursive at this level) whose
name ends `.jsonl`. Its basename (with the extension removed) is the session's id.

**Attached subagent records.** When a directory bearing the *exact same basename* as a top-level
record's id sits directly inside the store root (a sibling of the `.jsonl` file, not nested under it),
that directory is the session's own subagent-record folder. Inside it:
- a `subagents/` folder holds this session's own subagent-dispatch records, one **pair** per dispatch:
  `agent-<dispatch-id>.jsonl` (the dispatch's own transcript, in the same line-record shape as a
  top-level record) plus `agent-<dispatch-id>.meta.json` (dispatch metadata). A `.jsonl` file in
  `subagents/` with no matching `.meta.json` (or vice versa) is an incomplete pair — see §2.
- a `tool-results/` folder holds bulk tool-call output, not itself session-record content. The locator
  never enumerates it as a record source and never counts it as a subagent record.

No sibling directory for a given top-level record is a normal, common case — most sessions dispatch no
subagent — never an error and never a shape mismatch.

**Structural fields.** Each line of a `.jsonl` file (top-level or a `subagents/` entry) is one JSON
object. The fields this seam reads — and the only ones it reads — are `sessionId`, `timestamp`, `cwd`,
`gitBranch`, and `version`. Every other field in the line, and the entire substance of any message,
tool-call, or tool-result content the line carries, is never read, never inspected, and never returned
by this seam under any circumstance: reading those fields is what this seam offers instead of a content
read, not a narrower version of one.

**Skill-load fact.** A `.jsonl` line may additionally carry a tool-preamble marker whose value is a
version-pinned base directory shaped `.../plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>`
— the same fact `references/version-resolution.md` already reads from a *reader's* return block. The
locator detects the **presence** of a line matching this shape and, when present, extracts that literal
string — a mechanical tool-preamble artifact, not authored conversational content — for hunt-session
detection (§4) and skill-scope matching (§3). It never reads, quotes, or returns any other text from the
line the marker appears on.

---

## 2. The shape check — fail loudly, never partial

Applied to every top-level record, and to every `subagents/` entry, that the locate operation's scope
(§3) would otherwise include.

**Recognized** — all of the following hold:
- the file's name ends `.jsonl`;
- its first line is well-formed JSON and carries a `sessionId` field;
- when a sibling subagent-record directory exists for it, every file directly inside its `subagents/`
  folder is one half of a complete `agent-<dispatch-id>.jsonl` + `agent-<dispatch-id>.meta.json` pair
  (an orphaned half is unrecognized, not silently skipped).

**Unrecognized** — the extension is not `.jsonl`; the first line is not well-formed JSON, or lacks
`sessionId`; a `subagents/` entry has no matching pair-half; or the sibling directory exists but holds
no `subagents/` folder at all where the top-level record's own first line implies subagent activity
occurred (a stated, conservative signal — this release does not attempt to name every implying field,
only to fail loudly rather than guess when the layout looks inconsistent with itself).

**On unrecognized, at the whole-store or per-record enumeration level:** the locate operation fails
loudly for the whole hunt — return `LOCATE ERROR: unrecognized record shape — <path> — <what did not
match>` and stop; the caller (`SKILL.md`) writes no report. This is deliberately **not** a per-record
skip: an unrecognized shape signals the host's own layout may have changed, which could silently
mis-locate or mis-rank every other record too, so the seam refuses to proceed at all rather than trust
itself partially.

**On the store root itself being unreadable** (the directory cannot be listed — permission denied, or
present but inaccessible): `LOCATE ERROR: session store unreadable — <cause>` and stop, no report. A
store root that simply **does not exist** (`ENOENT` — this project has never produced a session under
that path) is not this failure: it is zero located sessions for that scope element, reported as such,
never an error on its own.

**Distinct from a single record's denied read.** A store root that lists successfully, where one
specific candidate record's own read (its first line, for the shape check) is denied while the store
directory itself is readable, is **not** a shape mismatch and is **not** a whole-run stop: record that
one session's status as `skipped (access denied)` in the locator's return block and continue enumerating
the rest of the store — this is the same status SUB-3 already produces for a named `--session` record
whose read the host denies, preserved unchanged now that the read moves behind this seam.

---

## 3. Scope-to-store mapping

**Default (no `--folder`/`--repo` named).** The store root is the current workspace's own, derived from
`workspaceRoot` (§1). Only that project's sessions are located.

**Named `--folder`/`--repo`.** Once `SKILL.md` Phase 1 has resolved the value to a filesystem path, the
same store-root derivation (§1) applied to that path is the store root to enumerate — widening the
located set to that project's sessions, never any other unnamed project's.

**`--skill`.** A candidate matches the skill dimension when a Skill-load line (§1) naming that skill —
`.../skills/<the named skill>` — appears anywhere in its top-level record or in any of its attached
subagent records. Absent `--skill`, every candidate matches this dimension trivially (unscoped).

**Date — the 30-day window.** A candidate's date is its `timestamp` field's earliest occurrence (its
first line, in file order). A candidate whose date falls outside the trailing 30 days from the locate
operation's own run time is **not located and not read** — it receives no coverage entry of any kind
(not even a "skipped" one), and the caller states the window itself in coverage regardless of whether
any candidate was excluded by it. This is a hard filter applied before ranking, not a ranking penalty.

**No explicit repository-relative or per-machine path appears in this scope logic** — every mapping
above is a formula applied to a resolved absolute path, so it holds for any project on any host running
this pack, not only this one.

---

## 4. Ranking — orders reading, never excludes

Sessions that pass the shape check (§2) and the scope/window filter (§3) are ranked, in order:

1. **Scope-match specificity, descending.** Count how many of the *named* scope elements (`--skill`,
   and the folder/repo dimension when named) a candidate matches; a candidate matching more of them
   ranks above one matching fewer. (The folder/repo dimension, when its store root is what was
   enumerated, is trivially matched by every candidate from that store — specificity here mainly
   distinguishes `--skill` matches from non-matches within one store.)
2. **Recency, descending, as the tie-break.** Within equal specificity, the candidate with the later
   date (§3) ranks first.
3. **Hunt-session override, applied last.** Regardless of what steps 1–2 computed, every hunt session
   (§5) is moved to the end of the ranked list, in the same relative order steps 1–2 would otherwise
   give them. A hunt session is never dropped, never excluded, and never given any status other than an
   ordinary one (§5) — only its rank position changes.

Every candidate that reaches this step appears in the final ranked list exactly once; nothing here
removes a candidate. The caller (`SKILL.md`) reads sessions in this order and lists every one of them
in coverage — ranking orders reading, it does not gate it (that arrives with a later charter sub-task's
read cap).

---

## 5. Hunt-session detection

A **hunt session** is either of:

- **The running session** — the session in which this very hunt is executing. Prefer the host's own
  current-session disclosure when the runtime exposes one (an environment or tool-context fact naming
  the active transcript, read verbatim, never guessed at). When no such fact is exposed, fall back to
  treating the most-recently-modified in-scope top-level record as the running session — an accepted,
  stated heuristic: a session actively being written grows and its modification time keeps advancing
  throughout the run, so among already-existing records it is reliably the newest at any snapshot in
  time. This is a heuristic, not a guaranteed identity, and is named as such rather than presented as
  certain.
- **Any session in which `postmortem` itself ran** — a candidate whose top-level record or any attached
  subagent record carries a Skill-load line (§1) naming `.../skills/postmortem`. This reuses
  `references/version-resolution.md`'s existing fact rather than inventing a second identity signal.

A hunt session keeps an **ordinary** coverage status (read, read in part, or skipped with its ordinary
reason) — never `skipped (self)`, and never omitted. It is labelled as a hunt session in the locator's
return block so `SKILL.md` can state that label in coverage; the label changes nothing about how it is
read, counted, or reported otherwise.

---

## 6. Deterministic counting

For a session that is actually read (this seam does not itself read message content — this counting
runs as part of the same structural pass §1 describes, over the same fields plus a count of matching
line shapes, never full content):

- **Iterations** — the count of distinct top-level conversational turns in the record (a mechanical
  count of role-transition boundaries in the JSONL line sequence, not an interpretation of what happened
  in a turn).
- **Edits** — the count of tool-call lines whose tool name is a file-mutating one (an editing or writing
  tool call), counted structurally from the line's own tool-name field — never by reading the edit's
  content or the file's own text.
- **Files touched** — the count of **distinct** file-path values named by those same edit tool-calls'
  own structural arguments, deduplicated by exact path string.

Each of these three counts, when the seam can extract it from the structural fields with **no model
judgment**, carries the `mechanically-observed` tier and replaces a reader-reported figure for the same
session. **Findings per pass** has no equivalent structural signal this release — "a finding" is a
judgment about significance, not a line shape — so it is never produced by this seam; it stays whatever
a session-reader reported, at the `reader-counted` label and the `unverified` tier, exactly as before
this task.

A session the locator could not read at all (`skipped (access denied)`, or excluded by the shape check
at the whole-run level) produces no seam-counted figures for itself; nothing here changes what happens
before a session is even located.

---

## 7. The `--session` regression path

`SKILL.md` Phase 1 already resolves every `--session` value exactly as before this task — this seam
changes nothing about that resolution. What changes is the trigger for using this seam at all:

- **One or more `--session` values were passed, and at least one resolves.** The hunt runs over exactly
  those resolved records, precisely as today; this seam is **never invoked** — a named hunt stays fully
  explicit, and locating never widens it.
- **One or more `--session` values were passed, and none resolves.** `SKILL.md` still stops with its
  existing stated reason (`"no named session record resolved — <n> named, 0 resolved"`); this seam is
  **never invoked** as a fallback — an all-unresolved named hunt never silently becomes a located one.
- **No `--session` value was passed at all.** This is the **only** condition under which `SKILL.md`
  dispatches this seam. The hunt then runs over whatever this seam locates under the resolved scope
  (§3) — "not found" (§8) is a valid, complete outcome of that dispatch, not a stop.

---

## 8. What the locator agent returns

One ranked list, `LOCATE OK` (even when the list is empty — an empty list under scope is the "not
found" outcome, still a success, not an error) or `LOCATE ERROR: <cause>` (§2's fail-loud cases). Each
listed entry carries: the session's own resolved path, its date, its scope-match specificity, whether it
carries attached subagent records (and their resolved paths, for the caller's later
`excerpt-fetcher.md` allow-list), whether it is a hunt session, its per-session status when the locator
itself could not read it (`skipped (access denied)`; never `skipped (self)`), and any of §6's counts the
seam produced for it. The 30-day window's own cutoff date is always stated, whether or not it excluded
anything. `SKILL.md` reads this list defensively exactly as it reads a `session-reader`/`excerpt-fetcher`
return block — no parseable result is a stated error, never a silent empty pass.
