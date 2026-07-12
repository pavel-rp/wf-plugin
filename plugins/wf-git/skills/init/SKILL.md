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

The generic onboarding spine — register the capability, record the install root,
self-check — is shared by every provider pack and lives in
`plugins/wf/skills/_contracts/pack-onboarding.ops.md`. wf-git supplies the parameters
below; the spine carries the rest. wf-git ships exactly one capability, so there is no
capability-subset argument.

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

---

## Safety Rules (NON-NEGOTIABLE)

**Allowed:**

- Read any file; read `${CLAUDE_PLUGIN_ROOT}` and read-only git (`git rev-parse`).
- Write/edit files under `_local/`.
- Write the `## Plugin Roots` and `## Capabilities` tables to the **resolved registry
  location** — the one sanctioned write outside `_local/`, since registering the pack is
  this skill's whole purpose.

**Forbidden:**

- Modify any source file except the writes named above.
- Register a `/command` (impossible — native discovery only; this skill wires the
  fragment/registry).
- Record any plugin's root but **its own** (`${CLAUDE_PLUGIN_ROOT}` = wf-git).
- Run builds, tests, installs, or any destructive git operation.

---

## Onboarding procedure

Follow `plugins/wf/skills/_contracts/pack-onboarding.ops.md` end to end (Phases 0–5),
supplying these parameters:

- `<pack>` = `wf-git`
- `<capability>` = `git`
- **Phase 4 detail** = the no-op profile seed below.

### Phase 4 detail: seed profiles

The `git` capability's manifest declares **no** `profile-template:` — no-op. Record
`skipped — no template`.

---

## Edge Cases

The generic onboarding stop/idempotency conditions — `/wf:init` not run,
`$CLAUDE_PLUGIN_ROOT` unset, `git` already registered, a `wf-git` plugin-root row already
present, registry relocated via `registryPath`, and self-check FAIL — are handled by
`plugins/wf/skills/_contracts/pack-onboarding.ops.md` §"Edge cases". wf-git adds none of
its own (it runs no interview).

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
