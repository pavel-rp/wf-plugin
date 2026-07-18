---
name: init
description: Onboards the wf-sandbox-testing pack into a wf-initialized repo in one command — self-registers the pack's sandbox-testing capability into the wf capability registry by calling core's inspect_pack/register_pack resolver tools with the stable plugin id wf-sandbox-testing, no manual install-root discovery or hand-edited registry rows. Use once (after /wf:init) to record the skill-eval harness as an active capability so registry validation and /wf:resolve see it; re-run any time — register_pack is idempotent and self-checks the wiring. Fails loudly directing the user to /wf:init when the repo is not wf-initialized.
allowed-tools: [Read, Bash]
---

# /wf-sandbox-testing:init — Onboard the skill-eval harness pack (self-register via the resolver)

Collapse wf-sandbox-testing onboarding into **one command**, driven by the core-bundled
**wf-resolver** MCP service. Installing the plugin makes `/wf-sandbox-testing:init` discoverable
and the harness scripts (`assert/`, `corpus/`, `runner/`, `fixtures/`) available by native
composition — but it registers **no** capability row on its own. That requires a row in the
downstream `## Capabilities` registry. This skill performs that registration by calling core's typed
`inspect_pack` / `register_pack` tools with the pack's **stable plugin id, `wf-sandbox-testing`** —
it never probes `${CLAUDE_PLUGIN_ROOT}`, never derives an install root itself, and never hand-edits
the `## Capabilities` table or the `## Plugin Roots` mapping. Core resolves the install path,
validates the manifest, computes a fingerprint, and owns the registry write end-to-end — then
self-checks that the capability resolves.

The `sandbox-testing` capability is a **feature** capability: it owns no provider surface and
attaches no phase fragment. Its registry row is a **presence-only** declaration so registry
validation acknowledges the harness and `/wf:resolve` reports it — no capability-aware phase changes
whether the row is present or absent. The harness itself is invoked as scripts (see the pack README),
never fired by a phase.

---

## Command Syntax

```
/wf-sandbox-testing:init
```

Takes no arguments — it always registers the single `sandbox-testing` capability this pack ships,
under the stable plugin id `wf-sandbox-testing`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Call the bundled `wf-resolver` MCP tools: `resolve_config`, `resolve_registry`, `inspect_pack`,
  `register_pack`, and — on a failure — `resolve_gate`.
- Read `_local/config.md` (or the `registryPath` `resolve_config` returns) to confirm `/wf:init` has
  already run.

**Forbidden:**

- Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive an install root by hand —
  `inspect_pack`/`register_pack` resolve it.
- Hand-edit the `## Capabilities` table or a `## Plugin Roots` row — `register_pack` owns that write
  exclusively.
- Modify any source file, or write anywhere at all — this skill only calls resolver tools and reads
  config. It seeds **no** config section (the harness reads no `_local/config.md` key) and needs no
  profile (the capability declares no `profile-template:`).
- Register a `/command` (impossible — native discovery only; this skill wires the registry row).
- Run builds, tests, installs, container runs, or any network/version-control operation.

---

## Onboarding procedure

1. **Precondition.** Call `resolve_config` for the resolved registry location and Read it to confirm
   `_local/config.md` exists. If the resolver reports the project is uninitialized (no resolved
   config / absent `_local/config.md`), **stop loudly**: "Run `/wf:init` first —
   `/wf-sandbox-testing:init` registers into the registry that `/wf:init` creates. It never registers
   into a half-configured repo." Do not call `inspect_pack` or `register_pack`.
2. **Check prior state (reporting only).** Call `resolve_registry`; note whether `sandbox-testing`
   already appears with `validity: "ok"`. This never skips a later step — it only decides whether the
   Final Output says `onboarded` or `already-registered`.
3. **Inspect the pack.** Call `inspect_pack({ pluginId: "wf-sandbox-testing" })`. Read-only; returns
   `{ installed, enabled, installPath, capabilities[], fingerprint, valid, issues[] }`.
   - `valid: false` (not installed, disabled, no readable
     `capabilities/sandbox-testing/manifest.md`, or `claude plugin list --json` itself unavailable) →
     go to **Failure path**; do not call `register_pack`.
4. **Register.** Call
   `register_pack({ pluginId: "wf-sandbox-testing", expectedFingerprint: <fingerprint from step 3> })`.
   It writes the `## Plugin Roots` row and the `sandbox-testing` `## Capabilities` row in a single
   write, refreshes the resolver snapshot, and self-checks that `sandbox-testing` now resolves —
   returning `{ status, reason, capabilities[], root, selfCheck, preview[] }`.
   - `status: "rejected"` → **Failure path**.
   - `status: "registered"`, `selfCheck: "ok"` → success; report `onboarded` (or
     `already-registered` per step 2).
   - `status: "registered"`, `selfCheck: "failed"` → report `partial`: the registry write landed but
     `sandbox-testing` still does not resolve; direct the user to re-run `/wf-sandbox-testing:init`
     after checking the pack install.

The `sandbox-testing` capability's manifest declares **no** `profile-template:`, so the Final
Output's `Profile:` row is always `skipped — no template` — a static fact, not a resolver call.

### Failure path (WF-272 diagnostics)

Call `resolve_gate({ surface: "delivery-write" })` (registering a pack is a registry write). Report
its `categories`, `diagnostics`, and `recovery` alongside the pack-specific `issues[]` (from
`inspect_pack`) or `reason` (from a rejected `register_pack`) — never a bare error. Finish with
`partial`.

---

## Edge Cases

- **`/wf:init` not run:** stop per the precondition step above, directing the user to `/wf:init` —
  never register into a half-configured repo (success criterion 5).
- **wf-sandbox-testing not installed or disabled** (`inspect_pack.installed`/`enabled` false):
  failure path; direct the user to install/enable the plugin, then re-run.
- **`claude plugin list --json` unavailable:** `inspect_pack` reports `installed: false` with an
  issue naming the CLI call as the cause — failure path; check the `claude` CLI, then re-run.
- **No readable pack manifest** (`inspect_pack.capabilities` empty): failure path; the install looks
  corrupted — reinstall the plugin.
- **Stale fingerprint** (`register_pack` rejects on a fingerprint mismatch): re-run `inspect_pack` to
  get the current fingerprint and retry `register_pack`.
- **`sandbox-testing` already registered:** `register_pack` upserts idempotently — re-running is
  always safe; report `already-registered` per step 2's pre-check.
- **Self-check FAIL:** report `partial`; never claim success.

---

## Final Output

```
WF-SANDBOX-TESTING-INIT — <onboarded | already-registered | partial>

Registry:   <registryPath from resolve_config>
Pack root:  <installPath from inspect_pack — may be null on the failure path>
Registered: sandbox-testing — <registered | already registered> (feature; no provider surface, no phase fragment)
Profile:    skipped — no template
Self-check: <PASS — sandbox-testing resolves | FAIL — <issues / reason>>

Next: author a fixture and run a tier — see the pack README for the runner, the assertion tiers, the corpus, and the findings-loop procedure. Fixtures that script a provider also need the wf-fake pack installed and registered (the runner fails loudly naming wf-fake when it is absent). Re-run /wf-sandbox-testing:init any time — register_pack is idempotent.
```

**The final-output block must always be the very last thing output to chat.**
