---
name: seed
description: Parses an architecture or design doc's action-items checklist into an append-only local backlog under _local/, minting a local T-prefixed id per item with metadata and a resolvable doc reference so a later /wf:spec has grounded context. Use once per architecture or design doc to turn its action items into tracked task stubs before running /wf:spec on each — re-runnable, appending only newly-added items without clobbering existing entries.
allowed-tools: [Read, Write, Edit, Glob, Grep]
---

# /wf:seed — Turn an architecture doc's action items into a local backlog

Parse an architecture or design doc's action-items checklist into an append-only backlog under `_local/`. Each checklist item becomes a `### T<NNN>:` stub carrying a local `T<NNN>` id, lightweight metadata, and a `Refs:` line pointing back at the doc section it came from — so a subsequent `/wf:spec T<NNN>` has grounded context. Re-runnable: a second run appends only the items that aren't already in the backlog.

**Local ids only. No source writes outside `_local/`. Append-only — never clobber.**

---

## Prerequisites

**Before any other phase**, obtain project config from the bundled `wf-resolver` MCP service via `resolve_config` — it returns `{ workspaceRoot, registryPath, coreConfig{ taskRoot, seedArchitectureDoc, seedBacklogPath, … }, idShape }`, already resolved from `_local/config.md` (core performs no direct config-file parse). If the resolver reports the project is uninitialized (no resolved config / absent `_local/config.md`), stop and instruct the user to run `/wf:init` first. If the `wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback. `{task-root}` and the two `## Seed` values below come from `coreConfig` (`coreConfig.taskRoot`, `coreConfig.seedArchitectureDoc`, `coreConfig.seedBacklogPath`) — never hardcode them. An older config that predates the `## Seed` section is handled gracefully (see Phase 1): the resolver surfaces a missing key as an unset `coreConfig` value — an unset value is a fallback, not an error.

**Config values** (surfaced by `resolve_config` from the `## Seed` section of `_local/config.md`):

- **`coreConfig.seedArchitectureDoc`** (the **Architecture Doc** key) — the default doc parsed when `/wf:seed` is called with no `<doc>` argument.
- **`coreConfig.seedBacklogPath`** (the **Backlog Path** key) — the backlog file to write/append. Unset → fall back to `{task-root}/BACKLOG.md`.

---

## When to use

Reach for `/wf:seed` when an architecture or design doc carries an action-items checklist and you want each item captured as a tracked backlog stub before writing specs — so `/wf:spec T<NNN>` resolves the item's doc refs with full context instead of hand-transcribing.

**Do NOT use `/wf:seed` when:** you have a single well-formed task (call `/wf:spec` directly), or the doc has no action-items checklist (there is nothing to seed — the skill stops).

---

## Command Syntax

```
/wf:seed [<doc>]
```

### Arguments

| Argument | Required | Description |
| -------- | -------- | ----------- |
| `<doc>`  | NO       | Repo-relative path (forward slashes) to the architecture/design doc to parse. Omitted → the **Architecture Doc** config key. If neither resolves, stop (see `## Edge Cases`). |

**Zero-argument default:** `/wf:seed` reads the **Architecture Doc** key for the doc and the **Backlog Path** key (or the `{task-root}/BACKLOG.md` fallback) for the destination.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the project (`Read`, `Glob`, `Grep`).
- Obtain `{task-root}` and the `## Seed` values from the `wf-resolver` `resolve_config` query (`coreConfig`).
- Write/create and append the backlog artifact **inside `_local/`** only.

**Forbidden:**

- Modify any file outside `_local/` — including any other skill (`skills/spec` and the rest stay untouched).
- Clobber, rewrite, or reorder existing backlog entries — only append new ones.
- Run any version-control, work-item, build, or network operation — `/wf:seed` is file-read plus one `_local/` write, nothing else.

---

## Phase 1: Resolve inputs

1. **Resolve config.** From `resolve_config`'s `coreConfig`, read `{task-root}` (`coreConfig.taskRoot`) and the `## Seed` values (`coreConfig.seedArchitectureDoc`, `coreConfig.seedBacklogPath`). If a `## Seed` value is unset (an older config predating the section), degrade gracefully — do not error:
   - **`coreConfig.seedArchitectureDoc`** unset **and** no `<doc>` argument → stop per `## Edge Cases` ("no doc resolved").
   - **`coreConfig.seedBacklogPath`** unset → use `{task-root}/BACKLOG.md`.
