# Fixture registry — plugin-anchored Path with no `## Plugin Roots` entry (fails)

A `plugin:testpkg/...` Path is present but there is no `## Plugin Roots` mapping for
`testpkg`, so the plugin is unmapped and cannot resolve — a validation error naming
the plugin.

## Capabilities

| Capability | Path                     |
|------------|--------------------------|
| solo       | plugin:testpkg/caps/solo |
