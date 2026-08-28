# C029 OUT-8 — re-test of the four never-re-tested dispatch behaviours

**Kind:** findings note — **no runtime code.** Not read at skill runtime.
**Model:** claude-opus-5[1m]
**Written:** 2026-08-28
**Covers:** C029 (WF-480) outcome **OUT-8**, sub-task **WF-481**. Gates OUT-1…OUT-7 and OUT-9.
**Subject:** the four behaviours [`docs/c011-fleet-run-diagnostic.md`](./c011-fleet-run-diagnostic.md) §10
lists as *"not re-tested this run"*.
**Diff baseline:** cached wf **0.116.0** (the harness the C011 run actually executed) against current
`main` at **0.117.0** (`69cf868`).

**Cite this note, not the diagnostic, for §10 behaviour.** The diagnostic remains the citation for
what it *measured*; from here on it is superseded on all four §10 items.

---

## Table of contents

1. [Why this note exists](#1-why-this-note-exists)
2. [Method](#2-method)
3. [Verdicts at a glance](#3-verdicts-at-a-glance)
4. [B1 — the `wf:phase-runner` cwd fallback](#4-b1--the-wfphase-runner-cwd-fallback)
5. [B2 — `Agent(isolation: "worktree")`](#5-b2--agentisolation-worktree)
6. [B3 — `EnterWorktree`](#6-b3--enterworktree)
7. [B4 — `/wf:branch`'s base switch](#7-b4--wfbranchs-base-switch)
8. [Which prohibitions are now stale](#8-which-prohibitions-are-now-stale)
9. [The two desk-confirmed contradictions](#9-the-two-desk-confirmed-contradictions)
10. [Scope escalations](#10-scope-escalations)
11. [Caveats](#11-caveats)

---

## 1. Why this note exists

The C011 diagnostic's headline finding is that an 11½-hour unattended run hard-coded
*already-fixed* defects into all 16 dispatch briefs, because nothing in the run resolved or
reported the plugin version it was executing (§8). Its §10 then lists four further behaviours that
were **inherited as lore from an earlier run, written into the briefs as prohibitions, and never
exercised** — so their status was, by the diagnostic's own admission, unknown.

C029 specifies remediation against those behaviours. Specifying against unknown status is exactly
the failure the diagnostic describes, one level up. OUT-8 therefore runs **first** and gates every
other outcome in the programme.

This note is a **routing decision point, not a work queue.** Where a behaviour is found still live,
the finding is raised in §10 as an explicit scope escalation. It is not absorbed into any sub-task.

## 2. Method

Three evidence tiers, kept separate and labelled per verdict:

| Tier | How obtained |
|---|---|
| **Source diff** | `diff` of the cached 0.116.0 tree against the current `main` worktree, per file |
| **Contract read** | The behaviour's governing ops-contract text, quoted with file and line |
| **Live probe** | The behaviour actually exercised in this session, under the shape C011 used or the shape the harness mandates |

Verdict vocabulary, from WF-481's spec: `still-broken` · `fixed` · `never-was` · `unverifiable`.
A behaviour whose verdict cannot be established without a full fleet dispatch is recorded
`unverifiable` **with its reason**, never silently asserted.

Two of the four behaviours (**B2**, **B3**) are properties of the **host runtime**, not of wf
source. For those the wf-version diff is *not* the determinant and a source diff would be vacuous;
the live probe is the evidence, and the note says so rather than manufacturing a delta.

**On the file-and-line requirement.** WF-481 asks each verdict to carry file-and-line evidence.
**B1** and **B4** do, because they are wf-source behaviours. **B2** and **B3** carry no wf file or
line **because no wf file governs them** — quoting one would be false precision pointing at the
wrong layer. Their evidence is a reproducible live probe plus, for B3, the runtime's own published
tool schema, both quoted in full below. This substitution is recorded here rather than passed off
silently, and it is the reason each verdict states its evidence tier.

**Reachability.** The cached 0.116.0 tree was still present at
`~/.claude/plugins/cache/wf-marketplace/wf/0.116.0/`, so WF-481's fallback (current-state verdict
alone) was **not** needed — every verdict below carries a real 0.116.0-vs-`main` delta.

## 3. Verdicts at a glance

| Id | §10 behaviour | Verdict | 0.116.0 → `main` delta | Evidence tier |
|---|---|---|---|---|
| **B1** | `wf:phase-runner` cwd fallback (the F2/F3 cause) | **still-broken (conditional)** — unchanged in wf; reproduces only in the unisolated dispatch shape | **none** — `agents/phase-runner.md` is byte-identical | source diff + contract read + live probe |
| **B2** | `Agent(isolation: "worktree")` | **fixed** | host-side; not wf-versioned | live probe |
| **B3** | `EnterWorktree` | **fixed** | host-side; not wf-versioned | live probe (tool schema) |
| **B4** | `/wf:branch`'s base switch checking out trunk | **never-was** | none — no cached version ever checked out a base | contract read (all cached versions) |

**Three of the four prohibitions in the dispatch brief are stale.** One behaviour remains live, and
it is the one the charter deliberately defers.

## 4. B1 — the `wf:phase-runner` cwd fallback

> §10: *"The `wf:phase-runner` cwd fallback (F2) — forbidden by brief, never triggered."*

### Verdict: `still-broken (conditional)`

**Source diff — no change at all.** `diff` of
`~/.claude/plugins/cache/wf-marketplace/wf/0.116.0/agents/phase-runner.md` against
`plugins/wf/agents/phase-runner.md` on current `main` produces **empty output**. The file is
byte-identical. Whatever F2/F3 observed in 0.116.0, wf has not changed it.

**Contract read — the mechanism is `pwd -P`.** `plugins/wf/agents/phase-runner.md:46`:

> *"Before the first bundled resolver call, run `pwd -P` once and retain the absolute result as
> `workspaceRoot`."*

So the agent's resolved workspace is **entirely determined by what `pwd -P` returns inside the
dispatched subagent**. There is no wf-side fallback, heuristic, or override to be broken or fixed —
the behaviour is inherited from the host's subagent cwd semantics. This matters for how the
remediation is scoped: B1 is not a resolver defect and not a prose defect.

**Live probe — the cwd is correct under runtime isolation.** An agent dispatched in this session
with `isolation: "worktree"` reported:

- `pwd -P` → its own worktree
- `git rev-parse --show-toplevel` → **the same** worktree (not a parent checkout)
- `git rev-parse --git-common-dir` → the parent repository's `.git`, as a linked worktree should

A resolver call made from this shipper's own worktree likewise returned that worktree as
`workspaceRoot`, not the shared checkout.

**Live probe — a nested subagent inherits the pinned worktree cwd.** Separately, a `wf:branch`
subagent was dispatched from this shipper's worktree-pinned context **without** any `isolation`
parameter — the nesting shape a `wf:phase-runner` occupies under `/wf:ship`. It reported:

- `pwd -P` → this shipper's worktree
- `resolve_config({workspaceRoot})` → **the same** worktree, not the shared checkout

The `pwd -P` value is the load-bearing datum: it is factual shell output from that agent's own
context, and it shows the host pinned the child to the parent agent's worktree rather than
defaulting it to the launch checkout. Its git writes were independently observed landing in this
worktree. **Caveat, stated rather than glossed:** that probe was given an explicit workspace-binding
instruction and told to target git by absolute path, so the *git targeting* is attributable to the
instruction; only the `pwd -P` and resolver values are clean evidence of inherited cwd.

**Why the verdict is conditional.** F2/F3 are reproducible only under the dispatch shape the C011
run actually used, and that shape was itself a workaround for B2. Per the diagnostic's F5, all 16
shippers ran `subagent_type: "claude"` with **no** `isolation` and no `run_in_background`, inside
worktrees created by hand with `git worktree add`. A subagent dispatched that way is not given a
worktree by the runtime, so its cwd is whatever the host hands it — the shared checkout — and a
`wf:phase-runner` nested below it inherits that, finds no task folder, and returns blocked. That is
F2 exactly.

Under the shape `plugins/wf/skills/fleet/SKILL.md:158` actually **mandates** — `isolation: worktree`
— the precondition is removed: the probe above shows the dispatched agent receives a genuine,
registered worktree and reports it correctly. Since **B2 is now fixed** (§5), the mandated shape is
available, and the workaround that created B1's precondition is no longer necessary.

**What this does and does not license.** It does **not** license recording B1 as fixed: the wf
source is unchanged, and no end-to-end `/wf:ship`-under-fleet-dispatch run was performed here to
confirm the full chain completes. The honest reading is that B1's *cause* is unchanged in wf and
still live in the unisolated shape, while its *precondition* has been removed by a host-side fix
outside this programme's control. Confirming the chain end-to-end requires a full fleet dispatch,
which WF-481's scope excludes — see the `unverifiable` residual recorded in §10.

## 5. B2 — `Agent(isolation: "worktree")`

> §10: *"`Agent(isolation: "worktree")` (F5) — explicitly recorded as 'has not been re-tested'."*

### Verdict: `fixed`

**This is a host-runtime capability, not wf source**, so there is no meaningful 0.116.0-vs-`main`
wf delta to report; the C011 observation and this one are separated by a host upgrade, not a plugin
release. Recorded as such rather than dressed up as a plugin fix.

**Live probe.** An agent dispatched with `isolation: "worktree"` in this session returned:

- `pwd -P` → `…/.claude/worktrees/agent-<id>` — its own directory
- `git rev-parse --show-toplevel` → **the same path**
- `git rev-parse --abbrev-ref HEAD` → its own dedicated branch, not the trunk and not the parent's
- `git worktree list` → the directory appears as a **registered, locked** worktree

**This directly refutes F5's recorded rationale.** F5 stated the runtime *"evaluates the container
directory as the worktree root and git discovers the parent checkout above it."* It does not: the
probe's `--show-toplevel` resolves to the agent's own worktree, and the directory is a registered
worktree rather than a bare directory nested inside another checkout. Concurrent isolation also
held — the probe observed this shipper's worktree and its own as two distinct registered entries.

Consequently `plugins/wf/skills/fleet/SKILL.md:158`'s mandated dispatch shape
(`isolation: worktree`) is **executable as written**. The hand-rolled `git worktree add` workaround
C011 fell back to is no longer required.

**Bearing on OUT-3 (F4).** OUT-3's charter text already flags that current resolver source does not
obviously exhibit the F4 mechanism, and predicts the observed behaviour is *"more consistent with
F5's rationale … than with a family-root return."* This note's probe supports the first half of
that prediction and removes the second: resolver calls from two distinct worktrees returned two
distinct roots. OUT-3 should treat its reproduction step as likely to come back **negative**, which
its own first success measure already admits as a valid result.

## 6. B3 — `EnterWorktree`

> §10: *"`EnterWorktree` — not attempted."*
> F5: *"`EnterWorktree` was denied in two shapes."*

### Verdict: `fixed`

**Host-runtime capability**, as B2 — no wf version delta applies.

**Live probe.** The `EnterWorktree` tool is present and its schema resolves in this session. Two
clauses in that schema address the C011 denials directly:

1. *"Must not already be in a worktree session when creating a new worktree (`name`); **switching
   into another existing worktree via `path` is allowed**."*
2. *"Switching with `path` also works … **from agents whose working directory was pinned at launch
   (subagent isolation or explicit cwd)**. In both cases the target must be a worktree under
   `.claude/worktrees/` of the same repository, and from a pinned agent the switch only affects
   this agent, not the parent session."*

The two shapes F5 recorded as denied are the two the schema still refuses or now explicitly
supports: creating a *new* worktree by `name` from inside an existing worktree session remains
refused **by design**, while entering an *existing* worktree by `path` — including from a pinned
subagent — is now explicitly supported.

**The prohibition is stale, but the capability is narrower than "it works now."** `EnterWorktree`
is usable only in its `path` form, only against a worktree already registered under
`.claude/worktrees/` of the same repository. Any downstream sub-task citing this verdict must cite
that shape, not a general one.

**Not exercised destructively.** The tool was resolved but deliberately **not invoked** — entering
a worktree would have moved this shipper's own session mid-run. The verdict rests on schema
availability plus the explicit pinned-agent clause, which is sufficient to retire the prohibition
and insufficient to promise a working end-to-end rebind. Recorded honestly rather than overclaimed.

## 7. B4 — `/wf:branch`'s base switch

> §10: *"`/wf:branch`'s base switch checking out trunk — never invoked."*
> The dispatch brief, `plugins/wf/skills/fleet/SKILL.md:167`: *"Cut your branch from the latest
> delivery base — NOT via a harness 'branch' skill, whose base switch checks out the trunk and
> breaks in a worktree."*

### Verdict: `never-was`

**The prohibition describes behaviour that does not exist, and never did in any cached version.**

**Contract read.** `/wf:branch` derives a name and delegates every git operation to the delivery
provider's `branch-create`. That operation's **step 6**, at
`plugins/wf-git/capabilities/git/fragments/delivery.ops.md:26` (contract version 1.7.0), reads
**identically** in every cached `wf-git` version — 0.7.0, 0.7.1, and 0.8.0, all at line 26:

> *"**Create and switch.** With a remote: `git checkout -b <branch-name> origin/<base>`,
> `<base-source>` = `origin/<base>`. Without: `git checkout -b <branch-name> <base>`."*

`git checkout -b <branch-name> origin/<base>` creates **and** switches to the *task* branch in one
command, using `origin/<base>` only as a start-point revision. **The base is never checked out.**
Nothing in the operation's other steps checks one out either — step 4 determines the base with
`git rev-parse --verify main`, a read-only ref check, and step 5 reaches the remote with
`git fetch origin <base>`, a fetch. Neither moves `HEAD`.

**Why it is worktree-safe.** The one git operation that genuinely fails in a linked worktree is
checking out a branch already checked out elsewhere. `git checkout -b` creates a *new* branch,
which by definition is not checked out anywhere, so the create path cannot trip that. The
prohibition's stated mechanism — *"breaks in a worktree"* — has no basis in the contract.

**0.116.0 → `main` delta.** `agents/branch.md` did change, but in the opposite direction from the
prohibition: the WF-479 fix added an **already-active name substitution** so that a caller already
sitting on a task branch whose name the agent would not itself derive (a tracker-prefixed
`feat/{task-id}-…` shape) is matched on `/{task-id}-` case-insensitively and handed straight to
`branch-create`'s exact-name match. That path returns `already-active` with, per the contract's
step 1, *"no checkout happens, so nothing is ever captured."* The current harness is therefore
**strictly safer** on this behaviour than the one C011 measured, and the prohibition was already
false against the version it was written for.

**Live probe — the prohibition is refuted directly.** `/wf:branch` was invoked through the ceremony
for this very task, from inside this shipper's **linked worktree**, while already sitting on a
tracker-shaped branch. The delivery provider reported the two git commands it actually ran:

- `git fetch origin main` — a **fetch**. `HEAD` does not move.
- `git checkout -b <task-branch> origin/main` — a **create-and-switch to the new task branch**,
  with `origin/main` as start-point only.

`HEAD` moved from the previous task branch **directly to the newly created task branch**. At no
point was `main` checked out. The operation also **completed successfully inside a linked
worktree** — it did not "break in a worktree" as `:167` alleges. Both halves of the prohibition are
false, observed live on current `main`, not merely inferred from the contract.

**An adjacent defect surfaced by the same probe — see ESC-5.** The invocation did *not* return
`already-active` as expected. Because no task folder existed for the id, `agents/branch.md` step 1's
zero-folder-match path held the **bare numeric token** as `{task-id}`, collapsing `{task-id}` onto
`{numeric-id}`; the WF-479 already-active substitution is gated on those two **differing**, so the
gate skipped, derivation fell through to step 2, and a **redundant second branch was minted** from
`origin/main`. That is a real defect, it is not B4, and it is raised in §10 rather than fixed here.

**Accepted residual, distinct from the claim.** `branch-create` step 3 does run a plain
`git checkout <branch-name>` when a branch of that exact name already exists locally. If *that*
branch is checked out in another worktree, git refuses. This is a real edge, it is **not** the
"base switch checks out the trunk" the brief alleges, and it does not arise on the create path or
the already-active path. Downstream sub-tasks should not conflate the two.

## 8. Which prohibitions are now stale

WF-482 owns the brief edits; this section states only **what the evidence shows**, so that
sub-task's diff has a citable basis. Line numbers are read-date evidence (2026-08-28) — the edits
must anchor on quoted text, since WF-482 and OUT-9 both rewrite this file.

| Brief text | Location | Status | Basis |
|---|---|---|---|
| *"NOT via a harness 'branch' skill, whose base switch checks out the trunk and breaks in a worktree"* | `fleet/SKILL.md:167` | **stale — remove** | B4: no cached version ever checks out a base |
| The implicit prohibition on `Agent(isolation: "worktree")` carried from C010 lore | dispatch-brief lore | **stale — remove** | B2: the runtime honours it; `:158` already mandates it |
| The implicit prohibition on `EnterWorktree` | dispatch-brief lore | **stale — remove**, but only for the `path` form | B3: `path` form supported from pinned agents; `name` form still refused by design |
| The `wf:phase-runner` cwd prohibition | dispatch-brief lore | **KEEP** | B1: unchanged in wf; still live in the unisolated shape |

**One prohibition survives the re-test.** The B1 prohibition is the only one of the four that is
still doing real work, and it must not be swept out with the other three. A blanket "delete the §10
lore" edit would reintroduce F2.

## 9. The two desk-confirmed contradictions

Both sit inside OUT-8's lore-deletion. This note supplies the resolving evidence; WF-482 applies
the edit.

**Contradiction 1 — the brief forbids the branch skill while mandating a skill that invokes it.**
`fleet/SKILL.md:167` forbids the harness branch skill; `fleet/SKILL.md:175` simultaneously mandates
driving the merge **through `/wf:ship`**, and `/wf:ship`'s own Phase 2 step 1 invokes `/wf:branch`
as its branch gate. A shipper obeying both instructions cannot exist.

**Resolved in favour of `:175`.** Per B4 the `:167` prohibition is factually false, so the
contradiction dissolves by deleting the false half. `/wf:ship` invoking `/wf:branch` is correct and
stays.

**Contradiction 2 — the ceremony chain names a phase that does not exist.**
`fleet/SKILL.md:175` advertises the chain as *"spec → plan → tasks → implement → verify → qa"*.

**Resolved: `tasks` is not in the graph.** A grep of `plugins/wf/skills/run/SKILL.md` on current
`main` returns **zero** occurrences of `tasks`. The graph the file actually draws
(`run/SKILL.md:77`) is `triage ─► spec ─► plan ─► implement ─► verify-spec`, and its auto-front set
is `triage` / `spec` / `plan` / `verify-spec` / `qa-gen` (`run/SKILL.md:61`, `:90`). `/wf:tasks` is
a real skill, but `/wf:run` never routes to it and `wf:phase-runner` neither maps nor knowingly
refuses it — matching the diagnostic's §4 observation that `03_tasks.md` was produced **0** times
across 16 items.

This independently corroborates the charter's own settled decision (assumption 27) that
`tasks/SKILL.md` is **not** in OUT-2's receipt-bearing set. The corrected chain should name the
phases `/wf:run` actually walks.

## 10. Scope escalations

Raised here, deliberately **not** absorbed into any sub-task — per WF-481's spec and the charter's
matching risk row.

**ESC-1 — B1's cause is live, and remediating it is out of scope for C029.**
The charter already defers this by name: F2/F3's cause is *"OUT of scope for this programme"*, and
its status was routed to this note. The verdict is that the cause is **unchanged in wf source** and
still reproduces in the unisolated dispatch shape.

The charter's **stated cost stands, with one material qualification.** The charter warns that while
the cause is live, `/wf:ship` cannot complete under fleet dispatch, so OUT-2 can ship a sound proof
mechanism and every item still be recorded `unproven`. This note does not overturn that, but it
narrows it: because **B2 is fixed**, the mandated `isolation: worktree` dispatch shape now works,
and under that shape a dispatched agent's cwd resolves correctly. The precondition for F2 is
therefore removed for any run that uses the shape `fleet/SKILL.md:158` already mandates.

**The cheap probe this implies, offered as a routing option and not as work:** before OUT-2 is
specified against a pessimistic `unproven` assumption, a single `/wf:ship` invocation under a
genuinely runtime-isolated dispatch would settle whether the chain now completes. If it does, the
charter's headline deferral cost largely evaporates and OUT-2's operator-visible value returns.
That probe is **not** performed here — it requires a full fleet dispatch, which WF-481's scope
excludes.

**ESC-2 — `EnterWorktree(path:)` is a concrete, available remedy for B1, and nothing in C029 owns
it.** B3 established that a subagent whose cwd was pinned at launch may rebind itself to an existing
worktree under `.claude/worktrees/` of the same repository. That is precisely the capability a
mis-rooted `wf:phase-runner` would need. Whether wf *should* adopt it is a design question in the
subagent dispatch/cwd layer — not the resolver boundary OUT-3 owns, and not a §11 recommendation.
Flagged so it is not silently absorbed into OUT-3, whose scope is the resolver only.

**ESC-3 — an `unverifiable` residual on B1's end-to-end status.** B1's verdict covers the *cause*
(unchanged) and its *precondition* (removed under the mandated shape). It does **not** cover whether
`/wf:ship`'s full chain completes end-to-end under fleet dispatch on current `main`. That is
recorded **`unverifiable` within this sub-task's scope**, with the reason: establishing it requires
running a full fleet dispatch, which WF-481's Scope OUT excludes and which no desk read can
substitute for.

**ESC-5 — `/wf:branch` mints a redundant branch when the task folder is absent.** Newly discovered
while live-probing B4; **not** a §10 behaviour and **not** in any C029 outcome, so it is raised, not
absorbed.

`agents/branch.md` step 1's zero-folder-match path holds the **bare numeric token** as `{task-id}`.
That collapses `{task-id}` onto `{numeric-id}`. The WF-479 already-active substitution is gated on
those two **differing** — a deliberate collision guard, since a bare-numeric arm cannot distinguish
two tasks sharing a numeric run. When they collapse, the gate skips, name derivation falls through
to step 2, and a caller **already sitting on the correct task branch** gets a *second* branch cut
from the base instead of `already-active`.

Observed live in this run: a shipper on a valid tracker-shaped task branch, with commits on it, was
moved onto a freshly minted branch containing **none** of that work. The pushed branch survived, so
nothing was lost here — but an unattended shipper that did not notice would open its pull request
against a head carrying none of its commits, which is precisely the failure the WF-479 substitution
was added to prevent. The gap is that the fix's guard is disabled exactly when the task folder is
missing — the normal state for a fleet shipper in a fresh worktree, since `_local/` is gitignored.

Interaction to note for whoever picks this up: the guard is load-bearing and must not simply be
removed. A candidate direction is to make the substitution consult the **id as passed by the caller**
rather than the folder-resolved `{task-id}`, so an explicitly supplied tracker-shaped id keeps its
prefix and stays collision-proof. Not designed or implemented here.

**ESC-4 — the diagnostic's own §10 advice is now partly spent.** §10 closes with *"A diff of `main`
against the cached 0.116.0 for these specific behaviours is the cheapest next step."* For B1 and B4
the diff was decisive. For B2 and B3 it was **vacuous** — both are host-runtime behaviours carried
in no wf version, so a plugin diff can never settle them. Any future re-test of a §10-style list
should classify each item as wf-versioned or host-versioned *before* choosing its method, or it
will diff two identical trees and conclude nothing changed when the environment changed underneath.

## 11. Caveats

- **B2 and B3 are host-runtime verdicts and are not pinned by any wf version.** They can regress
  with a host upgrade, silently and without a plugin release. Nothing in wf detects that today —
  which is the same class of blindness OUT-1 addresses for the *plugin* version, one layer out.
  A downstream sub-task citing B2 or B3 should cite it as *observed on this host at this date*.
- **B1's verdict is conditional, not clean.** It is `still-broken` on source and precondition-free
  under the mandated dispatch shape. Anyone reading only the verdict column will get it wrong; the
  qualification in §4 is load-bearing.
- **No fleet dispatch was performed.** Every verdict here is from source diff, contract read, or a
  single-agent live probe. The end-to-end claim is explicitly left `unverifiable` (ESC-3).
- **`EnterWorktree` was resolved but not invoked**, deliberately — invoking it would have moved the
  shipper that wrote this note. B3 rests on schema plus the explicit pinned-agent clause.
- **The 0.116.0 cache may be pruned.** Every quotation this note depends on is reproduced inline
  with its file and step, so the verdicts survive the cache's disappearance.
- **Single host, single repository.** As with the diagnostic, findings about worktree behaviour are
  entangled with this host; findings about wf source are not.
