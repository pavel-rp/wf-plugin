# Counterpart map contract

**Version:** 1.0.0 (WF-758: the declared map, the `list_counterparts` resolver tool, and the verify rendering)
**Model:** claude-opus-5-5
**Implemented by:** `plugins/wf/mcp/src/resolver/counterparts.ts`, which the resolver tool `list_counterparts` exposes
**Consumed by:** `/wf:verify-spec` §"Fire the `verify` phase" (Counterpart listing)

A rule often lives in more than one place. The same statement can be held in two documents, a format can be written by one component and read by another, or a literal can be defined once and referenced elsewhere with no compiler linking the two. A change that updates one copy and leaves the others alone is invisible to a reviewer who sees only the changed hunk. This contract makes the other copies visible. It lists them deterministically, as advisory findings, and it never decides that a listed copy is wrong.

This document is read by authors. It is never read at a phase's runtime; the runtime behaviour lives in the verify-spec skill body and in the tool.

## Three layers

1. **Core (this contract and the tool).** Core is given changed lines and a set of declared keys. It finds each changed key's declared locations and returns them. Core does not know what a key means, which file types exist, or what "mirror" means for any stack.
2. **Declared map (per-project data).** A project declares the links it knows about in `counterparts.md`, placed beside its registry file (`_local/counterparts.md` under the default registry path). It is static data, shaped by the section below.
3. **Extractors (capabilities).** A capability that can infer counterparts for its own stack contributes them through its existing `verify` / `finding` fragment row, marking each such finding `counterpart: true`. No new contribution kind is involved. Core renders these findings under the same non-blocking rule as its own listings. Unregistering the capability removes exactly its findings, because they arrive only through its own row.

## Map shape

One markdown table. Other prose in the file is ignored.

```markdown
| Key | Kind | Locations |
|---|---|---|
| `<literal key>` | <mirror | writer-parser | reference> | <path>, <path>, … |
```

- **Key:** a literal string, optionally backtick-quoted, that must not contain `|`. It matches by plain substring, with no pattern syntax.
- **Kind:** exactly one of `mirror` (the same statement held in several places), `writer-parser` (a format one location writes and another reads), or `reference` (defined once, referenced by literal elsewhere). The kind is a label only; it changes no computation.
- **Locations:** comma-separated, forward-slash, repo-relative paths. A path that is absolute, uses a backslash, or has a `..` segment is rejected.
- A malformed row (wrong cell count, empty key, unknown kind, or no valid location) is skipped and reported as a diagnostic. It is never guessed at.

## Change detection and listing

- The change is the working tree diffed against the audited base revision, dirty files included. Untracked files that were never added are not part of it.
- A declared key is **changed** when any added or removed line in the change contains it, in any file.
- For each changed key, every declared location is returned with the lines of its current content that contain the key. A location is tagged `changed` when a key-bearing changed line sits in it, and `missing` when it cannot be read.
- A listing is returned **only when at least one declared location is unchanged**. When every copy moved together, there is nothing to list.

## Distinctiveness

- A key shorter than **4** characters is too common to be distinctive. It is returned under `suppressed` with reason `too-short` and never listed.
- A listing whose unchanged locations hold more than **25** occurrences in total is returned `summarized: true`. Only the first **10** unchanged occurrences are named, with the full count in `total`.

## The tool

`list_counterparts({ workspaceRoot, baseRef })` is read-only and not always resident. `baseRef` is held to a plain revision shape: no leading `-`, no whitespace, no `..` range. It returns `{ status, mapPath, baseRef, listings[], suppressed[], diagnostics[] }` with one of four statuses:

| Status | Meaning |
|---|---|
| `listed` | The map was read and the change diffed. `listings` may still be empty. |
| `no-map` | No map is declared. Nothing is listed and no diff is taken; this is the inert default. |
| `no-diff` | The change is empty against the base. |
| `unavailable` | The base ref or the registry path was refused (a registry path that would place the map outside the workspace), or the diff could not be taken. This is never an empty success. |

## Severity and gating

Every counterpart finding is `warn` severity, marked `mechanical`, and advisory. The core gate map `gate-maps/counterparts.gate-map.md` records its one label as `advisory`. It never enters the blocking set, the critic, the finding ledger, or the verdict, and `/wf:verify-fix` skips it. A listed copy left unchanged on purpose is a normal outcome, so an unattended run converges past it.

## Known limit

The listing only covers what is declared or extracted. A contradiction between a changed section and unchanged prose in the same document, where no shared key exists, is outside it and remains a review lens's job.
