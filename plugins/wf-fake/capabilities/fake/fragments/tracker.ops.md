# fake tracker provider — runtime ops

**Version:** 0.2.0 (WF-344 — hermetic in-memory tracker binding: every tracker op returns a scripted response and records its invocation to the op log; no network/tracker-MCP reach. 0.2.0 adds the argument-keyed `{by, map, default?}` response form for ops whose concurrent callers make call-order sequences answer the wrong argument.)
**Role:** the runtime-read half of the fake tracker provider — the uniform scripted-response protocol every tracker operation follows, plus the authoritative tracker op list. Read at every tracker-surface boot; self-sufficient (no step below requires opening another file).
**Reference (rationale, scripts/op-log format, edge-case matrix — never read at boot):** `tracker.md`; scripts/op-log format legend `../references/scripts-format.md`.
**Resolved by:** `plugins/wf/skills/_contracts/invocation-runtime.ops.md` §"Direct provider resolution" — a core skill selects the registry row where `contribution-kind = provider AND scope = tracker`, reads this file, and follows it in-context. No subagent, no phase gate.
**Model:** claude-opus-4-8

**Hermetic invariant (no egress):** every step below is a **local file read or append** under the fixture's own `_local/`. It invokes **no** network-reaching tool — no HTTP-fetch client, remote-shell utility, or web fetch/search tool — **no** tracker MCP tool, and **no** tracker product API; it names **no** external tracker host. A scripted response may carry a synthetic id (e.g. `FAKE-1`) or a synthetic non-routable URL (host `fake.local`); it is inert data returned to the caller, never fetched. `fixtures/run.sh`'s static no-egress assertion enforces this.

**Consumes, never derives:** every operation takes an already-resolved id / title / body / field value / status name — composing those is the caller's job. The fake records them and returns the scripted response.

**Operations:** resolve_config · create_umbrella · create_child · update · get · list_children · post_comment · set_status · attach_link · list_by_status · list_milestones · list_cycles · list_blockers.

## The scripted-response protocol (every tracker op)

Identical to the delivery surface's protocol — one shared shape across both surfaces. Every operation `<op>` follows the same five steps; `<args>` is the operation's already-resolved inputs (the op table below names each op's arg keys).

1. **Resolve fixture paths.** Read the `## Fake` section of `_local/config.md`: `Fake Scripts` (default `_local/fake/scripts.json`) and `Fake Op Log` (default `_local/fake/op-log.jsonl`). Fixture-local paths only; nothing outside the project is read or written.
2. **Load the scripts file.** Read the `Fake Scripts` JSON. **Absent or unparseable → fail loudly** and stop: `wf-fake: scripts file <path> not found or invalid — a fixture must seed scripted responses before driving tracker ops.` (Exception: `resolve_config` — see below — reports `unconfigured` instead of failing, because "is a tracker configured?" is itself a legitimate answer.)
3. **Compute `<seq>` and the per-op call index.** `<seq>` = (count of existing op-log lines) + 1 (op log absent → `<seq>` = 1, create it). `<call-index>` = the number of op-log lines already recording this same `(surface=tracker, op=<op>)` pair (0 for the first call).
4. **Resolve the scripted response** from `scripts.tracker.<op>`:
   - **Absent key → UNSCRIPTED.** Append the invocation line (step 5) with `"response":"__UNSCRIPTED__"`, then **fail loudly** and stop: `wf-fake: unscripted tracker op '<op>' — no scripted response in <scripts-path>. Add scripts.tracker.<op> or the scenario is invalid.` Never a silent skip, never a fabricated value.
   - **A keyed map** — an object carrying exactly the keys `by` and `map` (plus an optional `default`) → an argument-keyed response: read the arg named by `by` from `<args>`, and the response is `map.<that value>`. When `map` has no such key: the response is `default` when one is declared, else treat the call as UNSCRIPTED (append the line, fail loudly naming the op **and** the missed key). Use this whenever concurrent or reordered callers make a call-order sequence answer the wrong argument (e.g. `get` keyed `by: "id"`).
   - **Any other single JSON value** → that is the response.
   - **A JSON array** (an ordered response sequence) → the element at `<call-index>`; past the end, the **last** element repeats. A sequence is indexed by call count, blind to arguments — never script one for an op whose calls interleave across concurrent callers with different arguments; use a keyed map there.
5. **Append the invocation, in order, then return.** Append exactly one line to the op log: `{"seq":<seq>,"surface":"tracker","op":"<op>","args":<args-as-json>,"response":<resolved-response-or-"__UNSCRIPTED__">}`. Append **before** returning (and before the loud stop in step 4). Return the resolved response.

## Tracker operations (arg keys recorded in `<args>`)

| op | arg keys | scripted response shape |
|----|----------|-------------------------|
| resolve_config | — | `"configured"` or `"unconfigured"` (see below) |
| create_umbrella | title, description | string (issue id, e.g. `FAKE-1`) |
| create_child | parent-id, title, description | string (child issue id) |
| update | id, fields | `{state}` (confirmation) |
| get | id | `{id, title, description, status, parent?, labels?}` |
| list_children | parent-id | `[{id, title}, …]` (possibly empty) |
| post_comment | id, body | `{state}` (confirmation) |
| set_status | id, status | `{state}` (confirmation) |
| attach_link | id, url | `{state}` (confirmation) |
| list_by_status | status, scope | `[{id, title, status}, …]` (possibly empty) |
| list_milestones | scope | `[{id, name, target?}, …]` (possibly empty) |
| list_cycles | scope | `[{id, name, start?, end?}, …]` (possibly empty) |
| list_blockers | id | `[<blocking-id>, …]` (possibly empty set) |

**`resolve_config` is the one op that never fails on an absent scripts file.** "Is a tracker configured?" is itself a legitimate answer: if the scripts file is absent, or `scripts.tracker.resolve_config` is absent, resolve_config returns `"unconfigured"` (the contract's silent local-only fallback) rather than failing loudly. When the scripts file **is** present, it returns the scripted `"configured"` / `"unconfigured"` value. It still records its invocation to the op log per step 5. Every **other** tracker op keeps the loud unscripted-op failure — a fixture driving `get`/`create_child`/etc. against an unseeded fixture is a scenario error, surfaced.

**Id shape.** The fake mints whatever id the scripts file scripts (`create_umbrella` / `create_child` return the scripted string verbatim, e.g. `FAKE-1`). Core's own no-provider local `T<NNN>` fallback is not this file's concern — with fake registered, the surface is configured and the scripted ids apply.
