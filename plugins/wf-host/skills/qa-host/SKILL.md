---
name: qa-host
description: Executes a profile-driven, run-scoped temporary QA host lifecycle — reversible API exposure, host augmentation, transactional persistence seed, synthetic fixtures, health verification, and durable reverse-order teardown recovery with a run-scoped ledger. Use when the registered host provider receives host-dependent QA work; all project bindings come from the host capability profile.
allowed-tools: [Read, Write, Edit, Bash, ToolSearch]
---

# /wf-host:qa-host — Temporary host lifecycle provider

Prepare only the host work the caller requests. A successful `prepare` deliberately leaves its
reversible state armed for the caller's engine work; the caller owns `prepare → engine → teardown` and
must invoke `teardown` from a finally-equivalent path. This skill has no project, stack, route,
database, or executable name. Those values are profile bindings. It never creates a permanent endpoint,
fixture, source edit, process, or seeded record.

Before any resolver call, run `pwd -P`; pass that absolute directory as `workspaceRoot` on every call.

## Command syntax

```
/wf-host:qa-host prepare --run <run-id> --lifecycle-token <opaque-token> --operations <comma-list> [--payload <opaque-json>]
/wf-host:qa-host teardown --run <run-id> --lifecycle-token <opaque-token>
```

`<comma-list>` contains zero or more ordered requests from `expose`, `augment`, `seed`, `fixture`,
and `verify`. `verify` is read-only and is not ledgered. The caller chooses the opaque `run-id`; it
must be 1–128 characters, begin with an ASCII letter or digit, and otherwise contain only ASCII letters,
digits, dots, underscores, and hyphens. Reject `.` and `..`, then resolve the run directory canonically and
require it to remain a strict child of `_local/scratch/wf-host/` before any scratch access. The lifecycle token must be exactly 64
lowercase hexadecimal characters encoding 32 caller-generated CSPRNG bytes; reject every other length or
encoding before scratch access. It authenticates this run's prepare/teardown ownership and is never exposed
to profile commands or persisted raw. `<opaque-json>`
is input for the profile bindings, not a project value to interpret. With no arguments, stop and require
an explicit form.

## Safety Rules

**Allowed:**

- Resolve the `host` profile with `resolve_profile({ capability: "host", workspaceRoot })`.
- Write the run ledger and payload only under `_local/scratch/wf-host/<run-id>/`.
- Execute a nonempty profile-bound command for a requested operation, with its timeout.
- Invoke only the matching teardown binding, in reverse order, for every operation whose setup intent
  was persisted before its setup command began.

**Forbidden:**

- Hand-read the profile, capability manifest, registry, or plugin install path.
- Invent a command, substitute a project value, or run an operation whose setup or teardown binding
  is absent.
- Make a permanent product change, run an install/build, commit, or retain a fixture after the run.
- Place payloads, command text, credentials, or other secret-bearing values in the report or ledger.

## Profile and command contract

Call `resolve_profile` first. If it is absent or unavailable, stop and direct the caller to
`/wf-host:init`; never inspect profile files as fallback. Require the following pairs for each
requested mutable operation:

| Operation | Setup slot | Teardown slot |
|---|---|---|
| expose | `{expose-command}` | `{expose-teardown-command}` |
| augment | `{augment-command}` | `{augment-teardown-command}` |
| seed | `{seed-command}` | `{seed-teardown-command}` |
| fixture | `{fixture-command}` | `{fixture-teardown-command}` |

Require `{command-timeout-seconds}` to be a positive whole number. Before the first mutation,
validate every requested pair. A missing or placeholder binding is a preflight error: execute
nothing. `{health-command}` is optional; run it for `verify` and after all mutable setup steps when
nonempty.

