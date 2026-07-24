---
name: init
description: Onboards the wf-ado pack into a wf-initialized repo in one command — self-registers the pack's ado capability into the wf capability registry by calling the bundled resolver's inspect_pack/register_pack tools with the pack's stable plugin id, then interviews for (or carries forward) the Azure DevOps organization/project already recorded by /wf:init. Use once (after /wf:init) to activate ADO tracker binding without hand-editing _local/config.md or probing the plugin install path; re-run only if register_pack reports the pack unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-ado:init — Onboard the wf-ado pack (self-register via inspect_pack/register_pack + ADO interview)

Collapse wf-ado onboarding into **one command**. Installing the plugin makes
`/wf-ado:init` discoverable (native composition) but registers **no** phase fragment —
that still requires a row in the downstream `## Capabilities` table and a plugin-root
entry. This skill does that registration for you by calling the core plugin's bundled
**wf-resolver** MCP tools — `inspect_pack` then `register_pack` — passing wf-ado's own
stable plugin id (`wf-ado`). Those tools resolve the pack's install path via `claude
plugin list --json`, validate its manifest, and own the registry write themselves; this
skill never probes `${CLAUDE_PLUGIN_ROOT}` and never hand-edits the `## Plugin Roots` /
`## Capabilities` tables. It also runs the one phase a delivery pack never needs: an
interview for the Azure DevOps organization/project, carrying forward any values a prior
`/wf:init` run already recorded.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-ado:init` is already discoverable from installing the plugin; this skill wires the
**fragment + registry** (plus the ADO interview) via the resolver tools.

---

## Command Syntax

```
/wf-ado:init
```

Takes no arguments — it always registers the single `ado` capability this pack ships,
under the fixed plugin id `wf-ado`.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read-only `git` (`git rev-parse`).
- Call the bundled `wf-resolver` MCP tools `inspect_pack`, `resolve_gate`, and
  `register_pack` — always with `pluginId: "wf-ado"`, wf-ado's own exact stable plugin id.
- Write/edit files under `_local/` — including the `## Azure DevOps` section of
  `_local/config.md` (Phase 4), which stays inside `_local/`.

**Forbidden:**

- Modify any source file except the writes named above.
- Probe `${CLAUDE_PLUGIN_ROOT}`, derive an install root by any other means, or
  hand-edit the `## Plugin Roots` / `## Capabilities` tables directly — that write
  belongs solely to `register_pack`.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Call `inspect_pack` / `register_pack` for any `pluginId` other than `wf-ado`.
- Invent a default value for ADO Organization or ADO Project — always ask.
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

Before any resolver MCP call, run `pwd -P` once and use the returned absolute current Agent/session workspace directory as `<workspace-root>`. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit the primary checkout's or a parent Agent's root. Every resolver call below must explicitly include `workspaceRoot: "<workspace-root>"`; omission is a hard schema error, with no default or fallback.

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "`/wf-ado:init` must
   run inside a git repository — run `/wf:init` first."
2. **Resolve the registry location** exactly as `/wf:init` does — read `wf.config.js` at
   the workspace directory (`pwd -P`) and use its optional `registryPath`
   key, **defaulting to `_local/config.md`** when absent. Call this `<registry-location>`.
3. **Require `/wf:init` first.** If `_local/` is absent, or `<registry-location>` does not
   exist, stop: "Run `/wf:init` first — `/wf-ado:init` registers into the registry that
   `/wf:init` creates." (This skill augments a registry; it never bootstraps one.)

## Phase 1: Inspect the pack (read-only)

1. Call `inspect_pack` with `{ workspaceRoot: "<workspace-root>", pluginId: "wf-ado" }`. It returns `{ pluginId,
   pluginName, installed, enabled, version, installPath, capabilities[], fingerprint,
   valid, issues[] }` — resolved via `claude plugin list --json`, no environment probing
   of any kind on wf-ado's part.
