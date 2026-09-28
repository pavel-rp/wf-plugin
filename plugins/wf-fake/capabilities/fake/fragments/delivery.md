# fake delivery provider — reference

Rationale, scope framing, and the edge-case matrix for the fake delivery binding. **Never read
at phase-fire** — a core skill resolving the `delivery` surface reads only `delivery.ops.md`. This
file is for authors and `init`.

## What this binds

The `fake` capability owns the `delivery` `provider` surface (`plugins/wf/skills/_contracts/
capability-registry.ops.md` §"The delivery provider surface") with an in-memory, scripted,
op-recording implementation. It binds the **same** abstract operation set wf-git binds to git/gh —
`branch-create`, `branch-switch`, `commit`, `push-upstream`, `pr-create`, `pr-detect`,
`pr-comment-post`, `review-thread-resolve`, `review-thread-reply`, `pr-merge` (writes);
`workspace-root-resolve`, `current-branch-query`, `default-base-query`,
`last-commit-timestamp-query`, `branch-changes-read`, `pr-comments-read`, `review-threads-read`,
`checks-read`, `activity-read`, `newest-published-version-read`, `branch-head-read`,
`merged-ref-read`, `review-request-read` (reads) — but to a **scripts file + op log**, not to a real
remote. `pr-merge` also records the optional `expected-head` arg and can serve a scripted
`head-moved` state, exactly as the git owner refuses a moved head.
The op vocabulary is taken from the contract at implementation time (mirrored in wf-git); the
canonical list the self-checks assert against is `../fixtures/op-vocabulary.txt`.

## Why prose, not code

Providers dispatch as `inline:` read-and-follow ops docs (`invocation-runtime.ops.md` §"Direct
provider resolution"): the runtime model reads the ops doc and follows it in-context. wf-fake is
therefore prose — the same shape as wf-git and wf-linear — and "in-memory" means fixture-local
file I/O under `_local/`, driven by the model with the built-in Read/Write tools. No executable
runtime ships with the pack.

## The scripted-response protocol

The single uniform protocol (`delivery.ops.md` §"The scripted-response protocol") is shared
byte-for-byte with the tracker surface. Its three deliberate properties:

- **Records every invocation, in order.** Each op appends one JSONL line to the op log before
  returning — including the loud-failure case (recorded with `"response":"__UNSCRIPTED__"`), so the
  log is a faithful, ordered trace an assertion layer (WF-346) can read.
- **Loud on an unscripted op.** A contract op with no `scripts.delivery.<op>` entry is a scenario
  error, surfaced by name — never a silent skip and never a fabricated value.
- **Scriptable evolution.** A scripted value that is a JSON array is an ordered response sequence
  indexed by the per-op call count — the mechanism review-gate scenarios use to script poll
  outcomes and evolving thread states (unresolved → resolved across calls).

## Edge-case matrix

| Situation | Behaviour |
|---|---|
| Scripts file absent/invalid | Fail loudly (fixture error) — every delivery op. |
| Op key absent | UNSCRIPTED — record then fail loudly, naming the op. |
| Scripted value is an array, calls exceed its length | Last element repeats (settled terminal state). |
| `review-threads-read` scripted `read-performed:false` | Returned verbatim; never upgraded to `true` (honest merge-gate). |
| `newest-published-version-read` scripted `read-performed:true` | Returned verbatim with its `version` — the only shape a consumer may treat as a completed currency check. |
| `newest-published-version-read` scripted `read-performed:false` | Returned verbatim with its closed `reason` and **no** `version`; never upgraded to `true`, never emptied to a bare result (honest currency check). |
| `branch-head-read` scripted `read-performed:true` | Returned verbatim with its `commit` and `tree` — the remote head a merge would take. |
| `branch-head-read` scripted `read-performed:false` | Returned verbatim with its closed `reason` (`read-failed` / `not-published`) and **no** `commit`/`tree`; never the local head passed off as the remote one. |
| `merged-ref-read` scripted `read-performed:true` | Returned verbatim with its `merge-commit`, `tree` and (when a `dest` is simulated) `root`; the fake exports nothing and creates no `dest`. |
| `merged-ref-read` scripted `read-performed:false` | Returned verbatim with its closed `reason` (`read-failed` / `not-merged`) and **no** `merge-commit`/`tree`/`root`; never upgraded to `true`. |
| `review-request-read` scripted `read-performed:true` | Returned verbatim with `requested` and the three counts (`pending`, `request-events`, `reviews`); the fake requests nothing. |
| `review-request-read` scripted `read-performed:false` | Returned verbatim with `reason` `read-failed` and **no** `requested` or counts — never a provider-less empty passed off as "nothing was requested". |
| `pr-merge` scripted `head-moved` (with `expected-head`) | Returned verbatim with no `url`; nothing is merged. |
| Scripted typed-read element malformed | A fixture error caught by `../fixtures/run.sh`'s typed-shape check (both polarities, success fields well-typed, closed reasons, no success field on a degraded element). |
| Op log absent on first call | Created; `<seq>` starts at 1. |
| Two surfaces, one op log | Both delivery and tracker ops append to the same op log; `surface` distinguishes them. |

## No egress

No operation invokes a network-reaching tool, a version-control command, or names an external
delivery host. `../fixtures/run.sh`'s static no-egress assertion enforces this over this file's
runtime-ops sibling and every script/fixture. A scripted URL uses the synthetic host `fake.local`,
which is inert returned data, not a fetch target.

## Version history

- **WF-344** — initial hermetic in-memory delivery binding (OUT-1 of charter C016).
- **WF-483** — bind the newest-published-version read (`newest-published-version-read`),
  including its typed degraded return, so a fixture can drive a version-currency check
  deterministically from both polarities (OUT-1 of charter C029).
- **WF-839** — bind the remote-head read (`branch-head-read`) with its typed degraded return.
- **WF-838** — bind the merged-ref read (`merged-ref-read`); the fake serves the scripted merge
  commit, tree and root and exports nothing.
- **WF-837** — bind the review-request verification read (`review-request-read`); the fake serves
  the scripted request state and counts and requests nothing.
- **WF-881** — `pr-merge` records the optional `expected-head` arg and serves a scripted
  `head-moved` state.
- **WF-886** — this reference brought level with `delivery.ops.md`'s op list and typed shapes;
  `../fixtures/run.sh` validates every scripted element of the three typed reads above.
