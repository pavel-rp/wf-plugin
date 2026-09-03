---
name: sweep-pr
description: Sweeps one already-shipped pull request for review threads and review comments that landed after its merge, verifies every claim against current source, and records exactly one disposition per finding - issue filed, verified-invalid, moot, unverifiable, or absent. Files each verified survivor through the active tracker naming the PR, the claim, and the verification evidence. Reads and files only; it fixes nothing in place. Use after a task has merged to catch feedback that arrived too late for the pre-merge gate.
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash, Task, Skill]
---

# /wf-review:sweep-pr — Catch the review that landed after the merge

Before any resolver MCP call, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit a parent root. Pass it explicitly on every call. Omitting `workspaceRoot` is a hard schema error; resolver MCP calls have no default or fallback root.

A capped-review merge does not wait indefinitely on a reviewer — correctly. The cost is that a
verdict landing *after* the caps and the merge is orphaned: nothing revisits a merged pull request's
threads. This skill is what revisits them, for **one** pull request. `/wf:fleet` does the same over a
whole run's merged set through its `fleet.closeout-review` composition point; both run the **same**
procedure, so the two can never drift apart.

This is a **native, user-invoked** feature skill: it fills no core seam, and installing the
wf-review pack is what makes the command discoverable. Its body, though, resolves this capability's
own shared procedure, so it additionally needs `pr-review` **registered** to run — see Prerequisites. It reaches the host **only** through the active **delivery** provider
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

**This skill additionally requires the `pr-review` capability to be registered.** Unlike its two
siblings, which reach only provider surfaces, its whole body is a capability-scoped
`resolve_content` call — so with `pr-review` unregistered that call does not resolve and the run
stops. Run `/wf-review:init` once after `/wf:init`.

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
- Read-side delivery operations: `current-branch-query`, `pr-detect`, `review-threads-read`,
  `pr-comments-read`. `pr-detect` is the identity probe the shared procedure's Step 1 uses. All are
  existing surface operations — this skill adds none.
- The tracker write operation `create_child`, strictly through the resolved provider, to file a
  verified survivor.
- `Read` / `Grep` / `Glob` to verify every candidate finding against current source — the
  load-bearing step, and the **only** tools that ever see review-derived pattern text: the `Grep`
  tool takes a pattern as a structured argument, whereas a shell `grep` would take it as a shell
  word. **`Bash` is authorized for exactly three purposes, and claim verification is not
  one of them**: **one real-path
  resolution per candidate** (`realpath` / `readlink -f`) to enforce the shared procedure's anchor
  bound — over an anchor whose every character the shared procedure requires to be drawn from `A`-`Z`, `a`-`z`, `0`-`9`, `.`, `_`, `/` and `-`, checked on the string first precisely because this resolution puts an untrusted path on a command line; and **one SHA-256 digest per ingested entry that carries no thread
  node id, at most one per entry in the 100-entry ingest** — anchorless comments, replies, and
  stale-thread inline comments alike. The budget is per *entry ingested*, not per surviving
  candidate, and its preimage is written to the fixed `_local/scratch/wf-sweep-digest.bin` and hashed there — never inlined into a command, since it is arbitrary commenter text. **The third `Bash` purpose is removing that file after each hash, regardless of outcome** — it is the one non-read-only purpose here, and the only mechanism that can delete it (`Write` creates and overwrites; it does not remove). It is denominated per entry because the shared procedure's Step 2 dedup mints the key while deduplicating, before the
  candidate cap exists, so a per-candidate grant would under-authorize it. The procedure applies that
  ingest cap **once** — the first 100 entries per pull request, in Step 2, after its cross-source
  dedup and before its within-source one — and
  that single set is what this grant is denominated in. That resolution is not optional decoration: `Read` and `Grep` follow a symlink silently and
  cannot report one, so without it the bound degrades to the lexical check the procedure itself
  says is insufficient.
- Invoke the **Task** tool with `subagent_type: wf:context-distiller` (`MODE: review`) to distil bulk
  thread and comment bodies in an isolated context; invoke `/wf:index` through the **Skill** tool to
  catalogue the run.
