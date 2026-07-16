---
name: address-pr
description: Reads a pull request's review comments and CI-check failures, verifies each claim against the actual code, and addresses only the valid ones on the PR branch. Treats review-tool output (Copilot, CodeRabbit, human reviewers) as hypothesis, never truth — every claim is confirmed against real code before any fix is applied. Routes all host interaction through the active delivery provider. Use after a PR has picked up review comments or a failing check and you want the valid feedback resolved.
allowed-tools: [Read, Write, Edit, Grep, Glob, Bash, Task]
---

# /wf-review:address-pr — Verify review feedback, then address the valid parts

Reads the review comments and CI-check results on the current PR, decides which are real,
and fixes only those — on the PR branch, then commits and pushes so a re-review sees the
change. This is a **native, user-invoked** feature skill: it fills no core seam and is
reachable purely by installing the wf-review pack. It reaches the host **only** through the
active **delivery** provider's PR-interaction operations; it names no concrete
version-control or host tool.

**The one discipline: review-tool output is a hypothesis, never truth.** A comment from
Copilot, CodeRabbit, or a human reviewer is a *claim about the code*, not a fact about it.
Before touching anything you **read the actual code the claim points at** and decide for
yourself whether the issue is real. You address confirmed issues; you reply to and skip
false positives. You never edit code on a reviewer's say-so alone.

**Model:** claude-opus-4-8

---

## Prerequisites

Confirm the project is initialized by calling the bundled `wf-resolver` MCP service's
`resolve_config` query — it returns `{ workspaceRoot, registryPath, coreConfig{…}, idShape }`,
already resolved (this skill performs **no** direct `_local/config.md` parse and **no**
`## Capabilities` registry read of its own — the delivery provider is resolved via
`resolve_provider("delivery")` below). If the resolver reports the project is uninitialized
(no resolved config / absent `_local/config.md`), stop: "Run `/wf:init` first." If the
`wf-resolver` service is unavailable, stop and report that the resolver runtime is not loaded
(restart Claude Code) — do not hand-parse config as a fallback (WF-272 diagnostics/recovery).

---

## Command Syntax

```
/wf-review:address-pr [<branch>] [--dry-run] [--no-commit]
```

| Argument      | Required | Description                                                                                      |
| ------------- | -------- | ------------------------------------------------------------------------------------------------ |
| `<branch>`    | NO       | The branch whose PR to address. Defaults to the current branch (resolved via `current-branch-query`). |
| `--dry-run`   | NO       | Verify and classify every claim and report the plan, but apply no edit, post no comment, and commit nothing. |
| `--no-commit` | NO       | Apply the verified fixes but skip the commit/push step — leave the working tree for a later `/wf:commit`. |

Zero-argument invocation addresses the PR for the current branch.

---

## Safety Rules

**Allowed:**

- Call the bundled `wf-resolver` MCP tools `resolve_config` (confirm initialization) and
  `resolve_provider("delivery")` (resolve the delivery surface); read the task folder and any
  source file.
- Read-side delivery operations: `current-branch-query`, `pr-comments-read`, `checks-read`.
- `Read` / `Grep` / `Glob` to verify each claim against the real code — the load-bearing step.
- Edit source files **only** to apply a fix for a claim you have verified against the code.
  This skill mutates source (like `/wf:implement`, `/wf:verify-fix`) — but only the lines a
  confirmed finding names.
- Write-side delivery operations, strictly through the resolved provider: `pr-comment-post`
  (replies), `review-thread-resolve`, `commit`, `push-upstream`.
- Invoke the **Task** tool with `subagent_type: wf:context-distiller` (bulk distillation) and
  `subagent_type: wf:index` (catalogue the run).

**Forbidden:**

- Writing any concrete git/host command or tool name in reasoning or output — name only the
  abstract delivery operations above; the provider fragment owns the mechanics.
- Editing code on an unverified claim. If reading the real code does not confirm the issue,
  the claim is a **false positive** — reply, do not edit.
- Editing any file a verified finding does not name; no opportunistic refactors.
- Destructive delivery operations: force-push, history rewrite, branch deletion, closing or
  merging the PR.
- Any AI-attribution, "generated with" footer, emoji tagline, or promotional content in a
  posted comment or a commit message. Write like a human.

---

## Provider resolution — delivery surface (resolve once)

