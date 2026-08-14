---
name: init
description: Onboards the wf-host pack into a wf-initialized repo in one command — self-registers the host capability through the bundled resolver's inspect_pack/register_pack flow, then seeds the generic host profile override when no local override exists. Use after /wf:init before running host-dependent QA.
allowed-tools: [Read, Write, Edit, Bash, ToolSearch]
---

# /wf-host:init — Onboard the generic host provider

Installing this pack makes `/wf-host:init` and `/wf-host:qa-host` discoverable, but does not activate
its provider fragment. This command uses the core resolver to register the sole `host` capability.
It never probes an install path or hand-edits `_local/config.md`, `## Plugin Roots`, or
`## Capabilities`.

## Command syntax

```
/wf-host:init
```

## Safety Rules

**Allowed:** read project files and run read-only git checks; call `inspect_pack`, `resolve_gate`,
`register_pack`, and `resolve_content`; securely create `_local/profiles/` and write only
`_local/profiles/host.profile.json` when seeding.

**Forbidden:** modify source or registry tables directly; derive a plugin root; run installs, builds,
tests, or destructive git operations; register any plugin id other than `wf-host`.

## Procedure

1. Run `pwd -P` and retain it as `<workspace-root>` for every resolver call. Confirm a git repo with
   `git rev-parse --git-dir`. Resolve the registry location from `wf.config.js`'s `registryPath`,
   defaulting to `_local/config.md`. If `_local/` or that registry is absent, stop: run `/wf:init`
   first.
2. Call `inspect_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-host" })`.
   If `valid` is false, stop without registration, report every returned issue, and direct the user
   to install, enable, or reinstall the pack as applicable. Retain its `fingerprint` and install path.
3. Call `resolve_gate({ workspaceRoot: "<workspace-root>", surface: "delivery-write" })`. If it
   reports unhealthy/block, stop before mutation and relay the categories, diagnostics, and recovery
   paths verbatim. Never manually recover the registry.
4. Call `register_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-host",
   expectedFingerprint: "<fingerprint>" })`. On `rejected`, report its reason and direct the user
   to rerun this command. On `registered`, retain the returned root and self-check result.
5. Seed the profile only after successful registration. Use
   `resolve_content({ workspaceRoot: "<workspace-root>", class: "profile-template", capability: "host" })`
   to obtain the default template. Before any profile write, set `umask 077`, create
   `_local/profiles/` as a real current-user-owned directory with mode `0700` (stop if it is a symlink,
   not a directory, or cannot be secured), and preserve an existing profile unchanged. If
   `_local/profiles/host.profile.json` is absent, write the template unchanged to a mode-`0600` temporary
   file in that directory, then atomically rename it to the profile path and record `seeded override`;
   otherwise record `default or local override in use`. Never read the installed pack's profile template
   directly.
6. If `selfCheck` is failed, report `partial`, call `resolve_gate` again for diagnostics, and direct
   the user to `/wf:resolve refresh`; do not claim onboarding succeeded.

## Edge Cases

- **Resolver tools unavailable:** fetch the deferred resolver tool schema once through the host tool
  search surface; if still unavailable, stop and direct the user to restart Claude Code.
- **Stale fingerprint:** rerun `/wf-host:init`; do not retry registration using the old fingerprint.
- **Existing registration:** registration is an idempotent upsert; report `registered` and preserve
  any existing profile override.
- **Placeholder profile remains:** onboarding is valid, but `/wf-host:qa-host` rejects requested
  operations until the relevant command/teardown pairs are supplied.

## Final Output

```
WF-HOST-INIT — <onboarded | partial>

Registry:   <registry location>
Pack root:  <install path>
Registered: host — registered
Profile:    <seeded override [seeded by <model id>] | default or local override in use>
Self-check: <PASS — register_pack selfCheck: ok | FAIL — <diagnostics and recovery>>

Next: fill the command/teardown pairs and review the default 120-second command timeout in _local/profiles/host.profile.json, then run /wf:qa-auto for a host-dependent QA plan.
```

The final-output block is always last. Use the runtime model id for a newly seeded profile, or
`unknown` when unavailable.