2. **If `valid` is `false`**, stop before attempting registration. Report every string in
   `issues` verbatim, plus the concrete remedy per cause:
   - `installed: false` — the wf-ado plugin isn't installed; install it from the
     marketplace, then re-run `/wf-ado:init`.
   - `enabled: false` — the plugin is installed but disabled; enable it, then re-run.
   - `capabilities` empty / no readable manifest — the install looks corrupted or
     incomplete; reinstall the plugin, then re-run.
3. Keep the returned `fingerprint` for Phase 3 — it proves to `register_pack` that
   nothing about the pack changed between inspection and registration.

## Phase 2: Resolver health gate (SUB-4 / WF-272 diagnostics)

Registering a pack **writes** the shared registry, so it uses the same
block-before-mutation policy as any other registry-mutating write.

1. Call `resolve_gate` with `{ workspaceRoot: "<workspace-root>", surface: "delivery-write" }`.
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
   direct the user to the named `/wf:resolve` recovery, then re-run `/wf-ado:init`.
3. If `healthy` is `true`, proceed to Phase 3.

## Phase 3: Register the pack

1. Call `register_pack` with `{ workspaceRoot: "<workspace-root>", pluginId: "wf-ado", expectedFingerprint: <fingerprint
   from Phase 1> }`. It re-validates internally, then — on success — owns the entire
   `## Plugin Roots` + `## Capabilities` write and refreshes the resolver snapshot. This
   skill performs none of that writing itself.
2. **`status: "rejected"`** — stop, report `reason` verbatim, plus the remedy:
   - stale fingerprint (pack changed between Phase 1 and now) — just re-run
     `/wf-ado:init`; it re-inspects and gets a fresh fingerprint automatically.
   - not installed / disabled / no valid manifest — same remedies as Phase 1.
3. **`status: "registered"`** — `register_pack` **upserts by key**, not skip-if-present:
   for each row in `preview`, an existing row with that key gets its value **replaced**
   (a differing `Root`/`Path` is overwritten); only a row whose existing value is already
   byte-identical is left untouched (a no-op write). The response carries no signal for
   which of these happened — `preview` always lists every capability the pack provides,
   whether its row was inserted fresh, replaced, or left as a no-op.
4. **`selfCheck: "failed"`** on an otherwise-successful registration means the write
   landed but resolution still doesn't resolve `ado` to `ok`. Treat this as a SUB-4-style
   diagnosis, not a silent partial success: call `resolve_gate` with `{ workspaceRoot: "<workspace-root>", surface:
   "delivery-write" }` again, report its diagnostics + recovery, and direct the user to
   `/wf:resolve refresh` before re-running `/wf-ado:init`.

## Phase 4: ADO interview + carry-forward (bespoke)

