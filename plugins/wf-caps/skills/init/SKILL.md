---
name: init
description: Onboards the wf-caps pack into a wf-initialized repo in one command — registers the pack's capabilities into the wf capability registry as plugin-anchored rows and records the pack's install root so core can resolve them, then seeds each capability's profile. Use once (after /wf:init) to activate wf-caps without hand-editing _local/config.md; upgrades self-heal, so re-run only if resolution reports a capability unrecoverable or after relocating the pack. Optionally pass a subset of capability names to register only those.
allowed-tools: [Read, Write, Edit, Glob, Bash]
---

# /wf-caps:init — Onboard the wf-caps pack (self-register + record install root)

Collapse wf-caps onboarding into **one command**. Installing the plugin makes `/wf-caps:*`
commands discoverable (native composition) but registers **no** phase fragments — that
still required hand-editing the downstream `## Capabilities` table and re-running
`/wf:init`. This skill does that registration for you and records the one datum core
cannot get on its own: **the pack's install root**.

Core resolves a `plugin:<plugin-name>/<rel-path>` `Path` by looking `<plugin-name>` up in
a `## Plugin Roots` mapping (see `plugins/wf/skills/_contracts/capability-registry.contract.md`
§"The `## Plugin Roots` mapping"). Only a **wf-caps skill** runs with
`${CLAUDE_PLUGIN_ROOT}` equal to the wf-caps install root, so only this skill can capture
and record it. With the root recorded and the capability rows written, core resolves the
pack's capabilities on a **plugin-only install** — no vendored `plugins/wf-caps/...` in the
consuming repo.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery). `/wf-caps:*`
commands are already discoverable from installing the plugin; this skill wires the
**fragments + registry**.

---

## Command Syntax

```
/wf-caps:init [<capability> ...]
```

### Arguments

| Argument       | Required | Description |
| -------------- | -------- | ----------- |
| `<capability>` | NO       | Zero or more capability names to register (e.g. `migration browser-qa`). **Default (no args): register every capability the pack ships** (each `capabilities/<name>/` folder with a `manifest.md`). A subset registers only the named ones. |

**Validation:**

- **Registry location:** resolve exactly as `/wf:init` does — read `wf.config.js` at the repo root (`git rev-parse --show-toplevel`) and use its optional `registryPath` key, **defaulting to `_local/config.md`** when absent. All registry writes below target this resolved location.
- If a named `<capability>` has no `capabilities/<name>/manifest.md` under the pack, stop and name it (do not guess a near-match).

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read `${CLAUDE_PLUGIN_ROOT}` and read-only git (`git rev-parse`).
- Write/edit files under `_local/`.
- Write the `## Plugin Roots` and `## Capabilities` tables to the **resolved registry location** — the one sanctioned write outside `_local/` (registering the pack is this skill's whole purpose), mirroring `/wf:init`'s registry-write carve-out.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires fragments/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-caps).
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "wf-caps:init must run inside a git repository — run `/wf:init` first."
2. **Record the repo root:** `git rev-parse --show-toplevel`.
3. **Require `/wf:init` first.** Resolve the registry location (see Validation). If `_local/` is absent, or the resolved registry file does not exist, stop: "Run `/wf:init` first — wf-caps:init registers into the registry that `/wf:init` creates." (This skill augments the registry; it does not bootstrap `_local/`.)

---

## Phase 1: Discover self

1. **Capture the install root.** Run (Bash) `printf '%s' "$CLAUDE_PLUGIN_ROOT"` to read the pack's install root. If it is empty, stop: "`$CLAUDE_PLUGIN_ROOT` is not set — run this as the `/wf-caps:init` slash command so the pack's install root is available." **Normalize to forward slashes** (replace every `\` with `/`); a leading drive prefix such as `C:` is fine (the `## Plugin Roots` `Root` shape permits absolute/drive-prefixed roots — see the contract). Call the normalized value `<pack-root>`.
2. **Enumerate the pack's capabilities.** `Glob` `<pack-root>/capabilities/*/manifest.md` (use the normalized `<pack-root>`, not the raw `$CLAUDE_PLUGIN_ROOT`, so a Windows backslash can't make the glob miss manifests); each match's parent folder name is a capability name. If arguments were given, intersect with them (erroring on any unknown name per Validation). If the resulting set is empty, stop: "No capabilities to register." Call this the **selected set**.

---

## Phase 2: Record the plugin root

Write/refresh the `wf-caps` row in a `## Plugin Roots` table at the resolved registry location.

