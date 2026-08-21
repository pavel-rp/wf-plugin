---
name: resolve
description: Inspects and manages the wf resolution snapshot through the bundled typed resolver MCP service — the same typed tools normal skills and isolated subagents use to obtain config, capability, provider, path, and diagnostic facts. Dispatches inspect (show state + diagnostics), refresh (rebuild the resolved view), and invalidate (mark it stale). Use to check what wf resolved, force a rebuild after changing the registry or installed packs, or debug a capability that is not resolving.
allowed-tools: [Read, Bash, ToolSearch]
---

# /wf:resolve — Inspect and manage the resolution snapshot

Thin frontend over the bundled **wf resolver MCP service** — the always-loaded `wf-resolver` server. Its current surface comprises the `wf_resolver_status` liveness probe; metadata queries (`resolve_config`, `resolve_registry`, `resolve_provider`, `resolve_profile`, `resolve_settings`, `resolve_plugin_root`, `resolve_gate`, `resolve_inspect`); lifecycle mutations (`resolve_refresh`, `resolve_invalidate`); pack operations (`inspect_pack`, `discover_packs`, `register_pack`); composition preview (`preview_composition`); structural/reference validators (`validate_manifest`, `validate_registry`, `validate_skill_interface`, `validate_references`); and the distinct body-serving tool `resolve_content`. This skill dispatches the three lifecycle actions and prints the result. It performs **no discovery of its own** — no `_local/config.md` parse, no registry read, no plugin-root probe, no installed-folder walk. Every fact comes from a typed tool call, exactly as a normal skill or an isolated subagent obtains it.

**Read-only on your project (except `refresh`/`invalidate`, which only touch the resolver's own `_local/resolver/` cache via the service). Never edits source, never commits, never registers a pack.** (Pack registration is `register_pack`, driven by a pack's own init skill — not this skill.)

---

## When to use

- **inspect** — see what wf currently resolved: validity, cache state, capability/pack/provider counts, and any diagnostics. The default when no action is given.
- **refresh** — after you edit the registry, install/enable/disable a pack, or change `wf.config.js`: rebuild the resolved view so the next skill sees the change.
- **invalidate** — mark the resolved view stale without rebuilding (the next query, or an explicit `refresh`, rebuilds it). Use when you know inputs changed but do not want to rebuild yet.

**Do NOT use `/wf:resolve` to** register a pack (that is `/wf-<pack>:init` → `register_pack`), edit the registry by hand, or print a bundled body. Metadata tools remain body-free; only `resolve_content` serves approved bodies, across its six classes: `fragment`, `contract`, `shared`, `references-template`, `profile-template`, and `slot` (the composed `skill` + `point` content surface).

**Freshness is automatic.** Every typed resolver query re-validates the snapshot's recorded input fingerprints (registry, capability manifests, plugin roots, profiles, and the resolver schema/version) and rebuilds on any mismatch — so a registry edit, a manifest change, or an `init` completion is picked up on the very next query without a manual `refresh`. Core's SessionStart hook additionally runs a pre-MCP `refresh-if-stale` pass so a change made while Claude was closed (including a plugin add/remove) is reconciled at session start. Freshness is driven only by these recorded inputs and explicit requests — **never by elapsed time**. `refresh`/`invalidate` remain available to force the rebuild point or to record that inputs changed.

**Failure is predictable and safe.** When the resolver cannot produce a trustworthy resolution (a missing / malformed / schema-incompatible / fingerprint-unresolvable / cli-unavailable / registry-invalid state), a consumer about to act asks the `resolve_gate` typed query for its surface (`local-read` | `tracker-write` | `delivery-write`). It binds the failure to the existing degradation policy — **a local read continues** best-effort, **a tracker write warns and continues**, **a delivery write blocks before any mutation** — always with categorized diagnostics and a `/wf:resolve refresh` (or `invalidate`) recovery path, and never a fallback to folder-walking or environment probing. `inspect` here surfaces the same diagnostics; the recovery is exactly `refresh`/`invalidate`.

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

- Call the bundled `wf-resolver` MCP tools needed by this skill (`resolve_inspect`, `resolve_refresh`, `resolve_invalidate`, and — for a fuller inspect — `resolve_config`, `resolve_registry`). Before those calls, run `pwd -P`; every call must explicitly pass the returned absolute current Agent/session workspace directory as `workspaceRoot`.
- Print the returned metadata verbatim.

**Forbidden:**

- Any discovery outside the typed service: no `_local/config.md` parse, no `## Capabilities` / `## Plugin Roots` read, no `${CLAUDE_PLUGIN_ROOT}` probe, no installed-folder walk. If a fact is needed, call the tool that returns it.
- Write any file directly (the service owns the `_local/resolver/` cache).
- Register a pack, edit the registry, or mutate source.
- Echo any fragment / skill / prompt body. Metadata responses carry none, and this skill does not call the distinct `resolve_content` body-serving surface.

---

Before any action, run `pwd -P` and use the returned absolute current Agent/session workspace directory as `workspaceRoot` on **every** resolver MCP call. In a linked-worktree Agent, that cwd is the Agent's own worktree; never inherit the parent session's root. `workspaceRoot` is schema-required: omission is a hard schema error, with no default or fallback.

## Action: inspect (default)

1. Call `resolve_inspect` with `workspaceRoot: "<Agent/session absolute current workspace directory>"`. It returns `{ valid, cached, generatedAt, schemaVersion, counts{capabilities,packs,providers}, diagnostics[] }`.
2. If `valid` is true, also call `resolve_config` and `resolve_registry`, each with the same explicit `workspaceRoot`, to show the resolved view (workspace root, registry path, core config, id shape, and the ordered capability list with kind/validity/provenance). These reuse the same cached snapshot — no rediscovery.
3. Print the state, then the resolved view (when valid), then any diagnostics. Do not print fragment bodies — the responses carry none.

If `valid` is false and `cached` is false, report that nothing has been resolved yet and suggest `refresh`.

## Action: refresh

1. Call `resolve_refresh` with `workspaceRoot: "<Agent/session absolute current workspace directory>"`. It rebuilds and persists, returning the fresh lifecycle state.
2. Print the new state (`valid` should be true) and its counts + diagnostics.

## Action: invalidate

1. Call `resolve_invalidate` with `workspaceRoot: "<Agent/session absolute current workspace directory>"`. It marks the view stale (does not rebuild), returning the lifecycle state (`valid: false`). A typed consumer may also pass `reasons` (short suspected-stale messages), which surface as `freshness/*` diagnostics on the returned state.
2. Print the state and note that the next resolver query (or `/wf:resolve refresh`) will rebuild.

---

## Edge Cases

- **Unknown action token** — stop: "Usage: `/wf:resolve [inspect | refresh | invalidate]`."
- **`wf-resolver` MCP server not available** — this skill's tools (`resolve_inspect`, `resolve_refresh`, `resolve_invalidate`) are **deferred**: their schemas load on demand, so a "no such tool" on first reach means *not yet fetched*, not *not installed*. Fetch them through the host's tool-search surface and retry once. Only if the retry still fails, stop and report that the resolver runtime is not loaded; suggest restarting Claude Code. Do **not** fall back to hand-parsing the registry — that is exactly the discovery this service replaces.
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
