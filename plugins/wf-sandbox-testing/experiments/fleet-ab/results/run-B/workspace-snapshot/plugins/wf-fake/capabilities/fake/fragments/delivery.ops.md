# fake delivery provider — runtime ops

**Version:** 0.1.0 (WF-344 — hermetic in-memory delivery binding: every delivery op returns a scripted response and records its invocation to the op log; no network/git/gh reach.)
**Role:** the runtime-read half of the fake delivery provider — the uniform scripted-response protocol every delivery operation follows, plus the authoritative delivery op list. Read at every delivery-surface boot; self-sufficient (no step below requires opening another file).
**Reference (rationale, scripts/op-log format, edge-case matrix — never read at boot):** `delivery.md`; scripts/op-log format legend `../references/scripts-format.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = delivery`, reads this file, and follows it in-context. No subagent, no phase gate.
**Model:** claude-opus-4-8

**Hermetic invariant (no egress):** every step below is a **local file read or append** under the fixture's own `_local/`. It invokes **no** network-reaching tool — no HTTP-fetch client, remote-shell utility, or web fetch/search tool — **no** version-control command, and **no** tracker/delivery product API; it names **no** external tracker/delivery host. A scripted response may carry a synthetic non-routable URL (host `fake.local`); it is inert data returned to the caller, never fetched. `fixtures/run.sh`'s static no-egress assertion enforces this.

**Consumes, never derives:** every operation takes an already-resolved `<branch-name>` / `<message>` / `<title>` / `<body>` / `<thread-id>` — composing those is the caller's job. The fake neither validates nor acts on them; it records them and returns the scripted response.

**Operations:** branch-create · branch-switch · commit · push-upstream · pr-create · pr-detect · workspace-root-resolve · current-branch-query · default-base-query · last-commit-timestamp-query · branch-changes-read · pr-comments-read · review-threads-read · pr-comment-post · checks-read · review-thread-resolve · review-thread-reply · pr-merge · activity-read.

## The scripted-response protocol (every delivery op)

Every operation `<op>` on this surface follows the same five steps. `<args>` is the operation's already-resolved inputs (the op table below names each op's arg keys).

1. **Resolve fixture paths.** Read the `## Fake` section of `_local/config.md`: `Fake Scripts` (default `_local/fake/scripts.json`) and `Fake Op Log` (default `_local/fake/op-log.jsonl`). These are fixture-local paths; no path outside the project is ever read or written.
2. **Load the scripts file.** Read the `Fake Scripts` JSON. **Absent or unparseable → fail loudly** and stop: `wf-fake: scripts file <path> not found or invalid — a fixture must seed scripted responses before driving delivery ops.` (A fixture that registered fake but scripted nothing is a fixture error, surfaced, never a silent pass.)
3. **Compute `<seq>` and the per-op call index.** `<seq>` = (count of existing lines in the op log) + 1 (op log absent → `<seq>` = 1, create it). `<call-index>` = the number of op-log lines already recording this same `(surface=delivery, op=<op>)` pair (0 for the first call).
4. **Resolve the scripted response** from `scripts.delivery.<op>`:
   - **Absent key → UNSCRIPTED.** Append the invocation line (step 5) with `"response":"__UNSCRIPTED__"`, then **fail loudly** and stop: `wf-fake: unscripted delivery op '<op>' — no scripted response in <scripts-path>. Add scripts.delivery.<op> or the scenario is invalid.` Never a silent skip, never a fabricated value.
   - **A single JSON value** (object/string/number/bool) → that is the response.
   - **A JSON array** (an ordered response sequence, e.g. poll outcomes / evolving thread states) → the element at `<call-index>`; past the end, the **last** element repeats (a settled terminal state).
5. **Append the invocation, in order, then return.** Append exactly one line to the op log: `{"seq":<seq>,"surface":"delivery","op":"<op>","args":<args-as-json>,"response":<resolved-response-or-"__UNSCRIPTED__">}`. Append **before** returning (and before the loud stop in step 4), so the log records every invocation in call order. Return the resolved response to the caller.

## Delivery operations (arg keys recorded in `<args>`)

| op | arg keys | scripted response shape |
|----|----------|-------------------------|
| branch-create | branch-name, base? | `{state, base-source, tracking, carry}` |
| branch-switch | branch-name | `{state, tracking}` |
| commit | message, staged-only? | `{state, diffstat?}` |
| push-upstream | branch? | `{state}` |
| pr-create | title, body, base, head?, draft? | `{state, url}` |
| pr-detect | branch? | `{found, url?, state?}` |
| pr-comment-post | body, branch?, reply-to? | `{state, url}` |
| review-thread-resolve | thread-id | `{state}` |
| review-thread-reply | thread-id, body | `{state, url}` |
| pr-merge | branch?, method?, delete-branch? | `{state, url}` |
| workspace-root-resolve | — | string (absolute path) |
| current-branch-query | — | string (branch name, or `HEAD`) |
| default-base-query | — | string (`main`/`master`) |
| last-commit-timestamp-query | — | string (timestamp) |
| branch-changes-read | base? | `[{path, status}, …]` (possibly empty) |
| pr-comments-read | branch? | `[{author, body, anchor?}, …]` (possibly empty) |
| review-threads-read | branch? | `{read-performed, threads:[{id, path, line, resolved, body}, …]}` |
| checks-read | branch? | `[{name, state, link?}, …]` (possibly empty) |
| activity-read | since?, limit? | `{commits:[…], pull-requests:[…]}` |

**`review-threads-read` typed empty (never fabricate).** Return exactly the scripted `{read-performed, threads}`. A fixture simulating a performed HEAD_SHA read-back scripts `read-performed: true`; one simulating a bare-core / no-PR degraded empty scripts `read-performed: false`. The fake never upgrades a scripted `false` to `true` — the merge-blocking review-gate claim stays honest.

**Idempotency is the caller's, not the fake's.** For `pr-create` / `pr-comment-post` / `review-thread-reply` the caller records the returned url as an artifact metadata line and reads it back before re-invoking; the fake simply serves the scripted response and logs each call. A fixture that wants a second call to differ scripts an array (step 4).