1. Read the registry file. Locate a `## Plugin Roots` section.
2. **If absent**, append this section (heading + prose + table) to the file:

   ```markdown
   ## Plugin Roots

   Per-machine plugin install roots that resolve plugin-anchored `## Capabilities` paths (`plugin:<plugin-name>/<rel-path>`). Written and refreshed by each pack's own init (e.g. `/wf-caps:init`) — machine-specific, gitignored, never committed. See `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots` mapping".

   | Plugin  | Root        |
   |---------|-------------|
   | wf-caps | <pack-root> |
   ```

3. **If present**, upsert the `wf-caps` row: replace its `Root` with `<pack-root>` if the row exists (the install root can move between machines / upgrades), else append the row to the table. Leave every other plugin's row untouched.

Substitute the real `<pack-root>` value; never write the literal placeholder.

---

## Phase 3: Register the selected capabilities

For each capability in the selected set, ensure a `## Capabilities` row exists at the resolved registry location:

- Row shape: `| <name> | plugin:wf-caps/capabilities/<name> |`.
- **Append-only, skip-if-present by capability name.** If a row with that `Capability` name already exists (any `Path`), leave it untouched and record `already registered`. Never delete or reorder existing rows.
- Preserve the table's existing order; append new rows at the end (registry order = injection order, general → specific — appended packs are most-specific, which is the intended default).

---

## Phase 4: Seed profiles

For each **newly-registered** capability (skip ones that were already registered), apply the **profile-seeding convention by name** — the same convention `/wf:init` Phase 2.5 follows, defined in `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The profile-seeding convention". Do **not** re-derive its rules here.

- Resolve the capability's manifest at `<pack-root>/capabilities/<name>/manifest.md` (the plugin-anchored row you just wrote, resolved through the `## Plugin Roots` root you just recorded).
- If the manifest declares no `profile-template:`, no-op (record `skipped — no template`).
- Otherwise seed a downstream **override** at `_local/profiles/<name>.profile.json` **only on divergence** from the capability's default template; **idempotent** — never overwrite an existing override (skip-if-present). Record `seeded override` or `default in use`.

This is exactly what `/wf:init` would do on its next run now that the rows resolve — doing it here keeps onboarding to one command.

---

## Phase 5: Self-check (the one in-repo runtime assertion)

Pick one capability from the selected set and resolve it **the way core will** — including self-heal — to prove the wiring end-to-end. Follow `plugins/wf/skills/_contracts/capability-registry.ops.md` §"Recorded-root-first resolution with install-manifest self-heal" for the resolution steps; do not restate the algorithm here.

1. Resolve `plugin:wf-caps/capabilities/<name>` per that section: the recorded `## Plugin Roots` root first, then — if that root dangles — the install-manifest fallback.
2. Record `PASS` when resolution yields a readable `manifest.md` by **either** route — a recovered-via-fallback root counts as PASS, since a recorded root that went stale after an upgrade is expected and self-heals, not a failure. Record `FAIL` only when the capability is **unrecoverable** (neither route yields a readable manifest — the ops-doc step-3 case).
3. A `FAIL` means the pack is unrecoverable — surface it loudly and direct the user to re-run `/wf-caps:init` (or fix a relocated pack); do not report success.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to `/wf:init` (Phase 0). This skill augments a registry; it never bootstraps one.
- **`$CLAUDE_PLUGIN_ROOT` unset** (skill invoked outside the plugin runtime): stop — the install root is the one datum this skill exists to capture.
- **Capability already registered** (a row with that name exists): skip it (append-only, skip-if-present); still refresh the plugin root and self-check.
- **Unknown capability argument** (no `capabilities/<name>/manifest.md`): stop and name it; do not guess.
- **`## Plugin Roots` already has a `wf-caps` row**: upsert (refresh the `Root`), never duplicate.
- **Registry relocated to a committed file via `registryPath`**: still write there (the sanctioned write), but warn that the machine-specific `## Plugin Roots` table should stay gitignored — keep the registry under `_local/` unless the project manages that itself.
- **Self-check FAIL**: report it as the final state (`partial`); do not claim success.

---

## Final Output

```
WF-CAPS-INIT — <onboarded | already-registered | partial>

Registry:     <resolved registry location>
Pack root:    <pack-root>
Registered:
- <capability> — <registered | already registered>
  (one line per selected capability)
Profiles:
- <capability> — <seeded override [seeded by <model id>] | default in use | skipped — no template>
  (one line per newly-registered capability; "none" when all were already registered)
Self-check:   <PASS — plugin:wf-caps/capabilities/<name> resolves (recorded root or self-heal) | FAIL — pack unrecoverable: <what didn't resolve>>

Next: run any wf phase (e.g. /wf:verify, /wf:qa-gen) — core now resolves the pack's capabilities. Upgrades self-heal — re-run /wf-caps:init only if resolution reports a capability unrecoverable, or after relocating the pack.
```

Attach `seeded by <model id>` only to a `seeded override` whose profile format has no schema-permitted attribution slot (per the seeding convention); use the current model id from the runtime, or `unknown`.

**The final-output block must always be the very last thing output to chat.**
