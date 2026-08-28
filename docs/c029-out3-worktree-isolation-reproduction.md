# C029 OUT-3 — reproduction of the fleet worktree-isolation failure, and the verdict

**Recorded:** 2026-08-28 · **Item:** WF-484 · **Covers:** C029 OUT-3, first success measure
**Audited by:** claude-opus-5[1m]
**Fixture:** `plugins/wf/mcp/test/worktree-isolation-repro.test.ts`
**Claim under test:** `docs/c011-fleet-run-diagnostic.md` §5 **F4** — *"The resolver defeats worktree isolation."*
**Dispatch shape sourced from:** `docs/c029-out8-dispatch-behaviour-retest.md` §5 (**B2**) and §6 (**B3**), not from the diagnostic.

---

## 1. Verdict

> **RESHAPED.** F4's **symptom** reproduces on current source — but **only** when the shipper's container
> directory is *not* a registered worktree. F4's **stated mechanism** does **not** reproduce and is
> **refuted** by direct evidence. In the dispatch shape `plugins/wf/skills/fleet/SKILL.md:158` actually
> mandates, worktree isolation **already holds at the resolver boundary** on current source, for a
> concurrent set, with no semantic change.

| Question | Answer |
|---|---|
| Does a resolver call from a C011-shaped container return a checkout above it? | **Yes** — in the *unregistered* container state only. |
| Is the cause the mechanism F4 names (`--git-common-dir` / a family-root return)? | **No.** Refuted — see §4. |
| Is the cause a resolver defect at all? | **No.** The resolver faithfully reports what `git rev-parse --show-toplevel` returns. |
| Does isolation hold in the mandated `isolation: "worktree"` shape? | **Yes**, including concurrently. OUT-3's second success measure is already satisfied. |
| Was any resolver source change needed to build the reproduction? | **No.** No stop-and-raise was triggered. |

## 2. Layout reproduced

The layout the C011 run actually used — a container directory **nested inside the parent checkout**:

```
<parent-checkout>/                       # the shared checkout
└── .claude/worktrees/
    ├── agent-aaa/                       # shipper 1's container
    └── agent-bbb/                       # shipper 2's container
```

Exercised in the two states that separate the competing mechanisms:

- **State (a) — pre-registration.** The container is a plain directory; no `git worktree add` has run.
  C011's **F5** records that all 16 shippers ran `subagent_type: "claude"` with **no** `isolation`, inside
  directories created by hand — so state (a) is the state F4 was observed in.
- **State (b) — registered.** The container is a genuine linked worktree. This is the shape
  `fleet/SKILL.md:158` mandates, and which WF-481's **B2** records as `fixed`/available.

Both states are driven through the same code path a `resolve_config({ workspaceRoot })` request takes:
`resolveWorkspaceIdentity` (`plugins/wf/mcp/src/git-workspace.ts`), and `WorkspaceServiceRegistry.select`
(`plugins/wf/mcp/src/workspace-services.ts`) above it.

## 3. Observed vs expected

### 3.1 Fixture — `plugins/wf/mcp/test/worktree-isolation-repro.test.ts` (5 cases, all passing)

| # | State | Input `workspaceRoot` | Expected if isolated | **Observed** | Verdict |
|---|---|---|---|---|---|
| 1 | (a) unregistered | `<parent>/.claude/worktrees/agent-aaa` | `<parent>/.claude/worktrees/agent-aaa` | **`<parent>`** | **symptom reproduces** |
| 2 | (a) unregistered, 2 shippers | `agent-aaa`, `agent-bbb` | 2 distinct services | **1 service, keyed on `<parent>`** | **symptom reproduces** |
| 3 | (b) registered | `<parent>/.claude/worktrees/agent-aaa` | `<parent>/.claude/worktrees/agent-aaa` | **same, verbatim** | **isolation holds** |
| 4 | (b) registered, 2 shippers | `agent-aaa`, `agent-bbb` | 2 distinct roots + services | **2 distinct roots + services, no state leak** | **isolation holds** |
| 5 | (b) registered, shared common dir | `agent-aaa`, `agent-bbb` | keyed on root, not common dir | **2 services despite one shared common dir** | **F4 mechanism refuted** |

Case 2 is C011's F4 symptom stated mechanically: concurrent shippers converge on **one** root-bound
`ResolverService`, and that root is the shared checkout. Had any skill trusted the returned root for a
write, all shippers would have written into one tree — exactly F4's stated consequence.

### 3.2 Live probe — through the real `resolve_config` MCP tool

Run from inside this item's own dispatched, worktree-isolated shipper. Values verbatim:

**Probe A — an unregistered directory nested inside a registered worktree (state (a) in miniature):**

```
input   workspaceRoot: /workspace/wf-plugin/.claude/worktrees/agent-a37d9e3ca32360c68/_local/scratch/agent-probe-container
output  workspaceRoot: /workspace/wf-plugin/.claude/worktrees/agent-a37d9e3ca32360c68
git rev-parse --show-toplevel   -> /workspace/wf-plugin/.claude/worktrees/agent-a37d9e3ca32360c68
git rev-parse --git-common-dir  -> /workspace/wf-plugin/.git
```

