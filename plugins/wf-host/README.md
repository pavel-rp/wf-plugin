# wf-host

`wf-host` is an independently registerable, stack- and project-neutral QA host-provider pack. Its
`host` capability owns only the `qa-execution` provider surface `host`; it composes with (but does
not replace) an engine provider. Registration rejects a second host owner.

## Install and register

After installing the pack and running `/wf:init` in the target repository:

```
/wf-host:init
```

The init command is a compatibility alias onto the shared setup lifecycle: it seeds `wf-host` into
`/wf:init`'s selection round and owns no lifecycle step of its own — no discovery, no registry
write, no profile write. Registration and the seeding of
`_local/profiles/host.profile.json` from the capability's declared profile template both happen
inside the canonical run, which reports the profile on its `Capability profiles:` line. Fill only
the command pairs that the project supports, then use `/wf:qa-auto` to dispatch host-dependent work.

`/wf:init` is the canonical command and does the same thing for every installed pack at once;
`/wf-host:init` remains a permanent entry point for anyone who already types it.

## Configuration

The profile defines a setup/teardown pair for each supported temporary operation:

| Operation | Setup | Teardown |
|---|---|---|
| Temporary API exposure | `expose-command` | `expose-teardown-command` |
| Host augmentation | `augment-command` | `augment-teardown-command` |
| Transactional persistence seed | `seed-command` | `seed-teardown-command` |
| Synthetic fixture | `fixture-command` | `fixture-teardown-command` |

`health-command` is optional. `command-timeout-seconds` defaults to 120 and applies to every configured command; projects may replace it with another positive whole number. The
pack treats profile command text as a project-supplied binding: it never embeds routes, framework
rules, schema names, or build tools.

Commands receive `WF_HOST_RUN_ID`, `WF_HOST_OPERATION`, `WF_HOST_PAYLOAD_FILE`,
`WF_HOST_LEDGER_FILE`, and `WF_HOST_RESULT_FILE`. Before writing, the provider rejects symlinked,
hard-linked, non-regular, foreign-owned, or group/world-writable scratch paths and creates missing
provider-owned scratch directories at mode `0700`; the global lock is acquired with atomic exclusive
creation, remains a current-user-owned regular link-count-one mode-`0600` file, and is revalidated before
access. Ledger replacement is an atomic same-directory rename. Opaque operation input is written to a mode-`0600`
payload file in a mode-`0700` run directory rather than child-command arguments. Each child command's
stdout and stderr are redirected to a private mode-`0600` capture file and discarded after the command
exits; neither child output nor command text is read into reports or the ledger. A setup command may
write the private result file with bounded, validated non-secret readiness references (including a
root-relative route) for engine handoff; malformed or unsafe values fail preparation and are never
ledgered. For provider orchestration, stable `Backend host required:`, `Host required:`, `Host operations:`,
and `Host operation target: <operation> | <control|observation> | <public-identifier>` markers are serialized
into the private payload as scenario/operation/kind/target records; profile commands read that file to bind the requested target without hardcoding it. Do not log payload
contents or secrets.

## Lifecycle and safety

The host provider supports authenticated `prepare` and `teardown` invocations through
`/wf-host:qa-host`; both carry the same caller-generated lifecycle token, which is never persisted raw or
exposed to commands. Run ids are bounded safe tokens whose canonical run directory must remain a strict
child of `_local/scratch/wf-host/`; dot-segment traversal is rejected before scratch access. Setup is validated as an all-or-nothing preflight: every requested mutable operation
must have both a setup and teardown command before any command runs. A global scratch lock stores only
the run id and token digest, refuses a different concurrent owner, and remains held through ready until
teardown completes. **Before** each setup command, the provider durably records its teardown intent and
`started` status in a run-scoped ledger under `_local/scratch/wf-host/<run-id>/`. This makes even an
interrupted or failed setup eligible for reverse-order teardown because it may have partially mutated
state.

A successful `prepare` persists `ready` and disarms its success-path `EXIT` trap; it does **not** tear
down immediately. The caller owns `prepare → engine → teardown` and must invoke `teardown` from a
finally-equivalent path after engine work. Failure and interruption traps remain armed through setup
and health checks, and a stale ledger is recovered before another prepare for the same run. A hard kill
that bypasses a shell trap is recoverable from the retained ledger on the next invocation.

Recovery and teardown attempt every recorded pending reversal in reverse order, including started,
completed, and failed setup entries, even when an earlier reversal fails. The payload is deleted as soon
as no teardown remains pending — including after setup or health failure — while the command-free ledger
remains as safe audit evidence. A teardown failure leaves only the ledger and payload needed for its
outstanding reversal and is reported as an error; the provider never claims source or persistence state
was restored without evidence.

The provider writes only its scratch ledger and payload. It never creates permanent product
surfaces, commits, runs installations or builds, or invents missing command bindings.

## Provider result

`wf-host:qa-host` returns a terminal `QA-HOST — ready`, `torn-down`, or `error` block with the run
id, completed/requested operations, profile-slot provenance, health result, ledger path, teardown
result, and safe timestamp/status evidence. For an orchestration `ready` result, `Evidence` may also
carry bounded readiness references validated from the provider's private result file plus the teardown
token `run=<run-id>; ledger=<ledger path>` while teardown is pending. It omits command text, payload
values, credentials, child output, absolute URLs, query/fragment data, and persistence data. The
provider agent accepts either direct command pass-through or selected host-dependent scenario blocks;
it maps only the stable `Backend host required:`, `Host required:`, `Host operations:`, and
`Host operation target:` metadata, never free text.