For each profile command, first set `umask 077`. Before any write, require `_local/`, `_local/scratch/`,
`_local/scratch/wf-host/`, and the run directory to be real, current-user-owned directories rather than
symlinks and reject any existing ancestor that is group- or world-writable. Create missing scratch directories
with mode `0700`; require the provider-owned `_local/scratch/wf-host/` and run directory to remain mode `0700`,
and never broaden existing permissions. Reject a payload, ledger, capture, result, or lock path that already
names a symlink, a file with link count other than one, a non-regular file, a foreign-owned file, or a file
with group/world permission bits. Create new private files without following links at mode `0600`; persist
ledger updates through a mode-`0600` same-directory temporary file plus atomic rename. Before ledger access,
acquire `_local/scratch/wf-host/active-lifecycle.json` through an atomic exclusive-create operation that
reports an existing entry rather than replacing it; never implement acquisition as check-then-write. Require the created lock to
remain current-user-owned, regular, link-count one, and exactly mode `0600` before every read, comparison, or
removal. It stores only the run id
and SHA-256 digest of the lifecycle token. A different run/token while that file exists is refused before
mutation; the matching token may recover or tear down its own ledger. Keep this global lifecycle lock
through `ready` and release it only after every teardown is complete. This prevents concurrent runs from
reversing or overlapping each other's active host state. Then expose only these generic variables to the
child process:

```
WF_HOST_RUN_ID=<run-id>
WF_HOST_OPERATION=<operation>
WF_HOST_PAYLOAD_FILE=<absolute payload path>
WF_HOST_LEDGER_FILE=<absolute ledger path>
WF_HOST_RESULT_FILE=<absolute private readiness-result path>
```

Run each setup, teardown, and health command through one owned shell wrapper with the configured
timeout. Set `umask 077`; redirect both child stdout and stderr to a distinct mode-`0600` capture file
inside the run directory, never to this conversation. After the child exits, discard that capture file
without reading, printing, or copying it into the ledger. Record only the operation, status, and safe
timestamps; never command text, output, payload data, credentials, URLs, or exit diagnostics.

A successful setup command may atomically write `WF_HOST_RESULT_FILE` as JSON containing only
`{"references":[{"kind":"route|fixture|control|observation","value":"<safe-ref>"}]}`. The wrapper
accepts at most 32 references; each value is at most 512 characters, contains no control characters,
credentials, query, or fragment, and a `route` value must be a root-relative path beginning with `/`.
Reject malformed or unsafe result data as a setup failure and run teardown. Copy validated references
into the final `Evidence` field for the engine, never into the ledger, then delete the result file on every
path. An absent or empty result file is valid when the operation needs no readiness handoff.

The wrapper installs `EXIT`, `HUP`, `INT`, and `TERM` traps before the first mutable command. While
armed, each trap invokes this skill's persisted-ledger teardown routine, then exits with the original
status. After all requested setup and health checks succeed, persist the `ready` state and disarm the
success-path `EXIT` trap before returning `ready`; it must not tear down a prepared host on normal
return. Keep traps armed through setup, health, and teardown failures or interruption. Do not place the
payload on the command line. A forced, untrappable process kill cannot run a trap: because the ledger
is durable, the next `prepare` for that run must first execute its recorded teardown and report this
recovery rather than start new setup.

## Run-scoped teardown ledger

Create `_local/scratch/wf-host/<run-id>/teardown-ledger.json` before mutation. It must record only
safe provenance and evidence:

```json
{
  "runId": "<run-id>",
  "state": "preparing",
  "operations": [
    {"operation": "seed", "setupSlot": "seed-command", "teardownSlot": "seed-teardown-command", "setup": "started", "teardown": "pending", "startedAt": "<ISO-8601>", "completedAt": null}
  ],
  "teardown": {"status": "pending", "attemptedAt": null, "completedAt": null, "failures": []}
}
```

Do not record command bodies, payload values, terminal output, tokens, URLs, persistence data, or
failure diagnostics beyond operation, status, and timestamps. **Before** every setup command, append
and persist its teardown intent with `setup: "started"` and `teardown: "pending"`. After the command
returns, update that same entry to `complete` or `failed`, retaining `startedAt`; a failed setup may
have partially mutated state and therefore still requires teardown. On a subsequent same-run `prepare`,
if the ledger is not fully torn down, recover every recorded entry with pending teardown in reverse
order, including entries whose setup is `started`, `complete`, or `failed`, before any new mutation,
**but only when the request presents the lifecycle token whose digest owns the global lock**. A different
token never triggers recovery. If authorized recovery fails, stop with `error` and preserve both ledger
and payload.

