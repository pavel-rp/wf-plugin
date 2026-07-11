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
phase git never needed: an interview for the Linear team (and, optionally, project).

Core resolves a `plugin:<plugin-name>/<rel-path>` `Path` by looking `<plugin-name>` up
in a `## Plugin Roots` mapping (see
`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots`
mapping"). Only a **wf-linear skill** runs with `${CLAUDE_PLUGIN_ROOT}` equal to the
wf-linear install root, so only this skill can capture and record it. With the root
recorded and the capability row written, core resolves the pack's `linear` capability
on a **plugin-only install** — no vendored `plugins/wf-linear/...` in the consuming
repo.

This mirrors `/wf-ado:init` (WF-123) and `/wf-git:init` (WF-122)
exactly, simplified for a single-capability pack — **plus one bespoke phase
git never needed**: Phase 4 below interviews for the Linear team + optional project,
writing this pack's **own** `## Linear` section of `_local/config.md`. Unlike
`/wf-ado:init`'s `## Azure DevOps` section, there is nothing to "carry forward" from
core's own `/wf:init` template here — core's config template ships no tracker-product
section of any kind (see `plugins/wf/skills/init/SKILL.md` Phase 2's "Default
content"); the `## Linear` section below is entirely this pack's own, created fresh on
first run and left untouched (except for genuinely-unset rows) on every re-run.

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

**Validation:**

- **Registry location:** resolve exactly as `/wf:init` does — read `wf.config.js` at the
  repo root (`git rev-parse --show-toplevel`) and use its optional `registryPath` key,
  **defaulting to `_local/config.md`** when absent. All registry writes below target
  this resolved location.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read `${CLAUDE_PLUGIN_ROOT}` and read-only git (`git rev-parse`).
- Write/edit files under `_local/` — including the `## Linear` section of
  `_local/config.md` (Phase 4), which stays inside `_local/`.
- Write the `## Plugin Roots` and `## Capabilities` tables to the **resolved registry
  location** — the one sanctioned write outside `_local/` (registering the pack is this
  skill's whole purpose), mirroring `/wf:init`'s and `/wf-ado:init`'s registry-write
  carve-out.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-linear).
- Invent a default value for **Linear Team** — always ask.
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "wf-linear:init
   must run inside a git repository — run `/wf:init` first."
2. **Record the repo root:** `git rev-parse --show-toplevel`.
3. **Require `/wf:init` first.** Resolve the registry location (see Validation). If
   `_local/` is absent, or the resolved registry file does not exist, stop: "Run
   `/wf:init` first — wf-linear:init registers into the registry that `/wf:init`
   creates." (This skill augments the registry; it does not bootstrap `_local/`.)

---

## Phase 1: Discover self

1. **Capture the install root.** Run (Bash) `printf '%s' "$CLAUDE_PLUGIN_ROOT"` to read
   the pack's install root. If it is empty, stop: "`$CLAUDE_PLUGIN_ROOT` is not set —
   run this as the `/wf-linear:init` slash command so the pack's install root is
   available." **Normalize to forward slashes** (replace every `\` with `/`); a leading
   drive prefix such as `C:` is fine (the `## Plugin Roots` `Root` shape permits
   absolute/drive-prefixed roots). Call the normalized value `<pack-root>`.
2. **Confirm the capability manifest exists.** Confirm
   `<pack-root>/capabilities/linear/manifest.md` is readable. If it is not, stop: "No
   `capabilities/linear/manifest.md` under the pack — the install appears corrupted or
   incomplete."

---

## Phase 2: Record the plugin root

Write/refresh the `wf-linear` row in a `## Plugin Roots` table at the resolved
registry location.

1. Read the registry file. Locate a `## Plugin Roots` section.
2. **If absent**, append this section (heading + prose + table) to the file:

   ```markdown
   ## Plugin Roots

   Per-machine plugin install roots that resolve plugin-anchored `## Capabilities` paths (`plugin:<plugin-name>/<rel-path>`). Written and refreshed by each pack's own init (e.g. `/wf-linear:init`) — machine-specific, gitignored, never committed. See `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots` mapping".

   | Plugin    | Root        |
   |-----------|-------------|
   | wf-linear | <pack-root> |
   ```

3. **If present**, upsert the `wf-linear` row: replace its `Root` with `<pack-root>` if
   the row exists (the install root can move between machines / upgrades), else append
   the row to the table. Leave every other plugin's row untouched.

Substitute the real `<pack-root>` value; never write the literal placeholder.

---

## Phase 3: Register the capability

Ensure a `## Capabilities` row exists at the resolved registry location:

- Row shape: `| linear | plugin:wf-linear/capabilities/linear |`.
- **Append-only, skip-if-present by capability name.** If a row named `linear` already
  exists (any `Path`), leave it untouched and record `already registered`. Never delete
  or reorder existing rows.
- Preserve the table's existing order; append the new row at the end (registry order =
  injection order, general → specific — an appended pack is most-specific, the
  intended default).
- **Do not check for an `ado` row here.** Co-registering `linear` alongside an already-
  active `ado` capability is a registry-**validation** concern (both would claim the
  `tracker` provider surface — a partitioned-ownership overlap), not something this
  onboarding skill polices itself; report it plainly if the user later runs registry
  validation and it fails, but don't duplicate that check inline.

---

## Phase 4: Interview + carry-forward (bespoke)

The one phase git never needed. Reconcile `_local/config.md`'s `## Linear` section
with real values, carrying forward anything a prior `/wf-linear:init` run (or a
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

## Phase 5: Self-check (the one in-repo runtime assertion)

Resolve `linear` **the way core will** — including self-heal — to prove the wiring
end-to-end. Follow `plugins/wf/skills/_contracts/capability-registry.ops.md`
§"Recorded-root-first resolution with install-manifest self-heal" for the resolution
steps; do not restate the algorithm here.

1. Resolve `plugin:wf-linear/capabilities/linear` per that section: the recorded `##
   Plugin Roots` root first, then — if that root dangles — the install-manifest fallback.
2. Record `PASS` when resolution yields a readable `manifest.md` by **either** route — a
   recovered-via-fallback root counts as PASS, since a recorded root that went stale
   after an upgrade is expected and self-heals, not a failure. Record `FAIL` only when
   the pack is **unrecoverable** (neither route yields a readable manifest — the ops-doc
   step-3 case).
3. A `FAIL` means the pack is unrecoverable — surface it loudly and direct the user to
   re-run `/wf-linear:init` (or fix a relocated pack); do not report success.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0). This skill augments a registry; it never bootstraps one.
- **`$CLAUDE_PLUGIN_ROOT` unset** (skill invoked outside the plugin runtime): stop — the
  install root is the one datum this skill exists to capture.
- **`linear` already registered** (a row named `linear` exists): skip it (append-only,
  skip-if-present); still refresh the plugin root, run the Phase 4 interview, and
  self-check.
- **`## Plugin Roots` already has a `wf-linear` row**: upsert (refresh the `Root`),
  never duplicate.
- **`ado` already registered as the active tracker provider:** register `linear`
  anyway (this skill never blocks its own registration), but flag in the Final Output
  that both `ado` and `linear` are now present and that registry validation will fail
  on the overlapping `tracker` surface until one is removed — direct the user to pick
  one.
- **Linear Team already set (re-run on an already-onboarded repo):** Phase 4 produces
  **zero prompts** and leaves both rows byte-identical — report both as
  `carried forward`.
- **Registry relocated to a committed file via `registryPath`**: still write there (the
  sanctioned write), but warn that the machine-specific `## Plugin Roots` table should
  stay gitignored — keep the registry under `_local/` unless the project manages that
  itself.
- **Self-check FAIL**: report it as the final state (`partial`); do not claim success.

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
