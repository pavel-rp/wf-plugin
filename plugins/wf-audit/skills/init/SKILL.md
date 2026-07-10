---
name: init
description: Onboards the wf-audit pack into a wf-initialized repo in one command — registers both the audit and sr capabilities into the wf capability registry as plugin-anchored rows and records the pack's install root so core can resolve them, then seeds the audit profile. Use once (after /wf:init) to activate the five verify-phase adversarial lenses plus the pre-commit self-review lens without hand-editing _local/config.md; upgrades self-heal, so re-run only if resolution reports a capability unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf-audit:init — Onboard the wf-audit pack (self-register + record install root)

Collapse wf-audit onboarding into **one command**. Installing the plugin makes
`/wf-audit:init` discoverable (native composition) but registers **no** phase fragment —
that still requires hand-editing the downstream `## Capabilities` table and re-running
`/wf:init`. This skill does that registration for you and records the one datum core
cannot get on its own: **the pack's install root**.

Core resolves a `plugin:<plugin-name>/<rel-path>` `Path` by looking `<plugin-name>` up in
a `## Plugin Roots` mapping (see `plugins/wf/skills/_contracts/capability-registry.contract.md`
§"The `## Plugin Roots` mapping"). Only a **wf-audit skill** runs with
`${CLAUDE_PLUGIN_ROOT}` equal to the wf-audit install root, so only this skill can capture
and record it. With the root recorded and both capability rows written, core resolves the
pack's `audit` and `sr` capabilities on a **plugin-only install** — no vendored
`plugins/wf-audit/...` in the consuming repo.

This pack's onboarding is fixed to the two capabilities it ships: there is no
capability-subset argument — `audit` and `sr` always register together, because `sr`
reaches `audit`'s owned correctness rubric by a co-located intra-plugin path and the two
capabilities are shipped as one unit (WF-257 charter).

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
  **defaulting to `_local/config.md`** when absent. All registry writes below target
  this resolved location.

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read `${CLAUDE_PLUGIN_ROOT}` and read-only git (`git rev-parse`).
- Write/edit files under `_local/`.
- Write the `## Plugin Roots` and `## Capabilities` tables to the **resolved registry
  location** — the one sanctioned write outside `_local/` (registering the pack is this
  skill's whole purpose), mirroring `/wf:init`'s registry-write carve-out.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragments/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-audit).
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

## Phase 1: Discover self

1. **Capture the install root.** Run (Bash) `printf '%s' "$CLAUDE_PLUGIN_ROOT"` to read
   the pack's install root. If it is empty, stop: "`$CLAUDE_PLUGIN_ROOT` is not set —
   run this as the `/wf-audit:init` slash command so the pack's install root is
   available." **Normalize to forward slashes** (replace every `\` with `/`); a leading
   drive prefix such as `C:` is fine (the `## Plugin Roots` `Root` shape permits
   absolute/drive-prefixed roots). Call the normalized value `<pack-root>`.
2. **Confirm both capability manifests exist.** Confirm `<pack-root>/capabilities/audit/manifest.md`
   and `<pack-root>/capabilities/sr/manifest.md` are both readable. If either is not, stop:
   "No `capabilities/<name>/manifest.md` under the pack — the install appears corrupted or
   incomplete," naming which is missing.

---

## Phase 2: Record the plugin root

Write/refresh the `wf-audit` row in a `## Plugin Roots` table at the resolved registry
location.

1. Read the registry file. Locate a `## Plugin Roots` section.
2. **If absent**, append this section (heading + prose + table) to the file:

   ```markdown
   ## Plugin Roots

   Per-machine plugin install roots that resolve plugin-anchored `## Capabilities` paths (`plugin:<plugin-name>/<rel-path>`). Written and refreshed by each pack's own init (e.g. `/wf-audit:init`) — machine-specific, gitignored, never committed. See `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots` mapping".

   | Plugin   | Root        |
   |----------|-------------|
   | wf-audit | <pack-root> |
   ```

3. **If present**, upsert the `wf-audit` row: replace its `Root` with `<pack-root>` if the
   row exists (the install root can move between machines / upgrades), else append the
   row to the table. Leave every other plugin's row untouched.

Substitute the real `<pack-root>` value; never write the literal placeholder.

---

## Phase 3: Register both capabilities

For **each** of `audit` and `sr`, ensure a `## Capabilities` row exists at the resolved
registry location:

