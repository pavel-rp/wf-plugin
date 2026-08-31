---
name: sweep-pr
description: Sweeps one already-shipped pull request for review threads and review comments that landed after its merge, verifies every claim against current source, and records exactly one disposition per finding - issue filed, verified-invalid, moot, or absent. Files each verified survivor through the active tracker naming the PR, the claim, and the verification evidence. Reads and files only; it fixes nothing in place. Use after a task has merged to catch feedback that arrived too late for the pre-merge gate.
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash, Task, Skill]
---

# /wf-review:sweep-pr — Catch the review that landed after the merge

Before any resolver MCP call, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

A capped-review merge does not wait indefinitely on a reviewer — correctly. The cost is that a
verdict landing *after* the caps and the merge is orphaned: nothing revisits a merged pull request's
threads. This skill is what revisits them, for **one** pull request. `/wf:fleet` does the same over a
whole run's merged set through its `fleet.closeout-review` composition point; both run the **same**
procedure, so the two can never drift apart.

This is a **native, user-invoked** feature skill: it fills no core seam and is reachable purely by
installing the wf-review pack. It reaches the host **only** through the active **delivery** provider
and files **only** through the active **tracker** provider; it names no concrete version-control,
host, or tracker tool. It is **read-only on source** — it reads, verifies, and files; remediation
stays with the issues it files.

**The one discipline: file nothing you have not verified against the real code.** A review comment is
a claim about the code. Before it becomes a tracker issue you open the actual file and lines it
concerns, **as they stand now**, and confirm the issue is real and still open. A hunch or a
pattern-match is not a finding.

**Model:** claude-opus-4-8

---

## Prerequisites

Confirm the project is initialized by calling the bundled `wf-resolver` MCP service's
`resolve_config({ workspaceRoot })` query — it returns `{ workspaceRoot, registryPath, coreConfig{…}, idShape }`,
already resolved (this skill performs **no** direct `_local/config.md` parse and **no**
`## Capabilities` registry read of its own). `{task-root}` comes from `coreConfig.taskRoot` — never
hardcode it. If `resolve_config` returns no usable project config — an empty `coreConfig` with no
`taskRoot` (the signal that `_local/config.md` is absent / the repo is uninitialized) — stop: "Run
`/wf:init` first." If the `wf-resolver` service is unavailable, stop and report that the resolver
runtime is not loaded (restart Claude Code) — do not hand-parse config as a fallback.

---

## Command Syntax

```
/wf-review:sweep-pr [<branch>] [--dry-run]
```

| Argument    | Required | Description                                                                                        |
| ----------- | -------- | -------------------------------------------------------------------------------------------------- |
| `<branch>`  | NO       | The branch whose pull request to sweep. Defaults to the current branch (via `current-branch-query`). |
| `--dry-run` | NO       | Verify and dispose, but file nothing — print the dispositions and tally to chat instead.            |

Zero-argument invocation sweeps the pull request for the current branch.

---

## Safety Rules

**Allowed:**

- Call the bundled `wf-resolver` MCP tools `resolve_config({ workspaceRoot })`,
  `resolve_provider({ workspaceRoot, surface })` for the `delivery` and `tracker` surfaces, and
  `resolve_content({ workspaceRoot, ... })` (`class: fragment`) to obtain an operation's or the shared
  procedure's body.
- Read-side delivery operations: `current-branch-query`, `review-threads-read`, `pr-comments-read`.
- The tracker write operation `create_child`, strictly through the resolved provider, to file a
  verified survivor.
- `Read` / `Grep` / `Glob` / `Bash` (grep) to verify every candidate finding against current source
  — the load-bearing step.
- Invoke the **Task** tool with `subagent_type: wf:context-distiller` (`MODE: review`) to distil bulk
  thread and comment bodies in an isolated context; invoke `/wf:index` through the **Skill** tool to
  catalogue the run.
- Read-side tracker operation `get`, to confirm the task id resolves as its own umbrella when no
  `**Tracker umbrella:**` line is recorded.
- Write **only under `_local/`** — the `**Swept issues:**` single-shot-publish metadata line
  recording each filed issue's id in the task's own artifact, and the `index.md` row the index
  writer edits inline.

**Forbidden:**

- Editing any source file — this skill sweeps and files, it does not fix. Remediation belongs to the
  issues it files, under the ordinary gated plan-then-implement flow.