- Read-side tracker operation `get`, to confirm the task id resolves as its own umbrella when no
  `**Tracker umbrella:**` line is recorded.
- Write **only under `_local/`** — the `**Swept issues:**` single-shot-publish metadata line
  recording each filed issue's id in the task's own artifact, the `index.md` row the index
  writer edits inline, and the single short-lived `_local/scratch/wf-sweep-digest.bin` each
  idempotency digest is computed over — a **fixed** path, never one derived from a comment, written
  mode `0600`, hashed, and removed regardless of outcome; never an inlined command operand.

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

Every host read this skill invokes — `current-branch-query`, `pr-detect`, `review-threads-read`,
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

**Resolve the task folder at both of its locations.** A finalized task's folder does not stay put:
`/wf:tf` moves `{task-root}/{task-id}/` to `{task-root}/_archive/{task-id}/`, carrying every
artifact with it — and a sweep runs *after* finalize, so the archived location is the **normal**
one, not the exception. Every read below resolves `{task-root}/{task-id}/` **else**
`{task-root}/_archive/{task-id}/`, taking the first that exists. Reading only the active path would
leave every finalized task with no recorded identity and no filing parent.

1. **`<branch>`** — the argument if given, else `current-branch-query`. Its detached-HEAD signal (the
   literal `HEAD`) is not fatal here: carry no branch and continue to step 2.
2. **`<pr-ref>`** — the durable pull-request URL, read from the `**Merged PR:**` line of
   `09_finalize.md` in the resolved task folder (the merged reference `/wf:tf` records when it
   finalizes a task), resolved from the branch's task id when one is resolvable. That line carries
   one of five forms, and only two yield an identity:
   - `<url>` → take it verbatim.
   - `already merged (<url>)` → **extract the URL from inside the parentheses.** This is the norm
     whenever the merge was performed by `/wf:ship`'s finalize or on the host before `/wf:tf` ran,
     so treating it as unusable would discard the common case.
   - `skipped (…)` / `failed (…)` / the unreplaced placeholder → **no identity.** Carry none rather
     than passing a non-resolvable string into Step 1's probe.

   Absent file, no identity-bearing form, or no resolvable task folder at either location: carry none.

If **neither** identity is available, stop: `SWEEP-PR — No PR`, reason "No branch and no recorded
pull-request reference — nothing to sweep. Pass a branch: `/wf-review:sweep-pr <branch>`."

Then resolve the two filing inputs. Neither blocks the sweep — each is required only to **file**,
and the shared procedure degrades explicitly when one is absent:

3. **`<parent>`** — the tracker umbrella a filed survivor hangs beneath. Resolve it in this order and
   stop at the first hit: the `**Tracker umbrella:** <id>` metadata line in the resolved task
   folder's artifacts (both locations, per the rule above); else `{task-id}` itself when a tracker
   `get({task-id})` resolves it (the task id **is** its own umbrella in that case). If neither holds
   — a local `T<NNN>` task, or no tracker registered — **carry no parent.** Never substitute an
   unrelated item, and never mint a new umbrella here; minting is not this skill's job, and a
   finding filed under a guessed parent is worse than one reported unfiled.
4. **`<already-filed>`** — the `<key>`=`<issue-id>` pairs this skill filed for this pull request on
   an earlier run, read back from the `**Swept issues:** <key>=<id>, …` line of `09_finalize.md` in
   the resolved task folder. **Pairs, not bare ids:** a survivor has no issue id until it is filed,
   so a record of ids alone can never be matched against the candidate in front of you and every
   re-run would re-file everything.
   **That file is this record's one destination**, for both the read and the write — the same
   artifact `/wf:tf` already uses for its own single-shot-publish handles, so the sweep adds a line
   to an existing convention rather than inventing a home for one. On a **first** sweep of a task whose
   `09_finalize.md` exists, the line is simply not there yet: carry an **empty** record — the
   destination resolved, nothing in it. That is different from carrying **none**, which is reserved
   for having **no resolvable record destination at all** — no task folder, or no `09_finalize.md`
   in it. The three states map one-to-one: line present → the pairs; file present, line absent →
   empty; no file → none. Only the latter means no idempotency record
   was available, and only the latter should make the run report a duplicate risk; an ordinary first
   sweep has a perfectly good record that happens to be empty.

