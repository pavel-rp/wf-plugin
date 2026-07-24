---
name: init
description: Onboards the wf-fake pack into a wf-initialized FIXTURE project in one command — self-registers the pack's fake capability into the wf capability registry by calling core's inspect_pack/register_pack resolver tools with the stable plugin id wf-fake, then writes the Fake config section (scripts + op-log paths). The fake capability owns BOTH the delivery and tracker provider surfaces with a hermetic, scripted, op-recording in-memory binding. Use once (after /wf:init) inside a fixture project only — never a real project, where fake would trip the surface-overlap validation against a real delivery/tracker pack. Re-run any time; register_pack is idempotent and self-checks the wiring.
allowed-tools: [Read, Write, Bash]
---

# /wf-fake:init — Onboard the wf-fake fixture pack (self-register via the resolver)

Collapse wf-fake onboarding into **one command**, driven by the core-bundled **wf-resolver**
MCP service. Installing the plugin makes `/wf-fake:init` discoverable (native composition) but
registers **no** phase fragment — that requires a row in the downstream `## Capabilities`
registry. This skill performs that registration by calling core's typed `inspect_pack` /
`register_pack` tools with wf-fake's **stable plugin id, `wf-fake`** — it never probes
`${CLAUDE_PLUGIN_ROOT}`, never derives an install root itself, and never hand-edits the
`## Capabilities` table or the `## Plugin Roots` mapping. Core resolves the install path,
validates the manifest, computes a fingerprint, and owns the registry write end-to-end — then
self-checks that the capability resolves.

The `fake` capability owns **both** the `delivery` and `tracker` provider surfaces with a
hermetic, in-memory, scripted, op-recording binding (see the fake capability's onboarding
reference). It is meant **only for fixture projects** — a
project whose registry lists `fake` and no real delivery/tracker pack.

> **Fixture-only — the overlap check is a feature.** Registering `fake` in a real project
> alongside `git` (delivery) or `linear`/`ado` (tracker) correctly trips the registry's
> partitioned-ownership overlap validation, failing and naming both offenders. That is the
> contract working as designed, not a bug. Only register `fake` where it is the sole owner of
> both surfaces.

---

## Command Syntax

```
/wf-fake:init
```

Takes no arguments — it always registers the single `fake` capability this pack ships, under the
stable plugin id `wf-fake`, and seeds the `## Fake` config section.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Call the bundled `wf-resolver` MCP tools: `resolve_config`, `resolve_registry`, `inspect_pack`,
  `register_pack`, and — on a failure — `resolve_gate`.
- Read `_local/config.md` (or the `registryPath` `resolve_config` returns) to confirm `/wf:init`
  has already run, and **write only** the `## Fake` config section into it (the two path keys).

**Forbidden:**

- Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive an install root by hand —
  `inspect_pack`/`register_pack` resolve it.
- Hand-edit the `## Capabilities` table or a `## Plugin Roots` row — `register_pack` owns that
  write exclusively.
- Modify any source file, or write anywhere outside `_local/config.md`.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Run builds, tests, installs, or any network/version-control operation.

---

## Onboarding procedure

Before any resolver MCP call, run `pwd -P` once and use the returned absolute current Agent/session workspace directory as `<workspace-root>`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit the primary checkout's or a parent Agent's root. Every resolver call below must explicitly include `workspaceRoot: "<workspace-root>"`; omission is a hard schema error, with no default or fallback.

1. **Precondition.** Call `resolve_config({ workspaceRoot: "<workspace-root>" })` for the resolved registry location and Read it to
   confirm `_local/config.md` exists. If it does not, stop: "Run `/wf:init` first —
   `/wf-fake:init` registers into the registry that `/wf:init` creates."
2. **Check prior state (reporting only).** Call `resolve_registry({ workspaceRoot: "<workspace-root>" })`; note whether `fake` already
   appears with `validity: "ok"`. This never skips a later step — it only decides whether the
   Final Output says `onboarded` or `already-registered`.