2. **Resolve the doc.** `<doc>` argument if given, else the **Architecture Doc** key. Read it. If it can't be read (missing/unreadable), stop per `## Edge Cases`.
3. **Resolve the backlog path** per the key/fallback above, then **defensively confirm it stays inside `_local/`** — it must be a repo-relative, forward-slash path under `{task-root}` with **no** `..` segment and **no** absolute/drive prefix (no leading `/`, no `C:`-style prefix). If it violates that shape, do **not** write to it: fall back to `{task-root}/BACKLOG.md` and flag the rejected value loudly in the report (mirrors `/wf:init`'s defensive `registryPath` check). This keeps the Safety Rule "writes only inside `_local/`" total even against a misconfigured **Backlog Path**. Hold the resolved path; do not create it yet.

---

## Phase 2: Extract action items

Parse the doc's action-items checklist:

1. Collect every Markdown task-list line — `- [ ]` or `- [x]` (any indent). Strip the checkbox marker; the remaining text is the **item text**.
2. For each item, record its **section anchor**: the nearest preceding Markdown heading (`#`…`######`). That heading text is the `§ <section>` part of the item's ref — it exists in the doc, so the ref resolves. **If an item has no preceding heading** (it sits above the first heading, or the doc has none), its anchor is the **doc itself** — the `Refs:` line is `<doc-path>` with **no** `§ <section>` suffix, which still resolves (the doc exists).
3. Capture any immediately-nested sub-bullets under an item as its context (for the entry description).

**No task-list items found anywhere in the doc** → stop per `## Edge Cases` ("no checklist"). Write nothing.

---

## Phase 3: Mint collision-safe ids

Compute the next `T<NNN>` so a minted id never collides with an id already in use:

1. Scan `{task-root}` for existing `T<NNN>`-prefixed task folders; collect their numbers.
2. Read the backlog (if it exists); collect the numbers from existing `### T<NNN>:` headings.
3. `next = max(all collected numbers, 0) + 1`, zero-padded to 3 digits. Increment once per **appended** item, in doc order.

This mirrors the local `T<NNN>` scheme `/wf:spec` mints when no id is passed (the empty-registry default). (Residual: a later `/wf:spec` invoked with **no** id scans task folders only, so it can't see a still-unspec'd backlog id — always expand a backlog stub with the explicit form `/wf:spec T<NNN>`.)

---

## Phase 4: Dedup and append

1. **Dedup key** = the item's ref anchor (`<doc-path> § <section>`, or `<doc-path>` alone for a pre-heading item) **plus** its normalized title — the item text **truncated to exactly 80 characters** (the same cap the entry heading uses, below), then trimmed, inner whitespace collapsed, and lowercased. Apply the truncation and normalization identically when deriving the key from an existing backlog entry's `**Refs:**` line and `### T<NNN>:` heading title, so the match is deterministic and the re-run is idempotent.
2. **Skip** any item whose key already appears in the backlog — it was seeded on a prior run. **Stage** every unmatched item, minting the next id from Phase 3 in doc order.
3. **Append.** If the backlog doesn't exist, create it with the header template, then append the staged entries. If it exists, append the staged entries **after the last existing entry**, preserving every existing byte. Never rewrite or reorder what's already there.

Every write stays inside `_local/`.

### Backlog header (written once, on creation)

```markdown
# Backlog

> Append-only task backlog seeded by `/wf:seed` from architecture/design docs.
> Each `### T<NNN>:` entry is a task stub — run `/wf:spec T<NNN>` to expand it into a full spec.
> **Model:** <model identifier>
```

### Per-entry template (one per appended item)

```markdown
### T<NNN>: <item title — item text, truncated to exactly 80 chars>

**Type:** <task type per /wf:classify, or — to defer to /wf:spec>
**Complexity:** <S | M | L | —>
**Refs:** <doc-path> § <section heading>   (drop the "§ <section heading>" suffix when the item precedes any heading)
**Seeded:** <YYYY-MM-DD> by <model identifier>

<1–3 sentences from the item text and its sub-bullets — the context /wf:spec resolves.>
```

Set `Type`/`Complexity` only when the item text makes them obvious; otherwise write `—` (leave the call to `/wf:spec`). Use the current model id from the runtime for both `**Model:**` and `Seeded … by`; write `unknown` if unavailable.

---

## Edge Cases

- **No doc resolved** (no `<doc>` argument and no **Architecture Doc** key): stop — "No doc given and no Architecture Doc configured. Pass one: `/wf:seed <doc>`, or add the Architecture Doc key to `_local/config.md` (`/wf:init` seeds the `## Seed` section)." Write nothing.
- **Doc missing or unreadable:** stop and name the path. Write nothing.
- **No action-items checklist in the doc:** stop — "No action-items checklist found in `<doc>`. Nothing to seed." Write nothing. (Final block status `No-op`.)
- **Re-run with no new items:** append nothing; report `0 new (<M> already seeded)`. Existing entries stay byte-stable.
- **`_local/config.md` absent:** stop and direct the user to `/wf:init` (Prerequisites).
- **`## Seed` section or a key absent:** not an error — Architecture Doc absent falls through to the no-doc stop above (only when no `<doc>` was passed); Backlog Path absent falls back to `{task-root}/BACKLOG.md`.
- **Backlog Path resolves outside `_local/`** (absolute, drive-prefixed, or containing a `..` segment): do **not** write there — fall back to `{task-root}/BACKLOG.md` and flag the rejected value in the report. The Safety Rule's "writes only inside `_local/`" is never violated by a misconfigured key.
- **Item precedes any heading** (or the doc has no headings): its `Refs:` anchor is the doc path alone (no `§ <section>`), which still resolves — never a stop condition on its own.
- **Backlog exists but has no parseable `### T<NNN>:` headings:** treat the backlog's id set as empty (mint from `{task-root}` folders alone), warn once, and still append — never clobber the existing file.

---

## Final Output

```
SEED — <Complete | No-op | Error>

Doc: <doc-path>
Backlog: <backlog-path>
Items scanned: <total checklist items>
New entries: <N> (<first-id>–<last-id>)   |   0 new (<M> already seeded)

Next: /wf:spec <first-new-id>    # expand the first new stub into a spec
```

- `No-op` (no checklist / nothing to seed) → `Next: none — add an action-items checklist to the doc, then re-run /wf:seed`.
- `Error` (no doc resolved / unreadable) → `Next: /wf:seed <doc>` (or fix `_local/config.md`).

**The final output block must always be the very last thing output to chat.**
