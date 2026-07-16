---
name: resolve
description: Inspects and manages the wf resolution snapshot through the bundled typed resolver MCP service — the same typed tools normal skills and isolated subagents use to obtain config, capability, provider, path, and diagnostic facts. Dispatches inspect (show state + diagnostics), refresh (rebuild the resolved view), and invalidate (mark it stale). Use to check what wf resolved, force a rebuild after changing the registry or installed packs, or debug a capability that is not resolving.
allowed-tools: [Read]
---

# /wf:resolve — Inspect and manage the resolution snapshot

Thin frontend over the bundled **wf resolver MCP service** — the typed tools exposed by the always-loaded `wf-resolver` server (`resolve_config`, `resolve_registry`, `resolve_provider`, `resolve_profile`, `resolve_plugin_root`, `inspect_pack`, `register_pack`, and the `resolve_inspect` / `resolve_refresh` / `resolve_invalidate` lifecycle). This skill dispatches the three lifecycle actions and prints the result. It performs **no discovery of its own** — no `_local/config.md` parse, no registry read, no plugin-root probe, no installed-folder walk. Every fact comes from a typed tool call, exactly as a normal skill or an isolated subagent obtains it.

**Read-only on your project (except `refresh`/`invalidate`, which only touch the resolver's own `_local/resolver/` cache via the service). Never edits source, never commits, never registers a pack.** (Pack registration is `register_pack`, driven by a pack's own init skill — not this skill.)

---

## When to use

- **inspect** — see what wf currently resolved: validity, cache state, capability/pack/provider counts, and any diagnostics. The default when no action is given.
- **refresh** — after you edit the registry, install/enable/disable a pack, or change `wf.config.js`: rebuild the resolved view so the next skill sees the change.
- **invalidate** — mark the resolved view stale without rebuilding (the next query, or an explicit `refresh`, rebuilds it). Use when you know inputs changed but do not want to rebuild yet.

**Do NOT use `/wf:resolve` to** register a pack (that is `/wf-<pack>:init` → `register_pack`), edit the registry by hand, or read a capability's fragment/prompt body (the service never returns bodies — paths and metadata only).

**Freshness is automatic.** Every typed resolver query re-validates the snapshot's recorded input fingerprints (registry, capability manifests, plugin roots, profiles, and the resolver schema/version) and rebuilds on any mismatch — so a registry edit, a manifest change, or an `init` completion is picked up on the very next query without a manual `refresh`. Core's SessionStart hook additionally runs a pre-MCP `refresh-if-stale` pass so a change made while Claude was closed (including a plugin add/remove) is reconciled at session start. Freshness is driven only by these recorded inputs and explicit requests — **never by elapsed time**. `refresh`/`invalidate` remain available to force the rebuild point or to record that inputs changed.

---

## Command Syntax

```
/wf:resolve [inspect | refresh | invalidate]
```

### Arguments

| Argument     | Required | Description                                                                                 |
| ------------ | -------- | ------------------------------------------------------------------------------------------- |
| `inspect`    | NO       | Show lifecycle state + diagnostics (and the resolved config/registry when valid). **Default.** |
| `refresh`    | NO       | Rebuild the resolved snapshot from current inputs and persist it.                           |
| `invalidate` | NO       | Mark the resolved snapshot stale; the next query rebuilds it.                               |

Empty input runs **inspect**. Any other token: stop with the syntax line above.

---

## Safety Rules

**Allowed:**

- Call the bundled `wf-resolver` MCP tools (`resolve_inspect`, `resolve_refresh`, `resolve_invalidate`, and — for a fuller inspect — `resolve_config`, `resolve_registry`).
- Print the returned metadata verbatim.

**Forbidden:**

- Any discovery outside the typed service: no `_local/config.md` parse, no `## Capabilities` / `## Plugin Roots` read, no `${CLAUDE_PLUGIN_ROOT}` probe, no installed-folder walk. If a fact is needed, call the tool that returns it.
- Write any file directly (the service owns the `_local/resolver/` cache).
- Register a pack, edit the registry, or mutate source.
- Echo any fragment / skill / prompt body — the service returns none, and this skill adds none.

---

## Action: inspect (default)

1. Call `resolve_inspect`. It returns `{ valid, cached, generatedAt, schemaVersion, counts{capabilities,packs,providers}, diagnostics[] }`.
2. If `valid` is true, also call `resolve_config` and `resolve_registry` to show the resolved view (workspace root, registry path, core config, id shape, and the ordered capability list with kind/validity/provenance). These reuse the same cached snapshot — no rediscovery.
3. Print the state, then the resolved view (when valid), then any diagnostics. Do not print fragment bodies — the responses carry none.

If `valid` is false and `cached` is false, report that nothing has been resolved yet and suggest `refresh`.

## Action: refresh

1. Call `resolve_refresh`. It rebuilds and persists, returning the fresh lifecycle state.
2. Print the new state (`valid` should be true) and its counts + diagnostics.

## Action: invalidate

1. Call `resolve_invalidate`. It marks the view stale (does not rebuild), returning the lifecycle state (`valid: false`). A typed consumer may pass `reasons` (short suspected-stale messages) which surface as `freshness/*` diagnostics on the returned state.
2. Print the state and note that the next resolver query (or `/wf:resolve refresh`) will rebuild.

---

## Edge Cases

- **Unknown action token** — stop: "Usage: `/wf:resolve [inspect | refresh | invalidate]`."
- **`wf-resolver` MCP server not available** — the tools are unreachable (the plugin's `.mcp.json` sets `alwaysLoad: true`, so this is unusual). Stop and report that the resolver runtime is not loaded; suggest restarting Claude Code. Do **not** fall back to hand-parsing the registry — that is exactly the discovery this service replaces.
- **A tool returns `isError`** — surface the error message as-is; do not retry with a hand-rolled discovery path.
- **Diagnostics present but `valid: true`** — the resolved view is usable; print the diagnostics as warnings (e.g. a registered-but-unrecoverable pack) so the user can act.

---

## Final Output

Always end with the fenced status block as the very last thing emitted.

Success:

```
RESOLVE — <inspect | refresh | invalidate>

Valid: <true | false>   Cached: <true | false>   Generated: <iso | —>
Counts: capabilities=<n> packs=<n> providers=<n>
Diagnostics: <count, or "none">
<one line per diagnostic when present>

Next: <suggested command>
```

Error:

```
RESOLVE — Error

Reason: <one sentence — what went wrong>

Next: <suggested recovery>
```

`Next:` guidance: after **inspect** with an invalid/empty view → `Next: /wf:resolve refresh`. After **refresh** → `Next: none — the resolved view is current.` After **invalidate** → `Next: /wf:resolve refresh (or run any wf skill — the next query rebuilds).` On a resolver-unavailable error → `Next: restart Claude Code so the wf-resolver MCP server loads.`