Every host operation this skill invokes — `current-branch-query`, `pr-comments-read`,
`checks-read`, `pr-comment-post`, `review-thread-resolve`, `commit`, `push-upstream` — is a
**`delivery`-surface** operation. Resolve the surface **once** by calling the bundled
`wf-resolver` MCP tool `resolve_provider("delivery")` — the typed query that returns the
run-scoped resolution record
`{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already
resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any
plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md`
§"Recorded-root-first resolution with install-manifest self-heal"); this skill performs
**no** registry / manifest / plugin-root read of its own. Follow the returned `fragmentPath`
in this skill's own context to dispatch every delivery operation (the resolver returns paths
and metadata only, never a fragment body). If the `wf-resolver` service is unavailable, stop
and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse
the registry as a fallback (WF-272 diagnostics/recovery).

Reproduce degradation from the record's `state`. PR interaction is this skill's whole
purpose, so a missing provider is a loud, blocking condition (not a silent empty result). On
`state: ok`, dispatch every operation against the resolved `fragmentPath`. Otherwise return
`ADDRESS-PR — No provider` and split the reason by state:

- **`unconfigured`** — no capability owns the `delivery` surface (every registered manifest
  readable): "No delivery provider is registered. Register a capability that owns the
  `delivery` surface (e.g. install and run `/wf-git:init`)."
- **`unrecoverable`** — a registered capability's `delivery` manifest can't be read (its
  recorded root dangled and the self-heal recovered nothing); the record's `diagnostics`
  names the pack. Surface it as a hedged **candidate** — "registered pack [X] has an
  unrecoverable manifest at that path; if it is your `delivery` provider, fix its stale root
  / re-run its init." Never assert a candidate owns `delivery`.

---

## Phase 1 — Resolve the target PR

1. Resolve the branch: the `<branch>` argument if given, else `current-branch-query`. Its
   detached-HEAD signal (the literal `HEAD`) → `ADDRESS-PR — Error`, reason "Detached HEAD;
   check out the PR branch first."
2. The PR is the open PR for that branch. `pr-comments-read` and `checks-read` in Phase 2
   both resolve the PR from the branch themselves; if neither finds an open PR, treat it as
   the no-PR case (Edge Cases).

## Phase 2 — Gather the review signals

Both are read-side delivery operations; follow the resolved fragment for each:

1. **Review comments** — `pr-comments-read(<branch>)`. Returns the PR-level and inline
   review-thread comments, each with its author, body, and thread/anchor id where present.
   Keep every thread id — you need it to reply (`pr-comment-post` `reply-to`) and to resolve
   (`review-thread-resolve`).
2. **CI checks** — `checks-read(<branch>)`. Returns each check's name, state, and link. Keep
   only the **failing** checks.

An empty result from either (no open PR, no comments, no failing checks) is a valid outcome,
not an error — see Edge Cases.

## Phase 3 — Distil the bulk (delegate when large)

The point of distillation is to keep bulk out of this skill's context. Use judgement:

- **Review comments** — for more than a handful of threads, or long comment bodies, invoke
  the **Task** tool with `subagent_type: wf:context-distiller`, passing a `MODE: review` line
  then each thread's body tagged with its thread id. It returns one compact block per thread:
  `Verdict: valid | false-positive`, a one-line rationale, and a one-line suggested fix. For
  a couple of short comments, classify inline instead.
- **Failing checks** — for each failing check, invoke `wf:context-distiller` with a
  `MODE: ci` line then the failing-check reference (name + link) or a captured log. It returns
  the failing check, a `Class: code | infra/transient`, the root cause, the `file:line`
  location, and a suggested fix. An `infra/transient` class means no code fix — note it and
  move on.

**The distiller's verdict is itself a hypothesis.** It narrows what to look at; it does not
authorise a fix. Phase 4 still verifies every `valid` against the real code.

## Phase 4 — Verify each claim against the real code

For every candidate claim (a review comment, or a distilled CI root cause), open the actual
code it points at with `Read` / `Grep` and decide for yourself:

- **Confirmed** — the code really has the issue the claim describes, at the line it names.
  This claim is **valid**; it goes to Phase 5.
- **Not confirmed** — the code is already correct, the reviewer misread it, the line moved,
  or the point is pure style with no defect. This claim is a **false positive**; it goes to
  Phase 6 as a reply-only, no-edit item.

