# Fixture registry — duplicate Plugin in `## Plugin Roots` (fails CHECK 4b)

A duplicate `Plugin` key would make resolution pick the first match silently; it is a
validation error.

## Capabilities

| Capability | Path |
|------------|------|

## Plugin Roots

| Plugin  | Root                                           |
|---------|------------------------------------------------|
| testpkg | plugins/wf                                     |
| testpkg | plugins/wf/skills/_contracts/registry-fixtures |
