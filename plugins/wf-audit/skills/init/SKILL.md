---
name: init
description: Onboards the wf-audit pack into a wf-initialized repo in one command — self-registers both the audit and sr capabilities with core via the typed resolver MCP tools (inspect_pack/register_pack), keyed by the pack's stable plugin id, then seeds the audit profile. Use once (after /wf:init) to activate the five verify-phase adversarial lenses plus the pre-commit self-review lens without probing $CLAUDE_PLUGIN_ROOT or hand-editing _local/config.md or the plugin-roots map; upgrades self-heal, so re-run only if resolution reports a capability unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-audit:init — Onboard the wf-audit pack (self-register via the resolver)

Collapse wf-audit onboarding into **one command**. Installing the plugin makes
`/wf-audit:init` discoverable (native composition) but registers **no** phase fragment —
that still requires an entry in the downstream `## Capabilities` table and a resolved
`/wf:init` run. This skill does that registration for you by calling core's bundled
**typed resolver MCP service** — the same `wf-resolver` tools every wf skill uses (see
`plugins/wf/skills/resolve/SKILL.md`) — with the pack's own stable plugin id.

Its core pair — `inspect_pack("wf-audit")` (read-only — resolves the plugin via
`claude plugin list --json`, validates it, and returns a fingerprint) then
`register_pack("wf-audit", <fingerprint>)` (the sole mutation — writes the `## Plugin
Roots` row and one `## Capabilities` row per discovered capability, refreshes the
snapshot, and self-checks) — replaces every manual discovery step this skill used to
perform itself; `resolve_registry` (a pre-registration check) and `resolve_gate`
(resolver-health diagnostics on failure) round out the typed calls this skill makes.
**This skill never probes `${CLAUDE_PLUGIN_ROOT}`, derives an install root, or hand-edits
the registry file itself** — `register_pack` owns that write exclusively.

This pack's onboarding is fixed to the two capabilities it ships: there is no
capability-subset argument — `audit` and `sr` always register together in the **same**
`register_pack` call, because `sr` reaches `audit`'s owned correctness rubric by a
co-located intra-plugin path and the two capabilities are shipped as one unit (WF-257
charter). `register_pack` discovers both automatically (it scans every
`capabilities/*/manifest.md` under the pack), so no per-capability call is needed.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery). `/wf-audit:init`
is already discoverable from installing the plugin; this skill wires the **fragments +
registry**.

---

## Command Syntax

```
/wf-audit:init
```

Takes no arguments — it always registers both `audit` and `sr`, the two capabilities this
pack ships.

**Validation:**

- **Registry location:** resolve exactly as `/wf:init` does — read `wf.config.js` at the
  repo root (`git rev-parse --show-toplevel`) and use its optional `registryPath` key,
  **defaulting to `_local/config.md`** when absent. Used only for the Phase 0 precondition
  check and to report the location in the Final Output — `register_pack` resolves and
  writes it independently.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file (capability manifests, at the paths `inspect_pack` returns); read-only git
  (`git rev-parse`).
- Call the bundled `wf-resolver` MCP tools this skill needs: `inspect_pack`,
  `register_pack`, `resolve_registry` (pre-registration check), and `resolve_gate`
  (failure diagnostics) — the same typed service every wf skill uses.
- Write/edit files under `_local/` (profile seeding only).

**Forbidden:**

- Modify any source file except the profile-seed write named above.
- **Hand-edit the `## Plugin Roots` / `## Capabilities` tables directly.**
  `register_pack` is the sole write path for pack registration; this skill never writes
  the registry file itself.
- **Probe `${CLAUDE_PLUGIN_ROOT}` or otherwise derive an install root by hand** —
  `inspect_pack`/`register_pack` resolve it via `claude plugin list --json`.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragments/registry).
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "wf-audit:init must
   run inside a git repository — run `/wf:init` first."
2. **Record the repo root:** `git rev-parse --show-toplevel`.
3. **Require `/wf:init` first.** Resolve the registry location (see Validation). If
   `_local/` is absent, or the resolved registry file does not exist, stop: "Run
   `/wf:init` first — wf-audit:init registers into the registry that `/wf:init` creates."
   (This skill augments the registry; it does not bootstrap `_local/`.)

---

## Phase 1: Inspect the pack

Call `inspect_pack` with `pluginId: "wf-audit"` — this pack's exact stable plugin id
(bare, no `@marketplace` suffix; `inspect_pack` matches a bare id against either the
installed plugin's full id or its bare name, so this is unambiguous regardless of which
marketplace it was installed from).

