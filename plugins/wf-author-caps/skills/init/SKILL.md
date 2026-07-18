---
name: init
description: Onboards the wf-author-caps authoring toolkit into a wf-initialized repo in one command — self-registers the pack's author-caps capability into the wf capability registry by calling core's inspect_pack/register_pack resolver tools with the stable plugin id wf-author-caps, no manual install-root discovery or hand-edited registry rows. Use once (after /wf:init) to register author-caps so its authoring contributions resolve; re-run any time — register_pack is idempotent and self-checks the wiring.
allowed-tools: [Read, Bash]
---

# /wf-author-caps:init — Onboard the authoring toolkit (self-register via the resolver)

Collapse onboarding into **one command**, driven entirely by the core-bundled **wf-resolver** MCP
service. Installing the plugin makes all three skills discoverable by native composition —
`/wf-author-caps:init`, `/wf-author-caps:authoring-guide`, `/wf-author-caps:authoring-taxonomy` —
but registers **no** phase contribution. That still requires a row in the downstream
`## Capabilities` registry. This skill performs that registration by calling core's typed
`inspect_pack` / `register_pack` tools with the **stable plugin id, `wf-author-caps`** — it never
probes `${CLAUDE_PLUGIN_ROOT}`, never derives an install root itself, and never hand-edits
`_local/config.md` or a `## Plugin Roots` mapping. Core resolves the install path (via
`claude plugin list --json`), validates the manifest, computes a fingerprint, and owns the registry
write end-to-end — including the self-check that the capability now resolves.

**Why register a capability whose fragments table is still empty.** The two reference skills already
reach users by native composition alone — an authoring question loads them by description
auto-selection, with no registry row involved. But the capability's phase contributions (guidance at
`spec` and `implement`, a `finding` at `verify`, a `scenario` at `qa-generation`, and its
constitution articles) presuppose a registration path: without one, those fragments could never fire
once added. Registering now makes `author-caps` resolvable ahead of them landing.

**This is registry-side onboarding only.** It cannot register a `/command` — a discoverable skill
must live in a plugin's `skills/` directory (native discovery). This skill wires the **registry** row.

## Contents

