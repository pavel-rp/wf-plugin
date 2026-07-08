---
name: init
description: Onboards the wf-git pack into a wf-initialized repo in one command — registers the pack's git capability into the wf capability registry as a plugin-anchored row and records the pack's install root so core can resolve it. Use once (after /wf:init) to activate git/GitHub delivery without hand-editing _local/config.md; upgrades self-heal, so re-run only if resolution reports the pack unrecoverable or after relocating the pack.
allowed-tools: [Read, Write, Edit, Bash]
---

# /wf-git:init — Onboard the wf-git pack (self-register + record install root)

Collapse wf-git onboarding into **one command**. Installing the plugin makes
`/wf-git:init` discoverable (native composition) but registers **no** phase fragment —
that still requires hand-editing the downstream `## Capabilities` table and re-running
`/wf:init`. This skill does that registration for you and records the one datum core
cannot get on its own: **the pack's install root**.

Core resolves a `plugin:<plugin-name>/<rel-path>` `Path` by looking `<plugin-name>` up
in a `## Plugin Roots` mapping (see
`plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots`
mapping"). Only a **wf-git skill** runs with `${CLAUDE_PLUGIN_ROOT}` equal to the
wf-git install root, so only this skill can capture and record it. With the root
recorded and the capability row written, core resolves the pack's `git` capability on
a **plugin-only install** — no vendored `plugins/wf-git/...` in the consuming repo.

This mirrors `/wf-caps:init` (WF-99) exactly, simplified for a single-capability pack:
there is no capability-subset argument, because wf-git ships exactly one capability.

**This is fragment/registry-side onboarding only.** It cannot register a `/command` — a
discoverable skill must live in a plugin's `skills/` dir (native discovery).
`/wf-git:init` is already discoverable from installing the plugin; this skill wires the
**fragment + registry**.

---

## Command Syntax

```
/wf-git:init
```

Takes no arguments — it always registers the single `git` capability this pack ships.

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
  skill's whole purpose), mirroring `/wf:init`'s and `/wf-caps:init`'s registry-write
  carve-out.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-git).
- Run builds, tests, installs, or any destructive git operation.

---

## Phase 0: Preconditions

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "wf-git:init must
   run inside a git repository — run `/wf:init` first."
2. **Record the repo root:** `git rev-parse --show-toplevel`.
3. **Require `/wf:init` first.** Resolve the registry location (see Validation). If
   `_local/` is absent, or the resolved registry file does not exist, stop: "Run
   `/wf:init` first — wf-git:init registers into the registry that `/wf:init` creates."
   (This skill augments the registry; it does not bootstrap `_local/`.)

---

## Phase 1: Discover self

1. **Capture the install root.** Run (Bash) `printf '%s' "$CLAUDE_PLUGIN_ROOT"` to read
   the pack's install root. If it is empty, stop: "`$CLAUDE_PLUGIN_ROOT` is not set —
   run this as the `/wf-git:init` slash command so the pack's install root is
   available." **Normalize to forward slashes** (replace every `\` with `/`); a leading
   drive prefix such as `C:` is fine (the `## Plugin Roots` `Root` shape permits
   absolute/drive-prefixed roots). Call the normalized value `<pack-root>`.
2. **Confirm the capability manifest exists.** Confirm `<pack-root>/capabilities/git/manifest.md`
   is readable. If it is not, stop: "No `capabilities/git/manifest.md` under the pack —
   the install appears corrupted or incomplete."

---

## Phase 2: Record the plugin root

Write/refresh the `wf-git` row in a `## Plugin Roots` table at the resolved registry
location.

1. Read the registry file. Locate a `## Plugin Roots` section.
2. **If absent**, append this section (heading + prose + table) to the file:

   ```markdown
   ## Plugin Roots

   Per-machine plugin install roots that resolve plugin-anchored `## Capabilities` paths (`plugin:<plugin-name>/<rel-path>`). Written and refreshed by each pack's own init (e.g. `/wf-git:init`) — machine-specific, gitignored, never committed. See `plugins/wf/skills/_contracts/capability-registry.contract.md` §"The `## Plugin Roots` mapping".

   | Plugin | Root        |
   |--------|-------------|
   | wf-git | <pack-root> |
   ```

3. **If present**, upsert the `wf-git` row: replace its `Root` with `<pack-root>` if the
   row exists (the install root can move between machines / upgrades), else append the
   row to the table. Leave every other plugin's row untouched.

Substitute the real `<pack-root>` value; never write the literal placeholder.

---

## Phase 3: Register the capability

Ensure a `## Capabilities` row exists at the resolved registry location:

- Row shape: `| git | plugin:wf-git/capabilities/git |`.
- **Append-only, skip-if-present by capability name.** If a row named `git` already
  exists (any `Path`), leave it untouched and record `already registered`. Never delete
  or reorder existing rows.
- Preserve the table's existing order; append the new row at the end (registry order =
  injection order, general → specific — an appended pack is most-specific, the
  intended default).

---

## Phase 4: Seed profiles

The `git` capability's manifest declares **no** `profile-template:` — no-op. Record
`skipped — no template`.

---

## Phase 5: Self-check (the one in-repo runtime assertion)

Resolve `git` **the way core will** — including self-heal — to prove the wiring
end-to-end. Follow `plugins/wf/skills/_contracts/capability-registry.ops.md`
§"Recorded-root-first resolution with install-manifest self-heal" for the resolution
steps; do not restate the algorithm here.

1. Resolve `plugin:wf-git/capabilities/git` per that section: the recorded `## Plugin
   Roots` root first, then — if that root dangles — the install-manifest fallback.
2. Record `PASS` when resolution yields a readable `manifest.md` by **either** route — a
   recovered-via-fallback root counts as PASS, since a recorded root that went stale
   after an upgrade is expected and self-heals, not a failure. Record `FAIL` only when
   the pack is **unrecoverable** (neither route yields a readable manifest — the ops-doc
   step-3 case).
3. A `FAIL` means the pack is unrecoverable — surface it loudly and direct the user to
   re-run `/wf-git:init` (or fix a relocated pack); do not report success.

---

## Edge Cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0). This skill augments a registry; it never bootstraps one.
- **`$CLAUDE_PLUGIN_ROOT` unset** (skill invoked outside the plugin runtime): stop — the
  install root is the one datum this skill exists to capture.
- **`git` already registered** (a row named `git` exists): skip it (append-only,
  skip-if-present); still refresh the plugin root and self-check.
- **`## Plugin Roots` already has a `wf-git` row**: upsert (refresh the `Root`), never
  duplicate.
- **Registry relocated to a committed file via `registryPath`**: still write there (the
  sanctioned write), but warn that the machine-specific `## Plugin Roots` table should
  stay gitignored — keep the registry under `_local/` unless the project manages that
  itself.
- **Self-check FAIL**: report it as the final state (`partial`); do not claim success.

---

## Final Output

```
WF-GIT-INIT — <onboarded | already-registered | partial>

Registry:   <resolved registry location>
Pack root:  <pack-root>
Registered: git — <registered | already registered>
Profile:    skipped — no template
Self-check: <PASS — plugin:wf-git/capabilities/git resolves (recorded root or self-heal) | FAIL — pack unrecoverable: <what didn't resolve>>

Next: run any wf skill that needs delivery (e.g. /wf:branch, /wf:commit, /wf:pr) — core resolves the git capability for the delivery surface directly (no phase-firing gate). Upgrades self-heal — re-run /wf-git:init only if resolution reports the pack unrecoverable, or after relocating the pack.
```

**The final-output block must always be the very last thing output to chat.**
