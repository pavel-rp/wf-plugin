# postmortem session-locate seam

Runtime-read only, by the isolated `wf-postmortem:locator` agent (`agents/locator.md`) — obtained via
`resolve_content({ workspaceRoot, class: "references-template", plugin: "wf-postmortem", skill:
"postmortem", ref: "locator.md" })` at the start of that agent's own dispatch, never read at boot and
never read by `SKILL.md`'s own context. **The one file naming the host's session-record store
location, filename convention, subagent-folder layout, and JSONL field names** — every other pack
file points here rather than restating any of it. Facts below are **host-observed** (this project's
own installed host). Rationale: `locator-rationale.md` (paired reference, never read at runtime).

## 1. Record layout

**Store root.** Per project: take the resolved absolute workspace path, replace every `/` with `-`
(incl. the leading one → a leading `-`), use that string as the final path segment under the host's
per-user session root. Same derivation applies to a named `--folder`/`--repo` scope's resolved path.
**Top-level session record:** a file directly inside the store root (non-recursive) ending `.jsonl`;
its basename (extension stripped) is the session id. **Quoting:** every path substituted into a shell
command — store root, candidate, subagent entry — is single-quoted, every `'` replaced by `'\''`
first; never expand a glob through the shell, never pass a path as a `Glob` pattern (enumerate the
directory, match names as data).