1. **Tool unreachable / errors.** The resolver MCP service itself may be unhealthy — not
   a pack problem. Call `resolve_gate` with `surface: "local-read"` (inspection is a
   read) and present its `categories` / `diagnostics` / `recovery` verbatim as the
   failure. This is the WF-272 diagnostics/recovery contract every wf consumer uses (see
   `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Recorded-root-first
   resolution with install-manifest self-heal" → "Resolver-failure semantics"). Stop;
   report `partial`.
2. **Returns `valid: false`.** A genuine pack problem, not a resolver failure — present
   `issues[]` verbatim (e.g. "plugin `wf-audit` is not installed", "...is disabled", "no
   readable `capabilities/*/manifest.md` under `<installPath>`") with the matching remedy
   (install or enable the plugin; reinstall if the manifest is missing/corrupted). Stop;
   report `partial`.
3. **Returns `valid: true`.** Confirm `capabilities[]` names **both** `audit` and `sr` by
   name — `valid: true` only guarantees at least one capability folder resolved, not both.
   If either name is missing, the install is incomplete: stop, naming which is missing,
   "the install appears corrupted or incomplete." Otherwise capture `fingerprint`,
   `installPath`, and each capability's `manifestPath` for the phases below.

---

## Phase 2: Register the pack

1. Call `resolve_registry` and note which of `audit`/`sr` already appear as **active**
   registry rows by name — this pre-existing set is used only to report `already
   registered` vs `registered` per capability below; `register_pack`'s own write is
   idempotent regardless of what this step finds.
2. Call `register_pack` with `pluginId: "wf-audit"` and `expectedFingerprint` = the
   `fingerprint` from Phase 1. One call performs everything this skill used to hand-write:
   it discovers every `capabilities/*/manifest.md` under the pack (both `audit` and `sr`),
   upserts one `## Plugin Roots` row (`wf-audit` → the pack's install root) and one
   `## Capabilities` row per capability, refreshes the resolver snapshot, and self-checks
   that every registered capability now resolves. Registry order is preserved — new rows
   append at the end (general → specific), matching the contract's injection-order rule.
   - **Tool unreachable / errors.** The same resolver-health failure as Phase 1 — call
     `resolve_gate` with `surface: "delivery-write"` (registration blocks before any
     mutation on failure, the same reaction a delivery write takes on a broken resolver),
     present its diagnostics/recovery verbatim. Stop; report `partial`.
   - **`status: "rejected"`.** Present `reason` verbatim (a stale fingerprint, the plugin
     no longer installed/enabled, or an invalid manifest found between Phase 1 and now).
     Recovery: re-run `/wf-audit:init` to re-inspect and retry. Stop; report `partial`.
   - **`status: "registered"`.** For each name in the returned `capabilities` (`audit`,
     `sr`), report `already registered` if it was in step 1's pre-existing set, else
     `registered`. Record `root` (the pack's install path) and `selfCheck`.

---

## Phase 3: Seed profiles

Apply the **profile-seeding convention by name** — the same convention `/wf:init` Phase 2.5
follows, defined in `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The
profile-seeding convention". Do **not** re-derive its rules here.

- **audit** (if newly registered in Phase 2): resolve its manifest at the `manifestPath`
  `inspect_pack` returned for it. It declares `profile-template:
  profile.template.json` — seed a downstream **override** at
  `_local/profiles/audit.profile.json` **only on divergence** from the capability's default
  template; **idempotent** — never overwrite an existing override (skip-if-present). Record
  `seeded override` or `default in use`.
- **sr** (if newly registered): resolve its manifest at the `manifestPath` `inspect_pack`
  returned for it. It declares **no** `profile-template:` — no-op. Record `skipped — no
  template`.
- Skip either step whose capability was already registered (Phase 2 recorded `already
  registered` for it).

This is exactly what `/wf:init` would do on its next run now that the rows resolve — doing
it here keeps onboarding to one command.

---

## Phase 4: Self-check

Relay `register_pack`'s own `selfCheck` — no separate resolution walk needed, since
`register_pack` already re-resolved the registry after writing (Phase 2, step 2) and
validated every registered capability there.

1. `selfCheck: "ok"` → both `audit` and `sr` resolve. Record `PASS`.
2. `selfCheck: "failed"` → call `resolve_registry` again and find the entry (or entries)
   named `audit`/`sr` carrying `validity: "unrecoverable"`. Its `manifestPath` is `null`
   at that point — record `FAIL`, naming which capability and its `registryPath` (the
   stable registered token) instead. This means the pack is unrecoverable even after the
   write — surface it loudly and direct the user to re-run `/wf-audit:init` (or fix a
   relocated/corrupted pack); do not report success.
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
- **One or both capabilities already registered** (Phase 2 step 1 found a matching row):
  `register_pack` still upserts idempotently; report `already registered` for those
  names, still run Phase 3 for any newly-registered capability, and self-check both.
- **`## Plugin Roots` already has a `wf-audit` row**: `register_pack` upserts it
  (refreshing `Root` if the pack moved between machines/upgrades), never duplicates —
  this skill does not manage that table itself.
- **Registry relocated to a committed file via `registryPath`**: `register_pack` still
  writes there (it resolves the same `registryPath`), but warn that the machine-specific
  `## Plugin Roots` table should stay gitignored — keep the registry under `_local/`
  unless the project manages that itself.
- **Self-check FAIL for either capability**: report it as the final state (`partial`); do
  not claim success.

---

## Final Output

```
WF-AUDIT-INIT — <onboarded | already-registered | partial>

Registry:   <resolved registry location>
Pack root:  <pack-root>
Registered:
- audit — <registered | already registered>
- sr — <registered | already registered>
Profiles:
- audit — <seeded override [seeded by <model id>] | default in use | skipped — already registered>
- sr — skipped — no template
Self-check: <PASS — both capabilities resolve (per register_pack's selfCheck) | FAIL — <capability> unrecoverable: <what didn't resolve> | partial — <resolver/pack diagnosis, see recovery>

Next: run /wf:verify-spec on a task — core dispatches the five audit lenses at verify; the commit path's pre-commit seam dispatches the sr lens on every commit. Upgrades self-heal — re-run /wf-audit:init only if resolution reports a capability unrecoverable, or after relocating the pack.
```

Attach `seeded by <model id>` only to a `seeded override` whose profile format has no
schema-permitted attribution slot (per the seeding convention); use the current model id
from the runtime, or `unknown`.

**The final-output block must always be the very last thing output to chat.**