Record, per claim: its thread id (when it came from a comment), the verdict, the one-line
reason grounded in what you read, and — for confirmed claims — the exact file and lines to
change. Never carry a claim to Phase 5 you have not personally confirmed against the code.

## Phase 5 — Address only the confirmed claims

For each **confirmed** claim, apply the **minimal** fix its finding names, with `Edit` /
`Write`, touching only the lines involved. Do not bundle unrelated cleanups. If two confirmed
claims touch the same code, reconcile them into one coherent change. If `--dry-run` was
passed, apply nothing here — just carry the plan to the Final Output.

## Phase 6 — Reply and resolve threads

Skip this phase entirely under `--dry-run`. Otherwise, for each claim that came from a review
thread (has a thread id):

- **Confirmed and fixed** — `pr-comment-post(<body>, <branch>, reply-to=<thread-id>)` with a
  one-line note of what changed, then `review-thread-resolve(<thread-id>)`. The code now
  satisfies the comment, so the thread is resolved.
- **False positive** — `pr-comment-post(<body>, <branch>, reply-to=<thread-id>)` with the
  one-line evidence from Phase 4 (what you read, why the code is already correct). **Do not
  resolve** it — leave the thread open for the reviewer to adjudicate.

Keep replies terse and factual. No AI attribution, no filler.

## Phase 7 — Land the fixes

Skip under `--dry-run` or `--no-commit`, and skip when Phase 5 changed nothing. Otherwise
commit and push the addressed fixes through the delivery provider so a re-review sees them:

1. Author a terse message — subject `address review feedback` (prefix it with the branch's
   first 3+-digit run, when one exists, as `<n>: address review feedback`), body a short
   bulleted list of what was fixed, no trailing periods, no attribution.
2. `commit(<message>)` — stages and records the change (its nothing-to-commit check is
   authoritative; a `nothing-to-commit` result just means nothing landed).
3. `push-upstream(<branch>)` — updates the PR branch. A `failed (<reason>)` push is non-fatal
   to the commit; surface the reason on the `Push:` line.

Then invoke the **Task** tool with `subagent_type: wf:index` (when a resolvable task folder
exists for this branch) to catalogue the run under the `address-pr` slot — a stale index
loses nothing, so an `INDEX — Error` never fails the run.

---

## Edge Cases

- **No open PR for the branch** — `pr-comments-read` / `checks-read` return empty because no
  PR exists → `ADDRESS-PR — No PR`, reason "No open PR for this branch. Open one with
  `/wf:pr` first." No edit, no post.
- **PR exists but nothing to address** — comments and checks all resolve to false positives
  or already-passing → `ADDRESS-PR — Clean`; report the count verified and that nothing
  needed changing (replies to any false positives were still posted unless `--dry-run`).
- **Every failing check is `infra/transient`** — no code fix applies; report them as
  transient (e.g. re-run the job) and change no code.
- **A confirmed claim you cannot safely fix** (needs a larger design change, or is outside
  this PR's scope) — do not force a partial edit; reply on the thread noting it is valid but
  out of scope for an automated fix, leave the thread open, and list it under the Final
  Output's deferred items.
- **Delivery provider not authenticated** — a delivery operation returns an
  authentication-remedy error; surface it verbatim in `ADDRESS-PR — Error`.
- **No readable delivery provider** — handled up front by Provider resolution (`ADDRESS-PR —
  No provider`, two-mode diagnosis); no host operation is attempted.
- **Detached HEAD** — `ADDRESS-PR — Error`, reason "Detached HEAD; check out the PR branch
  first."

---

## Final Output

Emit exactly one block as the very last thing in the transcript.

```
ADDRESS-PR — <addressed | Clean | dry-run | No PR | No provider | Error>

Branch: <branch>
Comments: <n verified> (<a> valid, <b> false-positive)
Checks: <n failing> (<c> code, <d> infra/transient)
Addressed: <short list of the fixes applied, or "none">
Deferred: <valid-but-out-of-scope items, or "none">
Push: <pushed (origin/<branch>) | not-pushed | failed (<reason>) | n/a>
Next: <re-request review, then /wf-review:review-pr, or /wf:pr to open a PR if none exists>
```

No-provider / no-PR / error variants carry only the `Reason:` line under the status:

```
ADDRESS-PR — <No provider | No PR | Error>

Reason: <one sentence — what stopped the run and the remedy>
Next: <the remedy command>
```

The block must always be the very last thing output to chat.
