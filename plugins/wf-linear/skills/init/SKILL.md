---
name: init
description: Onboards the wf-linear pack into a wf-initialized repo in one command — registers the pack's linear capability into the wf capability registry as a plugin-anchored row, records the pack's install root so core can resolve it, and interviews for (or carries forward) the Linear team/project. Use once (after /wf:init) to activate Linear tracker binding without hand-editing _local/config.md; upgrades self-heal, so re-run only if resolution reports the pack unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-linear:init — Onboard the wf-linear pack (self-register + record install root + Linear interview)

Collapse wf-linear onboarding into **one command**. Installing the plugin makes
`/wf-linear:init` discoverable (native composition) but registers **no** phase
fragment — that still requires hand-editing the downstream `## Capabilities` table
and re-running `/wf:init`. This skill does that registration for you, records the
one datum core cannot get on its own (**the pack's install root**), and runs the one
phase a delivery pack never needs: an interview for the Linear team (and, optionally,
project).

The generic onboarding spine — register the capability, record the install root,
self-check — is shared by every provider pack and lives in
`plugins/wf/skills/_contracts/pack-onboarding.ops.md`. wf-linear supplies the parameters
below, **plus one bespoke phase**: Phase 4 interviews for the Linear team + optional
project, writing this pack's **own** `## Linear` section of `_local/config.md`. Unlike
wf-ado's `## Azure DevOps` section, there is nothing to "carry forward" from core's own
`/wf:init` template here — core's config template ships no tracker-product section of any
kind (see `plugins/wf/skills/init/SKILL.md` Phase 2's "Default content"); the `## Linear`
section is entirely this pack's own, created fresh on first run and left untouched
(except for genuinely-unset rows) on every re-run.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-linear:init` is already discoverable from installing the plugin; this skill wires
the **fragment + registry** (plus the Linear interview).

---

## Command Syntax

```
/wf-linear:init
```

Takes no arguments — it always registers the single `linear` capability this pack
ships.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read `${CLAUDE_PLUGIN_ROOT}` and read-only git (`git rev-parse`).
- Write/edit files under `_local/` — including the `## Linear` section of
  `_local/config.md` (Phase 4), which stays inside `_local/`.
- Write the `## Plugin Roots` and `## Capabilities` tables to the **resolved registry
  location** — the one sanctioned write outside `_local/`, since registering the pack is
  this skill's whole purpose.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-linear).
- Invent a default value for **Linear Team** — always ask.
- Run builds, tests, installs, or any destructive git operation.

---

## Onboarding procedure

Follow `plugins/wf/skills/_contracts/pack-onboarding.ops.md` end to end (Phases 0–5),
supplying these parameters:

- `<pack>` = `wf-linear`
- `<capability>` = `linear`
- **Phase 4 detail** = the Linear interview below.

One capability-registration note specific to this pack: at Phase 3, register `linear`
**even if** an `ado` row already exists — this skill never blocks its own registration.
Co-registering `linear` alongside an active `ado` is a registry-**validation** concern
(both claim the `tracker` provider surface — a partitioned-ownership overlap), reported
when validation runs, not something this onboarding skill polices inline. Surface it in
the Final Output (see below), not as a Phase 3 gate.

### Phase 4 detail: interview + carry-forward (bespoke)

The one phase a delivery pack never needed. Reconcile `_local/config.md`'s `## Linear`
section with real values, carrying forward anything a prior `/wf-linear:init` run (or a
hand-edit) already set, and asking only for what is still a placeholder.

1. **Locate the section.** Read `_local/config.md` and look for a `## Linear` heading.
   - **Present** — read its two rows (**Linear Team**, **Linear Project**) as they
     stand today.
   - **Absent** — the whole section is missing. Append it using this pack's own
     template shape:

     ```markdown
     ## Linear

     | Key | Value |
     |-----|-------|
     | **Linear Team** | `<LINEAR_TEAM: the Linear team key or name new issues are created under>` |
     | **Linear Project** | `none` |
     ```

     Treat every row as freshly created for the per-field logic below (the
     **Linear Project** row's own default value, the literal `none`, counts as "the
     section was entirely absent" for that one field's rule — see step 3).

2. **Placeholder-shape detection (Approach — carry-forward is shape-based, not
   presence-based).** A row counts as **already set** — skip the prompt, leave it
   byte-identical, record `carried forward` — when its value is **not** wrapped in the
   `<...>` bracket shape this pack's own template uses for an unset value
   (`<LINEAR_TEAM: the Linear team key or name new issues are created under>`). A
   concrete value from any prior run — a hand-edit, or a previous `/wf-linear:init`
   run — counts as set. A row still wrapped in that bracket shape counts as **unset**.

3. **Per-field resolution:**
   - **Linear Team** — already set (non-bracketed) → leave byte-identical, record
     `carried forward`. Unset (bracketed, or the section was just created) → prompt
     the user (`AskUserQuestion`) for the real team key or name (whichever the
     downstream Linear workspace uses to identify the team new issues attach to).
     **No invented default.** Record `set to <value>`.
   - **Linear Project** — already set means **any** non-bracketed value, including the
     template's own literal `none` default (which is a legitimate, deliberate "no
     project scoping" state — not a placeholder). So this row is carried forward on
     essentially every run: unset only if some unusual hand-edit re-wrapped it in
     brackets. Unset → default it to the literal `none` **without prompting** and
     record `set to none`. **Never prompt for Linear Project** — it is an optional
     secondary scoping value, not a required identity like Linear Team.

4. **Write only the rows that changed.** A `carried forward` row is never rewritten
   (byte-identical). A `set to <value>` row replaces exactly that cell's value; every
   other row and the surrounding table structure is left untouched.

---

## Edge Cases

The generic onboarding stop/idempotency conditions — `/wf:init` not run,
`$CLAUDE_PLUGIN_ROOT` unset, `linear` already registered, a `wf-linear` plugin-root row
already present, registry relocated via `registryPath`, and self-check FAIL — are handled
by `plugins/wf/skills/_contracts/pack-onboarding.ops.md` §"Edge cases". wf-linear's own
cases:

- **`ado` already registered as the active tracker provider:** register `linear`
  anyway (this skill never blocks its own registration), but flag in the Final Output
  that both `ado` and `linear` are now present and that registry validation will fail
  on the overlapping `tracker` surface until one is removed — direct the user to pick
  one.
- **Linear Team already set (re-run on an already-onboarded repo):** Phase 4 produces
  **zero prompts** and leaves both rows byte-identical — report both as
  `carried forward`.

---

## Final Output

```
WF-LINEAR-INIT — <onboarded | already-registered | partial>

Registry:   <resolved registry location>
Pack root:  <pack-root>
Registered: linear — <registered | already registered>
Linear:
- Linear Team    — <carried forward | set to <value>>
- Linear Project — <carried forward | set to none | set to <value>>
Self-check: <PASS — plugin:wf-linear/capabilities/linear resolves (recorded root or self-heal) | FAIL — pack unrecoverable: <what didn't resolve>>
<Warning: `ado` is also registered — both claim the tracker surface; registry validation will fail until one is removed. — only when applicable>

Next: run any wf skill that needs the tracker (e.g. /wf:spec, /wf:lite, /wf:triage) — core resolves the linear capability for the tracker surface directly (no phase-firing gate). Upgrades self-heal — re-run /wf-linear:init only if resolution reports the pack unrecoverable, or after relocating the pack.
```

**The final-output block must always be the very last thing output to chat.**