**Attached subagent records.** A directory sharing a top-level record's exact basename, sitting
directly inside the store root (a sibling, not nested), is that session's subagent-record folder:
`subagents/` holds one **pair** per dispatch — `agent-<dispatch-id>.jsonl` (transcript, same
line-record shape as top-level) + `agent-<dispatch-id>.meta.json` (metadata); a `.jsonl` with no
matching `.meta.json` (or vice versa) is an incomplete pair (§2). `tool-results/` holds bulk tool
output, never enumerated as a record source. No sibling directory is the normal case.
**Structural fields** — read for shape/count, never content:
- **Scope/identity:** `sessionId`, `timestamp`, `cwd`, `gitBranch`, `version`. `gitBranch` — scan
  forward from line 1 to the first line carrying a `gitBranch` field, take its value, stop (same scan
  §3 uses for `timestamp`). Only when **no** line carries a non-empty-string `gitBranch` is the value
  `none observed`; an empty/whitespace-only value counts as the same absence. A present non-empty
  value is returned raw. No size cap of its own (§6's scan bound governs it).
- **Count-only fields** (§6 alone reads these, to count shapes, never substance): the line's top-level
  `type` field (turn-role marker; header lines — an observed `type` of `mode`/`last-prompt`/
  `bridge-session` etc., carrying no `timestamp` — are never counted; the first line carrying
  `timestamp` is turn 1, each subsequent `type` change from the prior *counted* line adds one); on a
  `type: "assistant"` line, each `message.content[]` entry with its own `type: "tool_use"` is one
  invocation, its `name` field the tool name; the closed file-mutating allowlist is `Write`, `Edit`,
  `NotebookEdit` (nothing else counts as an edit); the target-file field, read only on an
  already-identified file-mutating entry, is `input.file_path` (`Write`/`Edit`) or
  `input.notebook_path` (`NotebookEdit`) — never any other argument or the tool's result line.

Every other field, and the entire substance of any message/argument/result, is never read or returned
by this seam under any circumstance. **Skill-load fact.** A `.jsonl` line may carry a tool-preamble
marker shaped `.../plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>` (same fact
`version-resolution.md` reads from a reader's return); the locator detects its **presence** and
extracts the literal string for hunt-session detection (§4) and skill-scope matching (§3) — never
reading, quoting, or returning any other text from that line.
## 2. The shape check — fail loudly, never partial

Applied to every top-level record, and every `.jsonl` record inside a `subagents/` folder, the locate
operation's scope (§3) would include. A `.meta.json` sidecar is never shape-checked as a record — only
that it completes its pair. **Recognized** — all hold: the candidate is a real regular file, never a symlink (`test -f` succeeds
**and** `test -L` fails; both apply in either mode) — a sibling subagent-record directory and
`subagents/` itself instead require `test -d` succeed and `test -L` fail. **In locate mode only**, its
canonicalized path must additionally be contained under the derived store root (component-boundary
comparison, never string-prefix); **in attach-only mode** there is no store root, so containment is
`n/a — named session`. The name ends `.jsonl`; the first line is well-formed JSON carrying
`sessionId` (header lines carry no `timestamp`); at least one line carries a `timestamp` (§3's
forward scan, §6's bound) — or the record is **empty**: every line well-formed JSON carrying a `type`,
none carrying `timestamp` (a header-only stub, e.g. a lone `bridge-session` line) — recognized, never
a shape failure, and dateless, so §3's window excludes it (no coverage entry); when a sibling subagent-record directory exists, every file
directly inside its `subagents/` is one half of a complete `agent-<id>.jsonl` + `.meta.json` pair.

**Unrecognized** — a record: wrong extension, malformed/missing-`sessionId` first line, or no line
carries `timestamp` and it is not empty. A pair: either half missing. Also unrecognized: a `subagents/` entry that is
neither a `.jsonl` record nor a `.meta.json` sidecar; a sibling directory with no `subagents/` folder
at all where the top-level record's own first line implies subagent activity; any candidate/directory/
entry that is a symlink or fails its shape test; in locate mode, one whose path is not canonically
contained under the store root. **On unrecognized** (whole-store or per-record level): fail loudly —
return `LOCATE ERROR: unrecognized record shape — <path> — <what did not match>` and stop; the caller
writes no report. Never a per-record skip. **Store root unreadable** (permission denied or
inaccessible): `LOCATE ERROR: session store unreadable — <cause>`, stop, no report. A store root that
simply does not exist (`ENOENT`) is zero located sessions, not an error. **A single record's denied read**
(store lists successfully, one candidate's own read is denied): not a shape mismatch, not a
whole-run stop — record that session `skipped (access denied)` and continue.

## 3. Scope-to-store mapping

**Default:** store root = the current workspace's own (§1), derived from `workspaceRoot`. **Named
`--folder`/`--repo`:** once `SKILL.md` Phase 1 resolves it to a path, the same §1 derivation applied
to that path is the store root to enumerate. **`--skill`:** a candidate matches when a Skill-load line
(§1), top-level or in any attached subagent record, carries a path whose segment immediately
following `.../skills/` equals `--skill` **exactly** — full final-segment match
(`plugins/cache/<seg>/<seg>/<seg>/skills/<seg>`, each `<seg>` matching `^[A-Za-z0-9._-]+$`, not `.`/
`..`); a longer skill sharing the value as a prefix does **not** match. Absent `--skill`, every
candidate matches trivially. **Date — 30-day window:** a candidate's date = earliest `timestamp` in
file order (forward scan from line 1, not a fixed line). The window cutoff is **supplied by the
caller** (`SKILL.md` Phase 3.5 step 0 computes it once from that run's current time); the locate
operation never recomputes it. Outside the trailing 30 days from that cutoff → not located, not read,
no entry of any kind — a hard filter before ranking, not a ranking penalty.

## 4. Ranking — orders reading, never excludes

1. **Scope-match specificity, descending** — count how many named scope elements (`--skill`, folder/
   repo when named) a candidate matches.
2. **Recency, descending** — tie-break within equal specificity.
3. **Hunt-session override, last** — every hunt session (§5) moves to the list's end, in the relative
   order 1–2 would otherwise give; never dropped, never given any status but an ordinary one (§5).
   Every candidate reaching this step appears exactly once in the final list — nothing is removed.
   `SKILL.md` reads in this order and lists every one in coverage; ranking orders reading, it doesn't
   gate it (Phase 3.5 step 2.5 applies the per-run read cap over this seam's full ranked list).

## 5. Hunt-session detection

A **hunt session** is either: **the running session** — prefer the host's own current-session
disclosure when exposed (read verbatim, never guessed); else fall back to the most-recently-modified
in-scope top-level record (a stated heuristic, not a guaranteed identity); or **any session in which
`postmortem` itself ran** — a candidate whose top-level or attached-subagent record carries a
Skill-load line naming `.../skills/postmortem`. A hunt session keeps an **ordinary** coverage status
(never `skipped (self)`, never omitted) — labelled as a hunt session in the return block, changing
nothing about how it's read, counted, or reported otherwise.

## 6. Deterministic counting

For a session actually read, over exactly §1's count-only structural fields, no model judgment:
**Iterations** — count of role-transition boundaries (§1's turn-role rule, header lines excluded, the
first timestamped line counted as turn 1). **Edits** — count of tool-invocation entries whose `name`
matches §1's closed allowlist. **Files touched** — count of **distinct** values named by those same
entries' target-file field, deduplicated by exact string. Each count, when extractable with no
judgment, carries `mechanically-observed` and replaces a reader-reported figure for that session.
**Findings per pass** has no structural signal — never produced by this seam; stays `reader-counted`,
`unverified`. A session not read (`skipped (access denied)`, or excluded by the shape check) produces
no seam-counted figures. **Scan bound:** this pass reads every line of a session's top-level and
attached-subagent records once, sequentially, the same walk §2's shape check performs — no separate
size/candidate-count cap, unlike the reader's 200,000-character window; this seam locates/ranks/counts
the **full** matching set, the per-run read cap applied afterward (Phase 3.5 step 2.5).

## 7. The `--session` regression path

`SKILL.md` Phase 1 resolves every `--session` value exactly as before this task. This seam is
dispatched **exactly once per run**, in one of two modes: **≥1 value resolves** → **attach-only
mode** — given the resolved paths directly (never a scope), applies §2's shape check and discovers
attached subagent records (§1); no enumeration, scope-matching (§3), ranking (§4), or window filter.
**≥1 passed, none resolves** → `SKILL.md` stops with its own existing reason (`"no named session
record resolved — <n> named, 0 resolved"`) **before** this seam would dispatch — never a fallback to
locating. **None passed** → **locate mode** — given the resolved scope (§3), enumerates, shape-checks,
scope-matches, ranks (§4), window-filters; "not found" (§8) is a valid outcome, not a stop.

## 8. What the locator agent returns

One ranked list: `LOCATE OK` (even empty — a valid "not found" outcome) or `LOCATE ERROR: <cause>`
(§2's fail-loud cases). Each entry carries: resolved path, date, raw `gitBranch` value (or `none
observed`, stated in both modes, no named-session exemption), scope-match specificity, attached
subagent records (+ paths, for `excerpt-fetcher.md`'s allow-list), whether it's a hunt session, its
status when unreadable (`skipped (access denied)`; never `skipped (self)`), and any §6 counts
produced. The 30-day cutoff is always stated, whether or not it excluded anything. `SKILL.md` reads
this list defensively, exactly as a `session-reader`/`excerpt-fetcher` return — no parseable result is
a stated error, never a silent empty pass.