- Row shapes: `| audit | plugin:wf-audit/capabilities/audit |` and
  `| sr | plugin:wf-audit/capabilities/sr |`.
- **Append-only, skip-if-present by capability name.** If a row with that `Capability`
  name already exists (any `Path`), leave it untouched and record `already registered`.
  Never delete or reorder existing rows.
- Preserve the table's existing order; append new rows at the end, `audit` then `sr`
  (registry order = injection order, general → specific — appended rows are
  most-specific, the intended default).

---

## Phase 4: Seed profiles

Apply the **profile-seeding convention by name** — the same convention `/wf:init` Phase 2.5
follows, defined in `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The
profile-seeding convention". Do **not** re-derive its rules here.

- **audit** (if newly registered): resolve its manifest at
  `<pack-root>/capabilities/audit/manifest.md`. It declares `profile-template:
  profile.template.json` — seed a downstream **override** at
  `_local/profiles/audit.profile.json` **only on divergence** from the capability's default
  template; **idempotent** — never overwrite an existing override (skip-if-present). Record
  `seeded override` or `default in use`.
- **sr** (if newly registered): resolve its manifest at
  `<pack-root>/capabilities/sr/manifest.md`. It declares **no** `profile-template:` — no-op.
  Record `skipped — no template`.
- Skip either step whose capability was already registered (Phase 3 recorded `already
  registered` for it).

This is exactly what `/wf:init` would do on its next run now that the rows resolve — doing
it here keeps onboarding to one command.

---

## Phase 5: Self-check (the one in-repo runtime assertion)

Resolve **both** capabilities **the way core will** — including self-heal — to prove the
wiring end-to-end. Follow `plugins/wf/skills/_contracts/capability-registry.ops.md`
§"Recorded-root-first resolution with install-manifest self-heal" for the resolution
steps; do not restate the algorithm here.

1. Resolve `plugin:wf-audit/capabilities/audit` and `plugin:wf-audit/capabilities/sr` per
   that section: the recorded `## Plugin Roots` root first, then — if that root dangles —
   the install-manifest fallback.
2. Record `PASS` when resolution yields a readable `manifest.md` for **both**, by **either**
   route each — a recovered-via-fallback root counts as PASS, since a recorded root that
   went stale after an upgrade is expected and self-heals, not a failure. Record `FAIL` when
   **either** capability is **unrecoverable** (neither route yields a readable manifest for
   it — the ops-doc step-3 case), naming which.
3. A `FAIL` means the pack is unrecoverable — surface it loudly and direct the user to
   re-run `/wf-audit:init` (or fix a relocated pack); do not report success.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0). This skill augments a registry; it never bootstraps one.
- **`$CLAUDE_PLUGIN_ROOT` unset** (skill invoked outside the plugin runtime): stop — the
  install root is the one datum this skill exists to capture.
- **One or both capabilities already registered** (a row with that name exists): skip the
  registered one(s) (append-only, skip-if-present); still refresh the plugin root, run
  Phase 4 for any newly-registered capability, and self-check both.
- **`## Plugin Roots` already has a `wf-audit` row**: upsert (refresh the `Root`), never
  duplicate.
- **Registry relocated to a committed file via `registryPath`**: still write there (the
  sanctioned write), but warn that the machine-specific `## Plugin Roots` table should
  stay gitignored — keep the registry under `_local/` unless the project manages that
  itself.
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
Self-check: <PASS — both capabilities resolve (recorded root or self-heal) | FAIL — <capability> unrecoverable: <what didn't resolve>>

Next: run /wf:verify-spec on a task — core dispatches the five audit lenses at verify; the commit path's pre-commit seam dispatches the sr lens on every commit. Upgrades self-heal — re-run /wf-audit:init only if resolution reports a capability unrecoverable, or after relocating the pack.
```

Attach `seeded by <model id>` only to a `seeded override` whose profile format has no
schema-permitted attribution slot (per the seeding convention); use the current model id
from the runtime, or `unknown`.

**The final-output block must always be the very last thing output to chat.**