- [Command Syntax](#command-syntax)
- [Safety Rules](#safety-rules-non-negotiable)
- [Onboarding procedure](#onboarding-procedure)
- [Edge Cases](#edge-cases)
- [Final Output](#final-output)

---

## Command Syntax

```
/wf-author-caps:init
```

Takes no arguments — it always registers the single `author-caps` capability this plugin ships,
under the stable plugin id `wf-author-caps`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Call the bundled `wf-resolver` MCP tools: `resolve_config`, `resolve_registry`, `inspect_pack`,
  `register_pack`, and — on a failure — `resolve_gate`.
- Read `_local/config.md` (or the `registryPath` `resolve_config` returns), and run read-only
  `git rev-parse --git-dir`, only to confirm `/wf:init` has already run.

**Forbidden:**

- Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive an install root by hand —
  `inspect_pack`/`register_pack` resolve it.
- Hand-edit `_local/config.md`, a `## Capabilities` row, or a `## Plugin Roots` row —
  `register_pack` owns that write exclusively.
- Modify any source file.
- Register a `/command` (impossible — native discovery only; this skill wires the registry).
- Run builds, tests, installs, or any destructive version-control operation.

---

## Onboarding procedure

1. **Precondition.** Confirm a git repository (`git rev-parse --git-dir`); if this fails, stop:
   "`/wf-author-caps:init` must run inside a git repository — run `/wf:init` first." Call
   `resolve_config` for the resolved registry location and Read it to confirm the file exists. If it
   does not, stop: "Run `/wf:init` first — `/wf-author-caps:init` registers into the registry that
   `/wf:init` creates."
2. **Check prior state (reporting only).** Call `resolve_registry`; note whether `author-caps`
   already appears with `validity: "ok"`. This never skips a later step — it only decides whether the
   Final Output says `onboarded` or `already-registered`.
3. **Inspect the plugin.** Call `inspect_pack({ pluginId: "wf-author-caps" })`. Read-only; returns
   `{ installed, enabled, installPath, capabilities[], fingerprint, valid, issues[] }`.
   - `valid: false` (not installed, disabled, no readable
     `capabilities/author-caps/manifest.md`, or `claude plugin list --json` itself unavailable) → go
     to **Failure path**; **do not call `register_pack`**, so nothing is written.
4. **Register.** Call
   `register_pack({ pluginId: "wf-author-caps", expectedFingerprint: <fingerprint from step 3> })`.
   It writes the `## Plugin Roots` row and the `author-caps` `## Capabilities` row in a single write
   (a plain file write, not a filesystem-atomic temp+rename swap), refreshes the resolver snapshot,
   and self-checks that `author-caps` now resolves — returning
   `{ status, reason, capabilities[], root, selfCheck, preview[] }`.
   - `status: "rejected"` → **Failure path**. The rejection happens *before* any write, so the
     registry is untouched.
   - `status: "registered"`, `selfCheck: "ok"` → success.
   - `status: "registered"`, `selfCheck: "failed"` → report `partial`: the registry write landed but
     `author-caps` still does not resolve; direct the user to re-run `/wf-author-caps:init` after
     checking the install.

The capability's manifest declares **no** `profile-template:`, so the Final Output's `Profile:` row
is always `skipped — no template` — a static fact, not a resolver call.

### Failure path

Call `resolve_gate({ surface: "delivery-write" })` (registering a capability is a registry write).
Report its `categories`, `diagnostics`, and `recovery` alongside the pack-specific `issues[]` (from
`inspect_pack`) or `reason` (from a rejected `register_pack`) — never a bare error. Finish with
`partial`, and state explicitly that nothing was registered.

---

## Edge Cases

- **Not a git repo / `/wf:init` not run:** stop per the precondition step above.
- **Plugin not installed or disabled** (`inspect_pack.installed`/`enabled` false): failure path;
  direct the user to install or enable the plugin, then re-run. Nothing is written.
- **`claude plugin list --json` unavailable:** `inspect_pack` reports `installed: false` with an
  issue naming the CLI call as the cause (a broken or unavailable `claude` CLI, not a missing
  plugin) — failure path; direct the user to check their `claude` CLI, then re-run.
- **No readable manifest** (`inspect_pack.capabilities` empty): failure path; the install looks
  corrupted — reinstall the plugin.
- **Path-invalid install** (`register_pack` rejects on an install path that fails validation): the
  rejection precedes the write, so the registry is untouched — failure path; report the typed
  `reason` and re-run after fixing the install.
- **Stale fingerprint** (`register_pack` rejects on a fingerprint mismatch): re-run `inspect_pack`
  for the current fingerprint and retry `register_pack`.
- **`author-caps` already registered:** `register_pack` upserts idempotently — re-running is always
  safe; report `already-registered` per step 2's pre-check.
- **The capability declares no fragment row yet:** expected — it registers ahead of its first
  contribution. Registry validation passes on a zero-row table, and no authoring term surfaces in any
  core phase until those fragments land.
- **Self-check FAIL:** report `partial`; never claim success.

---

## Final Output

```
WF-AUTHOR-CAPS-INIT — <onboarded | already-registered | partial>

Registry:   <registryPath from resolve_config>
Pack root:  <installPath from inspect_pack — may be null on the failure path>
Registered: author-caps — <registered | already registered | nothing written>
Profile:    skipped — no template
Self-check: <PASS — author-caps resolves | FAIL — <issues / reason>>

Next: ask an authoring question to load /wf-author-caps:authoring-guide or /wf-author-caps:authoring-taxonomy by description auto-selection, or invoke either directly. Re-run /wf-author-caps:init any time — register_pack is idempotent.
```

**The final-output block must always be the very last thing output to chat.**