- Writing any file outside `_local/`.
- Filing a finding you have not confirmed against current source. Unverified claims are dropped, not
  hedged into the tracker — laundering reviewer noise into the tracker is worse than the silence this
  skill replaces.
- Resolving or replying to a review thread, merging, or any destructive delivery operation. This
  skill only reads and files.
- Writing any concrete version-control, host, or tracker command or tool name in reasoning or output
  — name only the abstract provider operations above.
- Any AI-attribution, "generated with" footer, emoji tagline, or promotional content in a filed
  issue. Write like a human.

---

## Provider resolution — delivery surface (resolve once)

Every host read this skill invokes — `current-branch-query`, `review-threads-read`,
`pr-comments-read` — is a **`delivery`-surface** operation. Resolve the surface **once** by calling
`resolve_provider({ workspaceRoot, surface: "delivery" })` — the typed query returning the run-scoped
record `{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already
resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any
plugin-anchored root; this skill performs **no** registry / manifest / plugin-root read of its own.
Obtain each operation's body via `resolve_content` from that record and follow it in this skill's own
context.

Sweeping is this skill's whole purpose and it cannot be done without a host, so a missing provider is
a **stated no-op**, never a silent pass. On `state: ok`, dispatch every operation against the
resolved record. Otherwise return `SWEEP-PR — No provider` and split the reason by state:

- **`unconfigured`** — no capability owns the `delivery` surface: "No delivery provider is
  registered — no pull request can be read, so no sweep ran. Register a capability that owns the
  `delivery` surface (e.g. install and run `/wf-git:init`)." Zero reads attempted, zero tracker
  writes.
- **`unrecoverable`** — a registered capability owns the surface but its manifest can't be read. The
  record's `owner` names that capability and its `diagnostics` carries any detail. Surface it as a
  hedged **candidate** — "the registered `delivery` owner `<owner>` is currently unrecoverable; if it
  is your delivery provider, fix its stale root / re-run its init." Never assert it is definitely at
  fault.

## Provider resolution — tracker surface (resolve once, optional)

Filing goes through the **`tracker`** surface's `create_child`. Resolve it once via
`resolve_provider({ workspaceRoot, surface: "tracker" })`. A tracker is **optional**: when the
surface is unconfigured or unrecoverable the sweep still reads, verifies, and disposes — a survivor
is recorded `issue filed` **unfiled — no tracker registered** and its full evidence is reported in
this skill's own output, so no finding is lost. Never skip the verification because there is nowhere
to file.

---

## Phase 1 — Resolve the pull request's identity

The sweep runs **after** a merge, so the source branch may no longer exist — a repository's own
auto-delete-on-merge setting can remove one `wf` never touched. Assemble both identities the shared
procedure accepts:

1. **`<branch>`** — the argument if given, else `current-branch-query`. Its detached-HEAD signal (the
   literal `HEAD`) is not fatal here: carry no branch and continue to step 2.
2. **`<pr-ref>`** — the durable pull-request number or URL, read from the task's own
   `**Pull request:**` metadata line in `{task-root}/{task-id}/`, resolved from the branch's task id
   when one is resolvable. Absent is fine; carry none.

If **neither** identity is available, stop: `SWEEP-PR — No PR`, reason "No branch and no recorded
pull-request reference — nothing to sweep. Pass a branch: `/wf-review:sweep-pr <branch>`."

Then resolve the two filing inputs. Neither blocks the sweep — each is required only to **file**,
and the shared procedure degrades explicitly when one is absent:

3. **`<parent>`** — the tracker umbrella a filed survivor hangs beneath. Resolve it in this order and
   stop at the first hit: the `**Tracker umbrella:** <id>` metadata line in the task's own artifacts
   under `{task-root}/{task-id}/`; else `{task-id}` itself when a tracker `get({task-id})` resolves
   it (the task id **is** its own umbrella in that case). If neither holds — a local `T<NNN>` task, or
   no tracker registered — **carry no parent.** Never substitute an unrelated item, and never mint a
   new umbrella here; minting is not this skill's job, and a finding filed under a guessed parent is
   worse than one reported unfiled.
4. **`<already-filed>`** — the ids this skill filed for this pull request on an earlier run, read
   back from the `**Swept issues:** <ids>` metadata line in the task's own artifact (the
   single-shot-publish convention). Absent on a first sweep; carry none.

After the sweep returns, append each newly filed id to that `**Swept issues:**` line — the one
`_local/` write this skill makes besides the index row, and what makes a re-run file no duplicate.

## Phase 2 — Run the shared sweep procedure

Obtain the shared procedure's body with **one** call —
`resolve_content({ workspaceRoot, class: "fragment", capability: "pr-review", ref: "fragments/closeout-review.md" })`
— and **follow it as prose** in this skill's own context for that one pull request, passing all four
Phase 1 inputs: `<branch>`, `<pr-ref>`, `<parent>`, and `<already-filed>`.

**Never re-implement it here.** The fragment is the single source of truth for the reachability
fallback, the distil-before-reasoning rule, the four-way disposition vocabulary, the filed-issue
shape, and the tally. `/wf:fleet` follows the same body over a whole merged set; a second copy of
this logic is exactly the drift this arrangement exists to prevent.

Under `--dry-run`, follow the procedure through verification and disposition but **file nothing** —
print each disposition and the tally instead, and report what *would* have been filed.

## Phase 3 — Index

Invoke `/wf:index` through the **Skill** tool (when a resolvable task folder exists for this branch)
to catalogue the run under the `sweep-pr` slot; its wrapper writes `index.md` inline. A stale index
loses nothing, so an `INDEX — Error` never fails the run.

---

## Edge Cases

- **No readable delivery provider** — handled up front by Provider resolution (`SWEEP-PR — No
  provider`, two-mode diagnosis); no host operation is attempted and nothing is filed. A **stated**
  no-op, never a silent pass.
- **No tracker registered** — the sweep still reads, verifies, and disposes; survivors are reported
  `unfiled — no tracker registered` with their full evidence rather than dropped.
- **No filing parent resolvable** — no `**Tracker umbrella:**` line and the task id does not resolve
  as its own umbrella (a local `T<NNN>` task) → survivors are reported `unfiled — no filing parent
  resolved` with their full evidence. A parent is never guessed and an umbrella is never minted here.
- **More survivors than the filing cap** — the overflow is reported `unfiled — filing cap reached`
  with full evidence and an explicit count, never silently filed or silently dropped.
- **Neither identity resolves** — the branch is gone and no pull-request reference was ever recorded
  → the procedure records `absent: PR unreachable (branch deleted, no recorded PR reference)`. Never
  silent, and never folded into `moot`.
- **`<read-performed>` = false** — the review read could not be performed → recorded `absent: review
  read could not be performed`. This is **not** "no findings"; a clean claim requires a performed
  read.
- **A performed read with an empty thread set and no review comments** — an honest zero, recorded
  `absent: no review present at read time` and reported as such.
- **Every candidate dropped against current source** — a legitimate and expected outcome (the C029
  triage dropped roughly 60%) → `SWEEP-PR — Clean`, with the `<invalid>` / `<moot>` counts stating
  what was judged. Nothing is filed.
- **`create_child` fails for one survivor** — state one line naming the claim and the error, report
  its evidence, and continue with the remaining survivors; the run is `SWEEP-PR — Partial`.
- **Re-running the sweep on the same pull request** — the single-shot-publish metadata lines are read
  back first, so an already-filed survivor is never filed twice.

---

## Final Output

Emit exactly one block as the very last thing in the transcript.

```
SWEEP-PR — <swept | Clean | Partial | dry-run | No PR | No provider | Error>

PR:           <the pull request swept, or "unreachable (<reason>)">
Identity:     <branch <name> | recorded reference | none>
Review sweep: <f> found, <m> filed, <k> invalid, <j> moot, <a> absent
Filed:        <issue ids and links, one per line, or "none">
Unfiled:      <n> — <no filing parent resolved | no tracker registered | filing cap reached>, evidence reported above | none
Next:         <address the filed issues with /wf:spec <id>, or "none — nothing survived verification">
```

No-provider / no-PR / error variants carry only the `Reason:` line under the status:

```
SWEEP-PR — <No provider | No PR | Error>

Reason: <one sentence — what stopped the run and the remedy>
Next:   <the remedy command>
```

`Review sweep:` always states all five counts, `0` included — a sweep that found nothing renders
explicit zeros rather than the silence a reader would take for a clean pull request. `<f>` is the
number of candidates judged, so `<m> + <k> + <j>` equals it; `<a>` is counted apart because it
records a review that produced nothing to judge rather than a candidate that was dismissed.

The block must always be the very last thing output to chat.
