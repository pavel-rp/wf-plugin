---
name: init
description: Onboards the wf-ado pack into a wf-initialized repo in one command — registers the pack's ado capability into the wf capability registry as a plugin-anchored row, records the pack's install root so core can resolve it, and interviews for (or carries forward) the Azure DevOps organization/project already recorded by /wf:init. Use once (after /wf:init) to activate ADO tracker binding without hand-editing _local/config.md; upgrades self-heal, so re-run only if resolution reports the pack unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-ado:init — Onboard the wf-ado pack (self-register + record install root + ADO interview)

Collapse wf-ado onboarding into **one command**. Installing the plugin makes
`/wf-ado:init` discoverable (native composition) but registers **no** phase fragment —
that still requires hand-editing the downstream `## Capabilities` table and re-running
`/wf:init`. This skill does that registration for you, records the one datum core
cannot get on its own (**the pack's install root**), and runs the one phase git never
needed: an interview for the Azure DevOps organization/project, carrying forward any
values a prior `/wf:init` run already recorded.

Core resolves a `plugin:<plugin-name>/<rel-path>` `Path` by looking `<plugin-name>` up
in a `## Plugin Roots` mapping (see
`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots`
mapping"). Only a **wf-ado skill** runs with `${CLAUDE_PLUGIN_ROOT}` equal to the
wf-ado install root, so only this skill can capture and record it. With the root
recorded and the capability row written, core resolves the pack's `ado` capability on
a **plugin-only install** — no vendored `plugins/wf-ado/...` in the consuming repo.

This mirrors `/wf-git:init` (WF-122) and `/wf-caps:init` (WF-99) exactly, simplified
for a single-capability pack — **plus one bespoke phase git never needed**: Phase 4
below interviews for ADO organization + project, carrying forward any values a prior
`/wf:init` run already wrote to `_local/config.md`'s `## Azure DevOps` section, rather
than orphaning them behind a new profile file.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-ado:init` is already discoverable from installing the plugin; this skill wires the
**fragment + registry** (plus the ADO interview).

---

## Command Syntax

```
/wf-ado:init
```

Takes no arguments — it always registers the single `ado` capability this pack ships.

**Validation:**

- **Registry location:** resolve exactly as `/wf:init` does — read `wf.config.js` at the
  repo root (`git rev-parse --show-toplevel`) and use its optional `registryPath` key,
  **defaulting to `_local/config.md`** when absent. All registry writes below target
  this resolved location.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read `${CLAUDE_PLUGIN_ROOT}` and read-only git (`git rev-parse`).
- Write/edit files under `_local/` — including the `## Azure DevOps` section of
  `_local/config.md` (Phase 4), which stays inside `_local/`.
- Write the `## Plugin Roots` and `## Capabilities` tables to the **resolved registry
  location** — the one sanctioned write outside `_local/` (registering the pack is this
  skill's whole purpose), mirroring `/wf:init`'s and `/wf-git:init`'s registry-write
  carve-out.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-ado).
- Invent a default value for ADO Organization or ADO Project — always ask.
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "wf-ado:init must
   run inside a git repository — run `/wf:init` first."
2. **Record the repo root:** `git rev-parse --show-toplevel`.
3. **Require `/wf:init` first.** Resolve the registry location (see Validation). If
   `_local/` is absent, or the resolved registry file does not exist, stop: "Run
   `/wf:init` first — wf-ado:init registers into the registry that `/wf:init` creates."
   (This skill augments the registry; it does not bootstrap `_local/`.)

---

## Phase 1: Discover self

1. **Capture the install root.** Run (Bash) `printf '%s' "$CLAUDE_PLUGIN_ROOT"` to read
   the pack's install root. If it is empty, stop: "`$CLAUDE_PLUGIN_ROOT` is not set —
   run this as the `/wf-ado:init` slash command so the pack's install root is
   available." **Normalize to forward slashes** (replace every `\` with `/`); a leading
   drive prefix such as `C:` is fine (the `## Plugin Roots` `Root` shape permits
   absolute/drive-prefixed roots). Call the normalized value `<pack-root>`.
2. **Confirm the capability manifest exists.** Confirm `<pack-root>/capabilities/ado/manifest.md`
   is readable. If it is not, stop: "No `capabilities/ado/manifest.md` under the pack —
   the install appears corrupted or incomplete."

---

## Phase 2: Record the plugin root

Write/refresh the `wf-ado` row in a `## Plugin Roots` table at the resolved registry
location.

1. Read the registry file. Locate a `## Plugin Roots` section.
2. **If absent**, append this section (heading + prose + table) to the file:

   ```markdown
   ## Plugin Roots

   Per-machine plugin install roots that resolve plugin-anchored `## Capabilities` paths (`plugin:<plugin-name>/<rel-path>`). Written and refreshed by each pack's own init (e.g. `/wf-ado:init`) — machine-specific, gitignored, never committed. See `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots` mapping".

   | Plugin | Root        |
   |--------|-------------|
   | wf-ado | <pack-root> |
   ```

3. **If present**, upsert the `wf-ado` row: replace its `Root` with `<pack-root>` if the
   row exists (the install root can move between machines / upgrades), else append the
   row to the table. Leave every other plugin's row untouched.

Substitute the real `<pack-root>` value; never write the literal placeholder.

---

## Phase 3: Register the capability

Ensure a `## Capabilities` row exists at the resolved registry location:

- Row shape: `| ado | plugin:wf-ado/capabilities/ado |`.
- **Append-only, skip-if-present by capability name.** If a row named `ado` already
  exists (any `Path`), leave it untouched and record `already registered`. Never delete
  or reorder existing rows.
- Preserve the table's existing order; append the new row at the end (registry order =
  injection order, general → specific — an appended pack is most-specific, the
  intended default).

---

## Phase 4: Interview + carry-forward (bespoke)

The one phase git never needed. Reconcile `_local/config.md`'s `## Azure DevOps`
section with real values, carrying forward anything a prior `/wf:init` run (or a
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

## Phase 5: Self-check (the one in-repo runtime assertion)

Resolve `ado` **the way core will** — including self-heal — to prove the wiring
end-to-end. Follow `plugins/wf/skills/_contracts/capability-registry.ops.md`
§"Recorded-root-first resolution with install-manifest self-heal" for the resolution
steps; do not restate the algorithm here.

1. Resolve `plugin:wf-ado/capabilities/ado` per that section: the recorded `## Plugin
   Roots` root first, then — if that root dangles — the install-manifest fallback.
2. Record `PASS` when resolution yields a readable `manifest.md` by **either** route — a
   recovered-via-fallback root counts as PASS, since a recorded root that went stale
   after an upgrade is expected and self-heals, not a failure. Record `FAIL` only when
   the pack is **unrecoverable** (neither route yields a readable manifest — the ops-doc
   step-3 case).
3. A `FAIL` means the pack is unrecoverable — surface it loudly and direct the user to
   re-run `/wf-ado:init` (or fix a relocated pack); do not report success.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0). This skill augments a registry; it never bootstraps one.
- **`$CLAUDE_PLUGIN_ROOT` unset** (skill invoked outside the plugin runtime): stop — the
  install root is the one datum this skill exists to capture.
- **`ado` already registered** (a row named `ado` exists): skip it (append-only,
  skip-if-present); still refresh the plugin root, run the Phase 4 interview, and
  self-check.
- **`## Plugin Roots` already has a `wf-ado` row**: upsert (refresh the `Root`), never
  duplicate.
- **All three ADO values already set (re-run on an already-onboarded repo):** Phase 4
  produces **zero prompts** and leaves every row byte-identical — report all three as
  `carried forward`.
- **`## Azure DevOps` section present but only `Work Item ID Prefix` is still
  bracketed** (unusual hand-edit): default it to `ADO` without prompting and record
  `set to ADO`, per step 3 — the same action as a freshly-created section, since the
  rule keys only on *this row's own* placeholder-shape, not on why the section
  exists. `ADO Project`/`ADO Organization` are unaffected — they key off their own
  row's shape independently.
- **Registry relocated to a committed file via `registryPath`**: still write there (the
  sanctioned write), but warn that the machine-specific `## Plugin Roots` table should
  stay gitignored — keep the registry under `_local/` unless the project manages that
  itself.
- **Self-check FAIL**: report it as the final state (`partial`); do not claim success.

---

## Final Output

```
WF-ADO-INIT — <onboarded | already-registered | partial>

Registry:   <resolved registry location>
Pack root:  <pack-root>
Registered: ado — <registered | already registered>
Azure DevOps:
- ADO Organization    — <carried forward | set to <value>>
- ADO Project         — <carried forward | set to <value>>
- Work Item ID Prefix — <carried forward | set to <value>>
Self-check: <PASS — plugin:wf-ado/capabilities/ado resolves (recorded root or self-heal) | FAIL — pack unrecoverable: <what didn't resolve>>

Next: run any wf skill that needs the tracker (e.g. /wf:spec, /wf:lite, /wf:triage) — core resolves the ado capability for the tracker surface directly (no phase-firing gate). Upgrades self-heal — re-run /wf-ado:init only if resolution reports the pack unrecoverable, or after relocating the pack.
```

**The final-output block must always be the very last thing output to chat.**