## Prepare lifecycle

1. Validate arguments, the exact lifecycle-token format, profile, timeout, and every requested
   setup/teardown pair before mutations.
2. Secure the scratch path and acquire the global lifecycle lock for the run/token digest. Refuse a
   different active owner. Create the private payload file and empty ledger, then install armed wrapper
   traps.
3. For each mutable operation in the caller's requested order, persist a `started` teardown-intent
   entry **before** executing setup. Then update that entry with only its safe setup status and
   timestamps.
4. Run the optional health command after preparation, or for an explicit `verify`. A health failure
   is a run failure.
5. On any setup or health failure, interruption, or armed wrapper exit, execute reverse-order teardown
   for every recorded pending entry, not merely completed setup. Attempt every teardown even after one
   fails; write each safe result to the ledger. If all required reversals succeed, delete the payload
   immediately; retain it only while at least one pending teardown remains.
6. On success, persist `ready`, disarm the success-path `EXIT` trap, and emit `ready`. Retain the
   ledger as safe lifecycle evidence; retain the payload only if a pending teardown needs it, otherwise
   delete it. The caller owns the whole `prepare → engine → teardown` lifecycle and **must** invoke
   `teardown` from a finally-equivalent path after the engine has consumed a prepared host. The armed
   traps mitigate failure or interruption before `ready`; they cannot guarantee cleanup after control
   returns to the caller or after an untrappable kill.

## Teardown lifecycle

For `teardown --run <run-id> --lifecycle-token <opaque-token>`, require the token digest to match the
global lifecycle lock before loading or mutating that run's ledger. A mismatch is an error with zero
teardown attempts. If no ledger and no matching lock exist, report `torn-down` with `Operations: none`
(idempotent); if a matching lock exists without a ledger, clear that lock and report the same. Otherwise
execute every recorded operation whose teardown is not complete in reverse ledger order, regardless of
whether its setup is `started`, `complete`, or `failed`, using its recorded teardown slot and the same run
variables. Record all attempts; never stop after the first teardown error. Mark the ledger `torn-down`
and atomically remove the global lock only when all pending entries succeed. As soon as all required
reversals have succeeded, delete the payload file — including after setup or health failure — and retain
the ledger as safe audit evidence. On any failure, retain the lock, ledger, and payload only when a
teardown remains pending, and return `error` with the failed operation names.

## Edge Cases

- **Unknown operation, malformed run id/token, weak lifecycle token, missing payload JSON, or invalid timeout:** stop before any
  command.
- **Another lifecycle owns the global lock:** refuse prepare and teardown before mutation. Never recover
  or reverse a run under a different token digest.
- **Requested binding is blank/placeholder:** report the exact missing operation and direct the user
  to fill `_local/profiles/host.profile.json`; do not partially prepare other operations.
- **Setup command fails:** tear down every operation whose intent was persisted, including the failed
  setup entry, then return `error`; delete payload once no teardown remains pending.
- **Health failure:** tear down every recorded operation; delete payload when every reversal succeeds,
  then return `error`.
- **Teardown fails:** finish attempts for all remaining entries, retain the ledger and payload only
  while any teardown remains pending, and never claim the working state was restored.
- **Interrupted run or stale ledger:** recover every pending entry, including started setup, before
  accepting more setup work for that run.

## Final Output

```
QA-HOST — <ready | torn-down | error>

Run:        <run-id>
Operations: <completed operations | none>
Provenance: <profile slots used, comma-separated>
Health:     <PASS | skipped | FAIL>
Ledger:     _local/scratch/wf-host/<run-id>/teardown-ledger.json
Teardown:   <pending — caller must invoke teardown | PASS — <N> reversed | FAIL — <operation list> | not started>
Evidence:   <setup/teardown timestamps and safe operation statuses; ready may append validated provider-produced readiness references>

Next: <caller continues engine execution then invokes teardown | none — teardown recovery required>
```

The block is always the final output. `ready` is never emitted after a teardown failure; `error`
always includes the ledger path and its teardown evidence.