After the sweep returns, append each newly filed `<key>`=`<issue-id>` pair to that
`**Swept issues:**` line, **preserving
every id already recorded there** — the line accumulates across sweeps and is never overwritten with
only this run's ids. Overwriting would make the *next* sweep re-file everything an earlier one
already filed, which is precisely the duplicate this record exists to prevent. **Append the line
itself if the file exists but the line does not** — that is the first sweep of an already-finalized
task, and appending one line to an existing artifact is this skill's one `_local/` write besides the
index row.

**Never create `09_finalize.md` itself.** That artifact is `/wf:tf`'s, and tf gates its own template
write on the file being *absent* — so a sweep that created a bare one would suppress that write and
leave tf running without the single-shot-publish handles it reads back (`**Merged PR:**`,
`**Resolution comment:**`, `**Closed:**`) and without its model-attribution line. When the file does
not exist, no finalize has run: carry no `<already-filed>`, write nothing, and state in the output
that no idempotency record was available, so a re-run may duplicate. Reported, never silently
risked — and never bought by corrupting another skill's artifact.

**When no task folder resolves at either location**, carry no `<pr-ref>`, no `<parent>` and no
`<already-filed>`, and state in the run's output that no idempotency record was available — so a
re-run may duplicate. Reported, never silently risked.

## Phase 2 — Run the shared sweep procedure

Obtain the shared procedure's body with **one** call —
`resolve_content({ workspaceRoot, class: "fragment", capability: "pr-review", ref: "fragments/closeout-review.md" })`
— and **follow it as prose** in this skill's own context for that one pull request, passing all four
Phase 1 inputs: `<branch>`, `<pr-ref>`, `<parent>`, and `<already-filed>`.

**Act on the typed outcome; never improvise a sweep at this point.**

- **`{status: served, content}`** → follow the served `content` as prose, per the paragraph above.
- **`{status: unresolved}`** (registry-invalid / ref-not-found) or **`{status: refused}`** → stop with
  `SWEEP-PR — Error`, stating the resolver's reason and `/wf:resolve refresh` as the recovery path.
  Follow the content surface's degradation discipline — **never a wrong-path body, never a raw-read
  fall-through** to the fragment's file path. This skill has no inline default to fall back on: the
  procedure *is* the skill, so an unresolvable procedure is a stop, not a degraded run. The most
  likely cause is that the `pr-review` capability is not registered — see Prerequisites.

**Never re-implement it here.** The fragment is the single source of truth for the reachability
fallback, the distil-before-reasoning rule, the five-way disposition vocabulary, the filed-issue
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
  what was judged. Nothing is filed. **`Clean` requires `<n>` = 0, `<v>` = 0, and an `<a>` carrying no failure reason.**
`absent: no review present at read time` is an honest zero and stays `Clean`; `review read could not be performed`, `identity probe could not be performed` and `PR unreachable` are checks that did not run, and force `Partial` with that reason stated. A run whose candidates could not be read — no anchor,
a rejected anchor, a file that no longer opens, a source that could not be read — verified nothing, and renders `SWEEP-PR — Partial`, with a `Reason:`
line naming **which** of the four it was — a candidate with no anchor did not fail a containment
check, so a reason asserting one would be false. Those candidates are `unverifiable`,
never `verified-invalid`: the latter asserts a reading that did not happen. A truncated sweep renders
  `SWEEP-PR — Partial` however its judged candidates fell out: otherwise flooding a merged pull
  request with junk pushes a genuine finding past the cap and still yields the clean token, letting
  an arbitrary commenter choose a downstream-grepped verdict.
- **`create_child` fails for one survivor** — state one line naming the claim and the error, report
  it `unfiled — filing failed` with its full evidence, and continue with the remaining survivors;
  the run is `SWEEP-PR — Partial`. The survivor keeps its `issue filed` disposition, so it must
  still reach a render site.
