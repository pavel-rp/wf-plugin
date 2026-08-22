# Resolving and guarding the registry location

Read on the scaffold write path only — `/wf:init` Phase 3 reaches this file
through `resolve_content({ workspaceRoot, class: "references-template", skill:
"init", ref: "registry-location.md" })`, never a raw `Read` of a plugin-cache
path, and never at boot.

Writing the `## Capabilities` registry table to a configured `registryPath` is
the one sanctioned scaffold write outside `_local/`, since relocating the
registry is that key's whole purpose. It is therefore the one scaffold write that
needs a containment check of its own.

## Resolve

Resolve the location from `registryPath`. When no override is configured the
resolver's default is `_local/config.md`, so default behaviour is byte-identical
to a workspace that never set the key.

Record the state for the Final Output: `default`, `configured`, or
`rejected → fell back to default`.

## The defensive check

Before writing to a **non-default** `registryPath`:

1. Confirm it is a repo-relative, forward-slash file path with no `..` segment
   and no absolute or drive prefix.
2. Canonicalize the target — or its nearest existing ancestor — and require it to
   stay under the canonical admitted root. This second step is what catches a
   relative path escaping through a symlink, which step 1 alone cannot see.

**On failure, do not write there.** Fall back to `_local/config.md`, record
`rejected → fell back to default`, and flag the rejected value loudly. Silently
honouring a path that failed containment, or silently discarding it, are both
wrong: the user set the key deliberately and must learn it was refused.

## One registry, never two

The `## Capabilities` section belongs to exactly one destination.

- **Same-file case** — the resolved location *is* `_local/config.md` ⇒ the table
  rides inside the config template.
- **Relocated case** ⇒ omit `## Capabilities` from the `_local/config.md` write
  entirely, and write that section only to the resolved location.

The two writes skip independently, each guarded on its own destination, so
re-running after the registry moved still creates it where it now belongs.
