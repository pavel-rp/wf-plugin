# wf-fake scripts + op-log format

The two machine-readable files the fake reads and writes. **Reference only** — the runtime protocol
lives in `../fragments/delivery.ops.md` / `../fragments/tracker.ops.md`. Both files live under the
fixture's own `_local/`; a fixture seeds the scripts file, and assertion scripts (WF-346) read the
op log.

## Config keys (`## Fake` section of `_local/config.md`, written by the fixture)

Both keys have working defaults; the section is needed only to relocate the files. `/wf-fake:init`
does not write it — since WF-462 that skill is a compatibility alias that writes nothing at all.


| Key | Default | Meaning |
|-----|---------|---------|
| **Fake Scripts** | `_local/fake/scripts.json` | fixture-seeded scripted responses (read-only to the fake) |
| **Fake Op Log** | `_local/fake/op-log.jsonl` | append-only invocation trace (written by the fake) |

## The scripts file (`scripts.json`)

A single JSON object with two top-level surface keys, each mapping an op name to its scripted
response:

```json
{
  "delivery": {
    "current-branch-query": "feature/FAKE-1-demo",
    "pr-create": { "state": "created", "url": "https://fake.local/pr/1" },
    "checks-read": [ [ { "name": "ci", "state": "PENDING" } ],
                     [ { "name": "ci", "state": "SUCCESS" } ] ],
    "review-threads-read": { "read-performed": true, "threads": [] }
  },
  "tracker": {
    "resolve_config": "configured",
    "create_umbrella": "FAKE-1",
    "get": { "id": "FAKE-1", "title": "Demo", "status": "In Progress" }
  }
}
```

**Response value forms:**

- **A single value** (object / string / number / bool) — returned on every call to that op.
- **An array** — an **ordered response sequence**: call N returns element N (0-indexed by the op's
  prior call count in the op log); once calls exceed the array length the **last** element repeats.
  This is how a fixture scripts a poll that starts `PENDING` and settles `SUCCESS`, or a review
  thread that flips `unresolved` → `resolved` across reads. (Note the nesting in the `checks-read`
  example: each *element* is itself the op's normal list-shaped response, so the array-of-arrays is
  a two-call sequence, not one four-item list.)

An op with **no** key is **unscripted** — the fake records the invocation and fails loudly naming
the op (except tracker `resolve_config`, which returns `"unconfigured"`).

## The op log (`op-log.jsonl`)

Append-only JSON Lines, one object per invocation, in call order:

```
{"seq":1,"surface":"tracker","op":"resolve_config","args":{},"response":"configured"}
{"seq":2,"surface":"delivery","op":"current-branch-query","args":{},"response":"feature/FAKE-1-demo"}
{"seq":3,"surface":"delivery","op":"pr-create","args":{"title":"…","base":"main"},"response":{"state":"created","url":"https://fake.local/pr/1"}}
```

Fields: `seq` (1-based global order across both surfaces), `surface` (`delivery`|`tracker`), `op`,
`args` (the resolved inputs the caller passed), `response` (the scripted value returned, or
`"__UNSCRIPTED__"` for a loud failure). Both surfaces share one op log; `surface` disambiguates.

## No egress

Neither file may contain a network-reaching tool invocation or an external delivery/tracker host.
Scripted URLs use the synthetic host `fake.local`; scripted ids use the `FAKE-` prefix. The
`../fixtures/run.sh` static no-egress assertion enforces this over the sample scripts and every
fragment.
