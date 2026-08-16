---
name: preview-edit
description: Previews what a pending, uncommitted composition-affecting edit would do, by classifying the edit and then running the shipped resolver tool that can actually observe that class — a snapshot rebuild followed by a composition render for a capability manifest or registry edit, and a live manifest re-validation for a taxonomy-contract edit. Use when a capability manifest, the capability registry, or the taxonomy contract has been changed on disk and the effect of that change should be observed before it reaches a commit.
allowed-tools: [Read, Glob, Grep, Bash]
---

# /wf-core-authoring:preview-edit — see a pending composition edit before it is committed

An edit to a capability manifest, to the capability registry, or to the taxonomy contract changes how
composition behaves — and nothing reports that change until something downstream misbehaves. This skill
closes the gap: it classifies the **pending, uncommitted** edit and runs the shipped resolver tool that
can actually observe that class.

**Dry-run means uncommitted, not un-run.** The edit is on disk and is genuinely evaluated; version
control is the only thing that has not seen it. Nothing here stages, commits, stashes, or reverts.

**The taxonomy is cited, never restated.** For the phase set, the contribution kinds, and the
aggregation policy, invoke `/wf-author-caps:authoring-taxonomy` through the Skill tool. This body
defines none of them and is not the place to look them up.

---

## Contents

