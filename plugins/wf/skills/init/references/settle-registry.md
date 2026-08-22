# Settling the registry-derived scaffolding

Read on the settle path only — `/wf:init` Phase 9 reaches this file through
`resolve_content({ workspaceRoot, class: "references-template", skill: "init",
ref: "settle-registry.md" })`, never a raw `Read` of a plugin-cache path, and
never at boot.

These are the two registry-derived loops. They run after the registry is current
— never in Phase 3, which is bare-core only — and they run on every path,
including after a `no-change` plan, after a rejected apply, and after the
reconcile settled exit.

**Domain-free guard:** both loops name **no** concrete capability. They iterate
the resolved registry and key on the presence of a declared field.

---

## Loop 1 — Seed capability profiles

Execute the profile-seeding convention defined in
`plugins/wf/skills/_contracts/capability-registry.contract.md`
(§"The profile-seeding convention") — follow it **by name**; do not re-derive its
rules.

Call `resolve_registry({ workspaceRoot })` and iterate the returned
`capabilities[]`. Empty ⇒ seed nothing (the inert no-op; report "none").

Per capability, read `validity` and `profileTemplatePath`:

- `unrecoverable` ⇒ skip, record `skipped — unreadable manifest`.
- `ok` with a null template ⇒ skip, record `skipped — no template`.
- Otherwise read the template — **verbatim when the path is absolute** (a
  plugin-anchored root outside the workspace), joined to the workspace root only
  when it is relative.

Derive the destination `_local/profiles/<name>.profile.json` from the registry
`name` field, after confirming it is a filesystem-safe token (lowercase letters,
digits, hyphens; no separator, no `..`, no whitespace) — otherwise skip the row
and record `skipped — unsafe capability name`.

**Seed an override only on divergence, never overwrite an existing
destination**; precedence is downstream override > capability default, stated in
the seeded file, with the convention's angle-bracketed placeholders for divergent
slots.

Carry model attribution where the format has a schema-permitted place for it;
where it has none, omit it in-file and record the seeding model on the Final
Output row.

## Loop 2 — Append the page-test exclude (conditional)

Per capability, call `resolve_profile({ workspaceRoot, capability: <name> })` —
it returns the capability's persisted profile as written (no template or
override tier is merged in), so there is no hand-merge here.

For any resolved profile declaring a `test-host-root`, check whether the
conventional sandbox module-test folder under it exists in this checkout; if it
does, ensure `.git/info/exclude` contains that capability's `_page-tests/` path
under the root, appending only when missing.

If no profile declares the field, or the folder is absent, skip silently.
