---
name: init
description: Onboards the wf-node-ts pack into a wf-initialized repo in one command — self-registers the pack's node-ts capability into the wf capability registry by calling core's inspect_pack/register_pack resolver tools with the stable plugin id wf-node-ts, no manual install-root discovery or hand-edited registry rows. Use once (after /wf:init) to activate the Node/TS pure-helper test harness; re-run any time — register_pack is idempotent and self-checks the wiring.
allowed-tools: [Read, Bash]
---

# /wf-node-ts:init — Onboard the wf-node-ts pack (self-register via the resolver)

Collapse wf-node-ts onboarding into **one command**, driven entirely by the core-bundled
**wf-resolver** MCP service. Installing the plugin makes `/wf-node-ts:init` and
`/wf-node-ts:test-node` discoverable (native composition) but registers **no** phase
fragment — that still requires a row in the downstream `## Capabilities` registry. This
skill performs that registration by calling core's typed `inspect_pack` / `register_pack`
tools with wf-node-ts's **stable plugin id, `wf-node-ts`** — it never probes
`${CLAUDE_PLUGIN_ROOT}`, never derives an install root itself, and never hand-edits
`_local/config.md` or a `## Plugin Roots` mapping. Core resolves the install path (via
`claude plugin list --json`), validates the pack's manifest, computes a fingerprint, and
owns the registry write end-to-end — including the self-check that the capability now
resolves.

This mirrors `/wf-git:init` exactly, simplified for a single-capability pack: there is no
capability-subset argument, because wf-node-ts ships exactly one capability.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-node-ts:*` commands are already discoverable from installing the plugin; this skill
wires the **fragment + registry**.

---

## Command Syntax

```
/wf-node-ts:init
```

Takes no arguments — it always registers the single `node-ts` capability this pack
ships, under the stable plugin id `wf-node-ts`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Call the bundled `wf-resolver` MCP tools: `resolve_config`, `resolve_registry`,
  `inspect_pack`, `register_pack`, and — on a failure — `resolve_gate`.
- Read `_local/config.md` (or the `registryPath` `resolve_config` returns), and run
  read-only `git rev-parse --git-dir`, only to confirm `/wf:init` has already run.

**Forbidden:**

- Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive an install root by hand —
  `inspect_pack`/`register_pack` resolve it.
- Hand-edit `_local/config.md`, a `## Capabilities` row, or a `## Plugin Roots` row —
  `register_pack` owns that write exclusively.
- Modify any source file.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Run builds, tests, installs, or any destructive git operation.

---

## Onboarding procedure

1. **Precondition.** Confirm a git repository (`git rev-parse --git-dir`); if this fails,
   stop: "`/wf-node-ts:init` must run inside a git repository — run `/wf:init` first."
   Call `resolve_config` for the resolved registry location and Read it to confirm the
   file exists. If it does not, stop: "Run `/wf:init` first — `/wf-node-ts:init`
   registers into the registry that `/wf:init` creates."
2. **Check prior state (reporting only).** Call `resolve_registry`; note whether
   `node-ts` already appears with `validity: "ok"`. This never skips a later step — it
   only decides whether the Final Output says `onboarded` or `already-registered`.
3. **Inspect the pack.** Call `inspect_pack({ pluginId: "wf-node-ts" })`. Read-only;
   returns `{ installed, enabled, installPath, capabilities[], fingerprint, valid, issues[] }`.
   - `valid: false` (not installed, disabled, or no readable
     `capabilities/node-ts/manifest.md`) → go to **Failure path**; do not call
     `register_pack`.
4. **Register.** Call
   `register_pack({ pluginId: "wf-node-ts", expectedFingerprint: <fingerprint from step 3> })`.
   It writes the `## Plugin Roots` row and the `node-ts` `## Capabilities` row in one
   atomic write, refreshes the resolver snapshot, and self-checks that `node-ts` now
   resolves — returning `{ status, reason, capabilities[], root, selfCheck, preview[] }`.
   - `status: "rejected"` → **Failure path**.
   - `status: "registered"`, `selfCheck: "ok"` → success.
   - `status: "registered"`, `selfCheck: "failed"` → report `partial`: the registry write
     landed but `node-ts` still does not resolve; direct the user to re-run
     `/wf-node-ts:init` after checking the pack install.

The `node-ts` capability's manifest declares **no** `profile-template:`, so the Final
Output's `Profile:` row is always `skipped — no template` — a static fact, not a
resolver call.

### Failure path (SUB-4 / WF-272 diagnostics)

Call `resolve_gate({ surface: "delivery-write" })` (registering a pack is a registry
write). Report its `categories`, `diagnostics`, and `recovery` alongside the pack-specific
`issues[]` (from `inspect_pack`) or `reason` (from a rejected `register_pack`) — never a
bare error. Finish with `partial`.

---

## Edge Cases

- **Not a git repo / `/wf:init` not run:** stop per the precondition step above.
- **`wf-node-ts` not installed or disabled** (`inspect_pack.installed`/`enabled` false):
  failure path; direct the user to install/enable the plugin, then re-run.
- **No readable pack manifest** (`inspect_pack.capabilities` empty): failure path; the
  install looks corrupted — reinstall the plugin.
- **Stale fingerprint** (`register_pack` rejects on a fingerprint mismatch): re-run
  `inspect_pack` to get the current fingerprint and retry `register_pack`.
- **`node-ts` already registered:** `register_pack` upserts idempotently — re-running is
  always safe; report `already-registered` per step 2's pre-check.
- **Self-check FAIL:** report `partial`; never claim success.

---

## Final Output

```
WF-NODE-TS-INIT — <onboarded | already-registered | partial>

Registry:   <registryPath from resolve_config>
Pack root:  <root from register_pack>
Registered: node-ts — <registered | already registered>
Profile:    skipped — no template
Self-check: <PASS — node-ts resolves | FAIL — <issues / reason>>

Next: run /wf:implement on a task that authors a pure-helper unit test — core aggregates the node-ts test-authoring guidance from the new plugin. Re-run /wf-node-ts:init any time — register_pack is idempotent.
```

**The final-output block must always be the very last thing output to chat.**
