# fake tracker provider — reference

Rationale, scope framing, and the edge-case matrix for the fake tracker binding. **Never read at
phase-fire** — a core skill resolving the `tracker` surface reads only `tracker.ops.md`. This file
is for authors and `init`.

## What this binds

The `fake` capability owns the `tracker` `provider` surface (`plugins/wf/skills/_contracts/
capability-registry.ops.md` §"The tracker provider surface") with the same in-memory, scripted,
op-recording implementation the delivery surface uses. It binds the **same** abstract operation
set wf-linear / wf-ado bind to a real tracker — `resolve_config`, `create_umbrella`,
`create_child`, `update`, `get`, `list_children`, `post_comment`, `set_status`, `attach_link`,
`list_by_status`, `list_statuses`, `list_milestones`, `list_cycles`, `list_blockers` — but to a scripts file + op
log. The canonical list the self-checks assert against is `../fixtures/op-vocabulary.txt`.

## Shared protocol, one exception

The scripted-response protocol (`tracker.ops.md`) is byte-for-byte the delivery surface's, with a
**single** documented exception: `resolve_config` returns `"unconfigured"` (never a loud failure)
when the scripts file or its own key is absent, because "is a tracker configured?" is itself a
legitimate answer and the contract defines a silent local-only fallback for the unconfigured
tracker. Every other tracker op keeps the loud unscripted-op failure.

## Edge-case matrix

| Situation | Behaviour |
|---|---|
| Scripts file absent/invalid | Every op except `resolve_config` fails loudly; `resolve_config` → `"unconfigured"`. |
| Op key absent | UNSCRIPTED — record then fail loudly, naming the op (except `resolve_config`). |
| Scripted value is an array, calls exceed its length | Last element repeats. |
| `list_*` / `list_blockers` scripted empty | Returned as an empty list/set (a read never writes, empty is valid). |
| Op row removed from this fragment entirely (WF-525) | The contract's **fourth** degradation case: the caller finds the operation undefined and applies the typed degraded-empty — silent, no error, no warning, carrying `<operation-supported>` = `false`. Deliberately **distinct** from the row above it: a *declared* op with no script is a scenario error (loud UNSCRIPTED), an *undeclared* op is a supported degradation. This is how a fixture reproduces "a configured, recoverable pack that never implemented the operation". |
| `list_statuses` scripted `{"operation-supported": true, "statuses": []}` | A genuine "nothing found" — told apart from the degraded empty above by the **flag on the recorded response** in the op log, never by emptiness. |
| Id shape | Whatever the scripts file scripts (`create_umbrella`/`create_child` return the scripted string, e.g. `FAKE-1`); no local `T<NNN>` fallback applies while fake is registered. |

## No egress

No operation invokes a network-reaching tool or names an external tracker host or product API.
`../fixtures/run.sh`'s static no-egress assertion enforces this. Synthetic ids (`FAKE-1`) and
`fake.local` URLs are inert returned data.

## Version history

- **WF-344** — initial hermetic in-memory tracker binding (OUT-1 of charter C016).
