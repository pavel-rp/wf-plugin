# Skills Configuration

**Model:** claude-opus-4-8

Canned fixture project for the wf-sandbox-testing hermetic runner. A skill invoked in
this workspace resolves **only** the `fake` capability (owner of both the delivery and
tracker surfaces), so every provider op returns a scripted response and reaches no network.

This file is the source-of-truth for the fixture's `_local/config.md`; the runner's
`seed.sh` materializes it (substituting the `__WF_FAKE_ROOT__` plugin-root placeholder with
the clean in-image wf-fake install path) into a throwaway workspace before the demonstrated
skill invocation runs.

## Task Folders

| Key | Value |
|-----|-------|
| **Task Root** | `_local/wf` |
| **Folder Pattern** | `{task-root}/FAKE-<N>/` — the fixture uses the scripted `FAKE-` id shape the `fake` tracker binding returns. |

## Build / Verify

| Key | Value |
|-----|-------|
| **Verify Command** | `true` |

A no-op verify command: the fixture ships no buildable source — it exists only to drive a
real skill invocation against the scripted `fake` providers.

## Capabilities

| Capability | Path                           |
|------------|--------------------------------|
| fake       | plugin:wf-fake/capabilities/fake |

The fixture registers the `fake` capability as its **sole** provider set — the hermetic
in-memory binding that owns both the delivery and tracker surfaces. No real delivery/tracker
pack is registered, so no run path reaches a tracker/delivery host.

## Plugin Roots

| Plugin  | Root              |
| ------- | ----------------- |
| wf-fake | __WF_FAKE_ROOT__  |

Per-machine, resolver-owned mapping. In a real project `/wf-fake:init` writes this row; for
the hermetic fixture the runner substitutes the placeholder with the actual clean-install
path of the in-image `wf-fake` pack, so the row always points at the build under test.

## Fake

| Key | Value |
|-----|-------|
| **Fake Scripts** | `_local/fake/scripts.json` |
| **Fake Op Log**  | `_local/fake/op-log.jsonl` |

The paths the `fake` capability reads scripted responses from and appends its machine-readable
op log to. Both are workspace-local; nothing outside the workspace is ever read or written.