- **The shared procedure cannot be resolved** (`unresolved` / `refused`) — stop with `SWEEP-PR —
  Error` naming the resolver's reason and `/wf:resolve refresh`. Never fall back to reading the
  fragment's path directly, and never improvise the sweep: this skill carries no inline default,
  because the procedure is the whole of it. Most often the `pr-review` capability is unregistered.
- **Re-running the sweep on the same pull request** — the single-shot-publish metadata lines are read
  back first, so an already-filed survivor is never filed twice.

---

## Final Output

Emit exactly one block as the very last thing in the transcript.

```
SWEEP-PR — <swept | Clean | Partial | dry-run | No PR | No provider | Error>

PR:           <the pull request swept, or "unreachable (<reason>)">
Reason:       <present on Partial, and on the No provider / No PR / Error variants below — incomplete (<n> not-judged, with reasons) | unverifiable (<v> — no anchor | anchor rejected | file no longer opens | source could not be read) | review read could not be performed | identity probe could not be performed | PR unreachable | filing failed; omit the line entirely otherwise>
Identity:     <branch <name> | recorded reference | none>
Review sweep: <f> found (<m> survivors, <k> invalid, <j> moot, <v> unverifiable), <a> absent, <n> not-judged
Filed:        <issue ids and links, one per line, or "none">
Unfiled:      <x> — <a stated reason per survivor; commonly no tracker registered, no filing parent resolved, filing cap reached, filing failed, not filed — dry run, or already filed (earlier run)>, evidence reported above | none
Next:         <address the filed issues with /wf:spec <id>, or "none — nothing survived verification">
```

No-provider / no-PR / error variants carry only the `Reason:` line under the status:

```
SWEEP-PR — <No provider | No PR | Error>

Reason: <one sentence — what stopped the run and the remedy>
Next:   <the remedy command>
```

**Status precedence.** More than one token can be true of a run, so they are ordered and the
**first** matching token is rendered: `Error` > `No provider` > `No PR` > `Partial` > `dry-run` >
`Clean` > `swept`. The two that had no rule: **`dry-run`** is a `--dry-run` run that was otherwise
complete and clean (a dry run that is truncated or carries an unverifiable candidate is `Partial`,
because the truncation is the more important fact); **`swept`** is the ordinary outcome — the run
completed and **at least one candidate survived verification**, whether or not it reached the
tracker; a survivor left unfiled for a **non-failure** reason — no tracker registered, no filing
parent resolved, filing cap reached, already filed on an earlier run — still renders `swept`, with the
`Unfiled:` line carrying its reason and evidence. A **filing failure** or a **dry run** is not one
of those: both are resolved by the precedence order above, which puts `Partial` and `dry-run` ahead
of `swept`. `Clean` is the completed run in which **nothing survived**. Tying `swept` to survivors rather than to writes is what keeps a tracker-free or dry
run from falling between the two tokens.

`Review sweep:` always states every count, `0` included — a sweep that found nothing renders
explicit zeros rather than the silence a reader would take for a clean pull request. `<f>` is the
number of candidates judged, and every candidate disposition is inside it: `<m> + <k> + <j> + <v>`
equals `<f>`. Two counts sit apart from that sum, for two different reasons — `<a>` records a review
that produced nothing to judge, and `<n>` items this run never judged at all, each with a stated
reason (past the procedure's ingest cap or its candidate cap, or the distiller returned no block for
it). `<x>` on the `Unfiled:` line is the count of survivors not written to a tracker, each with its
stated reason and its evidence reported above the block. **A non-zero `<n>` or `<v>`
means the sweep did not fully verify** — say so on the `Reason:` line rather than letting a
healthy-looking tally imply completeness.

`<m>` counts survivors, **not** tracker writes: a survivor that could not be filed still counts
there. That is why `Filed:` and `Unfiled:` are their own lines rather than something a reader
infers from `<m>` — the disposition records what the verification concluded, never whether a write
succeeded, and every unfiled survivor's evidence is reported above the block so nothing a
verification established is lost to a filing failure.

The block must always be the very last thing output to chat.
