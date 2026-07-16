---
name: review-pr
description: Reviews a pull request for correctness, security, and design, then posts verified findings as a PR-level summary plus file-level findings anchored by file and line. Every finding is confirmed against the real code before it is posted — no speculation, no vibes. Routes all host interaction through the active delivery provider and writes no AI attribution into anything it posts. Use to review a PR and leave actionable, grounded feedback.
allowed-tools: [Read, Grep, Glob, Bash, Task]
---

# /wf-review:review-pr — Review a PR, post only verified findings

Reviews the changeset a PR introduces and posts feedback the author can act on. This is a
**native, user-invoked** feature skill: it fills no core seam and is reachable purely by
installing the wf-review pack. It reaches the host **only** through the active **delivery**
provider's PR-interaction operations; it names no concrete version-control or host tool. It
is **read-only on source** — it reviews and comments, it never edits code.

**The one discipline: post nothing you have not verified against the real code.** A finding
is a claim about the code; before it goes on the PR you open the actual file and lines it
concerns and confirm the issue is real. A hunch, a pattern-match, or "this looks risky" is
not a finding until the code confirms it. No speculation reaches the author.

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
/wf-review:review-pr [<branch>] [--dry-run]
```

| Argument    | Required | Description                                                                                         |
| ----------- | -------- | --------------------------------------------------------------------------------------------------- |
| `<branch>`  | NO       | The branch whose PR to review. Defaults to the current branch (resolved via `current-branch-query`). |
| `--dry-run` | NO       | Review and compose the findings but post nothing — print the summary and findings to chat instead.  |

Zero-argument invocation reviews the PR for the current branch.

---

## Safety Rules

**Allowed:**

- Call the bundled `wf-resolver` MCP tools `resolve_config` (confirm initialization) and
  `resolve_provider("delivery")` (resolve the delivery surface); read the task folder and any
  source file.
- Read-side delivery operations: `current-branch-query`, `pr-comments-read`, `checks-read`.
- `Read` / `Grep` / `Glob` to read the changeset and to verify every candidate finding
  against the real code — the load-bearing step.
- The write-side delivery operation `pr-comment-post`, strictly through the resolved
  provider, to post the review.
- Invoke the **Task** tool with `subagent_type: wf:context-distiller` (distil existing
  review threads or CI bulk) and `subagent_type: wf:index` (catalogue the run).

**Forbidden:**

- Editing any source file — this skill reviews, it does not fix. (To address feedback, run
  `/wf-review:address-pr`.)
- Writing any concrete git/host command or tool name in reasoning or output — name only the
  abstract delivery operations above; the provider fragment owns the mechanics.
- Posting a finding you have not confirmed against the real code. Unverified observations are
  dropped, not hedged into the review.
- Destructive delivery operations of any kind (this skill only reads and posts a comment).
- Any AI-attribution, "generated with" footer, emoji tagline, or promotional content in the
  posted review. Write like a human reviewer.

---

## Provider resolution — delivery surface (resolve once)

Every host operation this skill invokes — `current-branch-query`, `pr-comments-read`,
`checks-read`, `pr-comment-post` — is a **`delivery`-surface** operation. Resolve the surface
**once** by calling the bundled `wf-resolver` MCP tool `resolve_provider("delivery")` — the
typed query that returns the run-scoped resolution record
`{ surface, owner, fragmentPath, state, degradation, diagnostics }`. The resolver has already
resolved the `## Capabilities` registry, the owning capability's `manifest.md`, and any
plugin-anchored root (post install-manifest self-heal, per `capability-registry.ops.md`
§"Recorded-root-first resolution with install-manifest self-heal"); this skill performs
**no** registry / manifest / plugin-root read of its own. Follow the returned `fragmentPath`
in this skill's own context to dispatch every delivery operation (the resolver returns paths
and metadata only, never a fragment body). If the `wf-resolver` service is unavailable, stop
and report that the resolver runtime is not loaded (restart Claude Code) — do not hand-parse
the registry as a fallback (WF-272 diagnostics/recovery).

Reproduce degradation from the record's `state`. Posting a review is this skill's whole
purpose, so a missing provider is a loud, blocking condition (not a silent empty result). On
`state: ok`, dispatch every operation against the resolved `fragmentPath`. Otherwise return
`REVIEW-PR — No provider` and split the reason by state:

- **`unconfigured`** — no capability owns the `delivery` surface (every registered manifest
  readable): "No delivery provider is registered. Register a capability that owns the
  `delivery` surface (e.g. install and run `/wf-git:init`)."
- **`unrecoverable`** — a registered capability's `delivery` manifest can't be read (its
  recorded root dangled and the self-heal recovered nothing); the record's `diagnostics`
  names the pack. Surface it as a hedged **candidate** — "registered pack [X] has an
  unrecoverable manifest at that path; if it is your `delivery` provider, fix its stale root
  / re-run its init." Never assert a candidate owns `delivery`.

---

## Phase 1 — Resolve the PR and read the changeset

1. Resolve the branch: the `<branch>` argument if given, else `current-branch-query`. Its
   detached-HEAD signal (the literal `HEAD`) → `REVIEW-PR — Error`, reason "Detached HEAD;
   check out the PR branch first."