3. **Inspect the pack.** Call `inspect_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-fake" })`. Read-only; returns
   `{ installed, enabled, installPath, capabilities[], fingerprint, valid, issues[] }`.
   - `valid: false` (not installed, disabled, no readable `capabilities/fake/manifest.md`, or
     `claude plugin list --json` itself unavailable) → go to **Failure path**; do not call
     `register_pack`.
4. **Register.** Call
   `register_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-fake", expectedFingerprint: <fingerprint from step 3> })`. It
   writes the `## Plugin Roots` row and the `fake` `## Capabilities` row in a single write,
   refreshes the resolver snapshot, and self-checks that `fake` now resolves — returning
   `{ status, reason, capabilities[], root, selfCheck, preview[] }`.
   - `status: "rejected"` → **Failure path**.
   - `status: "registered"`, `selfCheck: "ok"` → success; continue to step 5.
   - `status: "registered"`, `selfCheck: "failed"` → report `partial`: the registry write landed
     but `fake` still does not resolve; direct the user to re-run `/wf-fake:init` after checking
     the pack install.
5. **Seed the `## Fake` config section.** If `_local/config.md` has no `## Fake` section, append
   it with the default fixture paths (do not overwrite an existing section — a fixture author may
   have relocated the files):

   ```markdown
   ## Fake

   | Key | Value |
   |-----|-------|
   | **Fake Scripts** | `_local/fake/scripts.json` |
   | **Fake Op Log**  | `_local/fake/op-log.jsonl` |
   ```

   The fake reads these paths for its scripted responses and op log (format: the pack's
   scripts-format reference). Remind the user to seed the scripts file
   before driving ops — an unseeded fixture fails loudly on the first op.

The `fake` capability's manifest declares **no** `profile-template:`, so the Final Output's
`Profile:` row is always `skipped — no template` — a static fact, not a resolver call.

### Failure path (WF-272 diagnostics)

Call `resolve_gate({ workspaceRoot: "<workspace-root>", surface: "delivery-write" })` (registering a pack is a registry write).
Report its `categories`, `diagnostics`, and `recovery` alongside the pack-specific `issues[]`
(from `inspect_pack`) or `reason` (from a rejected `register_pack`) — never a bare error. Finish
with `partial`.

---

## Edge Cases

- **`/wf:init` not run:** stop per the precondition step above.
- **wf-fake not installed or disabled** (`inspect_pack.installed`/`enabled` false): failure path;
  direct the user to install/enable the plugin, then re-run.
- **`claude plugin list --json` unavailable:** `inspect_pack` reports `installed: false` with an
  issue naming the CLI call as the cause — failure path; check the `claude` CLI, then re-run.
- **No readable pack manifest** (`inspect_pack.capabilities` empty): failure path; the install
  looks corrupted — reinstall the plugin.
- **Stale fingerprint** (`register_pack` rejects on a fingerprint mismatch): re-run `inspect_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-fake" })`
  to get the current fingerprint, then retry `register_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-fake", expectedFingerprint: <current fingerprint> })`.
- **`fake` already registered:** `register_pack` upserts idempotently — re-running is always
  safe; report `already-registered` per step 2's pre-check.
- **Co-registered with a real delivery/tracker pack:** this is a fixture-only capability — if
  registry validation later reports a surface overlap naming `fake` and a real pack, that is the
  contract working as designed. Remove `fake` from any non-fixture registry.
- **Self-check FAIL:** report `partial`; never claim success.

---

## Final Output

```
WF-FAKE-INIT — <onboarded | already-registered | partial>

Registry:   <registryPath from resolve_config>
Pack root:  <installPath from inspect_pack — may be null on the failure path>
Registered: fake — <registered | already registered> (owns delivery + tracker)
Config:     <## Fake seeded | ## Fake already present>
Profile:    skipped — no template
Self-check: <PASS — fake resolves | FAIL — <issues / reason>>

Next: seed the scripts file (see the pack's scripts-format reference), then drive any wf skill that resolves the delivery or tracker surface — fake serves scripted responses and records each op to the op log. Re-run /wf-fake:init any time — register_pack is idempotent.
```

**The final-output block must always be the very last thing output to chat.**
