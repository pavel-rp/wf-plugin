---
name: init
description: Onboards the wf-angular pack into a wf-initialized repo in one command — self-registers the pack's angular capability into the wf capability registry by calling the bundled resolver's inspect_pack/register_pack tools with the pack's stable plugin id, then seeds the angular profile override on divergence. Use once (after /wf:init) to activate the Angular test-host execution provider (qa-host + test-page) without hand-editing _local/config.md or probing the plugin install path; re-run only if register_pack reports the pack unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-angular:init — Onboard the wf-angular pack (self-register via inspect_pack/register_pack)

Collapse wf-angular onboarding into **one command**. Installing the plugin makes
`/wf-angular:init`, `/wf-angular:qa-host`, and `/wf-angular:test-page` discoverable
(native composition) but registers **no** phase fragment — that still requires a row in
the downstream `## Capabilities` table and a plugin-root entry. This skill does that
registration for you by calling the core plugin's bundled **wf-resolver** MCP tools —
`inspect_pack` then `register_pack` — passing wf-angular's own stable plugin id
(`wf-angular`). Those tools resolve the pack's install path via `claude plugin list
--json`, validate its manifest, and own the registry write themselves; this skill never
probes `${CLAUDE_PLUGIN_ROOT}` and never hand-edits the `## Plugin Roots` / `##
Capabilities` tables.

This mirrors `/wf-browser-qa:init` and `/wf-ado:init` for a single-capability pack: there
is no capability-subset argument, because wf-angular ships exactly one capability.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-angular:*` commands are already discoverable from installing the plugin; this skill
wires the **fragment + registry** via the resolver tools.

---

## Command Syntax

```
/wf-angular:init
```

Takes no arguments — it always registers the single `angular` capability this pack
ships, under the fixed plugin id `wf-angular`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read-only `git` (`git rev-parse`).
- Call the bundled `wf-resolver` MCP tools `inspect_pack`, `resolve_gate`, and
  `register_pack` — always with `pluginId: "wf-angular"`, wf-angular's own exact stable
  plugin id.
- Write/edit files under `_local/` — including seeding the profile override (Phase 3).

**Forbidden:**

- Modify any source file except the writes named above.
- Probe `${CLAUDE_PLUGIN_ROOT}`, derive an install root by any other means, or
  hand-edit the `## Plugin Roots` / `## Capabilities` tables directly — that write
  belongs solely to `register_pack`.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Call `inspect_pack` / `register_pack` for any `pluginId` other than `wf-angular`.
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "`/wf-angular:init`
   must run inside a git repository — run `/wf:init` first."
2. **Resolve the registry location** exactly as `/wf:init` does — read `wf.config.js` at
   the repo root (`git rev-parse --show-toplevel`) and use its optional `registryPath`
   key, **defaulting to `_local/config.md`** when absent. Call this `<registry-location>`.
3. **Require `/wf:init` first.** If `_local/` is absent, or `<registry-location>` does not
   exist, stop: "Run `/wf:init` first — `/wf-angular:init` registers into the registry
   that `/wf:init` creates." (This skill augments a registry; it never bootstraps one.)

## Phase 1: Inspect the pack (read-only)

1. Call `inspect_pack` with `{ pluginId: "wf-angular" }`. It returns `{ pluginId,
   pluginName, installed, enabled, version, installPath, capabilities[], fingerprint,
   valid, issues[] }` — resolved via `claude plugin list --json`, no environment probing
   of any kind on wf-angular's part.
2. **If `valid` is `false`**, stop before attempting registration. Report every string in
   `issues` verbatim, plus the concrete remedy per cause:
   - `installed: false` — the wf-angular plugin isn't installed; install it from the
     marketplace, then re-run `/wf-angular:init`.
   - `enabled: false` — the plugin is installed but disabled; enable it, then re-run.
   - `capabilities` empty / no readable manifest — the install looks corrupted or
     incomplete; reinstall the plugin, then re-run.
3. Keep the returned `fingerprint` for Phase 2 — it proves to `register_pack` that
   nothing about the pack changed between inspection and registration.

## Phase 2: Resolver health gate (SUB-4 / WF-272 diagnostics) + registration

Registering a pack **writes** the shared registry, so it uses the same
block-before-mutation policy as any other registry-mutating write.

1. Call `resolve_gate` with `{ surface: "delivery-write" }`.
2. **If `healthy` is `false`**, STOP — do not call `register_pack`. Report, verbatim:
   - `reaction` (will read `block`),
   - each `categories` entry (one or more of `snapshot-missing`, `snapshot-malformed`,
     `schema-incompatible`, `fingerprint-unresolvable`, `cli-unavailable`,
     `registry-invalid`),
   - every diagnostic's message, and
   - every `recovery` line (each names a `/wf:resolve refresh` or `/wf:resolve
     invalidate` action).

   This is the resolver itself being unhealthy — a different failure class from an
   uninstalled/disabled pack (Phase 1). Do not attempt any manual fallback discovery;
   direct the user to the named `/wf:resolve` recovery, then re-run `/wf-angular:init`.