| Section | What it settles |
|---|---|
| [Command Syntax](#command-syntax) | the invocation shape and the zero-argument default |
| [Safety Rules](#safety-rules-non-negotiable) | what this surface may and may not do |
| [Phase 1](#phase-1-classify-the-pending-edit) | which arm each pending path routes to |
| [Phase 2](#phase-2-the-composition-arm--refresh-then-render) | the composition arm: refresh, then render |
| [Phase 3](#phase-3-the-taxonomy-arm--re-validate-and-nothing-else) | the taxonomy arm: re-validate, and nothing else |
| [Phase 4](#phase-4-report) | what the run reports |
| [Edge Cases](#edge-cases) | the stop and inert conditions |

Why each arm is sequenced the way it is — the asymmetry that makes the ordering load-bearing — lives in
`references/routing-rationale.md`, which is never read at runtime.

---

## Prerequisites

Before the first bundled resolver call, run `pwd -P` and use the returned absolute path as
`workspaceRoot` on every resolver call. In a linked worktree that cwd is this worktree — never inherit a
parent's root. Then obtain project config via `resolve_config({ workspaceRoot })`; its `registryPath` is
the resolved registry file this skill classifies against.

If the resolver reports the project is uninitialized, stop and direct the user to `/wf:init`. If the
resolver runtime is unavailable, stop and report that it is not loaded — never hand-parse the registry, a
manifest, or the contract as a fallback.

---

## Command Syntax

```
/wf-core-authoring:preview-edit [<path>]
```

| Argument | Required | Description |
|---|---|---|
| `<path>` | NO | One repo-relative path (forward slashes) to narrow the run to a single pending change. |

**Zero-argument default:** classify the working tree's own uncommitted change set — every path a
read-only version-control status query reports as modified, added, or untracked. This is the normal
invocation; the argument exists only to narrow a noisy tree.

**Validation:**

- `<path>` given but absent from disk — stop: the path names no file.
- `<path>` given but not in the pending change set — stop: "`<path>` has no pending change. Drop the
  argument to classify the whole pending set."

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file in the repository (`Read`, `Glob`, `Grep`).
- Obtain the pending change set through a **read-only** version-control status or name-only diff query.
- Call the resolver's `resolve_config`, `resolve_registry`, `resolve_inspect`, `resolve_refresh`,
  `preview_composition`, `validate_manifest`, and `validate_registry`.

**Forbidden:**

- Write, create, or delete any file. This surface declares no `Write` and no `Edit`; its whole result is
  the report it emits.
- Stage, commit, stash, revert, check out, or otherwise mutate version control.
- Run a build, a test suite, an install, or a lint.
- Route a taxonomy-contract edit to `preview_composition` (Phase 3).
- Render `preview_composition` on the composition arm without the `resolve_refresh` that precedes it
  (Phase 2).
- Re-derive any check a consumed validator already performs, or restate the phase set, the contribution
  kinds, or the aggregation policy — cite `/wf-author-caps:authoring-taxonomy` instead.

---

## Phase 1: Classify the pending edit

1. **Resolve the registry file.** Take `registryPath` from `resolve_config`; that resolved path is the
   registry. Never assume a location for it.
2. **Locate the taxonomy contract by role, not by a hardcoded path.** It is whatever `validate_manifest`
   reports in its own `ruleSources` — call it once, with no path, and hold that list.
3. **Obtain the pending change set.** With `<path>`, that one path; otherwise every path the read-only
   status query reports.
4. **Assign each pending path to a class:**
   - **Composition class** — the resolved registry file, or any capability `manifest.md`. These change
     what the resolver would resolve.
   - **Taxonomy class** — a doc named in `ruleSources`. These change the rules a manifest is judged
     against. Compare by the path's trailing segments, not by absolute equality: a resolved rule source
     may live inside an installed plugin's root rather than in the working tree, and Phase 3 reports that
     difference rather than hiding it.
5. **Route on the result:**
   - **Nothing pending** — inert. Report the empty set and stop; this is not an error.
   - **Neither class** — inert. Report each pending path as unclassified, name the two classes this
     surface can observe, and stop; this is not an error.
   - **One class** — run that arm.
   - **Both classes** — run **the taxonomy arm first, then the composition arm**, and report both. The
     composition arm performs the run's only state mutation, so running it last keeps the lifecycle
     bracket in Phase 2 unambiguous. Neither arm substitutes for the other.

---

## Phase 2: The composition arm — refresh, then render

1. **Announce the refresh before making it.** State that the next call rebuilds the resolved snapshot,
   that it is the run's only state mutation, and that it is deliberate.
2. **Call `resolve_refresh`.** This is **required, not incidental**: `preview_composition` renders purely
   off the already-resolved snapshot and re-parses no manifest, so without the refresh the render is the
   **pre-edit** composition presented as though it were current — the exact failure this surface exists to
   prevent. Never skip it, never reorder it, never call a render edit-aware without it.
3. **If the refresh reports the registry invalid**, report its diagnostics and stop this arm: a render off
   an invalid registry previews nothing. If the taxonomy arm was also selected it still runs.
4. **Read the lifecycle state** (`resolve_inspect`) immediately before the render.
5. **Call `preview_composition`.** Omit the phase argument so the whole fixed phase set renders; pass a
   single phase only when the caller narrowed to it.
6. **Read the lifecycle state again**, immediately after, and report both reads. **The no-mutation claim
   brackets this one call**: `preview_composition` is what leaves lifecycle state untouched. The
   `resolve_refresh` in step 2 changed it on purpose. Never make the claim over the surface as a whole.
7. **Report the render as the composition *as edited*** — per phase, every entry in the order the resolver
   returned it, naming the contributing capability, the contribution kind, the dispatch target, and the
   scope where one is present.
8. **Zero entries is a valid inert outcome, not an error.** Report a phase with no entries as inert and
   say so plainly. An empty registry renders zero entries everywhere and is reported the same way.

---

## Phase 3: The taxonomy arm — re-validate, and nothing else

1. **Call `validate_manifest` with no path**, so every active manifest is judged against the edited rules.
2. **No refresh on this arm.** `validate_manifest` derives its rules live from the ops doc on every call
   and consults no snapshot, so it observes a working-tree edit directly. A refresh here would mutate
   state for nothing.
3. **Report `ruleSources` verbatim**, and state for each whether it is the working-tree copy or a copy
   inside an installed plugin's root. If the rules were derived from a copy other than the one edited,
   say so plainly and report this arm as **inconclusive** — never as a verdict on the pending edit.
4. **Report each manifest's verdict and every finding.** When a pre-edit verdict set was captured before
   the edit was made, report the newly-failing and newly-passing manifests as the delta against it. When
   none was captured, report the absolute verdict set and state that the delta is unavailable — never
   present an absolute set as a delta.
5. **Never call `preview_composition` for this class.** It renders off the snapshot's already-parsed
   fragment rows, which a taxonomy edit does not touch; its output would be identical before and after and
   would read as "this edit changes nothing" — a false clean. State in the report that it was not run, and
   why.

---

## Phase 4: Report

Report, in this order: the pending set with each path's class; which arms ran and which did not, each
untaken arm named with its reason; the arm outputs from Phases 2 and 3; and the two bracketing lifecycle
reads. Report an inert outcome as inert and an inconclusive arm as inconclusive — never round either one
up to a clean verdict.

---

## Edge Cases

- **Nothing pending, or nothing in either class:** inert. Report it and stop — not an error, not a
  warning.
- **`<path>` names no file, or no pending change:** stop with the Validation message.
- **Project uninitialized:** stop and direct the user to `/wf:init`.
- **Resolver runtime unavailable:** stop and report it is not loaded. Never hand-parse as a fallback.
- **`resolve_refresh` reports the registry invalid:** the composition arm stops with the diagnostics
  surfaced; a selected taxonomy arm still runs.
- **`ruleSources` names a copy other than the edited one:** the taxonomy arm is inconclusive, and the
  report says which copy was read and which was edited.
- **A phase renders zero entries, or the registry is empty:** an inert outcome, reported as such.
- **A pending manifest edit belongs to a capability the registry does not activate:** it resolves to no
  active capability, so the render will not move. Report the path as classified but unregistered, rather
  than as a composition change that did nothing.
- **Both classes pending:** both arms run, taxonomy first, and both are reported.

---

## Final Output

```
PREVIEW-EDIT — <previewed | inert | stopped>

Pending:   <n> path(s) — <n> composition, <n> taxonomy, <n> unclassified
Arms:      <composition | taxonomy | both | none — reason>
Render:    <n> entries across <n> phases | not run — <reason>
Manifests: <n> checked, <n> pass, <n> fail | inconclusive — <reason> | not run — <reason>
Rules:     <the rule source(s) the verdict was derived from> | —
State:     <unchanged across the render | not bracketed — render not run>

Next: <the follow-up, or "none — nothing pending to preview">
```

**The final output block must always be the very last thing output to chat.**
