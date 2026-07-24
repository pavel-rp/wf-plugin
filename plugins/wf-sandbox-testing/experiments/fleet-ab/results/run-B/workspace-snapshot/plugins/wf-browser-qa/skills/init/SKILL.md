---
name: init
description: Onboards the wf-browser-qa pack into a wf-initialized repo in one command — self-registers the browser-qa capability with core via the typed resolver MCP tools (inspect_pack/register_pack), keyed by the pack's stable plugin id. Use once (after /wf:init) to activate the browser-automation QA engine without probing $CLAUDE_PLUGIN_ROOT or hand-editing _local/config.md or the plugin-roots map; upgrades self-heal, so re-run only if resolution reports the pack unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-browser-qa:init — Onboard the wf-browser-qa pack (self-register via the resolver)

Collapse wf-browser-qa onboarding into **one command**. Installing the plugin makes
`/wf-browser-qa:init` and `/wf-browser-qa:qa-engine` discoverable (native composition) but
registers **no** phase fragment — that still requires an entry in the downstream
`## Capabilities` table and a resolved `/wf:init` run. This skill does that registration
for you by calling core's bundled **typed resolver MCP service** — the same `wf-resolver`
tools every wf skill uses (see `plugins/wf/skills/resolve/SKILL.md`) — with the pack's own
stable plugin id.

Its core pair — `inspect_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-browser-qa" })` (read-only — resolves the plugin via
`claude plugin list --json`, validates it, and returns a fingerprint) then
`register_pack({ workspaceRoot: "<workspace-root>", pluginId: "wf-browser-qa", expectedFingerprint: <fingerprint> })` (the sole mutation — writes the
`## Plugin Roots` row and the `## Capabilities` row for the pack's capability, refreshes
the snapshot, and self-checks) — replaces every manual discovery step this skill used to
perform itself; `resolve_registry` (a pre-registration check) and `resolve_gate`
(resolver-health diagnostics on failure) round out the typed calls this skill makes.
**This skill never probes `${CLAUDE_PLUGIN_ROOT}`, derives an install root, or hand-edits
the registry file itself** — `register_pack` owns that write exclusively.

This mirrors `/wf-audit:init` exactly, simplified for a single-capability pack: there is
no capability-subset argument, because wf-browser-qa ships exactly one capability.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-browser-qa:*` commands are already discoverable from installing the plugin; this skill
wires the **fragment + registry**.

---

## Command Syntax

```
/wf-browser-qa:init
```

Takes no arguments — it always registers the single `browser-qa` capability this pack ships.

**Validation:**

- **Registry location:** resolve exactly as `/wf:init` does — read `wf.config.js` at the
  workspace directory (`pwd -P`) and use its optional `registryPath` key,
  **defaulting to `_local/config.md`** when absent. Used only for the Phase 0 precondition
  check and to report the location in the Final Output — `register_pack` resolves and
  writes it independently.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file (the capability manifest, at the path `inspect_pack` returns); read-only
  git (`git rev-parse`).
- Call the bundled `wf-resolver` MCP tools this skill needs: `inspect_pack`,
  `register_pack`, `resolve_registry` (pre-registration check), and `resolve_gate`
  (failure diagnostics) — the same typed service every wf skill uses.
- Write/edit files under `_local/` (none needed here — no profile to seed — kept for
  parity with the pack-init family; see Phase 3).

**Forbidden:**

- Modify any source file.
- **Hand-edit the `## Plugin Roots` / `## Capabilities` tables directly.**
  `register_pack` is the sole write path for pack registration; this skill never writes
  the registry file itself.
- **Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive an install root by hand** —
  `inspect_pack`/`register_pack` resolve it via `claude plugin list --json`.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

Before any resolver MCP call, run `pwd -P` once and use the returned absolute current Agent/session workspace directory as `<workspace-root>`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit the primary checkout's or a parent Agent's root. Every resolver call below must explicitly include `workspaceRoot: "<workspace-root>"`; omission is a hard schema error, with no default or fallback.

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "wf-browser-qa:init must
   run inside a git repository — run `/wf:init` first."
2. **Record the workspace directory:** `pwd -P`.
3. **Require `/wf:init` first.** Resolve the registry location (see Validation). If
   `_local/` is absent, or the resolved registry file does not exist, stop: "Run
   `/wf:init` first — wf-browser-qa:init registers into the registry that `/wf:init`
   creates." (This skill augments the registry; it does not bootstrap `_local/`.)

---

## Phase 1: Inspect the pack

Call `inspect_pack` with `workspaceRoot: "<workspace-root>"` and `pluginId: "wf-browser-qa"` — this pack's exact stable plugin id
(bare, no `@marketplace` suffix; `inspect_pack` matches a bare id against either the
installed plugin's full id or its bare name, so this is unambiguous regardless of which
marketplace it was installed from).

