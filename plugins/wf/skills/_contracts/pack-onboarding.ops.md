# Provider-pack onboarding — runtime ops

The **write-side** onboarding spine every provider pack's `/wf-<pack>:init` skill
follows: register the pack's one capability into the downstream registry and record the
one datum core cannot get on its own — the pack's install root — so core's **read-side**
resolution (`capability-registry.ops.md`) can later resolve it on a plugin-only install.
This procedure is generic: it names no concrete pack. The invoking init supplies the
`## Parameters` below; everything else is identical across packs, so a rename or a new
pack never re-drifts a copied spine.

**Reference:** rationale, history, and authoring detail live in the paired
`pack-onboarding` reference doc — never read at boot.

## Parameters

The invoking `/wf-<pack>:init` SKILL.md supplies three values; substitute them wherever
this doc writes `<pack>`, `<capability>`, or the Phase 4 slot:

- `<pack>` — the plugin name (e.g. the value that prefixes the `/wf-…:init` command).
- `<capability>` — the single capability the pack registers.
- **Phase 4 detail** — the pack-specific step (a no-op profile seed, or a config
  interview). The invoking SKILL.md carries this; this doc only marks where it runs.

## Phase 0: Preconditions

1. **Confirm a git repo:** `git rev-parse --git-dir`. If not, stop: "`/wf-<pack>:init`
   must run inside a git repository — run `/wf:init` first."
2. **Record the workspace directory:** `pwd -P`.
3. **Resolve the registry location** exactly as `/wf:init` does — read `wf.config.js` at
   the repo root and use its optional `registryPath` key, **defaulting to
   `_local/config.md`** when absent. All registry writes below target this location.
4. **Require `/wf:init` first.** If `_local/` is absent, or the resolved registry file
   does not exist, stop: "Run `/wf:init` first — `/wf-<pack>:init` registers into the
   registry that `/wf:init` creates." (This skill augments a registry; it never
   bootstraps one.)

## Phase 1: Discover self

1. **Capture the install root.** Run (Bash) `printf '%s' "$CLAUDE_PLUGIN_ROOT"`. If it is
   empty, stop: "`$CLAUDE_PLUGIN_ROOT` is not set — run this as the `/wf-<pack>:init`
   slash command so the pack's install root is available." **Normalize to forward
   slashes** (replace every `\` with `/`); a leading drive prefix such as `C:` is fine
   (the `## Plugin Roots` `Root` shape permits absolute/drive-prefixed roots). Call the
   normalized value `<pack-root>`.
2. **Confirm the capability manifest exists.** Confirm
   `<pack-root>/capabilities/<capability>/manifest.md` is readable. If not, stop: "No
   `capabilities/<capability>/manifest.md` under the pack — the install appears corrupted
   or incomplete."

## Phase 2: Record the plugin root

Write/refresh the `<pack>` row in a `## Plugin Roots` table at the resolved registry
location.

1. Read the registry file. Locate a `## Plugin Roots` section.
2. **If absent**, append this section (heading + prose + table) to the file:

   ```markdown
   ## Plugin Roots

   Per-machine plugin install roots that resolve plugin-anchored `## Capabilities` paths (`plugin:<plugin-name>/<rel-path>`). Written and refreshed by each pack's own init (e.g. `/wf-<pack>:init`) — machine-specific, gitignored, never committed. See `plugins/wf/skills/_contracts/capability-registry.ops.md` §"The `## Plugin Roots` mapping".

   | Plugin | Root        |
   |--------|-------------|
   | <pack> | <pack-root> |
   ```

3. **If present**, upsert the `<pack>` row: replace its `Root` with `<pack-root>` if the
   row exists (the install root can move between machines / upgrades), else append the
   row. Leave every other plugin's row untouched.

Substitute the real `<pack-root>` value; never write the literal placeholder.

## Phase 3: Register the capability

Ensure a `## Capabilities` row exists at the resolved registry location:

- Row shape: `| <capability> | plugin:<pack>/capabilities/<capability> |`.
- **Append-only, skip-if-present by capability name.** If a row named `<capability>`
  already exists (any `Path`), leave it untouched and record `already registered`. Never
  delete or reorder existing rows.
- Preserve the table's existing order; append the new row at the end (registry order =
  injection order, general → specific — an appended pack is most-specific, the intended
  default).

## Phase 4: Pack-specific step

Run the invoking SKILL.md's **Phase 4 detail** here — a no-op profile seed for a pack
with no template, or a config interview for a tracker pack. This is the one phase that
varies; the invoking init owns its content (including any config-section write and the
matching final-output rows). Then return here for Phase 5.

## Phase 5: Self-check

Resolve `<capability>` **the way core will** — including self-heal — to prove the wiring
end-to-end. Follow `capability-registry.ops.md` §"Recorded-root-first resolution with
install-manifest self-heal" for the resolution steps; do not restate the algorithm.

1. Resolve `plugin:<pack>/capabilities/<capability>` per that section: the recorded `##
   Plugin Roots` root first, then — if that root dangles — the install-manifest fallback.
2. Record `PASS` when resolution yields a readable `manifest.md` by **either** route — a
   recovered-via-fallback root counts as PASS, since a recorded root that went stale
   after an upgrade is expected and self-heals, not a failure. Record `FAIL` only when
   the pack is **unrecoverable** (neither route yields a readable manifest).
3. A `FAIL` means the pack is unrecoverable — surface it loudly and direct the user to
   re-run `/wf-<pack>:init` (or fix a relocated pack); do not report success.

## Edge cases

- **`/wf:init` not run yet** (no `_local/` or no resolved registry): stop and direct to
  `/wf:init` (Phase 0). This skill augments a registry; it never bootstraps one.
- **`$CLAUDE_PLUGIN_ROOT` unset** (skill invoked outside the plugin runtime): stop — the
  install root is the one datum this skill exists to capture.
- **`<capability>` already registered** (a row with that name exists): skip it
  (append-only, skip-if-present); still refresh the plugin root, run Phase 4, self-check.
- **`## Plugin Roots` already has a `<pack>` row**: upsert (refresh the `Root`), never
  duplicate.
- **Registry relocated to a committed file via `registryPath`**: still write there (the
  sanctioned write), but warn that the machine-specific `## Plugin Roots` table should
  stay gitignored — keep the registry under `_local/` unless the project manages it.
- **Self-check FAIL**: report it as the final state (`partial`); do not claim success.

## Final output

The invoking init emits a fenced `WF-<PACK>-INIT — <onboarded | already-registered |
partial>` block as the **very last thing** output to chat. Shared rows every pack fills:
`Registry:`, `Pack root:`, `Registered: <capability> — …`, `Self-check: …`, and a
`Next:` line. The invoking init inserts its own Phase-4 rows (a profile line, or a
config-section summary) between `Registered:` and `Self-check:`.
