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
cannot get on its own (**the pack's install root**), and runs the one phase a delivery
pack never needs: an interview for the Azure DevOps organization/project, carrying
forward any values a prior `/wf:init` run already recorded.

The generic onboarding spine — register the capability, record the install root,
self-check — is shared by every provider pack and lives in
`plugins/wf/skills/_contracts/pack-onboarding.ops.md`. wf-ado supplies the parameters
below, **plus one bespoke phase**: Phase 4 interviews for ADO organization + project,
carrying forward any values a prior `/wf:init` run already wrote to `_local/config.md`'s
`## Azure DevOps` section rather than orphaning them behind a new profile file.

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

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read `${CLAUDE_PLUGIN_ROOT}` and read-only git (`git rev-parse`).
- Write/edit files under `_local/` — including the `## Azure DevOps` section of
  `_local/config.md` (Phase 4), which stays inside `_local/`.
- Write the `## Plugin Roots` and `## Capabilities` tables to the **resolved registry
  location** — the one sanctioned write outside `_local/`, since registering the pack is
  this skill's whole purpose.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-ado).
- Invent a default value for ADO Organization or ADO Project — always ask.
- Run builds, tests, installs, or any destructive git operation.

---

## Onboarding procedure

Follow `plugins/wf/skills/_contracts/pack-onboarding.ops.md` end to end (Phases 0–5),
supplying these parameters:

- `<pack>` = `wf-ado`
- `<capability>` = `ado`
- **Phase 4 detail** = the ADO interview below.

### Phase 4 detail: interview + carry-forward (bespoke)

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

The generic onboarding stop/idempotency conditions — `/wf:init` not run,
`$CLAUDE_PLUGIN_ROOT` unset, `ado` already registered, a `wf-ado` plugin-root row already
present, registry relocated via `registryPath`, and self-check FAIL — are handled by
`plugins/wf/skills/_contracts/pack-onboarding.ops.md` §"Edge cases". wf-ado's own
interview-specific cases:

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