3. If `healthy` is `true`, call `register_pack` with `{ pluginId: "wf-angular",
   expectedFingerprint: <fingerprint from Phase 1> }`. It re-validates internally, then —
   on success — owns the entire `## Plugin Roots` + `## Capabilities` write and refreshes
   the resolver snapshot. This skill performs none of that writing itself.
4. **`status: "rejected"`** — stop, report `reason` verbatim, plus the remedy:
   - stale fingerprint (pack changed between Phase 1 and now) — just re-run
     `/wf-angular:init`; it re-inspects and gets a fresh fingerprint automatically.
   - not installed / disabled / no valid manifest — same remedies as Phase 1.
5. **`status: "registered"`** — the `preview` array shows exactly which `## Plugin
   Roots` and `## Capabilities` rows were written (or left byte-identical if already
   present — the tool is itself skip-if-present on an existing capability row).
6. **`selfCheck: "failed"`** on an otherwise-successful registration means the write
   landed but resolution still doesn't resolve `angular` to `ok`. Treat this as a
   SUB-4-style diagnosis, not a silent partial success: call `resolve_gate` with
   `{ surface: "delivery-write" }` again, report its diagnostics + recovery, and direct
   the user to `/wf:resolve refresh` before re-running `/wf-angular:init`.

## Phase 3: Seed profile

Apply the **profile-seeding convention by name** — the same convention `/wf:init` Phase
2.5 follows, defined in `plugins/wf/skills/_contracts/capability-registry.contract.md`
§"The profile-seeding convention". Do **not** re-derive its rules here.

- **angular** (only when Phase 2 registered it fresh — `preview` contains a
  `Capabilities`/`angular` row and it was not already present): resolve its manifest
  path from `register_pack`'s `root` (`<root>/capabilities/angular/manifest.md`). It
  declares `profile-template: profile.template.json` — seed a downstream **override** at
  `_local/profiles/angular.profile.json` **only on divergence** from the capability's
  default template; **idempotent** — never overwrite an existing override
  (skip-if-present). Record `seeded override` or `default in use`.
- Skip this step when the capability was already registered before this run (Phase 2
  reported `already registered`).

This is exactly what `/wf:init` would do on its next run now that the row resolves — doing
it here keeps onboarding to one command.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0).
- **`angular` already registered**: `register_pack` is itself skip-if-present on the
  `## Capabilities` row — it still refreshes the `## Plugin Roots` row and re-runs the
  self-check. Report `already registered` for the capability row and skip the profile
  seed (Phase 3).
- **Pack not installed / disabled / manifest-invalid** (Phase 1 `valid: false`): stop
  before any resolver-health or registration call; report the concrete remedy and do not
  proceed to Phases 2–3.
- **Resolver unhealthy** (Phase 2 `resolve_gate` returns `healthy: false`): stop before
  calling `register_pack`; report the categorized diagnostics + `/wf:resolve` recovery
  verbatim — never fall back to hand-walking the registry.
- **Stale fingerprint** (Phase 2's `register_pack` call rejects because the pack changed
  since Phase 1): re-run `/wf-angular:init` — no manual recovery needed.
- **`register_pack` self-check FAIL**: report it as the final state (`partial`); do not
  claim success. Direct to `/wf:resolve refresh`.

---

## Final Output

```
WF-ANGULAR-INIT — <onboarded | already-registered | partial>

Registry:   <registry-location>
Pack root:  <installPath from inspect_pack/register_pack>
Registered: angular — <registered | already registered>
Profile:    <seeded override [seeded by <model id>] | default in use | skipped — already registered>
Self-check: <PASS — register_pack selfCheck: ok | FAIL — <resolve_gate/register_pack diagnostics + recovery>>

Next: run /wf:qa-auto for a task with a QA plan — core resolves the angular capability, finds the qa-execution provider owning surface: host, and dispatches test-host scaffolding to /wf-angular:qa-host. Fill the profile slots in _local/profiles/angular.profile.json before first scaffold. Re-run /wf-angular:init only if register_pack reports the pack unrecoverable, or after relocating the pack.
```

Attach `seeded by <model id>` only to a `seeded override` whose profile format has no
schema-permitted attribution slot (per the seeding convention); use the current model id
from the runtime, or `unknown`.

**The final-output block must always be the very last thing output to chat.**
