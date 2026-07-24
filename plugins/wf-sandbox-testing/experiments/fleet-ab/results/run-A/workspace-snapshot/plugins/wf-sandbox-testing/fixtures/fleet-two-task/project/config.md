# Skills Configuration

**Model:** claude-opus-4-8

Canned fixture project for the accepted **fleet-two-task** measurement fixture (WF-401). A skill
invoked in this workspace resolves **only** the `fake` capability (owner of both the delivery and
tracker surfaces), so every provider op returns a scripted response and reaches no network. The
fixture defines one hermetic umbrella (`FLEET-1`) with **exactly two** independent synthetic runtime
children (`FLEET-2`, `FLEET-3`), each driven through the full ceremony by its own ship orchestrator.

This file is the source-of-truth for the fixture's `_local/config.md`; the fixture's `seed.sh`
materializes it (substituting the `__WF_FAKE_ROOT__` plugin-root placeholder with the clean in-image
wf-fake install path) into a throwaway workspace.

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | `_local/wf` |
| **Folder Pattern** | `{task-root}/FLEET-<N>/` — the scripted id shape the `fake` tracker binding returns. |

## Build / Verify

| Key | Value |
|-----|-------|
| **Verify Command** | `true` |

A no-op verify command: the fixture ships no buildable source — it exists only to define a
deterministic two-child fleet run whose accounting inputs are captured for measurement.

## Capabilities

| Capability | Path                           |
|------------|--------------------------------|
| fake       | plugin:wf-fake/capabilities/fake |

The fixture registers the `fake` capability as its **sole** provider set — the hermetic in-memory
binding that owns both the delivery and tracker surfaces. No real delivery/tracker pack is registered,
so no run path reaches a tracker/delivery host.

## Plugin Roots

| Plugin  | Root              |
| ------- | ----------------- |
| wf-fake | __WF_FAKE_ROOT__  |

Per-machine, resolver-owned mapping. For the hermetic fixture the seed substitutes the placeholder
with the actual clean-install path of the in-image `wf-fake` pack.

## Fake

| Key | Value |
|-----|-------|
| **Fake Scripts** | `_local/fake/scripts.json` |
| **Fake Op Log**  | `_local/fake/op-log.jsonl` |

The paths the `fake` capability reads scripted responses from and appends its machine-readable op log
to. Both are workspace-local; nothing outside the workspace is ever read or written. The op log is
durable fixture state that `seed.sh` resets before every run (proved leakage-free by `seed.sh
--prove-reset`).