The returned root is **not** the directory passed in — the symptom — and it is **not** the family root
either, even though the common dir *is* the family's. That single observation separates the two mechanisms.

**Probe B — this shipper's own registered worktree (state (b)):**

```
input   workspaceRoot: /workspace/wf-plugin/.claude/worktrees/agent-a37d9e3ca32360c68
output  workspaceRoot: /workspace/wf-plugin/.claude/worktrees/agent-a37d9e3ca32360c68
```

Returned verbatim. This shipper's worktree was never moved and never resolved to the shared checkout at any
point during this run.

## 4. The mechanism, with file-and-line evidence

**The operative mechanism is F5's, not F4's.**

- `plugins/wf/mcp/src/git-workspace.ts:49` derives the root from `git rev-parse --show-toplevel`, executed
  **in the caller's directory**. When that directory is not a registered worktree, git's own discovery walks
  up and answers with the enclosing checkout. The resolver reports that answer faithfully — there is no
  resolver-side override, heuristic, or family substitution to blame.
- `plugins/wf/mcp/src/git-workspace.ts:54` reads `--git-common-dir` separately.
- `plugins/wf/mcp/src/workspace-services.ts:29` uses `commonDir` **only** as the family-admission predicate —
  it decides whether a `workspaceRoot` is inside the launch repository's worktree family, and nothing else.
- `plugins/wf/mcp/src/workspace-services.ts:44` keys the service map on `identity.root` — the **resolved
  worktree root**.

So the family-root return F4 describes has no source in current code. Fixture case 5 and live probe A each
falsify it independently: two worktrees sharing one common dir produce two services, and a call whose common
dir is the family root still returns a worktree root.

**Why F4 nevertheless recorded a true observation.** C011's shippers were dispatched into containers that the
runtime had not registered as worktrees (F5). Every such call was, from git's point of view, a call from an
ordinary subdirectory of the shared checkout — and the resolver answered correctly for that question. The
defect was in the **dispatch shape**, not the resolver. WF-481's **B2** records that the mandated
`isolation: "worktree"` shape is now available, which removes the precondition.

## 5. Consequence for WF-495

WF-495 — *"Return a dispatched shipper's own worktree as its resolved root"* — is specified against this
verdict. The verdict does not support it as written.

1. **There is no resolver defect to fix in the mandated dispatch shape.** Cases 3–4 and probe B show the
   resolver already returns a dispatched shipper's own worktree, for a concurrent set. OUT-3's second success
   measure holds on current source, today.
2. **Charter open-assumption (7)'s "return the caller's root verbatim" option should be closed, not chosen.**
   Returning the caller's directory verbatim would break ordinary resolution from any repository
   subdirectory — a skill calling from `plugins/wf/mcp` would receive `plugins/wf/mcp` as its `workspaceRoot`.
   That alias/subdirectory convergence is pinned as *required* behaviour by
   `plugins/wf/mcp/test/workspace-services.test.ts` ("canonical aliases and subdirectories share one
   root-bound service"), and every consumer in `docs/resolver-consumer-inventory.md` depends on it. This
   option is not a narrow fix; it is a breaking change to the resolver's core contract.
3. **Recommended reshape.** Either **close** WF-495 as already-satisfied, or narrow it to assumption (7)'s
   *other* option — an **additive** signal that the passed `workspaceRoot` differs from the resolved root, so
   an agent dispatched into an unregistered container can detect the condition instead of silently sharing
   the parent's service. That is purely additive, changes no existing return value, and requires no update to
   the reviewed consumer inventory's ownership assignments.
4. **The real remediation for F4 is not in the resolver.** It is ensuring the dispatch registers the
   worktree — `fleet/SKILL.md:158`'s mandated `isolation: "worktree"`, now available per WF-481's B2.

`plugins/wf/skills/_contracts/invocation-runtime.contract.md:14` — *"a linked-worktree Agent never reuses its
parent's root"* — is **satisfied** by current resolver behaviour for a genuine linked worktree. It says
nothing about an unregistered directory, and the reproduction shows why that distinction is the whole
question.

## 6. Caveats

- **The fixture is a layout reproduction, not a fleet dispatch.** It reconstructs the worktree layout and
  drives the real resolver code path; it does not run `/wf:fleet`. Its dispatch-shape premises are taken from
  WF-481's B2/B3 verdicts, as WF-484 requires, not from the diagnostic.
- **B3 (`EnterWorktree`) was not exercised here.** WF-481 records it `fixed` in its `path` form only, on
  schema evidence, and deliberately did not invoke it. Nothing in this reproduction depends on it.
- **State (a) remains reachable.** Registration is a property of the dispatching runtime, not of wf. If a
  future host regresses B2, state (a) returns and with it F4's symptom — which is why the fixture pins both
  states rather than only the passing one.
- **No resolver source or semantics were changed by this item.** Its only touch on `plugins/wf/mcp/` is the
  added test file.