1. **Tool unreachable / errors.** The resolver MCP service itself may be unhealthy — not
   a pack problem. Call `resolve_gate` with `workspaceRoot: "<workspace-root>"` and `surface: "local-read"` (inspection is a
   read) and present its `categories` / `diagnostics` / `recovery` verbatim as the
   failure. This is the WF-272 diagnostics/recovery contract every wf consumer uses (see
   the capability-registry contract ops doc — obtained via the resolver content surface
   (`resolve_content`, `workspaceRoot: "<workspace-root>"`, `class: contract`, `ref: capability-registry.ops.md`), never a raw
   read of the plugin-cache path — §"Recorded-root-first resolution with install-manifest
   self-heal" → "Resolver-failure semantics"). Stop; report `partial`.
2. **Returns `valid: false`.** A genuine pack problem, not a resolver failure — present
   `issues[]` verbatim (e.g. "plugin `wf-browser-qa` is not installed", "...is disabled",
   "no readable `capabilities/*/manifest.md` under `<installPath>`") with the matching
   remedy (install or enable the plugin; reinstall if the manifest is missing/corrupted).
   Stop; report `partial`.
3. **Returns `valid: true`.** Confirm `capabilities[]` names `browser-qa` — the pack's one
   shipped capability. If it is missing, the install is incomplete even though
   `valid: true` (capabilities.length > 0 only guarantees at least one readable manifest):
   stop, "the install appears corrupted or incomplete." Otherwise capture `fingerprint`,
   `installPath`, and the capability's `manifestPath` for the phases below.

---

## Phase 2: Register the pack

1. Call `resolve_registry({ workspaceRoot: "<workspace-root>" })` and note whether `browser-qa` already appears as an **active**
   registry row — used only to report `already registered` vs `registered` below;
   `register_pack`'s own write is idempotent regardless of what this step finds.
2. Call `register_pack` with `workspaceRoot: "<workspace-root>"`, `pluginId: "wf-browser-qa"`, and `expectedFingerprint` = the
   `fingerprint` from Phase 1. One call performs everything this skill used to hand-write:
   it discovers `capabilities/browser-qa/manifest.md` under the pack, upserts one
   `## Plugin Roots` row (`wf-browser-qa` → the pack's install root) and the
   `## Capabilities` row for `browser-qa`, refreshes the resolver snapshot, and
   self-checks that the capability now resolves. Registry order is preserved — a new row
   appends at the end (general → specific), matching the contract's injection-order rule.
   - **Tool unreachable / errors.** The same resolver-health failure as Phase 1 — call
     `resolve_gate` with `workspaceRoot: "<workspace-root>"` and `surface: "delivery-write"` (registration blocks before any
     mutation on failure, the same reaction a delivery write takes on a broken resolver),
     present its diagnostics/recovery verbatim. Stop; report `partial`.
   - **`status: "rejected"`.** Present `reason` verbatim (a stale fingerprint, the plugin
     no longer installed/enabled, or an invalid manifest found between Phase 1 and now).
     Recovery: re-run `/wf-browser-qa:init` to re-inspect and retry. Stop; report
     `partial`.
   - **`status: "registered"`.** Report `already registered` if `browser-qa` was in step
     1's pre-existing set, else `registered`. Record `root` (the pack's install path) and
     `selfCheck`.

---

## Phase 3: Seed profiles

The `browser-qa` capability's manifest declares **no** `profile-template:` — no-op. Record
`skipped — no template`. (The engine reads its test credentials from the downstream
`_local/qa-creds.md`, which it prompts for on first run, not from a stamped profile.)

---

## Phase 4: Self-check

Relay `register_pack`'s own `selfCheck` — no separate resolution walk needed, since
`register_pack` already re-resolved the registry after writing (Phase 2, step 2) and
validated the registered capability there.

1. `selfCheck: "ok"` → `browser-qa` resolves. Record `PASS`.
2. `selfCheck: "failed"` → call `resolve_registry({ workspaceRoot: "<workspace-root>" })` again and find the `browser-qa` entry
   carrying `validity: "unrecoverable"`. Its `manifestPath` is `null` at that point —
   record `FAIL`, naming its `registryPath` (the stable registered token) instead. This
   means the pack is unrecoverable even after the write — surface it loudly and direct
   the user to re-run `/wf-browser-qa:init` (or fix a relocated/corrupted pack); do not
   report success.
3. `selfCheck: "skipped"` only accompanies a `rejected` status (Phase 2) — already handled
   there.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0). This skill augments a registry; it never bootstraps one.
- **Resolver MCP unavailable** (`inspect_pack`/`register_pack`/`resolve_gate` unreachable):
  the tools are unreachable (wf core's `.mcp.json` sets `alwaysLoad: true` for the bundled
  `wf-resolver` server, so this is unusual). Stop and report that the resolver runtime is
  not loaded; suggest restarting Claude Code. Do **not** fall back to a hand-rolled
  `${CLAUDE_PLUGIN_ROOT}` probe or a manual registry edit — that is exactly the discovery
  this service replaces.
- **`browser-qa` already registered** (Phase 2 step 1 found a matching row):
  `register_pack` still upserts idempotently; report `already registered` and still
  self-check.
- **`## Plugin Roots` already has a `wf-browser-qa` row**: `register_pack` upserts it
  (refreshing `Root` if the pack moved between machines/upgrades), never duplicates —
  this skill does not manage that table itself.
- **Registry relocated to a committed file via `registryPath`**: `register_pack` still
  writes there (it resolves the same `registryPath`), but warn that the machine-specific
  `## Plugin Roots` table should stay gitignored — keep the registry under `_local/`
  unless the project manages that itself.
- **Self-check FAIL**: report it as the final state (`partial`); do not claim success.

---

## Final Output

```
WF-BROWSER-QA-INIT — <onboarded | already-registered | partial>

Registry:   <resolved registry location>
Pack root:  <pack-root>
Registered: browser-qa — <registered | already registered>
Profile:    skipped — no template
Self-check: <PASS — browser-qa resolves (per register_pack's selfCheck) | FAIL — pack unrecoverable: <what didn't resolve> | partial — <resolver/pack diagnosis, see recovery>

Next: run /wf:qa-auto for a task with a QA plan — core resolves the browser-qa capability, finds the qa-execution provider owning surface: engine, and dispatches the per-scenario browser drive to /wf-browser-qa:qa-engine. Upgrades self-heal — re-run /wf-browser-qa:init only if resolution reports the pack unrecoverable, or after relocating the pack.
```

**The final-output block must always be the very last thing output to chat.**