2. Read the **changeset** the branch introduces relative to its base — the set of changed
   files and their diff hunks. This is a read-only, content-gathering read described **by
   what it returns**, never as a literal command; the base is the repository default
   (`main`, else `master`). This is the bounded bulk this skill reasons over — read it once.

## Phase 2 — Prior context (avoid duplication)

- `pr-comments-read(<branch>)` — the existing review threads, so you do not re-post a finding
  already raised. For many/long existing threads, distil them with `wf:context-distiller`
  (`MODE: review`) rather than ingesting them whole.
- `checks-read(<branch>)` — the CI state; a failing check may point at a real defect worth a
  finding (verify it against the code like any other), or `wf:context-distiller` (`MODE: ci`)
  can distil a failing log's root cause. An empty result from either is a valid outcome.

## Phase 3 — Review, verifying every candidate finding against the real code

Review the changeset across three lenses — **correctness** (logic errors, ignored return
values, null/error handling, data loss, off-by-one, unhandled branches), **security**
(injection, missing authz, secret exposure, unvalidated external input, unsafe defaults), and
**design** (unclear contracts, needless complexity, inconsistency with the surrounding code).

For **every** candidate finding, before it can become a real finding:

- Open the actual file and lines with `Read` / `Grep`. Confirm the code truly does what the
  finding claims, at the line it names, in the surrounding context (a guard three lines up may
  already handle it; a helper may already validate it).
- Keep the finding **only if the code confirms it.** If the code does not confirm it, drop it
  — do not soften it into a "consider…" note. Unverified observations never reach the author.

Assign each surviving finding a severity: **blocker** (must fix before merge), **major**
(should fix), or **minor/nit** (optional). Record its `file:line`, the verified claim, and a
concrete suggested fix.

## Phase 4 — Compose the review

Compose one review from the verified findings:

- **Summary** — an overall verdict (`approve` / `comment` / `request-changes`), the finding
  counts by severity, and one or two sentences on the changeset's intent and overall health.
- **Findings** — one entry per verified finding, ordered blocker → major → minor, each as
  `` `file:line` — <severity> — <verified claim>. Suggested fix: <one line>. `` The
  `file:line` anchors each finding to its exact location.

Post nothing that is not in this list; the list contains only Phase 3 survivors.

> **Anchoring note.** The findings are anchored by explicit `file:line` inside the posted
> comment. The delivery `pr-comment-post` operation posts a PR-level comment (and threaded
> replies to existing threads); creating a *new* natively-inline review comment bound to a
> file line would need a delivery operation the current contract does not expose, so this
> skill anchors by reference rather than inventing one. If such an operation is later added,
> this phase upgrades to true inline posting with no change to the review it produces.

## Phase 5 — Post the review

Under `--dry-run`, print the summary and findings to chat and stop before posting. Otherwise
post through the resolved provider:

- `pr-comment-post(<body>, <branch>)` with the composed summary and findings as a single
  PR-level review comment (no `reply-to` — these are fresh findings, not replies). Capture the
  returned comment URL.
- If the review has **zero** findings, still post a brief summary comment recording that the
  PR was reviewed and no issues were found — so the PR reflects that a review happened.

## Phase 6 — Index

Invoke the **Task** tool with `subagent_type: wf:index` (when a resolvable task folder exists
for this branch) to catalogue the run under the `review-pr` slot. A stale index loses nothing,
so an `INDEX — Error` never fails the run.

---

## Edge Cases

- **No open PR for the branch** — the changeset or the delivery reads resolve no PR →
  `REVIEW-PR — No PR`, reason "No open PR for this branch. Open one with `/wf:pr` first." No
  review is posted.
- **Empty changeset** — the branch introduces no change relative to base → `REVIEW-PR —
  Empty`; nothing to review, nothing posted.
- **No findings survive verification** — every candidate was dropped against the real code →
  `REVIEW-PR — Approved`; a brief "reviewed, no issues found" summary is posted (unless
  `--dry-run`).
- **A failing check with no code cause** (`infra/transient`) — note it in the summary as a
  transient/environmental failure; do not raise it as a code finding.
- **Delivery provider not authenticated** — `pr-comment-post` returns an
  authentication-remedy error; surface it verbatim in `REVIEW-PR — Error` (the review is
  composed but unposted).
- **No readable delivery provider** — handled up front by Provider resolution (`REVIEW-PR —
  No provider`, two-mode diagnosis); no host operation is attempted.
- **Detached HEAD** — `REVIEW-PR — Error`, reason "Detached HEAD; check out the PR branch
  first."

---

## Final Output

Emit exactly one block as the very last thing in the transcript.

```
REVIEW-PR — <posted | Approved | dry-run | Empty | No PR | No provider | Error>

Branch: <branch>
Verdict: <approve | comment | request-changes>
Findings: <n> (<blocker> blocker, <major> major, <minor> minor)
Posted: <comment url, or "not posted (dry-run)" / "not posted (<reason>)">
Next: <address the findings with /wf-review:address-pr, or /wf:pr to merge when clean>
```

No-provider / no-PR / empty / error variants carry only the `Reason:` line under the status:

```
REVIEW-PR — <No provider | No PR | Empty | Error>

Reason: <one sentence — what stopped the run and the remedy>
Next: <the remedy command>
```

The block must always be the very last thing output to chat.