The one phase a delivery pack never needed. Reconcile `_local/config.md`'s `## Azure
DevOps` section with real values, carrying forward anything a prior `/wf:init` run (or a
previous `/wf-ado:init` run, or a hand-edit) already set, and asking only for what is
still a placeholder.

1. **Locate the section.** Read `_local/config.md` and look for a `## Azure DevOps`
   heading.
   - **Present** — read its three rows (`ADO Project`, `ADO Organization`, `Work Item
     ID Prefix`) as they stand today.
   - **Absent** — the whole section is missing. Append it using `/wf:init`'s exact
     template shape (`plugins/wf/skills/init/SKILL.md` Phase 2 "Default content"):

     ```markdown
     ## Azure DevOps

     | Key | Value |
     |-----|-------|
     | **ADO Project** | `<ADO_PROJECT: the Azure DevOps project name>` |
     | **ADO Organization** | `<asked by wf:init — see Phase 2>` |
     | **Work Item ID Prefix** | `ADO` |
     ```

     Treat every row as freshly created for the per-field logic below (the
     `Work Item ID Prefix` row's own default value, `ADO`, counts as "the section was
     entirely absent" for that one field's rule — see step 3).

2. **Placeholder-shape detection (Approach — carry-forward is shape-based, not
   presence-based).** A row counts as **already set** — skip the prompt, leave it
   byte-identical, record `carried forward` — when its value is **not** wrapped in the
   `<...>` bracket shape `/wf:init`'s own template uses for an unset value
   (`<ADO_PROJECT: the Azure DevOps project name>`, `<asked by wf:init — see Phase
   2>`). A concrete value from any prior run — `/wf:init`'s own org-only prompt, a
   hand-edit, or a previous `/wf-ado:init` run — counts as set. A row still wrapped in
   that bracket shape counts as **unset**.

3. **Per-field resolution:**
   - **ADO Organization** — already set (non-bracketed) → leave byte-identical, record
     `carried forward`. Unset (bracketed, or the section was just created) → prompt
     the user (`AskUserQuestion`) for the real org slug — the `<org>` segment in
     `dev.azure.com/<org>`. **No invented default.** Record `set to <value>`.
   - **ADO Project** — same rule: already set → carry forward; unset → prompt, no
     invented default, record `set to <value>`.
   - **Work Item ID Prefix** — already set (non-bracketed) → carry forward. This will
     almost always be true: `/wf:init`'s own template default is the literal `ADO`
     (not bracketed), so any repo that has ever run `/wf:init` already has this row
     "set" even if the user never touched it. Unset (bracketed) → default it to the
     literal `ADO` **without prompting** and record `set to ADO`, regardless of
     *why* it's unset — whether the whole section was just created in step 1, or the
     row is bracketed via an unusual hand-edit while `ADO Project`/`ADO Organization`
     are already set. Unlike Organization/Project, this field always has a sensible,
     already-established default (`/wf:init`'s own template value), so it never needs
     a prompt.

4. **Write only the rows that changed.** A `carried forward` row is never rewritten
   (byte-identical). A `set to <value>` row replaces exactly that cell's value; every
   other row and the surrounding table structure is left untouched.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0).
- **Re-running on an already-onboarded repo**: `register_pack` upserts by key, so
  re-running is safe — an unchanged `## Capabilities`/`## Plugin Roots` row is left
  byte-identical, a drifted one is corrected. The response gives no signal for whether
  the row pre-existed, so report `registered` for the capability row (never `already
  registered` — that state can't be determined from `register_pack`); Phase 4 still runs.
- **Pack not installed / disabled / manifest-invalid** (Phase 1 `valid: false`): stop
  before any resolver-health or registration call; report the concrete remedy and do not
  proceed to Phases 2–4.
- **Resolver unhealthy** (Phase 2 `resolve_gate` returns `healthy: false`): stop before
  calling `register_pack`; report the categorized diagnostics + `/wf:resolve` recovery
  verbatim — never fall back to hand-walking the registry.
- **Stale fingerprint** (Phase 3 rejects because the pack changed since Phase 1): re-run
  `/wf-ado:init` — no manual recovery needed.
- **`register_pack` self-check FAIL**: report it as the final state (`partial`); do not
  claim success. Direct to `/wf:resolve refresh`.
- **All three ADO values already set (re-run on an already-onboarded repo):** Phase 4
  produces **zero prompts** and leaves every row byte-identical — report all three as
  `carried forward`.
- **`## Azure DevOps` section present but only `Work Item ID Prefix` is still
  bracketed** (unusual hand-edit): default it to `ADO` without prompting and record
  `set to ADO`, per Phase 4 step 3 — the same action as a freshly-created section, since
  the rule keys only on *this row's own* placeholder-shape, not on why the section
  exists. `ADO Project`/`ADO Organization` are unaffected — they key off their own
  row's shape independently.

---

## Final Output

```
WF-ADO-INIT — <onboarded | partial>

Registry:   <registry-location>
Pack root:  <installPath from inspect_pack/register_pack>
Registered: ado — registered
Azure DevOps:
- ADO Organization    — <carried forward | set to <value>>
- ADO Project         — <carried forward | set to <value>>
- Work Item ID Prefix — <carried forward | set to ADO>
Self-check: <PASS — register_pack selfCheck: ok | FAIL — <resolve_gate/register_pack diagnostics + recovery>>

Next: run any wf skill that needs the tracker (e.g. /wf:spec, /wf:lite, /wf:triage) — core resolves the ado capability for the tracker surface directly (no phase-firing gate). Re-run /wf-ado:init only if register_pack reports the pack unrecoverable, or after relocating the pack.
```

**The final-output block must always be the very last thing output to chat.**
