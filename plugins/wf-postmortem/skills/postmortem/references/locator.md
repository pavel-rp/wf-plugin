# postmortem session-locate seam

Runtime-read only, by the isolated `wf-postmortem:locator` agent (`agents/locator.md`) at the start of
its dispatch via `resolve_content` — never by `SKILL.md`'s own context. **The one file naming the
host's session-record store location, filename convention, subagent-folder layout, and JSONL field
names**; every other pack file points here. Facts are **host-observed**. Rationale:
`locator-rationale.md` (paired reference, never read at runtime).

**Contents:** [1 Layout](#1-record-layout) · [2 Shape check](#2-the-shape-check--local-to-its-session) · [3 Scope](#3-scope-to-store-mapping) · [4 Ranking](#4-ranking--orders-reading-never-excludes) ·
[5 Hunt sessions](#5-hunt-session-detection) · [6 Counting](#6-deterministic-counting) · [7 `--session`](#7-the---session-regression-path) · [8 Return](#8-what-the-locator-agent-returns)

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
directly inside the store root (a sibling, not nested), is that session's subagent-record folder.
Its `subagents/` holds one **pair** per dispatch — `agent-<dispatch-id>.jsonl` (transcript, same
line-record shape as top-level) + `agent-<dispatch-id>.meta.json` (metadata). `tool-results/` holds
bulk tool output, never enumerated as a record source. No sibling directory is the normal case.
**Known container `subagents/workflows/`:** one directory per workflow run, each holding the same
`agent-<id>.jsonl` + `.meta.json` pairs plus one `journal.jsonl` (the run's orchestration journal —
never a record source, never read). Each pair inside a run directory is attached to the owning
session exactly like a direct pair. No other directory inside `subagents/` is a known container.
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

## 2. The shape check — local to its session

Applied to every top-level record the locate operation's scope (§3) would include, and to every entry
of its attached folder. A `.meta.json` sidecar is never shape-checked as a record — only that it
completes its pair. **Path safety** (every candidate, directory, and entry, both modes): a record or
sidecar must be a real regular file, never a symlink (`test -f` succeeds **and** `test -L` fails); a
sibling folder, `subagents/`, `workflows/`, and a workflow run directory instead require `test -d`
succeed and `test -L` fail. **In locate mode only**, every canonicalized path must also be contained
under the derived store root (component-boundary comparison, never string-prefix); in attach-only mode
containment is `n/a — named session`. A path failing path safety is never opened, listed, or descended.
**A recognized record:** the name ends `.jsonl`; the first line is well-formed JSON carrying `sessionId`
(header lines carry no `timestamp`); at least one line carries a `timestamp` (§3's forward scan, §6's
bound) — or the record is **empty**: every line well-formed JSON carrying a `type`, none carrying
`timestamp` (a header-only stub, e.g. a lone `bridge-session` line) — recognized, never a shape
failure, and dateless, so §3's window excludes it (no coverage entry).

**Outcomes are local to the owning session — never a whole-dispatch stop:**
- **Top-level record** unrecognized (malformed/missing-`sessionId` first line; no `timestamp` and not
  empty; fails path safety) → that candidate's status `skipped (unrecognized shape: <what did not
  match>)`; never read or counted; the dispatch continues with every other candidate.
- **Attached entry** unrecognized — a `subagents/` entry that is neither a pair half nor the known
  `workflows/` container; a pair missing either half (either location); a record inside a pair
  failing the record check; a workflow run directory entry that is neither a pair half nor
  `journal.jsonl`; any entry, directory, or container failing path safety; a sibling folder with no
  `subagents/` where the top-level record's first line implies subagent activity → **omit** exactly
  that entry (a failing directory or container: the whole of it, never descended), list it under the
  owning candidate's `Omitted:` as `<path> — <what did not match>`, and keep the candidate eligible
  with every other validated attachment.
- **Store root unreadable** (permission denied or inaccessible) → `LOCATE ERROR: session store
  unreadable — <cause>`, stop, no report — the one store-wide failure. A store root that simply does
  not exist (`ENOENT`) is zero located sessions, not an error.
- **A single record's denied read** (store lists successfully, one candidate's own read is denied) →
  that session `skipped (access denied)`; continue.

## 3. Scope-to-store mapping

**Default:** store root = the current workspace's own (§1), derived from `workspaceRoot`. **Named
`--folder`/`--repo`:** once `SKILL.md` Phase 1 resolves it to a path, the same §1 derivation applied
to that path is the store root to enumerate. **`--skill`:** a candidate matches when a Skill-load line
(§1), top-level or in any attached subagent record, carries a path whose segment immediately
following `.../skills/` equals `--skill` **exactly** — full final-segment match
(`plugins/cache/<seg>/<seg>/<seg>/skills/<seg>`, each `<seg>` matching `^[A-Za-z0-9._-]+$`, not `.`/
`..`); a longer skill sharing the value as a prefix does **not** match. Absent `--skill`, every
candidate matches trivially. **Date — 30-day window:** a candidate's date = earliest `timestamp` in
file order (forward scan from line 1, not a fixed line); a `skipped (unrecognized shape: …)` candidate
has no trusted record date, so its file modification time (metadata only) decides the window, and its
`Date:` reads `n/a — not read`. The window cutoff is **supplied by the caller** (`SKILL.md` Phase 3.5
step 0 computes it once); the locate operation never recomputes it. Outside the trailing 30 days from
that cutoff → not located, not read, no entry — a hard filter before ranking, not a ranking penalty.

## 4. Ranking — orders reading, never excludes

1. **Scope-match specificity, descending** — how many named scope elements (`--skill`, folder/repo
   when named) a candidate matches. 2. **Recency, descending** — the tie-break.
3. **Hunt-session override, last** — every hunt session (§5) moves to the end, in the relative order
   1–2 give; never dropped, never given any status but an ordinary one. Every candidate appears exactly
   once — nothing is removed; `SKILL.md` Phase 3.5 step 2.5 applies the read cap over this full list.

## 5. Hunt-session detection

A **hunt session** is **the running session** (the host's current-session disclosure verbatim when
exposed; else the most-recently-modified in-scope top-level record — a stated heuristic) or **any
session whose top-level or attached record carries a Skill-load line naming `.../skills/postmortem`**.
It keeps an **ordinary** status (never `skipped (self)`, never omitted), labelled in the return block.

## 6. Deterministic counting

For a session actually read, over exactly §1's count-only structural fields, no model judgment:
**Iterations** — count of role-transition boundaries (§1's turn-role rule, header lines excluded, the
first timestamped line counted as turn 1). **Edits** — count of tool-invocation entries whose `name`
matches §1's closed allowlist. **Files touched** — count of **distinct** values named by those same
entries' target-file field, deduplicated by exact string. Each count, when extractable with no
judgment, carries `mechanically-observed` and replaces a reader-reported figure for that session.
**Findings per pass** has no structural signal — never produced by this seam; stays `reader-counted`,
`unverified`. A session not read (`skipped (access denied)` or `skipped (unrecognized shape: …)`)
produces no seam-counted figures; an omitted entry contributes nothing. **Scan bound:** one sequential
pass over every line of a session's top-level and attached records — §2's own walk, no separate cap.

## 7. The `--session` regression path

`SKILL.md` Phase 1 resolves every `--session` value; this seam is dispatched once per run. **≥1
resolves** → **attach-only mode** — the resolved paths directly; §2's shape check and §1's attachment
only, no enumeration, scope-matching, ranking, or window filter. **≥1 passed, none resolves** →
`SKILL.md` stops with its own reason before dispatch — never a fallback to locating. **None passed** →
**locate mode** over the resolved scope (§3); "not found" (§8) is a valid outcome, not a stop.

## 8. What the locator agent returns

One ranked list: `LOCATE OK` (even empty — a valid "not found" outcome) or `LOCATE ERROR: <cause>`
(§2's store-wide failure only). Each entry carries: resolved path, date, raw `gitBranch` value (or
`none observed`, both modes), scope-match specificity, attached subagent records (+ paths, for
`excerpt-fetcher.md`'s allow-list), every omitted entry with its reason, whether it's a hunt session,
its status (`ok`, `skipped (access denied)`, or `skipped (unrecognized shape: …)`; never `skipped
(self)`), and any §6 counts produced. The 30-day cutoff is always stated. `SKILL.md` reads this list
defensively — no parseable result is a stated error, never a silent empty pass.
